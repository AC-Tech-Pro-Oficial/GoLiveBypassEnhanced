# Viewer da GUI real na home do GoLiveBypass

**Data:** 2026-09-01  
**Escopo:** substituir o mockup `StatusPanel` da página `/` por uma prévia interativa baseada na GUI Electron real.

## Objetivo

Mostrar na home a interface que o usuário realmente encontrará ao baixar o GoLiveBypass. A prévia deve usar a estrutura, proporções, tipografia, tokens e estados presentes em `golive-gui/index.html` e `golive-gui/src/style.css`, sem tentar executar Electron, IPC, Tor, proxy ou bypass no navegador.

O CTA principal da prévia não será “Ativar Bypass” nem “Desativar Bypass”. Será **“Baixar GUI”** e levará para `/downloads#gui`, porque a ação disponível na web é baixar o aplicativo.

## Abordagens consideradas

1. **Componente Vue baseado na GUI real — escolhido.** Replica o markup relevante e os tokens da GUI, com estados locais para a demonstração. Permite interação sem misturar APIs Electron ao Nuxt.
2. **Iframe da GUI Electron.** Rejeitado: a GUI depende de `window.api`, IPC e contexto Electron.
3. **Screenshot.** Rejeitado: não permite interação e envelhece com mudanças da GUI.

## Arquitetura

- Criar `website/components/GuiViewer.vue`.
- Substituir somente `<StatusPanel />` em `website/pages/index.vue`.
- Manter `golive-gui/index.html`, `golive-gui/src/main.ts` e `golive-gui/src/style.css` sem alterações.
- O componente terá CSS próprio e namespace `.gui-viewer`, derivado dos tokens e da geometria da GUI real. Não importar o CSS inteiro da Electron para evitar vazamento de seletores globais (`body`, `html`, `#app`) no site.
- Usar `website/public/logo.svg` para a marca, mantendo a mesma identidade visual da GUI.

## Conteúdo e estados exibidos

Estado inicial da prévia:

- wordmark “GoLiveBypass”;
- meta “Go Live · Brasil · v1.1.11” usando a versão centralizada em `website/data/release.ts`;
- tagline real da GUI;
- status “Discord limpo. Pronto para injetar.” com tag “Pronto”;
- CTA verde “Baixar GUI” com link real para `/downloads#gui`;
- switch “Iniciar com o sistema”;
- grupo de rede com Tor selecionado e badge “recomendado”;
- rodapé curto indicando que é uma prévia.

Interações locais:

- Tor, Gratuitas e Personalizado alternam o estado selecionado.
- Personalizado revela campo `socks5://host:porta`, botão “Testar conexão” e orientação resumida, sem testar rede.
- O botão de configurações abre um diálogo visual baseado no diálogo real da GUI. Fechar retorna o foco ao botão quando possível.
- O CTA “Baixar GUI” sempre navega para a página de downloads e nunca simula ativação/desativação.
- Ícones de suporte/report não executarão ações falsas; podem ser omitidos do viewer central para preservar foco no fluxo de instalação.

## Fidelidade visual

Reutilizar os valores principais da GUI:

- canvas escuro `#0F0F12`, superfície `#1A1A1F`, superfície secundária `#232329`;
- texto `#E6E6EA`/`#F5F5F7`, texto auxiliar `#A6A6B0`;
- sucesso `#16301B`/`#7BC98C`;
- CTA verde `#BCE0BF` com texto `#0F3318`;
- raio interno de 8px/12px, easing `.16,1,.3,1`;
- wordmark 24px, botão 52px, dot 8px e tags mono em caixa alta.

O viewer será acomodado na coluna visual do hero, com largura máxima próxima dos 380px da janela real, reduzindo para `width: 100%` em telas menores. A moldura externa usada atualmente pode permanecer como elemento editorial do site, mas o interior e os controles devem corresponder à GUI real.

O tema claro do site deve refletir os tokens claros da GUI. Todos os controles terão foco visível, áreas clicáveis adequadas e estados compreensíveis sem depender apenas de cor.

## Acessibilidade e segurança

- Usar `button` para estados locais e `NuxtLink`/link para download.
- Aplicar `role="radiogroup"`/`role="radio"` e `aria-checked` ao seletor de rede.
- Usar `role="dialog"`, `aria-modal` e título associado nas configurações.
- Não chamar `window.api`, não escrever arquivos e não enviar credenciais.
- Respeitar `prefers-reduced-motion` do CSS existente.

## Validação

- `npm run test`.
- `npm run typecheck`.
- `npm run generate`.
- `git diff --check`.
- Verificar as rotas principais e a home em largura desktop e mobile.
- Confirmar que o CTA aponta para `/downloads#gui` e que nenhum texto promete ativação no navegador.
