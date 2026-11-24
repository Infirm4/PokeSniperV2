# PokeIdle Market Sniper — Correção de confiabilidade v1.5.4.97

Base: `extensao/` v1.5.4.96 do arquivo `PokeSniper v2.rar`. No RAR original também havia `pokeidle-sniper/` v1.5.4.87; o pacote completo entregue contém as duas pastas alinhadas à mesma v1.5.4.97.

## Alterações

| Arquivo | Mudanças |
| --- | --- |
| `bridge.js` | Transporte com callback + leitura de `chrome.runtime.lastError`, tratamento de contexto invalidado, aviso manual de F5, origem validada para `https://pokeidle.io` ou subdomínio, confirmação de fila e aviso após commit. Não recarrega a página automaticamente. |
| `background.js` | Respostas explícitas para tipos reconhecidos inválidos, consumidor único de lotes, gravação durável antes do ACK, retomada por alarme, recuo progressivo após falha, confirmação de processamento ao conteúdo, isolamento de erros. |
| `market-store.js` | Migração **incremental** do IndexedDB de versão 17 para 18, acrescentando exclusivamente `marketQueue` e seus índices; fila persistente com idempotência por identificador, transações de confirmação, tombstones de ACK para evitar reprocessamento, limpeza apenas de tombstones antigos, cache transitório de leitura de vendas em Coins. |
| `sniper.js` | Outbox persistente no IndexedDB da página (`pis_market_delivery_v1`) para lotes de anúncios. Reenvio com o mesmo identificador até ACK da gravação no banco da extensão; recuperação após F5. |
| `market-main.js` | Bundle regenerado a partir de `sniper.js`, `market-core.js` e `coins-history.js` usando `node scripts/build-market-main.cjs`. **Não editar manualmente**. |
| `market-badges.js` | Retentativas após erro, não marca respostas inválidas como sucesso, atualiza cotações após `MARKET_LISTINGS_SAVED`, interrompe novas consultas após invalidação do contexto. |
| `coin-market.js` | Cache de metadados dos comparáveis por preparação para reduzir trabalho repetido; **não modifica fórmulas, janelas, pesos nem fontes**. |
| `panel-launcher.js` | Aguarda `load` do iframe antes de `postMessage` para evitar `targetOrigin` de extensão enviado a `about:blank` com origem do jogo. |
| `manifest.json` | Versão atualizada para 1.5.4.97. As permissões não foram ampliadas. |
| `tests/` | Testes atualizados para a semântica ACK=`queued`; novos testes de 60 lotes, reenvio idempotente, falhas/retomada de worker, recuperação do outbox e contexto invalidado. |

## Como instalar sem perder o banco

1. Faça backup dos dados/exportação disponíveis na versão instalada. **Não remova/desinstale a extensão já existente**: a remoção pode apagar o IndexedDB armazenado no perfil do Chrome.
2. Se a versão antiga foi carregada **sem compactação**, atualize o conteúdo **na mesma pasta já registrada** pelo Chrome. Alterar o caminho pode alterar o ID da extensão e isolar os dados antigos.
3. Em `chrome://extensions`, clique em **Recarregar** no PokeIdle Market Sniper. Depois recarregue `https://pokeidle.io/app` com **F5**. Não há recarregamento automático durante o jogo.
4. Para uma instalação nova, descompacte o ZIP e em `chrome://extensions` → **Modo do desenvolvedor** → **Carregar sem compactação**, escolha a pasta **`extensao`**, onde está o `manifest.json`.
5. Atenção: o `PokeSniper.exe` original não foi recompilado. O launcher pode buscar versões do GitHub e substituí-las no futuro. Para validar essa correção, atualize/carregue a pasta manualmente.

## Verificações locais

No **Console do Service Worker** da extensão (`chrome://extensions` → extensão → *Service worker* → Inspecionar), execute:

```js
(async () => {
  const db = await new Promise((resolve, reject) => {
    const r = indexedDB.open('pis_market_core');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  const names = ['sales', 'listings', 'marketQueue'];
  const tx = db.transaction(names, 'readonly');
  const result = await Promise.all(names.map(name => new Promise((resolve, reject) => {
    const store = tx.objectStore(name);
    const r = name === 'marketQueue' ? store.index('status').count('pending') : store.count();
    r.onsuccess = () => resolve([name, r.result]);
    r.onerror = () => reject(r.error);
  })));
  console.table(Object.fromEntries(result.map(([name, count]) => [name, { count }])));
  console.log('Versão do banco:', db.version);
  db.close();
})().catch(console.error);
```

Esperado: banco na versão **18** e vendas/anúncios anteriores ainda presentes. `marketQueue` é o número de lotes ainda pendentes; poderá variar enquanto o jogo estiver capturando anúncios.

Abra o mercado de Gemas e Coins e confira se novas cotações surgem à medida que os lotes são processados. Teste recarregar a extensão enquanto a aba do jogo está aberta: a página antiga deverá exibir um aviso pedindo **F5**, e após o F5 a captura deverá retomar. Não espere estimativa para todo anúncio que não tenha comparáveis suficientes ou informações completas.

## Testes automatizados

Na pasta da extensão, com Node.js instalado:

```bash
node scripts/build-market-main.cjs --check
node --test tests/*.test.cjs
```

Resultado no ambiente de desenvolvimento: **88 testes aprovados, 0 falhas**. O teste de perda de conexão foi executado com *mocks* do service worker e da fila; a instalação real no Chrome ainda precisa ser validada pelo usuário.

## Limites conhecidos

- `marketQueue` evita descarte por concorrência e preserva lotes após reinício do worker, mas não garante recuperação quando o armazenamento físico está esgotado ou se o usuário desinstala a extensão. O MAIN tenta conservar lotes no IndexedDB do jogo antes do envio; se esse banco também estiver indisponível, há apenas retenção em memória enquanto a página permanecer aberta, com aviso no Console.
- `Sem dados` pode continuar válido para anúncios ainda não capturados, desatualizados ou com informações insuficientes; não significa automaticamente que o Briaoale esteja fora do ar.
- Nenhuma venda anterior foi excluída, nenhuma fórmula de precificação foi alterada e não houve migração destrutiva das tabelas existentes.
