const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { createContext, runInContext, runInNewContext } = require('node:vm');
const pricingContext = createContext({ URL });
for (const file of ['vendor/briaoale/especies.js', 'vendor/briaoale/market-bonuses.js', 'vendor/briaoale/pve-pricing.js',
  'market-core.js', 'opportunities.js']) {
  runInContext(readFileSync(join(__dirname, '..', file), 'utf8'), pricingContext);
}
const { PISOpportunities: rules, PISMarketCore } = pricingContext;

const worker = readFileSync(join(__dirname, '../opportunities-worker.js'), 'utf8');

test('a fila respeita o opt-in, limita a rajada e registra os resultados da entrega', async () => {
  let notify = false;
  const rows = Array.from({ length: 6 }, (_, index) => ({
    key: String(index), queuedAt: index + 1, currency: 'gold', speciesId: '25', price: 70,
    estimate: { discount: 0.3 }, delivery: 'pending', nextAttemptAt: 0,
  }));
  Object.assign(rows[0], { name: 'Scizor', currency: 'orb', speciesId: '212', price: 6,
    estimate: { discount: 1 - 6 / 14, median: 14 } });
  Object.assign(rows[5], { alertSource: 'older', queuedAt: 0 });
  const attempts = [], results = [], gameAttempts = [], desktopTitles = [];
  const event = { addListener() {} };
  const chrome = {
    storage: { local: { get: async () => ({ opportunitySettings: { notify } }) }, onChanged: event },
    alarms: { get: async () => true, onAlarm: event },
    notifications: { onClicked: event, async create(id, { title }) {
      attempts.push(id);
      desktopTitles.push(title);
      if (id === 'pis:1') throw new Error('falha simulada');
    } },
    runtime: { getURL: file => file },
  };
  const PISMarketStore = {
    recentOpportunities: async () => rows.slice().reverse(), currentOpportunity: async key => rows.find(row => row.key === key),
    markDelivery: async (key, delivered, time, channels, offer) => {
      assert.equal(offer, rows.find(row => row.key === key));
      assert.ok(Number.isFinite(time));
      results.push([key, delivered, channels.desktop, channels.game]);
    },
  };
  const PISGameTab = { show: async title => {
    gameAttempts.push(title);
    return gameAttempts.length === 2;
  } };
  const alerts = runInNewContext(worker + '\nPISOpportunityAlerts;', {
    chrome, PISMarketStore, PISGameTab, PISMarketCore, PISOpportunities: rules, console: { warn() {} },
  });
  await alerts.wake();
  assert.deepEqual(attempts, []);
  notify = true;
  await Promise.all([alerts.wake(), alerts.wake()]);
  assert.deepEqual(attempts, ['pis:0', 'pis:1', 'pis:2', 'pis:3', 'pis:4']);
  assert.equal(gameAttempts.length, 5);
  assert.equal(desktopTitles[0], 'Scizor · −57,1% · Rev 💎 8');
  assert.equal(gameAttempts[0], desktopTitles[0]);
  assert.deepEqual(results, [['0', true, true, false], ['1', true, false, true],
    ['2', true, true, false], ['3', true, true, false], ['4', true, true, false]]);
});

test('tenta a sprite verificada nos dois canais e recupera o ícone fixo se o Chrome recusar a imagem', async () => {
  const sprite = 'https://pokeidle.io/assets/gengar.png';
  const row = { key: 'sale', name: 'Gengar', currency: 'gold', price: 78_500_000, sprite, level: 100, power: 4, grade: 4.123,
    ivs: { speed: 0, attack: 24, specialAttack: 32, hp: 5, defense: 1, specialDefense: 2 },
    estimate: { discount: 0.215, median: 100_000_000, lower: 90_000_000, upper: 120_000_000 }, delivery: 'pending', nextAttemptAt: 0 };
  const event = { addListener() {} };
  const notices = [];
  const chrome = {
    storage: { local: { get: async () => ({ opportunitySettings: { notify: true } }) }, onChanged: event },
    alarms: { get: async () => true, onAlarm: event },
    notifications: { onClicked: event, async create(_id, options) {
      notices.push(options);
      if (options.iconUrl.startsWith('data:')) throw new Error('simulado');
    } },
    runtime: { getURL: file => file },
  };
  let game;
  const alerts = runInNewContext(worker + '\nPISOpportunityAlerts;', {
    chrome, PISMarketCore, PISOpportunities: rules, console: { warn() {} }, AbortSignal, btoa, setTimeout, clearTimeout,
    fetch: async url => {
      assert.equal(url, sprite);
      return new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'content-type': 'image/png' } });
    },
    PISGameTab: { async show(...args) { game = args; return true; } },
    PISMarketStore: { recentOpportunities: async () => [row], currentOpportunity: async () => row,
      noticeLiquidity: async () => ({ label: 'média', hours: 50 }),
      markDelivery: async () => {} },
  });
  await alerts.wake();
  assert.match(notices[0].iconUrl, /^data:image\/png;base64,/);
  assert.equal(notices[1].iconUrl, 'opportunity-placeholder.png');
  assert.equal(game[3], sprite);
  assert.equal(notices[0].title, 'Gengar · −21,5%');
  assert.equal(notices[0].message, 'Nvl 100 · P4 · N 4,12\nMercado 💰 78,5 MI · Preço justo 💰 100 MI\n0 Spe (crítico) · 32 Sp Atk (Pica)\nLiquidez média');
  assert.equal(game[0], notices[0].title);
  assert.equal(game[1], notices[0].message.replace('N 4,12', 'Nota 4,12'));
});

test('revalida a oferta seguinte e processa novas chegadas durante o envio', async () => {
  const row = key => ({ id: key, key, price: 75, estimate: { discount: .25 }, delivery: 'pending', nextAttemptAt: 0 });
  let rows = [row('first'), row('closed')];
  const attempts = [];
  const event = { addListener() {} };
  const chrome = {
    storage: { local: { get: async () => ({ opportunitySettings: { notify: true } }) }, onChanged: event },
    alarms: { get: async () => true, onAlarm: event },
    notifications: { onClicked: event, async create(id) {
      attempts.push(id);
      if (id === 'pis:first') {
        rows = [row('new')];
        alerts.wake();
      }
    } },
    runtime: { getURL: file => file },
  };
  const alerts = runInNewContext(worker + '\nPISOpportunityAlerts;', {
    chrome, PISMarketCore, PISOpportunities: rules, console, PISGameTab: { show: async () => false },
    PISMarketStore: { recentOpportunities: async () => rows,
      currentOpportunity: async key => rows.find(row => row.key === key), markDelivery: async () => {} },
  });
  await alerts.wake();
  assert.deepEqual(attempts, ['pis:first', 'pis:new']);
});
