(() => {
  const ALARM = 'pis-sales-backup-hourly';
  const INITIAL = 'pisSalesBackupInitialCompleteSales';
  const CATCHUP_ALARM = 'pis-sales-backup-catchup';
  const STATUS = 'pisSalesBackupStatus';
  const READ = 'pisSalesSheetAccess';
  const CURSOR = 'pisSalesSheetCursor';
  const PULL = 'pis_sales_pull_v1';
  const START_ROW = 4;
  const RESCAN_MS = 24 * 3600000;
  let active;

  async function post(data) {
    const response = await fetch(SHEETS_URL, {
      method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(data),
      redirect: 'follow', credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(25000),
    });
    if (!response.ok) throw new Error('Apps Script respondeu HTTP ' + response.status);
    return response.json().catch(() => null);
  }

  async function pullSales() {
    const data = await chrome.storage.local.get([READ, CURSOR]);
    const access = data[READ];
    if (!access?.key) return { enabled: false };
    const saved = data[CURSOR];
    const cursor = saved?.id === access.id ? { ...saved } :
      { id: access.id, row: START_ROW, fullAt: 0, rechecking: true };
    if (!cursor.rechecking && Date.now() - cursor.fullAt >= RESCAN_MS) {
      cursor.row = START_ROW;
      cursor.rechecking = true;
    }

    const started = Date.now();
    let imported = 0, read = 0, skipped = 0, more = true;
    try {
      for (let i = 0; i < 5 && more && Date.now() - started < 60000; i++) {
        const reply = await post({ tipo: PULL, chave: access.key, linha: cursor.row });
        if (reply?.tipo !== PULL || reply.ok !== true)
          throw new Error(reply?.tipo === PULL ? reply.erro : 'A leitura requer uma implantação atualizada do Apps Script.');
        if (reply.reiniciar === true && reply.proxima_linha === START_ROW && cursor.row > START_ROW) {
          cursor.row = START_ROW;
          cursor.rechecking = true;
          await chrome.storage.local.set({ [CURSOR]: cursor });
          continue;
        }
        const next = reply.proxima_linha;
        if (reply.linha !== cursor.row || !Number.isSafeInteger(next) || next < cursor.row ||
            next > cursor.row + 100 || typeof reply.tem_mais !== 'boolean' || (reply.tem_mais && next === cursor.row) ||
            !Array.isArray(reply.vendas) || reply.vendas.length > next - cursor.row)
          throw new Error('Página de vendas inválida.');
        const rows = PISSalesBackup.normalize(reply.vendas, PISMarketCore);
        if (rows.length) {
          const receipt = await PISMarketStore.ingest('sale', rows, Date.now(), { fromSheet: true });
          imported += receipt.new;
          skipped += receipt.incomplete;
        }
        read += rows.length;
        skipped += Number.isSafeInteger(reply.ignoradas) && reply.ignoradas > 0 ? reply.ignoradas : 0;
        cursor.row = next;
        more = reply.tem_mais;
        if (!more && cursor.rechecking) {
          cursor.fullAt = Date.now();
          cursor.rechecking = false;
        }
        await chrome.storage.local.set({ [CURSOR]: cursor });
      }
      return { enabled: true, imported, read, skipped, more };
    } catch (failure) {
      return { enabled: true, imported, read, skipped, error: String(failure.message).slice(0, 240) };
    }
  }

  async function sendBatch(batch) {
    const lote = crypto.randomUUID();
    const vendas = PISSalesBackup.normalize(batch.map(entry => entry.row), PISMarketCore);
    if (vendas.some(row => PISMarketCore.incompleteSaleFields(row).length))
      throw new Error('O lote não passou na validação de ficha completa.');
    const receipt = await post({ tipo: PISSalesBackup.FORMAT, lote, vendas });
    if (receipt?.ok !== true || receipt.tipo !== PISSalesBackup.FORMAT || receipt.lote !== lote ||
        receipt.vendas_confirmadas !== batch.length) {
      const details = typeof receipt?.erro === 'string' ? ' ' + receipt.erro.slice(0, 150) : '';
      throw new Error('Apps Script não confirmou o lote. Confira a implantação do receptor.' + details);
    }
    await PISMarketStore.acknowledgeSalesBackup(batch);
  }

  function sync(reason) {
    active ??= (async () => {
      const started = Date.now();
      let saved = 0, skipped = 0, error = null;
      try {
        for (let i = 0; i < 10 && Date.now() - started < 90000; i++) {
          const batch = await PISMarketStore.pendingSalesBackup(100);
          if (!batch.length) break;
          const complete = [], invalid = [];
          for (const entry of batch)
            (PISMarketCore.incompleteSaleFields(entry.row).length ? invalid : complete).push(entry);
          if (invalid.length) {
            // Remove apenas referências antigas da fila; os registros locais não são apagados.
            await PISMarketStore.acknowledgeSalesBackup(invalid);
            skipped += invalid.length;
          }
          if (complete.length) {
            await sendBatch(complete);
            saved += complete.length;
          }
        }
      } catch (failure) {
        error = String(failure.message).slice(0, 240);
      }
      const pending = await PISMarketStore.pendingSalesBackupCount().catch(() => null);
      const pull = await pullSales().catch(() => ({ enabled: true, error: 'Falha ao ler o histórico do Sheets.' }));
      const status = { at: Date.now(), reason, saved, pending, skipped, error, pull };
      await chrome.storage.local.set({ [STATUS]: status });
      return status;
    })().finally(() => { active = null; });
    return active;
  }

  async function syncAndCatchUp(reason) {
    const status = await sync(reason);
    if (!status.error && status.pending != null) {
      if (status.pending === 0) await chrome.storage.local.set({ [INITIAL]: PISSalesBackup.FORMAT });
    }
    if ((!status.error && status.pending > 0) || status.pull.more)
      await chrome.alarms.create(CATCHUP_ALARM, { delayInMinutes: 1 });
    return status;
  }

  async function syncInitialLayout() {
    const saved = await chrome.storage.local.get([INITIAL, STATUS]);
    if (saved[INITIAL] === PISSalesBackup.FORMAT) return saved[STATUS] ?? { saved: 0, pending: 0 };
    return syncAndCatchUp('abertura_do_painel');
  }

  async function setReadAccess(value) {
    if (typeof value !== 'string' || (value !== '' && !/^[A-Za-z0-9_-]{32,128}$/.test(value)))
      return { error: 'Use a chave de leitura configurada no Apps Script.' };
    await chrome.storage.local.set({ [READ]: value ? { key: value, id: crypto.randomUUID() } : null, [CURSOR]: null });
    // Se uma sincronização anterior estiver no final, espere para usar a chave nova.
    if (active) await active;
    return value ? syncAndCatchUp('chave_de_leitura') : { disabled: true };
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
    if (alarm.name === ALARM) syncAndCatchUp('horário').catch(console.warn);
    if (alarm.name === CATCHUP_ALARM) syncAndCatchUp('continuação').catch(console.warn);
  });

  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    let run;
    if (message?.type === 'PIS_GAME_OPEN_SALES_BACKUP') {
      if (sender.id !== chrome.runtime.id || sender.frameId !== 0 || !sender.tab ||
          !PIS_HOST.test(String(sender.url || ''))) return false;
      run = () => syncAndCatchUp('abertura_do_pokeidle');
    } else {
      if (sender.url !== chrome.runtime.getURL('opportunities.html')) return false;
      if (message?.type === 'PIS_START_SALES_BACKUP') run = syncInitialLayout;
      else if (message?.type === 'PIS_SYNC_SALES_BACKUP') run = () => syncAndCatchUp('manual');
      else if (message?.type === 'PIS_SET_SALES_SHEET_ACCESS') {
        if (sender.id !== chrome.runtime.id) return false;
        run = () => setReadAccess(message.key);
      } else if (message?.type === 'PIS_SALES_SHEET_ACCESS_STATUS') {
        if (sender.id !== chrome.runtime.id) return false;
        run = async () => ({ enabled: Boolean((await chrome.storage.local.get(READ))[READ]?.key) });
      }
      else return false;
    }
    run().then(reply, () => reply({ error: 'Falha ao ler o banco local.' }));
    return true;
  });
  ensureAlarm();
})();
