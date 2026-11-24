const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { listingKey, extractId, fingerprint } = require('../src/listing-id.js');

const card = html => new JSDOM('<body>' + html + '</body>').window.document.body.firstElementChild;

test('usa o id no próprio card', () => {
  assert.equal(listingKey(card('<div class="cm-card" data-anuncio-id="a1"></div>')), 'id:a1');
  assert.equal(listingKey(card('<div class="cm-card" data-listing-id="L_9"></div>')), 'id:L_9');
});

test('usa o id de um descendente ou do botão de favoritar', () => {
  assert.equal(extractId(card('<div class="cm-card"><i data-listing-id="x7"></i></div>')), 'x7');
  assert.equal(extractId(card('<div class="cm-card"><button data-fav="f42"></button></div>')), 'f42');
});

test('vitrine e favoritos geram a mesma chave para o mesmo anúncio', () => {
  const vitrine = card('<div class="cm-card" data-anuncio-id="abc"><span class="cm-rodape"></span></div>');
  const favoritos = card('<li class="cm-card"><button data-fav="abc"></button><b>outro layout</b></li>');
  assert.equal(listingKey(vitrine), listingKey(favoritos));
});

test('rejeita ids inválidos e cai no fallback determinístico', () => {
  const html = '<div class="cm-card" data-anuncio-id="a b!"><img src="/s/pikachu.png?x=1"><h3>Pikachu</h3>' +
    '<div class="cm-rodape"><span class="cm-preco" data-preco="1,5mi"></span></div></div>';
  const a = card(html), b = card(html);
  assert.equal(extractId(a), null);
  assert.match(listingKey(a), /^fp:[0-9a-z]+$/);
  assert.equal(listingKey(a), listingKey(b));
  assert.notEqual(listingKey(a), listingKey(card(html.replace('Pikachu', 'Raichu'))));
});

test('sem sinais suficientes não gera chave', () => {
  assert.equal(listingKey(card('<div class="cm-card"></div>')), null);
  assert.equal(fingerprint(card('<div class="cm-card"><h3>Só nome</h3></div>')), null);
});
