<script setup lang="ts">
const props = defineProps<{
  error: {
    statusCode?: number
    statusMessage?: string
  }
}>()

const goHome = () => clearError({ redirect: '/' })
</script>

<template>
  <div class="error-page site-container">
    <span class="eyebrow">{{ props.error.statusCode ?? 404 }} · PÁGINA NÃO ENCONTRADA</span>
    <h1>Este caminho não existe.</h1>
    <p>Volte ao início ou escolha uma instalação pelo menu principal.</p>
    <button class="button button--primary" type="button" @click="goHome">
      <BaseIcon name="arrow-right" :size="17" />
      Voltar ao início
    </button>
  </div>
</template>
