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
  assert.equal((await dispatch(event(3, ['failure']))).ok, false);
  assert.deepEqual(trace, [['response', 1, 'gravado', 1], ['response', 2, 'sem_registros_validos', undefined],
    ['response', 3, 'falha_na_gravação', undefined]]);
  assert.equal(await dispatch({ type: 'PIS_TEST_GAME_TOAST' }), undefined);
  const popup = { id: 'own', url: 'chrome-extension://own/opportunities.html' };
  assert.equal(await dispatch({ type: 'PIS_TEST_GAME_TOAST' }, popup), undefined);
  assert.equal(await dispatch({ type: 'PIS_TEST_DESKTOP_TOAST' }, popup), undefined);
  assert.deepEqual(messages, []);
  assert.equal((await dispatch({ type: 'PIS_MARKET_CORE_BATCH', kind: 'sale', rows: ['known'] })).ok, true);
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

test('a ficha sem ID usa a espécie do catálogo e marca o preço como indicativo', async () => {
  let listener, received;
  const context = {
    chrome: { runtime: { id: 'own', onMessage: { addListener(fn) { listener ??= fn; } } } },
    importScripts() {}, console, PISMarketCore: require('../market-core'),
    PI_ESPECIES: [{ id: 141, n: 'Kabutops' }],
    PISMarketStore: {
      async initialize() {},
      async inventoryQuote(profile) {
        received = profile;
        return { gold: { median: 38000000, indicative: false }, orb: null };
      },
    },
  };
  runInNewContext(source, context);
  const profile = { catalogFallback: true, name: 'Kabutops', grade: 3.524, level: 80, power: 4, quality: 1.52, shiny: 0 };
  const sender = { id: 'own', frameId: 0, url: 'https://pokeidle.io/', tab: { id: 1 } };
  const send = profile => new Promise(resolve => {
    if (!listener({ type: 'PIS_INVENTORY_QUOTE', profile }, sender, resolve)) resolve(null);
  });
  assert.equal(await send({ ...profile, grade: 3.499 }), null);
  assert.equal(await send({ ...profile, name: 'Desconhecido' }), null);
  const response = await send(profile);
  assert.equal(received.speciesId, '141');
  assert.equal(received.pokemonId, null);
  assert.equal(received.grade, 3.524);
  assert.equal(response.quotes.gold.indicative, true);
});
