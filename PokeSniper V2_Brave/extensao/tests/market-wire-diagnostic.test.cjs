const assert = require('node:assert/strict');
const test = require('node:test');
const { create, LIMIT_MS } = require('../market-wire-diagnostic');

test('registra filtros, páginas e mudança de preço com IDs anônimos', () => {
  let now = 111000;
  const probe = create(() => now);
  probe.start();
  probe.raw('enviada', JSON.stringify({ t: 'market.listar', moeda: 'orb', ordem: 'recentes', pagina: 1,
    especieId: 212, notaMin: '3.55', ivMin: 110, precoMax: 30, soShiny: true,
    busca: 'nome de jogador', token: 'private-token' }));
  const row = { id: '9812244', pokemonId: '671322', preco: 18, vendedor: 'nome de jogador',
    criadoEm: 1700000000000, compravelEm: 1700000001000, ficha: { speciesId: 212, nota: 3.6, ivTotal: 120, shiny: 1 } };
  const page = { t: 'market', aba: 'vitrine', moeda: 'orb', ordem: 'recentes', pagina: 1,
    porPagina: 24, total: 132, temMais: true, linhas: [row] };
  probe.socket('recebida', page);
  now += 200;
  probe.raw('enviada', '{"t":"market.editar","id":"9812244","preco":12}');
  probe.socket('recebida', { ...page, ordem: 'baratos', linhas: [{ ...row, preco: 12, atualizadoEm: 1700000002000 }] });
  probe.socket('recebida', { t: 'batalha', ev: [{ k: 'marketEditado', id: row.id, pokemonId: row.pokemonId, preco: 12 }] });
  probe.controls('ver ficha', ['Adicionados recentemente', 'Última alteração', 'nome de jogador']);
  probe.network('fetch', '/api/market/anuncio/9812244?token=private-token&listingId=9812244', 'https://pokeidle.io', 200);
  probe.network('eventsource', '/api/events/private-token', 'https://pokeidle.io');
  probe.network('fetch', 'https://example.org/market/listing', 'https://pokeidle.io');

  const report = probe.finish();
  const [request, first, edit, after, push, click, xhr, sse] = report.eventos;
  assert.equal(report.eventos.length, 8);
  assert.deepEqual(report.ordens_no_menu, ['adicionados recentemente', 'última alteração']);
  assert.deepEqual(request.filtros, { especieId: 212, notaMin: 3.55, ivMin: 110, precoMax: 30,
    soShiny: true, busca_preenchida: true });
  assert.deepEqual(first.paginação, { porPagina: 24, total: 132, temMais: true, linhas: 1 });
  assert.equal(first.retornados.primeiro, edit.anúncio);
  assert.equal(after.retornados.primeiro, edit.anúncio);
  assert.equal(push.sentido, 'evento');
  assert.equal(click.ação, 'ver ficha');
  assert.equal(xhr.rota, '/api/market/anuncio/:id');
  assert.equal(xhr.anúncio, edit.anúncio);
  assert.equal(sse.rota, '/api/events/*');
  assert.equal(report.diferenças_observadas.length, 1);
  const [change] = report.diferenças_observadas;
  assert.equal(change.antes.exemplar, change.depois.exemplar);
  assert.equal(change.antes.anúncio, change.depois.anúncio);
  assert.deepEqual([change.antes.preço, change.depois.preço], [18, 12]);
  assert.doesNotMatch(JSON.stringify(report), /9812244|671322|private-token|nome de jogador|example\.org/);
});

test('encerra a captura sozinho e separa relistagem de edição pelo alias do anúncio', () => {
  let now = 3000;
  const probe = create(() => now);
  probe.start();
  const row = { id: '131', pokemonId: '204', preco: 32 };
  probe.socket('recebida', { t: 'market', aba: 'vitrine', moeda: 'orb', linhas: [row] });
  probe.socket('recebida', { t: 'market', aba: 'vitrine', moeda: 'orb', linhas: [{ ...row, id: '132', preco: 28 }] });
  now += LIMIT_MS;
  assert.equal(probe.active(), false);
  probe.raw('enviada', '{"t":"market.listar","moeda":"orb"}');
  const result = probe.finish();
  const [change] = result.diferenças_observadas;
  assert.notEqual(change.antes.anúncio, change.depois.anúncio);
  assert.equal(change.antes.exemplar, change.depois.exemplar);
  assert.equal(result.eventos.length, 2);
  assert.equal(result.duração_ms, LIMIT_MS);
});
