const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { runInNewContext } = require('node:vm');
const test = require('node:test');

const source = readFileSync(join(__dirname, '../background.js'), 'utf8');

test('atribui falhas e vendas repetidas à página certa e restringe o teste à extensão', async () => {
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
    PISMarketCore: { validate: (_kind, rows) => rows },
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
  assert.equal((await dispatch({ type: 'PIS_TEST_GAME_TOAST' }, popup)).ok, true);
  assert.deepEqual(messages, [[7, 'PIS_MARKET_TOAST']]);
  assert.equal((await dispatch({ type: 'PIS_TEST_DESKTOP_TOAST' }, popup)).ok, true);
  assert.equal(savedNotices.pisGameToastTest.ok, true);
  assert.equal(savedNotices.pisDesktopToastTest.ok, true);
  assert.ok(savedNotices.pisGameToastTest.at > 0);
  assert.equal((await dispatch({ type: 'PIS_MARKET_CORE_BATCH', kind: 'sale', rows: ['known'] })).ok, true);
  assert.deepEqual(trace.at(-1), ['legacy_batch', undefined, 'gravado', 1]);
});
