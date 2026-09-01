<script setup lang="ts">
import { release } from '~/data/release'
import type { SiteTheme } from '~/composables/useTheme'

type NetworkMode = 'tor' | 'free' | 'manual'

const { theme, applyTheme } = useTheme()

const selectedMode = ref<NetworkMode>('tor')
const startupEnabled = ref(false)
const autoUpdateEnabled = ref(true)
const autoReviveEnabled = ref(true)
const betaEnabled = ref(false)
const settingsOpen = ref(false)
const manualProxy = ref('')
const proxyTested = ref(false)
const settingsButton = ref<HTMLButtonElement | null>(null)
const settingsClose = ref<HTMLButtonElement | null>(null)

const modes: Array<{
  id: NetworkMode
  label: string
  hint: string
  badge?: string
  badgeClass?: string
}> = [
  { id: 'tor', label: 'Tor', hint: 'sempre, baixa sozinho', badge: 'recomendado', badgeClass: 'reco' },
  { id: 'free', label: 'Gratuitas', hint: 'proxies da lista', badge: 'instável', badgeClass: 'insta' },
  { id: 'manual', label: 'Personalizado', hint: 'VPS / proxy' },
]

const modeStatus = computed(() => {
  if (selectedMode.value === 'tor') return 'Tor será baixado automaticamente ao ativar.'
  if (selectedMode.value === 'free') return 'Proxies públicas serão testadas pela GUI.'
  return 'A sua saída SOCKS5 fica visível e pode ser testada na GUI.'
})

function selectMode(mode: NetworkMode) {
  selectedMode.value = mode
  proxyTested.value = false
}

function openSettings() {
  settingsOpen.value = true
}

function closeSettings() {
  settingsOpen.value = false
}

function handleSettingsKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') closeSettings()
}

function setViewerTheme(nextTheme: SiteTheme) {
  applyTheme(nextTheme)
}

watch(settingsOpen, async (open: boolean) => {
  await nextTick()
  if (open) settingsClose.value?.focus()
  else settingsButton.value?.focus()
})
</script>

<template>
  <section class="gui-viewer" aria-label="Prévia interativa da GUI do GoLiveBypass">
    <div class="gui-viewer__chrome">
      <div class="gui-viewer__dots" aria-hidden="true">
        <span></span><span></span><span></span>
      </div>
      <span class="gui-viewer__chrome-caption">GoLiveBypass</span>
      <button
        ref="settingsButton"
        class="gui-viewer__icon-btn"
        type="button"
        aria-label="Abrir configurações da prévia"
        @click="openSettings"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      </button>
    </div>

    <div class="gui-viewer__surface">
      <header class="gui-viewer__header">
        <div class="gui-viewer__wordmark-group">
          <span class="gui-viewer__wordmark">
            <img src="/logo.svg" alt="" aria-hidden="true" draggable="false" />
            GoLiveBypass
          </span>
          <span class="gui-viewer__meta">Go Live · Brasil · v{{ release.version }}</span>
        </div>
        <p class="gui-viewer__tagline">
          Devolve o Go Live e a câmera no Discord, no Brasil.
        </p>
      </header>

      <div class="gui-viewer__status-card" role="status" aria-live="polite">
        <span class="gui-viewer__status-indicator" aria-hidden="true"></span>
        <span>Discord limpo. Pronto para injetar.</span>
        <span class="gui-viewer__status-tag">Pronto</span>
      </div>

      <NuxtLink class="gui-viewer__toggle-btn" to="/downloads#gui">
        <BaseIcon name="download" :size="18" />
        <span>Baixar GUI</span>
      </NuxtLink>

      <label class="gui-viewer__switch">
        <input v-model="startupEnabled" type="checkbox" />
        <span class="gui-viewer__switch-track" aria-hidden="true">
          <span class="gui-viewer__switch-thumb"></span>
        </span>
        <span>Iniciar com o sistema</span>
      </label>

      <div class="gui-viewer__net-mode">
        <div class="gui-viewer__segmented" role="radiogroup" aria-label="Rede de saída">
          <button
            v-for="mode in modes"
            :key="mode.id"
            class="gui-viewer__seg-btn"
            :class="{ 'gui-viewer__seg-btn--active': selectedMode === mode.id }"
            type="button"
            role="radio"
            :aria-checked="selectedMode === mode.id"
            @click="selectMode(mode.id)"
          >
            <span
              v-if="mode.badge"
              class="gui-viewer__seg-badge"
              :class="`gui-viewer__seg-badge--${mode.badgeClass}`"
              aria-hidden="true"
            >{{ mode.badge }}</span>
            <span class="gui-viewer__seg-label">{{ mode.label }}</span>
            <span class="gui-viewer__seg-hint">{{ mode.hint }}</span>
          </button>
        </div>

        <small class="gui-viewer__mode-status" aria-live="polite">{{ modeStatus }}</small>

        <div v-if="selectedMode === 'manual'" class="gui-viewer__proxy-group">
          <div class="gui-viewer__float-field">
            <input
              id="gui-viewer-proxy"
              v-model="manualProxy"
              type="text"
              placeholder=" "
              spellcheck="false"
              autocomplete="off"
              aria-describedby="gui-viewer-proxy-help"
            />
            <label for="gui-viewer-proxy">socks5://host:porta</label>
          </div>
          <div class="gui-viewer__proxy-actions">
            <button
              class="gui-viewer__proxy-test"
              type="button"
              @click="proxyTested = true"
            >
              Testar conexão
            </button>
            <small id="gui-viewer-proxy-help" class="gui-viewer__proxy-status" aria-live="polite">
              {{ proxyTested ? 'Prévia: a GUI instalada fará o teste até o gateway.' : 'Use uma saída estável fora do Brasil.' }}
            </small>
          </div>
          <details class="gui-viewer__vps-guide">
            <summary>Como montar uma VPS (saída estável)</summary>
            <p>Na GUI real, este guia explica como configurar uma saída SOCKS5 própria.</p>
          </details>
        </div>
      </div>

      <footer class="gui-viewer__footer">
        <p>Prévia da GUI real. O download abre a instalação para o seu sistema.</p>
      </footer>
    </div>

    <div v-if="settingsOpen" class="gui-viewer__settings-dialog" role="dialog" aria-modal="true" aria-labelledby="gui-viewer-settings-title" @keydown="handleSettingsKeydown">
      <button
        class="gui-viewer__settings-backdrop"
        type="button"
        aria-label="Fechar configurações"
        @click="closeSettings"
      ></button>
      <div class="gui-viewer__settings-panel" role="document" @click.stop>
        <h2 id="gui-viewer-settings-title">Configurações</h2>

        <div class="gui-viewer__settings-group">
          <span class="gui-viewer__settings-label" id="gui-viewer-theme-label">Tema</span>
          <div class="gui-viewer__theme-options" role="radiogroup" aria-labelledby="gui-viewer-theme-label">
            <button
              class="gui-viewer__theme-option"
              :class="{ 'gui-viewer__theme-option--active': theme === 'light' }"
              type="button"
              role="radio"
              :aria-checked="theme === 'light'"
              @click="setViewerTheme('light')"
            >
              <BaseIcon name="sun" :size="17" />
              <span>Claro</span>
            </button>
            <button
              class="gui-viewer__theme-option"
              :class="{ 'gui-viewer__theme-option--active': theme === 'dark' }"
              type="button"
              role="radio"
              :aria-checked="theme === 'dark'"
              @click="setViewerTheme('dark')"
            >
              <BaseIcon name="moon" :size="17" />
              <span>Escuro</span>
            </button>
          </div>
        </div>

        <label class="gui-viewer__settings-switch">
          <input v-model="autoUpdateEnabled" type="checkbox" />
          <span class="gui-viewer__switch-track" aria-hidden="true"><span class="gui-viewer__switch-thumb"></span></span>
          <span>Avisar sobre atualizações</span>
        </label>
        <p class="gui-viewer__settings-hint">Avisa quando sai uma versão nova do GoLiveBypass.</p>

        <label class="gui-viewer__settings-switch">
          <input v-model="autoReviveEnabled" type="checkbox" />
          <span class="gui-viewer__switch-track" aria-hidden="true"><span class="gui-viewer__switch-thumb"></span></span>
          <span>Reviver gateway travado automaticamente</span>
        </label>
        <p class="gui-viewer__settings-hint">Reconecta um gateway travado sem recarregar durante uma transmissão.</p>

        <label class="gui-viewer__settings-switch">
          <input v-model="betaEnabled" type="checkbox" />
          <span class="gui-viewer__switch-track" aria-hidden="true"><span class="gui-viewer__switch-thumb"></span></span>
          <span>Participar dos testes (canal beta)</span>
        </label>
        <p class="gui-viewer__settings-hint">A opção real permite receber versões de teste pelo próprio app.</p>

        <button ref="settingsClose" class="gui-viewer__settings-close" type="button" @click="closeSettings">
          Fechar
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.gui-viewer {
  --gui-canvas: #0f0f12;
  --gui-surface: #1a1a1f;
  --gui-surface-muted: #232329;
  --gui-ink: #e6e6ea;
  --gui-ink-strong: #f5f5f7;
  --gui-muted: #a6a6b0;
  --gui-faint: #6f6f7a;
  --gui-line: #26262d;
  --gui-line-strong: #34343c;
  --gui-ok-bg: #16301b;
  --gui-ok-ink: #7bc98c;
  --gui-warn-bg: #33290e;
  --gui-warn-ink: #e8c16a;
  --gui-go-bg: #bce0bf;
  --gui-go-ink: #0f3318;
  --gui-go-hover: #aed8b2;
  --gui-discord: #8e97ff;
  --gui-radius-sm: 8px;
  --gui-radius-md: 12px;
  --gui-radius-full: 9999px;
  --gui-ease: cubic-bezier(0.16, 1, 0.3, 1);
  position: relative;
  isolation: isolate;
  width: min(100%, 380px);
  overflow: hidden;
  border: 1px solid var(--gui-line-strong);
  border-radius: 16px;
  background: var(--gui-canvas);
  color: var(--gui-ink);
  box-shadow: 0 12px 34px rgba(0, 0, 0, 0.22);
  color-scheme: dark;
}

:global(html[data-theme='light']) .gui-viewer {
  --gui-canvas: #f7f6f3;
  --gui-surface: #ffffff;
  --gui-surface-muted: #f1f0ee;
  --gui-ink: #2f3437;
  --gui-ink-strong: #111111;
  --gui-muted: #6e6c68;
  --gui-faint: #a8a29e;
  --gui-line: #eaeaea;
  --gui-line-strong: #d9d9d7;
  --gui-ok-bg: #edf3ec;
  --gui-ok-ink: #346538;
  --gui-warn-bg: #fbf3db;
  --gui-warn-ink: #956400;
  --gui-go-bg: #cfe8d0;
  --gui-go-ink: #1e5b28;
  --gui-go-hover: #c1e0c3;
  --gui-discord: #5865f2;
  color-scheme: light;
}

.gui-viewer,
.gui-viewer * {
  box-sizing: border-box;
}

.gui-viewer button,
.gui-viewer input,
.gui-viewer summary {
  font: inherit;
}

.gui-viewer button,
.gui-viewer a,
.gui-viewer summary {
  -webkit-tap-highlight-color: transparent;
}

.gui-viewer button:focus-visible,
.gui-viewer a:focus-visible,
.gui-viewer input:focus-visible + .gui-viewer__switch-track {
  outline: 2px solid var(--gui-ink-strong);
  outline-offset: 3px;
}

.gui-viewer__chrome {
  display: flex;
  height: 38px;
  align-items: center;
  gap: 7px;
  padding: 0 12px 0 16px;
  border-bottom: 1px solid var(--gui-line);
  background: var(--gui-surface-muted);
}

.gui-viewer__dots {
  display: flex;
  gap: 6px;
}

.gui-viewer__dots span {
  display: block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--gui-line-strong);
}

.gui-viewer__chrome-caption {
  margin-left: 4px;
  color: var(--gui-faint);
  font-family: var(--mono);
  font-size: 9px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.gui-viewer__icon-btn {
  display: grid;
  width: 36px;
  height: 36px;
  margin-left: auto;
  place-items: center;
  border: 1px solid transparent;
  border-radius: var(--gui-radius-full);
  background: transparent;
  color: var(--gui-muted);
  cursor: pointer;
  transition: background 180ms var(--gui-ease), border-color 180ms var(--gui-ease), color 180ms var(--gui-ease), transform 180ms var(--gui-ease);
}

.gui-viewer__icon-btn svg {
  width: 17px;
  height: 17px;
}

.gui-viewer__icon-btn:hover {
  border-color: var(--gui-line-strong);
  background: var(--gui-surface);
  color: var(--gui-ink);
}

.gui-viewer__icon-btn:active,
.gui-viewer__proxy-test:active,
.gui-viewer__settings-close:active {
  transform: scale(0.96);
}

.gui-viewer__surface {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 26px 28px 22px;
}

.gui-viewer__header {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.gui-viewer__wordmark-group {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 7px;
}

.gui-viewer__wordmark {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  color: var(--gui-ink-strong);
  font-size: 24px;
  font-weight: 700;
  letter-spacing: -0.03em;
  line-height: 1.05;
}

.gui-viewer__wordmark img {
  flex: 0 0 auto;
  width: 24px;
  height: 24px;
  border-radius: 6px;
}

.gui-viewer__meta {
  color: var(--gui-faint);
  font-family: var(--mono);
  font-size: 9.5px;
  letter-spacing: 0.14em;
  line-height: 1.3;
  text-transform: uppercase;
}

.gui-viewer__tagline {
  max-width: 30ch;
  color: var(--gui-muted);
  font-size: 13.5px;
  line-height: 1.6;
}

.gui-viewer__status-card {
  display: flex;
  min-height: 52px;
  align-items: center;
  gap: 10px;
  padding: 13px 15px;
  border: 1px solid var(--gui-line);
  border-radius: var(--gui-radius-md);
  background: var(--gui-surface);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.22), 0 6px 18px rgba(0, 0, 0, 0.12);
  color: var(--gui-ink);
  font-size: 12.5px;
  line-height: 1.4;
}

:global(html[data-theme='light']) .gui-viewer__status-card {
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04), 0 4px 12px rgba(0, 0, 0, 0.06);
}

.gui-viewer__status-indicator {
  flex: 0 0 auto;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--gui-ok-ink);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--gui-ok-ink) 15%, transparent);
}

.gui-viewer__status-tag {
  margin-left: auto;
  padding: 3px 8px;
  border-radius: var(--gui-radius-full);
  background: var(--gui-ok-bg);
  color: var(--gui-ok-ink);
  font-family: var(--mono);
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.08em;
  line-height: 1.3;
  text-transform: uppercase;
}

.gui-viewer__toggle-btn {
  display: flex;
  min-height: 52px;
  align-items: center;
  justify-content: center;
  gap: 9px;
  border: 1px solid transparent;
  border-radius: var(--gui-radius-sm);
  background: var(--gui-go-bg);
  color: var(--gui-go-ink);
  font-size: 15px;
  font-weight: 600;
  line-height: 1.2;
  text-decoration: none;
  transition: background 200ms var(--gui-ease), transform 180ms var(--gui-ease), filter 180ms var(--gui-ease);
}

.gui-viewer__toggle-btn:hover {
  background: var(--gui-go-hover);
}

.gui-viewer__toggle-btn:active {
  transform: scale(0.98);
}

.gui-viewer__toggle-btn :deep(.base-icon) {
  flex: 0 0 auto;
}

.gui-viewer__switch,
.gui-viewer__settings-switch {
  position: relative;
  display: flex;
  min-height: 44px;
  align-items: center;
  justify-content: center;
  gap: 9px;
  color: var(--gui-muted);
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  user-select: none;
}

.gui-viewer__switch input,
.gui-viewer__settings-switch input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
}

.gui-viewer__switch-track {
  position: relative;
  flex: 0 0 auto;
  width: 34px;
  height: 19px;
  border: 1px solid var(--gui-line-strong);
  border-radius: var(--gui-radius-full);
  background: var(--gui-surface-muted);
  transition: background 200ms var(--gui-ease), border-color 200ms var(--gui-ease);
}

.gui-viewer__switch-thumb {
  position: absolute;
  top: 1px;
  left: 1px;
  width: 15px;
  height: 15px;
  border: 1px solid var(--gui-line-strong);
  border-radius: 50%;
  background: var(--gui-surface);
  transition: transform 200ms var(--gui-ease);
}

.gui-viewer__switch input:checked + .gui-viewer__switch-track,
.gui-viewer__settings-switch input:checked + .gui-viewer__switch-track {
  border-color: var(--gui-ink-strong);
  background: var(--gui-ink-strong);
}

.gui-viewer__switch input:checked + .gui-viewer__switch-track .gui-viewer__switch-thumb,
.gui-viewer__settings-switch input:checked + .gui-viewer__switch-track .gui-viewer__switch-thumb {
  transform: translateX(15px);
}

.gui-viewer__switch input:checked + .gui-viewer__switch-track .gui-viewer__switch-thumb {
  background: var(--gui-canvas);
}

.gui-viewer__net-mode {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 2px 0 0;
}

.gui-viewer__segmented {
  display: flex;
  gap: 4px;
  padding: 4px;
  border: 1px solid var(--gui-line-strong);
  border-radius: 14px;
  background: var(--gui-surface);
}

.gui-viewer__seg-btn {
  position: relative;
  display: flex;
  min-width: 0;
  min-height: 52px;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  padding: 8px 5px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: var(--gui-muted);
  cursor: pointer;
  transition: background 180ms var(--gui-ease), color 180ms var(--gui-ease), box-shadow 180ms var(--gui-ease);
}

.gui-viewer__seg-btn:hover {
  background: color-mix(in srgb, var(--gui-muted) 10%, transparent);
  color: var(--gui-ink);
}

.gui-viewer__seg-btn--active {
  background: var(--gui-ink-strong);
  color: var(--gui-canvas);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.18);
}

.gui-viewer__seg-badge {
  position: absolute;
  top: -9px;
  left: 50%;
  padding: 2.5px 6px;
  border: 1px solid currentColor;
  border-radius: var(--gui-radius-full);
  background: var(--gui-surface);
  font-size: 8px;
  font-weight: 700;
  letter-spacing: 0.06em;
  line-height: 1;
  pointer-events: none;
  text-transform: uppercase;
  transform: translateX(-50%);
  white-space: nowrap;
  z-index: 2;
}

.gui-viewer__seg-badge--reco {
  color: var(--gui-ok-ink);
}

.gui-viewer__seg-badge--insta {
  color: var(--gui-warn-ink);
}

.gui-viewer__seg-label {
  font-size: 11px;
  font-weight: 700;
  line-height: 1.1;
}

.gui-viewer__seg-hint {
  max-width: 100%;
  overflow: hidden;
  font-size: 8px;
  line-height: 1.1;
  opacity: 0.72;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.gui-viewer__mode-status,
.gui-viewer__proxy-status {
  min-height: 15px;
  color: var(--gui-faint);
  font-size: 10.5px;
  line-height: 1.35;
}

.gui-viewer__proxy-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.gui-viewer__float-field {
  position: relative;
}

.gui-viewer__float-field input {
  width: 100%;
  min-height: 48px;
  padding: 15px 12px 6px;
  border: 1px solid var(--gui-line-strong);
  border-radius: var(--gui-radius-sm);
  outline: 0;
  background: var(--gui-surface);
  color: var(--gui-ink);
  font-family: var(--mono);
  font-size: 11px;
  transition: border-color 180ms var(--gui-ease), box-shadow 180ms var(--gui-ease);
}

.gui-viewer__float-field label {
  position: absolute;
  top: 50%;
  left: 12px;
  color: var(--gui-faint);
  font-family: var(--mono);
  font-size: 11px;
  pointer-events: none;
  transform: translateY(-50%);
  transition: top 160ms var(--gui-ease), color 160ms var(--gui-ease), font-size 160ms var(--gui-ease);
}

.gui-viewer__float-field input:focus,
.gui-viewer__float-field input:not(:placeholder-shown) {
  border-color: var(--gui-ink-strong);
}

.gui-viewer__float-field input:focus {
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--gui-ink-strong) 10%, transparent);
}

.gui-viewer__float-field input:focus + label,
.gui-viewer__float-field input:not(:placeholder-shown) + label {
  top: 7px;
  color: var(--gui-muted);
  font-size: 8px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.gui-viewer__proxy-actions {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.gui-viewer__proxy-test {
  align-self: flex-start;
  min-height: 40px;
  padding: 0 12px;
  border: 1px solid var(--gui-line-strong);
  border-radius: var(--gui-radius-sm);
  background: var(--gui-surface);
  color: var(--gui-ink);
  cursor: pointer;
  font-size: 11px;
  font-weight: 600;
  transition: background 160ms var(--gui-ease), border-color 160ms var(--gui-ease), transform 160ms var(--gui-ease);
}

.gui-viewer__proxy-test:hover {
  border-color: var(--gui-ink-strong);
  background: var(--gui-surface-muted);
}

.gui-viewer__vps-guide {
  padding: 9px 10px;
  border: 1px dashed var(--gui-line-strong);
  border-radius: var(--gui-radius-sm);
  background: transparent;
}

.gui-viewer__vps-guide summary {
  color: var(--gui-muted);
  cursor: pointer;
  font-size: 11px;
  font-weight: 600;
  list-style: none;
}

.gui-viewer__vps-guide summary::-webkit-details-marker {
  display: none;
}

.gui-viewer__vps-guide summary::before {
  content: '+ ';
  font-family: var(--mono);
  opacity: 0.6;
}

.gui-viewer__vps-guide[open] summary::before {
  content: '− ';
}

.gui-viewer__vps-guide p {
  margin-top: 8px;
  color: var(--gui-faint);
  font-size: 10.5px;
  line-height: 1.45;
}

.gui-viewer__footer {
  padding-top: 2px;
  text-align: center;
}

.gui-viewer__footer p {
  color: var(--gui-faint);
  font-size: 10px;
  line-height: 1.5;
}

.gui-viewer__settings-dialog {
  position: absolute;
  z-index: 40;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 18px;
}

.gui-viewer__settings-backdrop {
  position: absolute;
  inset: 0;
  border: 0;
  background: rgba(0, 0, 0, 0.56);
  cursor: pointer;
}

.gui-viewer__settings-panel {
  position: relative;
  z-index: 1;
  width: 100%;
  max-height: 100%;
  overflow: auto;
  padding: 18px 16px 14px;
  border: 1px solid var(--gui-line-strong);
  border-radius: var(--gui-radius-md);
  background: var(--gui-surface);
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.28);
  animation: gui-viewer-settings-in 220ms var(--gui-ease);
}

@keyframes gui-viewer-settings-in {
  from { opacity: 0; transform: translateY(6px) scale(0.98); }
  to { opacity: 1; transform: none; }
}

.gui-viewer__settings-panel h2 {
  color: var(--gui-ink-strong);
  font-size: 15px;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.gui-viewer__settings-group {
  margin-top: 18px;
}

.gui-viewer__settings-label {
  display: block;
  margin-bottom: 8px;
  color: var(--gui-muted);
  font-size: 11px;
  font-weight: 600;
}

.gui-viewer__theme-options {
  display: flex;
  gap: 5px;
  padding: 4px;
  border: 1px solid var(--gui-line-strong);
  border-radius: var(--gui-radius-sm);
  background: var(--gui-surface-muted);
}

.gui-viewer__theme-option {
  display: inline-flex;
  min-height: 40px;
  flex: 1;
  align-items: center;
  justify-content: center;
  gap: 7px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--gui-muted);
  cursor: pointer;
  font-size: 11px;
  font-weight: 600;
  transition: background 160ms var(--gui-ease), border-color 160ms var(--gui-ease), color 160ms var(--gui-ease);
}

.gui-viewer__theme-option:hover {
  color: var(--gui-ink);
}

.gui-viewer__theme-option--active {
  border-color: var(--gui-line-strong);
  background: var(--gui-surface);
  color: var(--gui-ink-strong);
}

.gui-viewer__settings-switch {
  justify-content: flex-start;
  margin-top: 18px;
  font-size: 12px;
}

.gui-viewer__settings-hint {
  margin: 5px 0 0 43px;
  color: var(--gui-faint);
  font-size: 10.5px;
  line-height: 1.45;
}

.gui-viewer__settings-close {
  display: block;
  min-height: 42px;
  margin: 19px auto 0;
  padding: 0 16px;
  border: 1px solid var(--gui-ink-strong);
  border-radius: var(--gui-radius-sm);
  background: var(--gui-ink-strong);
  color: var(--gui-canvas);
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
  transition: filter 160ms var(--gui-ease), transform 160ms var(--gui-ease);
}

.gui-viewer__settings-close:hover {
  filter: brightness(1.1);
}

@media (max-width: 420px) {
  .gui-viewer__surface {
    padding-inline: 22px;
  }

  .gui-viewer__seg-hint {
    font-size: 7.5px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .gui-viewer *,
  .gui-viewer *::before,
  .gui-viewer *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    scroll-behavior: auto !important;
    transition-duration: 0.01ms !important;
  }
}
</style>
