# PokeIdle Market Sniper 1.5.4.98 — integração dos marcadores

Base: extensão corrigida 1.5.4.97.

## Alterações
- `manifest.json`: nova versão e scripts dos marcadores carregados no mundo ISOLATED em `document_idle`.
- `markers/src/*.js`: implementação da caveira, lua e estrela, selecionados um por vez em cada anúncio.
- `markers/tests/*.test.cjs`: testes originais do pacote de marcadores.
- `tests/markers-integration.test.cjs`: testes de integração com o manifest da extensão.
- `README.md`: instruções de uso e instalação.

Nenhum módulo de cotação, preço, histórico, market-main.js, service worker ou banco IndexedDB foi alterado. A chave `pimMarkers` no `chrome.storage.local` é independente.

## Instalação
1. Faça uma cópia da pasta atualmente carregada no Chrome.
2. Descompacte este ZIP. **Copie o conteúdo da pasta `extensao` para dentro da pasta já carregada no Chrome.**
3. Em `chrome://extensions`, clique em Recarregar na extensão Sniper. Depois atualize a aba do jogo com F5.
4. Não mantenha a extensão autônoma dos marcadores habilitada ao mesmo tempo.

Não remova a extensão do Chrome nem substitua a pasta por um caminho diferente, pois isso pode mudar seu ID e a associação ao banco.

## Validação
Execute na pasta `extensao`: `node --test tests/*.test.cjs`.
Execute em `extensao/markers`: `npm ci && npm test`.
No jogo, selecione caveira/lua/estrela em diferentes anúncios, alterne vitrine/favoritos, feche/reabra a loja e pressione F5. Confirme que só um símbolo fica ativo por anúncio e que clicar nele remove a marcação.

### Limitações
- O mesmo anúncio em favoritos depende do ID de anúncio ser exposto e de seus cards usarem `.cm-card`.
- Sem ID de anúncio estável, utiliza-se impressão digital que pode mudar se o preço mudar.
- O launcher `.exe` não foi recompilado. Seu atualizador pode substituir essa versão com arquivos do GitHub.
