// Captura voluntária de metadados da vitrine. IDs recebem apelidos por sessão.
(() => {
  const LIMIT_MS = 5 * 60 * 1000;
  const EVENT_LIMIT = 120;
  const TRACK_LIMIT = 3000;
  const FILTER_NUMBERS = ['especieId', 'nivelMin', 'nivelMax', 'potenciaMin', 'potenciaMax',
    'notaMin', 'notaMax', 'ivMin', 'ivMax', 'qualidadeMin', 'qualidadeMax', 'precoMin', 'precoMax',
    'porPagina', 'pageSize', 'limite'];
  const FLAGS = ['soShiny', 'soP5', 'soMega', 'soLendario', 'soTmElemental', 'soTmAoe', 'semOutland', 'tiposUnidos'];
  const ACTIONS = ['abrir edição', 'salvar edição', 'ver ficha', 'alterar controle'];
  const COMPARE_FIELDS = ['preço', 'anúncio', 'moeda', 'criadoEm', 'compravelEm', 'expiraEm', 'alteradoEm'];
  const NETWORK_TYPES = ['fetch', 'xmlhttprequest', 'eventsource'];
  const ORDER_TEXT = /^(?:adicionados? recentemente|recentes|mais baratos|mais caros|última alteração|última atualização|maior nota|menor nota|maior nível|menor nível|mais novos|mais antigos)$/iu;
  const MARKET_ROUTE = /^(?:market|mercado|vitrine|listing|listings|anuncio|anuncios|pokemon|ficha|offers|offer)$/i;
  const PATH_WORD = /^(?:api|market|mercado|vitrine|listing|listings|anuncio|anuncios|pokemon|ficha|offers|offer|detail|details|update|edit|recent|preco|price|stream|events|sse|v[1-9])$/i;
  const operation = value => typeof value === 'string' && /^(?:market|mkt)[.A-Za-z_]{0,38}$/.test(value) ? value : null;
  const option = value => typeof value === 'string' && /^[a-z][a-z0-9_-]{0,31}$/i.test(value) ? value : null;
  const currency = value => ['gold', 'orb'].includes(value) ? value : null;
  const number = value => typeof value === 'number' && Number.isFinite(value) ? value :
    typeof value === 'string' && /^\d{1,15}(?:\.\d{1,6})?$/.test(value) ? Number(value) : null;
  const identifier = value => typeof value === 'string' && /^\d{1,24}$/.test(value) ? value :
    Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
  const listingId = row => row.anuncioId ?? row.idAnuncio ?? row.listingId ?? row.ofertaId ?? row.id;

  function create(now = () => Date.now()) {
    let capture;
    const active = () => Boolean(capture && now() - capture.start < LIMIT_MS);

    function start() {
      capture = { start: now(), events: [], changes: [], dropped: 0,
        listings: new Map(), specimens: new Map(), seen: new Map(), orders: new Set(), detailAt: -Infinity };
      return true;
    }

    function token(map, value, prefix) {
      const key = identifier(value);
      if (key == null) return null;
      if (!map.has(key) && map.size < TRACK_LIMIT) map.set(key, prefix + (map.size + 1));
      return map.get(key) ?? null;
    }

    function add(entry) {
      if (capture.events.length === EVENT_LIMIT) { capture.dropped++; return; }
      capture.events.push({ ms: now() - capture.start, ...entry });
    }

    function readRow(row, denom) {
      return { anúncio: token(capture.listings, listingId(row), 'A'),
        exemplar: token(capture.specimens, row.pokemonId ?? row.ficha?.id, 'P'),
        espécie: number(row.especieId ?? row.ficha?.speciesId ?? row.ficha?.especieId),
        moeda: currency(row.moeda) ?? denom, preço: number(row.preco ?? row.price ?? row.novoPreco),
        criadoEm: number(row.criadoEm), compravelEm: number(row.compravelEm),
        expiraEm: number(row.expiraEm), alteradoEm: number(row.alteradoEm ?? row.atualizadoEm ??
          row.editadoEm ?? row.precoAlteradoEm ?? row.updatedAt ?? row.lastModified) };
    }

    function compare(row, context) {
      const key = row.exemplar ?? (row.anúncio && row.moeda && row.moeda + row.anúncio);
      if (!key || row.preço == null) return;
      const before = capture.seen.get(key);
      if (before && COMPARE_FIELDS.some(field => row[field] != null && row[field] !== before[field]) &&
          capture.changes.length < EVENT_LIMIT) capture.changes.push({ ms: now() - capture.start, ...context, antes: before, depois: row });
      if (!before && capture.seen.size >= TRACK_LIMIT) return;
      const current = before && (!row.anúncio || row.anúncio === before.anúncio) ?
        { ...before, ...Object.fromEntries(Object.entries(row).filter(([, value]) => value != null)) } : row;
      capture.seen.set(key, current);
    }

    function socket(direction, frame) {
      if (!active() || !frame || typeof frame !== 'object') return;
      if (direction === 'recebida' && Array.isArray(frame.ev)) {
        for (const event of frame.ev.slice(0, 60)) {
          const op = operation(event?.k ?? event?.t);
          if (op) add({ canal: 'WebSocket', sentido: 'evento', operação: op, ...readRow(event, null) });
        }
      }
      const op = operation(frame.t ?? frame.k);
      if (!op) return;
      const aba = option(frame.aba), denom = currency(frame.moeda);
      // O cenário do teste é a vitrine, menus e edição. Históricos ficam fora do relatório.
      if (/histor/i.test(op) || /histor/i.test(aba ?? '')) return;
      const entry = { canal: 'WebSocket', sentido: direction, operação: op, aba, moeda: denom,
        seq: number(frame.seq), ordem: option(frame.ordem), página: number(frame.pagina),
        anúncio: token(capture.listings, listingId(frame), 'A'),
        exemplar: token(capture.specimens, frame.pokemonId, 'P'), preço: number(frame.preco ?? frame.novoPreco) };
      if (direction === 'enviada') {
        entry.filtros = Object.fromEntries(FILTER_NUMBERS.flatMap(key => {
          const value = number(frame[key]);
          return value == null ? [] : [[key, value]];
        }));
        Object.assign(entry.filtros, Object.fromEntries(FLAGS.filter(key => typeof frame[key] === 'boolean').map(key => [key, frame[key]])));
        entry.filtros.busca_preenchida = typeof frame.busca === 'string' && Boolean(frame.busca.trim());
      } else if (Array.isArray(frame.linhas)) {
        entry.paginação = { porPagina: number(frame.porPagina), total: number(frame.total),
          temMais: typeof frame.temMais === 'boolean' ? frame.temMais : null, linhas: frame.linhas.length };
        const rows = frame.linhas.slice(0, 200).filter(row => row && typeof row === 'object');
        const samples = rows.map(row => readRow(row, denom));
        const context = { aba, ordem: entry.ordem, página: entry.página };
        if (aba === 'vitrine' || /^meus|anuncio|oferta/i.test(aba ?? '')) samples.forEach(row => compare(row, context));
        const range = values => {
          const present = values.filter(value => value != null);
          return present.length ? [Math.min(...present), Math.max(...present)] : null;
        };
        entry.retornados = { espécies: [...new Set(samples.map(row => row.espécie).filter(value => value != null))].slice(0, 30),
          preço: range(samples.map(row => row.preço)), nota: range(rows.map(row => number(row.ficha?.nota ?? row.ficha?.grade))),
          iv_total: range(rows.map(row => number(row.ficha?.ivTotal ?? row.ficha?.ivSoma ?? row.ficha?.ivSomado))),
          shiny: [...new Set(rows.map(row => row.ficha?.shiny).filter(value => [0, 1, false, true].includes(value)))],
          primeiro: samples[0]?.anúncio ?? null, último: samples.at(-1)?.anúncio ?? null,
          anúncios_na_ordem: samples.slice(0, 60).map(row => row.anúncio) };
      } else {
        const row = readRow(frame.anuncio ?? frame.linha ?? frame, denom);
        if (row.anúncio || row.exemplar) entry.dados = row;
        if (/^(?:market|mkt).*(?:edit|alter|preco|price|updat)/i.test(op)) compare(row, { operação: op });
      }
      add(entry);
    }

    function raw(direction, value) {
      if (!active() || typeof value !== 'string' || value.length > 262144 ||
          !/"[tk]"\s*:\s*"(?:market|mkt)/i.test(value)) return;
      try { socket(direction, JSON.parse(value)); } catch { /* Formato fora da captura. */ }
    }

    function network(kind, name, base, status) {
      if (!active() || !NETWORK_TYPES.includes(kind)) return;
      let url;
      try { url = new URL(name, base); } catch { return; }
      if (!/^https?:$/.test(url.protocol) || !/(?:^|\.)pokeidle\.io$/i.test(url.hostname)) return;
      const parts = url.pathname.split('/').filter(Boolean);
      if (kind !== 'eventsource' && now() - capture.detailAt > 2500 && !parts.some(part => MARKET_ROUTE.test(part))) return;
      const rota = '/' + parts.slice(0, 10).map(part => PATH_WORD.test(part) ? part.toLowerCase() : identifier(part) ? ':id' : '*').join('/');
      const alias = keys => keys.map(key => url.searchParams.get(key)).find(value => identifier(value) != null);
      add({ canal: kind, rota, status: number(status),
        anúncio: token(capture.listings, alias(['anuncioId', 'listingId']), 'A'),
        exemplar: token(capture.specimens, alias(['pokemonId']), 'P'),
        id_no_url: identifier(url.searchParams.get('id')) != null || parts.some(part => identifier(part) != null) });
    }

    function controls(action, labels) {
      if (!active()) return;
      for (const label of labels ?? []) if (ORDER_TEXT.test(label)) capture.orders.add(label.toLowerCase());
      if (action === 'ver ficha') capture.detailAt = now();
      if (ACTIONS.includes(action)) add({ ação: action });
    }

    function finish() {
      if (!capture) return null;
      const result = { duração_ms: Math.min(LIMIT_MS, Math.max(0, now() - capture.start)),
        ordens_no_menu: [...capture.orders], eventos: capture.events, diferenças_observadas: capture.changes,
        eventos_fora_do_limite: capture.dropped };
      capture = undefined;
      return result;
    }

    return { start, active, socket, raw, network, controls, finish };
  }

  const api = { create, LIMIT_MS };
  if (typeof window === 'undefined' && typeof module === 'object' && module.exports) module.exports = api;
  else globalThis.PISMarketWireDiagnostic = api;
})();
