<script setup lang="ts">
const props = defineProps<{
  label: string
  platform: string
  command: string
}>()

const copied = ref(false)
const copyMessage = ref('Copiar comando')
let resetTimer: ReturnType<typeof setTimeout> | undefined

const copyCommand = async () => {
  if (import.meta.server) return

  let copiedSuccessfully = false
  try {
    await navigator.clipboard.writeText(props.command)
    copiedSuccessfully = true
  } catch {
    const helper = document.createElement('textarea')
    helper.value = props.command
    helper.setAttribute('readonly', '')
    helper.style.position = 'fixed'
    helper.style.opacity = '0'
    document.body.appendChild(helper)
    helper.select()
    try {
      copiedSuccessfully = document.execCommand('copy')
    } catch {
      copiedSuccessfully = false
    }
    helper.remove()
  }

  if (resetTimer) clearTimeout(resetTimer)
  copied.value = copiedSuccessfully
  copyMessage.value = copiedSuccessfully ? 'Comando copiado' : 'Selecione o comando'
  resetTimer = setTimeout(() => {
    copied.value = false
    copyMessage.value = 'Copiar comando'
  }, 2600)
}

onBeforeUnmount(() => {
  if (resetTimer) clearTimeout(resetTimer)
})
</script>

<template>
  <div class="command-block">
    <div class="command-block__heading">
      <div>
        <span class="command-block__label">{{ label }}</span>
        <span class="command-block__platform">{{ platform }}</span>
      </div>
      <button class="copy-button" type="button" :aria-label="copyMessage" @click="copyCommand">
        <BaseIcon :name="copied ? 'check' : 'copy'" :size="15" />
        <span>{{ copyMessage }}</span>
      </button>
    </div>
    <pre class="command-block__code"><code>{{ command }}</code></pre>
    <p class="sr-only" aria-live="polite">{{ copyMessage }}</p>
  </div>
</template>
