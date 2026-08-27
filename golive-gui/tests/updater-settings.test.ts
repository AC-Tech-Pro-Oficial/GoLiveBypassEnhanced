import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

describe("updater-settings", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "golive-updater-test-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ok
    }
  });

  function readAutoUpdateFrom(dir: string): boolean {
    try {
      const file = path.join(dir, "settings.json");
      if (!fs.existsSync(file)) return true;
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      return typeof data.autoUpdate === "boolean" ? data.autoUpdate : true;
    } catch {
      return true;
    }
  }

  function saveAutoUpdateTo(dir: string, enabled: boolean) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, "settings.json");
      const atual = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
      fs.writeFileSync(file, JSON.stringify({ ...atual, autoUpdate: enabled }, null, 4));
    } catch (error) {
      console.error("[settings] nao consegui salvar preferencia de atualizacao:", error);
    }
  }

  it("retorna true por padrao quando settings.json nao existe", () => {
    expect(readAutoUpdateFrom(tempDir)).toBe(true);
  });

  it("salva false e recupera corretamente", () => {
    saveAutoUpdateTo(tempDir, false);
    expect(readAutoUpdateFrom(tempDir)).toBe(false);

    const data = JSON.parse(fs.readFileSync(path.join(tempDir, "settings.json"), "utf8"));
    expect(data.autoUpdate).toBe(false);
  });

  it("salva true e recupera corretamente", () => {
    saveAutoUpdateTo(tempDir, false);
    expect(readAutoUpdateFrom(tempDir)).toBe(false);

    saveAutoUpdateTo(tempDir, true);
    expect(readAutoUpdateFrom(tempDir)).toBe(true);
  });

  it("preserva configuracoes existentes (proxy, routeMode) ao alterar autoUpdate", () => {
    const file = path.join(tempDir, "settings.json");
    fs.writeFileSync(
      file,
      JSON.stringify({ proxy: "socks5://127.0.0.1:1080", routeMode: "free" }, null, 4),
    );

    saveAutoUpdateTo(tempDir, false);

    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(data.proxy).toBe("socks5://127.0.0.1:1080");
    expect(data.routeMode).toBe("free");
    expect(data.autoUpdate).toBe(false);
    expect(readAutoUpdateFrom(tempDir)).toBe(false);
  });

  it("trata arquivo settings.json corrompido retornando true (padrao seguro)", () => {
    const file = path.join(tempDir, "settings.json");
    fs.writeFileSync(file, "{ invalid json content ... ");
    expect(readAutoUpdateFrom(tempDir)).toBe(true);
  });
});
