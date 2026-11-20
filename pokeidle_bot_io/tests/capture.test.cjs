const assert = require('node:assert/strict');
const test = require('node:test');
const { createCapture } = require('../extensao_chrome/capture.js');

function fixture() {
  let now = 0, lists = [], area = null;
  const attempted = [];
  const makeList = buttons => ({
    contains: button => buttons.includes(button),
    querySelectorAll: selector => selector === 'button.caido' ? buttons.filter(button => button.caido) : buttons,
  });
  const document = { querySelectorAll: () => lists, querySelector: () => area };
  const make = (name, slot, { disabled = false, caido = true } = {}) => ({
    dataset: { slot, caidoId: name },
    textContent: name,
    caido,
    isConnected: true,
    matches: () => disabled,
    getBoundingClientRect: () => ({ width: 0, height: 0 }),
    click: () => attempted.push(name),
  });
  return { capture: createCapture(document, () => now), make, attempted,
    set(...values) { lists = values.map(makeList); },
    setArea(buttons) { area = makeList(buttons); },
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
