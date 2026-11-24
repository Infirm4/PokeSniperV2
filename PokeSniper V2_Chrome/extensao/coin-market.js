// Referências em Coins e projeção de liquidez por moeda. A cotação normal e o BEPI continuam no estimador original.
(() => {
  const HOUR = 3600000;
  const OPTIONS = Object.freeze({
    windows: Object.freeze([14 * 24, 30 * 24, Infinity]),
    halfLife: 120,
    normalLevelLog: 0.30,
    curveLevelLog: Math.log(1.50),
    extrapolationLog: Math.log(1.20),
    normalGrade: 0.35,
    relaxedGrade: 0.65,
    minimum: Object.freeze({ normal: 3, bepi: 3, 1: 3, 2: 3, 3: 3, 4: 5 }),
    minEffective: 2.6,
    smoothingK: 5,
    fallbackPercentile: 0.40,
    extraDiscountPoints: 10,
    liquidityHours: 336,
    liquidityMinimum: 5,
    inactiveHours: 168,
    highHours: 24,
    mediumHours: 72,
    listingFreshHours: 0.5,
    liquidityBudgetMs: 750,
    calibrationGradeGap: 0.12,
    pairedLevelLog: Math.log(1.10),
    levelTrainingRange: Object.freeze([Math.log(1.12), Math.log(1.50)]),
    minTrainingPairs: 9,
    minValidationPairs: 3,
    minTrainingSpecies: 3,
    maxCalibrationSalesPerSpecies: 64,
    warning: '⚠️',
    textWarning: '[!]',
    useTextWarning: false,
    warningText: 'Preço estimado',
    lowConfidenceWarning: '🚨',
    useLowConfidenceWarning: false,
  });

  const variants = row => JSON.stringify([row.shiny, row.form ?? null, row.shadow === 1,
    row.rarity ?? null, row.legendary ?? null]);
  const formOf = row => String(row.name ?? '').trim().toLowerCase();
  const specials = row => [row.aoe === 1, row.zMove === 1, row.mega === 1].join(',');
  const correctTime = value => Number.isSafeInteger(value) && value >= 1e12;
  const effective = rows => rows.length ?
    rows.reduce((sum, row) => sum + row.weight, 0) ** 2 / rows.reduce((sum, row) => sum + row.weight ** 2, 0) : 0;

  function unique(rows, get = row => row) {
    const sales = new Set(), specimens = new Set();
    return rows.filter(row => {
      const value = get(row);
      if (!value.pokemonId || sales.has(value.id) || specimens.has(value.pokemonId)) return false;
      sales.add(value.id);
      specimens.add(value.pokemonId);
      return true;
    });
  }

  function percentile(rows, fraction) {
    const sorted = [...rows].sort((a, b) => a.price - b.price);
    const threshold = sorted.reduce((sum, row) => sum + row.weight, 0) * fraction;
    let weight = 0;
    return sorted.find(row => (weight += row.weight) >= threshold)?.price ?? sorted.at(-1)?.price;
  }

  function trim(rows) {
    if (rows.length < 5) return rows;
    const logs = rows.map(row => ({ ...row, price: Math.log(row.price) }));
    const low = percentile(logs, .25), high = percentile(logs, .75);
    const spread = Math.max(Math.log(1.15), high - low) * 1.5;
    return rows.filter(row => Math.log(row.price) >= low - spread && Math.log(row.price) <= high + spread);
  }

  let familyCache, lastCatalog, lastCalibration;
  function families() {
    if (lastCatalog === globalThis.PI_ESPECIES && familyCache) return familyCache;
    lastCatalog = globalThis.PI_ESPECIES;
    const species = new Map((globalThis.PI_ESPECIES || []).map(entry => [entry.id, entry]));
    const edges = new Map([...species.keys()].map(id => [id, []]));
    for (const entry of species.values()) for (const child of entry.evo ?? []) {
      if (edges.has(child)) {
        edges.get(entry.id).push(child);
        edges.get(child).push(entry.id);
      }
    }
    const result = new Map();
    for (const entry of species.values()) {
      const name = entry.n.toLowerCase();
      if (result.has(name)) continue;
      const stack = [entry.id];
      while (stack.length) {
        const id = stack.pop(), member = species.get(id).n.toLowerCase();
        if (result.has(member)) continue;
        result.set(member, entry.id);
        stack.push(...edges.get(id));
      }
    }
    return familyCache = result;
  }

  // Pares independentes e semelhantes. Testa os fatores nas vendas mais recentes, fora do treino.
  function fit(pairs, pooled, ceiling = Math.log(5)) {
    const seen = new Set();
    const disjoint = [...pairs].sort((a, b) => a.distance - b.distance).filter(pair => {
      if (seen.has(pair.a.pokemonId) || seen.has(pair.b.pokemonId)) return false;
      seen.add(pair.a.pokemonId);
      seen.add(pair.b.pokemonId);
      return true;
    }).sort((a, b) => a.at - b.at);
    const validationSize = Math.max(OPTIONS.minValidationPairs, Math.ceil(disjoint.length / 4));
    const training = disjoint.slice(0, -validationSize), validation = disjoint.slice(-validationSize);
    const groups = new Map();
    for (const pair of training) {
      if (!groups.has(pair.a.speciesId)) groups.set(pair.a.speciesId, []);
      groups.get(pair.a.speciesId).push({ price: pair.y / pair.x, weight: 1 });
    }
    const result = { pares: disjoint.length, treino: training.length, validação: validation.length,
      espécies_no_treino: groups.size, valor: null };
    if (training.length < OPTIONS.minTrainingPairs || validation.length < OPTIONS.minValidationPairs ||
        (pooled && groups.size < OPTIONS.minTrainingSpecies)) return result;
    const coefficient = percentile([...groups.values()].map(rows => ({ price: percentile(rows, .5), weight: 1 })), .5);
    const errors = scale => percentile(validation.map(pair => ({ price: Math.abs(pair.y - scale * pair.x), weight: 1 })), .5);
    const before = errors(0), after = errors(coefficient);
    return { ...result, erro_sem_ajuste_log: before, erro_com_ajuste_log: after,
      valor: after < before && Math.abs(coefficient) <= ceiling ? coefficient : null };
  }

  function observedQueue(target, quote, listings, now) {
    return listings.filter(row => row.currency === target.currency && row.id !== target.id && !row.closed &&
      row.observedAt <= now && now - row.observedAt <= OPTIONS.listingFreshHours * HOUR &&
      (!row.expiresAt || row.expiresAt > now) && row.price <= quote.median)
      .sort((a, b) => b.observedAt - a.observedAt);
  }

  function hourlyLiquidity(sample, m, now, pages, stage) {
    const decay = soldAt => 2 ** (-(now - soldAt) / (OPTIONS.halfLife * HOUR));
    const lambda = sample.reduce((sum, row) => sum + decay(row.sale.soldAt), 0) / OPTIONS.liquidityHours;
    const hours = lambda > 0 ? (m + 1) / lambda : null;
    const lastSale = Math.max(...sample.map(row => row.sale.soldAt));
    const label = hours == null || now - lastSale > OPTIONS.inactiveHours * HOUR || hours > OPTIONS.mediumHours
      ? 'baixa' : hours <= OPTIONS.highHours ? 'alta' : 'média';
    return { stage, lambda, m, hours, label, count: sample.length, windowHours: OPTIONS.liquidityHours,
      pages, partial: true, lastSale };
  }

  function gemLiquidity(target, quote, sales, listings, pages, now) {
    const core = globalThis.PISMarketCore;
    if (target.currency !== 'orb' || ![0, 1].includes(target.shiny) || !target.name ||
        !(quote?.median > 0) || !Number.isInteger(target.power) || core.isOutland(target)) return null;
    function comparable(row) {
      const profile = core.coinProfile(target, row, false);
      return row.price > 0 && row.pokemonId && row.pokemonId !== target.pokemonId &&
        core.sameMarket(target, row) && specials(target) === specials(row) && profile?.samePower && profile.close;
    }

    // O snapshot público precifica, mas não identifica exemplares únicos para liquidez.
    const from = now - OPTIONS.liquidityHours * HOUR;
    const rows = sales.filter(row => correctTime(row.soldAt) && row.soldAt >= from && row.soldAt < now &&
      comparable(row) && !core.incompleteSaleFields(row, { requireSprite: false }).length)
      .sort((a, b) => b.soldAt - a.soldAt);
    const sample = trim(unique(rows).map(sale => ({ sale, price: sale.price,
      weight: 2 ** (-(now - sale.soldAt) / (OPTIONS.halfLife * HOUR)) })));
    if (sample.length < OPTIONS.liquidityMinimum) return null;
    const queue = unique(observedQueue(target, quote, listings, now).filter(comparable));
    return hourlyLiquidity(sample, queue.length, now, pages, 'gemas');
  }

  function prepare(allSales, now, options = OPTIONS) {
    const core = globalThis.PISMarketCore;
    // Cache local de metadados de perfis durante uma preparação. Não altera
    // janelas, pesos temporais, estatísticas nem a abrangência do histórico.
    const profiles = new WeakMap();
    function info(row) {
      let data = profiles.get(row);
      if (!data) {
        data = { name: formOf(row), variant: variants(row), extra: specials(row) };
        profiles.set(row, data);
      }
      return data;
    }
    const sales = allSales.filter(row => row.currency === 'gold' && !core.isOutland(row) &&
      correctTime(row.soldAt) && row.soldAt < now && !core.incompleteSaleFields(row, { requireSprite: false }).length);
    const bySpecies = new Map();
    const familyIds = families();
    const byFamily = new Map();
    for (const sale of sales) {
      const species = info(sale).name;
      if (!bySpecies.has(species)) bySpecies.set(species, []);
      bySpecies.get(species).push(sale);
      const family = familyIds.get(species);
      if (family == null) continue;
      if (!byFamily.has(family)) byFamily.set(family, []);
      byFamily.get(family).push(sale);
    }

    let models;
    function calibrate() {
      if (models) return models;
      const signature = JSON.stringify(sales.map(row => [row.id, row.pokemonId, row.speciesId, info(row).name, row.source,
        row.price, row.soldAt, row.level, row.grade, row.power, info(row).variant, info(row).extra, row.nature, row.natureId]));
      if (lastCalibration?.signature === signature && lastCalibration.familyIds === familyIds) return models = lastCalibration.models;
      const samples = new Map(), levelPairs = [], powerPairs = new Map(), familyPairs = new Map();
      function add(map, key, pair) {
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(pair);
      }
      function pair(a, b, x) {
        return { a, b, x, y: Math.log(b.price / a.price), at: Math.max(a.soldAt, b.soldAt),
          distance: Math.abs(Math.log(a.level / b.level)) + Math.abs(a.grade - b.grade) };
      }
      const compatible = (a, b) => info(a).variant === info(b).variant && info(a).extra === info(b).extra &&
        Math.abs(a.grade - b.grade) <= OPTIONS.calibrationGradeGap && a.pokemonId !== b.pokemonId && a.id !== b.id &&
        Math.abs(a.soldAt - b.soldAt) <= 14 * 24 * HOUR &&
        core.coinProfile(a, b, false, true) !== null;
      for (const [species, rows] of bySpecies) {
        const sample = unique(rows.filter(row => row.source === 'game').sort((a, b) => b.soldAt - a.soldAt))
          .slice(0, OPTIONS.maxCalibrationSalesPerSpecies);
        samples.set(species, sample);
        for (let i = 0; i < sample.length; i++) for (let j = i + 1; j < sample.length; j++) {
          let a = sample[i], b = sample[j];
          if (!compatible(a, b)) continue;
          let level = Math.log(b.level / a.level);
          if (a.power === b.power && Math.abs(level) >= OPTIONS.levelTrainingRange[0] &&
              Math.abs(level) <= OPTIONS.levelTrainingRange[1]) {
            if (level < 0) [a, b] = [b, a];
            level = Math.abs(level);
            levelPairs.push(pair(a, b, level));
          } else if (Math.abs(a.power - b.power) === 1 && Math.abs(level) <= OPTIONS.pairedLevelLog) {
            if (a.power > b.power) [a, b] = [b, a];
            add(powerPairs, a.power, pair(a, b, 1));
          }
        }
      }
      for (const family of byFamily.values()) {
        const names = [...new Set(family.map(formOf))].sort();
        for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
          for (const a of samples.get(names[i])) for (const b of samples.get(names[j])) {
            if (a.power === b.power && Math.abs(Math.log(a.level / b.level)) <= OPTIONS.pairedLevelLog && compatible(a, b))
              add(familyPairs, relation(names[i], names[j], a), pair(a, b, 1));
          }
        }
      }
      const powers = Object.fromEntries([1, 2, 3, 4].map(p => [p, fit(powerPairs.get(p) ?? [], true)]));
      const level = fit(levelPairs, true, 4);
      if (!(level.valor > 0)) level.valor = null;
      const lineage = new Map([...familyPairs].map(([key, pairs]) => [key, fit(pairs, false)]));
      models = { level, powers, lineage };
      lastCalibration = { signature, familyIds, models };
      return models;
    }

    function relation(a, b, row) {
      return JSON.stringify([a, b, info(row).variant, row.power, info(row).extra]);
    }

    // A mesma seleção é usada para estimar preços e identificar vendas/anúncios da fila.
    function segment(target, stage, rows, window = Infinity, isListing = false) {
      const species = formOf(target), family = familyIds.get(species);
      if (stage === 'base') return rows.filter(row => core.sameMarket(target, row) && row.pokemonId !== target.pokemonId);
      const gradeLimit = typeof stage === 'number' ? OPTIONS.relaxedGrade : OPTIONS.normalGrade;
      const levelLimit = stage === 3 ? OPTIONS.curveLevelLog : OPTIONS.normalLevelLog;
      const found = [];
      const calibration = typeof stage === 'number' && stage > 1 ? calibrate() : null;
      if (stage === 3 && calibration.level.valor == null) return [];
      for (const row of rows) {
        const distance = Math.log(target.level / row.level);
        const grade = Math.abs(target.grade - row.grade);
        const sameSpecies = info(row).name === species && row.speciesId === target.speciesId;
        if (row.currency !== 'gold' || !row.pokemonId || row.pokemonId === target.pokemonId || row.price <= 0 ||
            core.isOutland(row) || info(row).variant !== info(target).variant ||
            !Number.isFinite(distance) || Math.abs(distance) > levelLimit || !Number.isFinite(grade) || grade > gradeLimit ||
            !isListing && (row.soldAt < now - window * HOUR || row.soldAt >= now)) continue;
        const profile = core.coinProfile(target, row, false, stage >= 2);
        if (!profile || profile.extraPremium) continue;
        let powerFactor = 1, levelFactor = 1, speciesFactor = 1;
        if (stage === 4) {
          if (sameSpecies || family == null || familyIds.get(info(row).name) !== family || !profile.samePower) continue;
          const names = [species, info(row).name].sort();
          const coefficient = calibration.lineage.get(relation(...names, target))?.valor;
          if (coefficient == null) continue;
          speciesFactor = Math.exp(info(row).name === names[0] ? coefficient : -coefficient);
        } else {
          if (!sameSpecies) continue;
          if (!profile.samePower) {
            if (stage === 'bepi' && profile.neighbor) powerFactor = 1;
            else if ((stage === 2 || stage === 3) && Math.abs(row.power - target.power) === 1) {
              const coefficient = calibration.powers[Math.min(row.power, target.power)]?.valor;
              if (coefficient == null) continue;
              powerFactor = Math.exp(coefficient * Math.sign(target.power - row.power));
            } else continue;
          }
          if (stage === 3) levelFactor = Math.exp(calibration.level.valor * distance);
        }
        const downgraded = !profile.samePower && stage !== 4;
        const price = row.price * powerFactor * levelFactor * speciesFactor;
        if (!(price > 0 && price <= Number.MAX_SAFE_INTEGER)) continue;
        const noteScale = typeof stage === 'number' ? .35 : .24;
        const similarity = profile.weight * Math.exp(-.5 * (grade / noteScale) ** 2) * (downgraded ? .35 : 1);
        const time = isListing ? 1 : 2 ** (-(now - row.soldAt) / (OPTIONS.halfLife * HOUR));
        found.push({ sale: row, price, weight: similarity * time, powerFactor, levelFactor, speciesFactor });
      }
      return unique(found.sort((a, b) => b.weight - a.weight || (b.sale.soldAt ?? 0) - (a.sale.soldAt ?? 0)), row => row.sale);
    }

    function pool(target, stage) {
      return stage === 4 ? byFamily.get(familyIds.get(formOf(target))) ?? [] : bySpecies.get(formOf(target)) ?? [];
    }

    function coverage(target, rows) {
      const min = rows.length ? Math.min(...rows.map(row => row.sale.level)) : null;
      const max = rows.length ? Math.max(...rows.map(row => row.sale.level)) : null;
      return { min, max, covered: rows.length > 0 &&
        Math.log(min / target.level) <= OPTIONS.extrapolationLog &&
        Math.log(target.level / max) <= OPTIONS.extrapolationLog };
    }

    function summarize(rows) {
      return rows.map(({ sale, price, weight, levelFactor = 1, powerFactor = 1, speciesFactor = 1 }) => ({
        venda: sale.id, exemplar: sale.pokemonId, espécie: sale.name, vendido_em: new Date(sale.soldAt).toISOString(),
        nível: sale.level, potência: sale.power, nota: sale.grade, preço_pago: sale.price,
        preço_ajustado: Math.round(price), peso: weight, fator_nível: levelFactor, fator_potência: powerFactor, fator_espécie: speciesFactor,
      }));
    }

    const stages = [1, 2, 3, 4];
    const ready = target => target.currency === 'gold' && !core.isOutland(target) &&
      [0, 1].includes(target.shiny) && target.name && Number.isFinite(target.grade) && target.level > 0 &&
      Number.isInteger(target.power) && target.power >= 1 && target.power <= 5;

    function estimate(target, debug = null) {
      if (core.isOutland(target)) return { status: 'excluded_outland' };
      if (!ready(target)) return { status: 'insufficient_sales' };
      const rows = segment(target, 'base', pool(target, 'normal'));
      const inspect = debug && !debug.summaryOnly ? (stage, retained, scale, quote) => debug.tentativas.push({
        nível: stage, escala_nota: scale, nível_alvo: target.level, níveis_das_vendas: coverage(target, retained),
        vendas_efetivas: effective(retained), vendas: summarize(retained), estimativa: quote ?? null,
      }) : undefined;
      const old = core.estimateCoins(target, rows, now, { inspect });
      const original = old.alertSupported ? old.bepi ? 'bepi' : 'normal' : 'indicativa';
      if (debug) debug.base = { ...old, nível: original };
      if (old.alertSupported) return { ...old, segmentStage: original };
      const narrow = segment(target, 'normal', rows, 30 * 24);
      const reviewed = narrow.length >= 3 && coverage(target, narrow).covered
        ? core.estimateCoins(target, narrow.map(row => row.sale), now) : null;
      const prior = reviewed?.status === 'estimated' ? reviewed : null;
      for (const stage of stages) {
        for (const window of options.windows) {
          const sample = trim(segment(target, stage, pool(target, stage), window));
          const band = coverage(target, sample), n = effective(sample);
          const converted = stage === 2 ? sample.some(row => row.sale.power !== target.power) :
            stage === 3 ? sample.some(row => Math.abs(Math.log(row.sale.level / target.level)) > OPTIONS.normalLevelLog) : true;
          const eligible = converted && sample.length >= OPTIONS.minimum[stage] &&
            n >= (stage === 4 ? 4 : OPTIONS.minEffective) && band.covered;
          const trace = debug && !debug.summaryOnly && { nível: stage, janela_h: Number.isFinite(window) ? window : 'todo o histórico',
            nível_alvo: target.level, níveis_das_vendas: band, vendas_efetivas: n, vendas: summarize(sample),
            motivo: eligible ? 'estimado' : !band.covered && sample.length ? 'fora_da_faixa_de_níveis' :
              stage === 3 && calibrate().level.valor == null ? 'sem_curva_validada' :
              stage === 2 && !converted ? 'sem_potência_convertida' : 'comparáveis_insuficientes' };
          if (trace) debug.tentativas.push(trace);
          if (!eligible) continue;
          const lower = percentile(sample, .25), upper = percentile(sample, .75);
          const middle = percentile(sample, stage === 1 ? .5 : OPTIONS.fallbackPercentile);
          const spread = (upper - lower) / percentile(sample, .5);
          const confidence = spread > .8 ? 'baixa' : n >= 8 && spread <= .4 ? 'alta' : 'média';
          const w = prior ? n / (n + OPTIONS.smoothingK) : 1;
          const mix = (value, previous) => Math.round(w * value + (1 - w) * (previous ?? value));
          const median = mix(middle, prior?.median);
          const result = { status: 'estimated', method: 'coins_fallback', segmentStage: stage, fallbackLevel: stage,
            count: sample.length, effectiveCount: n, lower: mix(lower, prior?.lower), median,
            upper: mix(upper, prior?.upper), confidence, discount: 1 - target.price / median,
            alertSupported: false,
            dispersion: spread };
          if (trace) Object.assign(trace, { w, estimativa: result, sem_suavização: { lower, median: middle, upper },
            nível_anterior_sem_suporte: !prior });
          return result;
        }
      }
      return prior ? { ...prior, alertSupported: false, segmentStage: 'indicativa' } :
        { status: 'insufficient_sales', count: old.count, effectiveCount: old.effectiveCount, alertReason: old.alertReason };
    }

    function liquidity(target, quote, listings, pages, debug = false) {
      if (!ready(target) || !(quote?.median > 0)) return null;
      const start = quote.segmentStage === 'indicativa' || quote.segmentStage == null ? 'normal' : quote.segmentStage;
      const candidates = typeof start === 'number' ? stages.filter(stage => stage >= start) :
        [start, ...stages];
      for (const stage of candidates) {
        const sample = trim(segment(target, stage, pool(target, stage), OPTIONS.liquidityHours));
        const band = coverage(target, sample);
        if (sample.length < OPTIONS.liquidityMinimum || !band.covered) continue;
        const active = observedQueue(target, quote, listings, now);
        const queue = segment(target, stage, active, Infinity, true);
        return { ...hourlyLiquidity(sample, queue.length, now, pages, stage),
          ...(debug && { vendas: summarize(sample), níveis: band }) };
      }
      return null;
    }

    function calibrationReport() {
      const data = calibrate();
      return { vendas_completas: sales.length, sem_horário_válido: allSales.filter(row => row.currency === 'gold' &&
        !core.isOutland(row) && !correctTime(row.soldAt)).length,
        horários_exatamente_meia_noite_utc: sales.filter(row => row.soldAt % (24 * HOUR) === 0).length,
        nível: { ...data.level, fator_para_20_pct: data.level.valor == null ? null : 1.2 ** data.level.valor },
        potência: Object.fromEntries(Object.entries(data.powers).map(([key, value]) =>
          [key + '→' + (Number(key) + 1), { ...value, fator: value.valor == null ? null : Math.exp(value.valor) }])),
        linha_evolutiva: { pares_de_espécies: data.lineage.size,
          fatores_validados: [...data.lineage.values()].filter(value => value.valor != null).length } };
    }

    return { estimate, liquidity, calibrationReport };
  }

  const api = { OPTIONS, prepare, gemLiquidity };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else globalThis.PISCoinMarket = api;
})();
