const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { runInNewContext } = require('node:vm');
const test = require('node:test');
const core = require('../market-core.js');

const source = readFileSync(join(__dirname, '../sniper.js'), 'utf8');
const script = source.slice(source.indexOf('  async function comprarPokemon('), source.indexOf('  async function loop()'));

test('envia uma compra aprovada apenas para a mesma oferta, pelo preço exato e sem repetir após recarga', async () => {
  const now = Date.now();
  const listing = { id: '1', speciesId: '94', pokemonId: '3', currency: 'gold', name: 'Gengar',
    price: 100, observedAt: now, expiresAt: now + 60000 };
  const approval = core.purchaseOffer(listing);
  assert.equal(core.purchaseOffer({ ...listing, currency: 'orb' }), null);
  assert.equal(core.matchesPurchase(approval, { ...listing, pokemonId: '2' }, now), false);
  assert.equal(core.matchesPurchase(approval, { ...listing, price: 101 }, now), false);
  assert.equal(core.matchesPurchase(approval, { ...listing, availableAt: now + 1 }, now), false);

  const trigger = [];
  let refreshed = listing;
  const storage = new Map();
  const st = { running: false, sock: { readyState: 1 }, marketPausaAte: 0, spent: 0,
    gold: 1000, marketFila: Promise.resolve(), finalizados: new Set(), skip: {}, fails: 0 };
  const buy = runInNewContext(script + '\ncomprarPokemon', {
    st, PISMarketCore: core, localStorage: { setItem: (key, value) => storage.set(key, value) },
    lsGet: (key, fallback) => storage.has(key) ? JSON.parse(storage.get(key)) : fallback,
    APPROVAL_RECEIPTS: 'orders', cfg: () => ({ dryRun: true }), orcamento: () => 1000,
    refreshApprovedPokemon: async () => ({ row: refreshed, item: {}, p: { idRaw: 1, preco: 100, qtd: 1 } }),
    hist: async () => ({ total: 1 }), L: () => '', P: String, G: String, logPk() {}, dbg() {},
    nowSrv: () => now, esperarPermissaoDeConsulta: async () => {},
    osend(value) { trigger.push(JSON.parse(value)); st.activeAttempt.venceuSorteio = false; },
    sleep: async () => {}, comprasNoHistorico: () => [], mostrarResultado() {},
  });
  refreshed = { ...listing, price: 120 };
  await buy({ id: '1', preco: 100 }, {}, 0, { approval });
  assert.equal(trigger.length, 0);
  refreshed = listing;
  await buy({ id: '1', preco: 100 }, {}, 0, { approval });
  assert.deepEqual(trigger, [{ t: 'market.comprar', id: 1, qtd: 1, preco: 100, moeda: 'gold' }]);
  st.finalizados.clear();
  assert.match(await buy({ id: '1', preco: 100 }, {}, 0, { approval }), /pedido registrado/);
  assert.equal(trigger.length, 1);
});
