// Mostra cotações validadas no banco da extensão sem alterar os filtros do jogo.
(() => {
  const SCALES = { mil: 1000, k: 1000, mi: 1000000, m: 1000000, bi: 1000000000, b: 1000000000 };
  const millions = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 6 });
  const gems = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });
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

  function quoteBadge({ quote, actualPrice, unread, currency, excluded }) {
    if (excluded) return { label: '✕', range: 'Pokémon de Outland excluído da precificação.', tone: 'above' };
    if (unread) return { label: 'Sem dados', range: 'O Sniper ainda não conseguiu conferir este anúncio.', tone: 'neutral' };
    if (!quote) return { label: 'Sem estimativa', range: '', tone: 'neutral' };
    const { lower, median, upper, indicative } = quote;
    const delta = (actualPrice - median) / median;
    const formatted = percent.format(delta < 0 ? -delta : actualPrice / median);
    const variation = delta < 0 ? (formatted === '0%' ? '<0,1%' : formatted) :
      delta > 0 && formatted === '100%' ? '>100%' : formatted;
    const amount = value => {
      if (currency === 'orb') return value < 1000 ? gems.format(value) : gems.format(value / 1000) + 'K';
      const valueInMillions = value / SCALES.mi;
      const decimals = valueInMillions >= 0.01 ? 2 : 6;
      return millions.format(Number(valueInMillions.toFixed(decimals))) + 'MI';
    };
    return {
      label: '≈' + amount(median) + (currency === 'orb' ? ' 💎 ' : ' ') + variation,
      range: 'Faixa ' + amount(lower) + '–' + amount(upper) +
        (currency === 'orb' ? ' Gemas · Base pública do Briaoale' : '') +
        (indicative ? ' · Indicativa' : ''),
      tone: delta === 0 ? 'neutral' : delta < 0 ? 'below' : 'above',
    };
  }

  if (typeof module === 'object' && module.exports) { module.exports = { readPrice, displayPrice, quoteBadge }; return; }
  const key = offer => JSON.stringify([offer.currency, offer.id, offer.price]);
  let market;
  const quotes = new Map();
  const REUSE_MS = 10 * 60000;
  const REFRESH_MS = 5000;
  const MIN_QUERY_INTERVAL_MS = 1800;
  const OBSERVATION_TTL_MS = 10 * 60000;
  const MAX_QUOTES = 1200;
  let lastQuery = 0;
  let lastKeys = '';
  let pending = 0;
  let scheduled = false;
  let revision = 0;
  let retryTimer = null;
  let contextInvalidated = false;
  const badges = new WeakMap();
  const visibleCurrencies = new Map();
  // Observações reais do MAIN: a precificação pode ser exibida antes do
  // processamento da fila, sem depender de um anúncio já gravado no banco.
  const observedListings = new Map();
  const PRICE = '.cm-rodape .cm-preco';

  function identify(card) {
    const id = [card.dataset.anuncioId, card.dataset.listingId, card.querySelector('[data-fav]')?.dataset.fav]
      .find(value => /^[A-Za-z0-9_-]{1,64}$/.test(value ?? '')) ?? null;
    const node = card.querySelector(PRICE);
    if (!node) return null;
    const hint = visibleCurrencies.get(id);
    const seen = hint && Date.now() - hint.at < 600000;
    const pokemon = seen || card.matches('.poke, [data-tipo="pokemon"]') ||
      [...card.querySelectorAll('button, a, [role="button"]')].some(button => /^ver ficha$/i.test(button.textContent.trim()));
    const icons = [...node.querySelectorAll('img')].map(image =>
      [image.alt, image.title, image.getAttribute('src')?.split('/').at(-1)?.split(/[.?]/)[0]].join(' ')).join(' ');
    const classifications = [node.dataset.moeda, card.dataset.moeda, ...node.classList, icons,
      node.getAttribute('aria-label'), node.textContent].filter(Boolean).join(' ').replaceAll('_', ' ');
    const coins = /(?:\b(?:gold|coins?|ouro)\b|🪙)/iu.test(classifications);
    const gems = /(?:\b(?:orb|gemas?|gems?|diamond)\b|💎)/iu.test(classifications);
    if (coins && gems) return null;
    const currency = coins ? 'gold' : gems ? 'orb' : seen ? hint.currency : null;
    if (!currency || (!pokemon && !id)) return null;
    const shown = displayPrice(node.dataset.preco, currency) ?? displayPrice(node.textContent, currency);
    return { id, currency, pokemon: Boolean(pokemon), ...shown };
  }

  function render(card, offer) {
    const previous = badges.get(card);
    const signature = offer ? JSON.stringify(offer) : null;
    if (previous?.signature === signature && previous.host.isConnected) return;
    previous?.host.remove();
    badges.delete(card);
    if (!offer) return;
    const price = card.querySelector(PRICE);
    if (!price) return;
    const host = document.createElement('span');
    host.dataset[offer.currency === 'gold' ? 'pisCoinQuote' : 'pisGemQuote'] = '';
    Object.assign(host.style, {
      display: 'inline-flex', flex: '0 0 auto', alignSelf: 'center',
      marginInlineStart: '4px', verticalAlign: 'middle',
    });
    const shadow = host.attachShadow({ mode: 'open' });
    const copy = quoteBadge(offer);
    const badge = document.createElement('span');
    const palettes = {
      below: { fill: '#24533e', edge: '#4c8a6d' },
      above: { fill: '#8f2535', edge: '#cf5866' },
      neutral: { fill: '#3c3a53', edge: '#696481' },
    };
    const palette = palettes[copy.tone];
    Object.assign(badge.style, {
      display: 'inline-block', boxSizing: 'border-box', padding: '1px 4px', color: '#fff',
      background: palette.fill, borderTop: '1px solid ' + palette.edge, borderRadius: '3px',
      font: '700 9px/1.2 system-ui', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
    });
    badge.textContent = copy.label;
    host.title = copy.range || (offer.currency === 'orb'
      ? 'Sem estimativa na base pública de Gemas' : 'Sem estimativa em Coins');
    host.setAttribute('aria-label', copy.range ? copy.label + '. ' + copy.range : host.title);
    shadow.append(badge);
    // O Shadow DOM mantém o texto do selo fora da leitura do preço do jogo.
    price.append(host);
    badges.set(card, { host, signature });
  }

  function cachedQuote(offer, identity, now) {
    const entry = identity && quotes.get(identity);
    if (!entry) return null;
    if (now >= entry.until || !PISMarketCore.matchesDisplayPrice(entry.row.actualPrice, offer)) {
      quotes.delete(identity);
      return null;
    }
    return entry;
  }

  function visible() {
    const offers = new Map();
    if (!market?.isConnected || !market.getClientRects().length) return offers;
    const now = Date.now();
    for (const card of market.querySelectorAll('.cm-card')) {
      const offer = identify(card);
      const identity = offer?.id && offer.price ? key(offer) : null;
      if (identity && offers.size < 100) offers.set(identity, offer);
      const observation = visibleCurrencies.get(offer?.id);
      const excluded = identity && observation?.excluded && !observation.closed &&
        observation.currency === offer.currency && now - observation.at < REUSE_MS &&
        PISMarketCore.matchesDisplayPrice(observation.price, offer);
      const fallback = offer?.pokemon ? { currency: offer.currency, unread: true } : null;
      const cached = cachedQuote(offer, identity, now);
      render(card, excluded ? { currency: offer.currency, excluded: true } : cached?.row ?? fallback);
    }
    return offers;
  }

  async function refresh() {
    if (contextInvalidated) return;
    const offers = visible();
    const keys = [...offers.keys()].sort().join('\n');
    const elapsed = Date.now() - lastQuery;
    // Mensagens de vitrine podem chegar dezenas de vezes por segundo. Mesmo
    // com chaves novas, não sobrecarregar o worker com consultas concorrentes.
    const changedPage = keys !== lastKeys;
    // Uma cotação antiga pode estar lenta: a página que acabou de ser aberta
    // pode iniciar imediatamente outra consulta, com até duas simultâneas.
    // Não envia consultas ao WebSocket (apenas ao service worker/IndexedDB).
    if (!offers.size || pending >= 2 ||
        (!changedPage && (pending > 0 || elapsed < REFRESH_MS ||
          elapsed < MIN_QUERY_INTERVAL_MS))) return;
    const token = revision;
    pending++;
    lastQuery = Date.now();
    lastKeys = keys;
    try {
      const now = Date.now();
      const observations = [...offers].map(([identity]) => observedListings.get(identity))
        .filter(entry => entry && now - entry.at < OBSERVATION_TTL_MS)
        .map(entry => entry.row);
      // Não permitir que uma Promise de mensagem pendurada congele o painel.
      let timeoutId;
      const timeout = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('consulta de cotações expirou')), 12000);
      });
      let response;
      try {
        response = await Promise.race([chrome.runtime.sendMessage({ type: 'PIS_MARKET_BADGES',
          offers: [...offers.values()], observations }), timeout]);
      } finally { clearTimeout(timeoutId); }
      if (response?.ok === false || !Array.isArray(response?.offers)) throw new Error(response?.error || 'cotações indisponíveis');
      if (token === revision && Array.isArray(response?.offers)) {
        const rows = new Map(response.offers.map(row => [key(row), row]));
        const now = Date.now();
        for (const [identity, offer] of offers) {
          const row = rows.get(identity);
          const latest = visibleCurrencies.get(offer.id);
          if (!row || !PISMarketCore.matchesDisplayPrice(row.actualPrice, offer) ||
              (latest?.currency === offer.currency &&
                (latest.closed || Number.isSafeInteger(latest.price) && latest.price !== row.actualPrice))) continue;
          quotes.delete(identity);
          quotes.set(identity, { row, until: Math.min(now + REUSE_MS, row.validUntil ?? Infinity) });
        }
        while (quotes.size > MAX_QUOTES) quotes.delete(quotes.keys().next().value);
      }
    } catch {
      // Não memorizar uma consulta que falhou: a próxima tentativa deve ocorrer
      // mesmo que os mesmos 24 cards ainda estejam na tela.
      lastKeys = '';
      lastQuery = 0;
      if (!retryTimer && !contextInvalidated) retryTimer = setTimeout(() => {
        retryTimer = null;
        if (market?.isConnected) schedule();
      }, 5000);
    } finally {
      pending = Math.max(0, pending - 1);
      if (lastKeys !== keys || [...visible().keys()].sort().join('\n') !== keys) schedule();
    }
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; void refresh(); });
  }

  window.addEventListener('message', event => {
    const data = event.data;
    if (event.source !== window || event.origin !== location.origin) return;
    if (data?.source === 'PIS_BRIDGE' &&
        (data.type === 'EXTENSION_CONTEXT_INVALIDATED' ||
         data.type === 'BRIDGE_STATUS' && data.state === 'invalid')) {
      contextInvalidated = true;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
      return;
    }
    if (data?.source === 'PIS_BRIDGE' && data.type === 'BRIDGE_STATUS') {
      if (data.state === 'ready') {
        contextInvalidated = false;
        lastKeys = '';
        lastQuery = 0;
        pending = 0;
        revision++;
        if (market?.isConnected) schedule();
      }
      // 'reconnecting' é transitório: mantém os retries e as observações.
      return;
    }
    if (data?.source === 'PIS_BRIDGE' && data.type === 'MARKET_LISTINGS_SAVED') {
      lastKeys = '';
      if (market?.isConnected) schedule();
      return;
    }
    if (data?.source !== 'PIS_MAIN' ||
        data.type !== 'MARKET_CORE_BATCH' || data.kind !== 'listing' || !Array.isArray(data.rows) ||
        data.rows.length > 100) return;
    const now = Date.now();
    const observed = new Map();
    for (const row of data.rows) {
      if (!['gold', 'orb'].includes(row?.currency) || !/^[A-Za-z0-9_-]{1,64}$/.test(row.id ?? '')) continue;
      const observation = { currency: row.currency, price: row.price, closed: row.closed, excluded: PISMarketCore.isOutland(row), at: now };
      visibleCurrencies.delete(row.id);
      visibleCurrencies.set(row.id, observation);
      observed.set(row.id, observation);
      if (Number.isSafeInteger(row.price) && row.price > 0 && row.closed !== true && !row.closed) {
        const identity = key(row);
        observedListings.delete(identity);
        observedListings.set(identity, { row, at: now });
      }
    }
    for (const [identity, entry] of quotes) {
      const update = observed.get(entry.row.id);
      if (update?.currency === entry.row.currency &&
          (update.closed || Number.isSafeInteger(update.price) && update.price !== entry.row.actualPrice))
        quotes.delete(identity);
    }
    while (visibleCurrencies.size > 500) visibleCurrencies.delete(visibleCurrencies.keys().next().value);
    for (const [identity, entry] of observedListings) {
      if (now - entry.at > OBSERVATION_TTL_MS) observedListings.delete(identity);
    }
    while (observedListings.size > 500) observedListings.delete(observedListings.keys().next().value);
    if (observed.size) lastKeys = '';
    if (market?.isConnected) schedule();
  });

  const cards = new MutationObserver(schedule);
  function discover() {
    const next = document.getElementById('cm-lista');
    if (next === market) return;
    market = next;
    cards.disconnect();
    if (market) cards.observe(market, { subtree: true, childList: true, characterData: true,
      attributes: true, attributeFilter: ['data-fav', 'data-anuncio-id', 'data-listing-id', 'data-moeda', 'data-preco', 'class', 'src', 'alt'] });
    schedule();
  }
  new MutationObserver(discover).observe(document, { childList: true, subtree: true });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const source = changes.pisPublicGemsCheck;
    if (!source?.newValue?.ok || source.newValue.sourceAt === source.oldValue?.sourceAt) return;
    revision++;
    lastKeys = '';
    for (const [identity, entry] of quotes) if (entry.row.currency === 'orb') quotes.delete(identity);
    schedule();
  });
  setInterval(() => { if (market?.isConnected) schedule(); }, REFRESH_MS);
  discover();
})();
