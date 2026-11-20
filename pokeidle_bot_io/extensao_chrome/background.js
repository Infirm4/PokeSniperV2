'use strict';
// Automacao local de cliques MANUAIS do pokeidle.io.
// A extensao NAO acessa cookies, credenciais, WebSockets do jogo nem APIs privadas.
const SERVER = 'ws://127.0.0.1:8765';
const GAME = 'https://pokeidle.io/*';
let socket = null;
let keepAliveTimer = null;
let reconnectTimer = null;
let lastResult = {status: 'iniciando', clicks: 0, found: 0};

function connected() {
  return Boolean(socket && socket.readyState === WebSocket.OPEN);
}
function send(payload) {
  if (connected()) socket.send(JSON.stringify(payload));
}

// Funcao executada em mundo isolado pelo Chrome dentro da aba, inclusive sem foco.
// Captura usando os botoes que o jogador ja pode clicar manualmente, sem usar VIP.
function clickGameButtons() {
  const container = document.querySelector('#caidos-lista, .caidos-lista');
  if (!container) return {status: 'sem_lista', clicks: 0, found: 0};

  const buttons = [...container.querySelectorAll('button.caido, button[data-slot]')];
  const now = Date.now();
  // Este mapa fica no contexto isolado da extensao, entre injecoes na mesma aba.
  const recently = globalThis.__pokeidleRecentThrows || new WeakMap();
  globalThis.__pokeidleRecentThrows = recently;
  let clicks = 0;
  for (const button of buttons.slice(0, 12)) {
    if (!button.isConnected || button.disabled || button.getAttribute('aria-disabled') === 'true') continue;
    const style = getComputedStyle(button);
    const rect = button.getBoundingClientRect();
    if (style.display === 'none' || style.visibility === 'hidden' || rect.width < 1 || rect.height < 1) continue;
    // Evita martelar o mesmo botao caso o jogo ainda processe o lancamento.
    if (now - (recently.get(button) || 0) < 5000) continue;
    recently.set(button, now);
    button.click();
    clicks++;
    if (clicks >= 3) break; // no maximo 3 cliques por ciclo
  }
  return {status: clicks ? 'clicou' : buttons.length ? 'cooldown' : 'aguardando',
          clicks, found: buttons.length};
}

async function triggerThrow() {
  const tabs = await chrome.tabs.query({url: GAME});
  const candidates = tabs.filter(t => /^https:\/\/pokeidle\.io\//i.test(t.url || ''));
  if (!candidates.length) return {status: 'sem_aba', clicks: 0, found: 0};
  // Atua somente numa aba, sem ativa-la ou trazer o Chrome ao primeiro plano.
  const tab = candidates[0];
  if (tab.discarded) return {status: 'descartada', clicks: 0, found: 0};
  try {
    if (tab.autoDiscardable) await chrome.tabs.update(tab.id, {autoDiscardable: false});
    const result = await chrome.scripting.executeScript({
      target: {tabId: tab.id}, func: clickGameButtons
    });
    return result?.[0]?.result || {status: 'erro', clicks: 0, found: 0};
  } catch (error) {
    console.warn('Falha ao executar cliques de captura no pokeidle.io', error);
    return {status: 'sem_permissao', clicks: 0, found: 0};
  }
}
function clearHeartbeat() {
  if (keepAliveTimer !== null) clearInterval(keepAliveTimer);
  keepAliveTimer = null;
}
function connect() {
  if (socket && (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN)) return;
  if (reconnectTimer !== null) clearTimeout(reconnectTimer);
  reconnectTimer = null;
  try {
    const ws = new WebSocket(SERVER);
    socket = ws;
    ws.onopen = () => {
      send({type: 'hello', version: '2.0.0-io'});
      clearHeartbeat();
      keepAliveTimer = setInterval(() => send({type: 'ping'}), 20_000);
    };
    ws.onmessage = async event => {
      let command;
      try { command = JSON.parse(event.data); } catch { return; }
      if (command.type === 'throw') {
        lastResult = await triggerThrow();
        send({type: 'result', ...lastResult});
      }
    };
    ws.onclose = () => {
      if (socket !== ws) return;
      socket = null;
      clearHeartbeat();
      reconnectTimer = setTimeout(connect, 8000);
    };
    ws.onerror = () => {};
  } catch {
    reconnectTimer = setTimeout(connect, 8000);
  }
}
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('reconectar', {periodInMinutes: 0.5});
  connect();
});
chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create('reconectar', {periodInMinutes: 0.5});
  connect();
});
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'reconectar') connect();
});
chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
  if (msg.type === 'status') respond({connected: connected(), lastResult});
  else if (msg.type === 'connect') {
    connect();
    respond({connected: connected(), lastResult});
  }
});
chrome.alarms.get('reconectar', alarm => {
  if (!alarm) chrome.alarms.create('reconectar', {periodInMinutes: 0.5});
});
connect();
