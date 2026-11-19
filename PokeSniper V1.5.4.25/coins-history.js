// Conversão de um backup explícito do cache local do Smart Market.
(() => {
  const DAY = 86400000;
  function cleanSpecies(value) {
    if (typeof value !== 'string') return null;
    const name = value.trim();
    return name.length <= 80 && /^[\p{L}\p{N} .:’'♀♂-]+$/u.test(name) ? name : null;
  }

  function importRows(data, core, now = Date.now()) {
    if (!Array.isArray(data) || data.length > 150000) throw new Error('Use uma lista JSON de transações do Smart Market.');
    const unique = new Map();
    for (const sale of data) {
      if (sale?.moeda !== 'gold' || core.isOutland(sale) || !(sale.em >= now - 30 * DAY && sale.em <= now)) continue;
      const frame = { t: 'market', aba: 'historicoGlobal', linhas: [{
        tipo: 'pokemon', id: sale.id, pokemonId: sale.pokemonId, moeda: 'gold',
        bruto: sale.preco, em: sale.em,
        ficha: { speciesId: sale.speciesId, nome: sale.nome, level: sale.level > 1 ? sale.level : null,
          nota: sale.nota > 0 ? sale.nota : null, potencia: sale.potencia, quality: sale.quality > 0 ? sale.quality : null,
          formId: sale.formId ?? sale.form, ivs: sale.ivs, ivTotal: sale.ivTotal > 0 ? sale.ivTotal : null, shiny: sale.shiny, tmAoe: sale.aoe, tmElemental: sale.zmove, mega: sale.mega },
      }] };
      const row = core.capture(frame)?.rows[0];
      if (!row || core.isOutland(row)) continue;
      const previous = unique.get(row.id);
      const fields = Object.fromEntries(Object.entries(row).filter(([, value]) => value != null));
      const ivs = Object.fromEntries(Object.entries(row.ivs).filter(([, value]) => value != null));
      unique.set(row.id, { ...row, ...previous, ...Object.fromEntries(
        Object.entries(fields).filter(([key]) => previous?.[key] == null)),
        ivs: { ...row.ivs, ...ivs, ...Object.fromEntries(
          Object.entries(previous?.ivs ?? {}).filter(([, value]) => value != null)) },
        source: 'smartmarket_backup' });
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

  // Páginas mudam de posição quando entram vendas. Reencontre uma página
  // gravada antes de prosseguir, em vez de confiar só no número da página.
  async function backfill({ previous, read, save, now = Date.now(), budget = 6 }) {
    const cutoff = now - 30 * DAY;
    let state = previous ?? { page: 0, ids: [], oldest: null };
    let page = state.probe ?? state.page;
    let anchored = !state.ids.length;
    let used = 0;
    while (used++ < budget) {
      const wasAnchored = anchored;
      const { ids, newest, oldest, last } = await read(page);
      if (!anchored) {
        const savedIds = new Set(state.ids);
        anchored = ids.some(id => savedIds.has(id));
        if (!anchored) {
          if (ids.length && oldest != null && state.oldest != null && oldest >= state.oldest) {
            page++;
            if (used === budget) {
              state = { ...state, probe: page };
              await save(state, 'buscando página de retomada');
            }
            continue;
          }
          // A página de referência sumiu ou moveu para trás. Repita a janela
          // desde o começo; a gravação por ID já é idempotente.
          const reset = { page: 0, ids: [], oldest: null };
          await save(reset, 'reancorando');
          return reset;
        }
      }
      const complete = last || (newest != null && newest < cutoff);
      const next = { page, ids, oldest: oldest ?? state.oldest,
        ...(complete ? { completedAt: now } : {}) };
      // Repetir a última página evita pular um trecho se o servidor ignorar a paginação.
      if (wasAnchored && !complete && page !== state.page && ids.length && ids.every(id => state.ids.includes(id))) return state;
      await save(next, complete ? 'janela percorrida' : 'gravando histórico anterior');
      state = next;
      if (complete) return state;
      page++;
    }
    return state;
  }

  const api = { cleanSpecies, importRows, readCache, backfill };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else globalThis.PISCoinsHistory = api;
})();
