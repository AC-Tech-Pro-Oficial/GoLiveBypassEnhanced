import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import path from "path";

// Este teste executa o CODIGO REAL do shim, do alarme e da escada de revive,
// extraido do standalone/golivebypass.js por marcadores — nao replica logica. O
// shim roda dentro do renderer do Discord (envolve o WebSocket antes do bundle);
// aqui ele roda contra um window falso com um WebSocket de mentira, para provar
// contagem de frames/dispatches, rastreio de midia, o fechar do ws (revive) e o
// resumo que o vigia polla.
const CAMINHO_SCRIPT = path.resolve(process.cwd(), "..", "standalone", "golivebypass.js");

function lerScript(): string {
  return fs.readFileSync(CAMINHO_SCRIPT, "utf8");
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
  readyState = 1;
  closes: Array<{ code?: number; reason?: string }> = [];
  private l: Record<string, ((e?: unknown) => void)[]> = {};
  constructor(url: string) { this.url = url; }
  addEventListener(t: string, f: (e?: unknown) => void) { (this.l[t] ??= []).push(f); }
  emitir(t: string, ev?: unknown) { (this.l[t] ?? []).forEach(f => f(ev)); }
  send(d: string) { this.sent.push(d); }
  close(code?: number, reason?: string) {
    this.closes.push({ code, reason });
    this.readyState = 3;
    this.emitir("close");
  }
}

interface Resumo {
  estado: string;
  srvHa: number;
  cliHa: number;
  subs: number;
  srvFrames: number;
  dispatches: number;
  dispatchHa: number;
  intentHa: number;
  abertoHa: number;
  geracao: number;
  opCounts: Record<string, number>;
  midiaAberta: boolean;
  infladorOk: boolean;
}

function rodarShim(opts: { semInflador?: boolean } = {}): {
  win: Record<string, unknown>;
  ws: (url: string) => FakeWS;
  resumo: () => Resumo;
  midiaAberta: () => boolean;
  fechar: () => boolean;
} {
  const shim = extrairConst("SHIM_GATEWAY_SRC");
  const win = { WebSocket: FakeWS as unknown } as Record<string, unknown>;
  // 1) avalia a EXPRESSAO (concatenacao de strings) para obter o codigo fonte;
  // 2) executa o codigo fonte contra o window falso.
  const fonte = new Function("window", "return " + shim)(win) as string;
  if (opts.semInflador) {
    // Parametro com o MESMO nome do global sombreia ele: o shim roda como se o
    // renderer nao tivesse DecompressionStream (renderer velho, recurso off).
    new Function("window", "DecompressionStream", fonte)(win, undefined);
  } else {
    new Function("window", fonte)(win);
  }
  return {
    win,
    ws: (url: string) => new (win.WebSocket as unknown as new (u: string) => FakeWS)(url),
    resumo: () => (win.__goliveGwResumo as () => Resumo)(),
    midiaAberta: () => (win.__goliveMidiaAberta as () => boolean)(),
    fechar: () => (win.__goliveGwFechar as () => boolean)(),
  };
}

// Os campos *Ha sao IDADES em ms desde o ultimo evento (o shim mede no momento do
// poll). A beta.4 alimentava o alarme com TIMESTAMP — o contrato errado que fazia
// o banner de zumbi disparar em falso; este resumoBase codifica o contrato real.
function resumoBase(parcial: Partial<Resumo>): Resumo {
  return {
    estado: "aberta",
    srvHa: 1000,
    cliHa: 5000,
    subs: 0,
    srvFrames: 100,
    dispatches: 0,
    dispatchHa: -1,
    intentHa: 45_000,
    abertoHa: 300_000,
    geracao: 1,
    opCounts: { "1": 8 },
    midiaAberta: false,
    infladorOk: true,
    ...parcial,
  };
}

function rodarAlarme(): (resumo: Resumo | null, agora: number) => string | null {
  const codigo =
    "const GW_SERVIDOR_SILENCIOSO_MS = (" + extrairConst("GW_SERVIDOR_SILENCIOSO_MS") + ");\n" +
    "const GW_ZUMBI_AQUECIMENTO_MS = (" + extrairConst("GW_ZUMBI_AQUECIMENTO_MS") + ");\n" +
    "const GW_ZUMBI_CLIENTE_VIVO_MS = (" + extrairConst("GW_ZUMBI_CLIENTE_VIVO_MS") + ");\n" +
    "const GW_ZUMBI_ESPERA_MS = (" + extrairConst("GW_ZUMBI_ESPERA_MS") + ");\n" +
    extrairFuncao("avaliarSinalGw") + "\nreturn avaliarSinalGw;";
  return new Function(codigo)() as (resumo: Resumo | null, agora: number) => string | null;
}

interface CtxRevive {
  agora: number;
  midiaAberta: boolean;
  midiaRecente: boolean;
  tentativas: number[];
  ultimaAcaoEm: number;
  ultimaAcao: string | null;
}

function rodarEscada(): (ctx: CtxRevive) => { acao: string; motivo: string } {
  const codigo =
    "const GW_ZUMBI_TENTATIVAS = (" + extrairConst("GW_ZUMBI_TENTATIVAS") + ");\n" +
    "const GW_ZUMBI_JANELA_MS = (" + extrairConst("GW_ZUMBI_JANELA_MS") + ");\n" +
    "const GW_ZUMBI_COOLDOWN_MS = (" + extrairConst("GW_ZUMBI_COOLDOWN_MS") + ");\n" +
    extrairFuncao("decidirRevive") + "\nreturn decidirRevive;";
  return new Function(codigo)() as (ctx: CtxRevive) => { acao: string; motivo: string };
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
    expect(r.intentHa).toBeGreaterThanOrEqual(0); // op 14 = intencao
  });

  it("histograma de ops: heartbeat separado de intencao (14 e 37 contam como subscribe)", () => {
    const app = rodarShim();
    const ws = app.ws("wss://gateway.discord.gg/?v=10");
    ws.emitir("open");
    ws.send('{"op":1,"d":1}');
    ws.send('{"op":1,"d":2}');
    ws.send('{"op":14,"d":{}}');
    ws.send('{"op":37,"d":{}}');
    const r = app.resumo();
    expect(r.opCounts).toEqual({ "1": 2, "14": 1, "37": 1 });
    expect(r.subs).toBe(2);
  });

  it("contadores por geracao: o ws renascido pelo cliente reseta intencao/dispatch", () => {
    const app = rodarShim();
    const ws1 = app.ws("wss://gateway.discord.gg/?v=10");
    ws1.emitir("open");
    ws1.send('{"op":14,"d":{}}');
    ws1.emitir("message", { data: new ArrayBuffer(8) });
    expect(app.resumo().geracao).toBe(1);
    const ws2 = app.ws("wss://gateway.discord.gg/?v=10"); // cliente recriou o ws
    ws2.emitir("open");
    const r = app.resumo();
    expect(r.geracao).toBe(2);
    expect(r.subs).toBe(0);
    expect(r.srvFrames).toBe(0);
    expect(r.estado).toBe("aberta");
  });

  it("__goliveGwFechar fecha o ws do gateway com close 4000 (revive nivel 1)", () => {
    const app = rodarShim();
    const ws = app.ws("wss://gateway.discord.gg/?v=10");
    ws.emitir("open");
    expect(app.fechar()).toBe(true);
    expect(ws.closes).toEqual([{ code: 4000, reason: "golive-revive" }]);
    expect(app.resumo().estado).toBe("fechada");
    expect(app.fechar()).toBe(false); // ws ja fechado: nada a fechar
  });

  it("__goliveGwFechar ignora ws inexistente e ws de midia (so gateway renasce)", () => {
    const app = rodarShim();
    expect(app.fechar()).toBe(false);
    const midia = app.ws("wss://eu-central-1.c1.discord.media/?v=1");
    midia.emitir("open");
    expect(app.fechar()).toBe(false);
  });

  it("nao confunde ws que nao e gateway nem midia", () => {
    const app = rodarShim();
    const ws = app.ws("wss://remote-auth-gateway.discord.gg/?v=1"); // nao casa com o regex do gateway
    ws.emitir("open");
    ws.send('{"op":1}');
    expect(app.resumo().estado).toBe("nenhum");
    expect(app.midiaAberta()).toBe(false);
  });

  it("rastreia websocket de midia aberto e fechado (pill e escada usam para nao agir)", () => {
    const app = rodarShim();
    const ws = app.ws("wss://eu-central-1.c1.discord.media/?v=1");
    expect(app.midiaAberta()).toBe(true);
    expect(app.resumo().midiaAberta).toBe(true);
    ws.emitir("close");
    expect(app.midiaAberta()).toBe(false);
    expect(app.resumo().midiaAberta).toBe(false);
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

describe("shim: decompress do servidor (o dispatch e o dado que o zumbi nao entrega)", () => {
  // Fluxo zlib continuo de verdade: os payloads sao comprimidos JUNTOS (um stream
  // zlib, como o Discord manda com encoding=zlib-stream) e fatiados em blocos
  // arbitrarios — inclusive no meio de um payload.
  async function comprimirPayloads(payloads: string[]): Promise<Uint8Array[]> {
    const cs = new CompressionStream("deflate");
    const writer = cs.writable.getWriter();
    const enc = new TextEncoder();
    for (const p of payloads) await writer.write(enc.encode(p));
    await writer.close();
    const reader = cs.readable.getReader();
    const chunks: Uint8Array[] = [];
    for (;;) {
      const r = await reader.read();
      if (r.done) break;
      chunks.push(r.value);
    }
    return chunks;
  }

  function fatiar(chunks: Uint8Array[], tamanho: number): Uint8Array[] {
    const pedacos: Uint8Array[] = [];
    for (const c of chunks) {
      for (let i = 0; i < c.length; i += tamanho) pedacos.push(c.slice(i, i + tamanho));
    }
    return pedacos;
  }

  it("conta dispatches (op 0) no fluxo zlib, ignorando op 11 e chaves dentro de strings", async () => {
    vi.useRealTimers();
    const app = rodarShim();
    const ws = app.ws("wss://gateway.discord.gg/?v=10&encoding=zlib-stream");
    ws.emitir("open");
    const chunks = await comprimirPayloads([
      JSON.stringify({ t: null, s: 2, op: 11, d: null }),
      JSON.stringify({ t: "MESSAGE_CREATE", s: 3, op: 0, d: { content: "chaves } dentro { da string }" } }),
      JSON.stringify({ t: "READY", s: 4, op: 0, d: { user: { id: "u" } } }),
    ]);
    for (const c of fatiar(chunks, 7)) ws.emitir("message", { data: new Blob([c]) });
    await new Promise(r => setTimeout(r, 20));
    const r = app.resumo();
    expect(r.infladorOk).toBe(true);
    expect(r.dispatches).toBe(2);
    expect(r.dispatchHa).toBeGreaterThanOrEqual(0);
  });

  it("inflador quebrado (lixo no lugar de zlib) degrada para frames crus: infladorOk false", async () => {
    vi.useRealTimers();
    const app = rodarShim();
    const ws = app.ws("wss://gateway.discord.gg/?v=10&encoding=zlib-stream");
    ws.emitir("open");
    ws.emitir("message", { data: new Blob([new TextEncoder().encode("isto nao e um fluxo zlib")]) });
    await new Promise(r => setTimeout(r, 20));
    const r = app.resumo();
    expect(r.infladorOk).toBe(false);
    expect(r.dispatches).toBe(0);
    expect(r.srvFrames).toBe(1); // o frame cru continuou contado
  });

  it("sem DecompressionStream no renderer: infladorOk false e o resto segue contando", () => {
    const app = rodarShim({ semInflador: true });
    const ws = app.ws("wss://gateway.discord.gg/?v=10");
    ws.emitir("open");
    ws.send('{"op":1}');
    ws.emitir("message", { data: new ArrayBuffer(8) });
    const r = app.resumo();
    expect(r.infladorOk).toBe(false);
    expect(r.srvFrames).toBe(1);
    expect(r.estado).toBe("aberta");
  });
});

describe("alarme (silente + zumbi) — campos *Ha sao IDADES, comparadas direto", () => {
  it("nao alerta com sessao fechada ou resumo ausente", () => {
    const alarme = rodarAlarme();
    const agora = Date.now();
    expect(alarme(null, agora)).toBeNull();
    expect(alarme(resumoBase({ estado: "fechada" }), agora)).toBeNull();
    expect(alarme(resumoBase({ estado: "nenhum" }), agora)).toBeNull();
  });

  it("alerta silente com o servidor inteiro calado alem de 3min (nem ACK anda)", () => {
    const alarme = rodarAlarme();
    const agora = Date.now();
    expect(alarme(resumoBase({ srvHa: 200_000 }), agora)).toBe("silente");
    // silente independe do inflador: e contagem de frames crus
    expect(alarme(resumoBase({ srvHa: 200_000, infladorOk: false }), agora)).toBe("silente");
  });

  it("nao alerta silente com servidor falando (o bug da beta.4: idade virava timestamp)", () => {
    const alarme = rodarAlarme();
    const agora = Date.now();
    expect(alarme(resumoBase({ srvHa: 1000 }), agora)).not.toBe("silente");
    expect(alarme(resumoBase({ srvHa: 100_000 }), agora)).not.toBe("silente");
  });

  it("alerta zumbi: protocolo vivo dos dois lados, usuario pediu e nada despachou", () => {
    const alarme = rodarAlarme();
    const agora = Date.now();
    // dispatchHa -1: nenhum dispatch na conexao inteira apos a intencao
    expect(alarme(resumoBase(), agora)).toBe("zumbi");
    // dispatch ha 60s (antes da intencao ha 45s): so heartbeats desde o pedido
    expect(alarme(resumoBase({ dispatchHa: 60_000, dispatches: 1 }), agora)).toBe("zumbi");
  });

  it("nao e zumbi quando dispatch chegou depois da intencao (dado fluindo)", () => {
    const alarme = rodarAlarme();
    const agora = Date.now();
    expect(alarme(resumoBase({ dispatchHa: 10_000, dispatches: 7 }), agora)).toBeNull();
  });

  it("guardas do zumbi: aquecimento, cliente morto, intencao no prazo e inflador", () => {
    const alarme = rodarAlarme();
    const agora = Date.now();
    expect(alarme(resumoBase({ abertoHa: 60_000 }), agora)).toBeNull();       // recem-aberta
    expect(alarme(resumoBase({ abertoHa: -1 }), agora)).toBeNull();           // nunca abriu
    expect(alarme(resumoBase({ cliHa: 120_000 }), agora)).toBeNull();         // cliente sem heartbeat
    expect(alarme(resumoBase({ intentHa: 10_000 }), agora)).toBeNull();       // pedido muito recente
    expect(alarme(resumoBase({ intentHa: -1 }), agora)).toBeNull();           // cliente nao pediu nada
    expect(alarme(resumoBase({ infladorOk: false }), agora)).toBeNull();      // sem decompress: indistinguivel
  });
});

describe("escada de revive (funcao pura decidirRevive)", () => {
  it("nivel 1: sem historico, acao e fechar o ws (RESUME preserva a sessao)", () => {
    const escada = rodarEscada();
    const agora = Date.now();
    expect(escada({ agora, midiaAberta: false, midiaRecente: false, tentativas: [], ultimaAcaoEm: 0, ultimaAcao: null }))
      .toEqual({ acao: "fechar", motivo: "nivel1" });
  });

  it("nivel 2: o close nao curou (ultima acao foi fechar) — sobe para o reload", () => {
    const escada = rodarEscada();
    const agora = Date.now();
    expect(escada({ agora, midiaAberta: false, midiaRecente: false, tentativas: [agora - 4 * 60_000], ultimaAcaoEm: agora - 4 * 60_000, ultimaAcao: "fechar" }))
      .toEqual({ acao: "reload", motivo: "nivel2" });
  });

  it("midia aberta ou recente (§6: reconexao mata o video): so banner, nunca automatico", () => {
    const escada = rodarEscada();
    const agora = Date.now();
    expect(escada({ agora, midiaAberta: true, midiaRecente: false, tentativas: [], ultimaAcaoEm: 0, ultimaAcao: null }))
      .toEqual({ acao: "banner", motivo: "midia" });
    expect(escada({ agora, midiaAberta: false, midiaRecente: true, tentativas: [], ultimaAcaoEm: 0, ultimaAcao: null }))
      .toEqual({ acao: "banner", motivo: "midia" });
  });

  it("teto de tentativas estourado: volta a ser ambiental (banner)", () => {
    const escada = rodarEscada();
    const agora = Date.now();
    expect(escada({ agora, midiaAberta: false, midiaRecente: false, tentativas: [agora - 25 * 60_000, agora - 20 * 60_000], ultimaAcaoEm: agora - 20 * 60_000, ultimaAcao: "reload" }))
      .toEqual({ acao: "banner", motivo: "teto_tentativas" });
  });

  it("cooldown entre tentativas: nao age agora", () => {
    const escada = rodarEscada();
    const agora = Date.now();
    expect(escada({ agora, midiaAberta: false, midiaRecente: false, tentativas: [agora - 60_000], ultimaAcaoEm: agora - 60_000, ultimaAcao: "fechar" }))
      .toEqual({ acao: "nenhum", motivo: "cooldown" });
  });

  it("tentativas fora da janela expiram: a escada recomeca", () => {
    const escada = rodarEscada();
    const agora = Date.now();
    expect(escada({ agora, midiaAberta: false, midiaRecente: false, tentativas: [agora - 45 * 60_000, agora - 40 * 60_000], ultimaAcaoEm: agora - 40 * 60_000, ultimaAcao: "reload" }))
      .toEqual({ acao: "fechar", motivo: "nivel1" });
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
    // escada de revive: o main chama o fechar do shim e respeita os guardas proprios
    expect(src).toContain("window.__goliveGwFechar ? window.__goliveGwFechar() : false");
    expect(src).toContain("function decidirRevive");
    expect(src).toContain("revivePendenteEm");
    expect(src).toContain("autoRevive");
    // o detector de bytes da beta.3 foi removido de verdade
    expect(src).not.toContain("marcarSinalGateway");
    expect(src).not.toContain("gwUltimoSinalEm");
  });
});
