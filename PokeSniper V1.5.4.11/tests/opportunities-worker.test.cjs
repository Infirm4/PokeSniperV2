const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { runInNewContext } = require('node:vm');
const rules = require('../opportunities.js');

const worker = readFileSync(join(__dirname, '../opportunities-worker.js'), 'utf8');

test('a fila respeita o opt-in, limita a rajada e registra os resultados da entrega', async () => {
  let notify = false;
  const rows = Array.from({ length: 6 }, (_, index) => ({
    key: String(index), currency: 'gold', speciesId: '25', price: 70,
    estimate: { discount: 0.3 }, delivery: 'pending', nextAttemptAt: 0,
  }));
  const attempts = [], results = [];
  const event = { addListener() {} };
  const chrome = {
    storage: { local: { get: async () => ({ opportunitySettings: { notify } }) }, onChanged: event },
    alarms: { get: async () => true, onAlarm: event },
    notifications: { onClicked: event, async create(id) {
      attempts.push(id);
      if (id === 'pis:1') throw new Error('falha simulada');
    } },
    runtime: { getURL: file => file },
  };
  const PISMarketStore = {
    recentOpportunities: async () => rows,
    markDelivery: async (key, delivered) => { results.push([key, delivered]); },
  };
  const alerts = runInNewContext(worker + '\nPISOpportunityAlerts;', {
    chrome, PISMarketStore, PISOpportunities: rules, console: { warn() {} },
  });
  await alerts.wake();
  assert.deepEqual(attempts, []);
  notify = true;
  await Promise.all([alerts.wake(), alerts.wake()]);
  assert.deepEqual(attempts, ['pis:0', 'pis:1', 'pis:2', 'pis:3', 'pis:4']);
  assert.deepEqual(results, [['0', true], ['1', false], ['2', true], ['3', true], ['4', true]]);
});
