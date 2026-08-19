import './style.css'

declare global {
  interface Window {
    api: {
      activate: () => Promise<void>;
      deactivate: () => Promise<void>;
      getStatus: () => Promise<string>;
    }
  }
}

const statusIndicator = document.getElementById('statusIndicator')!;
const statusText = document.getElementById('statusText')!;
const toggleBtn = document.getElementById('toggleBtn') as HTMLButtonElement;
const btnText = document.getElementById('btnText')!;

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
    } else if (status === 'OTHER_MOD') {
      statusIndicator.classList.add('danger');
      statusText.innerText = 'Outro mod detectado';
      btnText.innerText = 'Sobrescrever e Ativar';
    } else if (status === 'NOT_FOUND') {
      statusIndicator.classList.add('danger');
      statusText.innerText = 'Discord não encontrado';
      toggleBtn.disabled = true;
      btnText.innerText = 'Não Disponível';
    } else {
      statusText.innerText = 'Discord limpo. Pronto para injetar.';
      btnText.innerText = 'Ativar Bypass';
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
      await window.api.activate();
    }
  } catch (err) {
    alert('Erro: ' + err);
  }

  await updateStatus();
});

// Inicialização
updateStatus();
