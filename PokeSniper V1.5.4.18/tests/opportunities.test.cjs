const assert = require('node:assert/strict');
const test = require('node:test');
const { settings, eligible, key, matches } = require('../opportunities.js');

const row = { id: '001', speciesId: '25', name: 'Pikachu', currency: 'gold',
  price: 70, estimate: { status: 'estimated', lower: 90, median: 100, discount: 0.3 } };

test('exige avaliação válida e aceita ofertas até o preço de referência', () => {
  assert.equal(eligible(row), true);
  assert.equal(eligible({ ...row, price: 95 }), true);
  assert.equal(eligible({ ...row, price: 101 }), false);
  assert.equal(eligible({ ...row, estimate: { status: 'insufficient_sales' } }), false);
});

test('deduplica pela identidade e pelo preço, independentemente da idade da observação', () => {
  assert.equal(key(row), key({ ...row, observedAt: 1000 }));
  assert.notEqual(key(row), key({ ...row, price: 65 }));
  assert.notEqual(key(row), key({ ...row, currency: 'orb' }));
});

test('aplica filtros por moeda, desconto, teto e espécie, com bloqueio prioritário', () => {
  assert.equal(matches(row, settings({ allow: 'PIKACHU' })), true);
  assert.equal(matches(row, settings({ allow: '25', block: 'pikachu' })), false);
  assert.equal(matches(row, settings({ maxPrice: 69 })), true);
  assert.equal(matches(row, settings({ discount: 31 })), false);
  assert.equal(matches(row, settings({ currency: 'orb' })), false);
  assert.equal(settings().notify, false);
});

test('exibe pelo desconto mínimo mesmo acima da faixa inferior e ignora o teto salvo na versão antiga', () => {
  const withinBand = { ...row, price: 95_000_000,
    estimate: { status: 'estimated', lower: 90_000_000, median: 100_000_000, discount: 0.05 } };
  assert.equal(matches(withinBand, settings({ discount: 5, maxPrice: 10_000 })), true);
  assert.equal(matches(withinBand, settings({ discount: 6 })), false);
});
