// Modelo local no log do preço, avaliado em blocos cronológicos antes de alterar alertas.
(() => {
  const DAY = 86400000;
  const STATS = ['hp', 'attack', 'defense', 'specialAttack', 'specialDefense', 'speed'];
  const EXTRA = ['aoe', 'zMove', 'mega'];
  const MIN_ROWS = 60;
  const cache = new Map();

  function features(row, detailed) {
    if (!(row.level > 0) || !Number.isFinite(row.grade) || !Number.isFinite(row.quality) ||
        !Number.isFinite(row.ivTotal) || !(row.power >= 1 && row.power <= 5)) return null;
    const values = [row.grade, Math.log(row.level), ...[2, 3, 4, 5].map(n => Number(row.power === n)),
      row.quality, row.ivTotal];
    if (detailed) {
      const ivs = STATS.map(key => row.ivs?.[key]);
      if (!ivs.every(Number.isFinite)) return null;
      // Cinco contrastes independentes preservam a distribuição sem duplicar o total.
      const mean = ivs.reduce((a, b) => a + b, 0) / ivs.length;
      values.push(...ivs.slice(1).map(value => value - mean));
    }
    // Presença e valor são coordenadas distintas. Ausência não é um especial falso.
    for (const flag of EXTRA) values.push(Number(row[flag] != null), Number(row[flag] === 1));
    return values;
  }

  function solve(matrix) {
    for (let i = 0; i < matrix.length; i++) {
      let pivot = i;
      for (let j = i + 1; j < matrix.length; j++) {
        if (Math.abs(matrix[j][i]) > Math.abs(matrix[pivot][i])) pivot = j;
      }
      if (Math.abs(matrix[pivot][i]) < 1e-9) return null;
      [matrix[i], matrix[pivot]] = [matrix[pivot], matrix[i]];
      const value = matrix[i][i];
      matrix[i] = matrix[i].map(x => x / value);
      for (let j = 0; j < matrix.length; j++) {
        if (j === i) continue;
        const factor = matrix[j][i];
        matrix[j] = matrix[j].map((x, k) => x - factor * matrix[i][k]);
      }
    }
    return matrix.map(row => row.at(-1));
  }

  const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);

  function fit(rows) {
    const dimensions = rows[0].x.length;
    const center = Array.from({ length: dimensions }, (_, k) => rows.reduce((s, r) => s + r.x[k], 0) / rows.length);
    const scale = center.map((mean, k) => Math.sqrt(rows.reduce((s, r) => s + (r.x[k] - mean) ** 2, 0) / rows.length) || 1);
    const transform = x => [1, ...x.map((value, k) => (value - center[k]) / scale[k])];
    const newest = rows.at(-1).sale.soldAt;
    const weightByPokemon = new Map();
    const weighted = rows.map(row => {
      const weight = 2 ** (-(newest - row.sale.soldAt) / (10 * DAY));
      if (row.sale.pokemonId) weightByPokemon.set(row.sale.pokemonId, (weightByPokemon.get(row.sale.pokemonId) || 0) + weight);
      return { ...row, x: transform(row.x), weight };
    });
    let coefficients;
    // Ridge regulariza efeitos correlacionados. Reponderação Huber limita vendas extremas.
    for (let pass = 0; pass < 4; pass++) {
      const size = dimensions + 1;
      const matrix = Array.from({ length: size }, () => Array(size + 1).fill(0));
      for (const row of weighted) {
        const y = Math.log(row.sale.price);
        const error = coefficients ? Math.abs(y - dot(row.x, coefficients)) : 0;
        const factor = row.weight / Math.max(1, weightByPokemon.get(row.sale.pokemonId) || 0) *
          (error > 0.35 ? 0.35 / error : 1);
        for (let i = 0; i < size; i++) {
          for (let j = 0; j < size; j++) matrix[i][j] += factor * row.x[i] * row.x[j];
          matrix[i][size] += factor * row.x[i] * y;
        }
      }
      for (let i = 1; i < size; i++) matrix[i][i] += 4;
      coefficients = solve(matrix);
      if (!coefficients) return null;
    }
    return { predict: x => dot(transform(x), coefficients),
      contributions: x => transform(x).slice(1).map((value, i) => value * coefficients[i + 1]) };
  }

  function quantile(values, fraction) {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor((sorted.length - 1) * fraction)];
  }

  function build(rows, allSales, baseline) {
    if (rows.length < MIN_ROWS) return null;
    const calibrationStart = rows[Math.floor(rows.length * 0.55)].sale.soldAt;
    const testStart = rows[Math.floor(rows.length * 0.77)].sale.soldAt;
    const test = rows.filter(row => row.sale.soldAt >= testStart);
    const testIds = new Set(test.map(row => row.sale.pokemonId).filter(Boolean));
    const calibration = rows.filter(row => row.sale.soldAt >= calibrationStart &&
      row.sale.soldAt < testStart && !testIds.has(row.sale.pokemonId));
    const calibrationIds = new Set(calibration.map(row => row.sale.pokemonId).filter(Boolean));
    const train = rows.filter(row => row.sale.soldAt < calibrationStart &&
      !testIds.has(row.sale.pokemonId) && !calibrationIds.has(row.sale.pokemonId));
    if (train.length < 28 || calibration.length < 12 || test.length < 12) return null;
    const model = fit(train);
    if (!model) return null;
    const residuals = calibration.map(row => Math.log(row.sale.price) - model.predict(row.x));
    const offsets = [0.2, 0.5, 0.8].map(p => quantile(residuals, p));
    const tests = [];
    for (const row of test) {
      // Compara com o motor vigente nas mesmas transações, sempre com vendas anteriores.
      const prior = allSales.filter(sale => !row.sale.pokemonId || sale.pokemonId !== row.sale.pokemonId);
      const reference = baseline(row.sale, prior, row.sale.soldAt);
      if (reference.status !== 'estimated') continue;
      const predicted = model.predict(row.x);
      const actual = Math.log(row.sale.price);
      tests.push({ baseline: Math.abs(actual - Math.log(reference.median)),
        error: Math.abs(actual - predicted - offsets[1]),
        below: actual < predicted + offsets[0],
        covered: actual >= predicted + offsets[0] && actual <= predicted + offsets[2] });
    }
    if (tests.length < 12) return null;
    const before = quantile(tests.map(row => row.baseline), 0.5);
    const after = quantile(tests.map(row => row.error), 0.5);
    const below = tests.filter(row => row.below).length / tests.length;
    const coverage = tests.filter(row => row.covered).length / tests.length;
    if (before <= 0 || after > before * 0.95 || below > 0.27 || coverage < 0.45 || coverage > 0.85) return null;
    return { model, offsets, validation: { count: tests.length, before, after, below, coverage } };
  }

  function identity(row) {
    return JSON.stringify([row.id, row.pokemonId, row.soldAt, row.price, row.grade, row.level,
      row.power, row.quality, row.ivTotal, row.ivs, row.aoe, row.zMove, row.mega]);
  }

  function prepare(sales, baseline, sameMarket, now) {
    const local = new Map();
    return target => {
      const reference = baseline(target, sales, now);
      const detailed = STATS.every(key => Number.isFinite(target.ivs?.[key]));
      const x = features(target, detailed);
      if (!x || reference.status !== 'estimated') return { ...reference, profileReason: 'missing_fields_or_sales' };
      const key = JSON.stringify([target.currency, target.speciesId, target.shiny, target.form ?? null, detailed]);
      if (!local.has(key)) {
        const available = sales.filter(sale => sameMarket(sale, target) && sale.soldAt < now && sale.price > 0)
          .sort((a, b) => a.soldAt - b.soldAt);
        const signature = available.map(identity).join('\n');
        let value = cache.get(key);
        if (!value || value.signature !== signature) {
          const rows = available.map(sale => ({ sale, x: features(sale, detailed) })).filter(row => row.x);
          value = { signature, rows, calibrated: build(rows, available, baseline) };
          if (cache.size >= 32) cache.delete(cache.keys().next().value);
          cache.set(key, value);
        }
        local.set(key, value);
      }
      const { rows, calibrated } = local.get(key);
      if (!calibrated) return { ...reference, profileReason: 'no_temporal_validation', profileSales: rows.length };
      const nearby = rows.filter(({ sale }) =>
        sale.power === target.power && EXTRA.every(flag => (sale[flag] ?? null) === (target[flag] ?? null)) &&
        Math.abs(target.grade - sale.grade) <= 0.75 && Math.abs(Math.log(target.level / sale.level)) <= 0.5 &&
        (!detailed || Math.abs(target.ivs.speed - sale.ivs.speed) <= Math.max(1, target.ivTotal / 12)))
        .map(({ sale, x: values }) => ({
          sale, distance: Math.abs(target.grade - sale.grade) + Math.abs(Math.log(target.level / sale.level)) +
            Math.abs(x[6] - values[6]) / Math.max(1, x[6] * 0.15) +
            Math.abs(x[7] - values[7]) / Math.max(1, x[7] * 0.15) +
            (detailed ? x.slice(8, 13).reduce((sum, value, i) =>
              sum + Math.abs(value - values[8 + i]), 0) / Math.max(1, x[7]) : 0),
        })).filter(row => row.distance <= 2).sort((a, b) => a.distance - b.distance);
      const distinct = new Map();
      for (const row of nearby) {
        const identity = row.sale.pokemonId || row.sale.id;
        if (!distinct.has(identity)) distinct.set(identity, row);
      }
      const supported = [...distinct.values()];
      if (supported.length < 5) return { ...reference, profileReason: 'rare_profile', profileSales: supported.length };
      const prediction = calibrated.model.predict(x);
      const [lower, median, upper] = calibrated.offsets.map(offset => Math.exp(prediction + offset));
      if (![lower, median, upper].every(value => Number.isFinite(value) && value > 0)) return reference;
      const parts = calibrated.model.contributions(x);
      const effect = (name, start, end) => ({ name, logEffect: parts.slice(start, end).reduce((a, b) => a + b, 0) });
      const effects = [effect('Potência', 2, 6), effect('Qualidade', 6, 7), effect('IV total', 7, 8),
        effect('Especiais', detailed ? 13 : 8)];
      if (detailed) effects.push(effect('Distribuição dos IVs', 8, 13));
      return { ...reference, method: detailed ? 'profile_iv_distribution' : 'profile_iv_total',
        lower, median, upper, discount: 1 - target.price / median,
        effects, profileSales: supported.length, baselineMedian: reference.median, validation: calibrated.validation,
        comparables: supported.slice(0, 5).map(({ sale }) => ({
          id: sale.id, price: sale.price, soldAt: sale.soldAt, grade: sale.grade, level: sale.level,
          power: sale.power, speed: sale.ivs?.speed,
        })) };
    };
  }

  const api = { prepare, features };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else globalThis.PISPricingModel = api;
})();
