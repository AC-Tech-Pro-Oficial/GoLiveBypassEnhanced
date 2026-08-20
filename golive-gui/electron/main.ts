import { app, BrowserWindow, ipcMain } from 'electron';
import path, { dirname } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { exec, execSync } from 'child_process';
import { bypassCode } from './bypass';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const FLAVOURS = ['Discord', 'DiscordPTB', 'DiscordCanary'];

let mainWindow: BrowserWindow | null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 480,
    height: 600,
    resizable: false,
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

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

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
    exec(`"${exePath}"`);
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

  // So desfaz o que e nosso. Isto roda ao fechar a janela, e antes desfazia qualquer injecao:
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

ipcMain.handle('activate', activateBypass);
ipcMain.handle('deactivate', deactivateAll);
ipcMain.handle('get-status', () => {
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
});
