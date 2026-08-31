# Especificação de design — site GoLiveBypass

**Data:** 2026-08-31  
**Status:** aprovado para implementação local  
**Diretório do frontend:** `website/`  
**Domínio planejado:** `https://golivebypass.dev`  
**Comunidade:** `https://discord.gg/7cWbtr82rG`

## 1. Objetivo

Criar um site Nuxt 3 separado do aplicativo desktop para apresentar o GoLiveBypass e orientar a instalação. O site deve tornar claros os caminhos para GUI, CLI/instalador, standalone e plugin Vencord/Equicord, além de responder dúvidas comuns sem exigir conhecimento técnico prévio.

A primeira entrega será validada localmente. Hospedagem, proxy reverso, DNS, PM2, certificados e qualquer deploy ficam fora desta etapa.

## 2. Metas

- Explicar em linguagem simples o que o projeto faz e quais são seus limites.
- Levar a pessoa ao caminho de instalação correto em poucos passos.
- Oferecer downloads diretos dos artefatos hospedados no GitHub.
- Manter a identidade visual alinhada à GUI existente.
- Funcionar bem em 375px, 768px, 1024px e desktop largo.
- Ser navegável por teclado, ter foco visível, contraste adequado e movimento reduzido.
- Usar somente SVGs de qualidade para ícones, sem emojis.

## 3. Fora do escopo

- Hospedagem ou publicação em servidor.
- Backend próprio, banco de dados, autenticação ou painel administrativo.
- Chamadas à API do GitHub.
- Consulta dinâmica de releases ou verificação de existência de assets em runtime.
- Automação de publicação de releases.
- Analytics, coleta de dados ou formulários de suporte no site.

## 4. Arquitetura de informação

O site será multipágina, com navegação global e páginas Nuxt independentes:

- `/` — apresentação, proposta e escolha rápida do caminho.
- `/downloads` — GUI por plataforma, CLI, standalone e plugin.
- `/instalacao` — orientações por caminho, comandos copiáveis e pré-requisitos.
- `/como-funciona` — explicação do gateway, do roteamento seletivo e da mídia direta.
- `/faq` — dúvidas de instalação, permissões, atualizações, tela preta e compatibilidade.

Jornada principal:

```text
Início
  └─ Escolher caminho
       ├─ Quero usar uma interface → Downloads → Instalação da GUI
       ├─ Quero instalar pelo terminal → Instalação → CLI
       └─ Já uso Vencord/Equicord → Instalação → Plugin
```

A home apresenta três caminhos de forma equivalente, sem presumir que todo visitante usa Vencord ou que deseja abrir um terminal. A FAQ fica em página própria para preservar a clareza do início. Cada página contém uma chamada para a comunidade no Discord.

## 5. Direção visual

A GUI existente é a fonte de identidade. O site não criará uma marca visual paralela.

### 5.1 Tokens de tema

Tema escuro inicial:

- Canvas: `#0F0F12`.
- Superfície: `#1A1A1F`.
- Superfície secundária: `#232329`.
- Texto forte: `#F5F5F7`.
- Texto principal: `#E6E6EA`.
- Texto secundário: `#A6A6B0`.
- Texto discreto: `#6F6F7A` na GUI; no site, `#8B8B95` para manter contraste em rótulos pequenos.
- Linha: `#26262D`.
- Linha forte: `#34343C`.

Tema claro:

- Canvas: `#F7F6F3`.
- Superfície: `#FFFFFF`.
- Superfície secundária: `#F1F0EE`.
- Texto: `#2F3437`.
- Texto forte: `#111111`.
- Texto secundário: `#6E6C68`.
- Texto discreto: `#A8A29E` na GUI; no site, `#706C67` para manter contraste em rótulos pequenos.
- Linha: `#EAEAEA`.
- Linha forte: `#D9D9D7`.

Cores semânticas compartilhadas:

- Ativação/sucesso: fundo verde leitoso e texto verde escuro.
- Desativação/perigo: fundo vermelho suave e texto vermelho escuro.
- Aviso: fundo âmbar suave e texto âmbar escuro.
- Discord: `#5865F2`, somente em ações ou referências ao Discord.

### 5.2 Forma, tipografia e movimento

- Fonte principal igual à gramática da GUI, com fallback nativo compatível.
- Fonte monoespaçada para comandos, versões, nomes de arquivos e metadados.
- Cantos de `8–12px` em cartões e controles.
- Bordas de `1px` e sombras muito discretas.
- Cápsulas somente para badges, status e toggles; cartões e CTAs principais não serão cápsulas grandes.
- Uma luz radial ambiente muito sutil pode aparecer no fundo. Não haverá gradientes em botões ou cartões.
- Entrada de conteúdo com `opacity` e `translateY`, em 150–600ms conforme o contexto.
- `prefers-reduced-motion` remove a ambientação e reduz transições.

### 5.3 Assinatura da home

O hero combina texto de proposta com uma prévia de status inspirada diretamente na GUI: indicador de conexão, versão, ação principal e uma linha de terminal. A prévia demonstra o produto e conecta visualmente a página ao aplicativo sem usar uma ilustração genérica.

## 6. Componentes

Componentes compartilhados em `website/components/`:

- `AppShell` — container, canvas, ambientação e estrutura de tema.
- `AppHeader` — wordmark, navegação, tema e Discord.
- `StatusPanel` — prévia de status inspirada na GUI.
- `DownloadCard` — plataforma, tipo, versão, ação e fallback.
- `InstallCommand` — sistema, comando, copiar e feedback textual.
- `PlatformTabs` — escolha acessível de sistema operacional.
- `FaqAccordion` — pergunta expansível com controle de teclado.
- `DiscordCta` — chamada para suporte da comunidade.
- `AppFooter` — GitHub, licença, versão, aviso legal e links.
- `IconSvg` — conjunto local de ícones SVG com rótulo acessível quando necessário.

As páginas ficam em `website/pages/`. Dados de instalação e release ficam separados da marcação para permitir atualização sem duplicar links.

## 7. Downloads sem API

A configuração inicial fica em `website/data/release.ts` e concentra repositório, tag, versão e nomes de assets. O repositório de distribuição canônico será `bezumiya/GoLiveBypass`, que é o usado pelos links públicos do README e pela configuração de publicação da GUI. O owner será uma constante configurável para permitir apontar para outro fork sem alterar os componentes.

Modelo conceitual:

```ts
export const release = {
  owner: 'bezumiya',
  repo: 'GoLiveBypass',
  tag: 'v1.1.11',
  version: '1.1.11',
  assets: {
    windowsGui: 'GoLiveBypass-1.1.11.exe',
    macDmg: 'GoLiveBypass.dmg',
    macZip: 'GoLiveBypass.zip',
    linuxGui: 'GoLiveBypass-1.1.11.AppImage',
    plugin: 'goLiveBypass-vencord.zip',
  },
}
```

Os helpers gerarão apenas URLs previsíveis:

```text
https://github.com/{owner}/{repo}/releases/download/{tag}/{asset}
https://raw.githubusercontent.com/{owner}/{repo}/main/{path}
```

Os scripts de instalação e standalone usarão `raw.githubusercontent.com` quando o arquivo correto for mantido na branch `main`. Assets versionados usarão a URL da release. Cada cartão exibirá a versão e terá um link “Ver todos os arquivos no GitHub”.

Como o site não consulta a API nem faz verificação de runtime, o cartão terá fallback explícito para a página da release. A atualização de uma release consiste em alterar tag, versão e nomes dos assets em um único arquivo. O site não fingirá que um arquivo está disponível se o GitHub retornar erro; o fallback ficará sempre visível como alternativa.

Os links externos terão `target="_blank"` e `rel="noopener noreferrer"`. Não haverá token, proxy ou servidor intermediário.

## 8. Interações e estados

- Tema começa em escuro e pode ser alternado para claro.
- Preferência de tema é salva com a chave `golivebypass-theme`.
- O shell evita o flash claro durante a hidratação inicial.
- Menu móvel tem foco gerenciado, fecha com `Esc` e devolve o foco ao botão de abertura.
- Botão de copiar usa a Clipboard API e, se ela falhar, seleciona o comando para cópia manual.
- O feedback de cópia é textual e anunciado com `aria-live`.
- Abas de plataforma usam semântica de tab/radio consistente e funcionam por teclado.
- Accordion da FAQ usa `button`, `aria-expanded` e `aria-controls`.
- Estado hover não será a única indicação de interação.
- A página 404 oferece retorno claro para o início.
- Avisos de compatibilidade ficam junto da opção que pode causar conflito, especialmente standalone versus Vencord/Equicord.

## 9. Conteúdo essencial

A primeira versão reutilizará e simplificará os fatos já documentados no README:

- GUI é portátil para Windows, macOS e Linux.
- CLI/instalador oferece PowerShell e shells POSIX.
- Standalone não requer Node, pnpm, Git, Vencord ou Equicord.
- Plugin é o caminho para quem já usa Vencord ou Equicord.
- Somente sinalização/gateway passa pelo roteamento seletivo; WebRTC de áudio e vídeo permanece direto.
- Atualizações do Discord podem exigir nova ativação da injeção.
- macOS pode exibir avisos do Gatekeeper e de Administração de Apps.
- Linux pode exigir permissão de execução no AppImage e permissões adicionais em instalações Flatpak do sistema.
- Tela preta ou carregamento infinito devem apontar para a orientação adequada, incluindo recarga quando aplicável e o cuidado de não recarregar durante uma chamada sem entender a consequência.
- O projeto é open source e o uso pode estar sujeito aos termos do Discord; o aviso será informativo, sem linguagem alarmista.

## 10. SEO e metadados

- `lang="pt-BR"`.
- Título e descrição específicos por rota.
- Canonical planejado: `https://golivebypass.dev` e seus caminhos.
- Open Graph básico para compartilhamento.
- Favicon em SVG alinhado ao logo existente.
- Headings em ordem semântica.

## 11. Validação

Durante a implementação:

1. Rodar `npm run dev` dentro de `website/`.
2. Validar navegação e links localmente.
3. Rodar `npm run generate` para confirmar que o site pode ser gerado estaticamente.
4. Testar o helper de URL e a configuração de release.
5. Revisar visualmente em 375px, 768px, 1024px e desktop.
6. Testar teclado, foco, contraste, estados de cópia, menu móvel e accordion.
7. Conferir `prefers-reduced-motion`.
8. Confirmar que nenhum arquivo de hospedagem ou deploy foi adicionado nesta etapa.

## 12. Critérios de aceite

- O frontend está isolado em `website/` e roda com Nuxt.
- Todas as rotas descritas carregam e têm navegação entre si.
- GUI, CLI, standalone e plugin aparecem como caminhos distintos.
- Downloads apontam diretamente para GitHub/raw GitHub sem API.
- A tag e os nomes de assets são mantidos em um único arquivo.
- O Discord usa exatamente `https://discord.gg/7cWbtr82rG`.
- O site abre em tema escuro, permite tema claro e mantém o padrão visual da GUI.
- Não há emojis no texto, markup, ícones ou alt text.
- O build estático local conclui sem erro.
- Hospedagem e deploy não fazem parte da entrega.
