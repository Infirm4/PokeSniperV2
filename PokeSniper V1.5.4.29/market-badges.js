// Anota oportunidades validadas no banco da extensão sem alterar os filtros do jogo.
(() => {
  function readPrice(value, currency) {
    const text = String(value ?? '').trim().toLowerCase()
      .replace(/^[🪙💎]\s*/u, '').replace(/\s*(?:coins|gemas?)$/, '');
    const match = /^(\d+(?:[.,]\d+)*)\s*(mil|mi|bi|k|m|b)?$/.exec(text);
    if (!match || (match[2] && currency !== 'gold')) return null;
    const number = /^\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(match[1])
      ? match[1].replace(/\./g, '').replace(',', '.') : match[1].replace(',', '.');
    if (!match[2] && !/^\d+$/.test(number)) return null;
    const scale = { mil: 1000, k: 1000, mi: 1000000, m: 1000000, bi: 1000000000, b: 1000000000 };
    const price = Math.round(Number(number) * (scale[match[2]] ?? 1));
    return Number.isSafeInteger(price) && price > 0 ? price : null;
  }

  if (typeof module === 'object' && module.exports) { module.exports = { readPrice }; return; }
  const key = offer => JSON.stringify([offer.currency, offer.id, offer.price]);
  let market;
  let current = new Map();
  let lastQuery = 0;
  let lastKeys = '';
  let pending = false;
  let scheduled = false;
  let revision = 0;
  const badges = new WeakMap();

  function identify(card) {
    const id = card.querySelector('button.cm-fav[data-fav]')?.dataset.fav;
    const node = card.querySelector('.cm-rodape > .cm-preco');
    if (!node || !/^[A-Za-z0-9_-]{1,64}$/.test(id ?? '')) return null;
    const denominations = new Set(['gold', 'orb'].filter(value => node.classList.contains(value) || node.dataset.moeda === value));
    if (denominations.size !== 1) return null;
    const [currency] = denominations;
    const price = readPrice(node.dataset.preco ?? node.textContent, currency);
    return price == null ? null : { id, currency, price };
  }

  function render(card, offer) {
    const previous = badges.get(card);
    const signature = offer ? JSON.stringify(offer) : null;
    if (previous?.signature === signature && previous.host.isConnected) return;
    previous?.host.remove();
    badges.delete(card);
    if (!offer) return;
    const footer = card.querySelector('.cm-rodape');
    if (!footer) return;
    const host = document.createElement('div');
    host.dataset.pisOpportunity = '';
    const shadow = host.attachShadow({ mode: 'open' });
    const line = document.createElement('div');
    Object.assign(line.style, { display: 'flex', alignItems: 'center', gap: '4px', padding: '3px',
      color: '#d2f4e4', background: '#273d3a', borderRadius: '4px', font: '600 10px system-ui' });
    const sprite = document.createElement('img');
    sprite.alt = '';
    Object.assign(sprite.style, { width: '22px', height: '22px', objectFit: 'contain', imageRendering: 'pixelated' });
    if (PISOpportunities.mountSprite(sprite, (offer.sprites ?? []).map(PISMarketCore.safeSprite).filter(Boolean))) line.append(sprite);
    line.append(document.createTextNode(offer.discount + ' · ' + offer.asking));
    shadow.append(line);
    footer.append(host);
    badges.set(card, { host, signature });
  }

  function visible() {
    const offers = new Map();
    if (!market?.isConnected || !market.getClientRects().length) return offers;
    for (const card of market.querySelectorAll('.cm-card')) {
      const offer = identify(card);
      const identity = offer && key(offer);
      if (offer && offers.size < 100) offers.set(identity, offer);
      render(card, identity ? current.get(identity) : null);
    }
    return offers;
  }

  async function refresh() {
    const offers = visible();
    const keys = [...offers.keys()].sort().join('\n');
    if (!offers.size || pending || (keys === lastKeys && Date.now() - lastQuery < 5000)) return;
    const token = revision;
    pending = true;
    lastQuery = Date.now();
    lastKeys = keys;
    try {
      const response = await chrome.runtime.sendMessage({ type: 'PIS_MARKET_BADGES', offers: [...offers.values()] });
      if (token === revision) current = new Map((response?.offers ?? []).filter(row => offers.has(key(row))).map(row => [key(row), row]));
    } catch { if (token === revision) current.clear(); }
    finally { pending = false; visible(); }
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; void refresh(); });
  }

  const cards = new MutationObserver(schedule);
  function discover() {
    const next = document.getElementById('cm-lista');
    if (next === market) return;
    market = next;
    cards.disconnect();
    if (market) cards.observe(market, { subtree: true, childList: true, characterData: true,
      attributes: true, attributeFilter: ['data-fav', 'data-moeda', 'data-preco', 'class'] });
    schedule();
  }
  new MutationObserver(discover).observe(document, { childList: true, subtree: true });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.opportunitySettings) return;
    revision++;
    lastKeys = '';
    current.clear();
    schedule();
  });
  setInterval(() => { if (market?.isConnected) schedule(); }, 5000);
  discover();
})();
