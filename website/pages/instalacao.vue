<script setup lang="ts">
import { downloads, githubReleasePageUrl } from '~/data/release'
import { terminalCommands } from '~/data/install'
import type { Platform } from '~/components/PlatformTabs.vue'

useSeoMeta({
  title: 'Instalação',
  description:
    'Escolha entre GUI, instalador de terminal, standalone e plugin Vencord/Equicord para instalar o GoLiveBypass.',
  ogTitle: 'Instalação — GoLiveBypass',
  ogDescription: 'Um caminho de instalação para cada forma de usar o Discord.',
  ogUrl: 'https://golivebypass.dev/instalacao',
})

const installPlatform = ref<Platform>('windows')
const activeInstallCommands = computed(() => terminalCommands[installPlatform.value === 'linux' ? 'linux' : 'windows'])

onMounted(() => {
  const userAgent = navigator.userAgent.toLowerCase()
  if (userAgent.includes('mac')) installPlatform.value = 'macos'
  if (userAgent.includes('linux')) installPlatform.value = 'linux'
})
</script>

<template>
  <div class="page-wrap site-container">
    <PageIntro
      eyebrow="GUIA DE INSTALAÇÃO"
      title="Instale sem escolher no escuro."
      description="Primeiro identifique como você usa o Discord. Depois siga apenas o caminho correspondente. Cada opção tem uma finalidade diferente."
    />

    <section class="decision-panel reveal reveal--first" aria-labelledby="decision-title">
      <div class="decision-panel__heading">
        <div>
          <span class="eyebrow">DECISÃO RÁPIDA</span>
          <h2 id="decision-title">Qual frase descreve você?</h2>
        </div>
        <BaseIcon name="route" :size="25" />
      </div>
      <div class="decision-grid">
        <NuxtLink class="decision-card" to="#gui">
          <span class="decision-card__index">01</span>
          <strong>Quero uma janela para ativar</strong>
          <span>Use a GUI para Windows, macOS ou Linux.</span>
          <BaseIcon name="arrow-right" :size="16" />
        </NuxtLink>
        <NuxtLink class="decision-card" to="#terminal">
          <span class="decision-card__index">02</span>
          <strong>Prefiro executar comandos</strong>
          <span>Use o instalador automático pelo PowerShell ou shell POSIX.</span>
          <BaseIcon name="arrow-right" :size="16" />
        </NuxtLink>
        <NuxtLink class="decision-card" to="#terminal">
          <span class="decision-card__index">03</span>
          <strong>Já uso Vencord ou Equicord</strong>
          <span>Instale o plugin com TUI ou em modo direto, sem perder os outros recursos.</span>
          <BaseIcon name="arrow-right" :size="16" />
        </NuxtLink>
        <NuxtLink class="decision-card" to="#standalone">
          <span class="decision-card__index">04</span>
          <strong>Uso o Discord sem mod</strong>
          <span>Use o standalone, sem dependências de Node ou pnpm.</span>
          <BaseIcon name="arrow-right" :size="16" />
        </NuxtLink>
      </div>
    </section>

    <section id="gui" class="section section--page-section reveal reveal--second" aria-labelledby="install-gui-title">
      <div class="section-heading">
        <div>
          <span class="eyebrow">CAMINHO 01</span>
          <h2 id="install-gui-title">GUI para desktop</h2>
        </div>
        <p>A interface gráfica é o caminho mais curto para quem não quer lidar com arquivos de configuração ou comandos.</p>
      </div>
      <div class="prose-grid">
        <div class="prose-block">
          <h3>Passo a passo</h3>
          <ol class="numbered-list">
            <li><span>01</span><p>Baixe o arquivo da sua plataforma na <NuxtLink to="/downloads">página de downloads</NuxtLink>.</p></li>
            <li><span>02</span><p>Abra o aplicativo e aguarde a detecção do Discord.</p></li>
            <li><span>03</span><p>Escolha o modo de saída e clique para ativar.</p></li>
            <li><span>04</span><p>O Discord será reiniciado quando a injeção terminar.</p></li>
          </ol>
        </div>
        <div id="gui-linux" class="prose-block prose-block--note">
          <span class="icon-frame icon-frame--success"><BaseIcon name="check" :size="19" /></span>
          <h3>O que muda por sistema</h3>
          <p><strong>Windows:</strong> abra o executável. O SmartScreen pode pedir confirmação na primeira execução.</p>
          <p><strong>macOS:</strong> DMG e ZIP estão disponíveis. O sistema pode pedir autorização em Privacidade e Segurança.</p>
          <p><strong>Linux:</strong> torne o AppImage executável antes de abrir. Em instalações Flatpak do sistema, uma permissão adicional pode aparecer.</p>
          <a class="text-link" :href="githubReleasePageUrl" target="_blank" rel="noopener noreferrer">Ver notas da release <BaseIcon name="external" :size="15" /></a>
        </div>
      </div>
    </section>

    <section id="terminal" class="section section--page-section section--terminal reveal reveal--third" aria-labelledby="install-terminal-title">
      <div class="section-heading">
        <div>
          <span class="eyebrow">CAMINHO 02</span>
          <h2 id="install-terminal-title">Instaladores pelo terminal</h2>
        </div>
        <p>Standalone e plugin são scripts de instalação. Copie o comando com TUI para escolher as opções ou use o modo direto para automação.</p>
      </div>

      <PlatformTabs
        v-model="installPlatform"
        id-prefix="install-platform"
        aria-label="Escolha o sistema operacional para a instalação por terminal"
      />

      <div v-if="installPlatform !== 'macos'" :id="`install-platform-panel-${installPlatform}`" class="command-path-grid" role="tabpanel" :aria-labelledby="`install-platform-tab-${installPlatform}`">
        <CommandPathCard
          icon="code"
          kicker="VENCORD / EQUICORD"
          title="Plugin do Discord"
          description="Use para preservar Vencord ou Equicord e os outros plugins. Sem flags, o instalador abre a TUI e detecta ou instala o mod escolhido."
          :platform="installPlatform === 'windows' ? 'Windows · PowerShell' : 'Linux · shell POSIX'"
          :tui-command="activeInstallCommands.plugin.tui"
          :direct-command="activeInstallCommands.plugin.direct"
          :direct-note="activeInstallCommands.plugin.directNote"
          tone="discord"
        />
        <CommandPathCard
          icon="route"
          kicker="DISCORD PURO"
          title="Standalone"
          description="Use somente no Discord sem mod. O instalador abre a TUI, baixa o bypass e injeta direto no Discord."
          :platform="installPlatform === 'windows' ? 'Windows · PowerShell' : 'Linux · shell POSIX'"
          :tui-command="activeInstallCommands.standalone.tui"
          :direct-command="activeInstallCommands.standalone.direct"
          :direct-note="activeInstallCommands.standalone.directNote"
          tone="success"
        />
      </div>

      <div v-else :id="`install-platform-panel-${installPlatform}`" class="info-note command-platform-unavailable" role="tabpanel" :aria-labelledby="`install-platform-tab-${installPlatform}`">
        <span class="icon-frame icon-frame--muted"><BaseIcon name="apple" :size="18" /></span>
        <div>
          <strong>No macOS, use a GUI.</strong>
          <p>Os instaladores de terminal documentados pelo projeto são para Windows e Linux. No macOS, use a GUI para ativar o bypass.</p>
        </div>
      </div>

      <div class="info-note info-note--dark">
        <span class="icon-frame icon-frame--muted"><BaseIcon name="alert" :size="18" /></span>
        <div>
          <strong>Com TUI é o fluxo recomendado.</strong>
          <p>Abra o comando em um terminal interativo. Use as flags sem TUI apenas em automação ou quando já souber qual mod e caminho quer usar.</p>
        </div>
      </div>
    </section>

    <section id="standalone" class="section section--page-section reveal reveal--third" aria-labelledby="install-standalone-title">
      <div class="section-heading">
        <div>
          <span class="eyebrow">CAMINHO 03</span>
          <h2 id="install-standalone-title">Standalone para Discord puro</h2>
        </div>
        <p>O standalone não é um arquivo para abrir. É um instalador de terminal que baixa o payload, mostra a TUI e injeta o bypass diretamente no Discord.</p>
      </div>

      <div v-if="installPlatform !== 'macos'" class="standalone-command-layout">
        <CommandPathCard
          icon="route"
          kicker="INSTALADOR STANDALONE"
          title="Com TUI ou sem TUI"
          description="Escolha o modo com menu para configurar saída, status e remoção. No modo direto, o script instala sem fazer perguntas."
          :platform="installPlatform === 'windows' ? 'Windows · PowerShell' : 'Linux · shell POSIX'"
          :tui-command="activeInstallCommands.standalone.tui"
          :direct-command="activeInstallCommands.standalone.direct"
          :direct-note="activeInstallCommands.standalone.directNote"
          tone="success"
        />
        <div class="prose-block prose-block--note">
          <span class="icon-frame icon-frame--success"><BaseIcon name="check" :size="19" /></span>
          <h3>Quando escolher</h3>
          <ul class="check-list">
            <li><BaseIcon name="check" :size="16" /> Discord instalado sem Vencord ou Equicord.</li>
            <li><BaseIcon name="check" :size="16" /> Sem Node, pnpm ou Git.</li>
            <li><BaseIcon name="alert" :size="16" /> Não use por cima de um mod já injetado.</li>
          </ul>
          <p>Para consultar ou desfazer depois, acrescente <code>-Mode Status</code> ou <code>-Mode Uninstall</code> no PowerShell. No Linux, use <code>--status</code> ou <code>--uninstall</code>.</p>
        </div>
      </div>

      <div v-else class="info-note command-platform-unavailable">
        <span class="icon-frame icon-frame--muted"><BaseIcon name="apple" :size="18" /></span>
        <div>
          <strong>No macOS, use a GUI.</strong>
          <p>O caminho de terminal do standalone não é documentado para macOS. Baixe a GUI na página de downloads.</p>
        </div>
      </div>
    </section>

    <section id="plugin" class="section section--page-section reveal reveal--third" aria-labelledby="install-plugin-title">
      <div class="section-heading">
        <div>
          <span class="eyebrow">CAMINHO AVANÇADO</span>
          <h2 id="install-plugin-title">Plugin manual para Vencord e Equicord</h2>
        </div>
        <p>O instalador por comando acima é o caminho recomendado. Use este fluxo apenas se quiser baixar o ZIP e fazer cada etapa manualmente.</p>
      </div>
      <div class="plugin-layout">
        <div class="prose-block">
          <h3>Passo a passo</h3>
          <ol class="numbered-list numbered-list--plain">
            <li><span>01</span><p>Baixe o <a :href="downloads.plugin" target="_blank" rel="noopener noreferrer">ZIP do plugin</a> e extraia a pasta <code>goLiveBypass</code>.</p></li>
            <li><span>02</span><p>Copie-a para <code>src/userplugins/goLiveBypass</code> dentro do seu clone do Vencord ou Equicord. A pasta <code>userplugins</code> fica ao lado de <code>plugins</code>.</p></li>
            <li><span>03</span><p>Na raiz do mod, rode <code>pnpm install</code> e <code>pnpm build</code>.</p></li>
            <li><span>04</span><p>Feche o Discord, rode <code>pnpm inject</code> e abra o Discord novamente. No Vesktop, aponte o campo <strong>Vencord Location</strong> para a pasta <code>dist</code> em vez de usar <code>pnpm inject</code>.</p></li>
          </ol>
        </div>
        <div class="warning-card">
          <BaseIcon name="alert" :size="20" />
          <div>
            <strong>Não misture os caminhos.</strong>
            <p>O standalone ocupa o lugar do mod e pode remover outros plugins. Se Vencord ou Equicord já estiver instalado, use o instalador do plugin ou este fluxo manual — nunca o standalone.</p>
            <a class="text-link" :href="githubReleasePageUrl" target="_blank" rel="noopener noreferrer">Ver release e checksums <BaseIcon name="external" :size="15" /></a>
          </div>
        </div>
      </div>
    </section>

    <section class="section section--aftercare" aria-labelledby="aftercare-title">
      <div class="section-heading section-heading--compact">
        <div>
          <span class="eyebrow">DEPOIS DA INSTALAÇÃO</span>
          <h2 id="aftercare-title">O que esperar na primeira abertura.</h2>
        </div>
        <NuxtLink class="text-link text-link--standalone" to="/faq">Ir para a FAQ <BaseIcon name="arrow-right" :size="16" /></NuxtLink>
      </div>
      <div class="aftercare-grid">
        <article><span class="icon-frame icon-frame--success"><BaseIcon name="signal" :size="18" /></span><h3>Confira o status</h3><p>A GUI mostra se a instalação está pronta. No standalone, consulte o status pelo script.</p></article>
        <article><span class="icon-frame icon-frame--warning"><BaseIcon name="refresh" :size="18" /></span><h3>Atualize a injeção</h3><p>Uma atualização do Discord pode criar uma pasta nova e exigir que você ative o bypass novamente.</p></article>
        <article><span class="icon-frame icon-frame--muted"><BaseIcon name="book" :size="18" /></span><h3>Leia a solução</h3><p>Se a Live não carregar, a FAQ separa problemas de gateway, mídia e permissões.</p></article>
      </div>
    </section>

    <div class="section section--last">
      <DiscordCta />
    </div>
  </div>
</template>
