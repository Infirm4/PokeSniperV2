const PISOpportunityAlerts = (() => {
  const ALARM = 'pis-opportunity-alerts';
  let draining;
  let delivering = false;
  let refreshRequested = false;

  const icons = new Map();
  const maxBytes = 128 * 1024;

  async function loadIcon(sprite) {
    try {
      const response = await fetch(sprite, {
        credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(2000),
      });
      const mime = response.headers.get('content-type')?.split(';')[0].trim();
      if (!response.ok || !/^image\/(png|jpeg|webp|gif|avif)$/.test(mime || '') || !response.body) return null;
      const reader = response.body.getReader();
      let bytes = 0;
      let raw = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.length;
        if (bytes > maxBytes) { await reader.cancel(); return null; }
        for (let i = 0; i < value.length; i += 8192) raw += String.fromCharCode(...value.subarray(i, i + 8192));
      }
      return bytes ? `data:${mime};base64,${btoa(raw)}` : null;
    } catch { return null; }
  }

  async function createDesktopNotice(id, title, message, sprites) {
    const options = { type: 'basic', title, message, contextMessage: 'Oferta observada no PokéIdle' };
    for (const sprite of sprites) {
      let icon = icons.get(sprite);
      if (!icon) {
        icon = await loadIcon(sprite);
        if (icon) {
          if (icons.size >= 32) icons.delete(icons.keys().next().value);
          icons.set(sprite, icon);
        }
      }
      if (!icon) continue;
      try { await chrome.notifications.create(id, { ...options, iconUrl: icon }); return; }
      catch { /* tenta a segunda sprite ou o ícone local */ }
    }
    await chrome.notifications.create(id, { ...options, iconUrl: chrome.runtime.getURL('opportunity-placeholder.png') });
  }

  async function sendPending() {
    const { opportunitySettings } = await chrome.storage.local.get('opportunitySettings');
    const config = PISOpportunities.settings(opportunitySettings);
    if (!config.notify) return;

    const recent = await PISMarketStore.recentOpportunities(config);
    const pending = recent.filter(row => row.delivery === 'pending' && row.nextAttemptAt <= Date.now() &&
      PISOpportunities.notificationEligible(row, config));
    delivering = true;
    for (const candidate of pending.slice(0, 5)) {
      const { opportunitySettings } = await chrome.storage.local.get('opportunitySettings');
      const current = PISOpportunities.settings(opportunitySettings);
      if (!current.notify) break;
      const row = await PISMarketStore.currentOpportunity(candidate.key, candidate.id, current);
      if (!row) continue;
      // ID determinístico mantém apenas uma notificação para a mesma revisão após uma retomada.
      const { title, message, desktopMessage } = PISOpportunities.noticePresentation(row);
      const sprites = PISOpportunities.spriteCandidates(row);
      const inGame = PISGameTab.show(title, message, false, sprites[0], PISMarketCore.purchaseOffer(row), sprites[1]).catch(() => false);
      let desktop = false;
      try {
        await createDesktopNotice('pis:' + row.key, title, desktopMessage, sprites);
        desktop = true;
      } catch {
        console.warn('[PIS] Aviso visual do Chrome indisponível.');
      }
      const game = await inGame;
      await PISMarketStore.markDelivery(row.key, desktop || game, Date.now(), { desktop, game }, row);
      globalThis.PISMarketEventLog?.record(chrome.storage.local, row.currency, desktop || game ? 'aviso_enviado' : 'aviso_falhou');
    }
  }

  function wake() {
    if (!draining) {
      draining = sendPending().catch(error => console.warn('[PIS] Fila de oportunidades:', error.message))
        .finally(() => {
          draining = null;
          delivering = false;
          if (refreshRequested) {
            refreshRequested = false;
            return wake();
          }
        });
    } else if (delivering) refreshRequested = true;
    return draining;
  }

  async function schedule() {
    if (!await chrome.alarms.get(ALARM)) await chrome.alarms.create(ALARM, { periodInMinutes: 1 });
  }

  chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === ALARM) wake(); });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.opportunitySettings) wake();
  });
  async function review(key) {
    let revision;
    try { revision = JSON.parse(key); } catch { return false; }
    if (!Array.isArray(revision) || revision.length !== 3 || revision[0] !== 'gold' ||
        typeof revision[1] !== 'string') return false;
    const { opportunitySettings } = await chrome.storage.local.get('opportunitySettings');
    const config = PISOpportunities.settings(opportunitySettings);
    const row = await PISMarketStore.currentOpportunity(key, revision[1], config, Date.now(), true);
    return row ? PISGameTab.review(row) : false;
  }

  chrome.notifications.onClicked.addListener(id => {
    if (!id.startsWith('pis:')) return;
    review(id.slice(4)).then(ok => ok || chrome.tabs.create({ url: 'https://pokeidle.io/' }))
      .catch(error => console.warn('[PIS] Não foi possível abrir o jogo:', error.message));
  });
  schedule().catch(error => console.warn('[PIS] Agendamento de alertas:', error.message));
  return { wake, review };
})();
