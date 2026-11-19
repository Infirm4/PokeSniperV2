// IndexedDB da extensão. O catálogo anterior no domínio do jogo continua legível.
const PISMarketStore = (() => {
  const DB_NAME = 'pis_market_core';
  const MAX_COMPARABLES = 1000;
  let opening;

  function open() {
    if (opening) return opening;
    opening = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore('listings', { keyPath: 'id' });
        const sales = db.createObjectStore('sales', { keyPath: ['currency', 'id'] });
        sales.createIndex('comparables', ['currency', 'speciesId', 'shiny', 'soldAt']);
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { db.close(); opening = null; };
        resolve(db);
      };
      request.onerror = () => reject(request.error);
    }).catch(error => { opening = null; throw error; });
    return opening;
  }

  // Leitura indexada por grupo, limitada às vendas mais recentes da janela.
  function recentSales(index, listing, now) {
    if (listing.shiny == null) return Promise.resolve([]);
    const group = [listing.currency, listing.speciesId, listing.shiny];
    const range = IDBKeyRange.bound([...group, now - PISMarketCore.WINDOW_MS], [...group, now], false, true);
    return new Promise((resolve, reject) => {
      const rows = [];
      const request = index.openCursor(range, 'prev');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor || rows.length === MAX_COMPARABLES) return resolve(rows);
        rows.push(cursor.value);
        cursor.continue();
      };
    });
  }

  async function ingest(kind, rows, now = Date.now()) {
    const db = await open();
    const tx = db.transaction(['sales', 'listings'], 'readwrite');
    const done = new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error || new Error('Gravação de mercado interrompida'));
    });
    // Trate abortos mesmo enquanto aguardamos a leitura de um índice.
    done.catch(() => {});
    const sales = tx.objectStore('sales');
    const listings = tx.objectStore('listings');
    try {
      if (kind === 'sale') {
        for (const sale of rows) sales.put(sale);
      } else {
        const groups = new Map();
        const index = sales.index('comparables');
        for (const listing of rows) {
          const key = JSON.stringify([listing.currency, listing.speciesId, listing.shiny]);
          if (!groups.has(key)) groups.set(key, recentSales(index, listing, now));
        }
        await Promise.all(rows.map(async listing => {
          const key = JSON.stringify([listing.currency, listing.speciesId, listing.shiny]);
          const comparable = await groups.get(key);
          listings.put({ ...listing, observedAt: now,
            estimate: PISMarketCore.estimate(listing, comparable, now) });
        }));
      }
      await done;
    } catch (error) {
      try { tx.abort(); } catch { /* já encerrada */ }
      throw error;
    }
  }

  return { ingest };
})();
