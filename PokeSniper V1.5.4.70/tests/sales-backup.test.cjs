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
    getRangeList(addresses) {
      return { clearContent() {
        for (const address of addresses) {
          const [row, col, height, width] = address.split(',').map(Number);
          for (let y = 0; y < height; y++)
            for (let x = 0; x < width; x++) data[row + y - 1][col + x - 1] = '';
        }
      } };
    },
    getRange(row, col, height = 1, width = 1) {
      const matrix = produce => Array.from({ length: height }, (_, y) =>
        Array.from({ length: width }, (_, x) => produce(row + y, col + x)));
      return { getValues: () => matrix(readCell), getDisplayValues: () => matrix(readCell),
        getFormulas: () => matrix(() => ''), getNumberFormats: () => matrix(() => 'General'),
        setNumberFormats() {},
        getValue: () => readCell(row, col),
        getA1Notation: () => [row, col, height, width].join(','),
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
  let held = false;
  const lock = {
    waitLock() { assert.equal(held, false); held = true; },
    releaseLock() { assert.equal(held, true); held = false; },
  };
  const secret = 'test-access-key-00000000000000000000';
  const { doPost, diagnosticarLinhasForaDoBanco, limparLinhasForaDoBanco } =
    runInNewContext(read('google-apps-script.gs') +
      '\n({ doPost, diagnosticarLinhasForaDoBanco, limparLinhasForaDoBanco })', {
    SpreadsheetApp: { openById: () => ({ getSheetByName: () => sheet }), flush() {} },
    PropertiesService: { getScriptProperties: () => ({ getProperty: key => key === 'POKEIDLE_CHAVE_LEITURA_VENDAS' ? secret : 'test-sheet' }) },
    LockService: { getScriptLock: () => lock },
    ContentService: { MimeType: { JSON: 'JSON' }, createTextOutput: contents => ({ setMimeType: () => JSON.parse(contents) }) },
    console: { log() {}, warn() {}, error() {} },
  });
  const send = (...vendas) => doPost({ postData: { contents: JSON.stringify({
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
  const key = col('Chave da venda');
  data[5] = [];
  data[5][col('Pokemon')] = 'Registro legado';
  data[5][0] = 'Anotação alheia';
  data[6] = [];
  data[6][col('Pokemon')] = 'Venda a conferir';
  data[6][key] = 'gold:04';
  const preview = diagnosticarLinhasForaDoBanco();
  assert.equal(preview.linhas_fora_do_db, 1);
  assert.equal(preview.linhas_incertas_preservadas, 1);
  assert.equal(data[5][col('Pokemon')], 'Registro legado');
  assert.equal(limparLinhasForaDoBanco().aplicou, true);
  assert.equal(data[5][0], 'Anotação alheia');
  assert.equal(data[5][col('Pokemon')], '');
  assert.equal(data[6][col('Pokemon')], 'Venda a conferir');
  assert.equal(data[3][col('IV SPED')], 0);
  assert.equal(limparLinhasForaDoBanco().aplicou, false);
  const readSales = (chave, linha) => doPost({ postData: { contents: JSON.stringify({
    tipo: 'pis_sales_pull_v1', chave, linha,
  }) } });
  assert.equal(readSales('outra-chave', 4).ok, false);
  assert.equal(readSales('outra-chave', 4).vendas, undefined);
  const first = readSales(secret, 4);
  assert.equal(first.vendas.length, 2);
  assert.deepEqual(first.vendas.map(row => row.currency), ['gold', 'orb']);
  assert.equal(first.tem_mais, false);
  assert.equal(first.ignoradas, 1);
  assert.equal(readSales(secret, first.proxima_linha).vendas.length, 0);
  assert.equal(readSales(secret, 999).reiniciar, true);
  while (data.length < 104) data.push([]);
  data.push([...data[3]]);
  const paged = readSales(secret, 4);
  assert.equal(paged.proxima_linha, 104);
  assert.equal(paged.tem_mais, true);
  assert.equal(readSales(secret, paged.proxima_linha).vendas[0].id, gold.id);
});

test('reabrir o jogo sincroniza a fila e só dá baixa após confirmação', async () => {
  let listener, alarmSchedule, acknowledged = 0, confirm = false;
  const fullSale = { ...sale, level: 810, grade: 3.576, power: 1, quality: 1.554, ivTotal: 146,
    ivs: { hp: 29, attack: 32, defense: 30, specialAttack: 31, specialDefense: 24, speed: 0 } };
  const queue = [{ row: fullSale }];
  const storage = {};
  const worker = runInNewContext(read('sales-backup-worker.js'), {
    PISSalesBackup: backup, PISMarketCore: core, SHEETS_URL: 'https://example.invalid/exec', PIS_HOST: /^https:\/\/pokeidle\.io\//,
    crypto: webcrypto, AbortSignal, console,
    PISMarketStore: {
      pendingSalesBackup: async () => queue,
      pendingSalesBackupCount: async () => queue.length,
      acknowledgeSalesBackup: async entries => {
        for (const entry of entries) {
          queue.splice(queue.indexOf(entry), 1);
          acknowledged++;
        }
      },
    },
    chrome: {
      alarms: { get: async () => null, create: async (_, options) => { alarmSchedule = options; }, onAlarm: { addListener() {} } },
      storage: { local: { get: async () => ({ ...storage }), set: async value => Object.assign(storage, value) } },
      runtime: { id: 'own', getURL: page => page, onInstalled: { addListener() {} }, onStartup: { addListener() {} },
        onMessage: { addListener(fn) { listener = fn; } } },
    },
    fetch: async (_, request) => {
      const { lote, tipo, vendas } = JSON.parse(request.body);
      assert.equal(vendas.length, 1);
      assert.equal(vendas[0].quality, 1.554);
      assert.deepEqual(core.incompleteSaleFields(vendas[0]), []);
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
  const openPanel = () => new Promise(resolve =>
    listener({ type: 'PIS_START_SALES_BACKUP' }, { url: 'opportunities.html' }, resolve));
  assert.equal((await openPanel()).pending, 0);
  assert.equal(acknowledged, 1);
  queue.push({ row: fullSale });
  await openPanel();
  assert.equal(acknowledged, 1);
  const request = { type: 'PIS_GAME_OPEN_SALES_BACKUP' };
  const game = { id: 'own', url: 'https://pokeidle.io/', frameId: 0, tab: { id: 1 } };
  assert.equal(listener(request, { ...game, url: 'https://other.invalid/' }, () => {}), false);
  assert.equal(listener(request, { ...game, frameId: 1 }, () => {}), false);
  const reopened = await new Promise(resolve => listener(request, game, resolve));
  assert.equal(reopened.reason, 'abertura_do_pokeidle');
  assert.equal(reopened.saved, 1);
  assert.equal(reopened.pending, 0);
  assert.equal(acknowledged, 2);
  queue.push({ row: fullSale });
  queue.unshift({ row: { ...fullSale, id: 'partial', quality: null } });
  const afterStale = await sync();
  assert.equal(afterStale.saved, 1);
  assert.equal(afterStale.skipped, 1);
  assert.equal(afterStale.pending, 0);
});

test('sincroniza vendas de outro PC, avança a página após gravar e preserva envio independente', async () => {
  const storage = {}, contexts = [];
  let listener, rejectLocalSave = true, calls = 0;
  const accessKey = 'private-key-000000000000000000000000';
  const access = { id: 'own', url: 'opportunities.html' };
  const row = { ...sale, currency: 'orb', price: 25 };
  const existing = new Set();
  runInNewContext(read('sales-backup-worker.js'), {
    PISSalesBackup: backup, PISMarketCore: core, SHEETS_URL: 'https://example.invalid/exec',
    crypto: webcrypto, AbortSignal, console,
    PISMarketStore: {
      pendingSalesBackup: async () => [], pendingSalesBackupCount: async () => 0,
      async ingest(kind, rows, _now, options) {
        assert.equal(kind, 'sale');
        assert.equal(options.fromSheet, true);
        if (rejectLocalSave) throw new Error('Falha local simulada');
        const unique = rows.filter(entry => !existing.has(entry.id));
        unique.forEach(entry => existing.add(entry.id));
        return { new: unique.length, incomplete: 0 };
      },
    },
    chrome: {
      alarms: { get: async () => ({ periodInMinutes: 60 }), create: async (...args) => contexts.push(args), onAlarm: { addListener() {} } },
      storage: { local: { get: async () => structuredClone(storage), set: async value => Object.assign(storage, structuredClone(value)) } },
      runtime: { id: 'own', getURL: page => page, onInstalled: { addListener() {} }, onStartup: { addListener() {} },
        onMessage: { addListener(fn) { listener = fn; } } },
    },
    fetch: async (_, request) => {
      const { tipo, chave, linha } = JSON.parse(request.body);
      assert.equal(chave, accessKey);
      assert.equal(tipo, 'pis_sales_pull_v1');
      calls++;
      const tem_mais = linha === 4;
      const vendas = tem_mais ? [row] : [];
      return { ok: true, json: async () => ({ ok: true, tipo, linha, proxima_linha: tem_mais ? 5 : linha,
        tem_mais, vendas, ignoradas: 0 }) };
    },
  });
  const action = message => new Promise(resolve => listener(message, access, resolve));
  assert.equal(listener({ type: 'PIS_SET_SALES_SHEET_ACCESS', key: accessKey }, { ...access, id: 'other' }, () => {}), false);
  const broken = await action({ type: 'PIS_SET_SALES_SHEET_ACCESS', key: accessKey });
  assert.match(broken.pull.error, /Falha local/);
  assert.equal(broken.saved, 0);
  assert.equal(storage.pisSalesSheetCursor, null);
  rejectLocalSave = false;
  const first = await action({ type: 'PIS_SYNC_SALES_BACKUP' });
  assert.equal(first.pull.imported, 1);
  assert.equal(first.pull.more, false);
  assert.equal(calls, 3);
  assert.equal(contexts.length, 0);
  assert.equal(storage.pisSalesSheetCursor.row, 5);
  const next = await action({ type: 'PIS_SYNC_SALES_BACKUP' });
  assert.equal(next.pull.imported, 0);
  assert.equal(calls, 4);
  assert.equal(JSON.stringify(next).includes(accessKey), false);
  await action({ type: 'PIS_SET_SALES_SHEET_ACCESS', key: '' });
  assert.equal((await action({ type: 'PIS_SYNC_SALES_BACKUP' })).pull.enabled, false);
  assert.equal(calls, 4);
});
