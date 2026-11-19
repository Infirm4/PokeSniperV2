// Conversão de um backup explícito do cache local do Smart Market.
(() => {
  const DAY = 86400000;
  function cleanSpecies(value) {
    if (typeof value !== 'string') return null;
    const name = value.trim();
    return name.length <= 80 && /^[\p{L}\p{N} .’'♀♂-]+$/u.test(name) ? name : null;
  }

  function importRows(data, core, now = Date.now()) {
    if (!Array.isArray(data) || data.length > 150000) throw new Error('Use uma lista JSON de transações do Smart Market.');
    const unique = new Map();
    for (const sale of data) {
      if (sale?.moeda !== 'gold' || !(sale.em >= now - 30 * DAY && sale.em <= now)) continue;
      const frame = { t: 'market', aba: 'historicoGlobal', linhas: [{
        tipo: 'pokemon', id: sale.id, pokemonId: sale.pokemonId, moeda: 'gold',
        bruto: sale.preco, em: sale.em,
        ficha: { speciesId: sale.speciesId, nome: sale.nome, level: sale.level > 1 ? sale.level : null,
          nota: sale.nota > 0 ? sale.nota : null, potencia: sale.potencia, quality: sale.quality > 0 ? sale.quality : null,
          ivTotal: sale.ivTotal > 0 ? sale.ivTotal : null, shiny: sale.shiny, tmAoe: sale.aoe, tmElemental: sale.zmove, mega: sale.mega },
      }] };
      const row = core.capture(frame)?.rows[0];
      if (row && !core.isOutland(row)) unique.set(row.id, { ...row, source: 'smartmarket_backup' });
    }
    return [...unique.values()];
  }

  async function readCache(databaseApi, core) {
    const name = 'pokeidle-preco';
    if (typeof databaseApi?.databases !== 'function' ||
        !(await databaseApi.databases()).some(db => db.name === name)) return null;
    const db = await new Promise((resolve, reject) => {
      const request = databaseApi.open(name);
      // Não crie banco se o cache tiver sido removido entre a listagem e a abertura.
      request.onupgradeneeded = () => request.transaction.abort();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    try {
      if (!db.objectStoreNames.contains('vendas')) return null;
      const rows = await new Promise((resolve, reject) => {
        const tx = db.transaction('vendas', 'readonly');
        const request = tx.objectStore('vendas').getAll();
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
      });
      return importRows(rows, core);
    } finally { db.close(); }
  }

  const api = { cleanSpecies, importRows, readCache };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else globalThis.PISCoinsHistory = api;
})();
