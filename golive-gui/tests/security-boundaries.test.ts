import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const main = readFileSync(join(__dirname, "..", "electron", "main.ts"), "utf8");
const preload = readFileSync(join(__dirname, "..", "electron", "preload.ts"), "utf8");
const logsPreload = readFileSync(join(__dirname, "..", "electron", "preload-logs.ts"), "utf8");
const vite = readFileSync(join(__dirname, "..", "vite.config.ts"), "utf8");

describe("Electron privilege boundaries", () => {
  it("sandboxes both renderer windows behind contextBridge", () => {
    expect((main.match(/nodeIntegration:\s*false/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect((main.match(/contextIsolation:\s*true/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect((main.match(/sandbox:\s*true/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(preload).toContain("contextBridge.exposeInMainWorld('api', api)");
    expect(logsPreload).toContain("contextBridge.exposeInMainWorld('api', api)");
  });

  it("gives the diagnostic window a separate least-privilege preload", () => {
    expect(vite).toContain("electron/preload-logs.ts");
    expect(main).toContain('preload: path.join(__dirname, "preload-logs.js")');

    for (const forbidden of [
      "activate:",
      "deactivate:",
      "setStartup:",
      "setAutoUpdate:",
      "setAutoRevive:",
      "setUpdateChannel:",
      "setNetMode:",
      "installTor:",
      "testProxy:",
      "reportBug:",
    ]) {
      expect(logsPreload).not.toContain(forbidden);
    }

    for (const allowed of [
      "getStatus:",
      "startLogWatch:",
      "getDiagnostic:",
      "openBugReport:",
      "openLogFolder:",
    ]) {
      expect(logsPreload).toContain(allowed);
    }
  });

  it("binds privileged IPC to the intended top-level renderer", () => {
    expect(main).toContain("event.senderFrame === event.sender.mainFrame");
    expect(main).toContain('assertIpcSender(event, "main")');
    expect(main).toContain('assertIpcSender(event, "ui")');
    expect(main).not.toMatch(/ipcMain\.handle\(\s*["']/);

    for (const channel of [
      "activate",
      "deactivate",
      "set-startup",
      "set-auto-update",
      "set-auto-revive",
      "set-update-channel",
      "set-net-mode",
      "install-tor",
      "test-proxy",
      "report-bug",
    ]) {
      expect(main).toContain(`handleMain("${channel}"`);
    }

    for (const channel of [
      "get-status",
      "start-log-watch",
      "get-diagnostic",
      "open-bug-report",
      "open-log-folder",
    ]) {
      expect(main).toContain(`handleUi("${channel}"`);
    }
  });

  it("denies web permissions and external navigation outside the allowlist", () => {
    expect(main).toContain("setPermissionRequestHandler");
    expect(main).toContain("setPermissionCheckHandler");
    expect(main).toContain("TRUSTED_EXTERNAL_HOSTS");
    expect(main).toContain('"github.com"');
    expect(main).toContain('"discord.gg"');
    expect(main).toContain('win.webContents.on("will-navigate"');
    expect(main).toContain("setWindowOpenHandler");
  });
});
