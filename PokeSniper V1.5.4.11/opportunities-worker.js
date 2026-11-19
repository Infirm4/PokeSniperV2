const PISOpportunityAlerts = (() => {
  const ALARM = 'pis-opportunity-alerts';
  let draining;

  async function sendPending() {
    const { opportunitySettings } = await chrome.storage.local.get('opportunitySettings');
    const config = PISOpportunities.settings(opportunitySettings);
    if (!config.notify) return;

    const recent = await PISMarketStore.recentOpportunities(config);
    const pending = recent.filter(row => row.delivery === 'pending' && row.nextAttemptAt <= Date.now());
    for (const row of pending.slice(0, 5)) {
      // ID determinístico mantém apenas uma notificação para a mesma revisão após uma retomada.
      let delivered = false;
      try {
        await chrome.notifications.create('pis:' + row.key, {
          type: 'basic', iconUrl: chrome.runtime.getURL('opportunity-icon.png'),
          title: row.name || 'Pokémon #' + row.speciesId,
          message: `${row.price.toLocaleString('pt-BR')} ${row.currency === 'gold' ? 'Coins' : 'Gemas'} · ${Math.round(row.estimate.discount * 100)}% abaixo da referência`,
          contextMessage: 'Oferta observada no PokéIdle · clique para abrir o jogo',
        });
        delivered = true;
      } catch (error) {
        console.warn('[PIS] Falha na notificação:', error.message);
      }
      await PISMarketStore.markDelivery(row.key, delivered);
    }
  }

  function wake() {
    if (!draining) {
      draining = sendPending().catch(error => console.warn('[PIS] Fila de oportunidades:', error.message))
        .finally(() => { draining = null; });
    }
    return draining;
  }

  async function schedule() {
    if (!await chrome.alarms.get(ALARM)) await chrome.alarms.create(ALARM, { periodInMinutes: 1 });
  }

  chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === ALARM) wake(); });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.opportunitySettings) wake();
  });
  chrome.notifications.onClicked.addListener(id => {
    if (id.startsWith('pis:')) chrome.tabs.create({ url: 'https://pokeidle.io/' })
      .catch(error => console.warn('[PIS] Não foi possível abrir o jogo:', error.message));
  });
  schedule().catch(error => console.warn('[PIS] Agendamento de alertas:', error.message));
  return { wake };
})();
