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
  const bound = runInNewContext(pieces.join('\n') + '\n() => gameSocketSource', {
    st, waiters, window, OWS: Socket, osend: Socket.prototype.send, URL, clearTimeout,
    monitorAtivo: () => true, reportAutomatic: value => updates.push(value), onMsg() {},
    dbg() {}, aprenderConsultaPokemon() {},
  });
  new window.WebSocket('wss://not-pokeidle.io/').send('{"t":"ping"}');
  assert.equal(st.sock, undefined);
  existing.send('{"t":"ping"}');
  assert.equal(st.sock, existing);
  assert.equal(bound(), 'envio do jogo');
  assert.equal(st.gold, null);
  const pending = new Promise((resolve, reject) => waiters.push({ ws: existing, reject }));
  existing.readyState = 3;
  existing.dispatchEvent(new Event('close'));
  await assert.rejects(pending, /fechada/);
  assert.equal(st.sock, null);
  assert.deepEqual(updates, ['aguardando_socket']);
  const replacement = new window.WebSocket('wss://pokeidle.io/');
  assert.equal(st.sock, replacement);
  assert.equal(bound(), 'abertura');
});
