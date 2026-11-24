const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const { listingKey } = require('../markers/src/listing-id.js');
const { create, KEY } = require('../markers/src/storage.js');

test('manifest 1.5.4.101 incorpora marcadores após o Sniper e mantém scripts essenciais', () => {
  assert.equal(manifest.version, '1.5.4.101');
  assert.equal(manifest.background.service_worker, 'background.js');
  assert.ok(manifest.content_scripts.some(c => c.world === 'MAIN' && c.js.includes('market-main.js')));
  const blocks = manifest.content_scripts.filter(c => c.js.some(x => x.includes('markers/src/')));
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].world, 'ISOLATED');
  assert.equal(blocks[0].run_at, 'document_idle');
  assert.deepEqual(blocks[0].js, ['icons','listing-id','storage','ui','main'].map(s => 'markers/src/' + s + '.js'));
  assert.ok(manifest.permissions.includes('storage'));
  assert.ok(blocks[0].js.every(file => fs.existsSync(path.join(root, file))));
});

test('mesmo id na vitrine e favoritos gera mesma chave sem interferir no banco Sniper', () => {
  const card = (dataset, fav) => ({ dataset, querySelector: () => fav ? { dataset: { fav } } : null });
  const key1 = listingKey(card({ anuncioId: '123' }, null));
  const key2 = listingKey(card({}, '123'));
  assert.equal(key1, 'id:123');
  assert.equal(key1, key2);
  assert.equal(KEY, 'pimMarkers');
});

test('marcadores persistem em chave isolada e preservam dados preexistentes de storage', async () => {
  const initial = { opportunitySettings: { notify: true }, foo: 123 };
  const area = { get: async key => ({ [key]: initial[key] }), set: async update => Object.assign(initial, update) };
  const store = create(area);
  await store.load();
  assert.ok(store.set('id:123', 'moon'));
  await store.flush();
  assert.deepEqual(initial[KEY], { 'id:123': 'moon' });
  assert.deepEqual(initial.opportunitySettings, { notify: true });
  assert.equal(initial.foo, 123);
});


test('marcadores ficam à esquerda e não ocupam o canto superior direito do favorito', () => {
  const uiSource = fs.readFileSync(path.join(root, 'markers/src/ui.js'), 'utf8');
  assert.match(uiSource, /Object\.assign\(host\.style,\s*\{[^}]*top:\s*'3px',\s*left:\s*'3px'/);
  assert.doesNotMatch(uiSource, /Object\.assign\(host\.style,\s*\{[^}]*right:/);
});
