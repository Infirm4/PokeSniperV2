const assert = require('node:assert/strict');
const test = require('node:test');
const { createCapture } = require('../extensao_chrome/capture.js');

function fixture() {
  let now = 0, buttons = [];
  const attempted = [];
  const list = { contains: button => buttons.includes(button), querySelectorAll: () => buttons };
  const document = { querySelector: () => buttons && list };
  const make = (name, slot, { disabled = false, visible = false } = {}) => ({
    dataset: { slot, caidoId: name },
    textContent: name,
    isConnected: true,
    matches: () => disabled,
    getBoundingClientRect: () => ({ width: visible ? 20 : 0, height: visible ? 20 : 0 }),
    click: () => attempted.push(name),
  });
  return { capture: createCapture(document, () => now), make, attempted,
    set(value) { buttons = value; }, advance(ms) { now += ms; } };
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
  set(null);
  assert.equal(capture().status, 'sem_lista');
  advance(3000);
  set([make('A', '1'), make('B', '2')]);
  assert.equal(capture().clicks, 1);
  assert.deepEqual(attempted, ['A', 'B']);
});
