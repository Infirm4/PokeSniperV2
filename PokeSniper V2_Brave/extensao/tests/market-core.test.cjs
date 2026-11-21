const assert = require('node:assert/strict');
const test = require('node:test');
const { capture, validate, estimate, WINDOW_MS } = require('../market-core.js');

const now = Date.UTC(2026, 10, 19);
const ficha = { speciesId: 32, shiny: false, level: 100, nota: 5 };
const listing = { id: '0001', pokemonId: '002', moeda: 'gold', preco: 70, ficha };
const sales = [90, 100, 110, 120, 130].map((bruto, index) => ({
  id: index + 1, tipo: 'pokemon', moeda: 'gold', bruto, ficha, em: now - 1000,
}));
const frame = (aba, linhas) => ({ t: 'market', aba, linhas });

test('normaliza a vitrine e preserva IDs textuais sem levar dados de vendedor', () => {
  const batch = capture(frame('vitrine', [{ ...listing, vendedor: 'nome', estado: 'aberto' }]));
  assert.equal(batch.rows[0].id, '0001');
  assert.equal(batch.rows[0].pokemonId, '002');
  assert.equal(batch.rows[0].shiny, 0);
  assert.equal(Object.hasOwn(batch.rows[0], 'vendedor'), false);
  assert.deepEqual(validate(batch.kind, batch.rows), batch.rows);
});

test('ignora compras, anúncios encerrados, lotes inválidos e vendas sem transação válida', () => {
  assert.equal(capture(frame('historicoCompras', sales)), null);
  assert.equal(capture(frame('vitrine', [{ ...listing, estado: 'vendido' }])), null);
  assert.equal(capture(frame('historicoGlobal', [{ ...sales[0], bruto: undefined }])), null);
  assert.deepEqual(validate('sale', Array(101).fill(listing)), []);
});

test('calcula quantis e exclui vendas fora do grupo e do corte temporal', () => {
  const target = capture(frame('vitrine', [listing])).rows[0];
  const batch = capture(frame('historicoGlobal', [
    ...sales,
    { ...sales[0], id: 6, moeda: 'orb' },
    { ...sales[0], id: 7, ficha: { ...ficha, shiny: true } },
    { ...sales[0], id: 8, em: now },
    { ...sales[0], id: 9, em: now - WINDOW_MS - 1 },
  ]));
  const result = estimate(target, batch.rows, now);
  assert.deepEqual([result.status, result.count, result.lower, result.median, result.upper],
    ['estimated', 5, 100, 110, 120]);
  assert.equal(result.discount, 1 - 70 / 110);
});

test('abstém-se com amostra pequena ou atributos ausentes', () => {
  const target = capture(frame('vitrine', [listing])).rows[0];
  const batch = capture(frame('historicoGlobal', sales.slice(0, 4)));
  assert.equal(estimate(target, batch.rows, now).status, 'insufficient_sales');
  assert.equal(estimate({ ...target, grade: null }, batch.rows, now).status, 'incomplete_profile');
});

test('página do censo aceita a moeda da consulta correlacionada e rejeita outra moeda', () => {
  const core = require('../market-core.js');
  const frame = { t: 'market', aba: 'vitrine', pagina: 3,
    linhas: [{ ...listing, moeda: undefined }, { ...listing, id: 'gem', moeda: 'orb' }] };
  assert.equal(core.captureAutomatic(frame, { pagina: 3, moeda: 'gold' }).rows.length, 1);
  assert.equal(core.captureAutomatic(frame, { pagina: 3, moeda: 'gold' }).rows[0].currency, 'gold');
  assert.equal(core.captureAutomatic(frame, { pagina: 4, moeda: 'gold' }), null);
  assert.equal(core.captureAutomatic({ ...frame, moeda: 'orb' }, { pagina: 3, moeda: 'gold' }), null);
});

test('reconhece prefixos de Outland, marcador explícito e Pokédex sem confundir speciesId', () => {
  const { isOutland, capture } = require('../market-core.js');
  for (const name of ['Trickmaster Gengar', 'Trickamaster Gengar', 'Enrage Tyranitar',
    'Enraged Typhlosion', 'Furious Scizor', '✨ Shiny Brave Charizard']) {
    assert.equal(isOutland({ name }), true);
  }
  assert.equal(isOutland({ name: 'Mega Charizard', speciesId: '13359' }), false);
  assert.equal(isOutland({ ficha: { dex: 2019 } }), true);
  assert.equal(isOutland({ ficha: { isOutland: true } }), true);
  const batch = capture({ t: 'market', aba: 'vitrine', linhas: [{ ...listing,
    ficha: { ...listing.ficha, nome: 'Gengar', dex: 2019 } }] });
  assert.equal(batch.rows[0].outland, true);
});

test('vendas legadas de Trickmaster Gengar não mudam o preço de Gengar mesmo com o mesmo speciesId', () => {
  const { estimate } = require('../market-core.js');
  const now = Date.now();
  const target = { name: 'Gengar', speciesId: '94', currency: 'gold', shiny: 0, level: 100, grade: 5, price: 80 };
  const regular = [90, 95, 100, 105, 110].map((price, i) => ({
    ...target, id: 'regular-' + i, soldAt: now - 1000, price,
  }));
  const premium = [...Array(10)].map((_, i) => ({
    ...target, name: 'Trickmaster Gengar', id: 'premium-' + i, soldAt: now - 1000, price: 1000,
  }));
  assert.equal(estimate(target, [...regular, ...premium], now).median, 100);
  assert.equal(estimate({ ...target, name: 'Trickmaster Gengar' }, premium, now).status, 'excluded_outland');
  assert.equal(require('../opportunities.js').eligible({ ...premium[0],
    estimate: { status: 'estimated', median: 2000 } }), false);
});

test('prioriza a sprite exata do anúncio e valida o domínio antes de avisar', () => {
  const { capture, validate, safeSprite } = require('../market-core.js');
  const frame = { t: 'market', aba: 'vitrine', linhas: [{ ...listing,
    ficha: { ...listing.ficha, nome: 'Gengar', sprite: '/assets/market/skin.png', dex: 94 } }] };
  const batch = capture(frame);
  assert.equal(batch.rows[0].sprite, 'https://pokeidle.io/assets/market/skin.png');
  assert.equal(validate('listing', batch.rows)[0].sprite, batch.rows[0].sprite);
  assert.equal(safeSprite('https://pokeidle.io.evil.example/gengar.png'), null);
  assert.equal(safeSprite('https://raw.githubusercontent.com/other/repo/main/file.png'), null);
  assert.equal(safeSprite('//else.example/sprite.png'), null);
  const fallback = capture({ ...frame, linhas: [{ ...listing, ficha: { ...listing.ficha, dex: 94 } }] });
  assert.match(fallback.rows[0].sprite, /\/pokemon\/94\.png$/);
  assert.equal(batch.rows[0].spriteSource, 'market');
  assert.equal(fallback.rows[0].spriteSource, 'dex');
  assert.equal(validate('listing', fallback.rows)[0].spriteSource, 'dex');
});

test('correlaciona a vitrine por sequência ou moeda explícita independente da ordem das chaves', () => {
  const { decodeGameFrame, matchesMarketPage } = require('../market-core');
  const request = { pagina: 2, moeda: 'orb', ordem: 'recentes', seq: 8123456 };
  const raw = '{"aba":"vitrine","seq":8123456,"t":"market","linhas":[]}';
  const received = decodeGameFrame(raw);
  assert.equal(matchesMarketPage(received, request), true);
  assert.equal(matchesMarketPage({ ...received, pagina: 3 }, request), false);
  assert.equal(matchesMarketPage({ ...received, seq: 42 }, request), false);
  assert.equal(matchesMarketPage({ ...received, moeda: 'gold' }, request), false);
  const withCurrency = { t: 'market', aba: 'vitrine', pagina: 2, linhas: [{ moeda: 'orb' }] };
  assert.equal(matchesMarketPage(withCurrency, request), true);
  assert.equal(matchesMarketPage({ ...withCurrency, linhas: [{ moeda: 'gold' }] }, request), false);
  assert.equal(decodeGameFrame('{"t":"chat","msg":"Devagar aí — muitas mensagens."}'), null);
});

test('classifica o formato do tráfego sem devolver dados da mensagem', () => {
  const { otherFrameFormat } = require('../market-core.js');
  assert.equal(otherFrameFormat('{"t":"pong","private":"x"}'), 'ping_pong');
  assert.equal(otherFrameFormat('42["name",{"secret":"x"}]'), 'json_com_prefixo');
  assert.equal(otherFrameFormat('{"t":"private"}'), 'json_com_t');
  assert.equal(otherFrameFormat('{"type":"private"}'), 'json_com_type');
  assert.equal(otherFrameFormat('{"payload":"x"}'), 'json_sem_tipo');
  assert.equal(otherFrameFormat('{bad'), 'json_inválido');
});

test('a ficha histórica completa exige todos os atributos e preserva IV igual a zero', () => {
  const { incompleteSaleFields } = require('../market-core.js');
  const frame = { t: 'market', aba: 'historicoGlobal', linhas: [{
    ...sales[0], pokemonId: '42', ficha: { ...ficha, nome: 'Nidoran', potencia: 'P1', quality: 1.777,
      ivs: { hp: 29, atk: 24, def: 30, spAtk: 23, spDef: 20, speed: 0 },
      sprite: '/sprites/nidoran.png' },
  }] };
  const [sale] = capture(frame).rows;
  assert.deepEqual(incompleteSaleFields(sale), []);
  assert.equal(sale.ivTotal, 126);
  assert.equal(sale.ivs.speed, 0);
  assert.deepEqual(validate('sale', [sale]), [sale]);
  assert.deepEqual(incompleteSaleFields({ ...sale, quality: null, sprite: null, ivs: { hp: 29 } }),
    ['quality', 'ivs', 'sprite']);
  assert.deepEqual(incompleteSaleFields({ ...sale, sprite: null }, { requireSprite: false }), []);
});

test('identifica Pokémon da mochila por ID e exige nome e nível únicos no fallback', () => {
  const { inventoryProfiles, findInventoryProfile } = require('../market-core');
  const first = { id: '11', speciesId: 94, nome: 'Gengar', level: 100, nota: 4, shiny: false };
  const results = inventoryProfiles({ deposito: { lista: [first, { ...first, id: '12' }] }, nick: 'privado' });
  const byId = new Map(results.map(row => [row.id, row]));
  assert.equal(findInventoryProfile(byId, { ids: ['11'] }).id, '11');
  assert.equal(findInventoryProfile(byId, { ids: [], name: 'Gengar', level: 100 }), null);
  assert.equal(findInventoryProfile(byId, { ids: ['11', '12'] }), null);
  byId.delete('12');
  assert.equal(findInventoryProfile(byId, { ids: [], name: 'gengar', level: 100 }).id, '11');
  assert.equal(findInventoryProfile(byId, { ids: ['99'], name: 'Gengar', level: 100 }), null);
  assert.equal(Object.hasOwn(results[0], 'nick'), false);
});

test('a vitrine filtrada recupera a moeda apenas de uma consulta compatível', () => {
  const { captureVisible } = require('../market-core.js');
  const response = { ...frame('vitrine', [{ ...listing, moeda: undefined }]), pagina: 0, seq: 4 };
  const gems = { moeda: 'orb', pagina: 0, seq: 4, ordem: 'baratos', notaMin: 3.9 };
  const coins = { moeda: 'gold', pagina: 0, seq: 3 };
  assert.equal(captureVisible(response, [coins, gems]).batch.rows[0].currency, 'orb');
  assert.equal(captureVisible({ ...response, seq: undefined }, [coins, gems]).batch, null);
  assert.equal(captureVisible({ ...response, pagina: 1 }, [gems]).batch, null);
  assert.equal(captureVisible({ ...response, moeda: 'gold' }, [gems]).batch.rows[0].currency, 'gold');
});
