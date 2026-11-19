# Revisão de integridade e rastreamento — v1.5.4.4

## Evidências da v1.5.4.3

- O Apps Script lia o texto **exibido** na coluna `#ID`. Quando uma célula era
  convertida pelo Sheets para uma data, o script interpretava `11/12/2026`
  como um identificador de anúncio, podendo acusar duplicação e rejeitar o lote.
- A função `atualizarPorId` recusava atualizar enquanto a coluna possuísse
  duplicações ou lacunas; o histórico `eventos` era a fonte de recuperação.
- A cobertura *normal* admitia até **93% do menor total** de IDs, enquanto a
  cobertura *moderada* exigia **97,5% do maior total**. Esse desbalanceamento
  diminuía a proteção contra falsos desaparecimentos em censos normais.

## Reparo seguro do Apps Script

1. `diagnosticarIDsMarketplaceSeguro` é **somente leitura** e informa IDs
   duplicados, datas, valores inválidos, lacunas e quantidade de IDs da auditoria.
2. `repararIDsMarketplaceSeguro` usa `LockService` e confere a integridade da
   fonte `eventos`; aborta se ela tiver IDs inválidos, faltar IDs ainda legíveis
   no resumo ou se houver colunas manuais não mapeadas com conteúdo.
3. **Antes de alterar `Sheet`**, cria `backup_market_...` e
   `stage_market_...`. Reconstrói e valida `stage_market_...` primeiro.
4. Atualiza apenas as colunas reconhecidas pelos títulos da **linha 3**,
   usa linhas consecutivas desde a **linha 4**, e formata IDs como texto.
5. Revalida os IDs após gravar. Deixa backup e staging disponíveis e não toca
   na aba `eventos`. Se a gravação falhar parcialmente, o backup permite voltar.
6. `doPost` agora recusa IDs corrompidos **antes** de anexar novos eventos,
   evitando sucesso parcial quando a tabela está danificada.
7. `gravarEventos` define formato de texto em `evento_id`/`id` antes de escrever.
8. Datas que já sejam objetos `Date` são formatadas explicitamente, não como
   representações GMT.

## Cobertura e reconciliação

- Exige todas as páginas previstas, páginas completas, tamanho consistente e
  variação total inferior a 5% (com tolerância mínima de 30 registros).
- Cobertura normal: pelo menos **98%** dos IDs do maior total visto e no máximo
  **2% de IDs distintos deslocados** (com mínimo técnico de 8 para mercados pequenos).
- Cobertura moderada: pelo menos **97,5%** dos IDs e até **3% de IDs distintos
  deslocados**. Requer **três censos** alternados antes de inferir ausência.
- Censos rejeitados aproveitam as observações presentes, mas **não reclassificam
  anúncios ausentes**.
- O painel mostra `Censo X/Y pág.`, IDs únicos e horário da última resposta.
  Ao terminar, relata porcentagem da cobertura e duração.
- O rastreador ainda depende do WebSocket e de páginas mutáveis; não existe
  garantia de identificação perfeita de transações. O intervalo de 7 segundos
  e o recuo contra rate limiting permanecem inalterados.

## Testes automatizados locais

Executados com Node.js, usando mocks para os objetos `SpreadsheetApp`,
`LockService`, WebSocket e temporização. Não foram conectados aos serviços reais.

- `tests/test_tracker_154.js`: **55 cenários**, abrangendo paginação, churn,
  reanúncio por vendedor, prazo de 7 dias, classificação por ausência e Sheets.
- `tests/test_integridade_1544.js`: **9 cenários**, cobrindo datas indevidas em
  `#ID`, IDs repetidos, backup, staging, dados manuais, histórico incompleto e
  recuperação de eventos pendentes.
- `tests/test_background_154.js`: **6 cenários**, abrangendo confirmação
  do Apps Script, lote, origem, erro HTTP e resposta inválida.
- `tests/test_throttle_1542.js`: **7 cenários**, abrangendo controle de
  frequência, fila compartilhada e desativação de pedras.

**Total: 77 cenários aprovados localmente.**

## Limitações e segurança

- O Apps Script não fornece transações ACID em planilhas. Por isso a segurança
  depende de backup prévio, staging validado, lock e verificação posterior.
- Se `eventos` não contiver os IDs antigos, não é seguro reconstruir
  automaticamente. A função interrompe a execução em vez de inventar dados.
- Uma cópia externa da planilha é recomendada antes do reparo, além das abas
  `backup_market_...` e `stage_market_...` criadas automaticamente.
- O status `Vendido (provável)` continua uma inferência e deve ser distinguido
  de `Vendido (servidor)`.
