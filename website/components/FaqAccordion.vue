<script setup lang="ts">
defineProps<{
  id: string
  question: string
}>()

const open = ref(false)
</script>

<template>
  <div class="faq-item" :class="{ 'faq-item--open': open }">
    <h3>
      <button
        class="faq-trigger"
        type="button"
        :aria-expanded="open"
        :aria-controls="`${id}-answer`"
        @click="open = !open"
      >
        <span>{{ question }}</span>
        <BaseIcon :name="open ? 'minus' : 'plus'" :size="18" />
      </button>
    </h3>
    <div v-show="open" :id="`${id}-answer`" class="faq-answer">
      <slot />
    </div>
  </div>
</template>
