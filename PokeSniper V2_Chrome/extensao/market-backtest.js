// Validação cronológica, usando vendas locais e sem enviar registros pela rede.
(() => {
  const DAY = 86400000;
  const median = values => {
    const sorted = [...values].sort((a, b) => a - b);
    const center = Math.floor(sorted.length / 2);
    return sorted.length ? (sorted[center] + sorted[Math.floor((sorted.length - 1) / 2)]) / 2 : null;
  };

  async function run(sales, config, now = Date.now()) {
    const standardCut = now - 7 * DAY;
    const rows = sales.filter(row => !PISMarketCore.isOutland(row) && row.price > 0 &&
      row.soldAt >= now - 30 * DAY && row.soldAt < now);
    const byCurrency = {};
    const coinVariants = [
      ['adaptativa', {}], ...[0.08, 0.12, 0.16, 0.24].map(scale => ['nota_' + scale, { scales: [scale] }]),
      ['adaptativa_com_qualidade', { qualityWeight: true }],
    ];
    const comparison = new Map(coinVariants.map(([key]) => [key,
      { errors: [], covered: 0, cases: 0, alerts: 0, falseAlerts: 0, strongAlerts: 0, strongFalse: 0, bepi: 0, bepiFalse: 0 }]));
    const factors = [0.7, 0.85, 1, 1.15];
    const discountCap = reference => reference * (1 - config.discount / 100);
    for (const currency of ['gold', 'orb']) {
      const trades = rows.filter(row => row.currency === currency).sort((a, b) => a.soldAt - b.soldAt);
      const trainingCount = trades.filter(row => row.soldAt < standardCut).length;
      const adaptive = trades.length > 1 && (trainingCount < 10 || trainingCount === trades.length);
      const cut = adaptive ? trades[Math.floor(trades.length * .75)].soldAt : standardCut;
      const held = trades.filter(row => row.soldAt >= cut);
      const step = Math.max(1, Math.ceil(held.length / 250));
      const sample = held.filter((_, index) => index % step === 0);
      const heldIds = new Set(sample.map(row => row.pokemonId).filter(Boolean));
      const training = trades.filter(row => row.soldAt < cut && !heldIds.has(row.pokemonId));
      const market = PISPricingModel.makeMarket(training, cut, PISMarketCore.isOutland);
      const estimate = PISPricingModel.prepare(training, PISMarketCore.estimate, cut, market);
      const grouped = new Map();
      const bySpecies = new Map();
      if (currency === 'gold') {
        for (const sale of training) {
          if (!bySpecies.has(sale.speciesId)) bySpecies.set(sale.speciesId, []);
          bySpecies.get(sale.speciesId).push(sale);
        }
      }
      function record(key, error, covered, signaled, falseSignals) {
        if (!grouped.has(key)) grouped.set(key, { errors: [], covered: 0, signals: 0, falseSignals: 0 });
        const group = grouped.get(key);
        group.errors.push(error);
        group.covered += Number(covered);
        group.signals += signaled;
        group.falseSignals += falseSignals;
      }
      let unavailable = 0;
      for (const [index, row] of sample.entries()) {
        if (index % 20 === 0) await new Promise(resolve => setTimeout(resolve, 0));
        if (currency === 'gold' && row.shiny != null && row.level > 0 && row.grade != null) {
          const history = bySpecies.get(row.speciesId) ?? [];
          for (const [key, options] of coinVariants) {
            const metrics = comparison.get(key);
            metrics.cases++;
            const quote = PISMarketCore.estimateCoins(row, history, cut, options);
            if (quote.status !== 'estimated') continue;
            metrics.errors.push(Math.abs(quote.median / row.price - 1));
            if (quote.lower <= row.price && row.price <= quote.upper) metrics.covered++;
            for (const factor of factors) {
              const asking = Math.max(1, Math.round(row.price * factor));
              const scenario = { ...row, price: asking, estimate: quote };
              if (asking > discountCap(quote.median)) continue;
              const falseSignal = asking > discountCap(row.price);
              if (quote.bepi) {
                if (PISOpportunities.notificationEligible(scenario, config)) {
                  metrics.bepi++;
                  metrics.bepiFalse += Number(asking > row.price * Math.max(0, 95 - config.discount) / 100);
                }
                continue;
              }
              if (!PISOpportunities.notificationEligible(scenario, config)) continue;
              metrics.alerts++;
              metrics.falseAlerts += Number(falseSignal);
              if (asking <= quote.lower) {
                metrics.strongAlerts++;
                metrics.strongFalse += Number(falseSignal);
              }
            }
          }
        }
        const price = estimate(row);
        if (price.status !== 'estimated') { unavailable++; continue; }
        const error = Math.abs(price.median / row.price - 1);
        const covered = price.lower <= row.price && row.price <= price.upper;
        let signals = 0, falseSignals = 0;
        // Preços pedidos simulados para a mesma venda conhecida. O preço pago é o referencial observado.
        for (const factor of factors) {
          const asking = Math.max(1, Math.round(row.price * factor));
          const scenario = { ...row, price: asking, estimate: price };
          if (PISOpportunities.notificationEligible(scenario, config) &&
              asking <= PISOpportunities.priceLimit(scenario, { discount: config.discount })) {
            signals++;
            if (asking > row.price * (1 - config.discount / 100)) falseSignals++;
          }
        }
        record('total', error, covered, signals, falseSignals);
        record(['perfil', row.shiny ? 'shiny' : 'normal', row.power ?? '?', price.method].join('/'),
          error, covered, signals, falseSignals);
      }
      byCurrency[currency] = {
        treino_antes_de: new Date(cut).toISOString(),
        corte: adaptive ? 'janela disponível · separação cronológica' : 'últimos 7 dias para teste',
        estado: !sample.length || !training.length ? 'sem datas suficientes para separar treino e teste' :
          unavailable === sample.length ? 'sem comparáveis para a amostra' : 'avaliado',
        treino: training.length, vendas_na_janela_de_teste: held.length, amostra: sample.length, sem_estimativa: unavailable,
        grupos: Object.fromEntries([...grouped].map(([key, group]) => [key, {
          avaliadas: group.errors.length,
          erro_absoluto_mediano_pct: Math.round(median(group.errors) * 1000) / 10,
          cobertura_da_faixa_pct: Math.round(1000 * group.covered / group.errors.length) / 10,
          alertas_simulados: group.signals, falsos_alertas_simulados: group.falseSignals,
        }])),
      };
    }
    return { fonte: 'Vendas locais. Gemas públicas não entram neste teste.',
      desconto_mínimo_pct: config.discount, moedas: byCurrency,
      calibração_coins: Object.fromEntries([...comparison].map(([key, result]) => [key, {
        amostra: result.cases, avaliadas: result.errors.length,
        erro_absoluto_mediano_pct: result.errors.length ? Math.round(median(result.errors) * 1000) / 10 : null,
        dentro_da_faixa: result.covered, alertas_simulados: result.alerts,
        falsos_alertas_simulados: result.falseAlerts, alertas_fortes_simulados: result.strongAlerts,
        falsos_alertas_fortes_simulados: result.strongFalse, alertas_bepi_simulados: result.bepi,
        falsos_alertas_bepi_simulados: result.bepiFalse,
      }])) };
  }

  globalThis.PISMarketBacktest = { run };
})();
