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
  const window = { WebSocket: Socket };
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
