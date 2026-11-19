// IndexedDB da extensão. O catálogo anterior no domínio do jogo continua legível.
const PISMarketStore = (() => {
  const DB_NAME = 'pis_market_core';
  const MAX_COMPARABLES = 1000;
  let opening;

  function open() {
    if (opening) return opening;
    opening = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 6);
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
        if (event.oldVersion < 3) {
          const opportunities = db.createObjectStore('opportunities', { keyPath: 'key' });
          opportunities.createIndex('observedAt', 'observedAt');
        }
        if (event.oldVersion < 4) {
          listings.createIndex('observedAt', 'observedAt');
          const exposures = db.createObjectStore('exposures', { keyPath: 'key' });
          exposures.createIndex('cohort', ['currency', 'speciesId', 'shiny', 'startAt']);
          exposures.createIndex('byPokemon', ['pokemonId', 'currency', 'lastSeen']);
        }
        if (event.oldVersion >= 4) {
          // Atualiza somente anúncios recentes. Recibos anteriores continuam válidos.
          const now = Date.now();
          result(listings.index('observedAt').getAll(IDBKeyRange.lowerBound(now - PISOpportunities.TTL)))
            .then(rows => reprice(tx, rows, now, true))
            .catch(() => { try { tx.abort(); } catch { /* já encerrada */ } });
        }
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

  async function saveOpportunity(tx, priced) {
    const store = tx.objectStore('opportunities');
    const key = PISOpportunities.key(priced);
    const previous = await result(store.get(key));
    store.put({ ...priced, key, delivery: previous?.delivery ?? 'pending',
      attempts: previous?.attempts ?? 0, nextAttemptAt: previous?.nextAttemptAt ?? 0, deliveryChannels: previous?.deliveryChannels });
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
      const estimate = PISPricingModel.prepare(comparable, PISMarketCore.estimate, PISMarketCore.sameMarket, now);
      for (const listing of group) {
        const priced = { ...listing, estimate: estimate(listing) };
        listings.put(priced);
        if (recordOpportunities && priced.observedAt >= now - PISOpportunities.TTL &&
            PISOpportunities.eligible(priced)) {
          await saveOpportunity(tx, priced);
        }
      }
    }
  }

  async function ingest(kind, rows, now = Date.now()) {
    const db = await open();
    const tx = db.transaction(['sales', 'listings', 'opportunities', 'exposures'], 'readwrite');
    const done = new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error || new Error('Gravação de mercado interrompida'));
    });
    // Trate abortos mesmo enquanto aguardamos a leitura de um índice.
    done.catch(() => {});
    const sales = tx.objectStore('sales');
    const listings = tx.objectStore('listings');
    const exposures = tx.objectStore('exposures');
    const savedRows = { new: 0, existing: 0, gainedFullIvs: 0 };
    const hasFullIvs = row => Object.values(row?.ivs || {}).filter(Number.isFinite).length === 6;
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
          // Uma importação posterior sem a ficha detalhada não apaga os campos já observados.
          const saved = previous ? { ...sale, ...Object.fromEntries(Object.entries(previous)
            .filter(([key, value]) => sale[key] == null && value != null)),
            ivs: Object.fromEntries(Object.entries(previous.ivs || {}).concat(
              Object.entries(sale.ivs || {}).filter(([, value]) => value != null))) } : sale;
          if (previous) savedRows.existing++;
          else savedRows.new++;
          if (!hasFullIvs(previous) && hasFullIvs(saved)) savedRows.gainedFullIvs++;
          sales.put(saved);
          if (saved.pokemonId && saved.soldAt <= now) {
            const start = [saved.pokemonId, saved.currency, saved.soldAt - PISLiquidity.MAX_GAP];
            const end = [saved.pokemonId, saved.currency, saved.soldAt];
            const nearby = await result(exposures.index('byPokemon').getAll(IDBKeyRange.bound(start, end)));
            const candidates = nearby.filter(exposure => saved.listingId ? PISLiquidity.saleMatches(exposure, saved)
              : PISLiquidity.possibleSale(exposure, saved));
            if (candidates.length === 1 && !candidates[0].saleAt) {
              const [exposure] = candidates;
              // Matches sem ID do anúncio são informativos, mas ficam fora das probabilidades.
              exposures.put(saved.listingId ? { ...exposure, saleAt: saved.soldAt, saleId: saved.id }
                : { ...exposure, possibleSaleAt: saved.soldAt, possibleSaleId: saved.id });
              if (saved.listingId) {
                const active = await result(listings.get(exposure.id));
                if (active?.exposureKey?.[1] === exposure.startAt) {
                  listings.put({ ...active, closed: 'vendido' });
                }
              }
            }
          }
        }
        // Recalcula apenas os grupos atingidos. Anúncios conservam a data observada.
        const index = listings.index('pricingGroup');
        for (const group of affected.values()) {
          await reprice(tx, await result(index.getAll(group)), now, true);
        }
      } else {
        const observed = [];
        for (const listing of new Map(rows.map(row => [row.id, row])).values()) {
          const saved = await result(listings.get(listing.id));
          const previous = saved?.exposureKey ? await result(exposures.get(saved.exposureKey)) : null;
          if (listing.closed) {
            if (saved) listings.put({ ...saved, closed: listing.closed, observedAt: now });
            if (previous && !previous.saleAt && previous.price === listing.price) {
              exposures.put({ ...previous, closedAt: now, closed: listing.closed });
            }
            continue;
          }
          const exposure = PISLiquidity.observe(listing, previous, now);
          exposures.put(exposure);
          observed.push({ ...listing, exposureKey: exposure.key, observedAt: now });
        }
        await reprice(tx, observed, now, true);
      }
      await done;
      return savedRows;
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
          PISOpportunities.eligible(listing, now) && PISOpportunities.matches(listing, config)) {
        return { ...candidate, ...listing };
      }
      return null;
    }));
    return current.filter(Boolean).reverse();
  }

  // Remove da vitrine local, sem transformar a ausência em venda para precificação ou liquidez.
  async function markUnavailable(ids, cutoff) {
    const db = await open();
    const tx = db.transaction('listings', 'readwrite');
    const done = new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error || new Error('Atualização de ofertas interrompida'));
    });
    done.catch(() => {});
    const store = tx.objectStore('listings');
    for (const id of new Set(ids)) {
      const row = await result(store.get(id));
      if (row && !row.closed && row.observedAt <= cutoff) {
        store.put({ ...row, closed: 'ausente_no_censo' });
      }
    }
    await done;
  }

  async function markDelivery(key, delivered, now = Date.now(), channels) {
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
      if (channels) row.deliveryChannels = channels;
      row.delivery = delivered ? 'sent' : row.attempts >= 3 ? 'failed' : 'pending';
      row.nextAttemptAt = now + 60000 * row.attempts;
      store.put(row);
    }
    await done;
  }

  async function liquidity(row, level, price, now = Date.now()) {
    const target = { ...row, price, level };
    if (row.shiny == null || !Number.isSafeInteger(level) || level < 1 ||
        !Number.isSafeInteger(price) || price < 1) return { status: 'incomplete_profile', count: 0, horizons: [] };
    const db = await open();
    const tx = db.transaction(['exposures', 'sales']);
    const group = groupOf(row);
    const [exposures, sales] = await Promise.all([
      result(tx.objectStore('exposures').index('cohort')
        .getAll(IDBKeyRange.bound([...group, now - PISLiquidity.HISTORY], [...group, now]))),
      recentSales(tx.objectStore('sales').index('comparables'), row, now),
    ]);
    return {
      ...PISLiquidity.estimate(target, exposures, now, PISMarketCore.sameMarket),
      activity: PISLiquidity.activity(target, sales, exposures, now, PISMarketCore.sameMarket, PISOpportunities.TTL),
    };
  }

  async function findListings(query = '') {
    const db = await open();
    const store = db.transaction('listings').objectStore('listings');
    const fold = value => (value || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
    const needle = fold(query.trim());
    // Suporta o ID para quem já o conhece. O fluxo principal pesquisa pelo nome.
    if (needle && /^[A-Za-z0-9_-]{1,64}$/.test(query.trim())) {
      const exact = await result(store.get(query.trim()));
      if (exact) return [exact];
    }
    return new Promise((resolve, reject) => {
      const matches = [];
      const request = store.index('observedAt').openCursor(null, 'prev');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor || matches.length === 15) return resolve(matches);
        if (!cursor.value.closed && (!needle || fold(cursor.value.name).includes(needle))) matches.push(cursor.value);
        cursor.continue();
      };
    });
  }

  async function analyzeListing(row, now = Date.now()) {
    const db = await open();
    const index = db.transaction('sales').objectStore('sales').index('comparables');
    const sales = await recentSales(index, row, now);
    return { ...row, estimate: PISPricingModel.prepare(sales, PISMarketCore.estimate,
      PISMarketCore.sameMarket, now)(row) };
  }

  // Leitura local iniciada pelo usuário. Só o resumo agregado sai do banco para o relatório.
  async function diagnosticSnapshot() {
    const db = await open();
    const tx = db.transaction(['listings', 'sales', 'exposures']);
    const [listings, sales, exposures] = await Promise.all([
      result(tx.objectStore('listings').getAll()),
      result(tx.objectStore('sales').getAll()),
      result(tx.objectStore('exposures').getAll()),
    ]);
    return { dbVersion: db.version, ...PISMarketDiagnostics.summarize({ listings, sales, exposures }, Date.now()) };
  }

  async function diagnostics(config, now = Date.now()) {
    const db = await open();
    const tx = db.transaction(['listings', 'opportunities', 'sales']);
    const range = IDBKeyRange.lowerBound(now - PISOpportunities.TTL);
    const rows = result(tx.objectStore('listings').index('observedAt').getAll(range));
    const queue = result(tx.objectStore('opportunities').index('observedAt').getAll(range));
    const sales = result(tx.objectStore('sales').count());
    const [listings, opportunities, saleCount] = await Promise.all([rows, queue, sales]);
    const totals = { listings: listings.length, sales: saleCount, noEstimate: 0, price: 0,
      filters: 0, detailed: 0, matched: 0, held: 0, sent: 0, sentDesktop: 0, sentInGame: 0, sentWithoutChannelInfo: 0, failed: 0, pending: 0 };
    const byKey = new Map(opportunities.map(row => [row.key, row]));
    for (const row of listings) {
      if (row.estimate?.method?.startsWith('profile_')) totals.detailed++;
      if (row.estimate?.status !== 'estimated') totals.noEstimate++;
      else if (row.estimate.profileReason === 'rare_profile') totals.held++;
      else if (!PISOpportunities.eligible(row)) totals.price++;
      else if (!PISOpportunities.matches(row, config)) totals.filters++;
      else {
        totals.matched++;
        const entry = byKey.get(PISOpportunities.key(row));
        const delivery = entry?.delivery;
        if (delivery === 'sent') {
          totals.sent++;
          if (!entry.deliveryChannels) totals.sentWithoutChannelInfo++;
          if (entry.deliveryChannels?.desktop) totals.sentDesktop++;
          if (entry.deliveryChannels?.game) totals.sentInGame++;
        } else if (delivery === 'failed') totals.failed++;
        else if (!PISOpportunities.notificationEligible(row)) totals.held++;
        else if (delivery === 'pending') totals.pending++;
      }
    }
    return totals;
  }

  return { ingest, initialize: open, recentOpportunities, markDelivery, markUnavailable, findListings, analyzeListing, diagnosticSnapshot, liquidity, diagnostics };
})();
