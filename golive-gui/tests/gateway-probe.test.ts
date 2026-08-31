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
  activityHa: number;
  op4Ha: number;
  midiaOpenHa: number;
  midiaCloseHa: number;
  abertoHa: number;
  geracao: number;
  opCounts: Record<string, number>;
  srvBytes: number;
  srvBytesDesdeAtividade: number;
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
    activityHa: -1,
    op4Ha: -1,
    midiaOpenHa: -1,
    midiaCloseHa: -1,
    abertoHa: 300_000,
    geracao: 1,
    opCounts: { "1": 8 },
    srvBytes: 5000,
    srvBytesDesdeAtividade: 100,
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
    "const GW_ZUMBI_ATIVIDADE_JANELA_MS = (" + extrairConst("GW_ZUMBI_ATIVIDADE_JANELA_MS") + ");\n" +
    "const GW_ZUMBI_RESPOSTA_BYTES = (" + extrairConst("GW_ZUMBI_RESPOSTA_BYTES") + ");\n" +
    "const GW_STREAM_ESPERA_MS = (" + extrairConst("GW_STREAM_ESPERA_MS") + ");\n" +
    "const GW_STREAM_JANELA_MS = (" + extrairConst("GW_STREAM_JANELA_MS") + ");\n" +
    "const GW_STREAM_LEAVE_MS = (" + extrairConst("GW_STREAM_LEAVE_MS") + ");\n" +
    extrairFuncao("minIdade") + "\n" +
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

  it("atividade por BURST: 3 envios BINARIOS em 30s marcam atividade (agnostico de protocolo)", () => {
    const app = rodarShim();
    const ws = app.ws("wss://gateway.discord.gg/?v=10&encoding=etf");
    ws.emitir("open");
    ws.send(new Blob([new Uint8Array([1])]));
    ws.send(new Blob([new Uint8Array([2])]));
    ws.send(new Blob([new Uint8Array([3])]));
    const r = app.resumo();
    expect(r.activityHa).toBeGreaterThanOrEqual(0); // burst binario = atividade
    expect(r.opCounts).toEqual({});                 // etf: sem decode de ops (a #156 provou)
    expect(r.srvBytesDesdeAtividade).toBe(0);       // relogio do volume zerou
  });

  it("heartbeat sozinho NAO e atividade (2 envios a 41s e cadencia, nao burst)", () => {
    const app = rodarShim();
    const ws = app.ws("wss://gateway.discord.gg/?v=10");
    ws.emitir("open");
    ws.send('{"op":1,"d":1}');
    vi.advanceTimersByTime(41_000);
    ws.send('{"op":1,"d":2}');
    expect(app.resumo().activityHa).toBe(-1);
  });

  it("frames de TEXTO (encoding=json) contam dispatch sem inflate", () => {
    const app = rodarShim();
    const ws = app.ws("wss://gateway.discord.gg/?v=10&encoding=json");
    ws.emitir("open");
    ws.emitir("message", { data: JSON.stringify({ t: null, s: 1, op: 10, d: {} }) });
    ws.emitir("message", { data: JSON.stringify({ t: "MESSAGE_CREATE", s: 2, op: 0, d: { id: "x" } }) });
    const r = app.resumo();
    expect(r.dispatches).toBe(1);
    expect(r.dispatchHa).toBeGreaterThanOrEqual(0);
    expect(r.srvFrames).toBe(2);
    expect(r.srvBytes).toBeGreaterThan(0);
  });

  it("volume de resposta: bytes do servidor acumulam desde a ultima atividade", () => {
    const app = rodarShim();
    const ws = app.ws("wss://gateway.discord.gg/?v=10");
    ws.emitir("open");
    ws.send(new Blob([new Uint8Array([1])]));
    ws.send(new Blob([new Uint8Array([2])]));
    ws.send(new Blob([new Uint8Array([3])]));
    ws.emitir("message", { data: new Blob([new Uint8Array(300)]) });
    expect(app.resumo().srvBytesDesdeAtividade).toBe(300);
    expect(app.resumo().srvBytes).toBeGreaterThanOrEqual(300);
  });

  it("SNIFF de op 4 em frame BINARIO (etf): o pedido de assistir fica visivel", () => {
    const app = rodarShim();
    const ws = app.ws("wss://gateway.discord.gg/?v=10&encoding=etf");
    ws.emitir("open");
    // formato estranho (nao-etf) NUNCA vira falso op4
    ws.send(new Uint8Array([0x83, 1, 2, 3, 4, 5, 6, 7, 8]));
    expect(app.resumo().op4Ha).toBe(-1);
    // etf: 131 + SMALL_TUPLE_EXT(104) + aridade + SMALL_INT(97) + op
    ws.send(new Uint8Array([131, 104, 3, 97, 4, 109, 0, 0, 0, 5, 1, 2, 3, 4, 5]));
    expect(app.resumo().op4Ha).toBeGreaterThanOrEqual(0);
    // heartbeat binario (op 1) nao marca op4
    ws.send(new Uint8Array([131, 104, 2, 97, 1]));
    expect(app.resumo().op4Ha).toBeGreaterThanOrEqual(0); // segue do op4 anterior
  });

  it("op 4 em JSON texto tambem marca o pedido de assistir", () => {
    const app = rodarShim();
    const ws = app.ws("wss://gateway.discord.gg/?v=10&encoding=json");
    ws.emitir("open");
    ws.send('{"op":4,"d":{}}');
    expect(app.resumo().op4Ha).toBeGreaterThanOrEqual(0);
  });

  it("timestamps de midia: open e close ficam visiveis no resumo (guardas do caminho 3)", () => {
    const app = rodarShim();
    const gw = app.ws("wss://gateway.discord.gg/?v=10");
    gw.emitir("open");
    const midia = app.ws("wss://eu-central-1.c1.discord.media/?v=1");
    midia.emitir("open");
    expect(app.resumo().midiaOpenHa).toBeGreaterThanOrEqual(0);
    midia.emitir("close");
    expect(app.resumo().midiaCloseHa).toBeGreaterThanOrEqual(0);
    expect(app.resumo().midiaAberta).toBe(false);
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

  it("inflador RESINCRONIZA apos lixo (a #156 morria para sempre)", async () => {
    vi.useRealTimers();
    const app = rodarShim();
    const ws = app.ws("wss://gateway.discord.gg/?v=10&encoding=zlib-stream");
    ws.emitir("open");
    const chunks1 = await comprimirPayloads([JSON.stringify({ t: "READY", s: 1, op: 0, d: {} })]);
    for (const c of chunks1) ws.emitir("message", { data: new Blob([c]) });
    await new Promise(r => setTimeout(r, 20));
    expect(app.resumo().dispatches).toBe(1);
    // lixo que quebra o fluxo zlib
    ws.emitir("message", { data: new Blob([new TextEncoder().encode("lixo que quebra o fluxo")]) });
    await new Promise(r => setTimeout(r, 20));
    // payload novo num stream proprio: o resync segura e o dispatch conta de novo
    const chunks2 = await comprimirPayloads([JSON.stringify({ t: "MESSAGE_CREATE", s: 2, op: 0, d: {} })]);
    for (const c of chunks2) ws.emitir("message", { data: new Blob([c]) });
    await new Promise(r => setTimeout(r, 20));
    const r = app.resumo();
    expect(r.infladorOk).toBe(true);
    expect(r.dispatches).toBe(2);
    expect(r.srvFrames).toBeGreaterThanOrEqual(3); // 2 payloads + o lixo, cada chunk e um frame
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

  it("zumbi pelo VOLUME (mundo binario/etf): burst do usuario sem resposta = zumbi", () => {
    const alarme = rodarAlarme();
    const agora = Date.now();
    expect(alarme(resumoBase({ intentHa: -1, activityHa: 45_000, srvBytesDesdeAtividade: 100 }), agora)).toBe("zumbi");
  });

  it("volume saudavel (o servidor respondeu de verdade ao pedido) nao e zumbi", () => {
    const alarme = rodarAlarme();
    const agora = Date.now();
    expect(alarme(resumoBase({ intentHa: -1, activityHa: 45_000, srvBytesDesdeAtividade: 4096 }), agora)).toBeNull();
  });

  it("guardas do volume: sem burst, burst velho (>90s) ou ainda no prazo (<30s)", () => {
    const alarme = rodarAlarme();
    const agora = Date.now();
    expect(alarme(resumoBase({ intentHa: -1, activityHa: -1 }), agora)).toBeNull();
    expect(alarme(resumoBase({ intentHa: -1, activityHa: 120_000, srvBytesDesdeAtividade: 0 }), agora)).toBeNull();
    expect(alarme(resumoBase({ intentHa: -1, activityHa: 5_000 }), agora)).toBeNull();
  });

  it("mundo JSON com dispatch depois do pedido: saudavel mesmo com bytes baixos", () => {
    const alarme = rodarAlarme();
    const agora = Date.now();
    expect(alarme(resumoBase({ intentHa: 45_000, activityHa: 45_000, dispatchHa: 10_000, dispatches: 3, srvBytesDesdeAtividade: 10 }), agora)).toBeNull();
  });

  it("CAMINHO 3 (o caso real da beta 8): op 4 enviado, midia nunca abriu = zumbi", () => {
    const alarme = rodarAlarme();
    const agora = Date.now();
    // Servidor empurrando dados ambiente (resp_bytes alto) e inflate morto —
    // os caminhos 1/2 nao disparam, mas o pedido de voz ficou sem fluxo de midia
    expect(alarme(resumoBase({
      intentHa: -1, activityHa: 45_000, op4Ha: 40_000, infladorOk: false,
      dispatchHa: -1, srvBytesDesdeAtividade: 26931, midiaAberta: false,
      midiaOpenHa: -1, midiaCloseHa: -1,
    }), agora)).toBe("zumbi");
  });

  it("caminho 3 saudavel: midia abriu DEPOIS do op 4 = o fluxo funcionou", () => {
    const alarme = rodarAlarme();
    const agora = Date.now();
    // op4 ha 40s, midia aberta ha 35s (5s depois do op4): saudavel
    expect(alarme(resumoBase({ intentHa: -1, activityHa: -1, op4Ha: 40_000, midiaAberta: true, midiaOpenHa: 35_000, midiaCloseHa: -1 }), agora)).toBeNull();
    // midia ja fechou depois de abrir, mas abriu depois do pedido
    expect(alarme(resumoBase({ intentHa: -1, activityHa: -1, op4Ha: 40_000, midiaAberta: false, midiaOpenHa: 35_000, midiaCloseHa: 2_000 }), agora)).toBeNull();
  });

  it("guardas do caminho 3: saida recente (leave), op4 antigo, op4 no prazo e midia aberta", () => {
    const alarme = rodarAlarme();
    const agora = Date.now();
    // midia fechou ha 5s + op4 ha 40s = usuario SAINDO (nao entrando): nao dispara
    expect(alarme(resumoBase({ intentHa: -1, activityHa: -1, op4Ha: 40_000, midiaAberta: false, midiaOpenHa: 90_000, midiaCloseHa: 5_000, srvBytesDesdeAtividade: 0 }), agora)).toBeNull();
    // op4 velho (>90s): nao e mais o clique corrente
    expect(alarme(resumoBase({ intentHa: -1, activityHa: -1, op4Ha: 120_000, midiaAberta: false, midiaOpenHa: -1, midiaCloseHa: -1, srvBytesDesdeAtividade: 0 }), agora)).toBeNull();
    // op4 muito recente (<20s): o fluxo de voz ainda tem prazo
    expect(alarme(resumoBase({ intentHa: -1, activityHa: -1, op4Ha: 5_000, midiaAberta: false, midiaOpenHa: -1, midiaCloseHa: -1, srvBytesDesdeAtividade: 0 }), agora)).toBeNull();
    // midia aberta agora (em call): §6 — nunca automatico
    expect(alarme(resumoBase({ intentHa: -1, activityHa: -1, op4Ha: 40_000, midiaAberta: true, midiaOpenHa: 90_000, midiaCloseHa: -1, srvBytesDesdeAtividade: 0 }), agora)).toBeNull();
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
    // shim v3: agnostico de protocolo (issues #154/#156/#158)
    expect(src).toContain("registrarEnvio");
    expect(src).toContain("srvBytesDesdeAtividade");
    // vigia diagnostica o silencio e reinjeta o shim quando o CDP falha (#154)
    expect(src).toContain("estado=sem-shim");
    expect(src).toContain("gw.shim | o shim do CDP nao anexou neste documento");
    // o detector de bytes da beta.3 foi removido de verdade
    expect(src).not.toContain("marcarSinalGateway");
    expect(src).not.toContain("gwUltimoSinalEm");
  });
});
