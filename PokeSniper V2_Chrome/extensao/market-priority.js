// Classificação pura da fila de mercado. 0 = vitrine atual, 1 = Recentes,
// 2 = vendas/observações normais, 3 = varredura histórica/preparação.
// Não dispara nenhuma consulta de rede nem modifica os preços.
(() => {
  function forJob(job) {
    if (job?.kind === 'listing' && job.viewing === true && job.automatic !== true) return 0;
    if (job?.kind === 'listing' && job.automatic === true &&
        job.order === 'recentes' && Number.isInteger(job.page) &&
        job.page >= 0 && job.page <= 2) return 1;
    if (job?.preparation === true || job?.olderScan === true) return 3;
    return 2;
  }
  // O trabalho da vitrine nunca é ultrapassado. Permite trabalho normal
  // eventual mesmo sob entrada sustentada de lotes de Recentes.
  function order(backgroundTurn = false) {
    return backgroundTurn ? [0, 3, 2, 1] : [0, 1, 2, 3];
  }
  const api = Object.freeze({ forJob, order });
  if (typeof module === 'object' && module.exports) module.exports = api;
  else globalThis.PISMarketPriority = api;
})();
