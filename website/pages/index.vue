<script setup lang="ts">
import { githubRepositoryUrl, release } from '~/data/release'

useSeoMeta({
  title: 'Go Live de volta ao Discord',
  description:
    'Escolha como instalar o GoLiveBypass: GUI para Windows, macOS e Linux, CLI, standalone ou plugin.',
  ogTitle: 'GoLiveBypass — Go Live de volta ao Discord',
  ogDescription:
    'Uma instalação guiada para devolver o Go Live e a câmera no Discord, no Brasil.',
  ogUrl: 'https://golivebypass.dev/',
})
</script>

<template>
  <div>
    <section class="hero site-container">
      <div class="hero__copy reveal reveal--first">
        <span class="eyebrow">GO LIVE · BRASIL</span>
        <h1>Go Live de volta ao Discord.</h1>
        <p class="hero__lead">
          Escolha uma interface ou instale pelo terminal. O GoLiveBypass organiza o caminho certo para a sua máquina e aponta para os arquivos oficiais do projeto.
        </p>
        <div class="hero__actions">
          <NuxtLink class="button button--primary" to="/downloads">
            <BaseIcon name="download" :size="17" />
            Escolher download
            <BaseIcon name="arrow-right" :size="16" />
          </NuxtLink>
          <a
            class="button button--secondary"
            :href="githubRepositoryUrl"
            target="_blank"
            rel="noopener noreferrer"
          >
            <BaseIcon name="github" :size="17" />
            Ver no GitHub
          </a>
        </div>
        <div class="hero__meta">
          <span>Windows</span>
          <span>macOS</span>
          <span>Linux</span>
          <span>Open source</span>
        </div>
      </div>

      <div class="hero__visual reveal reveal--second">
        <StatusPanel />
        <div class="hero__note">
          <span class="status-dot" aria-hidden="true"></span>
          <span>Release estável <strong>v{{ release.version }}</strong></span>
        </div>
      </div>
    </section>

    <div class="site-container product-strip reveal reveal--third" aria-label="Caminhos disponíveis">
      <div>
        <span class="product-strip__value">04</span>
        <span class="product-strip__label">caminhos de instalação</span>
      </div>
      <div>
        <span class="product-strip__value">03</span>
        <span class="product-strip__label">sistemas desktop</span>
      </div>
      <div>
        <span class="product-strip__value">01</span>
        <span class="product-strip__label">projeto open source</span>
      </div>
    </div>

    <section id="paths" class="section site-container">
      <div class="section-heading">
        <div>
          <span class="eyebrow">POR ONDE COMEÇAR</span>
          <h2>Use o caminho que já combina com seu Discord.</h2>
        </div>
        <p>Você não precisa instalar tudo. Escolha uma opção e siga somente os passos daquele caminho.</p>
      </div>

      <div class="path-grid">
        <PathCard
          icon="layers"
          eyebrow="INTERFACE DESKTOP"
          title="Quero uma GUI"
          description="Uma janela para ativar, desativar e acompanhar o bypass sem abrir o terminal."
          link-label="Ver downloads da GUI"
          to="/downloads#gui"
        />
        <PathCard
          icon="terminal"
          eyebrow="POUCOS COMANDOS"
          title="Quero usar o terminal"
          description="Instale pelo PowerShell ou por qualquer shell POSIX, com comandos prontos para copiar."
          link-label="Abrir instalação por terminal"
          to="/instalacao#terminal"
        />
        <PathCard
          icon="code"
          eyebrow="PARA QUEM JÁ USA MOD"
          title="Uso Vencord ou Equicord"
          description="Instale o plugin dentro do mod e preserve os outros plugins do seu Discord."
          link-label="Ver instalação do plugin"
          to="/instalacao#plugin"
        />
        <PathCard
          icon="route"
          eyebrow="DISCORD PURO"
          title="Quero o standalone"
          description="Injete direto no Discord sem Node, pnpm, Git, Vencord ou Equicord."
          link-label="Entender o standalone"
          to="/instalacao#standalone"
        />
      </div>
    </section>

    <section class="section section--route">
      <div class="site-container route-section">
        <div class="section-heading section-heading--compact">
          <div>
            <span class="eyebrow">A IDEIA CENTRAL</span>
            <h2>Uma regra pequena para o que precisa mudar.</h2>
          </div>
          <NuxtLink class="text-link text-link--standalone" to="/como-funciona">
            Ver como funciona
            <BaseIcon name="arrow-right" :size="16" />
          </NuxtLink>
        </div>

        <div class="route-card">
          <div class="route-card__intro">
            <span class="icon-frame icon-frame--success"><BaseIcon name="route" :size="21" /></span>
            <div>
              <h3>O gateway sai por uma rota alternativa.</h3>
              <p>O restante do Discord continua seguindo sua conexão normal.</p>
            </div>
          </div>
          <div class="route-schematic" aria-label="Gateway roteado e mídia em conexão direta">
            <div class="route-node">
              <span class="route-node__icon"><BaseIcon name="code" :size="18" /></span>
              <strong>Discord</strong>
              <small>cliente</small>
            </div>
            <div class="route-path route-path--routed">
              <span class="route-path__line"></span>
              <span class="route-path__label">gateway · roteado</span>
            </div>
            <div class="route-node route-node--active">
              <span class="route-node__icon"><BaseIcon name="route" :size="18" /></span>
              <strong>Saída</strong>
              <small>túnel local</small>
            </div>
            <div class="route-path route-path--direct">
              <span class="route-path__line"></span>
              <span class="route-path__label">áudio e vídeo · direto</span>
            </div>
            <div class="route-node">
              <span class="route-node__icon"><BaseIcon name="signal" :size="18" /></span>
              <strong>Discord</strong>
              <small>mídia</small>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class="section site-container">
      <div class="section-heading">
        <div>
          <span class="eyebrow">O FLUXO</span>
          <h2>Da escolha ao primeiro Go Live.</h2>
        </div>
        <p>O site separa decisão, instalação e solução de problemas para você não precisar adivinhar o próximo passo.</p>
      </div>
      <div class="steps-grid">
        <article class="step-item">
          <span class="step-index">01</span>
          <h3>Escolha</h3>
          <p>GUI, terminal, standalone ou plugin. A página de instalação explica quando usar cada um.</p>
        </article>
        <article class="step-item">
          <span class="step-index">02</span>
          <h3>Instale</h3>
          <p>Baixe um asset da release ou copie o comando indicado para o seu sistema.</p>
        </article>
        <article class="step-item">
          <span class="step-index">03</span>
          <h3>Conecte</h3>
          <p>Abra o Discord, confira o status e consulte a FAQ se uma transmissão não carregar.</p>
        </article>
      </div>
    </section>

    <section class="section section--faq-preview site-container">
      <div class="section-heading section-heading--compact">
        <div>
          <span class="eyebrow">ANTES DE INSTALAR</span>
          <h2>Respostas para as dúvidas mais comuns.</h2>
        </div>
        <NuxtLink class="text-link text-link--standalone" to="/faq">
          Abrir FAQ completa
          <BaseIcon name="arrow-right" :size="16" />
        </NuxtLink>
      </div>
      <div class="faq-preview-grid">
        <NuxtLink class="faq-preview-card" to="/faq#proxy">
          <span class="faq-preview-card__number">01</span>
          <h3>A mídia passa pela proxy?</h3>
          <p>Não. O roteamento é seletivo e a conexão de áudio e vídeo permanece direta.</p>
          <BaseIcon name="arrow-right" :size="17" />
        </NuxtLink>
        <NuxtLink class="faq-preview-card" to="/faq#mod">
          <span class="faq-preview-card__number">02</span>
          <h3>Qual opção uso com Vencord?</h3>
          <p>Use o plugin. O standalone ocupa o lugar do mod e pode remover outros plugins.</p>
          <BaseIcon name="arrow-right" :size="17" />
        </NuxtLink>
        <NuxtLink class="faq-preview-card" to="/faq#black-screen">
          <span class="faq-preview-card__number">03</span>
          <h3>O que faço se a tela ficar preta?</h3>
          <p>Confira a orientação de recarga e as proteções para não interromper uma chamada ativa.</p>
          <BaseIcon name="arrow-right" :size="17" />
        </NuxtLink>
      </div>
    </section>

    <div class="site-container section section--last">
      <DiscordCta />
    </div>
  </div>
</template>
