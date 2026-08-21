import './style.css'

declare global {
  interface Window {
    api: {
      platform: string;
      activate: (proxy?: string) => Promise<void>;
      deactivate: () => Promise<void>;
      getStatus: () => Promise<string>;
      getStartup: () => Promise<boolean>;
      setStartup: (enabled: boolean) => Promise<void>;
      onRefreshStartup: (callback: () => void) => void;
    }
  }
}

const isMac = window.api.platform === 'darwin';
const reloadShortcut = isMac ? 'Cmd + R' : 'Ctrl + R';

function applyPlatformCopy() {
  document.body.classList.toggle('darwin', isMac);

  const startupLabel = document.getElementById('startupLabel');
  if (startupLabel) startupLabel.textContent = isMac ? 'Iniciar com o Mac' : 'Iniciar com o Windows';

  const closeHint = document.getElementById('closeHint');
  if (closeHint) {
    closeHint.textContent = isMac
      ? 'Fechar a janela esconde o app na barra de menus, junto do relógio — para reverter tudo, saia pelo ícone de lá.'
      : 'Fechar a janela esconde o app na bandeja, junto do relógio — para reverter tudo, saia pelo ícone de lá.';
  }

  const reloadKeys = document.getElementById('reloadKeys');
  if (reloadKeys) reloadKeys.textContent = reloadShortcut;
}

const statusIndicator = document.getElementById('statusIndicator')!;
const statusText = document.getElementById('statusText')!;
const toggleBtn = document.getElementById('toggleBtn') as HTMLButtonElement;
const btnText = document.getElementById('btnText')!;
const warningAlert = document.getElementById('warningAlert')!;
const proxyInput = document.getElementById('proxyInput') as HTMLInputElement;
const startupToggle = document.getElementById('startupToggle') as HTMLInputElement;

let currentState = 'INACTIVE';

async function updateStatus() {
  try {
    const status = await window.api.getStatus();
    currentState = status;
    
    statusIndicator.className = 'status-indicator';
    toggleBtn.disabled = false;
    toggleBtn.classList.remove('loading', 'deactivate');

    if (status === 'ACTIVE') {
      statusIndicator.classList.add('active');
      statusText.innerText = 'GoLiveBypass está Ativo';
      btnText.innerText = 'Desativar Bypass';
      toggleBtn.classList.add('deactivate');
      warningAlert.style.display = 'block';
    } else if (status === 'OTHER_MOD') {
      statusIndicator.classList.add('danger');
      statusText.innerText = 'Outro mod detectado';
      btnText.innerText = 'Sobrescrever e Ativar';
      warningAlert.style.display = 'none';
    } else if (status === 'NOT_FOUND') {
      statusIndicator.classList.add('danger');
      statusText.innerText = 'Discord não encontrado';
      toggleBtn.disabled = true;
      btnText.innerText = 'Não Disponível';
      warningAlert.style.display = 'none';
    } else {
      statusText.innerText = 'Discord limpo. Pronto para injetar.';
      btnText.innerText = 'Ativar Bypass';
      warningAlert.style.display = 'none';
    }
  } catch (err) {
    console.error(err);
    statusText.innerText = 'Erro ao buscar status';
  }
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
      alert(`GoLiveBypass Ativado!\n\nAVISO IMPORTANTE: Se a transmissão ficar preta ou não carregar, aperte ${reloadShortcut} dentro do Discord.`);
    }
  } catch (err) {
    alert('Erro: ' + err);
  }

  await updateStatus();
});

// Inicialização
applyPlatformCopy();
updateStatus();
refreshStartup();

async function refreshStartup() {
  try {
    startupToggle.checked = await window.api.getStartup();
  } catch (err) {
    console.error(err);
  }
}

startupToggle.addEventListener('change', async () => {
  await window.api.setStartup(startupToggle.checked);
});

// A bandeja tambem tem esse controle; sem o aviso, os dois ficariam dessincronizados.
window.api.onRefreshStartup(refreshStartup);
