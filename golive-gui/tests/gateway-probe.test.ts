import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import path from "path";

// Este teste executa o CODIGO REAL do shim e do alarme, extraido do
// standalone/golivebypass.js por marcadores — nao replica logica. O shim roda
// dentro do renderer do Discord (envolve o WebSocket antes do bundle); aqui ele
// roda contra um window falso com um WebSocket de mentira, para provar contagem
// de frames, rastreio de midia e o resumo que o vigia polla.
const CAMINHO_SCRIPT = path.resolve(process.cwd(), "..", "standalone", "golivebypass.js");

function lerScript(): string {
  return fs.readFileSync(CAMINHO_SCRIPT, "utf8");
}

function extrairEntre(src: string, inicio: string, fim: string): string {
  const i = src.indexOf(inicio);
  const j = src.indexOf(fim, i);
  if (i < 0 || j < 0) throw new Error(`marcadores nao encontrados: ${inicio}`);
  return src.slice(i + inicio.length, j);
}

function extrairConst(nome: string): string {
  const src = lerScript();
  const m = src.match(new RegExp(`const ${nome} = ([\\s\\S]*?);\\n`));
  if (!m) throw new Error(`const ${nome} nao encontrada`);
  return m[1];
}

function extrairFuncao(nome: string): string {
  const src = lerScript();
  const m = src.match(new RegExp(`function ${nome}\\([\\s\\S]*?\\n\\}`));
  if (!m) throw new Error(`funcao ${nome} nao encontrada`);
  return m[0];
}

class FakeWS {
  static OPEN = 1;
  url: string;
  sent: string[] = [];
  private l: Record<string, ((e?: unknown) => void)[]> = {};
  constructor(url: string) { this.url = url; }
  addEventListener(t: string, f: (e?: unknown) => void) { (this.l[t] ??= []).push(f); }
  emitir(t: string, ev?: unknown) { (this.l[t] ?? []).forEach(f => f(ev)); }
  send(d: string) { this.sent.push(d); }
}

interface Resumo { estado: string; srvHa: number; cliHa: number; subs: number; srvFrames: number }

function rodarShim(): { ws: (url: string) => FakeWS; resumo: () => Resumo; midiaAberta: () => boolean } {
  const shim = extrairConst("SHIM_GATEWAY_SRC");
  const win = { WebSocket: FakeWS as unknown } as Record<string, unknown>;
  // 1) avalia a EXPRESSAO (concatenacao de strings) para obter o codigo fonte;
  // 2) executa o codigo fonte contra o window falso.
  const fonte = new Function("window", "return " + shim)(win) as string;
  new Function("window", fonte)(win);
  return {
    ws: (url: string) => new (win.WebSocket as unknown as new (u: string) => FakeWS)(url),
    resumo: () => (win.__goliveGwResumo as () => Resumo)(),
    midiaAberta: () => (win.__goliveMidiaAberta as () => boolean)(),
  };
}

function rodarAlarme(): (resumo: Resumo | null, agora: number) => string | null {
  const codigo =
    "const GW_SERVIDOR_SILENCIOSO_MS = (" + extrairConst("GW_SERVIDOR_SILENCIOSO_MS") + ");\n" +
    extrairFuncao("avaliarSinalGw") + "\nreturn avaliarSinalGw;";
  return new Function(codigo)() as (resumo: Resumo | null, agora: number) => string | null;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("shim do gateway (codigo real do renderer)", () => {
  it("classifica o ws do gateway e conta frames de ambos os lados", () => {
    const app = rodarShim();
    const ws = app.ws("wss://gateway.discord.gg/?v=10&encoding=zlib-stream");
    ws.emitir("open");
    ws.emitir("message", { data: new ArrayBuffer(64) }); // frame comprimido do servidor
    ws.send('{"op":1,"d":123}');                          // heartbeat do cliente (texto)
    ws.send('{"op":14,"d":{"guild_id":"1"}}');            // subscribe = intencao de navegar
    ws.emitir("message", { data: new ArrayBuffer(32) });
    const r = app.resumo();
    expect(r.estado).toBe("aberta");
    expect(r.srvFrames).toBe(2);
    expect(r.subs).toBe(1);
    expect(r.cliHa).toBeGreaterThanOrEqual(0);
    expect(r.srvHa).toBeGreaterThanOrEqual(0);
  });

  it("nao confunde ws que nao e gateway nem midia", () => {
    const app = rodarShim();
    const ws = app.ws("wss://remote-auth-gateway.discord.gg/?v=1"); // nao casa com o regex do gateway
    ws.emitir("open");
    ws.send('{"op":1}');
    expect(app.resumo().estado).toBe("nenhum");
    expect(app.midiaAberta()).toBe(false);
  });

  it("rastreia websocket de midia aberto e fechado (o pill usa para se esconder)", () => {
    const app = rodarShim();
    const ws = app.ws("wss://eu-central-1.c1.discord.media/?v=1");
    expect(app.midiaAberta()).toBe(true);
    ws.emitir("close");
    expect(app.midiaAberta()).toBe(false);
  });

  it("preserva a identidade do WebSocket original (prototype e estaticos)", () => {
    const shim = extrairConst("SHIM_GATEWAY_SRC");
    const win = { WebSocket: FakeWS } as Record<string, unknown>;
    const fonte = new Function("window", "return " + shim)(win) as string;
    new Function("window", fonte)(win);
    const Construtor = win.WebSocket as unknown as { prototype: unknown; OPEN: number };
    expect(Construtor.prototype).toBe(FakeWS.prototype);
    expect(Construtor.OPEN).toBe(1);
  });
});

describe("alarme re-escopado (servidor inteiro calado)", () => {
  it("nao alerta com sessao fechada, resumo ausente ou servidor falando", () => {
    const alarme = rodarAlarme();
    const agora = Date.now();
    expect(alarme(null, agora)).toBeNull();
    expect(alarme({ estado: "fechada", srvHa: agora - 999_999, cliHa: agora, subs: 0, srvFrames: 0 }, agora)).toBeNull();
    expect(alarme({ estado: "nenhum", srvHa: -1, cliHa: -1, subs: 0, srvFrames: 0 }, agora)).toBeNull();
    expect(alarme({ estado: "aberta", srvHa: agora - 100_000, cliHa: agora, subs: 0, srvFrames: 0 }, agora)).toBeNull();
  });

  it("alerta com o ws aberto e o servidor calado alem de 3min (nem ACK anda)", () => {
    const alarme = rodarAlarme();
    const agora = Date.now();
    expect(alarme({ estado: "aberta", srvHa: agora - 200_000, cliHa: agora, subs: 0, srvFrames: 0 }, agora)).toBe("silente");
  });
});

describe("pill de recuperacao + wiring no script", () => {
  it("o pill tem reload, atalho Ctrl+Alt+R e se esconde com midia/fullscreen", () => {
    const revive = extrairConst("REVIVE_SRC");
    expect(revive).toContain("golive-revive");
    expect(revive).toContain("location.reload()");
    expect(revive).toContain("KeyR");
    expect(revive).toContain("__goliveMidiaAberta");
    expect(revive).toContain("fullscreenElement");
  });

  it("o script inteiro liga o shim via CDP, o pill no did-finish-load e o vigia no boot", () => {
    const src = lerScript();
    expect(src).toContain('wc.debugger.sendCommand(\'Page.addScriptToEvaluateOnNewDocument\', { source: SHIM_GATEWAY_SRC })');
    expect(src).toContain("wc.on('did-finish-load'");
    expect(src).toContain("app.on(\"web-contents-created\"");
    expect(src).toContain("setInterval(() => { checarGatewaySilente(); }, GW_PROBE_CHECAGEM_MS);");
    // o detector de bytes da beta.3 foi removido de verdade
    expect(src).not.toContain("marcarSinalGateway");
    expect(src).not.toContain("gwUltimoSinalEm");
  });
});
