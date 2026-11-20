
/**
 * PokeIdle Market Tracker v1.5.3 - alinhamento do Marketplace
 *
 * Receptor de eventos enviados pela extensão Sniper.
 *
 * ABA "eventos":
 * Histórico append-only, sem duplicação de evento_id.
 *
 * ABA "Sheet":
 * Uma linha por ID de anúncio, com o estado mais recente.
 *
 * Linha 3: cabeçalhos (B:P originais, Q:Y adicionais)
 * Linha 4+: registros sem lacunas
 *
 * Inclui logs para diagnóstico das requisições.
 */

// =====================================================
// 1. CONFIGURAÇÕES
// =====================================================

// Execute configurarPlanilhaVinculada UMA VEZ pelo editor do Apps Script.
// O ID da planilha que contém este projeto será salvo nas propriedades do script.
const CHAVE_PLANILHA = 'POKEIDLE_PLANILHA_ID';

function configurarPlanilhaVinculada() {
  const planilha = SpreadsheetApp.getActiveSpreadsheet();
  if (!planilha) {
    throw new Error('Abra o Apps Script por Extensões > Apps Script dentro do Google Sheets e execute novamente.');
  }
  PropertiesService.getScriptProperties().setProperty(CHAVE_PLANILHA, planilha.getId());
  console.log('Planilha vinculada configurada: ' + planilha.getName() + ' (ID ' + planilha.getId() + ')');
  console.log('Abas: ' + planilha.getSheets().map(aba => aba.getName()).join(', '));
}

function abrirPlanilhaConfigurada() {
  const id = PropertiesService.getScriptProperties().getProperty(CHAVE_PLANILHA);
  if (!id) {
    throw new Error('Planilha não configurada. Execute configurarPlanilhaVinculada uma vez no editor.');
  }
  // Em App da Web getActiveSpreadsheet() pode ser null, mesmo em projeto vinculado.
  return SpreadsheetApp.openById(id);
}

const NOME_ABA = 'eventos';
const NOME_RESUMO = 'Sheet';

const LINHA_CABECALHO_RESUMO = 3;
const LINHA_DADOS_RESUMO = 4;

const VERSAO = '1.5.4.70';
const CHAVE_LEITURA_VENDAS = 'POKEIDLE_CHAVE_LEITURA_VENDAS';

// A linha 3 da aba Sheet é a única fonte de verdade dos títulos.
// Nenhum novo cabeçalho é escrito ou movido automaticamente.
const PROP_REPARO = 'POKEIDLE_RESUMO_REPARADO_150';
const COLUNA_LIMITE_LEITURA = 150;

// =====================================================
// 2. RECEPTOR POST
// =====================================================

function doPost(e) {

  const inicio = Date.now();

  console.log('===================================');
  console.log('POKEIDLE - POST RECEBIDO');
  console.log('Versão: ' + VERSAO);
  console.log('Horário: ' + new Date().toISOString());

  const lock = LockService.getScriptLock();
  let bloqueado = false;

  try {

    lock.waitLock(20000);
    bloqueado = true;

    // ---------------------------------------------
    // Validar conteúdo recebido
    // ---------------------------------------------

    if (
      !e ||
      !e.postData ||
      typeof e.postData.contents !== 'string'
    ) {
      throw new Error('POST sem JSON válido');
    }

    const conteudo = e.postData.contents;

    console.log(
      'Tamanho do conteúdo: ' + conteudo.length
    );

    const dados = JSON.parse(conteudo);

    if (
      !dados ||
      typeof dados !== 'object' ||
      Array.isArray(dados)
    ) {
      throw new Error('JSON recebido não é um objeto');
    }

    console.log(
      'Campos recebidos: ' +
      JSON.stringify(Object.keys(dados))
    );

    // ---------------------------------------------
    // Interpretar eventos
    // ---------------------------------------------

    if (dados.tipo === 'pis_sales_pull_v1') {
      return resposta(lerBackupVendas_(dados));
    }

    if (['pis_sales_backup_v1', 'pis_sales_backup_v2'].includes(dados.tipo)) {
      return resposta(receberBackupVendas_(dados));
    }

    const linhas = Array.isArray(dados.linhas)
      ? dados.linhas.filter(
          x => x && typeof x === 'object' &&
               !Array.isArray(x)
        )
      : [];

    console.log(
      'Eventos recebidos: ' + linhas.length
    );

    if (!linhas.length) {

      console.warn(
        'Nenhum evento válido encontrado no campo linhas'
      );

      return resposta({
        ok: false,
        versao: VERSAO,
        erro: 'Nenhum evento recebido no campo linhas'
      });
    }

    if (linhas.length > 200) {
      throw new Error(
        'Limite de 200 eventos por POST'
      );
    }

    // ---------------------------------------------
    // Diagnóstico dos identificadores
    // ---------------------------------------------

    const comEventoId = linhas.filter(
      x => String(x.evento_id || '').trim() !== ''
    ).length;

    const comAnuncioId = linhas.filter(
      x => String(x.id || x.anuncio_id || '').trim() !== ''
    ).length;

    console.log(
      'Eventos com evento_id: ' + comEventoId
    );

    console.log(
      'Eventos com ID de anúncio: ' + comAnuncioId
    );

    console.log(
      'Campos do primeiro evento: ' +
      JSON.stringify(Object.keys(linhas[0]))
    );

    // ---------------------------------------------
    // Abrir planilha
    // ---------------------------------------------

    console.log('Abrindo planilha...');

    const planilha =
      abrirPlanilhaConfigurada();

    console.log(
      'Planilha encontrada: ' + planilha.getName()
    );

    console.log(
      'ID da planilha: ' + planilha.getId()
    );

    console.log(
      'Abas existentes: ' +
      planilha.getSheets()
        .map(x => x.getName())
        .join(', ')
    );

    const resumoVerificado = planilha.getSheetByName(NOME_RESUMO);
    if (!resumoVerificado) throw new Error('Aba Sheet não encontrada');
    const somenteAuditoria = abaTemModeloVendas_(resumoVerificado);
    // O resumo antigo identifica anúncios. A tabela nova identifica vendas.
    if (!somenteAuditoria) {
      if (PropertiesService.getScriptProperties().getProperty(PROP_REPARO) !== 'sim')
        throw new Error('Execute repararMarketplaceUmaVez() antes de receber eventos');
      mapaMarketplace_(resumoVerificado);
      checarIDsResumo_(resumoVerificado, true);
    }

    // ---------------------------------------------
    // Gravar auditoria
    // ---------------------------------------------

    console.log('Iniciando gravação da auditoria');

    const auditoria =
      gravarEventos(planilha, linhas);

    console.log(
      'Resultado auditoria: ' +
      JSON.stringify(auditoria)
    );

    // ---------------------------------------------
    // Atualizar resumo
    // ---------------------------------------------

    console.log('Iniciando atualização do resumo');

    const resumo = somenteAuditoria ? { novas: 0, atualizadas: 0, antigas: 0, semId: 0 } :
      atualizarPorId(planilha, linhas);

    console.log(
      'Resultado resumo: ' +
      JSON.stringify(resumo)
    );

    SpreadsheetApp.flush();

    // ---------------------------------------------
    // Resposta final
    // ---------------------------------------------

    const resultado = {
      ok: true,
      versao: VERSAO,

      eventos_recebidos: linhas.length,

      eventos_novos: auditoria.novos,
      eventos_duplicados: auditoria.duplicados,

      linhas_novas: resumo.novas,
      linhas_atualizadas: resumo.atualizadas,

      ignoradas_antigas: resumo.antigas,

      sem_evento_id: auditoria.semId,
      sem_anuncio_id: resumo.semId,

      planilha: planilha.getName(),

      duracao_ms: Date.now() - inicio
    };

    console.log(
      'RESULTADO FINAL: ' +
      JSON.stringify(resultado)
    );

    console.log('POST FINALIZADO');

    return resposta(resultado);

  } catch (err) {

    console.error(
      'ERRO NO DOPOST: ' +
      (err && err.stack ? err.stack : String(err))
    );

    return resposta({
      ok: false,
      versao: VERSAO,
      erro: String(err)
    });

  } finally {

    if (bloqueado) {
      lock.releaseLock();
    }

  }
}

// =====================================================
// 3. RECEPTOR GET
// =====================================================

function doGet() {

  return resposta({
    ok: true,
    msg: 'Receptor do PokeIdle ativo',
    versao: VERSAO,
    planilha_configurada: !!PropertiesService.getScriptProperties().getProperty(CHAVE_PLANILHA),
    horario: new Date().toISOString()
  });

}

// =====================================================
// 4. HISTÓRICO DE EVENTOS
// =====================================================

function gravarEventos(planilha, linhas) {

  const aba =
    planilha.getSheetByName(NOME_ABA) ||
    planilha.insertSheet(NOME_ABA);

  console.log(
    'Aba auditoria: ' + aba.getName()
  );

  let cols = aba.getLastColumn()
    ? aba.getRange(
        1, 1, 1, aba.getLastColumn()
      ).getValues()[0].map(String)
    : [];

  const novasColunas = [];

  for (const linha of linhas) {

    for (const chave of Object.keys(linha)) {

      if (
        !cols.includes(chave) &&
        !novasColunas.includes(chave)
      ) {
        novasColunas.push(chave);
      }

    }

  }

  if (novasColunas.length) {

    aba.getRange(
      1,
      cols.length + 1,
      1,
      novasColunas.length
    ).setValues([novasColunas]);

    cols = cols.concat(novasColunas);

  }

  const colId = cols.indexOf('evento_id');

  const vistos = new Set();

  const fim = aba.getLastRow();

  if (colId >= 0 && fim > 1) {

    aba.getRange(
      2,
      colId + 1,
      fim - 1,
      1
    ).getValues().forEach(r => {

      const id = String(r[0] || '').trim();

      if (id) vistos.add(id);

    });

  }

  const adicionar = [];

  let semId = 0;

  for (const linha of linhas) {

    const id =
      String(linha.evento_id || '').trim();

    if (!id) {
      semId++;
      continue;
    }

    if (vistos.has(id)) {
      continue;
    }

    vistos.add(id);

    adicionar.push(
      cols.map(c => limpar(linha[c]))
    );

  }

  if (adicionar.length) {
    const novaLinha = aba.getLastRow()+1;
    // Event ID e anúncio ID são identificadores, não datas ou números de moeda.
    // Configurar como texto ANTES de setValues evita conversões automáticas.
    for (const nomeId of ['evento_id','id','anuncio_id']) {
      const col=cols.indexOf(nomeId);
      if (col>=0) aba.getRange(novaLinha,col+1,adicionar.length,1).setNumberFormat('@');
    }
    aba.getRange(novaLinha,1,adicionar.length,cols.length).setValues(adicionar);
  }

  const resultado = {
    novos: adicionar.length,
    duplicados: linhas.length -
      adicionar.length - semId,
    semId: semId
  };

  console.log(
    'Auditoria - linhas finais: ' +
    aba.getLastRow()
  );

  return resultado;

}


// =====================================================
// 5. MAPA DINÂMICO DOS CABEÇALHOS DA LINHA 3
// =====================================================
function normalizarTitulo(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// Aliases referem-se aos NOMES que aparecem no cabeçalho, nunca a letras fixas.
const ALIASES_MARKETPLACE = {
  'data':'data_postagem', 'data postagem':'data_postagem', 'data publicacao':'data_postagem',
  'id':'id', 'id anuncio':'id', 'anuncio id':'id',
  'sprite':'sprite_url', 'imagem':'sprite_url',
  'pokemon':'pokemon', 'especie':'pokemon',
  'nivel':'nivel', 'level':'nivel',
  'preco mi':'preco_mi', 'preco milhoes':'preco_mi',
  'nota':'nota', 'score':'nota',
  'iv hp':'iv_hp', 'iv atk':'iv_atq', 'iv atq':'iv_atq',
  'iv def':'iv_def', 'iv defesa':'iv_def',
  'iv sp atk':'iv_spatq', 'iv sp atq':'iv_spatq', 'iv spatk':'iv_spatq',
  'iv especial atk':'iv_spatq', 'iv ataque especial':'iv_spatq',
  'iv sp def':'iv_spdef', 'iv spdef':'iv_spdef', 'iv defesa especial':'iv_spdef',
  'iv speed':'iv_sped', 'iv sped':'iv_sped', 'iv velocidade':'iv_sped',
  'shiny':'shiny',
  'status':'status_compra', 'status compra':'status_compra',
  'status de compra':'status_compra', 'status anuncio':'status_compra',
  'potencia':'potencia', 'qualidade':'qualidade',
  'iv total':'iv_somado', 'iv somado':'iv_somado',
  'pokemon id':'pokemon_id', 'id pokemon':'pokemon_id',
  'evento em':'evento_em', 'data evento':'evento_em',
  'evento id':'evento_id', 'id evento':'evento_id',
  'motivo':'motivo', 'data origem':'data_origem', 'origem data':'data_origem',
  'alteracao ms':'data_evento_ms', 'ultima alteracao ms':'data_evento_ms',
  'data evento ms':'data_evento_ms',
  'vendedor':'vendedor', 'vendedor id':'vendedor_id',
  'ultima observacao':'ultima_observacao',
  'data expiracao':'expira_em', 'expira em':'expira_em',
  'tipo evento':'tipo_evento', 'tipo de evento':'tipo_evento',
  'preco original mi':'preco_original_mi',
  'preco referencia mi':'preco_referencia_mi',
  'desconto':'desconto_pct', 'desconto percentual':'desconto_pct'
};

function mapaMarketplace_(aba) {
  const largura = Math.min(aba.getLastColumn(), COLUNA_LIMITE_LEITURA);
  if (largura < 2) throw new Error('Cabeçalhos da linha 3 não encontrados.');
  const nomes = aba.getRange(LINHA_CABECALHO_RESUMO, 1, 1, largura).getDisplayValues()[0];
  const map = [];
  const presentes = new Set();
  const duplicados = [];
  for (let i = 0; i < nomes.length; i++) {
    const titulo = String(nomes[i] || '').trim();
    if (!titulo) continue;
    const chave = ALIASES_MARKETPLACE[normalizarTitulo(titulo)];
    if (!chave) continue; // Coluna criada manualmente: não interferimos nela.
    if (presentes.has(chave)) { duplicados.push(titulo + ' (' + (i+1) + ')'); continue; }
    presentes.add(chave);
    map.push({ coluna: i + 1, titulo: titulo, campo: chave });
  }
  if (duplicados.length) throw new Error('Cabeçalhos repetidos: ' + duplicados.join(', '));
  for (const obrigatorio of ['id', 'pokemon', 'preco_mi']) {
    if (!presentes.has(obrigatorio)) {
      throw new Error('Cabeçalho obrigatório ausente na linha 3: ' + obrigatorio +
        '. O script não vai deslocar nem criar colunas automaticamente.');
    }
  }
  return map;
}

function normalizarNumero_(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : '';
  const t = String(v == null ? '' : v).trim();
  if (!t) return '';
  // Aceita decimais do CSV: "2.5" ou "2,5". Não trata um ID como número.
  const n = Number(t.replace(',', '.'));
  return Number.isFinite(n) ? n : '';
}

const CAMPOS_NUMERICOS = new Set([
  'preco_mi','nivel','nota','iv_hp','iv_atq','iv_def', 'iv_spatq',
  'iv_spdef','iv_sped','potencia','qualidade','iv_somado',
  'data_evento_ms','desconto_pct','preco_original_mi','preco_referencia_mi'
]);
const CAMPOS_TEXTO = new Set([
  'id','pokemon_id','evento_id','data_postagem','data_origem','evento_em',
  'ultima_observacao','expira_em','vendedor_id'
]);

function valorMarketplace_(evento, campo) {
  let v = evento[campo];
  if ((v === undefined || v === null || v === '') && campo === 'status_compra')
    v = evento.status || '';
  if (campo === 'ultima_observacao' && (v === undefined || v === null || v === ''))
    v = evento.evento_em || '';
  if (campo === 'vendedor' && (v === undefined || v === null || v === ''))
    v = evento.anuncio_vendedor || '';
  if (campo === 'vendedor_id' && (v === undefined || v === null || v === ''))
    v = evento.anuncio_vendedorId || '';
  if (campo === 'preco_original_mi' && (v === undefined || v === null || v === ''))
    v = normalizarNumero_(evento.preco_anterior) === '' ? '' : Number(evento.preco_anterior) / 1e6;
  if (campo === 'preco_referencia_mi' && (v === undefined || v === null || v === ''))
    v = normalizarNumero_(evento.mediana_referencia) === '' ? '' : Number(evento.mediana_referencia) / 1e6;
  if (campo === 'desconto_pct' && (v === undefined || v === null || v === '')) {
    const ref = normalizarNumero_(evento.mediana_referencia);
    const preco = normalizarNumero_(evento.preco);
    v = ref !== '' && ref > 0 && preco !== '' ? 100 * (1 - preco / ref) : '';
  }
  if (v === undefined || v === null || v === '') return '';
  // getValues() da aba eventos devolve Date real quando o Sheets converteu uma
  // célula. Nunca gravar a representação literal GMT na coluna Data da tabela.
  if (v instanceof Date && !isNaN(v.getTime()) &&
      ['data_postagem','evento_em','ultima_observacao','expira_em'].includes(campo)) {
    return Utilities.formatDate(v,Session.getScriptTimeZone(),
      campo==='data_postagem' ? 'dd/MM/yyyy' : 'dd/MM/yyyy HH:mm:ss');
  }
  if (campo === 'sprite_url') return imagemFormula(v);
  if (CAMPOS_TEXTO.has(campo)) return limpar(String(v));
  if (CAMPOS_NUMERICOS.has(campo)) return normalizarNumero_(v);
  return limpar(v);
}

function formatarMarketplace_(aba, mapa, inicio, quantidade) {
  if (quantidade <= 0) return;
  for (const item of mapa) {
    let formato = 'General';
    if (CAMPOS_TEXTO.has(item.campo)) formato = '@';
    else if (item.campo === 'preco_mi' || item.campo === 'preco_original_mi' ||
             item.campo === 'preco_referencia_mi') formato = '0.######';
    else if (item.campo === 'data_evento_ms') formato = '0';
    else if (CAMPOS_NUMERICOS.has(item.campo)) formato = '0.###';
    aba.getRange(inicio, item.coluna, quantidade, 1).setNumberFormat(formato);
  }
}

function msEvento_(ev) {
  const n = Number(ev.data_evento_ms);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function consolidarEventos_(eventos) {
  const out = new Map();
  const ordenados = eventos.slice().sort((a,b) => msEvento_(a) - msEvento_(b));
  for (const ev of ordenados) {
    const id = String(ev.id || ev.anuncio_id || '').trim();
    if (!id) continue;
    let rec = out.get(id);
    if (!rec) { rec = { id }; out.set(id, rec); }
    for (const [chave, valor] of Object.entries(ev)) {
      if (valor === null || valor === undefined || valor === '') continue;
      if (chave === 'motivo' &&
          (String(ev.tipo_evento || '') === 'sincronizacao' ||
           /^sincroniza[cç][aã]o da planilha/i.test(String(valor)))) continue;
      rec[chave] = valor;
    }
    rec.id = id;
    rec.data_evento_ms = Math.max(msEvento_(rec), msEvento_(ev));
  }
  return out;
}

function lerEventosAuditoria_(planilha) {
  const aba = planilha.getSheetByName(NOME_ABA);
  if (!aba || aba.getLastRow() < 2) throw new Error('Aba eventos não contém registros para reconstruir.');
  const ultima = aba.getLastRow(), largura = aba.getLastColumn();
  const titulos = aba.getRange(1,1,1,largura).getValues()[0].map(String);
  const registros = aba.getRange(2,1,ultima-1,largura).getValues();
  return registros.map(r => Object.fromEntries(titulos.map((t,i) => [t,r[i]])))
    .filter(x => x.evento_id && (x.id || x.anuncio_id));
}

function idNaTabela_(valor) {
  if (valor === null || valor === undefined) return '';
  return String(valor).trim();
}

// =====================================================
// 6. GRAVAÇÃO: APENAS SOB OS TÍTULOS EXISTENTES NA LINHA 3
// =====================================================
function atualizarPorId(planilha, linhas) {
  if (PropertiesService.getScriptProperties().getProperty(PROP_REPARO) !== 'sim') {
    throw new Error('Execute repararMarketplaceUmaVez() no editor do Apps Script ' +
      'para reorganizar a aba Sheet antes de retomar o envio automático.');
  }
  const aba = planilha.getSheetByName(NOME_RESUMO);
  if (!aba) throw new Error('Aba Sheet não encontrada.');
  const mapa = mapaMarketplace_(aba);
  const idCol = mapa.find(x => x.campo === 'id').coluna;
  const msCol = (mapa.find(x => x.campo === 'data_evento_ms') || {}).coluna;
  if (!msCol) throw new Error('Coluna técnica Alteração MS ausente: pode ocultar, mas não excluir; necessária para ordenação de eventos');
  const limite = Math.max(aba.getLastRow(), LINHA_DADOS_RESUMO - 1);
  const contagem = Math.max(0, limite - LINHA_DADOS_RESUMO + 1);
  const valoresId = contagem ? aba.getRange(LINHA_DADOS_RESUMO,idCol,contagem,1).getValues() : [];
  const ids = contagem ? aba.getRange(LINHA_DADOS_RESUMO,idCol,contagem,1).getDisplayValues().map(x=>idNaTabela_(x[0])) : [];
  for (let i=0; i<ids.length; i++) {
    if (valoresId[i][0] instanceof Date || /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(ids[i]))
      throw new Error('A coluna #ID contém uma DATA na linha '+(LINHA_DADOS_RESUMO+i)+': '+ids[i]+
        '. Execute diagnosticarIDsMarketplaceSeguro() e repararIDsMarketplaceSeguro().');
  }
  const encontrados = new Map();
  const msAtuais = msCol && contagem ? aba.getRange(LINHA_DADOS_RESUMO,msCol,contagem,1).getValues() : [];
  let fimReal = LINHA_DADOS_RESUMO - 1;
  for (let i=0; i<ids.length; i++) {
    if (!ids[i]) continue;
    if (encontrados.has(ids[i])) throw new Error('ID duplicado na tabela: ' + ids[i] + '. Reexecute o reparo com backup.');
    encontrados.set(ids[i], LINHA_DADOS_RESUMO + i);
    fimReal = LINHA_DADOS_RESUMO + i;
  }
  // Segurança: lacunas na área de IDs significam que a grade saiu da estrutura.
  if (encontrados.size !== Math.max(0, fimReal - LINHA_DADOS_RESUMO + 1))
    throw new Error('A coluna #ID contém lacunas. Execute repararMarketplaceUmaVez() após revisar o backup.');

  // O lote pode conter eventos de um mesmo anúncio. Consolida e compara timestamps.
  const consolidados = consolidarEventos_(linhas);
  let novas = 0, atualizadas = 0, antigas = 0, semId = 0;
  // Novas linhas são anexadas IMEDIATAMENTE após o último ID, nunca getLastRow()+1.
  const alteracoes = [];
  for (const [id, ev] of consolidados) {
    let linha = encontrados.get(id);
    if (linha) {
      const antigoMs = msCol ? Number(msAtuais[linha-LINHA_DADOS_RESUMO]?.[0]) || 0 : 0;
      if (msEvento_(ev) < antigoMs) { antigas++; continue; }
      atualizadas++;
    } else {
      linha = ++fimReal;
      encontrados.set(id, linha);
      novas++;
    }
    alteracoes.push({linha, ev});
  }
  if (alteracoes.length) {
    // Atualizações distantes não devem provocar leitura/regravação de milhares de
    // células entre elas. Agrupar apenas linhas adjacentes ou muito próximas.
    alteracoes.sort((a,b) => a.linha-b.linha);
    const maxLinha = alteracoes[alteracoes.length-1].linha;
    if (aba.getMaxRows() < maxLinha)
      aba.insertRowsAfter(aba.getMaxRows(),maxLinha-aba.getMaxRows());
    const grupos = [];
    let grupo = [];
    for (const a of alteracoes) {
      if (grupo.length && (a.linha-grupo[grupo.length-1].linha > 2 ||
                            a.linha-grupo[0].linha >= 120)) {
        grupos.push(grupo); grupo=[];
      }
      grupo.push(a);
    }
    if (grupo.length) grupos.push(grupo);
    const colunaInicio=Math.min(...mapa.map(m=>m.coluna));
    const colunaFim=Math.max(...mapa.map(m=>m.coluna));
    const numericos=new Set(CAMPOS_NUMERICOS);
    for (const bloco of grupos) {
      const menor=bloco[0].linha, maior=bloco[bloco.length-1].linha;
      const range=aba.getRange(menor,colunaInicio,maior-menor+1,colunaFim-colunaInicio+1);
      const matriz=range.getValues(), formulas=range.getFormulas(), formatos=range.getNumberFormats();
      // Colunas não mapeadas, fórmulas e células em linhas intermediárias são preservadas.
      for (let i=0;i<matriz.length;i++) for(let j=0;j<matriz[i].length;j++)
        if (formulas[i][j]) matriz[i][j]=formulas[i][j];
      for (const {linha,ev} of bloco) {
        const i=linha-menor;
        for (const m of mapa) {
          const j=m.coluna-colunaInicio;
          const valor=valorMarketplace_(ev,m.campo);
          if (valor==='') continue;
          matriz[i][j]=valor;
          if (m.campo==='id'||m.campo==='pokemon_id'||m.campo==='evento_id') formatos[i][j]='@';
          else if (m.campo==='data_evento_ms') formatos[i][j]='0';
          else if (numericos.has(m.campo)) formatos[i][j]=
            ['preco_mi','preco_original_mi','preco_referencia_mi'].includes(m.campo)
              ? '0.######' : '0.###';
        }
      }
      range.setNumberFormats(formatos);
      range.setValues(matriz);
    }
  }
  console.log('RESUMO: ' + JSON.stringify({novas,atualizadas,antigas,semId,ateLinha:fimReal}));
  return {novas,atualizadas,antigas,semId};
}

// =====================================================
// 7. REPARO CONTROLADO: CÓPIA + RECONSTRUÇÃO PELA AUDITORIA
// =====================================================
function repararMarketplaceUmaVez() {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const ss = abrirPlanilhaConfigurada();
    const aba = ss.getSheetByName(NOME_RESUMO);
    if (!aba) throw new Error('Aba Sheet não encontrada.');
    if (abaTemModeloVendas_(aba)) throw new Error('A aba Sheet está reservada para vendas confirmadas.');
    const mapa = mapaMarketplace_(aba); // valida títulos antes de qualquer alteração
    const eventos = lerEventosAuditoria_(ss);
    const unicos = consolidarEventos_(eventos);
    if (!unicos.size) throw new Error('Nenhum anúncio válido na aba eventos.');
    const props = PropertiesService.getScriptProperties();
    if (props.getProperty(PROP_REPARO) === 'sim') {
      console.log('Reparo v1.5.0 já concluído. Para nova reconstrução, execute reconstruirMarketplaceNovamente().');
      return;
    }
    reconstruirMarketplace_(ss,aba,mapa,unicos,props);
  } finally { lock.releaseLock(); }
}

// Para corrigir outra alteração futura de cabeçalhos. Também cria backup antes.
function reconstruirMarketplaceNovamente() {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const ss = abrirPlanilhaConfigurada();
    const aba = ss.getSheetByName(NOME_RESUMO);
    if (!aba) throw new Error('Aba Sheet não encontrada.');
    if (abaTemModeloVendas_(aba)) throw new Error('A aba Sheet está reservada para vendas confirmadas.');
    const mapa = mapaMarketplace_(aba);
    const unicos = consolidarEventos_(lerEventosAuditoria_(ss));
    if (!unicos.size) throw new Error('Auditoria sem anúncios para reconstrução.');
    reconstruirMarketplace_(ss,aba,mapa,unicos,PropertiesService.getScriptProperties());
  } finally { lock.releaseLock(); }
}

function reconstruirMarketplace_(ss,aba,mapa,unicos,props) {
  const d = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss');
  const backup = aba.copyTo(ss).setName('backup_market_' + d);
  console.log('BACKUP COMPLETO: ' + backup.getName());
  const lista = [...unicos.values()].sort((a,b)=>msEvento_(b)-msEvento_(a));
  const inicio = LINHA_DADOS_RESUMO;
  const linhasAntigas = Math.max(0,aba.getLastRow()-inicio+1);
  const limparLinhas = Math.max(linhasAntigas,lista.length);
  if (aba.getMaxRows() < inicio + lista.length - 1)
    aba.insertRowsAfter(aba.getMaxRows(),inicio+lista.length-1-aba.getMaxRows());
  // Limpar conteúdos deslocados da versão anterior, inclusive segunda tabela.
  // Somente abaixo da linha 3; cabeçalhos e título são preservados.
  const largura = Math.min(Math.max(aba.getLastColumn(), 40), aba.getMaxColumns());
  if (limparLinhas) aba.getRange(inicio,2,limparLinhas,largura-1).clearContent();
  // Formatar ANTES da escrita: não herdar dólar nem converter ID em data.
  formatarMarketplace_(aba,mapa,inicio,lista.length);
  // Grava pelo mapa dos NOMES. Nem uma célula da linha 3 é reescrita.
  const plan = lista.map(ev => mapa.map(m=>valorMarketplace_(ev,m.campo)));
  for (let j=0; j<mapa.length; j++) {
    const col = mapa[j].coluna;
    const coluna = plan.map(r=>[r[j]]);
    aba.getRange(inicio,col,lista.length,1).setValues(coluna);
  }
  formatarMarketplace_(aba,mapa,inicio,lista.length);
  aba.setFrozenRows(3);
  SpreadsheetApp.flush();
  props.setProperty(PROP_REPARO,'sim');
  console.log('RECONSTRUÍDOS: ' + lista.length + ' Pokémon, linha 4 até ' + (lista.length+3));
  console.log('CABEÇALHOS PRESERVADOS: ' + JSON.stringify(mapa.map(x=>x.titulo+'='+x.coluna)));
  console.log('BACKUP: '+backup.getName());
}

function imagemFormula(v) {
  const url=String(v||'').trim();
  if (!/^https:\/\/[a-z0-9.-]+\/[a-z0-9_\-/%.,~?=&+]*$/i.test(url) || url.length>500) return '';
  return '=IMAGE("'+url.replace(/"/g,'%22')+'",4,36,36)';
}

function limpar(v) {
  if (v === undefined || v === null) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  if (typeof v === 'string' && /^[=+@\-\t\r]/.test(v)) return "'" + v;
  return v;
}

function resposta(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}


// =====================================================
// 8. INTEGRIDADE E REPARO SEGURO DOS IDs (v1.5.4.4)
// =====================================================
// Execute diagnosticarIDsMarketplaceSeguro() primeiro (somente leitura).
// Depois execute repararIDsMarketplaceSeguro() UMA VEZ pelo editor.
// NUNCA execute estas rotinas pelo endpoint público doPost.
// As abas 'eventos' e 'Sheet' originais permanecem preservadas até a
// validação de uma cópia de trabalho; um backup de Sheet é criado antes.

function checarIDsResumo_(aba, estrito) {
  const mapa = mapaMarketplace_(aba);
  const idCol = mapa.find(x=>x.campo==='id').coluna;
  const n = Math.max(0, aba.getLastRow()-LINHA_DADOS_RESUMO+1);
  const valores = n ? aba.getRange(LINHA_DADOS_RESUMO,idCol,n,1).getValues() : [];
  const visiveis = n ? aba.getRange(LINHA_DADOS_RESUMO,idCol,n,1).getDisplayValues() : [];
  const vistos = new Map(), duplicados=[], datas=[], invalidos=[];
  let vazios=0, validos=0;
  for (let i=0;i<n;i++) {
    const linha=LINHA_DADOS_RESUMO+i, bruto=valores[i][0];
    const id=String(visiveis[i][0]||'').trim();
    if (!id) { vazios++; continue; }
    if (bruto instanceof Date || /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(id)) {
      datas.push({linha,valor:id}); continue;
    }
    // ID de anúncio como texto simples (inclui IDs sintéticos de testes), nunca data ou fórmula.
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) { invalidos.push({linha,valor:id}); continue; }
    validos++;
    if (vistos.has(id)) duplicados.push({id,primeiraLinha:vistos.get(id),linha});
    else vistos.set(id,linha);
  }
  const resultado={registrosComId:validos,idsUnicos:vistos.size,
    duplicados,datas,invalidos,linhasSemId:vazios,ultimaLinha:aba.getLastRow()};
  if (estrito && (duplicados.length||datas.length||invalidos.length)) {
    const amostra=[...datas,...duplicados,...invalidos].slice(0,4);
    throw new Error('Coluna #ID inconsistente ('+datas.length+' datas, '+
      duplicados.length+' duplicados, '+invalidos.length+' inválidos). Exemplos: '+
      JSON.stringify(amostra)+'. Execute diagnosticarIDsMarketplaceSeguro e repararIDsMarketplaceSeguro.');
  }
  return resultado;
}

function diagnosticarIDsMarketplaceSeguro() {
  const ss=abrirPlanilhaConfigurada(), aba=ss.getSheetByName(NOME_RESUMO);
  if (!aba) throw new Error('Aba Sheet ausente');
  const analise=checarIDsResumo_(aba,false);
  const eventos=lerEventosAuditoria_(ss);
  const idsAuditoria=new Set();
  const invalidosAuditoria=[];
  eventos.forEach((e,i)=>{
    const id=String(e.id||e.anuncio_id||'').trim();
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) invalidosAuditoria.push({linha:i+2,id});
    else idsAuditoria.add(id);
  });
  console.log('DIAGNÓSTICO: '+JSON.stringify({
    planilha:ss.getName(),resumo:analise,eventos: eventos.length,
    anunciosUnicosAuditoria:idsAuditoria.size,
    invalidosAuditoria:invalidosAuditoria.slice(0,15),
    quantidadeInvalidosAuditoria:invalidosAuditoria.length}));
  return analise;
}

function repararIDsMarketplaceSeguro() {
  const lock=LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const ss=abrirPlanilhaConfigurada(), original=ss.getSheetByName(NOME_RESUMO);
    if (!original) throw new Error('Aba Sheet ausente');
    if (abaTemModeloVendas_(original)) throw new Error('A aba Sheet está reservada para vendas confirmadas.');
    const mapa=mapaMarketplace_(original);
    const auditoria=lerEventosAuditoria_(ss);
    if (!auditoria.length) throw new Error('Aba eventos vazia. Reparo interrompido.');
    const invalidos=auditoria.filter(e=>!/^[A-Za-z0-9_-]{1,64}$/.test(String(e.id||e.anuncio_id||'').trim()));
    if (invalidos.length) throw new Error('A auditoria tem '+invalidos.length+
      ' anúncios com ID não numérico. Corrija/recupere a auditoria antes do reparo.');
    const unicos=consolidarEventos_(auditoria);
    if (!unicos.size || unicos.size>50000)
      throw new Error('Quantidade inválida de anúncios na auditoria: '+unicos.size);
    const diag=checarIDsResumo_(original,false);
    // Proteção contra reconstruir 4 mil linhas a partir de um histórico parcial.
    if (diag.idsUnicos>20 && unicos.size < diag.idsUnicos*0.90)
      throw new Error('Auditoria parece incompleta ('+unicos.size+' IDs contra '+
        diag.idsUnicos+' no resumo). Não é seguro reconstruir.');
    // Cada ID ainda legível na tabela deve existir no histórico. A contagem total
    // sozinha NÃO basta: poderia perder 1% dos Pokémon sem perceber.
    const colunaId=mapa.find(m=>m.campo==='id').coluna;
    const idsOriginais=original.getLastRow()<LINHA_DADOS_RESUMO ? [] :
      original.getRange(LINHA_DADOS_RESUMO,colunaId,
        original.getLastRow()-LINHA_DADOS_RESUMO+1,1).getDisplayValues().flat();
    const semHistorico=[...new Set(idsOriginais.map(x=>String(x||'').trim())
      .filter(id=>/^[A-Za-z0-9_-]{1,64}$/.test(id) && !unicos.has(id)))];
    if(semHistorico.length) throw new Error(semHistorico.length+
      ' IDs do resumo não constam na aba eventos (ex.: '+semHistorico.slice(0,8).join(', ')+
      '). Reparo interrompido para evitar perda de registros.');
    const ultima=Math.max(original.getLastRow(),LINHA_DADOS_RESUMO-1);
    const qtdAntiga=Math.max(0,ultima-LINHA_DADOS_RESUMO+1);
    const todosMapeados=new Set(mapa.map(x=>x.coluna));
    // Evitar desalinhamento de colunas manuais sem mapeamento pelo script.
    // A cópia de backup não substitui preservar a associação ID -> anotação.
    const largura=Math.min(original.getLastColumn(),COLUNA_LIMITE_LEITURA);
    for(let col=1;col<=largura;col++) {
      if (todosMapeados.has(col)||col===1||qtdAntiga===0) continue;
      const manual=original.getRange(LINHA_DADOS_RESUMO,col,qtdAntiga,1).getValues();
      if (manual.some(r=>r[0]!=='' && r[0]!==null))
        throw new Error('Coluna manual não mapeada ('+col+') contém valores. '+
          'O reparo automático foi interrompido para não desalinhá-los.');
    }
    const stamp=Utilities.formatDate(new Date(),Session.getScriptTimeZone(),'yyyyMMdd_HHmmss');
    const sufixo=Utilities.getUuid().slice(0,6);
    // BACKUP CRIADO ANTES DE QUALQUER GRAVAÇÃO NA ABA ORIGINAL.
    const backup=original.copyTo(ss).setName('backup_market_'+stamp+'_'+sufixo);
    console.log('BACKUP PRÉVIO: '+backup.getName());
    // Cópia de trabalho: a aba original NÃO é alterada enquanto preparamos.
    const stage=original.copyTo(ss).setName('stage_market_'+stamp+'_'+sufixo);
    const lista=[...unicos.values()].sort((a,b)=>msEvento_(b)-msEvento_(a));
    const quantidade=lista.length;
    const n=Math.max(qtdAntiga,quantidade);
    if (stage.getMaxRows()<LINHA_DADOS_RESUMO+n-1)
      stage.insertRowsAfter(stage.getMaxRows(),LINHA_DADOS_RESUMO+n-1-stage.getMaxRows());
    // Reescrever SOMENTE colunas reconhecidas na linha 3. Não tocar na aba eventos.
    for(const m of mapa) {
      if(n) stage.getRange(LINHA_DADOS_RESUMO,m.coluna,n,1).clearContent();
    }
    formatarMarketplace_(stage,mapa,LINHA_DADOS_RESUMO,quantidade);
    for (const m of mapa) {
      const valores=lista.map(e=>[valorMarketplace_(e,m.campo)]);
      if (quantidade) stage.getRange(LINHA_DADOS_RESUMO,m.coluna,quantidade,1).setValues(valores);
    }
    SpreadsheetApp.flush();
    const valida=checarIDsResumo_(stage,true);
    if(valida.idsUnicos!==quantidade || valida.datas.length || valida.duplicados.length)
      throw new Error('A cópia de trabalho não passou na verificação de IDs; '+
        'a aba original foi preservada. Backup: '+backup.getName());
    // Só agora copiar para Sheet. Lock evita concorrência com doPost.
    if (original.getMaxRows()<LINHA_DADOS_RESUMO+n-1)
      original.insertRowsAfter(original.getMaxRows(),LINHA_DADOS_RESUMO+n-1-original.getMaxRows());
    for (const m of mapa) {
      if (n) original.getRange(LINHA_DADOS_RESUMO,m.coluna,n,1).clearContent();
    }
    formatarMarketplace_(original,mapa,LINHA_DADOS_RESUMO,quantidade);
    for (const m of mapa) {
      if (quantidade) {
        // Em especial preserva as fórmulas =IMAGE(), não apenas o resultado.
        const valores=lista.map(e=>[valorMarketplace_(e,m.campo)]);
        original.getRange(LINHA_DADOS_RESUMO,m.coluna,quantidade,1).setValues(valores);
      }
    }
    SpreadsheetApp.flush();
    const apos=checarIDsResumo_(original,true);
    if(apos.idsUnicos!==quantidade)
      throw new Error('Verificação pós-gravação falhou; restaure pelo backup '+backup.getName());
    PropertiesService.getScriptProperties().setProperty(PROP_REPARO,'sim');
    console.log('REPARO CONCLUÍDO: '+JSON.stringify({
      anuncios:quantidade,backup:backup.getName(),stage:stage.getName(),
      duplicadosAntes:diag.duplicados.length,datasAntes:diag.datas.length,
      invalidosAntes:diag.invalidos.length,validosDepois:apos.idsUnicos}));
    // A stage é mantida intencionalmente para conferência independente.
  } finally {lock.releaseLock();}
}

const CABECALHO_BACKUP_VENDAS = [
  'Data', '#ID', 'Sprite', 'Pokemon', 'Preço (Mi)', 'Potência', 'Nota',
  'IV ATQ', 'IV SPED', 'IV SP.ATQ', 'IV SP.DEF', 'IV DEF', 'IV HP', 'Qualidade',
  'IV Total', 'Shiny', 'Status de Compra', 'Moeda', 'Preço exato', 'ID Pokémon',
  'ID espécie', 'ID anúncio', 'Nível', 'Forma', 'Natureza', 'ID natureza',
  'Shadow', 'Raridade', 'Lendário', 'AoE', 'Z-Move', 'Mega', 'Refino', 'Poder',
  'Outland', 'Origem', 'Chave da venda', 'Dados da venda (JSON)'
];

const TITULOS_VISIVEIS_VENDAS = [
  'Data', 'Sprite', 'Pokemon', 'Nível', 'Preço (Mi)', 'Potência', 'Nota',
  'IV ATQ', 'IV SPED', 'IV SP.ATQ', 'IV SP.DEF', 'IV DEF', 'IV HP', 'Qualidade',
  'IV Total', 'Shiny', 'Status de Compra'
];

function titulosVendas_(sheet) {
  const width = sheet.getLastColumn();
  if (!width || sheet.getLastRow() < LINHA_CABECALHO_RESUMO) return [];
  return sheet.getRange(LINHA_CABECALHO_RESUMO, 1, 1, width).getDisplayValues()[0];
}

function abaTemModeloVendas_(sheet) {
  if (!sheet) return false;
  const titles = new Set(titulosVendas_(sheet).map(normalizarTitulo));
  return TITULOS_VISIVEIS_VENDAS.every(title => titles.has(normalizarTitulo(title)));
}

function escolherAbaVendas_(book) {
  const preferred = book.getSheetByName(NOME_RESUMO);
  if (abaTemModeloVendas_(preferred)) return preferred;
  const candidates = book.getSheets().filter(abaTemModeloVendas_);
  if (candidates.length === 1) return candidates[0];
  throw new Error(candidates.length ?
    'Mais de uma aba tem os títulos de vendas na linha 3. Use o nome Sheet na aba desejada.' :
    'Modelo de vendas ausente: confira os cabeçalhos da linha 3 na planilha vinculada.');
}

function colunasBackupVendas_(sheet) {
  const titles = titulosVendas_(sheet);
  const byTitle = new Map();
  const expected = new Set(CABECALHO_BACKUP_VENDAS.map(normalizarTitulo));
  titles.forEach((title, index) => {
    const key = normalizarTitulo(title);
    if (!expected.has(key)) return;
    if (byTitle.has(key)) throw new Error('Cabeçalho de vendas repetido: ' + title);
    byTitle.set(key, index + 1);
  });
  const missing = CABECALHO_BACKUP_VENDAS.filter(title => !byTitle.has(normalizarTitulo(title)));
  if (missing.length) {
    const first = titles.length + 1;
    const last = titles.length + missing.length;
    if (last > sheet.getMaxColumns()) sheet.insertColumnsAfter(sheet.getMaxColumns(), last - sheet.getMaxColumns());
    sheet.getRange(LINHA_CABECALHO_RESUMO, first, 1, missing.length).setValues([missing]);
    sheet.hideColumns(first, missing.length);
    missing.forEach((title, index) => byTitle.set(normalizarTitulo(title), first + index));
  }
  return CABECALHO_BACKUP_VENDAS.map(title => byTitle.get(normalizarTitulo(title)));
}

function escreverLinhasBackup_(sheet, columns, firstRow, records) {
  const first = Math.min(...columns);
  const last = Math.max(...columns);
  const width = last - first + 1;
  const range = sheet.getRange(firstRow, first, records.length, width);
  const values = range.getValues();
  const formulas = range.getFormulas();
  const formats = range.getNumberFormats();
  const idFields = new Set(['#ID', 'ID Pokémon', 'ID espécie', 'ID anúncio', 'ID natureza', 'Chave da venda']);
  for (let row = 0; row < records.length; row++) {
    for (let i = 0; i < width; i++) if (formulas[row][i]) values[row][i] = formulas[row][i];
    const incoming = records[row];
    columns.forEach((column, index) => {
      const title = CABECALHO_BACKUP_VENDAS[index];
      const offset = column - first;
      values[row][offset] = incoming[index];
      if (idFields.has(title)) formats[row][offset] = '@';
      else if (title === 'Data') formats[row][offset] = 'yyyy-mm-dd hh:mm:ss';
    });
  }
  // A chave, a ficha e o texto da venda entram juntos no mesmo intervalo de linhas.
  range.setNumberFormats(formats);
  range.setValues(values);
}

function limparVendaBackup_(row) {
  if (!row || !['gold', 'orb'].includes(row.currency) ||
      !['game', 'smartmarket_backup'].includes(row.source) ||
      !Number.isSafeInteger(row.soldAt) || row.soldAt < 1e12 ||
      row.soldAt > Date.now() + 86400000 || !Number.isSafeInteger(row.price) || row.price < 1) {
    throw new Error('Venda inválida no backup');
  }
  const id = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(value) ? value : null;
  const clean = { id: id(row.id), currency: row.currency, source: row.source,
    soldAt: row.soldAt, price: row.price, speciesId: id(row.speciesId) };
  if (!clean.id || !clean.speciesId) throw new Error('ID de venda ou espécie inválido');

  for (const key of ['pokemonId', 'listingId', 'natureId']) clean[key] = id(row[key]);
  for (const key of ['name', 'form', 'nature', 'rarity'])
    clean[key] = typeof row[key] === 'string' ? row[key].trim().slice(0, 100) || null : null;
  for (const key of ['level', 'grade', 'power', 'quality', 'ivTotal', 'refinement', 'battlePower'])
    clean[key] = Number.isFinite(row[key]) && row[key] >= 0 ? row[key] : null;
  for (const key of ['shiny', 'shadow', 'legendary', 'aoe', 'zMove', 'mega'])
    clean[key] = [0, 1].includes(row[key]) ? row[key] : null;
  clean.outland = row.outland === true ? true : null;
  const sprite = url => typeof url === 'string' && url.length <= 500 &&
    /^https:\/\/(?:[\w-]+\.)?pokeidle\.io\/[a-zA-Z0-9/%._?=&~+@:-]+$|^https:\/\/raw\.githubusercontent\.com\/PokeAPI\/sprites\/master\/sprites\/pokemon\/(?:shiny\/)?\d+\.png$/.test(url) ? url : null;
  clean.sprite = sprite(row.sprite);
  clean.spriteFallback = sprite(row.spriteFallback);
  clean.spriteSource = clean.sprite && ['market', 'dex'].includes(row.spriteSource) ? row.spriteSource : null;
  for (const key of ['ivs', 'stats']) {
    clean[key] = {};
    for (const stat of ['hp', 'attack', 'defense', 'specialAttack', 'specialDefense', 'speed'])
      if (Number.isFinite(row[key]?.[stat]) && row[key][stat] >= 0) clean[key][stat] = row[key][stat];
  }
  return clean;
}

function juntarVendaBackup_(old, incoming) {
  if (!old) return incoming;
  // O histórico do jogo prevalece sobre registros de cache importados.
  const preferIncoming = old.source !== 'game' && incoming.source === 'game';
  const [primary, secondary] = preferIncoming ? [incoming, old] : [old, incoming];
  if (['soldAt', 'price', 'speciesId', 'pokemonId', 'listingId', 'shiny', 'form', 'shadow', 'rarity']
    .some(key => primary[key] != null && secondary[key] != null && primary[key] !== secondary[key])) return primary;
  const merged = { ...primary };
  for (const [key, value] of Object.entries(secondary)) if (merged[key] == null) merged[key] = value;
  merged.ivs = { ...secondary.ivs, ...primary.ivs };
  merged.stats = { ...secondary.stats, ...primary.stats };
  const ivs = Object.values(merged.ivs);
  if (ivs.length === 6) merged.ivTotal = ivs.reduce((sum, value) => sum + value, 0);
  if (secondary.outland) merged.outland = true;
  if (incoming.spriteSource === 'market' && merged.spriteSource !== 'market') {
    merged.sprite = incoming.sprite;
    merged.spriteSource = incoming.spriteSource;
    merged.spriteFallback = incoming.spriteFallback;
  }
  return merged;
}

function linhaVendaBackup_(row) {
  const { ivs } = row;
  // Células de texto livre não podem se tornar fórmulas ao serem inseridas.
  const text = value => value == null ? '' : /^[-+=@\s]/.test(value) ? "'" + value : value;
  const flag = value => value == null ? '' : value ? 'Sim' : 'Não';
  const sprite = row.sprite || row.spriteFallback;
  return [
    new Date(row.soldAt), row.id, sprite ? '=IMAGE("' + sprite + '")' : '', text(row.name),
    row.currency === 'gold' ? row.price / 1000000 : row.price + ' Gemas', row.power, row.grade,
    ivs.attack, ivs.speed, ivs.specialAttack, ivs.specialDefense, ivs.defense, ivs.hp,
    row.quality, row.ivTotal, flag(row.shiny), 'Vendido', row.currency === 'gold' ? 'Coins' : 'Gemas',
    row.price, row.pokemonId, row.speciesId, row.listingId, row.level,
    text(row.form), text(row.nature), row.natureId, flag(row.shadow), text(row.rarity),
    flag(row.legendary), flag(row.aoe), flag(row.zMove), flag(row.mega), row.refinement,
    row.battlePower, flag(row.outland), row.source, row.currency + ':' + row.id, JSON.stringify(row)
  ].map(value => value ?? '');
}

// Execute uma vez no editor, depois copie a propriedade nas configurações do projeto.
function gerarChaveLeituraVendas() {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const props = PropertiesService.getScriptProperties();
    if (!props.getProperty(CHAVE_LEITURA_VENDAS)) {
      props.setProperty(CHAVE_LEITURA_VENDAS, (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, ''));
    }
  } finally { lock.releaseLock(); }
}

function lerBackupVendas_(request) {
  const tipo = 'pis_sales_pull_v1';
  const secret = PropertiesService.getScriptProperties().getProperty(CHAVE_LEITURA_VENDAS);
  if (!secret || typeof request.chave !== 'string' || request.chave !== secret)
    return { ok: false, tipo, erro: 'Chave de leitura inválida ou não configurada no Apps Script.' };
  const start = LINHA_DADOS_RESUMO;
  const first = request.linha ?? start;
  if (!Number.isSafeInteger(first) || first < start) throw new Error('Posição de leitura inválida.');
  const sheet = escolherAbaVendas_(abrirPlanilhaConfigurada());
  const last = Math.max(start - 1, sheet.getLastRow());
  if (first > last + 1) return { ok: true, tipo, reiniciar: true, proxima_linha: start };
  const count = Math.min(100, last - first + 1);
  const titles = titulosVendas_(sheet).map(normalizarTitulo);
  const key = titles.indexOf(normalizarTitulo('Chave da venda')) + 1;
  const json = titles.indexOf(normalizarTitulo('Dados da venda (JSON)')) + 1;
  const vendas = [];
  let ignoradas = 0;
  if (count && key && json) {
    const keys = sheet.getRange(first, key, count, 1).getValues();
    const data = sheet.getRange(first, json, count, 1).getValues();
    for (const [index, [cell]] of data.entries()) {
      const id = keys[index][0];
      if (!cell && !id) continue;
      try {
        const row = limparVendaBackup_(JSON.parse(cell));
        if (id !== row.currency + ':' + row.id) throw new Error('Chave incompatível.');
        vendas.push(row);
      } catch { ignoradas++; }
    }
  }
  const proxima_linha = first + count;
  return { ok: true, tipo, linha: first, proxima_linha, tem_mais: proxima_linha <= last, vendas, ignoradas };
}

function receberBackupVendas_(request) {
  if (typeof request.lote !== 'string' || !/^[a-f0-9-]{36}$/.test(request.lote) ||
      !Array.isArray(request.vendas) || !request.vendas.length || request.vendas.length > 100)
    throw new Error('Lote de backup inválido');
  const incoming = request.vendas.map(limparVendaBackup_);
  const sales = new Map(incoming.map(row => [row.currency + ':' + row.id, row]));
  if (sales.size !== incoming.length) throw new Error('Lote de backup com IDs repetidos');
  const sheet = escolherAbaVendas_(abrirPlanilhaConfigurada());
  const columns = colunasBackupVendas_(sheet);
  const colKey = columns[CABECALHO_BACKUP_VENDAS.indexOf('Chave da venda')];
  const colJson = columns[CABECALHO_BACKUP_VENDAS.indexOf('Dados da venda (JSON)')];
  const start = LINHA_DADOS_RESUMO;
  const last = Math.max(start - 1, sheet.getLastRow());
  const keys = last >= start ? sheet.getRange(start, colKey, last - start + 1, 1).getValues() : [];
  const positions = new Map();
  keys.forEach(([key], index) => {
    if (!key) return;
    if (positions.has(key)) throw new Error('Chave de venda repetida na aba ' + sheet.getName());
    positions.set(key, index + start);
  });

  const updates = [], additions = [];
  for (const [key, sale] of sales) {
    const position = positions.get(key);
    if (!position) { additions.push(linhaVendaBackup_(sale)); continue; }
    const cell = sheet.getRange(position, colJson).getValue();
    const old = limparVendaBackup_(JSON.parse(cell));
    if (old.currency + ':' + old.id !== key) throw new Error('Chave e ficha não correspondem na linha ' + position);
    const merged = limparVendaBackup_(juntarVendaBackup_(old, sale));
    if (JSON.stringify(merged) !== cell) updates.push([position, linhaVendaBackup_(merged)]);
  }
  for (const [position, values] of updates) escreverLinhasBackup_(sheet, columns, position, [values]);
  if (additions.length) {
    if (last + additions.length > sheet.getMaxRows())
      sheet.insertRowsAfter(sheet.getMaxRows(), last + additions.length - sheet.getMaxRows());
    escreverLinhasBackup_(sheet, columns, last + 1, additions);
  }
  SpreadsheetApp.flush();
  return { ok: true, tipo: request.tipo, lote: request.lote, vendas_confirmadas: incoming.length,
    novas: additions.length, atualizadas: updates.length };
}

// Ferramentas do editor para limpar apenas a tabela de vendas vinculada.
function diagnosticarLinhasForaDoBanco() {
  return executarLimpezaVendas_(false);
}

function limparLinhasForaDoBanco() {
  return executarLimpezaVendas_(true);
}

function executarLimpezaVendas_(apply) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = escolherAbaVendas_(abrirPlanilhaConfigurada());
    const titles = titulosVendas_(sheet).map(normalizarTitulo);
    const keyIndex = titles.indexOf(normalizarTitulo('Chave da venda'));
    const jsonIndex = titles.indexOf(normalizarTitulo('Dados da venda (JSON)'));
    if (keyIndex < 0 || jsonIndex < 0)
      throw new Error('A tabela ainda não tem as colunas de identificação do IndexedDB.');

    const first = LINHA_DADOS_RESUMO;
    const count = Math.max(0, sheet.getLastRow() - first + 1);
    const rows = count ? sheet.getRange(first, 1, count, titles.length).getValues() : [];
    const known = new Set(CABECALHO_BACKUP_VENDAS.map(normalizarTitulo));
    const managed = titles.map((title, index) => known.has(title) || Object.prototype.hasOwnProperty.call(ALIASES_MARKETPLACE, title)
      ? index : -1).filter(index => index !== -1);
    const toClear = [];
    let saved = 0, uncertain = 0;
    rows.forEach((row, i) => {
      const key = row[keyIndex], content = row[jsonIndex];
      if (key !== '' || content !== '') {
        try {
          const sale = limparVendaBackup_(JSON.parse(content));
          if (sale.currency + ':' + sale.id !== key) throw new Error();
          saved++;
        } catch { uncertain++; }
      } else if (managed.some(index => row[index] !== '' && row[index] != null)) {
        toClear.push(first + i);
      }
    });
    const report = { aba: sheet.getName(), vendas_db: saved, linhas_incertas_preservadas: uncertain,
      linhas_fora_do_db: toClear.length, amostra_de_linhas: toClear.slice(0, 30), aplicou: false };
    if (apply && toClear.length) {
      if (!saved) throw new Error('Nenhuma venda do IndexedDB identificada. Confira o diagnóstico antes de limpar.');
      // Preserva a formatação, os cabeçalhos e colunas sem relação com a tabela.
      const blocks = [];
      for (const index of managed) {
        const last = blocks.at(-1);
        if (last && index === last[1] + 1) last[1] = index;
        else blocks.push([index, index]);
      }
      const runs = [];
      for (const row of toClear) {
        const last = runs.at(-1);
        if (last && row === last[1] + 1) last[1] = row;
        else runs.push([row, row]);
      }
      const addresses = runs.flatMap(([from, to]) => blocks.map(([left, right]) =>
        sheet.getRange(from, left + 1, to - from + 1, right - left + 1).getA1Notation()));
      for (let i = 0; i < addresses.length; i += 100)
        sheet.getRangeList(addresses.slice(i, i + 100)).clearContent();
      SpreadsheetApp.flush();
      report.aplicou = true;
    }
    console.log(JSON.stringify(report));
    return report;
  } finally { lock.releaseLock(); }
}
