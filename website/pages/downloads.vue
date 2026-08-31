<script setup lang="ts">
import { downloads, githubReleasePageUrl, release } from '~/data/release'
import { terminalCommands } from '~/data/install'
import type { Platform } from '~/components/PlatformTabs.vue'

useSeoMeta({
  title: 'Downloads',
  description:
    'Baixe a GUI do GoLiveBypass para Windows, macOS e Linux ou escolha a instalação por terminal, standalone e plugin.',
  ogTitle: 'Downloads — GoLiveBypass',
  ogDescription: 'Escolha a GUI ou copie o comando de instalação para a sua plataforma.',
  ogUrl: 'https://golivebypass.dev/downloads',
})

const selectedPlatform = ref<Platform>('windows')
const commandPlatform = ref<Platform>('windows')

const activeTerminalCommands = computed(() => terminalCommands[commandPlatform.value === 'linux' ? 'linux' : 'windows'])

onMounted(() => {
  const userAgent = navigator.userAgent.toLowerCase()
  if (userAgent.includes('mac')) {
    selectedPlatform.value = 'macos'
    commandPlatform.value = 'macos'
  }
  if (userAgent.includes('linux')) {
    selectedPlatform.value = 'linux'
    commandPlatform.value = 'linux'
  }
})
</script>

<template>
  <div class="page-wrap site-container">
    <PageIntro
      eyebrow="BAIXAR O PROJETO"
      title="Escolha a ferramenta para a sua máquina."
      description="A GUI vem diretamente da release do GitHub. Para terminal, standalone e plugin, copie o comando oficial correspondente ao seu sistema."
    />

    <section id="gui" class="release-banner reveal reveal--first">
      <div class="release-banner__copy">
        <span class="release-banner__label"><span class="status-dot" aria-hidden="true"></span> Release estável</span>
        <h2>GoLiveBypass <code>v{{ release.version }}</code></h2>
        <p>Uma versão para cada sistema desktop. O download abre o arquivo oficial na release correspondente.</p>
      </div>
      <a class="text-link" :href="githubReleasePageUrl" target="_blank" rel="noopener noreferrer">
        Ver release no GitHub
        <BaseIcon name="external" :size="16" />
      </a>
    </section>

    <section class="section section--page-section reveal reveal--second" aria-labelledby="gui-title">
      <div class="section-heading section-heading--compact">
        <div>
          <span class="eyebrow">INTERFACE GRÁFICA</span>
          <h2 id="gui-title">Baixe a GUI</h2>
        </div>
        <p>Escolhemos uma sugestão com base no seu navegador. As três plataformas continuam disponíveis.</p>
      </div>

      <PlatformTabs v-model="selectedPlatform" />

      <div v-if="selectedPlatform === 'windows'" id="platform-panel-windows" class="platform-panel" role="tabpanel" aria-labelledby="platform-tab-windows">
        <DownloadCard
          icon="windows"
          kicker="WINDOWS"
          title="Aplicativo para Windows"
          description="Abra o executável, escolha a configuração e deixe a GUI cuidar da ativação do Discord."
          :meta="`GoLiveBypass-${release.version}.exe · release ${release.channel}`"
          primary-label="Baixar para Windows"
          :primary-href="downloads.windowsGui"
          secondary-label="Abrir release"
          :secondary-href="githubReleasePageUrl"
          tone="success"
        />
        <div class="platform-note">
          <BaseIcon name="alert" :size="17" />
          <p>O Windows pode exibir um aviso do SmartScreen na primeira abertura. A release também está disponível no GitHub para conferência.</p>
        </div>
      </div>

      <div v-else-if="selectedPlatform === 'macos'" id="platform-panel-macos" class="platform-panel" role="tabpanel" aria-labelledby="platform-tab-macos">
        <DownloadCard
          icon="apple"
          kicker="MACOS"
          title="Aplicativo para macOS"
          description="Use o instalador DMG ou escolha o ZIP para abrir o mesmo aplicativo no macOS."
          :meta="`GoLiveBypass.dmg ou GoLiveBypass.zip · release ${release.channel}`"
          primary-label="Baixar DMG"
          :primary-href="downloads.macDmg"
          secondary-label="Baixar ZIP"
          :secondary-href="downloads.macZip"
        />
        <div class="platform-note">
          <BaseIcon name="lock" :size="17" />
          <p>O macOS pode pedir autorização em Privacidade e Segurança antes de permitir que o aplicativo altere o Discord.</p>
        </div>
      </div>

      <div v-else id="platform-panel-linux" class="platform-panel" role="tabpanel" aria-labelledby="platform-tab-linux">
        <DownloadCard
          icon="linux"
          kicker="LINUX"
          title="AppImage para Linux"
          description="Um arquivo portátil para Debian, Ubuntu, Fedora, Arch e outras distribuições compatíveis."
          :meta="`GoLiveBypass-${release.version}.AppImage · release ${release.channel}`"
          primary-label="Baixar AppImage"
          :primary-href="downloads.linuxGui"
          secondary-label="Ver instruções"
          secondary-href="/instalacao#gui-linux"
        />
        <div class="platform-note">
          <BaseIcon name="terminal" :size="17" />
          <p>Depois do download, dê permissão de execução com <code>chmod +x GoLiveBypass-*.AppImage</code>.</p>
        </div>
      </div>
    </section>

    <section class="section section--page-section reveal reveal--third" aria-labelledby="command-title">
      <div class="section-heading">
        <div>
          <span class="eyebrow">INSTALAÇÃO POR COMANDO</span>
          <h2 id="command-title">Copie e cole no terminal.</h2>
        </div>
        <p>Terminal, standalone e plugin não são downloads de aplicativo. Cada caminho baixa o instalador oficial e oferece uma versão com TUI e outra sem TUI.</p>
      </div>

      <PlatformTabs
        v-model="commandPlatform"
        id-prefix="command-platform"
        aria-label="Escolha o sistema operacional para os comandos"
      />

      <div v-if="commandPlatform !== 'macos'" :id="`command-platform-panel-${commandPlatform}`" class="command-path-grid" role="tabpanel" :aria-labelledby="`command-platform-tab-${commandPlatform}`">
        <CommandPathCard
          icon="code"
          kicker="VENCORD / EQUICORD"
          title="Plugin do Discord"
          description="Use quando você já usa Vencord ou Equicord. A TUI detecta o mod e guia a instalação; o modo direto instala com Equicord sem abrir o menu."
          :platform="commandPlatform === 'windows' ? 'Windows · PowerShell' : 'Linux · shell POSIX'"
          :tui-command="activeTerminalCommands.plugin.tui"
          :direct-command="activeTerminalCommands.plugin.direct"
          :direct-note="activeTerminalCommands.plugin.directNote"
          tone="discord"
        />
        <CommandPathCard
          icon="route"
          kicker="DISCORD PURO"
          title="Standalone"
          description="Use somente no Discord sem mod. O script é o instalador com TUI; o arquivo JavaScript é baixado por ele e não precisa ser baixado separadamente."
          :platform="commandPlatform === 'windows' ? 'Windows · PowerShell' : 'Linux · shell POSIX'"
          :tui-command="activeTerminalCommands.standalone.tui"
          :direct-command="activeTerminalCommands.standalone.direct"
          :direct-note="activeTerminalCommands.standalone.directNote"
          tone="success"
        />
      </div>

      <div v-else :id="`command-platform-panel-${commandPlatform}`" class="info-note command-platform-unavailable" role="tabpanel" :aria-labelledby="`command-platform-tab-${commandPlatform}`">
        <span class="icon-frame icon-frame--muted"><BaseIcon name="apple" :size="18" /></span>
        <div>
          <strong>No macOS, use a GUI.</strong>
          <p>O README documenta os instaladores de terminal para Windows e Linux. No macOS, baixe a GUI acima para ativar o bypass sem comandos.</p>
        </div>
      </div>

      <div class="command-section-footnote">
        <span class="icon-frame icon-frame--muted"><BaseIcon name="lock" :size="17" /></span>
        <div>
          <strong>O comando roda os scripts oficiais do repositório.</strong>
          <p>O modo TUI abre o menu interativo. O modo sem TUI usa as flags de automação. Se preferir instalar o plugin manualmente, o <a :href="downloads.plugin" target="_blank" rel="noopener noreferrer">ZIP do plugin</a> continua disponível como caminho avançado.</p>
        </div>
      </div>
    </section>

    <section class="info-note reveal reveal--third">
      <span class="icon-frame icon-frame--muted"><BaseIcon name="lock" :size="18" /></span>
      <div>
        <strong>Links e comandos sem API do GitHub</strong>
        <p>A página usa links estáticos para a release e para os scripts oficiais. Se uma versão mudar, a tag, os assets e os comandos ficam centralizados nos arquivos de dados do site.</p>
      </div>
    </section>

    <div class="section section--last">
      <DiscordCta />
    </div>
  </div>
</template>
