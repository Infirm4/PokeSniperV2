// PokeIdle Market Sniper v1.5.4.1 - ponte entre a página (MAIN) e o background (MV3).
// A página não tem acesso a chrome.runtime; o content script ISOLATED tem.
(() => {
  if (window.__pisSheetsBridge) return;
  window.__pisSheetsBridge = true;
  const configureMonitor = settings => window.postMessage({ source: 'PIS_BRIDGE',
    type: 'WATCH_OPPORTUNITIES', enabled: settings?.notify === true }, location.origin);
  chrome.storage.local.get('opportunitySettings').then(
    data => configureMonitor(data.opportunitySettings), () => {});
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.opportunitySettings) configureMonitor(changes.opportunitySettings.newValue);
  });
  chrome.runtime.onMessage.addListener((msg, sender, reply) => {
    if (sender.id !== chrome.runtime.id || msg?.type !== 'PIS_READ_SMART_COINS') return false;
    PISCoinsHistory.readCache(indexedDB, PISMarketCore)
      .then(rows => reply({ rows }), () => reply({ error: true }));
    return true;
  });
  chrome.runtime.onMessage.addListener((msg, sender, reply) => {
    if (sender.id !== chrome.runtime.id || msg?.type !== 'PIS_COINS_HISTORY_LOOKUP' ||
        typeof msg.name !== 'string' || msg.name.length > 80) return false;
    window.postMessage({ source: 'PIS_BRIDGE', type: 'COINS_HISTORY_LOOKUP', name: msg.name }, location.origin);
    reply({ ok: true });
    return false;
  });
  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin) return;
    const msg = event.data;
    if (msg?.source === 'PIS_MAIN' && msg.type === 'MARKET_QUERY') {
      chrome.runtime.sendMessage({ type: 'PIS_MARKET_QUERY', route: msg.route, status: msg.status,
        page: msg.page, order: msg.order }).catch(() => {});
      return;
    }
    if (msg?.source === 'PIS_MAIN' && msg.type === 'COINS_HISTORY_STATUS') {
      chrome.runtime.sendMessage({ type: 'PIS_COINS_HISTORY_STATUS', state: msg.state, scope: msg.scope, page: msg.page, oldest: msg.oldest }).catch(() => {});
      return;
    }
    if (msg?.source === 'PIS_MAIN' && msg.type === 'MARKET_HISTORY_EVENT') {
      if (!['request', 'response', 'invalid_json', 'ignored_socket'].includes(msg.event) ||
          !Array.isArray(msg.rows) || msg.rows.length > 100) return;
      chrome.runtime.sendMessage({ type: 'PIS_MARKET_HISTORY_EVENT', event: msg.event, trace: msg.trace, rows: msg.rows })
        .then(receipt => {
          if (Number.isSafeInteger(msg.seq)) window.postMessage({ source: 'PIS_BRIDGE',
            type: 'COINS_HISTORY_RECEIPT', seq: msg.seq, ok: receipt?.ok === true }, location.origin);
        })
        .catch(error => console.warn('[PIS] Histórico de mercado:', error.message));
      return;
    }
    if (msg?.source === 'PIS_MAIN' && ['MARKET_MONITOR', 'MARKET_UNAVAILABLE'].includes(msg.type)) {
      chrome.runtime.sendMessage({ type: 'PIS_' + msg.type, state: msg.state, ids: msg.ids, cutoff: msg.cutoff })
        .catch(error => console.warn('[PIS] Monitor de mercado:', error.message));
      return;
    }
    if (msg?.source === 'PIS_MAIN' && msg.type === 'MARKET_CORE_BATCH') {
      if (!['sale', 'listing'].includes(msg.kind) || !Array.isArray(msg.rows) ||
          (msg.rows.length === 0 && !msg.automatic) || msg.rows.length > 100) return;
      try {
        chrome.runtime.sendMessage({ type: 'PIS_MARKET_CORE_BATCH', kind: msg.kind, rows: msg.rows,
          automatic: msg.automatic === true, page: msg.page, currency: msg.currency, totalRows: msg.totalRows }, reply => {
          const error = chrome.runtime.lastError;
          if (error || !reply?.ok) console.warn('[PIS] Observação de mercado não gravada:', error?.message || reply?.error);
        });
      } catch (error) { console.warn('[PIS] Ponte de mercado indisponível:', error.message); }
      return;
    }
    if (!msg || msg.source !== 'PIS_MAIN' || msg.type !== 'SHEETS_POST' ||
        typeof msg.requestId !== 'string' || msg.requestId.length > 100) return;
    const id = msg.requestId;
    const responder = resultado => {
      window.postMessage({ source: 'PIS_BRIDGE', type: 'SHEETS_RESULT', requestId: id,
        ok: !!(resultado && resultado.ok),
        resultado: resultado && resultado.resultado || null,
        error: String(resultado && resultado.error || '') }, location.origin);
    };
    if (!Array.isArray(msg.linhas) || !msg.linhas.length || msg.linhas.length > 100) {
      responder({ ok: false, error: 'lote inválido enviado pela página' });
      return;
    }
    try {
      chrome.runtime.sendMessage({ type: 'PIS_SHEETS_POST', linhas: msg.linhas }, resposta => {
        const erro = chrome.runtime.lastError;
        if (erro) responder({ ok: false, error: 'ponte da extensão: ' + erro.message });
        else responder(resposta || { ok: false, error: 'background sem resposta' });
      });
    } catch (e) { responder({ ok: false, error: 'ponte da extensão: ' + e.message }); }
  });
})();
