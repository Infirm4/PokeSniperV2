# Relatório de integração — marcadores 1.5.4.98

## Origem
- Base: PokeIdle Market Sniper 1.5.4.97 já corrigido.
- Código dos marcadores: `pokeidle_marcadores.zip`, enviado pelo usuário.
- `marcadores.patch`: verificado; é um patch para **criar uma extensão independente**, não para editar o Sniper. A integração foi feita diretamente na extensão existente.

## Arquivos de integração
- `manifest.json`: versão 1.5.4.98; novo content script no ISOLATED/document_idle com os 5 módulos.
- `markers/src/*.js`: código da funcionalidade (copiado integralmente do ZIP recebido).
- `markers/tests/`: testes originais e `browser-harness.html` para validação manual da interface em Chrome.
- `tests/markers-integration.test.cjs`: 3 testes de integração novos.
- `README.md`: instruções de instalação e limitações.

Nenhuma alteração foi feita em `background.js`, `bridge.js`, `market-store.js`, `market-main.js`, `market-badges.js`, `coin-market.js` nem nos dados do IndexedDB. O armazenamento novo usa exclusivamente a chave `pimMarkers` em `chrome.storage.local`.

## Testes realmente executados
- Sniper + integração: **91/91 passaram** (88 originais, 3 novos).
- Marcadores: storage: **5/5 passaram**.
- Sintaxe dos 5 módulos JS: aprovada (`node --check`).
- Interface/DOM: testes `jsdom` **não executados** porque a dependência não estava disponível na sessão; tentativa de instalação não concluiu. O Chromium headless também não iniciou no ambiente. Os 19 testes alegados pelo Claude não foram reproduzidos aqui.
- Validação no site real: **pendente**.

## Procedimento para atualizar sem perder dados
1. Faça backup da pasta atual da extensão.
2. Descompacte `PokeIdle_Market_Sniper_COM_MARCADORES_v1.5.4.98.zip`.
3. Copie o **conteúdo** da pasta `extensao/` do ZIP para dentro da **mesma pasta** atualmente carregada no Chrome (sobrescreva os arquivos). Não desinstale a extensão.
4. Em `chrome://extensions`, recarregue o Sniper e, em `https://pokeidle.io/app`, pressione F5.
5. Se instalou `PokeIdle Marcadores` separadamente, desative essa outra extensão para não duplicar marcadores.
6. Abra a loja e confirme três símbolos em cada card, marcação exclusiva, clique para remover, troca de filtros, favoritos e persistência após F5.

## Verificar persistência
No console da página do jogo, os content scripts ISOLATED não compartilham todas as variáveis do MAIN. Para conferir a chave, abra as Ferramentas de Desenvolvedor da extensão ou sua página popup e execute:

```js
chrome.storage.local.get('pimMarkers').then(x => console.log(x.pimMarkers));
```

## Limitações do código do Claude mantidas
- Só alcança cards que tenham a classe `.cm-card`. Favoritos com seletor diferente exigem ajuste após ver o DOM real.
- Ao não encontrar ID de anúncio, utiliza impressão digital de imagem/nome/preço/vendedor; mudança de preço pode quebrar a continuidade da marcação.
- A extensão autônoma do Claude usa outro ID Chrome; suas marcas preexistentes não migram automaticamente para a chave `pimMarkers` do Sniper.
- O executável `PokeSniper.exe` não foi recompilado; o atualizador pode sobrescrever a versão local.
