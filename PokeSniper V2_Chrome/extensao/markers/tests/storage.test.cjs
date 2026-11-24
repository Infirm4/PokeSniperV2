const test = require('node:test');
const assert = require('node:assert/strict');
const { create, sanitize, KEY, MAX_ENTRIES } = require('../src/storage.js');

function fakeArea(initial = {}) {
  const data = { ...initial };
  const listeners = [];
  return {
    data,
    area: { get: async key => ({ [key]: data[key] }), set: async obj => Object.assign(data, obj) },
    changes: { addListener: fn => listeners.push(fn) },
    emit: (newValue) => listeners.forEach(fn => fn({ [KEY]: { newValue } }, 'local')),
  };
}

test('grava, lê de forma síncrona e persiste após flush', async () => {
  const fake = fakeArea();
  const store = create(fake.area, fake.changes);
  await store.load();
  assert.equal(store.set('id:a1', 'skull'), true);
  assert.equal(store.get('id:a1'), 'skull');
  await store.flush();
  assert.deepEqual(fake.data[KEY], { 'id:a1': 'skull' });
  const reopened = create(fake.area, fake.changes);
  await reopened.load();
  assert.equal(reopened.get('id:a1'), 'skull');
});

test('troca e remove marcador sem afetar outros anúncios', async () => {
  const fake = fakeArea();
  const store = create(fake.area, fake.changes);
  await store.load();
  store.set('id:a', 'skull'); store.set('id:b', 'star');
  store.set('id:a', 'moon');
  assert.equal(store.get('id:a'), 'moon');
  store.clear('id:a');
  assert.equal(store.get('id:a'), null);
  assert.equal(store.get('id:b'), 'star');
});

test('rejeita chaves e tipos inválidos', () => {
  assert.equal(sanitize({ 'id:ok': 'moon', 'id:x': 'x', __proto__: 'moon', 'zz:1': 'star', 'id:a b': 'star' }).size, 1);
  const store = create(fakeArea().area);
  assert.equal(store.set('id:a', 'coroa'), false);
  assert.equal(store.set('../x', 'star'), false);
});

test('sincroniza mudanças vindas de outra aba', async () => {
  const fake = fakeArea();
  const store = create(fake.area, fake.changes);
  await store.load();
  let calls = 0;
  store.onChange(() => calls++);
  fake.emit({ 'id:z': 'star' });
  assert.equal(store.get('id:z'), 'star');
  assert.equal(calls, 1);
});

test('limita o número de entradas guardadas', () => {
  const raw = {};
  for (let i = 0; i < MAX_ENTRIES + 10; i++) raw['id:k' + i] = 'star';
  assert.equal(sanitize(raw).size, MAX_ENTRIES);
});
