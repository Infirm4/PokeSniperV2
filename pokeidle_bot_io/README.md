# Bot local — PokeIdle.io (Chrome + Python)

**Destinado somente a:** https://pokeidle.io/ — **não** ao Poké Idle World.

## O que faz

O Python funciona como servidor local em `127.0.0.1:8765`. Uma pequena extensão Chrome recebe comandos e clica **somente** nos botões de Pokémon caídos na interface normal do jogo, dentro de `#caidos-lista` (`button.caido` / `button[data-slot]`). A extensão não movimenta o cursor, não traz a aba para frente e não tenta acessar mecanismos VIP. A Poké Ball é a que o jogador selecionou na própria hunt.

A escolha dos seletores foi conferida no código público de uma extensão da comunidade: https://github.com/ThiagoJurge/pokeidle-helper/blob/master/content.js — observador de caídos. **A captura real ainda não foi testada numa conta logada:** o jogo pode mudar HTML, exigir outra ação depois do clique ou pausar ao minimizar. Não dizemos que cliques enviados são capturas confirmadas.

## Instalação no Windows

1. **Extraia o ZIP inteiro** para uma pasta definitiva. **Não** execute dentro do WinRAR.
2. Execute `instalar_bot.bat` (instala somente `websockets`, NÃO usa Playwright).
3. Abra `chrome://extensions` no seu Chrome **normal**.
4. Ative **Modo do desenvolvedor** e **Carregar sem compactação**, escolhendo `extensao_chrome` deste pacote.
5. Se você instalou a extensão antiga que era para `poke.idleworld.online`, **remova a extensão antiga** para evitar confusão.
6. Em https://pokeidle.io/, faça login **manualmente** e entre numa hunt. Escolha a bola na interface de caídos.
7. Execute `iniciar_bot.bat`. Clique no ícone da extensão para confirmar **Python conectado**.
8. Experimente minimizar a janela. Confira `bot.log` / jogo para ver se capturas de fato ocorrem.
9. Para encerrar, execute `parar_bot.bat` (ou feche o CMD do bot).

Se o site for descarregado pelo Chrome, configure **Configurações → Desempenho → Sempre manter estes sites ativos** e adicione `pokeidle.io`. Deixe o PC acordado e o Chrome aberto. Minimizá-lo não é o mesmo que fechá-lo.

## Configuração

`config.json` contém `intervalo_segundos: 3.0`. Aceita entre 2 e 3600 segundos. Cada ciclo clica em no máximo três alvos disponíveis; para evitar repetições, o mesmo botão não é clicado novamente por cinco segundos. Isso não altera os limites do jogo.

## Diagnóstico

- **Python desconectado**: execute `iniciar_bot.bat`; no ícone da extensão clique `Conectar agora`.
- **sem_aba**: abra `https://pokeidle.io/` no mesmo Chrome em que instalou a extensão.
- **sem_lista**: ainda não encontrou a lista de Pokémon caídos; inicie uma hunt.
- **aguardando**: não há Pokémon caídos para clicar.
- **cooldown**: alvos encontrados, mas ainda respeitando o intervalo entre cliques.
- **clicou**: clique foi enviado; **não confirma que a captura aconteceu**.
- **descartada**: o Chrome suspendeu a aba.
- **sem_permissao**: recarregue a extensão em chrome://extensions e pressione F5 no jogo.

## Privacidade e limites

- A extensão tem acesso **somente** a `https://pokeidle.io/*` e à conexão local com Python.
- Não lê nem envia senhas, cookies, dados de pagamento ou tokens da conta.
- Não interfere na verificação Cloudflare: login normal antes de iniciar o bot.
- Não opera com Chrome fechado, PC em suspensão ou aba descartada.
- Pode falhar se o jogo tiver modificado o HTML ou se restringir ações quando minimizado.
- Consulte as regras de automação do jogo: https://pokeidle.io/terms.
