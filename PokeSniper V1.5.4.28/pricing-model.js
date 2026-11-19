// Adapta as fichas do Sniper ao motor MIT do Briaoale. O histórico fica na extensão.
(() => {
  const DAY = 86400000;
  const STATS = { hp: 'hp', atk: 'attack', def: 'defense', spAtk: 'specialAttack',
    spDef: 'specialDefense', speed: 'speed' };
  const cache = new Map();
  let central;
  let catalog;

  const normalizedName = name => typeof name === 'string'
    ? name.trim().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/^✨\s*/u, '')
      .replace(/^shiny\s+/i, '').toLowerCase() : '';

  function describe(row, outland) {
    if (outland(row) || !central || !Number.isFinite(row.grade) || !Number.isFinite(row.quality)) return null;
    const speciesId = catalog.get(normalizedName(row.name));
    if (speciesId == null) return null;
    const ivs = Object.fromEntries(Object.entries(STATS).map(([key, field]) => [key, row.ivs?.[field]]));
    const profile = globalThis.PokeIdlePvePricing.describe(central, {
      speciesId, level: row.level, potencia: row.power, quality: row.quality, shiny: row.shiny === 1,
      ivs, tmAoe: row.aoe === 1, tmElemental: row.zMove === 1 ? 'NORMAL' : null, refino: {},
    });
    if (!profile) return null;
    // Os IVs alimentam o PvE. A coluna de IV de ataque não entra como fator separado.
    return { ...profile, speciesId, name: row.name, nota: row.grade, ivAtaque: null,
      effectsKey: JSON.stringify([row.aoe === 1, row.zMove === 1, profile.mega || row.mega === 1]) };
  }

  function makeMarket(sales, now, outland) {
    const engine = globalThis.PokeIdlePvePricing;
    if (!engine || !globalThis.PokeIdleCentral) return () => null;
    if (!central) {
      central = globalThis.PokeIdleCentral.create(globalThis);
      catalog = new Map([...central.species].map(([id, entry]) => [normalizedName(entry.n), id]));
    }
    const rowsByMarket = new Map();
    const seen = new Set();
    // Cada exemplar contribui com a venda mais recente. Moedas e classes nunca se cruzam.
    for (const sale of [...sales].sort((a, b) => b.soldAt - a.soldAt)) {
      if (!(sale.price > 0) || sale.soldAt >= now || sale.soldAt < now - 30 * DAY || sale.shiny == null) continue;
      const profile = describe(sale, outland);
      if (!profile) continue;
      const key = JSON.stringify([sale.currency, sale.shiny, profile.effectsKey]);
      const id = JSON.stringify([sale.currency, sale.pokemonId ? 'pokemon' : 'sale', sale.pokemonId || sale.id]);
      if (seen.has(id)) continue;
      seen.add(id);
      if (!rowsByMarket.has(key)) rowsByMarket.set(key, []);
      rowsByMarket.get(key).push({ ...profile, id: sale.id, at: sale.soldAt, price: sale.price,
        base: sale.price, logBase: Math.log(sale.price), power: sale.power, speed: sale.ivs?.speed });
    }

    const fitted = new Map();
    return target => {
      const profile = describe(target, outland);
      if (!profile) return null;
      const key = JSON.stringify([target.currency, target.shiny, profile.effectsKey]);
      const rows = rowsByMarket.get(key) || [];
      // Sem cotação de adicionais, usa preços pagos do mesmo conjunto de especiais.
      // Exige suporte direto na espécie, além do conjunto usado para ajustar a curva.
      const nearby = rows.filter(row => row.speciesId === profile.speciesId &&
        Math.abs(row.nota - target.grade) <= 0.75 && Math.abs(Math.log2(row.level / target.level)) <= 0.5 &&
        Math.abs(Math.log(row.pve / profile.pve)) <= 0.5);
      if (rows.length < 30 || nearby.length < 5) return null;
      if (!fitted.has(key)) {
        const signature = JSON.stringify(rows.map(row => [row.id, row.at, row.price, row.pve, row.nota, row.notaBase, row.level, row.speciesId]));
        let entry = cache.get(key);
        if (!entry || entry.signature !== signature) {
          entry = { signature, fit: engine.marketFit(rows) };
          if (cache.size >= 16) cache.delete(cache.keys().next().value);
          cache.set(key, entry);
        }
        fitted.set(key, entry.fit);
      }
      const result = engine.neighbors({ ...profile, at: now }, rows, {
        fit: fitted.get(key), typesOf: id => central.species.get(id)?.t || [], bias: 0,
      });
      if (!result || ![result.low, result.median, result.high].every(n => Number.isFinite(n) && n > 0)) return null;
      return { status: 'estimated', method: 'briaoale_pve', lower: result.low, median: result.median, upper: result.high,
        discount: 1 - target.price / result.median, count: nearby.length, profileSales: nearby.length,
        marketCount: rows.length, alertSupported: result.parts.proximidade >= 4 / 9, comparables: result.influence.slice(0, 5).map(({ r }) => ({
          id: r.id, price: r.price, soldAt: r.at, grade: r.nota, level: r.level, power: r.power, speed: r.speed,
        })) };
    };
  }

  function prepare(sales, baseline, now, estimateMarket) {
    return target => estimateMarket?.(target) ?? baseline(target, sales, now);
  }

  const api = { makeMarket, prepare };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else globalThis.PISPricingModel = api;
})();
