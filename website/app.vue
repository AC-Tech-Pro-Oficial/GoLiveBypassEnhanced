<script setup lang="ts">
const { theme, initTheme, toggleTheme } = useTheme()
const route = useRoute()

useHead(() => ({
  titleTemplate: (title) => (title ? `${title} — GoLiveBypass` : 'GoLiveBypass'),
  link: [
    {
      rel: 'canonical',
      href: `https://golivebypass.dev${route.path === '/' ? '/' : route.path}`,
    },
  ],
  meta: [
    {
      name: 'theme-color',
      content: theme.value === 'dark' ? '#0F0F12' : '#F7F6F3',
    },
  ],
}))

onMounted(() => {
  initTheme()
})
</script>

<template>
  <div class="site">
    <div class="site-ambient" aria-hidden="true"></div>
    <AppHeader :theme="theme" @toggle-theme="toggleTheme" />
    <main class="site-main">
      <NuxtPage />
    </main>
    <AppFooter />
  </div>
</template>
