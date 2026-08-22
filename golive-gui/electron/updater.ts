// Atualizacao automatica via GitHub Releases — sem servidor proprio.
//
// Windows: o target e portable, e o electron-updater nao suporta portable (so NSIS).
// Entao o update do Windows e proprio: consulta a release mais recente na API do
// GitHub, baixa o exe novo, substitui o atual (via PORTABLE_EXECUTABLE_FILE, a
// variavel que o electron-builder portable define) e reabre a versao nova.
//
// Mac e Linux: o autoUpdater do electron-updater cuida (dmg/zip assinado e AppImage).

import { app, dialog, BrowserWindow } from "electron";
import { createWriteStream } from "fs";
import { rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { spawn } from "child_process";
import { autoUpdater } from "electron-updater";
import { request } from "https";

const REPO = "bezumiya/GoLiveBypass";
// O artifactName leva a versao (GoLiveBypass-1.1.5.exe): o AppImageLauncher e
// outros integradores nao sobrescrevem o arquivo quando o nome muda por versao.
const EXE_PREFIX = "GoLiveBypass-";
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // re-checa a cada 4h
const RETRY_COUNT = 10; // o exe em uso no Windows recusa rename por um tempo
const RETRY_DELAY_MS = 1000;

let lastCheckAt = 0;
let checking = false;
let updateReady = false;

// ------------------------------------------------------------------ GitHub API

function githubLatestRelease(): Promise<{ tag: string; url: string } | null> {
  return new Promise((resolve) => {
    const req = request(
      {
        host: "api.github.com",
        path: `/repos/${REPO}/releases/latest`,
        method: "GET",
        headers: { "User-Agent": "GoLiveBypass", Accept: "application/vnd.github+json" },
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          return resolve(null);
        }
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (c) => {
          body += c;
          if (body.length > 1_000_000) req.destroy();
        });
        res.on("end", () => {
          try {
            const data = JSON.parse(body);
            const asset = (data.assets || []).find(
              (a: { name: string }) =>
                a.name.startsWith(EXE_PREFIX) && a.name.endsWith(".exe"),
            );
            if (!asset || !asset.browser_download_url) return resolve(null);
            resolve({ tag: String(data.tag_name), url: asset.browser_download_url });
          } catch {
            resolve(null);
          }
        });
      },
    );
    req.on("error", () => resolve(null));
    req.setTimeout(15_000, () => req.destroy());
    req.end();
  });
}

function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = request(url, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error("download falhou: HTTP " + res.statusCode));
      }
      const out = createWriteStream(dest);
      res.pipe(out);
      out.on("finish", () => {
        out.close();
        resolve();
      });
      out.on("error", reject);
    });
    req.on("error", reject);
    req.end();
  });
}

// ------------------------------------------------------------------ Windows portable

function portableExePath(): string | null {
  // O electron-builder portable define esta variavel com o caminho do exe em uso.
  const current = process.env.PORTABLE_EXECUTABLE_FILE;
  return current && current.trim() !== "" ? current : null;
}

function tryReplace(target: string, downloaded: string): Promise<boolean> {
  return new Promise((resolve) => {
    const attempt = (tries: number) => {
      const { rmSync, renameSync } = require("fs");
      try {
        rmSync(target, { force: true });
        renameSync(downloaded, target);
        resolve(true);
      } catch {
        if (tries <= 0) return resolve(false);
        setTimeout(() => attempt(tries - 1), RETRY_DELAY_MS);
      }
    };
    attempt(RETRY_COUNT);
  });
}

async function updateWindowsPortable(url: string): Promise<boolean> {
  const current = portableExePath();
  if (current === null) {
    console.warn("[updater] PORTABLE_EXECUTABLE_FILE nao definido; pulando update.");
    return false;
  }

  const downloaded = join(tmpdir(), "GoLiveBypass-update.exe");
  try {
    await downloadFile(url, downloaded);
  } catch (error) {
    console.error("[updater] download falhou:", error);
    return false;
  }

  if (!(await tryReplace(current, downloaded))) {
    console.error("[updater] nao consegui substituir o exe em uso.");
    return false;
  }

  // Abre a versao nova e encerra a atual. O quit nao reverte o bypass: o novo
  // processo assume e o before-quit do processo antigo desfaria a injecao.
  spawn(current, [], { detached: true, stdio: "ignore" }).unref();
  return true;
}

// O main process consulta esta flag no before-quit: quando o auto-update esta
// aplicando, o quit nao pode ser segurado (senao o app antigo fica vivo e o
// novo morre no lock de instancia unica — o "fecha mas nao abre").
let quittingForUpdate = false;
export function markQuittingForUpdate() {
  quittingForUpdate = true;
}
export function isQuittingForUpdate() {
  return quittingForUpdate;
}

// ------------------------------------------------------------------ API publica

export function setupUpdater(getMainWindow: () => BrowserWindow | null) {
  // Dev (npm run dev): o app roda fora do pacote, sem o app-update.yml embutido.
  // O electron-updater usa o dev-app-update.yml na raiz do projeto + esta flag.
  const isDev = !app.isPackaged;
  if (isDev) {
    autoUpdater.forceDevUpdateConfig = true;
    // Em dev nao existe o runtime AppImage; sem este env o AppImageUpdater aborta
    // antes de baixar. Aponta para um AppImage buildado (so o caminho importa aqui).
    if (process.env.APPIMAGE === undefined) {
      process.env.APPIMAGE = join(app.getAppPath(), "dist-app", `GoLiveBypass-${app.getVersion()}.AppImage`);
    }
  }

  // Mac/Linux: updater nativo (dmg/zip assinado, AppImage).
  if (process.platform !== "win32") {
    autoUpdater.autoDownload = true;
    autoUpdater.logger = console;

    // O download corre sozinho em background; ao terminar, avisa o usuario e
    // so instala com o OK dele — atualizar sem avisar derruba o app na hora.
    autoUpdater.on("update-downloaded", (info) => {
      updateReady = true;
      const win = getMainWindow();
      const choice = win
        ? dialog.showMessageBoxSync(win, {
            type: "info",
            title: "Atualização disponível",
            message: `GoLiveBypass ${info.version} foi baixada.`,
            detail: "Reiniciar agora para aplicar a atualização? O app fecha e reabre sozinho.",
            buttons: ["Reiniciar agora", "Depois"],
            defaultId: 0,
            cancelId: 1,
          })
        : 0;

      // Em dev o quitAndInstall nao funciona: nao ha runtime AppImage montado,
      // e o processo e gerenciado pelo vite — o arquivo ate e substituido, mas
      // o app nao reinicia (e o arquivo some). O dev serve para verificar a
      // notificacao; a instalacao real so vale no app empacotado.
      if (choice === 0 && !isDev) {
        markQuittingForUpdate();
        autoUpdater.quitAndInstall();
      }
    });

    autoUpdater.checkForUpdatesAndNotify().catch(() => {});
    return;
  }

  // Windows portable: checagem periodica em background.
  setInterval(() => void checkWindowsUpdate(getMainWindow), CHECK_INTERVAL_MS);
  void checkWindowsUpdate(getMainWindow);
}

async function checkWindowsUpdate(getMainWindow: () => BrowserWindow | null) {
  if (checking || updateReady) return;
  if (Date.now() - lastCheckAt < 60_000) return; // no minimo 1min entre checagens
  checking = true;
  lastCheckAt = Date.now();

  try {
    const release = await githubLatestRelease();
    if (release === null) return;

    const current = app.getVersion();
    const latest = release.tag.replace(/^v/, "");
    const isNewer = latest !== current;
    if (!isNewer) return;

    const win = getMainWindow();
    const choice = win
      ? dialog.showMessageBoxSync(win, {
          type: "info",
          title: "Atualização disponível",
          message: `GoLiveBypass ${latest} está disponível.`,
          detail: "Baixar e instalar agora? O app reabre sozinho ao terminar.",
          buttons: ["Atualizar agora", "Depois"],
          defaultId: 0,
          cancelId: 1,
        })
      : 0;

    if (choice !== 0) return;

    const ok = await updateWindowsPortable(release.url);
    if (ok) {
      updateReady = true;
      app.quit();
    } else {
      console.error("[updater] falha ao aplicar o update portable.");
    }
  } finally {
    checking = false;
  }
}
