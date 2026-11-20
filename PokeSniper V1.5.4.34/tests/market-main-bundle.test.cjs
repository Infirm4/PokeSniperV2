const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { runInNewContext } = require('node:vm');
const test = require('node:test');
const { build } = require('../scripts/build-market-main.cjs');

test('o MAIN é instalado com um único bundle e os módulos permanecem privados à página', () => {
  const manifest = require('../manifest.json');
  const files = manifest.content_scripts.find(entry => entry.world === 'MAIN').js;
  assert.deepEqual(files, ['market-main.js']);
  const stored = readFileSync(join(__dirname, '..', files[0]), 'utf8');
  assert.equal(stored, build());
  const boundary = stored.indexOf('// PokeIdle Market Sniper v');
  assert.ok(boundary > 0);
  const page = { module: { exports: { site: true } }, PISMarketCore: null, PISCoinsHistory: null };
  const result = runInNewContext(stored.slice(0, boundary) +
    'return [typeof mainMarketCore.decodeGameFrame, typeof mainCoinsHistory.backfill];\n})();', page);
  assert.equal(result[0], 'function');
  assert.equal(result[1], 'function');
  assert.deepEqual(page.module.exports, { site: true });
  assert.equal(page.PISMarketCore, null);
  assert.equal(page.PISCoinsHistory, null);
  assert.doesNotMatch(stored, /globalThis\.PIS(?:MarketCore|CoinsHistory)/);
});
