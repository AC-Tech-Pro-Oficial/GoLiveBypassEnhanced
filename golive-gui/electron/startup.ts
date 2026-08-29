/**
 * Autostart multiplataforma.
 *
 * O Electron prove app.setLoginItemSettings() (e o getLoginItemSettings()), mas
 * em build portable do Windows ele NAO funciona: o metodo delega ao instalador
 * Squirrel/MSI para criar a entrada de Run, e o portable nao tem instalador. O
 * usuario clica "Iniciar com Windows", o app chama setLoginItemSettings({...}),
 * o metodo retorna sucesso -- e nada acontece. O checkbox no renderer continua
 * desmarcado na proxima abertura porque o getLoginItemSettings tambem le do
 * instalador (que nao escreveu nada), e nao tem como a interface saber que a
 * chamada "funcionou" sem efeito.
 *
 * Workaround: no Windows, escrever direto em HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run
 * via reg.exe. O reg.exe ja vem com o Windows, nao exige elevacao (HKCU e do
 * usuario), e o caminho do exe e o `process.execPath` (que no portable e o .exe
 * que o usuario esta rodando agora). Args = ["--hidden"] para subir so na
 * bandeja sem abrir a janela. Remover o autostart = reg delete.
 *
 * No macOS, o setLoginItemSettings funciona (foi reescrito no Electron 22+
 * para portable, e o app oficial e dmg/zip com category). Mantemos o caminho
 * antigo. No Linux, o caminho do .desktop em ~/.config/autostart continua.
 */
import { app } from "electron";
import path from "path";
import fs from "fs";
import { execFileSync } from "child_process";

const IS_WINDOWS = process.platform === "win32";
const IS_LINUX = process.platform === "linux";
const IS_MAC = process.platform === "darwin";

const RUN_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const ENTRY_NAME = "GoLiveBypass";

/**
 * Retorna o caminho do executavel que deve ser usado para iniciar o app no boot.
 *
 * No Linux, quando o app esta rodando de dentro de um AppImage, o `process.execPath`
 * e o caminho dentro do mountpoint FUSE temporario (`/tmp/.mount_GoLiveXXX/golive-gui`),
 * que NAO persiste entre sessoes -- o mountpoint e desmontado junto com o AppImage.
 * A variavel de ambiente `APPIMAGE` (definida pelo runtime do AppImage) guarda o
 * caminho real do .AppImage no disco, e e isso que o .desktop precisa usar.
 *
 * No Windows e macOS, `process.execPath` ja e o caminho certo (no portable, o
 * proprio .exe; no macOS, o app.asar/Contents/MacOS/GoLiveBypass).
 */
function realExecPath(): string {
  if (IS_LINUX) {
    const appImage = process.env.APPIMAGE;
    if (appImage && fs.existsSync(appImage)) return appImage;
  }
  return process.execPath;
}

/**
 * Marca o app para iniciar com o login do usuario.
 * - Windows: HKCU\...\Run via reg.exe (funciona em portable)
 * - macOS: app.setLoginItemSettings (funciona em dmg/zip)
 * - Linux: ~/.config/autostart/golivebypass.desktop
 *
 * Args de execucao: ["--hidden"] para subir so na bandeja no login, sem abrir
 * a janela do GUI. A primeira coisa que o main faz com --hidden e a checagem
 * launchedHidden() (ver main.ts), que decide se cria a janela visivel.
 */
export function setStartup(enabled: boolean): void {
  if (IS_WINDOWS) {
    if (enabled) {
      // Aspas escapadas: o caminho do exe pode ter espacos (o portable e
      // "GoLiveBypass-1.1.9.exe" em C:\Program Files\ por exemplo). reg.exe
      // interpreta a string como valor REG_SZ, e espacos sem aspas quebram
      // o registro. O prefixo " so serve se o valor comecar com aspas;
      // aqui o caminho e o valor inteiro do registro.
      const value = `\"${realExecPath()}\" --hidden`;
      try {
        execFileSync("reg.exe", [
          "add",
          RUN_KEY,
          "/v", ENTRY_NAME,
          "/t", "REG_SZ",
          "/d", value,
          "/f",
        ], { stdio: "ignore" });
      } catch (error) {
        // Sem HKCU: usuario sem perfil movel, ou sessao sem permissao (raro
        // mas pode acontecer em kiosk). Silencioso -- a UI nao foi projetada
        // para mostrar erro, e o usuario pode re-tentar.
        console.error("falha ao adicionar entrada de Run:", error);
      }
    } else {
      try {
        execFileSync("reg.exe", [
          "delete",
          RUN_KEY,
          "/v", ENTRY_NAME,
          "/f",
        ], { stdio: "ignore" });
      } catch {
        // Ignorar quando a entrada nao existe: o `reg delete` falha com nivel
        // de erro 1 quando a chave nao esta presente, e o caller nao distingue
        // isso de um erro real. O retorno e mapeado em getStartup() de qualquer
        // jeito.
      }
    }
    return;
  }

  if (IS_LINUX) {
    const file = path.join(app.getPath("home"), ".config", "autostart", "golivebypass.desktop");
    if (enabled) {
      const dir = path.dirname(file);
      try {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(file, [
          "[Desktop Entry]",
          "Type=Application",
          "Name=GoLiveBypass",
          "Comment=Devolve o Go Live e a camera no Discord",
          `Exec=${realExecPath()} --hidden`,
          "X-GNOME-Autostart-enabled=true",
          "",
        ].join("\n"));
      } catch (error) {
        console.error("falha ao escrever .desktop:", error);
      }
    } else if (fs.existsSync(file)) {
      try {
        fs.unlinkSync(file);
      } catch (error) {
        console.error("falha ao remover .desktop:", error);
      }
    }
    return;
  }

  if (IS_MAC) {
    // setLoginItemSettings no Electron 22+ funciona em dmg/zip (foi
    // reescrito para suportar portable, mas o app oficial do projeto e
    // dmg). Mantemos o caminho padrao.
    app.setLoginItemSettings({
      openAtLogin: enabled,
      args: ["--hidden"],
    });
    return;
  }
}

/**
 * Le o estado atual do autostart. Retorna true se o app vai subir com o
 * login, false caso contrario.
 *
 * No Windows, lemos diretamente do registro. Usar getLoginItemSettings do
 * Electron daria sempre false em portable (porque nao escreve nada), e o
 * checkbox no renderer viraria sempre desmarcado mesmo com o registro
 * configurado -- e a queixa da issue #84.
 */
export function getStartup(): boolean {
  if (IS_LINUX) {
    const file = path.join(app.getPath("home"), ".config", "autostart", "golivebypass.desktop");
    return fs.existsSync(file);
  }
  if (IS_WINDOWS) {
    try {
      const output = execFileSync("reg.exe", [
        "query",
        RUN_KEY,
        "/v", ENTRY_NAME,
      ], { encoding: "utf8" });
      // /v so imprime a chave pedida; se ela existir, aparece "GoLiveBypass" no stdout.
      // Se nao existir, reg.exe sai com codigo 1 e escreve no stderr.
      return output.includes(ENTRY_NAME);
    } catch {
      return false;
    }
  }
  return app.getLoginItemSettings().openAtLogin;
}

/**
 * Reescreve a entrada de Run com o caminho ATUAL do exe, se a entrada existir.
 *
 * O valor da Run key congela o caminho de quando o usuario ativou o toggle — e o
 * portable muda de lugar o tempo todo (baixa na Downloads, move para o Desktop,
 * renomeia, o updater substitui). O Windows falha em SILENCIO quando o caminho do
 * valor nao existe mais: o app simplesmente nao abre no boot, com o checkbox
 * marcado — getStartup() so confere se a ENTRADA existe, nao se o caminho dela e
 * valido. Rodar isto a cada abertura do app cura todos esses casos (um reg add
 * idempotente, custo desprezivel) e devolve a flag --hidden se ela se perdeu.
 */
export function syncStartupEntry(): void {
  if (!IS_WINDOWS) return;
  if (!getStartup()) return;
  setStartup(true);
}

/**
 * Detecta se o app foi iniciado pelo autostart (Run key no Windows,
 * openAsHidden do macOS, ou o .desktop do Linux). Usado para nao abrir a
 * janela visivel em boots automaticos -- o usuario so precisa do icone
 * na bandeja.
 */
export function launchedHidden(): boolean {
  if (process.argv.includes("--hidden")) return true;
  if (IS_MAC) {
    return app.getLoginItemSettings().wasOpenedAtLogin;
  }
  if (IS_LINUX) {
    return process.argv.includes("--hidden");
  }
  return false;
}
