// Funções puras compartilhadas pelo capturador e pelo service worker.
(() => {
  const DAY = 86400000;
  const WINDOW_MS = 30 * DAY;
  const MAX_BATCH = 100;
  const id = value => (typeof value === 'string' || Number.isSafeInteger(value)) &&
    /^[A-Za-z0-9_-]{1,64}$/.test(String(value)) ? String(value) : null;
  const money = value => value === 'gold' || value === 'orb' ? value : null;
  const number = value => (typeof value === 'number' ||
    (typeof value === 'string' && value.trim() !== '')) && Number.isFinite(Number(value))
    ? Number(value) : null;
  const positiveInteger = value => Number.isSafeInteger(number(value)) && number(value) > 0;
  const shiny = value => value === true || value === 1 || value === '1' || value === 'true' ? 1 :
    value === false || value === 0 || value === '0' || value === 'false' ? 0 : null;

  // Conserva a identidade do anúncio e a da venda em campos e stores distintos.
  // Dados ausentes permanecem nulos. Preço unitário só é comparável para um exemplar.
  function normalizeRow(kind, row, currency) {
    if (!row || (row.tipo != null && row.tipo !== 'pokemon') || !row.ficha) return null;
    const sale = kind === 'sale';
    if (sale && row.tipo !== 'pokemon') return null;
    const recordId = id(row.id);
    const speciesId = id(row.ficha.speciesId ?? row.ficha.especieId);
    const denomination = money(row.moeda ?? currency);
    const price = sale ? row.bruto : row.preco;
    if (!recordId || !speciesId || !denomination || !positiveInteger(price) ||
      (row.qtd != null && number(row.qtd) !== 1)) return null;
    const profile = {
      id: recordId,
      pokemonId: id(row.pokemonId),
      speciesId,
      name: typeof row.ficha.nome === 'string' ? row.ficha.nome.trim().slice(0, 100) : null,
      currency: denomination,
      shiny: shiny(row.ficha.shiny),
      level: number(row.ficha.level ?? row.ficha.nivel),
      grade: number(row.ficha.nota),
      price: Number(price),
    };
    if (sale) {
      if (!positiveInteger(row.em) || Number(row.em) < 1e12) return null;
      return { ...profile, soldAt: Number(row.em) };
    }
    if ((row.estado != null && row.estado !== 'aberto') || row.comprador) return null;
    return profile;
  }

  function capture(frame) {
    if (frame?.t !== 'market' || !Array.isArray(frame.linhas)) return null;
    const kind = frame.aba === 'vitrine' ? 'listing' : frame.aba === 'historicoGlobal' ? 'sale' : null;
    if (!kind) return null;
    const rows = frame.linhas.slice(0, MAX_BATCH)
      .map(row => normalizeRow(kind, row, frame.moeda)).filter(Boolean);
    return rows.length ? { kind, rows } : null;
  }

  // Revalida a mensagem no limite de privilégio e reconstrói somente os campos permitidos.
  function validate(kind, rows) {
    if (!['sale', 'listing'].includes(kind) || !Array.isArray(rows) ||
      rows.length === 0 || rows.length > MAX_BATCH) return [];
    return rows.map(row => row && normalizeRow(kind, {
      tipo: 'pokemon', id: row.id, pokemonId: row.pokemonId, moeda: row.currency,
      preco: row.price, bruto: row.price, em: row.soldAt,
      ficha: { speciesId: row.speciesId, nome: row.name, shiny: row.shiny, level: row.level, nota: row.grade },
    })).filter(Boolean);
  }

  function quantile(sorted, total, fraction) {
    let cumulative = 0;
    for (const { price, weight } of sorted) {
      cumulative += weight;
      if (cumulative >= total * fraction) return price;
    }
    return sorted.at(-1).price;
  }

  // Baseline conservadora: mesma espécie, moeda e Shiny, com meia-vida de 10 dias.
  // Nota e nível só participam quando presentes dos dois lados. As escalas são
  // parâmetros iniciais para backtest e a faixa descreve os comparáveis observados.
  function estimate(target, sales, now) {
    if (target.shiny == null || !(target.level > 0) || target.grade == null) {
      return { status: 'incomplete_profile' };
    }
    const comparable = sales.filter(sale =>
      sale.currency === target.currency && sale.speciesId === target.speciesId &&
      sale.shiny === target.shiny && sale.soldAt >= now - WINDOW_MS && sale.soldAt < now &&
      sale.price > 0 && sale.level > 0 && sale.grade != null)
      .map(sale => {
        const recency = 2 ** (-(now - sale.soldAt) / (10 * DAY));
        const distance = Math.abs(sale.grade - target.grade) / 0.5 +
          Math.abs(Math.log(sale.level / target.level)) / 0.5;
        return { price: sale.price, weight: recency * Math.exp(-distance) };
      }).filter(sale => sale.weight >= 0.01).sort((a, b) => a.price - b.price);
    const count = comparable.length;
    if (count < 5) return { status: 'insufficient_sales', count };
    const weight = comparable.reduce((sum, sale) => sum + sale.weight, 0);
    const effectiveCount = weight ** 2 / comparable.reduce((sum, sale) => sum + sale.weight ** 2, 0);
    if (effectiveCount < 4) return { status: 'insufficient_sales', count, effectiveCount };
    const lower = quantile(comparable, weight, 0.25);
    const median = quantile(comparable, weight, 0.5);
    const upper = quantile(comparable, weight, 0.75);
    return { status: 'estimated', count, effectiveCount, lower, median, upper,
      discount: 1 - target.price / median };
  }

  const core = { capture, validate, estimate, WINDOW_MS, MAX_BATCH };
  if (typeof module === 'object' && module.exports) module.exports = core;
  else globalThis.PISMarketCore = core;
})();
