const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { runInNewContext } = require('node:vm');
const test = require('node:test');

test('repete o histórico após falha intermediária e só avança após gravar todas as páginas', async () => {
  const source = readFileSync(join(__dirname, '../sniper.js'), 'utf8');
  const script = source.slice(source.indexOf('  const COINS_HISTORY_CHECKS'), source.indexOf('  const COINS_BACKFILL'));
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
    lsGet: () => state, lsSet: (_, saved) => Object.assign(state, saved), postHistory() {}, dbg() {}, trackAtivo: () => true,
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

test('retoma a coleta global na página deslocada sem avançar por uma página que falhou', async () => {
  const { backfill } = require('../coins-history.js');
  const now = Date.now();
  const row = (ids, minutes, last = false) => ({
    ids, newest: now - minutes * 60000, oldest: now - (minutes + 1) * 60000, last,
  });
  let saved;
  const save = async value => { saved = value; };
  await backfill({ read: async page => page ? row(['b'], 3) : row(['a'], 1), save, now, budget: 2 });
  assert.equal(saved.page, 1);
  const pages = [row(['x'], 1), row(['a'], 2), row(['b'], 3), row(['c'], 4, true)];
  await assert.rejects(backfill({
    previous: saved, now, save, read: async page => {
      if (page === 3) throw Error('gravação rejeitada');
      return pages[page];
    },
  }), /gravação rejeitada/);
  assert.equal(saved.page, 2);
  assert.deepEqual(saved.ids, ['b']);
  assert.equal(saved.completedAt, undefined);
  await backfill({ previous: saved, read: async page => pages[page], save, now });
  assert.equal(saved.completedAt, now);
  assert.equal(saved.page, 3);
});
