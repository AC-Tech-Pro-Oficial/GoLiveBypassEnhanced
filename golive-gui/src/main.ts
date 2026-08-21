import './style.css'

declare global {
  interface Window {
    api: {
      activate: (proxy?: string) => Promise<void>;
      deactivate: () => Promise<void>;
      getStatus: () => Promise<string>;
      getPlatform: () => Promise<string>;
      getStartup: () => Promise<boolean>;
      setStartup: (enabled: boolean) => Promise<void>;
      onRefreshStartup: (callback: () => void) => void;
      onRefreshStatus: (callback: () => void) => void;
      resizeWindow: (height: number) => void;
    }
  }
}

const statusIndicator = document.getElementById('statusIndicator')!;
const statusText = document.getElementById('statusText')!;
const toggleBtn = document.getElementById('toggleBtn') as HTMLButtonElement;
const btnText = document.getElementById('btnText')!;
const warningAlert = document.getElementById('warningAlert')!;
const proxyInput = document.getElementById('proxyInput') as HTMLInputElement;
const startupToggle = document.getElementById('startupToggle') as HTMLInputElement;
const startupLabel = document.getElementById('startupLabel') as HTMLLabelElement;



let currentState = 'INACTIVE';

// O warning do bypass ativo faz o conteudo crescer; a janela e fixa, entao reportamos a altura
// necessaria para o main process redimensionar e nada ficar cortado.
function fitWindowToContent() {
  const container = document.querySelector('.container');
  if (!container) return;
  // +1 px de folga: sem isto a ultima linha as vezes ficava cortada por causa do arredondamento.
  const height = Math.ceil(container.getBoundingClientRect().height + 1);
  window.api.resizeWindow(height);
}



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
  // Depois de mostrar/esconder o warning, ajusta a janela ao novo tamanho do conteudo.
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
      alert("GoLiveBypass Ativado!\n\nAVISO IMPORTANTE: Se a transmissão ficar preta ou não carregar, aperte Ctrl + R dentro do Discord.");
    }
  } catch (err) {
    alert('Erro: ' + err);
  }

  await updateStatus();
});

// Inicialização
updateStatus();
refreshStartup();
updateStartupLabel();
fitWindowToContent();

async function updateStartupLabel() {
  try {
    const platform = await window.api.getPlatform();
    // O texto depende do SO: no Linux o autostart e um .desktop XDG, no Windows um login item.
    startupLabel.textContent = platform === 'linux' ? 'Iniciar com o sistema' : 'Iniciar com o Windows';
  } catch (err) {
    console.error(err);
  }
}

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

// A bandeja tambem tem esses controles; sem os avisos, os dois ficariam dessincronizados.
window.api.onRefreshStartup(refreshStartup);
window.api.onRefreshStatus(updateStatus);
