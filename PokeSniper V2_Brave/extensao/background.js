// PokeIdle Market Sniper v1.5.4.1 - envio de eventos pelo service worker da extensão.
// Domínio de destino fixo. Nunca usa um endereço fornecido pela própria página do jogo.
const SHEETS_URL = 'https://script.google.com/macros/s/AKfycbwPXSeG3xL5PUwDwsuCp-XWJ8s8w3qmlGxECTJo_haREmZbeKOOnr_5qTfVZtH5xmDS/exec';
const PIS_HOST = /^https:\/\/(?:[a-z0-9-]+\.)?pokeidle\.io(?:\/|$)/i;

importScripts('vendor/briaoale/especies.js', 'vendor/briaoale/pve-power.js', 'vendor/briaoale/market-bonuses.js', 'vendor/briaoale/central.js', 'vendor/briaoale/nota.js', 'vendor/briaoale/pve-pricing.js');
importScripts('market-core.js', 'coin-market.js', 'pricing-model.js', 'liquidity.js', 'opportunities.js', 'market-store.js',
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
  async show(title, message, test = false, sprite = null, offer = null, spriteFallback = null) {
    const tabId = lastGameTab ?? (await chrome.storage.session.get(gameTabKey))[gameTabKey];
    if (!Number.isSafeInteger(tabId)) return false;
    try {
      const reply = await chrome.tabs.sendMessage(tabId, { type: 'PIS_MARKET_TOAST', title, message, test, sprite: PISMarketCore.safeSprite(sprite), offer, spriteFallback: PISMarketCore.safeSprite(spriteFallback) }, { frameId: 0 });
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

let listingPending = 0;
let salePending = 0;
chrome.runtime.onMessage.addListener((req, sender, reply) => {
  if (req?.type === 'PIS_TEST_PURCHASE_REVIEW') {
    if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('opportunities.html')) return false;
    PISGameTab.review({ id: 'demo', pokemonId: 'demo', speciesId: '94', currency: 'gold',
      name: 'Gengar', observedAt: Date.now(), price: 1000000 }, true)
      .then(ok => reply({ ok }), () => reply({ ok: false }));
    return true;
  }
  if (req?.type === 'PIS_REVIEW_OFFER') {
    if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('opportunities.html') ||
        typeof req.key !== 'string' || req.key.length > 200) return false;
    PISOpportunityAlerts.review(req.key).then(ok => reply({ ok }), () => reply({ ok: false }));
    return true;
  }
  if (req?.type === 'PIS_COPY_SMART_COINS') {
    if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('opportunities.html')) return false;
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
        typeof req.name !== 'string' || req.name.length > 80) return false;
    (async () => {
      const tabId = lastGameTab ?? (await chrome.storage.session.get(gameTabKey))[gameTabKey];
      if (!Number.isSafeInteger(tabId)) return { ok: false };
      return chrome.tabs.sendMessage(tabId, { type: 'PIS_COINS_HISTORY_LOOKUP', name: req.name }, { frameId: 0 });
    })().then(result => reply({ ok: result?.ok === true }), () => reply({ ok: false }));
    return true;
  }
  if (req?.type === 'PIS_INVENTORY_QUOTE') {
    if (sender.id !== chrome.runtime.id || sender.frameId !== 0 || !sender.tab ||
        !PIS_HOST.test(String(sender.url || sender.tab.url || ''))) return false;
    const profile = req.profile;
    const [target] = PISMarketCore.validate('listing', [{
      ...profile, id: profile?.pokemonId, currency: 'gold', price: 1,
    }]);
    if (!target || !target.name || !(target.level > 0)) return false;
    PISMarketStore.inventoryQuote(target).then(quotes => reply({ quotes }), () => reply({ quotes: null }));
    return true;
  }
  if (req?.type === 'PIS_MARKET_BADGES') {
    if (!sender.tab || !PIS_HOST.test(String(sender.url || sender.tab.url || '')) ||
        !Array.isArray(req.offers) || req.offers.length > 100) return false;
    const candidates = req.offers.filter(row => ['gold', 'orb'].includes(row?.currency) &&
      typeof row.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(row.id) &&
      Number.isSafeInteger(row.price) && row.price > 0).map(({ id, currency, price, priceTick }) => ({
      id, currency, price, priceTick: currency === 'gold' && Number.isSafeInteger(priceTick) && priceTick > 1 &&
        priceTick <= 1e9 ? priceTick : 1,
    }));
    (async () => {
      const rows = await PISMarketStore.marketBadges(candidates);
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
    })().then(offers => reply({ offers }), () => reply({ offers: [] }));
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
      'cancelada', 'sem_resposta', 'falha_de_envio', 'desconectada'].includes(req.status)) return false;
    const query = { status: req.status, at: Date.now(),
      page: Number.isSafeInteger(req.page) && req.page >= 0 ? req.page : null,
      order: ['recentes', 'baratos'].includes(req.order) ? req.order : null };
    recordMarket(req.route, query.status, query.page);
    chrome.storage.session.set({ ['pisMarketQuery:' + req.route]: query })
      .then(() => reply({ ok: true }), () => reply({ ok: false }));
    return true;
  }
  if (req.type === 'PIS_COINS_HISTORY_STATUS') {
    if (!['global', 'espécie', 'backfill'].includes(req.scope) || typeof req.state !== 'string' || req.state.length > 40) return false;
    chrome.storage.session.set({ ['pisCoinsHistory:' + req.scope]: { state: req.state, at: Date.now(),
      reason: ['schema_incompatível', 'sem_resposta', 'falha_na_gravação', 'recusada', 'desconectada', 'recuo',
        'cancelada', 'falha_de_envio'].includes(req.reason) ? req.reason : null,
      page: Number.isSafeInteger(req.page) && req.page >= 0 ? req.page : null,
      oldest: Number.isSafeInteger(req.oldest) ? req.oldest : null } })
      .then(() => reply({ ok: true }), () => reply({ ok: false }));
    return true;
  }
  if (req.type === 'PIS_MARKET_MONITOR') {
    if (!['aguardando_socket', 'rastreador_desligado', 'aguardando_tráfego', 'parser_indisponível', 'recuo', 'varrendo', 'vitrine_aberta', 'falha_ou_recuo'].includes(req.state)) return false;
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
        req.cutoff > now || now - req.cutoff > 2 * 3600000) return false;
    const ids = req.ids.filter(id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id));
    PISMarketStore.markUnavailable(ids, req.cutoff)
      .then(() => reply({ ok: true }), () => reply({ ok: false }));
    return true;
  }
  function pageReceipt(status, accepted) {
    if (req.kind !== 'listing' || req.automatic !== true) return Promise.resolve();
    const currency = ['gold', 'orb'].includes(req.currency) ? req.currency : null;
    const page = { status, accepted, page: Number.isSafeInteger(req.page) ? req.page : null, currency,
      preparação_de_selos: req.preparation === true,
      totalRows: Number.isSafeInteger(req.totalRows) ? req.totalRows : null, at: Date.now() };
    const receipts = { pisMarketAutomaticPage: page };
    if (currency) {
      receipts['pisMarketPage:' + currency] = page;
      if (req.preparation === true) receipts['pisMarketPrepared:' + currency] = page;
      if (page.status === 'gravado' && page.page != null && page.page >= 0 && page.page <= 999) {
        const prefix = currency === 'gold' ? 'pisCoinSeenPage:' : 'pisGemSeenPage:';
        receipts[prefix + page.page] = page.at;
      }
    }
    return chrome.storage.session.set(receipts).catch(() => {});
  }
  const traceEvent = history ? req.event : req.kind === 'sale' ? 'legacy_batch' : null;
  const track = receipt => traceEvent ? PISHistoryTrace.record(traceEvent, history ? req.trace || {} : {}, receipt)
    .catch(() => console.warn('[PIS] Falha ao guardar o diagnóstico do histórico.')) : Promise.resolve();
  if (history && req.event !== 'response') {
    track().then(() => reply({ ok: true }));
    return true;
  }
  const kind = history ? 'sale' : req.kind;
  const rows = PISMarketCore.validate(kind, req.rows);
  const isSale = kind === 'sale';
  // Reserva vagas para páginas de histórico durante um censo da vitrine.
  const full = isSale ? salePending >= 4 : listingPending >= 16;
  const route = history ? 'history' : req.currency;
  const page = history ? req.trace?.page : req.page;
  const invalidHistory = history && Array.isArray(req.rows) && req.rows.length !== rows.length;
  if (!rows.length || full || invalidHistory) {
    const status = invalidHistory ? 'lote_inválido' : rows.length ? 'fila_cheia' : 'sem_registros_validos';
    recordMarket(route, status, page);
    Promise.all([track({ status, accepted: rows.length }), pageReceipt(status, rows.length)])
      .then(() => reply({ ok: !invalidHistory && (history || req.automatic === true) && !rows.length,
        error: rows.length ? 'fila local cheia' : 'lote inválido' }));
    return true;
  }
  if (isSale) salePending++;
  else listingPending++;
  PISMarketStore.ingest(kind, rows, undefined, { live: req.live === true })
    .then(
      stats => {
        PISOpportunityAlerts.wake();
        recordMarket(route, stats.conflicts ? 'conflito_de_transação' : 'gravado', page);
        return Promise.all([track({ status: 'gravado', accepted: rows.length, ...stats }), pageReceipt('gravado', rows.length)])
          .then(() => reply({ ok: true }));
      },
      error => {
        recordMarket(route, 'falha_na_gravação', page);
        return Promise.all([track({ status: 'falha_na_gravação', accepted: rows.length }), pageReceipt('falha_na_gravação', rows.length)])
          .then(() => reply({ ok: false, error: String(error.message).slice(0, 300) }));
      },
    )
    .finally(() => { if (isSale) salePending--; else listingPending--; });
  return true;
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
