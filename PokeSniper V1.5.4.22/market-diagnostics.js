(() => {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const RECENT_MS = 30 * DAY_MS;
  const IVS = ['hp', 'attack', 'defense', 'specialAttack', 'specialDefense', 'speed'];
  const positive = value => Number.isFinite(value) && value > 0;
  const nonnegative = value => Number.isFinite(value) && value >= 0;
  const identifier = value => typeof value === 'string' && value.trim().length > 0;

  const commonFields = {
    price: positive,
    level: positive,
    grade: nonnegative,
    power: value => Number.isInteger(value) && value >= 1 && value <= 5,
    quality: nonnegative,
    ivTotal: nonnegative,
    form: identifier,
    shiny: value => value === 0 || value === 1,
  };
  const counters = names => Object.fromEntries(names.map(name => [name, 0]));

  function coverage(rows, timeField, extraFields, now, classify) {
    const fieldsToCheck = Object.entries({ ...commonFields, ...extraFields });
    const fieldNames = [...fieldsToCheck.map(([name]) => name), 'allIvs'];
    const fields = counters(fieldNames);
    const recentFields = counters(fieldNames);
    const ivFields = counters(IVS);
    const recentIvFields = counters(IVS);
    const currencies = {
      gold: { total: 0, recent: 0 },
      orb: { total: 0, recent: 0 },
      unknown: { total: 0, recent: 0 },
    };
    let total = 0;
    let recent = 0;
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      total++;
      const time = row[timeField];
      const isRecent = positive(time) && time >= now - RECENT_MS && time <= now;
      const currency = row.currency === 'gold' || row.currency === 'orb' ? row.currency : 'unknown';
      currencies[currency].total++;
      if (isRecent) {
        recent++;
        currencies[currency].recent++;
      }
      for (const [name, present] of fieldsToCheck) {
        if (!present(row[name])) continue;
        fields[name]++;
        if (isRecent) recentFields[name]++;
      }
      let ivCount = 0;
      for (const stat of IVS) {
        if (!nonnegative(row.ivs?.[stat])) continue;
        ivFields[stat]++;
        if (isRecent) recentIvFields[stat]++;
        ivCount++;
      }
      if (ivCount === IVS.length) {
        fields.allIvs++;
        if (isRecent) recentFields.allIvs++;
      }
      classify?.(row);
    }
    return { total, recent, fields, recentFields, ivFields, recentIvFields, currencies };
  }

  function summarize({ listings = [], sales = [], exposures = [] } = {}, now = Date.now()) {
    const outcomes = { confirmed: 0, probable: 0, closed: 0, unresolved: 0 };
    const outcomeAt = value => positive(value) && value <= now;
    // Count each exposure once. A confirmed sale supersedes a previously inferred link.
    const exposureCoverage = coverage(exposures, 'lastSeen', { availableAt: positive }, now, row => {
      if (outcomeAt(row.saleAt)) outcomes.confirmed++;
      else if (outcomeAt(row.closedAt)) outcomes.closed++;
      else if (outcomeAt(row.possibleSaleAt)) outcomes.probable++;
      else outcomes.unresolved++;
    });
    return {
      lookbackDays: RECENT_MS / DAY_MS,
      listings: coverage(listings, 'observedAt', { postedAt: positive, availableAt: positive, sprite: identifier, spriteSource: value => value === 'market' }, now),
      sales: coverage(sales, 'soldAt', { listingId: identifier }, now),
      exposures: { ...exposureCoverage, outcomes },
    };
  }

  const api = { summarize };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else globalThis.PISMarketDiagnostics = api;
})();
