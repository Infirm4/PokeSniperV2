const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const Storage = require('../src/storage.js');
const { createUI, HOST_ATTR } = require('../src/ui.js');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const memoryArea = () => {
  const data = {};
  return { data, get: async key => ({ [key]: data[key] }), set: async obj => Object.assign(data, obj) };
};

async function setup(html) {
  const dom = new JSDOM('<body>' + html + '</body>', { pretendToBeVisual: true });
  const { window } = dom;
  const area = memoryArea();
  const store = Storage.create(area);
  await store.load();
  const ui = createUI({ document: window.document, store, getComputedStyle: window.getComputedStyle.bind(window) });
  return { window, document: window.document, store, ui, area };
}

const vitrine = (...ids) => '<div id="cm-lista">' + ids.map(id =>
  `<div class="cm-card" data-anuncio-id="${id}"><b>Poke ${id}</b></div>`).join('') + '</div>';
const hosts = scope => [...scope.querySelectorAll('[' + HOST_ATTR + ']')];
const buttons = host => [...host.shadowRoot.querySelectorAll('button')].map(b => b.dataset.type);
const click = (host, type) => host.shadowRoot.querySelector(`button[data-type="${type}"]`)
  .dispatchEvent(new host.ownerDocument.defaultView.MouseEvent('click', { bubbles: true, composed: true }));

test('1) anúncio sem marca oferece só caveira, lua e estrela', async () => {
  const { document, ui } = await setup(vitrine('a1'));
  ui.reconcile();
  assert.deepEqual(buttons(hosts(document)[0]), ['skull', 'moon', 'star']);
});

test('2) ao escolher, só o ícone escolhido fica e os outros anúncios não mudam', async () => {
  const { document, ui } = await setup(vitrine('a1', 'a2'));
  ui.reconcile();
  click(hosts(document)[0], 'moon');
  ui.reconcile();
  const [first, second] = hosts(document);
  assert.deepEqual(buttons(first), ['moon']);
  assert.deepEqual(buttons(second), ['skull', 'moon', 'star']);
});

test('3) o marcador sobrevive a re-render do DOM e a fechar/abrir a vitrine', async () => {
  const { document, ui } = await setup(vitrine('a1'));
  ui.reconcile();
  click(hosts(document)[0], 'skull');
  document.getElementById('cm-lista').remove();               // fecha a vitrine
  document.body.insertAdjacentHTML('beforeend', vitrine('a1')); // abre de novo, DOM novo
  ui.reconcile();
  assert.deepEqual(buttons(hosts(document)[0]), ['skull']);
});

test('4) o mesmo anúncio nos favoritos mostra o mesmo marcador', async () => {
  const { document, ui } = await setup(vitrine('a1') +
    '<ul id="favs"><li class="cm-card"><button data-fav="a1"></button></li></ul>');
  ui.reconcile();
  click(hosts(document.getElementById('cm-lista'))[0], 'star');
  ui.reconcile();
  assert.deepEqual(buttons(hosts(document.getElementById('favs'))[0]), ['star']);
});

test('5) as marcações persistem após recarregar a página', async () => {
  const first = await setup(vitrine('a1'));
  first.ui.reconcile();
  click(hosts(first.document)[0], 'star');
  await first.store.flush();
  const store = Storage.create(first.area);                   // "F5": storage novo, mesmo disco
  await store.load();
  const dom = new JSDOM('<body>' + vitrine('a1') + '</body>');
  createUI({ document: dom.window.document, store, getComputedStyle: dom.window.getComputedStyle.bind(dom.window) }).reconcile();
  assert.deepEqual(buttons(hosts(dom.window.document)[0]), ['star']);
});

test('6) remover por clique ou botão direito volta ao estado sem marca, sem afetar os demais', async () => {
  const { document, ui, window } = await setup(vitrine('a1', 'a2'));
  ui.reconcile();
  click(hosts(document)[0], 'skull'); click(hosts(document)[1], 'moon');
  ui.reconcile();
  click(hosts(document)[0], 'skull');                          // clique no ícone ativo remove
  ui.reconcile();
  assert.deepEqual(buttons(hosts(document)[0]), ['skull', 'moon', 'star']);
  assert.deepEqual(buttons(hosts(document)[1]), ['moon']);
  hosts(document)[1].dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, composed: true }));
  ui.reconcile();
  assert.deepEqual(buttons(hosts(document)[1]), ['skull', 'moon', 'star']);
});

test('injeção idempotente: nunca duplica ícones no mesmo card', async () => {
  const { document, ui } = await setup(vitrine('a1'));
  for (let i = 0; i < 5; i++) ui.reconcile();
  const card = document.querySelector('.cm-card');
  card.append(card.firstElementChild.cloneNode(true));
  card.append(hosts(document)[0].cloneNode(false));            // host duplicado "fantasma"
  ui.reconcile();
  assert.equal(hosts(card).length, 1);
});

test('o clique no marcador não chega ao card', async () => {
  const { document, ui } = await setup(vitrine('a1'));
  ui.reconcile();
  let reached = false;
  document.querySelector('.cm-card').addEventListener('click', () => { reached = true; });
  click(hosts(document)[0], 'skull');
  assert.equal(reached, false);
});

test('o observer reinjeta após re-render e não entra em loop', async () => {
  const { document, ui, window, store } = await setup(vitrine('a1'));
  store.set('id:a1', 'moon');
  const running = ui.start(window);
  await sleep(150);
  const before = hosts(document).length;
  document.getElementById('cm-lista').innerHTML = '<div class="cm-card" data-anuncio-id="a1">novo</div>';
  await sleep(250);
  assert.equal(before, 1);
  assert.deepEqual(buttons(hosts(document)[0]), ['moon']);
  const stable = document.documentElement.outerHTML;
  await sleep(250);
  assert.equal(document.documentElement.outerHTML, stable);   // sem mutações autoinduzidas
  running.stop();
});
