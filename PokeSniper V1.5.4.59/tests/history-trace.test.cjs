const assert = require('node:assert/strict');
const test = require('node:test');
const core = require('../market-core.js');
const history = require('../history-trace.js');

test('preserva página fora da primeira chave, ficha reconhecida e resultado de gravação', () => {
  const frame = { pagina: 3, t: 'market', aba: 'historicoGlobal', linhas: [
    { tipo: 'pokemon', id: 'private-sale', ficha: { nome: 'private-name' }, idAnuncio: 'private-id' },
    { tipo: 'item', idAnuncio: 'private-other' },
  ] };
  assert.equal(core.historyReply.test(JSON.stringify(frame, null, 2)), true);
  assert.equal(core.historyRequest.test('{ "pagina": 3, "t": "market.historicoGlobal" }'), true);
  const result = history.clean('response', core.historyTrace(frame),
    { status: 'gravado', accepted: 1, new: 0, existing: 1, gainedFullIvs: 1 }, 10);
  assert.equal(result.pagina, 3);
  assert.equal(result.totalLinhas, 2);
  assert.equal(result.linhasPokemon, 1);
  assert.equal(result.comFicha, 1);
  assert.equal(result.camposCandidatosIdAnuncio.idAnuncio, 1);
  assert.equal(result.novas, 0);
  assert.equal(result.repetidas, 1);
  assert.equal(result.ganharamIvsCompletos, 1);
  assert.doesNotMatch(JSON.stringify(result), /private/);
});

test('identifica lote filtrado, fila cheia e requisição com página inválida', () => {
  for (const status of ['sem_registros_validos', 'fila_cheia', 'falha_na_gravação']) {
    assert.equal(history.clean('response', {}, { status }).lote, status);
  }
  const request = history.clean('request', { page: 'name', pokemon: true });
  assert.equal(request.pagina, null);
  assert.equal(request.filtroPokemon, true);
  assert.equal(history.clean('other', {}), null);
});
