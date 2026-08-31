<template>
  <section class="discord-cta" aria-labelledby="discord-cta-title">
    <div class="discord-cta__mark"><BaseIcon name="discord" :size="25" /></div>
    <div class="discord-cta__copy">
      <span class="eyebrow">SUPORTE DA COMUNIDADE</span>
      <h2 id="discord-cta-title">Quando a documentação não basta.</h2>
      <p>Converse com quem usa o projeto, compartilhe seu diagnóstico e encontre ajuda no servidor da comunidade.</p>
    </div>
    <a
      class="button button--discord"
      href="https://discord.gg/7cWbtr82rG"
      target="_blank"
      rel="noopener noreferrer"
    >
      <span>Entrar no Discord</span>
      <BaseIcon name="external" :size="16" />
    </a>
  </section>
</template>
