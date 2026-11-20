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

  function countdown(button) {
    const width = button.querySelector('.caido-tempo i')?.style.width;
    if (!width) return undefined;
    if (width === '0px') return 0;
    if (width.endsWith('%')) return Number.parseFloat(width);
  }

  function sceneIsOff(document) {
    return Array.from(document.querySelectorAll('button, [role="button"]')).some(button =>
      button.textContent.trim().replace(/\s+/g, ' ').toLowerCase() === 'ligar a cena' &&
      button.getClientRects().length > 0);
  }

  function identify(button) {
    const specimen = button.dataset.caidoId ?? button.dataset.pokemonId;
    const slot = button.dataset.slot;
    if (specimen) return JSON.stringify(['pokemon', specimen, slot]);
    if (slot != null) return JSON.stringify(['slot', slot, button.textContent.trim()]);
    return button;
  }

  function createCapture(document, time = () => Date.now()) {
    const attempts = new Map();

    return function capture() {
      const lists = [...document.querySelectorAll(LIST)];
      const area = document.querySelector(AREA);
      const sceneOff = sceneIsOff(document);
      const groups = lists.map(source => ({ source, buttons: [...source.querySelectorAll(TARGET)] }));
      if (area) {
        const buttons = [...area.querySelectorAll('button.caido')];
        groups.push({ source: area, buttons: buttons.filter(button => !lists.some(list => list.contains(button))) });
      }
      const now = time();
      const observed = new Set();
      const targets = groups.map(({ source, buttons }) => ({ source, targets: buttons.map(button => {
        const identity = identify(button);
        observed.add(identity);
        return { button, identity };
      }) }));
      for (const [identity, attempt] of attempts) {
        if (observed.has(identity)) continue;
        if (now - attempt.at >= RETRY_MS) attempts.delete(identity);
        else attempt.present = false;
      }

      let found = 0, expired = 0, ready = 0, held = 0;
      for (const { source, targets: group } of targets) {
        let clicks = 0;
        found = Math.max(found, group.length);
        for (const { button, identity } of group) {
          if (!source.contains(button) || !canClick(button)) continue;
          const remaining = countdown(button);
          if (remaining === 0) {
            expired++;
            continue;
          }
          ready++;
          const previous = attempts.get(identity);
          if (sceneOff && previous?.present && previous.remaining === remaining) {
            held++;
            continue;
          }
          if (previous && now - previous.at < RETRY_MS) continue;

          attempts.set(identity, { at: now, present: true, remaining });
          button.click();
          if (++clicks >= PER_CYCLE) break;
        }
        if (clicks) return { status: 'clicou', clicks, found: group.length };
      }

      let status = lists.length ? 'aguardando' : 'sem_lista';
      if (found) status = 'bloqueado';
      if (expired) status = 'expirado';
      if (ready) status = 'cooldown';
      if (sceneOff && (!ready || held === ready)) status = 'cena_desligada';
      return { status, clicks: 0, found };
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
