// Regras puras para o painel e as notificações. Nenhum comando é enviado ao jogo.
(() => {
  const { isOutland } = typeof module === 'object' && module.exports
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
      resale: raw.resale === true,
      fee: raw.fee != null && raw.fee !== '' && Number.isFinite(Number(raw.fee)) &&
        Number(raw.fee) >= 0 && Number(raw.fee) < 100 ? Number(raw.fee) : null,
      returnPercent: Math.max(0, Math.min(1000, Number(raw.returnPercent) || 0)),
      purchaseCost: Number.isSafeInteger(Number(raw.purchaseCost)) ? Math.max(0, Number(raw.purchaseCost)) : 0,
      saleCost: Number.isSafeInteger(Number(raw.saleCost)) ? Math.max(0, Number(raw.saleCost)) : 0,
    };
  }

  // Indexa ofertas no preço de referência ou abaixo dele. O filtro aplica o desconto salvo.
  const eligible = (row, now = Date.now()) => !row.closed && !isOutland(row) && (!row.expiresAt || row.expiresAt > now) && row.estimate?.status === 'estimated' && row.estimate.profileReason !== 'rare_profile' && row.estimate.median > 0 && row.price <= row.estimate.median;
  const key = row => JSON.stringify([row.currency, row.id, row.price]);

  // O preço limite deriva do desconto e, quando ativo, do filtro de margem de revenda.
  function priceLimit(row, config) {
    if (row.estimate?.status !== 'estimated') return null;
    const { lower, median } = row.estimate;
    const caps = [median * (100 - config.discount) / 100];
    if (config.resale) {
      if (config.fee == null || config.currency !== row.currency) return null;
      const proceeds = lower * (1 - config.fee / 100) - config.saleCost;
      caps.push(proceeds / (1 + config.returnPercent / 100) - config.purchaseCost);
    }
    return Math.max(0, Math.floor(Math.min(...caps)));
  }

  function notificationEligible(row) {
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
    return eligible(row, now) && matches(row, config) && notificationEligible(row, now);
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

  // Formata o mesmo desconto e os mesmos valores para painel e avisos.
  function presentation(row, now = Date.now()) {
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
    const stats = { hp: 'HP', attack: 'Ataque', defense: 'Defesa', specialAttack: 'Atq. Esp.', specialDefense: 'Def. Esp.', speed: 'Velocidade' };
    const lowIvs = Object.entries(stats).filter(([key]) => Number.isInteger(row.ivs?.[key]) && row.ivs[key] < 10)
      .map(([, label]) => label);
    const warning = lowIvs.length ? 'IV baixo: ' + lowIvs.join(', ') : '';
    const hold = row.availableAt > now ? 'Retido até ' + new Intl.DateTimeFormat('pt-BR', {
      timeStyle: 'medium', timeZone: 'America/Sao_Paulo',
    }).format(row.availableAt) + ' (Brasília)' : '';
    return { discount, asking, range, warning, hold,
      message: [`${discount} · ${asking}`, range, hold, warning].filter(Boolean).join('\n') };
  }

  const core = { TTL, freshLaunch, settings, eligible, key, matches, priceLimit, notificationEligible, approved, spriteCandidates, mountSprite, presentation };
  if (typeof module === 'object' && module.exports) module.exports = core;
  else globalThis.PISOpportunities = core;
})();
