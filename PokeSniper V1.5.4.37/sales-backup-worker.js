(() => {
  const ALARM = 'pis-sales-backup-hourly';
  const STATUS = 'pisSalesBackupStatus';
  let active;

  async function sendBatch(batch) {
    const lote = crypto.randomUUID();
    const vendas = PISSalesBackup.normalize(batch.map(entry => entry.row), PISMarketCore).map(row => {
      if (row.sprite) return row;
      const [sprite] = globalThis.PISOpportunities?.spriteCandidates(row) ?? [];
      return sprite ? { ...row, sprite, spriteSource: 'dex' } : row;
    });
    const response = await fetch(SHEETS_URL, {
      method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ tipo: PISSalesBackup.FORMAT, lote, vendas }),
      redirect: 'follow', credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(25000),
    });
    if (!response.ok) throw new Error('Apps Script respondeu HTTP ' + response.status);
    const receipt = await response.json().catch(() => null);
    if (receipt?.ok !== true || receipt.tipo !== PISSalesBackup.FORMAT || receipt.lote !== lote ||
        receipt.vendas_confirmadas !== batch.length) {
      throw new Error('Apps Script não confirmou o lote. Confira a implantação do receptor.');
    }
    await PISMarketStore.acknowledgeSalesBackup(batch);
  }

  function sync() {
    active ??= (async () => {
      const started = Date.now();
      let saved = 0, error = null;
      try {
        for (let i = 0; i < 10 && Date.now() - started < 90000; i++) {
          const batch = await PISMarketStore.pendingSalesBackup(100);
          if (!batch.length) break;
          await sendBatch(batch);
          saved += batch.length;
        }
      } catch (failure) {
        error = String(failure.message).slice(0, 240);
      }
      const pending = await PISMarketStore.pendingSalesBackupCount().catch(() => null);
      const status = { at: Date.now(), saved, pending, error };
      await chrome.storage.local.set({ [STATUS]: status });
      return status;
    })().finally(() => { active = null; });
    return active;
  }

  function ensureAlarm() {
    (async () => {
      const alarm = await chrome.alarms.get(ALARM);
      if (alarm?.periodInMinutes !== 60) await chrome.alarms.create(ALARM, { periodInMinutes: 60 });
    })().catch(error => console.warn('[PIS] Agenda de backup:', error.message));
  }

  chrome.runtime.onInstalled.addListener(ensureAlarm);
  chrome.runtime.onStartup.addListener(ensureAlarm);
  chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === ALARM) sync().catch(console.warn); });
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (message?.type !== 'PIS_SYNC_SALES_BACKUP' ||
        sender.url !== chrome.runtime.getURL('opportunities.html')) return false;
    sync().then(reply, () => reply({ error: 'Falha ao ler o banco local.' }));
    return true;
  });
  ensureAlarm();
})();
