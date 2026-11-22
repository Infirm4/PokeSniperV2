# PokeIdle Market Sniper (v1.5.4.95)

O [launcher para Windows](../README.md) cria um atalho na
área de trabalho, atualiza a extensão e abre o PokéIdle no Chrome.

O Chrome carrega o monitor, parser e coletor em um único arquivo na aba do
jogo. Os módulos ficam dentro do monitor, sem depender de globais da página.
O relatório inclui **versão_na_aba** e a disponibilidade dos dois módulos.

Em **Coins**, a escala da Nota se adapta ao suporte do histórico. Especiais
diferentes pesam menos e extras que faltam no alvo não sustentam alertas.
A Qualidade aparece no aviso. O BEPI em Coins é aplicado
automaticamente às oportunidades elegíveis.
No BEPI, a oferta deve ficar abaixo do quartil inferior e superar em cinco
pontos percentuais o desconto configurado. A porcentagem é sempre relativa
à mediana. O teste de precisão compara as escalas de Nota e a variante com
Qualidade no mesmo corte cronológico das vendas locais.

Para regenerar o arquivo do monitor depois de editar seus módulos ou
`sniper.js`, use `node scripts/build-market-main.cjs`.


O topo do painel mostra **Ligar avisos** ou **Desligar avisos**, com o estado
atual ao lado. A mudança vale imediatamente. **Salvar filtros** grava a
moeda, o desconto mínimo e a Nota mínima do Pokémon anunciado. O corte de
Nota pode ir de `3,50` a `10,00` e vale para Coins e Gemas. Deixe vazio ou
informe `0` para desativar o corte. Na digitação sem separador, `375` vira
`3,75`. O campo mantém até duas casas decimais ao sair ou salvar.


O parser do mercado é carregado no navegador mesmo quando a página expõe
um objeto de módulos JavaScript. O relatório mostra se o parser e o coletor
do histórico estão disponíveis e identifica falhas de resposta ou gravação.

O banco aceita novos campos opcionais de perfil, como natureza, raridade,
Shadow, atributos, refino e poder, quando a resposta do servidor os contém.
Vendas anteriores são preservadas. A moeda e a transação identificam a venda.
O identificador do exemplar impede que revendas dominem a referência.

A precificação de Coins pondera a semelhança de Nota, nível e Potência,
os atributos comparáveis e a recência. Usa quartis ponderados e filtra
extremos no cálculo. Os avisos exigem suporte de vendas confirmadas pelo jogo.
O ajuste de IV usa o mesmo critério de ataque dominante de Gemas. Em Coins,
o prêmio é estimado a partir de vendas parecidas da espécie, com peso
reduzido para amostras pequenas e limite de ±15% no preço de referência.
Quando não há evidência comparável, o preço segue a referência original e
o alerta continua elegível pelos critérios habituais. O alerta normal exige
pelo menos três comparáveis próximos de exemplares diferentes, com amostra efetiva e
dispersão de preços aceitáveis.

**Gerar relatório do mercado** consulta o estado e os registros de avisos reais.
Os testes locais continuam disponíveis no relatório sem enviar notificações.

Para validar no jogo, ligue os avisos, salve **Coins** com desconto mínimo
de 5% e deixe o PokéIdle conectado com o Mercado fechado. Depois de alguns
minutos, selecione **Diagnóstico da versão → Gerar relatório do mercado**.
Confira histórico gravado e **alertas → coins**. Abra a vitrine, pesquise uma
espécie e confirme que a paginação permanece sob seu controle.

O monitor prioriza as duas primeiras páginas de anúncios recentes na moeda
selecionada. O intervalo entre envios começa em 2 segundos, com fila
compartilhada e recuo do servidor. Em **Todas**, alterna Coins e Gemas.
Com a vitrine aberta, pausa as consultas que podem redesenhá-la.
A leitura do histórico e dos anúncios visitados continua alimentando o banco.
Anúncios retidos com desconto podem aparecer antes da liberação, com o horário
de compra. A chegada de um aviso depende da resposta do jogo e dos comparáveis.


Os filtros **Somente espécies** e **Bloquear espécies** foram removidos.
Configurações antigas desses campos são ignoradas. O diagnóstico de tráfego
mostra contagens por formato das mensagens não reconhecidas, sem conteúdo.


O monitor espera um sinal de atividade do jogo antes de enviar consultas por
uma conexão recém-aberta. O diagnóstico inclui contagens de mensagens, sem
gravar o conteúdo delas. Um timeout recuperável da vitrine usa retentativa
local, enquanto o recuo global permanece reservado para avisos explícitos de
limite do servidor.

Para conferir a coleta, rode **Testar avisos e gerar relatório** depois de
deixar o jogo conectado por alguns minutos com o Mercado fechado. Se o
diagnóstico continuar em `aguardando_tráfego`, abra a vitrine uma vez, veja
se os anúncios carregam normalmente, feche-a e repita o diagnóstico.


## Painel no PokéIdle

Use **Poke Sniper V2**, no canto inferior esquerdo do jogo. **Planilhas**
reúne a conexão e a sincronização do Sheets, **Filtros** reúne moeda,
desconto e o controle de avisos, e **Oportunidades** mostra os avisos dos
últimos 10 minutos ao selecionar a aba. Os filtros de lançamento Shiny e
Nota da evolução final aparecem indisponíveis porque ainda não há regras
para eles. O relatório do mercado está em **Filtros → Diagnóstico da versão**.

## Backup de vendas no Google Sheets

O painel antigo dentro do jogo está pausado. A aba **Planilhas** reúne a
seção **Planilha de vendas**. Na primeira abertura do menu, o Chrome inicia o envio das vendas já
armazenadas no IndexedDB. Ao abrir ou reabrir o PokéIdle, a extensão também
envia as vendas completas que ainda estão pendentes. Há uma sincronização
por hora com o Chrome aberto, inclusive com o PokéIdle fechado. Lotes continuam pendentes
até o Sheets confirmar. Uma migração reenfileira as vendas locais da versão
anterior para preencher o novo modelo.

Na planilha vinculada, use na **linha 3** os títulos da tabela de vendas.
O receptor prefere **Sheet** quando ela tem os títulos esperados. Se não
tiver, procura uma única aba com o modelo. Os dados vão da **linha 4** em
diante. As colunas existentes conservam sua posição. As categorias extras
são acrescentadas à direita e ocultadas na primeira gravação. A chave de
venda contém moeda e ID da transação. Quando **Sheet** recebe as vendas
confirmadas, a auditoria de anúncios continua na aba **eventos**.

Atualize o Apps Script com `google-apps-script.gs`. No editor, execute
`gerarChaveLeituraVendas` uma vez. Em **Configurações do projeto →
Propriedades do script**, copie o valor de `POKEIDLE_CHAVE_LEITURA_VENDAS`.
Em **Implantar → Gerenciar implantações**, edite a implantação existente e
publique uma **Nova versão**, mantendo a URL `/exec`. A planilha precisa
estar vinculada como antes.

Em cada perfil, abra **Planilhas → Conectar histórico compartilhado**
e use a mesma chave. O envio e a leitura sincronizam ao abrir o PokéIdle e
a cada hora, enquanto o Chrome está aberto. **Sincronizar com o Sheets agora**
faz os dois imediatamente. Históricos grandes são lidos em páginas, com
continuação automática. Guarde a chave com as pessoas que podem ler o banco.

Os dois PCs enviam para a mesma planilha. O receptor usa um bloqueio e a chave
**moeda + ID da transação** para atualizar a mesma linha, e os registros
importados do Sheets entram no IndexedDB sem voltar para a fila de envio.
O relatório de diagnóstico mostra a última sincronização em `backup_sheets`.

No editor do Apps Script, **diagnosticarLinhasForaDoBanco** mostra quantas
linhas da tabela não têm chave nem ficha de venda. **limparLinhasForaDoBanco**
limpa apenas os campos da tabela nessas linhas. Registros com chave ou ficha
inconsistente ficam para conferência. A função exige pelo menos uma venda
válida do IndexedDB na aba antes de gravar.

**Diagnóstico da versão → Ver uma venda do banco** mostra a venda mais
recente com moeda e Shiny registrados. A amostra é lida diretamente do
IndexedDB e fica no painel até você copiá-la.

## Fichas completas no histórico

O IndexedDB **sales** exige identidade da venda e do Pokémon, espécie, data,
moeda, preço, nome, nível, Nota, Potência, Qualidade, Shiny, os seis IVs, a
soma de IVs e uma sprite válida. São aceitos IVs zero. Para espécies base
identificadas, a sprite pode vir do catálogo. Os atributos opcionais continuam
sendo gravados quando a ficha histórica os traz.

A versão 1.5.4.41 reenfileira uma vez as vendas completas já armazenadas e
começa a enviá-las ao abrir o painel. O receptor mantém uma linha por moeda e
ID da venda. A extensão checa a ficha antes do POST e deixa pendente o lote
cuja gravação não foi confirmada.

A atualização retira de **sales** os registros incompletos e os separa na fila
local de recuperação. Eles ficam fora da precificação e dos novos envios ao
Sheets. O monitor refaz a coleta do histórico e consulta pendências por exemplar
na própria fila de mercado, conferindo a transação antes de completar. O
relatório mostra `vendas_pendentes_ficha_completa` e a contagem por lote.
O histórico já sincronizado no Sheets segue disponível na planilha.

## Cobertura e liquidez em Coins

Os caminhos normal e BEPI do estimador existente precedem os quatro
fallbacks. O novo cálculo tenta Nota mais distante, Potência adjacente com
fator medido, banda de nível ampliada com curva validada e linha evolutiva
com fator validado. As janelas são 14 dias, 30 dias e todo o histórico local.
O banco compartilhado entra pela sincronização já existente. Os fallbacks
são indicativos por padrão. Em **Filtros → Ligar Fallback**, é possível habilitar
avisos dos níveis 1 e 2. Eles exigem 10 pontos percentuais a mais no desconto
e preço abaixo do limite inferior da faixa.

O limite normal do código é `|ln(nível alvo / nível da venda)| ≤ 0,30`.
O nível 3 amplia o teto para uma razão de 1,50. A distância até a faixa
observada tem margem máxima de razão 1,20 nos fallbacks. Os ajustes são
aprendidos com pares de exemplares independentes e só entram quando
reduzem o erro mediano em pares mais recentes, fora do treino. Quando
existe uma referência anterior com suporte, ela recebe suavização com
`k = 5`.

A liquidez é uma projeção em horas baseada no ritmo das vendas dos últimos
14 dias e na fila ativa observada. A leitura da vitrine é parcial, por
isso a estimativa pode ser otimista. O selo e o aviso usam o resultado
somente para informação. O texto mostra apenas a classificação. Em Gemas,
usa vendas locais da mesma espécie, variante, Shiny e Potência. Sem pelo
menos cinco exemplares distintos no segmento, o selo é omitido.

Em **Filtros → Diagnóstico da versão → Analisar cobertura, preço e liquidez
de Coins**, use um nome ou ID de anúncio para selecionar o exemplo. O
relatório mostra fatores medidos e validados, data/hora das vendas usadas,
tentativas e pesos, cobertura antes e depois e o cálculo da oportunidade.
Se omitido, o exemplo é o anúncio observado mais recentemente.

## Faixa estimada na vitrine de Coins e Gemas

O selo em Coins fica na mesma linha do preço do jogo. O texto branco mostra
`≈500MI 20%` quando o anúncio custa 400 MI e `≈500MI 120%` quando custa
600 MI. O fundo é verde abaixo da referência e vermelho acima. Passe o
cursor sobre o selo para ver a faixa e a marca indicativa quando aplicável.
`Sem dados` indica que falta conferir o anúncio. `Sem estimativa` indica que
o anúncio foi lido e ainda não tem um preço de referência. O selo usa o histórico local e não exige avisos habilitados.

Em Gemas, o mesmo selo usa exclusivamente as estimativas do snapshot
público do Briaoale (`precos.json`), já sincronizado pela extensão. O selo
mostra `≈2,9K 💎 20%` ou `≈2,9K 💎 120%` e a faixa em Gemas ao passar o cursor.
Sem uma referência desse snapshot, aparece `Sem estimativa`. Os alertas
seguem suas próprias regras e preservam os fallbacks existentes.

Selos recentes são reaproveitados ao reabrir a vitrine ou voltar de página.
O anúncio é conferido em segundo plano, e mudanças de preço ou da fonte
pública de Gemas invalidam as referências em cache.

Com a vitrine fechada, o monitor intercala páginas de Coins e Gemas para
preparar selos em segundo plano. Ao abrir a vitrine, as consultas auxiliares
de preparação pausam. Os avisos
mostram o nome e o desconto no título. Nível, Potência e Nota ficam na
primeira linha do corpo. O preço anunciado e o preço justo aparecem abaixo. Nos avisos de Spe, Atk e Sp Atk,
IVs de 0 a 14 são marcados como `(crítico)`, de 15 a 24 como `(baixo)` e a partir de 25 como `(Pica)`.
HP, Defesa e Defesa Especial ficam disponíveis na ficha detalhada.

## Preço justo na mochila

Passe o mouse sobre um Pokémon próprio reconhecido na mochila. O selo mostra
a mediana em Coins com base nas vendas locais e em Gemas com base no snapshot
público do Briaoale. Fichas com poucos comparáveis podem ter preço indicativo
ou ficar sem estimativa. Os dados da ficha vêm do estado já recebido do jogo.

Ao abrir a ficha de um Pokémon próprio no Depósito ou na Coleção, o selo
aparece logo abaixo da barra da Nota para exemplares com Nota 3,500 ou maior.
O selo reaproveita a consulta da mochila e mostra «Consultando…» se a cotação
ainda estiver em andamento após o reconhecimento do exemplar. A ficha mostra
**Venda entre: (vender rápido, esperar)** nas moedas com faixa disponível. Os limites
são os quartis de 25% e 75% das vendas comparáveis ponderadas, com os ajustes
da cotação da ficha. São referências de preço, sem estimativa de prazo.

## Monitoramento e precificação

Com **Avisos dentro do jogo e no Chrome** ativo e o jogo conectado, o Sniper
acompanha a moeda selecionada pela conexão do jogo e sincroniza o histórico
de Coins. Os limites de consulta e o recuo do servidor continuam valendo.

- **Coins:** as transações confirmadas ficam separadas por moeda e ID de venda.
  O ID do exemplar ajuda a deduplicar os comparáveis. O cálculo considera
  espécie, forma, Shiny, nível, Nota, Potência e Natureza conforme
  os campos disponíveis, com menor peso para vendas mais antigas. Extremos são
  filtrados na avaliação. Histórico incompleto pode fornecer uma referência
  exploratória. Só referências com suporte suficiente podem gerar alertas.
- **Gemas:** a cópia pública JSON do Briaoale fica em armazenamento separado e
  é validada antes de substituir o último snapshot. O conversor aceita uma
  cotação informada em Coins por Gema. A cotação não entra no cálculo do desconto.
- **Avisos:** a porcentagem é calculada com a referência na moeda do anúncio.
  O painel e os selos de vitrine só exibem ofertas que passam pelo filtro.
  A sprite do jogo tem precedência. Para a forma base identificada, o fallback
  respeita a variante Shiny. No Chrome, o último fallback é um ícone neutro.

## Diagnóstico desta versão

Deixe o jogo conectado com o Mercado fechado, moeda **Todas**, desconto mínimo
**0%** e avisos ativos por cinco minutos. Execute **Testar avisos e gerar relatório**.
**Baixar diagnóstico (.json)** exporta o estado da coleta e até 100 eventos
agregados, sem nomes, IDs de vendas ou conteúdo bruto das respostas. O arquivo
pode ser enviado ao suporte manualmente. Em seguida, abra o Mercado e confira
se o selo e a sprite permanecem corretos quando a vitrine atualiza.

O teste local roda com `node --test tests/*.test.cjs`. O Apps Script mantém a
mesma implantação.


O monitor reconhece a conexão do PokéIdle quando ela abre ou quando o jogo
envia dados por uma conexão que já estava aberta. O diagnóstico mostra como
a conexão foi reconhecida. Se ela fechar, as consultas pendentes são encerradas
e o monitor aguarda outra conexão.


O monitor aceita respostas mesmo quando o campo de tipo muda de posição no
JSON. A correlação da vitrine usa página, moeda e sequência quando presentes.
Um aviso de limite precisa vir de um erro do jogo. A fila também conta o envio
das consultas que o jogo fez pela mesma conexão.

Em **Testar avisos e gerar relatório**, confira **últimas consultas** em
Coins, Gemas e histórico. O estado distingue envio, resposta, recusa, recuo
e ausência de resposta. `duração_ms` mostra o tempo do envio até a resposta.
A seção da última página confirma se houve gravação.


Com os avisos ligados e a aba do jogo conectada, a varredura automática de
**Adicionados recentemente** e **Mais baratos** usa a moeda configurada em
**Filtros**. As duas primeiras páginas de Recentes têm prioridade. A terceira
fica elegível a cada 30 segundos, se existir, e é lida depois de uma rodada
prioritária. Entre duas rodadas entra no máximo uma leitura secundária.
Com a vitrine aberta, a varredura de Recentes segue depois que a
conexão confirma que devolve o identificador da consulta. Até essa confirmação,
o Sniper lê as páginas que o jogador visita. Os avisos prontos são entregues
pela ordem de entrada na fila.

Uma queda de preço detectada em anúncio já conhecido também pode gerar aviso
pelos filtros de desconto e Nota mínima. O monitor aproveita a leitura de
**Mais baratos** com o Mercado fechado e as páginas visitadas na vitrine.
A redução só é conhecida quando o anúncio é lido de novo.

Em **Testar revisão de compra**, o jogo confirma que abriu a janela simulada
antes de a extensão trazer a aba à frente. **Simular confirmação** não envia
pedido. O diagnóstico de precisão adapta o corte em bases com poucos dias,
mantendo o treino anterior à janela de teste.


## Histórico automático de Coins e compra confirmada

Com o PokéIdle conectado, o Sniper verifica o histórico geral de Coins em
segundo plano. O ciclo verifica a cada minuto se precisa atualizar a janela
recente, normalmente atualizada a cada cinco minutos. Os lotes usam a fila
compartilhada de consultas e a coleta retroativa retoma de uma página já gravada. O
**Diagnóstico da versão** mostra a página e a data mais antiga alcançada. A
busca termina ao chegar ao fim das páginas disponíveis ou ao corte de 30 dias.

No jogo, clique em **Revisar compra** no aviso. No Chrome, clique na notificação
em Coins. O Sniper abre uma revisão com o preço integral. **Confirmar compra em
Coins** autoriza um pedido pelo preço exibido, dentro do saldo e do limite
configurado. Mantenha a compra automática do painel parada. O Sniper confere
novamente o ID, o exemplar, a moeda, o preço e a disponibilidade no jogo. A
confirmação de resultado usa o histórico e os eventos do servidor. Se o pedido
ficar incerto, confira o histórico do jogo.

Para testar a captura sem gastar, mantenha o mercado fechado por alguns minutos
e use **Testar avisos e gerar relatório**. **Testar revisão de compra** abre
uma simulação no jogo sem enviar pedido. Na revisão de uma oferta, **Cancelar**
fecha a janela. Os testes Node simulam aprovação, mudança de preço e reenvio
sem usar o servidor.


## Monitoramento, histórico e testes

A função **REGISTRAR MERCADO** em **Pokémon** mantém o censo local quando os
avisos estão desligados e o Mercado está fechado. Com os avisos ligados, a
fila dá prioridade à captura de anúncios novos. O histórico oficial de Coins
continua em ambos os modos. Seu cursor só avança após a confirmação de que as
páginas foram gravadas.

Os alertas conferem a revisão atual do preço. O desconto usa a mediana
estimada e a liquidez continua separada. A notificação indica atributos com
IV menor que 10, incluindo zero.

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

## Ajuste de IV de ataque em Gemas

A cotação baseada no histórico público usa o IV do ataque dominante (físico
ou especial), conforme o motor do BriaoAle. Para espécies de ataque equilibrado,
o motor combina os dois com maior peso no menor IV. Os filtros do histórico
continuam aplicados à cotação do PokeSniper.

Em **Diagnóstico da versão → Comparar ajuste de IV em Gemas**, é possível
informar o nome de um Pokémon da vitrine e comparar o preço justo, a faixa e
o desconto com e sem esse ajuste. O relatório inclui a referência do motor
do BriaoAle, na mesma ficha e data da base. Nenhum aviso é gerado pelo teste.

Nos avisos de Coins e Gemas, Spe e o ataque dominante são rotulados como
crítico abaixo de 15, média de 15 a 24 e Pica a partir de 25. Em espécies
equilibradas, o aviso mostra Atk e Sp Atk separadamente. A Velocidade não recebe um ajuste direto no preço.

No relatório do mercado, `banco.vendas_sem_sprite` separa Outlaws identificados
de fichas sem indício de Outlaw, distinguindo se o nome estava disponível.
`histórico_na_sessão` mostra `outlawsIgnorados` por lote. Novas vendas Outlaw
ficam fora das fichas locais e da fila de envio ao Sheets. Fichas com espécie e atributos
completos podem sustentar a cotação enquanto aguardam a recuperação da sprite.
Só fichas com sprite válida entram na fila do Sheets. O relatório mostra em
`aptas_para_precificação` quantas vendas foram aproveitadas sem sprite e,
por resposta do histórico, contabiliza itens que não são Pokémon e até oito
amostras dos nomes e tipos dos campos de imagem (sem IDs ou URLs).

## Oportunidades e diagnóstico

O painel **Oportunidades** reúne os avisos enviados ao jogo ou aceitos pelo
Chrome nos últimos 10 minutos, em ordem de envio. Cada cartão mantém o preço
e o desconto do momento do aviso, mesmo que a oferta depois saia do mercado. No PokéIdle, os
avisos aparecem em ordem de chegada, um por vez por 3 segundos. Fechar um aviso
antecipa o próximo da fila.

Para validar a instalação, abra **Tabela de preços → Pokémon** e a vitrine. Em seguida, no
ícone da extensão, use **Diagnóstico da versão → Rodar diagnóstico → Copiar resultado**. O
relatório contém os resultados de testes sintéticos, contagens da fila e cobertura de campos
no histórico local. O diagnóstico não grava registros de teste, não consulta o jogo e não
inclui nomes de jogadores nem informações de anúncios individuais.

## Precificação por atributos e liquidez (v1.5.4.12)

Expanda um cartão em **Oportunidades** para abrir **Comparáveis e simulação
de revenda**. Altere o nível e o preço de saída separadamente. O desconto
continua referente ao anúncio original. Liquidez não integra o preço nem o disparo.

O histórico é alimentado pelas páginas da vitrine e da **Tabela de preços → Pokémon** que chegam
ao cliente. A atualização não faz novas consultas. A ficha de venda preserva atributos recebidos
junto da própria transação. Dados ausentes aparecem como desconhecidos.

O modelo detalhado testa previsões em um bloco cronologicamente posterior e usa a referência
básica quando o perfil não está validado. Para liquidez, somente uma venda vinculada por identidade
explícita da oferta, exemplar, moeda, preço e tempo entra como desfecho confirmado. Os demais
vínculos são diagnósticos. Sem observações completas ou vendas vinculadas suficientes, o painel
exibe a atividade observada, sem porcentagem. A coleta de exposições de anúncio começa nesta versão.

O índice de liquidez continua separado da precificação.

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
