const assert = require('node:assert/strict');
const { test } = require('node:test');
const { summarize } = require('../market-diagnostics.js');

const day = 86400000;
const now = Date.UTC(2026, 10, 19);
const ivs = { hp: 0, attack: 11, defense: 12, specialAttack: 0, specialDefense: 17, speed: 20 };

test('counts original and recent profile coverage without exposing records', () => {
  const summary = summarize({
    listings: [
      { id: 'private-listing', currency: 'gold', observedAt: now - 30 * day, price: 100, shiny: 0, power: 1,
        quality: 0, ivTotal: 60, ivs },
      { id: 'old-listing', currency: 'orb', observedAt: now - 31 * day, price: 2, power: 5, quality: 4,
        ivTotal: 20, ivs: { speed: 20 } },
    ],
    sales: [
      { id: 'private-sale', listingId: 'private-link', currency: 'gold', soldAt: now - day },
      { id: 'future-sale', currency: 'orb', soldAt: now + day, ivs: { hp: null, speed: -1 } },
    ],
  }, now);

  assert.equal(summary.lookbackDays, 30);
  assert.equal(summary.listings.total, 2);
  assert.equal(summary.listings.recent, 1);
  assert.equal(summary.listings.fields.power, 2);
  assert.equal(summary.listings.recentFields.quality, 1);
  assert.equal(summary.listings.recentFields.shiny, 1);
  assert.equal(summary.listings.fields.ivTotal, 2);
  assert.equal(summary.listings.fields.allIvs, 1);
  assert.equal(summary.listings.ivFields.hp, 1);
  assert.equal(summary.listings.ivFields.speed, 2);
  assert.equal(summary.listings.recentIvFields.speed, 1);
  assert.equal(summary.sales.fields.listingId, 1);
  assert.equal(summary.sales.recent, 1);
  assert.equal(summary.sales.ivFields.speed, 0);
  assert.deepEqual(summary.sales.currencies.orb, { total: 1, recent: 0 });
  assert.doesNotMatch(JSON.stringify(summary), /private-/);
});

test('keeps confirmed and probable exposure outcomes separate', () => {
  const { exposures } = summarize({
    exposures: [
      { lastSeen: now - day, saleAt: now - day, possibleSaleAt: now - day },
      { lastSeen: now - day, possibleSaleAt: now - day },
      { lastSeen: now - day, closedAt: now - day, possibleSaleAt: now - day },
      { lastSeen: now - day, saleAt: now + day },
      { lastSeen: now - 31 * day, possibleSaleAt: now - 31 * day },
    ],
  }, now);
  assert.equal(exposures.total, 5);
  assert.equal(exposures.recent, 4);
  assert.deepEqual(exposures.outcomes, { confirmed: 1, probable: 2, closed: 1, unresolved: 1 });
});
