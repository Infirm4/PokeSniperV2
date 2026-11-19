// Regras puras para o painel e as notificações. Nenhum comando é enviado ao jogo.
(() => {
  const TTL = 10 * 60 * 1000;
  const DEFAULTS = { currency: 'gold', discount: 20, allow: '', block: '', notify: false };
  const tokens = value => String(value || '').toLowerCase().split(',').map(item => item.trim()).filter(Boolean);

  function settings(raw = {}) {
    const discount = Number(raw.discount ?? DEFAULTS.discount);
    return {
      currency: ['gold', 'orb', 'all'].includes(raw.currency) ? raw.currency : DEFAULTS.currency,
      discount: Number.isFinite(discount) ? Math.min(99, Math.max(0, discount)) : DEFAULTS.discount,
      allow: typeof raw.allow === 'string' ? raw.allow.slice(0, 1000) : '',
      block: typeof raw.block === 'string' ? raw.block.slice(0, 1000) : '',
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
  const eligible = row => !row.closed && row.estimate?.status === 'estimated' && row.estimate.median > 0 && row.price <= row.estimate.median;
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
    return row.estimate?.profileReason !== 'rare_profile' &&
      (row.estimate?.method !== 'baseline' || ![row.aoe, row.zMove, row.mega].includes(1));
  }

  function matches(row, config) {
    const limit = priceLimit(row, config);
    const tags = [row.speciesId, row.name?.trim().toLowerCase()];
    const allow = tokens(config.allow);
    return (config.currency === 'all' || config.currency === row.currency) &&
      limit != null && row.price <= limit &&
      (!allow.length || allow.some(tag => tags.includes(tag))) &&
      !tokens(config.block).some(tag => tags.includes(tag));
  }

  const core = { TTL, settings, eligible, key, matches, priceLimit, notificationEligible };
  if (typeof module === 'object' && module.exports) module.exports = core;
  else globalThis.PISOpportunities = core;
})();
