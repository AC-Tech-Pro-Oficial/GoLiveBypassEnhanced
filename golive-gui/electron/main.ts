import { app, BrowserWindow, ipcMain, Menu, nativeImage, Tray, shell } from "electron";
import path, { dirname } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { homedir } from "os";
import fs from "fs";
import { exec, execFile, execFileSync, execSync, spawnSync } from "child_process";
import { bypassCode } from "./bypass";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const isMac = process.platform === "darwin";

// O fs do Electron trata *.asar como pasta. original-fs e o disco de verdade, o mesmo
// que o instalador do Vencord usa para renomear o app.asar.
const diskFs: typeof fs = (() => {
  try {
    return createRequire(import.meta.url)("original-fs");
  } catch {
    return fs;
  }
})();

const FLAVOURS = ["Discord", "DiscordPTB", "DiscordCanary"];

const MAC_APPS = [
  { flavour: "Discord", appName: "Discord.app", processName: "Discord" },
  {
    flavour: "DiscordPTB",
    appName: "Discord PTB.app",
    processName: "Discord PTB",
  },
  {
    flavour: "DiscordCanary",
    appName: "Discord Canary.app",
    processName: "Discord Canary",
  },
] as const;

const MAC_HELPER_PROCESSES = [
  "Discord Helper",
  "Discord Helper (GPU)",
  "Discord Helper (Renderer)",
  "Discord Helper (Plugin)",
];

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

// Fechar a janela esconde na bandeja (Windows) / barra de menus (Mac); so o Sair do menu
// desliga o app (e reverte o bypass, como o fechar da janela fazia antes). Sem a trava, o X
// derrubaria o app e a pessoa nem notaria que a janela foi parar junto do relogio.
let quitting = false;
let cleaningUp = false;

// Os icones moram em assets/ e seguem no pacote pelo "files" do electron-builder. O icone do
// exe vem de build/icon.ico; no Mac o .icns e gerado a partir do mesmo desenho.
function assetPath(name: string) {
  return path.join(__dirname, "..", "assets", name);
}

function startupLabel() {
  return isMac ? "Iniciar com o Mac" : "Iniciar com o Windows";
}

function enclosingApp(filePath: string) {
  let dir = path.resolve(filePath);
  while (dir !== path.dirname(dir)) {
    if (dir.endsWith(".app")) return dir;
    dir = path.dirname(dir);
  }
  return filePath;
}

function openAppManagementSettings() {
  void shell.openExternal(
    "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_AppBundles",
  );
}

function writeError(targetPath: string) {
  if (isMac) {
    const appPath = enclosingApp(targetPath);
    return [
      `Não foi possível escrever dentro de Discord.app (${targetPath}).`,
      "",
      "O macOS bloqueia outros apps de alterar o Discord — é a mesma permissão que o Vencord pede.",
      "",
      "1. Ajustes do Sistema → Privacidade e Segurança → Administração de Apps",
      "2. Ative o GoLiveBypass (ou arraste o app para a lista)",
      "3. Volte aqui e tente de novo",
      "",
      "Se ainda falhar, no Terminal:",
      `sudo chown -R "$(whoami):staff" ${JSON.stringify(appPath)}`,
    ].join("\n");
  }
  return `Não foi possível escrever na pasta do Discord (${targetPath}).`;
}

function macPermissionDenied(targetPath: string): never {
  openAppManagementSettings();
  throw new Error(writeError(targetPath));
}

function lockedFileHint(targetPath: string) {
  if (isMac) {
    return `Arquivo bloqueado pelo sistema: ${targetPath}\n\nDICA: Feche o Discord completamente (Cmd+Q) e tente novamente.`;
  }
  return `Arquivo bloqueado pelo sistema: ${targetPath}\n\nDICA: Feche o Discord completamente pelo Gerenciador de Tarefas e tente novamente.`;
}

function isPermissionError(e: any) {
  return e && (e.code === "EACCES" || e.code === "EPERM");
}

/**
 * O app mora na bandeja / barra de menus.  Windows o arg --hidden esconde a janela;
 * No Mac usamos wasOpenedAtLogin porque o openAsHidden morreu no macOS 13 :(
 * Nos dois casos sobe so o icone, sem jogar janela na cara do usuario a cada login.
 */
function getStartup() {
  return app.getLoginItemSettings().openAtLogin;
}

function setStartup(enabled: boolean) {
  app.setLoginItemSettings({
    openAtLogin: enabled,
    args: ["--hidden"],
  });
}

function launchedHidden() {
  return (
    process.argv.includes("--hidden") ||
    app.getLoginItemSettings().wasOpenedAtLogin
  );
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 480,
    height: isMac ? 640 : 600,
    resizable: false,
    icon: assetPath("icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: true,
      contextIsolation: false,
    },
    autoHideMenuBar: true,
    titleBarStyle: isMac ? "hiddenInset" : "hidden",
    ...(isMac
      ? { trafficLightPosition: { x: 16, y: 16 } }
      : {
          titleBarOverlay: {
            color: "#1e1f22",
            symbolColor: "#ffffff",
          },
        }),
  });

  mainWindow.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    mainWindow?.hide();
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

function showWindow() {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
    // A bandeja pode ter mudado o startup com a janela escondida; ao reaparecer, sincroniza.
    mainWindow.webContents.send("refresh-startup");
  } else {
    createWindow();
  }
  refreshTray();
}

function statusLabel(status: string) {
  if (status === "ACTIVE") return "ativo";
  if (status === "OTHER_MOD") return "outro mod detectado";
  if (status === "NOT_FOUND") return "Discord não encontrado";
  return "inativo";
}

// O menu e remontado a cada mudanca: e o jeito simples de o rotulo de status e o item
// Ativar/Desativar refletirem o estado atual sem logica de diff.
function refreshTray() {
  if (!tray) return;
  try {
    const status = getStatus();
    const label = statusLabel(status);
    tray.setToolTip(`GoLiveBypass — ${label}`);
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: `GoLiveBypass — ${label}`, enabled: false },
        { type: "separator" },
        { label: "Abrir", click: showWindow },
        {
          label: status === "ACTIVE" ? "Desativar o bypass" : "Ativar o bypass",
          enabled: status !== "NOT_FOUND",
          click: toggleFromTray,
        },
        {
          label: startupLabel(),
          type: "checkbox",
          checked: getStartup(),
          click: (item) => setStartup(item.checked),
        },
        { type: "separator" },
        // Sair pela bandeja / barra de menus reverte so o que e nosso.
        {
          label: status === "ACTIVE" ? "Sair (desfaz o bypass)" : "Sair",
          click: quitApp,
        },
      ]),
    );
  } catch {
    // uma bandeja sem menu nao vale derrubar o app
  }
}

async function toggleFromTray() {
  try {
    if (getStatus() === "ACTIVE") await deactivateAll();
    else await activateBypass(null, "");
  } finally {
    refreshTray();
  }
}

function quitApp() {
  quitting = true;
  app.quit();
}

function createTray() {
  const icon = nativeImage.createFromPath(assetPath("tray.png"));
  if (isMac) icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.on("click", showWindow);
  refreshTray();
}

// Com o app morando na bandeja, rodar o exe de novo nao pode empilhar uma segunda copia:
// ela morre aqui e a janela da primeira aparece.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => showWindow());

  app.whenReady().then(() => {
    // No login (start com --hidden / wasOpenedAtLogin) sobe so a bandeja; a janela aparece no clique.
    if (!launchedHidden()) createWindow();
    createTray();
    app.on("activate", showWindow);
  });
}

// Cmd+Q no Mac nao passa por window-all-closed da mesma forma que o Sair da bandeja no Windows:
// o restore vive aqui para os dois caminhos.
app.on("before-quit", (event) => {
  // A segunda instancia so acorda a primeira e morre: sem esta guarda ela restauraria o
  // Discord na saida, desfazendo o bypass que a instancia principal acabou de aplicar.
  if (!gotLock || cleaningUp) return;
  event.preventDefault();
  quitting = true;
  cleaningUp = true;
  deactivateAll().finally(() => {
    app.quit();
  });
});

app.on("window-all-closed", () => {
  // No Mac o app fica na barra de menus com a janela fechada; no Windows o X ja esconde, entao
  // isto so dispara de verdade na hora de sair, e o restore ja foi pelo before-quit.
  if (!isMac) {
    quitting = true;
    app.quit();
  }
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
  bundlePath?: string;
}

function getWinDiscordInstalls(): DiscordInstall[] {
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) return [];

  const installs: DiscordInstall[] = [];
  for (const flavour of FLAVOURS) {
    const rootPath = path.join(localAppData, flavour);
    if (!diskFs.existsSync(rootPath)) continue;

    const dirs = diskFs.readdirSync(rootPath).filter((d) => d.startsWith("app-"));
    if (dirs.length === 0) continue;

    dirs.sort();
    const latestApp = dirs[dirs.length - 1];
    const resourcesPath = path.join(rootPath, latestApp, "resources");
    const exePath = path.join(rootPath, latestApp, `${flavour}.exe`);
    const asar = path.join(resourcesPath, "app.asar");
    const originalAsar = path.join(resourcesPath, "_app.asar");
    if (diskFs.existsSync(asar) || diskFs.existsSync(originalAsar)) {
      installs.push({ flavour, resources: resourcesPath, exePath });
    }
  }
  return installs;
}

function getMacDiscordInstalls(): DiscordInstall[] {
  const roots = ["/Applications", path.join(homedir(), "Applications")];
  const installs: DiscordInstall[] = [];
  const seen = new Set<string>();

  for (const root of roots) {
    for (const { flavour, appName } of MAC_APPS) {
      if (seen.has(flavour)) continue;
      const bundlePath = path.join(root, appName);
      const resources = path.join(bundlePath, "Contents", "Resources");
      const asar = path.join(resources, "app.asar");
      const originalAsar = path.join(resources, "_app.asar");
      if (diskFs.existsSync(asar) || diskFs.existsSync(originalAsar)) {
        installs.push({ flavour, resources, exePath: "", bundlePath });
        seen.add(flavour);
      }
    }
  }
  return installs;
}

function getDiscordInstalls(): DiscordInstall[] {
  return withNoAsar(() =>
    isMac ? getMacDiscordInstalls() : getWinDiscordInstalls(),
  );
}

function discordIsRunning(): boolean {
  if (isMac) {
    for (const { processName } of MAC_APPS) {
      try {
        execFileSync("pgrep", ["-x", processName], { stdio: "ignore" });
        return true;
      } catch {}
    }
    return false;
  }

  for (const flavour of FLAVOURS) {
    try {
      const out = execSync(`tasklist /FI "IMAGENAME eq ${flavour}.exe" /NH`, {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "ignore"],
      });
      if (out.toLowerCase().includes(`${flavour}.exe`.toLowerCase()))
        return true;
    } catch {}
  }
  return false;
}

async function waitUntilDiscordGone(tries = 40, delayMs = 250) {
  for (let i = 0; i < tries; i++) {
    if (!discordIsRunning()) return true;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return !discordIsRunning();
}

function killMacProcesses(names: readonly string[], signal?: "-9") {
  for (const name of names) {
    try {
      execFileSync(
        "killall",
        signal ? [signal, name] : [name],
        { stdio: "ignore" },
      );
    } catch {}
  }
}

async function killDiscord() {
  if (isMac) {
    const mains = MAC_APPS.map((macApp) => macApp.processName);
    killMacProcesses(mains);
    killMacProcesses(MAC_HELPER_PROCESSES);
    if (!(await waitUntilDiscordGone())) {
      killMacProcesses(mains, "-9");
      killMacProcesses(MAC_HELPER_PROCESSES, "-9");
      await waitUntilDiscordGone(20, 250);
    }
    return;
  }

  for (const flavour of FLAVOURS) {
    try {
      execSync(`taskkill /F /T /IM ${flavour}.exe`, { stdio: "ignore" });
    } catch {}
  }
  await waitUntilDiscordGone();
}

function assertResourcesWritable(install: DiscordInstall) {
  const probe = path.join(install.resources, ".golivebypass-write-test");
  try {
    withNoAsar(() => {
      diskFs.writeFileSync(probe, "");
      diskFs.unlinkSync(probe);
    });
  } catch {
    if (isMac) macPermissionDenied(install.bundlePath || install.resources);
    throw new Error(writeError(install.bundlePath || install.resources));
  }
}

function isAdHocSigned(bundlePath: string) {
  const result = spawnSync("codesign", ["-dv", "--verbose=2", bundlePath], {
    encoding: "utf8",
  });
  const info = `${result.stdout}\n${result.stderr}`;
  return /\badhoc\b/i.test(info) || /TeamIdentifier=not set/.test(info);
}

function assertDiscordSignature(bundlePath: string | undefined) {
  if (!isMac || !bundlePath) return;
  if (!isAdHocSigned(bundlePath)) return;
  throw new Error(
    [
      "O Discord.app está com a assinatura quebrada (assinatura ad-hoc).",
      "",
      "O macOS trata esse Discord como outro app: pede a senha do Keychain (Discord Safe Storage) e o cliente cai. Desativar o bypass não devolve a assinatura original da Discord Inc.",
      "",
      "Baixe o Discord de novo em https://discord.com/download e substitua o app em Aplicativos.",
      "Não apague ~/Library/Application Support/discord — sua conta continua lá.",
    ].join("\n"),
  );
}

// O Vencord só troca o app.asar e não reassina. Reassinar com codesign --deep --sign -
// apaga as entitlements (JIT, library validation) e o Team ID: o Keychain pede senha e
// o Chromium crasha. Com Administração de Apps, o asar novo basta; o xattr só tira quarentena.
function clearBundleQuarantine(bundlePath: string | undefined) {
  if (!isMac || !bundlePath) return;
  try {
    execFileSync("xattr", ["-cr", bundlePath], { stdio: "ignore" });
  } catch {
    // sem atributos estendidos nao e erro
  }
}

async function safeRename(oldPath: string, newPath: string) {
  let lastError;
  for (let i = 0; i < 15; i++) {
    try {
      withNoAsar(() => {
        diskFs.renameSync(oldPath, newPath);
      });
      return;
    } catch (e: any) {
      if (isPermissionError(e)) {
        if (isMac) macPermissionDenied(oldPath);
        throw new Error(writeError(oldPath));
      }
      lastError = e;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error(
    `${lockedFileHint(oldPath)}\nErro: ${lastError?.message || "Desconhecido"}`,
  );
}

async function safeRemove(targetPath: string) {
  let lastError;
  for (let i = 0; i < 15; i++) {
    try {
      withNoAsar(() => {
        if (diskFs.existsSync(targetPath)) {
          diskFs.rmSync(targetPath, { recursive: true, force: true });
        }
      });
      return;
    } catch (e: any) {
      if (isPermissionError(e)) {
        if (isMac) macPermissionDenied(targetPath);
        throw new Error(writeError(targetPath));
      }
      lastError = e;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error(`Falha ao remover arquivo bloqueado: ${targetPath}`);
}

function startDiscord(install: DiscordInstall) {
  try {
    if (isMac && install.bundlePath) {
      execFile("open", [install.bundlePath]);
    } else if (install.exePath) {
      exec(`"${install.exePath}"`);
    }
  } catch {}
}

// O _app.asar so existe quando alguem ja injetou: e o Discord original guardado de lado. Se ele
// existe e o app.asar nao e nosso, quem esta ali e outro mod.
function isOurInjection(resources: string) {
  return withNoAsar(() => {
    const indexJs = path.join(resources, "app.asar", "index.js");
    if (!diskFs.existsSync(indexJs)) return false;
    return diskFs.readFileSync(indexJs, "utf8").includes("golivebypass.js");
  });
}

function writeInjection(asar: string, proxyAddress: string) {
  withNoAsar(() => {
    diskFs.mkdirSync(asar);
    diskFs.writeFileSync(
      path.join(asar, "package.json"),
      JSON.stringify({ name: "discord", main: "index.js" }),
    );
    diskFs.writeFileSync(path.join(asar, "golivebypass.js"), bypassCode);
    diskFs.writeFileSync(
      path.join(asar, "settings.json"),
      JSON.stringify({ enabled: true, proxy: proxyAddress }),
    );
    diskFs.writeFileSync(
      path.join(asar, "index.js"),
      `require('./golivebypass.js');`,
    );
  });
}

async function activateBypass(event: any, proxyAddress: string = "") {
  const installs = getDiscordInstalls();
  if (installs.length === 0) throw new Error("Nenhum Discord encontrado.");

  for (const install of installs) {
    assertDiscordSignature(install.bundlePath);
    assertResourcesWritable(install);
  }

  await killDiscord();

  for (const install of installs) {
    const asar = path.join(install.resources, "app.asar");
    const originalAsar = path.join(install.resources, "_app.asar");

    const hasOriginal = withNoAsar(() => diskFs.existsSync(originalAsar));
    const hasAsar = withNoAsar(() => diskFs.existsSync(asar));

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

    clearBundleQuarantine(install.bundlePath);
    startDiscord(install);
  }
}

async function deactivateAll() {
  const installs = getDiscordInstalls();

  // So desfaz o que e nosso. Isto roda ao sair do app, e antes desfazia qualquer injecao:
  // quem tinha Equicord ou Vencord abria este app, fechava, e o mod sumia sem nada avisar.
  const ours = installs.filter(
    (install) =>
      withNoAsar(() =>
        diskFs.existsSync(path.join(install.resources, "_app.asar")),
      ) && isOurInjection(install.resources),
  );

  // Decidido antes de matar o Discord: sem isto, quem tem outro mod teria o Discord fechado
  // para nada, porque nao haveria o que desfazer depois.
  if (ours.length === 0) return;

  for (const install of ours) assertResourcesWritable(install);

  await killDiscord();

  for (const install of ours) {
    const asar = path.join(install.resources, "app.asar");
    const originalAsar = path.join(install.resources, "_app.asar");

    await safeRemove(asar);
    await safeRename(originalAsar, asar);
    clearBundleQuarantine(install.bundlePath);
    startDiscord(install);
  }
}

function getStatus(): string {
  const installs = getDiscordInstalls();
  if (installs.length === 0) return "NOT_FOUND";
  return withNoAsar(() => {
    for (const install of installs) {
      const asar = path.join(install.resources, "app.asar");
      const originalAsar = path.join(install.resources, "_app.asar");
      if (diskFs.existsSync(originalAsar)) {
        // Checa se é o nosso bypass
        const indexJs = path.join(asar, "index.js");
        if (diskFs.existsSync(indexJs)) {
          const content = diskFs.readFileSync(indexJs, "utf8");
          if (content.includes("golivebypass.js")) return "ACTIVE";
        }
        return "OTHER_MOD";
      }
    }
    return "INACTIVE";
  });
}

// A bandeja precisa refletir o que os botoes da janela fizeram, entao os handlers de IPC
// tambem remontam o menu ao terminar.
ipcMain.handle("activate", async (event, proxyAddress: string) => {
  await activateBypass(event, proxyAddress);
  refreshTray();
});
ipcMain.handle("deactivate", async () => {
  await deactivateAll();
  refreshTray();
});
ipcMain.handle("get-status", () => getStatus());
ipcMain.handle("get-startup", () => getStartup());
ipcMain.handle("set-startup", (_event, enabled: unknown) => {
  setStartup(enabled === true);
  refreshTray();
});
