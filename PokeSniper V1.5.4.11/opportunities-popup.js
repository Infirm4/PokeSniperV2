const form = document.querySelector('#settings');
const offers = document.querySelector('#offers');
const panelStatus = document.querySelector('#status');
const saveStatus = document.querySelector('#save-status');
const format = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });
let config;
let generation = 0;

function text(tag, value, className) {
  const element = document.createElement(tag);
  element.textContent = value;
  if (className) element.className = className;
  return element;
}

function card(row) {
  const item = document.createElement('li');
  const title = document.createElement('div');
  title.className = 'offer-title';
  const unit = row.currency === 'gold' ? 'Coins' : 'Gemas';
  title.append(text('strong', (row.name || 'Pokémon #' + row.speciesId) + (row.shiny ? ' · Shiny' : '')),
    text('strong', format.format(row.price) + ' ' + unit));
  const estimate = row.estimate;
  const minutes = Math.max(0, Math.floor((Date.now() - row.observedAt) / 60000));
  item.append(title, text('div', `${format.format(estimate.discount * 100)}% abaixo da mediana de ${format.format(estimate.median)}`, 'offer-meta'),
    text('div', `Faixa ${format.format(estimate.lower)}–${format.format(estimate.upper)} · ${estimate.count} vendas · n efetivo ${format.format(estimate.effectiveCount)}`, 'offer-meta'),
    text('div', `Anúncio #${row.id} · Nv. ${row.level} · Nota ${format.format(row.grade)} · observado há ${minutes} min`, 'offer-meta'));
  return item;
}

async function refresh() {
  const request = ++generation;
  try {
    const rows = await PISMarketStore.recentOpportunities(config);
    if (request !== generation) return;
    const visible = rows.slice(0, 100);
    offers.replaceChildren(...visible.map(card));
    panelStatus.textContent = rows.length
      ? `${visible.length} de ${rows.length} oportunidades dos últimos 10 min. Confira a oferta no jogo.`
      : 'Nenhuma oportunidade recente atende aos filtros. A vitrine e a Tabela de preços alimentam o painel.';
  } catch (error) {
    if (request === generation) panelStatus.textContent = 'Não foi possível ler as oportunidades. ' + error.message;
  }
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  const next = PISOpportunities.settings({
    ...Object.fromEntries(new FormData(form)),
    notify: form.elements.notify.checked,
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
    if (name === 'notify') form.elements[name].checked = value;
    else form.elements[name].value = value;
  }
  await refresh();
  setInterval(refresh, 5000);
})().catch(error => { panelStatus.textContent = 'Não foi possível iniciar o painel. ' + error.message; });
