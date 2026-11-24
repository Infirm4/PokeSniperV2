// PokeIdle Market Sniper v1.5.4.97 - envio de eventos pelo service worker da extensão.
// Domínio de destino fixo. Nunca usa um endereço fornecido pela própria página do jogo.
const SHEETS_URL = 'https://script.google.com/macros/s/AKfycbwPXSeG3xL5PUwDwsuCp-XWJ8s8w3qmlGxECTJo_haREmZbeKOOnr_5qTfVZtH5xmDS/exec';
const PIS_HOST = /^https:\/\/(?:[a-z0-9-]+\.)?pokeidle\.io(?:\/|$)/i;

importScripts('vendor/briaoale/especies.js', 'vendor/briaoale/pve-power.js', 'vendor/briaoale/market-bonuses.js', 'vendor/briaoale/central.js', 'vendor/briaoale/nota.js', 'vendor/briaoale/pve-pricing.js');
importScripts('market-core.js', 'coin-market.js', 'pricing-model.js', 'liquidity.js', 'opportunities.js', 'market-priority.js', 'market-store.js',
  'history-trace.js', 'public-gems.js', 'market-event-log.js');

const gameTabKey = 'marketGameTab';
let lastGameTab;
const PISGameTab = {
  remember(tabId) {
    if (lastGameTab === tabId) return;
    lastGameTab = tabId;
    chrome.storage.session.set({ [gameTabKey]: tabId }).catch(() => {});
  },
  async review(row, demo = false) {
    const offer = PISMarketCore.purchaseOffer(row);
    const tabId = lastGameTab ?? (await chrome.storage.session.get(gameTabKey))[gameTabKey];
    if (!offer || !Number.isSafeInteger(tabId)) return false;
    try {
      const tab = await chrome.tabs.get(tabId);
      if (!PIS_HOST.test(tab.url ?? '')) return false;
      const result = await chrome.tabs.sendMessage(tabId, { type: 'PIS_MARKET_REVIEW', offer, demo }, { frameId: 0 });
      if (result?.ok !== true) return false;
      if (!tab.active) await chrome.tabs.update(tabId, { active: true });
      const currentWindow = await chrome.windows.getLastFocused();
      if (currentWindow.id !== tab.windowId) await chrome.windows.update(tab.windowId, { focused: true });
      return true;
    } catch { return false; }
  },
  async show(title, message, test = false, sprite = null, offer = null, spriteFallback = null, secondary = false) {
    const tabId = lastGameTab ?? (await chrome.storage.session.get(gameTabKey))[gameTabKey];
    if (!Number.isSafeInteger(tabId)) return false;
    try {
      const reply = await chrome.tabs.sendMessage(tabId, { type: 'PIS_MARKET_TOAST', title, message, test,
        sprite: PISMarketCore.safeSprite(sprite), offer, spriteFallback: PISMarketCore.safeSprite(spriteFallback), secondary }, { frameId: 0 });
      return reply?.ok === true;
    } catch { return false; }
  }
};

importScripts('opportunities-worker.js', 'public-gems-worker.js', 'sales-backup.js', 'sales-backup-worker.js');
PISMarketStore.initialize().catch(error => {
  console.warn('[PIS] Não foi possível iniciar o banco de mercado:', error.message);
});
PISMarketStore.warmInventoryPricing?.().catch(error => {
  console.warn('[PIS] Não foi possível preparar a base de Gemas:', error.message);
});

function recordMarket(route, status, page) {
  globalThis.PISMarketEventLog?.record(chrome.storage.local, route, status, page);
}

// Consumidor único para não saturar transações IndexedDB. Os lotes ficam no disco
// enquanto não houver commit; o service worker pode encerrar/reiniciar sem perdê-los.
const MARKET_QUEUE_ALARM = 'pisMarketQueueDrain';
let drainingMarketQueue = false;
let marketQueueRequested = false;
let completedMarketBatches = 0;
const marketQueueAvailable = () => typeof PISMarketStore.enqueueBatch === 'function';

function recordPageReceipt(job, status, accepted) {
  if (job.kind !== 'listing' || job.automatic !== true) return Promise.resolve();
  const currency = ['gold', 'orb'].includes(job.currency) ? job.currency : null;
  const page = { status, accepted, page: Number.isSafeInteger(job.page) ? job.page : null, currency,
    preparação_de_selos: job.preparation === true,
    totalRows: Number.isSafeInteger(job.totalRows) ? job.totalRows : null, at: Date.now() };
  const receipts = { pisMarketAutomaticPage: page };
  if (currency) {
    receipts['pisMarketPage:' + currency] = page;
    if (job.preparation === true) receipts['pisMarketPrepared:' + currency] = page;
    if (status === 'gravado' && page.page != null && page.page >= 0 && page.page <= 999) {
      receipts[(currency === 'gold' ? 'pisCoinSeenPage:' : 'pisGemSeenPage:') + page.page] = page.at;
    }
  }
  return chrome.storage.session.set(receipts).catch(() => {});
}

function wakeMarketQueue() {
  if (!marketQueueAvailable()) return;
  if (drainingMarketQueue) { marketQueueRequested = true; return; }
  drainingMarketQueue = true;
  marketQueueRequested = false;
  void (async () => {
    for (let i = 0; i < 10000; i++) {
      const job = await PISMarketStore.nextBatch(Date.now(), {
        // A vitrine permanece em primeiro lugar. Recentes só cede um turno
        // a trabalhos normais a cada 12 lotes concluídos.
        backgroundTurn: completedMarketBatches > 0 && completedMarketBatches % 12 === 0,
      });
      if (!job) break;
      const route = job.history ? 'history' : job.currency;
      const page = job.history ? job.trace?.page : job.page;
      try {
        const stats = await PISMarketStore.ingest(job.kind, job.rows, undefined, job.options ?? {});
        // Remove APÓS ingest ter confirmado o commit. Duplicatas são seguras (upsert).
        await PISMarketStore.finishBatch(job.id);
        if (++completedMarketBatches % 100 === 0)
          void PISMarketStore.trimDoneBatches?.().catch(() => {});
        recordMarket(route, stats.conflicts ? 'conflito_de_transação' : 'gravado', page);
        await Promise.allSettled([
          recordPageReceipt(job, 'gravado', job.rows.length),
          job.traceEvent ? PISHistoryTrace.record(job.traceEvent, job.trace ?? {},
            { status: 'gravado', accepted: job.rows.length, ...stats }) : Promise.resolve(),
        ]);
        try { PISOpportunityAlerts.wake(); } catch { /* alertas têm recuperação própria */ }
        if (job.kind === 'listing' && Number.isSafeInteger(job.tabId) && chrome.tabs?.sendMessage) {
          chrome.tabs.sendMessage(job.tabId, { type: 'PIS_MARKET_LISTINGS_COMMITTED' }, { frameId: 0 })
            .catch(() => {});
        }
      } catch (error) {
        recordMarket(route, 'falha_na_gravação', page);
        if (job.traceEvent) void PISHistoryTrace.record(job.traceEvent, job.trace ?? {},
          { status: 'falha_na_gravação', accepted: job.rows.length }).catch(() => {});
        console.warn('[PIS] Lote preservado para nova tentativa:', String(error?.message ?? error));
        try { await PISMarketStore.deferBatch(job.id, (job.attempts || 0) + 1); }
        catch (failure) { console.warn('[PIS] Falha ao atualizar tentativa:', failure?.message); }
        // Um lote defeituoso não deve bloquear todos os outros: o job
        // permanece durável com backoff e a fila avança para os demais.
        continue;
      }
    }
  })().catch(error => console.warn('[PIS] Fila de mercado:', error?.message))
    .finally(() => {
      drainingMarketQueue = false;
      if (marketQueueRequested) wakeMarketQueue();
    });
}

if (chrome.alarms?.onAlarm) chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === MARKET_QUEUE_ALARM) wakeMarketQueue();
});
if (chrome.alarms?.create) chrome.alarms.create(MARKET_QUEUE_ALARM, { periodInMinutes: 1 }).catch(() => {});
Promise.resolve(PISMarketStore.initialize()).then(() => {
  void PISMarketStore.trimDoneBatches?.().catch(() => {});
  wakeMarketQueue();
}).catch(() => {});

chrome.runtime.onMessage.addListener((req, sender, reply) => {
  try {
  // Health check leve para recuperar após suspensão/reinício do MV3.
  if (req?.type === 'PIS_BRIDGE_HEALTH') {
    if (sender.id !== chrome.runtime.id || !sender.tab || !PIS_HOST.test(String(sender.url || sender.tab.url || ''))) {
      reply({ ok: false, error: 'origem inválida' });
      return false;
    }
    reply({ ok: true, ready: true, version: chrome.runtime.getManifest?.().version ?? null });
    return false;
  }
  if (req?.type === 'PIS_TEST_PURCHASE_REVIEW') {
    if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('opportunities.html')) { reply({ ok: false, error: 'origem inválida' }); return false; }
    PISGameTab.review({ id: 'demo', pokemonId: 'demo', speciesId: '94', currency: 'gold',
      name: 'Gengar', observedAt: Date.now(), price: 1000000 }, true)
      .then(ok => reply({ ok }), () => reply({ ok: false }));
    return true;
  }
  if (req?.type === 'PIS_REVIEW_OFFER') {
    if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('opportunities.html') ||
        typeof req.key !== 'string' || req.key.length > 200) { reply({ ok: false, error: 'requisição inválida' }); return false; }
    PISOpportunityAlerts.review(req.key).then(ok => reply({ ok }), () => reply({ ok: false }));
    return true;
  }
  if (req?.type === 'PIS_COPY_SMART_COINS') {
    if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('opportunities.html')) { reply({ ok: false, error: 'origem inválida' }); return false; }
    (async () => {
      const tabId = lastGameTab ?? (await chrome.storage.session.get(gameTabKey))[gameTabKey];
      if (!Number.isSafeInteger(tabId)) return { ok: false, reason: 'no_tab' };
      const response = await chrome.tabs.sendMessage(tabId, { type: 'PIS_READ_SMART_COINS' }, { frameId: 0 });
      if (response?.rows === null) return { ok: false, reason: 'no_cache' };
      if (!Array.isArray(response?.rows) || response.rows.length > 150000) return { ok: false, reason: 'invalid' };
      let added = 0;
      let checked = 0;
      for (let i = 0; i < response.rows.length; i += PISMarketCore.MAX_BATCH) {
        const rows = PISMarketCore.validate('sale', response.rows.slice(i, i + PISMarketCore.MAX_BATCH))
          .filter(row => row.currency === 'gold' && !PISMarketCore.isOutland(row))
          .map(row => ({ ...row, source: 'smartmarket_backup' }));
        if (rows.length) {
          const stats = await PISMarketStore.ingest('sale', rows);
          added += stats.new;
          checked += rows.length;
        }
      }
      PISOpportunityAlerts.wake();
      return { ok: true, added, checked };
    })().then(reply, () => reply({ ok: false, reason: 'invalid' }));
    return true;
  }
  if (req?.type === 'PIS_LOOKUP_COINS') {
    if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('opportunities.html') ||
        typeof req.name !== 'string' || req.name.length > 80) { reply({ ok: false, error: 'requisição inválida' }); return false; }
    (async () => {
      const tabId = lastGameTab ?? (await chrome.storage.session.get(gameTabKey))[gameTabKey];
      if (!Number.isSafeInteger(tabId)) return { ok: false };
      return chrome.tabs.sendMessage(tabId, { type: 'PIS_COINS_HISTORY_LOOKUP', name: req.name }, { frameId: 0 });
    })().then(result => reply({ ok: result?.ok === true }), () => reply({ ok: false }));
    return true;
  }
  if (req?.type === 'PIS_INVENTORY_QUOTE') {
    if (sender.id !== chrome.runtime.id || sender.frameId !== 0 || !sender.tab ||
        !PIS_HOST.test(String(sender.url || sender.tab.url || ''))) { reply({ ok: false, error: 'origem inválida' }); return false; }
    const profile = req.profile;
    const [target] = PISMarketCore.validate('listing', [{
      ...profile, id: profile?.pokemonId, currency: 'gold', price: 1,
    }]);
    if (!target || !target.name || !(target.level > 0)) { reply({ ok: false, error: 'perfil inválido' }); return false; }
    PISMarketStore.inventoryQuote(target).then(quotes => reply({ quotes }), () => reply({ quotes: null }));
    return true;
  }
  if (req?.type === 'PIS_MARKET_BADGES') {
    if (!sender.tab || !PIS_HOST.test(String(sender.url || sender.tab.url || '')) ||
        !Array.isArray(req.offers) || req.offers.length > 100) { reply({ ok: false, error: 'ofertas inválidas', offers: [] }); return false; }
    const candidates = req.offers.filter(row => ['gold', 'orb'].includes(row?.currency) &&
      typeof row.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(row.id) &&
      Number.isSafeInteger(row.price) && row.price > 0).map(({ id, currency, price, priceTick }) => ({
      id, currency, price, priceTick: currency === 'gold' && Number.isSafeInteger(priceTick) && priceTick > 1 &&
        priceTick <= 1e9 ? priceTick : 1,
    }));
    (async () => {
      // Apenas observações normalizadas do jogo, nunca um preço vindo do DOM.
      const observations = Array.isArray(req.observations) && req.observations.length <= 100
        ? PISMarketCore.validate('listing', req.observations).filter(row => !row.closed) : [];
      const rows = await PISMarketStore.marketBadges(candidates, Date.now(), observations);
      return rows.map(({ offer, row, excluded }) => {
        if (excluded) return { ...offer, actualPrice: row.price, excluded: true };
        const estimate = row.estimate;
        // A vitrine em Gemas cita só a referência da base pública, mesmo que o motor de alertas tenha fallback.
        const publicSource = row.currency === 'orb' && estimate?.method === 'briaoale_public' &&
          PISPublicGems.freshTimestamp(estimate.sourceAt);
        const quote = (row.currency === 'gold' || publicSource) && estimate?.status === 'estimated' &&
          [estimate.lower, estimate.median, estimate.upper].every(value => Number.isSafeInteger(value) && value > 0) ? {
            lower: estimate.lower, median: estimate.median, upper: estimate.upper,
            indicative: estimate.alertSupported !== true || estimate.bepi === true,
          } : null;
        return { ...offer, actualPrice: row.price, quote,
          ...(publicSource ? { validUntil: estimate.sourceAt + PISPublicGems.MAX_AGE } : {}) };
      });
    })().then(offers => reply({ ok: true, offers }), error => reply({ ok: false, error: String(error?.message ?? error), offers: [] }));
    return true;
  }
  const history = req?.type === 'PIS_MARKET_HISTORY_EVENT';
  if (!history && !['PIS_MARKET_CORE_BATCH', 'PIS_MARKET_MONITOR', 'PIS_MARKET_UNAVAILABLE', 'PIS_CLAIM_INCOMPLETE_SALE', 'PIS_MARKET_QUERY', 'PIS_COINS_HISTORY_STATUS'].includes(req?.type)) return false;
  if (!sender.tab || !PIS_HOST.test(String(sender.url || sender.tab.url || ''))) {
    reply({ ok: false, error: 'origem inválida' });
    return false;
  }
  PISGameTab.remember(sender.tab.id);
  if (req.type === 'PIS_CLAIM_INCOMPLETE_SALE') {
    PISMarketStore.claimIncompleteSale().then(row => reply({ row }), () => reply({ row: null }));
    return true;
  }
  if (req.type === 'PIS_MARKET_QUERY') {
    if (!['gold', 'orb', 'history'].includes(req.route) || !['enviada', 'resposta', 'recuo', 'recusada',
      'cancelada', 'sem_resposta', 'falha_de_envio', 'desconectada'].includes(req.status)) { reply({ ok: false, error: 'consulta inválida' }); return false; }
    const query = { status: req.status, at: Date.now(),
      page: Number.isSafeInteger(req.page) && req.page >= 0 ? req.page : null,
      order: ['recentes', 'baratos'].includes(req.order) ? req.order : null,
      duração_ms: req.status === 'resposta' && Number.isSafeInteger(req.durationMs) &&
        req.durationMs >= 0 && req.durationMs <= 120000 ? req.durationMs : null };
    recordMarket(req.route, query.status, query.page);
    chrome.storage.session.set({ ['pisMarketQuery:' + req.route]: query })
      .then(() => reply({ ok: true }), () => reply({ ok: false }));
    return true;
  }
  if (req.type === 'PIS_COINS_HISTORY_STATUS') {
    if (!['global', 'espécie', 'backfill'].includes(req.scope) || typeof req.state !== 'string' || req.state.length > 40) { reply({ ok: false, error: 'estado inválido' }); return false; }
    chrome.storage.session.set({ ['pisCoinsHistory:' + req.scope]: { state: req.state, at: Date.now(),
      reason: ['schema_incompatível', 'sem_resposta', 'falha_na_gravação', 'recusada', 'desconectada', 'recuo',
        'cancelada', 'falha_de_envio'].includes(req.reason) ? req.reason : null,
      page: Number.isSafeInteger(req.page) && req.page >= 0 ? req.page : null,
      oldest: Number.isSafeInteger(req.oldest) ? req.oldest : null } })
      .then(() => reply({ ok: true }), () => reply({ ok: false }));
    return true;
  }
  if (req.type === 'PIS_MARKET_MONITOR') {
    if (!['aguardando_socket', 'rastreador_desligado', 'aguardando_tráfego', 'parser_indisponível', 'recuo', 'varrendo', 'vitrine_aberta', 'falha_ou_recuo'].includes(req.state)) { reply({ ok: false, error: 'monitor inválido' }); return false; }
    recordMarket('monitor', req.state);
    chrome.storage.session.set({ pisMarketMonitor: { state: req.state, at: Date.now(),
      socket: ['abertura', 'envio do jogo', 'consulta do jogo', 'tráfego', 'estado'].includes(req.socket) ? req.socket : null,
      versão_na_aba: typeof req.version === 'string' && /^\d{1,4}(?:\.\d{1,4}){3}$/.test(req.version) ? req.version : null,
      módulos: { parser: req.modules?.parser === true, histórico: req.modules?.histórico === true },
      tráfego: {
        ...Object.fromEntries(['recebidos', 'estados', 'vitrine', 'histórico', 'outros', 'binários']
          .map(key => [key, Number.isSafeInteger(req.wire?.[key]) && req.wire[key] >= 0 ? req.wire[key] : 0])),
        formatos: Object.fromEntries(['fora_do_limite', 'json_com_prefixo', 'texto', 'lista_json',
          'ping_pong', 'json_com_t', 'json_com_type', 'json_sem_tipo', 'json_inválido']
          .filter(key => Number.isSafeInteger(req.wire?.formatos?.[key]) && req.wire.formatos[key] > 0)
          .map(key => [key, req.wire.formatos[key]])),
      } } })
      .then(() => reply({ ok: true }), () => reply({ ok: false }));
    return true;
  }
  if (req.type === 'PIS_MARKET_UNAVAILABLE') {
    const now = Date.now();
    if (!Array.isArray(req.ids) || req.ids.length > 100 || !Number.isSafeInteger(req.cutoff) ||
        req.cutoff > now || now - req.cutoff > 2 * 3600000) { reply({ ok: false, error: 'indisponibilidade inválida' }); return false; }
    const ids = req.ids.filter(id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id));
    PISMarketStore.markUnavailable(ids, req.cutoff)
      .then(() => reply({ ok: true }), () => reply({ ok: false }));
    return true;
  }
  // Eventos de rastreamento sem lote respondem mesmo se a gravação do trace falhar.
  const historyEvent = history ? req.event : null;
  if (history && !['request', 'response', 'invalid_json', 'ignored_socket'].includes(historyEvent)) {
    reply({ ok: false, error: 'evento de histórico inválido' });
    return false;
  }
  if (history && historyEvent !== 'response') {
    Promise.resolve().then(() => PISHistoryTrace.record(historyEvent, req.trace ?? {}, undefined))
      .then(() => reply({ ok: true }), error => reply({ ok: false, error: String(error?.message ?? error) }));
    return true;
  }
  const kind = history ? 'sale' : req.kind;
  if (!['sale', 'listing'].includes(kind) || !Array.isArray(req.rows) || req.rows.length > 100) {
    reply({ ok: false, error: 'lote inválido' });
    return false;
  }
  let rows;
  try { rows = PISMarketCore.validate(kind, req.rows); }
  catch (error) { reply({ ok: false, error: String(error?.message ?? error) }); return false; }
  const route = history ? 'history' : req.currency;
  const page = history ? req.trace?.page : req.page;
  const invalidHistory = history && req.rows.length !== rows.length;
  if (invalidHistory || (req.rows.length > 0 && !rows.length) ||
      (!rows.length && req.automatic !== true && !history)) {
    recordMarket(route, 'lote_inválido', page);
    reply({ ok: false, error: 'lote inválido' });
    return false;
  }
  if (!rows.length) {
    Promise.resolve().then(() => Promise.all([
      recordPageReceipt({ ...req, kind }, 'sem_registros_validos', 0),
      history ? PISHistoryTrace.record(req.event, req.trace ?? {},
        { status: 'sem_registros_validos', accepted: 0 }) : Promise.resolve(),
    ])).then(() => reply({ ok: true, accepted: 0 }),
      error => reply({ ok: false, error: String(error?.message ?? error) }));
    return true;
  }
  if (!marketQueueAvailable()) { reply({ ok: false, error: 'fila persistente indisponível' }); return false; }
  const id = typeof req.batchId === 'string' && /^[A-Za-z0-9:_-]{8,130}$/.test(req.batchId)
    ? req.batchId : 'legacy:' + Date.now().toString(36) + ':' + Math.random().toString(36).slice(2, 12);
  const job = { id, kind, rows, history, traceEvent: history ? req.event : kind === 'sale' ? 'legacy_batch' : null,
    trace: history ? req.trace ?? {} : {},
    automatic: req.automatic === true, viewing: req.viewing === true && req.automatic !== true,
    order: ['recentes', 'baratos'].includes(req.order) ? req.order : null,
    page: req.page, currency: req.currency, preparation: req.preparation === true,
    totalRows: req.totalRows, tabId: sender.tab.id,
    options: { live: req.live === true, priceWatch: req.priceWatch === true,
      olderScan: req.automatic === true && req.preparation === true && req.olderScan === true } };
  job.priority = globalThis.PISMarketPriority?.forJob(job) ?? 2;
  PISMarketStore.enqueueBatch(job).then(
    async receipt => {
      recordMarket(route, 'enfileirado', page);
      await recordPageReceipt(job, 'enfileirado', rows.length);
      // ACK significa PERSISTIDO na fila, não estimado ou processado.
      reply({ ok: true, queued: true, duplicate: receipt.duplicate === true, batchId: id });
      wakeMarketQueue();
    },
    error => {
      recordMarket(route, 'falha_na_gravação', page);
      reply({ ok: false, error: String(error?.message ?? error).slice(0, 300) });
    },
  ).catch(error => {
    // Falhas de telemetria nunca deixam o canal sem resposta nem apagam o lote já persistido.
    reply({ ok: true, queued: true, batchId: id, warning: String(error?.message ?? error) });
    wakeMarketQueue();
  });
  return true;
  } catch (error) {
    // Nenhuma validação inesperada deixa a requisição reconhecida sem resposta.
    try { reply({ ok: false, error: String(error?.message ?? error).slice(0, 300) }); } catch {}
    return false;
  }
});

chrome.runtime.onMessage.addListener((req, sender, responder) => {
  if (!req || req.type !== 'PIS_SHEETS_POST') return false;
  (async () => {
    try {
      if (!sender || !sender.tab || !PIS_HOST.test(String(sender.url || sender.tab.url || '')))
        throw new Error('origem de mensagem não autorizada');
      if (!Array.isArray(req.linhas) || req.linhas.length < 1 || req.linhas.length > 100)
        throw new Error('lote inválido (1 a 100 eventos)');
      if (!req.linhas.every(r => r && typeof r === 'object' && !Array.isArray(r) &&
          typeof r.evento_id === 'string' && r.evento_id.length > 0 && r.evento_id.length <= 128))
        throw new Error('evento_id ausente ou inválido');
      const corpo = JSON.stringify({ linhas: req.linhas });
      if (corpo.length > 3000000) throw new Error('lote ultrapassou 3 MB');
      const controller = new AbortController();
      const abortar = setTimeout(() => controller.abort(), 30000);
      let response;
      try {
        response = await fetch(SHEETS_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: corpo,
          redirect: 'follow',
          credentials: 'omit',
          cache: 'no-store',
          signal: controller.signal
        });
      } finally { clearTimeout(abortar); }
      if (!response.ok) throw new Error(`Google Apps Script respondeu HTTP ${response.status}`);
      const retorno = (await response.text()).slice(0, 12000);
      let json;
      try { json = JSON.parse(retorno); }
      catch { throw new Error('Apps Script retornou HTML/texto em vez de JSON; verifique acesso público, implantação e URL /exec'); }
      if (!json || json.ok !== true)
        throw new Error(`Apps Script não gravou: ${String(json && json.erro || 'ok:true ausente').slice(0, 500)}`);
      // A versão 1.4.5 do receptor informa quantos eventos efetivamente tratou.
      // Não marcar dados locais como enviados quando há apenas um "ok:true" vazio.
      const recebidos = Number(json.eventos_recebidos);
      const novos = Number(json.eventos_novos);
      const duplicados = Number(json.eventos_duplicados);
      const semId = Number(json.sem_evento_id);
      const inteiros = [recebidos, novos, duplicados, semId]
        .every(n => Number.isSafeInteger(n) && n >= 0);
      if (!inteiros || recebidos !== req.linhas.length ||
          novos + duplicados + semId !== recebidos || semId !== 0)
        throw new Error('Apps Script não confirmou todos os eventos: confira Execuções e a aba eventos');
      responder({ ok: true, resultado: json });
    } catch (err) {
      responder({ ok: false, error: String(err && err.message || err).slice(0, 600) });
    }
  })();
  return true;
});
