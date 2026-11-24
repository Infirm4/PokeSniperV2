const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { runInNewContext } = require('node:vm');

const source = file => readFileSync(join(__dirname, '..', file), 'utf8');
const policy = require('../market-priority.js');
const core = require('../market-core.js');
const opportunity = require('../opportunities.js');

const view = { kind: 'listing', viewing: true, automatic: false };
const recent = page => ({ kind: 'listing', automatic: true, order: 'recentes', page });
const historic = { kind: 'listing', automatic: true, preparation: true, olderScan: true, order: 'baratos' };

test('a prioridade da vitrine precede Recentes (páginas 1–3) e varreduras', () => {
  assert.equal(policy.forJob(view), 0);
  for (const page of [0, 1, 2]) assert.equal(policy.forJob(recent(page)), 1);
  assert.equal(policy.forJob(recent(3)), 2);
  assert.equal(policy.forJob(historic), 3);
  assert.equal(policy.forJob({ kind: 'sale' }), 2);
  assert.deepEqual(policy.order(false), [0, 1, 2, 3]);
  assert.deepEqual(policy.order(true), [0, 3, 2, 1]);
});

function indexedDbQueue(jobs) {
  const ranges = [];
  const db = {
    onversionchange: null,
    transaction(store) {
      assert.equal(store, 'marketQueue');
      return { objectStore() { return { index(name) {
        assert.equal(name, 'readyPriority');
        return { openCursor(range) {
          ranges.push(range);
          const request = {};
          const eligible = jobs.filter(job => job.status === range.lower[0] &&
            job.priority === range.lower[1] && job.dueAt <= range.upper[2] &&
            job.dueAt >= range.lower[2]).sort((a,b) => a.dueAt-b.dueAt || a.createdAt-b.createdAt);
          queueMicrotask(() => { request.result = eligible.length ? { value: eligible[0] } : null; request.onsuccess?.(); });
          return request;
        } }; } }; } };
    },
  };
  const indexedDB = {
    open(_name, version) {
      assert.equal(version, 20);
      const request = { result: db };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    },
  };
  const IDBKeyRange = { bound(lower, upper) { return { lower, upper }; } };
  return { indexedDB, IDBKeyRange, ranges };
}

test('fila persistida seleciona a vitrine antes de backlog, sem aceitar lote em backoff', async () => {
  const now = Date.now();
  const jobs = [
    { id: 'historico', status: 'pending', priority: 3, dueAt: 0, createdAt: 1 },
    { id: 'recentes', status: 'pending', priority: 1, dueAt: 0, createdAt: 2 },
    { id: 'vitrine', status: 'pending', priority: 0, dueAt: 0, createdAt: 4 },
    { id: 'vitrine_adiada', status: 'pending', priority: 0, dueAt: now + 60_000, createdAt: 1 },
  ];
  const context = indexedDbQueue(jobs);
  const store = runInNewContext(source('market-store.js') + '\nPISMarketStore;', {
    ...context, PISMarketPriority: policy, console,
  });
  assert.equal((await store.nextBatch(now)).id, 'vitrine');
  jobs[2].status = 'done';
  assert.equal((await store.nextBatch(now)).id, 'recentes');
  assert.equal((await store.nextBatch(now, { backgroundTurn: true })).id, 'historico');
  jobs[0].status = 'done'; jobs[1].status = 'done';
  assert.equal(await store.nextBatch(now), null);
  assert.ok(context.ranges.length >= 5);
});

test('nota é truncada sem arredondar para cima, com ponto ou vírgula', () => {
  for (const raw of [3.978, '3,978', '3.978', 3.9799999999])
    assert.equal(core.truncateGrade(raw), 3.97);
  assert.equal(core.truncateGrade('3,980'), 3.98);
  assert.equal(core.truncateGrade(3.97), 3.97);
  assert.equal(core.truncateGrade(9.999), 9.99);
  assert.equal(core.truncateGrade('abc'), null);
  const sample = { id: 'g1', moeda: 'orb', preco: 77, tipo: 'pokemon', estado: 'aberto',
    ficha: { speciesId: '25', level: 80, nota: '3,978', shiny: false } };
  const captured = core.capture({ t: 'market', aba: 'vitrine', moeda: 'orb', linhas: [sample] });
  assert.equal(captured.rows[0].grade, 3.97);
  assert.equal(core.validate('listing', captured.rows)[0].grade, 3.97);
});

test('filtro e visualização usam a mesma nota truncada, inclusive registros históricos', () => {
  const row = { grade: 3.978, level: 100, power: 3, currency: 'gold', price: 70,
    estimate: { status: 'estimated', median: 100, lower: 80 }, id: 'n1' };
  assert.match(opportunity.profileSummary(row), /N 3,97$/);
  assert.match(opportunity.profileSummary(row, false), /Nota 3,97$/);
  assert.equal(opportunity.matches(row, opportunity.settings({ minGrade: '3,98' })), false);
  assert.equal(opportunity.matches(row, opportunity.settings({ minGrade: '3,97' })), true);
  assert.equal(opportunity.matches({ ...row, grade: 3.981 }, opportunity.settings({ minGrade: '3,98' })), true);
  const popup = source('opportunities-popup.js');
  assert.match(popup, /const displayGrade =/);
  assert.match(popup, /Nota \$\{displayGrade\(row\.grade\)\}/);
});

test('outbox do MAIN envia primeiro anúncio da página visível mesmo com backlog histórico', async () => {
  const src = source('sniper.js');
  const snippet = src.slice(src.indexOf('  // Outbox do MAIN no domínio do jogo:'),
    src.indexOf('  const observedGameSockets'));
  const messages = [];
  const window = { postMessage(message) { messages.push(message); }, addEventListener() {} };
  const indexedDB = { open() { return {}; } }; // A inicialização do outbox fica pendente neste teste.
  const state = runInNewContext(snippet + '\n({ marketDeliveries, dispatchMarketOutbox })', {
    window, indexedDB, console, Date, Math, setInterval() {}, location: { origin: 'https://pokeidle.io' },
  });
  for (let i = 0; i < 15; i++) state.marketDeliveries.set('backlog-' + i, {
    persisted: true, message: { kind: 'listing', automatic: true, preparation: true, order: 'baratos',
      batchId: 'backlog-' + i },
  });
  state.marketDeliveries.set('visible-now', { persisted: true, message: {
    batchId: 'visible-now', kind: 'listing', viewing: true, automatic: false,
  } });
  state.dispatchMarketOutbox();
  const batchIds = messages.filter(message => message.batchId)
    .map(message => message.batchId);
  assert.equal(batchIds[0], 'visible-now');
  assert.equal(batchIds.length, 6);
});

test('bridge preserva contexto da página; worker classifica corretamente três tipos de lote', async () => {
  assert.match(source('bridge.js'), /viewing: msg\.viewing === true, order: msg\.order/);
  assert.match(source('sniper.js'), /viewing, order: request\?\.ordem/);
  const listeners = [];
  const received = [];
  const session = {};
  const chrome = {
    runtime: { id: 'test-extension', onMessage: { addListener(fn) { listeners.push(fn); } } },
    storage: { session: { async set(values) { Object.assign(session, values); }, async get() { return {}; } },
      local: { async set() {} } },
    alarms: { onAlarm: { addListener() {} }, async create() {} },
  };
  const store = {
    async initialize() {}, async enqueueBatch(job) { received.push(job); return { queued: true }; },
    async nextBatch() { return null; }, async trimDoneBatches() {},
  };
  runInNewContext(source('background.js'), {
    chrome, PISMarketPriority: policy, importScripts() {}, console,
    PISMarketCore: { validate(_type, rows) { return rows; }, safeSprite() { return null; } },
    PISMarketStore: store, PISMarketEventLog: { record() {} }, PISHistoryTrace: {},
    PISOpportunityAlerts: {},
  });
  const sender = { id: 'test-extension', tab: { id: 5 }, url: 'https://pokeidle.io/app' };
  const send = req => new Promise(resolve => listeners[0]({
    type: 'PIS_MARKET_CORE_BATCH', kind: 'listing', currency: 'gold', rows: [{ id: 'safe', price: 1 }],
    batchId: 'main:prio_' + String(received.length).padStart(5, '0'), ...req,
  }, sender, resolve));
  assert.equal((await send({ viewing: true, automatic: false })).ok, true);
  assert.equal((await send({ viewing: false, automatic: true, order: 'recentes', page: 2 })).ok, true);
  assert.equal((await send({ viewing: false, automatic: true, order: 'baratos', preparation: true })).ok, true);
  assert.deepEqual(received.map(job => job.priority), [0, 1, 3]);
});
