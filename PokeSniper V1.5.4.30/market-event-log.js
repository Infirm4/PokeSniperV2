// Guarda apenas diagnósticos agregados, sem IDs, nomes ou conteúdo de pacotes.
(() => {
  const KEY = 'pisMarketEvents';
  const routes = new Set(['gold', 'orb', 'history', 'monitor']);
  const codes = new Set(['resposta', 'recuo', 'recusada', 'cancelada', 'sem_resposta', 'falha_de_envio',
    'desconectada', 'fila_cheia', 'sem_registros_validos', 'falha_na_gravação', 'lote_inválido',
    'conflito_de_transação', 'aguardando_socket', 'aguardando_tráfego', 'enviada', 'gravado']);
  let pending = Promise.resolve();
  function record(storage, route, status, page, at = Date.now()) {
    if (!routes.has(route) || !codes.has(status)) return Promise.resolve();
    pending = pending.then(async () => {
      const data = (await storage.get(KEY))[KEY];
      const rows = Array.isArray(data) ? data.slice(-99) : [];
      const previous = rows.findLast(row => row?.route === route && row.status === status);
      if (previous && at - previous.at < 30000) return;
      rows.push({ route, status, page: Number.isSafeInteger(page) && page >= 0 ? page : null, at });
      await storage.set({ [KEY]: rows });
    }).catch(() => {});
    return pending;
  }
  const api = { KEY, record };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else globalThis.PISMarketEventLog = api;
})();
