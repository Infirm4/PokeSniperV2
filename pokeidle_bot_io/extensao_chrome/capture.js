'use strict';

(() => {
  const LIST = '#caidos-lista, .caidos-lista';
  const TARGET = 'button.caido, button[data-slot]';
  const PER_CYCLE = 3;
  const RETRY_MS = 5000;

  function createCapture(document, time = () => Date.now()) {
    const recent = new WeakMap();
    const slots = new Map();

    return function capture() {
      const list = document.querySelector(LIST);
      if (!list) return { status: 'sem_lista', clicks: 0, found: 0 };

      const now = time();
      for (const [slot, submittedAt] of slots) if (now - submittedAt >= RETRY_MS) slots.delete(slot);

      const buttons = [...list.querySelectorAll(TARGET)];
      let clicks = 0, ready = 0;
      for (const button of buttons) {
        if (!button.isConnected || !list.contains(button) || button.matches(':disabled, [aria-disabled="true"], [hidden]')) continue;
        ready++;
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
      const status = clicks ? 'clicou' : ready ? 'cooldown' : buttons.length ? 'bloqueado' : 'aguardando';
      return { status, clicks, found: buttons.length };
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
  let list;
  let lastResult;

  function stop() {
    enabled = false;
    observer.disconnect();
    clearTimeout(timer);
    timer = undefined;
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
    list = document.querySelector(LIST);
    const result = capture();
    const at = Date.now();
    if (result.clicks || result.status !== lastResult?.status || result.found !== lastResult?.found) {
      chrome.runtime.sendMessage({ type: 'capture:result', result: { ...result, at } }).catch(() => {});
    }
    lastResult = { ...result, at };
    if (result.found) schedule();
  }

  const observer = new MutationObserver(changes => {
    if (!enabled) return;
    // Mudanças dentro da lista ou a sua substituição podem criar um novo alvo.
    if (list && (!list.isConnected || changes.some(change => list.contains(change.target)))) schedule();
    else if (!list && document.querySelector(LIST)) schedule();
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
          observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true,
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
