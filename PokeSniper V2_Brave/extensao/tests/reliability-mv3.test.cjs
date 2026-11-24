const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { runInNewContext } = require('node:vm');

const source = file => readFileSync(join(__dirname, '..', file), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
async function waitUntil(predicate, message) {
  for (let i = 0; i < 150; i++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.fail(message);
}

function fakeWorkerStore() {
  const queue = new Map();
  const processed = [];
  const attempts = new Map();
  let rejectOnce = null;
  return {
    queue, processed, attempts,
    failNext(id) { rejectOnce = id; },
    async initialize() {},
    async enqueueBatch(job) {
      if (job.id.includes('reject_enqueue')) throw Error('IndexedDB quota exceeded');
      const duplicate = queue.has(job.id);
      if (!duplicate) queue.set(job.id, { ...job, status: 'pending', dueAt: 0, attempts: 0 });
      return { queued: true, duplicate };
    },
    async nextBatch() {
      return [...queue.values()].find(row => row.status === 'pending' && row.dueAt <= Date.now()) ?? null;
    },
    async ingest(kind, rows) {
      const id = rows[0].id;
      attempts.set(id, (attempts.get(id) ?? 0) + 1);
      if (id === rejectOnce) { rejectOnce = null; throw Error('transaction aborted'); }
      processed.push({ id, kind });
      return { new: rows.length, conflicts: 0 };
    },
    async finishBatch(id) { queue.set(id, { id, status: 'done', dueAt: Number.MAX_SAFE_INTEGER }); },
    async deferBatch(id, tries) { queue.set(id, { ...queue.get(id), attempts: tries, dueAt: Date.now() + 30000 }); },
    async trimDoneBatches() {},
  };
}

function loadWorker(store) {
  const listeners = [];
  const alarms = [];
  const tabMessages = [];
  const session = {};
  const chrome = {
    runtime: { id: 'own', onMessage: { addListener(fn) { listeners.push(fn); } },
      getURL: path => 'chrome-extension://own/' + path },
    storage: { session: { async set(values) { Object.assign(session, values); }, async get() { return {}; } },
      local: { async set() {} } },
    tabs: { async sendMessage(tab, message) { tabMessages.push([tab, message.type]); return { ok: true }; } },
    alarms: { onAlarm: { addListener(fn) { alarms.push(fn); } }, async create() {} },
  };
  runInNewContext(source('background.js'), {
    chrome, importScripts() {}, console: { warn() {} },
    PISMarketCore: { validate: (_kind, rows) => rows, safeSprite: () => null },
    PISMarketStore: store,
    PISOpportunityAlerts: { wake() {} },
    PISHistoryTrace: { async record() {} },
    PISMarketEventLog: { record() {} },
  });
  const sender = { id: 'own', url: 'https://pokeidle.io/app', tab: { id: 10 } };
  const dispatch = req => new Promise(resolve => {
    const handled = listeners[0](req, sender, resolve);
    if (handled === false) resolve({ ok: false, error: 'não tratado' });
  });
  return { dispatch, alarms, tabMessages };
}

test('60 lotes recebem ACK de fila persistida e todos são processados, sem limite de 16', async () => {
  const store = fakeWorkerStore();
  const worker = loadWorker(store);
  const jobs = Array.from({ length: 60 }, (_, i) => ({
    type: 'PIS_MARKET_CORE_BATCH', kind: 'listing', batchId: 'main:lot_' + String(i).padStart(5, '0'),
    rows: [{ id: 'pokemon' + i }], currency: 'orb', automatic: i % 2 === 0,
  }));
  const receipts = await Promise.all(jobs.map(worker.dispatch));
  assert.equal(receipts.filter(r => r.ok === true && r.queued === true).length, 60);
  await waitUntil(() => store.processed.length === 60, 'lotes restantes não foram persistidos');
  assert.equal(store.queue.size, 60);
  assert.equal([...store.queue.values()].filter(v => v.status === 'pending').length, 0);
  assert.equal(store.processed.length, new Set(store.processed.map(x => x.id)).size);
  assert.equal((await worker.dispatch(jobs[0])).duplicate, true);
  await flush();
  assert.equal(store.processed.length, 60, 'reenvio após ACK não pode duplicar processamento');
});

test('falha do ingest mantém o lote; outro worker retoma após o backoff', async () => {
  const store = fakeWorkerStore();
  store.failNext('transient');
  const worker1 = loadWorker(store);
  const req = { type: 'PIS_MARKET_CORE_BATCH', kind: 'listing',
    batchId: 'main:transient_1', rows: [{ id: 'transient' }], currency: 'gold' };
  assert.equal((await worker1.dispatch(req)).ok, true);
  await waitUntil(() => store.attempts.get('transient') === 1, 'primeira tentativa não ocorreu');
  await flush();
  assert.equal(store.queue.get(req.batchId).status, 'pending');
  assert.equal(store.queue.get(req.batchId).attempts, 1);
  assert.equal((await worker1.dispatch({ ...req, batchId: 'main:reject_enqueue_2' })).ok, false,
    'falha na gravação da fila não pode gerar confirmação positiva');
  store.queue.get(req.batchId).dueAt = 0;
  const worker2 = loadWorker(store);
  for (const alarm of worker2.alarms) alarm({ name: 'pisMarketQueueDrain' });
  await waitUntil(() => store.queue.get(req.batchId).status === 'done', 'worker reiniciado não retomou o lote');
  assert.equal(store.processed.filter(row => row.id === 'transient').length, 1);
  assert.equal(store.attempts.get('transient'), 2);
});

function fakeOutboxDb() {
  const contents = new Map();
  const db = {
    createObjectStore() {},
    transaction() {
      const tx = {
        objectStore() {
          return {
            put(row) { contents.set(row.batchId, structuredClone(row)); },
            delete(id) { contents.delete(id); },
            getAll() {
              const req = {};
              queueMicrotask(() => { req.result = [...contents.values()]; req.onsuccess?.(); });
              return req;
            },
          };
        },
      };
      queueMicrotask(() => tx.oncomplete?.());
      return tx;
    },
  };
  return {
    contents,
    open() {
      const req = {};
      queueMicrotask(() => {
        req.result = db;
        req.onupgradeneeded?.();
        req.onsuccess?.();
      });
      return req;
    },
  };
}

function loadMainOutbox(indexedDB) {
  const messages = [];
  const events = [];
  const window = {
    addEventListener(type, fn) { if (type === 'message') events.push(fn); },
    postMessage(data) { messages.push(data); },
  };
  const code = source('sniper.js');
  const snippet = code.slice(code.indexOf('  // Outbox do MAIN no domínio do jogo:'),
    code.indexOf('  const observedGameSockets'));
  const api = runInNewContext(snippet + '\n({ publishMarketBatch, dispatchMarketOutbox })', {
    window, indexedDB, location: { origin: 'https://pokeidle.io' }, console,
    setInterval() {}, Math, Date,
  });
  return { messages, api, receive(data) { for (const fn of events) fn({ source: window, origin: 'https://pokeidle.io', data }); } };
}

test('outbox do MAIN recupera a mensagem após reload e só remove com ACK positivo', async () => {
  const indexedDB = fakeOutboxDb();
  const beforeReload = loadMainOutbox(indexedDB);
  beforeReload.api.publishMarketBatch({ rows: [{ id: 'gem1' }], kind: 'listing' });
  await flush();
  assert.equal(indexedDB.contents.size, 1);
  assert.equal(beforeReload.messages.length, 1);
  const batchId = beforeReload.messages[0].batchId;
  const afterReload = loadMainOutbox(indexedDB);
  await flush();
  assert.equal(afterReload.messages[0].batchId, batchId);
  afterReload.receive({ source: 'PIS_BRIDGE', type: 'MARKET_BATCH_RECEIPT', batchId, ok: true });
  await flush();
  assert.equal(indexedDB.contents.size, 0);
});

test('bridge sinaliza contexto invalidado sem enviar mensagens para origin de extensão', async () => {
  const emitted = [];
  const handlers = [];
  let id = 'own';
  const window = {
    addEventListener(type, fn) { if (type === 'message') handlers.push(fn); },
    postMessage(message, origin) { emitted.push([message, origin]); },
  };
  window.top = window;
  const chrome = {
    runtime: {
      get id() { return id; }, onMessage: { addListener() {} },
      sendMessage(_req, callback) { callback?.({ ok: true, queued: true }); },
    },
    storage: { local: { async get() { return {}; } }, onChanged: { addListener() {} } },
  };
  runInNewContext(source('bridge.js'), { window, chrome, location: { origin: 'https://pokeidle.io' }, console });
  id = undefined;
  for (const handler of handlers) handler({ source: window, origin: 'https://pokeidle.io',
    data: { source: 'PIS_MAIN', type: 'MARKET_CORE_BATCH', batchId: 'main:batch_01',
      kind: 'listing', rows: [{ id: 'a' }] } });
  await flush();
  assert.equal(emitted.some(([msg]) => msg.type === 'EXTENSION_CONTEXT_INVALIDATED'), true);
  assert.equal(emitted.some(([msg]) => msg.type === 'MARKET_BATCH_RECEIPT' && msg.ok === false), true);
  assert.equal(emitted.every(([, origin]) => origin === 'https://pokeidle.io'), true);
});
