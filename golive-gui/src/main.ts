import './style.css'

declare global {
  interface Window {
    api: {
      platform: string;
      activate: (proxy?: string) => Promise<void>;
      deactivate: () => Promise<void>;
      getStatus: () => Promise<string>;
      getProxy: () => Promise<string>;
      getPlatform: () => Promise<string>;
      getStartup: () => Promise<boolean>;
      setStartup: (enabled: boolean) => Promise<void>;
      getNetMode: () => Promise<string>;
      setNetMode: (mode: string) => Promise<string>;
      getTorStatus: () => Promise<{ presente: boolean; ativo: boolean; porta: number }>;
      installTor: () => Promise<{ ok: boolean; porta?: number; error?: string }>;
      testProxy: (proxy: string) => Promise<{
        ok: boolean;
        ms?: number;
        host?: string;
        port?: number;
        country?: string;
        error?: string;
      }>;
      startLogWatch: () => Promise<{ path: string }>;
      stopLogWatch: () => Promise<boolean>;
      getDiagnostic: (payload: { status: string; note?: string }) => Promise<{
        text: string;
        logPath: string;
        apiConfigured?: boolean;
      }>;
      openBugReport: (payload: {
        status: string;
        note?: string;
        title?: string;
      }) => Promise<{
        ok: boolean;
        via?: "api" | "github";
        url: string;
        issueNumber?: number;
        copied: boolean;
        truncated: boolean;
        apiError?: string;
      }>;
      openLogFolder: () => Promise<string>;
      setDevLogWindow: (open: boolean) => Promise<boolean>;
      onLogChunk: (callback: (chunk: string) => void) => void;
      onDevLogWindowClosed: (callback: () => void) => void;
      onRefreshStartup: (callback: () => void) => void;
      onRefreshStatus: (callback: () => void) => void;
      resizeWindow: (height: number) => void;
      setTheme: (theme: string) => void;
    }
  }
}

const platform = window.api.platform;
const isMac = platform === 'darwin';
const isLinux = platform === 'linux';
const reloadShortcut = isMac ? 'Cmd + R' : 'Ctrl + R';

function applyPlatformCopy() {
  document.body.classList.toggle('darwin', isMac);

  const startupLabel = document.getElementById('startupLabel');
  if (startupLabel) {
    // Linux: autostart XDG; Windows/Mac: login item. O rotulo acompanha o SO.
    startupLabel.textContent = isMac ? 'Iniciar com o Mac' : isLinux ? 'Iniciar com o sistema' : 'Iniciar com o Windows';
  }

  const closeHint = document.getElementById('closeHint');
  if (closeHint) {
    closeHint.textContent = isMac
      ? 'Fechar a janela esconde o app na barra de menus, junto do relógio — para reverter tudo, saia pelo ícone de lá.'
      : 'Fechar a janela esconde o app na bandeja, junto do relógio — para reverter tudo, saia pelo ícone de lá.';
  }

  const reloadKeys = document.getElementById('reloadKeys');
  if (reloadKeys) reloadKeys.textContent = reloadShortcut;
}

// ---------------------------------------------------------------------------
// Tema claro/escuro — persistido em localStorage e avisado ao main process
// (o titleBarOverlay do Windows precisa saber a cor de fundo da janela).
// ---------------------------------------------------------------------------
const THEME_KEY = 'golivebypass-theme';

function applyTheme(theme: 'light' | 'dark') {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // localStorage pode falhar (perfil sem escrita); o tema ainda vale na sessao.
  }
  window.api.setTheme(theme);
}

function initTheme() {
  // Tema padrao: dark. So usa o claro se estiver salvo explicitamente.
  let theme: 'light' | 'dark' = 'dark';
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'dark' || saved === 'light') theme = saved;
  } catch {
    // cai no default escuro
  }
  applyTheme(theme);
}

const statusIndicator = document.getElementById('statusIndicator')!;
const statusText = document.getElementById('statusText')!;
const statusTag = document.getElementById('statusTag')!;
const statusCard = document.getElementById('statusCard')!;
const toggleBtn = document.getElementById('toggleBtn') as HTMLButtonElement;
const btnText = document.getElementById('btnText')!;
const warningAlert = document.getElementById('warningAlert')!;
const warnBtn = document.getElementById('warnBtn') as HTMLButtonElement;
const proxyInput = document.getElementById('proxyInput') as HTMLInputElement;
const startupToggle = document.getElementById('startupToggle') as HTMLInputElement;
const themeBtn = document.getElementById('themeBtn') as HTMLButtonElement;

let currentState = 'INACTIVE';

// ---------------------------------------------------------------------------
// Popover do aviso: abre/fecha no clique do botao "!", e fecha ao clicar fora.
// ---------------------------------------------------------------------------
function setWarningOpen(open: boolean) {
  warningAlert.classList.toggle('open', open);
  warnBtn.setAttribute('aria-expanded', String(open));
  // O popover flutua sobre o conteudo, entao a altura da janela nao muda.
  fitWindowToContent();
}

warnBtn.addEventListener('click', (event) => {
  event.stopPropagation();
  setWarningOpen(!warningAlert.classList.contains('open'));
});

document.addEventListener('click', (event) => {
  const target = event.target as Node;
  if (!warningAlert.contains(target) && target !== warnBtn) {
    setWarningOpen(false);
  }
});

// ---------------------------------------------------------------------------
// Tema: botao alterna; inicia com o valor salvo.
// ---------------------------------------------------------------------------
themeBtn.addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(next);
});

// ---------------------------------------------------------------------------

// O warning do bypass ativo faz o conteudo crescer; a janela e fixa, entao reportamos a altura
// necessaria para o main process redimensionar e nada ficar cortado.
function fitWindowToContent() {
  // Espera o layout apos hidden/details: sem rAF a medicao ainda ve a altura antiga
  // (Personalizado expandia e a janela nunca encolhia ao voltar para Tor/Gratuitas).
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const container = document.querySelector('.container') as HTMLElement | null;
      if (!container) return;
      const height = Math.ceil(container.getBoundingClientRect().height + 1);
      window.api.resizeWindow(height);
    });
  });
}

async function updateStatus() {
  try {
    const status = await window.api.getStatus();
    currentState = status;
    
    statusIndicator.className = 'status-indicator';
    statusTag.className = 'status-tag';
    toggleBtn.disabled = false;
    toggleBtn.classList.remove('loading', 'deactivate', 'overwrite');

    if (status === 'ACTIVE') {
      statusText.innerText = 'GoLiveBypass está Ativo';
      statusTag.textContent = 'Ativo';
      statusTag.classList.add('tag--ok');
      btnText.innerText = 'Desativar Bypass';
      toggleBtn.classList.add('deactivate');
      statusCard.hidden = true;
    } else if (status === 'OTHER_MOD') {
      statusText.innerText = 'Outro mod detectado';
      statusTag.textContent = 'Conflito';
      statusTag.classList.add('tag--warn');
      btnText.innerText = 'Sobrescrever e Ativar';
      toggleBtn.classList.add('overwrite');
      statusCard.hidden = false;
    } else if (status === 'NOT_FOUND') {
      statusText.innerText = 'Discord não encontrado';
      statusTag.textContent = 'Ausente';
      statusTag.classList.add('tag--danger');
      toggleBtn.disabled = true;
      btnText.innerText = 'Não Disponível';
      statusCard.hidden = false;
    } else {
      statusText.innerText = 'Discord limpo. Pronto para injetar.';
      statusTag.textContent = 'Pronto';
      statusTag.classList.add('tag--ok');
      btnText.innerText = 'Ativar Bypass';
      statusCard.hidden = true;
    }
  } catch (err) {
    console.error(err);
    statusText.innerText = 'Erro ao buscar status';
    statusTag.textContent = 'Erro';
    statusTag.classList.add('tag--danger');
    statusCard.hidden = false;
  }
  // O updateStatus acabou de reabilitar o botao; se o modo e Tor e o daemon nao esta de pe,
  // a trava tem que valer por cima -- senao dava para injetar e ficar sem conectar.
  aplicarTravaDoTor();
  // Depois de mudar o estado, ajusta a janela ao novo tamanho do conteudo.
  fitWindowToContent();
}

toggleBtn.addEventListener('click', async () => {
  toggleBtn.disabled = true;
  toggleBtn.classList.add('loading');

  try {
    if (currentState === 'ACTIVE') {
      await window.api.deactivate();
    } else {
      const proxy = proxyInput.value.trim();
      await window.api.activate(proxy);

      // Popup de aviso
      setWarningOpen(true);
    }
  } catch (err) {
    alert('Erro: ' + err);
  }

  await updateStatus();
  // O Tor sobe durante a ativacao, entao o texto lido na abertura da janela ja nasceu velho:
  // ficava em "aguardando ativacao" com o Tor de pe e o bypass funcionando.
  refreshTorStatus();
});

// Inicialização
applyPlatformCopy();
initTheme();
updateStatus();
refreshStartup();
refreshProxy();
refreshNetMode();
refreshTorStatus();
// O Tor pode subir depois (durante a ativacao) ou cair no meio; sem reconferir, o texto
// congela no que era verdade quando a janela abriu. A checagem custa um connect no loopback.
setInterval(refreshTorStatus, 5000);
fitWindowToContent();

async function refreshStartup() {
  try {
    startupToggle.checked = await window.api.getStartup();
  } catch (err) {
    console.error(err);
  }
}

// Preenche o campo de proxy com o valor salvo no settings.json (se houver),
// para a configuracao ficar visivel apos reiniciar o app.
async function refreshProxy() {
  try {
    proxyInput.value = await window.api.getProxy();
  } catch (err) {
    console.error(err);
  }
}

// ---------------------------------------------------------------------------
// Rede de saida: tres modos segmentados (Tor / Gratuitas / Personalizado).
// O padrao e TOR (o app instala e usa o Tor sempre). O campo de proxy so aparece
// no modo Personalizado.
// ---------------------------------------------------------------------------
const segBtns = Array.from(document.querySelectorAll<HTMLButtonElement>('.seg-btn'));
const torStatusEl = document.getElementById('torStatus') as HTMLElement;
const manualProxyGroup = document.getElementById('manualProxyGroup') as HTMLElement;

// O modo escolhido e se o Tor ja foi verificado: juntos decidem se o botao de ativar pode ser
// liberado. Injetar em modo Tor sem o daemon de pe deixa o Discord sem conectar -- o bypass
// segura o gateway em vez de vazar pelo IP brasileiro, entao o Discord fica sem rede nenhuma.
let modoAtual = 'tor';
let torPronto = false;

// Libera ou trava o botao conforme o Tor. Fora do modo Tor nao ha o que travar; o resto do
// estado (Discord ausente, etc.) continua mandando no updateStatus.
function aplicarTravaDoTor() {
  if (currentState === 'NOT_FOUND') return;
  if (modoAtual !== 'tor' || currentState === 'ACTIVE') return;

  if (torPronto) {
    toggleBtn.disabled = false;
    btnText.innerText = currentState === 'OTHER_MOD' ? 'Sobrescrever e Ativar' : 'Ativar Bypass';
    return;
  }

  toggleBtn.disabled = true;
  btnText.innerText = 'Aguardando o Tor...';
}

function selectMode(mode: string) {
  modoAtual = mode;
  for (const btn of segBtns) {
    const checked = btn.dataset.mode === mode;
    btn.setAttribute('aria-checked', String(checked));
    btn.classList.toggle('seg-btn--active', checked);
  }
  manualProxyGroup.hidden = mode !== 'manual';
  // O status do Tor so faz sentido no modo Tor; nos outros ele so confunde.
  torStatusEl.hidden = mode !== 'tor';
  // Fecha o guia VPS ao sair do Personalizado: se ficar aberto, a proxima visita ja nasce alta.
  if (mode !== 'manual') {
    const guide = manualProxyGroup.querySelector('details.vps-guide');
    if (guide) (guide as HTMLDetailsElement).open = false;
  }
  fitWindowToContent();
}

async function refreshNetMode() {
  try {
    const saved = await window.api.getNetMode();
    const proxy = await window.api.getProxy();
    // Mapeia o estado salvo para a UI de 3 opcoes:
    // - "free" -> Gratuitas (escolha explicita)
    // - "auto" com proxy preenchida -> Personalizado
    // - o resto ("tor", "auto" sem proxy, vazio) -> Tor, que e o padrao
    if (saved === 'free') selectMode('free');
    else if (saved === 'auto' && proxy) selectMode('manual');
    else selectMode('tor');
  } catch (err) {
    console.error(err);
  }
}

async function refreshTorStatus() {
  try {
    const st = await window.api.getTorStatus();
    torPronto = st.ativo;
    if (st.ativo) {
      torStatusEl.textContent = `Tor pronto (porta ${st.porta})`;
      torStatusEl.classList.add('tor-status--ok');
    } else if (st.presente) {
      torStatusEl.textContent = 'Tor baixado, preparando... o botao libera quando ele subir.';
      torStatusEl.classList.remove('tor-status--ok');
    } else {
      torStatusEl.textContent = 'Tor sera baixado automaticamente ao ativar.';
      torStatusEl.classList.remove('tor-status--ok');
    }
  } catch (err) {
    console.error(err);
  }
  // O botao depende disto: em modo Tor ele so libera com o daemon verificado.
  aplicarTravaDoTor();
}

for (const btn of segBtns) {
  btn.addEventListener('click', () => {
    const mode = btn.dataset.mode!;
    selectMode(mode);

    if (mode === 'tor') {
      // Prepara o Tor (baixa/sobe) — o padrao. Nao espera: o status atualiza.
      window.api.setNetMode('tor').catch(() => {});
      // Trava o botao na hora: ate o Tor estar de pe, injetar so deixaria o Discord sem
      // conectar. O refreshTorStatus (a cada 5s) libera quando ele subir.
      torPronto = false;
      aplicarTravaDoTor();
      window.api.installTor().then((r) => {
        torPronto = !!r.ok;
        torStatusEl.textContent = r.ok
          ? `Tor pronto (porta ${r.porta ?? 9060})`
          : `${r.error ?? 'nao consegui preparar o Tor'}`;
        torStatusEl.classList.toggle('tor-status--ok', !!r.ok);
        aplicarTravaDoTor();
      }).catch(() => {});
      fitWindowToContent();
    } else if (mode === 'free') {
      window.api.setNetMode('free').catch(() => {});
      // Fora do modo Tor nao ha o que esperar: devolve o botao.
      aplicarTravaDoTor();
      updateStatus();
    } else {
      // Personalizado: volta ao auto com a proxy do campo.
      window.api.setNetMode('auto').catch(() => {});
      aplicarTravaDoTor();
      updateStatus();
      fitWindowToContent();
    }
  });
}

const proxyTestBtn = document.getElementById('proxyTestBtn') as HTMLButtonElement;
const proxyTestStatus = document.getElementById('proxyTestStatus') as HTMLElement;

proxyTestBtn.addEventListener('click', async () => {
  const proxy = proxyInput.value.trim();
  proxyTestBtn.disabled = true;
  proxyTestStatus.classList.remove('proxy-test-status--ok', 'proxy-test-status--bad');
  proxyTestStatus.textContent = 'Testando túnel até o gateway...';
  fitWindowToContent();

  try {
    const r = await window.api.testProxy(proxy);
    if (r.ok) {
      proxyTestStatus.classList.add('proxy-test-status--ok');
      const geo = r.country ? ` · saída ${r.country}` : '';
      proxyTestStatus.textContent = `OK — túnel em ${r.ms ?? '?'}ms (${r.host}:${r.port})${geo}`;
    } else {
      proxyTestStatus.classList.add('proxy-test-status--bad');
      const geo = r.country ? ` [${r.country}]` : '';
      proxyTestStatus.textContent = `${r.error ?? 'Falha no teste'}${geo}`;
    }
  } catch (err) {
    proxyTestStatus.classList.add('proxy-test-status--bad');
    proxyTestStatus.textContent = err instanceof Error ? err.message : String(err);
  } finally {
    proxyTestBtn.disabled = false;
    fitWindowToContent();
  }
});

const vpsGuide = document.querySelector('.vps-guide');
if (vpsGuide) {
  vpsGuide.addEventListener('toggle', () => fitWindowToContent());
}

startupToggle.addEventListener('change', async () => {
  await window.api.setStartup(startupToggle.checked);
});

// ---------------------------------------------------------------------------
// Modo desenvolvedor: so o toggle aqui. Logs e report ficam numa janela aparte.
// ---------------------------------------------------------------------------
const DEV_KEY = 'golivebypass-dev-mode';
const devModeToggle = document.getElementById('devModeToggle') as HTMLInputElement;
const devModeHint = document.getElementById('devModeHint') as HTMLElement;

async function setDevMode(on: boolean) {
  try {
    localStorage.setItem(DEV_KEY, on ? '1' : '0');
  } catch {
    /* ignore */
  }
  try {
    await window.api.setDevLogWindow(on);
  } catch (err) {
    console.error(err);
  }
  devModeHint.hidden = !on;
  fitWindowToContent();
}

devModeToggle.addEventListener('change', () => {
  void setDevMode(devModeToggle.checked);
});

window.api.onDevLogWindowClosed?.(() => {
  devModeToggle.checked = false;
  devModeHint.hidden = true;
  try {
    localStorage.setItem(DEV_KEY, '0');
  } catch {
    /* ignore */
  }
  fitWindowToContent();
});

try {
  if (localStorage.getItem(DEV_KEY) === '1') {
    devModeToggle.checked = true;
    void setDevMode(true);
  }
} catch {
  /* ignore */
}

// A bandeja tambem tem esses controles; sem os avisos, os dois ficariam dessincronizados.
window.api.onRefreshStartup(refreshStartup);
window.api.onRefreshStatus(updateStatus);
