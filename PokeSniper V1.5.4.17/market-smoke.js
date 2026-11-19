// Exercita os mesmos módulos usados pela extensão com dados sintéticos, sem gravar vendas de teste.
(() => {
  function run() {
    const now = Date.now();
    const ficha = { speciesId: '1', nome: 'Teste local', shiny: false, level: 100, nota: 5,
      potencia: 3, quality: 1, ivs: { hp: 10, attack: 10, defense: 10,
        specialAttack: 10, specialDefense: 10, speed: 0 } };
    const common = { pokemonId: 'example', moeda: 'gold', ficha };
    const listing = { ...common, id: 'offer', preco: 70 };
    const sales = [90, 100, 110, 120, 130].map((bruto, index) => ({
      ...common, tipo: 'pokemon', pokemonId: 'sample' + index,
      id: 'sale' + index, bruto, em: now - 60000,
    }));
    const capture = (aba, linhas) => PISMarketCore.capture({ t: 'market', aba, linhas });
    const check = (name, test) => {
      try { return { teste: name, resultado: test() ? 'ok' : 'falhou' }; }
      catch { return { teste: name, resultado: 'falhou' }; }
    };
    return [
      check('captura e preservação de IV zero', () => capture('vitrine', [listing]).rows[0].ivs.speed === 0),
      check('faixa e preço de referência', () => {
        const target = capture('vitrine', [listing]).rows[0];
        const history = capture('historicoGlobal', sales).rows;
        const estimate = PISMarketCore.estimate(target, history, now);
        return estimate.lower === 100 && estimate.median === 110 && estimate.upper === 120;
      }),
      check('desconto dentro da faixa e sem teto antigo', () => {
        const row = { ...capture('vitrine', [listing]).rows[0],
          price: 95, estimate: { status: 'estimated', lower: 90, median: 100 } };
        return PISOpportunities.eligible(row) &&
          PISOpportunities.matches(row, PISOpportunities.settings({ discount: 5, maxPrice: 1 }));
      }),
      check('página de histórico reconhecida sem expor identificadores', () => {
        const frame = { pagina: 2, aba: 'historicoGlobal', t: 'market', linhas: sales };
        const wire = JSON.stringify(frame, null, 2);
        const normalized = PISMarketCore.capture(frame);
        const receipt = PISHistoryTrace.clean('response', PISMarketCore.historyTrace(frame),
          { status: 'gravado', accepted: normalized.rows.length, new: normalized.rows.length });
        return PISMarketCore.historyReply.test(wire) && receipt.pagina === 2 && receipt.novas === 5 &&
          !JSON.stringify(receipt).includes('sample0');
      }),
      check('identidade da transação separada do anúncio', () => {
        const row = capture('vitrine', [listing]).rows[0];
        const exposure = PISLiquidity.observe(row, null, now - 60000);
        const [sale] = capture('historicoGlobal', [{ ...sales[0], pokemonId: row.pokemonId, bruto: row.price }]).rows;
        return PISLiquidity.possibleSale(exposure, sale) &&
          !PISLiquidity.saleMatches(exposure, sale) &&
          PISLiquidity.saleMatches(exposure, { ...sale, listingId: row.id });
      }),
      check('liquidez se abstém sem desfechos', () => {
        const target = capture('vitrine', [listing]).rows[0];
        const report = PISLiquidity.estimate(target, [], now, PISMarketCore.sameMarket);
        return report.horizons.every(row => row.status === 'insufficient_outcomes');
      }),
    ];
  }
  globalThis.PISMarketSmoke = { run };
})();
