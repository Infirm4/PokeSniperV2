// Gemas usa o snapshot público do site, em um conjunto separado das vendas locais.
(() => {
  const MAX_AGE = 72 * 3600000;
  const FIELDS = ['at', 'price', 'base', 'pve', 'family', 'speciesId', 'shiny', 'level', 'nota', 'name'];
  let cached;

  function valid(snapshot, now = Date.now()) {
    const date = Date.parse(snapshot?.geradoEm);
    const table = snapshot?.vendas;
    return Number.isFinite(date) && date <= now && now - date <= MAX_AGE &&
      table?.formato === 2 && Number.isSafeInteger(table.n) && table.n > 0 && table.n <= 250000 &&
      Array.isArray(table.nomes) && table.campos && FIELDS.every(key => Array.isArray(table.campos[key])) &&
      Object.values(table.campos).every(col => Array.isArray(col) && col.length === table.n) &&
      Array.isArray(snapshot.itens);
  }

  function validateContent(snapshot, now = Date.now()) {
    if (!valid(snapshot, now)) return false;
    const { campos, nomes } = snapshot.vendas;
    const published = Date.parse(snapshot.geradoEm);
    if (snapshot.vendas.tipos?.at !== 't' || snapshot.vendas.tipos?.name !== 's') return false;
    if (snapshot.currency != null && snapshot.currency !== 'orb') return false;
    const currency = campos.currency;
    if (currency && currency.some(value => (snapshot.vendas.tipos.currency === 's' ? nomes[value] : value) !== 'orb')) return false;
    let minute = 0;
    let latest = 0;
    const validRows = campos.at.every((delta, i) => Number.isSafeInteger(delta) &&
      (minute += delta) * 60000 >= 1e12 && minute * 60000 <= published &&
      (latest = Math.max(latest, minute * 60000)) > 0 &&
      [0, 1].includes(campos.shiny[i]) && (campos.nota[i] === null || Number.isFinite(campos.nota[i])) &&
      ['price', 'base', 'pve', 'level', 'speciesId', 'family'].every(key =>
        Number.isFinite(campos[key][i]) && campos[key][i] > 0) &&
      Number.isInteger(campos.name[i]) && typeof nomes[campos.name[i]] === 'string') &&
      snapshot.itens.every(row => row && ['orb', 'gold'].includes(row.currency) &&
        Number.isFinite(row.price) && row.price > 0 && Number.isFinite(Date.parse(row.day)) &&
        Number.isSafeInteger(Number(row.itemId)));
    return validRows && published - latest <= 7 * 86400000;
  }

  function prepare(snapshot, now = Date.now()) {
    const engine = globalThis.PokeIdlePvePricing;
    if (!engine || !globalThis.PokeIdleCentral || !valid(snapshot, now)) return () => null;
    if (cached?.stamp !== snapshot.geradoEm) {
      if (!validateContent(snapshot, now)) return () => null;
      const central = globalThis.PokeIdleCentral.create(globalThis);
      const rows = globalThis.PokeIdleCentral.linhas(snapshot).filter(row =>
        row.at <= Date.parse(snapshot.geradoEm) && row.pve > 0 && row.level > 0 && row.base > 0 &&
        !PISMarketCore.isOutland({ name: row.name }) && !(row.speciesId >= 2001 && row.speciesId < 3000));
      const catalog = new Map([...central.species].map(([id, entry]) => [keyName(entry.n), id]));
      for (const row of rows) row.ivAtaque = null;
      const markets = new Map();
      for (const row of rows) {
        if (!markets.has(row.shiny)) markets.set(row.shiny, { rows: [], bySpecies: new Map() });
        const market = markets.get(row.shiny);
        market.rows.push(row);
        if (!market.bySpecies.has(row.speciesId)) market.bySpecies.set(row.speciesId, []);
        market.bySpecies.get(row.speciesId).push(row);
      }
      cached = { stamp: snapshot.geradoEm, central, catalog, markets, fits: new Map() };
    }
    const { central, catalog, markets, fits } = cached;
    const at = Date.parse(snapshot.geradoEm);
    const quote = engine.itemQuotes(snapshot.itens.filter(row => row.currency === 'orb'));
    const typesOf = id => central.species.get(id)?.t || [];
    return target => {
      if (target.currency !== 'orb' || target.shiny == null || PISMarketCore.isOutland(target)) return null;
      const speciesId = catalog.get(keyName(target.name));
      const ivs = target.ivs;
      if (speciesId == null || !ivs || !Number.isFinite(target.grade)) return null;
      const profile = engine.describe(central, {
        speciesId, level: target.level, potencia: target.power, quality: target.quality, shiny: target.shiny === 1,
        ivs: { hp: ivs.hp, atk: ivs.attack, def: ivs.defense, spAtk: ivs.specialAttack,
          spDef: ivs.specialDefense, speed: ivs.speed },
        tmAoe: target.aoe === 1, tmElemental: target.zMove === 1 ? 'NORMAL' : null, refino: {},
      });
      if (!profile) return null;
      let addons = 0;
      for (const item of profile.addons) {
        const unit = quote(item.id, at);
        if (!(unit > 0)) return null;
        addons += Math.round(unit * item.quantity);
      }
      const shiny = profile.shiny;
      const market = markets.get(shiny);
      if (!market) return null;
      const local = (market.bySpecies.get(speciesId) || []).filter(row =>
        Number.isFinite(row.nota) && Math.abs(row.nota - target.grade) <= 0.75 &&
        Math.abs(Math.log2(row.level / target.level)) <= 0.5 && Math.abs(Math.log(row.pve / profile.pve)) <= 0.5);
      if (!fits.has(shiny)) fits.set(shiny, engine.marketFit(market.rows));
      const result = engine.neighbors({ ...profile, at, nota: target.grade, ivAtaque: null }, market.rows, {
        addons, fit: fits.get(shiny), typesOf, bias: engine.biasFor(snapshot.correcao, shiny) ?? 0,
        megaUnit: (special, time) => quote(special ? engine.MEGA_SHINY : engine.MEGA, time) ?? 0,
      });
      if (!result || ![result.low, result.median, result.high].every(value => Number.isFinite(value) && value > 0)) return null;
      const comparable = result.influence.slice(0, 5).map(({ r }) => ({
        price: r.price, soldAt: r.at, grade: r.nota, level: r.level,
      }));
      return {
        status: 'estimated', method: 'briaoale_public', median: result.median,
        lower: result.low, upper: result.high, discount: 1 - target.price / result.median,
        count: local.length, profileSales: local.length, marketCount: result.marketCount,
        alertSupported: local.length >= 5 && result.parts.proximidade >= 4 / 9,
        sourceAt: at, comparables: comparable,
      };
    };
  }

  function keyName(value) {
    return String(value ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '')
      .replace(/^✨\s*/u, '').replace(/^shiny\s+/i, '').trim().toLowerCase();
  }

  // A fonte pública é em Gemas. Uma cotação informada serve só ao conversor.
  function convert(amount, from, to, coinsPerGem) {
    if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(coinsPerGem) || coinsPerGem <= 0 ||
        !['gold', 'orb'].includes(from) || !['gold', 'orb'].includes(to)) return null;
    const converted = from === to ? amount : from === 'gold' ? amount / coinsPerGem : amount * coinsPerGem;
    return Number.isFinite(converted) && converted > 0 && converted <= Number.MAX_SAFE_INTEGER ? converted : null;
  }

  const api = { prepare, valid, validateContent, convert };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else globalThis.PISPublicGems = api;
})();
