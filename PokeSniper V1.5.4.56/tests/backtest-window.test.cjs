const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { runInNewContext } = require('node:vm');
const test = require('node:test');
const core = require('../market-core.js');
const opportunities = require('../opportunities.js');

test('avalia uma base curta com corte cronológico e sem treino com os mesmos exemplares', async () => {
  const now = Date.now();
  const cutoffs = [];
  const source = readFileSync(join(__dirname, '../market-backtest.js'), 'utf8');
  const backtest = runInNewContext(source + '\nPISMarketBacktest', {
    PISMarketCore: core, PISOpportunities: opportunities,
    PISPricingModel: { makeMarket(_, cut) { cutoffs.push(cut); },
      prepare(training) { return row => {
        assert.ok(training.every(sale => sale.soldAt < row.soldAt && sale.pokemonId !== row.pokemonId));
        return { status: 'estimated', lower: 80, median: 100, upper: 120 };
      }; } },
    setTimeout,
  });
  const sales = Array.from({ length: 40 }, (_, i) => ({ id: String(i), pokemonId: String(i % 39),
    currency: 'gold', name: 'Gengar', soldAt: now - (40 - i) * 60000, price: 100 }));
  const result = await backtest.run(sales, { discount: 5 }, now);
  assert.equal(cutoffs[0], sales[30].soldAt);
  assert.equal(result.moedas.gold.treino, 29);
  assert.equal(result.moedas.gold.grupos.total.avaliadas, 10);
  assert.equal(result.moedas.orb.estado, 'sem datas suficientes para separar treino e teste');
});
