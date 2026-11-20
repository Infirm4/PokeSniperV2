'use strict';

(() => {
  const LIST = '#caidos-lista, .caidos-lista';
  const AREA = '#caidos';
  const TARGET = 'button.caido, button[data-slot]';
  const PER_CYCLE = 3;
  const RETRY_MS = 5000;

  function canClick(button) {
    return button.isConnected && !button.matches(':disabled, [aria-disabled="true"], [hidden]');
  }

  function createCapture(document, time = () => Date.now()) {
    const recent = new WeakMap();
    const slots = new Map();

    return function capture() {
      const lists = [...document.querySelectorAll(LIST)];
      const area = document.querySelector(AREA);
      if (!lists.length && !area) return { status: 'sem_lista', clicks: 0, found: 0 };

      let found = 0, ready = [], source;
      // Uma lista vazia ou bloqueada pode continuar montada atrás de outro painel.
      for (const list of lists) {
        const buttons = [...list.querySelectorAll(TARGET)];
        found = Math.max(found, buttons.length);
        ready = buttons.filter(canClick);
        if (!ready.length) continue;
        found = buttons.length;
        source = list;
        break;
      }
      if (!source && area) {
        // Sem a lista, aceite somente os botões de caídos dentro da área da hunt.
        const buttons = [...area.querySelectorAll('button.caido')];
        found = Math.max(found, buttons.length);
        ready = buttons.filter(canClick);
        if (ready.length) found = buttons.length;
        source = area;
      }
      if (!ready.length) {
        return { status: found ? 'bloqueado' : lists.length ? 'aguardando' : 'sem_lista', clicks: 0, found };
      }

      const now = time();
      for (const [slot, submittedAt] of slots) if (now - submittedAt >= RETRY_MS) slots.delete(slot);

      let clicks = 0;
      for (const button of ready) {
        if (!source.contains(button) || !canClick(button)) continue;
        const specimen = button.dataset.caidoId ?? button.dataset.pokemonId;
        const slot = button.dataset.slot;
        const key = specimen ? JSON.stringify(['pokemon', specimen, slot]) :
          slot != null ? JSON.stringify(['slot', slot, button.textContent.trim()]) : null;
        const previous = recent.get(button);
        if ((previous?.key === key && now - previous.at < RETRY_MS) || (key && slots.has(key))) continue;

        // A lista pode continuar montada e clicável mesmo atrás de um painel.
        recent.set(button, { key, at: now });
        if (key) slots.set(key, now);
        button.click();
        if (++clicks >= PER_CYCLE) break;
      }
      return { status: clicks ? 'clicou' : 'cooldown', clicks, found };
    };
  }

  if (typeof module === 'object' && module.exports) {
    module.exports = { createCapture };
    return;
  }
  if (globalThis.__pokeIdleCaptureLoaded || window !== window.top) return;
  globalThis.__pokeIdleCaptureLoaded = true;

  const capture = createCapture(document);
  let timer;
  let enabled = false;
  let gap = 3000;
  let lastRun = -Infinity;
  let lastResult;

  function stop() {
    enabled = false;
    observer.disconnect();
    clearTimeout(timer);
    timer = undefined;
    lastRun = -Infinity;
    lastResult = undefined;
  }

  function schedule() {
    if (!enabled || timer !== undefined) return;
    timer = setTimeout(() => {
      timer = undefined;
      run();
    }, Math.max(0, gap - (Date.now() - lastRun)));
  }

  function run() {
    if (!enabled) return;
    if (Date.now() - lastRun < gap) {
      schedule();
      return;
    }
    clearTimeout(timer);
    timer = undefined;
    lastRun = Date.now();
    const result = capture();
    const at = Date.now();
    const report = { ...result, at, lastClickAt: result.clicks ? at : lastResult?.lastClickAt };
    if (result.clicks || result.status !== lastResult?.status || result.found !== lastResult?.found) {
      chrome.runtime.sendMessage({ type: 'capture:result', result: report }).catch(() => {});
    }
    lastResult = report;
    schedule();
  }

  const captureArea = `${AREA}, ${LIST}`;
  const observer = new MutationObserver(changes => {
    if (!enabled) return;
    if (changes.some(({ target }) => target.closest?.(captureArea))) run();
  });

  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (sender.id !== chrome.runtime.id) return false;
    if (message?.type === 'capture:stop') {
      stop();
      reply({ ok: true });
    } else if (message?.type === 'capture:run') {
      chrome.storage.local.get('captureSettings').then(({ captureSettings }) => {
        if (captureSettings?.enabled !== true) {
          stop();
          reply({ ok: false });
          return;
        }
        gap = message.interval * 1000;
        if (!enabled) {
          enabled = true;
          observer.observe(document.documentElement, { subtree: true, childList: true,
            attributes: true, attributeFilter: ['class', 'disabled', 'aria-disabled', 'hidden', 'data-slot'] });
        }
        run();
        reply({ ok: true, result: lastResult });
      }, () => reply({ ok: false }));
      return true;
    }
    return false;
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.captureSettings && changes.captureSettings.newValue?.enabled !== true) stop();
  });
  document.addEventListener('visibilitychange', schedule);
  window.addEventListener('pageshow', schedule);
})();
