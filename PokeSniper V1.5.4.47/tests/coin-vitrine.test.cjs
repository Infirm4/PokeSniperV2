const assert = require('node:assert/strict');
const test = require('node:test');
const { coinBadge, displayPrice } = require('../market-badges');
const { matchesDisplayPrice } = require('../market-core');

test('a vitrine mostra referência, faixa e desconto e preço relativo ao valor justo', () => {
  const quote = { lower: 450_000_000, median: 500_000_000, upper: 550_000_000 };
  const below = coinBadge({ quote, actualPrice: 400_000_000 });
  const above = coinBadge({ quote, actualPrice: 600_000_000 });
  assert.deepEqual([below.tone, above.tone], ['below', 'above']);
  assert.match(below.label, /^≈500MI 20%$/);
  assert.match(above.label, /^≈500MI 120%$/);
  assert.match(above.range, /450MI–550MI/);
  const smaller = { lower: 2_500_000, median: 2_900_000, upper: 3_100_000 };
  assert.equal(coinBadge({ quote: smaller, actualPrice: 2_320_000 }).label, '≈2,9MI 20%');
  assert.match(coinBadge({ quote: { lower: 1, median: 4, upper: 8 }, actualPrice: 2 }).label, /^≈0,000004MI/);
  const equal = coinBadge({ quote, actualPrice: 500_000_000 });
  assert.equal(equal.tone, 'neutral');
  assert.match(equal.label, / 100%$/);
  assert.match(coinBadge({ quote, actualPrice: 499_999_999 }).label, / <0,1%$/);
  assert.match(coinBadge({ quote, actualPrice: 500_000_001 }).label, / >100%$/);
  const indicative = coinBadge({ quote: { ...quote, indicative: true }, actualPrice: 600_000_000 });
  assert.match(indicative.range, /Indicativa/);
  assert.equal(indicative.tone, 'above');
  assert.equal(coinBadge({ unread: true }).label, 'Sem dados');
  assert.equal(coinBadge({ quote: null }).label, 'Sem estimativa');
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
