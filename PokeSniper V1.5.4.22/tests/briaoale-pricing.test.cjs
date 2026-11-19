const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const ctx = vm.createContext({});
for (const name of ['especies', 'pve-power', 'market-bonuses', 'central', 'nota', 'pve-pricing']) {
  vm.runInContext(readFileSync(join(__dirname, '../vendor/briaoale', name + '.js'), 'utf8'), ctx);
}
for (const name of ['market-core', 'pricing-model']) {
  vm.runInContext(readFileSync(join(__dirname, '..', name + '.js'), 'utf8'), ctx);
}
const pricing = ctx.PISPricingModel;
const core = ctx.PISMarketCore;
const now = Date.UTC(2026, 10, 19);
const target = { id: 'offer', name: 'Gengar', speciesId: '94', currency: 'orb', level: 100,
  grade: 5, quality: 1.8, power: 3, shiny: 0, price: 75, aoe: 0, zMove: 0, mega: 0,
  ivs: { hp: 20, attack: 20, defense: 20, specialAttack: 20, specialDefense: 20, speed: 20 } };
const history = (market, value, extra = {}) => Array.from({ length: 35 }, (_, n) => ({
  ...target, id: market + '-' + n, pokemonId: market + '-' + n, currency: market, price: value,
  soldAt: now - (n + 1) * 60000, ...extra,
}));

test('executa o motor MIT em moedas distintas e calcula o desconto da referência em PvE', () => {
  const data = [...history('orb', 100), ...history('gold', 100_000_000)];
  const estimate = pricing.makeMarket(data, now, core.isOutland);
  assert.equal(estimate(target).method, 'briaoale_pve');
  assert.equal(estimate(target).median, 100);
  assert.equal(estimate(target).discount, 0.25);
  assert.equal(estimate({ ...target, currency: 'gold', price: 75_000_000 }).median, 100_000_000);
  assert.equal(estimate({ ...target, name: 'Trickmaster Gengar' }), null);
});

test('recusa base insuficiente, venda futura e comparação entre adicionais incompatíveis', () => {
  const poor = [
    ...history('orb', 100, { pokemonId: 'same' }),
    ...history('gold', 100_000),
    ...history('orb', 200, { soldAt: now + 1 }),
    ...history('orb', 900, { aoe: 1 }),
  ];
  const estimate = pricing.makeMarket(poor, now, core.isOutland);
  assert.equal(estimate(target), null);
  assert.equal(estimate({ ...target, aoe: 1 }).median, 900);
  assert.equal(estimate({ ...target, name: 'Nome sem correspondência no catálogo' }), null);
});

test('mantém uma referência explícita de Nota e nível quando as vendas não trazem ficha completa', () => {
  const data = history('orb', 100, { ivs: null });
  const estimate = pricing.prepare(data, core.estimate, now, pricing.makeMarket(data, now, core.isOutland));
  assert.equal(estimate(target).method, 'baseline');
  assert.equal(estimate(target).discount, 0.25);
});

test('a adaptação e o motor do site dão a mesma faixa em Gemas com as mesmas fichas e vendas', () => {
  const hist = history('orb', 100).map((row, i) => ({ ...row, price: 85 + i }));
  const ficha = { nome: 'Gengar', level: 100, potencia: 3, quality: 1.8, nota: 5, shiny: false,
    ivs: { hp: 20, atk: 20, def: 20, spAtk: 20, spDef: 20, speed: 20 } };
  const central = ctx.PokeIdleCentral.create(ctx);
  const engine = ctx.PokeIdlePvePricing;
  const { rows } = engine.prepare(central, hist.map(row => ({
    name: row.name, speciesId: 94, currency: 'orb', at: row.soldAt, price: row.price, ficha,
  })), []);
  const original = engine.priceSheet(central, ficha, { rows, now, bias: 0 });
  const integrated = pricing.makeMarket(hist, now, core.isOutland)(target);
  assert.ok(original.available);
  assert.deepEqual([integrated.lower, integrated.median, integrated.upper],
    [original.low, original.median, original.high]);
});
