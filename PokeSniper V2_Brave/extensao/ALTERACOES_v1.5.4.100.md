# PokeIdle Market Sniper v1.5.4.100 — Correção de reconexão MV3 e cotações intermitentes

Base: versão 1.5.4.99 (Chrome e Brave). Repositório: `Infirm4/PokeSniperV2`.

## Diagnóstico (com base no código)

1. **Falso F5 permanente.** Em `bridge.js` da 1.5.4.99, três falhas de canal (`Receiving end does not exist` ou `message port closed`) eram tratadas como contexto invalidado. Isso desligava a ponte até a página recarregar, apesar de `chrome.runtime.id` ainda poder estar válido. Um novo F5 podia produzir a mesma sequência de falhas de inicialização e o mesmo aviso.
2. **Pausa sem recuperação.** O MAIN (`sniper.js`) interrompia entregas após `EXTENSION_CONTEXT_INVALIDATED` e o `market-badges.js` parava de consultar preços. Não havia handshake nem retomada quando o worker voltava após uma falha transitória.
3. **Selos dependentes da conclusão da fila.** A confirmação do `PIS_MARKET_CORE_BATCH` indicava que o lote estava persistido na **fila**, mas `PIS_MARKET_BADGES` exigia leitura da tabela `listings` já recalculada. Quando a fila tinha atraso, um anúncio observado podia continuar como `Sem dados` até o commit do seu lote. A conclusão ocasional de alguns lotes produz cotações isoladas.
4. **Recálculo excessivo.** Na entrada de vendas, o `market-store.js` reavaliava todas as listagens do grupo correspondente, mesmo as antigas e fora da janela de exibição, mantendo a transação IndexedDB aberta por mais tempo.
5. **Consultas de selos sem limite mínimo entre atualizações.** Eventos frequentes da vitrine zeravam `lastKeys` e podiam disparar consultas quase consecutivas, aumentando o congestionamento.

Essas são causas presentes no código e compatíveis com os sintomas. A contribuição relativa de cada uma **não foi medida no Chrome do usuário**; a estabilidade real e o fluxo WebSocket só poderão ser confirmados no site depois da atualização.

## Alterações

| Caminho (nas duas edições) | Mudança |
|---|---|
| `extensao/bridge.js` | Desconexão temporária gera `BRIDGE_STATUS: reconnecting` e health checks com backoff; só contexto realmente invalidado gera orientação de F5. Mensagens sem resposta têm timeout de 20s. Confirmação de reconexão `BRIDGE_STATUS: ready`; postMessage sempre na origem web. |
| `extensao/background.js` | Resposta rápida a `PIS_BRIDGE_HEALTH`, mesmo sem depender de transação de mercado; consulta de cotações aceita observações do MAIN normalizadas; falha de um job não bloqueia os demais. |
| `extensao/market-badges.js` | Armazena observações recentes em memória (máx. 500, 10 min) e as oferece à precificação, sem aguardar commit de `listings`; retoma consulta após bridge reconectar, timeout 12s, limite mínimo entre consultas. |
| `extensao/market-store.js` | Prévia de Gemas/Coins usando **os estimadores existentes** e observações reais; leitura da tabela `listings` só quando não há observação adequada. Migração aditiva IndexedDB v18 -> v19 com índice `pricingGroupRecent` para reavaliar apenas listagens observadas na última hora quando chegam vendas. Nenhum histórico é excluído. Invalidação do cache de leitura após inserir nova venda. |
| `extensao/sniper.js` | MAIN pede estado no início (`BRIDGE_STATUS_REQUEST`); mantém outbox persistente durante falhas e retoma automaticamente os IDs ainda não confirmados ao receber `ready`. Contexto realmente invalidado continua pedindo F5, sem reload automático. |
| `extensao/market-main.js` | Bundle reconstruído automaticamente a partir de `sniper.js` e módulos privados. |
| `extensao/manifest.json` | Versão 1.5.4.100. Nenhuma permissão adicional. |
| `extensao/tests/reliability-mv3.test.cjs` | Adequação do teste de outbox ao handshake inicial. |
| `extensao/tests/market-resilience-v154100.test.cjs` | Novos casos: três falhas de canal não causam falso F5; health restaura estado; invalidação real; health do worker; observações em cotações; avaliação de gema antes da persistência; migração não destrutiva. |
| `extensao/tests/markers-integration.test.cjs` | Versão atualizada no teste de manifesto. |

**Não alterados:** `coin-market.js`, `pricing-model.js`, `public-gems.js`, `market-core.js`, modelos Briaoale, fórmulas de preço, configuração dos marcadores, arquivos de bot, executáveis e launchers. A migração cria **apenas um índice**; o banco existente e todas as vendas históricas continuam disponíveis.

## Validação executada

- Chrome: `node scripts/build-market-main.cjs --check`, `node --test tests/*.test.cjs` — **97 testes aprovados, 0 falhas**.
- Brave: mesmos comandos — **97 testes aprovados, 0 falhas**.
- Parser JS e manifesto, comparação de arquivos das duas edições, integridade do ZIP.
- O teste no jogo real ainda é necessário: o ambiente de execução não tem acesso à sessão de PokeIdle e não consegue comprovar a recuperação real do WebSocket/MV3.

## Instalação e preservação de dados

1. Faça backup das pastas `PokeSniper V2_Chrome/extensao` e `PokeSniper V2_Brave/extensao`.
2. Substitua os arquivos **na mesma pasta** em que a extensão já está carregada; não use Remover/Desinstalar, nem limpe dados do site ou da extensão.
3. No Chrome: `chrome://extensions`; no Brave: `brave://extensions`. Clique em Recarregar para o Sniper correspondente.
4. Em `https://pokeidle.io/app`, pressione F5 uma vez, abra o mercado e observe Gemas e Coins por pelo menos 1–2 minutos.
5. Confira o Console: não deve reaparecer o aviso **por uma falha de canal transitória**. O aviso de F5 é reservado para invalidação real da instalação anterior.
6. Verifique o monitor e as contagens abaixo. Caso o mercado permaneça vazio, envie as saídas e os erros do console do Service Worker: isso distingue WebSocket sem dados, worker não inicializado, snapshot de preços sem suporte ou dados ainda não observados.

## Diagnósticos sem escrita

**No Console da aba `https://pokeidle.io/app`:**

```javascript
window.addEventListener('message', function onPisStatus(e) {
  if (e.source === window && e.origin === location.origin && e.data?.source === 'PIS_BRIDGE' && e.data.type === 'BRIDGE_STATUS') {
    console.log('[PIS STATUS]', e.data.state, e.data.reason || '', new Date().toLocaleTimeString());
  }
});
window.postMessage({ source: 'PIS_MAIN', type: 'BRIDGE_STATUS_REQUEST' }, location.origin);
```

Resultado esperado: `ready` após a inicialização ou uma transição `reconnecting` -> `ready` caso o worker estivesse indisponível.

**No Console do Service Worker:**

```javascript
(async () => {
  const queue = await PISMarketStore.marketQueueSize();
  const session = await chrome.storage.session.get(['pisMarketMonitor', 'pisMarketPage:gold', 'pisMarketPage:orb']);
  console.log('Fila pendente:', queue);
  console.log('Estados:', session);
  console.log('Versão:', chrome.runtime.getManifest().version);
})();
```

O tamanho da fila não deve crescer indefinidamente enquanto novas observações chegam. Os estados ajudam a distinguir ausência de captura de atraso de processamento.

## Nota de segurança e limites

- O teste de HTML do PokeIdle precisa ser feito no Chrome/Brave reais. O arquivo entregue é uma correção testada do **código**, não uma garantia de que uma eventual mudança de protocolo do jogo não exija outra adaptação.
- Se `chrome.runtime.id` estiver realmente ausente porque a extensão foi recarregada enquanto a aba permanecia aberta, **um novo carregamento da página continua necessário**; não existe mecanismo seguro de recuperar o contexto JavaScript antigo sem reload.
- Os executáveis `.exe` foram preservados sem recompilação e o bot permanece inalterado. Não faça commit de arquivos de configuração com credenciais ou de logs privados em repositório público sem revisão.
