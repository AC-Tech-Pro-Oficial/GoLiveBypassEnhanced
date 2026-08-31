<script setup lang="ts">
import { downloads, githubReleasePageUrl, release } from '~/data/release'
import type { Platform } from '~/components/PlatformTabs.vue'

useSeoMeta({
  title: 'Downloads',
  description:
    'Baixe a GUI do GoLiveBypass para Windows, macOS e Linux ou escolha a instalação por terminal, standalone e plugin.',
  ogTitle: 'Downloads — GoLiveBypass',
  ogDescription: 'Escolha a versão do GoLiveBypass para a sua plataforma.',
  ogUrl: 'https://golivebypass.dev/downloads',
})

const selectedPlatform = ref<Platform>('windows')

onMounted(() => {
  const userAgent = navigator.userAgent.toLowerCase()
  if (userAgent.includes('mac')) selectedPlatform.value = 'macos'
  if (userAgent.includes('linux')) selectedPlatform.value = 'linux'
})
</script>

<template>
  <div class="page-wrap site-container">
    <PageIntro
      eyebrow="BAIXAR O PROJETO"
      title="Escolha a ferramenta para a sua máquina."
      description="Os arquivos abaixo vêm diretamente das releases do GitHub. Não há conta, instalador intermediário ou chamada à API neste site."
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

    <section class="section section--page-section reveal reveal--third" aria-labelledby="other-title">
      <div class="section-heading">
        <div>
          <span class="eyebrow">OUTROS CAMINHOS</span>
          <h2 id="other-title">Terminal, standalone ou plugin.</h2>
        </div>
        <p>Use a GUI se quiser evitar comandos. Os outros caminhos continuam disponíveis para quem prefere controle manual.</p>
      </div>

      <div class="download-grid">
        <DownloadCard
          icon="terminal"
          kicker="CLI / INSTALADOR"
          title="Instalação pelo terminal"
          description="O instalador detecta o Discord e o mod. Escolha a opção e acompanhe tudo no próprio terminal."
          meta="PowerShell · bash · zsh · fish · sh"
          primary-label="PowerShell"
          :primary-href="downloads.installerWindows"
          secondary-label="Shell POSIX"
          :secondary-href="downloads.installerPosix"
        />
        <DownloadCard
          icon="route"
          kicker="DISCORD PURO"
          title="Standalone"
          description="Bypass direto no Discord, sem Node, pnpm, Git, Vencord ou Equicord."
          :meta="`${release.assets.standaloneJs} · código e instruções na release`"
          primary-label="Baixar standalone"
          :primary-href="downloads.standaloneJs"
          secondary-label="Ver instruções"
          secondary-href="/instalacao#standalone"
        />
        <DownloadCard
          icon="code"
          kicker="VENCORD / EQUICORD"
          title="Plugin do Discord"
          description="Para quem já usa um mod. O ZIP contém o plugin e o manual para instalar sem perder os demais recursos."
          meta="goLiveBypass-vencord.zip · checksum SHA-256 disponível"
          primary-label="Baixar plugin"
          :primary-href="downloads.plugin"
          secondary-label="Checksum"
          :secondary-href="downloads.pluginSha"
          tone="discord"
        />
      </div>
    </section>

    <section class="info-note reveal reveal--third">
      <span class="icon-frame icon-frame--muted"><BaseIcon name="lock" :size="18" /></span>
      <div>
        <strong>Downloads sem API do GitHub</strong>
        <p>A página usa links estáticos para a release configurada no projeto. Se uma versão mudar, a tag e os nomes dos arquivos são atualizados em um único arquivo do site.</p>
      </div>
    </section>

    <div class="section section--last">
      <DiscordCta />
    </div>
  </div>
</template>
