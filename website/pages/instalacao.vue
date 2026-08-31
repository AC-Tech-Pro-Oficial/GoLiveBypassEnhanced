<script setup lang="ts">
import { downloads, githubReleasePageUrl, release } from '~/data/release'

useSeoMeta({
  title: 'Instalação',
  description:
    'Escolha entre GUI, instalador de terminal, standalone e plugin Vencord/Equicord para instalar o GoLiveBypass.',
  ogTitle: 'Instalação — GoLiveBypass',
  ogDescription: 'Um caminho de instalação para cada forma de usar o Discord.',
  ogUrl: 'https://golivebypass.dev/instalacao',
})

const windowsInstallerCommand = 'irm https://raw.githubusercontent.com/bezumiya/GoLiveBypass/main/installer/GoLiveBypass-Installer.ps1 -OutFile $env:TEMP\glb.ps1; powershell -NoProfile -ExecutionPolicy Bypass -File "$env:TEMP\glb.ps1"'
const posixInstallerCommand = 'curl -fsSL https://raw.githubusercontent.com/bezumiya/GoLiveBypass/main/installer/golivebypass-installer.sh -o /tmp/glb.sh && chmod +x /tmp/glb.sh && /tmp/glb.sh'
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
        <NuxtLink class="decision-card" to="#plugin">
          <span class="decision-card__index">03</span>
          <strong>Já uso Vencord ou Equicord</strong>
          <span>Instale o plugin para preservar os recursos do seu mod.</span>
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
          <h2 id="install-terminal-title">Instalador pelo terminal</h2>
        </div>
        <p>O instalador detecta o Discord e o mod, pergunta o que deve fazer e mantém o processo reversível.</p>
      </div>
      <div class="command-stack">
        <InstallCommand
          label="Instalador automático"
          platform="Windows · PowerShell"
          :command="windowsInstallerCommand"
        />
        <InstallCommand
          label="Instalador automático"
          platform="Linux e macOS · shell POSIX"
          :command="posixInstallerCommand"
        />
      </div>
      <div class="info-note info-note--dark">
        <span class="icon-frame icon-frame--muted"><BaseIcon name="alert" :size="18" /></span>
        <div>
          <strong>Baixe como arquivo antes de executar.</strong>
          <p>O método preserva o terminal interativo para o menu e evita que o shell consuma as perguntas do instalador. Para automação, consulte os parâmetros documentados no README.</p>
        </div>
      </div>
    </section>

    <section id="standalone" class="section section--page-section reveal reveal--third" aria-labelledby="install-standalone-title">
      <div class="section-heading">
        <div>
          <span class="eyebrow">CAMINHO 03</span>
          <h2 id="install-standalone-title">Standalone para Discord puro</h2>
        </div>
        <p>Escolha esta opção se você não usa Vencord ou Equicord. Ela injeta o bypass diretamente no Discord.</p>
      </div>
      <div class="standalone-layout">
        <div class="prose-block">
          <h3>Antes de começar</h3>
          <ul class="check-list">
            <li><BaseIcon name="check" :size="16" /> Não requer Node, pnpm ou Git.</li>
            <li><BaseIcon name="check" :size="16" /> Não instala um mod paralelo no Discord.</li>
            <li><BaseIcon name="alert" :size="16" /> Não use por cima de Vencord ou Equicord.</li>
          </ul>
          <p class="muted-copy">Baixe o bypass da release e use o script do seu sistema para instalar, consultar o status ou restaurar o Discord original.</p>
          <div class="inline-actions">
            <a class="button button--small button--primary" :href="downloads.standaloneJs" target="_blank" rel="noopener noreferrer"><BaseIcon name="download" :size="16" /> Baixar bypass</a>
            <a class="text-link" :href="downloads.standaloneSha" target="_blank" rel="noopener noreferrer">SHA-256 <BaseIcon name="external" :size="15" /></a>
          </div>
        </div>
        <div class="script-links">
          <a class="script-link" :href="downloads.standaloneWindows" target="_blank" rel="noopener noreferrer"><BaseIcon name="windows" :size="18" /><span><strong>PowerShell</strong><small>GoLiveBypass-Standalone.ps1</small></span><BaseIcon name="external" :size="15" /></a>
          <a class="script-link" :href="downloads.standaloneWindowsBat" target="_blank" rel="noopener noreferrer"><BaseIcon name="windows" :size="18" /><span><strong>Duplo clique</strong><small>GoLiveBypass-Standalone.bat</small></span><BaseIcon name="external" :size="15" /></a>
          <a class="script-link" :href="downloads.standalonePosix" target="_blank" rel="noopener noreferrer"><BaseIcon name="terminal" :size="18" /><span><strong>Linux e macOS</strong><small>golivebypass-standalone.sh</small></span><BaseIcon name="external" :size="15" /></a>
        </div>
      </div>
    </section>

    <section id="plugin" class="section section--page-section reveal reveal--third" aria-labelledby="install-plugin-title">
      <div class="section-heading">
        <div>
          <span class="eyebrow">CAMINHO 04</span>
          <h2 id="install-plugin-title">Plugin para Vencord e Equicord</h2>
        </div>
        <p>Este é o caminho correto para manter seu mod e os outros plugins instalados.</p>
      </div>
      <div class="plugin-layout">
        <ol class="numbered-list numbered-list--plain">
          <li><span>01</span><p>Baixe o ZIP do plugin na <NuxtLink to="/downloads">página de downloads</NuxtLink>.</p></li>
          <li><span>02</span><p>Extraia a pasta <code>goLiveBypass</code> no diretório de plugins do Vencord ou Equicord.</p></li>
          <li><span>03</span><p>Compile o mod e reinicie o Discord conforme o fluxo do seu mod.</p></li>
        </ol>
        <div class="warning-card">
          <BaseIcon name="alert" :size="20" />
          <div>
            <strong>Não substitua o app.asar sem entender o conflito.</strong>
            <p>O standalone e o mod ocupam o mesmo lugar dentro do Discord. Se você já usa Vencord ou Equicord, prefira o plugin.</p>
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
