# Captura automática no PokéIdle.io

A versão 3.0 roda pela extensão em Chrome para computador. Ela observa a lista
de Pokémon caídos e usa os botões de captura do próprio jogo. A Poké Bola
continua sendo a escolhida na hunt.

## Instalação e uso

1. Se o bot Python antigo estiver rodando, encerre-o com `parar_bot.bat` ou feche o CMD dele.
2. Abra `chrome://extensions`. Se o bot já estiver instalado, substitua os arquivos na mesma pasta e clique em **Recarregar**. Em uma primeira instalação, ative o **Modo do desenvolvedor** e use **Carregar sem compactação**, selecionando `extensao_chrome`.
3. Recarregue a aba do PokéIdle, entre na hunt e escolha a Poké Bola.
4. Clique no ícone **Captura automática** e depois em **Ligar**. Use **Desligar** para parar.

O intervalo padrão é de 3 segundos e pode ser editado no ícone da extensão.
Cada ciclo envia até três tentativas. O estado informado no ícone distingue
uma tentativa enviada, a lista ausente, botões bloqueados e a aba congelada
ou descarregada. Confirme o resultado da captura pelo próprio jogo.

## Ao minimizar ou abrir outros painéis

Os botões podem ser acionados enquanto continuam montados e habilitados,
mesmo quando a interface está escondida por um painel ou pela janela
minimizada. Se a mochila ou o mercado desmontar a lista, a extensão aguarda
e volta a processá-la assim que o jogo a recriar. A extensão mantém a aba
selecionada protegida do descarte automático enquanto a captura está ligada
e restaura a configuração anterior ao desligar.

Uma aba congelada ou descarregada pelo Chrome, ou um jogo que pausa em
segundo plano, pode deixar de processar tentativas. Deixe o PC acordado e o
Chrome aberto. Em **Configurações → Desempenho → Sempre manter estes sites
ativos**, é possível adicionar `pokeidle.io` se o navegador descarregar a aba.

Os arquivos Python e BAT são do fluxo anterior. A extensão 3.0 usa o próprio
controle **Ligar/Desligar** e dispensa CMD e servidor local.
