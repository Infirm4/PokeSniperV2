const assert = require('node:assert/strict');
const test = require('node:test');
const { capture, validate, estimate, WINDOW_MS } = require('../market-core.js');

const now = Date.UTC(2026, 10, 19);
const ficha = { speciesId: 32, shiny: false, level: 100, nota: 5 };
const listing = { id: '0001', pokemonId: '002', moeda: 'gold', preco: 70, ficha };
const sales = [90, 100, 110, 120, 130].map((bruto, index) => ({
  id: index + 1, tipo: 'pokemon', moeda: 'gold', bruto, ficha, em: now - 1000,
}));
const frame = (aba, linhas) => ({ t: 'market', aba, linhas });

test('normaliza a vitrine e preserva IDs textuais sem levar dados de vendedor', () => {
  const batch = capture(frame('vitrine', [{ ...listing, vendedor: 'nome', estado: 'aberto' }]));
  assert.equal(batch.rows[0].id, '0001');
  assert.equal(batch.rows[0].pokemonId, '002');
  assert.equal(batch.rows[0].shiny, 0);
  assert.equal(Object.hasOwn(batch.rows[0], 'vendedor'), false);
  assert.deepEqual(validate(batch.kind, batch.rows), batch.rows);
});

test('ignora compras, anúncios encerrados, lotes inválidos e vendas sem transação válida', () => {
  assert.equal(capture(frame('historicoCompras', sales)), null);
  assert.equal(capture(frame('vitrine', [{ ...listing, estado: 'vendido' }])), null);
  assert.equal(capture(frame('historicoGlobal', [{ ...sales[0], bruto: undefined }])), null);
  assert.deepEqual(validate('sale', Array(101).fill(listing)), []);
});

test('calcula quantis e exclui vendas fora do grupo e do corte temporal', () => {
  const target = capture(frame('vitrine', [listing])).rows[0];
  const batch = capture(frame('historicoGlobal', [
    ...sales,
    { ...sales[0], id: 6, moeda: 'orb' },
    { ...sales[0], id: 7, ficha: { ...ficha, shiny: true } },
    { ...sales[0], id: 8, em: now },
    { ...sales[0], id: 9, em: now - WINDOW_MS - 1 },
  ]));
  const result = estimate(target, batch.rows, now);
  assert.deepEqual([result.status, result.count, result.lower, result.median, result.upper],
    ['estimated', 5, 100, 110, 120]);
  assert.equal(result.discount, 1 - 70 / 110);
});

test('abstém-se com amostra pequena ou atributos ausentes', () => {
  const target = capture(frame('vitrine', [listing])).rows[0];
  const batch = capture(frame('historicoGlobal', sales.slice(0, 4)));
  assert.equal(estimate(target, batch.rows, now).status, 'insufficient_sales');
  assert.equal(estimate({ ...target, grade: null }, batch.rows, now).status, 'incomplete_profile');
});

test('página do censo aceita a moeda da consulta correlacionada e rejeita outra moeda', () => {
  const core = require('../market-core.js');
  const frame = { t: 'market', aba: 'vitrine', pagina: 3,
    linhas: [{ ...listing, moeda: undefined }, { ...listing, id: 'gem', moeda: 'orb' }] };
  assert.equal(core.captureAutomatic(frame, { pagina: 3, moeda: 'gold' }).rows.length, 1);
  assert.equal(core.captureAutomatic(frame, { pagina: 3, moeda: 'gold' }).rows[0].currency, 'gold');
  assert.equal(core.captureAutomatic(frame, { pagina: 4, moeda: 'gold' }), null);
  assert.equal(core.captureAutomatic({ ...frame, moeda: 'orb' }, { pagina: 3, moeda: 'gold' }), null);
});

test('reconhece prefixos de Outland, marcador explícito e Pokédex sem confundir speciesId', () => {
  const { isOutland, capture } = require('../market-core.js');
  for (const name of ['Trickmaster Gengar', 'Trickamaster Gengar', 'Enrage Tyranitar',
    'Enraged Typhlosion', 'Furious Scizor', '✨ Shiny Brave Charizard']) {
    assert.equal(isOutland({ name }), true);
  }
  assert.equal(isOutland({ name: 'Mega Charizard', speciesId: '13359' }), false);
  assert.equal(isOutland({ ficha: { dex: 2019 } }), true);
  assert.equal(isOutland({ ficha: { isOutland: true } }), true);
  const batch = capture({ t: 'market', aba: 'vitrine', linhas: [{ ...listing,
    ficha: { ...listing.ficha, nome: 'Gengar', dex: 2019 } }] });
  assert.equal(batch.rows[0].outland, true);
});

test('vendas legadas de Trickmaster Gengar não mudam o preço de Gengar mesmo com o mesmo speciesId', () => {
  const { estimate } = require('../market-core.js');
  const now = Date.now();
  const target = { name: 'Gengar', speciesId: '94', currency: 'gold', shiny: 0, level: 100, grade: 5, price: 80 };
  const regular = [90, 95, 100, 105, 110].map((price, i) => ({
    ...target, id: 'regular-' + i, soldAt: now - 1000, price,
  }));
  const premium = [...Array(10)].map((_, i) => ({
    ...target, name: 'Trickmaster Gengar', id: 'premium-' + i, soldAt: now - 1000, price: 1000,
  }));
  assert.equal(estimate(target, [...regular, ...premium], now).median, 100);
  assert.equal(estimate({ ...target, name: 'Trickmaster Gengar' }, premium, now).status, 'excluded_outland');
  assert.equal(require('../opportunities.js').eligible({ ...premium[0],
    estimate: { status: 'estimated', median: 2000 } }), false);
});
