<script setup lang="ts">
useSeoMeta({
  title: 'Perguntas frequentes',
  description:
    'Respostas sobre instalação, compatibilidade, tela preta, atualizações e uso do GoLiveBypass.',
  ogTitle: 'FAQ — GoLiveBypass',
  ogDescription: 'Encontre respostas antes ou depois de instalar o GoLiveBypass.',
  ogUrl: 'https://golivebypass.dev/faq',
})
</script>

<template>
  <div class="page-wrap site-container">
    <PageIntro
      eyebrow="DÚVIDAS FREQUENTES"
      title="Respostas diretas para o que costuma travar."
      description="Se a resposta não estiver aqui, a comunidade pode ajudar com seu sistema, versão do Discord e registro do bypass."
    />

    <div class="faq-layout">
      <aside class="faq-index" aria-label="Índice da FAQ">
        <span class="footer-label">Nesta página</span>
        <a href="#instalacao">Instalação</a>
        <a href="#compatibilidade">Compatibilidade</a>
        <a href="#transmissao">Transmissão</a>
        <a href="#suporte">Suporte</a>
      </aside>

      <div class="faq-groups">
        <section id="instalacao" class="faq-group" aria-labelledby="faq-install-title">
          <div class="faq-group__heading">
            <span class="eyebrow">01 · INSTALAÇÃO</span>
            <h2 id="faq-install-title">Começar sem conflito</h2>
          </div>
          <div class="faq-list">
            <FaqAccordion id="which-path" question="Qual opção devo instalar?">
              <p>Use a <NuxtLink to="/downloads">GUI</NuxtLink> se quiser uma janela para ativar o bypass. Use o instalador de terminal se preferir acompanhar os comandos. Se você usa Vencord ou Equicord, escolha o plugin. Se usa o Discord puro, escolha o standalone.</p>
            </FaqAccordion>
            <FaqAccordion id="mod" question="Posso usar o standalone com Vencord ou Equicord?">
              <p>Não é o caminho recomendado. O standalone ocupa o lugar do mod dentro do Discord e pode remover outros plugins. Quem já usa Vencord ou Equicord deve instalar o plugin correspondente.</p>
            </FaqAccordion>
            <FaqAccordion id="linux-appimage" question="Como abro o AppImage no Linux?">
              <p>Depois de baixar, dê permissão de execução com <code>chmod +x GoLiveBypass-*.AppImage</code> e abra o arquivo. Se o sistema não tiver FUSE, consulte a orientação de execução alternativa na documentação do Linux.</p>
            </FaqAccordion>
            <FaqAccordion id="macos-permission" question="O macOS bloqueou o aplicativo. O que faço?">
              <p>Abra o aplicativo com o botão direito e escolha <strong>Abrir</strong>. Se o bloqueio continuar, vá em Privacidade e Segurança. Na primeira ativação, o macOS também pode pedir autorização em Administração de Apps para permitir a alteração do Discord.</p>
            </FaqAccordion>
          </div>
        </section>

        <section id="compatibilidade" class="faq-group" aria-labelledby="faq-compat-title">
          <div class="faq-group__heading">
            <span class="eyebrow">02 · COMPATIBILIDADE</span>
            <h2 id="faq-compat-title">Escolher o caminho certo</h2>
          </div>
          <div class="faq-list">
            <FaqAccordion id="requirements" question="Preciso instalar Node, pnpm ou Git?">
              <p>Não para a GUI ou para o standalone. O instalador do plugin pode trabalhar com um checkout do Vencord ou Equicord e, nesse caso, segue os requisitos do próprio mod. A página de instalação separa os cenários.</p>
            </FaqAccordion>
            <FaqAccordion id="update" question="O que acontece quando o Discord atualiza?">
              <p>O Discord pode criar uma pasta nova para a versão atualizada e deixar a injeção na pasta antiga. Reative o bypass pela GUI ou rode o instalador novamente. A instalação não deve ser tratada como permanente contra atualizações do cliente.</p>
            </FaqAccordion>
            <FaqAccordion id="flatpak" question="Funciona com Discord instalado por Flatpak?">
              <p>O projeto documenta o uso com Flatpak do sistema e do usuário. A primeira ativação pode pedir uma permissão extra para que o Discord encontre os arquivos do bypass. Atualizações do Flatpak podem exigir nova ativação.</p>
            </FaqAccordion>
            <FaqAccordion id="beta" question="Onde encontro versões beta?"><p>O site aponta para a release estável configurada. Versões de teste são publicadas como prerelease no GitHub e devem ser usadas apenas quando a documentação ou o mantenedor indicar.</p></FaqAccordion>
          </div>
        </section>

        <section id="transmissao" class="faq-group" aria-labelledby="faq-live-title">
          <div class="faq-group__heading">
            <span class="eyebrow">03 · TRANSMISSÃO</span>
            <h2 id="faq-live-title">Quando a Live não carrega</h2>
          </div>
          <div class="faq-list">
            <FaqAccordion id="proxy" question="A mídia passa pela proxy?">
              <p>Não. O projeto roteia apenas a sinalização do gateway do Discord. O áudio e o vídeo do Go Live continuam em conexão direta, como no uso normal do Discord.</p>
            </FaqAccordion>
            <FaqAccordion id="black-screen" question="O Go Live ficou com a tela preta. O que faço?">
              <p>Primeiro consulte o status e tente recarregar o Discord com <kbd>Ctrl + R</kbd> no Windows/Linux ou <kbd>Cmd + R</kbd> no macOS. Se você estiver no meio de uma chamada, leia a orientação de recuperação antes de recarregar, porque uma reconexão pode interromper a mídia.</p>
            </FaqAccordion>
            <FaqAccordion id="region" question="Preciso escolher uma região de voz específica?">
              <p>Não force a região Brazil quando estiver testando uma transmissão. A mídia é direta e pode seguir regras diferentes da sinalização. Se o problema persistir, registre a versão, o sistema e o diagnóstico sem compartilhar sua senha ou a URL completa da proxy.</p>
            </FaqAccordion>
            <FaqAccordion id="direct" question="O que significa “conexão direta”?">
              <p>Significa que o áudio e o vídeo não são enviados pelo roteador do bypass. A saída alternativa é reservada para os hosts de gateway usados na sinalização.</p>
            </FaqAccordion>
          </div>
        </section>

        <section id="suporte" class="faq-group" aria-labelledby="faq-support-title">
          <div class="faq-group__heading">
            <span class="eyebrow">04 · SUPORTE</span>
            <h2 id="faq-support-title">Ainda ficou diferente?</h2>
          </div>
          <div class="support-note">
            <div class="support-note__icon"><BaseIcon name="discord" :size="23" /></div>
            <div>
              <h3>Leve um diagnóstico útil para a comunidade.</h3>
              <p>Informe o sistema operacional, o caminho de instalação, a versão do Discord e o trecho relevante do log. Nunca envie tokens, senhas ou a URL completa da sua proxy.</p>
              <a class="button button--discord button--small" href="https://discord.gg/7cWbtr82rG" target="_blank" rel="noopener noreferrer">Entrar no Discord <BaseIcon name="external" :size="15" /></a>
            </div>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>
