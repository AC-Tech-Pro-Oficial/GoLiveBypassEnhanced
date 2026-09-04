import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

describe("Electron renderer security boundary", () => {
  const main = fs.readFileSync(path.resolve(process.cwd(), "electron/main.ts"), "utf8");
  const preload = fs.readFileSync(path.resolve(process.cwd(), "electron/preload.ts"), "utf8");

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
});
