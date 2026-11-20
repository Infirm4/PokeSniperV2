const assert = require('node:assert/strict');
const test = require('node:test');
const { settings, eligible, key, matches } = require('../opportunities.js');

const row = { id: '001', speciesId: '25', name: 'Pikachu', currency: 'gold',
  price: 70, estimate: { status: 'estimated', lower: 90, median: 100, discount: 0.3 } };

test('exige avaliação válida e aceita ofertas até o preço de referência', () => {
  assert.equal(eligible(row), true);
  assert.equal(eligible({ ...row, price: 95 }), true);
  assert.equal(eligible({ ...row, price: 101 }), false);
  assert.equal(eligible({ ...row, estimate: { status: 'insufficient_sales' } }), false);
});

test('deduplica pela identidade e pelo preço, independentemente da idade da observação', () => {
  assert.equal(key(row), key({ ...row, observedAt: 1000 }));
  assert.notEqual(key(row), key({ ...row, price: 65 }));
  assert.notEqual(key(row), key({ ...row, currency: 'orb' }));
});

test('aplica moeda e desconto, ignorando filtros antigos de espécie', () => {
  const legacy = { allow: 'Gengar', block: 'Pikachu,25' };
  const config = settings(legacy);
  assert.equal(matches(row, config), true);
  assert.equal(matches(row, { ...config, ...legacy }), true);
  assert.equal(Object.hasOwn(config, 'allow'), false);
  assert.equal(Object.hasOwn(config, 'block'), false);
  assert.equal(matches(row, settings({ maxPrice: 69 })), true);
  assert.equal(matches(row, settings({ discount: 31 })), false);
  assert.equal(matches(row, settings({ currency: 'orb' })), false);
  assert.equal(settings().notify, false);
});

test('aplica a nota mínima a Coins e Gemas e mantém o filtro desligado quando vazio', () => {
  assert.equal(settings().minGrade, 0);
  assert.equal(settings({ minGrade: '0,00' }).minGrade, 0);
  assert.equal(settings({ minGrade: '3' }).minGrade, 3.5);
  assert.equal(settings({ minGrade: '3.50' }).minGrade, 3.5);
  assert.equal(settings({ minGrade: '10,00' }).minGrade, 10);
  const config = settings({ currency: 'all', minGrade: '3,55' });
  assert.equal(config.minGrade, 3.55);
  for (const currency of ['gold', 'orb']) {
    const offer = { ...row, currency };
    assert.equal(matches({ ...offer, grade: 3.54 }, config), false);
    assert.equal(matches(offer, config), false);
    assert.equal(matches({ ...offer, grade: 3.55 }, config), true);
    assert.equal(matches({ ...offer, grade: 3.56 }, config), true);
    assert.equal(matches(offer, settings({ currency: 'all', minGrade: '' })), true);
  }
});

test('exibe pelo desconto mínimo mesmo acima da faixa inferior e ignora o teto salvo na versão antiga', () => {
  const withinBand = { ...row, price: 95_000_000,
    estimate: { status: 'estimated', lower: 90_000_000, median: 100_000_000, discount: 0.05 } };
  assert.equal(matches(withinBand, settings({ discount: 5, maxPrice: 10_000 })), true);
  assert.equal(matches(withinBand, settings({ discount: 6 })), false);
});

test('uma oferta expirada ou ausente no censo sai das oportunidades', () => {
  assert.equal(eligible({ ...row, expiresAt: 100 }, 100), false);
  assert.equal(eligible({ ...row, expiresAt: 100 }, 99), true);
  assert.equal(eligible({ ...row, closed: 'ausente_no_censo' }), false);
});

test('formata desconto, anúncio e intervalo em milhões de Coins, sem misturar Gemas', () => {
  const { presentation } = require('../opportunities.js');
  const row = { price: 78_500_000, currency: 'gold',
    estimate: { discount: 0.215, lower: 90_000_000, upper: 120_000_000 } };
  assert.equal(presentation(row).message, '21,5% de desconto · 78,5 Mi Coins\nOferta forte');
  assert.equal(presentation({ ...row, price: 123, currency: 'gold' }).asking, '0,000123 Mi Coins');
  const gems = presentation({ price: 100, currency: 'orb', estimate: { discount: 0.20, lower: 110, upper: 140 } });
  assert.equal(gems.message, '20% de desconto · 100 Gemas\nFaixa justa estimada · 110–140 Gemas');
  assert.equal(presentation({ ...row, estimate: { ...row.estimate, median: 48_400_000 } }).fair,
    'Preço justo ≈48,4 Mi Coins');
});

test('o aviso de Gemas mantém a velocidade quando a espécie não está no catálogo', () => {
  const { noticePresentation } = require('../opportunities.js');
  const now = Date.UTC(2026, 10, 20, 3, 0, 0);
  const result = noticePresentation({
    currency: 'orb', name: 'Espécie fora do catálogo', level: 306, power: 1, grade: 3.62, price: 30, availableAt: now + 60_000,
    ivs: { speed: 14, attack: 15, specialAttack: 25, hp: 1, defense: 2, specialDefense: 3 },
    estimate: { discount: 1 - 30 / 71, median: 71 },
  }, now);
  assert.equal(result.title, 'Espécie fora do catálogo · −57,7%');
  assert.equal(result.message, 'Nvl 306 · P1 · Nota 3,620\nMercado 💎 30 · Preço justo 💎 71\n14 Spe (crítico)');
  assert.equal(result.desktopMessage, result.message.replace('Nota 3,620', 'N 3,62'));
});
