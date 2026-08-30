import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import path from "path";

// Este teste nao replica a logica: ele extrai o BLOCO REAL do detector do
// standalone/golivebypass.js (delimitado pelos marcadores de inicio/fim) e o
// executa com stubs de log/clientWindow e tempo falso. O que passa aqui e o
// codigo que roda no Discord.
const CAMINHO_SCRIPT = path.resolve(process.cwd(), "..", "standalone", "golivebypass.js");

function extrairBloco(): string {
  const src = fs.readFileSync(CAMINHO_SCRIPT, "utf8");
  const m = src.match(
    /\/\/ === detector de gateway zumbi \(issue #145\): inicio ===([\s\S]*?)\/\/ === detector de gateway zumbi: fim ===/,
  );
  if (m === null) throw new Error("bloco do detector de gateway zumbi nao encontrado no standalone");
  return m[1];
}

interface Instancia {
  checar: () => void;
  sinal: () => void;
  estado: () => { ultimoSinal: number; bannerAtivo: boolean; limiar: number };
  logs: string[];
  js: string[];
}

function fabricarDetector(reloading: boolean): Instancia {
  const logs: string[] = [];
  const js: string[] = [];
  const win = {
    webContents: {
      executeJavaScript: (s: string) => {
        js.push(s);
        return Promise.resolve();
      },
    },
  };
  const fabrica = new Function(
    "reloading",
    "log",
    "clientWindow",
    bloco +
      "\nreturn { checar: checarGatewayZumbi, sinal: marcarSinalGateway," +
      " estado: () => ({ ultimoSinal: gwUltimoSinalEm, bannerAtivo: zumbiBannerAtivo, limiar: GW_ZUMBI_SILENCIO_MS }) };",
  );
  const api = fabrica(reloading, (m: string) => logs.push(m), () => win) as Instancia;
  return { ...api, logs, js };
}

let bloco: string;

beforeEach(() => {
  bloco = extrairBloco();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-30T12:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("detector de gateway zumbi (codigo real do standalone)", () => {
  it("nao alerta antes de ver qualquer sinal de gateway (arranque frio tem banner proprio)", () => {
    const det = fabricarDetector(false);
    vi.advanceTimersByTime(10 * 60_000);
    det.checar();
    expect(det.estado().bannerAtivo).toBe(false);
    expect(det.js).toHaveLength(0);
  });

  it("nao alerta com sinal recente (sessao saudavel com heartbeats)", () => {
    const det = fabricarDetector(false);
    det.sinal(); // byte no tunel / connect agora
    vi.advanceTimersByTime(4 * 60_000); // menos que o limiar de 5 min
    det.checar();
    expect(det.estado().bannerAtivo).toBe(false);
    expect(det.js).toHaveLength(0);
  });

  it("alerta no silencio longo e injeta banner com botao de reinicio", () => {
    const det = fabricarDetector(false);
    det.sinal();
    vi.advanceTimersByTime(6 * 60_000);
    det.checar();
    expect(det.estado().bannerAtivo).toBe(true);
    expect(det.logs.some((l) => l.startsWith("gw.silente"))).toBe(true);
    expect(det.js).toHaveLength(1);
    expect(det.js[0]).toContain("golivebypass-zumbi");
    expect(det.js[0]).toContain("Reiniciar agora");
    expect(det.js[0]).toContain("location.reload()");
  });

  it("nao empilha o banner enquanto o silencio continua", () => {
    const det = fabricarDetector(false);
    det.sinal();
    vi.advanceTimersByTime(6 * 60_000);
    det.checar();
    det.checar();
    det.checar();
    expect(det.js).toHaveLength(1);
  });

  it("sinal de volta remove o banner (falso alarme ou reconexao)", () => {
    const det = fabricarDetector(false);
    det.sinal();
    vi.advanceTimersByTime(6 * 60_000);
    det.checar();
    expect(det.estado().bannerAtivo).toBe(true);
    det.sinal();
    expect(det.estado().bannerAtivo).toBe(false);
    expect(det.js.some((s) => s.includes("golivebypass-zumbi") && s.includes(".remove()"))).toBe(true);
    expect(det.logs.some((l) => l.includes("gateway voltou a responder"))).toBe(true);
  });

  it("recarga em andamento nao dispara o aviso (quem decide e a recarga que ja existe)", () => {
    const det = fabricarDetector(true);
    det.sinal();
    vi.advanceTimersByTime(6 * 60_000);
    det.checar();
    expect(det.estado().bannerAtivo).toBe(false);
    expect(det.js).toHaveLength(0);
  });

  it("o script inteiro liga o detector nos tres pontos: tunel, hook de ws e boot", () => {
    const src = fs.readFileSync(CAMINHO_SCRIPT, "utf8");
    expect(src).toContain('upstream.on("data", () => marcarSinalGateway());');
    expect(src).toContain('client.on("data", () => marcarSinalGateway());');
    // Hook de websockets (gw.visto) tambem renova o sinal.
    expect(src).toMatch(/ultimoVistoAt = agora;[\s\S]{0,200}marcarSinalGateway\(\);/);
    // O watchdog sobe junto do batimento no start().
    expect(src).toContain("setInterval(() => { checarGatewayZumbi(); }, GW_ZUMBI_CHECAGEM_MS);");
  });
});
