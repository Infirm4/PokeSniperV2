// Regras puras para o painel e as notificações. Nenhum comando é enviado ao jogo.
(() => {
  const { isOutland, attackProfile, validIv } = typeof module === 'object' && module.exports
    ? require('./market-core.js') : globalThis.PISMarketCore;
  const TTL = 10 * 60 * 1000;
  // Conserva apenas lançamentos recentes como candidatos à fila de avisos.
  const NEW_OFFER_AGE = 120000;
  function freshLaunch(row, now = Date.now()) {
    return Number.isFinite(row.postedAt) && row.postedAt >= now - NEW_OFFER_AGE && row.postedAt <= now + 15000;
  }
  const DEFAULTS = { currency: 'gold', discount: 20, notify: false };

  function settings(raw = {}) {
    const discount = Number(raw.discount ?? DEFAULTS.discount);
    return {
      currency: ['gold', 'orb', 'all'].includes(raw.currency) ? raw.currency : DEFAULTS.currency,
      discount: Number.isFinite(discount) ? Math.min(99, Math.max(0, discount)) : DEFAULTS.discount,
      notify: raw.notify === true,
    };
  }

  // Indexa ofertas no preço de referência ou abaixo dele. O filtro aplica o desconto salvo.
  const eligible = (row, now = Date.now()) => !row.closed && !isOutland(row) && (!row.expiresAt || row.expiresAt > now) && row.estimate?.status === 'estimated' && row.estimate.profileReason !== 'rare_profile' && row.estimate.median > 0 && row.price <= row.estimate.median;
  const key = row => JSON.stringify([row.currency, row.id, row.price]);

  function priceLimit(row, config) {
    if (row.estimate?.status !== 'estimated') return null;
    return Math.max(0, Math.floor(row.estimate.median * (100 - config.discount) / 100));
  }

  function notificationEligible(row, config = {}) {
    if (row.currency === 'gold') {
      const { bepi, lower } = row.estimate ?? {};
      if (bepi && (!(row.price < lower) ||
          row.price > Math.floor(row.estimate.median * Math.max(0, 95 - (config.discount ?? 0)) / 100))) return false;
    }
    return row.estimate?.alertSupported !== false &&
      (!row.estimate?.sourceAt || Date.now() - row.estimate.sourceAt <= 72 * 3600000) &&
      row.estimate?.profileReason !== 'rare_profile' &&
      (row.estimate?.method !== 'baseline' || ![row.aoe, row.zMove, row.mega].includes(1));
  }

  function matches(row, config) {
    const limit = priceLimit(row, config);
    return (config.currency === 'all' || config.currency === row.currency) &&
      limit != null && row.price <= limit;
  }

  function approved(row, config, now = Date.now()) {
    return eligible(row, now) && matches(row, config) && notificationEligible(row, config);
  }

  let dexNames;
  function spriteCandidates(row) {
    const core = typeof module === 'object' && module.exports ? require('./market-core.js') : globalThis.PISMarketCore;
    const urls = [row.sprite, row.spriteFallback];
    if ([0, 1].includes(row.shiny) && row.mega !== 1 &&
        (row.form == null || ['0', 'base', 'normal', 'default'].includes(row.form)) && Array.isArray(globalThis.PI_ESPECIES)) {
      dexNames ??= new Map(globalThis.PI_ESPECIES.filter(species => species.id > 0 && species.id <= 1025)
        .map(species => [species.n.toLowerCase(), species.id]));
      const name = row.name?.trim().replace(/^✨\s*/u, '').replace(/^shiny\s+/i, '').toLowerCase();
      const dex = dexNames.get(name);
      if (dex) urls.push(`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${row.shiny ? 'shiny/' : ''}${dex}.png`);
    }
    return [...new Set(urls.map(core.safeSprite).filter(Boolean))].slice(0, 2);
  }

  function mountSprite(img, urls, unavailable = () => img.remove()) {
    if (!urls.length) return false;
    let index = 0;
    img.referrerPolicy = 'no-referrer';
    img.addEventListener('error', () => {
      if (++index < urls.length) img.src = urls[index];
      else unavailable();
    });
    img.src = urls[0];
    return true;
  }

  let speciesByName;
  function coinIvs(row, labels) {
    speciesByName ??= new Map();
    if (!speciesByName.size && Array.isArray(globalThis.PI_ESPECIES)) {
      for (const species of globalThis.PI_ESPECIES) speciesByName.set(species.n.toLowerCase(), species);
    }
    const name = row.name?.trim().replace(/^✨\s*|^shiny\s+/giu, '').toLowerCase();
    const species = speciesByName.get(name);
    const important = new Set(['speed']);
    const physical = species?.b?.[1], special = species?.b?.[3];
    if (physical >= special * 0.9) important.add('attack');
    if (special >= physical * 0.9) important.add('specialAttack');
    const fields = ['hp', 'attack', 'defense', 'specialAttack', 'specialDefense', 'speed'];
    const gameKeys = ['hp', 'atk', 'def', 'spAtk', 'spDef', 'speed'];
    const ficha = { level: row.level, potencia: row.power, quality: row.quality, shiny: row.shiny,
      ivs: Object.fromEntries(fields.map((key, index) => [gameKeys[index], row.ivs?.[key]])) };
    const evaluate = globalThis.PokeIdlePvePower?.calcular;
    const current = evaluate?.(ficha, species)?.power;
    return fields.filter(key => isLowIv(row.ivs?.[key]))
      .sort((a, b) => Number(important.has(b)) - Number(important.has(a)))
      .map(key => {
        const iv = row.ivs[key];
        if (important.has(key)) return `${labels[key]} ${iv} (prioritário)`;
        const gameKey = gameKeys[fields.indexOf(key)];
        const corrected = current >= 10 ? evaluate({ ...ficha, ivs: { ...ficha.ivs, [gameKey]: 20 } }, species)?.power : null;
        const impact = corrected > current * 1.05 ? ' (afeta PvE)' :
          corrected > 0 ? ' (baixo impacto no PvE)' : '';
        return `${labels[key]} ${iv}${impact}`;
      });
  }

  const IV_LABELS = { hp: 'HP', attack: 'Ataque', defense: 'Defesa', specialAttack: 'Atq. Esp.',
    specialDefense: 'Def. Esp.', speed: 'Velocidade' };

  function noticeIvs(row) {
    const rating = value => value < 15 ? 'crítico' : value < 25 ? 'média' : 'Pica';
    const speed = row.ivs?.speed;
    const entries = [validIv(speed) ? `Velocidade ${speed} (${rating(speed)})` : 'Velocidade indisponível'];
    const style = attackProfile(row)?.style;
    const attacks = style === 'mixed' ? ['attack', 'specialAttack'] : style ? [style] : [];
    for (const stat of attacks) {
      const value = row.ivs?.[stat];
      if (validIv(value)) entries.push(`${IV_LABELS[stat]} ${value}`);
    }
    return entries;
  }
  const isLowIv = value => Number.isInteger(value) && value >= 0 && value < 10;

  // Formata o mesmo desconto e os mesmos valores para painel e avisos.
  function presentation(row, now = Date.now(), { noticeIvsOnly = false } = {}) {
    const coins = row.currency === 'gold';
    const unit = coins ? 'Mi Coins' : 'Gemas';
    const money = value => new Intl.NumberFormat('pt-BR', {
      maximumFractionDigits: coins ? (value < 1e6 ? 6 : 2) : 0,
    }).format(coins ? value / 1e6 : value);
    const discount = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 })
      .format(row.estimate.discount * 100) + '% de desconto';
    const asking = `${money(row.price)} ${unit}`;
    const { lower, upper } = row.estimate;
    const range = Number.isFinite(lower) && Number.isFinite(upper)
      ? `Faixa justa estimada · ${money(lower)}–${money(upper)} ${unit}` : '';
    const ivs = noticeIvsOnly
      ? noticeIvs(row)
      : coins ? coinIvs(row, IV_LABELS) : Object.keys(IV_LABELS)
        .filter(key => isLowIv(row.ivs?.[key])).map(key => IV_LABELS[key]);
    const warning = [ivs.length ? (noticeIvsOnly ? 'IVs: ' : 'IV baixo: ') + ivs.join(', ') : '',
      coins && row.estimate.qualityBelow ? 'Qualidade abaixo dos comparáveis' : ''].filter(Boolean).join(' · ');
    const { confidence, bepi, powerCounts } = row.estimate;
    const label = coins ? bepi ? 'BEPI' : ({ alta: 'Alta', média: 'Média' })[confidence] : '';
    const composition = coins && bepi && powerCounts ? 'Registros: ' + Object.entries(powerCounts)
      .reverse().map(([power, count]) => `${count} P${power}`).join(' e ') : '';
    const strength = coins && Number.isFinite(lower) ? row.price <= lower ? 'Oferta forte' : 'Oferta fraca' : '';
    const tier = [label, strength].filter(Boolean).join(' · ');
    const hold = row.availableAt > now ? 'Retido até ' + new Intl.DateTimeFormat('pt-BR', {
      timeStyle: 'medium', timeZone: 'America/Sao_Paulo',
    }).format(row.availableAt) : '';
    return { discount, asking, range, warning, hold, tier, composition,
      message: [`${discount} · ${asking}`, coins ? tier : range, composition, hold, warning].filter(Boolean).join('\n') };
  }

  const grades = [2, 3].map(digits => new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: digits, maximumFractionDigits: digits,
  }));

  function profileSummary(row, compact = true) {
    const [label, grade] = compact ? ['N', grades[0]] : ['Nota', grades[1]];
    return [
      row.level > 0 ? 'Nvl ' + row.level : '',
      row.power > 0 ? 'P' + row.power : '',
      Number.isFinite(row.grade) ? label + ' ' + grade.format(row.grade) : '',
    ].filter(Boolean).join(' · ');
  }

  function noticePresentation(row, now = Date.now()) {
    const { composition, warning } = presentation(row, now, { noticeIvsOnly: true });
    const amount = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });
    const discount = row.estimate.discount > 0 ? '−' + amount.format(row.estimate.discount * 100) + '%' : '0%';
    const title = `${row.name || 'Pokémon #' + row.speciesId} · ${discount}`;
    const coins = row.currency === 'gold';
    const median = row.estimate.median;
    const money = value => {
      const precision = coins && value < 10000 ? 6 : coins ? 2 : 0;
      const price = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: precision })
        .format(coins ? value / 1e6 : value);
      return `${coins ? '💰' : '💎'} ${price}${coins ? ' MI' : ''}`;
    };
    const quoted = Number.isFinite(median) && median > 0 ? 'Preço justo ' + money(median) : 'Preço justo indisponível';
    const prices = `Mercado ${money(row.price)} · ${quoted}`;
    const details = [prices, composition, warning];
    return { title,
      message: [profileSummary(row, false), ...details].filter(Boolean).join('\n'),
      desktopMessage: [profileSummary(row), ...details].filter(Boolean).join('\n'),
    };
  }

  const core = { TTL, freshLaunch, settings, eligible, key, matches, priceLimit, notificationEligible, approved, spriteCandidates, mountSprite, presentation, profileSummary, noticePresentation };
  if (typeof module === 'object' && module.exports) module.exports = core;
  else globalThis.PISOpportunities = core;
})();
