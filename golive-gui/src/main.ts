import './style.css'

declare global {
  interface Window {
    api: {
      activate: (proxy?: string) => Promise<void>;
      deactivate: () => Promise<void>;
      getStatus: () => Promise<string>;
    }
  }
}

const statusIndicator = document.getElementById('statusIndicator')!;
const statusText = document.getElementById('statusText')!;
const toggleBtn = document.getElementById('toggleBtn') as HTMLButtonElement;
const btnText = document.getElementById('btnText')!;
const warningAlert = document.getElementById('warningAlert')!;
const proxyInput = document.getElementById('proxyInput') as HTMLInputElement;

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
      alert("GoLiveBypass Ativado!\n\nAVISO IMPORTANTE: Se a transmissão ficar preta ou não carregar, aperte Ctrl + R dentro do Discord.");
    }
  } catch (err) {
    alert('Erro: ' + err);
  }

  await updateStatus();
});

// Inicialização
updateStatus();
