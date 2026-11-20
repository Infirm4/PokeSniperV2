// A trilha guarda apenas contagens e número de página. Nunca guarda IDs ou conteúdo de pacotes.
(() => {
  const KEY = 'marketHistoryTrace';
  const EVENTS = ['request', 'response', 'invalid_json', 'ignored_socket', 'legacy_batch'];
  const FIELDS = ['listingId', 'anuncioId', 'idAnuncio', 'anuncio_id', 'listing_id', 'ofertaId', 'idOferta'];
  const IMAGE_KEYS = ['sprite', 'icone', 'icon', 'imagem', 'img', 'url', 'spriteUrl', 'looktype', 'dex', 'dexId'];
  const imageShape = sample => Object.fromEntries(IMAGE_KEYS
    .filter(key => ['null', 'number', 'string', 'object', 'boolean'].includes(sample?.[key]))
    .map(key => [key, sample[key]]));
  const asCount = value => Number.isSafeInteger(value) && value >= 0 ? Math.min(10000, value) : 0;
  let tail = Promise.resolve();

  function clean(event, trace = {}, receipt = {}, now = Date.now()) {
    if (!EVENTS.includes(event)) return null;
    const page = typeof trace.page === 'string' && /^\d{1,4}$/.test(trace.page) ? Number(trace.page) : trace.page;
    const base = { evento: event, pagina: Number.isSafeInteger(page) && page >= 0 && page <= 9999 ? page : null, em: now };
    if (event === 'request') return { ...base, filtroPokemon: trace.pokemon === true };
    if (event === 'invalid_json') return base;
    return {
      ...base, totalLinhas: asCount(trace.rows), linhasPokemon: asCount(trace.pokemon),
      itensNaoPokemon: asCount(trace.items), linhasSemTipoIdentificavel: asCount(trace.unclassified),
      pokemonSemSpriteNaResposta: asCount(trace.missingSprite), outlawsSemSpriteNaResposta: asCount(trace.outlawWithoutSprite),
      exemplosSemSprite: Array.isArray(trace.imageSamples) ? trace.imageSamples.slice(0, 8).map(sample => ({
        linha: imageShape(sample?.linha), ficha: imageShape(sample?.ficha), comNome: sample?.comNome === true,
      })) : [],
      comFicha: asCount(trace.withProfile), temMais: typeof trace.more === 'boolean' ? trace.more : null,
      camposCandidatosIdAnuncio: Object.fromEntries(FIELDS.map(field => [field, asCount(trace.candidateFields?.[field])])),
      lote: ['gravado', 'sem_registros_validos', 'fila_cheia', 'falha_na_gravação', 'lote_inválido'].includes(receipt.status)
        ? receipt.status : null,
      aceitas: asCount(receipt.accepted),
      fichasIncompletas: asCount(receipt.incomplete),
      outlawsIgnorados: asCount(receipt.outlaws),
      novasAproveitadasSemSprite: asCount(receipt.newWithoutSprite),
      novas: asCount(receipt.new), repetidas: asCount(receipt.existing), conflitos: asCount(receipt.conflicts),
      ganharamIvsCompletos: asCount(receipt.gainedFullIvs),
    };
  }

  function record(event, trace, receipt) {
    const entry = clean(event, trace, receipt);
    if (!entry) return Promise.resolve();
    const write = tail.then(async () => {
      const { [KEY]: stored } = await chrome.storage.session.get(KEY);
      const history = Array.isArray(stored) ? stored : [];
      await chrome.storage.session.set({ [KEY]: [...history.slice(-39), entry] });
    });
    tail = write.catch(() => {});
    return write;
  }

  const api = { KEY, clean, record };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else globalThis.PISHistoryTrace = api;
})();
