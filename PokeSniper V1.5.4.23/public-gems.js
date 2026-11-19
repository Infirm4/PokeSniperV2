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

  function prepare(snapshot, now = Date.now()) {
    const engine = globalThis.PokeIdlePvePricing;
    if (!engine || !globalThis.PokeIdleCentral || !valid(snapshot, now)) return () => null;
    if (cached?.stamp !== snapshot.geradoEm) {
      const central = globalThis.PokeIdleCentral.create(globalThis);
      const rows = globalThis.PokeIdleCentral.linhas(snapshot).filter(row =>
        row.at <= Date.parse(snapshot.geradoEm) && row.pve > 0 && row.level > 0 && row.base > 0 &&
        !PISMarketCore.isOutland({ name: row.name }) && !(row.speciesId >= 2001 && row.speciesId < 3000));
      const catalog = new Map([...central.species].map(([id, entry]) => [keyName(entry.n), id]));
      cached = { stamp: snapshot.geradoEm, central, rows, catalog, fits: new Map() };
    }
    const { central, rows, catalog, fits } = cached;
    const at = Date.parse(snapshot.geradoEm);
    const quote = engine.itemQuotes(snapshot.itens);
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
      if (!fits.has(shiny)) fits.set(shiny, engine.marketFit(rows.filter(row => row.shiny === shiny)));
      const result = engine.neighbors({ ...profile, at, nota: target.grade }, rows, {
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
        count: result.familyCount, profileSales: result.familyCount, marketCount: result.marketCount,
        sourceAt: at, comparables: comparable,
      };
    };
  }

  function keyName(value) {
    return String(value ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '')
      .replace(/^✨\s*/u, '').replace(/^shiny\s+/i, '').trim().toLowerCase();
  }

  const api = { prepare, valid };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else globalThis.PISPublicGems = api;
})();
