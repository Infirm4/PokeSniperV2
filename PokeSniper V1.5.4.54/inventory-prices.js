// Cotação local sob demanda para Pokémon próprios, sem cliques ou consultas ao jogo.
(() => {
  if (window !== window.top) return;
  const cards = '.poke-linha, .poke-card, .pk-card, .pokemon-card, [data-pokemon-id], [data-poke-id], [data-pk-id], [data-pokemon], [data-pk]';
  const excluded = '#cm-lista, #ficha, .cm-folha';
  const number = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 });
  const cache = new Map();
  let hovered, tooltip, timer, request = 0;

  function candidate(target) {
    if (!(target instanceof Element) || target.closest(excluded)) return null;
    const wrapper = target.closest('.poke-linha, .poke-card, .pk-card, .pokemon-card');
    if (wrapper) return wrapper;
    const area = target.closest('#mochila, #depot, #colecao, [data-panel="mochila"]');
    const contained = area && target.closest('.mk-card, .pk-slot, .poke-slot, [data-id], [data-chave]');
    return contained && area.contains(contained) ? contained : target.closest(cards);
  }

  function details(card) {
    const fields = ['pokemonId', 'pokeId', 'pkId', 'pokemon', 'pk', 'chave', 'key'];
    const ids = new Set();
    const nodes = [card, ...card.querySelectorAll('[data-pokemon-id], [data-poke-id], [data-pk-id], [data-pokemon], [data-pk], .pl-ficha')];
    for (const node of nodes) for (const field of fields) {
      const value = /^(?:poke[-:#]?|pk[-:#]?)?(\d{1,64})$/i.exec(node.dataset[field] ?? '')?.[1];
      if (value) ids.add(value);
    }
    if (!ids.size && /^\d{1,64}$/.test(card.dataset.id ?? '')) ids.add(card.dataset.id);
    const name = card.querySelector('.pl-nome, .pl-name, .poke-nome, .pk-nome, .pk-name, [data-pokemon-name], strong')?.textContent.trim() ||
      card.dataset.pokemonName?.trim();
    const level = Number(/\b(?:nv(?:l)?\.?|nível|level)\s*([\d.]+)/iu.exec(card.textContent)?.[1]?.replaceAll('.', ''));
    return { ids: [...ids].slice(0, 8), name, level: Number.isSafeInteger(level) ? level : null };
  }

  function remove() {
    ++request;
    clearTimeout(timer);
    tooltip?.remove();
    tooltip = null;
    hovered = null;
  }

  function show(card, profile, quotes) {
    if (!card.isConnected || !card.getClientRects().length) return;
    tooltip?.remove();
    tooltip = document.createElement('div');
    const panel = document.createElement('div');
    panel.setAttribute('role', 'tooltip');
    const title = document.createElement('strong');
    title.textContent = 'Preço justo';
    panel.append(title);
    for (const [currency, icon, unit] of [['gold', '🪙', 'Coins'], ['orb', '💎', 'Gemas']]) {
      const line = document.createElement('div');
      const quote = quotes?.[currency];
      let price = 'Sem estimativa';
      if (currency === 'gold' && profile.shiny === 1) price = 'Disponível em Gemas';
      else if (quote) price = currency === 'gold' && quote.median >= 1_000_000
        ? number.format(quote.median / 1_000_000) + ' MI' : number.format(quote.median);
      line.textContent = icon + ' ' + unit + ' · ' + price + (quote?.indicative ? ' (indicativo)' : '');
      panel.append(line);
    }
    Object.assign(panel.style, {
      display: 'grid', gap: '3px', padding: '7px 9px', borderLeft: '2px solid #9aaae8',
      background: '#28243b', color: '#fff', borderRadius: '4px', font: '11px/1.3 system-ui',
      boxShadow: '0 3px 12px #0006', maxWidth: 'calc(100vw - 16px)', boxSizing: 'border-box',
    });
    Object.assign(tooltip.style, { position: 'fixed', zIndex: '2147483647', pointerEvents: 'none' });
    tooltip.attachShadow({ mode: 'open' }).append(panel);
    document.documentElement.append(tooltip);
    const anchor = card.getBoundingClientRect();
    const { width, height } = tooltip.getBoundingClientRect();
    tooltip.style.left = Math.max(8, Math.min(anchor.left, innerWidth - width - 8)) + 'px';
    const below = anchor.bottom + 5;
    tooltip.style.top = (below + height <= innerHeight - 8 ? below : Math.max(8, anchor.top - height - 5)) + 'px';
  }

  async function price(card, profile, requestId) {
    const key = JSON.stringify(profile);
    let stored = cache.get(key);
    if (!stored || stored.until <= Date.now()) {
      const reply = await chrome.runtime.sendMessage({ type: 'PIS_INVENTORY_QUOTE', profile });
      if (!reply?.quotes) return;
      stored = { until: Date.now() + 30000, quotes: reply.quotes };
      cache.set(key, stored);
      if (cache.size > 128) cache.delete(cache.keys().next().value);
    }
    if (requestId === request && card === hovered) show(card, profile, stored.quotes);
  }

  function enter(event) {
    const card = candidate(event.target);
    if (!card || card === hovered) return;
    remove();
    hovered = card;
    const requestId = request;
    timer = setTimeout(() => {
      if (!card.isConnected || hovered !== card || requestId !== request) return;
      const identity = details(card);
      if (!identity.ids.length && !(identity.name && identity.level)) return;
      window.postMessage({ source: 'PIS_BRIDGE', type: 'INVENTORY_PROFILE', requestId, ...identity }, location.origin);
    }, 140);
  }

  function leave(event) {
    if (hovered?.contains(event.target) && !hovered.contains(event.relatedTarget)) remove();
  }

  window.addEventListener('message', event => {
    const result = event.data;
    if (event.source !== window || event.origin !== location.origin || result?.source !== 'PIS_MAIN' ||
        result.type !== 'INVENTORY_PROFILE' || result.requestId !== request || !hovered || !result.profile) return;
    price(hovered, result.profile, request).catch(() => {});
  });
  document.addEventListener('pointerover', enter);
  document.addEventListener('pointerout', leave);
  document.addEventListener('focusin', enter);
  document.addEventListener('focusout', leave);
  document.addEventListener('scroll', remove, { capture: true, passive: true });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') remove(); });
})();
