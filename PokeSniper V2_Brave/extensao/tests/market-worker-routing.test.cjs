const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { runInNewContext } = require('node:vm');
const test = require('node:test');

const source = readFileSync(join(__dirname, '../background.js'), 'utf8');

test('atribui falhas e vendas repetidas à página certa e nunca dispara avisos sintéticos', async () => {
  const listeners = [];
  const trace = [];
  const messages = [];
  const session = {}, savedNotices = {};
  const durableQueue = new Map();
  const failedJobs = [];
  const chrome = {
    runtime: {
      id: 'own', getURL: file => 'chrome-extension://own/' + file,
      onMessage: { addListener(fn) { listeners.push(fn); } },
    },
    storage: { session: {
      async set(values) { Object.assign(session, values); },
      async get(key) { return { [key]: session[key] }; },
    }, local: { async set(values) { Object.assign(savedNotices, values); } } },
    notifications: { async create() {} },
    tabs: { async sendMessage(id, message) { messages.push([id, message.type]); return { ok: true }; } },
  };
  const context = {
    chrome, importScripts() {}, console,
    PISMarketCore: { validate: (_kind, rows) => rows, safeSprite: () => null },
    PISHistoryTrace: { async record(event, details, receipt) { trace.push([event, details.page, receipt?.status, receipt?.existing]); } },
    PISOpportunityAlerts: { wake() {} },
    PISMarketStore: {
      async initialize() {},
      async enqueueBatch(job) {
        const old = durableQueue.get(job.id);
        if (!old) durableQueue.set(job.id, { ...job, dueAt: 0, attempts: 0 });
        return { duplicate: !!old };
      },
      async nextBatch() {
        return [...durableQueue.values()].find(job => job.dueAt <= Date.now()) ?? null;
      },
      async finishBatch(id) { durableQueue.delete(id); },
      async deferBatch(id, attempts) {
        const job = durableQueue.get(id);
        failedJobs.push(id);
        durableQueue.set(id, { ...job, dueAt: Number.MAX_SAFE_INTEGER, attempts });
      },
      async trimDoneBatches() {},
      async ingest(_kind, rows) {
        if (rows[0] === 'failure') throw new Error('fake');
        return { new: 0, existing: rows.length, gainedFullIvs: 0 };
      },
    },
  };
  runInNewContext(source, context);
  const sender = { id: 'own', url: 'https://pokeidle.io/', tab: { id: 7 } };
  const dispatch = (req, from = sender) => new Promise(resolve => {
    if (!listeners[0](req, from, resolve)) resolve(undefined);
  });
  const event = (page, rows) => ({ type: 'PIS_MARKET_HISTORY_EVENT', event: 'response', trace: { page }, rows });
  assert.equal((await dispatch(event(1, ['known']))).ok, true);
  assert.equal((await dispatch(event(2, []))).ok, true);
  // O ACK é dado após a fila persistir; falha do ingest fica para retry.
  assert.equal((await dispatch(event(3, ['failure']))).ok, true);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual([...trace].sort((a, b) => a[1] - b[1]), [
    ['response', 1, 'gravado', 1], ['response', 2, 'sem_registros_validos', undefined],
    ['response', 3, 'falha_na_gravação', undefined]]);
  assert.equal(failedJobs.length, 1);
  assert.equal(durableQueue.size, 1); // não descartou o lote que falhou
  assert.equal(await dispatch({ type: 'PIS_TEST_GAME_TOAST' }), undefined);
  const popup = { id: 'own', url: 'chrome-extension://own/opportunities.html' };
  assert.equal(await dispatch({ type: 'PIS_TEST_GAME_TOAST' }, popup), undefined);
  assert.equal(await dispatch({ type: 'PIS_TEST_DESKTOP_TOAST' }, popup), undefined);
  assert.deepEqual(messages, []);
  const query = { type: 'PIS_MARKET_QUERY', route: 'orb', page: 1, order: 'recentes', durationMs: 184 };
  assert.equal((await dispatch({ ...query, status: 'resposta' })).ok, true);
  assert.equal(session['pisMarketQuery:orb'].duração_ms, 184);
  assert.equal((await dispatch({ ...query, status: 'enviada' })).ok, true);
  assert.equal(session['pisMarketQuery:orb'].duração_ms, null);
  assert.equal((await dispatch({ type: 'PIS_MARKET_CORE_BATCH', kind: 'sale', rows: ['known'] })).ok, true);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(trace.at(-1), ['legacy_batch', undefined, 'gravado', 1]);
});

test('a vitrine de Gemas só exibe estimativas frescas da fonte pública', async () => {
  let listener;
  const estimate = { status: 'estimated', lower: 2500, median: 2900, upper: 3500 };
  const cases = {
    public: { ...estimate, method: 'briaoale_public', sourceAt: Date.now() - 1000 },
    expired: { ...estimate, method: 'briaoale_public', sourceAt: Date.now() - 73 * 3600000 },
    fallback: { ...estimate, method: 'briaoale_pve' },
    coins: { ...estimate, method: 'coins_comparables' },
  };
  const context = {
    chrome: { runtime: { onMessage: { addListener(fn) { listener ??= fn; } } } },
    importScripts() {}, console, PISPublicGems: require('../public-gems'),
    PISMarketStore: {
      async initialize() {},
      async marketBadges(offers) {
        return offers.map(offer => ({ offer, row: { ...offer, estimate: cases[offer.id] } }));
      },
    },
  };
  runInNewContext(source, context);
  const offers = Object.keys(cases).map(id => ({ id, currency: id === 'coins' ? 'gold' : 'orb', price: 6000 }));
  const reply = await new Promise(resolve =>
    listener({ type: 'PIS_MARKET_BADGES', offers }, { url: 'https://pokeidle.io/', tab: { id: 1 } }, resolve));
  assert.equal(reply.offers[0].quote.median, 2900);
  assert.equal(reply.offers[1].quote, null);
  assert.equal(reply.offers[2].quote, null);
  assert.equal(reply.offers[3].quote.median, 2900);
});
