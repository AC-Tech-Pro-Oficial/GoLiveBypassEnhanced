# Design: README com acesso rápido às variantes

## Objetivo

Tornar a página inicial do README mais intuitiva para novos usuários, com acesso
visível ao site oficial e à comunidade Discord, além de explicar imediatamente
qual distribuição do GoLiveBypass escolher.

## Escopo

- Adicionar botões HTML centralizados para:
  - Site oficial: `https://golivebypass.dev/`
  - Comunidade Discord: `https://discord.gg/7cWbtr82rG`
- Preservar o conteúdo técnico e as instruções existentes.
- Reorganizar a entrada do README para destacar três variantes:
  - GUI: aplicativo recomendado para ativação com poucos cliques.
  - Standalone: Discord puro, sem Equicord/Vencord.
  - Plugin: Equicord, Vencord ou Vesktop.
- Adicionar uma tabela curta de decisão comparando as variantes.
- Ajustar o índice para apontar primeiro para essas três opções.
- Renomear a instalação automática para deixar explícito que ela instala o plugin.

## Fora do escopo

- Não alterar código, scripts, instaladores ou comportamento do bypass.
- Não reescrever o resumo em inglês nesta mudança.
- Não remover as instruções detalhadas já existentes.

## Critérios de aceitação

1. Os dois links oficiais aparecem como botões logo abaixo do título.
2. Um leitor consegue distinguir GUI, standalone e plugin sem ler as seções
   técnicas mais abaixo.
3. A tabela não contradiz as instruções existentes sobre dependências e uso.
4. Os links internos do índice continuam apontando para cabeçalhos válidos.
5. O README continua sendo Markdown compatível com a renderização do GitHub.
