<script setup lang="ts">
import type { IconName } from './BaseIcon.vue'

defineProps<{
  icon: IconName
  eyebrow: string
  title: string
  description: string
  linkLabel: string
  to: string
}>()
</script>

<template>
  <NuxtLink class="path-card" :to="to">
    <div class="path-card__top">
      <span class="icon-frame"><BaseIcon :name="icon" :size="20" /></span>
      <span class="path-card__eyebrow">{{ eyebrow }}</span>
    </div>
    <h3>{{ title }}</h3>
    <p>{{ description }}</p>
    <span class="text-link">
      {{ linkLabel }}
      <BaseIcon name="arrow-right" :size="16" />
    </span>
  </NuxtLink>
</template>
