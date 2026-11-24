# PokeIdle Market Sniper 1.5.4.99 — Ajuste de posição dos marcadores

## Mudança visual
- `markers/src/ui.js`: os botões caveira, lua e estrela passam do canto superior direito para o **superior esquerdo** dos cards `.cm-card` (`left: 3px; top: 3px`).
- Corrige a sobreposição com a estrela original de favoritos do jogo.
- `markers/README.md`: documentação da nova posição.
- `tests/markers-integration.test.cjs`: nova proteção contra regressão de posicionamento.
- `manifest.json`: versão 1.5.4.99, permitindo atualização pelo launcher.

## Preservado
- Modelo de preços de Coins e Gemas, histórico no IndexedDB, fila MV3, selos, eventos e dados dos marcadores em `chrome.storage.local`.
- `market-main.js` não foi alterado: o posicionamento está isolado em `markers/src/ui.js`.
- Pastas do GitHub: Chrome, Brave e `pokeidle_bot_io`.

## Como testar
1. Atualize a pasta carregada pela extensão sem desinstalar.
2. Em `chrome://extensions` ou `brave://extensions`, recarregue o Sniper e pressione F5 em `https://pokeidle.io/app`.
3. Confira caveira/lua/estrela **à esquerda** e o favorito **à direita**, sem sobreposição.
4. Clique nos marcadores para escolher/remover. Teste favoritos, mudança de abas e F5.
5. No terminal, dentro de `extensao`: `node --test tests/*.test.cjs`.

**Limitação:** o teste visual no jogo real depende de validação no navegador. A suíte Node verifica o posicionamento no código e os fluxos de integração, não a aparência renderizada do PokeIdle.
