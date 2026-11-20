# Precificador de Pokémon de briaoAle

Arquivos distribuídos sob a licença MIT anexada a esta pasta.

Origem: https://github.com/briaoale/precificador-pokemon/tree/eea807bfa264999438ab2ee38d79ff84ef817639

A adaptação dos arquivos importados usa `globalThis` no lugar de `window` nos pontos em que
o motor e o catálogo precisam carregar tanto no service worker quanto na página da extensão.
A adaptação também aceita IV zero na validação do perfil e do PvE. O snapshot público de Gemas é baixado em tempo de execução.

A extensão expõe a seleção e o valor de IV de ataque do motor para
reaproveitar a mesma regra em Coins e nos avisos.
