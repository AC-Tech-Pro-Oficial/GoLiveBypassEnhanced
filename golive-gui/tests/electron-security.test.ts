import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

describe("Electron renderer security boundary", () => {
  const main = fs.readFileSync(path.resolve(process.cwd(), "electron/main.ts"), "utf8");
  const preload = fs.readFileSync(path.resolve(process.cwd(), "electron/preload.ts"), "utf8");
  const renderer = fs.readFileSync(path.resolve(process.cwd(), "src/main.ts"), "utf8");

  it("disables Node integration and enables context isolation in every BrowserWindow", () => {
    expect(main).not.toContain("nodeIntegration: true");
    expect(main).not.toContain("contextIsolation: false");
    expect(main.match(/nodeIntegration: false/g)?.length).toBeGreaterThanOrEqual(2);
    expect(main.match(/contextIsolation: true/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("exports the renderer API only through contextBridge", () => {
    expect(preload).toContain("contextBridge.exposeInMainWorld('api', api)");
    expect(preload).not.toContain("(window as any).api =");
  });

  it("does not expose raw IPC event objects through notification callbacks", () => {
    expect(preload).not.toContain("ipcRenderer.on('refresh-startup', callback)");
    expect(preload).not.toContain("ipcRenderer.on('refresh-auto-update', callback)");
    expect(preload).not.toContain("ipcRenderer.on('refresh-status', callback)");
    expect(preload).toContain("ipcRenderer.on('refresh-startup', () => callback())");
  });

  it("allows only the external hosts intentionally used by the UI", () => {
    expect(main).toContain('new Set(["github.com", "discord.gg"])');
    expect(main).toContain("function isTrustedExternalUrl");
    expect(main).toContain("function hardenWindowNavigation");
    expect(main).not.toMatch(/if \(\/\^https:\\\/\\\/\//);
  });

  it("validates bug-report issue URLs before opening the system browser", () => {
    expect(main).not.toContain("shell.openExternal(posted.issueUrl)");
    expect(main).toContain("openTrustedExternal(posted.issueUrl)");
  });

  it("does not inject API-returned issue URLs through innerHTML", () => {
    expect(renderer).not.toContain('bugSuccessLink.innerHTML = `<a href="');
    expect(renderer).toContain("issue.hostname === 'github.com'");
    expect(renderer).toContain("document.createElement('a')");
  });

  it("does not expose public proxy lists as an enhanced GUI mode", () => {
    const html = fs.readFileSync(path.resolve(process.cwd(), "index.html"), "utf8");
    const electronMain = fs.readFileSync(path.resolve(process.cwd(), "electron/main.ts"), "utf8");
    expect(html).not.toContain('data-mode="free"');
    expect(renderer).not.toContain("setNetMode('free')");
    expect(electronMain).not.toContain('["auto", "tor", "free"]');
    expect(electronMain).toContain('["auto", "tor"]');
  });

  it("migrates legacy free-mode GUI settings back to Tor", () => {
    const electronMain = fs.readFileSync(path.resolve(process.cwd(), "electron/main.ts"), "utf8");
    const readStart = electronMain.indexOf("function readNetMode()");
    const readEnd = electronMain.indexOf("\n}", readStart);
    expect(readStart).toBeGreaterThanOrEqual(0);
    const block = electronMain.slice(readStart, readEnd + 2);
    expect(block).not.toContain('m === "free"');
    expect(block).toContain('return "tor"');
  });

});
