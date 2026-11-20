// Exibe avisos enviados pelo service worker na aba do jogo.
(() => {
  const MAX_VISIBLE = 3;
  const DURATION_MS = 9000;
  const visible = new Map();
  let host;
  let container;

  function mount() {
    if (host?.isConnected) return true;
    if (!document.documentElement) return false;
    for (const entry of visible.values()) clearTimeout(entry.timer);
    visible.clear();

    host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'closed' });
    const style = new CSSStyleSheet();
    style.replaceSync(`
      :host {
        all: initial !important;
        position: fixed !important;
        top: 16px !important;
        right: 16px !important;
        width: min(350px, calc(100vw - 32px)) !important;
        z-index: 2147483647 !important;
        pointer-events: none !important;
      }
      .stack { display: grid; gap: 8px; }
      .notice {
        box-sizing: border-box;
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 4px 12px;
        padding: 12px 14px;
        background: #231930;
        color: #faf5ff;
        border: 1px solid #785393;
        border-inline-start: 4px solid #d5a7fb;
        border-radius: 8px;
        box-shadow: 0 4px 12px #100a19aa;
        pointer-events: auto;
        font: 14px/1.35 system-ui, sans-serif;
        overflow-wrap: anywhere;
      }
      .notice.with-sprite { grid-template-columns: 42px minmax(0, 1fr) auto; }
      .notice.with-sprite strong, .notice.with-sprite p { grid-column: 2; }
      .notice.with-sprite button { grid-column: 3; }
      .sprite { grid-column: 1; grid-row: 1 / span 2; width: 42px; height: 42px;
        align-self: center; object-fit: contain; image-rendering: pixelated; }
      .notice.test { border-inline-start-color: #8ad6f5; }
      strong { grid-column: 1; }
      p { grid-column: 1; margin: 0; color: #ebdff4; white-space: pre-line; }
      button {
        grid-column: 2;
        grid-row: 1 / span 2;
        align-self: start;
        border: 0;
        border-radius: 4px;
        padding: 2px 6px;
        color: inherit;
        background: transparent;
        font: inherit;
        cursor: pointer;
      }
      .notice .review { grid-column: 1 / -1; grid-row: auto; justify-self: start; border: 1px solid #a879a2; }
      button:hover, button:focus-visible { background: #52376a; }
    `);
    container = document.createElement('div');
    container.className = 'stack';
    container.setAttribute('aria-live', 'polite');
    container.setAttribute('aria-relevant', 'additions text');
    shadow.adoptedStyleSheets = [style];
    shadow.append(container);
    document.documentElement.append(host);
    return true;
  }

  function remove(key) {
    const entry = visible.get(key);
    if (!entry) return;
    clearTimeout(entry.timer);
    entry.element.remove();
    visible.delete(key);
  }

  async function review(value, demo = false) {
    const offer = PISMarketCore.purchaseOffer(value);
    if (!offer) return false;
    const requestId = crypto.randomUUID();
    return new Promise(resolve => {
      const receive = event => {
        if (event.source === window && event.origin === location.origin && event.data?.source === 'PIS_MAIN' &&
            event.data.type === 'REVIEW_POKEMON_RESULT' && event.data.requestId === requestId) finish(event.data.ok === true);
      };
      function finish(ok) {
        clearTimeout(timer);
        window.removeEventListener('message', receive);
        resolve(ok);
      }
      const timer = setTimeout(() => finish(false), 2500);
      window.addEventListener('message', receive);
      window.postMessage({ source: 'PIS_BRIDGE', type: 'REVIEW_POKEMON', offer, demo, requestId }, location.origin);
    });
  }

  function show(title, message, test, sprite, offer, spriteFallback) {
    if (!mount()) return false;
    const key = JSON.stringify([title, message, test, sprite, offer?.id]);
    if (visible.has(key)) {
      const entry = visible.get(key);
      clearTimeout(entry.timer);
      entry.timer = setTimeout(() => remove(key), DURATION_MS);
      return true;
    }
    if (visible.size >= MAX_VISIBLE) remove(visible.keys().next().value);

    const element = document.createElement('div');
    element.className = test ? 'notice test' : 'notice';
    const heading = document.createElement('strong');
    heading.textContent = title;
    const text = document.createElement('p');
    text.textContent = message;
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = '×';
    close.setAttribute('aria-label', 'Fechar aviso');
    close.addEventListener('click', () => remove(key));
    if (sprite) {
      const img = document.createElement('img');
      img.className = 'sprite';
      img.alt = '';
      PISOpportunities.mountSprite(img, [sprite, spriteFallback].filter(Boolean), () => {
        img.remove();
        element.classList.remove('with-sprite');
      });
      element.classList.add('with-sprite');
      element.append(img);
    }
    element.append(heading, text, close);
    if (offer && !test) {
      const checkout = document.createElement('button');
      checkout.className = 'review';
      checkout.type = 'button';
      checkout.textContent = 'Revisar compra';
      checkout.addEventListener('click', async event => {
        if (!event.isTrusted) return;
        checkout.disabled = true;
        if (await review(offer)) remove(key);
        else { checkout.textContent = 'Recarregue o PokéIdle para revisar'; checkout.disabled = false; }
      });
      element.append(checkout);
    }
    container.append(element);
    visible.set(key, { element, timer: setTimeout(() => remove(key), DURATION_MS) });
    return true;
  }

  chrome.runtime.onMessage.addListener((request, sender, reply) => {
    if (sender.id !== chrome.runtime.id) return false;
    if (request?.type === 'PIS_MARKET_REVIEW') {
      review(request.offer, request.demo === true).then(ok => reply({ ok }), () => reply({ ok: false }));
      return true;
    }
    if (request?.type !== 'PIS_MARKET_TOAST') return false;
    const title = typeof request.title === 'string' ? request.title.trim().slice(0, 120) : '';
    const message = typeof request.message === 'string' ? request.message.trim().slice(0, 400) : '';
    reply({ ok: Boolean(title && message && show(title, message, request.test === true, typeof request.sprite === 'string' ? request.sprite : null, PISMarketCore.purchaseOffer(request.offer), PISMarketCore.safeSprite(request.spriteFallback))) });
    return false;
  });
})();
