// PokeIdle Market Sniper v1.5.4.1 - envio de eventos pelo service worker da extensão.
// Domínio de destino fixo. Nunca usa um endereço fornecido pela própria página do jogo.
const SHEETS_URL = 'https://script.google.com/macros/s/AKfycbwPXSeG3xL5PUwDwsuCp-XWJ8s8w3qmlGxECTJo_haREmZbeKOOnr_5qTfVZtH5xmDS/exec';
const PIS_HOST = /^https:\/\/(?:[a-z0-9-]+\.)?pokeidle\.io(?:\/|$)/i;

importScripts('market-core.js', 'pricing-model.js', 'liquidity.js', 'opportunities.js', 'market-store.js',
  'history-trace.js');

const gameTabKey = 'marketGameTab';
let lastGameTab;
const PISGameTab = {
  remember(tabId) {
    if (lastGameTab === tabId) return;
    lastGameTab = tabId;
    chrome.storage.session.set({ [gameTabKey]: tabId }).catch(() => {});
  },
  async show(title, message, test = false) {
    const tabId = lastGameTab ?? (await chrome.storage.session.get(gameTabKey))[gameTabKey];
    if (!Number.isSafeInteger(tabId)) return false;
    try {
      const reply = await chrome.tabs.sendMessage(tabId, { type: 'PIS_MARKET_TOAST', title, message, test }, { frameId: 0 });
      return reply?.ok === true;
    } catch { return false; }
  }
};

importScripts('opportunities-worker.js');
PISMarketStore.initialize().catch(error => {
  console.warn('[PIS] Não foi possível iniciar o banco de mercado:', error.message);
});

let listingPending = 0;
let salePending = 0;
chrome.runtime.onMessage.addListener((req, sender, reply) => {
  if (req?.type === 'PIS_TEST_GAME_TOAST') {
    if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('opportunities.html')) return false;
    PISGameTab.show('PokeSniper · Aviso de teste', 'Este aviso aparece dentro da aba do PokéIdle.', true)
      .then(ok => reply({ ok }), () => reply({ ok: false }));
    return true;
  }
  const history = req?.type === 'PIS_MARKET_HISTORY_EVENT';
  if (!history && req?.type !== 'PIS_MARKET_CORE_BATCH') return false;
  if (!sender.tab || !PIS_HOST.test(String(sender.url || sender.tab.url || ''))) {
    reply({ ok: false, error: 'origem inválida' });
    return false;
  }
  PISGameTab.remember(sender.tab.id);
  const track = receipt => history ? PISHistoryTrace.record(req.event, req.trace || {}, receipt)
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
  if (!rows.length || full) {
    track({ status: rows.length ? 'fila_cheia' : 'sem_registros_validos', accepted: rows.length })
      .then(() => reply({ ok: history && !rows.length, error: rows.length ? 'fila local cheia' : 'lote inválido' }));
    return true;
  }
  if (isSale) salePending++;
  else listingPending++;
  PISMarketStore.ingest(kind, rows)
    .then(
      stats => track({ status: 'gravado', accepted: rows.length, ...stats })
        .then(() => { reply({ ok: true }); PISOpportunityAlerts.wake(); }),
      error => track({ status: 'falha_na_gravação', accepted: rows.length })
        .then(() => reply({ ok: false, error: String(error.message).slice(0, 300) })),
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
