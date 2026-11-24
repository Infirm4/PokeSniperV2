> Versão do pacote **1.5.4.99**: marcadores no canto superior esquerdo, sem sobreposição com os favoritos. Os dados locais continuam no perfil do navegador.

# PokeSniper para Chrome no Windows


Baixe e execute [**PokeSniper.exe**](./PokeSniper.exe) no Windows x64. O
aplicativo cria o atalho **PokeSniper** na Área de Trabalho e abre o Chrome
em **pokeidle.io**. A extensão fica na pasta [extensao](./extensao).
Para o Brave, use o [aplicativo para Brave](../PokeSniper%20V2_Brave).

## Primeira abertura

- **Se já usa o PokeSniper**, escolha **Sim** e selecione o arquivo
  `manifest.json` da pasta da extensão que já está carregada no Chrome. O
  aplicativo trabalha nesse mesmo caminho. Assim o perfil mantém o banco
  local de vendas, os filtros e a configuração do Sheets.
- **Em uma instalação nova**, escolha **Não**. O aplicativo baixa a
  extensão e abre `chrome://extensions`. Ative o **Modo do desenvolvedor**,
  clique em **Carregar sem compactação** e escolha a pasta indicada pela
  mensagem do aplicativo. Depois, recarregue a aba do jogo. O Chrome exige
  esse passo uma vez para extensões instaladas diretamente por pasta.

Quando há uma versão mais recente no GitHub, o aplicativo atualiza a pasta
antes de abrir o jogo. Se o Chrome estiver aberto, saia pelo menu **⋮ → Sair**
e clique em **OK** na mensagem. Você pode usar **Cancelar** para abrir o
jogo com a versão atual. Sem conexão, o aplicativo usa a versão que já
estiver instalada. Cada atualização guarda uma cópia da pasta anterior
ao lado da pasta da extensão em um diretório `.pokesniper-backup-*`.

## Recuperar a pasta da extensão

Se a pasta cadastrada sumiu, abra o **PokeSniper.exe** baixado nesta página.
Escolha **Sim** para baixar a extensão no mesmo caminho ou **Não** se já
moveu a extensão para outra pasta. Após restaurar, clique em **Recarregar**
em `chrome://extensions` se o Chrome mostrar um erro no PokeSniper. As
configurações e o banco local ficam no perfil do Chrome. Restaurar o caminho
permite reutilizar os dados que ainda estão nesse perfil.

## Compilar

O projeto requer Go 1.23 ou mais recente. Na pasta `launcher-windows`, rode
`go test ./...`. Os comandos abaixo compilam o executável com o ícone.

```powershell
go run github.com/akavel/rsrc@v0.10.2 -arch amd64 -ico assets/desktop.ico -o rsrc_windows_amd64.syso
go build -trimpath -ldflags="-H windowsgui -s -w" -o ../PokeSniper.exe .
go build -trimpath -ldflags="-H windowsgui -s -w -X main.browserEdition=brave" -o '../../PokeSniper V2_Brave/PokeSniper-Brave.exe' .
```

As duas edições usam a mesma extensão. Ao preparar uma versão, copie o
conteúdo de `PokeSniper V2_Chrome/extensao` para `PokeSniper V2_Brave/extensao`.
