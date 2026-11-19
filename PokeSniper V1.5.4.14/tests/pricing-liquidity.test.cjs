const assert = require('node:assert/strict');
const test = require('node:test');
const core = require('../market-core.js');
const pricing = require('../pricing-model.js');
const liquidity = require('../liquidity.js');
const opportunities = require('../opportunities.js');

const now = Date.UTC(2026, 10, 19);
const day = 86400000;
const profile = high => ({
  id: 'target', speciesId: '25', currency: 'gold', shiny: 0, level: 100, grade: 6,
  price: 100, power: 4, quality: 1.8, ivTotal: 120, aoe: 0, zMove: 0, mega: 0,
  ivs: { hp: 20, attack: 20, defense: high ? 10 : 30, specialAttack: 20,
    specialDefense: 20, speed: high ? 30 : 10 },
});

test('preserva forma, IV zero e IV ausente, além de IDs distintos', () => {
  const frame = { t: 'market', aba: 'historicoGlobal', linhas: [{
    tipo: 'pokemon', id: 'sale1', listingId: 'offer1', pokemonId: 'individual1',
    moeda: 'gold', bruto: 100, em: now, ficha: {
      speciesId: 25, formId: 'ALT', shiny: false, potencia: 'P4', quality: 1.8,
      ivTotal: 101, ivs: { speed: 0, spd: 19 },
    },
  }] };
  const batch = core.capture(frame);
  assert.deepEqual(core.validate(batch.kind, batch.rows), batch.rows);
  const [record] = batch.rows;
  assert.equal(record.listingId, 'offer1');
  assert.equal(record.id, 'sale1');
  assert.equal(record.form, 'alt');
  assert.equal(record.ivs.speed, 0);
  assert.equal(record.ivs.specialDefense, null);
  assert.equal(record.ivTotal, 101);
  assert.equal(record.power, 4);
  assert.equal(core.sameMarket(record, { ...record, form: null }), false);
});

test('valida a distribuição dos IVs em vendas posteriores e distingue perfis com o mesmo total', () => {
  const sales = Array.from({ length: 240 }, (_, i) => ({
    ...profile(i % 2 === 0), id: String(i), pokemonId: 'pokemon-' + i,
    soldAt: now - (240 - i) * day / 12,
    price: Math.round((i % 2 === 0 ? 200 : 100) * (1 + 0.05 * Math.sin(i * 2.7))),
  }));
  const estimate = pricing.prepare(sales, core.estimate, core.sameMarket, now);
  const fast = estimate(profile(true));
  const slow = estimate(profile(false));
  assert.equal(fast.method, 'profile_iv_distribution');
  assert.equal(slow.method, 'profile_iv_distribution');
  assert.ok(fast.median > slow.median * 1.5);
  assert.ok(fast.validation.after < fast.validation.before);
  assert.ok(fast.validation.below <= 0.27);
  assert.ok(fast.effects.some(effect => effect.name === 'Distribuição dos IVs'));
  const limited = pricing.prepare(sales.slice(-20), core.estimate, core.sameMarket, now)(profile(true));
  assert.equal(limited.method, 'baseline');
});

test('revendas do mesmo exemplar não sustentam preço por si sós', () => {
  const sales = Array.from({ length: 30 }, (_, i) => ({
    ...profile(true), id: String(i), pokemonId: 'exemplar-unico', soldAt: now - i - 1,
  }));
  const estimate = core.estimate(profile(true), sales, now);
  assert.equal(estimate.status, 'insufficient_sales');
  assert.equal(estimate.independentCount, 1);
});

test('mudanças e lacunas interrompem a exposição e vínculo provável não conta como venda', () => {
  const row = { ...profile(true), pokemonId: 'p1' };
  const initial = liquidity.observe(row, null, now - 10 * 60000);
  const continued = liquidity.observe(row, initial, now);
  assert.deepEqual(continued.key, initial.key);
  assert.notDeepEqual(liquidity.observe({ ...row, price: 99 }, initial, now).key, initial.key);
  assert.notDeepEqual(liquidity.observe(row, initial, now + liquidity.MAX_GAP + 1).key, initial.key);
  const sale = { ...row, id: 'sale1', soldAt: now + 1000 };
  assert.equal(liquidity.possibleSale(continued, sale), true);
  assert.equal(liquidity.saleMatches(continued, sale), false);
  assert.equal(liquidity.saleMatches(continued, { ...sale, listingId: row.id }), true);
  assert.equal(liquidity.saleMatches(continued, { ...sale, listingId: row.id, price: 99 }), false);
});


test('calcula liquidez separada por perfil e suspende probabilidades com muitos desfechos desconhecidos', () => {
  const items = Array.from({ length: 100 }, (_, i) => {
    const startAt = now - (58 - i * 0.4) * day;
    return { ...profile(i % 2 === 0), id: String(i), startAt, lastSeen: startAt + 8 * day,
      saleAt: (i % 2 === 0 ? i % 4 === 0 : i % 10 === 1) ? startAt + 2 * day : null };
  });
  const fast = liquidity.estimate(profile(true), items, now, core.sameMarket).horizons[1];
  const slow = liquidity.estimate(profile(false), items, now, core.sameMarket).horizons[1];
  assert.equal(fast.status, 'estimated');
  assert.equal(slow.status, 'estimated');
  assert.ok(fast.probability > slow.probability);
  const missing = items.map(row => ({ ...row, lastSeen: row.startAt, possibleSaleAt: row.saleAt, saleAt: null }));
  const unknown = liquidity.estimate(profile(true), missing, now, core.sameMarket).horizons[1];
  assert.equal(unknown.status, 'insufficient_outcomes');
  assert.equal(unknown.confirmed, 0);
  assert.ok(unknown.possible > 0);
  assert.ok(!Object.hasOwn(unknown, 'probability'));
  assert.equal(liquidity.estimate({ ...profile(true), level: 1000 }, items, now, core.sameMarket).count, 0);
});

test('teto de revenda considera taxa e retorno sem mudar o desconto ou usar liquidez', () => {
  const row = { ...profile(true), estimate: { status: 'estimated', lower: 90, median: 100, discount: 0.3 } };
  const config = opportunities.settings({ resale: true, fee: 15, returnPercent: 10, purchaseCost: 2, saleCost: 1 });
  assert.equal(opportunities.priceLimit(row, config), 66);
  assert.equal(opportunities.priceLimit({ ...row, liquidity: 0.99 }, config), 66);
  assert.equal(opportunities.priceLimit(row, opportunities.settings({ resale: true })), null);
});
