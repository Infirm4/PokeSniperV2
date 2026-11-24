// Ponto de entrada da interface da extensão, isolado dos estilos do jogo.
(() => {
  if (window !== window.top) return;
  const panelUrl = chrome.runtime.getURL('opportunities.html');
  const url = new URL(panelUrl);
  const panelOrigin = `${url.protocol}//${url.host}`;
  const host = document.createElement('div');
  const root = host.attachShadow({ mode: 'closed' });
  const style = new CSSStyleSheet();
  style.replaceSync(`
    :host {
      all: initial !important;
      position: fixed !important;
      left: max(10px, env(safe-area-inset-left)) !important;
      bottom: max(10px, env(safe-area-inset-bottom)) !important;
      z-index: 2147483646 !important;
    }
    .pis-v2-launcher {
      display: block;
      padding: 8px 12px;
      border: 1px solid #74578b;
      border-radius: 9px;
      background: #2e1e40;
      color: #f7f0fc;
      font: 700 12px/1.35 system-ui, sans-serif;
      box-shadow: 0 4px 12px #12091ca0;
      cursor: pointer;
    }
    .pis-v2-launcher:hover, .pis-v2-launcher[aria-expanded="true"] {
      background: #442960;
      border-color: #bd91ff;
    }
    .pis-v2-launcher:focus-visible { outline: 2px solid #bd91ff; outline-offset: 2px; }
    .pis-v2-frame {
      position: absolute;
      left: 0;
      bottom: calc(100% + 8px);
      width: min(360px, calc(100vw - 24px));
      height: min(var(--pis-v2-height, 290px), 520px, calc(100dvh - 62px));
      box-sizing: content-box;
      border: 1px solid #694987;
      border-radius: 12px;
      background: #17111f;
      box-shadow: 0 12px 30px #14091db3;
      opacity: 0;
      visibility: hidden;
      pointer-events: none;
      transform: translateY(6px);
      transition: opacity 150ms ease, transform 150ms ease, visibility 150ms;
    }
    .pis-v2-frame[data-open="true"] {
      opacity: 1;
      visibility: visible;
      pointer-events: auto;
      transform: none;
    }
    @media (prefers-reduced-motion: reduce) {
      .pis-v2-frame { transition: none; }
    }
  `);
  root.adoptedStyleSheets = [style];

  const launcher = document.createElement('button');
  launcher.className = 'pis-v2-launcher';
  launcher.type = 'button';
  launcher.textContent = 'Poke Sniper V2';
  launcher.setAttribute('aria-expanded', 'false');
  root.append(launcher);
  let frame, open = false, panelReady = false;

  const sendVisibility = () => {
    // iframe recém-criado ainda contém about:blank (origin do jogo).
    if (!panelReady || !frame?.contentWindow) return;
    try {
      frame.contentWindow.postMessage({ type: 'PIS_V2_PANEL_VISIBILITY', open }, panelOrigin);
    } catch (error) {
      // Um iframe navegando ou removido não pode derrubar o monitor.
      console.debug('[PIS] Painel ainda não pronto:', error?.message);
    }
  };

  function setOpen(value) {
    open = value;
    if (!frame) {
      frame = document.createElement('iframe');
      frame.className = 'pis-v2-frame';
      frame.id = 'pis-v2-frame';
      frame.title = 'Painel Poke Sniper V2';
      frame.allow = 'clipboard-write';
      frame.addEventListener('load', () => { panelReady = true; sendVisibility(); });
      frame.src = panelUrl;
      root.append(frame);
      launcher.setAttribute('aria-controls', frame.id);
    }
    frame.dataset.open = String(open);
    frame.inert = !open;
    frame.setAttribute('aria-hidden', String(!open));
    launcher.setAttribute('aria-expanded', String(open));
    sendVisibility();
    if (!open) launcher.focus();
  }

  launcher.addEventListener('click', () => setOpen(!open));
  window.addEventListener('message', event => {
    if (event.origin !== panelOrigin || !frame || event.source !== frame.contentWindow) return;
    if (event.data?.type === 'PIS_V2_CLOSE_PANEL') setOpen(false);
    if (event.data?.type === 'PIS_V2_PANEL_SIZE' && Number.isFinite(event.data.height)) {
      const height = Math.min(520, Math.max(225, Math.ceil(event.data.height)));
      frame.style.setProperty('--pis-v2-height', height + 'px');
    }
  });
  const mount = () => document.documentElement.append(host);
  if (document.documentElement) mount();
  else document.addEventListener('DOMContentLoaded', mount, { once: true });
})();
