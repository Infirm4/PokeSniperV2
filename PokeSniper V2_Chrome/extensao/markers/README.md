# Marcadores incorporados ao PokeIdle Market Sniper

Implementação adaptada do pacote `pokeidle_marcadores.zip` enviado pelo usuário.

Os ícones **caveira, lua e estrela** ficam na própria extensão Sniper (não precisam de uma segunda extensão instalada).
A interface usa `.cm-card` e posiciona os ícones no canto superior esquerdo do card, sem cobrir o favorito; por anúncio, os botões são exclusivos, e o ícone ativo pode ser removido por clique ou botão direito.

- `src/icons.js`: SVG de marcadores (não substitui o ícone da extensão).
- `src/listing-id.js`: chave por ID de anúncio, com fallback de fingerprint.
- `src/storage.js`: estado separado em `chrome.storage.local` na chave `pimMarkers`.
- `src/ui.js`: Shadow DOM, MutationObserver, seleção de marcadores.
- `src/main.js`: inicialização no mundo ISOLATED, em `document_idle`.
- `tests/`: testes do pacote Claude; para executar `npm ci && npm test` a partir desta pasta.

**Limitação conhecida:** se o jogo não fornecer um ID estável e mudar preço/sprite/nome/vendedor, o fallback de fingerprint cria outra chave. Nos favoritos, o card precisa ser `.cm-card` ou o seletor deve ser ajustado com evidência do DOM real.

A instalação integrada **não lê automaticamente** `chrome.storage.local` de uma extensão de marcadores autônoma, caso ela tenha sido instalada separadamente (IDs diferentes).
