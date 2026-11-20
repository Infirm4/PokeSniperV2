const form = document.querySelector('#settings');
const offers = document.querySelector('#offers');
const panelStatus = document.querySelector('#status');
const saveStatus = document.querySelector('#save-status');
const saveFilters = document.querySelector('#save-filters');
const toggleNotices = document.querySelector('#toggle-notices');
const noticeStatus = document.querySelector('#notice-status');
const format = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });
let config;
let generation = 0;
let rendered = '';
const lookup = document.querySelector('#lookup');
const analysis = document.querySelector('#analysis-result');
const diagnostics = document.querySelector('#diagnostics');
const lookupStatus = document.querySelector('#lookup-status');
const lookupMatches = document.querySelector('#lookup-matches');
const lookupPanel = document.querySelector('#lookup-panel');
let lookupRequest = 0;

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
  details.append(text('p', `P${row.power ?? '?'} · Qualidade ${row.quality ?? '?'} · IV total ${row.ivTotal ?? '?'} · Velocidade ${ivs.speed ?? '?'}`, 'offer-meta'));
  details.append(text('p', `IVs HP ${ivs.hp ?? '?'} · Atq ${ivs.attack ?? '?'} · Def ${ivs.defense ?? '?'} · Atq Esp ${ivs.specialAttack ?? '?'} · Def Esp ${ivs.specialDefense ?? '?'}`, 'offer-meta'));
  const estimate = row.estimate;
  for (const sale of estimate?.comparables || []) {
    details.append(text('div', `${format.format(sale.price)} ${unit} · Nv. ${sale.level} · Nota ${format.format(sale.grade)} · P${sale.power ?? '?'} · Vel. ${sale.speed ?? '?'} · ${new Date(sale.soldAt).toLocaleDateString('pt-BR')}`, 'offer-meta'));
  }

  const simulator = document.createElement('form');
  const fields = document.createElement('div');
  fields.className = 'fields';
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
  const output = text('div', '', 'offer-meta');
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
  title.className = 'offer-title';
  const unit = row.currency === 'gold' ? 'Coins' : 'Gemas';
  title.append(text('strong', (row.name || 'Pokémon #' + row.speciesId) + (row.shiny ? ' · Shiny' : '')),
    text('strong', format.format(row.price) + ' ' + unit));
  const estimate = row.estimate;
  const minutes = Math.max(0, Math.floor((Date.now() - row.observedAt) / 60000));
  item.append(title, text('div', `Anúncio #${row.id} · Nv. ${row.level ?? '?'} · Nota ${row.grade ?? '?'} · observado há ${minutes} min`, 'offer-meta'));
  if (estimate?.status === 'estimated') {
    const method = estimate.method === 'briaoale_public' ? 'histórico público · Briaoale' :
      estimate.method === 'coins_comparables' ? 'comparáveis em Coins' : estimate.method === 'briaoale_pve' ? 'motor de PvE · histórico local' : 'referência básica';
    const limit = PISOpportunities.priceLimit(row, config);
    const sample = ['briaoale_pve', 'briaoale_public'].includes(estimate.method)
      ? `${estimate.profileSales} vendas próximas da espécie · ${estimate.marketCount} na base do modelo`
      : `${estimate.count} vendas · n efetivo ${format.format(estimate.effectiveCount)}`;

    item.append(text('div', `Desconto ${percent(estimate.discount)} · mediana ${format.format(estimate.median)} · ${method}`, 'offer-meta'),
      text('div', `Faixa ${format.format(estimate.lower)}–${format.format(estimate.upper)} · ${sample}`, 'offer-meta'),
      text('div', limit == null ? 'Informe a taxa e selecione uma moeda para calcular o teto de revenda.' :
        `Teto de preço para alerta ${format.format(limit)} ${unit}`, 'offer-meta'));
    if (estimate.confidence) item.append(text('div', 'Confiança: ' + estimate.confidence, 'offer-meta'));
    if (estimate.alertSupported === false) item.append(text('div', 'Referência com poucos comparáveis próximos. Alerta suspenso.', 'offer-meta'));
    if (estimate.sourceAt) {
      item.append(text('div', 'Base de Gemas atualizada em ' + new Date(estimate.sourceAt).toLocaleString('pt-BR'), 'offer-meta'));
    }
    if (estimate.profileReason) item.append(text('div', profileStatus[estimate.profileReason], 'offer-meta'));
  } else item.append(text('div', estimate?.status === 'excluded_outland'
    ? 'Outlaw excluído da precificação e dos alertas.'
    : 'Preço estimado indisponível para esta ficha e amostra.', 'offer-meta'));
  if (showLiquidity && row.level > 0 && estimate?.status !== 'excluded_outland') {
    const summary = text('div', 'Consultando liquidez em 7 dias…', 'offer-meta');
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
  summary.className = 'offer-title';
  const offer = PISOpportunities.presentation(row);
  const block = document.createElement('span');
  block.className = 'opportunity-copy';
  block.append(text('strong', (row.name || 'Pokémon #' + row.speciesId) + (row.shiny ? ' · Shiny' : '')),
    text('span', `${offer.discount} · ${offer.asking}`, 'opportunity-price'));
  if (offer.range) block.append(text('span', offer.range, 'offer-meta'));
  if (offer.warning) block.append(text('span', offer.warning, 'offer-meta'));
  const sprite = document.createElement('img');
  sprite.alt = '';
  sprite.className = 'opportunity-sprite';
  if (PISOpportunities.mountSprite(sprite, PISOpportunities.spriteCandidates(row))) summary.append(sprite);
  summary.append(block);
  details.append(summary);
  details.addEventListener('toggle', () => {
    if (details.open && details.childElementCount === 1) {
      const panel = card(row, true);
      const body = document.createElement('div');
      body.append(...panel.childNodes);
      if (PISMarketCore.purchaseOffer(row) && PISOpportunities.notificationEligible(row)) {
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
  const request = ++generation;
  try {
    const [rows, stats] = await Promise.all([
      PISMarketStore.recentOpportunities(config), PISMarketStore.diagnostics(config),
    ]);
    if (request !== generation) return;
    const visible = rows.filter(row => PISOpportunities.approved(row, config)).slice(0, 100);
    const signature = JSON.stringify([config, visible]);
    // Uma oferta que deixou de atender aos filtros sai mesmo se o cartão estiver aberto.
    if (signature !== rendered) {
      const expanded = new Set([...offers.querySelectorAll('details[data-offer-key][open]')].map(card => card.dataset.offerKey));
      offers.replaceChildren(...visible.map(row => {
        const card = opportunityCard(row);
        if (expanded.has(row.key)) card.querySelector('details').open = true;
        return card;
      }));
      rendered = signature;
    }
    const { pisMarketMonitor } = await chrome.storage.session.get('pisMarketMonitor');
    if (request !== generation) return;
    panelStatus.textContent = visible.length
      ? `${visible.length} oportunidades dos últimos 10 min. Confira a oferta no jogo.`
      : !stats.listings ? (pisMarketMonitor?.state === 'varrendo'
        ? 'Aguardando as primeiras páginas do mercado.'
        : pisMarketMonitor?.state === 'aguardando_socket' ? 'Aguardando a conexão do PokéIdle.'
          : pisMarketMonitor?.state === 'aguardando_tráfego' ? 'Conexão aberta. Aguardando dados do jogo.'
          : 'Sem páginas recentes. Deixe os avisos ligados e o PokéIdle aberto e conectado.')
        : 'Nenhuma oportunidade recente atende aos filtros.';
    diagnostics.textContent = `${stats.listings} anúncios recentes · ${stats.sales} vendas no banco · ${stats.detailed} avaliados pelo perfil · ${stats.noEstimate} sem avaliação · ${stats.price} acima do preço de referência · ${stats.filters} barrados pelos filtros · ${stats.matched} oportunidades. Notificações ${config.notify ? 'ligadas' : 'desligadas'} · ${stats.pending} pendentes · ${stats.held} retidas · ${stats.sent} enviadas (${stats.sentInGame} no jogo · ${stats.sentDesktop} aceitas pelo Chrome) · ${stats.failed} com falha.`;
  } catch (error) {
    if (request === generation) panelStatus.textContent = 'Não foi possível ler as oportunidades. ' + error.message;
  }
}

async function searchListings(query) {
  const request = ++lookupRequest;
  lookupStatus.textContent = 'Consultando anúncios observados…';
  lookupMatches.replaceChildren();
  analysis.replaceChildren();
  try {
    const rows = await PISMarketStore.findListings(query);
    if (request !== lookupRequest) return;
    if (!rows.length) {
      lookupStatus.textContent = 'Nenhum anúncio encontrado. Abra a vitrine no jogo e busque o Pokémon lá para o Sniper observar o anúncio.';
      return;
    }
    const items = rows.map(row => {
      const item = document.createElement('li');
      const name = row.name || 'Pokémon #' + row.speciesId;
      const unit = row.currency === 'gold' ? 'Coins' : 'Gemas';
      const button = text('button', `${name}${row.shiny ? ' · Shiny' : ''} · Nv. ${row.level ?? '?'} · ${format.format(row.price)} ${unit}`);
      button.type = 'button';
      button.addEventListener('click', async () => {
        const selection = ++lookupRequest;
        analysis.replaceChildren(text('li', 'Atualizando a estimativa…'));
        try {
          const updated = await PISMarketStore.analyzeListing(row);
          if (selection === lookupRequest) {
            analysis.replaceChildren(card(updated, true));
            const name = updated.currency === 'gold' && !PISMarketCore.isOutland(updated) &&
              PISCoinsHistory.cleanSpecies(updated.name);
            if (name) chrome.runtime.sendMessage({ type: 'PIS_LOOKUP_COINS', name }).catch(() => {});
          }
        } catch {
          if (selection === lookupRequest) analysis.replaceChildren(text('li', 'Não foi possível atualizar a estimativa.'));
        }
      });
      item.append(button);
      return item;
    });
    lookupMatches.replaceChildren(...items);
    lookupStatus.textContent = `${rows.length} resultado${rows.length === 1 ? '' : 's'} · selecione um anúncio para analisar.`;
  } catch (error) {
    if (request === lookupRequest) lookupStatus.textContent = 'Falha na consulta. ' + error.message;
  }
}

lookup.addEventListener('submit', event => {
  event.preventDefault();
  searchListings(lookup.elements.pokemon.value.trim());
});
document.querySelector('#recent-listings').addEventListener('click', () => {
  lookup.elements.pokemon.value = '';
  searchListings('');
});
lookupPanel.addEventListener('toggle', () => {
  if (lookupPanel.open && lookupRequest === 0) searchListings('');
});

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

const runDiagnostics = document.querySelector('#run-diagnostics');
const copyDiagnostics = document.querySelector('#copy-diagnostics');
const downloadDiagnostics = document.querySelector('#download-diagnostics');
const reportBox = document.querySelector('#diagnostic-report');
const testStatus = document.querySelector('#test-status');


runDiagnostics.addEventListener('click', async () => {
  runDiagnostics.disabled = runBacktest.disabled = true;
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
    const sourceCheck = chrome.storage.local.get(['pisPublicGemsCheck', 'pisMarketEvents']).catch(() => ({}));
    const monitor = chrome.storage.session.get(['pisMarketMonitor', 'pisMarketAutomaticPage', 'pisMarketPage:gold', 'pisMarketPage:orb', 'pisMarketQuery:gold', 'pisMarketQuery:orb', 'pisMarketQuery:history', 'pisCoinsHistory:global', 'pisCoinsHistory:espécie', 'pisCoinsHistory:backfill']).catch(() => ({}));
    const [notificationPermission, database, alerts, history, automatic, publicSource] =
      await Promise.all([permission, snapshot, pipeline, trace, monitor, sourceCheck]);
    const tests = PISMarketSmoke.run();
    const report = {
      versão: chrome.runtime.getManifest().version,
      testes: tests,
      log_do_mercado: publicSource.pisMarketEvents ?? [],
      banco: database,
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
  } finally { runDiagnostics.disabled = runBacktest.disabled = false; }
});

document.querySelector('#test-purchase-review').addEventListener('click', async () => {
  try {
    const result = await chrome.runtime.sendMessage({ type: 'PIS_TEST_PURCHASE_REVIEW' });
    testStatus.textContent = result?.ok ? 'Simulação aberta no PokéIdle.' : 'A aba do jogo não confirmou a revisão. Recarregue o PokéIdle e tente novamente.';
  } catch { testStatus.textContent = 'Revisão de teste indisponível.'; }
});

const runBacktest = document.querySelector('#run-backtest');
runBacktest.addEventListener('click', async () => {
  runBacktest.disabled = runDiagnostics.disabled = true;
  copyDiagnostics.disabled = downloadDiagnostics.disabled = true;
  testStatus.textContent = 'Separando treino e teste por data no banco local…';
  try {
    const result = await PISMarketStore.backtest(config ?? PISOpportunities.settings());
    reportBox.value = JSON.stringify(result, null, 2);
    reportBox.hidden = false;
    copyDiagnostics.disabled = downloadDiagnostics.disabled = false;
    testStatus.textContent = 'Teste de precisão concluído.';
  } catch { testStatus.textContent = 'Falha ao avaliar o histórico local.'; }
  finally { runBacktest.disabled = runDiagnostics.disabled = false; }
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
  toggleNotices.textContent = config.notify ? 'Desligar avisos' : 'Ligar avisos';
  noticeStatus.textContent = config.notify ? 'Avisos ligados' : 'Avisos desligados';
}

async function saveOpportunitySettings(next, status, success) {
  toggleNotices.disabled = saveFilters.disabled = true;
  try {
    await chrome.storage.local.set({ opportunitySettings: next });
    config = next;
    showNoticeStatus();
    if (success) status.textContent = success;
    await refresh();
  } catch {
    status.textContent = 'Falha ao salvar. Tente novamente.';
  } finally {
    toggleNotices.disabled = saveFilters.disabled = false;
  }
}

toggleNotices.addEventListener('click', () => {
  if (!config || toggleNotices.disabled) return;
  return saveOpportunitySettings({ ...config, notify: !config.notify }, noticeStatus);
});

form.addEventListener('submit', event => {
  event.preventDefault();
  if (!config || saveFilters.disabled) return;
  const next = PISOpportunities.settings({
    ...Object.fromEntries(new FormData(form)),
    notify: config.notify,
    resale: form.elements.resale.checked,
  });
  return saveOpportunitySettings(next, saveStatus, 'Filtros salvos.');
});

document.querySelector('#open').addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://pokeidle.io/' })
    .catch(error => { panelStatus.textContent = 'Não foi possível abrir o jogo. ' + error.message; });
});

(async () => {
  const { opportunitySettings } = await chrome.storage.local.get('opportunitySettings');
  config = PISOpportunities.settings(opportunitySettings);
  for (const [name, value] of Object.entries(config)) {
    if (name === 'notify') continue;
    if (name === 'resale') form.elements[name].checked = value;
    else form.elements[name].value = value ?? '';
  }
  showNoticeStatus();
  toggleNotices.disabled = saveFilters.disabled = false;
  await refresh();
  setInterval(refresh, 5000);
})().catch(error => { panelStatus.textContent = 'Não foi possível iniciar o painel. ' + error.message; });
