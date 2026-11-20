(() => {
  const ALARM = 'pis-sales-backup-hourly';
  const INITIAL = 'pisSalesBackupInitialLayout';
  const INITIAL_ALARM = 'pis-sales-backup-catchup';
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
      const details = typeof receipt?.erro === 'string' ? ' ' + receipt.erro.slice(0, 150) : '';
      throw new Error('Apps Script não confirmou o lote. Confira a implantação do receptor.' + details);
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

  async function syncInitialLayout() {
    const saved = await chrome.storage.local.get([INITIAL, STATUS]);
    if (saved[INITIAL] === PISSalesBackup.FORMAT) return saved[STATUS] ?? { saved: 0, pending: 0 };
    const status = await sync();
    if (!status.error && status.pending != null) {
      if (status.pending === 0) await chrome.storage.local.set({ [INITIAL]: PISSalesBackup.FORMAT });
      else await chrome.alarms.create(INITIAL_ALARM, { delayInMinutes: 1 });
    }
    return status;
  }

  function ensureAlarm() {
    (async () => {
      const alarm = await chrome.alarms.get(ALARM);
      if (alarm?.periodInMinutes !== 60) await chrome.alarms.create(ALARM, { periodInMinutes: 60 });
    })().catch(error => console.warn('[PIS] Agenda de backup:', error.message));
  }

  chrome.runtime.onInstalled.addListener(ensureAlarm);
  chrome.runtime.onStartup.addListener(ensureAlarm);
  chrome.alarms.onAlarm.addListener(alarm => {
    if (alarm.name === ALARM || alarm.name === INITIAL_ALARM) syncInitialLayoutOrHourly(alarm.name).catch(console.warn);
  });

  async function syncInitialLayoutOrHourly(name) {
    const state = await chrome.storage.local.get(INITIAL);
    if (state[INITIAL] !== PISSalesBackup.FORMAT) return syncInitialLayout();
    if (name === ALARM) return sync();
  }
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (!['PIS_SYNC_SALES_BACKUP', 'PIS_START_SALES_BACKUP'].includes(message?.type) ||
        sender.url !== chrome.runtime.getURL('opportunities.html')) return false;
    const run = message.type === 'PIS_START_SALES_BACKUP' ? syncInitialLayout : sync;
    run().then(reply, () => reply({ error: 'Falha ao ler o banco local.' }));
    return true;
  });
  ensureAlarm();
})();
