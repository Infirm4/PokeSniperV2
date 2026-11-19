// Liquidez independente do preço justo e dos gatilhos de oportunidade.
(() => {
  const DAY = 86400000;
  const MAX_GAP = 45 * 60000;
  const HISTORY = 60 * DAY;
  const HORIZONS = [1, 7, 30];
  const IVS = ['hp', 'attack', 'defense', 'specialAttack', 'specialDefense', 'speed'];

  function observe(listing, previous, now) {
    // Redefine o relógio após mudança de preço, ficha ou lacuna de observação.
    const continued = previous && !previous.saleAt && !previous.closedAt && now - previous.lastSeen <= MAX_GAP &&
      ['price', 'level', 'grade', 'power', 'quality', 'ivTotal', 'form', 'shiny', 'currency', 'speciesId',
        'aoe', 'zMove', 'mega', 'pokemonId', 'availableAt'].every(key => (previous[key] ?? null) === (listing[key] ?? null)) &&
      IVS.every(stat => (previous.ivs?.[stat] ?? null) === (listing.ivs?.[stat] ?? null));
    const startAt = continued ? previous.startAt : Math.max(now, (previous?.startAt ?? 0) + 1);
    return { ...listing, key: [listing.id, startAt], startAt, lastSeen: Math.max(now, startAt) };
  }

  function possibleSale(exposure, sale) {
    return Boolean(sale.pokemonId) && sale.pokemonId === exposure.pokemonId && !exposure.closedAt &&
      sale.currency === exposure.currency && sale.price === exposure.price &&
      sale.speciesId === exposure.speciesId && (sale.form ?? null) === (exposure.form ?? null) &&
      sale.shiny === exposure.shiny && sale.soldAt >= exposure.lastSeen &&
      sale.soldAt - exposure.lastSeen <= MAX_GAP && sale.soldAt >= (exposure.availableAt ?? exposure.startAt);
  }

  function saleMatches(exposure, sale) {
    // O ID da transação e o ID do exemplar não identificam a oferta.
    return Boolean(sale.listingId) && sale.listingId === exposure.id && possibleSale(exposure, sale);
  }

  function profileDistance(target, row) {
    if (!(row.level > 0) || !Number.isFinite(row.grade)) return Infinity;
    if (target.power !== row.power) return Infinity;
    if (['aoe', 'zMove', 'mega'].some(key => (target[key] ?? null) !== (row[key] ?? null))) return Infinity;
    const grade = Math.abs(target.grade - row.grade);
    const level = Math.abs(Math.log(target.level / row.level));
    if (grade > 0.75 || level > 0.5) return Infinity;
    const quality = Math.abs(target.quality - row.quality) / Math.max(1, target.quality);
    const total = Math.abs(target.ivTotal - row.ivTotal) / Math.max(1, target.ivTotal);
    const differences = IVS.map(stat => Math.abs(target.ivs[stat] - row.ivs[stat]));
    const speed = differences.at(-1) / Math.max(1, target.ivTotal / 6);
    const distribution = differences.reduce((a, b) => a + b, 0) / Math.max(1, target.ivTotal);
    if (quality > 0.2 || total > 0.25 || speed > 0.6 || distribution > 0.35) return Infinity;
    return grade + level + quality + total + speed + distribution;
  }

  function fullProfile(row) {
    return Number.isFinite(row.grade) && row.level > 0 && row.shiny != null &&
      Number.isFinite(row.power) && Number.isFinite(row.quality) && Number.isFinite(row.ivTotal) &&
      IVS.every(stat => Number.isFinite(row.ivs?.[stat]));
  }

  function outcomes(rows, horizon, end) {
    const used = new Set();
    const sample = [];
    for (const { row, weight } of rows) {
      const start = Math.max(row.startAt, row.availableAt ?? 0);
      if (start + horizon > end) continue;
      const entity = row.pokemonId || row.id;
      if (used.has(entity)) continue;
      used.add(entity);
      const sold = row.saleAt != null && row.saleAt <= end && row.saleAt >= start;
      // Uma venda posterior ao prazo confirma que essa mesma revisão sobreviveu ao prazo.
      const known = sold || (row.closedAt != null && row.closedAt <= end) || row.lastSeen >= start + horizon;
      const possible = !sold && row.possibleSaleAt >= start && row.possibleSaleAt <= start + horizon;
      sample.push({ sold: sold && row.saleAt <= start + horizon, known, possible, weight });
    }
    const weight = sample.reduce((sum, row) => sum + row.weight, 0);
    if (!weight) return { count: 0, confirmed: 0, possible: 0, unknown: 1 };
    const confirmed = sample.filter(row => row.sold).length;
    const sold = sample.filter(row => row.sold).reduce((sum, row) => sum + row.weight, 0);
    const unknown = sample.filter(row => !row.known).reduce((sum, row) => sum + row.weight, 0) / weight;
    return { count: sample.length, confirmed, possible: sample.filter(row => row.possible).length, unknown, lower: sold / weight,
      upper: Math.min(1, sold / weight + unknown),
      effectiveCount: weight ** 2 / sample.reduce((sum, row) => sum + row.weight ** 2, 0) };
  }

  // Mede coortes com o prazo completo. As saídas desconhecidas viram limites de sensibilidade.
  // Só publica ponto se houver cobertura e o bloco cronológico seguinte for compatível.
  function horizonEstimate(rows, days, now) {
    const horizon = days * DAY;
    const live = outcomes(rows, horizon, now);
    if (live.count < 30 || live.effectiveCount < 20 || live.confirmed < 5 || live.unknown > 0.20) {
      return { days, status: 'insufficient_outcomes', ...live };
    }
    const mature = rows.filter(({ row }) => Math.max(row.startAt, row.availableAt ?? 0) + horizon <= now);
    const split = mature[Math.floor(mature.length / 3)]?.row.startAt;
    const train = outcomes(mature.filter(({ row }) => row.startAt < split), horizon, split);
    const test = outcomes(mature.filter(({ row }) => row.startAt >= split), horizon, now);
    const midpoint = interval => (interval.lower + interval.upper) / 2;
    if (train.count < 15 || test.count < 10 || train.confirmed < 3 || test.confirmed < 2 ||
        train.unknown > 0.20 || test.unknown > 0.20 || Math.abs(midpoint(train) - midpoint(test)) > 0.15) {
      return { days, status: 'not_validated', ...live };
    }
    // Acrescenta margem amostral aproximada aos limites decorrentes dos desfechos desconhecidos.
    const p = midpoint(live);
    const margin = 1.96 * Math.sqrt(Math.max(0.01, p * (1 - p)) / live.effectiveCount);
    return { days, status: 'estimated', probability: p, ...live,
      lower: Math.max(0, live.lower - margin), upper: Math.min(1, live.upper + margin),
      validationCount: test.count };
  }

  function comparablePrice(target, row) {
    return Math.abs(Math.log(row.price / target.price));
  }

  function activity(target, sales, exposures, now, sameMarket, freshness) {
    if (!fullProfile(target)) return null;
    const matches = row => row.id !== target.id && fullProfile(row) && sameMarket(row, target) &&
      comparablePrice(target, row) <= Math.log(1.25) && Number.isFinite(profileDistance(target, row));
    return {
      recentSales: sales.filter(sale => fullProfile(sale) && sameMarket(sale, target) &&
        comparablePrice(target, sale) <= Math.log(1.25) && Number.isFinite(profileDistance(target, sale))).length,
      recentListings: new Set(exposures.filter(row => !row.saleAt && !row.closedAt && row.lastSeen >= now - freshness &&
        matches(row)).map(row => row.id)).size,
    };
  }

  function estimate(target, exposures, now, sameMarket) {
    if (!fullProfile(target)) return { status: 'incomplete_profile', count: 0, horizons: [] };
    const reference = exposures.filter(row => row.id !== target.id && fullProfile(row) && sameMarket(row, target) &&
      row.startAt >= now - HISTORY && row.startAt < now)
      .map(row => {
        const price = comparablePrice(target, row);
        const distance = profileDistance(target, row);
        return { row, weight: Math.exp(-distance - price * 3) * 2 ** (-(now - row.startAt) / (20 * DAY)),
          price, distance };
      })
      .filter(row => row.price <= Math.log(1.25) && Number.isFinite(row.distance))
      .sort((a, b) => b.row.startAt - a.row.startAt);
    return { status: 'observational', count: reference.length,
      horizons: HORIZONS.map(days => horizonEstimate(reference, days, now)) };
  }

  const api = { observe, saleMatches, possibleSale, estimate, activity, HISTORY, MAX_GAP };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else globalThis.PISLiquidity = api;
})();
