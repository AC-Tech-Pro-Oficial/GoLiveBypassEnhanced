<script setup lang="ts">
import { githubRepositoryUrl } from '~/data/release'

useSeoMeta({
  title: 'Como funciona',
  description:
    'Entenda o roteamento seletivo do GoLiveBypass: gateway por uma saída alternativa e mídia do Discord direta.',
  ogTitle: 'Como funciona — GoLiveBypass',
  ogDescription: 'Uma explicação curta sobre gateway, roteamento seletivo e WebRTC.',
  ogUrl: 'https://golivebypass.dev/como-funciona',
})
</script>

<template>
  <div class="page-wrap site-container">
    <PageIntro
      eyebrow="POR DENTRO DO PROJETO"
      title="Uma regra pequena, não um túnel para tudo."
      description="O GoLiveBypass muda a rota da sinalização que decide o experimento do Discord. Áudio e vídeo continuam seguindo o caminho normal da sua conexão."
    />

    <section class="explanation-hero reveal reveal--first" aria-labelledby="explanation-title">
      <div class="explanation-hero__copy">
        <span class="eyebrow">O QUE MUDA</span>
        <h2 id="explanation-title">O gateway encontra uma saída alternativa.</h2>
        <p>O Discord atribui o experimento do Go Live a partir do IP de origem do WebSocket de gateway. O bypass instala um roteador local e aplica uma regra por host somente para essa sinalização.</p>
        <a class="text-link" :href="`${githubRepositoryUrl}#como-funciona`" target="_blank" rel="noopener noreferrer">Ler a explicação completa no GitHub <BaseIcon name="external" :size="15" /></a>
      </div>
      <div class="explanation-hero__mark" aria-hidden="true">
        <div class="mark-ring mark-ring--outer"></div>
        <div class="mark-ring mark-ring--inner"></div>
        <span class="mark-center"><BaseIcon name="route" :size="26" /></span>
      </div>
    </section>

    <section class="section section--page-section" aria-labelledby="route-title">
      <div class="section-heading">
        <div>
          <span class="eyebrow">ROTEAMENTO SELETIVO</span>
          <h2 id="route-title">Dois caminhos, uma sessão.</h2>
        </div>
        <p>A diferença entre sinalização e mídia é a parte mais importante do projeto.</p>
      </div>

      <div class="flow-diagram">
        <div class="flow-column flow-column--client">
          <span class="flow-column__label">No seu computador</span>
          <div class="flow-node"><span><BaseIcon name="code" :size="18" /></span><strong>Discord</strong><small>cliente desktop</small></div>
          <div class="flow-node flow-node--router"><span><BaseIcon name="route" :size="18" /></span><strong>Roteador local</strong><small>127.0.0.1</small></div>
        </div>
        <div class="flow-column flow-column--paths">
          <div class="flow-connection flow-connection--gateway">
            <span class="flow-connection__line"></span>
            <span class="flow-connection__label"><strong>Gateway</strong><small>via saída alternativa</small></span>
          </div>
          <div class="flow-connection flow-connection--media">
            <span class="flow-connection__line"></span>
            <span class="flow-connection__label"><strong>Áudio e vídeo</strong><small>conexão direta</small></span>
          </div>
        </div>
        <div class="flow-column flow-column--discord">
          <span class="flow-column__label">Nos serviços do Discord</span>
          <div class="flow-node flow-node--gateway"><span><BaseIcon name="signal" :size="18" /></span><strong>Gateway</strong><small>decide o experimento</small></div>
          <div class="flow-node flow-node--media"><span><BaseIcon name="layers" :size="18" /></span><strong>Discord media</strong><small>WebRTC direto</small></div>
        </div>
      </div>
    </section>

    <section class="section section--page-section" aria-labelledby="what-title">
      <div class="section-heading">
        <div>
          <span class="eyebrow">SEM SURPRESAS</span>
          <h2 id="what-title">O que passa e o que não passa.</h2>
        </div>
      </div>
      <div class="comparison-grid">
        <article class="comparison-card comparison-card--yes">
          <div class="comparison-card__title"><span class="icon-frame icon-frame--success"><BaseIcon name="check" :size="18" /></span><h3>Passa pela saída alternativa</h3></div>
          <ul class="feature-list"><li>WebSocket de gateway do Discord</li><li>Sinalização usada para atribuir o experimento</li><li>Hosts necessários para a conexão do gateway</li></ul>
        </article>
        <article class="comparison-card comparison-card--no">
          <div class="comparison-card__title"><span class="icon-frame icon-frame--muted"><BaseIcon name="signal" :size="18" /></span><h3>Continua direto</h3></div>
          <ul class="feature-list"><li>Áudio da chamada</li><li>Vídeo e captura do Go Live</li><li>O restante do tráfego do Discord</li></ul>
        </article>
      </div>
    </section>

    <section class="section section--page-section" aria-labelledby="limits-title">
      <div class="section-heading section-heading--compact">
        <div>
          <span class="eyebrow">LIMITES CONHECIDOS</span>
          <h2 id="limits-title">O bypass não corrige toda falha de transmissão.</h2>
        </div>
        <NuxtLink class="text-link text-link--standalone" to="/faq#black-screen">Ver solução de problemas <BaseIcon name="arrow-right" :size="16" /></NuxtLink>
      </div>
      <div class="limits-grid">
        <article><BaseIcon name="alert" :size="19" /><h3>Reconexão durante uma chamada</h3><p>Uma reconexão de gateway no meio de uma Live pode deixar o vídeo travado até a janela ser recarregada. Por isso, a troca de saída é conservadora.</p></article>
        <article><BaseIcon name="refresh" :size="19" /><h3>Atualizações do Discord</h3><p>O Discord pode instalar uma versão em outra pasta. Quando isso acontece, a injeção precisa ser ativada novamente.</p></article>
        <article><BaseIcon name="lock" :size="19" /><h3>Termos do serviço</h3><p>O projeto é open source. O uso para contornar uma restrição regional pode estar sujeito aos termos do Discord.</p></article>
      </div>
    </section>

    <div class="section section--last">
      <DiscordCta />
    </div>
  </div>
</template>
