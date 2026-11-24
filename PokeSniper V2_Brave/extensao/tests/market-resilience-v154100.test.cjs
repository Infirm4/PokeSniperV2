const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { runInNewContext } = require('node:vm');
const source = file => readFileSync(join(__dirname, '..', file), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));

function bridgeHarness() {
  const handlers = new Map();
  const emitted = [];
  const timers = new Map();
  let nextTimer = 0;
  let healthy = false;
  let runtimeId = 'sniper';
  const window = {
    addEventListener(type, fn) { if (!handlers.has(type)) handlers.set(type, []); handlers.get(type).push(fn); },
    postMessage(message, origin) { emitted.push({ message, origin }); },
  };
  window.top = window;
  const chrome = {
    runtime: {
      get id() { return runtimeId; },
      onMessage: { addListener() {} },
      sendMessage(request, callback) {
        if (!healthy) {
          chrome.runtime.lastError = { message: 'Could not establish connection. Receiving end does not exist.' };
          callback(undefined);
          delete chrome.runtime.lastError;
        } else callback({ ok: true, ready: request.type === 'PIS_BRIDGE_HEALTH' });
      },
    },
    storage: { local: { async get() { return {}; } }, onChanged: { addListener() {} } },
  };
  runInNewContext(source('bridge.js'), { window, location: { origin: 'https://pokeidle.io' }, chrome, console,
    setTimeout(fn) { timers.set(++nextTimer, fn); return nextTimer; },
    clearTimeout(id) { timers.delete(id); },
  });
  function emit(type, props = {}) {
    for (const fn of handlers.get('message') ?? []) fn({ source: window, origin: 'https://pokeidle.io',
      data: { source: 'PIS_MAIN', type, ...props } });
  }
  return { emit, emitted, timers, setHealthy: value => { healthy = value; },
    invalidate: () => { runtimeId = undefined; },
    async fireProbe() {
      const [id, fn] = [...timers.entries()][0] ?? [];
      if (fn) { timers.delete(id); fn(); await tick(); }
    } };
}

test('várias desconexões transitórias NÃO disparam pedido permanente de F5; health restaura estado', async () => {
  const harness = bridgeHarness();
  harness.emit('MARKET_MONITOR', { state: 'aguardando_tráfego' });
  harness.emit('MARKET_MONITOR', { state: 'aguardando_tráfego' });
  harness.emit('MARKET_MONITOR', { state: 'aguardando_tráfego' });
  await tick();
  assert.ok(harness.emitted.some(row => row.message.type === 'BRIDGE_STATUS' && row.message.state === 'reconnecting'));
  assert.equal(harness.emitted.some(row => row.message.type === 'EXTENSION_CONTEXT_INVALIDATED'), false);
  harness.setHealthy(true);
  await harness.fireProbe();
  assert.ok(harness.emitted.some(row => row.message.type === 'BRIDGE_STATUS' && row.message.state === 'ready'));
  assert.ok(harness.emitted.every(row => row.origin === 'https://pokeidle.io'));
  harness.emit('BRIDGE_STATUS_REQUEST');
  assert.equal(harness.emitted.at(-1).message.state, 'ready');
});

test('somente o runtime realmente invalidado sinaliza F5', async () => {
  const harness = bridgeHarness();
  harness.invalidate();
  harness.emit('MARKET_CORE_BATCH', { kind: 'listing', rows: [{ id: 'a' }], batchId: 'main:test_001' });
  await tick();
  assert.equal(harness.emitted.some(row => row.message.type === 'EXTENSION_CONTEXT_INVALIDATED'), true);
});

test('worker responde health sem depender do IndexedDB e repassa observações normalizadas aos badges', async () => {
  const listeners = [];
  let actual;
  const chrome = {
    runtime: { id: 'own', getManifest() { return { version: '1.5.4.100' }; },
      getURL: p => 'chrome-extension://own/' + p, onMessage: { addListener(fn) { listeners.push(fn); } } },
    storage: { session: { async get() { return {}; }, async set() {} }, local: { async set() {} } },
  };
  runInNewContext(source('background.js'), {
    chrome, importScripts() {}, console,
    PISMarketCore: { validate(_kind, rows) { return rows.filter(row => row.valid); }, safeSprite() { return null; } },
    PISPublicGems: { freshTimestamp() { return true; }, MAX_AGE: 3600000 },
    PISMarketStore: { async initialize() {}, async marketBadges(offers, now, observations) {
      actual = { offers, now, observations };
      return observations.map(row => ({ offer: { id: row.id, currency: row.currency, price: row.price },
        row: { ...row, estimate: { method: 'briaoale_public', status: 'estimated', sourceAt: now,
          lower: 50, median: 100, upper: 150 } }, excluded: false }));
    } },
    PISOpportunityAlerts: {}, PISHistoryTrace: {}, PISMarketEventLog: {},
  });
  const sender = { id: 'own', tab: { id: 5 }, url: 'https://pokeidle.io/app' };
  const dispatch = message => new Promise(resolve => {
    const handled = listeners[0](message, sender, resolve);
    if (handled === false) resolve({ ok: false });
  });
  const health = await dispatch({ type: 'PIS_BRIDGE_HEALTH' });
  assert.deepEqual([health.ok, health.ready, health.version], [true, true, '1.5.4.100']);
  const out = await dispatch({ type: 'PIS_MARKET_BADGES', offers: [{ id: 'm1', currency: 'orb', price: 50 }],
    observations: [{ id: 'm1', currency: 'orb', price: 50, valid: true },
      { id: 'bad', currency: 'orb', price: 1, valid: false }] });
  assert.equal(out.offers[0].quote.median, 100);
  assert.equal(actual.observations.length, 1);
  assert.equal(actual.observations[0].id, 'm1');
});

test('migração de v18 até v20 cria índice de anúncios recentes sem remover vendas históricas', () => {
  const code = source('market-store.js');
  assert.match(code, /const DB_VERSION = 20/);
  assert.match(code, /pricingGroupRecent/);
  assert.match(code, /now - 60 \* 60000/);
  assert.match(code, /allCoinSales\(sales, now\)/);
  assert.doesNotMatch(code, /deleteObjectStore\('sales'\)/);
});

test('estimativa pública de uma observação ao vivo não aguarda leitura de listings', async () => {
  const storesRead = [];
  const snapshot = { geradoEm: new Date().toISOString() };
  const db = {
    close() {},
    transaction(name) {
      storesRead.push(name);
      if (name !== 'publicPricing') throw Error('consulta de listings indevida para cotação ao vivo');
      return { objectStore() { return { get() {
        const r = {};
        queueMicrotask(() => { r.result = snapshot; r.onsuccess?.(); });
        return r;
      } }; } };
    },
  };
  const indexedDB = { open() {
    const r = { result: db };
    queueMicrotask(() => r.onsuccess?.());
    return r;
  } };
  const context = {
    indexedDB, console, Date,
    PISMarketCore: { isOutland() { return false; }, matchesDisplayPrice(a, b) { return a === b.price; } },
    PISPublicGems: { freshTimestamp() { return true; }, prepare() {
      return () => ({ status: 'estimated', method: 'briaoale_public', sourceAt: Date.now(),
        lower: 200, median: 300, upper: 400 });
    } },
  };
  const store = runInNewContext(source('market-store.js') + '\nPISMarketStore;', context);
  const offer = { id: 'gem_live', currency: 'orb', price: 250 };
  const rows = await store.marketBadges([offer], Date.now(), [{ ...offer, speciesId: '94', name: 'Gengar' }]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].row.estimate.median, 300);
  assert.deepEqual(storesRead, ['publicPricing'], 'preview não deve esperar transação da tabela listings');
});
