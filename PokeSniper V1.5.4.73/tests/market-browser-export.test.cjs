const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { createContext, runInContext } = require('node:vm');
const test = require('node:test');

test('o parser da extensão funciona no MAIN mesmo se o site definir module.exports', () => {
  const existing = { exports: { site: true } };
  const browser = createContext({ window: {}, module: existing });
  for (const file of ['market-core.js', 'coins-history.js']) {
    runInContext(readFileSync(join(__dirname, '..', file), 'utf8'), browser);
  }
  assert.deepEqual(existing.exports, { site: true });
  assert.equal(typeof browser.PISCoinsHistory.backfill, 'function');
  const now = Date.now();
  const reply = browser.PISMarketCore.decodeGameFrame(JSON.stringify({
    aba: 'historicoGlobal', t: 'market', moeda: 'gold', linhas: [{
      id: 'venda-1', bruto: 80_000_000, em: now - 1000,
      ficha: { id: 'poke-1', speciesId: 94, nome: 'Gengar', shiny: false, shadow: true,
        rarity: 'rare', stats: { hp: 567, speed: 234, nickname: 'private' },
        potencia: 3, ivs: { hp: 0 }, refinoTotal: 3, poder: 500, natureza: 'modest' },
    }],
  }));
  const [row] = browser.PISMarketCore.capture(reply).rows;
  const [validated] = browser.PISMarketCore.validate('sale', [row]);
  assert.equal(validated.id, 'venda-1');
  assert.equal(validated.pokemonId, 'poke-1');
  assert.equal(validated.currency, 'gold');
  assert.equal(validated.shadow, 1);
  assert.equal(validated.rarity, 'rare');
  assert.equal(validated.ivs.hp, 0);
  assert.equal(validated.stats.speed, 234);
  assert.equal(validated.stats.nickname, undefined);
  assert.equal(validated.refinement, 3);
  assert.equal(validated.nature, 'modest');
  assert.equal(validated.battlePower, 500);
});
