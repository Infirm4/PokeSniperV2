const assert = require('node:assert/strict');
const test = require('node:test');
const { coinBadge, displayPrice } = require('../market-badges');
const { matchesDisplayPrice } = require('../market-core');

test('a vitrine mostra referência, faixa e desconto e preço relativo ao valor justo', () => {
  const quote = { lower: 450_000_000, median: 500_000_000, upper: 550_000_000 };
  const below = coinBadge({ quote, actualPrice: 400_000_000 });
  const above = coinBadge({ quote, actualPrice: 600_000_000 });
  assert.deepEqual([below.tone, above.tone], ['below', 'above']);
  assert.match(below.label, /^≈500\sMi ~ 20% de desconto$/);
  assert.match(above.label, /^≈500\sMi ~ 120%$/);
  assert.match(above.range, /450\smi–550\smi/i);
  const equal = coinBadge({ quote, actualPrice: 500_000_000 });
  assert.equal(equal.tone, 'neutral');
  assert.match(equal.label, /~ 100%$/);
  assert.match(coinBadge({ quote, actualPrice: 499_999_999 }).label, /~ <0,1% de desconto$/);
  assert.match(coinBadge({ quote, actualPrice: 500_000_001 }).label, /~ >100%$/);
  assert.match(coinBadge({ quote: { ...quote, indicative: true }, actualPrice: 400_000_000 }).range, /Indicativa/);
  assert.equal(coinBadge({ quote: null }).label, 'Sem estimativa em Coins');
});

test('um anúncio abreviado usa o preço confirmado e não confunde preços incompatíveis ou Gemas', () => {
  const shown = displayPrice('550 M', 'gold');
  const offer = { ...shown, currency: 'gold' };
  assert.deepEqual(shown, { price: 550_000_000, priceTick: 1_000_000 });
  assert.equal(matchesDisplayPrice(549_999_998, offer), true);
  assert.equal(matchesDisplayPrice(560_000_000, offer), false);
  assert.equal(matchesDisplayPrice(549_999_998, { ...offer, currency: 'orb' }), false);
  assert.equal(matchesDisplayPrice(549_999_998, { ...offer, ...displayPrice('550000000', 'gold') }), false);
});
