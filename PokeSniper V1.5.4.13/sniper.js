// PokeIdle Market Sniper v1.5.4.13
// Roda no mundo MAIN da página (document_start) e usa o WebSocket que o próprio jogo já abriu.
// Começa DESLIGADO e em modo SIMULAÇÃO: só registra o que compraria.
//
// Cada pedra tem um modo (excludentes): DESCONTOS (comprar para ficar com a pedra),
// REVENDA (comprar só para revender) ou desativada.
//
// Regra de DESCONTOS (por pedra):
//   1. lê os anúncios abertos que o jogo devolve (hoje: até 60, os mais baratos);
//   2. referência = mediana dos 7 anúncios mais recentes; se houver lote de 50+ entre eles,
//      usa o MAIOR preço entre esses lotes grandes (regra especial);
//   3. limite por pedra = referência × (1 − desconto configurado para aquela pedra);
//   4. compra os anúncios com preço <= limite, respeitando o saldo para compras.
//
// Regra de REVENDA (foco em anúncios muito abaixo do preço normal):
//   1. preço de compra deve ser pelo menos 18% abaixo da mediana dos 7 anúncios recentes
//      (percentual editável somente na aba REVENDA);
//   2. preço de saída = (custo unitário + lucro mínimo) ÷ (1 − taxa de 15%)
//      deve ficar estritamente ABAIXO da mesma mediana;
//   3. ainda exige que o preço de saída não passe do menor lote concorrente de 30+;
//   4. todas as condições são recalculadas com consulta nova ANTES do envio,
//      inclusive na liberação de retidos, e com o orçamento atualizado.
//
// Regra de POKÉMON (aba POKEMON, desligada por padrão):
//   1. QUALQUER Pokémon anunciado por MENOS de 3 mi de gold (editável na aba) é alvo de compra,
//      independentemente de mediana;
//   2. lê espécie, nível e Shiny do anúncio; se a espécie não puder ser lida, NÃO compra;
//   3. mediana de referência (apenas informativa) é calculada por grupo espécie + Shiny/Normal;
//   4. antes de enviar, relê o mercado e revalida preço, vendedor, saldo e retenção;
//   5. a consulta de listagem de Pokémon é APRENDIDA do próprio jogo: abra o mercado de Pokémon
//      uma vez (ordenado pelo mais barato) e o bot passa a repetir a mesma consulta.
(() => {
  if (window.__pis) return;
  window.__pis = true;

  const EXT_VERSION = '1.5.4.13'; // versão realmente injetada na página
  const K_CFG = 'pis_cfg_v2';
  const K_LOG = 'pis_relatorio_v1';
  const K_AVISOS = 'pis_avisos_anuncios_v1'; // IDs já anunciados, independente da varredura
  const K_DESCONTOS = 'pis_descontos_por_pedra_v1'; // % independentes por nome de pedra
  const K_DESCONTO_TODOS = 'pis_ultimo_desconto_todos_v1'; // ultimo preenchimento em lote; nao cria regra global
  const K_PEDRAS_CONHECIDAS = 'pis_pedras_conhecidas_v1'; // inclui pedras novas detectadas no mercado
  const K_MODO_PEDRAS = 'pis_modo_pedras_v1'; // 'descontos' | 'revenda' | 'desativado' por pedra
  const K_INVENTARIO = 'pis_inventario_revenda_v1'; // compras da REVENDA: { chave: { nome, itemId, qtd, custoTotal } }
  const K_VENDAS_VISTAS = 'pis_vendas_conferidas_v1'; // IDs das vendas já lidas, persistidos para evitar baixas duplicadas
  const K_POKE_ATIVO = 'pis_pokemon_ativo_v1';       // liga/desliga a compra de Pokémon (padrão: desligado)
  const K_POKE_INV = 'pis_inventario_pokemon_v1';    // Pokémon comprados pelo bot (confirmados no histórico)
  const K_POKE_TPL = 'pis_pokemon_consulta_v1';      // consulta de listagem aprendida do jogo: { req, aba }
  const K_INTERVALO_CENSO_1547 = 'pis_intervalo_censo_adaptativo_v1547'; // mantém patamar de SEGURANÇA somente para falhas; censos válidos são contínuos
  const K_INTERVALO_MERCADO_1547 = 'pis_intervalo_mercado_adaptativo_v1547'; // preserva o intervalo adaptado de 2–7s da v1.5.4.7

  // ---------- configuração ----------
  // Editável no painel:
  const DEF = {
    dryRun: true,        // simulação: não compra, só registra
    discountPct: 20,     // usado apenas para migrar a configuração antiga para cada pedra
    saldoM: 1,           // saldo para compras, EM MILHÕES (2 = 2.000.000 de gold) — teto de gasto até reiniciar
    lucroMin: 0,         // REVENDA: lucro mínimo por unidade, em gold
    descontoMinRevenda: 18, // REVENDA: desconto mínimo do preço de compra vs. mediana simples dos 7 (%)
    pokeLimiteM: 3       // POKEMON: compra qualquer Pokémon com preço ESTRITAMENTE menor que isto (milhões de gold)
  };

  // Pausa fixa de 5 segundos ENTRE varreduras completas; não é configurável pelo painel.
  const INTERVALO_VARREDURA_MS = 5000;
  // POKEMON tem ciclo PRÓPRIO, mas as consultas usam limitador de frequência compartilhado.
  const INTERVALO_POKE_MS = 15000; // evita spam; limite de consulta compartilhado com o censo
  // A coleta incremental e os erros têm ciclo de verificação conservador.
  // Após CENSO VALIDADO, a próxima varredura inicia sem aguardar estes 60s.
  const INTERVALO_RASTREADOR_MS = 60000;
  // Patamares usados APENAS para retentativas após falha/cobertura inconsistente.
  // Censos concluídos com sucesso não têm espera fixa entre si.
  const INTERVALOS_CENSO_MS = [5, 7, 10, 15, 20, 30].map(min => min * 60000);
  const COOLDOWN_AJUSTE_CENSO_MS = 10 * 60000; // no máximo um aumento a cada dez minutos
  // Não somar uma pausa fixa de 2,5s ao limitador global: no teste de 2s,
  // isso impediria atingir o intervalo solicitado. A fila única e o backoff
  // continuam protegendo o servidor contra consultas concorrentes/sobrecarga.
  const PAUSA_ENTRE_PAGINAS_COMPLETAS_MS = 0;
  const INTERVALO_RETRY_CENSO_MS = 5 * 60000;
  const INTERVALO_RETRY_CENSO_MAX_MS = 30 * 60000;
  const ANTECEDENCIA_CANCELAMENTO_MS = 10 * 60000;
  // Base de ausência é SEMPRE revalidada ao iniciar: não inferir sobre lacunas de sessões antigas.
  // Proteção contra paginação sem fim ou volume que o jogo não consiga responder.
  const MAX_PAGINAS_RASTREADOR = 500;
  const FOLGA_EXPIRACAO_MS = 12000;  // 12 s: margem de rede/varredura para expiraEm
  const AMOSTRA_MIN_COMPARAVEIS = 8; // abaixo disso NUNCA inferir venda por preço
  const HISTORICO_PRECOS_MS = 7 * 86400000;
  const PRAZO_INCERTO_VENDA_MS = 7 * 86400000; // 7 dias completos desde a primeira ausência observada

  // Fixos (só mudam editando este arquivo):
  const FIXO = {
    amostraMax: 7,           // 7 mais recentes: mediana ou maior preço dos lotes de 50+ (DESCONTOS)
    minAnuncios: 10,         // abaixo disso a pedra é ignorada (mediana pouco confiável)
    maxFails: 3,             // para após N falhas/erros seguidos
    sorteioUi: 1,            // valor observado nas compras manuais
    categorias: 'stone',     // categorias varridas (vírgula)
    itemIds: '',             // vazio = todos; ex.: '49,76'
    meuNome: 'Infirm4',      // seu nick, para não comprar dos seus anúncios
    taxaMercadoPct: 15,      // taxa que o mercado cobra sobre o valor da venda (REVENDA)
    loteGrandeMin: 30,       // lote com 30+ un. = trava ADICIONAL à mediana dos 7 (REVENDA)
    excluir: ['rock stone', 'ground stone', 'earth stone', 'cocoon stone', 'metal stone'],   // pedras que nunca são varridas (nome em minúsculas)
    // POKEMON: normalmente null (a consulta é aprendida do jogo). Se preferir fixar, preencha com
    // a mensagem que o jogo envia (ex.: { t: 'market.pokemons', pagina: 0 }) e a 'aba' da resposta.
    pokeReq: null, pokeAba: null,
    // URL do app da web do Google Apps Script (veja google-apps-script.gs). Vazio = só banco local + CSV.
    sheetsUrl: 'https://script.google.com/macros/s/AKfycbwPXSeG3xL5PUwDwsuCp-XWJ8s8w3qmlGxECTJo_haREmZbeKOOnr_5qTfVZtH5xmDS/exec',
    // Salva sozinho uma cópia completa (CSV) na pasta Downloads a cada N horas, se houver registros novos. 0 = desligado.
    csvAutoHoras: 6
  };

  // A mediana deve usar a data REAL de criação; retenção (compravelEm) e ID não provam recência.
  // Se a data não vier na resposta, o bot exibe o problema e NÃO compra aquela pedra.
  const CAMPOS_DATA = [
    'criadoEm', 'criado', 'listadoEm', 'publicadoEm', 'postadoEm', 'createdAt', 'created', 'dataCriacao'
  ];

  const FIELDS = [
    ['saldoM', 'Saldo para compras (milhões de gold)']
  ];

  // cores do log
  const COR = { gold: '#ffd54a', qty: '#c792ea' };
  // cor de cada pedra pela primeira palavra do nome ("Fire Stone" → fire); as não listadas ganham uma cor derivada do nome
  const COR_PEDRA = {
    venom: '#a855f7', fire: '#ff7a3d', water: '#4da6ff', thunder: '#ffe14d', leaf: '#5fd068', ice: '#8fe3ff',
    earth: '#b0814f', ground: '#b0814f', rock: '#a39a8a', metal: '#b4bcc8', darkness: '#8b93b8',
    dark: '#8b93b8', ancient: '#d8b98a', enigma: '#b8e04a', feather: '#eef0ff', heart: '#ff7eb6',
    punch: '#d9573f', cocoon: '#9ccf6b', sun: '#ffb347', moon: '#b9c4ff', dawn: '#ffb7a1',
    dusk: '#c56a8a', shiny: '#fff3b0', sky: '#7cc8ff', wind: '#9be7d8'
  };
  const corHash = s => { let x = 0; for (const ch of s) x = (x * 31 + ch.charCodeAt(0)) >>> 0; return `hsl(${x % 360} 70% 68%)`; };
  const corPedra = nome => COR_PEDRA[String(nome).toLowerCase().split(/\s+/)[0]] || corHash(String(nome));

  // Apenas pedras permitidas aparecem no painel; as excluidas continuam bloqueadas na logica de compra.
  const PEDRAS_INICIAIS = [
    'Ancient Stone', 'Darkness Stone', 'Enigma Stone', 'Feather Stone',
    'Fire Stone', 'Heart Stone', 'Ice Stone', 'Leaf Stone',
    'Punch Stone', 'Sun Stone', 'Thunder Stone', 'Venom Stone', 'Water Stone'
  ];
  const chavePedra = nome => String(nome || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const descontoValido = valor => typeof valor === 'number' && Number.isFinite(valor) && valor >= 0 && valor <= 100;
  const pedraBloqueada = (nome, c) => c.excluir.some(x => chavePedra(nome).startsWith(x));

  // Cada pedra tem um único modo: DESCONTOS compra para ficar com a pedra, REVENDA compra só
  // para revender, e 'desativado' não compra em nenhuma das duas abas.
  // Preferências explícitas permanecem salvas; pedras ainda não configuradas começam desligadas.
  function modoPedra(nome) {
    if (!nome || pedraBloqueada(nome, cfg())) return 'desativado';
    const modos = lsGet(K_MODO_PEDRAS, {});
    const m = modos && modos[chavePedra(nome)];
    return ['descontos', 'revenda', 'desativado'].includes(m) ? m : 'desativado';
  }
  // Se todas as pedras estão DESATIVADAS, não consultar nem market.itens nem market.item.
  // A lista inclui pedras conhecidas dinamicamente, não apenas as 13 iniciais.
  function existePedraAtiva() {
    const configurados = lsGet(K_MODO_PEDRAS, {});
    if (!configurados || typeof configurados !== 'object' || Array.isArray(configurados)) return false;
    return Object.entries(configurados).some(([nome, modo]) =>
      (modo === 'descontos' || modo === 'revenda') && !pedraBloqueada(nome, cfg()));
  }

  function salvarModoPedra(nome, novoModo) {
    if (!nome || pedraBloqueada(nome, cfg()) ||
        !['descontos', 'revenda', 'desativado'].includes(novoModo)) return false;
    const modos = lsGet(K_MODO_PEDRAS, {});
    lsSet(K_MODO_PEDRAS, { ...(modos && typeof modos === 'object' && !Array.isArray(modos) ? modos : {}),
      [chavePedra(nome)]: novoModo });
    return true;
  }


  // ---------- utilidades ----------
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sem storage */ } };
  const cfg = () => ({ ...DEF, ...lsGet(K_CFG, {}), ...FIXO });
  const save = (k, v) => { lsSet(K_CFG, { ...lsGet(K_CFG, {}), [k]: v }); render(); };

  // Migração: cada pedra recebe o desconto global que o usuário usava até esta versão.
  // Não apagamos as preferências caso a extensão seja recarregada.
  function inicializarDescontos() {
    const anterior = lsGet(K_CFG, {});
    const porcentagem = descontoValido(Number(anterior.discountPct)) ? Number(anterior.discountPct) : DEF.discountPct;
    const salvos = lsGet(K_DESCONTOS, {});
    const mapa = salvos && typeof salvos === 'object' && !Array.isArray(salvos) ? { ...salvos } : {};
    let mudou = false;
    for (const nome of PEDRAS_INICIAIS) {
      const chave = chavePedra(nome);
      if (!descontoValido(mapa[chave])) { mapa[chave] = porcentagem; mudou = true; }
    }
    if (mudou) lsSet(K_DESCONTOS, mapa);
  }
  inicializarDescontos();
  function descontoDaPedra(nome, c = cfg()) {
    if (!nome) return null; // sem nome confiável, não comprar
    const dados = lsGet(K_DESCONTOS, {});
    const valor = dados && dados[chavePedra(nome)];
    if (descontoValido(valor)) return valor;
    // Se uma pedra nova aparecer no servidor, herda o padrão anterior.
    return descontoValido(Number(c.discountPct)) ? Number(c.discountPct) : DEF.discountPct;
  }
  function salvarDescontoPedra(nome, valor) {
    if (!descontoValido(valor)) return false;
    const mapa = lsGet(K_DESCONTOS, {});
    lsSet(K_DESCONTOS, { ...(mapa && typeof mapa === 'object' ? mapa : {}), [chavePedra(nome)]: valor });
    return true;
  }
  function registrarPedra(nome) {
    nome = String(nome || '').trim();
    if (!nome || pedraBloqueada(nome, cfg())) return;
    const lista = lsGet(K_PEDRAS_CONHECIDAS, []);
    if (!Array.isArray(lista) || PEDRAS_INICIAIS.some(x => chavePedra(x) === chavePedra(nome)) ||
        lista.some(x => chavePedra(x) === chavePedra(nome))) return;
    lsSet(K_PEDRAS_CONHECIDAS, [...lista, nome].slice(-100));
    // Se a tela de descontos estiver aberta, mostra a pedra recém-detectada.
    if (ui && typeof ui.atualizarListaDescontos === 'function') ui.atualizarListaDescontos();
  }

  lsSet(K_CFG, { ...lsGet(K_CFG, {}), dryRun: true });       // a cada carregamento da página volta em SIMULAÇÃO
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const fmt = n => (n == null ? '?' : Number(n).toLocaleString('pt-BR'));
  const orcamento = c => Math.round(c.saldoM * 1e6);   // painel em milhões → gold

  // 70000 → "70k", 89900 → "89,9k", 7000000 → "7 mi", 1912597 → "1,9 mi", 10e9 → "10 bi"
  const UN = [[1e9, ' bi'], [1e6, ' mi'], [1e3, 'k']];
  function abrev(n) {
    n = Math.round(n);
    for (let i = 0; i < UN.length; i++) {
      const [d, s] = UN[i];
      if (n >= d) {
        const v = Math.round(n / d * 10) / 10;
        if (v >= 1000 && i > 0) return abrev(UN[i - 1][0]);   // 999.950 → "1 mi"
        return v.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + s;
      }
    }
    return String(n);
  }

  const medianaDe = a => {
    const s = a.slice().sort((x, y) => x - y), m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };

  // Referência dos 7 anúncios mais recentes da resposta, incluindo os ainda RETIDOS.
  // Regra especial v1.2.10: se algum dos sete tiver 50+ un., referência = MAIOR
  // preço entre esses lotes; caso contrário, mediana simples dos sete preços.
  // Toda tentativa refaz este cálculo com uma consulta NOVA do mercado.
  function referenciaRecentes(abertas, n) {
    if (!Array.isArray(abertas) || abertas.length < n) return null;
    const campo = campoData(abertas);
    if (!campo) return null;
    const amostra = abertas.slice()
      .sort((a, b) => tsVal(b[campo]) - tsVal(a[campo]))
      .slice(0, n);
    if (amostra.some(l => !Number.isSafeInteger(Number(l.preco)) || Number(l.preco) <= 0 ||
        !Number.isSafeInteger(Number(l.qtd)) || Number(l.qtd) < 1)) return null;
    const lotes50 = amostra.filter(l => Number(l.qtd) >= 50);
    const referencia = lotes50.length
      ? Math.max(...lotes50.map(l => Number(l.preco)))
      : medianaDe(amostra.map(l => Number(l.preco)));
    return { referencia, campo, amostra,
      tipo: lotes50.length ? 'maior_preco_50_mais' : 'mediana', anunciosCom50: lotes50.length };
  }

  // Na REVENDA, a referência é SEMPRE a mediana simples dos 7 anúncios mais
  // recentes (independentemente do tamanho do lote). NÃO aplica a regra de 50+
  // que pertence somente a DESCONTOS. Inclui os retidos na amostra recente.
  function medianaRevendaRecentes(abertas, n) {
    const base = referenciaRecentes(abertas, n);
    return base ? medianaDe(base.amostra.map(x => Number(x.preco))) : null;
  }

  // ---------- REVENDA: preço de saída, trava de competitividade, mercado e inventário ----------
  // O mercado cobra a taxa sobre o valor da VENDA. Para sobrar custo + lucro depois da taxa, o preço
  // é (custo + lucro) ÷ (1 − taxa). Somar 15% ao custo deixaria prejuízo: 1,15 × 0,85 < 1.
  const precoVendaIdeal = (custoUnit, c = cfg()) => {
    const lucro = Math.max(0, Number(c.lucroMin) || 0);
    return Math.ceil((Number(custoUnit) + lucro) * 100 / (100 - c.taxaMercadoPct) - 1e-9);
  };

  // Três travas cumulativas na REVENDA (não confundir com DESCONTOS):
  //   a) compra MUITO abaixo da mediana: % >= descontoMinRevenda;
  //   b) saída após taxa + lucro mínimo ESTRITAMENTE menor que mediana;
  //   c) saída <= menor preço de lote de 30+ de OUTRO anúncio.
  // A função é reexecutada com um snapshot NOVO antes de cada envio (inclusive retidos).
  function avaliarRevenda(abertas, l, c = cfg()) {
    const preco = Number(l.preco);
    if (!Number.isSafeInteger(preco) || preco <= 0) return { ok: false, motivo: 'preço inválido' };
    const minPct = Number(c.descontoMinRevenda);
    // Uma configuração inválida não autoriza compras com regra mais permissiva.
    if (!Number.isFinite(minPct) || minPct < 0 || minPct > 100)
      return { ok: false, motivo: 'desconto mínimo de revenda inválido' };
    const medianaSaida = medianaRevendaRecentes(abertas, c.amostraMax);
    if (medianaSaida == null || !Number.isFinite(medianaSaida) || medianaSaida <= 0)
      return { ok: false, motivo: 'sem 7 anúncios recentes válidos para avaliar revenda' };
    const ideal = precoVendaIdeal(preco, c);
    const descontoReal = (1 - preco / medianaSaida) * 100;
    // Pequena tolerância para representação de porcentagens decimais.
    const okDesconto = descontoReal + 1e-9 >= minPct;
    const grandes = (Array.isArray(abertas) ? abertas : [])
      .filter(x => String(x.id) !== String(l.id) && x.estado === 'aberto' && !x.comprador &&
        (!c.meuNome || x.vendedor !== c.meuNome) &&
        Number.isSafeInteger(Number(x.preco)) && Number(x.preco) > 0 && Number(x.qtd) >= c.loteGrandeMin)
      .map(x => Number(x.preco));
    const piso = grandes.length ? Math.min(...grandes) : null;
    const okMediana = ideal < medianaSaida;
    const okLote = piso != null && ideal <= piso;
    return { ok: okDesconto && okMediana && okLote, ideal, piso, medianaSaida,
      descontoReal, minPct,
      motivo: !okDesconto ? `desconto abaixo dos ${minPct}% exigidos para revenda` :
        !okMediana ? 'saída ideal não é menor que a mediana dos 7 recentes' :
        piso == null ? `sem outro lote de ${c.loteGrandeMin}+ unidades como referência` :
        !okLote ? 'saída ideal acima do lote grande mais barato' : '' };
  }

  // Regra de compra de cada modo: ÚNICA fonte da verdade para varredura, retenção e envio.
  //   ctx = { nome, mediana (DESCONTOS), abertas (REVENDA) }
  function avaliarOferta(modo, ctx, l, c) {
    if (modo === 'descontos') {
      const desconto = descontoDaPedra(ctx.nome, c);
      const mediana = Number(ctx.mediana);
      if (desconto == null || !Number.isFinite(mediana) || mediana <= 0) return { ok: false };
      const limite = Math.floor(mediana * (1 - desconto / 100));
      return { ok: Number(l.preco) <= limite, limite, pct: Math.round((1 - Number(l.preco) / mediana) * 100) };
    }
    if (modo === 'revenda') return avaliarRevenda(ctx.abertas, l, c);
    return { ok: false };
  }

  // Dados que acompanham a oferta até o envio, para revalidar a MESMA regra antes de comprar.
  const candidata = (id, nome, modo, ctx, av) => ({
    id, nome, modo, mediana: ctx.mediana, abertas: ctx.abertas, pct: av.pct,
    ideal: av.ideal, piso: av.piso, medianaSaida: av.medianaSaida, descontoReal: av.descontoReal,
    detalhe: modo === 'revenda'
      ? `revenda, ${Number(av.descontoReal).toFixed(1).replace('.', ',')}% abaixo da mediana ${abrev(av.medianaSaida)}; saída ${abrev(av.ideal)}`
      : `desconto de ${av.pct}%`
  });

  // Menor preço entre os CONCORRENTES (seus próprios anúncios não contam), por pedra.
  function atualizarMercado(nome, itemId, abertas, c) {
    const precos = abertas.filter(x => !c.meuNome || x.vendedor !== c.meuNome)
      .map(x => Number(x.preco)).filter(p => Number.isFinite(p) && p > 0);
    st.mercado[chavePedra(nome)] = { itemId, menor: precos.length ? Math.min(...precos) : null, ts: Date.now() };
  }

  // Status do item do inventário: verde se o preço sugerido (com taxa e lucro mínimo) não passa do
  // menor concorrente; vermelho se o mercado não deixa vender com o lucro mínimo, ou com prejuízo.
  function statusRevenda(custoMedio, sugerido, mercado, c = cfg()) {
    if (!mercado) return { txt: 'Sem dados', cor: '#9a9aa8', dica: 'Mercado ainda não consultado. Use “Atualizar preços” ou ligue o bot.' };
    const menor = mercado.menor;
    if (menor == null) return { txt: 'Sem concorrentes', cor: '#4ade80', dica: 'Nenhum outro anúncio aberto.' };
    const liquido = Math.floor(menor * (1 - c.taxaMercadoPct / 100));   // o que sobra vendendo ao menor preço
    const dica = `Vendendo a ${fmt(menor)} (menor concorrente) sobram ${fmt(liquido)} após a taxa; custo médio ${fmt(Math.round(custoMedio))}.`;
    if (menor >= sugerido) return { txt: 'Lucro saudável', cor: '#4ade80', dica };
    return liquido < custoMedio
      ? { txt: 'Abaixo do custo', cor: '#fb4b4b', dica: dica + ' Melhor segurar.' }
      : { txt: 'Mercado travado', cor: '#fb4b4b', dica: dica + ' Abaixo do lucro mínimo; melhor segurar.' };
  }

  // Inventário da REVENDA: só o que o bot comprou de verdade (confirmado no histórico do jogo).
  const lerInventario = () => {
    const v = lsGet(K_INVENTARIO, {});
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  };
  function somarNoInventario(inv, nome, itemId, qtd, custo) {
    const k = chavePedra(nome), atual = inv[k] || { nome, itemId, qtd: 0, custoTotal: 0 };
    inv[k] = { nome, itemId: itemId != null ? itemId : atual.itemId,
      qtd: atual.qtd + qtd, custoTotal: atual.custoTotal + custo,
      // A data da primeira compra ajuda a descartar vendas anteriores à compra.
      // Registros anteriores à v1.3.5 permanecem sem data: não inventamos uma.
      ...(atual.compradoEm ? { compradoEm: atual.compradoEm } : atual.qtd > 0 ? {} : { compradoEm: Date.now() + st.off }) };
  }
  function registrarCompraInventario(nome, itemId, qtd, custo) {
    if (!Number.isSafeInteger(qtd) || qtd < 1 || !Number.isFinite(custo) || custo <= 0) return;
    const inv = lerInventario();
    somarNoInventario(inv, nome, itemId, qtd, custo);
    lsSet(K_INVENTARIO, inv);
    if (ui && ui.atualizarRevenda) ui.atualizarRevenda();
    agendarConferenciaVendas(1000);
  }
  function registrarSimulado(nome, itemId, qtd, custo) {
    somarNoInventario(st.invSim, nome, itemId, qtd, custo);
    if (ui && ui.atualizarRevenda) ui.atualizarRevenda();
  }
  function ajustarQtdInventario(nome, novaQtd) {
    const inv = lerInventario(), k = chavePedra(nome), it = inv[k];
    if (!it) return;
    if (novaQtd <= 0) delete inv[k];
    else inv[k] = { ...it, qtd: novaQtd, custoTotal: Math.round(it.custoTotal / it.qtd * novaQtd) };  // mantém o custo médio
    lsSet(K_INVENTARIO, inv);
  }

  const st = {
    running: false, loopId: 0, sock: null, gold: null, off: 0, fails: 0, errs: 0, seq: 1000,
    skip: {}, seen: {}, log: Array.isArray(lsGet(K_LOG, [])) ? lsGet(K_LOG, []).slice(0, 500) : [], lastScan: '',
    spent: 0,        // gold gasto na sessão (zera ao clicar em Ligar ou recarregar a página)
    excl: new Set(), // itemIds das pedras excluídas (descobertos pelo nome na 1ª varredura)
    diagN: 0,
    mercado: {},        // menor preço concorrente por pedra (alimenta a tabela da REVENDA)
    invSim: {},         // compras SIMULADAS da revenda (só na memória; zera ao ligar)
    retidos: new Map(), // agenda preparação antecipada de ofertas retidas
    prioridadeRetida: null, // evita compra normal concorrendo com a oferta prestes a liberar
    itemQueue: Promise.resolve(), // serializa consultas/compras entre varredura e liberação
    activeAttempt: null,          // correlação dos eventos do sorteio com a tentativa atual
    finalizados: new Set(),       // não tenta de novo anúncio com resultado conhecido/incerto
    avisados: lsGet(K_AVISOS, {}), // IDs avisados ficam salvos mesmo se clicar em Ligar novamente
    ultimaConferenciaVendas: 0, vendasEmAndamento: null, timerVendas: null,
    pokeTpl: lsGet(K_POKE_TPL, null), // consulta de Pokémon aprendida do jogo
    pokeAprender: null, pokeSim: [], pokeAvisos: {}, pokeErros: 0
  };
  const nowSrv = () => Date.now() + st.off; // relógio do servidor (vem em estado.servidorAgora)

  // converte um valor de data/ordem em número comparável (ou null se não servir)
  const tsVal = v => {
    if (typeof v === 'number' && isFinite(v)) return v;
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) { const p = Date.parse(v); return isNaN(p) ? null : p; }
    if (typeof v === 'string' && /^\d{10,16}$/.test(v)) return Number(v);
    return null;
  };
  const campoData = linhas => CAMPOS_DATA.find(k => linhas.every(l => tsVal(l[k]) != null));

  // Não repetir o mesmo anúncio em cada varredura nem após reiniciar o bot.
  // A chave é o ID ÚNICO do anúncio, não o nome da pedra: novos anúncios continuam aparecendo.
  // Mantém os 3000 anúncios mais recentes no histórico, para evitar inflar o armazenamento local.
  function avisoJaMostrado(id) {
    return Object.prototype.hasOwnProperty.call(st.avisados, String(id));
  }
  function marcarAviso(id) {
    const agora = Date.now();
    st.avisados[String(id)] = agora;
    const entradas = Object.entries(st.avisados).filter(([,t]) => Number.isFinite(Number(t)));
    entradas.sort((a,b) => Number(b[1]) - Number(a[1]));
    st.avisados = Object.fromEntries(entradas.slice(0, 3000));
    lsSet(K_AVISOS, st.avisados);
  }

  // ---------- log do painel ----------
  // Uma linha do log é uma lista de pedaços {s: texto, k: tipo}. k: 'gold' (amarelo), 'qty' (roxo), 'stone' (cor da pedra, sublinhado).
  const P = s => ({ s: String(s), k: 'stone' });
  const G = n => ({ s: abrev(n), k: 'gold' });
  const Q = n => ({ s: fmt(n), k: 'qty' });
  const L = (strs, ...vals) => {        // L`texto ${P(nome)} texto ${G(preco)}`
    const out = [];
    strs.forEach((s, i) => {
      out.push({ s });
      if (i < vals.length) out.push(typeof vals[i] === 'object' ? vals[i] : { s: String(vals[i]) });
    });
    return out;
  };

  let ui = null;
  const dbg = (...a) => console.log('[PIS]', ...a);   // detalhes técnicos: só no console (F12), não no painel

  // Os registros antigos continuam preservados em armazenamento para auditoria,
  // mas linhas intermediárias redundantes não aparecem no painel nem no TXT.
  function relatorioVisivel(e) {
    const txt = (e.parts || []).map(p => p.s || '').join('');
    return !/^Mediana \(\d+ mais recentes da consulta\)|ENTRADA NO SORTEIO CONFIRMADA|jogo confirmou a compra|Compra CONFIRMADA no hist[oó]rico|pedido enviado\. Aguardando|pré-verificando anúncio e histórico|retenção liberada \(\+|oferta liberada, desconto revalidado|perdi a janela inicial de sorteio/i.test(txt);
  }

  function entryEl(e) {
    const row = h('div', { margin: '0 0 3px', wordBreak: 'break-word' });
    // Uma linha vazia entre avisos de propostas; eventos técnicos ficam compactos.
    if (e.parts.some(p => typeof p.s === 'string' &&
      (p.s.startsWith('Identifiquei ') || p.s.startsWith('🔒 Retido:')))) row.style.marginBottom = '1.4em';
    row.append(h('span', { opacity: '.55', marginRight: '6px' }, { textContent: e.h }));
    for (const p of e.parts) {
      const sp = h('span', {}, { textContent: p.s });
      if (p.k === 'gold') { sp.style.color = COR.gold; sp.style.fontWeight = '600'; }
      else if (p.k === 'pct') { sp.style.color = '#ffffff'; sp.style.fontWeight = '700'; }
      else if (p.k === 'win') { sp.style.color = '#4ade80'; sp.style.fontWeight = '800'; }
      else if (p.k === 'loss') { sp.style.color = '#fb4b4b'; sp.style.fontWeight = '800'; }
      else if (p.k === 'qty') { sp.style.color = COR.qty; sp.style.fontWeight = '600'; }
      else if (p.k === 'stone') { sp.style.color = corPedra(p.s); sp.style.textDecoration = 'underline'; sp.style.fontWeight = '600'; }
      row.append(sp);
    }
    return row;
  }

  const log = (m, pk = false) => {
    const parts = (typeof m === 'string' ? [{ s: m }] : m).filter(p => p.s !== '');
    const e = { h: new Date().toLocaleTimeString('pt-BR'), parts, pk: !!pk };
    st.log.unshift(e);
    if (st.log.length > 500) st.log.length = 500;
    lsSet(K_LOG, st.log);
    dbg(parts.map(p => p.s).join(''));
    if (ui && relatorioVisivel(e)) {
      ui.log.prepend(entryEl(e));
      while (ui.log.childNodes.length > 200) ui.log.lastChild.remove();
    }
    if (ui && ui.pkLog && e.pk && relatorioVisivel(e)) {
      ui.pkLog.prepend(entryEl(e));
      while (ui.pkLog.childNodes.length > 200) ui.pkLog.lastChild.remove();
    }
    render();
  };

  // ---------- WebSocket do jogo ----------
  const OWS = window.WebSocket;
  const osend = OWS.prototype.send;
  const waiters = [];

  function descricaoConfere(descricao, nome) {
    const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const desc = norm(descricao), item = norm(nome);
    return !!desc && !!item && desc.includes(item);
  }

  // Um resultado por anúncio: a cor/estilo ficam nos tokens (win/loss/stone/gold).
  function mostrarResultado(a, venceu) {
    if (a.resultadoMostrado) return;
    a.resultadoMostrado = true;
    const rotulo = { s: venceu ? 'VITORIA' : 'DERROTA', k: venceu ? 'win' : 'loss' };
    log([{ s: venceu ? '✔️ ' : '❌ ' }, rotulo, ...L` ${P(a.rotulo || a.nome)} por ${G(a.precoUnitario)}`], !!a.pk);
  }

  // Apenas os eventos do próprio jogo podem confirmar entrada e resultado do sorteio.
  // Não confundir mensagem enviada, ausência no histórico ou outra compra com vitória/derrota.
  function observarEventoCompra(ev) {
    const a = st.activeAttempt;
    if (!a || !ev || typeof ev !== 'object') return;
    if (ev.k === 'mktSorteio') {
      if (String(ev.id) !== a.ofertaId) return;
      if (ev.fase === 'entrou' || ev.fase === 'lista') {
        // As fases podem chegar em duplicidade ou em sequência. Só um aviso de sorteio.
        if (ev.fase === 'entrou') a.entrou = true;
        if (ev.fase === 'lista') a.lista = true;
        if (!a.sorteioMostrado && a.venceuSorteio == null) {
          a.sorteioMostrado = true;
          log(L`🎲 ${P(a.rotulo || a.nome)} #${a.ofertaId}: ${a.pk ? 'entrou no sorteio, aguardando resultado.' : 'sorteio em andamento.'}`, !!a.pk);
        }
      } else if (ev.fase === 'fim' && typeof ev.ok === 'boolean' && a.venceuSorteio == null) {
        a.venceuSorteio = ev.ok;
        // Resultado do servidor: UMA linha, sem segunda confirmação no painel.
        mostrarResultado(a, ev.ok);
      }
    } else if (ev.k === 'marketComprado') {
      // Compra direta nem sempre tem ID. Nesse caso exige valor, moeda e descrição.
      const idCorresponde = ev.id != null && String(ev.id) === a.ofertaId;
      const valor = Number(ev.total);
      const valorCorresponde = Number.isFinite(valor) && valor > 0 && valor <= a.custo &&
        valor % a.precoUnitario === 0;
      const nomeCorresponde = descricaoConfere(ev.descricao, a.nome);
      if ((idCorresponde && valorCorresponde) ||
          (ev.id == null && ev.moeda === 'gold' && valorCorresponde && nomeCorresponde)) {
        a.recibo = true;
        a.valorRecebido = valor;
        // Recebimento técnico permanece correlacionado; sem mensagem duplicada ao usuário.
        dbg(`Recibo do jogo #${a.ofertaId}: ${fmt(valor)} Coins; aguardando histórico.`);
      }
    }
  }

  function onMsg(ws, e) {
    const d = e.data;
    if (typeof d !== 'string') return;
    // Resposta de limite pode vir em uma notificação fora de market/estado/batalha.
    if (d.length < 12000 && /devagar\s*a[ií]|muitas mensagens|too many (?:messages|requests)/i.test(d))
      registrarSobrecargaDoServidor('aviso do jogo: excesso de mensagens');
    if (!d.startsWith('{"t":"estado"') && !d.startsWith('{"t":"market"') && !d.startsWith('{"t":"batalha"')) return;
    let j;
    try { j = JSON.parse(d); } catch { return; }
    if (j.t === 'estado' && j.estado) {
      const primeiraConexao = st.sock !== ws;
      st.sock = ws;
      if (primeiraConexao) agendarConferenciaVendas(2500);
      if (j.estado.servidorAgora) st.off = j.estado.servidorAgora - Date.now();
      if (typeof j.estado.gold === 'number') st.gold = j.estado.gold;
    }
    if (j.t === 'batalha' && ws === st.sock && Array.isArray(j.ev)) {
      for (const ev of j.ev) {
        observarEventoCompra(ev);
        // Um evento ao vivo dispara a consulta, mas NÃO baixa estoque sozinho.
        if (ev && ev.k === 'marketVendido') agendarConferenciaVendas(1500);
      }
    }
    if (j.t === 'market') aprenderRespostaPokemon(j);
    // Observa páginas conforme chegam, sem consultas adicionais nem efeito sobre o censo.
    if (ws === st.sock && j.t === 'market') {
      try {
        const batch = globalThis.PISMarketCore?.capture(j);
        if (batch) window.postMessage({ source: 'PIS_MAIN', type: 'MARKET_CORE_BATCH', ...batch }, location.origin);
      } catch (error) { dbg('Captura da fundação de mercado:', error.message); }
    }
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i].p(j)) {
        const w = waiters.splice(i, 1)[0];
        clearTimeout(w.t);
        w.r(j);
      }
    }
  }

  function attach(ws) {
    if (ws.__pis) return;
    ws.__pis = true;
    ws.addEventListener('message', e => onMsg(ws, e));
  }

  window.WebSocket = new Proxy(OWS, {
    construct(target, args, nt) {
      const ws = Reflect.construct(target, args, nt);
      attach(ws);
      return ws;
    }
  });
  OWS.prototype.send = function (d) {
    attach(this);
    // espião (só console): mostra o que o PRÓPRIO JOGO envia ao mercado. O bot envia pelo send original e não aparece aqui.
    if (typeof d === 'string' && d.slice(0, 40).includes('market')) dbg('jogo enviou:', d.slice(0, 400));
    aprenderConsultaPokemon(d);
    return osend.apply(this, arguments);
  };

  // Um único limitador para TODOS os módulos (pedras, compra Pokémon, rastreador).
  // Teste CONTROLADO: inicia em 2s; se houver limitação/timeout, aumenta para
  // 3, 4, 5, 6 e 7s, além de respeitar backoff de 90s–15min já existente.
  // Não reduz sozinho após um sucesso, evitando oscilar no limite do servidor.
  const INTERVALOS_CONSULTA_MS = [2, 3, 4, 5, 6, 7].map(seg => seg * 1000);
  const RECUO_INICIAL_MS = 90 * 1000;
  const RECUO_MAX_MS = 15 * 60 * 1000;
  st.marketFila = Promise.resolve();
  st.marketUltimoEnvio = 0;
  st.marketPausaAte = 0;
  st.marketFalhas = 0;
  st.marketUltimoAviso = 0;
  // Somente o intervalo é persistido; nenhuma alteração no IndexedDB dos Pokémon.
  const mercadoSalvo1547 = lsGet(K_INTERVALO_MERCADO_1547, {});
  st.marketIntervaloIndice = Number.isInteger(mercadoSalvo1547.indice) &&
    mercadoSalvo1547.indice >= 0 && mercadoSalvo1547.indice < INTERVALOS_CONSULTA_MS.length
      ? mercadoSalvo1547.indice : 0;

  function intervaloMinMercadoAtualMs() {
    return INTERVALOS_CONSULTA_MS[st.marketIntervaloIndice];
  }

  function aumentarIntervaloMercadoPorSobrecarga(motivo) {
    if (st.marketIntervaloIndice >= INTERVALOS_CONSULTA_MS.length - 1) return false;
    st.marketIntervaloIndice++;
    lsSet(K_INTERVALO_MERCADO_1547, { indice: st.marketIntervaloIndice, ajustadoEm: Date.now() });
    log(`🛡️ Consultas: após ${motivo}, intervalo mínimo aumentado para ${intervaloMinMercadoAtualMs()/1000} s (teste 2→3→4→5→6→7 s).`, true);
    return true;
  }

  function intervaloCensoAtualMs() {
    const i = Number.isInteger(st.pkIntervaloCensoIndice) ? st.pkIntervaloCensoIndice : 0;
    return INTERVALOS_CENSO_MS[Math.max(0, Math.min(INTERVALOS_CENSO_MS.length - 1, i))];
  }

  // Quando o servidor sinaliza sobrecarga, aumenta a ESPERA DE RETENTATIVA
  // após falha. Não insere atraso após um censo que foi concluído e validado.
  // O patamar de segurança é persistido entre reinicializações.
  function aumentarIntervaloCensoPorSobrecarga(motivo) {
    const agora = Date.now();
    if (st.pkIntervaloCensoIndice >= INTERVALOS_CENSO_MS.length - 1 ||
        agora - st.pkUltimoAjusteCenso < COOLDOWN_AJUSTE_CENSO_MS) return false;
    st.pkIntervaloCensoIndice++;
    st.pkUltimoAjusteCenso = agora;
    lsSet(K_INTERVALO_CENSO_1547, {indice:st.pkIntervaloCensoIndice,ajustadoEm:agora});
    // Se já existe uma retentativa AGENDADA, nunca antecipá-la.
    // Se um censo está em andamento, a proteção da rede (marketPausaAte)
    // continua sendo respeitada pela fila única de requisições.
    if (st.pkProximoCenso && st.pkProximoCenso > agora)
      st.pkProximoCenso = Math.max(st.pkProximoCenso, agora + intervaloCensoAtualMs());
    log(`🕒 Censo: após ${motivo}, retentativas com pausa de segurança de ${intervaloCensoAtualMs()/60000} min (censos válidos continuam sem espera fixa).`, true);
    return true;
  }

  function registrarSobrecargaDoServidor(motivo) {
    const agora = Date.now();
    // Notificações repetidas do mesmo aviso não devem aumentar a contagem sem parar.
    if (agora < st.marketPausaAte && agora - st.marketUltimoAviso < 15000) return;
    st.marketFalhas = Math.min(5, st.marketFalhas + 1);
    const recuo = Math.min(RECUO_MAX_MS, RECUO_INICIAL_MS * (2 ** (st.marketFalhas - 1)));
    st.marketPausaAte = Math.max(st.marketPausaAte, agora + recuo);
    // O aviso vale para o intervalo entre requisições, não apenas para a agenda do censo.
    aumentarIntervaloMercadoPorSobrecarga(motivo);
    aumentarIntervaloCensoPorSobrecarga(motivo);
    if (agora - st.marketUltimoAviso >= 15000) {
      st.marketUltimoAviso = agora;
      log(`⚠️ Mercado limitou as consultas (${motivo}). Pausa de ${Math.ceil((st.marketPausaAte-agora)/60000)} min; sem tentar acelerar o servidor.`);
    }
  }

  async function esperarPermissaoDeConsulta(permitir) {
    while (true) {
      if (permitir && !permitir()) throw new Error('consulta cancelada: módulo desativado');
      const agora = Date.now();
      const atraso = Math.max(0, st.marketUltimoEnvio + intervaloMinMercadoAtualMs() - agora,
        st.marketPausaAte - agora);
      if (atraso === 0) return;
      await sleep(Math.min(atraso, 2000));
    }
  }

  // O lock inclui a RESPOSTA, não apenas o envio. Isso impede duas consultas do
  // próprio bot em paralelo e evita confundir respostas de paginação ou mercado.
  // 'permitir' é reavaliado após qualquer espera: desligar rastreador/bot cancela a consulta.
  function ask(msg, pred, ms = 12000, permitir = null) {
    const executar = async () => {
      await esperarPermissaoDeConsulta(permitir);
      const s = st.sock;
      if (!s || s.readyState !== 1) throw new Error('socket do jogo indisponível');
      st.marketUltimoEnvio = Date.now();
      try {
        const resposta = await new Promise((res, rej) => {
          const w = { p: pred, r: res, t: null };
          w.t = setTimeout(() => {
            const i = waiters.indexOf(w);
            if (i >= 0) waiters.splice(i, 1);
            rej(new Error('sem resposta a ' + msg.t));
          }, ms);
          waiters.push(w);
          try { osend.call(s, JSON.stringify(msg)); }
          catch(e) {
            clearTimeout(w.t);
            const i=waiters.indexOf(w);
            if (i>=0) waiters.splice(i,1);
            rej(e);
          }
        });
        // Não remove a pausa explícita disparada por aviso de limite.
        if (Date.now() >= st.marketPausaAte) st.marketFalhas = 0;
        return resposta;
      } catch(e) {
        if (/^sem resposta a market\./.test(String(e && e.message || '')))
          registrarSobrecargaDoServidor('sem resposta do servidor');
        throw e;
      }
    };
    const tentativa = st.marketFila.then(executar, executar);
    st.marketFila = tentativa.catch(() => {});
    return tentativa;
  }

  const hist = () => ask(
    { t: 'market.historicoCompras', pagina: 0, seq: ++st.seq },
    j => j.t === 'market' && j.aba === 'historicoCompras'
  );

  // O jogo responde ao histórico pessoal de vendas com aba 'historico',
  // diferente do 'historicoCompras' utilizado na confirmação das compras.
  const historicoVendas = () => {
    const seq = ++st.seq;
    return ask({ t: 'market.historico', pagina: 0, seq },
      j => j.t === 'market' && j.aba === 'historico' &&
        (j.seq == null || Number(j.seq) === seq));
  };

  // Reconciliação conservadora: somente vendas efetivamente concluídas no histórico,
  // identificadas por registro e quantidade. A primeira consulta estabelece uma BASE
  // para a versão nova: não desconta vendas antigas de compras legadas sem data.
  // O estado persistido permite reconhecer vendas ocorridas com o navegador fechado.
  const carregarVendasVistas = () => {
    const v = lsGet(K_VENDAS_VISTAS, {});
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  };
  const dataVenda = v => {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) {
      if (n >= 1.5e12) return n;  // timestamp em milissegundos
      if (n >= 1.5e9 && n < 1e11) return n * 1000; // timestamp em segundos
      return null; // duração relativa ou valor desconhecido: NÃO supor data de expiração
    }
    if (typeof v === 'string') { const t = Date.parse(v); if (Number.isFinite(t)) return t; }
    return null;
  };
  function decodificarVenda(l) {
    if (!l || typeof l !== 'object' || (l.moeda && l.moeda !== 'gold') ||
        (l.tipo && l.tipo !== 'item')) return null;
    const m = /^\s*([\d.]+)\s*[x×]\s*(.+?)\s*$/iu.exec(String(l.descricao || ''));
    if (!m) return null; // Sem quantidade e nome exatos, não deduzir estoque.
    const qtd = Number(m[1].replace(/\./g, ''));
    const nome = m[2].trim(), em = dataVenda(l.em);
    if (!Number.isSafeInteger(qtd) || qtd < 1 || !nome || em == null) return null;
    const id = l.id != null && String(l.id).trim() ? `id:${l.id}` :
      `sem-id:${em}|${chavePedra(nome)}|${qtd}|${String(l.bruto)}|${String(l.valor)}`;
    return { id, nome, qtd, em, itemId: l.itemId };
  }

  function aplicarHistoricoVendas(resposta) {
    if (!resposta || !Array.isArray(resposta.linhas)) throw new Error('histórico de vendas sem linhas verificáveis');
    const memoria = carregarVendasVistas();
    const primeiroAcesso = !memoria.inicializado;
    const inicio = Number.isFinite(memoria.iniciadoEm) ? memoria.iniciadoEm : Date.now() + st.off;
    const vistos = memoria.vistos && typeof memoria.vistos === 'object' && !Array.isArray(memoria.vistos)
      ? { ...memoria.vistos } : {};
    const inv = lerInventario();
    const baixas = {};
    const linhas = resposta.linhas.map(decodificarVenda).filter(Boolean).sort((a, b) => a.em - b.em);
    for (const venda of linhas) {
      if (Object.prototype.hasOwnProperty.call(vistos, venda.id)) continue;
      // Marcar como vista mesmo se o item não estava no inventário.
      vistos[venda.id] = venda.em;
      if (primeiroAcesso || venda.em < inicio - 120000) continue;
      const chave = chavePedra(venda.nome);
      const item = inv[chave];
      if (!item || !Number.isSafeInteger(item.qtd) || item.qtd < 1 ||
          (venda.itemId != null && item.itemId != null && Number(venda.itemId) !== Number(item.itemId)) ||
          (Number.isFinite(item.compradoEm) && venda.em < item.compradoEm - 120000)) continue;
      const tirar = Math.min(venda.qtd, item.qtd);
      const restante = item.qtd - tirar;
      if (!restante) delete inv[chave];
      else inv[chave] = { ...item, qtd: restante,
        custoTotal: Math.round(item.custoTotal * restante / item.qtd) };
      if (!baixas[chave]) baixas[chave] = { nome: item.nome, qtd: 0, restante: 0 };
      baixas[chave].qtd += tirar;
      baixas[chave].restante = restante;
    }
    // Guarda até 5000 IDs; a data inicial impede descontar vendas antigas que
    // aparecerem na primeira página após serem removidas da janela de consulta.
    const ordenados = Object.entries(vistos).sort((a, b) => Number(b[1]) - Number(a[1])).slice(0, 5000);
    lsSet(K_VENDAS_VISTAS, { inicializado: true, iniciadoEm: inicio, vistos: Object.fromEntries(ordenados) });
    if (Object.keys(baixas).length) {
      lsSet(K_INVENTARIO, inv);
      for (const b of Object.values(baixas)) {
        log(L`📦 Venda confirmada: ${Q(b.qtd)} ${P(b.nome)}. Restam ${Q(b.restante)} na REVENDA.`);
      }
      if (ui && ui.atualizarRevenda) ui.atualizarRevenda();
    }
    return { inicial: primeiroAcesso, novas: Object.keys(baixas).length,
      unidades: Object.values(baixas).reduce((s, b) => s + b.qtd, 0) };
  }

  async function conferirVendas({ forcar = false } = {}) {
    if (!st.sock || st.sock.readyState !== 1) return null;
    if (st.vendasEmAndamento) return st.vendasEmAndamento;
    if (!forcar && Date.now() - st.ultimaConferenciaVendas < 30000) return null;
    st.ultimaConferenciaVendas = Date.now();
    const operacao = (async () => aplicarHistoricoVendas(await historicoVendas()))();
    st.vendasEmAndamento = operacao;
    try { return await operacao; }
    finally { if (st.vendasEmAndamento === operacao) st.vendasEmAndamento = null; }
  }

  function agendarConferenciaVendas(delay = 1500) {
    if (!Object.keys(lerInventario()).length) return; // sem estoque, não existe venda para reconciliar
    if (st.timerVendas) clearTimeout(st.timerVendas);
    st.timerVendas = setTimeout(() => {
      st.timerVendas = null;
      conferirVendas({ forcar: true }).catch(e => dbg('Consulta das vendas:', e.message));
    }, delay);
  }
  // 1 consulta por minuto quando existe estoque real para revenda; fora da aba também.
  setInterval(() => {
    if (Object.keys(lerInventario()).length) conferirVendas().catch(e => dbg('Consulta das vendas:', e.message));
  }, 60000);

  // ---------- lógica ----------
  // O servidor só admite pedidos no sorteio APÓS a retenção acabar.
  // Antecipamos as consultas (sem pedir a compra antecipadamente) para enviar
  // a tentativa logo ao liberar; nunca repetimos pedidos sem resposta conclusiva.
  const ANTECEDENCIA_PREPARO_MS = 1800;
  const FOLGA_LIBERACAO_MS = 80;
  const JANELA_SORTEIO_MS = 3000;

  function cancelarRetidos() {
    for (const x of st.retidos.values()) clearTimeout(x.timer);
    st.retidos.clear();
    st.prioridadeRetida = null;
  }

  // A varredura usa uma fila, mas a preparação de uma retenção não deve
  // esperar uma compra anterior levar vários segundos para consultar histórico.
  function naFilaItem(tarefa) {
    const p = st.itemQueue.then(tarefa, tarefa);
    st.itemQueue = p.catch(() => {});
    return p;
  }

  // Revalida a MESMA oferta usando uma resposta nova do servidor, não um snapshot
  // guardado na primeira varredura. Inclui anúncios retidos no cálculo da referência.
  // A opção liberarEm é utilizada para conferir a identidade da retenção no pré-armamento.
  function validarOfertaNaResposta(itemId, ofertaId, resposta, nomeEsperado, modoEsperado, c, liberarEm = null) {
    if (!resposta || resposta.t !== 'market' || resposta.aba !== 'item' ||
        Number(resposta.itemId) !== Number(itemId) || resposta.moeda !== 'gold' ||
        !Array.isArray(resposta.linhas)) return null;
    const abertas = resposta.linhas.filter(x => x.estado === 'aberto' && !x.comprador);
    if (abertas.length < c.minAnuncios || abertas.length < c.amostraMax) return null;
    const item = abertas.find(x => String(x.id) === String(ofertaId));
    if (!item || st.finalizados.has(String(ofertaId)) ||
        !Number.isSafeInteger(Number(item.preco)) || Number(item.preco) <= 0 ||
        !Number.isSafeInteger(Number(item.qtd)) || Number(item.qtd) < 1 ||
        (item.moeda != null && item.moeda !== 'gold') ||
        (c.meuNome && item.vendedor === c.meuNome)) return null;
    // O anúncio original não pode ser substituído por outro nome ou categoria de compra.
    const nome = item.ficha && String(item.ficha.nome || '').trim();
    const modo = modoPedra(nome);
    if (!nome || (nomeEsperado && chavePedra(nome) !== chavePedra(nomeEsperado)) ||
        modo === 'desativado' || (modoEsperado && modo !== modoEsperado)) return null;
    if (liberarEm != null && Number(item.compravelEm) !== Number(liberarEm)) return null;
    const ctx = { nome, abertas, mediana: null };
    if (modo === 'descontos') {
      const calculo = referenciaRecentes(abertas, c.amostraMax);
      if (!calculo) return null;
      ctx.mediana = calculo.referencia;
    }
    const av = avaliarOferta(modo, ctx, item, c);
    const preco = Number(item.preco);
    if (!av.ok || preco > orcamento(c) - st.spent ||
        (!c.dryRun && (!Number.isFinite(st.gold) || preco > st.gold))) return null;
    return { item, cand: candidata(itemId, nome, modo, ctx, av) };
  }

  function validarRetidoNaResposta(itemId, ofertaId, resposta, liberarEm) {
    return validarOfertaNaResposta(itemId, ofertaId, resposta, null, null, cfg(), liberarEm);
  }

  // Sempre busca o estado MAIS RECENTE antes do pedido, inclusive ofertas liberadas.
  // O refresh de retidos passa pela mesma fila de mercado para não misturar respostas
  // de consultas idênticas que rodariam simultaneamente.
  async function consultarOfertaAtual(itemId, origemRetida) {
    const consulta = () => ask(
      { t: 'market.item', itemId, moeda: 'gold' },
      j => j.t === 'market' && j.aba === 'item' && j.itemId === itemId && j.moeda === 'gold'
    );
    return origemRetida ? naFilaItem(consulta) : consulta();
  }

  function avisarCancelamentoRetido(ofertaId, nome) {
    if (st.seen['cancel' + ofertaId]) return;
    st.seen['cancel' + ofertaId] = true;
    log(L`⏭️ Retido ${P(nome)} #${ofertaId} cancelado: oferta não atende à referência atualizada.`);
  }

  async function prepararRetido(itemId, ofertaId, liberarEm, runId, nome) {
    const info = st.retidos.get(ofertaId);
    if (!info || info.runId !== runId || info.liberarEm !== liberarEm ||
        !st.running || st.loopId !== runId || st.finalizados.has(ofertaId)) return;
    if (st.prioridadeRetida || st.activeAttempt) {
      dbg(`Retido #${ofertaId}: outra tentativa em andamento; não envio simultaneamente.`);
      return;
    }
    st.prioridadeRetida = ofertaId;
    info.preparando = true;
    let reavaliarAoFinal = false;
    dbg(`Retido #${ofertaId}: pré-verificação antes da liberação.`);
    try {
      const res = await consultarOfertaAtual(itemId, true);
      if (!st.running || st.loopId !== runId || st.prioridadeRetida !== ofertaId) return;
      const validado = validarRetidoNaResposta(itemId, ofertaId, res, liberarEm);
      if (!validado) {
        reavaliarAoFinal = true;
        avisarCancelamentoRetido(ofertaId, nome);
        dbg(`Retido #${ofertaId}: deixou de atender preço, desconto, saldo, quantidade ou retenção.`);
        return;
      }
      // O histórico inicial é buscado ANTES da liberação para não atrasar o envio.
      const antes = cfg().dryRun ? null : await hist();
      if (!cfg().dryRun && !Number.isSafeInteger(Number(antes && antes.total))) {
        dbg(`Retido #${ofertaId}: histórico sem total verificável; pedido cancelado.`);
        return;
      }
      if (!st.running || st.loopId !== runId || st.prioridadeRetida !== ofertaId) return;
      const resta = liberarEm - nowSrv() + FOLGA_LIBERACAO_MS;
      if (resta > 0) await sleep(resta);
      // Recompõe o pequeno desvio do relógio antes de enviar (se ainda cedo).
      const falta = liberarEm - nowSrv();
      if (falta > 0) await sleep(falta + FOLGA_LIBERACAO_MS);
      if (!st.running || st.loopId !== runId || st.prioridadeRetida !== ofertaId) return;
      const atraso = nowSrv() - liberarEm;
      if (atraso < 0 || atraso >= JANELA_SORTEIO_MS) {
        dbg(`Retido #${ofertaId}: janela de sorteio perdida; pedido não enviado.`);
        return;
      }
      // O buy relê orçamento, desconto, saldo e condição temporal antes do envio.
      dbg(`Retido #${ofertaId}: liberado após ${Math.round(atraso)} ms; envio condicionado à revalidação.`);
      const resultado = await buy(validado.item, validado.cand, cfg(), runId,
        { historicoAntes: antes, origemRetida: true });
      if (resultado === 'reavaliar') reavaliarAoFinal = true;
    } catch (e) {
      dbg(`Retido #${ofertaId}: falha ao preparar liberação (${e.message}).`);
    } finally {
      if (st.prioridadeRetida === ofertaId) st.prioridadeRetida = null;
      // Não apagar timer de um eventual novo horário de retenção.
      if (st.retidos.get(ofertaId) === info) st.retidos.delete(ofertaId);
      // Após cancelar/finalizar a tentativa, volta a examinar o mercado desta pedra.
      // Isso permite encontrar OUTRAS ofertas com desconto no novo preço de referência.
      if (reavaliarAoFinal && st.running && st.loopId === runId && !st.activeAttempt) {
        naFilaItem(() => tryItem(itemId, cfg(), { runId }))
          .catch(e => dbg(`Retido #${ofertaId}: revarredura imediata falhou (${e.message}).`));
      }
    }
  }

  function agendarRetido(itemId, anuncio, runId, nome, descr) {
    const ofertaId = String(anuncio.id);
    const liberarEm = Number(anuncio.compravelEm);
    if (!Number.isFinite(liberarEm) || !Number.isFinite(Number(anuncio.preco))) return;
    if (st.finalizados.has(ofertaId)) return;
    const anterior = st.retidos.get(ofertaId);
    if (anterior && anterior.liberarEm === liberarEm && anterior.runId === runId) return;
    if (anterior) clearTimeout(anterior.timer);
    // Pré-armar ~1,8s ANTES da liberação; enviar somente DEPOIS dela.
    const atraso = Math.max(0, liberarEm - nowSrv() - ANTECEDENCIA_PREPARO_MS);
    const info = { liberarEm, runId, timer: null, preparando: false };
    info.timer = setTimeout(() => {
      if (st.retidos.get(ofertaId) !== info) return;
      prepararRetido(itemId, ofertaId, liberarEm, runId, nome);
    }, Math.min(atraso, 2147483647));
    st.retidos.set(ofertaId, info);
    st.seen['r' + ofertaId] = true;
    if (!avisoJaMostrado(ofertaId)) {
      marcarAviso(ofertaId);
      const hora = new Date(liberarEm - st.off).toLocaleTimeString('pt-BR');
      log([...L`🔒 Retido: ${P(nome)} #${ofertaId}, `, ...descr,
        ...L`, ${G(Number(anuncio.preco))}/un. Libera por volta das ${hora}. Preparação programada.`]);
    }
  }

  function stop(why) {
    st.running = false;
    st.loopId++; // invalida consultas da sessão anterior
    cancelarRetidos();
    log('PARADO: ' + why);
  }

  async function scan(c) {
    if (!existePedraAtiva()) {
      st.lastScan = 'Pedras desativadas: sem consultas market.itens / market.item';
      render();
      return;
    }
    const ids = String(c.itemIds).split(',').map(s => s.trim()).filter(Boolean);
    let analisadas = 0, poucas = 0, hits = 0;
    for (const cat of String(c.categorias).split(',').map(s => s.trim()).filter(Boolean)) {
      const r = await ask(
        { t: 'market.itens', elementos: [], categoria: cat },
        j => j.t === 'market' && j.aba === 'itens', 12000,
        () => st.running && existePedraAtiva()
      );
      // só interessa item que tenha pelo menos um anúncio (minGold presente) e não esteja na lista de excluídas
      const lista = Object.entries(r.resumo || {})
        .filter(([id, x]) => x && x.minGold && !st.excl.has(+id) && (!ids.length || ids.includes(id)))
        .map(([id]) => +id);

      for (const id of lista) {
        if (!st.running) return;
        const runId = st.loopId;
        if (!existePedraAtiva()) return;
        const res = await naFilaItem(() => tryItem(id, c, { runId }));
        if (res.excl) { await sleep(600); continue; }
        if (res.amostra) analisadas++; else poucas++;
        hits += res.hits;
        await sleep(600);
      }
    }
    st.lastScan = `Última varredura ${new Date().toLocaleTimeString('pt-BR')}: ${analisadas} pedras analisadas, ` +
      `${hits} oportunidade${hits === 1 ? '' : 's'}`;
    render();
  }

  // diagnóstico técnico (só console), 3 primeiras pedras de cada sessão
  function diag(id, r, linhas) {
    if (st.diagN >= 3 || !linhas[0]) return;
    st.diagN++;
    const precos = linhas.map(l => l.preco);
    const cres = precos.every((p, i) => i === 0 || p >= precos[i - 1]);
    dbg(`diagnóstico item ${id}: ${linhas.length} anúncios; chaves da resposta [${Object.keys(r).join(', ')}]; ` +
      `preços ${cres ? 'em ordem crescente' : 'fora de ordem'} (${fmt(Math.min(...precos))} a ${fmt(Math.max(...precos))})` +
      (st.diagN === 1 ? `; campos do anúncio: ${Object.keys(linhas[0]).join(', ')}` : ''));
  }

  // Avalia UMA pedra: referência dos 7 mais recentes da consulta → só compra abaixo do limite.
  async function tryItem(id, c, opts = {}) {
    const runId = opts.runId == null ? st.loopId : opts.runId;
    if (!st.running || runId !== st.loopId) return { amostra: false, hits: 0 };
    const r = await ask(
      { t: 'market.item', itemId: id, moeda: 'gold' },
      j => j.t === 'market' && j.aba === 'item' && j.itemId === id && j.moeda === 'gold',
      12000, () => st.running && existePedraAtiva()
    );
    if (!st.running || runId !== st.loopId) return { amostra: false, hits: 0 };
    const linhas = r.linhas || [];
    diag(id, r, linhas);

    const abertas = linhas.filter(l => l.estado === 'aberto' && !l.comprador);
    const fichaNome = (abertas.find(l => l.ficha && l.ficha.nome) || {}).ficha;
    const nomeItem = fichaNome ? String(fichaNome.nome).trim() : '';
    // Sem nome confiável, não podemos garantir que não seja uma das pedras excluídas.
    if (!nomeItem) {
      dbg(`Item ${id}: sem nome confirmado; mediana indisponível e compra bloqueada.`);
      return { amostra: false, hits: 0 };
    }
    registrarPedra(nomeItem);
    if (pedraBloqueada(nomeItem, c)) {
      st.excl.add(id);
      // Pedra excluída: sem aviso no painel; continua bloqueada na lógica.
      dbg('pedra excluída, não será mais consultada:', nomeItem, '(item ' + id + ')');
      return { excl: true, hits: 0 };
    }
    // Alimenta a tabela da REVENDA (menor preço concorrente) com o que a varredura já consultou.
    atualizarMercado(nomeItem, id, abertas, c);
    // Cada pedra tem um modo: DESCONTOS (mediana) ou REVENDA (trava de saída); desativadas ficam de fora.
    const modo = modoPedra(nomeItem);
    if (modo === 'desativado') return { amostra: false, hits: 0 };
    // Preserva o mínimo de anúncios disponíveis para autorizar compras.
    if (abertas.length < c.amostraMax) {
      dbg(`Referência de ${nomeItem || 'item ' + id}: indisponível (${abertas.length} anúncio(s); mínimo ${c.amostraMax}).`);
      return { amostra: false, hits: 0 };
    }

    // DESCONTOS usa sua referência especial (regra de 50+).
    // REVENDA exige mediana SIMPLES dos 7 recentes E competitividade contra lote de 30+.
    const ctx = { nome: nomeItem, abertas, mediana: null };
    let mediana = null, limite = null, amostra = [];
    if (modo === 'descontos') {
      // O servidor pode ordenar ofertas por preço; a amostra precisa ser ordenada por DATA.
      // Considera apenas os 7 mais recentes DENTRE os anúncios retornados pelo servidor.
      const calculo = referenciaRecentes(abertas, c.amostraMax);
      if (!calculo) {
        dbg(`Referência de ${nomeItem || 'item ' + id}: indisponível (datas, preços ou quantidades inválidos; compra bloqueada).`);
        return { amostra: false, hits: 0 };
      }
      amostra = calculo.amostra;
      ctx.mediana = mediana = calculo.referencia;
      const desconto = descontoDaPedra(nomeItem, c);
      if (desconto == null) return { amostra: false, hits: 0 };
      limite = Math.floor(mediana * (1 - desconto / 100));
      // O diagnóstico detalhado permanece no console; no painel, só quando houver
      // uma oferta comprável com o desconto mínimo configurado.
      dbg('Referência atual dos 7 mais recentes da consulta', nomeItem || id,
        { referencia: mediana,
          amostra: amostra.map(l => ({ id: l.id, criadoEm: l[calculo.campo], preco: l.preco, qtd: l.qtd })) });
    }
    if (abertas.length < c.minAnuncios) {
      dbg(`${nomeItem || 'item ' + id}: apenas ${abertas.length} anúncios (mínimo para comprar: ${c.minAnuncios}); compra ignorada.`);
      return { amostra: false, hits: 0 };
    }
    const t = nowSrv();
    const baratos = abertas
      .filter(l => avaliarOferta(modo, ctx, l, c).ok &&
        (!opts.soOferta || String(l.id) === opts.soOferta) &&
        !st.finalizados.has(String(l.id)) &&
        (!c.meuNome || l.vendedor !== c.meuNome) &&
        (!st.skip[l.id] || Date.now() - st.skip[l.id] > 60000))
      .sort((a, b) => a.preco - b.preco);


    if (opts.soOferta && baratos.length === 0 && st.seen['r' + opts.soOferta] &&
        !st.finalizados.has(String(opts.soOferta))) {
      st.finalizados.add(String(opts.soOferta));
      dbg(`Oferta #${opts.soOferta}: acompanhamento encerrado (sumiu, mudou ou perdeu desconto).`);
    }

    let oportunidadesCompraveis = 0;
    for (const l of baratos) {
      if (!st.running || runId !== st.loopId) break;
      const nome = (l.ficha && l.ficha.nome) || nomeItem || 'item ' + id;
      const av = avaliarOferta(modo, ctx, l, c);   // DESCONTOS: pct; REVENDA: preço ideal e lote de referência
      const pct = av.pct;
      const retido = l.compravelEm && t < l.compravelEm;     // anúncio "Retido": ainda não dá para comprar
      if (retido) {
        // Evita acompanhar/anunciar uma oferta acima do orçamento ainda disponível.
        const atualRetido = cfg();
        if (modoPedra(nomeItem) !== modo ||
            Number(l.preco) > orcamento(atualRetido) - st.spent ||
            !avaliarOferta(modo, ctx, l, atualRetido).ok ||
            (!atualRetido.dryRun && (st.gold == null || Number(l.preco) > st.gold))) continue;
        // Mantém uma tentativa de reavaliação no horário de liberação e a
        // varredura normal como contingência; não envia compra antecipada.
        agendarRetido(id, l, runId, nome, modo === 'revenda'
          ? [{ s: `revenda, ${av.descontoReal.toFixed(1).replace('.', ',')}% abaixo da referência; saída ideal ` }, G(av.ideal)]
          : [{ s: `${pct}%`, k: 'pct' }, { s: ' de desconto' }]);
        continue;
      }
      // A oferta retida já pode estar sendo preparada em paralelo.
      // Não remover seu timer nem disputar a compra no loop normal.
      const pendente = st.retidos.get(String(l.id));
      if (pendente) {
        if (!pendente.preparando) {
          // Se o Chrome atrasou o timer, prioriza a preparação agora,
          // em vez de cair na consulta lenta da varredura normal.
          clearTimeout(pendente.timer);
          prepararRetido(id, String(l.id), pendente.liberarEm, runId, nome)
            .catch(e => dbg(`Retido #${l.id}: ${e.message}`));
        }
        continue;
      }

      // Liberação não produz novo aviso: já houve uma mensagem de Retido.
      // Só anunciar ofertas realmente elegíveis. Pedras sem desconto, retidas,
      // sem quantidade ou sem saldo continuam silenciosas no painel.
      const atual = cfg();
      const podeComprar = modoPedra(nomeItem) === modo &&
        l.preco > 0 && l.qtd > 0 &&
        avaliarOferta(modo, ctx, l, atual).ok &&
        l.preco <= orcamento(atual) - st.spent &&
        (atual.dryRun || (st.gold != null && l.preco <= st.gold));
      if (podeComprar) {
        oportunidadesCompraveis++;
        if (!avisoJaMostrado(l.id)) {
          st.seen['i' + l.id] = 1;
          marcarAviso(l.id);
          if (modo === 'revenda') {
            log([...L`Identifiquei ${P(nome)} para revenda com `,
              { s: `${av.descontoReal.toFixed(1).replace('.', ',')}%`, k: 'pct' },
              ...L` abaixo da mediana: ${Q(l.qtd)} un. a ${G(l.preco)} cada; saída ideal `,
              G(av.ideal), ...L` (referência `, G(av.medianaSaida), { s: ')' }]);
          } else {
            log([...L`Identifiquei ${P(nome)} com `,
              { s: `${pct}%`, k: 'pct' },
              ...L` de desconto: ${Q(l.qtd)} unidades a ${G(l.preco)} cada`]);
          }
        }
      }
      if (!st.running || runId !== st.loopId) break;
      if (podeComprar) await buy(l, candidata(id, nome, modo, ctx, av), c, runId);
    }
    return { amostra: true, hits: oportunidadesCompraveis };
  }

  function comprasNoHistorico(before, after, tentativa) {
    const antes = Number(before && before.total), depois = Number(after && after.total);
    if (!Number.isSafeInteger(antes) || !Number.isSafeInteger(depois) || depois <= antes) return [];
    const acrescimo = depois - antes;
    const novas = Array.isArray(after.linhas) ? after.linhas.slice(0, acrescimo) : [];
    return novas.filter(x => {
      const bruto = Number(x.bruto);
      const valorValido = Number.isFinite(bruto) && bruto > 0 &&
        bruto <= tentativa.custo && bruto % tentativa.precoUnitario === 0;
      // Sem ID na linha do histórico, exigir NOME e VALOR coerentes.
      const idValido = x.anuncioId == null || String(x.anuncioId) === tentativa.ofertaId;
      const nomeValido = (tentativa.pk && x.anuncioId != null) || descricaoConfere(x.descricao, tentativa.nome);
      return idValido && valorValido && nomeValido;
    });
  }

  // Lote por anúncio: usa o estoque do anúncio e o menor dos limites de
  // orçamento restante e Coins disponíveis. Não há limite fixo de 1 ou 50.
  // A função é chamada NOVAMENTE após consultar o histórico, imediatamente
  // antes de enviar a compra (configurações e saldo podem mudar nesse meio-tempo).
  function calcularLote(l, atual) {
    const preco = Number(l.preco), estoque = Number(l.qtd);
    const restante = orcamento(atual) - st.spent;
    if (!Number.isSafeInteger(preco) || preco <= 0 ||
        !Number.isSafeInteger(estoque) || estoque <= 0 ||
        !Number.isSafeInteger(restante) || restante < preco) return null;
    const qOrc = Math.floor(restante / preco);
    const qGold = atual.dryRun ? Number.MAX_SAFE_INTEGER :
      (Number.isFinite(st.gold) && st.gold >= 0 ? Math.floor(st.gold / preco) : 0);
    const qtd = Math.min(estoque, qOrc, qGold);
    const custo = qtd * preco;
    if (!Number.isSafeInteger(qtd) || qtd < 1 ||
        !Number.isSafeInteger(custo) || custo > restante ||
        (!atual.dryRun && custo > st.gold)) return null;
    return { preco, qtd, custo, restante };
  }

  async function buy(l, cand, c, runId = st.loopId, opts = {}) {
    if (!st.running || runId !== st.loopId || st.finalizados.has(String(l.id))) return;
    if (st.prioridadeRetida && st.prioridadeRetida !== String(l.id)) return;
    const atualNaTentativa = cfg();
    const restante = orcamento(atualNaTentativa) - st.spent;
    if (restante < 1) return stop('saldo para compras esgotado');
    const nome = cand.nome, modo = cand.modo;
    if (modoPedra(nome) !== modo) {
      dbg(`Oferta #${l.id}: modo da pedra mudou; tentativa cancelada.`);
      return;
    }
    const loteInicial = calcularLote(l, atualNaTentativa);
    if (!loteInicial || !avaliarOferta(modo, cand, l, atualNaTentativa).ok) return;
    if (!atualNaTentativa.dryRun && st.activeAttempt) {
      dbg('Outra compra em andamento; não envio outro pedido.');
      return;
    }

    // Consulta histórico só em compra REAL. A última consulta market.item acontece
    // DEPOIS do histórico, para que a referência nunca fique congelada durante a espera.
    let before = opts.historicoAntes || null;
    if (!atualNaTentativa.dryRun) {
      st.skip[l.id] = Date.now();
      if (!before) {
        try { before = await hist(); }
        catch(e) { log(`Não consegui consultar histórico antes do pedido #${l.id}: ${e.message}`); return; }
      }
      if (!st.running || runId !== st.loopId) return;
      if (!Number.isSafeInteger(Number(before.total))) {
        log(`Histórico inicial sem contador confiável; compra #${l.id} não enviada.`); return;
      }
    }

    // REFRESH OBRIGATÓRIO: a cada tentativa relê todos os anúncios da pedra,
    // calcula novamente os 7 mais recentes (inclusive novos retidos) e só então
    // decide sobre compra. Nenhum candidato carrega a referência antiga para o envio.
    let respostaAtual;
    try { respostaAtual = await consultarOfertaAtual(cand.id, !!opts.origemRetida); }
    catch (e) {
      dbg(`Oferta #${l.id}: mercado não respondeu ao refresh; nenhuma compra enviada (${e.message}).`);
      return;
    }
    if (!st.running || runId !== st.loopId) return;
    const aoEnviar = cfg();
    const validado = validarOfertaNaResposta(cand.id, l.id, respostaAtual, nome, modo, aoEnviar);
    if (!validado || Number(validado.item.preco) !== loteInicial.preco) {
      dbg(`Oferta #${l.id}: referência, anúncio, preço ou desconto mudou; compra cancelada.`);
      if (opts.origemRetida) avisarCancelamentoRetido(l.id, nome);
      return 'reavaliar';
    }
    // A oferta pode ter sido alterada: quantidade e orçamento devem ser recalculados
    // a partir do ESTOQUE FRESCO (nunca só do snapshot da primeira varredura).
    const ofertaAtual = validado.item;
    const candAtual = validado.cand;
    const loteAoEnviar = calcularLote(ofertaAtual, aoEnviar);
    const qtd = loteAoEnviar ? Math.min(loteInicial.qtd, loteAoEnviar.qtd) : 0;
    const preco = loteInicial.preco;
    const custo = qtd * preco;
    const restanteAoEnviar = orcamento(aoEnviar) - st.spent;
    // Não faz compra de anúncio ainda retido e nem depois da janela de sorteio.
    const liberacao = Number(ofertaAtual.compravelEm);
    const retidoAgora = ofertaAtual.compravelEm != null && Number.isFinite(liberacao) && liberacao > nowSrv();
    const foraDaJanela = !!opts.origemRetida && (!Number.isFinite(Number(l.compravelEm)) ||
      nowSrv() - Number(l.compravelEm) < 0 || nowSrv() - Number(l.compravelEm) >= JANELA_SORTEIO_MS);
    const bloqueado = (st.prioridadeRetida && st.prioridadeRetida !== String(l.id)) || st.activeAttempt ||
      !loteAoEnviar || qtd < 1 || !Number.isSafeInteger(custo) || custo > restanteAoEnviar ||
      modoPedra(nome) !== modo || aoEnviar.dryRun !== atualNaTentativa.dryRun ||
      !avaliarOferta(modo, candAtual, ofertaAtual, aoEnviar).ok ||
      retidoAgora || foraDaJanela || (!aoEnviar.dryRun && (Date.now() < st.marketPausaAte || !Number.isFinite(st.gold) || custo > st.gold ||
      !st.sock || st.sock.readyState !== 1));
    if (bloqueado) {
      dbg(`Pedido #${l.id} NÃO enviado: referência, orçamento, estoque, saldo ou retenção inválida.`);
      return 'reavaliar';
    }
    if (aoEnviar.dryRun) {
      if (!st.seen[l.id]) {
        st.seen[l.id] = 1;
        st.spent += custo;
        if (modo === 'revenda') registrarSimulado(nome, cand.id, qtd, custo);
        log(L`🧪 Simulação: tentaria comprar ${Q(qtd)} ${P(nome)} por ${G(custo)} (${candAtual.detalhe}). Não entrou em sorteio.`);
        if (orcamento(cfg()) - st.spent < 1) stop('saldo simulado esgotado');
      }
      return;
    }
    const a = {
      ofertaId: String(l.id), nome, itemId: cand.id, precoUnitario: preco, qtd, custo,
      entrou: false, lista: false, sorteioMostrado: false, resultadoMostrado: false,
      venceuSorteio: null, recibo: false, valorRecebido: null, enviadoEm: Date.now()
    };
    st.activeAttempt = a;
    log(L`🛒 Tentando comprar ${P(nome)} #${l.id}: ${Q(qtd)} un. por ${G(custo)}; ${candAtual.detalhe}.`);
    try {
      st.marketUltimoEnvio = Date.now();
      osend.call(st.sock, JSON.stringify({
        t: 'market.comprar', id: l.id, qtd, preco, moeda: 'gold', sorteioUi: c.sorteioUi
      }));
    } catch (e) {
      st.activeAttempt = null;
      st.finalizados.add(a.ofertaId); // envio incerto: não repetir cegamente
      log(`Falha/resultado incerto no envio #${l.id}: ${e.message}. Não vou repetir automaticamente.`);
      return;
    }
    dbg(`Pedido #${l.id} enviado; aguardando sorteio e confirmação no histórico.`);

    // Consulta o histórico ao longo de alguns segundos, incluindo depois da janela do sorteio.
    // A ausência de compra isoladamente NÃO significa perda no sorteio.
    let verificou = false, achadas = [], erroHistorico = null;
    for (const demora of [1600, 2300, 2400, 2800]) {
      await sleep(demora);
      try {
        const after = await hist();
        verificou = true;
        achadas = comprasNoHistorico(before, after, a);
        if (achadas.length && (a.recibo || a.venceuSorteio === true)) break;
        if (a.venceuSorteio === false) break;
      } catch (e) { erroHistorico = e; }
    }
    // Pode ter parado enquanto aguardava; resultado continua sendo auditável.
    const identificada = achadas.length > 0 && (a.recibo || a.venceuSorteio === true);
    if (identificada) {
      const paid = achadas.reduce((s,x)=>s+Number(x.bruto),0);
      st.spent += paid;
      st.fails = 0;
      // REVENDA: o que foi comprado de verdade entra no inventário, com o custo pago.
      if (modo === 'revenda') registrarCompraInventario(nome, cand.id, Math.round(paid / preco), paid);
      // O histórico confirma o gasto; mostrar apenas VITORIA se o servidor não
      // tiver mostrado antes (compra direta ou sem evento de sorteio).
      mostrarResultado(a, true);
      dbg(`Histórico confirmou #${l.id}: ${fmt(paid)} Coins.`);
      if (orcamento(cfg()) - st.spent < 1 && st.running) stop('saldo para compras esgotado');
    } else if (a.venceuSorteio === false) {
      st.fails = 0; // derrota legítima no sorteio não é falha de comunicação
      mostrarResultado(a, false);
      if (achadas.length) log(L`⚠️ ${P(nome)} #${l.id}: histórico contém compra semelhante apesar de derrota no sorteio; conferir manualmente.`);
    } else if (achadas.length) {
      log(L`⚠️ ${P(nome)} #${l.id}: encontrei compra compatível no histórico, mas faltou evento do servidor vinculando-a ao pedido. Confira manualmente.`);
    } else {
      st.fails++;
      // Sem evidência suficiente do gasto, bloqueia novas compras reais nesta sessão.
      // Isso evita ultrapassar o orçamento por contar uma compra possivelmente realizada como zero.
      if (st.running) stop('resultado de compra inconclusivo; confira histórico antes de reativar');
      const detalhe = a.venceuSorteio === true ? 'Servidor informou vitória, mas histórico ainda não confirmou.' :
        a.recibo ? 'Servidor informou compra, mas histórico ainda não confirmou.' :
        a.entrou ? 'Entrou no sorteio, mas não recebi desfecho verificável.' :
        'Sem confirmação de entrada ou compra; não é possível afirmar que perdeu.';
      log(L`⚠️ Resultado INDETERMINADO de ${P(nome)} #${l.id}. ${detalhe}${erroHistorico && !verificou ? ' Falha ao consultar histórico.' : ''} Não repetir automaticamente.`);
      if (st.fails >= c.maxFails && st.running) stop(`${c.maxFails} resultados sem confirmação`);
    }
    st.finalizados.add(a.ofertaId);
    if (st.activeAttempt === a) st.activeAttempt = null;
  }

  // =====================================================================================
  // POKEMON: compra automática de anúncios MUITO abaixo do preço (limite fixo, sem mediana)
  // =====================================================================================
  // O protocolo de listagem de Pokémon não é conhecido de antemão. Por isso o bot APRENDE a consulta:
  // quando você abre o mercado de Pokémon no jogo, a mensagem enviada pelo jogo (e o nome da 'aba' da
  // resposta) são guardados e depois repetidos pelo bot (somente leitura). Compras usam o mesmo
  // 'market.comprar' das pedras, com qtd 1.
  const ABAS_PEDRAS = ['item', 'historico', 'historicoCompras'];
  const ROTAS_QUE_NAO_SAO_LISTAGEM = /comprar|vender|anunciar|cancelar|criar|retirar|historico|resgatar|coletar/i;

  // Nomes tolerantes: o primeiro campo existente (em ficha, pokemon, item, dados ou no próprio anúncio) vence.
  const CAMPOS_POKE = {
    especie: ['especie', 'espécie', 'species', 'nome', 'name', 'pokemon'],
    nivel: ['nivel', 'nível', 'level', 'lvl', 'lv'],
    shiny: ['shiny', 'brilhante', 'isShiny', 'shinny'],
    icone: ['sprite', 'icone', 'icon', 'imagem', 'img', 'url'],
    dex: ['dex', 'dexId', 'especieId', 'speciesId', 'pokemonId', 'numero']
  };

  const pokeAtivo = () => lsGet(K_POKE_ATIVO, false) === true;
  const setPokeAtivo = v => lsSet(K_POKE_ATIVO, !!v);
  const limitePoke = (c = cfg()) => {
    const v = Math.round(Number(c.pokeLimiteM) * 1e6);
    return Number.isSafeInteger(v) && v > 0 ? v : 0;
  };
  const logPk = m => log(m, true);

  const pokeTemplate = () => FIXO.pokeReq && FIXO.pokeAba
    ? { req: FIXO.pokeReq, aba: FIXO.pokeAba } : (st.pokeTpl && st.pokeTpl.req ? st.pokeTpl : null);

  // Mensagem de listagem de Pokémon enviada PELO JOGO (o bot usa o send original e não passa por aqui).
  function aprenderConsultaPokemon(d) {
    if (typeof d !== 'string' || !d.startsWith('{"t":"market.')) return;
    let j; try { j = JSON.parse(d); } catch { return; }
    const t = String(j.t || '');
    if (ROTAS_QUE_NAO_SAO_LISTAGEM.test(t) || t === 'market.item') return;
    const ehPoke = /poke/i.test(t) || /(^|\.)mons?$/i.test(t) || /poke/i.test(String(j.categoria || '')) ||
      /^poke/i.test(String(j.tipo || ''));   // ex.: {"t":"market.listar","tipo":"pokemon",...}
    if (!ehPoke) return;
    st.pokeAprender = { req: j, ate: Date.now() + 10000 };
  }

  // A primeira resposta de mercado após essa consulta revela o nome da 'aba' (e prova que há 'linhas').
  function aprenderRespostaPokemon(j) {
    const ap = st.pokeAprender;
    if (!ap || Date.now() > ap.ate || !Array.isArray(j.linhas)) return;
    const categoriaPoke = /poke/i.test(String(ap.req.categoria || ''));
    if (ABAS_PEDRAS.includes(j.aba) || (j.aba === 'itens' && !categoriaPoke)) return;
    st.pokeAprender = null;
    st.pokeTpl = { req: ap.req, aba: j.aba };
    lsSet(K_POKE_TPL, st.pokeTpl);
    st.pokeAvisos.semConsulta = false;
    logPk(`📡 POKEMON: consulta aprendida do jogo (${ap.req.t}, aba “${j.aba}”).`);
    if (ui && ui.atualizarPokemon) ui.atualizarPokemon();
  }

  function consultarPokemon(viaFila) {
    const tpl = pokeTemplate();
    if (!tpl) return Promise.reject(new Error('consulta de Pokémon ainda não aprendida'));
    const req = { ...tpl.req };
    if ('ordem' in req) req.ordem = 'baratos';   // sempre do mais barato, mesmo que você tenha mudado a ordem no jogo
    let seq = null;
    if ('seq' in req) { seq = ++st.seq; req.seq = seq; }
    const consulta = () => ask(req, j => j.t === 'market' && j.aba === tpl.aba &&
      Array.isArray(j.linhas) && (seq == null || j.seq == null || Number(j.seq) === seq),
      12000, () => st.running && pokeAtivo());
    return viaFila ? naFilaItem(consulta) : consulta();
  }

  // ---------- leitura dos atributos do anúncio ----------
  function fontesDoAnuncio(l) {
    const base = [l && l.ficha, l && l.pokemon, l && l.poke, l && l.item, l && l.dados, l]
      .filter(o => o && typeof o === 'object');
    const nested = [];
    for (const o of base) for (const k of ['pokemon', 'especie', 'species'])
      if (o[k] && typeof o[k] === 'object') nested.push(o[k]);
    return [...base.slice(0, -1), ...nested, base[base.length - 1]].filter(Boolean);
  }
  function campoPoke(l, chaves) {
    for (const f of fontesDoAnuncio(l))
      for (const k of chaves) {
        const v = f[k];
        if (v != null && v !== '' && typeof v !== 'object') return v;
      }
    return null;
  }
  const spriteDex = (dex, shiny) => `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${shiny ? 'shiny/' : ''}${dex}.png`;

  // Retorna null se o anúncio não for legível com segurança (sem espécie, preço ou quantidade válidos).
  function lerPokemon(l) {
    if (!l || typeof l !== 'object') return null;
    const preco = Number(l.preco);
    if (!Number.isSafeInteger(preco) || preco <= 0) return null;
    const qtd = l.qtd == null ? 1 : Number(l.qtd);
    if (!Number.isSafeInteger(qtd) || qtd < 1) return null;
    let especie = campoPoke(l, CAMPOS_POKE.especie);
    if (especie == null) return null;
    especie = String(especie).trim();
    const sv = campoPoke(l, CAMPOS_POKE.shiny);
    let shiny = sv === true || sv === 1 || ['1', 'true', 'sim', 'yes', 'shiny'].includes(String(sv).toLowerCase());
    const m = /^shiny\s+(.+)$/i.exec(especie);
    if (m) { shiny = true; especie = m[1].trim(); }
    if (!especie || /^\d+$/.test(especie)) return null;
    const nb = campoPoke(l, CAMPOS_POKE.nivel);
    const nivel = nb != null && Number.isFinite(Number(nb)) ? Number(nb) : null;
    let icone = campoPoke(l, CAMPOS_POKE.icone);
    if (!(typeof icone === 'string' && /^(https?:|\/|data:image)/.test(icone))) {
      // Se o jogo não fornecer URL, tenta o sprite nacional SOMENTE quando o identificador
      // é plausível. IDs internos como speciesId=13359 NÃO são números da Pokédex.
      const dexBruto = Number(campoPoke(l, ['dex', 'dexId', 'numeroNacional']));
      const looktype = Number(campoPoke(l, ['looktype']));
      const especieInterna = Number(campoPoke(l, ['speciesId', 'especieId']));
      let dex = Number.isSafeInteger(dexBruto) && dexBruto >= 1 && dexBruto <= 1025 ? dexBruto : null;
      // Exemplo real: Absol looktype 60359 e speciesId 13359 concordam no sufixo 359.
      if (!dex && Number.isSafeInteger(looktype) && looktype >= 60001 && looktype <= 61025 &&
          Number.isSafeInteger(especieInterna) && especieInterna % 1000 === looktype % 1000)
        dex = looktype - 60000;
      icone = dex ? spriteDex(dex, shiny) : null;
    }
    const rotulo = `${shiny ? '✨ ' : ''}${especie}${nivel != null ? ` Nv.${nivel}` : ''}`;
    return { id: String(l.id), idRaw: l.id, preco, qtd, especie, nivel, shiny, icone, rotulo,
      vendedor: l.vendedor, compravelEm: l.compravelEm,
      grupo: `${chavePedra(especie)}|${shiny ? 'S' : 'N'}` };   // Shiny nunca se mistura com Normal
  }
  // ---------- potência, qualidade, IV somado e nota (ficha do Pokémon) ----------
  // Nomes tolerantes, como em CAMPOS_POKE. Mantidos em linhas separadas para ajustar fácil se o jogo usar outros.
  const CAMPOS_FICHA = {
    potencia: ['potencia', 'potência', 'pi', 'power', 'poder'],
    qualidade: ['qualidade', 'quality'],
    nota: ['nota', 'grade', 'score', 'rank'],
    ivTotal: ['ivTotal', 'ivSoma', 'ivSomado', 'ivSum', 'iv', 'ivs']
  };
  function campoBruto(l, chaves) {   // como campoPoke, mas aceita objetos/listas (IVs por atributo)
    for (const f of fontesDoAnuncio(l))
      for (const k of chaves) { const v = f[k]; if (v != null && v !== '') return v; }
    return null;
  }
  const numOuNull = v => (v == null || v === '' || typeof v === 'object' || !Number.isFinite(Number(v))) ? null : Number(v);
  function somarIvs(l) {
    const v = campoBruto(l, CAMPOS_FICHA.ivTotal);
    let valores = null;
    if (Array.isArray(v)) valores = v;
    else if (v && typeof v === 'object') valores = Object.values(v);
    else if (v != null) return numOuNull(v);   // número único: assume que já é o IV somado
    if (!valores) {   // sem campo agrupado: soma campos soltos tipo ivHp, iv_atk...
      valores = [];
      for (const f of fontesDoAnuncio(l))
        for (const [k, x] of Object.entries(f)) if (/^iv[_A-Z]/.test(k) && numOuNull(x) != null) valores.push(x);
    }
    const nums = valores.map(numOuNull).filter(x => x != null);
    return nums.length ? nums.reduce((a, b) => a + b, 0) : null;
  }
  function lerFicha(l) {
    const nota = campoBruto(l, CAMPOS_FICHA.nota), q = campoBruto(l, CAMPOS_FICHA.qualidade), pot = campoBruto(l, CAMPOS_FICHA.potencia);
    return {
      potencia: numOuNull(pot) ?? (typeof pot === 'string' ? pot : null),
      qualidade: numOuNull(q) ?? (typeof q === 'string' ? q : null),
      iv_somado: somarIvs(l),
      nota: nota != null && typeof nota !== 'object' ? nota : null
    };
  }
  const abertoPoke = l => l && (l.estado == null || l.estado === 'aberto') && !l.comprador;

  // Mediana INFORMATIVA do grupo (mesma espécie + mesmo status Shiny/Normal), sem o próprio anúncio.
  function medianaDoGrupo(todos, p) {
    const precos = todos.filter(x => x.grupo === p.grupo && x.id !== p.id).map(x => x.preco);
    return precos.length >= 3 ? { mediana: medianaDe(precos), n: precos.length } : null;
  }

  // VALIDAÇÃO: o anúncio precisa existir na resposta NOVA, aberto, sem comprador, de outro vendedor,
  // legível, com o mesmo preço visto antes, quantidade 1 e preço estritamente abaixo do limite.
  function validarPokemon(resposta, id, precoEsperado, c, liberarEm = null) {
    if (!resposta || resposta.t !== 'market' || !Array.isArray(resposta.linhas)) return null;
    if (!pokeAtivo() || st.finalizados.has(String(id))) return null;
    const l = resposta.linhas.find(x => String(x.id) === String(id));
    if (!abertoPoke(l) || (l.moeda != null && l.moeda !== 'gold') || (c.meuNome && l.vendedor === c.meuNome)) return null;
    const p = lerPokemon(l), limite = limitePoke(c);
    if (!p || !limite || p.preco >= limite || p.qtd !== 1 || p.preco !== Number(precoEsperado)) return null;
    if (liberarEm != null && Number(l.compravelEm) !== Number(liberarEm)) return null;
    return { item: l, p, limite };
  }

  // ---------- inventário de Pokémon ----------
  const lerInvPoke = () => { const v = lsGet(K_POKE_INV, []); return Array.isArray(v) ? v : []; };
  function registrarPokemonComprado(p, custo) {
    const inv = lerInvPoke().filter(x => x.id !== p.id);
    inv.push({ id: p.id, especie: p.especie, nivel: p.nivel, shiny: p.shiny, icone: p.icone, custo, em: nowSrv() });
    lsSet(K_POKE_INV, inv.slice(-500));
    if (ui && ui.atualizarPokemon) ui.atualizarPokemon();
  }

  // ---------- varredura ----------
  async function tryPokemon(c, opts = {}) {
    const runId = opts.runId == null ? st.loopId : opts.runId;
    const comprar = pokeAtivo();
    if (!comprar || !st.running || runId !== st.loopId) return { hits: 0 };
    if (!pokeTemplate()) {
      if (comprar && !st.pokeAvisos.semConsulta) {
        st.pokeAvisos.semConsulta = true;
        logPk('ℹ️ POKEMON ligado, mas a consulta ainda não foi aprendida. Abra o mercado de Pokémon no jogo (ordenado pelo mais barato).');
      }
      return { hits: 0 };
    }
    const limite = limitePoke(c);
    if (!limite) return { hits: 0 };
    const r = await consultarPokemon(false);
    if (!st.running || runId !== st.loopId) return { hits: 0 };
    const abertas = (r.linhas || []).filter(abertoPoke);
    const lidos = abertas.map(lerPokemon).filter(Boolean);

    if (abertas.length && !lidos.length) {
      if (!st.pokeAvisos.ilegivel) {
        st.pokeAvisos.ilegivel = true;
        logPk(`⚠️ POKEMON: não consegui ler a espécie dos anúncios (campos: ${Object.keys(abertas[0]).join(', ')}` +
          `${abertas[0].ficha ? '; ficha: ' + Object.keys(abertas[0].ficha).join(', ') : ''}). Nenhuma compra será feita.`);
      }
      return { hits: 0, lidos: 0 };
    }
    // Diagnóstico único por sessão: um anúncio COMPLETO (todos os campos: IVs, nota, qualidade...)
    // e, se houver, uma linha NÃO aberta (possível venda concluída) para descobrir onde estão as vendas.
    if (!st.pokeAvisos.bruto && (r.linhas || []).length) {
      st.pokeAvisos.bruto = true;
      const cortar = o => { try { return JSON.stringify(o).slice(0, 1500); } catch { return '?'; } };
      logPk(`🔬 POKEMON: anúncio completo (exemplo): ${cortar(abertas[0] || r.linhas[0])}`);
      const naoAbertas = (r.linhas || []).filter(x => !abertoPoke(x));
      logPk(`🔬 POKEMON: ${abertas.length} abertas e ${naoAbertas.length} não abertas na resposta` +
        `${naoAbertas.length ? '; exemplo: ' + cortar(naoAbertas[0]) : ''}. Chaves da resposta: ${Object.keys(r).join(', ')}.`);
    }
    if (lidos.length && !st.pokeAvisos.exemplo) {
      st.pokeAvisos.exemplo = true;
      const e = lidos[0];
      const f = lerFicha(abertas.find(x => String(x.id) === e.id) || {});
      logPk(L`ℹ️ POKEMON: leitura de exemplo: ${P(e.especie)}, nível ${e.nivel == null ? '?' : e.nivel}, ${e.shiny ? 'Shiny' : 'Normal'}, ${G(e.preco)}; potência ${f.potencia ?? '?'}, qualidade ${f.qualidade ?? '?'}, IV somado ${f.iv_somado ?? '?'}, nota ${f.nota ?? '?'}.`);
    }

    const t = nowSrv();
    const candidatos = lidos
      .filter(p => p.preco < limite && p.qtd === 1 &&
        (!c.meuNome || p.vendedor !== c.meuNome) && !st.finalizados.has(p.id) &&
        (!st.skip[p.id] || Date.now() - st.skip[p.id] > 60000))
      .sort((a, b) => a.preco - b.preco);

    let hits = 0;
    for (const p of candidatos) {
      if (!st.running || runId !== st.loopId) break;
      const atual = cfg();
      const podeComprar = p.preco <= orcamento(atual) - st.spent &&
        (atual.dryRun || (st.gold != null && p.preco <= st.gold));
      if (!podeComprar) continue;
      const g = medianaDoGrupo(lidos, p);
      const retido = p.compravelEm && t < Number(p.compravelEm);
      if (retido) { agendarRetidoPokemon(p, runId, g, limite); continue; }
      if (st.retidos.get(p.id)) continue;   // já em preparação
      hits++;
      anunciarPokemon(p, g, limite);
      await comprarPokemon(p, c, runId);
    }
    return { hits, lidos: lidos.length };
  }

  function anunciarPokemon(p, g, limite) {
    if (avisoJaMostrado('pk' + p.id)) return;
    marcarAviso('pk' + p.id);
    logPk([...L`Identifiquei ${P(p.rotulo)} (${p.shiny ? 'Shiny' : 'Normal'}) por ${G(p.preco)}, abaixo do limite de ${G(limite)}`,
      ...(g ? L`; mediana do grupo ${G(g.mediana)} (${Q(g.n)} anúncios)` : [])]);
  }

  // ---------- retenção ----------
  function agendarRetidoPokemon(p, runId, g, limite) {
    const liberarEm = Number(p.compravelEm);
    if (!Number.isFinite(liberarEm) || st.finalizados.has(p.id)) return;
    const anterior = st.retidos.get(p.id);
    if (anterior && anterior.liberarEm === liberarEm && anterior.runId === runId) return;
    if (anterior) clearTimeout(anterior.timer);
    const atraso = Math.max(0, liberarEm - nowSrv() - ANTECEDENCIA_PREPARO_MS);
    const info = { liberarEm, runId, timer: null, preparando: false };
    info.timer = setTimeout(() => {
      if (st.retidos.get(p.id) !== info) return;
      prepararRetidoPokemon(p, liberarEm, runId).catch(e => dbg(`Pokémon retido #${p.id}: ${e.message}`));
    }, Math.min(atraso, 2147483647));
    st.retidos.set(p.id, info);
    if (!avisoJaMostrado('pk' + p.id)) {
      marcarAviso('pk' + p.id);
      const hora = new Date(liberarEm - st.off).toLocaleTimeString('pt-BR');
      logPk([...L`🔒 Retido: ${P(p.rotulo)} (${p.shiny ? 'Shiny' : 'Normal'}) #${p.id}, ${G(p.preco)}. Libera por volta das ${hora}. Preparação programada.`]);
    }
  }

  async function prepararRetidoPokemon(p, liberarEm, runId) {
    const info = st.retidos.get(p.id);
    if (!info || info.runId !== runId || info.liberarEm !== liberarEm ||
        !st.running || st.loopId !== runId || st.finalizados.has(p.id)) return;
    if (st.prioridadeRetida || st.activeAttempt) { dbg(`Pokémon retido #${p.id}: outra tentativa em andamento.`); return; }
    st.prioridadeRetida = p.id;
    info.preparando = true;
    try {
      const res = await consultarPokemon(true);
      if (!st.running || st.loopId !== runId || st.prioridadeRetida !== p.id) return;
      const val = validarPokemon(res, p.id, p.preco, cfg(), liberarEm);
      if (!val) {
        logPk(L`⏭️ Retido ${P(p.rotulo)} #${p.id} cancelado: anúncio mudou, sumiu ou não atende mais às regras.`);
        return;
      }
      const antes = cfg().dryRun ? null : await hist();
      if (!cfg().dryRun && !Number.isSafeInteger(Number(antes && antes.total))) return;
      const falta = liberarEm - nowSrv() + FOLGA_LIBERACAO_MS;
      if (falta > 0) await sleep(falta);
      if (!st.running || st.loopId !== runId || st.prioridadeRetida !== p.id) return;
      const atraso = nowSrv() - liberarEm;
      if (atraso < 0 || atraso >= JANELA_SORTEIO_MS) { dbg(`Pokémon retido #${p.id}: janela de sorteio perdida.`); return; }
      await comprarPokemon(val.p, cfg(), runId, { historicoAntes: antes, origemRetida: true, liberarEm });
    } finally {
      if (st.prioridadeRetida === p.id) st.prioridadeRetida = null;
      if (st.retidos.get(p.id) === info) st.retidos.delete(p.id);
    }
  }

  // ---------- compra ----------
  async function comprarPokemon(p, c, runId = st.loopId, opts = {}) {
    const id = p.id;
    if (!st.running || runId !== st.loopId || st.finalizados.has(id) || !pokeAtivo()) return;
    if (st.prioridadeRetida && st.prioridadeRetida !== id) return;
    const atual = cfg();
    if (orcamento(atual) - st.spent < 1) return stop('saldo para compras esgotado');
    if (!atual.dryRun && st.activeAttempt) { dbg('Outra compra em andamento; não envio outro pedido.'); return; }

    let before = opts.historicoAntes || null;
    if (!atual.dryRun) {
      st.skip[id] = Date.now();
      if (!before) {
        try { before = await hist(); }
        catch (e) { logPk(`Não consegui consultar histórico antes do pedido #${id}: ${e.message}`); return; }
      }
      if (!st.running || runId !== st.loopId) return;
      if (!Number.isSafeInteger(Number(before.total))) { logPk(`Histórico inicial sem contador confiável; compra #${id} não enviada.`); return; }
    }

    // REFRESH OBRIGATÓRIO: relê o mercado e revalida TUDO imediatamente antes do envio.
    let resp;
    try { resp = await consultarPokemon(!!opts.origemRetida); }
    catch (e) { dbg(`Pokémon #${id}: mercado não respondeu ao refresh (${e.message}).`); return; }
    if (!st.running || runId !== st.loopId) return;
    const aoEnviar = cfg();
    const val = validarPokemon(resp, id, p.preco, aoEnviar, opts.liberarEm ?? null);
    if (!val) {
      dbg(`Pokémon #${id}: preço, vendedor, retenção ou limite mudou; compra cancelada.`);
      if (opts.origemRetida) logPk(L`⏭️ ${P(p.rotulo)} #${id}: compra cancelada, anúncio não atende mais às regras.`);
      return 'reavaliar';
    }
    const pk = val.p, custo = pk.preco;
    const lib = Number(val.item.compravelEm);
    const retidoAgora = val.item.compravelEm != null && Number.isFinite(lib) && lib > nowSrv();
    const foraDaJanela = !!opts.origemRetida && (!Number.isFinite(Number(opts.liberarEm)) ||
      nowSrv() - Number(opts.liberarEm) < 0 || nowSrv() - Number(opts.liberarEm) >= JANELA_SORTEIO_MS);
    const bloqueado = (st.prioridadeRetida && st.prioridadeRetida !== id) || st.activeAttempt ||
      custo > orcamento(aoEnviar) - st.spent || retidoAgora || foraDaJanela || aoEnviar.dryRun !== atual.dryRun ||
      (!aoEnviar.dryRun && Date.now() < st.marketPausaAte) ||
      (!aoEnviar.dryRun && (!Number.isFinite(st.gold) || custo > st.gold || !st.sock || st.sock.readyState !== 1));
    if (bloqueado) { dbg(`Pokémon #${id} NÃO enviado: saldo, orçamento, retenção ou janela inválidos.`); return 'reavaliar'; }

    if (aoEnviar.dryRun) {
      if (!st.seen['pk' + id]) {
        st.seen['pk' + id] = 1;
        st.spent += custo;
        st.pokeSim.push({ ...pk, custo });
        logPk(L`🧪 Simulação: tentaria comprar ${P(pk.rotulo)} (${pk.shiny ? 'Shiny' : 'Normal'}) por ${G(custo)}. Não entrou em sorteio.`);
        if (ui && ui.atualizarPokemon) ui.atualizarPokemon();
        if (orcamento(cfg()) - st.spent < 1) stop('saldo simulado esgotado');
      }
      return;
    }

    const a = {
      ofertaId: id, nome: pk.especie, rotulo: pk.rotulo, itemId: null, precoUnitario: custo, qtd: 1, custo,
      entrou: false, lista: false, sorteioMostrado: false, resultadoMostrado: false,
      venceuSorteio: null, recibo: false, valorRecebido: null, enviadoEm: Date.now(), pk: true
    };
    st.activeAttempt = a;
    logPk(L`🛒 Tentando comprar ${P(pk.rotulo)} #${id} (${pk.shiny ? 'Shiny' : 'Normal'}) por ${G(custo)}. Verificando entrada no sorteio…`);
    try {
      st.marketUltimoEnvio = Date.now();
      osend.call(st.sock, JSON.stringify({
        t: 'market.comprar', id: pk.idRaw, qtd: 1, preco: custo, moeda: 'gold', sorteioUi: c.sorteioUi
      }));
    } catch (e) {
      st.activeAttempt = null;
      st.finalizados.add(id);
      logPk(`Falha/resultado incerto no envio #${id}: ${e.message}. Não vou repetir automaticamente.`);
      return;
    }
    dbg(`Pokémon #${id} enviado; aguardando sorteio e confirmação no histórico.`);

    let verificou = false, achadas = [], erroHistorico = null;
    for (const demora of [1600, 2300, 2400, 2800]) {
      await sleep(demora);
      try {
        const after = await hist();
        verificou = true;
        achadas = comprasNoHistorico(before, after, a);
        if (achadas.length && (a.recibo || a.venceuSorteio === true)) break;
        if (a.venceuSorteio === false) break;
      } catch (e) { erroHistorico = e; }
    }
    const identificada = achadas.length > 0 && (a.recibo || a.venceuSorteio === true);
    if (identificada) {
      const pago = achadas.reduce((s, x) => s + Number(x.bruto), 0);
      st.spent += pago;
      st.fails = 0;
      registrarPokemonComprado(pk, pago);
      mostrarResultado(a, true);
      if (orcamento(cfg()) - st.spent < 1 && st.running) stop('saldo para compras esgotado');
    } else if (a.venceuSorteio === false) {
      st.fails = 0;
      mostrarResultado(a, false);
    } else if (achadas.length) {
      logPk(L`⚠️ ${P(pk.rotulo)} #${id}: encontrei compra compatível no histórico, mas faltou evento do servidor vinculando-a ao pedido. Confira manualmente.`);
    } else {
      st.fails++;
      if (st.running) stop('resultado de compra inconclusivo; confira histórico antes de reativar');
      const detalhe = a.venceuSorteio === true ? 'Servidor informou vitória, mas histórico ainda não confirmou.' :
        a.recibo ? 'Servidor informou compra, mas histórico ainda não confirmou.' :
        a.entrou ? 'Entrou no sorteio, mas não recebi desfecho verificável.' :
        'Sem confirmação de entrada ou compra; não é possível afirmar que perdeu.';
      logPk(L`⚠️ Resultado INDETERMINADO de ${P(pk.rotulo)} #${id}. ${detalhe}${erroHistorico && !verificou ? ' Falha ao consultar histórico.' : ''} Não repetir automaticamente.`);
    }
    st.finalizados.add(id);
    if (st.activeAttempt === a) st.activeAttempt = null;
  }

  async function loop() {
    const id = ++st.loopId;
    while (st.running && id === st.loopId) {
      const c = cfg();
      try {
        await scan(c);
        st.errs = 0;
      } catch (e) {
        st.errs++;
        log('Erro: ' + e.message + ` (${st.errs}/${c.maxFails})`);
        if (st.errs >= c.maxFails) return stop(c.maxFails + ' erros seguidos');
      }
      await sleep(existePedraAtiva() ? INTERVALO_VARREDURA_MS : 15000);
    }
  }

  // =====================================================================================
  // RASTREADOR DO MERCADO DE POKÉMON: banco local (IndexedDB) + CSV + envio opcional ao Google Sheets
  // =====================================================================================
  // A versão 1.4.7 coleta anúncios incrementalmente e NÃO compara ausências entre páginas.
  // A análise de desaparecimentos fica desativada para evitar falsos positivos.
  // Rodadas incompletas, respostas de páginas erradas, duplicações e mudanças de total
  // são descartadas: navegar manualmente pelas abas não pode criar vendas fictícias.
  // "vendido" exige evidência explícita do servidor; "sumiu" significa venda OU retirada,
  // sem confirmação. Conserva todos os dados (inclusive ficha/IV) no IndexedDB e no CSV.
  const K_POKE_TRACK = 'pis_pokemon_track_v1';
  const K_SHEET_MIGRADO = 'pis_sheet_pokemon_v143_migrado';
  const K_REENVIO_SHEETS_147 = 'pis_reenvio_sheets_v147_concluido';
  const K_CENSO_VALIDO_154 = 'pis_censo_valido_v154';
  const K_CENSO_SENTIDO_154 = 'pis_censo_sentido_v154';
  const trackAtivo = () => lsGet(K_POKE_TRACK, true) === true;
  const setTrackAtivo = v => lsSet(K_POKE_TRACK, !!v);

  const pkDb = (() => {
    let dbp = null;
    const abrir = () => dbp || (dbp = new Promise((res, rej) => {
      try {
        if (typeof indexedDB === 'undefined') throw new Error('IndexedDB indisponível');
        const rq = indexedDB.open('pis_mercado_v1', 1);
        rq.onupgradeneeded = () => rq.result.createObjectStore('pokemon', { keyPath: 'id' });
        rq.onsuccess = () => res(rq.result);
        rq.onerror = () => rej(rq.error);
      } catch (e) { rej(e); }
    }));
    const tx = async (modo, fn) => {
      const db = await abrir();
      return new Promise((res, rej) => {
        const t = db.transaction('pokemon', modo);
        const out = fn(t.objectStore('pokemon'));
        t.oncomplete = () => res(out && 'result' in out ? out.result : undefined);
        t.onerror = t.onabort = () => rej(t.error || new Error('transação abortada'));
      });
    };
    return {
      all: () => tx('readonly', s => s.getAll()),
      putMany: arr => tx('readwrite', s => { arr.forEach(x => s.put(x)); }),
      delMany: ids => tx('readwrite', s => { ids.forEach(i => s.delete(i)); }),
      clear: () => tx('readwrite', s => { s.clear(); })
    };
  })();

  st.pkObs = new Map(); st.pkPronto = false; st.pkEnviando = false; st.pkAvisos = {};
  st.pkPersistQueue = Promise.resolve();
  function persistirPokemon(registros) {
    // Serializa transações que alteram o mesmo registro; um ACK do Sheets não deve
    // ser sobrescrito por outra gravação concorrente do rastreador.
    const itens = [...new Set(registros)];
    if (!itens.length) return st.pkPersistQueue;
    const gravacao = st.pkPersistQueue.then(() => pkDb.putMany(itens));
    st.pkPersistQueue = gravacao.catch(e => dbg('Persistência do rastreador:', e.message));
    return gravacao;
  }
  st.pkTrackTemBase = false; st.pkTrackInfo = null; st.pkTrackErros = 0;
  pkDb.all().then(arr => {
    const velho = Date.now() + st.off - 2 * 86400000, descartar = [], migrados = [];
    const atualizarSheet = lsGet(K_SHEET_MIGRADO, false) !== true;
    const reenviarHistorico = lsGet(K_REENVIO_SHEETS_147, false) !== true;
    for (const r of arr || []) {
      if (r.status === 'aberto' && r.ultimaVez < velho && !(r.eventos || []).length) {
        descartar.push(r.id); continue; // anúncio antigo sem histórico relevante
      }
      if (!Array.isArray(r.eventos)) r.eventos = [];
      // A migração para Sheets pode já ter ocorrido. Identidade e vendedor devem
      // ser recuperados também nos registros legados, sem criar novo evento.
      let rawAnterior = {};
      try { rawAnterior = JSON.parse(r.raw || '{}'); } catch { /* bruto legado inválido */ }
      const pokemonAnterior = r.pokemonId || rawAnterior.pokemonId || rawAnterior.ficha?.id;
      if (pokemonAnterior != null && pokemonAnterior !== '') r.pokemonId = String(pokemonAnterior);
      r.vendedorId = r.vendedorId ?? rawAnterior.vendedorId ?? null;
      r.vendedor = r.vendedor || rawAnterior.vendedor || null;
      if (r.status === 'sumiu') { r.status = 'incerto_sem_dados'; migrados.push(r); }
      if (!r.eventos.length && r.status !== 'aberto') {
        const comprovado = r.status === 'vendido';
        r.contadorEventos = 1;
        r.eventos.push({ evento_id: `${r.id}:1`, id: String(r.id),
          tipo: comprovado ? 'confirmacao_servidor' : 'desaparecimento',
          status: r.status, classificacaoOriginal: 'legado', preco: r.preco,
          especie: r.especie, shiny: r.shiny, nivel: r.nivel,
          perfil: null, expiraEm: null, raw: r.raw, data: r.vendidoEm || r.ultimaVez || Date.now(),
          motivo: 'registro anterior ao filtro; sem classificação retrospectiva por estatística',
          incluiEstatistica: comprovado, confirmadoServidor: comprovado, enviado: true });
        migrados.push(r);
      }
      // Preserva banco anterior; prepara um evento de sincronização para popular a aba Sheet.
      if (atualizarSheet) {
        let raw = {}; try { raw = JSON.parse(r.raw || '{}'); } catch { /* legado */ }
        r.pokemonId = r.pokemonId || (raw.pokemonId != null ? String(raw.pokemonId) : null) ||
          (raw.ficha?.id != null ? String(raw.ficha.id) : null);
        r.vendedorId = r.vendedorId ?? raw.vendedorId ?? null;
        const postagem = normalizarTimer(raw.criadoEm);
        r.postadoEm = postagem || r.postadoEm || r.primeiraVez || r.ultimaVez || null;
        r.dataOrigem = postagem ? 'criadoEm' : 'primeira_observacao';
        // Cada evento continua único e auditável; sincronização não conta como outra venda.
        criarEvento(r, { tipo: 'sincronizacao', status: r.status,
          motivo: 'Sincronização da planilha por ID', incluiEstatistica: false });
        if (!migrados.includes(r)) migrados.push(r);
      }
      // Um único reenvio do histórico ao receptor recém-configurado.
      // O Apps Script deduplica por evento_id, então isso não duplica a auditoria.
      if (reenviarHistorico && r.eventos.length) {
        for (const evento of r.eventos) evento.enviado = false;
        if (!migrados.includes(r)) migrados.push(r);
      }
      st.pkObs.set(String(r.id), r);
    }
    if (descartar.length) pkDb.delMany(descartar).catch(() => {});
    if (migrados.length) pkDb.putMany(migrados)
      .then(() => {
          if (atualizarSheet) lsSet(K_SHEET_MIGRADO, true);
          if (reenviarHistorico) lsSet(K_REENVIO_SHEETS_147, true);
        })
      .catch(e => dbg('Falha ao preparar sincronização da Sheet:', e.message));
    else {
      if (atualizarSheet) lsSet(K_SHEET_MIGRADO, true);
      if (reenviarHistorico) lsSet(K_REENVIO_SHEETS_147, true);
    }
    st.pkPronto = true;
    if (ui && ui.atualizarPokemon) ui.atualizarPokemon();
  }).catch(e => { dbg('Banco local indisponível:', e.message); st.pkAvisos.semBanco = e.message; });

  const rawStr = l => { try { const j = JSON.stringify(l); return j.length <= 20000 ? j : null; } catch { return null; } };

  // Para rastrear todas as páginas usamos a consulta oficial da vitrine, sem filtros
  // da aba que o jogador deixou aberta (busca, espécie, nível, Shiny etc.).
  function pedidoPaginaRastreador(pagina) {
    const tpl = pokeTemplate();
    const salvo = tpl && tpl.req && tpl.req.t === 'market.listar' ? tpl.req : {};
    const req = { ...salvo,
      t: 'market.listar', tipo: 'pokemon', moeda: 'gold', ordem: 'baratos', pagina,
      especieId: 0, busca: '', criterios: [], elementos: [], tiposUnidos: true, categoria: '',
      soShiny: false, soP5: false, soMega: false, soLendario: false,
      soTmElemental: false, soTmAoe: false, semOutland: false,
      nivelMin: '', nivelMax: '', potenciaMin: '', potenciaMax: '',
      ivMin: '', ivMax: '', qualidadeMin: '', qualidadeMax: '',
      notaMin: '', notaMax: '', precoMin: '', precoMax: ''
    };
    if ('seq' in req) req.seq = ++st.seq;
    return req;
  }

  async function consultarPaginaRastreador(pagina) {
    const req = pedidoPaginaRastreador(pagina);
    // Uma consulta POR VEZ, com filtro EXATO da página da resposta. A fila é liberada
    // a cada página para não bloquear as compras e as liberações dos retidos.
    return naFilaItem(() => ask(req, j => j.t === 'market' && j.aba === 'vitrine' &&
      Array.isArray(j.linhas) && Number(j.pagina) === pagina &&
      (j.ordem == null || j.ordem === 'baratos') &&
      (j.moeda == null || j.moeda === 'gold') &&
      (j.especieId == null || Number(j.especieId) === 0) &&
      (req.seq == null || j.seq == null || Number(j.seq) === Number(req.seq)),
      15000, () => trackAtivo()));
  }

  function numeroInteiroNaoNegativo(v) {
    if (v == null || v === '') return null;
    const n = Number(v);
    return Number.isSafeInteger(n) && n >= 0 ? n : null;
  }


  // ===== CLASSIFICAÇÃO ESTATÍSTICA E LINHA DO TEMPO POR ID =====
  // Uma listagem completa é a fonte da presença dos IDs. A ausência nunca prova venda.
  // Os eventos são históricos: IDs reaparecidos geram uma correção em vez de apagar a informação.
  const STATUS_PROVAVEL = 'venda_provavel';
  const STATUS_SERVIDOR = 'vendido';
  const STATUS_EXPIRADO = 'expirado_incerto';
  const STATUS_OUTLIER = 'outlier_incerto';
  const STATUS_SEM_BASE = 'incerto_sem_dados';
  const STATUS_NAO_VENDIDO = 'nao_vendido_preco_anterior';
  const STATUS_ATIVO = 'aberto';
  const STATUS_CANCELADO = 'cancelado';
  const statusIncerto = status => [STATUS_SEM_BASE, STATUS_EXPIRADO, STATUS_OUTLIER].includes(status);
  const statusDeVenda = status => status === STATUS_PROVAVEL || status === STATUS_SERVIDOR;

  function normalizarTimer(v) {
    if (v == null || v === '') return null;
    const n = typeof v === 'number' ? v : Number(v);
    if (Number.isFinite(n) && n > 0) {
      if (n >= 1.5e12) return n;  // timestamp em milissegundos
      if (n >= 1.5e9 && n < 1e11) return n * 1000; // timestamp em segundos
      return null; // duração relativa ou valor desconhecido: NÃO supor data de expiração
    }
    const t = typeof v === 'string' ? Date.parse(v) : NaN;
    return Number.isFinite(t) ? t : null;
  }
  const nAtributo = x => x == null || x === '' || !Number.isFinite(Number(x)) ? null : Number(x);
  const textoAtributo = x => x == null || x === '' ? null : String(x).trim().toLowerCase();
  function perfilDoAnuncio(l, conhecido = null) {
    const p = lerPokemon(l) || conhecido || {};
    const a = lerFicha(l || {});
    const marcaLendario = campoPoke(l || {}, ['lendario', 'legendary', 'isLegendary']);
    const ehLendario = marcaLendario === true || marcaLendario === 1 ||
      ['true', '1', 'sim', 'yes'].includes(String(marcaLendario).toLowerCase());
    const raridade = campoPoke(l || {}, ['raridade', 'rarity']) || (ehLendario ? 'lendario' : 'comum');
    const qual = nAtributo(a.qualidade);
    const nota = nAtributo(a.nota);
    return { especie: chavePedra(p.especie || ''), shiny: p.shiny === true, raridade: textoAtributo(raridade) || 'comum',
      potencia: nAtributo(a.potencia), iv: nAtributo(a.iv_somado),
      qualidade: qual == null ? textoAtributo(a.qualidade) : qual,
      nota: nota == null ? textoAtributo(a.nota) : nota };
  }
  const perfilValido = v => v != null && v !== '';
  function valorParecido(a, b, campo) {
    if (!perfilValido(a) || !perfilValido(b)) return false;
    if (typeof a === 'string' || typeof b === 'string') return String(a) === String(b);
    if (campo === 'potencia') return Math.abs(a - b) <= Math.max(1, 0.20 * Math.max(Math.abs(a), 1));
    if (campo === 'iv') return Math.abs(a - b) <= Math.max(12, 0.15 * Math.max(Math.abs(a), 1));
    if (campo === 'qualidade') return Math.abs(a - b) <= Math.max(8, 0.10 * Math.max(Math.abs(a), 1));
    return Math.abs(a - b) <= 1; // nota numérica, quando o jogo a fornecer nessa forma
  }
  function perfisParecidos(alvo, outro) {
    if (!alvo || !outro || !alvo.especie || alvo.especie !== outro.especie ||
        alvo.shiny !== outro.shiny || alvo.raridade !== outro.raridade) return false;
    let n = 0;
    for (const campo of ['potencia', 'iv', 'qualidade', 'nota']) {
      // Estatística não pode comparar criaturas com atributo importante desconhecido.
      if (perfilValido(alvo[campo]) !== perfilValido(outro[campo])) return false;
      if (perfilValido(alvo[campo])) {
        if (!valorParecido(alvo[campo], outro[campo], campo)) return false;
        n++;
      }
    }
    return n >= 2;
  }
  function quartil(sorted, q) {
    if (!sorted.length) return null;
    const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  }
  const grupoPerfil = p => p && p.especie ? `${p.especie}|${p.shiny ? 'shiny' : 'normal'}|${p.raridade}` : null;
  function indexarReferencias(snapshot, agora) {
    const indice = new Map();
    const inserir = (id, preco, perfil) => {
      const grupo = grupoPerfil(perfil);
      if (!grupo || !Number.isSafeInteger(preco) || preco <= 0) return;
      if (!indice.has(grupo)) indice.set(grupo, []);
      indice.get(grupo).push({ id, preco, perfil });
    };
    for (const l of snapshot.linhas) {
      if (abertoPoke(l) && l && l.id != null)
        inserir(String(l.id), Number(l.preco), perfilDoAnuncio(l));
    }
    for (const r of st.pkObs.values()) for (const e of r.eventos || []) {
      if (!e || !e.incluiEstatistica || !statusDeVenda(e.status) ||
          !Number.isFinite(e.data) || e.data < agora - HISTORICO_PRECOS_MS || e.data > agora) continue;
      inserir(r.id, e.preco, e.perfil);
    }
    return indice;
  }
  function referenciasDePreco(rec, snapshot, agora) {
    let raw = {}; try { raw = JSON.parse(rec.raw || '{}'); } catch { /* registro antigo inválido */ }
    const alvo = rec.perfil || perfilDoAnuncio(raw, rec);
    if (!snapshot.indiceReferencias) snapshot.indiceReferencias = indexarReferencias(snapshot, agora);
    const precos = snapshot.indiceReferencias.get(grupoPerfil(alvo)) || [];
    const candidatos = precos.filter(x => x.id !== rec.id && perfisParecidos(alvo, x.perfil))
      .map(x => x.preco);
    if (candidatos.length < AMOSTRA_MIN_COMPARAVEIS)
      return { ok: false, n: candidatos.length, motivo: `amostra insuficiente (${candidatos.length}/${AMOSTRA_MIN_COMPARAVEIS})` };
    candidatos.sort((a,b) => a-b);
    const mediana = quartil(candidatos, .5), q1 = quartil(candidatos, .25), q3 = quartil(candidatos, .75);
    const iqr = q3 - q1;
    const inferior = Math.max(0, q1 - 1.5 * iqr, mediana * .60);
    const superior = Math.min(q3 + 1.5 * iqr, mediana * 1.80);
    return { ok: true, n: candidatos.length, mediana, q1, q3, iqr, inferior, superior,
      dentro: rec.preco >= inferior && rec.preco <= superior };
  }
  const eventosDe = r => Array.isArray(r.eventos) ? r.eventos : (r.eventos = []);
  function criarEvento(rec, dados) {
    const evs = eventosDe(rec);
    rec.contadorEventos = (Number(rec.contadorEventos) || 0) + 1;
    const ultimaData = Number(evs.length ? evs[evs.length - 1].data : 0) || 0;
    const origemData = Number(dados.data) || nowSrv();
    const dataEvento = Math.max(origemData, ultimaData + 1);
    const ev = {
      evento_id: `${rec.id}:${rec.contadorEventos}`, id: rec.id, data: dataEvento,
      preco: rec.preco, especie: rec.especie, shiny: rec.shiny,
      nivel: rec.nivel, perfil: rec.perfil, raw: rec.raw,
      expiraEm: rec.expiraEm || null, ultimaVez: rec.ultimaVez || null,
      postadoEm: rec.postadoEm || null, dataOrigem: rec.dataOrigem || 'desconhecida',
      pokemonId: rec.pokemonId || null, vendedorId: rec.vendedorId ?? null,
      incluiEstatistica: false, enviado: false, ...dados, data: dataEvento
    };
    evs.push(ev);
    rec.alteradoEm = dataEvento;
    return ev;
  }
  function ultimaSaida(r) {
    return [...(r.eventos || [])].reverse().find(e => e.tipo === 'desaparecimento' || e.tipo === 'confirmacao_servidor') || null;
  }
  function marcarReaparecimento(rec, l, agora) {
    const ultimo = ultimaSaida(rec);
    const precoNovo = Number(l.preco);
    if (ultimo && ultimo.tipo === 'desaparecimento' && ultimo.status !== STATUS_NAO_VENDIDO) {
      const antes = ultimo.status;
      ultimo.classificacaoOriginal = ultimo.classificacaoOriginal || antes;
      ultimo.status = STATUS_NAO_VENDIDO;
      ultimo.incluiEstatistica = false;
      ultimo.reapareceuEm = agora;
      // Planilhas em modo append-only recebem evento de CORREÇÃO com a referência ao
      // evento revogado; CSV reprocessa a classificação atual do evento anterior.
      criarEvento(rec, { tipo: 'reaparecimento', status: STATUS_ATIVO,
        evento_corrigido: ultimo.evento_id, preco_anterior: ultimo.preco, preco: precoNovo, raw: rawStr(l) || rec.raw,
        preco_novo: Number.isFinite(precoNovo) ? precoNovo : null, data: agora,
        motivo: `ID reapareceu: anula classificação anterior (${antes})` });
    } else {
      // Recuperação de um registro antigo/incompleto: o resumo também deve voltar a Aberto.
      criarEvento(rec, { tipo: 'reaparecimento', status: STATUS_ATIVO, preco: precoNovo,
        raw: rawStr(l) || rec.raw, data: agora,
        motivo: 'Anúncio voltou a aparecer no mercado; status reaberto' });
    }
    rec.status = STATUS_ATIVO;
    rec.confirmada = false;
    rec.vendidoEm = null;
    rec.faltas = 0;
    rec.precoInicial = precoNovo > 0 ? precoNovo : rec.precoInicial;
    rec.primeiraVez = agora;
    const postagem = normalizarTimer(l.criadoEm);
    rec.postadoEm = postagem || agora;
    rec.dataOrigem = postagem ? 'criadoEm' : 'primeira_observacao';
    rec.pokemonId = l.pokemonId != null ? String(l.pokemonId) : (l.ficha?.id != null ? String(l.ficha.id) : rec.pokemonId);
    rec.vendedorId = l.vendedorId ?? rec.vendedorId;
  }
  function marcarReprecificacao(rec, l, agora) {
    const novo = Number(l.preco);
    if (!(novo > 0) || novo === rec.preco) return;
    criarEvento(rec, { tipo: 'alteracao_preco', status: 'preco_alterado',
      preco: novo, raw: rawStr(l) || rec.raw,
      preco_anterior: rec.preco, preco_novo: novo, data: agora,
      motivo: 'Preço alterado com anúncio ainda visível; não caracteriza venda' });
    rec.preco = novo;
    rec.precoInicial = novo;
  }
  // Um mesmo Pokémon físico pode reaparecer sob OUTRO ID de anúncio.
  // Identidade somente por pokemonId real, jamais por espécie/atributos.
  function pokemonExato(x) {
    if (!x) return null;
    let id = x.pokemonId ?? x.pokemon_id ?? x.ficha?.id;
    if ((id == null || id === '') && typeof x.raw === 'string') {
      try { const raw = JSON.parse(x.raw); id = raw.pokemonId ?? raw.ficha?.id; }
      catch { /* não afirmar identidade com base em nome ou IV */ }
    }
    const chave = id == null ? '' : String(id).trim();
    return chave && chave !== '0' && chave !== 'null' && chave !== 'undefined' ? chave : null;
  }
  function dadosVendedor(x) {
    let raw = {};
    if (x && typeof x.raw === 'string') {
      try { raw = JSON.parse(x.raw); } catch { /* legado */ }
    }
    const id = x?.vendedorId ?? x?.vendedor_id ?? raw.vendedorId;
    const nome = x?.vendedor ?? x?.anuncio_vendedor ?? raw.vendedor;
    return {
      id: id == null || String(id).trim() === '' ? null : String(id).trim(),
      nome: nome == null || !String(nome).trim() ? null : String(nome).trim().toLocaleLowerCase('pt-BR')
    };
  }
  function compararVendedores(a, b) {
    const v1 = dadosVendedor(a), v2 = dadosVendedor(b);
    // IDs numéricos/sistema são mais confiáveis que o nome exibido.
    if (v1.id && v2.id) return v1.id === v2.id ? 'mesmo' : 'outro';
    if (v1.nome && v2.nome) return v1.nome === v2.nome ? 'mesmo' : 'outro';
    return 'desconhecido';
  }
  function primeiraAusenciaConfiavel(rec) {
    const saida = [...(rec.eventos || [])].reverse().find(e => e.tipo === 'desaparecimento');
    // "primeiroAusenteEm" é mais preciso do que a data da classificação, que
    // pode ocorrer apenas no segundo censo (~30 min depois).
    const tempo = Number(saida?.ausenteDesde || rec.primeiroAusenteEm || saida?.data || rec.vendidoEm);
    return Number.isFinite(tempo) && tempo > 0 ? tempo : null;
  }
  function statusRevisavel(rec, completa) {
    // Se já vimos o MESMO Pokémon com OUTRO proprietário, a venda anterior
    // segue provável. Uma futura recompra pelo vendedor original não reverte
    // automaticamente a transação anterior.
    const vendaPorNovoDono = rec.status === STATUS_PROVAVEL &&
      rec.resolucaoInferida === 'reanuncio_outro_vendedor';
    return !vendaPorNovoDono && (statusIncerto(rec.status) || rec.status === STATUS_PROVAVEL ||
      (completa && st.pkTrackTemBase && rec.status === STATUS_ATIVO));
  }
  function registrarResolucao(rec, novoStatus, criterio, motivo, agora, novo = null) {
    if (!rec || rec.status === STATUS_SERVIDOR || rec.status === STATUS_CANCELADO) return false;
    if (novoStatus === rec.status && criterio !== 'reanuncio_outro_vendedor') return false;
    const ultimo = (rec.eventos || []).at(-1);
    const saida = ultimaSaida(rec);
    if (novoStatus === STATUS_CANCELADO) {
      // Anula da estatística local qualquer "venda provável" desmentida pelo
      // reaparecimento sob o MESMO vendedor. A auditoria remota recebe correção.
      for (const e of rec.eventos || []) {
        if (e.incluiEstatistica && statusDeVenda(e.status) &&
            (e.tipo === 'desaparecimento' || e.tipo === 'resolucao_incerteza')) e.incluiEstatistica = false;
      }
    }
    criarEvento(rec, {
      tipo: 'resolucao_incerteza', status: novoStatus, criterio,
      data: agora, motivo,
      evento_corrigido: ultimo?.evento_id || saida?.evento_id || '',
      novo_anuncio_id: novo?.id || '',
      preco_anterior: rec.preco,
      preco_novo: novo?.preco ?? '',
      // Não alimentar a mediana de vendas com hipóteses baseadas apenas no tempo/vendedor.
      incluiEstatistica: false, confirmadoServidor: false
    });
    rec.status = novoStatus;
    rec.confirmada = false;
    rec.faltas = 0;
    rec.resolucaoInferida = criterio;
    return true;
  }
  function entradaConhecidaDoAnuncio(r) {
    const criacao = Number(r.postadoEm);
    const observado = Number(r.primeiraVez);
    // Prefira o timestamp real de publicação quando existe; quando não existe,
    // use a primeira observação, nunca a última atualização da linha do Sheets.
    if (r.dataOrigem === 'criadoEm' && Number.isFinite(criacao) && criacao > 0) return criacao;
    return Number.isFinite(observado) && observado > 0 ? observado : null;
  }
  function reconciliarReanuncios(snapshot, presentes, mudados, agora, completa) {
    const porPokemon = new Map();
    for (const r of st.pkObs.values()) {
      const id = pokemonExato(r);
      if (!id) continue;
      if (!porPokemon.has(id)) porPokemon.set(id, []);
      porPokemon.get(id).push(r);
    }
    for (const lista of porPokemon.values()) {
      lista.sort((a,b) => (entradaConhecidaDoAnuncio(a) || Infinity) -
                             (entradaConhecidaDoAnuncio(b) || Infinity));
    }
    const novosVinculos = new Map();
    for (const anterior of st.pkObs.values()) {
      const idPokemon = pokemonExato(anterior);
      if (!idPokemon || presentes.has(anterior.id) || !statusRevisavel(anterior, completa)) continue;
      const vistoAntigo = Number(anterior.ultimaVez);
      if (!Number.isFinite(vistoAntigo) || vistoAntigo <= 0) continue;
      // Usar o PRIMEIRO novo anúncio conhecido, e não o primeiro na ordenação
      // por preço da vitrine: o Pokémon pode ter mudado de dono várias vezes.
      // Os anúncios já catalogados servem mesmo se a publicação atual saiu do ar.
      const candidato = (porPokemon.get(idPokemon) || []).find(outro =>
        outro.id !== anterior.id && entradaConhecidaDoAnuncio(outro) != null &&
        entradaConhecidaDoAnuncio(outro) >= vistoAntigo);
      if (!candidato) continue;
      const vendedor = compararVendedores(anterior, candidato);
      if (vendedor === 'desconhecido') continue;
      const mesmo = vendedor === 'mesmo';
      if (!mesmo && anterior.status === STATUS_PROVAVEL) continue;
      const novoStatus = mesmo ? STATUS_CANCELADO : STATUS_PROVAVEL;
      const criterio = mesmo ? 'reanuncio_mesmo_vendedor' : 'reanuncio_outro_vendedor';
      const motivo = `${mesmo ? 'Cancelado (inferido)' : 'Vendido (provável)'}: Pokémon ID ${idPokemon} ` +
        `reapareceu no anúncio #${candidato.id} com ${mesmo ? 'o mesmo vendedor' : 'outro vendedor'}; ` +
        `anúncio antigo #${anterior.id}`;
      if (!registrarResolucao(anterior, novoStatus, criterio, motivo, agora, candidato)) continue;
      mudados.set(anterior.id, anterior);
      if (!novosVinculos.has(candidato.id)) novosVinculos.set(candidato.id, []);
      novosVinculos.get(candidato.id).push(anterior.id);
      dbg(`Rastreador: #${anterior.id} -> ${novoStatus} por novo anúncio #${candidato.id}`);
    }
    for (const [novoId, idsAntigos] of novosVinculos) {
      const novo = st.pkObs.get(novoId);
      if (!novo) continue;
      novo.reanuncioDoId = idsAntigos[0];
      criarEvento(novo, { tipo: 'vinculo_anuncio', status: novo.status, data: agora,
        reanuncioDoId: idsAntigos[0],
        motivo: `Anúncio #${novoId} do Pokémon ID ${pokemonExato(novo)}; anterior(es): ${idsAntigos.join(', ')}` });
      mudados.set(novo.id, novo);
    }
  }
  function reavaliarIncertosAposSemana(snapshot, presentes, mudados, agora) {
    // Só após duas coberturas válidas: não inferir venda se o navegador ficou
    // desligado ou se a paginação falhou no meio.
    const observadosPorPokemon = new Set();
    for (const l of snapshot.linhas) if (abertoPoke(l)) {
      const id = pokemonExato(l);
      if (id) observadosPorPokemon.add(id);
    }
    const todosPorPokemon = new Map();
    for (const rec of st.pkObs.values()) {
      const id = pokemonExato(rec);
      if (!id) continue;
      if (!todosPorPokemon.has(id)) todosPorPokemon.set(id, []);
      todosPorPokemon.get(id).push(rec);
    }
    for (const rec of st.pkObs.values()) {
      if (!statusIncerto(rec.status) || presentes.has(rec.id)) continue;
      const pokemonId = pokemonExato(rec);
      const inicio = primeiraAusenciaConfiavel(rec);
      if (!pokemonId || !inicio || agora - inicio <= PRAZO_INCERTO_VENDA_MS ||
          (rec.confirmacoesSemana || 0) < (rec.coberturaRuidosaSemana ? 3 : 2)) continue;
      if (observadosPorPokemon.has(pokemonId)) continue;
      // Um outro anúncio já observado após a saída prova que o Pokémon
      // reapareceu, mesmo que tenha sumido novamente ou falte o vendedor.
      const reapareceu = (todosPorPokemon.get(pokemonId) || []).some(outro =>
        outro.id !== rec.id && Number(outro.primeiraVez) >= inicio);
      if (reapareceu) continue;
      if (registrarResolucao(rec, STATUS_PROVAVEL, 'sem_reaparecimento_7_dias',
          `Vendido (provável): 7 dias completos desde a primeira ausência sem novo anúncio do Pokémon ID ${pokemonId}; censo atual completo`,
          agora)) {
        mudados.set(rec.id, rec);
        dbg(`Rastreador: anúncio #${rec.id} passou de Incerto a Vendido (provável) após 7 dias.`);
      }
    }
  }
  // A hora exata da saída é desconhecida: ela ocorreu entre a última observação
  // positiva e a primeira ausência EM VARREDURA COMPLETA COERENTE. Só atribuir
  // cancelamento/venda provável quando TODO esse intervalo cai na janela da regra.
  function classificarDesaparecimento(rec, snapshot, primeiroAusenteEm) {
    const expira = Number(rec.expiraEm);
    const visto = Number(rec.ultimaVez);
    const ausente = Number(primeiroAusenteEm);
    const semBase = motivo => ({ status: STATUS_SEM_BASE, motivo, estat: null });
    if (!Number.isFinite(expira) || expira <= 0)
      return semBase('Sem data de expiração confiável');
    if (!Number.isFinite(visto) || visto <= 0 || !Number.isFinite(ausente) || ausente < visto)
      return semBase('Sem intervalo confiável entre última observação e ausência');
    const limiar = expira - ANTECEDENCIA_CANCELAMENTO_MS;
    // Mesmo em um censo completo, um anúncio pode ter expirado enquanto varríamos as páginas.
    if (ausente >= expira - FOLGA_EXPIRACAO_MS)
      return { status: STATUS_EXPIRADO, motivo: 'Ausência percebida perto/depois da expiração; venda e retirada não verificadas', estat: null };
    if (ausente <= limiar)
      return { status: STATUS_CANCELADO, motivo: `Cancelado (inferido): primeiro ausente com pelo menos 10 min restantes`, estat: null };
    if (visto < limiar)
      return semBase('Intervalo de saída cruza o limiar de 10 min: pode ter sido cancelado ou vendido');
    const estat = referenciasDePreco(rec, snapshot, snapshot.coletaFim || nowSrv());
    if (!estat.ok) return { status: STATUS_SEM_BASE, motivo: estat.motivo, estat };
    if (!estat.dentro) return { status: STATUS_OUTLIER, motivo: 'Preço fora da faixa dos anúncios comparáveis (outlier)', estat };
    return { status: STATUS_PROVAVEL, motivo: `Vendido (provável): saída nos últimos 10 min da oferta; ${estat.n} comparáveis`, estat };
  }

  function registrarDesaparecimento(rec, snapshot, agora) {
    const primeiroAusente = rec.primeiroAusenteEm || agora;
    const res = classificarDesaparecimento(rec, snapshot, primeiroAusente);
    rec.status = res.status;
    rec.confirmada = false;
    rec.vendidoEm = agora;
    rec.faltas = 0;
    const ev = criarEvento(rec, { tipo: 'desaparecimento', status: res.status,
      incluiEstatistica: res.status === STATUS_PROVAVEL, confirmadoServidor: false,
      data: agora, ausenteDesde: primeiroAusente, motivo: res.motivo,
      referenciaN: res.estat?.n ?? 0, medianaReferencia: res.estat?.mediana ?? null,
      quartil1: res.estat?.q1 ?? null, quartil3: res.estat?.q3 ?? null,
      limiteInferior: res.estat?.inferior ?? null, limiteSuperior: res.estat?.superior ?? null });
    dbg(`Rastreador: ID ${rec.id} classificado como ${res.status}: ${res.motivo} (${ev.evento_id}).`);
  }
  function confirmadoPeloServidor(rec, l, agora) {
    if (rec.status === STATUS_SERVIDOR) return;
    const ultimo = ultimaSaida(rec);
    if (ultimo && ultimo.tipo === 'desaparecimento' && ultimo.status !== STATUS_NAO_VENDIDO) {
      ultimo.status = STATUS_SERVIDOR;
      ultimo.incluiEstatistica = true;
      ultimo.confirmadoServidor = true;
      ultimo.classificacaoOriginal = ultimo.classificacaoOriginal || rec.status;
      criarEvento(rec, { tipo: 'confirmacao_servidor', status: STATUS_SERVIDOR,
        evento_corrigido: ultimo.evento_id, confirmadoServidor: true, incluiEstatistica: false,
        data: agora, motivo: 'Resposta explícita de venda do servidor' });
    } else {
      criarEvento(rec, { tipo: 'confirmacao_servidor', status: STATUS_SERVIDOR,
        confirmadoServidor: true, incluiEstatistica: true, data: agora,
        motivo: 'Resposta explícita de venda do servidor' });
    }
    rec.status = STATUS_SERVIDOR; rec.confirmada = true; rec.vendidoEm = agora;
    rec.raw = rawStr(l) || rec.raw;
  }

  function rastrearMercado(snapshot, { completa = true } = {}) {
    if (!trackAtivo() || !st.pkPronto || !snapshot || !Array.isArray(snapshot.linhas)) return;
    const { linhas, paginas } = snapshot;
    const agora = snapshot.coletaFim || nowSrv(), mudados = new Map(), presentes = new Set();
    const abertas = linhas.filter(abertoPoke);
    const idsColetados = new Set(linhas.filter(l => l && l.id != null).map(l => String(l.id)));
    // A reconciliação de identidade/vendedor ocorre depois de processar as ofertas observadas.
    for (const l of linhas) {
      if (!l || l.id == null) continue;
      const id = String(l.id); presentes.add(id);
      const observadoEm = snapshot.vistosEm?.get(id) || agora;
      st.pkIdsConfiaveis.add(id);
      const preco = Number(l.preco) || 0, p = lerPokemon(l);
      let rec = st.pkObs.get(id);
      const novo = () => {
        const postagem = normalizarTimer(l.criadoEm);
        return { id, pokemonId: l.pokemonId != null ? String(l.pokemonId) : (l.ficha?.id != null ? String(l.ficha.id) : null),
          vendedorId: l.vendedorId ?? null, vendedor: l.vendedor ?? null,
          especie: p ? p.especie : null, shiny: p ? p.shiny : null, nivel: p ? p.nivel : null,
          perfil: perfilDoAnuncio(l, p), expiraEm: normalizarTimer(l.expiraEm),
          postadoEm: postagem || agora, dataOrigem: postagem ? 'criadoEm' : 'primeira_observacao',
          preco, precoInicial: preco, status: STATUS_ATIVO, confirmada: false, primeiraVez: observadoEm,
          ultimaVez: observadoEm, vendidoEm: null, enviado: false, faltas: 0, raw: rawStr(l),
          eventos: [], contadorEventos: 0, alteradoEm: agora };
      };
      if (abertoPoke(l)) {
        if (!rec) {
          rec = novo(); st.pkObs.set(id, rec);
          criarEvento(rec, { tipo: 'anuncio_observado', status: STATUS_ATIVO,
            data: observadoEm, motivo: 'Anúncio observado no mercado' });
          mudados.set(id, rec);
        }
        else if (rec.status !== STATUS_SERVIDOR) {
          const antes = rec.status;
          if (antes !== STATUS_ATIVO) marcarReaparecimento(rec, l, agora);
          const visitaAnterior = Number(rec.ultimaVez) || 0;
          if (antes === STATUS_ATIVO) marcarReprecificacao(rec, l, agora);
          rec.ultimaVez = observadoEm; rec.faltas = 0; rec.ultimoSentidoAusencia = null; rec.primeiroAusenteEm = null;
          rec.coberturaRuidosaAusencia = false;
          rec.preco = preco || rec.preco;
          rec.raw = rawStr(l) || rec.raw;
          rec.perfil = perfilDoAnuncio(l, p);
          rec.expiraEm = normalizarTimer(l.expiraEm);
          rec.especie = p?.especie || rec.especie; rec.shiny = p?.shiny ?? rec.shiny;
          rec.nivel = p?.nivel ?? rec.nivel;
          rec.pokemonId = rec.pokemonId || (l.pokemonId != null ? String(l.pokemonId) : (l.ficha?.id != null ? String(l.ficha.id) : null));
          rec.vendedorId = rec.vendedorId ?? l.vendedorId ?? null;
          rec.vendedor = rec.vendedor || l.vendedor || null;
          if (antes !== STATUS_ATIVO || agora - visitaAnterior > 300000 || rec.alteradoEm === agora) mudados.set(id, rec);
        }
      } else {
        const vendido = l.comprador || /vend|sold|compr|conclu/i.test(String(l.estado || ''));
        if (!vendido) continue;
        if (!rec) { rec = novo(); st.pkObs.set(id, rec); }
        confirmadoPeloServidor(rec, l, agora);
        mudados.set(id, rec);
      }
    }
    // Reaparição sob novo #ID com mesmo pokemonId: corrige o anúncio antigo,
    // preserva o #ID anterior e acompanha o preço novo em uma linha própria.
    // Ver um anúncio é suficiente; a reconciliação não exige varredura completa
    // para anúncios antigos já classificados como Incerto.
    reconciliarReanuncios(snapshot, presentes, mudados, agora, completa);
    // Exige duas coberturas independentes em sentidos opostos também para
    // converter Incerto em venda provável após a semana. Nunca usar a passagem
    // do tempo sozinha como prova de venda.
    if (completa) for (const rec of st.pkObs.values()) {
      if (statusIncerto(rec.status) && !presentes.has(rec.id)) {
        if (rec.ultimoSentidoSemana !== snapshot.sentido) {
          if (!(rec.confirmacoesSemana > 0)) rec.coberturaRuidosaSemana = false;
          rec.coberturaRuidosaSemana = !!rec.coberturaRuidosaSemana || !!snapshot.coberturaRuidosa;
          rec.confirmacoesSemana = Math.min(3, (rec.confirmacoesSemana || 0) + 1);
          rec.ultimoSentidoSemana = snapshot.sentido;
          mudados.set(rec.id, rec);
        }
      } else if (presentes.has(rec.id) && rec.confirmacoesSemana) {
        rec.confirmacoesSemana = 0;
        rec.ultimoSentidoSemana = null;
        rec.coberturaRuidosaSemana = false;
        mudados.set(rec.id, rec);
      }
    }
    // Após 7 dias, reavalia somente após coberturas válidas, sem outro anúncio
    // conhecido do mesmo Pokémon no intervalo.
    if (completa) reavaliarIncertosAposSemana(snapshot, presentes, mudados, agora);
    // Indexa referências UMA vez por ciclo: não percorre milhares de anúncios para cada ID ausente.
    if (completa && abertas.length && st.pkTrackTemBase) snapshot.indiceReferencias = indexarReferencias(snapshot, agora);
    // Comparação EXCLUSIVAMENTE contra snapshots de todas as páginas, com base anterior completa.
    if (completa && abertas.length && st.pkTrackTemBase) {
      for (const rec of st.pkObs.values()) {
        if (rec.status !== STATUS_ATIVO || presentes.has(rec.id)) continue;
        // Não contar duas leituras com o mesmo sentido como provas independentes.
        if (rec.ultimoSentidoAusencia !== snapshot.sentido) {
          if (!(rec.faltas > 0)) rec.coberturaRuidosaAusencia = false;
          rec.coberturaRuidosaAusencia = !!rec.coberturaRuidosaAusencia || !!snapshot.coberturaRuidosa;
          rec.faltas = Math.min(3, (rec.faltas || 0) + 1);
          rec.ultimoSentidoAusencia = snapshot.sentido;
          if (rec.faltas === 1) rec.primeiroAusenteEm = agora;
        }
        if (rec.faltas >= (rec.coberturaRuidosaAusencia ? 3 : 2)) {
          // Base recente do IndexedDB é útil após recarregar a página; uma
          // observação antiga demais nunca sustenta a hipótese temporal de saída.
          const vistoHa = agora - Number(rec.ultimaVez || 0);
          if (st.pkIdsConfiaveis.has(rec.id) || (vistoHa >= 0 && vistoHa <= 48*3600000)) {
            registrarDesaparecimento(rec, snapshot, agora);
          } else {
            rec.status = STATUS_SEM_BASE;
            rec.faltas = 0;
            criarEvento(rec, { tipo: 'desaparecimento', status: STATUS_SEM_BASE,
              data: agora, incluiEstatistica: false,
              motivo: 'Anúncio antigo não foi visto nesta sessão; saída sem intervalo confiável' });
          }
        }
        mudados.set(rec.id, rec);
      }
    }
    if (completa && !st.pkTrackTemBase) {
      for (const rec of st.pkObs.values()) if (rec.status === STATUS_ATIVO && !presentes.has(rec.id)) {
        rec.faltas = 0; rec.ultimoSentidoAusencia = null; rec.primeiroAusenteEm = null;
        rec.coberturaRuidosaAusencia = false; mudados.set(rec.id, rec);
      }
    }
    if (completa) st.pkTrackTemBase = true;
    // Um bloco parcial de um censo NÃO deve apagar o progresso visível do próprio censo.
    if (!(st.pkTrackInfo?.emCenso && !completa))
      st.pkTrackInfo = { paginas, total: snapshot.total, atualizadoEm: Date.now(), parcial: !completa, erro: null };
    const gravacao = mudados.size ? persistirPokemon([...mudados.values()]) : Promise.resolve();
    if (ui && ui.atualizarPokemon && [...mudados.values()].some(r => r.status !== STATUS_ATIVO)) ui.atualizarPokemon();
    return gravacao;
  }

  function eventosAuditaveis() {
    const out = [];
    for (const r of st.pkObs.values()) {
      if (Array.isArray(r.eventos) && r.eventos.length) {
        for (const e of r.eventos) out.push({ ...e });
      } else if (r.status !== STATUS_ATIVO) {
        // Registros das versões anteriores sem evento: preservados apenas na auditoria.
        out.push({ evento_id: `${r.id}:legado`, id: r.id, tipo: 'legado',
          status: r.status === STATUS_SERVIDOR ? STATUS_SERVIDOR : STATUS_SEM_BASE,
          incluiEstatistica: false, confirmadoServidor: r.status === STATUS_SERVIDOR,
          data: r.vendidoEm || r.ultimaVez, preco: r.preco, especie: r.especie, shiny: r.shiny,
          nivel: r.nivel, raw: r.raw, motivo: 'dado legado sem timer ou estatística completos' });
      }
    }
    return out.sort((a,b) => Number(a.data || 0) - Number(b.data || 0));
  }
  const eventosFiltrados = () => eventosAuditaveis().filter(e => e.incluiEstatistica && statusDeVenda(e.status));
  const resumoBanco = () => {
    let vendas = 0, provaveis = 0, incertos = 0, cancelados = 0, ativos = 0, invalidos = 0, pendentes = 0;
    for (const r of st.pkObs.values()) {
      if (r.status === STATUS_ATIVO) ativos++;
      else if (r.status === STATUS_SERVIDOR) vendas++;
      else if (r.status === STATUS_PROVAVEL) provaveis++;
      else if (r.status === STATUS_CANCELADO) cancelados++;
      else incertos++;
      invalidos += (r.eventos || []).filter(e => e.status === STATUS_NAO_VENDIDO).length;
      pendentes += (r.eventos || []).filter(e => !e.enviado).length;
    }
    return { vendidos: vendas, provaveis, incertos, cancelados, invalidados: invalidos, abertos: ativos, pendentes };
  };

  // ---------- exportação (CSV para importar no Google Sheets) ----------
  function achatar(o, pre = '', out = {}) {
    for (const [k, v] of Object.entries(o || {})) {
      const nome = pre ? `${pre}_${k}` : k;
      if (v && typeof v === 'object' && !Array.isArray(v)) achatar(v, nome, out);
      else out[nome] = Array.isArray(v) ? JSON.stringify(v) : v;
    }
    return out;
  }
  const isoServidor = t => (t == null || !Number.isFinite(Number(t)) ? '' : new Date(Number(t) - st.off).toISOString());
  const classePt = status => ({
    aberto: 'Aberto', vendido: 'Vendido (servidor)', venda_provavel: 'Vendido (provável)',
    expirado_incerto: 'Incerto (expirado)', outlier_incerto: 'Incerto (outlier)',
    incerto_sem_dados: 'Incerto (dados insuficientes)',
    nao_vendido_preco_anterior: 'Cancelado / Reanunciado', cancelado: 'Cancelado',
    preco_alterado: 'Aberto (preço alterado)'
  })[status] || status;
  const dataBr = t => Number.isFinite(t) && t > 0 ? new Intl.DateTimeFormat('pt-BR',
    { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' }).format(t) : '';
  function linhaPlanilha(e) {
    let raw = {}; try { raw = JSON.parse(e.raw || '{}'); } catch { /* sem raw */ }
    const ficha = raw.ficha && typeof raw.ficha === 'object' ? raw.ficha : {};
    const iv = ficha.ivs && typeof ficha.ivs === 'object' ? ficha.ivs : {};
    const p = lerPokemon(raw);
    const sprite = p?.icone || '';
    // criadoEm é a data verdadeira da postagem. Não confundir com ultimaVez (última leitura).
    const postado = normalizarTimer(raw.criadoEm) || normalizarTimer(e.postadoEm) || null;
    const origem = normalizarTimer(raw.criadoEm) ? 'criadoEm' : (e.dataOrigem || 'nao_informada');
    const postagem = postado || (Number.isFinite(Number(e.ultimaVez)) ? Number(e.ultimaVez) : null);
    const preco = Number(e.preco);
    const precoMi = Number.isFinite(preco) && preco > 0 ? preco / 1e6 : null;
    const nome = ficha.nome || e.especie || p?.especie || '';
    return { id: String(e.id), anuncio_id: String(e.id), pokemon_id: e.pokemonId || raw.pokemonId || ficha.id || '',
      evento_id: e.evento_id || '', tipo_evento: e.tipo || '',
      status: e.status, status_compra: classePt(e.status), classificacao: classePt(e.status),
      classificacao_original: e.classificacaoOriginal || '',
      confirmada: e.confirmadoServidor ? 'sim' : 'nao',
      base_preco: e.incluiEstatistica && statusDeVenda(e.status) ? 'sim' : 'nao',
      motivo: e.motivo || '', evento_corrigido: e.evento_corrigido || '',
      reanuncio_anterior: e.reanuncioDoId || '', novo_anuncio_id: e.novo_anuncio_id || '',
      data_postagem: dataBr(postagem), data_dd_mm: dataBr(postagem).slice(0, 5),
      data_origem: origem, postado_em_ms: postagem || '', data_evento_ms: e.data || '',
      evento_em: isoServidor(e.data), ultima_observacao: isoServidor(e.ultimaVez), primeira_vez: isoServidor(postagem),
      especie: nome, pokemon: nome, sprite_url: sprite,
      nivel: ficha.level ?? e.nivel ?? '',
      shiny: ficha.shiny === true || e.shiny === true ? 'Sim' : 'Não',
      preco: e.preco, preco_mi: precoMi, nota: ficha.nota ?? '',
      potencia: ficha.potencia ?? '', qualidade: ficha.quality ?? ficha.qualidade ?? '',
      iv_hp: iv.hp ?? '', iv_atq: iv.atk ?? '', iv_def: iv.def ?? '',
      iv_spatq: iv.spAtk ?? '', iv_spdef: iv.spDef ?? '', iv_sped: iv.speed ?? '',
      iv_somado: ficha.ivTotal ?? somarIvs(raw) ?? '',
      preco_anterior: e.preco_anterior ?? '', preco_novo: e.preco_novo ?? '',
      amostra_n: e.referenciaN ?? '', mediana_referencia: e.medianaReferencia ?? '',
      quartil_1: e.quartil1 ?? '', quartil_3: e.quartil3 ?? '',
      limite_inferior: e.limiteInferior ?? '', limite_superior: e.limiteSuperior ?? '',
      expira_em: isoServidor(e.expiraEm), reapareceu_em: isoServidor(e.reapareceuEm),
      ...achatar(raw, 'anuncio') };
  }
  function baixarCsvVendas(nome = 'pokeidle-vendas-pokemon.csv', tipo = 'filtrado') {
    const evs = tipo === 'auditoria' ? eventosAuditaveis() : eventosFiltrados();
    const regs = evs.map(linhaPlanilha);
    if (!regs.length) return 0;
    const cols = [...new Set(regs.flatMap(Object.keys))];
    const esc = v => { const t = v == null ? '' : String(v); return /[",\n;]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
    const csv = '\ufeff' + [cols.join(','), ...regs.map(r => cols.map(c => esc(r[c])).join(','))].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = nome;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return regs.length;
  }

  // ---------- envio ao Sheets: MAIN -> bridge (isolated) -> extension service worker ----------
  // A página PokeIdle pode vetar requisições externas pelo Content-Security-Policy.
  // Por isso o MAIN não usa fetch para o Google. O background possui permissão de host
  // e CONFERE a resposta JSON do Apps Script antes de considerar um evento entregue.
  let pisSheetsSeq = 0;
  function enviarPeloBackground(linhas) {
    return new Promise((resolve, reject) => {
      const reqId = `pis-${Date.now()}-${++pisSheetsSeq}`;
      let timer = null;
      const limpar = () => { window.removeEventListener('message', receber); clearTimeout(timer); };
      function receber(event) {
        if (event.source !== window || event.origin !== window.location.origin) return;
        const msg = event.data;
        if (!msg || msg.source !== 'PIS_BRIDGE' || msg.type !== 'SHEETS_RESULT' || msg.requestId !== reqId) return;
        limpar();
        if (msg.ok === true && msg.resultado && msg.resultado.ok === true) resolve(msg.resultado);
        else reject(new Error(String(msg.error || msg.resultado?.erro || 'Apps Script não confirmou a gravação')));
      }
      window.addEventListener('message', receber);
      timer = setTimeout(() => {
        limpar();
        reject(new Error('Extensão não respondeu (45 s); atualize manifest.json, bridge.js e background.js'));
      }, 45000);
      window.postMessage({ source: 'PIS_MAIN', type: 'SHEETS_POST', requestId: reqId, linhas }, window.location.origin);
    });
  }

  async function enviarParaPlanilha() {
    if (!FIXO.sheetsUrl || st.pkEnviando || !st.pkPronto) return;
    const pend = [];
    for (const r of st.pkObs.values()) for (const e of r.eventos || [])
      if (!e.enviado) pend.push({ rec: r, evento: e });
    const lote = pend.slice(0, 35);
    if (!lote.length) return;
    st.pkEnviando = true;
    try {
      const confirmado = await enviarPeloBackground(lote.map(x => linhaPlanilha(x.evento)));
      // Só marcar como enviado com resposta explícita de processamento ok:true.
      // O script deduplica por evento_id, então um retry após falha não duplica linhas.
      for (const x of lote) x.evento.enviado = true;
      try {
        await persistirPokemon(lote.map(x => x.rec));
      } catch (e) {
        // O retry poderá reenviar após recarregar; Apps Script mantém idempotência.
        dbg('Sheets: resposta OK, mas não consegui persistir os indicadores locais:', e.message);
      }
      if (st.pkAvisos.falhaSheets) logPk(`✅ SHEETS: conexão restabelecida; ${lote.length} eventos processados.`);
      st.pkAvisos.falhaSheets = false;
      st.pkAvisos.ultimaConfirmacaoSheets = Date.now();
      if (ui?.atualizarPokemon) ui.atualizarPokemon();
      dbg(`Sheets: ${lote.length} enviados; ${JSON.stringify(confirmado).slice(0, 220)}`);
    } catch (e) {
      dbg('Sheets: falha ao confirmar entrega:', e.message);
      if (!st.pkAvisos.falhaSheets || st.pkAvisos.ultimaFalhaSheets !== e.message) {
        st.pkAvisos.falhaSheets = true;
        st.pkAvisos.ultimaFalhaSheets = e.message;
        logPk(`⚠️ SHEETS: ${e.message}. Os eventos permanecem pendentes no banco local.`);
      }
    } finally { st.pkEnviando = false; }
  }
  setInterval(() => enviarParaPlanilha().catch(e => dbg('Sheets:', e.message)), 15000);

  // ---------- Importação manual de CSV de auditoria para o Apps Script ----------
  // Envia o CSV diretamente ao banco remoto (abas eventos/Sheet), sem consultar o jogo,
  // alterar o IndexedDB ou acionar compras. evento_id é a chave idempotente no servidor.
  function lerCsvAuditoria(texto) {
    const bruto = String(texto || '').replace(/^\uFEFF/, '');
    if (!bruto.trim()) throw new Error('CSV vazio');
    const primeiraLinha = bruto.split(/\r?\n/, 1)[0];
    const delimitador = (primeiraLinha.match(/;/g) || []).length >
      (primeiraLinha.match(/,/g) || []).length ? ';' : ',';
    const registros = [];
    let linha = [], campo = '', aspas = false;
    for (let i = 0; i < bruto.length; i++) {
      const c = bruto[i];
      if (aspas) {
        if (c === '"' && bruto[i + 1] === '"') { campo += '"'; i++; }
        else if (c === '"') aspas = false;
        else campo += c;
      } else if (c === '"' && campo === '') aspas = true;
      else if (c === delimitador) { linha.push(campo); campo = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && bruto[i + 1] === '\n') i++;
        linha.push(campo); campo = '';
        if (linha.some(x => x !== '')) registros.push(linha);
        linha = [];
      } else campo += c;
    }
    if (aspas) throw new Error('CSV com aspas não fechadas');
    linha.push(campo);
    if (linha.some(x => x !== '')) registros.push(linha);
    if (registros.length < 2) throw new Error('CSV sem registros');
    const colunas = registros.shift().map(x => x.trim().replace(/^\uFEFF/, ''));
    if (new Set(colunas).size !== colunas.length) throw new Error('CSV com colunas repetidas');
    const colEvento = colunas.indexOf('evento_id');
    const colId = colunas.indexOf('id') >= 0 ? colunas.indexOf('id') : colunas.indexOf('anuncio_id');
    if (colEvento < 0 || colId < 0) throw new Error('O CSV precisa das colunas evento_id e id (ou anuncio_id)');
    const numeric = new Set(['data_evento_ms', 'postado_em_ms', 'preco', 'preco_mi', 'nivel',
      'iv_hp', 'iv_atq', 'iv_def', 'iv_spatq', 'iv_spdef', 'iv_sped', 'iv_somado',
      'potencia', 'qualidade', 'nota', 'amostra_n', 'mediana_referencia',
      'quartil_1', 'quartil_3', 'limite_inferior', 'limite_superior']);
    const vistos = new Set();
    const eventos = [];
    let duplicadosArquivo = 0;
    for (let i = 0; i < registros.length; i++) {
      const valores = registros[i];
      if (valores.length !== colunas.length)
        throw new Error(`Linha ${i + 2}: ${valores.length} campos; esperado ${colunas.length}`);
      const eid = valores[colEvento].trim();
      const id = valores[colId].trim();
      if (!eid || !id || eid.length > 128) throw new Error(`Linha ${i + 2}: evento_id ou id inválido`);
      if (vistos.has(eid)) { duplicadosArquivo++; continue; }
      vistos.add(eid);
      const obj = {};
      for (let j = 0; j < colunas.length; j++) {
        const chave = colunas[j];
        let v = valores[j];
        if (numeric.has(chave) && v !== '' && Number.isFinite(Number(v))) v = Number(v);
        obj[chave] = v;
      }
      obj.evento_id = eid;
      obj.id = id;
      eventos.push(obj);
    }
    if (!eventos.length) throw new Error('Nenhum evento válido para importar');
    return { eventos, duplicadosArquivo };
  }

  async function importarCsvParaSheets(arquivo, atualizar) {
    if (!arquivo) return;
    if (!FIXO.sheetsUrl) throw new Error('URL do Sheets não configurada');
    if (st.pkEnviando || st.pkImportando) throw new Error('Já existe outro envio em andamento; tente novamente');
    if (arquivo.size > 10 * 1024 * 1024) throw new Error('Arquivo maior que 10 MB; divida em arquivos menores');
    const { eventos, duplicadosArquivo } = lerCsvAuditoria(await arquivo.text());
    if (eventos.length > 20000) throw new Error('Importação limitada a 20.000 eventos por arquivo');
    const nLotes = Math.ceil(eventos.length / 25);
    if (!confirm(`Enviar ${eventos.length} eventos do CSV para o Google Sheets em ${nLotes} lote(s)?\n` +
      `Duplicados no arquivo: ${duplicadosArquivo}. Eventos já existentes no Sheets não serão repetidos.`)) return;
    st.pkEnviando = true;
    st.pkImportando = true;
    let enviados = 0, novos = 0, repetidos = 0, atualizados = 0;
    try {
      for (let i = 0; i < eventos.length; i += 25) {
        const lote = eventos.slice(i, i + 25);
        atualizar(`Importando ${i + 1}–${i + lote.length} de ${eventos.length}…`);
        const resp = await enviarPeloBackground(lote);
        if (Number(resp.eventos_recebidos) !== lote.length)
          throw new Error(`Lote ${Math.floor(i / 25) + 1}: servidor não confirmou a quantidade recebida`);
        enviados += lote.length;
        novos += Number(resp.eventos_novos || 0);
        repetidos += Number(resp.eventos_duplicados || 0);
        atualizados += Number(resp.linhas_novas || 0) + Number(resp.linhas_atualizadas || 0);
        atualizar(`${enviados}/${eventos.length} enviados · ${novos} eventos novos · ${repetidos} já existentes`);
        if (i + lote.length < eventos.length) await sleep(800);
      }
      logPk(`✅ CSV importado no Sheets: ${enviados} eventos aceitos, ${novos} novos, ${repetidos} duplicados; ${atualizados} inserções/atualizações no resumo.`);
      atualizar(`✅ Concluído: ${enviados} enviados, ${novos} novos, ${repetidos} duplicados no Sheets.`);
    } catch (e) {
      atualizar(`⚠️ Interrompido após ${enviados}/${eventos.length}: ${e.message}. Pode selecionar o mesmo CSV novamente; os eventos já gravados não duplicam.`);
      logPk(`⚠️ CSV: importação interrompida após ${enviados}/${eventos.length}: ${e.message}`);
    } finally {
      st.pkImportando = false;
      st.pkEnviando = false;
    }
  }

  // ---------- cópia automática do banco em CSV (pasta Downloads) ----------
  const K_CSV_AUTO = 'pis_csv_auto_v1';
  function csvAutomatico() {
    const horas = Number(FIXO.csvAutoHoras);
    if (!(horas > 0) || !st.pkPronto) return;
    const ult = lsGet(K_CSV_AUTO, { t: 0, n: 0 });
    const evs = eventosAuditaveis();
    let ultimaMudanca = 0;
    for (const r of st.pkObs.values()) ultimaMudanca = Math.max(ultimaMudanca, Number(r.alteradoEm) || 0);
    if (!evs.length || (ultimaMudanca <= (ult.mudanca || 0) && evs.length <= ult.n) ||
        Date.now() - ult.t < horas * 3600000) return;
    const d = new Date(), z = x => String(x).padStart(2, '0');
    const prefixo = `pokeidle-pokemon-${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}_${z(d.getHours())}h${z(d.getMinutes())}`;
    const n = baixarCsvVendas(prefixo + '-auditoria.csv', 'auditoria');
    if (eventosFiltrados().length) baixarCsvVendas(prefixo + '-vendas-filtradas.csv', 'filtrado');
    if (n) {
      lsSet(K_CSV_AUTO, { t: Date.now(), n, mudanca: ultimaMudanca });
      logPk(`💾 CSV salvo automaticamente em Downloads: ${n} eventos de auditoria.`);
    }
  }
  setInterval(() => { try { csvAutomatico(); } catch (e) { dbg('CSV automático:', e.message); } }, 600000);

  async function loopPokemon(id) {
    while (st.running && id === st.loopId) {
      if (pokeAtivo()) {
        try {
          // Compra de Pokémon continua independente do rastreador de páginas.
          await naFilaItem(() => tryPokemon(cfg(), { runId: id }));
          st.pokeErros = 0;
        } catch (e) {
          st.pokeErros++;
          dbg('Pokémon: falha na consulta:', e.message);
          if (st.pokeErros === 1 || st.pokeErros % 10 === 0)
            log(`⚠️ POKEMON: consulta sem resposta (${e.message}). Se persistir, reabra o mercado de Pokémon no jogo.`, true);
        }
      }
      await sleep(INTERVALO_POKE_MS);
    }
  }

  // Primeiro censo completo; após um censo VÁLIDO, inicia outro assim que
  // concluir a persistência e reconciliação, sem pausa entre censos.
  // Após erro ou censo INCONSISTENTE, mantém retentativa com backoff.
  // A fila global impõe >=2s entre pedidos e impede concorrência.
  // A primeira varredura completa é BASE: um anúncio antigo já ausente não é vendido retroativamente.
  // Retoma o último patamar adaptativo após reiniciar a aba ou a extensão.
  const ajusteCensoSalvo = lsGet(K_INTERVALO_CENSO_1547, {});
  st.pkIntervaloCensoIndice = Number.isInteger(ajusteCensoSalvo.indice) &&
    ajusteCensoSalvo.indice >= 0 && ajusteCensoSalvo.indice < INTERVALOS_CENSO_MS.length
      ? ajusteCensoSalvo.indice : 0;
  st.pkUltimoAjusteCenso = Number.isFinite(ajusteCensoSalvo.ajustadoEm)
    ? ajusteCensoSalvo.ajustadoEm : 0;
  st.pkPaginaRotativa = 1;
  st.pkUltimaCompleta = 0;
  st.pkProximoCenso = 0;
  st.pkFalhasCenso = 0;
  // Uma base recente pode sobreviver ao recarregamento da aba. Nunca usar uma
  // base muito antiga como prova de ausência (o navegador pode ter ficado desligado).
  const baseCensoSalva = lsGet(K_CENSO_VALIDO_154, {});
  st.pkUltimoCensoValido = Number(baseCensoSalva.em) || 0;
  st.pkTrackTemBase = Number.isFinite(Number(baseCensoSalva.em)) &&
    Date.now() - Number(baseCensoSalva.em) >= 0 &&
    Date.now() - Number(baseCensoSalva.em) <= 6 * 3600000;
  st.pkDirecaoCenso = lsGet(K_CENSO_SENTIDO_154, 'asc') === 'desc' ? 'desc' : 'asc';
  st.pkIdsConfiaveis = new Set(); // vistos realmente nesta sessão (checagem extra)

  // Em um mercado vivo, exigir total/IDs imutáveis por ~50 páginas impede
  // praticamente todos os censos. Separar integridade da COBERTURA e estabilidade.
  // Uma cobertura válida visita CADA página exigida pelo maior total observado,
  // mesmo quando houve pequena variação e algum anúncio migrou entre páginas.
  // A ausência somente é aceita após duas coberturas em sentidos ALTERNADOS.
  async function varrerTodasPaginas() {
    const inicio = nowSrv();
    const sentido = st.pkDirecaoCenso;
    const primeira = await consultarPaginaRastreador(0);
    const totalInicial = numeroInteiroNaoNegativo(primeira.total);
    const tamanho = numeroInteiroNaoNegativo(primeira.porPagina) || primeira.linhas.length;
    if (!(tamanho > 0) || totalInicial == null || totalInicial === 0)
      throw new Error('censo sem tamanho/total de página confiáveis');
    let nPaginas = Math.max(1, Math.ceil(totalInicial / tamanho));
    if (nPaginas > MAX_PAGINAS_RASTREADOR)
      throw new Error(`mercado com ${nPaginas} páginas (limite ${MAX_PAGINAS_RASTREADOR})`);
    const unicos = new Map(), vistosEm = new Map(), origemIds = new Map();
    // Cada ID conta no máximo uma vez, mesmo quando ele migra por várias páginas
    // ou volta a aparecer na releitura da primeira página ao final do censo.
    const idsDeslocados = new Set();
    const buffer = new Map(), bufferVistos = new Map(), paginasLidas = new Set();
    let menorTotal = totalInicial, maiorTotal = totalInicial;
    let duplicados = 0, paginasIncompletas = 0, tamanhosInconsistentes = false;
    const salvarBloco = async () => {
      if (!buffer.size) return;
      await rastrearMercado({linhas:[...buffer.values()],vistosEm:new Map(bufferVistos),
        paginas:nPaginas,total:maiorTotal,coletaInicio:inicio,coletaFim:nowSrv()}, {completa:false});
      buffer.clear(); bufferVistos.clear();
    };
    const acumular = (r, pagina) => {
      if (!r || !Array.isArray(r.linhas) || Number(r.pagina) !== pagina)
        throw new Error('página sem resposta identificável: ' + pagina);
      const total = numeroInteiroNaoNegativo(r.total);
      if (total == null) { tamanhosInconsistentes = true; }
      else {
        menorTotal = Math.min(menorTotal, total);
        maiorTotal = Math.max(maiorTotal, total);
        const paginasNecessarias = Math.max(1, Math.ceil(total / tamanho));
        if (paginasNecessarias > MAX_PAGINAS_RASTREADOR)
          throw new Error(`mercado cresceu além de ${MAX_PAGINAS_RASTREADOR} páginas`);
        nPaginas = Math.max(nPaginas, paginasNecessarias);
      }
      const pp = numeroInteiroNaoNegativo(r.porPagina);
      if (pp != null && pp !== tamanho) tamanhosInconsistentes = true;
      if (r.linhas.length > tamanho) paginasIncompletas++;
      // Página interna incompleta pode indicar filtros/erro de consulta.
      if (total != null && pagina < Math.floor(total / tamanho) && r.linhas.length !== tamanho)
        paginasIncompletas++;
      paginasLidas.add(pagina);
      const idsPagina = new Set(), momento = nowSrv();
      for (const l of r.linhas) {
        if (!l || l.id == null) throw new Error('anúncio sem ID na página ' + pagina);
        const id = String(l.id);
        if (idsPagina.has(id)) paginasIncompletas++; // repetição na própria página: erro real
        idsPagina.add(id);
        if (origemIds.has(id) && origemIds.get(id) !== pagina && !idsDeslocados.has(id)) {
          idsDeslocados.add(id);
          duplicados++; // conta cada ID deslocado apenas uma vez
        }
        if (!origemIds.has(id)) origemIds.set(id, pagina);
        unicos.set(id, l);
        vistosEm.set(id, momento);
        buffer.set(id, l);
        bufferVistos.set(id, momento);
      }
    };
    acumular(primeira, 0);
    st.pkTrackInfo = {paginas:1,total:maiorTotal,paginasEsperadas:nPaginas,
      idsUnicos:unicos.size,emCenso:true,ultimaRespostaEm:Date.now(),
      atualizadoEm:Date.now(),erro:null};
    let visitas = 1;
    try {
      // Ler página 0 no começo e no fim. Alternar ASC/DESC nos demais índices
      // reduz o viés sistemático da paginação por preço quando há churn.
      const ordem = Array.from({length: Math.max(0,nPaginas-1)},(_,i)=>i+1);
      if (sentido === 'desc') ordem.reverse();
      while (ordem.length) {
        if (!trackAtivo() || !st.sock || st.sock.readyState !== 1)
          throw new Error('censo interrompido: mercado ou WebSocket indisponível');
        const pagina = ordem.shift();
        await sleep(PAUSA_ENTRE_PAGINAS_COMPLETAS_MS);
        acumular(await consultarPaginaRastreador(pagina), pagina);
        visitas++;
        // Se o mercado ganhou uma nova página durante o censo, adicioná-la.
        // Não confiar num snapshot que parou na antiga última página.
        for (let extra = 1; extra < nPaginas; extra++)
          if (!paginasLidas.has(extra) && !ordem.includes(extra))
            (sentido === 'desc' ? ordem.unshift(extra) : ordem.push(extra));
        if (visitas % 10 === 0) {
          await salvarBloco();
          st.pkTrackInfo = {paginas:paginasLidas.size,total:maiorTotal,
            paginasEsperadas:nPaginas,idsUnicos:unicos.size,emCenso:true,
            ultimaRespostaEm:Date.now(),parcial:true,atualizadoEm:Date.now(),erro:null};
          if (ui?.atualizarPokemon) ui.atualizarPokemon();
        }
      }
      // Releitura da primeira página verifica que o protocolo segue respondendo;
      // também captura ofertas que migraram para a faixa mais barata.
      await sleep(PAUSA_ENTRE_PAGINAS_COMPLETAS_MS);
      acumular(await consultarPaginaRastreador(0), 0);
      visitas++;
      // Se a última releitura revelar uma nova página, ler as extras agora.
      for (let extra=1; extra<nPaginas; extra++) if (!paginasLidas.has(extra)) {
        await sleep(PAUSA_ENTRE_PAGINAS_COMPLETAS_MS);
        acumular(await consultarPaginaRastreador(extra), extra);
        visitas++;
      }
    } catch(e) {
      await salvarBloco();
      throw e;
    }
    await salvarBloco();
    const desvio = maiorTotal - menorTotal;
    const tolerancia = Math.max(30, Math.ceil(maiorTotal * 0.05));
    // Uma resposta do servidor que repete grandes blocos não é cobertura,
    // mesmo que o total informado varie pouco (falha na paginação ou cache).
    const limiteDuplicados = Math.max(8, Math.ceil(maiorTotal * 0.02));
    const paginasCobertas = paginasLidas.size === nPaginas &&
      Array.from({length:nPaginas},(_,i)=>i).every(i=>paginasLidas.has(i));
    const basicoOk = menorTotal > 0 && desvio <= tolerancia &&
      !tamanhosInconsistentes && paginasIncompletas === 0 && paginasCobertas;
    // Uma cobertura 'normal' não pode aceitar MAIS lacunas do que a 'moderada'.
    // Antes havia um furo: normal aceitava apenas 93% do menor total; moderada
    // exigia 97,5% do maior total. Isso arriscava falsos desaparecimentos.
    const densidade = maiorTotal ? unicos.size / maiorTotal : 0;
    const deslocamentoPct = maiorTotal ? duplicados / maiorTotal : 1;
    // Sem excesso artificial de IDs acumulados em uma coleta demorada.
    const limiteSuperior = unicos.size <= maiorTotal + Math.ceil(maiorTotal * 0.05);
    const coberturaNormal = basicoOk && limiteSuperior &&
      duplicados <= limiteDuplicados && densidade >= 0.98;
    // Deslocamento moderado: até 3% de IDs distintos, com >=97,5% de cobertura.
    // Exige 3 censos INDEPENDENTES, em direções alternadas, para inferir ausência.
    const limiteModerado = Math.max(8, Math.ceil(maiorTotal * 0.03));
    const coberturaModerada = basicoOk && limiteSuperior && !coberturaNormal &&
      duplicados <= limiteModerado && densidade >= 0.975;
    const cobertura = coberturaNormal || coberturaModerada;
    const coberturaRuidosa = coberturaModerada;
    const coerente = coberturaNormal && desvio === 0 && duplicados === 0 &&
      unicos.size === totalInicial;
    return {linhas:[...unicos.values()],vistosEm,paginas:nPaginas,total:maiorTotal,
      coletaInicio:inicio,coletaFim:nowSrv(),cobertura,coerente,coberturaRuidosa,
      sentido,desvio,duplicados,limiteDuplicados,limiteModerado,
      paginasIncompletas,menorTotal,maiorTotal,tolerancia,
      densidade,deslocamentoPct,duracaoMs:Math.max(0,nowSrv()-inicio)};
  }

  (async function coletaContinua() {
    for (;;) {
      // Só acelera o próximo ciclo após censo INTEGRALMENTE VALIDADO.
      // Falhas, interrupções, módulo desligado e coletas parciais não ativam isto.
      let reiniciarCensoSemEspera = false;
      try {
        if (trackAtivo() && st.sock && st.sock.readyState === 1 && st.pkPronto) {
          const precisaCenso = Date.now() >= st.pkProximoCenso;
          if (precisaCenso) {
            const completo = await varrerTodasPaginas();
            // Sempre aproveita anúncios VISÍVEIS, mesmo se o total mudou enquanto lia.
            // Apenas uma cobertura integral validada pode avançar ausências.
            if (completo.cobertura || completo.linhas.length) {
              const baseline = st.pkTrackTemBase;
              await rastrearMercado(completo, { completa: completo.cobertura });
              if (completo.cobertura) {
                st.pkTrackInfo = {paginas:completo.paginas,total:completo.total,
                  atualizadoEm:Date.now(),parcial:false,emCenso:false,erro:null};
                st.pkUltimaCompleta = Date.now();
                st.pkUltimoCensoValido = st.pkUltimaCompleta;
                lsSet(K_CENSO_VALIDO_154, { em: st.pkUltimaCompleta, sentido: completo.sentido, desvio: completo.desvio });
                st.pkDirecaoCenso = completo.sentido === 'asc' ? 'desc' : 'asc';
                lsSet(K_CENSO_SENTIDO_154, st.pkDirecaoCenso);
                st.pkFalhasCenso = 0;
                // Sem os antigos 5 minutos entre censos: pode iniciar outro já.
                // Se houve sobrecarga, respeitar a pausa da rede, sem sobrepor
                // duas leituras completas (coletaContinua é uma só rotina async).
                st.pkProximoCenso = Math.max(Date.now(), st.marketPausaAte);
                reiniciarCensoSemEspera = true;
                logPk(`${completo.coberturaRuidosa ? '🟠 Cobertura moderada' : '✅ Censo com cobertura validada'} (${completo.sentido}): ${completo.linhas.length} IDs em ${completo.paginas} páginas; ` +
                  `variação ${completo.desvio}, ${completo.duplicados} IDs deslocados; ` +
                  `cobertura ${(100*completo.densidade).toFixed(2)}%, duração ${Math.round(completo.duracaoMs/60000)} min. ` +
                  (completo.coberturaRuidosa ? 'Ausências exigem 3 censos alternados; nenhum status muda em apenas 2.' :
                   baseline ? 'Ausências conferidas; mudança de status exige duas leituras opostas.' :
                    'Base inicial criada; aguardando verificações seguintes.'));
              } else {
                st.pkTrackInfo = {paginas:completo.paginas,total:completo.total,
                  atualizadoEm:Date.now(),parcial:true,emCenso:false,
                  erro:'censo sem cobertura confiável'};
                // Censo inconsistente não serve para inferir ausência.
                st.pkFalhasCenso++;
                st.pkProximoCenso = Date.now() + Math.max(intervaloCensoAtualMs(), Math.min(INTERVALO_RETRY_CENSO_MAX_MS,
                  INTERVALO_RETRY_CENSO_MS * Math.pow(2,Math.min(st.pkFalhasCenso-1,3))));
                logPk(`⚠️ Censo sem cobertura confiável (${completo.linhas.length} IDs): ` +
                  `variação ${completo.desvio}/${completo.tolerancia}, IDs deslocados ${completo.duplicados}/${completo.limiteDuplicados} (moderado até ${completo.limiteModerado}), ` +
                  `páginas incompletas ${completo.paginasIncompletas}; ` +
                  `cobertura ${(100*completo.densidade).toFixed(2)}%, duração ${Math.round(completo.duracaoMs/60000)} min. ` +
                  'Somente anúncios observados são salvos; nenhuma ausência classificada.');
              }
            }
          } else {
            const primeira = await consultarPaginaRastreador(0);
            const linhas = [...primeira.linhas];
            const total = numeroInteiroNaoNegativo(primeira.total);
            const tamanho = numeroInteiroNaoNegativo(primeira.porPagina) || linhas.length;
            const paginasTotal = total != null && tamanho > 0
              ? Math.max(1, Math.ceil(total / tamanho)) : 1;
            if (paginasTotal > 1 && trackAtivo()) {
              const pagina = Math.min(Math.max(1, st.pkPaginaRotativa), paginasTotal - 1);
              await sleep(PAUSA_ENTRE_PAGINAS_COMPLETAS_MS);
              linhas.push(...(await consultarPaginaRastreador(pagina)).linhas);
              st.pkPaginaRotativa = pagina + 1 >= paginasTotal ? 1 : pagina + 1;
            }
            const unicos = new Map();
            for (const l of linhas) if (l && l.id != null) unicos.set(String(l.id), l);
            if (unicos.size) await rastrearMercado({ linhas: [...unicos.values()],
              paginas: paginasTotal > 1 ? 2 : 1, total: total ?? unicos.size,
              coletaInicio: nowSrv(), coletaFim: nowSrv() }, { completa: false });
          }
          st.pkTrackErros = 0;
        }
      } catch (e) {
        st.pkTrackErros++;
        if (Date.now() >= st.pkProximoCenso) {
          st.pkFalhasCenso++;
          st.pkProximoCenso = Date.now() + Math.max(intervaloCensoAtualMs(), Math.min(INTERVALO_RETRY_CENSO_MAX_MS,
            INTERVALO_RETRY_CENSO_MS * Math.pow(2,Math.min(st.pkFalhasCenso-1,3))));
        }
        st.pkTrackInfo = { ...(st.pkTrackInfo || {}), emCenso:false, erro: e.message };
        dbg(`Rastreador ${EXT_VERSION}:`, e.message);
        if (st.pkTrackErros === 1 || st.pkTrackErros % 10 === 0)
          logPk(`⚠️ Rastreador: ${e.message}. Nenhuma ausência inferida nesta tentativa.`);
      }
      // Não aplicar a espera de 60s da coleta incremental após um censo válido.
      // sleep(0) apenas cede o controle ao navegador; a fila global continua
      // exigindo o intervalo adaptativo antes de cada requisição real.
      if (reiniciarCensoSemEspera && trackAtivo() && Date.now() >= st.pkProximoCenso) {
        await sleep(0);
        continue;
      }
      await sleep(INTERVALO_RASTREADOR_MS);
    }
  })();

  function start() {
    if (!st.sock) return log('Socket do jogo ainda não detectado; espere o jogo carregar.');
    cancelarRetidos();
    st.running = true; st.fails = 0; st.errs = 0;
    st.spent = 0; st.seen = {}; st.invSim = {}; st.pokeSim = [];                       // nova sessão: saldo para compras volta ao total
    log(cfg().dryRun ? 'Ligado em SIMULAÇÃO (não compra)' : 'Ligado com COMPRAS REAIS');
    loop();
    loopPokemon(st.loopId);   // loop() acabou de definir o novo loopId
  }

  // ---------- painel ----------
  function h(tag, css = {}, props = {}) {
    const e = document.createElement(tag);
    Object.assign(e.style, css);
    Object.assign(e, props);
    return e;
  }
  const sp = (s, css = {}) => h('span', css, { textContent: s });
  async function copiarTexto(txt) {
    try { await navigator.clipboard.writeText(txt); return true; } catch { /* tenta o método antigo */ }
    try {
      const ta = h('textarea', { position: 'fixed', left: '-9999px', opacity: '0' }, { value: txt });
      document.body.append(ta); ta.select();
      const ok = document.execCommand('copy'); ta.remove();
      return ok;
    } catch { return false; }
  }
  const ouro = n => sp(n == null ? '?' : abrev(n), { color: COR.gold, fontWeight: '600' });

  function render() {
    if (!ui) return;
    const c = cfg();
    ui.status.textContent = st.running ? (c.dryRun ? 'ligado, simulação' : 'ligado, comprando') : 'parado';
    ui.status.style.color = st.running && !c.dryRun ? '#ff8a8a' : '#f3e6d8';
    ui.btn.textContent = st.running ? 'Parar' : 'Ligar';
    const l1 = h('div');
    l1.append('gold ', ouro(st.gold), ' | gasto na sessão' + (c.dryRun ? ' (simulado)' : '') + ': ', ouro(st.spent), ' de ', ouro(orcamento(c)));
    const l2 = h('div', { marginTop: '2px', opacity: '.8' }, { textContent: st.lastScan });
    ui.info.replaceChildren(l1, l2);
  }

  function buildUI() {
    const c = cfg();
    const box = h('div', {
      position: 'fixed', left: '8px', bottom: '8px', zIndex: '2147483647', width: '290px',
      background: '#1d1420', color: '#f3e6d8', font: '12px/1.4 system-ui, sans-serif',
      border: '1px solid #b8687f', borderRadius: '8px', padding: '8px', maxHeight: '85vh', maxWidth: 'calc(100vw - 16px)', overflow: 'auto'
    });
    ['keydown', 'keyup', 'keypress'].forEach(ev => box.addEventListener(ev, e => e.stopPropagation()));

    const body = h('div', { display: 'none' });
    const head = h('div', { display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' });
    const title = h('strong', {}, { textContent: `Market sniper v${EXT_VERSION}` });
    const status = h('span', { marginLeft: 'auto' }, { textContent: 'parado' });
    head.append(title, status);
    // O título recolhe o painel principal ou volta da tela DESCONTOS/REVENDA.
    head.onclick = () => {
      if (telaAtual) abrirTela(null);
      else body.style.display = body.style.display === 'none' ? 'block' : 'none';
    };

    const btn = h('button', {
      margin: '8px 0 4px', padding: '5px 10px', width: '100%', cursor: 'pointer',
      background: '#b8687f', color: '#fff', border: '0', borderRadius: '5px', fontWeight: '600'
    }, { onclick: () => (st.running ? stop('manual') : start()) });

    const dry = h('input', {}, { type: 'checkbox', checked: c.dryRun });
    dry.onchange = () => {
      if (!dry.checked && !confirm('Sem a simulação, o bot gasta gold de verdade. Continuar?')) { dry.checked = true; return; }
      st.spent = 0; st.seen = {}; st.invSim = {}; st.pokeSim = [];                     // trocar de modo zera o gasto da sessão
      save('dryRun', dry.checked);
    };
    const dryRow = h('label', { display: 'block', margin: '4px 0' });
    dryRow.append(dry, document.createTextNode(' Simulação (não compra)'));

    body.append(btn, dryRow);
    const botaoDescontos = h('button', {
      margin: '8px 0 7px', width: '100%', padding: '10px 8px', cursor: 'pointer',
      background: '#503047', color: '#ffffff', border: '2px solid #a879a2',
      borderRadius: '7px', fontWeight: '900', fontSize: '15px', letterSpacing: '1px'
    }, { textContent: 'DESCONTOS' });
    body.append(botaoDescontos);
    const botaoRevenda = h('button', {
      margin: '0 0 7px', width: '100%', padding: '10px 8px', cursor: 'pointer',
      background: '#503047', color: '#ffffff', border: '2px solid #a879a2',
      borderRadius: '7px', fontWeight: '900', fontSize: '15px', letterSpacing: '1px'
    }, { textContent: 'REVENDA' });
    body.append(botaoRevenda);
    const botaoPokemon = h('button', {
      margin: '0 0 7px', width: '100%', padding: '10px 8px', cursor: 'pointer',
      background: '#503047', color: '#ffffff', border: '2px solid #a879a2',
      borderRadius: '7px', fontWeight: '900', fontSize: '15px', letterSpacing: '1px'
    }, { textContent: 'POKEMON' });
    body.append(botaoPokemon);
    FIELDS.forEach(([k, label]) => {
      const inp = h('input', {
        width: '100%', boxSizing: 'border-box', background: '#2d2030', color: 'inherit',
        border: '1px solid #6b4a63', borderRadius: '4px', padding: '2px 4px'
      }, { type: 'number', step: 'any', min: '0', value: c[k] });
      inp.onchange = () => save(k, Math.max(0, +inp.value || 0));
      body.append(h('div', { marginTop: '5px' }, { textContent: label }), inp);
    });

    const info = h('div', { margin: '8px 0 0', fontSize: '11px' });
    const logEl = h('div', { margin: '6px 0 0', fontSize: '11.5px', maxHeight: '240px', overflow: 'auto' });
    body.append(info, logEl);
    const exportar = h('button', {
      margin: '8px 0 2px', padding: '5px 8px', width: '100%', cursor: 'pointer',
      background: '#423047', color: '#fff', border: '1px solid #6b4a63', borderRadius: '5px'
    }, { textContent: 'Baixar relatório de ofertas e sorteios (.txt)' });
    exportar.onclick = () => {
      const linhas = st.log.slice().reverse().filter(relatorioVisivel)
        .map(e => `[${e.h}] ${e.parts.map(p => p.s).join('')}`);
      const blob = new Blob([linhas.join('\n') + '\n'], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'pokeidle-sniper-relatorio.txt';
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    };
    body.append(exportar);

    // Nova tela quadrada: uma configuração de desconto independente por pedra.
    const telaDescontos = h('div', {
      display: 'none', flexDirection: 'column', height: 'calc(100% - 28px)',
      boxSizing: 'border-box', minHeight: '0', marginTop: '8px', gap: '7px'
    });
    const topoDescontos = h('div', { display: 'flex', alignItems: 'center', gap: '8px' });
    const voltar = h('button', {
      background: '#423047', color: 'white', border: '1px solid #9a6b91',
      borderRadius: '5px', padding: '5px 9px', cursor: 'pointer'
    }, { textContent: '← Voltar' });
    const tituloDescontos = h('strong', { color: '#ffffff', fontSize: '15px' }, { textContent: 'DESCONTOS POR PEDRA' });
    topoDescontos.append(voltar, tituloDescontos);
    const explicacao = h('div', { opacity: '.78', fontSize: '11px' },
      { textContent: 'Compra pela referência dos 7 anúncios mais recentes (com regra de 50+ unidades) e pela % escolhida. ' +
        'Verde = COMPRAR por desconto; vermelho = NÃO COMPRAR nesta aba. ' +
        'Uma pedra pode ficar desligada nas duas abas. Desconto todos preenche os percentuais sem mudar os botões.' });
    // Preenchimento em lote: salva valores INDIVIDUAIS, sem vinculo permanente ao campo geral.
    const linhaTodos = h('div', {
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      gap: '8px', padding: '9px 8px', marginBottom: '2px', borderRadius: '5px',
      background: '#39283d', border: '1px solid #9a6b91'
    });
    const rotuloTodos = h('label', {
      color: '#ffffff', fontWeight: '900', textDecoration: 'underline',
      textUnderlineOffset: '3px', textShadow: '0 0 4px rgba(255,255,255,.55)',
      flex: '1', cursor: 'default', fontSize: '13px'
    }, { textContent: 'Desconto todos' });
    const ultimoTodos = lsGet(K_DESCONTO_TODOS, null);
    const campoTodos = h('input', {
      width: '64px', minWidth: '64px', boxSizing: 'border-box', padding: '5px 3px',
      textAlign: 'center', background: '#1f1927', border: '1px solid #ffffff',
      color: '#ffffff', borderRadius: '5px', fontSize: '12px', fontWeight: '800'
    }, { type: 'number', min: '0', max: '100', step: '0.5',
         value: ultimoTodos !== null && descontoValido(Number(ultimoTodos)) ? String(ultimoTodos) : '' });
    campoTodos.setAttribute('aria-label', 'Desconto todos em porcentagem');
    const porcentagemTodos = h('span', { color: '#ffffff', fontWeight: '900' }, { textContent: '%' });
    const controlesTodos = h('div', { display: 'flex', alignItems: 'center', gap: '4px' });
    controlesTodos.append(campoTodos, porcentagemTodos);
    linhaTodos.append(rotuloTodos, controlesTodos);
    const listaDescontos = h('div', {
      flex: '1', overflowY: 'auto', minHeight: '0', paddingRight: '5px',
      display: 'flex', flexDirection: 'column', gap: '5px'
    });
    // Um único estado armazenado por pedra: DESCONTOS, REVENDA ou nenhum.
    // Verde = esta categoria pode comprar; vermelho = esta categoria NÃO compra.
    // Ativar em uma aba desativa a outra; desligar nunca ativa a outra.
    function botaoCompraPorCategoria(nome, categoria) {
      const botao = h('button', {
        minWidth: '108px', boxSizing: 'border-box', padding: '7px 8px',
        borderRadius: '6px', cursor: 'pointer', fontSize: '11px',
        fontWeight: '900', whiteSpace: 'nowrap', letterSpacing: '.15px',
        color: '#ffffff', transition: 'background-color .15s, border-color .15s'
      }, { type: 'button' });
      const pintar = () => {
        const ativo = modoPedra(nome) === categoria;
        botao.textContent = ativo ? '✔ COMPRAR' : '✕ NÃO COMPRAR';
        botao.style.background = ativo ? '#176c3f' : '#90242e';
        botao.style.border = ativo ? '2px solid #65e99c' : '2px solid #fc7b87';
        botao.style.boxShadow = ativo ? 'inset 0 0 0 1px #11532e' : 'inset 0 0 0 1px #60121c';
        botao.setAttribute('aria-pressed', ativo ? 'true' : 'false');
        botao.setAttribute('aria-label', `${nome}: ${ativo ? 'ativada' : 'desativada'} para compra em ${categoria}`);
        botao.title = ativo
          ? `Desativar ${nome} em ${categoria} (não ativa a outra categoria)`
          : `Ativar ${nome} em ${categoria} (desativa a outra categoria)`;
      };
      botao.onclick = () => {
        const novo = modoPedra(nome) === categoria ? 'desativado' : categoria;
        if (salvarModoPedra(nome, novo)) pintar();
      };
      pintar();
      return botao;
    }

    function atualizarListaDescontos() {
      listaDescontos.replaceChildren();
      const extras = lsGet(K_PEDRAS_CONHECIDAS, []);
      const cAtual = cfg();
      const nomes = [...PEDRAS_INICIAIS, ...(Array.isArray(extras) ? extras : [])]
        .filter((nome, i, all) => !pedraBloqueada(nome, cAtual) &&
          all.findIndex(x => chavePedra(x) === chavePedra(nome)) === i)
        .sort((a,b) => a.localeCompare(b, 'pt-BR'));
      for (const nome of nomes) {
        const linha = h('div', {
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: '8px', padding: '6px 8px', borderRadius: '5px',
          background: '#2b2031', border: '1px solid #493448'
        });
        const rotulo = h('span', {
          color: corPedra(nome), textDecoration: 'underline', fontWeight: '700',
          flex: '1', minWidth: '0', whiteSpace: 'nowrap'
        }, { textContent: nome });
        const lateral = h('div', { display: 'flex', gap: '4px', alignItems: 'center' });
        const marcado = botaoCompraPorCategoria(nome, 'descontos');
        const valor = h('input', {
          width: '64px', minWidth: '64px', boxSizing: 'border-box', padding: '5px 3px',
          textAlign: 'center', background: '#1f1927', border: '1px solid #8b658b',
          color: '#fff', borderRadius: '5px', fontSize: '12px', fontWeight: '700'
        }, { type: 'number', min: '0', max: '100', step: '0.5', value: descontoDaPedra(nome, cAtual) });
        valor.setAttribute('aria-label', `Desconto de ${nome} em porcentagem`);
        valor.onchange = () => {
          const novo = Number(String(valor.value).replace(',', '.'));
          if (!valor.value.trim() || !salvarDescontoPedra(nome, novo)) {
            valor.value = descontoDaPedra(nome, cfg());
            return;
          }
          valor.value = novo;
        };
        const unidade = h('span', { color: '#fff', fontWeight: '700' }, { textContent: '%' });
        lateral.append(marcado, valor, unidade);
        linha.append(rotulo, lateral);
        listaDescontos.append(linha);
      }
    }
    campoTodos.onchange = () => {
      const texto = String(campoTodos.value).trim();
      const novo = Number(texto.replace(',', '.'));
      if (!texto || !descontoValido(novo)) {
        const anterior = lsGet(K_DESCONTO_TODOS, null);
        campoTodos.value = anterior !== null && descontoValido(Number(anterior)) ? String(anterior) : '';
        return;
      }
      // Atualiza todos os percentuais permitidos com UMA gravação; mudanças individuais posteriores são independentes.
      const extras = lsGet(K_PEDRAS_CONHECIDAS, []);
      const atual = cfg();
      const nomes = [...PEDRAS_INICIAIS, ...(Array.isArray(extras) ? extras : [])]
        .filter(nome => !pedraBloqueada(nome, atual));
      const anterior = lsGet(K_DESCONTOS, {});
      const descontos = anterior && typeof anterior === 'object' && !Array.isArray(anterior) ? { ...anterior } : {};
      for (const nome of nomes) descontos[chavePedra(nome)] = novo;
      lsSet(K_DESCONTOS, descontos);
      lsSet(K_DESCONTO_TODOS, novo); // só lembra o ultimo lote aplicado
      campoTodos.value = String(novo);
      atualizarListaDescontos();
    };
    telaDescontos.append(topoDescontos, explicacao, linhaTodos, listaDescontos);

    // REVENDA: compra só para revender. No topo fica o lucro mínimo; abaixo, o inventário comprado
    // pelo bot (com custo médio, menor preço concorrente, preço sugerido e status) e a escolha de
    // quais pedras usam este modo. As categorias DESCONTOS e REVENDA são mutuamente exclusivas.
    const telaRevenda = h('div', {
      display: 'none', flexDirection: 'column', height: 'calc(100% - 28px)',
      boxSizing: 'border-box', minHeight: '0', marginTop: '8px', gap: '8px'
    });
    const topoRevenda = h('div', { display: 'flex', alignItems: 'center', gap: '8px' });
    const voltarRevenda = h('button', {
      background: '#423047', color: '#ffffff', border: '1px solid #9a6b91',
      borderRadius: '5px', padding: '5px 9px', cursor: 'pointer'
    }, { textContent: '← Voltar' });
    topoRevenda.append(voltarRevenda, h('strong', { color: '#ffffff', fontSize: '15px' },
      { textContent: 'REVENDA' }));

    // Apenas preços muito abaixo da mediana entram na lista de candidatos de REVENDA.
    const linhaDescontoRevenda = h('div', {
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px',
      padding: '9px 8px', borderRadius: '5px', background: '#39283d', border: '1px solid #9a6b91'
    });
    const rotuloDescontoRevenda = h('label', { color: '#ffffff', fontWeight: '900', fontSize: '13px', flex: '1' },
      { textContent: 'Desconto mínimo para revenda' });
    const campoDescontoRevenda = h('input', {
      width: '70px', boxSizing: 'border-box', padding: '5px 3px', textAlign: 'center',
      background: '#1f1927', border: '1px solid #ffffff', color: '#ffffff',
      borderRadius: '5px', fontSize: '12px', fontWeight: '800'
    }, { type: 'number', min: '0', max: '100', step: '0.5', value: String(c.descontoMinRevenda) });
    campoDescontoRevenda.setAttribute('aria-label', 'Desconto mínimo para revenda em porcentagem');
    campoDescontoRevenda.onchange = () => {
      const texto = String(campoDescontoRevenda.value).trim();
      const novo = Number(texto.replace(',', '.'));
      if (!texto || !descontoValido(novo)) {
        campoDescontoRevenda.value = String(cfg().descontoMinRevenda);
        return;
      }
      save('descontoMinRevenda', novo);
      campoDescontoRevenda.value = String(novo);
    };
    linhaDescontoRevenda.append(rotuloDescontoRevenda, campoDescontoRevenda,
      h('strong', { color: '#ffffff' }, { textContent: '%' }));

    // Lucro mínimo por unidade: vale para a trava de compra e para o preço sugerido da tabela.
    const linhaLucro = h('div', {
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px',
      padding: '9px 8px', borderRadius: '5px', background: '#39283d', border: '1px solid #9a6b91'
    });
    const rotuloLucro = h('label', { color: '#ffffff', fontWeight: '900', fontSize: '13px', flex: '1' },
      { textContent: 'Lucro mínimo por unidade (gold)' });
    const dicaLucro = h('span', {
      color: COR.gold, fontWeight: '700', fontSize: '11px', minWidth: '56px', textAlign: 'right'
    });
    const campoLucro = h('input', {
      width: '110px', boxSizing: 'border-box', padding: '5px 3px', textAlign: 'center',
      background: '#1f1927', border: '1px solid #ffffff', color: '#ffffff',
      borderRadius: '5px', fontSize: '12px', fontWeight: '800'
    }, { type: 'number', min: '0', step: 'any', value: String(c.lucroMin) });
    campoLucro.setAttribute('aria-label', 'Lucro mínimo por unidade em gold');
    const mostrarDicaLucro = () => {
      const v = Number(campoLucro.value);
      dicaLucro.textContent = Number.isFinite(v) && v > 0 ? '= ' + abrev(v) : '';
    };
    mostrarDicaLucro();
    campoLucro.oninput = mostrarDicaLucro;
    campoLucro.onchange = () => {
      const texto = String(campoLucro.value).trim();
      const novo = Number(texto.replace(',', '.'));
      if (!texto || !Number.isFinite(novo) || novo < 0) {
        campoLucro.value = String(cfg().lucroMin);
        mostrarDicaLucro();
        return;
      }
      save('lucroMin', novo);
      campoLucro.value = String(novo);
      mostrarDicaLucro();
      atualizarTabelaRevenda();
    };
    linhaLucro.append(rotuloLucro, campoLucro, dicaLucro);

    const divisor = (1 - c.taxaMercadoPct / 100).toLocaleString('pt-BR');
    const infoRevenda = h('div', { opacity: '.78', fontSize: '11px' }, {
      textContent: `Preço sugerido = (custo médio + lucro mínimo) ÷ ${divisor}, com a taxa de ${c.taxaMercadoPct}% do mercado já embutida. ` +
        `Só compra anúncios com desconto igual ou maior que o percentual acima, comparado à mediana dos ${c.amostraMax} mais recentes ` +
        `(inclui retidos). A saída precisa cobrir taxa e lucro, ficar abaixo da mediana e não superar ` +
        `o menor lote concorrente de ${c.loteGrandeMin}+ unidades. Desconto grande NÃO garante revenda. ` +
        'O inventário registra compras do bot e baixa vendas confirmadas automaticamente. ' +
        'Verde = COMPRAR para revenda; vermelho = NÃO COMPRAR. É possível deixar vermelho nas duas abas.'
    });

    // Tabela do inventário
    const tabela = h('table', { width: '100%', borderCollapse: 'collapse', fontSize: '11.5px' });
    const cabecalho = h('tr');
    ['Item', 'Qtd', 'Custo médio', 'Menor concorrente', 'Preço sugerido', 'Status', ''].forEach((titulo, i) =>
      cabecalho.append(h('th', {
        textAlign: i === 0 ? 'left' : i === 5 ? 'center' : 'right', padding: '5px', verticalAlign: 'bottom',
        color: '#d9c7d6', fontWeight: '700', borderBottom: '1px solid #6b4a63',
        position: 'sticky', top: '0', background: '#1d1420'
      }, { textContent: titulo })));
    const thead = h('thead');
    thead.append(cabecalho);
    const corpoTabela = h('tbody');
    tabela.append(thead, corpoTabela);
    const tabelaWrap = h('div', {
      flex: '1', minHeight: '150px', overflow: 'auto', border: '1px solid #493448', borderRadius: '5px'
    });
    tabelaWrap.append(tabela);
    const msgRevenda = h('div', { fontSize: '11px', opacity: '.85', minHeight: '14px' });
    const ouroExato = n => sp(n == null ? '—' : fmt(n), { color: COR.gold, fontWeight: '600' });

    function atualizarTabelaRevenda() {
      const cAtual = cfg();
      const itens = [
        ...Object.values(lerInventario()).map(x => ({ ...x, sim: false })),
        ...Object.values(st.invSim).map(x => ({ ...x, sim: true }))
      ].filter(x => x && x.qtd > 0).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR') || (a.sim - b.sim));
      corpoTabela.replaceChildren();
      if (!itens.length) {
        const tr = h('tr'), td = h('td', { padding: '14px', textAlign: 'center', opacity: '.75' },
          { textContent: 'Nenhum item comprado pela revenda ainda.', colSpan: 7 });
        tr.append(td);
        corpoTabela.append(tr);
        return;
      }
      for (const x of itens) {
        const custoMedio = x.custoTotal / x.qtd;
        const mercado = st.mercado[chavePedra(x.nome)];
        const sugerido = precoVendaIdeal(custoMedio, cAtual);
        const stt = statusRevenda(custoMedio, sugerido, mercado, cAtual);
        const tr = h('tr', { borderBottom: '1px solid #3a2a3c', opacity: x.sim ? '.7' : '1' });
        const cel = (conteudo, css = {}) => {
          const td = h('td', { padding: '5px', textAlign: 'right', whiteSpace: 'nowrap', ...css });
          td.append(conteudo);
          return td;
        };
        tr.append(cel(sp(x.nome + (x.sim ? ' (sim)' : ''), {
          color: corPedra(x.nome), textDecoration: 'underline', fontWeight: '700'
        }), { textAlign: 'left' }));
        if (x.sim) tr.append(cel(sp(fmt(x.qtd))));
        else {
          const qtdInput = h('input', {
            width: '58px', boxSizing: 'border-box', padding: '3px 2px', textAlign: 'center',
            background: '#1f1927', border: '1px solid #8b658b', color: '#fff', borderRadius: '4px', fontSize: '11.5px'
          }, { type: 'number', min: '0', step: '1', value: String(x.qtd), title: 'Quantidade acompanhada (vendas confirmadas baixam automaticamente; 0 remove)' });
          qtdInput.onchange = () => {
            const nova = Math.floor(Number(qtdInput.value));
            if (!Number.isFinite(nova) || nova < 0) { qtdInput.value = String(x.qtd); return; }
            ajustarQtdInventario(x.nome, nova);
            atualizarTabelaRevenda();
          };
          tr.append(cel(qtdInput));
        }
        tr.append(cel(ouroExato(Math.round(custoMedio))));
        tr.append(cel(ouroExato(mercado ? mercado.menor : null)));
        tr.append(cel(ouroExato(sugerido)));
        const chip = h('span', {
          color: stt.cor, background: stt.cor + '26', border: '1px solid ' + stt.cor, borderRadius: '10px',
          padding: '2px 7px', fontWeight: '800', fontSize: '11px', whiteSpace: 'nowrap'
        }, { textContent: stt.txt, title: stt.dica });
        tr.append(cel(chip, { textAlign: 'center' }));
        // O jogo é quem cria o anúncio: o botão entrega o preço ideal pronto para colar.
        const copiar = h('button', {
          padding: '3px 7px', cursor: 'pointer', background: '#503047', color: '#fff',
          border: '1px solid #a879a2', borderRadius: '5px', fontSize: '11px', fontWeight: '700'
        }, { textContent: 'Copiar preço', title: 'Copia o preço de venda ideal para colar no anúncio do jogo' });
        copiar.onclick = async () => {
          const ok = await copiarTexto(String(sugerido));
          msgRevenda.textContent = ok
            ? `Preço ideal de ${x.nome} copiado: ${fmt(sugerido)} (cole no anúncio do jogo).`
            : `Não consegui copiar. Preço ideal de ${x.nome}: ${fmt(sugerido)}.`;
        };
        tr.append(cel(copiar));
        corpoTabela.append(tr);
      }
    }

    // Consulta o mercado só das pedras que estão no inventário (mesma consulta que o bot já faz).
    let atualizandoMercado = false;
    async function atualizarMercadoInventario() {
      if (atualizandoMercado) return;
      const itens = [...Object.values(lerInventario()), ...Object.values(st.invSim)].filter(x => x.itemId != null);
      const pedras = [...new Map(itens.map(x => [x.itemId, x.nome])).entries()];
      if (!pedras.length) { msgRevenda.textContent = ''; return; }
      if (!st.sock) { msgRevenda.textContent = 'Socket do jogo ainda não detectado; espere o jogo carregar.'; return; }
      atualizandoMercado = true;
      msgRevenda.textContent = 'Consultando o mercado…';
      let falhas = 0;
      try {
        for (const [itemId, nome] of pedras) {
          try {
            const r = await ask({ t: 'market.item', itemId, moeda: 'gold' },
              j => j.t === 'market' && j.aba === 'item' && j.itemId === itemId && j.moeda === 'gold');
            atualizarMercado(nome, itemId, (r.linhas || []).filter(l => l.estado === 'aberto' && !l.comprador), cfg());
          } catch { falhas++; }
          await sleep(600);
        }
      } finally { atualizandoMercado = false; }
      atualizarTabelaRevenda();
      msgRevenda.textContent = `Mercado atualizado às ${new Date().toLocaleTimeString('pt-BR')}` +
        (falhas ? ` (${falhas} consulta(s) sem resposta).` : '.');
    }
    const botaoAtualizar = h('button', {
      padding: '5px 8px', width: '100%', cursor: 'pointer',
      background: '#423047', color: '#fff', border: '1px solid #6b4a63', borderRadius: '5px'
    }, { textContent: '↻ Atualizar preços do mercado' });
    botaoAtualizar.onclick = () => atualizarMercadoInventario().catch(() => {});
    const botaoVendas = h('button', {
      padding: '5px 8px', width: '100%', cursor: 'pointer',
      background: '#423047', color: '#ffffff', border: '1px solid #6b4a63', borderRadius: '5px'
    }, { textContent: '↻ Conferir minhas últimas vendas' });
    botaoVendas.onclick = async () => {
      botaoVendas.disabled = true;
      msgRevenda.textContent = 'Conferindo vendas concluídas no jogo…';
      try {
        const r = await conferirVendas({ forcar: true });
        atualizarTabelaRevenda();
        msgRevenda.textContent = r && r.inicial
          ? 'Histórico inicial sincronizado. Vendas anteriores à instalação não foram descontadas.'
          : r ? `Vendas conferidas: ${r.unidades} unidade(s) baixada(s).` : 'Socket do jogo indisponível.';
      } catch (e) { msgRevenda.textContent = `Não foi possível conferir vendas: ${e.message}. Nenhuma baixa efetuada.`; }
      finally { botaoVendas.disabled = false; }
    };

    // Escolha das pedras que usam o modo REVENDA
    const listaRevenda = h('div', {
      maxHeight: '120px', overflowY: 'auto', marginTop: '6px', paddingRight: '5px',
      display: 'flex', flexDirection: 'column', gap: '5px'
    });
    function listaNomesPermitidos() {
      const extras = lsGet(K_PEDRAS_CONHECIDAS, []);
      const cAtual = cfg();
      return [...PEDRAS_INICIAIS, ...(Array.isArray(extras) ? extras : [])]
        .filter((nome, i, all) => !pedraBloqueada(nome, cAtual) &&
          all.findIndex(x => chavePedra(x) === chavePedra(nome)) === i)
        .sort((a, b) => a.localeCompare(b, 'pt-BR'));
    }
    function atualizarListaRevenda() {
      listaRevenda.replaceChildren();
      for (const nome of listaNomesPermitidos()) {
        const linha = h('div', {
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: '8px', padding: '8px', borderRadius: '5px',
          background: '#2b2031', border: '1px solid #493448'
        });
        const rotulo = h('span', { color: corPedra(nome), textDecoration: 'underline',
          fontWeight: '700', flex: '1' }, { textContent: nome });
        const marcado = botaoCompraPorCategoria(nome, 'revenda');
        linha.append(rotulo, marcado);
        listaRevenda.append(linha);
      }
    }
    const detalhesPedras = h('details', {
      flex: '0 0 auto', border: '1px solid #493448', borderRadius: '5px', padding: '6px 8px', color: '#ffffff'
    });
    detalhesPedras.append(h('summary', { cursor: 'pointer', fontWeight: '700' },
      { textContent: 'Escolher as pedras da revenda' }), listaRevenda);
    telaRevenda.append(topoRevenda, linhaDescontoRevenda, linhaLucro, infoRevenda,
      tabelaWrap, msgRevenda, botaoAtualizar, botaoVendas, detalhesPedras);
    // ---------- POKEMON: tela própria (abaixo de REVENDA) ----------
    // Liga/desliga, limite de preço, inventário (ícone/nome, nível, status, custo) e relatório do sorteio.
    const telaPokemon = h('div', {
      display: 'none', flexDirection: 'column', height: 'calc(100% - 28px)',
      boxSizing: 'border-box', minHeight: '0', marginTop: '8px', gap: '8px'
    });
    const voltarPoke = h('button', {
      background: '#423047', color: '#ffffff', border: '1px solid #9a6b91',
      borderRadius: '5px', padding: '5px 9px', cursor: 'pointer'
    }, { textContent: '← Voltar' });
    const topoPoke = h('div', { display: 'flex', alignItems: 'center', gap: '8px' });
    const botaoPokeAtivo = h('button', {
      marginLeft: 'auto', minWidth: '170px', padding: '7px 8px', borderRadius: '6px', cursor: 'pointer',
      fontSize: '11px', fontWeight: '900', color: '#ffffff', whiteSpace: 'nowrap'
    }, { type: 'button' });
    const pintarPokeAtivo = () => {
      const ativo = pokeAtivo();
      botaoPokeAtivo.textContent = ativo ? '✔ COMPRAR POKÉMON' : '✕ NÃO COMPRAR POKÉMON';
      botaoPokeAtivo.style.background = ativo ? '#176c3f' : '#90242e';
      botaoPokeAtivo.style.border = ativo ? '2px solid #65e99c' : '2px solid #fc7b87';
      botaoPokeAtivo.setAttribute('aria-pressed', ativo ? 'true' : 'false');
    };
    botaoPokeAtivo.onclick = () => { setPokeAtivo(!pokeAtivo()); pintarPokeAtivo(); };
    topoPoke.append(voltarPoke, h('strong', { color: '#ffffff', fontSize: '15px' }, { textContent: 'POKEMON' }), botaoPokeAtivo);

    const linhaLimitePoke = h('div', {
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px',
      padding: '9px 8px', borderRadius: '5px', background: '#39283d', border: '1px solid #9a6b91'
    });
    const dicaLimitePoke = h('span', { color: COR.gold, fontWeight: '700', fontSize: '11px', minWidth: '70px', textAlign: 'right' });
    const campoLimitePoke = h('input', {
      width: '80px', boxSizing: 'border-box', padding: '5px 3px', textAlign: 'center',
      background: '#1f1927', border: '1px solid #ffffff', color: '#ffffff',
      borderRadius: '5px', fontSize: '12px', fontWeight: '800'
    }, { type: 'number', min: '0', step: 'any', value: String(c.pokeLimiteM) });
    campoLimitePoke.setAttribute('aria-label', 'Preço máximo de compra de Pokémon em milhões de gold');
    const mostrarDicaLimite = () => {
      const v = limitePoke({ pokeLimiteM: campoLimitePoke.value });
      dicaLimitePoke.textContent = v ? 'abaixo de ' + fmt(v) : '';
    };
    mostrarDicaLimite();
    campoLimitePoke.oninput = mostrarDicaLimite;
    campoLimitePoke.onchange = () => {
      const novo = Number(String(campoLimitePoke.value).replace(',', '.'));
      if (!String(campoLimitePoke.value).trim() || !limitePoke({ pokeLimiteM: novo })) {
        campoLimitePoke.value = String(cfg().pokeLimiteM); mostrarDicaLimite(); return;
      }
      save('pokeLimiteM', novo);
      campoLimitePoke.value = String(novo); mostrarDicaLimite();
    };
    linhaLimitePoke.append(
      h('label', { color: '#ffffff', fontWeight: '900', fontSize: '13px', flex: '1' },
        { textContent: 'Comprar QUALQUER Pokémon abaixo de (milhões de gold)' }),
      campoLimitePoke, dicaLimitePoke);

    const infoPoke = h('div', { opacity: '.78', fontSize: '11px' }, {
      textContent: 'Compra qualquer Pokémon anunciado por menos do limite acima, sem olhar a mediana. O bot lê espécie, nível e Shiny; ' +
        'se não conseguir ler a espécie, não compra. A mediana mostrada no relatório é só informativa e separa Shiny de Normal. ' +
        'Antes de enviar, relê o mercado e revalida preço, vendedor, saldo e retenção. Compartilha o saldo para compras e a Simulação com as pedras.'
    });

    // Tabela do inventário
    const tabelaPoke = h('table', { width: '100%', borderCollapse: 'collapse', fontSize: '11.5px' });
    const cabPoke = h('tr');
    ['Pokémon', 'Nível', 'Status', 'Preço de custo', ''].forEach((titulo, i) =>
      cabPoke.append(h('th', {
        textAlign: i === 0 ? 'left' : i === 2 ? 'center' : 'right', padding: '5px', verticalAlign: 'bottom',
        color: '#d9c7d6', fontWeight: '700', borderBottom: '1px solid #6b4a63',
        position: 'sticky', top: '0', background: '#1d1420'
      }, { textContent: titulo })));
    const theadPoke = h('thead');
    theadPoke.append(cabPoke);
    const corpoPoke = h('tbody');
    tabelaPoke.append(theadPoke, corpoPoke);
    const tabelaPokeWrap = h('div', {
      flex: '1', minHeight: '120px', overflow: 'auto', border: '1px solid #493448', borderRadius: '5px'
    });
    tabelaPokeWrap.append(tabelaPoke);
    const resumoPoke = h('div', { fontSize: '11px', opacity: '.85', minHeight: '14px' });

    function atualizarTabelaPokemon() {
      const itens = [
        ...lerInvPoke().map(x => ({ ...x, sim: false })),
        ...st.pokeSim.map(x => ({ ...x, sim: true }))
      ];
      corpoPoke.replaceChildren();
      let total = 0;
      if (!itens.length) {
        const tr = h('tr'), td = h('td', { padding: '14px', textAlign: 'center', opacity: '.75' },
          { textContent: 'Nenhum Pokémon comprado pelo bot ainda.', colSpan: 5 });
        tr.append(td); corpoPoke.append(tr);
      }
      for (const x of itens) {
        total += Number(x.custo) || 0;
        const tr = h('tr', { borderBottom: '1px solid #3a2a3c', opacity: x.sim ? '.7' : '1' });
        const cel = (conteudo, css = {}) => {
          const td = h('td', { padding: '5px', textAlign: 'right', whiteSpace: 'nowrap', ...css });
          td.append(conteudo); return td;
        };
        const nomeCel = h('span', { display: 'inline-flex', alignItems: 'center', gap: '6px' });
        if (x.icone) {
          const img = h('img', { width: '28px', height: '28px', imageRendering: 'pixelated', objectFit: 'contain' },
            { src: x.icone, alt: '' });
          img.onerror = () => { img.style.display = 'none'; };
          nomeCel.append(img);
        }
        nomeCel.append(sp(x.especie + (x.sim ? ' (sim)' : ''),
          { color: corPedra(x.especie), textDecoration: 'underline', fontWeight: '700' }));
        tr.append(cel(nomeCel, { textAlign: 'left' }));
        tr.append(cel(sp(x.nivel == null ? '?' : String(x.nivel))));
        const chip = h('span', {
          color: x.shiny ? COR.gold : '#c9c9d6', background: (x.shiny ? COR.gold : '#c9c9d6') + '26',
          border: '1px solid ' + (x.shiny ? COR.gold : '#8a8a99'), borderRadius: '10px',
          padding: '2px 7px', fontWeight: '800', fontSize: '11px', whiteSpace: 'nowrap'
        }, { textContent: x.shiny ? '✨ Shiny' : 'Normal' });
        tr.append(cel(chip, { textAlign: 'center' }));
        tr.append(cel(sp(fmt(x.custo), { color: COR.gold, fontWeight: '600' })));
        if (x.sim) tr.append(cel(sp('')));
        else {
          const rm = h('button', {
            padding: '2px 7px', cursor: 'pointer', background: '#503047', color: '#fff',
            border: '1px solid #a879a2', borderRadius: '5px', fontSize: '11px'
          }, { textContent: '✕', title: 'Remover do registro (não afeta o jogo)' });
          rm.onclick = () => { lsSet(K_POKE_INV, lerInvPoke().filter(y => y.id !== x.id)); atualizarTabelaPokemon(); };
          tr.append(cel(rm));
        }
        corpoPoke.append(tr);
      }
      atualizarResumoBanco();
      resumoPoke.textContent = itens.length
        ? `${itens.length} Pokémon no registro · custo total ${fmt(total)} gold (compras simuladas incluídas, em cinza).` : '';
    }

    // Rastreador multi-página: liga/desliga, resumo do banco local, CSV e limpar
    const linhaBanco = h('div', {
      display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap',
      padding: '7px 8px', borderRadius: '5px', background: '#2b2031', border: '1px solid #493448'
    });
    const botaoTrack = h('button', {
      minWidth: '150px', padding: '6px 8px', borderRadius: '6px', cursor: 'pointer',
      fontSize: '11px', fontWeight: '900', color: '#ffffff', whiteSpace: 'nowrap'
    }, { type: 'button' });
    const pintarTrack = () => {
      const ativo = trackAtivo();
      botaoTrack.textContent = ativo ? '✔ REGISTRAR MERCADO' : '✕ NÃO REGISTRAR';
      botaoTrack.style.background = ativo ? '#176c3f' : '#90242e';
      botaoTrack.style.border = ativo ? '2px solid #65e99c' : '2px solid #fc7b87';
    };
    botaoTrack.onclick = () => { setTrackAtivo(!trackAtivo()); pintarTrack(); };
    const textoBanco = h('span', { flex: '1', fontSize: '11px', minWidth: '180px' });
    const btnCsv = h('button', {
      padding: '5px 8px', cursor: 'pointer', background: '#423047', color: '#fff',
      border: '1px solid #6b4a63', borderRadius: '5px', fontSize: '11px'
    }, { textContent: 'Vendas filtradas (CSV)' });
    btnCsv.onclick = () => {
      const n = baixarCsvVendas();
      if (!n) textoBanco.textContent = 'Ainda não há vendas com classificação estatística suficiente.';
    };
    const btnAuditoria = h('button', {
      padding: '5px 8px', cursor: 'pointer', background: '#423047', color: '#fff',
      border: '1px solid #6b4a63', borderRadius: '5px', fontSize: '11px'
    }, { textContent: 'Auditoria completa (CSV)' });
    btnAuditoria.onclick = () => {
      const n = baixarCsvVendas('pokeidle-auditoria-pokemon.csv', 'auditoria');
      if (!n) textoBanco.textContent = 'Ainda não há eventos de saída para exportar.';
    };
    const entradaCsv = h('input', { display: 'none' }, { type: 'file', accept: '.csv,text/csv' });
    const statusCsv = h('div', { fontSize: '11px', color: '#dbd3e2', padding: '3px 0', wordBreak: 'break-word' },
      { textContent: 'Selecione um CSV de auditoria para recuperar registros na planilha.' });
    const botaoImportar = h('button', {
      padding: '5px 8px', cursor: 'pointer', background: '#166147', color: '#fff',
      border: '1px solid #45ab87', borderRadius: '5px', fontSize: '11px', fontWeight: '700'
    }, { textContent: '⬆ Importar CSV para Sheets', type: 'button' });
    botaoImportar.onclick = () => { if (!st.pkImportando) { entradaCsv.value = ''; entradaCsv.click(); } };
    entradaCsv.onchange = async () => {
      const arquivo = entradaCsv.files && entradaCsv.files[0];
      if (!arquivo) return;
      botaoImportar.disabled = true;
      botaoImportar.style.opacity = '.55';
      try { await importarCsvParaSheets(arquivo, msg => { statusCsv.textContent = msg; }); }
      catch (e) { statusCsv.textContent = '⚠️ ' + e.message; logPk('⚠️ CSV: ' + e.message); }
      finally { botaoImportar.disabled = false; botaoImportar.style.opacity = '1'; }
    };
    const btnLimpar = h('button', {
      padding: '5px 8px', cursor: 'pointer', background: '#503047', color: '#fff',
      border: '1px solid #a879a2', borderRadius: '5px', fontSize: '11px'
    }, { textContent: 'Limpar banco' });
    btnLimpar.onclick = async () => {
      if (!confirm('Apagar TODO o banco local de vendas de Pokémon? Exporte o CSV antes se quiser guardar.')) return;
      try { await pkDb.clear(); st.pkObs.clear(); st.pkTrackTemBase = false; st.pkUltimoCensoValido = 0; lsSet(K_CENSO_VALIDO_154, {}); } catch (e) { textoBanco.textContent = 'Falha ao limpar: ' + e.message; }
      atualizarTabelaPokemon();
    };
    linhaBanco.append(botaoTrack, textoBanco, btnCsv, btnAuditoria, botaoImportar, entradaCsv, btnLimpar);
    linhaBanco.append(statusCsv);
    const dicaRastreador = h('div', { fontSize: '11px', opacity: '.75' }, {
      textContent: 'Rastreador: varredura de cobertura de todas as páginas (até 500) e coleta incremental de duas páginas a cada 60 s. ' +
        'Pequenas oscilações no total não interrompem a cobertura: com deslocamentos moderados, o status exige 3 censos alternados. ' +
        'Para cada ID, preserva histórico de preços, expiração e reaparecimentos. ' +
        'Vendas filtradas = servidor ou provável com timer ativo e preço dentro do intervalo robusto de Pokémon semelhantes. ' +
        'Incerto e outlier ficam na auditoria; reaparecimento do mesmo ID invalida a hipótese de venda no preço antigo.'
    });
    function atualizarResumoBanco() {
      pintarTrack();
      if (st.pkAvisos.semBanco) { textoBanco.textContent = 'Banco local indisponível: ' + st.pkAvisos.semBanco; return; }
      const b = resumoBanco();
      let esperandoRevisao = 0, incertosRevisao = 0;
      for (const r of st.pkObs.values()) {
        if (r.status === STATUS_ATIVO && r.faltas > 0) esperandoRevisao++;
        if (statusIncerto(r.status) && r.confirmacoesSemana === 1) incertosRevisao++;
      }
      const info = st.pkTrackInfo;
      const paginas = info && info.atualizadoEm ? (info.emCenso ?
        ` · Censo ${info.paginas}/${info.paginasEsperadas} pág., ${info.idsUnicos} IDs (${new Date(info.ultimaRespostaEm).toLocaleTimeString('pt-BR')})` :
        ` · ${info.paginas} pág. / ${info.total} anúncios na última coleta`) : '';
      const erro = info && info.erro ? ' · coleta incompleta (sem baixas)' : '';
      const censoValido = st.pkUltimoCensoValido
        ? ` · último censo validado ${new Date(st.pkUltimoCensoValido).toLocaleTimeString('pt-BR')}`
        : ' · sem censo de cobertura validada';
      const sheetsVisto = st.pkAvisos.ultimaConfirmacaoSheets ?
        ` · Sheets OK ${new Date(st.pkAvisos.ultimaConfirmacaoSheets).toLocaleTimeString('pt-BR')}` :
        (FIXO.sheetsUrl ? ' · Sheets configurado (sem confirmação nesta sessão)' : '');
      const pausaRede = Date.now() < st.marketPausaAte
        ? ` · consultas em pausa (${Math.ceil((st.marketPausaAte-Date.now())/1000)} s)` : '';
      const intervaloMercadoSeg = intervaloMinMercadoAtualMs()/1000;
      const agendaCenso = info && info.emCenso
        ? ' · censos contínuos: próximo assim que validar'
        : st.pkProximoCenso > Date.now()
          ? ` · próxima tentativa ${new Date(st.pkProximoCenso).toLocaleTimeString('pt-BR')} (proteção após falha ou sobrecarga)`
          : ' · censo contínuo (sem espera fixa)';
      textoBanco.textContent = `Banco v${EXT_VERSION}: ${b.vendidos} servidor · ${b.provaveis} prováveis · ${b.cancelados} cancelados · ${b.incertos} incertos · ${b.invalidados} reclassificados · ${b.abertos} abertos` +
        ` · ${b.pendentes} eventos pendentes · ${esperandoRevisao} aguardam outra cobertura · ${incertosRevisao} incertos em revisão` +
        paginas + censoValido + ` · consultas ≥${intervaloMercadoSeg}s` + agendaCenso + pausaRede + erro + sheetsVisto;
    }

    // Relatório da aba: tentativa de compra, entrada no sorteio, vitória ou derrota
    const pkLogEl = h('div', {
      fontSize: '11.5px', maxHeight: '150px', minHeight: '70px', overflow: 'auto', padding: '6px',
      border: '1px solid #493448', borderRadius: '5px', background: '#1a121d'
    });
    const exportarPoke = h('button', {
      padding: '5px 8px', width: '100%', cursor: 'pointer',
      background: '#423047', color: '#fff', border: '1px solid #6b4a63', borderRadius: '5px'
    }, { textContent: 'Baixar relatório de Pokémon e sorteios (.txt)' });
    exportarPoke.onclick = () => {
      const linhas = st.log.slice().reverse().filter(e => e.pk && relatorioVisivel(e))
        .map(e => `[${e.h}] ${e.parts.map(p => p.s).join('')}`);
      const blob = new Blob([linhas.join('\n') + '\n'], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'pokeidle-sniper-pokemon.txt';
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    };
    telaPokemon.append(topoPoke, linhaLimitePoke, infoPoke, tabelaPokeWrap, resumoPoke, linhaBanco, dicaRastreador,
      h('div', { fontWeight: '700', color: '#d9c7d6' }, { textContent: 'Relatório (tentativas, sorteio, vitória/derrota)' }),
      pkLogEl, exportarPoke);

    let telaAtual = null; // null | 'descontos' | 'revenda' | 'pokemon'
    function abrirTela(nome) {
      telaAtual = nome;
      const aberto = !!nome;
      const larga = nome === 'revenda' || nome === 'pokemon';
      box.style.width = larga ? '680px' : aberto ? '420px' : '290px';
      box.style.height = larga ? '650px' : aberto ? '420px' : '';
      box.style.boxSizing = 'border-box';
      body.style.display = aberto ? 'none' : 'block';
      telaDescontos.style.display = nome === 'descontos' ? 'flex' : 'none';
      telaRevenda.style.display = nome === 'revenda' ? 'flex' : 'none';
      telaPokemon.style.display = nome === 'pokemon' ? 'flex' : 'none';
      if (nome === 'pokemon') {
        pintarPokeAtivo();
        campoLimitePoke.value = String(cfg().pokeLimiteM);
        mostrarDicaLimite();
        atualizarTabelaPokemon();
      }
      if (nome === 'descontos') atualizarListaDescontos();
      if (nome === 'revenda') {
        atualizarListaRevenda();
        campoDescontoRevenda.value = String(cfg().descontoMinRevenda);
        campoLucro.value = String(cfg().lucroMin);
        mostrarDicaLucro();
        atualizarTabelaRevenda();
        atualizarMercadoInventario().catch(() => {});
        conferirVendas().catch(e => dbg('Consulta das vendas:', e.message));
      }
    }
    botaoDescontos.onclick = () => abrirTela('descontos');
    botaoRevenda.onclick = () => abrirTela('revenda');
    botaoPokemon.onclick = () => abrirTela('pokemon');
    voltarPoke.onclick = () => abrirTela(null);
    voltar.onclick = () => abrirTela(null);
    voltarRevenda.onclick = () => abrirTela(null);

    box.append(head, body, telaDescontos, telaRevenda, telaPokemon);
    document.body.append(box);
    ui = { status, btn, info, log: logEl, pkLog: pkLogEl, atualizarListaDescontos: () => {
      if (telaAtual === 'descontos') atualizarListaDescontos();
      if (telaAtual === 'revenda') atualizarListaRevenda();
    },
    // Não reconstrói a tabela enquanto o usuário edita uma quantidade nela.
    atualizarRevenda: () => {
      if (telaAtual === 'revenda' && !tabelaWrap.contains(document.activeElement)) atualizarTabelaRevenda();
    },
    atualizarPokemon: () => {
      if (telaAtual !== 'pokemon') return;
      atualizarTabelaPokemon();
    } };
    setInterval(() => ui.atualizarRevenda(), 2000);
    setInterval(() => ui.atualizarPokemon(), 2000);   // preços e status acompanham a varredura
    st.log.slice().reverse().filter(relatorioVisivel)
      .forEach(e => logEl.prepend(entryEl(e)));   // incluindo logs anteriores, sem duplicatas técnicas
    st.log.slice().reverse().filter(e => e.pk && relatorioVisivel(e))
      .forEach(e => pkLogEl.prepend(entryEl(e)));
    render();
  }

  // Novo aviso identifica o código injetado; mensagens antigas ficam no histórico local.
  logPk(`🧭 PokéIdle Sniper v${EXT_VERSION}: consultas ≥${intervaloMinMercadoAtualMs()/1000}s (2→3→4→5→6→7s com sobrecarga); censos contínuos sem pausa após censo validado. Falhas mantêm recuo.`);
  if (document.body) buildUI();
  else document.addEventListener('DOMContentLoaded', buildUI);
})();
