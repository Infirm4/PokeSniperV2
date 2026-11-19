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
    diagnostics.textContent = `${stats.listings} anúncios recentes · ${stats.sales} vendas no banco · ${stats.detailed} avaliados pelo perfil · ${stats.noEstimate} sem avaliação · ${stats.price} acima da faixa · ${stats.filters} barrados pelos filtros · ${stats.matched} oportunidades. Notificações ${config.notify ? 'ligadas' : 'desligadas'} · ${stats.pending} pendentes · ${stats.held} retidas · ${stats.sent} enviadas · ${stats.failed} com falha.`;
  } catch (error) {
    if (request === generation) panelStatus.textContent = 'Não foi possível ler as oportunidades. ' + error.message;
  }
}

lookup.addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const row = await PISMarketStore.listing(lookup.elements.listingId.value.trim());
    analysis.replaceChildren(row ? card(row, true) : text('li', 'Esse ID ainda não foi observado no mercado.'));
  } catch (error) { analysis.replaceChildren(text('li', 'Falha na consulta. ' + error.message)); }
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

document.querySelector('#test-notification').addEventListener('click', async () => {
  try {
    await chrome.notifications.create('pis:test', {
      type: 'basic', iconUrl: chrome.runtime.getURL('opportunity-icon.png'),
      title: 'PokeSniper · Teste de notificação',
      message: 'As notificações do Sniper estão funcionando neste navegador.',
    });
    saveStatus.textContent = 'Teste enviado ao Chrome.';
  } catch (error) { saveStatus.textContent = 'Falha no teste. ' + error.message; }
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
