const assert = require('node:assert/strict');
const test = require('node:test');
const core = require('../market-core.js');
globalThis.PISMarketCore = core;
const market = require('../coin-market.js');
globalThis.PISCoinMarket = market;
const opportunity = require('../opportunities.js');

const now = Date.UTC(2026, 10, 20, 15, 15, 30);
const hour = 3600000;
let next = 0;
const target = {
  id: 'offer', pokemonId: 'owned', speciesId: '11', name: 'Perfil Y', currency: 'gold', power: 1,
  level: 100, grade: 4, quality: 1.4, price: 60_000_000, shiny: 0, ivTotal: 120,
  ivs: { hp: 20, attack: 20, defense: 20, specialAttack: 20, specialDefense: 20, speed: 20 },
};
function sale(extra = {}) {
  const id = String(++next);
  return { ...target, id, pokemonId: id, price: 100_000_000, source: 'game', soldAt: now - hour, ...extra };
}
function training(mode) {
  return Array.from({ length: 4 }, (_, species) => Array.from({ length: 5 }, (_, i) => {
    const a = { speciesId: 'train-' + species, name: 'Treino ' + species, soldAt: now - (100 + 9 * i + species) * hour,
      grade: 4 + i * .16 };
    return [sale(a), sale({ ...a, ...mode })];
  })).flat(2);
}

test('mantém o preço normal e o BEPI e usa vendas distintas e completas no filtro', () => {
  const direct = [sale(), sale(), sale()];
  assert.deepEqual(market.prepare(direct, now).estimate(target),
    { ...core.estimateCoins(target, direct, now), segmentStage: 'normal' });
  const p4 = { ...target, power: 4 };
  const mixed = [sale({power: 4}), sale({power: 4}), sale({power: 3})];
  const quote = market.prepare(mixed, now).estimate(p4);
  assert.equal(quote.segmentStage, 'bepi');
  const repeat = [sale({pokemonId: 'copied'}), sale({pokemonId: 'copied'}), sale({quality: null}),
    sale({currency: 'orb'}), sale({shiny: 1}), sale({name: 'Trickmaster Gengar'})];
  assert.equal(market.prepare(repeat, now).estimate(target).status, 'insufficient_sales');
});
test('amplia Nota, percorre a janela e impede extrapolar nível', () => {
  const rows = [18, 20, 22].map(days => sale({ grade: 4.44, soldAt: now - days * 24 * hour }));
  const debug = { tentativas: [] };
  const quote = market.prepare(rows, now).estimate(target, debug);
  assert.equal(quote.fallbackLevel, 1);
  assert.equal(quote.alertSupported, false);
  assert.equal(debug.tentativas.find(x => x.nível === 1 && x.estimativa).janela_h, 30 * 24);
  assert.equal(market.prepare(rows.map(row => ({ ...row, level: 130 })), now).estimate(target).status, 'insufficient_sales');
  assert.equal(market.prepare(rows.map(row => ({ ...row, soldAt: now - 40 * 24 * hour })), now).estimate(target).fallbackLevel, 1);
});
test('valida o fator entre Potências e a curva em vendas posteriores', () => {
  const pairs = training({ power: 2, price: 200_000_000 });
  const neighbors = Array.from({ length: 4 }, () => sale({ power: 2, price: 200_000_000 }));
  const estimator = market.prepare([...pairs, ...neighbors], now);
  const quote = estimator.estimate(target);
  assert.equal(quote.fallbackLevel, 2);
  assert.equal(quote.median, 100_000_000);
  assert.equal(estimator.calibrationReport().potência['1→2'].fator, 2);
  assert.equal(market.prepare(neighbors, now).estimate(target).status, 'insufficient_sales');
  const slopes = training({ level: 130, price: 169_000_000 });
  const nearby = [116, 139, 139].map(level => sale({ level, price: level ** 2 * 10_000 }));
  const debug = { tentativas: [] };
  const curved = market.prepare([...slopes, ...nearby], now).estimate(target, debug);
  assert.equal(curved.fallbackLevel, 3);
  assert.equal(curved.median, 100_000_000);
  assert.ok(debug.tentativas.find(x => x.nível === 3 && x.estimativa).vendas.some(row => row.fator_nível < 1));
  assert.equal(market.prepare(nearby, now).estimate(target).status, 'insufficient_sales');
});
test('converte a linha evolutiva apenas quando o par tem fator validado', () => {
  globalThis.PI_ESPECIES = [{ id: 11, n: target.name, evo: [12] }, { id: 12, n: 'Evolução Y', evo: [] }];
  const comparables = Array.from({ length: 16 }, (_, i) => {
    const a = { level: 300, soldAt: now - (i + 1) * hour, price: 200_000_000 };
    return [sale(a), sale({ ...a, speciesId: '12', name: 'Evolução Y', price: 400_000_000 })];
  }).flat();
  const donors = Array.from({ length: 5 }, () => sale({ speciesId: '12', name: 'Evolução Y', price: 200_000_000 }));
  try {
    const quote = market.prepare([...comparables, ...donors], now).estimate(target);
    assert.equal(quote.fallbackLevel, 4);
    assert.equal(quote.median, 100_000_000);
    assert.equal(market.prepare(donors, now).estimate(target).status, 'insufficient_sales');
  } finally { delete globalThis.PI_ESPECIES; }
});
test('calcula liquidez por hora, separa mercados e não usa a liquidez para aprovar', () => {
  const rows = Array.from({ length: 6 }, (_, i) => sale({ soldAt: now - (i + 1) * hour }));
  const model = market.prepare(rows, now), quote = model.estimate(target);
  const active = sale({ price: 98_000_000, observedAt: now });
  const snapshot = model.liquidity(target, quote, [active, { ...active, id: 'another' },
    { ...active, id: 'gem', pokemonId: 'other', currency: 'orb' }], [0, 1]);
  assert.equal(snapshot.m, 1);
  assert.equal(snapshot.hours, 2 / snapshot.lambda);
  assert.equal(snapshot.label, 'baixa');
  assert.deepEqual(snapshot.pages, [0, 1]);
  assert.equal(snapshot.partial, true);
  const row = { ...target, estimate: quote, liquidityHours: snapshot };
  const config = opportunity.settings({ discount: 20 });
  assert.equal(opportunity.approved(row, config, now), opportunity.approved({ ...row, liquidityHours: null }, config, now));
  assert.equal(opportunity.fallbackWarning(row), '');
  const fallback = { ...row, estimate: { ...quote, bepi: true } };
  assert.match(opportunity.noticePresentation(fallback, now).title, /^⚠️ Preço estimado \(BEPI\)/u);
  assert.match(opportunity.noticePresentation(fallback, now).desktopMessage, /Liquidez baixa/);
  assert.equal(opportunity.fallbackWarning({ ...fallback, currency: 'orb' }), '');
  assert.equal(market.prepare(rows.slice(0, 4), now).liquidity(target, quote, [], []), null);
});

test('o controle de fallback reavalia a referência já gravada sem mudar BEPI ou Gemas', () => {
  const quote = market.prepare([sale({ grade: 4.44 }), sale({ grade: 4.44 }), sale({ grade: 4.44 })], now).estimate(target);
  const row = { ...target, estimate: quote };
  const off = opportunity.settings({ discount: 20 });
  const on = opportunity.settings({ discount: 20, fallbackAlerts: true });
  assert.equal(off.fallbackAlerts, false);
  assert.equal(on.fallbackAlerts, true);
  assert.equal(quote.fallbackLevel, 1);
  assert.equal(quote.alertSupported, false);
  assert.equal(opportunity.approved(row, off, now), false);
  assert.equal(opportunity.approved(row, on, now), true);
  assert.equal(opportunity.approved({ ...row, price: 70_000_001 }, on, now), false);
  assert.equal(opportunity.approved({ ...row, estimate: { ...quote, fallbackLevel: 2 } }, on, now), true);
  assert.equal(opportunity.approved({ ...row, estimate: { ...quote, fallbackLevel: 3 } }, on, now), false);
  assert.equal(opportunity.approved({ ...row, estimate: { ...quote, confidence: 'baixa' } }, on, now), false);
  assert.equal(opportunity.approved({ ...row, estimate: { ...quote, lower: row.price } }, on, now), false);
  assert.equal(opportunity.approved({ ...row, currency: 'orb' }, { ...on, currency: 'all' }, now), false);
  const bepi = { ...row, estimate: { ...quote, fallbackLevel: null, bepi: true, alertSupported: true } };
  assert.equal(opportunity.approved(bepi, off, now), true);
});

test('a liquidez de Gemas usa cinco exemplares locais distintos na própria moeda', () => {
  const gem = { ...target, currency: 'orb', price: 12 };
  const quote = { median: 25, discount: 0.52 };
  const sales = Array.from({ length: 5 }, (_, index) =>
    sale({ currency: 'orb', price: 24, soldAt: now - (index + 1) * hour }));
  const queue = [sale({ currency: 'orb', price: 23, observedAt: now }), sale({ price: 20, observedAt: now })];
  const liquidity = market.gemLiquidity(gem, quote, [...sales, ...sales, sale()], queue, [0, 1], now);
  assert.equal(liquidity.count, 5);
  assert.equal(liquidity.m, 1);
  assert.equal(liquidity.label, 'baixa');
  assert.equal(market.gemLiquidity(gem, quote, [...sales.slice(1), sales[1], sale()], queue, [0, 1], now), null);
  const formatted = opportunity.noticePresentation({ ...gem, estimate: quote, liquidityHours: liquidity });
  assert.match(formatted.desktopMessage, /IVs: Speed 20 \(média\)\nLiquidez baixa$/);
  assert.doesNotMatch(formatted.desktopMessage, /~\d/);
});
