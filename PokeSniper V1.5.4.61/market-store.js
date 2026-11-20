// IndexedDB da extensão. O catálogo anterior no domínio do jogo continua legível.
const PISMarketStore = (() => {
  const DB_NAME = 'pis_market_core';
  const MAX_COMPARABLES = 1000;
  const DB_VERSION = 15;
  const ESTIMATE_REVISION = 6;
  const revisionFor = row => row?.currency === 'gold' ? 7 : ESTIMATE_REVISION;
  const listingKey = row => [row.currency, row.id];
  let opening;

  function saleWithSprite(row) {
    // Usa a URL histórica quando presente e o catálogo somente para formas base verificáveis.
    if (PISMarketCore.safeSprite(row.sprite)) return row;
    const [sprite] = PISOpportunities.spriteCandidates(row);
    return sprite ? { ...row, sprite, spriteSource: row.spriteFallback === sprite ? row.spriteSource : 'dex' } : row;
  }

  function createListings(db) {
    const store = db.createObjectStore('listings', { keyPath: ['currency', 'id'] });
    store.createIndex('pricingGroup', ['currency', 'speciesId', 'shiny']);
    store.createIndex('observedAt', 'observedAt');
    store.createIndex('listingId', 'id');
    return store;
  }

  function open() {
    if (opening) return opening;
    opening = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      let abandoned = false;
      request.onblocked = () => {
        abandoned = true;
        reject(new Error('Atualização do IndexedDB bloqueada por uma conexão antiga'));
      };
      request.onupgradeneeded = event => {
        const db = request.result;
        const tx = request.transaction;
        if (abandoned) { tx.abort(); return; }
        if (event.oldVersion < 1) {
          createListings(db);
          const sales = db.createObjectStore('sales', { keyPath: ['currency', 'id'] });
          sales.createIndex('comparables', ['currency', 'speciesId', 'shiny', 'soldAt']);
        }
        if (event.oldVersion < 3) {
          const opportunities = db.createObjectStore('opportunities', { keyPath: 'key' });
          opportunities.createIndex('observedAt', 'observedAt');
        }
        if (event.oldVersion < 4) {
          const exposures = db.createObjectStore('exposures', { keyPath: 'key' });
          exposures.createIndex('cohort', ['currency', 'speciesId', 'shiny', 'startAt']);
          exposures.createIndex('byPokemon', ['pokemonId', 'currency', 'lastSeen']);
        }
        if (event.oldVersion < 9) db.createObjectStore('publicPricing');
        if (event.oldVersion < 8) {
          tx.objectStore('sales').createIndex('priceMarket', ['currency', 'shiny', 'soldAt']);
        }
        if (event.oldVersion < 12) db.createObjectStore('salesBackup', { keyPath: ['currency', 'id'] });
        if (event.oldVersion < 14) {
          const incomplete = db.createObjectStore('incompleteSales', { keyPath: ['currency', 'id'] });
          incomplete.createIndex('recoveryAt', 'recoveryAt');
        }
        if (event.oldVersion < 15) {
          const incomplete = tx.objectStore('incompleteSales');
          const pending = tx.objectStore('salesBackup');
          const sales = tx.objectStore('sales').openCursor();
          sales.onsuccess = () => {
            const cursor = sales.result;
            if (!cursor) return;
            const [currency, id] = cursor.primaryKey;
            const row = saleWithSprite(cursor.value);
            if (PISMarketCore.incompleteSaleFields(row).length) {
              incomplete.put({ ...row, recoveryAt: 0 });
              cursor.delete();
              pending.delete([currency, id]);
            } else {
              if (row !== cursor.value) cursor.update(row);
              // Reenvio único do banco limpo para preencher a planilha atual.
              pending.put({ currency, id, revision: 'schema-15' });
            }
            cursor.continue();
          };
        }
        if (event.oldVersion > 0 && event.oldVersion < 11) {
          const records = tx.objectStore('listings').getAll();
          records.onsuccess = () => {
            db.deleteObjectStore('listings');
            const fresh = createListings(db);
            let archive;
            for (const row of records.result) {
              if (typeof row.id === 'string' && ['gold', 'orb'].includes(row.currency)) fresh.put(row);
              else {
                archive ??= db.createObjectStore('legacyInvalidListings', { autoIncrement: true });
                archive.add(row);
              }
            }
          };
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        if (abandoned) { db.close(); return; }
        db.onversionchange = () => { db.close(); opening = null; };
        resolve(db);
      };
      request.onerror = () => reject(request.error);
    }).catch(error => { opening = null; throw error; });
    return opening;
  }

  // Leitura indexada por grupo, limitada às vendas mais recentes da janela.
  function recentSales(index, listing, now) {
    if (listing.shiny == null || PISMarketCore.isOutland(listing)) return Promise.resolve([]);
    const group = [listing.currency, listing.speciesId, listing.shiny];
    const range = IDBKeyRange.bound([...group, now - PISMarketCore.WINDOW_MS], [...group, now], false, true);
    return new Promise((resolve, reject) => {
      const rows = [];
      const request = index.openCursor(range, 'prev');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor || rows.length === MAX_COMPARABLES) return resolve(rows);
        if (!PISMarketCore.isOutland(cursor.value)) rows.push(cursor.value);
        cursor.continue();
      };
    });
  }

  function marketSales(index, target, now) {
    if (target.shiny == null || PISMarketCore.isOutland(target)) return Promise.resolve([]);
    const key = [target.currency, target.shiny];
    const range = IDBKeyRange.bound([...key, now - PISMarketCore.WINDOW_MS], [...key, now], false, true);
    return new Promise((resolve, reject) => {
      const rows = [];
      let inspected = 0;
      const request = index.openCursor(range, 'prev');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor || rows.length >= 3000 || inspected++ >= 8000) return resolve(rows);
        const sale = cursor.value;
        if (sale.name && sale.power && Number.isFinite(sale.quality) &&
            Object.values(sale.ivs || {}).filter(Number.isInteger).length === 6 &&
            !PISMarketCore.isOutland(sale)) rows.push(sale);
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

  // Só as consultas de anúncios novos armam a fila. Visitas manuais e censos atualizam a referência.
  const trackedLaunch = (row, now) => Number.isFinite(row.alertObservedAt) &&
    row.alertObservedAt >= now - PISOpportunities.TTL;

  async function saveOpportunity(tx, priced) {
    const store = tx.objectStore('opportunities');
    const key = PISOpportunities.key(priced);
    const previous = await result(store.get(key));
    store.put({ ...priced, key, delivery: previous?.delivery ?? 'pending',
      attempts: previous?.attempts ?? 0, nextAttemptAt: previous?.nextAttemptAt ?? 0, deliveryChannels: previous?.deliveryChannels });
  }

  const PRICING_FIELDS = ['pokemonId', 'speciesId', 'name', 'shiny', 'price', 'level', 'grade', 'power', 'form',
    'shadow', 'rarity', 'legendary', 'nature', 'natureId', 'refinement', 'quality', 'ivTotal', 'aoe', 'zMove', 'mega'];
  const IV_FIELDS = ['hp', 'attack', 'defense', 'specialAttack', 'specialDefense', 'speed'];

  function reusableQuote(saved, incoming, now) {
    return saved?.estimate && !saved.closed && saved.pricingRevision === revisionFor(saved) &&
      now - saved.estimatedAt < PISOpportunities.TTL && (!saved.expiresAt || saved.expiresAt > now) &&
      (saved.estimate.method !== 'briaoale_public' || PISPublicGems.freshTimestamp(saved.estimate.sourceAt, now)) &&
      PRICING_FIELDS.every(field => saved[field] === incoming[field]) &&
      IV_FIELDS.every(field => saved.ivs?.[field] === incoming.ivs?.[field]);
  }

  async function reprice(tx, rows, now, recordOpportunities = false, publicEstimates = null) {
    const groups = new Map();
    for (const row of rows) {
      const key = JSON.stringify(groupOf(row));
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }
    const sales = tx.objectStore('sales');
    const listings = tx.objectStore('listings');
    const markets = new Map();

    for (const group of groups.values()) {
      const target = group[0];
      const key = JSON.stringify([target.currency, target.shiny]);
      let local;
      for (const listing of group) {
        const previous = listing.estimate;
        let estimate = listing.currency !== 'orb' ? null : publicEstimates ? publicEstimates.get(listing.id) :
          listing.pricingRevision === ESTIMATE_REVISION && previous?.method === 'briaoale_public' &&
          PISPublicGems.freshTimestamp(previous.sourceAt, now) ? previous : null;
        if (!estimate) {
          // As cotações do snapshot já são completas; só o fallback consulta vendas locais.
          if (!local) {
            const comparable = await recentSales(sales.index('comparables'), target, now);
            if (target.currency === 'orb' && !markets.has(key)) {
              const available = await marketSales(sales.index('priceMarket'), target, now);
              markets.set(key, PISPricingModel.makeMarket(available, now, PISMarketCore.isOutland));
            }
            local = PISPricingModel.prepare(comparable, PISMarketCore.estimate, now, markets.get(key));
          }
          estimate = local(listing);
        }
        const priced = { ...listing, pricingRevision: revisionFor(listing), estimatedAt: now, estimate };
        listings.put(priced);
        if (recordOpportunities && trackedLaunch(priced, now) && PISOpportunities.eligible(priced))
          await saveOpportunity(tx, priced);
      }
    }
  }

  function reconcileSale(previous, incoming) {
    if (!previous) return { saved: incoming, changed: true, conflict: false };
    const gamePriority = previous.source === 'smartmarket_backup' && incoming.source === 'game';
    const conflict = ['soldAt', 'price', 'speciesId', 'pokemonId', 'listingId', 'shiny', 'form', 'shadow', 'rarity'].some(field =>
      previous[field] != null && incoming[field] != null && previous[field] !== incoming[field]);
    if (conflict) return { saved: gamePriority ? incoming : previous, changed: gamePriority, conflict };
    const primary = gamePriority ? incoming : previous;
    const supplemental = gamePriority ? previous : incoming;
    const saved = { ...primary, ivs: { ...primary.ivs } };
    for (const [key, value] of Object.entries(supplemental)) if (saved[key] == null && value != null) saved[key] = value;
    for (const [key, value] of Object.entries(supplemental.ivs ?? {})) if (saved.ivs[key] == null && value != null) saved.ivs[key] = value;
    const ivs = Object.values(saved.ivs);
    if (ivs.length === 6 && ivs.every(Number.isInteger)) saved.ivTotal = ivs.reduce((sum, value) => sum + value, 0);
    if (previous.outland || incoming.outland) saved.outland = true;
    if (incoming.spriteSource === 'market' && saved.spriteSource !== 'market' &&
        PISMarketCore.safeSprite(incoming.sprite)) {
      saved.sprite = incoming.sprite;
      saved.spriteSource = incoming.spriteSource;
      saved.spriteFallback = incoming.spriteFallback ?? null;
    }
    saved.stats = { ...supplemental.stats, ...primary.stats };
    if (Object.keys(saved.stats).length === 0) saved.stats = null;
    const changed = Object.entries(saved).some(([key, value]) => (key === 'ivs' || key === 'stats') && value != null
      ? Object.entries(value).some(([stat, iv]) => previous[key]?.[stat] !== iv)
      : previous[key] !== value);
    return { saved, changed, conflict };
  }

  async function ingest(kind, rows, now = Date.now(), { live = false } = {}) {
    const db = await open();
    let external = null;
    if (kind === 'listing' && rows.some(row => row.currency === 'orb' && !row.closed)) {
      const store = db.transaction('listings').objectStore('listings');
      const gems = rows.filter(row => row.currency === 'orb' && !row.closed);
      const required = (await Promise.all(gems.map(row => result(store.get(listingKey(row)))
        .then(saved => reusableQuote(saved, row, now) ? null : row)))).filter(Boolean);
      if (required.length) {
        const snapshot = await result(db.transaction('publicPricing').objectStore('publicPricing').get('gems'));
        external = evaluatePublic(snapshot, required, now);
      }
    }
    const tables = ['sales', 'listings', 'opportunities', 'exposures'];
    if (kind === 'sale') tables.push('salesBackup', 'incompleteSales');
    const tx = db.transaction(tables, 'readwrite');
    const done = new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error || new Error('Gravação de mercado interrompida'));
    });
    // Trate abortos mesmo enquanto aguardamos a leitura de um índice.
    done.catch(() => {});
    const sales = tx.objectStore('sales');
    const listings = tx.objectStore('listings');
    const exposures = tx.objectStore('exposures');
    const savedRows = { new: 0, existing: 0, gainedFullIvs: 0, conflicts: 0, incomplete: 0 };
    const hasFullIvs = row => Object.values(row?.ivs || {}).filter(Number.isFinite).length === 6;
    try {
      if (kind === 'sale') {
        const affected = new Map();
        const addGroup = row => {
          if (row?.shiny == null) return;
          const group = groupOf(row);
          affected.set(JSON.stringify(group), group);
        };
        const incomplete = tx.objectStore('incompleteSales');
        for (const sale of rows) {
          const key = [sale.currency, sale.id];
          const complete = await result(sales.get(key));
          const previous = complete ?? await result(incomplete.get(key));
          const incoming = saleWithSprite(sale);
          const next = reconcileSale(previous, incoming);
          if (next.conflict) savedRows.conflicts++;
          const saved = saleWithSprite(next.saved);
          if (PISMarketCore.incompleteSaleFields(saved).length) {
            if (!complete && (next.changed || saved !== next.saved))
              incomplete.put({ ...saved, recoveryAt: previous?.recoveryAt ?? 0 });
            savedRows.incomplete++;
            continue;
          }
          if (!complete && previous) incomplete.delete(key);
          const changed = !complete || next.changed || saved !== next.saved;
          if (complete) savedRows.existing++;
          else savedRows.new++;
          if (!changed) continue;
          addGroup(previous);
          addGroup(saved);
          if (!hasFullIvs(previous) && hasFullIvs(saved)) savedRows.gainedFullIvs++;
          const { recoveryAt, ...record } = saved;
          sales.put(record);
          tx.objectStore('salesBackup').put({
            currency: saved.currency, id: saved.id, revision: crypto.randomUUID(),
          });
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
                const active = await result(listings.get(listingKey(exposure)));
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
        for (const listing of new Map(rows.map(row => [JSON.stringify(listingKey(row)), row])).values()) {
          const saved = await result(listings.get(listingKey(listing)));
          const previous = saved?.exposureKey ? await result(exposures.get(saved.exposureKey)) : null;
          if (listing.closed) {
            if (saved) listings.put({ ...saved, closed: listing.closed, observedAt: now });
            if (previous && !previous.saleAt && previous.price === listing.price) {
              exposures.put({ ...previous, closedAt: now, closed: listing.closed });
            }
            continue;
          }
          const exposure = PISLiquidity.observe(listing, previous, now);
          if (!previous || exposure.startAt !== previous.startAt) exposure.key.push(listing.currency);
          else exposure.key = previous.key;
          exposures.put(exposure);
          const keepSprite = saved?.sprite && saved.spriteSource === 'market' && listing.spriteSource !== 'market' &&
            saved.pokemonId === listing.pokemonId && saved.speciesId === listing.speciesId && saved.shiny === listing.shiny;
          const sprite = keepSprite && saved.form === listing.form && saved.mega === listing.mega ?
            { sprite: saved.sprite, spriteSource: saved.spriteSource, spriteFallback: saved.spriteFallback } : {};
          const sameLaunch = saved && !saved.closed && saved.price === listing.price &&
            saved.pokemonId === listing.pokemonId && (listing.postedAt == null || listing.postedAt === saved.postedAt);
          const alertObservedAt = live && PISOpportunities.freshLaunch(listing, now) ? now :
            sameLaunch ? saved.alertObservedAt : null;
          const row = { ...listing, ...sprite, exposureKey: exposure.key, observedAt: now, alertObservedAt };
          if (reusableQuote(saved, row, now)) {
            const priced = { ...row, pricingRevision: saved.pricingRevision, estimatedAt: saved.estimatedAt, estimate: saved.estimate };
            listings.put(priced);
            if (trackedLaunch(priced, now) && PISOpportunities.eligible(priced)) await saveOpportunity(tx, priced);
          } else observed.push(row);
        }
        await reprice(tx, observed, now, true, external);
      }
      await done;
      return savedRows;
    } catch (error) {
      try { tx.abort(); } catch { /* já encerrada */ }
      throw error;
    }
  }

  async function claimIncompleteSale(now = Date.now()) {
    const db = await open();
    const tx = db.transaction('incompleteSales', 'readwrite');
    const done = new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error);
    });
    done.catch(() => {});
    const index = tx.objectStore('incompleteSales').index('recoveryAt');
    const candidate = await new Promise((resolve, reject) => {
      const request = index.openCursor(IDBKeyRange.upperBound(now - 24 * 3600000));
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) { resolve(null); return; }
        const row = cursor.value;
        if (!/^\d+$/.test(row.pokemonId ?? '') || row.soldAt < now - PISMarketCore.WINDOW_MS) {
          cursor.continue();
          return;
        }
        cursor.update({ ...row, recoveryAt: now });
        resolve({ id: row.id, currency: row.currency, pokemonId: row.pokemonId });
      };
    });
    await done;
    return candidate;
  }

  async function pendingSalesBackup(limit) {
    const db = await open();
    const tx = db.transaction(['salesBackup', 'sales']);
    const keys = await result(tx.objectStore('salesBackup').getAll(null, limit));
    return Promise.all(keys.map(async entry => ({
      ...entry, row: await result(tx.objectStore('sales').get([entry.currency, entry.id])),
    })));
  }

  async function acknowledgeSalesBackup(batch) {
    const db = await open();
    const tx = db.transaction('salesBackup', 'readwrite');
    const done = new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error ?? new Error('Falha ao confirmar o backup local'));
    });
    done.catch(() => {});
    const pending = tx.objectStore('salesBackup');
    for (const entry of batch) {
      const key = [entry.currency, entry.id];
      const current = await result(pending.get(key));
      if (current?.revision === entry.revision) pending.delete(key);
    }
    await done;
  }

  async function pendingSalesBackupCount() {
    const db = await open();
    return result(db.transaction('salesBackup').objectStore('salesBackup').count());
  }

  // Confere a revisão contra o anúncio mais recente, inclusive quando o preço deixou de ser oportunidade.
  async function recentOpportunities(config, now = Date.now()) {
    const db = await open();
    const tx = db.transaction(['opportunities', 'listings']);
    const listings = tx.objectStore('listings');
    const candidates = await result(tx.objectStore('opportunities').index('observedAt')
      .getAll(IDBKeyRange.lowerBound(now - PISOpportunities.TTL)));
    const current = await Promise.all(candidates.map(async candidate => {
      const listing = await result(listings.get(listingKey(candidate)));
      if (listing?.pricingRevision === revisionFor(listing) && trackedLaunch(listing, now) && PISOpportunities.key(listing) === candidate.key &&
          PISOpportunities.eligible(listing, now) && PISOpportunities.matches(listing, config)) {
        return { ...candidate, ...listing };
      }
      return null;
    }));
    return current.filter(Boolean).reverse();
  }

  async function currentOpportunity(key, id, config, now = Date.now(), forReview = false) {
    const db = await open();
    const tx = db.transaction(['opportunities', 'listings']);
    const entry = await result(tx.objectStore('opportunities').get(key));
    const listing = entry?.id === id ? await result(tx.objectStore('listings').get(listingKey(entry))) : null;
    if (!entry || (!forReview && (entry.delivery !== 'pending' || entry.nextAttemptAt > now)) || listing?.pricingRevision !== revisionFor(listing) ||
        !trackedLaunch(listing, now) || listing.observedAt < now - PISOpportunities.TTL || PISOpportunities.key(listing) !== key ||
        !PISOpportunities.eligible(listing, now) || !PISOpportunities.matches(listing, config) ||
        !PISOpportunities.notificationEligible(listing, config)) return null;
    return { ...entry, ...listing };
  }

  // Uma leitura recente da ficha basta para exibir a cotação da vitrine.
  // A janela menor dos alertas continua aplicada na fila de oportunidades.
  async function marketBadges(offers, now = Date.now()) {
    const db = await open();
    const listings = db.transaction('listings').objectStore('listings');
    const rows = await Promise.all(offers.map(async offer => {
      const row = await result(listings.get(listingKey(offer)));
      if (!row || row.pricingRevision !== revisionFor(row) || !PISMarketCore.matchesDisplayPrice(row.price, offer) ||
          row.observedAt < now - 60 * 60000 || row.closed || row.expiresAt && row.expiresAt <= now) return null;
      return PISMarketCore.isOutland(row) ? null : { offer, row };
    }));
    return rows.filter(Boolean);
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
      const row = await result(store.get(['gold', id]));
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
      const exact = await result(store.index('listingId').getAll(query.trim()));
      if (exact.length) return exact;
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

  let publicGemSource, publicGemRead;

  function publicGemEvaluator(snapshot, now) {
    const stamp = Date.parse(snapshot?.geradoEm);
    if (!PISPublicGems.freshTimestamp(stamp, now)) return null;
    if (!publicGemSource || publicGemSource.stamp < stamp) {
      publicGemSource = { stamp, estimate: PISPublicGems.prepare(snapshot, now) };
    }
    return publicGemSource.stamp === stamp ? publicGemSource.estimate : PISPublicGems.prepare(snapshot, now);
  }

  async function warmInventoryPricing(now = Date.now()) {
    if (publicGemSource && PISPublicGems.freshTimestamp(publicGemSource.stamp, now)) return publicGemSource.estimate;
    if (!publicGemRead) {
      publicGemRead = open().then(db => result(db.transaction('publicPricing').objectStore('publicPricing').get('gems')))
        .finally(() => { publicGemRead = null; });
    }
    return publicGemEvaluator(await publicGemRead, now);
  }

  // A mochila usa a mesma referência da vitrine, sem consultar o jogo nem criar anúncios.
  async function inventoryQuote(profile, now = Date.now()) {
    if (PISMarketCore.isOutland(profile)) return null;
    const gems = warmInventoryPricing(now).then(estimate => estimate?.({ ...profile, currency: 'orb' })).catch(error => {
      console.warn('[PIS] Preço público indisponível:', error.message);
      return null;
    });
    const db = await open();
    const sales = profile.shiny ? [] :
      await recentSales(db.transaction('sales').objectStore('sales').index('comparables'), profile, now);
    const gold = profile.shiny ? null : PISMarketCore.estimate(profile, sales, now);
    const quote = estimate => estimate?.status === 'estimated' && Number.isSafeInteger(estimate.median) ?
      { median: estimate.median, indicative: estimate.alertSupported !== true || estimate.bepi === true } : null;
    return { gold: quote(gold), orb: quote(await gems) };
  }

  async function analyzeListing(row, now = Date.now()) {
    const db = await open();
    const tx = db.transaction(['sales', 'publicPricing']);
    const store = tx.objectStore('sales');
    const [sales, market, snapshot] = await Promise.all([
      recentSales(store.index('comparables'), row, now),
      row.currency === 'orb' ? marketSales(store.index('priceMarket'), row, now) : [],
      row.currency === 'orb' ? result(tx.objectStore('publicPricing').get('gems')) : null,
    ]);
    const external = evaluatePublic(snapshot, [row], now).get(row.id);
    return { ...row, estimate: external || PISPricingModel.prepare(sales, PISMarketCore.estimate, now,
      PISPricingModel.makeMarket(market, now, PISMarketCore.isOutland))(row) };
  }

  function evaluatePublic(snapshot, rows, now) {
    const estimates = new Map();
    if (!snapshot) return estimates;
    try {
      const estimate = publicGemEvaluator(snapshot, now);
      if (!estimate) return estimates;
      for (const row of rows) if (row.currency === 'orb') estimates.set(row.id, estimate(row));
    } catch (error) {
      console.warn('[PIS] Preço público indisponível:', error.message);
    }
    return estimates;
  }

  async function savePublicGems(snapshot, now = Date.now()) {
    if (!PISPublicGems.validateContent(snapshot, now)) throw new Error('Snapshot de Gemas inválido');
    const db = await open();
    const tx = db.transaction('publicPricing', 'readwrite');
    const done = new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error || new Error('Gravação de Gemas interrompida'));
    });
    done.catch(() => {});
    const store = tx.objectStore('publicPricing');
    const previous = await result(store.get('gems'));
    const active = Date.parse(previous?.geradoEm) >= Date.parse(snapshot.geradoEm) ? previous : snapshot;
    if (active === snapshot) store.put(active, 'gems');
    await done;
    // A leitura compartilhada recebe o novo snapshot depois da gravação.
    try {
      publicGemEvaluator(active, now);
    } catch (error) {
      console.warn('[PIS] Preço público indisponível:', error.message);
    }

    // O ajuste estatístico não ocupa nenhuma transação de escrita.
    const range = IDBKeyRange.lowerBound(now - PISOpportunities.TTL);
    const listings = await result(db.transaction('listings').objectStore('listings').index('observedAt').getAll(range));
    const pending = listings.filter(row => row.currency === 'orb' && !row.closed && (row.pricingRevision !== ESTIMATE_REVISION || row.estimate?.sourceAt !== Date.parse(active.geradoEm)));
    for (let offset = 0; offset < pending.length; offset += 10) {
      const batch = pending.slice(offset, offset + 10);
      const estimates = evaluatePublic(active, batch, now);
      const update = db.transaction(['listings', 'opportunities'], 'readwrite');
      const saved = new Promise((resolve, reject) => {
        update.oncomplete = resolve;
        update.onabort = () => reject(update.error || new Error('Reavaliação de Gemas interrompida'));
      });
      saved.catch(() => {});
      const target = update.objectStore('listings');
      for (const row of batch) {
        const current = await result(target.get(listingKey(row)));
        const estimate = estimates.get(row.id);
        if (!estimate || !current || current.closed || current.observedAt !== row.observedAt ||
            current.price !== row.price || current.estimate?.sourceAt > estimate.sourceAt) continue;
        const priced = { ...current, pricingRevision: ESTIMATE_REVISION, estimatedAt: now, estimate };
        target.put(priced);
        if (trackedLaunch(priced, now) && PISOpportunities.eligible(priced, now)) await saveOpportunity(update, priced);
      }
      await saved;
    }
    return active.geradoEm;
  }

  async function backtest(config, now = Date.now()) {
    const db = await open();
    const index = db.transaction('sales').objectStore('sales').index('priceMarket');
    const groups = await Promise.all(['gold', 'orb'].flatMap(currency => [0, 1].map(shiny =>
      result(index.getAll(IDBKeyRange.bound([currency, shiny, now - 30 * 86400000], [currency, shiny, now], false, true))))));
    return PISMarketBacktest.run(groups.flat(), config, now);
  }

  async function recentSaleSample() {
    const db = await open();
    const index = db.transaction('sales').objectStore('sales').index('priceMarket');
    const latest = await Promise.all(['gold', 'orb'].flatMap(currency => [0, 1].map(shiny =>
      result(index.openCursor(IDBKeyRange.bound([currency, shiny, 0], [currency, shiny, Date.now()]), 'prev'))
        .then(cursor => cursor?.value))));
    return latest.filter(Boolean).sort((a, b) => b.soldAt - a.soldAt)[0] ?? null;
  }

  // Leitura local iniciada pelo usuário. Só o resumo agregado sai do banco para o relatório.
  async function diagnosticSnapshot() {
    const db = await open();
    const tx = db.transaction(['listings', 'sales', 'exposures', 'incompleteSales']);
    const [listings, sales, exposures, incompleteSales] = await Promise.all([
      result(tx.objectStore('listings').getAll()),
      result(tx.objectStore('sales').getAll()),
      result(tx.objectStore('exposures').getAll()),
      result(tx.objectStore('incompleteSales').getAll()),
    ]);
    const missing = {};
    for (const row of incompleteSales) {
      for (const field of PISMarketCore.incompleteSaleFields(row)) missing[field] = (missing[field] ?? 0) + 1;
    }
    return { dbVersion: db.version, vendas_pendentes_ficha_completa: incompleteSales.length,
      campos_faltantes_em_vendas_pendentes: missing, ...PISMarketDiagnostics.summarize({ listings, sales, exposures }, Date.now()) };
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
    const coins = { observados: 0, novos_capturados: 0, retidos: 0, estimados: 0, confiáveis: 0,
      sem_comparáveis: 0, extras_sem_suporte: 0, preços_dispersos: 0,
      bepi: 0, abaixo_da_mediana: 0, fortes: 0,
      estimados_sem_captura_nova: 0, sem_horário_publicação: 0, ofertas: 0, avisos_reais: 0 };
    totals.coins = coins;
    for (const row of listings) {
      if (row.currency === 'gold') {
        coins.observados++;
        if (!Number.isFinite(row.postedAt)) coins.sem_horário_publicação++;
        if (trackedLaunch(row, now)) {
          coins.novos_capturados++;
          if (row.availableAt > now) coins.retidos++;
        }
        if (row.estimate?.alertReason === 'comparáveis_insuficientes') coins.sem_comparáveis++;
        if (row.estimate?.alertReason === 'extras_sem_suporte') coins.extras_sem_suporte++;
        if (row.estimate?.alertReason === 'preços_dispersos') coins.preços_dispersos++;
        if (row.pricingRevision === revisionFor(row) && row.estimate?.status === 'estimated') {
          coins.estimados++;
          if (!trackedLaunch(row, now)) coins.estimados_sem_captura_nova++;
          if (row.estimate.bepi) coins.bepi++;
          if (row.price < row.estimate.median) coins.abaixo_da_mediana++;
          if (row.price <= row.estimate.lower) coins.fortes++;
          if (PISOpportunities.notificationEligible(row, config)) coins.confiáveis++;
          if (trackedLaunch(row, now) && PISOpportunities.approved(row, config, now)) {
            coins.ofertas++;
            if (byKey.get(PISOpportunities.key(row))?.delivery === 'sent') coins.avisos_reais++;
          }
        }
      }
      if (['coins_comparables', 'briaoale_pve', 'briaoale_public'].includes(row.estimate?.method)) totals.detailed++;
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
        else if (!PISOpportunities.notificationEligible(row, config)) totals.held++;
        else if (delivery === 'pending') totals.pending++;
      }
    }
    return totals;
  }

  return { ingest, pendingSalesBackup, acknowledgeSalesBackup, pendingSalesBackupCount, claimIncompleteSale, recentSaleSample, initialize: open, savePublicGems, recentOpportunities, currentOpportunity, markDelivery, markUnavailable, marketBadges, findListings, inventoryQuote, warmInventoryPricing, analyzeListing, backtest, diagnosticSnapshot, liquidity, diagnostics };
})();
