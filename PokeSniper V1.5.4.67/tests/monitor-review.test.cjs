const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { runInNewContext } = require('node:vm');
const test = require('node:test');
const core = require('../market-core.js');

const source = file => readFileSync(join(__dirname, '..', file), 'utf8');

test('ativar avisos também ativa a coleta com o registro antigo desligado', async () => {
  const origin = 'https://pokeidle.io';
  const listeners = [];
  const window = {
    addEventListener(_, listener) { listeners.push(listener); },
    postMessage(data) { for (const cb of listeners) cb({ source: window, origin, data }); },
  };
  let change;
  const snippet = source('sniper.js');
  const monitor = runInNewContext(snippet.slice(snippet.indexOf('  let lastMonitorState;'),
    snippet.indexOf('  function reportAutomatic')) + '\nmonitorAtivo', { window, location: { origin }, trackAtivo: () => false });
  runInNewContext(source('bridge.js'), { window, location: { origin }, chrome: {
    storage: { local: { async get() { return { opportunitySettings: { notify: true } }; } },
      onChanged: { addListener(fn) { change = fn; } } },
    runtime: { onMessage: { addListener() {} } },
  } });
  await Promise.resolve();
  assert.equal(monitor(), true);
  change({ opportunitySettings: { newValue: { notify: false } } }, 'local');
  assert.equal(monitor(), false);
});

test('receber a solicitação de revisão não confirma exibição no jogo', async () => {
  const origin = 'https://pokeidle.io';
  let listener, request, reply;
  const listeners = new Set();
  const window = {
    addEventListener(_, fn) { listeners.add(fn); },
    removeEventListener(_, fn) { listeners.delete(fn); },
    postMessage(msg) { request = msg; },
  };
  runInNewContext(source('market-toast.js'), { window, location: { origin }, PISMarketCore: core,
    crypto, setTimeout, clearTimeout, chrome: { runtime: { id: 'own', onMessage: { addListener(fn) { listener = fn; } } } } });
  const offer = { id: 'demo', pokemonId: 'demo', name: 'Gengar', speciesId: '94', price: 100, currency: 'gold',
    observedAt: Date.now() };
  const accepted = listener({ type: 'PIS_MARKET_REVIEW', offer, demo: true }, { id: 'own' }, result => { reply = result; });
  assert.equal(accepted, true);
  assert.equal(reply, undefined);
  for (const cb of listeners) cb({ source: window, origin, data: { source: 'PIS_MAIN', type: 'REVIEW_POKEMON_RESULT',
    requestId: request.requestId, ok: true } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(reply?.ok, true);
});

test('a ponte solicita o backup ao abrir a aba principal e ao voltar do cache do navegador', () => {
  const messages = [], events = new Map();
  const window = {
    addEventListener(name, handler) { events.set(name, handler); },
    postMessage() {},
  };
  window.top = window;
  runInNewContext(source('bridge.js'), {
    window, location: { origin: 'https://pokeidle.io' },
    chrome: {
      storage: { local: { async get() { return {}; } }, onChanged: { addListener() {} } },
      runtime: { onMessage: { addListener() {} }, async sendMessage(req) { messages.push(req.type); } },
    },
  });
  events.get('pageshow')({ persisted: false });
  assert.deepEqual(messages, ['PIS_GAME_OPEN_SALES_BACKUP']);
  events.get('pageshow')({ persisted: true });
  assert.deepEqual(messages, ['PIS_GAME_OPEN_SALES_BACKUP', 'PIS_GAME_OPEN_SALES_BACKUP']);
});
