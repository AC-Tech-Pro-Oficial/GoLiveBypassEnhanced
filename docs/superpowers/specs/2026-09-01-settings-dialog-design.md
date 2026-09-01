# Design: dialog de configurações compacto

## Objetivo

Reduzir a carga visual e textual do dialog de configurações da GUI, usando a
mesma linguagem do site: superfícies discretas, bordas finas, agrupamento claro
e ações compactas.

## Composição

- Painel estreito em coluna única, com cabeçalho contendo o rótulo
  `PREFERÊNCIAS`, o título e um botão de fechar no canto.
- Grupo `Aparência` com Claro/Escuro em controle segmented.
- Grupo `Comportamento` com linhas compactas, ícone, nome curto, legenda breve e
  switch à direita.
- Fechamento por botão superior, backdrop e `Escape`; o botão inferior não será
  necessário visualmente.

## Conteúdo compacto

- `Avisar sobre atualizações` / `Receba novas versões`
- `Recuperar gateway travado` / `Tenta corrigir sem recarregar`
- `Canal beta` / `Receba versões de teste`

## Restrições

- Não mudar IDs, bindings, eventos ou persistência existentes.
- Manter o modo beta ocultável no macOS.
- Preservar foco visível, navegação por teclado, contraste e suporte aos temas
  claro e escuro.
- Não adicionar dependências nem imagens raster.
