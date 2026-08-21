import { app, BrowserWindow, ipcMain, Menu, nativeImage, Tray } from 'electron';
import path, { dirname } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { exec, execSync } from 'child_process';
import { bypassCode } from './bypass';
import { findStandaloneScript, runScript } from './linux-helper';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const FLAVOURS = ['Discord', 'DiscordPTB', 'DiscordCanary'];
const IS_LINUX = process.platform === 'linux';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

// Fechar a janela esconde na bandeja; so o Sair do menu da bandeja desliga o app (e reverte
// o bypass, como o fechar da janela fazia antes). Sem a trava, o X derrubaria o app e a
// pessoa nem notaria que a janela foi parar junto do relogio.
let quitting = false;

// Os icones moram em assets/ e seguem no pacote pelo "files" do electron-builder. O icone do
// exe vem de build/icon.ico, por convencao do builder.
//
// Importante: no Linux (AppImage) os assets ficam DENTRO do app.asar, e o nativeImage
// createFromPath nao le de dentro do asar (API nativa, nao passa pelo patch do fs). Ler o
// arquivo com fs (que entende asar) e criar a imagem do buffer resolve a bandeja com icone
// vazio/invalido.
function loadAsset(name: string) {
  const file = path.join(__dirname, '..', 'assets', name);
  try {
    return nativeImage.createFromBuffer(fs.readFileSync(file));
  } catch {
    return nativeImage.createFromPath(file);
  }
}

// Iniciar com o sistema: no Windows e via login item do Electron (com --hidden, abre so na
// bandeja); no Linux e um arquivo .desktop em ~/.config/autostart, o padrao XDG que o GNOME,
// KDE e os demais respeitam. Sem isto o toggle mostraria "Iniciar com o Windows" no Linux sem
// fazer nada, que e pior do que nao ter o controle.
function getStartup() {
  if (IS_LINUX) {
    const file = path.join(app.getPath('home'), '.config', 'autostart', 'golivebypass.desktop');
    return fs.existsSync(file);
  }
  return app.getLoginItemSettings().openAtLogin;
}

function setStartup(enabled: boolean) {
  if (IS_LINUX) {
    const dir = path.join(app.getPath('home'), '.config', 'autostart');
    const file = path.join(dir, 'golivebypass.desktop');
    try {
      if (enabled) {
        fs.mkdirSync(dir, { recursive: true });
        // Exec com --hidden: abre so na bandeja/notificacao no login, sem jogar janela na tela.
        fs.writeFileSync(file, `[Desktop Entry]
Type=Application
Name=GoLiveBypass
Comment=Devolve o Go Live e a camera no Discord
Exec=${process.execPath} --hidden
X-GNOME-Autostart-enabled=true
`);
      } else if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    } catch (error) {
      console.error('Falha ao alterar autostart:', error);
    }
    return;
  }
  app.setLoginItemSettings({ openAtLogin: enabled, args: ['--hidden'] });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 480,
    // A altura e ajustada pelo proprio conteudo: a pagina avisa via IPC 'resize-window'
    // quando o warning do bypass ativo aparece/some, e a janela cresce/encolhe para nao
    // cortar nada (antes o aviso ficava cortado com a altura fixa de 560).
    height: 560,
    resizable: false,
    icon: loadAsset('icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: true,
      contextIsolation: false,
    },
    autoHideMenuBar: true,
    // titleBarStyle hidden + overlay so existe no Windows; no Linux deixa a janela sem
    // botoes de janela. Usar o frame nativo no Linux (com os botoes do GNOME/KDE).
    ...(IS_LINUX
      ? {}
      : { titleBarStyle: 'hidden' as const, titleBarOverlay: { color: '#1e1f22', symbolColor: '#ffffff' } }),
  });

  mainWindow.on('close', (event) => {
    if (quitting) return;
    // Fechar a janela esconde na bandeja e o app continua vivo em segundo plano, nos dois SOs.
    // Quem quer encerrar de verdade usa o "Sair" do menu da bandeja (que reverte o bypass).
    event.preventDefault();
    mainWindow?.hide();
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

// A janela precisa refletir o que a bandeja fez; sem isto, ativar/desativar pelo icone deixava
// a interface com o estado antigo (botao "Ativar" com o bypass ja ativo, por exemplo).
function refreshWindowStatus() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('refresh-status');
  }
}

function showWindow() {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
    // A bandeja pode ter mudado o startup ou o status com a janela escondida; ao reaparecer, sincroniza.
    mainWindow.webContents.send('refresh-startup');
    refreshWindowStatus();
  } else {
    createWindow();
  }
  refreshTray().catch(() => {});
}

function statusLabel(status: string) {
  if (status === 'ACTIVE') return 'ativo';
  if (status === 'OTHER_MOD') return 'outro mod detectado';
  if (status === 'NOT_FOUND') return 'Discord não encontrado';
  return 'inativo';
}

// O status no Linux vem do script (async); no Windows e sincrono. Guardamos o ultimo valor
// para o menu montar sem travar e para o botao Ativar/Desativar ficar sempre clicavel.
let cachedStatus: string | null = null;

async function refreshTray() {
  if (!tray) return;
  try {
    // Linux: status real via script; Windows: leitura sincrona das instalacoes.
    const status = IS_LINUX ? await linuxStatus() : getStatus();
    cachedStatus = status;
    const label = statusLabel(status);
    tray.setToolTip(`GoLiveBypass — ${label}`);
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: `GoLiveBypass — ${label}`, enabled: false },
      { type: 'separator' },
      { label: 'Abrir', click: showWindow },
      {
        label: status === 'ACTIVE' ? 'Desativar o bypass' : 'Ativar o bypass',
        // Sempre clicavel: mesmo com Discord "nao encontrado" a pessoa pode tentar de novo.
        click: () => { toggleFromTray().catch(() => refreshTray()); },
      },
      { type: 'separator' },
      {
        label: IS_LINUX ? 'Iniciar com o sistema' : 'Iniciar com o Windows',
        type: 'checkbox',
        checked: getStartup(),
        click: (item) => setStartup(item.checked),
      },
      { type: 'separator' },
      // Sair de verdade reverte o bypass e encerra o app.
      { label: status === 'ACTIVE' ? 'Sair (desfaz o bypass)' : 'Sair', click: quitApp },
    ]));
  } catch {
    // uma bandeja sem menu nao vale derrubar o app
  }
}

async function toggleFromTray() {
  try {
    // Atualiza o menu com "trabalhando" para dar feedback imediato do clique.
    if (tray) {
      tray.setToolTip('GoLiveBypass — trabalhando...');
      tray.setContextMenu(Menu.buildFromTemplate([
        { label: 'GoLiveBypass — trabalhando...', enabled: false },
      ]));
    }

    if (IS_LINUX) {
      const status = cachedStatus ?? await linuxStatus();
      if (status === 'ACTIVE') await linuxDeactivate(() => {});
      else await linuxActivate('', () => {});
    } else {
      const status = cachedStatus ?? getStatus();
      if (status === 'ACTIVE') await deactivateAll();
      else await activateBypass(null, '');
    }
  } catch (error) {
    console.error('toggle falhou:', error);
  } finally {
    await refreshTray().catch(() => {});
    refreshWindowStatus();
  }
}

async function quitApp() {
  quitting = true;
  // Sai na hora; a reversao do bypass continua em background (com timeout de seguranca).
  // Antes o app so fechava depois do script --uninstall terminar — que pode demorar (fechar
  // o Discord, flatpak, sudo...) ou falhar, e o "Sair" parecia morto.
  app.quit();
  try {
    if (IS_LINUX) {
      await withTimeout(linuxDeactivate(() => {}), 15000);
    } else {
      await withTimeout(deactivateAll(), 15000);
    }
  } catch {
    // se a reversao falhar ou estourar o tempo, o app ja saiu mesmo assim
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout apos ${ms}ms`)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

function createTray() {
  tray = new Tray(loadAsset('tray.png'));
  tray.on('click', showWindow);
  refreshTray().catch(() => {});
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

// A bandeja e o "dono" do app: fechar a janela so esconde, e o processo continua em segundo
// plano. Sem isto, no Linux o window-all-closed derrubaria o app inteiro ao fechar a janela.
// Quem quer encerrar de verdade usa o "Sair" do menu da bandeja (quitApp).
app.on('window-all-closed', () => {
  // manter vivo — a bandeja cuida do resto
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
// ---------------------------------------------------------------------------
// Linux: delega para o script standalone (POSIX). A GUI e uma casca: quem decide
// tudo (deteccao, flatpak, sudo, injecao) e o script, e a GUI mostra o progresso.
// ---------------------------------------------------------------------------

function linuxStatus(): Promise<string> {
  return runScript(['--status', '--json']).then(({ code, stdout }) => {
    if (code !== 0) return 'NOT_FOUND';
    try {
      const data = JSON.parse(stdout);
      const discords = data.discords ?? [];
      if (discords.length === 0) return 'NOT_FOUND';
      // Precisamos saber se ALGUM ja tem o nosso bypass
      const anyOurs = discords.some((d: any) => d.state === 'nosso');
      const anyMod = discords.some((d: any) => d.state === 'outromod');
      if (anyOurs) return 'ACTIVE';
      if (anyMod) return 'OTHER_MOD';
      return 'INACTIVE';
    } catch {
      return 'NOT_FOUND';
    }
  }).catch(() => 'NOT_FOUND');
}

async function linuxActivate(proxyAddress: string, onChunk: (c: string) => void) {
  const args = ['--yes'];
  if (proxyAddress.trim() !== '') args.push('--proxy', proxyAddress.trim());
  const { code, stderr } = await runScript(args, onChunk);
  if (code !== 0) {
    throw new Error(stderr.split('\n').filter(Boolean).slice(-3).join('\n') || 'Falha ao ativar');
  }
}

async function linuxDeactivate(onChunk: (c: string) => void) {
  const { code, stderr } = await runScript(['--uninstall'], onChunk);
  if (code !== 0) {
    throw new Error(stderr.split('\n').filter(Boolean).slice(-3).join('\n') || 'Falha ao desativar');
  }
}

ipcMain.handle('activate', async (event, proxyAddress: string = '') => {
  if (IS_LINUX) {
    await linuxActivate(proxyAddress, (c) => event.sender.send('bypass-log', c));
  } else {
    await activateBypass(event, proxyAddress);
  }
  refreshTray().catch(() => {});
});
ipcMain.handle('deactivate', async (event) => {
  if (IS_LINUX) {
    await linuxDeactivate((c) => event.sender.send('bypass-log', c));
  } else {
    await deactivateAll();
  }
  refreshTray().catch(() => {});
});
ipcMain.handle('get-platform', () => (IS_LINUX ? 'linux' : 'windows'));
ipcMain.handle('get-status', async () => {
  if (IS_LINUX) {
    return linuxStatus();
  }
  return getStatus();
});
ipcMain.handle('get-startup', () => getStartup());
ipcMain.handle('set-startup', (_event, enabled: unknown) => {
  setStartup(enabled === true);
  refreshTray().catch(() => {});
});

// A pagina reporta a altura de que precisa (o warning do bypass ativo faz o conteudo crescer).
// A janela e fixa (resizable: false), entao o proprio app ajusta para caber tudo sem cortar.
ipcMain.on('resize-window', (_event, height: unknown) => {
  const h = Number(height);
  if (!mainWindow || mainWindow.isDestroyed() || !Number.isFinite(h) || h <= 0) return;
  const [, currentH] = mainWindow.getSize();
  if (Math.abs(currentH - Math.round(h)) < 2) return;
  mainWindow.setSize(480, Math.round(h));
});
