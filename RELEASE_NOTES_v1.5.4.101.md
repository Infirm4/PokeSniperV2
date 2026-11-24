# PokeSniper V2 — v1.5.4.101

## Objetivo

Priorizar a cotação da página de mercado atualmente aberta sem criar novas requisições concorrentes ao WebSocket do jogo; manter as três primeiras páginas de **Recentes** em segundo plano, quando o monitor já estiver habilitado; deixar o histórico com menor prioridade. Corrigir a apresentação e o filtro de notas para **truncamento decimal em duas casas**, sem arredondar para cima.

## Diagnóstico da versão 1.5.4.100

- `sniper.js`: o **outbox MAIN** retransmitia lotes pendentes na ordem de inserção. Uma observação da vitrine podia aguardar atrás de vários lotes históricos.
- `market-store.js`: `nextBatch()` selecionava o menor `dueAt`; não diferenciava vitrine, Recentes e histórico.
- `market-badges.js`: uma consulta antiga pendente bloqueava a consulta da página recém-aberta até receber resposta ou atingir 12 segundos.
- `sniper.js`: o monitor compartilhava o WebSocket com o jogo. A versão já tinha limitador e prova de correlação, mas não reservava uma janela explícita após navegação real do usuário.
- `opportunities.js`: `Intl.NumberFormat` arredondava a nota (`3.978` → `3,98`) no resumo compacto e podia mostrar três casas no detalhado. `opportunities-popup.js` também formatava notas usando o formatador genérico de preços.
- `market-core.js`: `Number()` não reconhecia notas como `'3,978'`. O filtro digitado já descartava decimais extras, mas as notas dos registros antigos ainda podiam ter três casas.

## Implementação

| Arquivo | Mudança |
|---|---|
| `sniper.js` | Identifica lote originado da vitrine (`viewing`), carrega ordem da consulta e prioriza o reenvio dos lotes da página atual, sem descartar o restante. Dá uma janela de proteção à consulta nativa do jogo antes de enviar mais um pedido do monitor. |
| `bridge.js` | Propaga `viewing` e `order` ao background sem alterar a lógica de reconexão MV3. |
| `market-priority.js` | Novo módulo puro de classificação 0=vitrine, 1=Recentes páginas 1–3, 2=normal/vendas, 3=preparação/histórico; um turno periódico de prioridade baixa evita fome da fila. |
| `background.js` | Classifica cada lote antes de persistir na fila; drenagem usa prioridade, preserva ACK e retentativas existentes. |
| `market-store.js` | Migração **aditiva** do IndexedDB 19→20 com índice `readyPriority`. Lê por prioridade e `dueAt` com transações de leitura independentes. Notas históricas são truncadas em **memória** ao servir de comparáveis; registros persistidos não são regravados. |
| `market-badges.js` | Permite até duas requisições locais de selos concorrentes, para não esperar uma página antiga quando a vitrine muda. Continua sem enviar novos pedidos ao WebSocket. |
| `market-core.js` | Novo `truncateGrade()` decimal seguro; normaliza `grade` de novos anúncios/vendas com dois dígitos, aceita vírgula. |
| `opportunities.js` | Tanto `matches()` quanto `profileSummary()` utilizam a mesma nota truncada, inclusive em registros anteriores. |
| `opportunities-popup.js` | Detalhamento e comparáveis exibem a nota com exatamente duas casas sem arredondar. |
| `market-main.js` | Regenerado pelo script de build a partir de `sniper.js` e `market-core.js`. |
| `manifest.json` | Versão atualizada para `1.5.4.101`. |
| `tests/` | Novo teste de prioridade/nota e atualização de expectativas antigas. |

### Precedência efetiva

1. **Vitrine atual**: cotações diretas via `PIS_MARKET_BADGES` e lote de observação de maior prioridade.
2. **Recentes**: páginas visíveis no jogo como 1, 2 e 3, identificadas internamente pelos índices 0, 1 e 2. A página 3 mantém a periodicidade existente de ~30 segundos, quando permitida. A ordem de *processamento* é prioritária, não há aumento da frequência de consultas.
3. **Outras capturas e vendas**: mantidas no fluxo normal.
4. **Preparação e varredura histórica**: executadas no tempo ocioso, com turno de justiça a cada doze lotes concluídos quando necessário.

A monitoria continua respeitando as preferências existentes, bloqueios/rate limits, apenas uma consulta ativa por vez e a verificação de correlação da resposta. Quando o jogo está utilizando a vitrine, o monitor não interfere no pedido nativo. **Não há garantia de cotação onde faltam dados reais do jogo**, e uma transação IndexedDB já iniciada não é cancelada no meio.

### Nota truncada

- `3.978`, `3,978` → **`3,97`**.
- `3.980` → **`3,98`**.
- `9.999` → **`9,99`**.
- Configuração de nota mínima `3,98` **não aceita** oferta cuja nota bruta seja `3,978`.

As fórmulas e pesos de precificação não foram alterados. O código original de `coin-market.js`, `pricing-model.js`, `public-gems.js`, `vendor/briaoale/nota.js` e `vendor/briaoale/pve-pricing.js` permanece bit a bit igual ao 1.5.4.100. O algoritmo interno de Briaoale continua calculando notas de referência com a própria precisão; o Sniper trunca o valor de nota quando normaliza observações e comparáveis locais para exibição/filtros. **Somente a nota é truncada: preços monetários e descontos continuam usando seus respectivos arredondamentos intencionais.**

## Preservação de dados

O upgrade do `pis_market_core` para versão **20** adiciona um índice e atualiza apenas metadados de prioridade das mensagens `marketQueue` antigas. Nenhuma store de vendas, anúncios ou cotações é eliminada. O outbox no domínio do jogo é mantido. Os arquivos `.exe` de Chrome/Brave e o bot foram preservados.

## Validação automatizada

- `node scripts/build-market-main.cjs --check`
- `node --test tests/*.test.cjs`: **103/103 Chrome** e **103/103 Brave**.
- `pokeidle_bot_io`: **6/6**.
- `go test ./...` no launcher: **aprovado**.
- Teste real de UI/WebSocket: **pendente**; requer navegar no jogo.

## Como atualizar

1. Faça backup da pasta da extensão e mantenha o mesmo diretório/ID no Chrome ou Brave; não desinstale a extensão para testar.
2. Copie `PokeSniper V2_Chrome` e `PokeSniper V2_Brave` da distribuição para a raiz do repositório existente, substituindo arquivos correspondentes. `pokeidle_bot_io` não recebeu mudanças nesta versão.
3. Em `chrome://extensions` / `brave://extensions`, recarregue o Sniper. Depois pressione F5 na aba `https://pokeidle.io/app`.
4. Alterne entre páginas do mercado; confira se as cotações da página atual aparecem sem aguardar toda a fila e se os três marcadores permanecem à esquerda.
5. Abra o painel de oportunidades e confira uma nota bruta de três casas (por exemplo, 3,978): ela deve aparecer como **3,97**. Ajuste o filtro para 3,98 e confirme que a oferta não passa no filtro.
6. Com o monitor habilitado, confira que Recentes continuam sendo consultados respeitando o intervalo mínimo, sem criar rajadas no WebSocket.

### Diagnóstico seguro da fila no Console do service worker

```js
(async () => {
  const request = indexedDB.open('pis_market_core');
  const db = await new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    const tx = db.transaction('marketQueue', 'readonly');
    const index = tx.objectStore('marketQueue').index('readyPriority');
    const result = await Promise.all([0, 1, 2, 3].map(priority => new Promise((resolve, reject) => {
      const range = IDBKeyRange.bound(['pending', priority, 0, 0],
        ['pending', priority, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER]);
      const r = index.count(range);
      r.onsuccess = () => resolve({ prioridade: priority, pendentes: r.result });
      r.onerror = () => reject(r.error);
    })));
    console.table(result);
  } finally { db.close(); }
})().catch(console.error);
```

Esse diagnóstico lê apenas quantidades; não elimina ou modifica dados.
