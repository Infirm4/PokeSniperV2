// PokeIdle Market Sniper — ponte MAIN -> ISOLATED -> background (Manifest V3).
// Nunca tenta usar chrome.runtime depois de invalidado e nunca publica em chrome-extension://.
(() => {
  if (window.__pisSheetsBridge) return;
  if (!/^https:\/\/(?:[a-z0-9-]+\.)?pokeidle\.io$/i.test(location.origin)) return;
  window.__pisSheetsBridge = true;
  const PAGE_ORIGIN = location.origin;
  const BRIDGE_SESSION = Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
  let unavailable = false;
  let failures = 0;

  function postPage(message) {
    try { window.postMessage({ source: 'PIS_BRIDGE', ...message }, PAGE_ORIGIN); }
    catch (error) { console.warn('[PIS] Mensagem de página inválida:', error?.message); }
  }
  function runtimeReady() {
    try { return !unavailable && typeof chrome?.runtime?.id === 'string' && chrome.runtime.id.length > 0; }
    catch { return false; }
  }
  function noticeUnavailable(reason) {
    if (unavailable) return;
    unavailable = true;
    postPage({ type: 'EXTENSION_CONTEXT_INVALIDATED', reason });
    // Aviso discreto, sem recarregamento automático no meio do jogo.
    const show = () => {
      if (document.getElementById('pis-context-reload-tip')) return;
      const tip = document.createElement('div');
      tip.id = 'pis-context-reload-tip';
      tip.textContent = 'Poke Sniper: conexão da extensão atualizada/interrompida. Recarregue esta página (F5) para retomar a captura.';
      Object.assign(tip.style, { position: 'fixed', bottom: '12px', right: '12px', zIndex: '2147483647',
        maxWidth: '350px', padding: '10px 14px', font: '12px/1.5 system-ui', color: '#fff',
        background: '#46223e', border: '1px solid #d39bc6', borderRadius: '8px', pointerEvents: 'none' });
      (document.body ?? document.documentElement)?.append(tip);
    };
    if (typeof document === 'undefined') return;
    if (document.documentElement) show();
    else document.addEventListener('DOMContentLoaded', show, { once: true });
  }
  function transportFailure(error) {
    const message = String(error?.message ?? error ?? 'background sem resposta');
    if (/Extension context invalidated|context invalidated|Extension context was invalidated/i.test(message) ||
        !runtimeReady()) noticeUnavailable('contexto_invalidado');
    else if (/Receiving end does not exist|message port closed|message channel closed/i.test(message)) {
      if (++failures >= 3) noticeUnavailable('canal_indisponivel');
    }
    return { ok: false, transportError: true, error: message };
  }
  function sendRuntime(message) {
    if (!runtimeReady()) {
      noticeUnavailable('contexto_invalidado');
      return Promise.resolve({ ok: false, transportError: true, error: 'Contexto da extensão indisponível' });
    }
    return new Promise(resolve => {
      try {
        chrome.runtime.sendMessage(message, response => {
          let error;
          try { error = chrome.runtime.lastError; }
          catch (failure) { error = failure; }
          if (error) return resolve(transportFailure(error));
          failures = 0;
          resolve(response ?? { ok: false, error: 'background sem resposta' });
        });
      } catch (error) { resolve(transportFailure(error)); }
    });
  }

  if (window === window.top) {
    const syncPendingSales = () => { void sendRuntime({ type: 'PIS_GAME_OPEN_SALES_BACKUP' }); };
    syncPendingSales();
    window.addEventListener('pageshow', event => { if (event.persisted) syncPendingSales(); });
  }
  const configureMonitor = settings => postPage({ type: 'WATCH_OPPORTUNITIES',
    enabled: settings?.notify === true, currency: settings?.currency, minGrade: settings?.minGrade });
  try {
    chrome.storage.local.get('opportunitySettings').then(
      data => configureMonitor(data.opportunitySettings), error => transportFailure(error));
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.opportunitySettings) configureMonitor(changes.opportunitySettings.newValue);
    });
  } catch (error) { transportFailure(error); }

  try {
    chrome.runtime.onMessage.addListener((msg, sender, reply) => {
      if (sender.id !== chrome.runtime.id) return false;
      if (msg?.type === 'PIS_MARKET_LISTINGS_COMMITTED') {
        postPage({ type: 'MARKET_LISTINGS_SAVED' });
        reply({ ok: true });
        return false;
      }
      if (msg?.type === 'PIS_READ_SMART_COINS') {
        Promise.resolve().then(() => PISCoinsHistory.readCache(indexedDB, PISMarketCore))
          .then(rows => reply({ rows }), () => reply({ error: true }));
        return true;
      }
      if (msg?.type === 'PIS_COINS_HISTORY_LOOKUP') {
        if (typeof msg.name !== 'string' || msg.name.length > 80) {
          reply({ ok: false, error: 'nome inválido' });
          return false;
        }
        postPage({ type: 'COINS_HISTORY_LOOKUP', name: msg.name });
        reply({ ok: true });
        return false;
      }
      return false;
    });
  } catch (error) { transportFailure(error); }

  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== PAGE_ORIGIN || event.data?.source !== 'PIS_MAIN') return;
    const msg = event.data;
    if (msg.type === 'CLAIM_INCOMPLETE_SALE') {
      void sendRuntime({ type: 'PIS_CLAIM_INCOMPLETE_SALE' }).then(result =>
        postPage({ type: 'INCOMPLETE_SALE_CANDIDATE', requestId: msg.requestId, row: result?.row ?? null }));
      return;
    }
    if (msg.type === 'MARKET_QUERY') {
      void sendRuntime({ type: 'PIS_MARKET_QUERY', route: msg.route, status: msg.status,
        page: msg.page, order: msg.order, durationMs: msg.durationMs });
      return;
    }
    if (msg.type === 'COINS_HISTORY_STATUS') {
      void sendRuntime({ type: 'PIS_COINS_HISTORY_STATUS', state: msg.state,
        scope: msg.scope, reason: msg.reason, page: msg.page, oldest: msg.oldest });
      return;
    }
    if (msg.type === 'MARKET_HISTORY_EVENT') {
      if (!['request', 'response', 'invalid_json', 'ignored_socket'].includes(msg.event) ||
          !Array.isArray(msg.rows) || msg.rows.length > 100) {
        if (Number.isSafeInteger(msg.seq)) postPage({ type: 'COINS_HISTORY_RECEIPT', seq: msg.seq, ok: false });
        return;
      }
      void sendRuntime({ type: 'PIS_MARKET_HISTORY_EVENT', event: msg.event,
        trace: msg.trace, rows: msg.rows, batchId: Number.isSafeInteger(msg.seq) ?
          'history:' + BRIDGE_SESSION + ':' + msg.seq + ':' + (msg.trace?.page ?? 0) : undefined }).then(receipt => {
        if (Number.isSafeInteger(msg.seq)) postPage({ type: 'COINS_HISTORY_RECEIPT', seq: msg.seq,
          ok: receipt?.ok === true });
      });
      return;
    }
    if (['MARKET_MONITOR', 'MARKET_UNAVAILABLE'].includes(msg.type)) {
      void sendRuntime({ type: 'PIS_' + msg.type, state: msg.state, socket: msg.socket,
        version: msg.version, wire: msg.wire, modules: msg.modules,
        ids: msg.ids, cutoff: msg.cutoff });
      return;
    }
    if (msg.type === 'MARKET_CORE_BATCH') {
      if (!['sale', 'listing'].includes(msg.kind) || !Array.isArray(msg.rows) ||
          (msg.rows.length === 0 && !msg.automatic) || msg.rows.length > 100) {
        if (typeof msg.batchId === 'string') postPage({ type: 'MARKET_BATCH_RECEIPT', batchId: msg.batchId, ok: false });
        return;
      }
      void sendRuntime({ type: 'PIS_MARKET_CORE_BATCH', kind: msg.kind, rows: msg.rows,
        batchId: msg.batchId, automatic: msg.automatic === true,
        live: msg.live === true, priceWatch: msg.priceWatch === true,
        olderScan: msg.olderScan === true, preparation: msg.preparation === true,
        page: msg.page, currency: msg.currency, totalRows: msg.totalRows }).then(receipt => {
        if (typeof msg.batchId === 'string') postPage({ type: 'MARKET_BATCH_RECEIPT',
          batchId: msg.batchId, ok: receipt?.ok === true, queued: receipt?.queued === true });
        else if (!receipt?.ok && !unavailable) console.warn('[PIS] Observação não recebida:', receipt?.error);
      });
      return;
    }
    if (msg.type !== 'SHEETS_POST' || typeof msg.requestId !== 'string' || msg.requestId.length > 100) return;
    const responder = resultado => postPage({ type: 'SHEETS_RESULT', requestId: msg.requestId,
      ok: resultado?.ok === true, resultado: resultado?.resultado ?? null, error: String(resultado?.error ?? '') });
    if (!Array.isArray(msg.linhas) || !msg.linhas.length || msg.linhas.length > 100) {
      responder({ ok: false, error: 'lote inválido enviado pela página' });
      return;
    }
    void sendRuntime({ type: 'PIS_SHEETS_POST', linhas: msg.linhas }).then(responder);
  });
})();
