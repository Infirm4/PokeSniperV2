const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { runInNewContext } = require('node:vm');
const test = require('node:test');
const core = require('../market-core.js');
const backup = require('../sales-backup.js');

const read = name => readFileSync(join(__dirname, '..', name), 'utf8');
const sale = { id: '00042', speciesId: '94', pokemonId: '00090', currency: 'gold', source: 'game',
  price: 123456789, soldAt: Date.now() - 1000, name: 'Gengar, Shiny', shiny: 1,
  ivs: { speed: 0 }, sprite: 'https://pokeidle.io/sprites/gengar.png' };
const csvCell = value => '"' + String(value).replaceAll('"', '""') + '"';

test('backup restaura CSV com preço inteiro, IV zero, identidade textual e moeda', () => {
  const [gold, gem] = backup.normalize([sale, { ...sale, currency: 'orb', price: 123 }], core);
  const csv = '\uFEFFRelatório,2026\r\n\r\nData,' + backup.COLUMN + '\r\n' +
    '2026-11-19,' + csvCell(JSON.stringify(gold)) + '\r\n' +
    '2026-11-19,' + csvCell(JSON.stringify(gem));
  assert.deepEqual(backup.restore(csv, core), [gold, gem]);
  assert.throws(() => backup.restore(backup.COLUMN + '\n' + csvCell('{"source":"game"}'), core), /inválida/);
});

test('Apps Script reconcilia reenvio sem duplicar, mantém vendas homônimas em moedas distintas e permite enriquecimento', () => {
  const headers = ['', 'Data', 'Sprite', 'Pokemon', 'Nível', 'Preço (Mi)', 'Potência', 'Nota',
    'IV ATQ', 'IV SPED', 'IV SP.ATQ', 'IV SP.DEF', 'IV DEF', 'IV HP', 'Qualidade', 'IV Total',
    'Shiny', 'Status de Compra'];
  const data = [['Título preservado'], [], [...headers]];
  const hidden = [];
  const readCell = (row, col) => data[row - 1]?.[col - 1] ?? '';
  const sheet = {
    getMaxColumns: () => 50, getMaxRows: () => 50, getLastRow: () => data.length,
    getLastColumn: () => Math.max(...data.map(row => row.length)), getName: () => 'Sheet',
    hideColumns: (start, count) => hidden.push([start, count]),
    getRange(row, col, height = 1, width = 1) {
      const matrix = produce => Array.from({ length: height }, (_, y) =>
        Array.from({ length: width }, (_, x) => produce(row + y, col + x)));
      return { getValues: () => matrix(readCell), getDisplayValues: () => matrix(readCell),
        getFormulas: () => matrix(() => ''), getNumberFormats: () => matrix(() => 'General'),
        setNumberFormats() {},
        getValue: () => readCell(row, col),
        setValues(values) {
          values.forEach((line, y) => {
            const target = data[row + y - 1] ??= [];
            line.forEach((value, x) => { target[col + x - 1] = value; });
          });
          return this;
        },
        setFontWeight() {}, setNumberFormat() {},
      };
    },
  };
  const lock = { waitLock() {}, releaseLock() {} };
  const post = runInNewContext(read('google-apps-script.gs') + '\ndoPost', {
    SpreadsheetApp: { openById: () => ({ getSheetByName: () => sheet }), flush() {} },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'test-sheet' }) },
    LockService: { getScriptLock: () => lock },
    ContentService: { MimeType: { JSON: 'JSON' }, createTextOutput: contents => ({ setMimeType: () => JSON.parse(contents) }) },
    console: { log() {}, warn() {}, error() {} },
  });
  const send = (...vendas) => post({ postData: { contents: JSON.stringify({
    tipo: backup.FORMAT, lote: webcrypto.randomUUID(), vendas,
  }) } });
  const [gold, gem] = backup.normalize([sale, { ...sale, currency: 'orb', price: 123 }], core);
  assert.equal(send(gold, gem).vendas_confirmadas, 2);
  assert.equal(send(gold, gem).novas, 0);
  assert.equal(send({ ...gold, ivs: { ...gold.ivs, hp: 31 } }).atualizadas, 1);
  assert.equal(send(gold).atualizadas, 0);
  assert.equal(send(gold, gold).ok, false);
  assert.equal(data.length, 5);
  assert.deepEqual(data[0], ['Título preservado']);
  assert.deepEqual(data[2].slice(0, 18), headers);
  assert.deepEqual(hidden, [[19, data[2].length - 18]]);
  const col = title => data[2].indexOf(title);
  assert.equal(data[3][col('#ID')], '00042');
  assert.equal(data[3][col('Preço (Mi)')], 123.456789);
  assert.equal(data[3][col('IV SPED')], 0);
  assert.equal(data[4][col('Preço (Mi)')], '123 Gemas');
  assert.equal(data[4][col('Preço exato')], 123);
  const restored = JSON.parse(data[3][col(backup.COLUMN)]);
  assert.equal(restored.ivs.hp, 31);
  assert.equal(restored.ivs.speed, 0);
});

test('o alarme é horário e só dá baixa com confirmação do lote enviado', async () => {
  let listener, alarmSchedule, acknowledged = 0, confirm = false;
  const queue = [{ row: sale }];
  const storage = {};
  const worker = runInNewContext(read('sales-backup-worker.js'), {
    PISSalesBackup: backup, PISMarketCore: core, SHEETS_URL: 'https://example.invalid/exec',
    crypto: webcrypto, AbortSignal, console,
    PISMarketStore: {
      pendingSalesBackup: async () => queue,
      pendingSalesBackupCount: async () => queue.length,
      acknowledgeSalesBackup: async () => { queue.pop(); acknowledged++; },
    },
    chrome: {
      alarms: { get: async () => null, create: async (_, options) => { alarmSchedule = options; }, onAlarm: { addListener() {} } },
      storage: { local: { get: async () => ({ ...storage }), set: async value => Object.assign(storage, value) } },
      runtime: { getURL: page => page, onInstalled: { addListener() {} }, onStartup: { addListener() {} },
        onMessage: { addListener(fn) { listener = fn; } } },
    },
    fetch: async (_, request) => {
      const { lote, tipo } = JSON.parse(request.body);
      return { ok: true, json: async () => ({ ok: true, lote: confirm ? lote : 'outro', tipo, vendas_confirmadas: 1 }) };
    },
  });
  assert.equal(worker, undefined);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(alarmSchedule.periodInMinutes, 60);
  const sync = () => new Promise(resolve => listener({ type: 'PIS_SYNC_SALES_BACKUP' }, { url: 'opportunities.html' }, resolve));
  const failed = await sync();
  assert.match(failed.error, /não confirmou/);
  assert.equal(acknowledged, 0);
  confirm = true;
  assert.equal((await sync()).pending, 0);
  assert.equal(acknowledged, 1);
  queue.push({ row: sale });
  const openPanel = () => new Promise(resolve =>
    listener({ type: 'PIS_START_SALES_BACKUP' }, { url: 'opportunities.html' }, resolve));
  assert.equal((await openPanel()).pending, 0);
  assert.equal(acknowledged, 2);
  queue.push({ row: sale });
  await openPanel();
  assert.equal(acknowledged, 2);
});
