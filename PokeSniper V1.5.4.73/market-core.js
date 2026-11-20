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

  function readStats(source, aliases) {
    const stats = {};
    for (const [stat, keys] of Object.entries(aliases)) {
      const value = asNonnegative(keys.map(key => source?.[key]).find(value => value != null));
      if (value != null) stats[stat] = value;
    }
    return Object.keys(stats).length ? stats : null;
  }

  function attributes(ficha) {
    const source = ficha.ivs && typeof ficha.ivs === 'object' && !Array.isArray(ficha.ivs) ? ficha.ivs : {};
    const ivs = Object.fromEntries(Object.entries(statAliases).map(([stat, aliases]) => [
      stat, asNonnegative(aliases.map(key => source[key]).find(value => value != null)
        ?? aliases.filter(key => key.startsWith('iv')).map(key => ficha[key]).find(value => value != null)),
    ]));
    const parts = Object.values(ivs);
    const power = /^p?([1-5])$/i.exec(String(ficha.potencia ?? ficha.power ?? '').trim());
    return {
      form: label(ficha.formId ?? ficha.formaId ?? ficha.forma),
      nature: label(ficha.natureza ?? ficha.nature),
      natureId: id(ficha.naturezaId ?? ficha.natureId),
      shadow: shiny(ficha.shadow ?? ficha.isShadow),
      rarity: label(ficha.rarity ?? ficha.raridade),
      legendary: shiny(ficha.legendary ?? ficha.lendario),
      stats: readStats(ficha.stats ?? ficha.atributos, statAliases),
      refinement: asNonnegative(ficha.refinoTotal ?? ficha.refinementTotal),
      battlePower: asNonnegative(ficha.poder ?? ficha.battlePower),
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

  // Nomes do catálogo de Outlaws do PokéIdle. IDs internos da vitrine não são números Dex.
  const outlandNames = new Set([
    "ancient dragonair", "ancient dragonite", "ancient granbull", "ancient hypno",
    "ancient marowak", "ancient meganium", "ancient pinsir", "ancient pupitar",
    "ancient xatu", "banshee misdreavus", "banshee mismagius", "brave aerodactyl",
    "brave alakazam", "brave arcanine", "brave blastoise", "brave charizard",
    "brave clefable", "brave mantine", "brave nidoking", "brave nidoqueen",
    "brave noctowl", "brave steelix", "brave tyranitar", "brave venusaur",
    "brute rhydon", "charged raichu", "dark crobat", "enigmatic girafarig",
    "enraged typhlosion", "evil cloyster", "freezing aurorus", "freezing dewgong",
    "furious ampharos", "furious gyarados", "furious magmar", "furious pidgeot",
    "furious sandslash", "furious scizor", "furious scyther", "furious skarmory",
    "furious whimsicott", "furious wigglytuff", "hard golem", "heavy piloswine",
    "magma magcargo", "magnetic electabuzz", "milch-miltank", "psy exeggutor",
    "psy jynx", "roll donphan", "taekwondo hitmonchan", "taekwondo hitmonlee",
    "taekwondo hitmontop", "toxic toxicroak", "tribal feraligatr", "trickmaster gengar",
    "war heracross", "war scrafty",
  ]);

  function isOutland(row) {
    const ficha = row?.ficha;
    const explicit = [row?.outland, row?.outlaw, row?.isOutland, ficha?.outland, ficha?.outlaw, ficha?.isOutland];
    if (explicit.some(value => shiny(value) === 1)) return true;
    // #2001+ se refere à Pokédex do jogo. speciesId é um identificador interno.
    const dex = number(ficha?.dex ?? ficha?.dexId ?? ficha?.numeroNacional ?? row?.dex);
    if (Number.isSafeInteger(dex) && dex >= 2001) return true;
    const name = ficha?.nome ?? ficha?.name ?? row?.name ?? row?.nome;
    if (typeof name !== 'string') return false;
    const clean = name.trim().replace(/^✨\s*/u, '').replace(/^shiny\s+/i, '');
    return outlandNames.has(clean.toLowerCase()) || outlandPrefix.test(clean);
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
    let market = null;
    for (const source of [ficha, row]) {
      market ??= ['sprite', 'icone', 'icon', 'imagem', 'img', 'url'].map(key => safeSprite(source[key])).find(Boolean) ?? null;
    }
    // O looktype só serve de fallback quando o sufixo confirma o número da Pokédex.
    const look = Number(ficha.looktype ?? row.looktype);
    const internalId = Number(ficha.speciesId ?? ficha.especieId);
    const explicit = Number(ficha.dex ?? ficha.dexId ?? ficha.numeroNacional ?? row.dex);
    const number = Number.isInteger(explicit) && explicit >= 1 && explicit <= 1025 ? explicit :
      Number.isInteger(look) && look >= 60001 && look <= 61025 && internalId % 1000 === look % 1000 ? look - 60000 : null;
    const variant = label(ficha.formId ?? ficha.formaId ?? ficha.forma);
    const namedVariant = /\b(?:mega|primal|alolan?|galarian?|hisuian?|paldean?|origin|therian)\b/i.test(ficha.nome ?? '');
    const baseForm = !namedVariant && (variant == null || ['0', 'base', 'normal', 'default'].includes(variant));
    const dex = number && isShiny != null && baseForm && shiny(ficha.mega) !== 1
      ? safeSprite(`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${isShiny ? 'shiny/' : ''}${number}.png`)
      : null;
    const existingFallback = baseForm && shiny(ficha.mega) !== 1 ? safeSprite(row.spriteFallback) : null;
    return { sprite: market ?? dex, spriteSource: market ? (row.spriteSource === 'dex' ? 'dex' : 'market') : dex ? 'dex' : null,
      spriteFallback: market && (dex ?? existingFallback) !== market ? dex ?? existingFallback : null };
  }

  // Conserva a identidade do anúncio e a da venda em campos e stores distintos.
  // Dados ausentes permanecem nulos. Preço unitário só é comparável para um exemplar.
  function normalizeRow(kind, row, currency) {
    if (!row || (row.tipo != null && row.tipo !== 'pokemon') || !row.ficha) return null;
    const sale = kind === 'sale';
    const recordId = id(row.id);
    const speciesId = id(row.ficha.speciesId ?? row.ficha.especieId);
    const denomination = money(row.moeda ?? currency);
    const price = sale ? row.bruto : row.preco;
    if (!recordId || !speciesId || !denomination || !positiveInteger(price) ||
      (row.qtd != null && number(row.qtd) !== 1)) return null;
    const rawName = row.ficha.nome ?? row.ficha.name;
    const profile = {
      id: recordId,
      pokemonId: id(row.pokemonId ?? row.ficha.id),
      speciesId,
      name: typeof rawName === 'string' ? rawName.trim().slice(0, 100) || null : null,
      currency: denomination,
      shiny: shiny(row.ficha.shiny),
      level: number(row.ficha.level ?? row.ficha.nivel),
      grade: number(row.ficha.nota ?? row.ficha.grade),
      price: Number(price),
      outland: isOutland(row) ? true : null,
      ...attributes(row.ficha),
    };
    if (sale) {
      const soldAt = timestamp(row.em);
      if (!soldAt) return null;
      return { ...profile, ...listingSprite(row, profile.shiny), source: 'game', soldAt, listingId: linkageFields.map(field => id(row[field])).find(Boolean) ?? null };
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

  function decodeGameFrame(text) {
    if (typeof text !== 'string' || !/"t"\s*:\s*"(estado|market|batalha|erro)"/.test(text)) return null;
    try {
      const frame = JSON.parse(text);
      return ['estado', 'market', 'batalha', 'erro'].includes(frame?.t) ? frame : null;
    } catch { return null; }
  }

  // Descreve o formato de mensagens não reconhecidas, sem registrar valores ou campos livres.
  function otherFrameFormat(text) {
    if (typeof text !== 'string' || text.length > 262144) return 'fora_do_limite';
    const input = text.trimStart();
    if (/^\d+[\[{]/.test(input)) return 'json_com_prefixo';
    if (!input.startsWith('{') && !input.startsWith('[')) return 'texto';
    try {
      const frame = JSON.parse(input);
      if (Array.isArray(frame)) return 'lista_json';
      if (['ping', 'pong'].includes(frame.t ?? frame.type)) return 'ping_pong';
      if (typeof frame.t === 'string') return 'json_com_t';
      if (typeof frame.type === 'string') return 'json_com_type';
      return 'json_sem_tipo';
    } catch { return 'json_inválido'; }
  }

  function matchesMarketPage(frame, request) {
    if (frame?.t !== 'market' || frame.aba !== 'vitrine' || !Array.isArray(frame.linhas) ||
        !money(request.moeda) || (frame.moeda != null && frame.moeda !== request.moeda) ||
        (frame.especieId != null && Number(frame.especieId) !== Number(request.especieId ?? 0))) return false;
    const exact = request.seq != null && frame.seq != null && Number(frame.seq) === Number(request.seq);
    if (frame.seq != null && request.seq != null && !exact) return false;
    if (frame.pagina != null ? Number(frame.pagina) !== request.pagina : !exact) return false;
    if (frame.ordem != null && request.ordem != null && frame.ordem !== request.ordem) return false;
    if (request.ordem == null || exact) return true;
    // A moeda da linha pode servir de confirmação se o cabeçalho não a repetir.
    const hasCurrency = frame.moeda === request.moeda || (frame.linhas.length > 0 &&
      frame.linhas.every(row => row?.moeda === request.moeda));
    return hasCurrency || (request.moeda === 'gold' && request.ordem === 'baratos');
  }

  function captureAutomatic(frame, request) {
    if (!matchesMarketPage(frame, request)) return null;
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
      sprite: row.sprite, spriteSource: row.spriteSource, spriteFallback: row.spriteFallback, criadoEm: row.postedAt, compravelEm: row.availableAt, expiraEm: row.expiresAt, estado: row.closed,
      ficha: { speciesId: row.speciesId, nome: row.name, shiny: row.shiny, level: row.level, nota: row.grade,
        formId: row.form, natureza: row.nature, naturezaId: row.natureId, shadow: row.shadow,
        rarity: row.rarity, legendary: row.legendary, stats: row.stats, refinoTotal: row.refinement,
        poder: row.battlePower, potencia: row.power, quality: row.quality, ivTotal: row.ivTotal, ivs: row.ivs,
        tmAoe: row.aoe, tmElemental: row.zMove, mega: row.mega },
    })).filter(Boolean);
  }

  // A base de preço recebe apenas fichas completas da época da venda.
  function inventoryProfile(pokemon) {
    if (!pokemon || typeof pokemon !== 'object' || !id(pokemon.id) ||
        !id(pokemon.speciesId ?? pokemon.especieId)) return null;
    const profile = normalizeRow('listing', {
      id: pokemon.id, pokemonId: pokemon.id, moeda: 'gold', preco: 1, ficha: pokemon,
    });
    return profile?.name && profile.level > 0 ? profile : null;
  }

  // Percorre apenas os estados do jogador. Fichas de vendas nunca entram neste índice.
  function inventoryProfiles(state) {
    const stack = [state];
    const profiles = [];
    for (let visited = 0; stack.length && visited < 40000 && profiles.length < 6000; visited++) {
      const node = stack.pop();
      if (!node || typeof node !== 'object') continue;
      const profile = inventoryProfile(node);
      if (profile) profiles.push(profile);
      else for (const child of Object.values(node)) if (child && typeof child === 'object') stack.push(child);
    }
    return profiles;
  }

  function findInventoryProfile(index, request) {
    const ids = request.ids;
    if (Array.isArray(ids)) {
      const known = [...new Set(ids.slice(0, 8))].filter(id => typeof id === 'string' && index.has(id));
      if (known.length === 1) return index.get(known[0]);
      // Um ID de outro exemplar nunca é substituído por coincidência de nome.
      if (ids.length) return null;
    }
    const name = typeof request.name === 'string' && request.name.length <= 100 ? request.name.toLowerCase() : '';
    const level = request.level;
    if (!name || !Number.isSafeInteger(level) || level < 1) return null;
    let match = null;
    for (const profile of index.values()) {
      if (profile.name.toLowerCase() !== name || profile.level !== level) continue;
      if (match) return null;
      match = profile;
    }
    return match;
  }

  function incompleteSaleFields(row) {
    const missing = [];
    for (const key of ['id', 'pokemonId', 'speciesId']) if (!id(row?.[key])) missing.push(key);
    if (!money(row?.currency)) missing.push('currency');
    if (!positiveInteger(row?.price)) missing.push('price');
    if (!timestamp(row?.soldAt)) missing.push('soldAt');
    if (typeof row?.name !== 'string' || !row.name.trim()) missing.push('name');
    if (!Number.isInteger(row?.level) || row.level < 1) missing.push('level');
    if (!Number.isFinite(row?.grade) || row.grade < 0) missing.push('grade');
    if (!Number.isInteger(row?.power) || row.power < 1 || row.power > 5) missing.push('power');
    if (!Number.isFinite(row?.quality) || row.quality <= 0) missing.push('quality');
    if (![0, 1].includes(row?.shiny)) missing.push('shiny');
    const ivs = Object.keys(statAliases).map(stat => row?.ivs?.[stat]);
    if (!ivs.every(value => Number.isInteger(value) && value >= 0 && value <= 32)) missing.push('ivs');
    else if (row.ivTotal !== ivs.reduce((sum, value) => sum + value, 0)) missing.push('ivTotal');
    if (!safeSprite(row?.sprite) && !safeSprite(row?.spriteFallback)) missing.push('sprite');
    return missing;
  }

  function matchesDisplayPrice(actual, offer) {
    if (actual === offer.price) return true;
    const tick = offer.priceTick;
    // Um preço abreviado na vitrine pode ter sido arredondado ou truncado.
    return offer.currency === 'gold' && Number.isSafeInteger(tick) && tick > 1 && tick <= 1e9 &&
      actual >= offer.price - tick / 2 && actual < offer.price + tick;
  }

  const sameMarket = (a, b) => !isOutland(a) && !isOutland(b) && a.currency === b.currency && a.speciesId === b.speciesId &&
    a.shiny === b.shiny && (a.form ?? null) === (b.form ?? null);

  const validIv = value => Number.isInteger(value) && value >= 0 && value <= 32;
  let attackCatalog;

  function attackProfile(row) {
    const catalog = globalThis.PI_ESPECIES;
    const engine = globalThis.PokeIdlePvePricing;
    if (!Array.isArray(catalog) || !engine?.attackStyle) return null;
    if (attackCatalog?.catalog !== catalog) {
      const key = name => name?.normalize('NFD').replace(/\p{Diacritic}/gu, '').trim()
        .replace(/^✨\s*/u, '').replace(/^shiny\s+/i, '').toLowerCase();
      attackCatalog = {
        catalog, key, byName: new Map(catalog.map(species => [key(species.n), species])),
        byId: new Map(catalog.map(species => [species.id, species])),
        central: globalThis.PokeIdleCentral?.create(globalThis),
      };
    }
    const { key, byName, byId, central } = attackCatalog;
    const species = row.name ? byName.get(key(row.name)) : byId.get(Number(row.speciesId));
    if (!species) return null;
    const iv = row.ivs ?? {};
    const ivs = { hp: iv.hp, atk: iv.attack, def: iv.defense, spAtk: iv.specialAttack,
      spDef: iv.specialDefense, speed: iv.speed };
    // O motor escolhe a forma final usada no cálculo, inclusive nas evoluções ramificadas.
    const hasOtherForm = species.evo?.length || species.megaBase != null ||
      (species.id >= 3000 && species.id < 4000 && /^Mega /i.test(species.n));
    const profile = hasOtherForm && central && engine.describe(central, {
      speciesId: species.id, level: row.level, potencia: row.power, quality: row.quality,
      shiny: row.shiny === 1, ivs, refino: {},
    });
    if (profile) return { style: profile.attackStyle, value: profile.ivAtaque };
    const style = engine.attackStyle(species);
    const hasIv = style === 'attack' ? validIv(ivs.atk) : style === 'specialAttack'
      ? validIv(ivs.spAtk) : validIv(ivs.atk) && validIv(ivs.spAtk);
    return { style, value: hasIv ? engine.attackIv(style, ivs) : null };
  }

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

  const COIN_SCALES = [0.08, 0.12, 0.16, 0.24];
  const SPECIALS = ['aoe', 'zMove', 'mega'];

  function coinProfile(target, sale, qualityWeight) {
    if ((target.shadow === 1 || sale.shadow === 1) && target.shadow !== sale.shadow) return null;
    for (const field of ['natureId', 'nature', 'rarity', 'legendary']) {
      if (target[field] != null && sale[field] != null && target[field] !== sale[field]) return null;
    }
    if (target.name && sale.name && target.name.toLowerCase() !== sale.name.toLowerCase()) return null;
    const grade = Math.abs(sale.grade - target.grade);
    const level = Math.abs(Math.log(sale.level / target.level));
    const differences = SPECIALS.filter(flag => (sale[flag] === 1) !== (target[flag] === 1)).length;
    const extraPremium = SPECIALS.some(flag => sale[flag] === 1 && target[flag] !== 1);
    const samePower = Number.isInteger(target.power) && sale.power === target.power;
    const neighbor = [4, 5].includes(target.power) && sale.power === target.power - 1;
    if (!samePower && !neighbor && Number.isInteger(target.power) && Number.isInteger(sale.power)) return null;
    const refine = Number.isFinite(target.refinement) && Number.isFinite(sale.refinement) ?
      Math.min(2, Math.abs(target.refinement - sale.refinement) / Math.max(1, target.refinement * 0.2)) / 3 : 0;
    // A Qualidade direta só é usada na variante do backtest.
    const quality = qualityWeight && Number.isFinite(target.quality) && Number.isFinite(sale.quality)
      ? Math.min(2, Math.abs(target.quality - sale.quality) / Math.max(0.01, target.quality * 0.12)) / 3 : 0;
    return { grade, close: grade <= 0.35 && level <= 0.3, samePower, neighbor, extraPremium,
      weight: Math.exp(-((level / 0.30) ** 2 / 2 + refine + quality)) * 0.3 ** differences };
  }

  const totalWeight = rows => rows.reduce((sum, row) => sum + row.weight, 0);
  const effective = rows => rows.length
    ? totalWeight(rows) ** 2 / rows.reduce((sum, row) => sum + row.weight ** 2, 0) : 0;

  function trimOutliers(rows) {
    if (rows.length < 5) return rows;
    const weight = totalWeight(rows);
    const median = Math.log(quantile(rows, weight, 0.5));
    const deviation = rows.map(({ price, weight }) => ({ price: Math.abs(Math.log(price) - median), weight }))
      .sort((a, b) => a.price - b.price);
    const spread = Math.max(Math.log(2), 4.4478 * quantile(deviation, weight, 0.5));
    return rows.filter(row => Math.abs(Math.log(row.price) - median) <= spread);
  }

  function coinSamples(comparable, scale) {
    const ranked = comparable.map(row => ({ ...row, weight: row.weight * Math.exp(-((row.grade / scale) ** 2 / 2)) }))
      .filter(row => row.weight >= 0.01)
      .sort((a, b) => Number(b.verified && b.close) - Number(a.verified && a.close) ||
        Number(b.samePower) - Number(a.samePower) || Number(a.extraPremium) - Number(b.extraPremium) ||
        b.weight - a.weight || b.sale.soldAt - a.sale.soldAt);
    const transactions = new Set(), pokemon = new Set();
    return ranked.filter(row => {
      const tx = id(row.sale.id), specimen = id(row.sale.pokemonId);
      if (transactions.has(tx) || (specimen && pokemon.has(specimen))) return false;
      transactions.add(tx);
      if (specimen) pokemon.add(specimen);
      return true;
    }).sort((a, b) => a.price - b.price);
  }

  function coinAttackFactor(target, rows) {
    const attack = attackProfile(target);
    if (!Number.isFinite(attack?.value)) return 1;
    const anchors = rows.filter(row => row.verified && row.samePower && !row.extraPremium)
      .sort((a, b) => b.weight - a.weight).slice(0, 24)
      .map(row => ({ ...row, attack: attackProfile(row.sale) }))
      .filter(row => row.attack?.style === attack.style && Number.isFinite(row.attack.value));
    if (anchors.length < 3) return 1;

    const slopes = [], matched = new Set();
    for (const [index, a] of anchors.entries()) {
      for (const b of anchors.slice(index + 1)) {
        const difference = b.attack.value - a.attack.value;
        if (Math.abs(difference) < 4 || Math.abs(Math.log(b.sale.level / a.sale.level)) > 0.12 ||
            Math.abs(b.sale.grade - a.sale.grade) > 0.08 ||
            SPECIALS.some(flag => (a.sale[flag] === 1) !== (b.sale[flag] === 1))) continue;
        slopes.push({ price: Math.log(b.price / a.price) / difference, weight: Math.min(a.weight, b.weight) });
        matched.add(a);
        matched.add(b);
      }
    }
    if (matched.size < 3) return 1;
    slopes.sort((a, b) => a.price - b.price);
    // Usa só o prêmio positivo observado em vendas semelhantes e reduz o peso de amostras pequenas.
    const slope = Math.max(0, quantile(slopes, totalWeight(slopes), 0.5)) * matched.size / (matched.size + 8);
    const ivs = anchors.map(row => ({ price: row.attack.value, weight: row.weight })).sort((a, b) => a.price - b.price);
    const medianIv = quantile(ivs, totalWeight(ivs), 0.5);
    return Math.max(0.85, Math.min(1.15, Math.exp(slope * (attack.value - medianIv))));
  }

  function coinQuote(target, rows, scale, { direct = false, bepi = false, outlierCount = 0, reason } = {}) {
    const count = rows.length, effectiveCount = effective(rows);
    const stats = { count, independentCount: count, effectiveCount, outlierCount, gradeScale: scale,
      closeCount: rows.filter(row => row.verified && row.close && row.samePower && !row.extraPremium).length };
    if (count < (direct || bepi ? 3 : 5) || effectiveCount < (direct || bepi ? 2.6 : 4))
      return { status: 'insufficient_sales', ...stats, alertReason: reason || 'comparáveis_insuficientes' };
    const weight = totalWeight(rows);
    const lower = quantile(rows, weight, 0.25);
    const median = quantile(rows, weight, 0.5);
    const upper = quantile(rows, weight, 0.75);
    const spread = upper / lower;
    const confidence = effectiveCount >= 8 && spread <= 1.6 ? 'alta' :
      spread <= (count <= 4 ? 1.6 : 2) ? 'média' : 'baixa';
    const qualities = rows.filter(row => row.grade <= scale && row.samePower && Number.isFinite(row.sale.quality))
      .map(row => ({ weight: row.weight, price: row.sale.quality })).sort((a, b) => a.price - b.price);
    const qualityLower = qualities.length >= 3 && effective(qualities) >= 2.6
      ? quantile(qualities, totalWeight(qualities), 0.25) : null;
    const powerCounts = bepi ? Object.fromEntries([target.power, target.power - 1].map(power =>
      [power, rows.filter(row => row.sale.power === power).length])) : null;
    const attackFactor = coinAttackFactor(target, rows);
    const adjust = value => Math.max(1, Math.min(Number.MAX_SAFE_INTEGER, Math.round(value * attackFactor)));
    const fair = adjust(median);
    return { status: 'estimated', method: 'coins_comparables', ...stats,
      lower: adjust(lower), median: fair, upper: adjust(upper), attackFactor, confidence, bepi,
      powerCounts, qualityBelow: Number.isFinite(target.quality) && qualityLower != null && target.quality < qualityLower,
      discount: 1 - target.price / fair, alertSupported: (direct || bepi) && confidence !== 'baixa',
      alertReason: reason || (!(direct || bepi) ? 'comparáveis_insuficientes' : confidence === 'baixa' ? 'preços_dispersos' : null),
      comparables: [...rows].sort((a, b) => b.weight - a.weight).slice(0, 5).map(({ sale }) => ({
        id: sale.id, price: sale.price, soldAt: sale.soldAt, grade: sale.grade, level: sale.level,
        power: sale.power, speed: sale.ivs?.speed,
      })) };
  }

  function estimateCoins(target, sales, now, { scales = COIN_SCALES, qualityWeight = false } = {}) {
    const comparable = [];
    for (const sale of sales) {
      if (!id(sale.id) || !sameMarket(target, sale) ||
          !(sale.soldAt >= now - WINDOW_MS && sale.soldAt < now) || !positiveInteger(sale.price) ||
          !(sale.level > 0 && Number.isFinite(sale.grade)) || (sale.pokemonId && sale.pokemonId === target.pokemonId)) continue;
      const profile = coinProfile(target, sale, qualityWeight);
      if (!profile) continue;
      comparable.push({ ...profile, sale, price: Number(sale.price),
        verified: sale.source === 'game' && Boolean(id(sale.pokemonId)),
        weight: profile.weight * 2 ** (-(now - sale.soldAt) / (5 * DAY)) });
    }
    let latest, dispersed;
    for (const scale of scales) {
      const rows = coinSamples(comparable, scale);
      // Extras ausentes no alvo podem inflar o preço mesmo depois de reduzir seu peso.
      const safe = rows.filter(row => row.verified && row.close && !row.extraPremium);
      const anchors = safe.filter(row => row.samePower);
      const direct = trimOutliers(anchors);
      latest = { rows, safe, direct, scale };
      if (direct.length < 3 || effective(direct) < 2.6) continue;
      const estimate = coinQuote(target, direct, scale, { direct: true, outlierCount: anchors.length - direct.length });
      if (estimate.alertSupported) return estimate;
      dispersed = estimate;
    }
    if (dispersed) return dispersed;
    const { rows, safe, direct, scale } = latest;
    const neighbors = safe.filter(row => row.neighbor);
    if (direct.length >= 2 && neighbors.length && effective(direct) >= 1.75 &&
        direct.at(-1).price <= direct[0].price * 1.6) {
      // A potência inferior só complementa o perfil-alvo e nunca eleva a sua mediana.
      const anchorWeight = totalWeight(direct);
      const anchorMedian = quantile(direct, anchorWeight, 0.5);
      const capped = neighbors.filter(row => row.price <= anchorMedian);
      const multiplier = Math.min(0.35, anchorWeight * 0.75 / totalWeight(capped));
      const mixed = [...direct, ...capped.map(row => ({ ...row, weight: row.weight * multiplier }))]
        .sort((a, b) => a.price - b.price);
      const estimate = coinQuote(target, trimOutliers(mixed), scale, { bepi: capped.length > 0 });
      if (estimate.alertSupported && estimate.bepi && estimate.powerCounts[target.power] >= 2 &&
          estimate.powerCounts[target.power - 1] > 0) return estimate;
    }
    const reference = rows.filter(row => !row.neighbor);
    const trimmed = trimOutliers(reference);
    const reason = rows.some(row => row.verified && row.samePower && row.extraPremium)
      ? 'extras_sem_suporte' : 'comparáveis_insuficientes';
    return coinQuote(target, trimmed, scale, { reason, outlierCount: reference.length - trimmed.length });
  }

  // Baseline conservadora: mesma espécie, moeda e Shiny, com meia-vida de 10 dias.
  // Nota e nível só participam quando presentes dos dois lados. As escalas são
  // parâmetros iniciais para backtest e a faixa descreve os comparáveis observados.
  function estimate(target, sales, now) {
    if (isOutland(target)) return { status: 'excluded_outland' };
    if (target.shiny == null || !(target.level > 0) || target.grade == null) {
      return { status: 'incomplete_profile' };
    }
    if (target.currency === 'gold') return estimateCoins(target, sales, now);
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
    const close = comparable.filter(({ sale }) => Math.abs(sale.grade - target.grade) <= 0.5 &&
      Math.abs(Math.log2(sale.level / target.level)) <= 0.5);
    const closeEntities = new Set(close.map(({ sale }) => sale.pokemonId ? 'p:' + sale.pokemonId : 's:' + sale.id));
    const lower = quantile(comparable, weight, 0.25);
    const median = quantile(comparable, weight, 0.5);
    const upper = quantile(comparable, weight, 0.75);
    return { status: 'estimated', count, independentCount, effectiveCount, lower, median, upper,
      discount: 1 - target.price / median, method: 'baseline', alertSupported: closeEntities.size >= 5,
      comparables: [...comparable].sort((a, b) => b.weight - a.weight).slice(0, 5).map(({ sale }) => ({
        id: sale.id, price: sale.price, soldAt: sale.soldAt, grade: sale.grade, level: sale.level,
        power: sale.power, speed: sale.ivs?.speed,
      })) };
  }

  function purchaseOffer(row) {
    if (row?.currency !== 'gold' || typeof row.name !== 'string' || !row.name.trim() || !id(row.id) || !id(row.pokemonId) || !id(row.speciesId) ||
        !positiveInteger(row.price) || !timestamp(row.observedAt) || row.availableAt > Date.now() || isOutland(row)) return null;
    return { id: id(row.id), pokemonId: id(row.pokemonId), speciesId: id(row.speciesId),
      currency: 'gold', price: Number(row.price), observedAt: row.observedAt,
      name: row.name.trim().slice(0, 100) };
  }

  function matchesPurchase(offer, row, now = Date.now()) {
    return Boolean(offer && row && !row.closed && !isOutland(row) &&
      row.currency === offer.currency && row.id === offer.id && row.pokemonId === offer.pokemonId &&
      row.speciesId === offer.speciesId && row.name === offer.name && row.price === offer.price &&
      (!row.availableAt || row.availableAt <= now) && (!row.expiresAt || row.expiresAt > now));
  }

  const core = { decodeGameFrame, otherFrameFormat, matchesMarketPage, purchaseOffer, matchesPurchase, capture, captureAutomatic, validate, estimate, sameMarket, isOutland, safeSprite, historyReply, historyRequest, historyTrace, linkageFields,
    WINDOW_MS, MAX_BATCH, estimateCoins, attackProfile, validIv, incompleteSaleFields, matchesDisplayPrice, inventoryProfiles, findInventoryProfile };
  if (typeof window === 'undefined' && typeof module === 'object' && module.exports) module.exports = core;
  else globalThis.PISMarketCore = core;
})();
