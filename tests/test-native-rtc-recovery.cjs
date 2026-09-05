"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const BYPASS = process.env.BYPASS || path.resolve(process.cwd(), "standalone/golivebypass.js");
const source = fs.readFileSync(BYPASS, "utf8");
const begin = source.indexOf("// === voice shim: inicio ===");
const end = source.indexOf("// === voice shim: fim ===");

if (begin < 0 || end <= begin) {
  console.error("[FAIL] bloco do voice shim nao encontrado");
  process.exit(1);
}

let failures = 0;
function ok(name) { console.log("  [OK] " + name); }
function bad(name, detail) {
  failures++;
  console.log("  [FAIL] " + name + (detail ? ": " + detail : ""));
}

function extractConst(name) {
  const match = source.match(new RegExp(`const ${name} = ([\\s\\S]*?);\\n`));
  if (!match) throw new Error("const ausente: " + name);
  return match[1];
}

function extractFunction(name) {
  const match = source.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}`));
  if (!match) throw new Error("funcao ausente: " + name);
  return match[0];
}

const calls = [];
const connections = [];
const filters = [];
function connection(stats) {
  const value = {
    destroyed: false,
    setTransportOptions(options) { value.transportOptions = options; return 'transport-result'; },
    destroy() { value.destroyed = true; },
    getFilteredStats(filter, callback) {
      filters.push(filter);
      callback(JSON.stringify(stats));
    },
  };
  connections.push(value);
  return value;
}

function FakeVoiceConnection(_userId, options) {
  return connection(options?.kind === "stream" ? {
    screenshare: { pipewireFrames: 420, x11Frames: 0 },
    outbound: { video: {
      inputFrameRate: 60, framesEncoded: 300, encodeFrameRate: 60,
      mediaBitrate: 9000, suspended: false,
      substreams: [{ width: 1920, height: 1088, ssrc: 123456789 }],
    } },
    token: "nao-pode-vazar",
  } : {
    screenshare: { pipewireFrames: 1, x11Frames: 0 },
    outbound: { video: {
      inputFrameRate: 1, framesEncoded: 100, encodeFrameRate: 1,
      mediaBitrate: 2000, suspended: false,
    } },
    transport: { packetsSent: 10, secretAddress: "10.0.0.1" },
  });
}

const voice = {
  VoiceConnection: FakeVoiceConnection,
  createVoiceConnectionWithOptions(userId, options, callback) {
    calls.push({ creator: "voice", self: this, userId, options, callback });
    return new this.VoiceConnection(userId, options, callback);
  },
  createOwnStreamConnectionWithOptions(userId, options, callback) {
    calls.push({ creator: "stream", self: this, userId, options, callback });
    return new this.VoiceConnection(userId, options, callback);
  },
};
const cachedFactoryBeforeHook = voice.createVoiceConnectionWithOptions;

const logs = [];
const nativeModules = {
  requireModule(name) {
    if (name !== "discord_voice") return { name };
    return voice;
  },
};
const fakeConsole = {
  log(...args) { logs.push(args); },
  info(...args) { logs.push(args); },
  debug(...args) { logs.push(args); },
  warn(...args) { logs.push(args); },
  error(...args) { logs.push(args); },
};
const sandbox = {
  window: { DiscordNative: { nativeModules } },
  console: fakeConsole,
  Date,
  JSON,
  Object,
  Array,
  Number,
  Promise,
  WeakSet,
  setTimeout,
  clearTimeout,
};
sandbox.window.window = sandbox.window;
vm.createContext(sandbox);
vm.runInContext(source.slice(begin, end) + "\ninstalarVoiceShim();", sandbox, { filename: BYPASS });

async function main() {
  const firstRequire = nativeModules.requireModule;
  sandbox.instalarVoiceShim();
  if (nativeModules.requireModule === firstRequire) ok("instalacao idempotente nao envolve requireModule duas vezes");
  else bad("segunda instalacao mudou requireModule");

  const loaded = nativeModules.requireModule("discord_voice");
  if (loaded === voice) ok("requireModule preserva o modulo original");
  else bad("requireModule trocou o modulo");

  const callback = () => {};
  const voiceOptions = { context: "default", kind: "voice", endpoint: "segredo.example", nested: { token: "abc" } };
  const streamOptions = { context: "stream", kind: "stream", video: true, streamKey: "guild:segredo" };
  const voiceConn = voice.createVoiceConnectionWithOptions("usuario-secreto", voiceOptions, callback);
  const streamConn = voice.createOwnStreamConnectionWithOptions("usuario-secreto", streamOptions, callback);

  if (calls.length === 2 && calls[0].self === voice && calls[1].self === voice) {
    ok("wrappers preservam this e chamadas originais");
  } else bad("wrappers alteraram this/chamadas", "calls=" + calls.length);
  if (calls[0].options === voiceOptions && calls[1].options === streamOptions && calls[0].callback === callback) {
    ok("argumentos chegam intactos ao discord_voice");
  } else bad("argumentos foram alterados");
  if (voiceConn === connections[0] && streamConn === connections[1]) ok("retornos originais preservados");
  else bad("retorno da conexao foi alterado");

  const transportOptions = { remoteSinkWantsPixelCount: 244860 };
  if (streamConn.setTransportOptions(transportOptions) === 'transport-result' && streamConn.transportOptions === transportOptions) ok('native transport call preserved');
  else bad('native transport call changed');
  fakeConsole.log('unrelated renderer message');
  if (logs.length > 0) ok("console original continua sendo chamado");
  else bad("console original foi engolido");

  const summary = await sandbox.window.__goliveVoiceResumo();
  if (summary && summary.installed && summary.connections.length === 2) ok("resumo agrega conexoes nativas");
  else bad("resumo nao trouxe duas conexoes");
  if (summary.voiceHooked === true) ok("modulo ja carregado e envolvido imediatamente");
  else bad("modulo em cache nao foi envolvido");
  if (summary.connections.map(c => c.kind).join(",") === "voice,stream") ok("factory classifica voice e stream");
  else bad("classificacao incorreta", JSON.stringify(summary.connections));
  if (summary.demandHa >= 0 && summary.demandHa < 1000) ok("demanda positiva do espectador registrada");
  else bad("demanda positiva nao registrada", "ha=" + summary.demandHa);
  if (summary.demandKnown === true && summary.demandActive === true) ok("estado ativo da demanda e conhecido");
  else bad("estado da demanda nao foi exposto com seguranca");

  const encoded = JSON.stringify(summary);
  for (const secret of ["usuario-secreto", "segredo.example", "abc", "guild:segredo", "nao-pode-vazar", "10.0.0.1"]) {
    if (encoded.includes(secret)) bad("resumo vazou dado sensivel", secret);
  }
  if (!failures) ok("resumo nao persiste strings das opcoes/stats");

  const streamSummary = summary.connections.find(c => c.kind === "stream");
  if (streamSummary.stats?.statsOk === true && streamSummary.stats?.inputFrameRate === 60 &&
      streamSummary.stats?.captureFrames === 420 && streamSummary.stats?.framesEncoded === 300) {
    ok("getFilteredStats e normalizado nos contadores confirmados");
  } else bad("stats relevantes ausentes", JSON.stringify(streamSummary));
  if (filters.length === 1 && filters[0] === 7) ok("stream sem papel conhecido usa todos os campos nativos (7)");
  else bad("filtro inesperado no addon", JSON.stringify(filters));

  streamConn.setTransportOptions({ remoteSinkWantsPixelCount: 0 });
  const noDemand = sandbox.window.__goliveVoiceDemandaResumo();
  if (noDemand.known === true && noDemand.active === false) ok("demanda zero desarma o detector");
  else bad("demanda zero ficou ativa", JSON.stringify(noDemand));
  streamConn.setTransportOptions({ remoteSinkWantsPixelCount: 'not-a-number' });
  const malformed = sandbox.window.__goliveVoiceDemandaResumo();
  if (malformed.active === false) ok("payload de demanda malformado falha fechado");
  else bad("payload malformado alterou a demanda");

  const noVoice = nativeModules.requireModule("outro_modulo");
  if (noVoice.name === "outro_modulo") ok("modulos alheios passam sem alteracao");
  else bad("modulo alheio foi alterado");

  const cachedConn = cachedFactoryBeforeHook.call(voice, "usuario-secreto", { kind: "voice" }, callback);
  const afterCached = await sandbox.window.__goliveVoiceResumo();
  const fallback = afterCached.connections.find(c => c.creator === "VoiceConnection");
  if (cachedConn && fallback && fallback.kind === "unknown") {
    ok("construtor captura factory guardado antes do hook sem classificar por chute");
  } else bad("fallback do construtor nao capturou factory em cache", JSON.stringify(afterCached.connections));

  const recoveryStart = source.indexOf("window.__goliveVoiceRecuperar = function");
  const recoveryEnd = source.indexOf("installNativeHook();", recoveryStart);
  const recoveryBlock = source.slice(recoveryStart, recoveryEnd);
  if (!/\.destroy\s*\(/.test(recoveryBlock)) ok("recuperacao nativa nao usa destroy automaticamente");
  else bad("recuperacao enhanced ainda chama destroy");
  if (recoveryBlock.includes("desktop-source-reapply") && recoveryBlock.includes("viewer-fast-udp-reconnect") &&
      recoveryBlock.includes("viewer-video-resubscribe")) ok("contratos seguros de broadcaster e viewer estao presentes");
  else bad("acoes enhanced de RTC ausentes");
  if (!cachedConn.destroyed && !voiceConn.destroyed && !streamConn.destroyed) ok("teste legado confirma ausencia de destruicao automatica");
  else bad("alguma conexao foi destruida antes da recuperacao enhanced");

  const detectorCode = [
    "const VOICE_STREAM_AQUECIMENTO_MS = " + extractConst("VOICE_STREAM_AQUECIMENTO_MS") + ";",
    "const VOICE_DEMANDA_GRACA_MS = " + extractConst("VOICE_DEMANDA_GRACA_MS") + ";",
    "const VOICE_ENTRADA_VIVA_MS = " + extractConst("VOICE_ENTRADA_VIVA_MS") + ";",
    "const VOICE_SAIDA_PARADA_MS = " + extractConst("VOICE_SAIDA_PARADA_MS") + ";",
    "const VOICE_SAMPLE_MAX_MS = " + extractConst("VOICE_SAMPLE_MAX_MS") + ";",
    extractFunction("streamNativaAtiva"),
    extractFunction("avaliarRtcNativo"),
    "return avaliarRtcNativo;",
  ].join("\n");
  const detectar = new Function(detectorCode)();
  const frozen = {
    voice: {
      installed: true,
      voiceHooked: true,
      connections: [{
        id: 7, kind: "stream", destroyed: false, createdHa: 60_000,
        stats: {
          statsOk: true, sampleHa: 0, entradaHa: 0, saidaHa: 21_000,
          captureFrames: 5000, inputFrameRate: 60,
          framesEncoded: 100, encodeFrameRate: 0,
        },
      }],
    },
    demanda: { known: true, active: true, demandHa: 2_000, changedHa: 2_000 },
    midia: { midiaAberta: true },
  };
  if (detectar(frozen) === "transmissor-video-parado") ok("detector age com captura viva + demanda + saida congelada por 20s");
  else bad("detector nao reconheceu a assinatura reproduzida ao vivo");
  if (detectar({ ...frozen, voice: { ...frozen.voice, connections: [{ ...frozen.voice.connections[0], stats: { ...frozen.voice.connections[0].stats, saidaHa: 3_000 } }] } }) === null) {
    ok("renegociacao curta de 3s nao dispara");
  } else bad("queda curta virou falso positivo");
  if (detectar({ ...frozen, demanda: { ...frozen.demanda, active: false } }) === null) ok("sem espectador nunca age");
  else bad("detector agiu sem demanda");
  if (detectar({ ...frozen, voice: { ...frozen.voice, connections: [{ ...frozen.voice.connections[0], createdHa: 10_000 }] } }) === null) {
    ok("stream em aquecimento nunca age");
  } else bad("detector agiu durante aquecimento");
  if (detectar({ ...frozen, voice: { ...frozen.voice, connections: [{ ...frozen.voice.connections[0], stats: { ...frozen.voice.connections[0].stats, entradaHa: 20_000 } }] } }) === null) {
    ok("captura parada nao e confundida com o zumbi de saida");
  } else bad("detector agiu com captura morta");
  if (detectar({ ...frozen, voice: { ...frozen.voice, connections: [{ ...frozen.voice.connections[0], stats: { statsOk: false, reason: "campos" } }] } }) === null) {
    ok("stats incompletos falham fechado");
  } else bad("detector agiu com formato desconhecido");
  if (detectar({ ...frozen, voice: { ...frozen.voice, connections: [{ id: 8, kind: "unknown", destroyed: false, createdHa: 60_000, stats: frozen.voice.connections[0].stats }] } }) === null) {
    ok("conexao unknown nunca entra no detector");
  } else bad("detector classificou unknown por chute");

  const isolatedCalls = [];
  const isolatedCode = [
    "const VOICE_ISOLATED_WORLD_ID = " + extractConst("VOICE_ISOLATED_WORLD_ID") + ";",
    extractFunction("executarVoiceIsolado"),
    "return executarVoiceIsolado;",
  ].join("\n");
  const executeIsolated = new Function(isolatedCode)();
  const isolatedResult = await executeIsolated({ webContents: {
    executeJavaScriptInIsolatedWorld(worldId, scripts, userGesture) {
      isolatedCalls.push({ worldId, scripts, userGesture });
      return Promise.resolve({ ok: true });
    },
  } }, "window.__goliveVoiceResumo()");
  if (isolatedResult.ok && isolatedCalls[0]?.worldId === 999 &&
      isolatedCalls[0]?.scripts?.[0]?.code === "window.__goliveVoiceResumo()") {
    ok("main consulta exatamente o mundo isolado 999 do preload");
  } else bad("wiring do mundo isolado esta incorreto", JSON.stringify(isolatedCalls));

  const healthyCode = [
    "const VOICE_DEMANDA_GRACA_MS = " + extractConst("VOICE_DEMANDA_GRACA_MS") + ";",
    "const VOICE_ENTRADA_VIVA_MS = " + extractConst("VOICE_ENTRADA_VIVA_MS") + ";",
    "const VOICE_SAMPLE_MAX_MS = " + extractConst("VOICE_SAMPLE_MAX_MS") + ";",
    "const VOICE_SAIDA_SUCESSO_MS = " + extractConst("VOICE_SAIDA_SUCESSO_MS") + ";",
    extractFunction("streamNativaAtiva"),
    extractFunction("geracaoNativa"),
    extractFunction("rtcNativoSaudavel"),
    "return rtcNativoSaudavel;",
  ].join("\n");
  const healthy = new Function(healthyCode)();
  const newDocumentSameLocalId = {
    voice: {
      instanceId: 200,
      connections: [{
        ...frozen.voice.connections[0],
        stats: { ...frozen.voice.connections[0].stats, saidaHa: 0, encodeFrameRate: 60 },
      }],
    },
    demanda: frozen.demanda,
    midia: frozen.midia,
  };
  if (healthy(newDocumentSameLocalId, "100:7")?.id === 7) {
    ok("reload interno distingue a nova instancia mesmo quando o id local reinicia");
  } else bad("colisao de geracao apos reload impediu credito de sucesso");

  if (failures) process.exit(1);
  console.log("\nNative RTC shim: todos os testes passaram.");
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
