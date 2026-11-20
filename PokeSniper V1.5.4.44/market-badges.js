// Anota oportunidades validadas no banco da extensão sem alterar os filtros do jogo.
(() => {
  const SCALES = { mil: 1000, k: 1000, mi: 1000000, m: 1000000, bi: 1000000000, b: 1000000000 };
  const compact = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 2 });
  const percent = new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 1 });

  function displayPrice(value, currency) {
    const text = String(value ?? '').trim().toLowerCase()
      .replace(/^[🪙💎]\s*/u, '').replace(/\s*(?:coins|gemas?)$/, '');
    const match = /^(\d+(?:[.,]\d+)*)\s*(mil|mi|bi|k|m|b)?$/.exec(text);
    if (!match || (match[2] && currency !== 'gold')) return null;
    const number = /^\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(match[1])
      ? match[1].replace(/\./g, '').replace(',', '.') : match[1].replace(',', '.');
    if (!match[2] && !/^\d+$/.test(number)) return null;
    const scale = SCALES[match[2]] ?? 1;
    const price = Math.round(Number(number) * scale);
    const priceTick = Math.max(1, scale / 10 ** (number.split('.')[1]?.length ?? 0));
    return Number.isSafeInteger(price) && price > 0 ? { price, priceTick } : null;
  }

  function readPrice(value, currency) { return displayPrice(value, currency)?.price ?? null; }

  function coinBadge({ quote, actualPrice }) {
    if (!quote) return { label: 'Sem estimativa em Coins', range: '', tone: 'neutral' };
    const { lower, median, upper, indicative } = quote;
    const delta = (actualPrice - median) / median;
    const formatted = percent.format(delta < 0 ? -delta : actualPrice / median);
    const variation = delta < 0 ? (formatted === '0%' ? '<0,1%' : formatted) + ' de desconto' :
      delta > 0 && formatted === '100%' ? '>100%' : formatted;
    const amount = value => compact.format(value)
      .replace(/\b(?:mi|bi)$/, unit => unit[0].toUpperCase() + unit.slice(1));
    return {
      label: '≈' + amount(median) + ' ~ ' + variation,
      range: 'Faixa ' + amount(lower) + '–' + amount(upper) + (indicative ? ' · Indicativa' : ''),
      tone: delta === 0 || indicative ? 'neutral' : delta < 0 ? 'below' : 'above',
    };
  }

  if (typeof module === 'object' && module.exports) { module.exports = { readPrice, displayPrice, coinBadge }; return; }
  const key = offer => JSON.stringify([offer.currency, offer.id, offer.price]);
  let market;
  let current = new Map();
  let lastQuery = 0;
  let lastKeys = '';
  let pending = false;
  let scheduled = false;
  let revision = 0;
  const badges = new WeakMap();
  const visibleCurrencies = new Map();

  function identify(card) {
    const id = card.querySelector('button.cm-fav[data-fav]')?.dataset.fav;
    const node = card.querySelector('.cm-rodape > .cm-preco');
    if (!node || !/^[A-Za-z0-9_-]{1,64}$/.test(id ?? '')) return null;
    const denominations = ['gold', 'orb'].filter(value => node.classList.contains(value) || node.dataset.moeda === value);
    if (denominations.length > 1) return null;
    const hint = visibleCurrencies.get(id);
    const currency = denominations[0] ?? (hint?.currency === 'gold' && Date.now() - hint.at < 600000 ? 'gold' : null);
    if (!currency) return null;
    const shown = displayPrice(node.dataset.preco ?? node.textContent, currency);
    return shown ? { id, currency, ...shown } : null;
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
    if (offer.currency === 'gold') {
      const host = document.createElement('div');
      host.dataset.pisCoinQuote = '';
      const shadow = host.attachShadow({ mode: 'open' });
      const copy = coinBadge(offer);
      const badge = document.createElement('div');
      const colors = { below: '#a5f3da', above: '#ffb9b0', neutral: '#dce1ee' };
      Object.assign(badge.style, {
        display: 'grid', gap: '2px', padding: '4px 6px', margin: '3px 0', boxSizing: 'border-box',
        color: '#fff', background: '#242435', borderInlineStart: '2px solid ' + colors[copy.tone],
        borderRadius: '3px', font: '600 10px/1.25 system-ui', fontVariantNumeric: 'tabular-nums',
      });
      const label = document.createElement('span');
      label.textContent = copy.label;
      badge.append(label);
      if (copy.range) {
        const range = document.createElement('span');
        range.textContent = copy.range;
        range.style.fontWeight = '400';
        badge.append(range);
      }
      shadow.append(badge);
      footer.querySelector('.cm-preco')?.after(host);
      badges.set(card, { host, signature });
      return;
    }
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
    finally {
      pending = false;
      if ([...visible().keys()].sort().join('\n') !== keys) schedule();
    }
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; void refresh(); });
  }

  window.addEventListener('message', event => {
    const data = event.data;
    if (event.source !== window || event.origin !== location.origin || data?.source !== 'PIS_MAIN' ||
        data.type !== 'MARKET_CORE_BATCH' || data.kind !== 'listing' || !Array.isArray(data.rows) ||
        data.rows.length > 100) return;
    const now = Date.now();
    for (const row of data.rows) {
      if (!['gold', 'orb'].includes(row?.currency) || !/^[A-Za-z0-9_-]{1,64}$/.test(row.id ?? '')) continue;
      visibleCurrencies.delete(row.id);
      visibleCurrencies.set(row.id, { currency: row.currency, at: now });
    }
    while (visibleCurrencies.size > 500) visibleCurrencies.delete(visibleCurrencies.keys().next().value);
    if (market?.isConnected) schedule();
  });

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
