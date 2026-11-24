// Renderização dos marcadores nos cards e sincronização com o DOM reativo do jogo.
(function (root) {
  const Icons = typeof module === 'object' && module.exports ? require('./icons.js') : root.PIMIcons;
  const ListingId = typeof module === 'object' && module.exports ? require('./listing-id.js') : root.PIMListingId;

  // Ponto de ajuste fino: seletor do card de anúncio, usado na vitrine e nos favoritos.
  const CARD_SELECTOR = '.cm-card';
  const HOST_ATTR = 'data-pim-host';
  const OBSERVED_ATTRIBUTES = ['data-anuncio-id', 'data-listing-id', 'data-fav'];
  const DEBOUNCE_MS = 80;

  const STYLE = `
    :host { all: initial; }
    .bar { display: flex; gap: 2px; padding: 2px; border-radius: 6px; background: rgba(12, 10, 22, .72); }
    button { all: unset; box-sizing: border-box; display: block; width: 18px; height: 18px; padding: 1px;
      cursor: pointer; border-radius: 4px; }
    button svg { display: block; width: 100%; height: 100%; }
    .pick button { opacity: .38; transition: opacity .12s, transform .12s; }
    .pick button:hover, .pick button:focus-visible { opacity: 1; transform: scale(1.12); }
    .on button { opacity: 1; width: 20px; height: 20px; }
    .on button:hover, .on button:focus-visible { opacity: .75; }
    button:focus-visible { outline: 2px solid #bd91ff; outline-offset: 1px; }
  `;

  const isOwn = node => node?.nodeType === 1 && node.hasAttribute(HOST_ATTR);

  function createUI({ document, store, getComputedStyle: computed = globalThis.getComputedStyle }) {
    function outermostCards(scope) {
      return [...scope.querySelectorAll(CARD_SELECTOR)].filter(card => !card.parentElement?.closest(CARD_SELECTOR));
    }

    // O marcador é posicionado de forma absoluta; o card precisa ser a âncora.
    function ensureAnchor(card) {
      if (computed(card).position === 'static') {
        card.style.position = 'relative';
        card.dataset.pimAnchored = '1';
      }
    }

    function buildHost(key, mark) {
      const host = document.createElement('span');
      host.setAttribute(HOST_ATTR, '');
      host.dataset.pimSig = key + '|' + (mark ?? '');
      Object.assign(host.style, { position: 'absolute', top: '3px', left: '3px', zIndex: '6' });
      const shadow = host.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.textContent = STYLE;
      const bar = document.createElement('div');
      bar.className = mark ? 'bar on' : 'bar pick';
      for (const type of mark ? [mark] : Icons.TYPES) {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.type = type;
        const label = Icons.LABELS[type];
        button.title = mark ? label + ' — clique para remover' : 'Marcar com ' + label;
        button.setAttribute('aria-label', button.title);
        button.innerHTML = Icons.SVG[type];
        bar.append(button);
      }
      shadow.append(style, bar);

      // Os cliques não podem chegar ao card, que abre a ficha do Pokémon.
      for (const name of ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'touchstart', 'dblclick'])
        host.addEventListener(name, event => event.stopPropagation());
      host.addEventListener('click', event => {
        event.stopPropagation();
        const button = event.composedPath().find(node => node?.dataset?.type);
        if (!button) return;
        if (mark) store.clear(key); else store.set(key, button.dataset.type);
      });
      host.addEventListener('contextmenu', event => {
        if (!mark) return;
        event.preventDefault();
        event.stopPropagation();
        store.clear(key);
      });
      return host;
    }

    // Idempotente: no máximo um marcador por card, refeito só quando chave ou marcação mudam.
    function syncCard(card) {
      const hosts = [...card.children].filter(isOwn);
      hosts.slice(1).forEach(extra => extra.remove());
      const current = hosts[0];
      const key = ListingId.listingKey(card);
      if (!key) { current?.remove(); return; }
      const mark = store.get(key);
      if (current?.dataset.pimSig === key + '|' + (mark ?? '')) { ensureAnchor(card); return; }
      const next = buildHost(key, mark);
      if (current) current.replaceWith(next); else card.append(next);
      ensureAnchor(card);
    }

    function reconcile(scope = document) {
      for (const card of outermostCards(scope)) syncCard(card);
    }

    function start(win = globalThis) {
      let timer = null;
      const schedule = () => {
        if (timer) return;
        timer = win.setTimeout(() => { timer = null; reconcile(); }, DEBOUNCE_MS);
      };
      // Mutações causadas só pelos nossos próprios elementos não disparam nova passada.
      const observer = new win.MutationObserver(records => {
        const relevant = records.some(record => record.type === 'attributes' ||
          [...record.addedNodes, ...record.removedNodes].some(node => !isOwn(node)));
        if (relevant) schedule();
      });
      observer.observe(document.documentElement, {
        subtree: true, childList: true, attributes: true, attributeFilter: OBSERVED_ATTRIBUTES,
      });
      store.onChange(schedule);
      win.addEventListener?.('pageshow', schedule);
      reconcile();
      return { stop: () => { observer.disconnect(); if (timer) win.clearTimeout(timer); } };
    }

    return { reconcile, syncCard, start };
  }

  const api = { createUI, CARD_SELECTOR, HOST_ATTR };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PIMUI = api;
})(typeof self !== 'undefined' ? self : globalThis);
