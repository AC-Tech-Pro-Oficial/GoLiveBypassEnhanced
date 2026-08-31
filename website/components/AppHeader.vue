<script setup lang="ts">
import type { SiteTheme } from '~/composables/useTheme'

const props = defineProps<{
  theme: SiteTheme
}>()

const emit = defineEmits<{
  'toggle-theme': []
}>()

const menuOpen = ref(false)
const menuButton = ref<HTMLButtonElement | null>(null)
const mobileNav = ref<HTMLElement | null>(null)

const links = [
  { label: 'Downloads', to: '/downloads' },
  { label: 'Instalação', to: '/instalacao' },
  { label: 'Como funciona', to: '/como-funciona' },
  { label: 'FAQ', to: '/faq' },
]

const closeMenu = () => {
  if (!menuOpen.value) return
  menuOpen.value = false
  nextTick(() => menuButton.value?.focus())
}

const toggleMenu = () => {
  menuOpen.value = !menuOpen.value
  if (menuOpen.value) {
    nextTick(() => mobileNav.value?.querySelector<HTMLElement>('a')?.focus())
  }
}

const onKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape' && menuOpen.value) closeMenu()
}

watch(menuOpen, (open: boolean) => {
  if (import.meta.client) document.body.classList.toggle('menu-open', open)
})

onMounted(() => document.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown)
  if (import.meta.client) document.body.classList.remove('menu-open')
})
</script>

<template>
  <header class="site-header">
    <div class="site-container header-inner">
      <NuxtLink class="brand" to="/" aria-label="GoLiveBypass, início" @click="closeMenu">
        <img class="brand-mark" src="/logo.svg" alt="" aria-hidden="true" />
        <span class="brand-name">GoLiveBypass</span>
      </NuxtLink>

      <nav class="site-nav" aria-label="Navegação principal">
        <NuxtLink
          v-for="link in links"
          :key="link.to"
          class="nav-link"
          :to="link.to"
          exact-active-class="nav-link--active"
        >
          {{ link.label }}
        </NuxtLink>
      </nav>

      <div class="header-actions">
        <button
          class="theme-toggle"
          type="button"
          :aria-label="props.theme === 'dark' ? 'Mudar para tema claro' : 'Mudar para tema escuro'"
          @click="emit('toggle-theme')"
        >
          <BaseIcon :name="props.theme === 'dark' ? 'sun' : 'moon'" :size="18" />
        </button>
        <a
          class="header-discord"
          href="https://discord.gg/7cWbtr82rG"
          target="_blank"
          rel="noopener noreferrer"
        >
          <BaseIcon name="discord" :size="17" />
          <span>Comunidade</span>
        </a>
        <button
          ref="menuButton"
          class="menu-toggle"
          type="button"
          :aria-expanded="menuOpen"
          aria-controls="mobile-navigation"
          :aria-label="menuOpen ? 'Fechar menu' : 'Abrir menu'"
          @click="toggleMenu"
        >
          <BaseIcon :name="menuOpen ? 'x' : 'menu'" :size="20" />
        </button>
      </div>
    </div>

    <div v-if="menuOpen" id="mobile-navigation" class="mobile-nav-wrap">
      <nav ref="mobileNav" class="site-container mobile-nav" aria-label="Navegação móvel">
        <NuxtLink
          v-for="link in links"
          :key="link.to"
          class="mobile-nav-link"
          :to="link.to"
          exact-active-class="mobile-nav-link--active"
          @click="closeMenu"
        >
          <span>{{ link.label }}</span>
          <BaseIcon name="arrow-right" :size="17" />
        </NuxtLink>
        <a
          class="mobile-nav-link mobile-nav-link--discord"
          href="https://discord.gg/7cWbtr82rG"
          target="_blank"
          rel="noopener noreferrer"
          @click="closeMenu"
        >
          <span>Comunidade no Discord</span>
          <BaseIcon name="external" :size="16" />
        </a>
      </nav>
    </div>
  </header>
</template>
