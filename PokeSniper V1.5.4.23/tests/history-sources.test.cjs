const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const core = require('../market-core.js');
const coins = require('../coins-history.js');

const ctx = vm.createContext({});
for (const path of ['especies', 'pve-power', 'market-bonuses', 'central', 'nota', 'pve-pricing'].map(name =>
  'vendor/briaoale/' + name + '.js').concat(['market-core.js', 'public-gems.js'])) {
  vm.runInContext(readFileSync(join(__dirname, '..', path), 'utf8'), ctx);
}
const now = Date.UTC(2026, 10, 19);
const target = { name: 'Gengar', speciesId: '94', currency: 'orb', level: 100,
  grade: 5, quality: 1.8, power: 3, shiny: 0, price: 75, aoe: 0, zMove: 0,
  ivs: { hp: 20, attack: 20, defense: 20, specialAttack: 20, specialDefense: 20, speed: 20 } };

test('usa o histórico público e a curva do site somente em Gemas', () => {
  const central = ctx.PokeIdleCentral.create(ctx);
  const engine = ctx.PokeIdlePvePricing;
  const sheet = { nome: 'Gengar', level: 100, potencia: 3, quality: 1.8, nota: 5, shiny: false,
    ivs: { hp: 20, atk: 20, def: 20, spAtk: 20, spDef: 20, speed: 20 } };
  const publicSales = engine.prepare(central, Array.from({ length: 36 }, (_, i) => ({
    name: 'Gengar', speciesId: 94, currency: 'orb', at: now - 60000 * (i + 1), price: 85 + i, ficha: sheet,
  })), []).rows;
  const snapshot = { geradoEm: new Date(now).toISOString(),
    vendas: ctx.PokeIdleCentral.compactar(publicSales.map(({ logBase, ...row }) => row)), itens: [],
    correcao: { bias: 0.03 } };
  const source = ctx.PISPublicGems;
  const estimate = source.prepare(snapshot, now)(target);
  const original = engine.priceSheet(central, sheet, { rows: publicSales, now, correcao: snapshot.correcao });
  assert.equal(estimate.method, 'briaoale_public');
  assert.deepEqual([estimate.lower, estimate.median, estimate.upper], [original.low, original.median, original.high]);
  assert.equal(source.prepare(snapshot, now)({ ...target, currency: 'gold' }), null);
  assert.equal(source.prepare(snapshot, now + 4 * 86400000)(target), null);
  assert.equal(source.valid({ ...snapshot, vendas: { ...snapshot.vendas, n: 3 } }, now), false);
});

test('importa um backup do formato Smart Market com IDs deduplicados e sem copiar Gemas', () => {
  const row = { id: 100, pokemonId: 200, em: now - 60000,
    moeda: 'gold', preco: 123_000_000, speciesId: 94, nome: 'Gengar', level: 100, nota: 5,
    potencia: 3, quality: 1.8, ivTotal: 100, shiny: false, aoe: false, zmove: false, mega: false };
  const imported = coins.importRows([row, row, { ...row, id: 101, moeda: 'orb' },
    { ...row, id: 102, nome: 'Trickmaster Gengar' }], core, now);
  assert.equal(imported.length, 1);
  assert.equal(imported[0].id, '100');
  assert.equal(imported[0].source, 'smartmarket_backup');
  assert.equal(imported[0].price, 123_000_000);
  assert.equal(imported[0].ivs.speed, null);
  assert.equal(coins.cleanSpecies('Mr. Mime'), 'Mr. Mime');
  assert.equal(coins.cleanSpecies('{"busca":""}'), null);
});
