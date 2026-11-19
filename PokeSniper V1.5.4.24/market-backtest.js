// Validação cronológica, usando vendas locais e sem enviar registros pela rede.
(() => {
  const DAY = 86400000;
  const median = values => {
    const sorted = [...values].sort((a, b) => a - b);
    const center = Math.floor(sorted.length / 2);
    return sorted.length ? (sorted[center] + sorted[Math.floor((sorted.length - 1) / 2)]) / 2 : null;
  };

  async function run(sales, config, now = Date.now()) {
    const cut = now - 7 * DAY;
    const rows = sales.filter(row => !PISMarketCore.isOutland(row) && row.price > 0 &&
      row.soldAt >= now - 30 * DAY && row.soldAt < now);
    const byCurrency = {};
    for (const currency of ['gold', 'orb']) {
      const held = rows.filter(row => row.currency === currency && row.soldAt >= cut)
        .sort((a, b) => a.soldAt - b.soldAt);
      const step = Math.max(1, Math.ceil(held.length / 250));
      const sample = held.filter((_, index) => index % step === 0);
      const heldIds = new Set(sample.map(row => row.pokemonId).filter(Boolean));
      const training = rows.filter(row => row.currency === currency && row.soldAt < cut && !heldIds.has(row.pokemonId));
      const market = PISPricingModel.makeMarket(training, cut, PISMarketCore.isOutland);
      const estimate = PISPricingModel.prepare(training, PISMarketCore.estimate, cut, market);
      const grouped = new Map();
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
        const price = estimate(row);
        if (price.status !== 'estimated') { unavailable++; continue; }
        const error = Math.abs(price.median / row.price - 1);
        const covered = price.lower <= row.price && row.price <= price.upper;
        let signals = 0, falseSignals = 0;
        // Preços pedidos simulados para a mesma venda conhecida. O preço pago é o referencial observado.
        for (const factor of [0.7, 0.85, 1, 1.15]) {
          const asking = Math.max(1, Math.round(row.price * factor));
          const scenario = { ...row, price: asking, estimate: price };
          if (PISOpportunities.notificationEligible(scenario) &&
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
        treino: training.length, vendas_na_janela_de_teste: held.length, amostra: sample.length, sem_estimativa: unavailable,
        grupos: Object.fromEntries([...grouped].map(([key, group]) => [key, {
          avaliadas: group.errors.length,
          erro_absoluto_mediano_pct: Math.round(median(group.errors) * 1000) / 10,
          cobertura_da_faixa_pct: Math.round(1000 * group.covered / group.errors.length) / 10,
          alertas_simulados: group.signals, falsos_alertas_simulados: group.falseSignals,
        }])),
      };
    }
    return { fonte: 'Vendas locais. Gemas públicas não entram neste teste.', treino_antes_de: new Date(cut).toISOString(),
      desconto_mínimo_pct: config.discount, moedas: byCurrency };
  }

  globalThis.PISMarketBacktest = { run };
})();
