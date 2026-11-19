# PokeIdle Market Sniper (v1.5.4.24)

## Monitoramento, histórico e testes

Em **Pokémon**, ative **REGISTRAR MERCADO** e mantenha a aba do PokéIdle
conectada. A coleta busca anúncios recentes de Coins e Gemas na mesma fila.
Coins mantém o censo completo. Gemas percorre as outras páginas sem inferir
vendas ou ausências. A extensão também consulta o histórico oficial de Coins.
O cursor só avança depois da gravação confirmada de todas as páginas.

Os alertas esperam a liberação do anúncio e conferem a revisão atual do preço.
Ofertas com poucos comparáveis próximos ficam disponíveis para análise.
O desconto usa a mediana estimada e a liquidez continua separada. A notificação
indica atributos com IV menor que 10, incluindo zero.

Em **Diagnóstico da versão**, **Testar avisos e gerar relatório** verifica os
canais e mostra os recibos da coleta. **Testar precisão com vendas locais**
divide o histórico por data e mede erro de preço, cobertura e falsos alertas
simulados. O resultado pode ser copiado pelo botão **Copiar resultado**.

O envio automático ao Google Sheets começa desligado. A opção e o link para o
destino ficam no painel **Pokémon**. A implantação atual do Apps Script pode continuar.


## Históricos separados de Gemas e Coins (v1.5.4.23)

Em Gemas, a extensão consulta a base pública do Briaoale ao iniciar e verifica
uma atualização por hora. O snapshot fica em cache local separado do histórico
do Sniper, pois a base pública não traz IDs que permitam deduplicar vendas entre
as duas fontes. A análise identifica a origem e a hora do snapshot. O Sniper
mantém a exclusão de Outlaws.

Em Coins, abrir uma vitrine filtrada por uma espécie, analisar um anúncio ou usar
**Atualizar vendas em Coins** solicita à aba do jogo o histórico daquela espécie.
A busca respeita a fila de mercado e o recuo do servidor, tem intervalo de pelo
menos cinco segundos entre páginas e aguarda dez minutos antes de repetir a
mesma espécie. As vendas são conciliadas pela moeda e pelo ID da transação.

Em **Diagnóstico da versão → Copiar cache de Coins do Smart Market**, o Sniper lê
em modo somente leitura o cache que o Smart Market salva na própria origem do
PokéIdle. É necessário que o cache exista no mesmo perfil do navegador. Também
é possível importar uma lista JSON de outro perfil. As duas opções aceitam
apenas Coins e dão prioridade à ficha já capturada pelo Sniper no jogo.

## Sprite e preço nos avisos (v1.5.4.22)

O painel e os avisos exibem desconto, preço anunciado e faixa justa estimada.
Os valores de Coins aparecem em milhões. Gemas continuam em unidades.
A notificação usa a sprite recebida na ficha do anúncio, quando disponível.
Se vier apenas uma referência à Pokédex, pode usar a sprite padrão da espécie.
No Chrome, o ícone fixo serve de fallback quando a imagem está indisponível.

## Motor de PvE do Briaoale (v1.5.4.21)

O preço usa o motor publicado pelo Briaoale sob licença MIT, sobre as vendas
capturadas pelo Sniper. As moedas, Shiny e combinações de especiais ficam em
grupos separados. A adaptação usa os IVs no poder PvE e não aplica uma correção
separada por IV. Quando faltar ficha ou amostra suficiente, a análise indica
**referência básica**. Nenhum histórico externo é baixado pela extensão.

Em **Diagnóstico da versão**, o teste PvE usa fichas sintéticas para conferir
que o novo motor está carregado. Os avisos de IV baixo serão tratados em outra
etapa.

## Monitoramento automático (v1.5.4.19)

Com a aba do PokéIdle conectada e o rastreador de Pokémon ativo, o censo de Coins
alimenta os avisos sem precisar abrir a vitrine ou ligar compras. O diagnóstico
inclui o estado do censo e o recibo da última página automática. Ofertas expiradas
ou ausentes após a confirmação do censo saem das oportunidades.

## Filtro por desconto (v1.5.4.17)

O painel usa o desconto mínimo sobre a mediana. Anúncios dentro da faixa estimada podem
aparecer se atingirem o percentual. A configuração antiga de preço máximo foi retirada.
A margem de revenda opcional continua disponível em **Filtros e notificações**.

## Diagnóstico em um clique (v1.5.4.16)

Com o jogo aberto, use **Diagnóstico da versão → Testar avisos e gerar relatório → Copiar resultado**.
O diagnóstico dispara um aviso de teste em cada canal e registra os resultados da mesma execução.

## Avisos e diagnóstico da Tabela de preços (v1.5.4.14)

O aviso visual pode aparecer no próprio PokéIdle e nas notificações do sistema via Chrome.
Em **Filtros e notificações**, os dois botões de teste permitem conferir os canais separadamente.
O teste no jogo usa a última aba do PokéIdle observada pela extensão.

Se a quantidade de vendas não mudar, abra **Tabela de preços → Pokémon**, avance algumas
páginas e rode **Diagnóstico da versão**. O campo `histórico_na_sessão` mostra as páginas
observadas, quantas linhas tinham ficha e quantas vendas foram novas, repetidas ou enriqueceram
a ficha. Ele contém apenas metadados e contagens e mantém os últimos 40 eventos da sessão.

## Análise pelo nome e diagnóstico (v1.5.4.13)

No ícone do PokeSniper, abra **Analisar Pokémon**. Busque pelo nome ou escolha um anúncio
recente. Se a busca estiver vazia, abra primeiro a vitrine do jogo e filtre a espécie desejada.

Para validar a instalação, abra **Tabela de preços → Pokémon** e a vitrine. Em seguida, no
ícone da extensão, use **Diagnóstico da versão → Rodar diagnóstico → Copiar resultado**. O
relatório contém os resultados de testes sintéticos, contagens da fila e cobertura de campos
no histórico local. O diagnóstico não grava registros de teste, não consulta o jogo e não
inclui nomes de jogadores nem informações de anúncios individuais.

## Precificação por atributos e liquidez (v1.5.4.12)

Abra o ícone do PokeSniper no Chrome para ver **Oportunidades**. Em **Analisar Pokémon**,
é possível consultar um anúncio já visto, inclusive fora dos filtros de alerta. Em **Comparáveis e
simulação de revenda**, altere o nível e o preço de saída separadamente. O desconto continua
referente ao anúncio original. Liquidez não integra o preço nem o disparo.

O histórico é alimentado pelas páginas da vitrine e da **Tabela de preços → Pokémon** que chegam
ao cliente. A atualização não faz novas consultas. A ficha de venda preserva atributos recebidos
junto da própria transação. Dados ausentes aparecem como desconhecidos.

O modelo detalhado testa previsões em um bloco cronologicamente posterior e usa a referência
básica quando o perfil não está validado. Para liquidez, somente uma venda vinculada por identidade
explícita da oferta, exemplar, moeda, preço e tempo entra como desfecho confirmado. Os demais
vínculos são diagnósticos. Sem observações completas ou vendas vinculadas suficientes, o painel
exibe a atividade observada, sem porcentagem. A coleta de exposições de anúncio começa nesta versão.

Em **Filtros e notificações**, a margem de revenda opcional usa a taxa e os custos informados na
moeda selecionada. O índice de liquidez continua separado. Apps Script não precisa ser reimplantado.

Teste local dos cálculos: `node --test tests/*.test.cjs`.



Extensão Chrome (Manifest V3) para o jogo **pokeidle.io**. Varre o mercado de pedras, calcula para cada pedra um preço de referência (a **mediana** dos anúncios) e **compra automaticamente** os anúncios que estiverem no desconto escolhido ou abaixo, respeitando um saldo máximo de gasto.

> Este documento descreve *exatamente* o que o código faz, para que outra IA (ou pessoa) consiga alterá-lo sem quebrar nada. Leia as seções 6, 11 e 12 antes de mexer.

> Aviso: automatizar compras pode contrariar as regras do jogo. O uso é por conta e risco de quem usa.

---

## 1. Arquivos

| Arquivo | Função |
|---|---|
| `manifest.json` | Declara o content script. Roda em `https://pokeidle.io/*` e `https://*.pokeidle.io/*`, em `document_start`, no **mundo MAIN** (`"world": "MAIN"`). |
| `sniper.js` | Todo o código (lógica + painel). Um único arquivo, sem dependências, sem build. |
| `README.md` | Este documento. |

Não existe background/service worker, popup, nem permissões extras. O script é injetado direto na página.

## 2. Instalação e uso

1. Chrome → `chrome://extensions` → ativar **Modo do desenvolvedor**.
2. **Carregar sem compactação** → escolher a pasta com os 3 arquivos.
3. Abrir (ou recarregar) o pokeidle.io e esperar o jogo carregar.
4. Um painel aparece no **canto inferior esquerdo** (título "Market sniper v1.2.0"; se o título mostrar outra versão, o script antigo ainda está carregado). Clicar no título abre/fecha.
5. Ajustar os campos e clicar **Ligar**.

Depois de editar `sniper.js`: em `chrome://extensions` recarregar a extensão **e** recarregar a aba do jogo (o script só é injetado no carregamento da página). A extensão lê a pasta onde foi instalada; arquivos baixados para outra pasta não têm efeito.

**Simulação**: a caixa "Simulação (não compra)" faz o bot só registrar o que compraria. **A cada carregamento da página ela volta marcada** (o script força `dryRun: true` no `localStorage`). Para comprar de verdade é preciso desmarcar e confirmar o aviso, e depois clicar em Ligar. Desmarcar a caixa não liga o bot.

## 3. Painel

Campos editáveis (numéricos, salvos em `localStorage`):

| Campo | Chave | Padrão | Significado |
|---|---|---|---|
| Desconto mínimo (%) | `discountPct` | 20 | Compra se `preço <= mediana × (1 − desconto/100)`. |
| Saldo para compras (milhões de gold) | `saldoM` | 1 | **Teto total de gasto da sessão**, em milhões: `2` = 2.000.000, `0.5` = 500.000. Convertido por `orcamento(c) = round(saldoM × 1e6)`. |
| Intervalo da varredura (s, mínimo 10) | `scanSec` | 20 | Pausa entre varreduras completas. O código usa `max(10, scanSec)` com jitter de ±20%; valores menores que 10 valem 10. |

Caixa "Simulação (não compra)" → `dryRun`.

### Área de informação e log

Logo abaixo dos campos:

- **Info** (2 linhas): `gold <saldo do jogo> | gasto na sessão: <gasto> de <saldo para compras>` (com "(simulado)" em simulação) e o resumo da última varredura (`Última varredura HH:MM:SS: N pedras analisadas, M oportunidades[, K com poucos anúncios]`).
- **Log** (até 200 linhas, a mais nova em cima), com formato legível e colorido:
  - `Identifiquei <Pedra> com X% de desconto: N unidades a <preço> cada` (uma vez por anúncio; acrescenta `(retido, aguardando liberar)` se ainda não dá para comprar);
  - em seguida, uma destas:
    - `Comprando <Pedra> com X% de desconto: N unidades por <total>` → depois `Compra confirmada: N <Pedra>, pagou <total>` ou `Compra de <Pedra> não confirmada (...) (k/maxFails)`;
    - `Simulação: compraria N <Pedra> por <total> (X% de desconto)`;
    - `Não tive saldo para comprar <Pedra>: a unidade custa <preço> e restam <resto> do saldo`;
    - `Não tive gold para comprar <Pedra>: ...` (saldo do próprio jogo insuficiente);
  - mensagens de ciclo de vida: `Ligado em SIMULAÇÃO` / `Ligado com COMPRAS REAIS`, `PARADO: <motivo>`, `Erro: ...`.
- **Cores**: valores em gold **amarelo** (`COR.gold`), quantidades **roxo** (`COR.qty`), nome de cada pedra **com cor própria e sublinhado** (mapa `COR_PEDRA` pela primeira palavra do nome, ex.: Fire laranja, Water azul, Leaf verde, Ice ciano, Earth marrom, Heart rosa...; pedra sem entrada no mapa ganha uma cor derivada do nome por hash).
- **Abreviação de valores** (`abrev`): `49`, `1,5k`, `70k`, `89,9k`, `700k`, `1 mi`, `1,9 mi`, `7 mi`, `10 bi` (vírgula decimal, 1 casa). As quantidades usam separador de milhar (`1.500`).
- Uma linha do log é uma lista de pedaços `{s, k}` (`k` = `gold` | `qty` | `stone`). Os helpers `P(nome)`, `G(gold)`, `Q(qtd)` e a tag `L\`...\`` montam essas listas. Detalhes técnicos **não** vão para o painel: ficam só no console (F12), com prefixo `[PIS]`.

O painel bloqueia `keydown/keyup/keypress` para que digitar nos campos não dispare atalhos do jogo.

### Constantes fixas (sem campo no painel)

Ficam no objeto `FIXO` no topo de `sniper.js`; só mudam editando o arquivo:

| Constante | Valor | Significado |
|---|---|---|
| `amostraMax` | 100 | Quantos anúncios (os mais novos) entram na mediana. |
| `minAnuncios` | 10 | Pedra com menos anúncios abertos que isso é ignorada ("poucos anúncios"). |
| `maxQtdPerBuy` | 50 | Máximo de unidades por compra. |
| `maxFails` | 3 | Para o bot após N compras sem confirmação **ou** N erros seguidos. |
| `sorteioUi` | 1 | Valor enviado em `market.comprar` (observado nas compras manuais; significado desconhecido). |
| `categorias` | `'stone'` | Categorias varridas (vírgula). |
| `itemIds` | `''` | Vazio = todos; ex.: `'49,76'` restringe. |
| `meuNome` | `'Infirm4'` | Nick do jogador; anúncios dele nunca são comprados. |
| `excluir` | `['rock stone','ground stone','cocoon stone','metal stone']` | Pedras que nunca são varridas (nome em minúsculas). |

**Pedras excluídas**: o `market.itens` não traz o nome. Na primeira varredura de cada sessão o bot faz uma consulta `market.item` a cada pedra, lê `ficha.nome` e, se o nome *começar com* um item de `excluir` (sem diferenciar maiúsculas), guarda o `itemId` em `st.excl` e **não consulta mais essa pedra** até recarregar a página. O console mostra `pedra excluída, não será mais consultada: ...`. Se o nome real do jogo for diferente do esperado, a pedra continuará sendo varrida (aparecerá no log); ajustar `excluir`.

## 4. Como o script conversa com o jogo

O jogo usa um WebSocket próprio. O script **não abre conexão nova**: reaproveita a do jogo.

1. `window.WebSocket` é substituído por um `Proxy` que, a cada `new WebSocket(...)`, anexa um listener de `message` (`attach`). `WebSocket.prototype.send` também é interceptado para anexar o listener a sockets criados antes do Proxy.
2. `onMsg` só processa mensagens de texto que começam com `{"t":"estado"` ou `{"t":"market"`.
   - Em `estado`: guarda o socket em `st.sock` (esse é o socket usado para tudo), calcula o desvio de relógio `st.off = servidorAgora − Date.now()` e atualiza `st.gold`.
   - Mensagens `market` são entregues a quem estiver esperando (`waiters`).
3. `ask(msg, pred, ms=6000)` envia `msg` com o `send` **original** e devolve uma Promise resolvida com a primeira mensagem para a qual `pred` retorna `true`. Rejeita se o socket não existe/está fechado ou se passar `ms` sem resposta.
4. **Espião (só console)**: o `send` interceptado registra no console (`[PIS] jogo enviou: ...`) as mensagens de mercado que **o próprio jogo** envia (ex.: ao abrir uma pedra ou rolar a lista). Os envios do bot não passam por ele (usam `osend.call`). Serve para descobrir como o jogo pagina/ordena `market.item` (ver seção 12).

O bot só pode ligar depois que uma mensagem `estado` chegou (senão loga "Socket do jogo ainda não detectado").

### Mensagens usadas

| Direção | Mensagem | Campos usados |
|---|---|---|
| → | `{t:'market.itens', elementos:[], categoria}` | — |
| ← | `{t:'market', aba:'itens', resumo:{[itemId]:{minGold,...}}}` | `resumo[id].minGold` (só para saber se a pedra tem anúncio) |
| → | `{t:'market.item', itemId, moeda:'gold'}` | — |
| ← | `{t:'market', aba:'item', itemId, moeda:'gold', linhas:[...]}` | por anúncio: `id`, `estado`, `comprador`, `vendedor`, `preco`, `qtd`, `compravelEm`, `ficha.nome` (+ campo de data só se houver > `amostraMax` linhas) |
| → | `{t:'market.historicoCompras', pagina:0, seq}` | `seq` incrementa a partir de 1000 |
| ← | `{t:'market', aba:'historicoCompras', total, linhas:[{bruto, descricao}]}` | `total`, `linhas[].bruto` |
| → | `{t:'market.comprar', id, qtd, preco, moeda:'gold', sorteioUi}` | `id` = id do anúncio |
| ← | `{t:'estado', estado:{gold, servidorAgora}}` | `gold`, `servidorAgora` |

Não há resposta direta de `market.comprar` que o script leia; o sucesso é **confirmado pelo histórico de compras** (seção 7).

**Observado em execução real** sobre `market.item`: a resposta tem só as chaves `[t, aba, itemId, moeda, linhas]` (nenhuma informação de página/total), traz **no máximo 60 anúncios** e eles vêm **em ordem crescente de preço** (ex.: um item voltou com 60 anúncios de 95.499 a 98.156, com datas de criação espalhadas de 13/11 a 17/11; outro voltou com 45 anúncios de 5.000 a 10.000.000.000). A tela do jogo mostra de ~560 a ~3.000 anúncios por pedra. Conclusão: o jogo entrega as **60 mais baratas**, não as mais recentes. Campos de cada anúncio observados: `id, expiraEm, dias, vendedor, vendedorId, tipo, itemId, pokemonId, qtd, ficha, preco, moeda, estado, criadoEm, compravelEm, comprador` (a lista foi cortada na captura; pode haver mais).

## 5. Fluxo geral

```
Ligar → loop():
  repete enquanto st.running:
     scan(c)  ── para cada categoria:
                   market.itens → itens que têm anúncio (menos os já excluídos)
                   para cada item:  tryItem(id)  (+ pausa de 600 ms)
                                      ├─ market.item → anúncios
                                      ├─ exclui a pedra se o nome estiver em `excluir`
                                      ├─ mediana + limite (seção 6)
                                      └─ para cada anúncio no limite: log "Identifiquei..." e buy()
     dorme scanSec × (0,8 a 1,2) s   (mínimo 10 s)
```

`loop()` guarda um `loopId`; se o bot for parado e religado, o loop antigo morre sozinho. Qualquer exceção em `scan` conta como erro (`st.errs`); `maxFails` erros seguidos param o bot. Uma varredura sem exceção zera o contador.

## 6. Regra de compra (o coração do bot)

Executada em `tryItem(id, c)` para **cada pedra** que tenha pelo menos um anúncio e não esteja excluída.

1. **Anúncios considerados**: `estado === 'aberto'` e sem `comprador` (os que o jogo devolveu em `linhas`).
2. **Pedra excluída?** Se `ficha.nome` começa com um item de `excluir`, a pedra é descartada para sempre (na sessão).
3. **Tamanho mínimo**: menos de `minAnuncios` (10) anúncios abertos → pedra "com poucos anúncios", nada é comprado nela.
4. **Amostra**: até `amostraMax` (100) anúncios. Se o jogo devolver mais que 100, usa os 100 **mais novos** (ordenados por um campo de data detectado em `campoData`, ver seção 12); se devolver 100 ou menos (caso atual, ≤ 60), usa todos e **não precisa de campo de data**.
5. **Mediana**: `mediana = mediana dos preco` da amostra, **um valor por anúncio**, sem ponderar pela quantidade (um anúncio de 87 unidades a 100k conta como **1** ponto). Número par de anúncios → média dos dois do meio.
6. **Limite**: `limite = floor(mediana × (1 − discountPct/100))`.
7. **Quais anúncios entram** (de todos os abertos devolvidos, não só da amostra):
   - `preco <= limite`;
   - não é do `meuNome`;
   - não foi tentado nos últimos 60 s (`st.skip[l.id]`, só marcado em compra real).
   Ordenados do **mais barato para o mais caro**.
8. Para cada um: calcula `pct = round((1 − preco/mediana) × 100)`; loga `Identifiquei ...` **uma vez por anúncio** (`st.seen['i'+id]`). Se o anúncio está **retido** (`compravelEm` no futuro: `servidorAgora < compravelEm + 1500 ms`) só avisa "(retido, aguardando liberar)" e volta a olhar na próxima varredura (anúncio barato continua entre os mais baratos, então será pego quando liberar). Se não está retido, chama `buy()`.

**Exemplo** (desconto 10%): mediana 95.000 → limite 85.500. Anúncios de 49 gold, 80.000 e 89.000 → compra os de 49 e 80.000; o de 89.000 não.

## 7. Compra, saldo e confirmação (`buy`)

Antes de comprar:

- `restante = orcamento(c) − st.spent`. Se `restante < 1` → o bot **para** ("saldo para compras esgotado").
- Em compra real, se `st.gold` é desconhecido → não compra.
- `qtd = min(l.qtd, maxQtdPerBuy, floor(restante / preco), floor(st.gold / preco))` (o último só em compra real).
- Se `qtd < 1`: loga "Não tive saldo..." (ou "Não tive gold...") **uma vez por anúncio** e segue.

**Modo simulação** (`dryRun`): loga `Simulação: compraria ...` uma vez por anúncio (`st.seen[id]`), **soma o custo em `st.spent`** (a simulação consome o saldo, para refletir o que aconteceria) e não envia nada. Trocar a caixa de simulação zera `st.spent` e `st.seen`.

**Modo real**:
1. `st.skip[l.id] = agora` (nunca insiste no mesmo anúncio em loop).
2. Pede `historicoCompras` e guarda `before.total`. Sem histórico, não compra (não teria como confirmar).
3. Envia `market.comprar` com `id, qtd, preco, moeda:'gold', sorteioUi` e loga `Comprando ...`.
4. Até 2 tentativas, a cada 2,5 s: pede o histórico de novo; se `total` aumentou → **confirmada**.
5. Confirmada: gasto real = soma de `bruto` das novas linhas do histórico (se vier 0, usa `qtd × preco`); soma em `st.spent`; zera `st.fails`. Se o saldo acabou, para.
6. Não confirmada: `st.fails++`; ao chegar em `maxFails` o bot para. **Compras não confirmadas não entram em `st.spent`.**

### Saldo para compras / "reiniciar"

`st.spent` vive só em memória. **Zera** ao clicar **Ligar** (nova sessão com o saldo cheio) e ao recarregar a página. Não é persistido. Ao esgotar o saldo, o bot para sozinho. Alterar o campo durante a execução vale a partir da próxima varredura.

## 8. Persistência

Só a configuração do painel: `localStorage['pis_cfg_v2']` (`dryRun`, `discountPct`, `saldoM`, `scanSec`). `cfg()` mescla `DEF` ← valores salvos ← `FIXO` (as constantes fixas nunca são sobrescritas pelo salvo). Ao carregar o script, `dryRun` é regravado como `true`.

## 9. Estado em memória (`st`)

`running`, `loopId`, `sock` (socket do jogo), `gold`, `off` (desvio do relógio do servidor), `fails` (compras sem confirmação seguidas), `errs` (erros seguidos), `seq` (contador do histórico), `skip` (anúncios já tentados, com horário), `seen` (anúncios já identificados/simulados/avisados: chaves `'i'+id`, `id`, `'s'+id`), `log` (linhas do painel), `lastScan`, `spent` (gasto da sessão), `excl` (Set de itemIds excluídos), `diagN` (diagnósticos já impressos no console).

## 10. Mapa do código (`sniper.js`)

| Trecho | Papel |
|---|---|
| `DEF`, `FIXO`, `CAMPOS_DATA`, `FIELDS`, `COR`, `COR_PEDRA` | Configuração e cores. |
| `cfg()`, `save()`, `orcamento()` | Lê config (DEF ← salvo ← FIXO), grava uma chave, converte milhões em gold. |
| `abrev()`, `fmt()`, `medianaDe()` | Formatação (70k, 7 mi) e mediana. |
| `tsVal()`, `campoData()` | Escolha do campo de data (só usado com > 100 anúncios). |
| `P`, `G`, `Q`, `L`, `entryEl()`, `log()`, `dbg()` | Log colorido do painel e log técnico do console. |
| `Proxy` de `WebSocket`, `attach`, `onMsg`, `ask`, `hist`, espião no `send` | Camada de rede (seção 4). |
| `scan(c)` | Varre categorias/itens e monta o resumo `lastScan`. |
| `tryItem(id, c)` | Regra de compra (seção 6). |
| `buy(l, cand, c)` | Saldo, simulação, envio e confirmação (seção 7). |
| `loop()`, `start()`, `stop()` | Ciclo de vida. `start()` zera `spent` e `seen`. |
| `buildUI()`, `render()`, `h()` | Painel. |

## 11. Invariantes: não quebrar ao alterar

- **Sempre em simulação ao carregar** e **sempre desligado**. Não inverter.
- O envio de `market.comprar` só acontece depois de: ter histórico (`before`), ter saldo (`restante`, `st.gold`) e `st.running === true`.
- Todo gasto confirmado passa por `st.spent`; o teto `saldoM` precisa continuar sendo respeitado em **todo** caminho de compra.
- Nunca reenviar compra do mesmo anúncio em loop (`st.skip`, 60 s).
- O bot **para** em: saldo esgotado, `maxFails` compras sem confirmação, `maxFails` erros seguidos, clique em Parar.
- Usar o `send` **original** (`osend.call`) para os envios do bot, para não passar pelo hook de `send`.
- O script precisa rodar no mundo MAIN e em `document_start` (senão o Proxy do WebSocket chega depois que o jogo já abriu a conexão).
- Manter `if (window.__pis) return;` para não injetar duas vezes.
- Texto vindo do jogo (nome da pedra etc.) só entra no painel via `textContent` (nunca `innerHTML`).

## 12. Premissas e limitações (checar se algo parecer errado)

1. **"Últimos 100 anúncios" ainda não é possível de verdade.** O jogo só entrega as 60 mais baratas de cada pedra (seção 4). Hoje a mediana é calculada sobre esses ≤ 60 anúncios, que são o **piso do mercado**, não uma amostra dos 100 mais recentes. Efeito: a mediana fica mais baixa que a do mercado inteiro e o bot só compra anúncios claramente fora do padrão do piso (ex.: um anúncio de 49 gold no meio de preços de ~90k). Para chegar aos 100 mais recentes é preciso descobrir se o `market.item` aceita paginação/ordenação: o espião do console mostra as mensagens que o jogo envia ao abrir uma pedra e ao rolar a lista (abrir o console com F12 e filtrar por `PIS`). O código já está preparado: se vierem mais de 100 linhas, usa as 100 mais novas pelo campo de data.
2. **Campo de data**: só é necessário quando há mais de `amostraMax` linhas. Candidatos em `CAMPOS_DATA` (o primeiro presente em todos os anúncios; `compravelEm` e `id` são último recurso). Em execução real o anúncio tem `criadoEm`.
3. **Referência alternativa disponível**: `market.itens` devolve `medias[id].gold.media` e `.unidades` (preço médio vendido em 7 dias, o mesmo que o jogo mostra no modal), que cobre o mercado inteiro e não só as 60 mais baratas. Não é usado desde a v1.1.
4. **Anúncios retidos** (contador "Retido 0:16" na tela): não podem ser comprados; são identificados e comprados quando liberados (continuam entre os mais baratos).
5. **Mediana por anúncio**: o mesmo vendedor com vários anúncios conta várias vezes (não há deduplicação por vendedor).
6. **Volume de requisições**: cada varredura consulta `market.item` de todas as pedras com anúncio (menos as excluídas), com 600 ms entre elas. Se levar mais que `scanSec`, o próximo ciclo só começa depois.
7. Nomes das pedras excluídas dependem de `ficha.nome` ser em inglês no formato "Rock Stone" (observado em "Fire Stone").

## 13. Histórico de mudanças

**v1.2.0**
- Referência de preço = **mediana** dos preços (um voto por anúncio, independente da quantidade), até 100 anúncios; compra todo anúncio com preço ≤ mediana × (1 − desconto). Substitui a regra "ignorar os 3 mais novos + média de 10 vendedores".
- Pedras **Rock, Ground, Cocoon e Metal** excluídas da varredura.
- Log do painel reescrito: "Identifiquei ... / Comprando ... / Não tive saldo ...", valores abreviados (70k, 7 mi), valor em amarelo, quantidade em roxo, nome da pedra colorido e sublinhado. Diagnósticos técnicos movidos para o console.
- Info do painel com valores abreviados e resumo curto da varredura.
- Espião no console das mensagens de mercado enviadas pelo jogo.
- A simulação volta a ser forçada a cada carregamento da página.

**v1.1.1** — diagnóstico ampliado no log (3 primeiros itens).

**v1.1.0** — referência = média de 10 vendedores a partir do 4º anúncio mais novo; painel reduzido (desconto, saldo em milhões, intervalo); saldo único por sessão; `meuNome` e demais opções viraram constantes.

**v1.0.0** — compra de anúncios abaixo da média de 7 dias (`medias[id].gold.media`) com tetos por compra, hora e dia e saldo de reserva.
