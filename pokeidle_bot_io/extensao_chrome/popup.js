'use strict';

const status = document.querySelector('#status');
const game = document.querySelector('#game');
const toggle = document.querySelector('#toggle');
const interval = document.querySelector('#interval');
const save = document.querySelector('#save');
const intervalStatus = document.querySelector('#interval-status');
let config, busy = false;

const messages = {
  sem_aba: 'Abra o PokéIdle e entre em uma hunt.',
  sem_lista: 'Aguardando a lista de caídos voltar ao jogo.',
  aguardando: 'Aguardando Pokémon caídos.',
  bloqueado: 'A lista está presente. Os botões estão bloqueados pelo jogo.',
  cooldown: 'Aguardando o prazo entre tentativas.',
  descartada: 'O Chrome descarregou a aba. Volte ao jogo para retomá-la.',
  congelada: 'O Chrome congelou a aba. As tentativas retomam quando ela responder.',
  sem_resposta: 'A aba não respondeu. O bot tentará novamente.',
  sem_permissao: 'O Chrome bloqueou o acesso à aba. Recarregue o jogo.',
};

function render(state) {
  config = state.config;
  const result = state.result;
  status.dataset.active = String(config.enabled);
  status.textContent = config.enabled ? 'Captura ligada' : 'Captura desligada';
  toggle.textContent = config.enabled ? 'Desligar' : 'Ligar';
  toggle.disabled = interval.disabled = save.disabled = false;
  if (!interval.matches(':focus')) interval.value = config.interval;
  game.textContent = !config.enabled ? 'Ligue a captura depois de escolher uma Poké Bola na hunt.' :
    result?.status === 'clicou'
      ? `${result.clicks} tentativa(s) enviada(s) de ${result.found} alvo(s). Confira o resultado no jogo.`
      : messages[result?.status] ?? 'Aguardando a primeira leitura da aba.';
}

async function refresh() {
  if (busy) return;
  try {
    const state = await chrome.runtime.sendMessage({ type: 'capture:get' });
    if (!busy && state?.config) render(state);
  } catch { if (!busy) status.textContent = 'Extensão indisponível.'; }
}

async function saveConfig(next) {
  if (busy) return;
  busy = true;
  toggle.disabled = save.disabled = true;
  intervalStatus.textContent = '';
  try {
    const state = await chrome.runtime.sendMessage({ type: 'capture:set', config: next });
    if (!state?.config) throw new Error(state?.error ?? 'Sem resposta da extensão.');
    render(state);
  } catch (error) { intervalStatus.textContent = error.message; }
  finally {
    busy = false;
    toggle.disabled = save.disabled = false;
  }
}

toggle.addEventListener('click', () => { if (config) void saveConfig({ ...config, enabled: !config.enabled }); });
document.querySelector('#settings').addEventListener('submit', event => {
  event.preventDefault();
  if (config) void saveConfig({ ...config, interval: interval.valueAsNumber });
});
void refresh();
setInterval(refresh, 1000);
