const assert = require('node:assert/strict');
const test = require('node:test');
const core = require('../market-core');
const opportunities = require('../opportunities');
const gems = require('../public-gems');
const { readPrice } = require('../market-badges');
const { KEY, record } = require('../market-event-log');

test('Coins usa perfil comparável, não conta duas vendas do mesmo exemplar e limita outliers', () => {
  const now = Date.now();
  const target = { id: 'alvo', pokemonId: 'alvo', speciesId: '94', name: 'Gengar', currency: 'gold',
    shiny: 0, level: 100, price: 75, grade: 5, power: 3, quality: 1.5, ivTotal: 120,
    nature: 'modest', ivs: { hp: 20, attack: 20, defense: 20, specialAttack: 20, specialDefense: 20, speed: 20 } };
  const row = (i, price, extra) => ({
    ...target, id: String(i), pokemonId: 'p' + i, soldAt: now - 500000, price, ...extra,
  });
  const sales = [98, 100, 101, 102, 104, 10_000].map((price, index) => row(index, price));
  sales.push(row(6, 101, { pokemonId: 'p0' }), row(7, 20, { nature: 'adamant' }), row(8, 100, { currency: 'orb' }));
  const estimate = core.estimate(target, sales, now);
  assert.equal(estimate.method, 'coins_comparables');
  assert.equal(estimate.median, 101);
  assert.equal(estimate.count, 5);
  assert.equal(estimate.outlierCount, 1);
  assert.equal(estimate.alertSupported, true);
  assert.equal(sales.length, 9);
  assert.equal(opportunities.approved({ ...target, estimate }, opportunities.settings({ discount: 25 }), now), true);
  assert.equal(opportunities.approved({ ...target, estimate }, opportunities.settings({ discount: 27 }), now), false);
});

test('mantém a sprite exata e só usa fallback Dex verificável para a forma base', () => {
  const frame = { t: 'market', aba: 'vitrine', moeda: 'orb', linhas: [{
    id: 1, preco: 100, ficha: { speciesId: 94, nome: 'Gengar', shiny: true, dex: 94, sprite: '/real/gengar.png' },
  }] };
  const base = core.validate('listing', core.capture(frame).rows)[0];
  assert.deepEqual(opportunities.spriteCandidates(base), [
    'https://pokeidle.io/real/gengar.png',
    'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/shiny/94.png',
  ]);
  frame.linhas[0].ficha.formId = 'especial';
  const variant = core.capture(frame).rows[0];
  assert.deepEqual(opportunities.spriteCandidates(variant), ['https://pokeidle.io/real/gengar.png']);
  assert.equal(readPrice('16,5 Mi Coins', 'gold'), 16_500_000);
  assert.equal(readPrice('2.500 Gemas', 'orb'), 2500);
  assert.equal(readPrice('2Mi Gemas', 'orb'), null);
});

test('conversão valida unidade e cotação sem alterar o preço original', () => {
  assert.equal(gems.convert(2_000_000, 'gold', 'orb', 250_000), 8);
  assert.equal(gems.convert(8, 'orb', 'gold', 250_000), 2_000_000);
  assert.equal(gems.convert(8, 'orb', 'gold', 0), null);
  assert.equal(gems.convert(8, 'orb', 'xxx', 250_000), null);
});

test('trilha limita volume e só aceita campos previstos', async () => {
  const state = {};
  const storage = { get: async () => state, set: async record => Object.assign(state, record) };
  await record(storage, 'history', 'recuo', 'dados externos', 12345);
  await record(storage, 'history', 'recuo', 2, 12444);
  await record(storage, 'history', 'texto livre', 3, 13000);
  assert.deepEqual(state[KEY], [{ route: 'history', status: 'recuo', page: null, at: 12345 }]);
});
