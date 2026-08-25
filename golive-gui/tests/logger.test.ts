import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

import * as logger from "../electron/logger";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "golive-log-"));
  logger._resetForTests();
  logger.initLogger(dir);
});

afterEach(() => {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // ok
  }
});

describe("logger", () => {
  it("escreve no arquivo com formato [hora] [nivel][cat] msg | k=v", () => {
    logger.info("tor", "tunel.verificado", { ms: 342, porta: 9060 });

    const conteudo = fs.readFileSync(path.join(dir, "gui.log"), "utf8");
    expect(conteudo).toMatch(
      /\[\d{2}:\d{2}:\d{2}\] \[info\]\[tor\] tunel\.verificado \| ms=342 porta=9060/,
    );
  });

  it("dedupe: linhas repetidas consecutivas colapsam em (xN) no getRecent", () => {
    for (let i = 0; i < 5; i++) logger.error("net", "socks.falha", { motivo: "handshake" });

    const linhas = logger.getRecent().split("\n").filter(Boolean);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toContain("(x5)");
  });

  it("ring buffer respeita teto de bytes mantendo o fim", () => {
    for (let i = 0; i < 1200; i++) logger.info("app", `linha-${i}-${"p".repeat(200)}`);

    const recent = logger.getRecent();
    expect(Buffer.byteLength(recent)).toBeLessThanOrEqual(128 * 1024);
    expect(recent).toContain("linha-1199");
  });

  it("rotaciona o arquivo ao passar de 2MB (corta pra metade)", () => {
    const linhaGrande = "x".repeat(1024 * 1024);
    logger.info("app", linhaGrande);
    logger.info("app", linhaGrande);

    const size = fs.statSync(path.join(dir, "gui.log")).size;
    expect(size).toBeLessThan(2 * 1024 * 1024 + 2048);
  });

  it("initLogger sem pasta nao lanca e segue so com ring", () => {
    logger._resetForTests();
    logger.initLogger("/dev/null/caminho-impossivel");
    expect(() => logger.info("app", "sobrevive")).not.toThrow();
    expect(logger.getRecent()).toContain("sobrevive");
  });
});
