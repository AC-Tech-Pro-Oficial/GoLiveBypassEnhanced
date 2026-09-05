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
      description="O Enhanced Beta é instalado pelos scripts deste fork. As GUIs binárias abaixo ainda são releases upstream/legadas até o primeiro release assinado do Enhanced."
    />

    <section id="gui" class="release-banner reveal reveal--first">
      <div class="release-banner__copy">
        <span class="release-banner__label"><span class="status-dot" aria-hidden="true"></span> GUI upstream · legado</span>
        <h2>GoLiveBypass <code>v{{ release.version }}</code></h2>
        <p>Estes binários são do upstream e não representam a branch Enhanced. Para testar as correções Enhanced, use a instalação por comando abaixo.</p>
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
          <h2 id="gui-title">GUI legada do upstream</h2>
        </div>
        <p>Disponível para referência/uso legado. Não use estes binários para validar bugs ou recursos exclusivos do Enhanced.</p>
      </div>

      <PlatformTabs v-model="selectedPlatform" />

      <div v-if="selectedPlatform === 'windows'" id="platform-panel-windows" class="platform-panel" role="tabpanel" aria-labelledby="platform-tab-windows">
        <DownloadCard
          icon="windows"
          kicker="WINDOWS"
          title="Aplicativo para Windows"
          description="GUI upstream legada. Para Enhanced Beta no Windows, use o instalador de um comando na seção seguinte."
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
          description="GUI upstream legada. O Enhanced ainda não publicou um binário macOS assinado/notarizado."
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
          description="AppImage upstream legado. O código Enhanced possui instaladores Linux atualizados, mas ainda não há AppImage Enhanced publicado."
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
          <h2 id="command-title">Instale o Enhanced Beta.</h2>
        </div>
        <p>No Windows, o primeiro comando usa o migrador Enhanced que preserva Vencord/Equicord, valida Tor e recupera instalações antigas. Linux usa os scripts Enhanced desta mesma branch.</p>
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
          title="Plugin Enhanced"
          description="Use quando você já usa Vencord ou Equicord — ou mesmo numa máquina limpa. No Windows, o comando principal detecta/migra o mod, instala dependências quando preciso e valida Tor."
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
          <strong>Os comandos de código apontam para o fork Enhanced.</strong>
          <p>A GUI acima continua explicitamente upstream até existir release Enhanced. Para instalação manual, abra a <a :href="downloads.plugin" target="_blank" rel="noopener noreferrer">pasta-fonte Enhanced do plugin</a> e siga o guia incluído.</p>
        </div>
      </div>
    </section>

    <section class="info-note reveal reveal--third">
      <span class="icon-frame icon-frame--muted"><BaseIcon name="lock" :size="18" /></span>
      <div>
        <strong>Proveniência explícita</strong>
        <p>Scripts e fontes usam AC-Tech-Pro-Oficial/GoLiveBypassEnhanced. Os binários gráficos continuam marcados como upstream/legado até o primeiro release Enhanced, evitando download falso ou downgrade silencioso.</p>
      </div>
    </section>

    <div class="section section--last">
      <DiscordCta />
    </div>
  </div>
</template>
