// Identificador estável por anúncio. O mesmo anúncio recebe a mesma chave na vitrine
// e nos favoritos, desde que o jogo exponha o id em algum atributo do card.
(function (root) {
  const ID = /^[A-Za-z0-9_-]{1,64}$/;
  const DATASET_NAMES = ['anuncioId', 'listingId'];

  const valid = value => (typeof value === 'string' && ID.test(value) ? value : null);

  function fromDataset(element) {
    for (const name of DATASET_NAMES) {
      const found = valid(element?.dataset?.[name]);
      if (found) return found;
    }
    return null;
  }

  // 1) id nos atributos do próprio card; 2) em um descendente; 3) no botão de favoritar.
  function extractId(card) {
    const own = fromDataset(card);
    if (own) return own;
    const holder = card.querySelector('[data-anuncio-id], [data-listing-id]');
    const nested = holder && fromDataset(holder);
    if (nested) return nested;
    return valid(card.querySelector('[data-fav]')?.dataset?.fav);
  }

  const normalize = text => String(text ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

  // cyrb53: hash determinístico de 53 bits, suficiente para chaves locais.
  function hash(text) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      h1 = Math.imul(h1 ^ code, 2654435761);
      h2 = Math.imul(h2 ^ code, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
  }

  // Fallback quando o DOM não traz id: sprite + nome + preço + vendedor.
  // Troca de preço gera outra chave, então o marcador só vale enquanto o anúncio não muda.
  function fingerprint(card) {
    const sprites = [...card.querySelectorAll('img')]
      .map(image => (image.getAttribute('src') || '').split('/').pop().split(/[?#]/)[0])
      .filter(Boolean).join(',');
    const name = card.querySelector('.cm-nome, .nome, h3, h4, strong')?.textContent;
    const priceNode = card.querySelector('.cm-rodape .cm-preco');
    const price = priceNode?.dataset?.preco ?? priceNode?.textContent;
    const seller = card.dataset?.vendedor ?? card.querySelector('.cm-vendedor, [data-vendedor]')?.textContent;
    const parts = [sprites, normalize(name), normalize(price), normalize(seller)];
    return parts.filter(Boolean).length >= 2 ? hash(parts.join('|')) : null;
  }

  function listingKey(card) {
    const id = extractId(card);
    if (id) return 'id:' + id;
    const print = fingerprint(card);
    return print ? 'fp:' + print : null;
  }

  const api = { extractId, fingerprint, listingKey, hash };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PIMListingId = api;
})(typeof self !== 'undefined' ? self : globalThis);
