# PokeSniper para Windows

Extraia o ZIP e execute **PokeSniper.exe**. O aplicativo cria o atalho
**PokeSniper** na Área de Trabalho e abre o Chrome em **pokeidle.io**.

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

## Compilar

O projeto requer Go 1.23 ou mais recente. Dentro desta pasta, rode
`go test ./...`. Para embutir a arte no executável e compilar no Windows x64:

```powershell
go run github.com/akavel/rsrc@v0.10.2 -arch amd64 -ico assets/desktop.ico -o rsrc_windows_amd64.syso
go build -trimpath -ldflags="-H windowsgui -s -w" -o PokeSniper.exe .
```
