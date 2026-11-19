(() => {
  const SOURCE = 'https://briaoale.github.io/precificador-pokemon/precos.json';
  const ALARM = 'pis-public-gems';
  const REFRESH_MS = 60 * 60000;
  const RETRY_MS = 5 * 60000;
  const LIMIT = 24 * 1024 * 1024;
  let updating;

  async function refresh() {
    const { pisPublicGemsCheck } = await chrome.storage.local.get('pisPublicGemsCheck');
    const interval = pisPublicGemsCheck?.ok ? REFRESH_MS : RETRY_MS;
    if (Date.now() - (pisPublicGemsCheck?.at ?? 0) < interval) return;
    const at = Date.now();
    try {
      const response = await fetch(SOURCE, { credentials: 'omit', redirect: 'error',
        cache: 'no-cache', signal: AbortSignal.timeout(25000) });
      if (!response.ok || Number(response.headers.get('content-length')) > LIMIT) throw new Error('download');
      const reader = response.body?.getReader();
      if (!reader) throw new Error('download');
      const decoder = new TextDecoder();
      let data = '', size = 0;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > LIMIT) { await reader.cancel(); throw new Error('download'); }
        data += decoder.decode(value, { stream: true });
      }
      const snapshot = JSON.parse(data + decoder.decode());
      const sourceAt = await PISMarketStore.savePublicGems(snapshot);
      await chrome.storage.local.set({ pisPublicGemsCheck: { at, ok: true, sourceAt, attempted: snapshot.geradoEm } });
      PISOpportunityAlerts.wake();
    } catch (error) {
      await chrome.storage.local.set({ pisPublicGemsCheck: { at, ok: false, sourceAt: pisPublicGemsCheck?.sourceAt, error: error.message } });
      // O último snapshot válido continua disponível até vencer sua janela de frescor.
    }
  }

  function wake() {
    if (!updating) {
      updating = refresh().catch(() => {}).finally(() => { updating = null; });
    }
  }

  chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === ALARM) wake(); });
  (async () => {
    const alarm = await chrome.alarms.get(ALARM);
    if (alarm?.periodInMinutes !== 5) await chrome.alarms.create(ALARM, { periodInMinutes: 5 });
    wake();
  })().catch(() => {});
})();
