// IndexedDB da extensão. O catálogo anterior no domínio do jogo continua legível.
const PISMarketStore = (() => {
  const DB_NAME = 'pis_market_core';
  const MAX_COMPARABLES = 1000;
  let opening;

  function open() {
    if (opening) return opening;
    opening = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 2);
      request.onupgradeneeded = event => {
        const db = request.result;
        const tx = request.transaction;
        if (event.oldVersion < 1) {
          db.createObjectStore('listings', { keyPath: 'id' });
          const sales = db.createObjectStore('sales', { keyPath: ['currency', 'id'] });
          sales.createIndex('comparables', ['currency', 'speciesId', 'shiny', 'soldAt']);
        }
        const listings = tx.objectStore('listings');
        listings.createIndex('pricingGroup', ['currency', 'speciesId', 'shiny']);
        // Atualiza as estimativas legadas na mesma transação que instala o índice.
        if (event.oldVersion === 1) {
          result(listings.getAll())
            .then(rows => reprice(tx, rows, Date.now()))
            .catch(() => { try { tx.abort(); } catch { /* já encerrada */ } });
        }
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

  const groupOf = row => [row.currency, row.speciesId, row.shiny];

  function result(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function reprice(tx, rows, now) {
    const groups = new Map();
    for (const row of rows) {
      const key = JSON.stringify(groupOf(row));
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }
    const index = tx.objectStore('sales').index('comparables');
    const listings = tx.objectStore('listings');
    for (const group of groups.values()) {
      const comparable = await recentSales(index, group[0], now);
      for (const listing of group) {
        listings.put({ ...listing, estimate: PISMarketCore.estimate(listing, comparable, now) });
      }
    }
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
        const affected = new Map();
        const addGroup = row => {
          if (row?.shiny == null) return;
          const group = groupOf(row);
          affected.set(JSON.stringify(group), group);
        };
        for (const sale of rows) {
          const previous = await result(sales.get([sale.currency, sale.id]));
          addGroup(previous);
          addGroup(sale);
          sales.put(sale);
        }
        // Recalcula apenas os grupos atingidos. Anúncios conservam a data observada.
        const index = listings.index('pricingGroup');
        for (const group of affected.values()) {
          await reprice(tx, await result(index.getAll(group)), now);
        }
      } else {
        await reprice(tx, rows.map(listing => ({ ...listing, observedAt: now })), now);
      }
      await done;
    } catch (error) {
      try { tx.abort(); } catch { /* já encerrada */ }
      throw error;
    }
  }

  return { ingest, initialize: open };
})();
