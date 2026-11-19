// PokeIdle Market Sniper v1.5.4.1 - ponte entre a página (MAIN) e o background (MV3).
// A página não tem acesso a chrome.runtime; o content script ISOLATED tem.
(() => {
  if (window.__pisSheetsBridge) return;
  window.__pisSheetsBridge = true;
  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin) return;
    const msg = event.data;
    if (msg?.source === 'PIS_MAIN' && msg.type === 'MARKET_CORE_BATCH') {
      if (!['sale', 'listing'].includes(msg.kind) || !Array.isArray(msg.rows) ||
          msg.rows.length === 0 || msg.rows.length > 100) return;
      try {
        chrome.runtime.sendMessage({ type: 'PIS_MARKET_CORE_BATCH', kind: msg.kind, rows: msg.rows }, reply => {
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
