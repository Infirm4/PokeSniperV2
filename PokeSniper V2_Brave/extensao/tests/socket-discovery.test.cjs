const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { runInNewContext } = require('node:vm');
const test = require('node:test');

test('descobre conexão preexistente pelo envio do jogo e libera uma substituta ao fechar', async () => {
  class Socket extends EventTarget {
    constructor(url) { super(); this.url = url; this.readyState = 1; }
    send() {}
  }
  const existing = new Socket('wss://pokeidle.io/');
  const source = readFileSync(join(__dirname, '../sniper.js'), 'utf8');
  const readBetween = (from, until) => source.slice(source.indexOf(from), source.indexOf(until));
  const pieces = [
    readBetween('  const observedGameSockets', '  function publishMarketPage'),
    readBetween('  function attach(ws)', '  // Um único limitador'),
  ];
  const st = { gold: 9999, off: 10 };
  const waiters = [];
  const updates = [];
  const window = { WebSocket: Socket, addEventListener() {} };
  const result = runInNewContext(pieces.join('\n') + '\n({ source: () => gameSocketSource, ready: socketReadyForMarket, bind: bindGameSocket })', {
    st, waiters, window, OWS: Socket, osend: Socket.prototype.send, URL, clearTimeout,
    monitorAtivo: () => true, reportAutomatic: value => updates.push(value), onMsg() {},
    dbg() {}, aprenderConsultaPokemon() {},
  });
  new window.WebSocket('wss://not-pokeidle.io/').send('{"t":"ping"}');
  assert.equal(st.sock, undefined);
  existing.send('{"t":"ping"}');
  assert.equal(st.sock, existing);
  assert.equal(result.source(), 'envio do jogo');
  assert.equal(result.ready(), false);
  assert.equal(st.gold, null);
  const market = new window.WebSocket('wss://pokeidle.io/');
  assert.equal(st.sock, existing);
  result.bind(market, 'tráfego');
  assert.equal(st.sock, market);
  assert.equal(result.ready(), true);
  const pending = new Promise((resolve, reject) => waiters.push({ ws: market, reject }));
  market.readyState = 3;
  market.dispatchEvent(new Event('close'));
  await assert.rejects(pending, /fechada/);
  assert.equal(st.sock, null);
  assert.deepEqual(updates, ['aguardando_socket']);
  const replacement = new window.WebSocket('wss://pokeidle.io/');
  assert.equal(st.sock, replacement);
  assert.equal(result.source(), 'abertura');
  assert.equal(result.ready(), false);
});

test('só a resposta de uma consulta própria é ocultada da vitrine', () => {
  const source = readFileSync(join(__dirname, '../sniper.js'), 'utf8');
  const code = source.slice(source.indexOf('  const recentQueries'), source.indexOf('  function publishMarketPage'));
  const seen = [];
  const api = runInNewContext(code + '\n({ recentQueries, recentEchoVerified, receiveGameMessage })', {
    PISMarketCore: require('../market-core'), onMsg: (_socket, event) => seen.push(event),
  });
  const ws = {};
  const request = { moeda: 'orb', pagina: 0, ordem: 'recentes', seq: 8000001 };
  api.recentQueries.set(ws, new Map([[String(request.seq), request]]));
  const send = seq => {
    let stopped = false;
    const data = JSON.stringify({ t: 'market', aba: 'vitrine', linhas: [], moeda: 'orb', pagina: 0, seq });
    api.receiveGameMessage(ws, { data, stopImmediatePropagation() { stopped = true; } });
    return stopped;
  };
  assert.equal(send(2), false);
  assert.equal(api.recentEchoVerified.has(ws), false);
  assert.equal(send(request.seq), true);
  assert.equal(api.recentEchoVerified.has(ws), true);
  assert.equal(seen.length, 2);
});

test('a leitura de Mais baratos monitora reduções sem ser tratada como consulta de anúncios novos', () => {
  const source = readFileSync(join(__dirname, '../sniper.js'), 'utf8');
  const code = source.slice(source.indexOf('  function publishMarketPage'), source.indexOf('  let lastMonitorState'));
  const reports = [];
  const context = { watchOpportunities: true, watchMinGrade: 3.55, vitrineAberta: () => false, location: { origin: 'https://pokeidle.io' },
    watchesCurrency: currency => currency === 'orb',
    PISMarketCore: { captureAutomatic: () => ({ rows: [{ price: 7 }] }) },
    window: { postMessage: message => reports.push(message) } };
  const publish = runInNewContext(code + '\n publishMarketPage', context);
  const page = { aba: 'vitrine', linhas: [{}] };
  const request = { moeda: 'orb', pagina: 3, ordem: 'baratos', preparation: true, olderScan: true, notaMin: '3.55' };
  publish({}, page, request, false);
  assert.equal(reports[0].live, false);
  assert.equal(reports[0].priceWatch, true);
  assert.equal(reports[0].olderScan, true);
  publish({}, page, { ...request, moeda: 'gold' }, false);
  assert.equal(reports[1].priceWatch, false);
  context.watchOpportunities = false;
  publish({}, page, request, false);
  assert.equal(reports[2].priceWatch, false);
  assert.equal(reports[2].olderScan, false);
});

test('envia Nota mínima apenas nas consultas de anúncios antigos', async () => {
  const source = readFileSync(join(__dirname, '../sniper.js'), 'utf8');
  const code = source.slice(source.indexOf('  function pedidoPaginaRastreador'), source.indexOf('  function numeroInteiroNaoNegativo'));
  const calls = [];
  const query = runInNewContext(code + '\nconsultarPaginaRastreador', {
    st: { marketPausaAte: 0, seq: 0 }, watchMinGrade: 3.55, watchOpportunities: true,
    monitorAtivo: () => true, vitrineAberta: () => false, watchesCurrency: currency => currency === 'orb',
    pokeTemplate: () => ({ req: { t: 'market.listar', notaMin: '9', precoMax: '1' } }),
    naFilaItem: fn => fn(), ask: (request, _pred, _timeout, allowed, metadata) => {
      assert.equal(allowed(), true);
      calls.push([request.notaMin, request.precoMax, metadata.olderScan]);
    },
  });
  await query(0, 'orb', 'recentes', true);
  await query(0, 'orb', 'baratos', false, true);
  assert.deepEqual(calls, [['', '', undefined], ['3.55', '', true]]);
});

test('prioriza as duas primeiras páginas por moeda e evita duas consultas secundárias seguidas', async () => {
  const source = readFileSync(join(__dirname, '../sniper.js'), 'utf8');
  const code = source.slice(source.indexOf('  // A preparação de selos'),
    source.indexOf('  if (LEGACY_PANEL_ENABLED) (async function coletaContinua'));
  for (const watchCurrency of ['orb', 'gold', 'all']) {
    const first = 60000;
    let now = first, tick;
    const reads = [];
    const st = { marketPausaAte: 0, marketUltimoEnvio: 0 };
    runInNewContext(code, {
      Date: { now: () => now }, st, watchCurrency, watchOpportunities: true, watchMinGrade: 3.55,
      setInterval(fn) { tick = fn; },
      marketModules: () => ({ parser: true }), intervaloMinMercadoAtualMs: () => 2000,
      monitorAtivo: () => true, socketReadyForMarket: () => true, vitrineAberta: () => false,
      MAX_PAGINAS_RASTREADOR: 500, reportAutomatic() {}, dbg() {},
      numeroInteiroNaoNegativo: value => Number.isSafeInteger(value) ? value : null,
      async consultarPaginaRastreador(page, currency, order) {
        reads.push({ page, currency, order, now });
        st.marketUltimoEnvio = now;
        return { linhas: [{}], porPagina: 1, total: 50 };
      },
    });
    for (; now <= first + 75000; now += 2000) await tick();

    const currencies = watchCurrency === 'all' ? ['gold', 'orb'] : [watchCurrency];
    const priority = [0, 1].flatMap(page => currencies.map(currency => [currency, page, 'recentes']));
    const secondary = read => read.order === 'baratos' || read.page === 2;
    assert.deepEqual(reads.slice(0, priority.length).map(r => [r.currency, r.page, r.order]), priority);
    assert.equal(reads[priority.length].order, 'baratos');
    assert.ok(reads.every(r => currencies.includes(r.currency)));
    for (const currency of currencies) {
      const third = reads.find(r => r.currency === currency && r.page === 2 && r.order === 'recentes');
      const second = reads.find(r => r.currency === currency && r.page === 1 && r.order === 'recentes');
      assert.ok(third.now - second.now >= 30000);
      assert.ok(reads.filter(r => r.currency === currency && r.order === 'recentes' && r.page === 1).length > 4);
    }
    assert.equal(reads.some((read, index) => index > 0 && secondary(read) && secondary(reads[index - 1])), false);
  }
});
