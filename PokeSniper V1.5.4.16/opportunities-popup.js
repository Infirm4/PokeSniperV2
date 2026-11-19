const form = document.querySelector('#settings');
const offers = document.querySelector('#offers');
const panelStatus = document.querySelector('#status');
const saveStatus = document.querySelector('#save-status');
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
  if (estimate?.baselineMedian != null) {
    const adjustment = estimate.median / estimate.baselineMedian - 1;
    const validation = estimate.validation;
    details.append(text('p', `Ajuste do perfil sobre a referência básica ${percent(adjustment)} · validação em ${validation.count} vendas posteriores`, 'offer-meta'));
    const drivers = [...(estimate.effects || [])].sort((a, b) => Math.abs(b.logEffect) - Math.abs(a.logEffect))
      .filter(effect => Math.abs(effect.logEffect) >= 0.01).slice(0, 3);
    if (drivers.length) details.append(text('p', 'Ajustes do modelo em relação ao perfil médio · ' +
      drivers.map(effect => effect.name + ' ' + percent(Math.expm1(effect.logEffect))).join(' · '), 'offer-meta'));
  }
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
    const method = estimate.method === 'profile_iv_distribution' ? 'perfil e distribuição dos IVs' :
      estimate.method === 'profile_iv_total' ? 'perfil e IV total' : 'referência básica';
    const limit = PISOpportunities.priceLimit(row, config);
    item.append(text('div', `Desconto ${percent(estimate.discount)} · mediana ${format.format(estimate.median)} · ${method}`, 'offer-meta'),
      text('div', `Faixa ${format.format(estimate.lower)}–${format.format(estimate.upper)} · ${estimate.count} vendas · n efetivo ${format.format(estimate.effectiveCount)}`, 'offer-meta'),
      text('div', limit == null ? 'Informe a taxa e selecione uma moeda para calcular o teto de revenda.' :
        `Teto de preço para alerta ${format.format(limit)} ${unit}`, 'offer-meta'));
    if (estimate.profileReason) item.append(text('div', profileStatus[estimate.profileReason], 'offer-meta'));
  } else item.append(text('div', 'Preço estimado indisponível para esta ficha e amostra.', 'offer-meta'));
  if (showLiquidity && row.level > 0) {
    const summary = text('div', 'Consultando liquidez em 7 dias…', 'offer-meta');
    item.append(summary);
    const price = Math.round(estimate?.median ?? row.price);
    PISMarketStore.liquidity(row, row.level, price)
      .then(report => { summary.textContent = `Liquidez a ${format.format(price)} ${unit} · ${liquidityText(report, 7)}`; })
      .catch(() => { summary.textContent = 'Liquidez indisponível nesta consulta.'; });
  }
  item.append(detailsFor(row, unit));
  return item;
}

async function refresh() {
  const request = ++generation;
  try {
    const [rows, stats] = await Promise.all([
      PISMarketStore.recentOpportunities(config), PISMarketStore.diagnostics(config),
    ]);
    if (request !== generation) return;
    const visible = rows.slice(0, 100);
    const signature = JSON.stringify([config, visible]);
    // Não derruba uma simulação aberta durante a atualização automática.
    if (signature !== rendered && !offers.querySelector('details[open]')) {
      offers.replaceChildren(...visible.map((row, index) => card(row, index < 8)));
      rendered = signature;
    }
    panelStatus.textContent = rows.length
      ? `${visible.length} de ${rows.length} oportunidades dos últimos 10 min. Confira a oferta no jogo.`
      : 'Nenhuma oportunidade recente atende aos filtros. A vitrine e a Tabela de preços alimentam o painel.';
    diagnostics.textContent = `${stats.listings} anúncios recentes · ${stats.sales} vendas no banco · ${stats.detailed} avaliados pelo perfil · ${stats.noEstimate} sem avaliação · ${stats.price} acima da faixa · ${stats.filters} barrados pelos filtros · ${stats.matched} oportunidades. Notificações ${config.notify ? 'ligadas' : 'desligadas'} · ${stats.pending} pendentes · ${stats.held} retidas · ${stats.sent} enviadas (${stats.sentInGame} no jogo · ${stats.sentDesktop} aceitas pelo Chrome) · ${stats.failed} com falha.`;
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
      button.addEventListener('click', () => analysis.replaceChildren(card(row, true)));
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

const runDiagnostics = document.querySelector('#run-diagnostics');
const copyDiagnostics = document.querySelector('#copy-diagnostics');
const reportBox = document.querySelector('#diagnostic-report');
const testStatus = document.querySelector('#test-status');


runDiagnostics.addEventListener('click', async () => {
  runDiagnostics.disabled = true;
  copyDiagnostics.disabled = true;
  testStatus.textContent = 'Testando os dois avisos e lendo o banco local…';
  try {
    const settings = config ?? PISOpportunities.settings();
    const permission = Promise.resolve().then(() => chrome.notifications.getPermissionLevel())
      .catch(() => 'indisponível');
    const snapshot = PISMarketStore.diagnosticSnapshot().catch(() => ({ erro: 'falha na leitura do IndexedDB' }));
    const pipeline = PISMarketStore.diagnostics(settings).catch(() => ({ erro: 'falha na leitura da fila' }));
    const trace = Promise.resolve().then(() => chrome.storage.session.get(PISHistoryTrace.KEY))
      .then(value => value[PISHistoryTrace.KEY] ?? []).catch(() => 'indisponível');
    // Espera os recibos desta execução; o worker os guarda mesmo se o painel fechar.
    const testResults = Promise.all(['PIS_TEST_DESKTOP_TOAST', 'PIS_TEST_GAME_TOAST'].map(async type => {
      try {
        const response = await chrome.runtime.sendMessage({ type });
        return { ok: response?.ok === true, at: Date.now(),
          result: response ? (response.storageError ? 'falha ao salvar o teste' : null) : 'sem resposta' };
      } catch { return { ok: false, at: Date.now(), result: 'sem resposta' }; }
    }));
    const [notificationPermission, database, alerts, history, [desktopTest, gameTest]] =
      await Promise.all([permission, snapshot, pipeline, trace, testResults]);
    const tests = PISMarketSmoke.run();
    const report = {
      versão: chrome.runtime.getManifest().version,
      testes: tests,
      banco: database,
      histórico_na_sessão: history,
      alertas: {
        ...alerts,
        notificações_ativadas: settings.notify,
        permissão_do_Chrome: notificationPermission,
        notificação_de_teste: desktopTest.result ?? (desktopTest.ok ? 'aceita pelo Chrome' : 'falhou'),
        notificação_de_teste_em: desktopTest.at,
        aviso_de_teste_no_jogo: gameTest.result ?? (gameTest.ok ? 'confirmado pela aba' : 'aba indisponível'),
        aviso_de_teste_no_jogo_em: gameTest.at,
      },
    };
    reportBox.value = JSON.stringify(report, null, 2);
    reportBox.hidden = false;
    copyDiagnostics.disabled = false;
    const passed = tests.filter(test => test.resultado === 'ok').length;
    testStatus.textContent = `${passed}/${tests.length} testes locais passaram. Copie o resultado para compartilhar.`;
  } catch {
    testStatus.textContent = 'O diagnóstico não pôde ser concluído. Reabra o painel e tente novamente.';
  } finally { runDiagnostics.disabled = false; }
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

form.addEventListener('submit', async event => {
  event.preventDefault();
  const next = PISOpportunities.settings({
    ...Object.fromEntries(new FormData(form)),
    notify: form.elements.notify.checked,
    resale: form.elements.resale.checked,
  });
  try {
    await chrome.storage.local.set({ opportunitySettings: next });
    config = next;
    saveStatus.textContent = 'Filtros salvos.';
    await refresh();
  } catch (error) { saveStatus.textContent = 'Falha ao salvar. ' + error.message; }
});

async function runNoticeTest(type, success, failure) {
  try {
    const response = await chrome.runtime.sendMessage({ type });
    saveStatus.textContent = response?.storageError ? 'Falha ao salvar o resultado do teste.' :
      response?.ok ? success : failure;
  } catch { saveStatus.textContent = 'Recarregue a extensão e tente novamente.'; }
}

document.querySelector('#test-notification').addEventListener('click', () => {
  runNoticeTest('PIS_TEST_DESKTOP_TOAST', 'Teste enviado ao Chrome.', 'O Chrome recusou o aviso de teste.');
});

document.querySelector('#test-game-toast').addEventListener('click', () => {
  runNoticeTest('PIS_TEST_GAME_TOAST', 'Aviso exibido dentro da aba do PokéIdle. Volte ao jogo para vê-lo.',
    'Abra ou recarregue o PokéIdle e deixe o mercado carregar antes de testar.');
});

document.querySelector('#open').addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://pokeidle.io/' })
    .catch(error => { panelStatus.textContent = 'Não foi possível abrir o jogo. ' + error.message; });
});

(async () => {
  const { opportunitySettings } = await chrome.storage.local.get('opportunitySettings');
  config = PISOpportunities.settings(opportunitySettings);
  for (const [name, value] of Object.entries(config)) {
    if (name === 'notify' || name === 'resale') form.elements[name].checked = value;
    else form.elements[name].value = value ?? '';
  }
  await refresh();
  setInterval(refresh, 5000);
})().catch(error => { panelStatus.textContent = 'Não foi possível iniciar o painel. ' + error.message; });
