import { app, BrowserWindow, ipcMain, Menu, nativeImage, Tray } from 'electron';
import path, { dirname } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { execSync, spawn } from 'child_process';
import { bypassCode } from './bypass';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const FLAVOURS = ['Discord', 'DiscordPTB', 'DiscordCanary'];

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

// Fechar a janela esconde na bandeja; so o Sair do menu da bandeja desliga o app (e reverte
// o bypass, como o fechar da janela fazia antes). Sem a trava, o X derrubaria o app e a
// pessoa nem notaria que a janela foi parar junto do relogio.
let quitting = false;

// Os icones moram em assets/ e seguem no pacote pelo "files" do electron-builder. O icone do
// exe vem de build/icon.ico, por convencao do builder.
function assetPath(name: string) {
  return path.join(__dirname, '..', 'assets', name);
}

// O app mora na bandeja, entao "iniciar com o Windows" faz sentido de verdade: com --hidden
// ele ja abre escondido, sem jogar janela na cara a cada login.
function getStartup() {
  return app.getLoginItemSettings().openAtLogin;
}

function setStartup(enabled: boolean) {
  app.setLoginItemSettings({ openAtLogin: enabled, args: ['--hidden'] });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 480,
    height: 600,
    resizable: false,
    icon: assetPath('icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: true,
      contextIsolation: false,
    },
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#1e1f22',
      symbolColor: '#ffffff',
    }
  });

  mainWindow.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    mainWindow?.hide();
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

function showWindow() {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
    // A bandeja pode ter mudado o startup com a janela escondida; ao reaparecer, sincroniza.
    mainWindow.webContents.send('refresh-startup');
  } else {
    createWindow();
  }
  refreshTray();
}

function statusLabel(status: string) {
  if (status === 'ACTIVE') return 'ativo';
  if (status === 'OTHER_MOD') return 'outro mod detectado';
  if (status === 'NOT_FOUND') return 'Discord não encontrado';
  return 'inativo';
}

// O menu e remontado a cada mudanca: e o jeito simples de o rotulo de status e o item
// Ativar/Desativar refletirem o estado atual sem logica de diff.
function refreshTray() {
  if (!tray) return;
  try {
    const status = getStatus();
    const label = statusLabel(status);
    tray.setToolTip(`GoLiveBypass — ${label}`);
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: `GoLiveBypass — ${label}`, enabled: false },
      { type: 'separator' },
      { label: 'Abrir', click: showWindow },
      {
        label: status === 'ACTIVE' ? 'Desativar o bypass' : 'Ativar o bypass',
        enabled: status !== 'NOT_FOUND',
        click: toggleFromTray,
      },
      {
        label: 'Iniciar com o Windows',
        type: 'checkbox',
        checked: getStartup(),
        click: (item) => setStartup(item.checked),
      },
      { type: 'separator' },
      // Sair pela bandeja reverte so o que e nosso, como o fechar da janela sempre fez.
      { label: status === 'ACTIVE' ? 'Sair (desfaz o bypass)' : 'Sair', click: quitApp },
    ]));
  } catch {
    // uma bandeja sem menu nao vale derrubar o app
  }
}

async function toggleFromTray() {
  try {
    if (getStatus() === 'ACTIVE') await deactivateAll();
    else await activateBypass(null, '');
  } finally {
    refreshTray();
  }
}

function quitApp() {
  quitting = true;
  app.quit();
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(assetPath('tray.png')));
  tray.on('click', showWindow);
  refreshTray();
}

// Com o app morando na bandeja, rodar o exe de novo nao pode empilhar uma segunda copia:
// ela morre aqui e a janela da primeira aparece.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());

  app.whenReady().then(() => {
    // No login do Windows (start com --hidden) sobe so a bandeja; a janela aparece no clique.
    if (!process.argv.includes('--hidden')) createWindow();
    createTray();
    app.on('activate', showWindow);
  });
}

app.on('window-all-closed', () => {
  deactivateAll().finally(() => {
    app.quit();
  });
});

function withNoAsar<T>(fn: () => T): T {
  const previous = process.noAsar;
  process.noAsar = true;
  try {
    return fn();
  } finally {
    process.noAsar = previous;
  }
}

interface DiscordInstall {
  flavour: string;
  resources: string;
  exePath: string;
}

function getDiscordInstalls(): DiscordInstall[] {
  return withNoAsar(() => {
    const localAppData = process.env.LOCALAPPDATA;
    if (!localAppData) return [];

    const installs: DiscordInstall[] = [];
  for (const flavour of FLAVOURS) {
    const rootPath = path.join(localAppData, flavour);
    if (!fs.existsSync(rootPath)) continue;

    const dirs = fs.readdirSync(rootPath).filter(d => d.startsWith('app-'));
    if (dirs.length === 0) continue;

    dirs.sort();
    const latestApp = dirs[dirs.length - 1];
    const resourcesPath = path.join(rootPath, latestApp, 'resources');
    const exePath = path.join(rootPath, latestApp, `${flavour}.exe`);
    if (fs.existsSync(path.join(resourcesPath, 'app.asar'))) {
      installs.push({ flavour, resources: resourcesPath, exePath });
    }
  }
  return installs;
  });
}

async function killDiscord() {
  for (const flavour of FLAVOURS) {
    try {
      execSync(`taskkill /F /T /IM ${flavour}.exe`, { stdio: 'ignore' });
    } catch {}
  }
  await new Promise(r => setTimeout(r, 1000));
}

async function safeRename(oldPath: string, newPath: string) {
  let lastError;
  for (let i = 0; i < 15; i++) {
    try {
      withNoAsar(() => {
        fs.renameSync(oldPath, newPath);
      });
      return;
    } catch (e: any) {
      lastError = e;
      await new Promise(r => setTimeout(r, 500));
    }
  }
  throw new Error(`Arquivo bloqueado pelo sistema: ${oldPath}\nErro: ${lastError?.message || 'Desconhecido'}\n\nDICA: Feche o Discord completamente pelo Gerenciador de Tarefas e tente novamente.`);
}

async function safeRemove(targetPath: string) {
  let lastError;
  for (let i = 0; i < 15; i++) {
    try {
      withNoAsar(() => {
        if (fs.existsSync(targetPath)) {
          fs.rmSync(targetPath, { recursive: true, force: true });
        }
      });
      return;
    } catch (e: any) {
      lastError = e;
      await new Promise(r => setTimeout(r, 500));
    }
  }
  throw new Error(`Falha ao remover arquivo bloqueado: ${targetPath}`);
}

function startDiscord(exePath: string) {
  try {
    // exec() deixava o stdout do Discord preso num pipe nosso: quando a GUI morria (ou o
    // buffer do exec enchia), o pipe quebrava, e qualquer log de excecao do processo
    // principal do Discord virava EPIPE fatal ("A JavaScript error occurred in the main
    // process", relato real). O Discord precisa nascer sem pipe nenhum para nos: stdio
    // ignorado e sem referencia. Sem detached de proposito: no Windows ele faz o filho
    // sair na hora em alguns ambientes, e aqui ele nao falta.
    spawn(exePath, [], { stdio: 'ignore' }).unref();
  } catch {}
}

// O _app.asar so existe quando alguem ja injetou: e o Discord original guardado de lado. Se ele
// existe e o app.asar nao e nosso, quem esta ali e outro mod.
function isOurInjection(resources: string) {
  return withNoAsar(() => {
    const indexJs = path.join(resources, 'app.asar', 'index.js');
    if (!fs.existsSync(indexJs)) return false;
    return fs.readFileSync(indexJs, 'utf8').includes('golivebypass.js');
  });
}

function writeInjection(asar: string, proxyAddress: string) {
  withNoAsar(() => {
    fs.mkdirSync(asar);
    fs.writeFileSync(path.join(asar, 'package.json'), JSON.stringify({ name: "discord", main: "index.js" }));
    fs.writeFileSync(path.join(asar, 'golivebypass.js'), bypassCode);
    fs.writeFileSync(path.join(asar, 'settings.json'), JSON.stringify({ enabled: true, proxy: proxyAddress }));
    fs.writeFileSync(path.join(asar, 'index.js'), `require('./golivebypass.js');`);
  });
}

async function activateBypass(event: any, proxyAddress: string = '') {
  const installs = getDiscordInstalls();
  if (installs.length === 0) throw new Error('Nenhum Discord encontrado.');

  await killDiscord();

  for (const install of installs) {
    const asar = path.join(install.resources, 'app.asar');
    const originalAsar = path.join(install.resources, '_app.asar');

    const hasOriginal = withNoAsar(() => fs.existsSync(originalAsar));
    const hasAsar = withNoAsar(() => fs.existsSync(asar));

    if (!hasOriginal && hasAsar) {
      // Discord intocado: o app.asar atual e o original, entao ele vira _app.asar.
      await safeRename(asar, originalAsar);
      writeInjection(asar, proxyAddress);
    } else if (hasOriginal && !isOurInjection(install.resources)) {
      // Outro mod ocupa o lugar. O _app.asar ja e o Discord original, entao so o carregador do
      // outro mod e trocado pelo nosso. Sem isto o botao "Sobrescrever e Ativar" nao fazia nada:
      // a condicao antiga so injetava em Discord intocado, e aqui ela era falsa.
      await safeRemove(asar);
      writeInjection(asar, proxyAddress);
    } else if (hasOriginal) {
      // Ja e o nosso: so reescreve, para a proxy nova valer.
      await safeRemove(asar);
      writeInjection(asar, proxyAddress);
    }

    startDiscord(install.exePath);
  }
}

async function deactivateAll() {
  const installs = getDiscordInstalls();

  // So desfaz o que e nosso. Isto roda ao sair do app, e antes desfazia qualquer injecao:
  // quem tinha Equicord ou Vencord abria este app, fechava, e o mod sumia sem nada avisar.
  const ours = installs.filter(install =>
    withNoAsar(() => fs.existsSync(path.join(install.resources, '_app.asar'))) && isOurInjection(install.resources)
  );

  // Decidido antes de matar o Discord: sem isto, quem tem outro mod teria o Discord fechado
  // para nada, porque nao haveria o que desfazer depois.
  if (ours.length === 0) return;

  await killDiscord();

  for (const install of ours) {
    const asar = path.join(install.resources, 'app.asar');
    const originalAsar = path.join(install.resources, '_app.asar');

    await safeRemove(asar);
    await safeRename(originalAsar, asar);
    startDiscord(install.exePath);
  }
}

function getStatus(): string {
  const installs = getDiscordInstalls();
  if (installs.length === 0) return 'NOT_FOUND';
  return withNoAsar(() => {
    for (const install of installs) {
      const asar = path.join(install.resources, 'app.asar');
      const originalAsar = path.join(install.resources, '_app.asar');
      if (fs.existsSync(originalAsar)) {
         // Checa se é o nosso bypass
         const indexJs = path.join(asar, 'index.js');
         if (fs.existsSync(indexJs)) {
           const content = fs.readFileSync(indexJs, 'utf8');
           if (content.includes('golivebypass.js')) return 'ACTIVE';
         }
         return 'OTHER_MOD';
      }
    }
    return 'INACTIVE';
  });
}

// A bandeja precisa refletir o que os botoes da janela fizeram, entao os handlers de IPC
// tambem remontam o menu ao terminar.
ipcMain.handle('activate', async (event, proxyAddress: string) => {
  await activateBypass(event, proxyAddress);
  refreshTray();
});
ipcMain.handle('deactivate', async () => {
  await deactivateAll();
  refreshTray();
});
ipcMain.handle('get-status', () => getStatus());
ipcMain.handle('get-startup', () => getStartup());
ipcMain.handle('set-startup', (_event, enabled: unknown) => {
  setStartup(enabled === true);
  refreshTray();
});
