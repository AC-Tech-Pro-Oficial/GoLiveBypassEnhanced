<script setup lang="ts">
import type { IconName } from './BaseIcon.vue'

export type Platform = 'windows' | 'macos' | 'linux'

defineProps<{
  modelValue: Platform
}>()

const emit = defineEmits<{
  'update:modelValue': [value: Platform]
}>()

const platforms: Array<{ id: Platform; label: string; icon: IconName }> = [
  { id: 'windows', label: 'Windows', icon: 'windows' },
  { id: 'macos', label: 'macOS', icon: 'apple' },
  { id: 'linux', label: 'Linux', icon: 'linux' },
]
</script>

<template>
  <div class="platform-tabs" role="tablist" aria-label="Escolha o sistema operacional">
    <button
      v-for="platform in platforms"
      :id="`platform-tab-${platform.id}`"
      :key="platform.id"
      class="platform-tab"
      :class="{ 'platform-tab--active': modelValue === platform.id }"
      type="button"
      role="tab"
      :aria-selected="modelValue === platform.id"
      :aria-controls="`platform-panel-${platform.id}`"
      @click="emit('update:modelValue', platform.id)"
    >
      <BaseIcon :name="platform.icon" :size="17" />
      <span>{{ platform.label }}</span>
    </button>
  </div>
</template>
