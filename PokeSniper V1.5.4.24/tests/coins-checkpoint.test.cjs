const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { runInNewContext } = require('node:vm');
const test = require('node:test');

test('repete o histórico após falha intermediária e só avança após gravar todas as páginas', async () => {
  const source = readFileSync(join(__dirname, '../sniper.js'), 'utf8');
  const script = source.slice(source.indexOf('  const COINS_HISTORY_CHECKS'), source.indexOf('  setInterval(() => { if (trackAtivo()) syncCoinsHistory'));
  const core = require('../market-core.js');
  const coins = require('../coins-history.js');
  const now = Date.now();
  const state = { '*': { at: now - 3600000, newest: now - 1800000 } };
  let fail = true;
  const asked = [];
  const listeners = new Set();
  const window = {
    addEventListener(_, fn) { listeners.add(fn); },
    removeEventListener(_, fn) { listeners.delete(fn); },
    postMessage(msg) {
      if (msg.event !== 'response') return;
      for (const listener of listeners) listener({ source: window, origin: 'https://pokeidle.io',
        data: { source: 'PIS_BRIDGE', type: 'COINS_HISTORY_RECEIPT', seq: msg.seq, ok: !(fail && msg.trace.page === 1) } });
    },
  };
  const sync = runInNewContext(script + '\nsyncCoinsHistory', {
    window, location: { origin: 'https://pokeidle.io' }, PISMarketCore: core, PISCoinsHistory: coins,
    st: { sock: { readyState: 1 }, seq: 1001, marketPausaAte: 0 },
    lsGet: () => state, lsSet: (_, saved) => Object.assign(state, saved), postHistory() {}, dbg() {},
    setTimeout, clearTimeout, sleep: async () => {},
    ask: async req => {
      asked.push(req.pagina);
      return { t: 'market', aba: 'historicoGlobal', pagina: req.pagina, temMais: req.pagina < 2, linhas: [{
        tipo: 'pokemon', id: req.pagina + 1, bruto: 100, em: now - (req.pagina + 1) * 60000,
        ficha: { speciesId: 94, nome: 'Gengar' },
      }] };
    },
  });
  await sync(null);
  assert.deepEqual(asked, [0, 1]);
  assert.equal(state['*'].newest, now - 1800000);
  fail = false;
  await sync(null);
  assert.deepEqual(asked, [0, 1, 0, 1, 2]);
  assert.equal(state['*'].newest, now - 60000);
});
