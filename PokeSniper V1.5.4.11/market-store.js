// IndexedDB da extensão. O catálogo anterior no domínio do jogo continua legível.
const PISMarketStore = (() => {
  const DB_NAME = 'pis_market_core';
  const MAX_COMPARABLES = 1000;
  let opening;

  function open() {
    if (opening) return opening;
    opening = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 3);
      request.onupgradeneeded = event => {
        const db = request.result;
        const tx = request.transaction;
        if (event.oldVersion < 1) {
          db.createObjectStore('listings', { keyPath: 'id' });
          const sales = db.createObjectStore('sales', { keyPath: ['currency', 'id'] });
          sales.createIndex('comparables', ['currency', 'speciesId', 'shiny', 'soldAt']);
        }
        const listings = tx.objectStore('listings');
        if (event.oldVersion < 2) listings.createIndex('pricingGroup', ['currency', 'speciesId', 'shiny']);
        const opportunities = db.createObjectStore('opportunities', { keyPath: 'key' });
        opportunities.createIndex('observedAt', 'observedAt');
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

  async function reprice(tx, rows, now, recordOpportunities = false) {
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
        const priced = { ...listing, estimate: PISMarketCore.estimate(listing, comparable, now) };
        listings.put(priced);
        if (recordOpportunities && priced.observedAt >= now - PISOpportunities.TTL &&
            PISOpportunities.eligible(priced)) {
          const store = tx.objectStore('opportunities');
          const key = PISOpportunities.key(priced);
          const previous = await result(store.get(key));
          store.put({ ...priced, key, delivery: previous?.delivery ?? 'pending',
            attempts: previous?.attempts ?? 0, nextAttemptAt: previous?.nextAttemptAt ?? 0 });
        }
      }
    }
  }

  async function ingest(kind, rows, now = Date.now()) {
    const db = await open();
    const tx = db.transaction(['sales', 'listings', 'opportunities'], 'readwrite');
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
          await reprice(tx, await result(index.getAll(group)), now, true);
        }
      } else {
        await reprice(tx, rows.map(listing => ({ ...listing, observedAt: now })), now, true);
      }
      await done;
    } catch (error) {
      try { tx.abort(); } catch { /* já encerrada */ }
      throw error;
    }
  }

  // Confere a revisão contra o anúncio mais recente, inclusive quando o preço deixou de ser oportunidade.
  async function recentOpportunities(config, now = Date.now()) {
    const db = await open();
    const tx = db.transaction(['opportunities', 'listings']);
    const listings = tx.objectStore('listings');
    const candidates = await result(tx.objectStore('opportunities').index('observedAt')
      .getAll(IDBKeyRange.lowerBound(now - PISOpportunities.TTL)));
    const current = await Promise.all(candidates.map(async candidate => {
      const listing = await result(listings.get(candidate.id));
      if (listing && PISOpportunities.key(listing) === candidate.key &&
          PISOpportunities.eligible(listing) && PISOpportunities.matches(listing, config)) {
        return { ...candidate, ...listing };
      }
      return null;
    }));
    return current.filter(Boolean).reverse();
  }

  async function markDelivery(key, delivered, now = Date.now()) {
    const db = await open();
    const tx = db.transaction('opportunities', 'readwrite');
    const done = new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error || new Error('Atualização de alerta interrompida'));
    });
    done.catch(() => {});
    const store = tx.objectStore('opportunities');
    const row = await result(store.get(key));
    if (row && row.delivery === 'pending') {
      row.attempts++;
      row.delivery = delivered ? 'sent' : row.attempts >= 3 ? 'failed' : 'pending';
      row.nextAttemptAt = now + 60000 * row.attempts;
      store.put(row);
    }
    await done;
  }

  return { ingest, initialize: open, recentOpportunities, markDelivery };
})();
