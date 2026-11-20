const assert = require('node:assert/strict');
const test = require('node:test');
const { createCapture } = require('../extensao_chrome/capture.js');

function fixture() {
  let now = 0, lists = [], area = null, sceneOff = false;
  const attempted = [];
  const makeList = buttons => ({
    contains: button => buttons.includes(button),
    querySelectorAll: selector => selector === 'button.caido' ? buttons.filter(button => button.caido) : buttons,
  });
  const sceneButton = { textContent: 'LIGAR A CENA', getClientRects: () => [{}] };
  const document = {
    querySelectorAll: selector => selector === 'button, [role="button"]' ? (sceneOff ? [sceneButton] : []) : lists,
    querySelector: () => area,
  };
  const make = (name, slot, { disabled = false, caido = true, width } = {}) => ({
    dataset: { slot, caidoId: name },
    textContent: name,
    caido,
    isConnected: true,
    matches: () => disabled,
    querySelector() { return { style: { width: this.width } }; },
    width,
    getBoundingClientRect: () => ({ width: 0, height: 0 }),
    click: () => attempted.push(name),
  });
  return { capture: createCapture(document, () => now), make, attempted,
    set(...values) { lists = values.map(makeList); },
    setArea(buttons) { area = makeList(buttons); },
    setSceneOff(value) { sceneOff = value; },
    advance(ms) { now += ms; },
  };
}

test('processa botões ocultos por um painel em lotes e respeita botões desabilitados', () => {
  const { capture, make, set, advance, attempted } = fixture();
  set([make('bloqueado', '0', { disabled: true }), ...['A', 'B', 'C', 'D'].map((name, index) => make(name, String(index + 1)))]);
  assert.deepEqual(capture(), { status: 'clicou', clicks: 3, found: 5 });
  advance(3000);
  assert.deepEqual(capture(), { status: 'clicou', clicks: 1, found: 5 });
  assert.deepEqual(attempted, ['A', 'B', 'C', 'D']);
});

test('aguarda lista ausente e preserva o intervalo de um alvo mesmo se o botão for refeito', () => {
  const { capture, make, set, advance, attempted } = fixture();
  set([make('A', '1')]);
  assert.equal(capture().clicks, 1);
  set();
  assert.equal(capture().status, 'sem_lista');
  advance(3000);
  set([make('A', '1'), make('B', '2')]);
  assert.equal(capture().clicks, 1);
  assert.deepEqual(attempted, ['A', 'B']);
});

test('processa uma lista alternativa se a primeira estiver vazia ou desabilitada', () => {
  const { capture, make, set, advance, attempted } = fixture();
  set([], [make('A', '1')]);
  assert.deepEqual(capture(), { status: 'clicou', clicks: 1, found: 1 });
  advance(3000);
  set([make('bloqueado', '0', { disabled: true })], [make('B', '2')]);
  assert.deepEqual(capture(), { status: 'clicou', clicks: 1, found: 1 });
  assert.deepEqual(attempted, ['A', 'B']);
});

test('sem a lista, só clica nos botões de caídos da área da hunt', () => {
  const { capture, make, setArea, attempted } = fixture();
  setArea([make('outro botão', '0', { caido: false })]);
  assert.equal(capture().status, 'sem_lista');
  setArea([make('outro botão', '0', { caido: false }), make('bloqueado', '1', { disabled: true })]);
  assert.deepEqual(capture(), { status: 'bloqueado', clicks: 0, found: 1 });
  setArea([make('outro botão', '0', { caido: false }), make('A', '2')]);
  assert.deepEqual(capture(), { status: 'clicou', clicks: 1, found: 1 });
  assert.deepEqual(attempted, ['A']);
});

test('ignora alvos com o contador zerado mesmo se o botão continuar habilitado', () => {
  const { capture, make, set, attempted } = fixture();
  const expired = make('vencido', '0', { width: '0%' });
  set([expired]);
  assert.deepEqual(capture(), { status: 'expirado', clicks: 0, found: 1 });
  set([expired], [make('novo', '1', { width: '92%' })]);
  assert.deepEqual(capture(), { status: 'clicou', clicks: 1, found: 1 });
  assert.deepEqual(attempted, ['novo']);
});

test('com a cena desligada, pula alvo congelado e continua capturando da lista atualizada', () => {
  const { capture, make, set, setSceneOff, advance, attempted } = fixture();
  set([make('antigo', '0', { width: '60%' })]);
  assert.equal(capture().clicks, 1);
  setSceneOff(true);
  advance(6000);
  const old = make('antigo', '0', { width: '60%' });
  set([old]);
  assert.deepEqual(capture(), { status: 'cena_desligada', clicks: 0, found: 1 });
  const fresh = make('novo', '1', { width: '98%' });
  set([old], [fresh]);
  assert.equal(capture().clicks, 1);
  advance(6000);
  fresh.width = '65%';
  assert.equal(capture().clicks, 1);
  assert.deepEqual(attempted, ['antigo', 'novo', 'novo']);
  setSceneOff(false);
  advance(6000);
  assert.equal(capture().clicks, 1);
  assert.equal(attempted.at(-1), 'antigo');
});
