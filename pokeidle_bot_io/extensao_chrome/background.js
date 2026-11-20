'use strict';

const SETTINGS = 'captureSettings';
const TARGET = 'captureTarget';
const LAST = 'captureLastResult';
const ALARM = 'capture-wakeup';
const GAME = 'https://pokeidle.io/*';
const DEFAULT_INTERVAL = 3;
let tail = Promise.resolve();

function enqueue(task) {
  const result = tail.then(task);
  tail = result.catch(() => {});
  return result;
}

function isGame(tab) {
  return /^https:\/\/pokeidle\.io\//i.test(tab?.url || '');
}

function settings(value) {
  const interval = Number(value?.interval);
  return { enabled: value?.enabled === true,
    interval: Number.isFinite(interval) && interval >= 2 && interval <= 3600 ? interval : DEFAULT_INTERVAL };
}

async function updateTab(id, change) {
  try { await chrome.tabs.update(id, change); } catch { /* A aba pode ter sido fechada. */ }
}

async function waitForDocument(work) {
  let timer;
  try {
    return await Promise.race([work, new Promise((_, reject) => {
      timer = setTimeout(() => {
        const error = new Error('A aba não respondeu.');
        error.pendingDocument = true;
        reject(error);
      }, 2500);
    })]);
  } finally { clearTimeout(timer); }
}

const send = (id, message) => waitForDocument(chrome.tabs.sendMessage(id, message, { frameId: 0 }));

async function release(lease) {
  if (!lease) return;
  try { await send(lease.id, { type: 'capture:stop' }); } catch { /* Documento já trocado. */ }
  if (lease.autoDiscardable) await updateTab(lease.id, { autoDiscardable: true });
  await chrome.storage.session.remove(TARGET);
}

async function request(tab, config) {
  const command = { type: 'capture:run', interval: config.interval };
  try {
    const reply = await send(tab.id, command);
    return reply?.result;
  } catch (error) {
    if (error.pendingDocument) throw error;
    // Cobre a instalação/reinstalação enquanto o jogo já está aberto.
    await waitForDocument(chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['capture.js'] }));
    return (await send(tab.id, command))?.result;
  }
}

async function sweep() {
  const config = settings((await chrome.storage.local.get(SETTINGS))[SETTINGS]);
  let lease = (await chrome.storage.session.get(TARGET))[TARGET];
  if (!config.enabled) {
    await release(lease);
    return;
  }

  const tabs = (await chrome.tabs.query({ url: GAME })).filter(isGame);
  let tab = tabs.find(candidate => candidate.id === lease?.id);
  if (!tab) {
    await release(lease);
    tab = tabs.find(candidate => candidate.active && !candidate.discarded && !candidate.frozen) ??
      tabs.find(candidate => !candidate.discarded && !candidate.frozen) ?? tabs[0];
    if (tab) {
      lease = { id: tab.id, autoDiscardable: tab.autoDiscardable === true };
      await chrome.storage.session.set({ [TARGET]: lease });
    }
  }

  let status = 'sem_aba', scan;
  if (tab) {
    if (tab.discarded) status = 'descartada';
    else if (tab.frozen) status = 'congelada';
    else {
      if (tab.autoDiscardable) await updateTab(tab.id, { autoDiscardable: false });
      try { scan = await request(tab, config); }
      catch (error) { status = error.pendingDocument ? 'sem_resposta' : 'sem_permissao'; }
      if (!scan && status === 'sem_aba') status = 'aguardando';
    }
  }
  await chrome.storage.session.set({ [LAST]: scan ?? { status, found: 0, clicks: 0, at: Date.now() } });
}

async function ensureAlarm() {
  const alarm = await chrome.alarms.get(ALARM);
  if (!alarm) await chrome.alarms.create(ALARM, { periodInMinutes: 0.5 });
}

function wake() {
  return enqueue(async () => {
    await ensureAlarm();
    await sweep();
  });
}

function wakeSafely() {
  wake().catch(error => console.warn('Captura automática:', error.message));
}

chrome.runtime.onInstalled.addListener(wakeSafely);
chrome.runtime.onStartup.addListener(wakeSafely);
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === ALARM) wakeSafely(); });
chrome.tabs.onRemoved.addListener(async id => {
  if ((await chrome.storage.session.get(TARGET))[TARGET]?.id === id) wakeSafely();
});
chrome.tabs.onUpdated.addListener(async (id, change, tab) => {
  if (!(change.url || change.status === 'complete' || 'discarded' in change || 'frozen' in change)) return;
  if (isGame(tab) || (change.url && (await chrome.storage.session.get(TARGET))[TARGET]?.id === id)) wakeSafely();
});

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id) return false;
  if (message?.type === 'capture:result') {
    if (!isGame(sender.tab) || sender.frameId !== 0) return false;
    (async () => {
      const lease = (await chrome.storage.session.get(TARGET))[TARGET];
      if (lease?.id === sender.tab.id) await chrome.storage.session.set({ [LAST]: message.result });
    })().then(() => reply({ ok: true }), () => reply({ ok: false }));
    return true;
  }
  if (sender.url !== chrome.runtime.getURL('popup.html')) return false;
  const ops = {
    'capture:get': async () => {
      const config = settings((await chrome.storage.local.get(SETTINGS))[SETTINGS]);
      return { config, result: (await chrome.storage.session.get(LAST))[LAST] };
    },
    'capture:set': async () => {
      const config = settings(message.config);
      await chrome.storage.local.set({ [SETTINGS]: config });
      await wake();
      return { config, result: (await chrome.storage.session.get(LAST))[LAST] };
    },
  };
  if (!Object.hasOwn(ops, message?.type)) return false;
  ops[message.type]().then(reply, () => reply({ error: 'Não foi possível acessar a aba do jogo.' }));
  return true;
});
