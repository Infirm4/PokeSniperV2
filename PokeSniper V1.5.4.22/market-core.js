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

  const asNonnegative = value => {
    const parsed = number(value);
    return parsed != null && parsed >= 0 ? parsed : null;
  };
  const statAliases = {
    hp: ['hp', 'HP', 'ivHp', 'ivHP', 'iv_hp'],
    attack: ['attack', 'atk', 'ivAttack', 'ivAtk', 'iv_atk'],
    defense: ['defense', 'def', 'ivDefense', 'ivDef', 'iv_def'],
    specialAttack: ['specialAttack', 'spAttack', 'spAtk', 'spatk', 'spa', 'ivSpAtk', 'iv_spa'],
    specialDefense: ['specialDefense', 'spDefense', 'spDef', 'spdef', 'ivSpDef', 'iv_spdef'],
    speed: ['speed', 'spe', 'velocidade', 'ivSpeed', 'ivSpe', 'iv_speed', 'iv_spe'],
  };
  const label = value => typeof value === 'string' && value.trim()
    ? value.trim().slice(0, 80).toLowerCase() : id(value);
  const timestamp = value => positiveInteger(value) && Number(value) >= 1e12 ? Number(value) : null;

  function attributes(ficha) {
    const source = ficha.ivs && typeof ficha.ivs === 'object' && !Array.isArray(ficha.ivs) ? ficha.ivs : {};
    const ivs = Object.fromEntries(Object.entries(statAliases).map(([stat, aliases]) => [
      stat, asNonnegative(aliases.map(key => source[key]).find(value => value != null)
        ?? aliases.filter(key => key.startsWith('iv')).map(key => ficha[key]).find(value => value != null)),
    ]));
    const parts = Object.values(ivs);
    const power = /^p?([1-5])$/i.exec(String(ficha.potencia ?? '').trim());
    return {
      form: label(ficha.formId ?? ficha.formaId ?? ficha.forma),
      power: power ? Number(power[1]) : null,
      quality: asNonnegative(ficha.quality ?? ficha.qualidade),
      ivTotal: parts.every(value => value != null)
        ? parts.reduce((total, value) => total + value, 0)
        : asNonnegative(ficha.ivTotal ?? ficha.ivSoma),
      ivs,
      aoe: shiny(ficha.tmAoe),
      zMove: shiny(ficha.tmElemental) ??
        (typeof ficha.tmElemental === 'string' && /^(normal|fire|water|electric|grass|ice|fighting|poison|ground|flying|psychic|bug|rock|ghost|dragon|dark|steel|fairy)$/i.test(ficha.tmElemental.trim()) ? 1 : null),
      mega: shiny(ficha.mega),
    };
  }

  const outlandPrefix = /^(?:trickmaster|trickamaster|enraged|enrage|furious|brave|outlaw|outland)\s+\S/i;

  function isOutland(row) {
    const ficha = row?.ficha;
    const explicit = [row?.outland, row?.outlaw, row?.isOutland, ficha?.outland, ficha?.outlaw, ficha?.isOutland];
    if (explicit.some(value => shiny(value) === 1)) return true;
    // #2001+ se refere à Pokédex do jogo. speciesId é um identificador interno.
    const dex = number(ficha?.dex ?? ficha?.dexId ?? ficha?.numeroNacional ?? row?.dex);
    if (Number.isSafeInteger(dex) && dex >= 2001) return true;
    const name = ficha?.nome ?? row?.name ?? row?.nome;
    return typeof name === 'string' &&
      outlandPrefix.test(name.trim().replace(/^✨\s*/u, '').replace(/^shiny\s+/i, ''));
  }

  function safeSprite(value) {
    if (typeof value !== 'string' || !value.trim() || value.length > 1000) return null;
    if (!/^(https:\/\/|\/(?!\/))/.test(value)) return null;
    try {
      const url = new URL(value, 'https://pokeidle.io/');
      if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
      if (/(^|\.)pokeidle\.io$/i.test(url.hostname)) return url.href;
      if (url.hostname === 'raw.githubusercontent.com' &&
          /^\/PokeAPI\/sprites\/master\/sprites\/pokemon\/(?:shiny\/)?\d+\.png$/.test(url.pathname) &&
          !url.search && !url.hash) return url.href;
    } catch { /* Sprite inválida. */ }
    return null;
  }

  function listingSprite(row, isShiny) {
    const ficha = row.ficha || {};
    for (const source of [ficha, row]) {
      for (const key of ['sprite', 'icone', 'icon', 'imagem', 'img', 'url']) {
        const sprite = safeSprite(source[key]);
        if (sprite) return { sprite, spriteSource: row.spriteSource === 'dex' ? 'dex' : 'market' };
      }
    }
    // O looktype só serve de fallback quando o sufixo confirma o número da Pokédex.
    const look = Number(ficha.looktype ?? row.looktype);
    const internalId = Number(ficha.speciesId ?? ficha.especieId);
    const explicit = Number(ficha.dex ?? ficha.dexId ?? ficha.numeroNacional ?? row.dex);
    const number = Number.isInteger(explicit) && explicit >= 1 && explicit <= 1025 ? explicit :
      Number.isInteger(look) && look >= 60001 && look <= 61025 && internalId % 1000 === look % 1000 ? look - 60000 : null;
    if (!number || isShiny == null) return { sprite: null, spriteSource: null };
    return { sprite: `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${isShiny ? 'shiny/' : ''}${number}.png`, spriteSource: 'dex' };
  }

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
      outland: isOutland(row) ? true : null,
      ...attributes(row.ficha),
    };
    if (sale) {
      const soldAt = timestamp(row.em);
      if (!soldAt) return null;
      return { ...profile, soldAt, listingId: id(row.listingId ?? row.anuncioId) };
    }
    const closed = ['cancelado', 'expirado'].includes(row.estado) ? row.estado : null;
    if ((!closed && row.estado != null && row.estado !== 'aberto') || row.comprador) return null;
    return { ...profile, ...listingSprite(row, profile.shiny), postedAt: timestamp(row.criadoEm), availableAt: timestamp(row.compravelEm), expiresAt: timestamp(row.expiraEm),
      ...(closed ? { closed } : {}) };
  }

  const historyReply = /"aba"\s*:\s*"historicoGlobal"/;
  const historyRequest = /"t"\s*:\s*"market\.historicoGlobal"/;
  const linkageFields = ['listingId', 'anuncioId', 'idAnuncio', 'anuncio_id', 'listing_id', 'ofertaId', 'idOferta'];

  function historyTrace(frame) {
    const rows = Array.isArray(frame.linhas) ? frame.linhas : [];
    return {
      page: frame.pagina,
      rows: rows.length,
      pokemon: rows.filter(row => row?.tipo === 'pokemon').length,
      withProfile: rows.filter(row => row?.tipo === 'pokemon' && row.ficha && typeof row.ficha === 'object').length,
      more: frame.temMais,
      candidateFields: Object.fromEntries(linkageFields.map(key => [key,
        rows.filter(row => row?.tipo === 'pokemon' && id(row[key]) != null).length])),
    };
  }

  function capture(frame) {
    if (frame?.t !== 'market' || !Array.isArray(frame.linhas)) return null;
    const kind = frame.aba === 'vitrine' ? 'listing' : frame.aba === 'historicoGlobal' ? 'sale' : null;
    if (!kind) return null;
    const rows = frame.linhas.slice(0, MAX_BATCH)
      .map(row => normalizeRow(kind, row, frame.moeda)).filter(Boolean);
    return rows.length ? { kind, rows } : null;
  }

  function captureAutomatic(frame, request) {
    if (frame.aba !== 'vitrine' || frame.pagina == null || Number(frame.pagina) !== request.pagina ||
        (frame.moeda != null && frame.moeda !== request.moeda) || !money(request.moeda)) return null;
    // Nunca atribui a moeda solicitada quando o servidor identificou outra moeda na linha.
    return capture({ ...frame, moeda: request.moeda,
      linhas: frame.linhas.filter(row => row && (row.moeda == null || row.moeda === request.moeda)) });
  }

  // Revalida a mensagem no limite de privilégio e reconstrói somente os campos permitidos.
  function validate(kind, rows) {
    if (!['sale', 'listing'].includes(kind) || !Array.isArray(rows) ||
      rows.length === 0 || rows.length > MAX_BATCH) return [];
    return rows.map(row => row && normalizeRow(kind, {
      tipo: 'pokemon', id: row.id, pokemonId: row.pokemonId, moeda: row.currency, outland: row.outland,
      preco: row.price, bruto: row.price, em: row.soldAt, listingId: row.listingId,
      sprite: row.sprite, spriteSource: row.spriteSource, criadoEm: row.postedAt, compravelEm: row.availableAt, expiraEm: row.expiresAt, estado: row.closed,
      ficha: { speciesId: row.speciesId, nome: row.name, shiny: row.shiny, level: row.level, nota: row.grade,
        formId: row.form, potencia: row.power, quality: row.quality, ivTotal: row.ivTotal, ivs: row.ivs,
        tmAoe: row.aoe, tmElemental: row.zMove, mega: row.mega },
    })).filter(Boolean);
  }

  const sameMarket = (a, b) => !isOutland(a) && !isOutland(b) && a.currency === b.currency && a.speciesId === b.speciesId &&
    a.shiny === b.shiny && (a.form ?? null) === (b.form ?? null);

  // A ficha ausente não prova incompatibilidade, mas também não comprova um especial.
  function compatibleProfile(target, sale) {
    if (target.power != null && sale.power != null && target.power !== sale.power) return false;
    if (target.quality != null && sale.quality != null &&
        Math.abs(target.quality - sale.quality) > Math.max(0.01, Math.max(target.quality, sale.quality) * 0.20)) return false;
    return ['aoe', 'zMove', 'mega'].every(flag =>
      (target[flag] === 1 || sale[flag] === 1) ? target[flag] === sale[flag] : true);
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
    if (isOutland(target)) return { status: 'excluded_outland' };
    if (target.shiny == null || !(target.level > 0) || target.grade == null) {
      return { status: 'incomplete_profile' };
    }
    const comparable = sales.filter(sale =>
      sameMarket(target, sale) && compatibleProfile(target, sale) && sale.soldAt >= now - WINDOW_MS && sale.soldAt < now &&
      sale.price > 0 && sale.level > 0 && sale.grade != null)
      .map(sale => {
        const recency = 2 ** (-(now - sale.soldAt) / (10 * DAY));
        const distance = Math.abs(sale.grade - target.grade) / 0.5 +
          Math.abs(Math.log(sale.level / target.level)) / 0.5;
        return { sale, price: sale.price, weight: recency * Math.exp(-distance) };
      }).filter(sale => sale.weight >= 0.01).sort((a, b) => a.price - b.price);
    // Revendas do mesmo exemplar somam no máximo o peso de uma venda recente.
    const byPokemon = new Map();
    for (const { sale, weight } of comparable) {
      if (sale.pokemonId) byPokemon.set(sale.pokemonId, (byPokemon.get(sale.pokemonId) || 0) + weight);
    }
    for (const row of comparable) row.weight /= Math.max(1, byPokemon.get(row.sale.pokemonId) || 0);
    const entityWeights = new Map();
    for (const { sale, weight } of comparable) {
      const entity = sale.pokemonId ? 'pokemon:' + sale.pokemonId : 'sale:' + sale.id;
      entityWeights.set(entity, (entityWeights.get(entity) || 0) + weight);
    }
    const count = comparable.length;
    const independentCount = entityWeights.size;
    if (independentCount < 5) return { status: 'insufficient_sales', count, independentCount };
    const weight = comparable.reduce((sum, sale) => sum + sale.weight, 0);
    const effectiveCount = weight ** 2 / [...entityWeights.values()].reduce((sum, value) => sum + value ** 2, 0);
    if (effectiveCount < 4) return { status: 'insufficient_sales', count, independentCount, effectiveCount };
    const lower = quantile(comparable, weight, 0.25);
    const median = quantile(comparable, weight, 0.5);
    const upper = quantile(comparable, weight, 0.75);
    return { status: 'estimated', count, independentCount, effectiveCount, lower, median, upper,
      discount: 1 - target.price / median, method: 'baseline',
      comparables: [...comparable].sort((a, b) => b.weight - a.weight).slice(0, 5).map(({ sale }) => ({
        id: sale.id, price: sale.price, soldAt: sale.soldAt, grade: sale.grade, level: sale.level,
        power: sale.power, speed: sale.ivs?.speed,
      })) };
  }

  const core = { capture, captureAutomatic, validate, estimate, sameMarket, isOutland, safeSprite, historyReply, historyRequest, historyTrace, linkageFields,
    WINDOW_MS, MAX_BATCH };
  if (typeof module === 'object' && module.exports) module.exports = core;
  else globalThis.PISMarketCore = core;
})();
