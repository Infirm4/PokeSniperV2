// Regras puras para o painel e as notificações. Nenhum comando é enviado ao jogo.
(() => {
  const TTL = 10 * 60 * 1000;
  const DEFAULTS = { currency: 'gold', discount: 20, maxPrice: 0, allow: '', block: '', notify: false };
  const tokens = value => String(value || '').toLowerCase().split(',').map(item => item.trim()).filter(Boolean);

  function settings(raw = {}) {
    const discount = Number(raw.discount ?? DEFAULTS.discount);
    const maxPrice = Number(raw.maxPrice ?? DEFAULTS.maxPrice);
    return {
      currency: ['gold', 'orb', 'all'].includes(raw.currency) ? raw.currency : DEFAULTS.currency,
      discount: Number.isFinite(discount) ? Math.min(99, Math.max(0, discount)) : DEFAULTS.discount,
      maxPrice: Number.isSafeInteger(maxPrice) && maxPrice >= 0 ? maxPrice : 0,
      allow: typeof raw.allow === 'string' ? raw.allow.slice(0, 1000) : '',
      block: typeof raw.block === 'string' ? raw.block.slice(0, 1000) : '',
      notify: raw.notify === true,
    };
  }

  // Exige preço abaixo do quartil inferior. Repetir o mesmo preço não gera outro alerta.
  const eligible = row => row.estimate?.status === 'estimated' && row.price < row.estimate.lower;
  const key = row => JSON.stringify([row.currency, row.id, row.price]);

  function matches(row, config) {
    const tags = [row.speciesId, row.name?.trim().toLowerCase()];
    const allow = tokens(config.allow);
    return (config.currency === 'all' || config.currency === row.currency) &&
      (config.maxPrice === 0 || row.price <= config.maxPrice) &&
      row.estimate.discount >= config.discount / 100 &&
      (!allow.length || allow.some(tag => tags.includes(tag))) &&
      !tokens(config.block).some(tag => tags.includes(tag));
  }

  const core = { TTL, settings, eligible, key, matches };
  if (typeof module === 'object' && module.exports) module.exports = core;
  else globalThis.PISOpportunities = core;
})();
