// Cotação local sob demanda para Pokémon próprios, sem cliques ou consultas ao jogo.
(() => {
  if (window !== window.top) return;
  const cards = '.poke-linha, .poke-card, .pk-card, .pokemon-card, [data-pokemon-id], [data-poke-id], [data-pk-id], [data-pokemon], [data-pk]';
  const excluded = '#cm-lista, #ficha, .cm-folha';
  const number = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 });
  const cache = new Map();
  const MIN_SHEET_GRADE = 3.5;
  let hovered, tooltip, timer, hoverRequest = 0, requestSequence = 0;
  let sheet, sheetBadge, sheetSignature, sheetRequest = 0, sheetFrame = false;

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
    hoverRequest = 0;
    clearTimeout(timer);
    tooltip?.remove();
    tooltip = null;
    hovered = null;
  }

  function priceLabels(profile, quotes) {
    return [['gold', '💰', 'Coins'], ['orb', '💎', 'Gemas']].map(([currency, icon, unit]) => {
      const quote = quotes?.[currency];
      let value = 'Sem estimativa';
      if (currency === 'gold' && profile.shiny === 1) value = 'Disponível em Gemas';
      else if (quote) value = currency === 'gold' && quote.median >= 1_000_000
        ? number.format(quote.median / 1_000_000) + ' MI' : number.format(quote.median);
      return icon + ' ' + unit + ' · ' + value + (quote?.indicative ? ' (indicativo)' : '');
    });
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
    for (const label of priceLabels(profile, quotes)) {
      const line = document.createElement('div');
      line.textContent = label;
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

  async function loadQuote(profile) {
    const key = JSON.stringify(profile);
    let stored = cache.get(key);
    if (!stored || stored.until <= Date.now()) {
      const reply = await chrome.runtime.sendMessage({ type: 'PIS_INVENTORY_QUOTE', profile });
      if (!reply?.quotes) return;
      stored = { until: Date.now() + 30000, quotes: reply.quotes };
      cache.set(key, stored);
      if (cache.size > 128) cache.delete(cache.keys().next().value);
    }
    return stored.quotes;
  }

  function enter(event) {
    const card = candidate(event.target);
    if (!card || card === hovered) return;
    remove();
    hovered = card;
    const requestId = hoverRequest = ++requestSequence;
    timer = setTimeout(() => {
      if (!card.isConnected || hovered !== card || requestId !== hoverRequest) return;
      const identity = details(card);
      if (!identity.ids.length && !(identity.name && identity.level)) return;
      window.postMessage({ source: 'PIS_BRIDGE', type: 'INVENTORY_PROFILE', requestId, ...identity }, location.origin);
    }, 140);
  }

  function leave(event) {
    if (hovered?.contains(event.target) && !hovered.contains(event.relatedTarget)) remove();
  }

  function showSheetPrice(profile, quotes) {
    const anchor = sheet?.querySelector('.fi-heroi, .fi-acoes');
    if (!anchor) return;
    sheetBadge?.remove();
    sheetBadge = document.createElement('div');
    sheetBadge.dataset.pisInventoryQuote = '';
    const panel = document.createElement('div');
    panel.setAttribute('aria-label', 'Preço justo no mercado');
    Object.assign(panel.style, {
      display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 7px',
      margin: '4px 0 8px', color: '#fff', font: '600 11px/1.3 system-ui',
    });
    const title = document.createElement('strong');
    title.textContent = 'Preço justo';
    panel.append(title);
    for (const label of priceLabels(profile, quotes)) {
      const pill = document.createElement('span');
      pill.textContent = label;
      Object.assign(pill.style, { background: '#30283c', borderTop: '1px solid #86749b',
        padding: '2px 6px', borderRadius: '3px' });
      panel.append(pill);
    }
    sheetBadge.attachShadow({ mode: 'open' }).append(panel);
    const hero = sheet.querySelector('.fi-heroi') ?? anchor;
    hero.after(sheetBadge);
  }

  function visibleSheet() {
    return Boolean(sheet?.isConnected && !sheet.hidden && sheet.getClientRects().length && sheet.getAttribute('aria-hidden') !== 'true' &&
      getComputedStyle(sheet).visibility !== 'hidden');
  }

  function inspectSheet() {
    sheetFrame = false;
    let signature = null, id;
    if (visibleSheet() && sheet.querySelector('.fi-heroi, .fi-acoes')) {
      // A identidade da ficha permite consultar apenas o exemplar encontrado no inventário.
      const identifiers = [...sheet.querySelectorAll('.txt-num')].map(node =>
        /^#(\d{1,64})$/.exec(node.textContent.trim())?.[1]).filter(Boolean);
      [id] = identifiers;
      const name = sheet.querySelector('.fi-nome')?.textContent.trim();
      const level = sheet.querySelector('.fi-nivel-chip')?.textContent.trim();
      const visibleGrade = sheet.querySelector('[data-nota]')?.dataset.nota?.trim();
      const grade = visibleGrade ? Number(visibleGrade.replace(',', '.')) : null;
      if (id && name && (grade == null || !Number.isFinite(grade) || grade >= MIN_SHEET_GRADE))
        signature = JSON.stringify([id, name, level, visibleGrade]);
    }
    if (signature === sheetSignature && (!sheetBadge || sheetBadge.isConnected)) return;
    sheetSignature = signature;
    sheetBadge?.remove();
    sheetBadge = null;
    sheetRequest = 0;
    if (!signature) return;
    sheetRequest = ++requestSequence;
    window.postMessage({ source: 'PIS_BRIDGE', type: 'INVENTORY_PROFILE', requestId: sheetRequest, ids: [id] }, location.origin);
  }

  function scheduleSheet() {
    if (sheetFrame) return;
    sheetFrame = true;
    requestAnimationFrame(inspectSheet);
  }

  const sheetObserver = new MutationObserver(scheduleSheet);
  function discoverSheet() {
    const next = document.getElementById('ficha');
    if (next === sheet) return;
    sheetObserver.disconnect();
    sheet = next;
    sheetSignature = undefined;
    sheetRequest = 0;
    if (sheet) sheetObserver.observe(sheet, { subtree: true, childList: true, characterData: true, attributes: true,
      attributeFilter: ['hidden', 'class', 'style', 'data-nota', 'aria-hidden'] });
    scheduleSheet();
  }
  new MutationObserver(discoverSheet).observe(document, { childList: true, subtree: true });
  discoverSheet();

  window.addEventListener('message', event => {
    const result = event.data;
    if (event.source !== window || event.origin !== location.origin || result?.source !== 'PIS_MAIN' ||
        result.type !== 'INVENTORY_PROFILE' || !result.profile?.id) return;
    const { profile, requestId } = result;
    if (hovered && requestId === hoverRequest) {
      const card = hovered;
      loadQuote(profile).then(quotes => {
        if (quotes && requestId === hoverRequest && card === hovered) show(card, profile, quotes);
      }).catch(() => {});
    }
    if (requestId === sheetRequest && profile.grade >= MIN_SHEET_GRADE) {
      loadQuote(profile).then(quotes => {
        if (quotes && requestId === sheetRequest && visibleSheet()) showSheetPrice(profile, quotes);
      }).catch(() => {});
    }
  });
  document.addEventListener('pointerover', enter);
  document.addEventListener('pointerout', leave);
  document.addEventListener('focusin', enter);
  document.addEventListener('focusout', leave);
  document.addEventListener('scroll', remove, { capture: true, passive: true });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') remove(); });
})();
