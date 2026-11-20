const form = document.querySelector('#settings');
const offers = document.querySelector('#offers');
const panelStatus = document.querySelector('#status');
const saveStatus = document.querySelector('#save-status');
const saveFilters = document.querySelector('#save-filters');
const noticeToggles = [...document.querySelectorAll('#toggle-notices, #filter-notices')];
const offersEmpty = document.querySelector('#offers-empty');
const offersPanel = document.querySelector('#panel-offers');
const tabs = [...document.querySelectorAll('[role="tab"]')];
const inOverlay = window.parent !== window;
const main = document.querySelector('.pis-v2-main');
const header = document.querySelector('.pis-v2-header');
const navigation = document.querySelector('.pis-v2-tabs');
let panelVisible = !inOverlay;
const noticeStatus = document.querySelector('#notice-status');
const format = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });
let config;
let generation = 0;
let rendered = '';
const diagnostics = document.querySelector('#diagnostics');
const noticeTime = new Intl.DateTimeFormat('pt-BR', { timeStyle: 'medium', timeZone: 'America/Sao_Paulo' });
let expiryTimer;

function text(tag, value, className) {
  const element = document.createElement(tag);
  element.textContent = value;
  if (className) element.className = className;
  return element;
}

const percent = value => format.format(value * 100) + '%';
const profileStatus = {
  missing_fields_or_sales: 'Histórico sem atributos completos para o perfil',
  no_temporal_validation: 'Modelo detalhado ainda sem validação para este grupo',
  rare_profile: 'Perfil raro · alerta automático retido',
};

function liquidityText(report, days) {
  if (report.status === 'incomplete_profile') return 'Faltam atributos, incluindo IVs individuais, para avaliar a liquidez.';
  const value = report.horizons.find(row => row.days === days);
  if (value.status === 'estimated') {
    return `${percent(value.probability)} em ${days} d · faixa ${percent(value.lower)}–${percent(value.upper)} · ${value.count} acompanhados`;
  }
  return `Em ${days} d, evidência insuficiente · ${value.count} acompanhados · ${value.confirmed} vendas vinculadas · ${value.possible} vínculos possíveis`;
}

function detailsFor(row, unit) {
  const details = document.createElement('details');
  details.append(text('summary', 'Comparáveis e simulação de revenda'));
  const ivs = row.ivs || {};
  details.append(text('p', `P${row.power ?? '?'} · Qualidade ${row.quality ?? '?'} · IV total ${row.ivTotal ?? '?'} · Velocidade ${ivs.speed ?? '?'}`, 'pis-v2-meta'));
  details.append(text('p', `IVs HP ${ivs.hp ?? '?'} · Atq ${ivs.attack ?? '?'} · Def ${ivs.defense ?? '?'} · Atq Esp ${ivs.specialAttack ?? '?'} · Def Esp ${ivs.specialDefense ?? '?'}`, 'pis-v2-meta'));
  const estimate = row.estimate;
  for (const sale of estimate?.comparables || []) {
    details.append(text('div', `${format.format(sale.price)} ${unit} · Nv. ${sale.level} · Nota ${format.format(sale.grade)} · P${sale.power ?? '?'} · Vel. ${sale.speed ?? '?'} · ${new Date(sale.soldAt).toLocaleDateString('pt-BR')}`, 'pis-v2-meta'));
  }

  const simulator = document.createElement('form');
  const fields = document.createElement('div');
  fields.className = 'pis-v2-fields';
  const input = (name, label, value) => {
    const wrapper = text('label', label);
    const field = document.createElement('input');
    field.type = 'number';
    field.name = name;
    field.min = '1';
    field.required = true;
    field.value = value ?? '';
    wrapper.append(field);
    fields.append(wrapper);
  };
  input('level', 'Nível simulado', row.level);
  input('price', 'Preço de revenda', Math.round(estimate?.median ?? row.price));
  const run = text('button', 'Simular liquidez');
  const output = text('div', '', 'pis-v2-meta');
  output.setAttribute('aria-live', 'polite');
  simulator.append(fields, run, output);
  simulator.addEventListener('submit', async event => {
    event.preventDefault();
    run.disabled = true;
    output.textContent = 'Calculando com o histórico local…';
    try {
      const { level, price } = Object.fromEntries(new FormData(simulator));
      const report = await PISMarketStore.liquidity(row, Number(level), Number(price));
      output.replaceChildren(text('div', `Nv. ${level} · ${format.format(Number(price))} ${unit} · desde a primeira observação`));
      if (report.activity) {
        output.append(text('div', `${report.activity.recentSales} vendas parecidas em 30 d · ${report.activity.recentListings} anúncios parecidos vistos nos últimos 10 min`));
      }
      for (const days of report.horizons.length ? [1, 7, 30] : [7]) {
        output.append(text('div', liquidityText(report, days)));
      }
    } catch (error) {
      output.textContent = 'Falha ao ler o histórico de revenda. ' + error.message;
    } finally { run.disabled = false; }
  });
  details.append(simulator);
  return details;
}

function card(row, showLiquidity = false) {
  const item = document.createElement('li');
  const title = document.createElement('div');
  title.className = 'pis-v2-offer-title';
  const unit = row.currency === 'gold' ? 'Coins' : 'Gemas';
  title.append(text('strong', (row.name || 'Pokémon #' + row.speciesId) + (row.shiny ? ' · Shiny' : '')),
    text('strong', format.format(row.price) + ' ' + unit));
  const estimate = row.estimate;
  const minutes = Math.max(0, Math.floor((Date.now() - row.observedAt) / 60000));
  item.append(title, text('div', `Anúncio #${row.id} · Nv. ${row.level ?? '?'} · Nota ${row.grade ?? '?'} · observado há ${minutes} min`, 'pis-v2-meta'));
  if (estimate?.status === 'estimated') {
    const method = estimate.method === 'briaoale_public' ? 'histórico público · Briaoale' :
      estimate.method === 'coins_comparables' ? 'comparáveis em Coins' : estimate.method === 'briaoale_pve' ? 'motor de PvE · histórico local' : 'referência básica';
    const limit = PISOpportunities.priceLimit(row, config);
    const sample = ['briaoale_pve', 'briaoale_public'].includes(estimate.method)
      ? `${estimate.profileSales} vendas próximas da espécie · ${estimate.marketCount} na base do modelo`
      : `${estimate.count} vendas · n efetivo ${format.format(estimate.effectiveCount)}`;

    item.append(text('div', `Desconto ${percent(estimate.discount)} · mediana ${format.format(estimate.median)} · ${method}`, 'pis-v2-meta'),
      text('div', `Faixa ${format.format(estimate.lower)}–${format.format(estimate.upper)} · ${sample}`, 'pis-v2-meta'),
      text('div', `Teto de preço para alerta ${format.format(limit)} ${unit}`, 'pis-v2-meta'));
    if (estimate.confidence) item.append(text('div', 'Confiança: ' + estimate.confidence, 'pis-v2-meta'));
    if (estimate.alertSupported === false) item.append(text('div', 'Referência com poucos comparáveis próximos. Alerta suspenso.', 'pis-v2-meta'));
    if (estimate.sourceAt) {
      item.append(text('div', 'Base de Gemas atualizada em ' + new Date(estimate.sourceAt).toLocaleString('pt-BR'), 'pis-v2-meta'));
    }
    if (estimate.profileReason) item.append(text('div', profileStatus[estimate.profileReason], 'pis-v2-meta'));
  } else item.append(text('div', estimate?.status === 'excluded_outland'
    ? 'Outlaw excluído da precificação e dos alertas.'
    : 'Preço estimado indisponível para esta ficha e amostra.', 'pis-v2-meta'));
  if (showLiquidity && row.level > 0 && estimate?.status !== 'excluded_outland') {
    const summary = text('div', 'Consultando liquidez em 7 dias…', 'pis-v2-meta');
    item.append(summary);
    const price = Math.round(estimate?.median ?? row.price);
    PISMarketStore.liquidity(row, row.level, price)
      .then(report => { summary.textContent = `Liquidez a ${format.format(price)} ${unit} · ${liquidityText(report, 7)}`; })
      .catch(() => { summary.textContent = 'Liquidez indisponível nesta consulta.'; });
  }
  const species = row.currency === 'gold' && !PISMarketCore.isOutland(row) && PISCoinsHistory.cleanSpecies(row.name);
  if (species) {
    const update = text('button', 'Atualizar vendas em Coins');
    update.type = 'button';
    update.addEventListener('click', async () => {
      update.disabled = true;
      try {
        const result = await chrome.runtime.sendMessage({ type: 'PIS_LOOKUP_COINS', name: species });
        update.textContent = result?.ok ? 'Busca solicitada ao jogo' : 'Abra a aba do PokéIdle e tente novamente';
      } catch { update.textContent = 'Busca indisponível'; }
      finally { update.disabled = false; }
    });
    item.append(update);
  }
  item.append(detailsFor(row, unit));
  return item;
}

function opportunityCard(row) {
  const item = document.createElement('li');
  const details = document.createElement('details');
  details.dataset.offerKey = row.key;
  const summary = document.createElement('summary');
  summary.className = 'pis-v2-offer-title';
  const offer = PISOpportunities.presentation(row, row.deliveredAt, { noticeIvsOnly: true });
  const block = document.createElement('span');
  block.className = 'pis-v2-opportunity-copy';
  const heading = document.createElement('span');
  heading.append(text('strong', (row.name || 'Pokémon #' + row.speciesId) + (row.shiny ? ' · Shiny' : '')));
  const profile = PISOpportunities.profileSummary(row);
  if (profile) heading.append(text('span', ' - ' + profile, 'pis-v2-meta'));
  block.append(heading, text('span', `${offer.discount} · ${offer.asking}`, 'pis-v2-opportunity-price'));
  if (offer.tier) block.append(text('span', offer.tier, 'pis-v2-meta'));
  if (offer.composition) block.append(text('span', offer.composition, 'pis-v2-meta'));
  if (row.currency === 'orb') {
    const median = row.estimate.median;
    if (Number.isFinite(median) && median > 0) {
      block.append(text('span', `Preço justo ≈${format.format(median)} Gemas`, 'pis-v2-meta'));
    }
  } else if (offer.range) block.append(text('span', offer.range, 'pis-v2-meta'));
  if (offer.warning) block.append(text('span', offer.warning, 'pis-v2-meta'));
  const time = text('time', noticeTime.format(row.deliveredAt), 'pis-v2-meta');
  time.dateTime = new Date(row.deliveredAt).toISOString();
  block.append(time);
  const sprite = document.createElement('img');
  sprite.alt = '';
  sprite.className = 'pis-v2-opportunity-sprite';
  if (PISOpportunities.mountSprite(sprite, PISOpportunities.spriteCandidates(row))) summary.append(sprite);
  summary.append(block);
  details.append(summary);
  details.addEventListener('toggle', () => {
    if (details.open && details.childElementCount === 1) {
      const panel = card(row, true);
      const body = document.createElement('div');
      body.className = 'pis-v2-offer-extra';
      body.append(...panel.childNodes);
      if (PISMarketCore.purchaseOffer(row) && PISOpportunities.notificationEligible(row, config)) {
        const checkout = text('button', 'Revisar compra no jogo');
        checkout.type = 'button';
        checkout.addEventListener('click', async () => {
          checkout.disabled = true;
          try {
            const receipt = await chrome.runtime.sendMessage({ type: 'PIS_REVIEW_OFFER', key: row.key });
            if (receipt?.ok) checkout.textContent = 'Revisão aberta no PokéIdle';
            else checkout.textContent = 'Oferta indisponível ou jogo desconectado';
          } catch { checkout.textContent = 'Revisão indisponível'; }
          finally { checkout.disabled = false; }
        });
        body.append(checkout);
      }
      details.append(body);
    }
  });
  item.append(details);
  return item;
}

async function refresh() {
  if (!config || !panelVisible || offersPanel.hidden) return;
  const request = ++generation;
  try {
    const rows = await PISMarketStore.deliveredOpportunities();
    if (request !== generation) return;
    const cutoff = Date.now() - PISOpportunities.TTL;
    const visible = rows.filter(row => row.deliveredAt > cutoff);
    const signature = JSON.stringify([config, visible]);
    if (signature !== rendered) {
      const expanded = new Set([...offers.querySelectorAll('details[data-offer-key][open]')].map(card => card.dataset.offerKey));
      offers.replaceChildren(...visible.map(row => {
        const card = opportunityCard(row);
        if (expanded.has(row.key)) card.querySelector('details').open = true;
        return card;
      }));
      rendered = signature;
    }
    offersEmpty.hidden = visible.length !== 0;
    panelStatus.textContent = visible.length === 1 ? '1 aviso nos últimos 10 min.' : visible.length
      ? `${visible.length} avisos nos últimos 10 min.`
      : 'Nenhum aviso nos últimos 10 min.';
    clearTimeout(expiryTimer);
    if (visible.length) {
      const expiresAt = visible.at(-1).deliveredAt + PISOpportunities.TTL;
      expiryTimer = setTimeout(refresh, Math.max(0, expiresAt - Date.now()));
    }
  } catch {
    if (request === generation) {
      offersEmpty.hidden = true;
      panelStatus.textContent = 'Não foi possível ler os avisos recentes.';
    }
  }
}

async function refreshDiagnosticStats() {
  if (!config) return;
  try {
    const stats = await PISMarketStore.diagnostics(config);
    diagnostics.textContent = `${stats.listings} anúncios recentes · ${stats.sales} vendas no banco · ${stats.detailed} avaliados pelo perfil · ${stats.noEstimate} sem avaliação · ${stats.price} acima do preço de referência · ${stats.filters} barrados pelos filtros · ${stats.matched} oportunidades. Notificações ${config.notify ? 'ligadas' : 'desligadas'} · ${stats.pending} pendentes · ${stats.held} retidas · ${stats.sent} enviadas (${stats.sentInGame} no jogo · ${stats.sentDesktop} aceitas pelo Chrome) · ${stats.failed} com falha.`;
  } catch {
    diagnostics.textContent = 'Não foi possível ler o diagnóstico do mercado.';
  }
}

const copySmartCoins = document.querySelector('#copy-smart-coins');
copySmartCoins.addEventListener('click', async () => {
  const status = document.querySelector('#coins-import-status');
  copySmartCoins.disabled = true;
  status.textContent = 'Copiando as vendas em Coins da aba do jogo…';
  try {
    const receipt = await chrome.runtime.sendMessage({ type: 'PIS_COPY_SMART_COINS' });
    if (receipt?.ok) {
      status.textContent = `${receipt.added} vendas novas em Coins de ${receipt.checked} verificadas.`;
      await refresh();
    } else {
      status.textContent = receipt?.reason === 'no_cache'
        ? 'O cache do Smart Market não foi encontrado neste perfil.'
        : 'Abra e recarregue o PokéIdle e tente novamente. Você também pode importar um backup JSON.';
    }
  } catch { status.textContent = 'Falha ao copiar o cache de Coins.'; }
  finally { copySmartCoins.disabled = false; }
});

const coinsImport = document.querySelector('#coins-import');
coinsImport.addEventListener('change', async () => {
  const file = coinsImport.files[0];
  const status = document.querySelector('#coins-import-status');
  if (!file) return;
  coinsImport.disabled = true;
  try {
    if (file.size > 25 * 1024 * 1024) throw new Error('O arquivo excede 25 MiB.');
    const rows = PISCoinsHistory.importRows(JSON.parse(await file.text()), PISMarketCore);
    let added = 0;
    for (let offset = 0; offset < rows.length; offset += PISMarketCore.MAX_BATCH) {
      const receipt = await PISMarketStore.ingest('sale', rows.slice(offset, offset + PISMarketCore.MAX_BATCH));
      added += receipt.new;
      status.textContent = `${Math.min(rows.length, offset + PISMarketCore.MAX_BATCH)} de ${rows.length} verificadas…`;
    }
    status.textContent = `${added} vendas novas de ${rows.length} transações em Coins válidas. IDs repetidos foram conciliados.`;
    await refresh();
  } catch (error) { status.textContent = 'Falha ao importar. ' + error.message; }
  finally { coinsImport.disabled = false; coinsImport.value = ''; }
});

const salesBackupNow = document.querySelector('#sales-backup-now');
const salesBackupStatus = document.querySelector('#sales-backup-status');

const sheetAccess = document.querySelector('#sheet-access');
const sheetKey = document.querySelector('#sheet-key');
const sheetAccessStatus = document.querySelector('#sheet-access-status');
const saveSheetAccess = document.querySelector('#save-sheet-access');
const disconnectSheetAccess = document.querySelector('#disconnect-sheet-access');

function showSalesSync(result) {
  if (!result) throw new Error('Sem resposta da extensão.');
  const sending = result.error ? 'Envio: ' + result.error : result.saved || result.pending
    ? `${result.saved} vendas confirmadas no Sheets · ${result.pending ?? '?'} pendentes.` : 'Nenhuma venda pendente para enviar.';
  const pull = result.pull;
  const reading = !pull?.enabled ? '' : pull.error ? 'Leitura: ' + pull.error :
    `${pull.imported} vendas novas no banco local.` +
    (pull.skipped ? ` ${pull.skipped} registros incompletos, inválidos ou Outlaws ignorados.` : '') +
    (pull.more ? ' Ainda há páginas. A sincronização vai continuar.' : '');
  salesBackupStatus.textContent = [sending, reading].filter(Boolean).join(' ');
}

async function runSalesBackup(initial = false) {
  if (salesBackupNow.disabled) return;
  salesBackupNow.disabled = true;
  salesBackupStatus.textContent = 'Sincronizando vendas com ficha completa…';
  try {
    showSalesSync(await chrome.runtime.sendMessage({ type: initial ? 'PIS_START_SALES_BACKUP' : 'PIS_SYNC_SALES_BACKUP' }));
  } catch (error) { salesBackupStatus.textContent = error.message; }
  finally { salesBackupNow.disabled = false; }
}
salesBackupNow.addEventListener('click', () => runSalesBackup());

async function showSheetAccess() {
  const status = await chrome.runtime.sendMessage({ type: 'PIS_SALES_SHEET_ACCESS_STATUS' });
  disconnectSheetAccess.disabled = status?.enabled !== true;
  sheetAccessStatus.textContent = status?.enabled ?
    'Chave salva neste perfil. O histórico é lido durante a sincronização.' : 'Leitura da planilha desconectada.';
}

async function configureSheetAccess(key) {
  saveSheetAccess.disabled = disconnectSheetAccess.disabled = true;
  sheetAccessStatus.textContent = key ? 'Conectando e buscando vendas…' : 'Desconectando leitura…';
  try {
    const result = await chrome.runtime.sendMessage({ type: 'PIS_SET_SALES_SHEET_ACCESS', key });
    if (!result || (result.error && !result.pull)) throw new Error(result?.error ?? 'Sem resposta da extensão.');
    sheetKey.value = '';
    await showSheetAccess();
    if (key) showSalesSync(result);
  } catch (error) { sheetAccessStatus.textContent = error.message; }
  finally { saveSheetAccess.disabled = false; }
}

sheetAccess.addEventListener('submit', event => {
  event.preventDefault();
  const key = sheetKey.value.trim();
  if (key) void configureSheetAccess(key);
});
disconnectSheetAccess.addEventListener('click', () => configureSheetAccess(''));
showSheetAccess().catch(() => { sheetAccessStatus.textContent = 'Não foi possível verificar a conexão.'; });

const runDiagnostics = document.querySelector('#run-diagnostics');
const compareGemAttackIv = document.querySelector('#compare-gem-attack-iv');
const copyDiagnostics = document.querySelector('#copy-diagnostics');
const downloadDiagnostics = document.querySelector('#download-diagnostics');
const reportBox = document.querySelector('#diagnostic-report');
const testStatus = document.querySelector('#test-status');


document.querySelector('#sample-sale').addEventListener('click', async () => {
  const button = document.querySelector('#sample-sale');
  button.disabled = true;
  try {
    const row = await PISMarketStore.recentSaleSample();
    if (!row) { testStatus.textContent = 'Nenhuma venda com ficha completa no banco.'; return; }
    const { id, pokemonId, speciesId, name, currency, price, soldAt, grade, power, quality, ivTotal, ivs,
      level, shiny, sprite, spriteSource, source } = row;
    reportBox.value = JSON.stringify({ id, pokemonId: pokemonId ?? null, speciesId, name: name ?? null,
      currency, price, soldAt: new Date(soldAt).toISOString(), grade: grade ?? null, power: power ?? null,
      quality: quality ?? null, ivTotal: ivTotal ?? null, ivs, level: level ?? null, shiny, sprite: sprite ?? null,
      spriteSource: spriteSource ?? null, source: source ?? null }, null, 2);
    reportBox.hidden = false;
    copyDiagnostics.disabled = downloadDiagnostics.disabled = false;
    testStatus.textContent = 'Venda mais recente do seu IndexedDB. Campos nulos estão ausentes no registro.';
  } catch { testStatus.textContent = 'Falha ao ler uma venda do IndexedDB.'; }
  finally { button.disabled = false; }
});

runDiagnostics.addEventListener('click', async () => {
  compareGemAttackIv.disabled = runDiagnostics.disabled = runBacktest.disabled = true;
  copyDiagnostics.disabled = downloadDiagnostics.disabled = true;
  testStatus.textContent = 'Lendo o banco local e os registros de alertas…';
  try {
    const settings = config ?? PISOpportunities.settings();
    const permission = Promise.resolve().then(() => chrome.notifications.getPermissionLevel())
      .catch(() => 'indisponível');
    const snapshot = PISMarketStore.diagnosticSnapshot().catch(error => ({ erro: error.message }));
    const pipeline = PISMarketStore.diagnostics(settings).catch(() => ({ erro: 'falha na leitura da fila' }));
    const trace = Promise.resolve().then(() => chrome.storage.session.get(PISHistoryTrace.KEY))
      .then(value => value[PISHistoryTrace.KEY] ?? []).catch(() => 'indisponível');
    const sourceCheck = chrome.storage.local.get(['pisPublicGemsCheck', 'pisMarketEvents', 'pisSalesBackupStatus']).catch(() => ({}));
    const monitor = chrome.storage.session.get(['pisMarketMonitor', 'pisMarketAutomaticPage', 'pisMarketPage:gold', 'pisMarketPage:orb', 'pisMarketPrepared:gold', 'pisMarketPrepared:orb', 'pisMarketQuery:gold', 'pisMarketQuery:orb', 'pisMarketQuery:history', 'pisCoinsHistory:global', 'pisCoinsHistory:espécie', 'pisCoinsHistory:backfill']).catch(() => ({}));
    const [notificationPermission, database, alerts, history, automatic, publicSource] =
      await Promise.all([permission, snapshot, pipeline, trace, monitor, sourceCheck]);
    const tests = PISMarketSmoke.run();
    const report = {
      versão: chrome.runtime.getManifest().version,
      testes: tests,
      log_do_mercado: publicSource.pisMarketEvents ?? [],
      banco: database,
      backup_sheets: publicSource.pisSalesBackupStatus ?? null,
      histórico_na_sessão: history,
      atualização_coins: { recentes: automatic['pisCoinsHistory:global'], espécie: automatic['pisCoinsHistory:espécie'],
        histórico_anterior: automatic['pisCoinsHistory:backfill'] },
      fonte_pública_de_gemas: publicSource.pisPublicGemsCheck ?? null,
      varredura_automática: { estado: automatic.pisMarketMonitor ?? null, última_página: automatic.pisMarketAutomaticPage ?? null,
        coins: automatic['pisMarketPage:gold'] ?? null, gemas: automatic['pisMarketPage:orb'] ?? null,
        últimas_consultas: { coins: automatic['pisMarketQuery:gold'] ?? null, gemas: automatic['pisMarketQuery:orb'] ?? null,
          histórico: automatic['pisMarketQuery:history'] ?? null } },
      alertas: {
        ...alerts,
        notificações_ativadas: settings.notify,
        filtros_coins: { bepi: true },
        permissão_do_Chrome: notificationPermission,

      },
    };
    reportBox.value = JSON.stringify(report, null, 2);
    reportBox.hidden = false;
    copyDiagnostics.disabled = downloadDiagnostics.disabled = false;
    const passed = tests.filter(test => test.resultado === 'ok').length;
    testStatus.textContent = `${passed}/${tests.length} testes locais passaram. Copie o resultado para compartilhar.`;
  } catch {
    testStatus.textContent = 'O diagnóstico não pôde ser concluído. Reabra o painel e tente novamente.';
  } finally { compareGemAttackIv.disabled = runDiagnostics.disabled = runBacktest.disabled = false; }
});

document.querySelector('#test-purchase-review').addEventListener('click', async () => {
  try {
    const result = await chrome.runtime.sendMessage({ type: 'PIS_TEST_PURCHASE_REVIEW' });
    testStatus.textContent = result?.ok ? 'Simulação aberta no PokéIdle.' : 'A aba do jogo não confirmou a revisão. Recarregue o PokéIdle e tente novamente.';
  } catch { testStatus.textContent = 'Revisão de teste indisponível.'; }
});

const runBacktest = document.querySelector('#run-backtest');
runBacktest.addEventListener('click', async () => {
  compareGemAttackIv.disabled = runBacktest.disabled = runDiagnostics.disabled = true;
  copyDiagnostics.disabled = downloadDiagnostics.disabled = true;
  testStatus.textContent = 'Separando treino e teste por data no banco local…';
  try {
    const result = await PISMarketStore.backtest(config ?? PISOpportunities.settings());
    reportBox.value = JSON.stringify(result, null, 2);
    reportBox.hidden = false;
    copyDiagnostics.disabled = downloadDiagnostics.disabled = false;
    testStatus.textContent = 'Teste de precisão concluído.';
  } catch { testStatus.textContent = 'Falha ao avaliar o histórico local.'; }
  finally { compareGemAttackIv.disabled = runBacktest.disabled = runDiagnostics.disabled = false; }
});

compareGemAttackIv.addEventListener('click', async () => {
  const name = document.querySelector('#gem-comparison-name').value;
  compareGemAttackIv.disabled = runBacktest.disabled = runDiagnostics.disabled = true;
  copyDiagnostics.disabled = downloadDiagnostics.disabled = true;
  testStatus.textContent = 'Comparando as três cotações em Gemas…';
  try {
    const result = await PISMarketStore.compareGemAttackIv(name);
    reportBox.value = JSON.stringify(result, null, 2);
    reportBox.hidden = false;
    copyDiagnostics.disabled = downloadDiagnostics.disabled = false;
    testStatus.textContent = result.anúncios.length ? `${result.anúncios.length} fichas comparadas em Gemas.` :
      result.estado === 'base pública indisponível' ? 'Base pública de Gemas indisponível.' :
        'Sem fichas comparáveis. Abra a vitrine de Gemas no PokéIdle e tente novamente.';
  } catch { testStatus.textContent = 'Falha ao comparar as cotações em Gemas.'; }
  finally { compareGemAttackIv.disabled = runBacktest.disabled = runDiagnostics.disabled = false; }
});

downloadDiagnostics.addEventListener('click', () => {
  if (!reportBox.value) return;
  const url = URL.createObjectURL(new Blob([reportBox.value], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'pokesniper-diagnostico-' + chrome.runtime.getManifest().version + '.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

copyDiagnostics.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(reportBox.value);
    testStatus.textContent = 'Resultado copiado.';
  } catch {
    reportBox.focus();
    reportBox.select();
    testStatus.textContent = 'Resultado selecionado. Use Ctrl+C para copiar.';
  }
});

function showNoticeStatus() {
  for (const toggle of noticeToggles) {
    toggle.setAttribute('aria-checked', String(config.notify));
    toggle.title = config.notify ? 'Desligar avisos' : 'Ligar avisos';
  }
  noticeStatus.parentElement.dataset.enabled = String(config.notify);
  noticeStatus.textContent = config.notify ? 'Avisos ligados' : 'Avisos desligados';
}

async function saveOpportunitySettings(next, status, success) {
  setSettingsDisabled(true);
  try {
    await chrome.storage.local.set({ opportunitySettings: next });
    config = next;
    showNoticeStatus();
    if (success) status.textContent = success;
    await refresh();
  } catch {
    status.textContent = 'Falha ao salvar. Tente novamente.';
  } finally {
    setSettingsDisabled(false);
  }
}

function setSettingsDisabled(disabled) {
  saveFilters.disabled = disabled;
  for (const toggle of noticeToggles) toggle.disabled = disabled;
}

for (const toggle of noticeToggles) {
  toggle.addEventListener('click', () => {
    if (!config || toggle.disabled) return;
    return saveOpportunitySettings({ ...config, notify: !config.notify }, noticeStatus);
  });
}

form.addEventListener('submit', event => {
  event.preventDefault();
  if (!config || saveFilters.disabled) return;
  const next = PISOpportunities.settings({
    ...Object.fromEntries(new FormData(form)),
    notify: config.notify,
  });
  return saveOpportunitySettings(next, saveStatus, 'Filtros salvos.');
});

function stopOfferRefresh() {
  ++generation;
  clearTimeout(expiryTimer);
}

function selectTab(tab) {
  for (const option of tabs) {
    const selected = option === tab;
    option.setAttribute('aria-selected', String(selected));
    option.tabIndex = selected ? 0 : -1;
    document.getElementById(option.getAttribute('aria-controls')).hidden = !selected;
  }
  main.scrollTop = 0;
  stopOfferRefresh();
  void refresh();
}

for (const tab of tabs) {
  tab.addEventListener('click', () => selectTab(tab));
  tab.addEventListener('keydown', event => {
    const i = tabs.indexOf(tab);
    const next = { ArrowLeft: (i + tabs.length - 1) % tabs.length,
      ArrowRight: (i + 1) % tabs.length, Home: 0, End: tabs.length - 1 }[event.key];
    if (!Number.isInteger(next)) return;
    event.preventDefault();
    tabs[next].focus();
    selectTab(tabs[next]);
  });
}

function closePanel() {
  if (inOverlay) window.parent.postMessage({ type: 'PIS_V2_CLOSE_PANEL' }, '*');
  else window.close();
}

document.querySelector('#close-panel').addEventListener('click', closePanel);
document.addEventListener('keydown', event => { if (event.key === 'Escape') closePanel(); });
const diagnosticsPanel = document.querySelector('#diagnostics-panel');
diagnosticsPanel.addEventListener('toggle', () => { if (diagnosticsPanel.open) void refreshDiagnosticStats(); });

if (inOverlay) {
  document.body.dataset.overlay = '';
  function reportPanelSize() {
    if (!panelVisible) return;
    const section = main.querySelector('section:not([hidden])');
    const { paddingTop, paddingBottom } = getComputedStyle(main);
    const height = header.offsetHeight + navigation.offsetHeight + (section?.offsetHeight ?? 0) +
      parseFloat(paddingTop) + parseFloat(paddingBottom);
    window.parent.postMessage({ type: 'PIS_V2_PANEL_SIZE', height }, '*');
  }
  const layout = new ResizeObserver(reportPanelSize);
  [header, navigation, ...main.children].forEach(node => layout.observe(node));
  window.addEventListener('message', event => {
    if (event.source !== window.parent || !/^https:\/\/(?:[a-z0-9-]+\.)?pokeidle\.io$/i.test(event.origin) ||
        event.data?.type !== 'PIS_V2_PANEL_VISIBILITY') return;
    panelVisible = event.data.open === true;
    if (panelVisible) {
      reportPanelSize();
      tabs.find(tab => tab.getAttribute('aria-selected') === 'true')?.focus({ preventScroll: true });
      void refresh();
    } else stopOfferRefresh();
  });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.opportunitySettings || !config) return;
  const next = PISOpportunities.settings(changes.opportunitySettings.newValue);
  if (next.currency !== config.currency) form.elements.currency.value = next.currency;
  if (next.discount !== config.discount) form.elements.discount.value = next.discount;
  config = next;
  showNoticeStatus();
});

(async () => {
  const { opportunitySettings } = await chrome.storage.local.get('opportunitySettings');
  config = PISOpportunities.settings(opportunitySettings);
  void runSalesBackup(true);
  form.elements.currency.value = config.currency;
  form.elements.discount.value = config.discount;
  showNoticeStatus();
  setSettingsDisabled(false);
  void refresh();
  setInterval(refresh, 5000);
})().catch(error => { noticeStatus.textContent = 'Não foi possível iniciar o painel. ' + error.message; });
