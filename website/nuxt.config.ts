export default defineNuxtConfig({
  devtools: { enabled: false },
  css: ['~/assets/css/main.css'],
  typescript: {
    strict: true,
    typeCheck: true,
  },
  nitro: {
    preset: 'static',
  },
  app: {
    head: {
      htmlAttrs: {
        lang: 'pt-BR',
      },
      meta: [
        {
          name: 'theme-color',
          content: '#0F0F12',
        },
        {
          name: 'description',
          content:
            'Escolha como instalar o GoLiveBypass: GUI para Windows, macOS e Linux, CLI, standalone ou plugin.',
        },
      ],
      link: [
        {
          rel: 'icon',
          type: 'image/svg+xml',
          href: '/favicon.svg',
        },
      ],
      script: [
        {
          innerHTML: `try {
  var savedTheme = localStorage.getItem('golivebypass-theme');
  document.documentElement.dataset.theme = savedTheme === 'light' ? 'light' : 'dark';
} catch (error) {
  document.documentElement.dataset.theme = 'dark';
}`,
          tagPosition: 'head',
        },
      ],
    },
  },
})
