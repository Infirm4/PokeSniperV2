const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const core = require('../market-core.js');
const coins = require('../coins-history.js');

const ctx = vm.createContext({});
for (const path of ['especies', 'pve-power', 'market-bonuses', 'central', 'nota', 'pve-pricing'].map(name =>
  'vendor/briaoale/' + name + '.js').concat(['market-core.js', 'public-gems.js', 'opportunities.js'])) {
  vm.runInContext(readFileSync(join(__dirname, '..', path), 'utf8'), ctx);
}
const now = Date.UTC(2026, 10, 19);
const target = { name: 'Gengar', speciesId: '94', currency: 'orb', level: 100,
  grade: 5, quality: 1.8, power: 3, shiny: 0, price: 75, aoe: 0, zMove: 0,
  ivs: { hp: 20, attack: 20, defense: 20, specialAttack: 20, specialDefense: 20, speed: 20 } };

test('usa o histórico público e a curva do site somente em Gemas', () => {
  const central = ctx.PokeIdleCentral.create(ctx);
  const engine = ctx.PokeIdlePvePricing;
  const sheet = { nome: 'Gengar', level: 100, potencia: 3, quality: 1.8, nota: 5, shiny: false,
    ivs: { hp: 20, atk: 20, def: 20, spAtk: 20, spDef: 20, speed: 20 } };
  const publicSales = engine.prepare(central, Array.from({ length: 36 }, (_, i) => ({
    name: 'Gengar', speciesId: 94, currency: 'orb', at: now - 60000 * (i + 1), price: 85 + i, ficha: sheet,
  })), []).rows;
  const snapshot = { geradoEm: new Date(now).toISOString(),
    vendas: ctx.PokeIdleCentral.compactar(publicSales.map(({ logBase, ...row }) => row)), itens: [],
    correcao: { bias: 0.03 } };
  const source = ctx.PISPublicGems;
  const estimate = source.prepare(snapshot, now)(target);
  const original = engine.priceSheet(central, sheet, { rows: publicSales, now, correcao: snapshot.correcao });
  assert.equal(estimate.method, 'briaoale_public');
  assert.deepEqual([estimate.lower, estimate.median, estimate.upper], [original.low, original.median, original.high]);
  assert.equal(source.prepare(snapshot, now)({ ...target, currency: 'gold' }), null);
  assert.equal(source.prepare(snapshot, now + 4 * 86400000)(target), null);
  assert.equal(source.valid({ ...snapshot, vendas: { ...snapshot.vendas, n: 3 } }, now), false);
  const report = source.compareAttackIv(snapshot, [{ ...target, currency: 'gold' }, target], now);
  assert.equal(report.anúncios.length, 1);
  const [comparison] = report.anúncios;
  const withoutAttack = source.prepare(snapshot, now, { attackIv: false })(target);
  assert.equal(comparison.sem_ajuste_de_ataque.justo, withoutAttack.median);
  assert.equal(comparison.com_ajuste_de_ataque.justo, estimate.median);
  assert.equal(comparison.briaoale.justo, original.median);
  assert.equal(source.compareAttackIv(snapshot, [target], now + 4 * 86400000).estado, 'base pública indisponível');
});

test('importa um backup do formato Smart Market com IDs deduplicados e sem copiar Gemas', () => {
  const row = { id: 100, pokemonId: 200, em: now - 60000,
    moeda: 'gold', preco: 123_000_000, speciesId: 94, nome: 'Gengar', level: 100, nota: 5,
    potencia: 3, quality: 1.8, ivTotal: 100, shiny: false, aoe: false, zmove: false, mega: false };
  const imported = coins.importRows([row, row, { ...row, id: 101, moeda: 'orb' },
    { ...row, id: 102, nome: 'Trickmaster Gengar' }], core, now);
  assert.equal(imported.length, 1);
  assert.equal(imported[0].id, '100');
  assert.equal(imported[0].source, 'smartmarket_backup');
  assert.equal(imported[0].price, 123_000_000);
  assert.equal(imported[0].ivs.speed, null);
  assert.equal(coins.cleanSpecies('Mr. Mime'), 'Mr. Mime');
  assert.equal(coins.cleanSpecies('{"busca":""}'), null);
});

test('suporta IV zero e separa referência pública exploratória do alerta', () => {
  const central = ctx.PokeIdleCentral.create(ctx);
  const engine = ctx.PokeIdlePvePricing;
  const ficha = { nome: 'Gengar', level: 100, potencia: 3, quality: 1.8, nota: 5, shiny: false,
    ivs: { hp: 20, atk: 20, def: 20, spAtk: 20, spDef: 20, speed: 0 } };
  const rows = engine.prepare(central, Array.from({ length: 36 }, (_, i) => ({
    name: 'Gengar', speciesId: 94, currency: 'orb', at: now - 60000 * (i + 1), price: 100, ficha,
  })), []).rows;
  assert.equal(rows.length, 36);
  const snapshot = { geradoEm: new Date(now).toISOString(), itens: [],
    vendas: ctx.PokeIdleCentral.compactar(rows.map(({ logBase, ...row }) => row)) };
  assert.equal(ctx.PISPublicGems.validateContent({ ...snapshot, itens: [null] }, now), false);
  assert.equal(ctx.PISPublicGems.validateContent(snapshot, now), true);
  const quote = ctx.PISPublicGems.prepare(snapshot, now);
  assert.equal(quote({ ...target, ivs: { ...target.ivs, speed: 0 } }).alertSupported, true);
  assert.equal(quote({ ...target, name: 'Rattata', speciesId: '19' })?.alertSupported ?? false, false);
  assert.equal(quote({ ...target, name: 'War Heracross', speciesId: '2005' }), null);
});

test('backup preserva atributos de registros repetidos e exclui Outlaws explícitos', () => {
  const sale = { id: 1, nome: 'Gengar', speciesId: 94, moeda: 'gold', em: now - 60000, preco: 100, level: 100 };
  const imported = coins.importRows([{ ...sale, ivs: { speed: 0 }, nota: 5 }, sale,
    { ...sale, id: 2, dex: 2001, isOutland: true }], core, now);
  assert.equal(imported.length, 1);
  assert.equal(imported[0].ivs.speed, 0);
  assert.equal(imported[0].grade, 5);
  assert.equal(coins.cleanSpecies('Type: Null'), 'Type: Null');
});

test('o IV dominante ajusta a referência de Coins sem virar requisito de aviso', () => {
  const quote = { ...target, currency: 'gold', price: 80_000_000 };
  const sales = [10, 14, 18, 22, 26].map((specialAttack, i) => ({
    ...quote, id: String(i + 1), pokemonId: String(i + 100), soldAt: now - (i + 1) * 60000,
    source: 'game', price: (90 + i * 5) * 1_000_000, ivs: { ...quote.ivs, specialAttack },
  }));
  const estimate = ivs => ctx.PISMarketCore.estimate({ ...quote, ivs: { ...quote.ivs, ...ivs } }, sales, now);
  const low = estimate({ specialAttack: 10 });
  const high = estimate({ specialAttack: 32 });
  const otherIvs = estimate({ specialAttack: 32, speed: 0, attack: 1 });
  const missing = estimate({ specialAttack: null });
  assert.ok(low.median < missing.median && missing.median < high.median);
  assert.equal(high.median, otherIvs.median);
  assert.equal(high.effectiveCount, low.effectiveCount);
  assert.equal(low.alertSupported, true);
  assert.equal(missing.alertSupported, true);
  assert.equal(missing.attackFactor, 1);
  assert.ok(high.attackFactor <= 1.15 && low.attackFactor >= 0.85);
  const legacy = ctx.PISMarketCore.estimate(quote, sales.map(sale => ({ ...sale, ivs: null })), now);
  assert.equal(legacy.median, missing.median);
  assert.equal(legacy.alertSupported, true);
});

test('o aviso classifica a velocidade e exibe o ataque da mesma forma usada no motor', () => {
  const { noticePresentation } = ctx.PISOpportunities;
  const quote = { ...target, estimate: { median: 100, discount: 0.25 },
    ivs: { hp: 20, attack: 26, defense: 20, specialAttack: 17, specialDefense: 20, speed: 15 } };
  assert.match(noticePresentation(quote).message, /IVs: Velocidade 15 \(média\), Atq\. Esp\. 17$/);
  const dragonite = { ...quote, name: 'Dragonite', ivs: { ...quote.ivs, speed: 25 } };
  assert.match(noticePresentation(dragonite).message, /IVs: Velocidade 25 \(Pica\), Ataque 26$/);
  const mixed = { ...quote, name: 'Meganium' };
  assert.match(noticePresentation(mixed).message, /IVs: Velocidade 15 \(média\), Ataque 26, Atq\. Esp\. 17$/);
  assert.match(noticePresentation({ ...mixed, ivs: { ...mixed.ivs, attack: 0, specialAttack: null } }).message,
    /IVs: Velocidade 15 \(média\), Ataque 0$/);
  const haunter = { ...quote, name: 'Haunter', ivs: { ...quote.ivs, speed: 14 } };
  assert.match(noticePresentation(haunter).message, /IVs: Velocidade 14 \(crítico\), Atq\. Esp\. 17$/);
  assert.match(noticePresentation({ ...quote, ivs: { ...quote.ivs, speed: null } }).message, /Velocidade indisponível/);
});
