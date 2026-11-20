const assert = require('node:assert/strict');
const test = require('node:test');
const { quoteBadge, displayPrice } = require('../market-badges');
const { matchesDisplayPrice } = require('../market-core');

test('a vitrine mostra referência, faixa e desconto e preço relativo ao valor justo', () => {
  const quote = { lower: 450_000_000, median: 500_000_000, upper: 550_000_000 };
  const below = quoteBadge({ quote, actualPrice: 400_000_000 });
  const above = quoteBadge({ quote, actualPrice: 600_000_000 });
  assert.deepEqual([below.tone, above.tone], ['below', 'above']);
  assert.match(below.label, /^≈500MI 20%$/);
  assert.match(above.label, /^≈500MI 120%$/);
  assert.match(above.range, /450MI–550MI/);
  const smaller = { lower: 2_500_000, median: 2_900_000, upper: 3_100_000 };
  assert.equal(quoteBadge({ quote: smaller, actualPrice: 2_320_000 }).label, '≈2,9MI 20%');
  assert.match(quoteBadge({ quote: { lower: 1, median: 4, upper: 8 }, actualPrice: 2 }).label, /^≈0,000004MI/);
  const equal = quoteBadge({ quote, actualPrice: 500_000_000 });
  assert.equal(equal.tone, 'neutral');
  assert.match(equal.label, / 100%$/);
  assert.match(quoteBadge({ quote, actualPrice: 499_999_999 }).label, / <0,1%$/);
  assert.match(quoteBadge({ quote, actualPrice: 500_000_001 }).label, / >100%$/);
  const indicative = quoteBadge({ quote: { ...quote, indicative: true }, actualPrice: 600_000_000 });
  assert.match(indicative.range, /Indicativa/);
  assert.equal(indicative.tone, 'above');
  assert.equal(quoteBadge({ unread: true }).label, 'Sem dados');
  assert.equal(quoteBadge({ quote: null }).label, 'Sem estimativa');
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

test('Gemas usam K e identificam a base pública na faixa', () => {
  const quote = { lower: 2500, median: 2900, upper: 3500, indicative: true };
  const cheaper = quoteBadge({ currency: 'orb', actualPrice: 2320, quote });
  const expensive = quoteBadge({ currency: 'orb', actualPrice: 3480, quote });
  assert.equal(cheaper.label, '≈2,9K 20%');
  assert.equal(expensive.label, '≈2,9K 120%');
  assert.equal(expensive.tone, 'above');
  assert.equal(expensive.range, 'Faixa 2,5K–3,5K Gemas · Base pública do Briaoale · Indicativa');
});
