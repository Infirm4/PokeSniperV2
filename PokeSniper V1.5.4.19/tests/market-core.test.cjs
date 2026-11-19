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
