<script setup lang="ts">
import type { IconName } from './BaseIcon.vue'

defineProps<{
  icon: IconName
  kicker: string
  title: string
  description: string
  platform: string
  tuiCommand: string
  directCommand: string
  directNote: string
  tone?: 'default' | 'success' | 'discord' | 'warning'
}>()
</script>

<template>
  <article class="command-path-card" :class="`command-path-card--${tone ?? 'default'}`">
    <div class="command-path-card__intro">
      <span class="icon-frame"><BaseIcon :name="icon" :size="21" /></span>
      <div>
        <span class="command-path-card__kicker">{{ kicker }}</span>
        <h3>{{ title }}</h3>
        <p>{{ description }}</p>
      </div>
    </div>

    <div class="command-path-card__commands">
      <InstallCommand
        label="Com TUI"
        :platform="`${platform} · interativo`"
        :command="tuiCommand"
      />
      <InstallCommand
        label="Sem TUI"
        :platform="`${platform} · automático`"
        :command="directCommand"
      />
    </div>

    <p class="command-path-card__note">
      <BaseIcon name="alert" :size="14" />
      {{ directNote }}
    </p>
  </article>
</template>
