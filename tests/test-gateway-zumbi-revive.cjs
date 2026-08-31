"use strict";
//
// Testes da escada de revive do gateway zumbi (issues #145/#149/#153): a sessao
// do gateway fica protocolarmente viva (heartbeats respondendo dos dois lados)
// mas para de entregar dispatch — telas carregam para sempre, e a rede nao ve
// nada (o tunel segue carregando heartbeats).
//
// Cobre o fluxo de decisao no script REAL (sandbox vm, igual aos outros testes
// desta bateria; o renderer e simulado com resumos de probe sob controle do teste):
//   1. zumbi confirmado sem midia -> nivel 1: __goliveGwFechar (close 4000)
//   2. a reconexao que o proprio revive provoca nao vira recorrencia (sem banner/reload)
//   3. zumbi de novo apos o close -> nivel 2: reload da janela
//   4. teto de tentativas estourado -> volta a ser ambiental (banner)
//   5. midia aberta ou recente (§6) -> nunca automatico, so banner
//   6. o ws nao renasceu apos o close -> auto-cura subindo direto pro reload
//   7. dispatches voltaram -> sucesso credita e zera a escada
//   8. silente (servidor inteiro calado) segue banner-only
//   9. autoRevive=false -> banner em vez de agir
//  10. guarda da rajada existe no fonte (a reconexao do revive nao alimenta a janela)
//
// Nao precisa de container: nada toca rede externa (a janela e o session sao stubs
// e a sandbox vm carrega o bypass real, igual aos outros testes da bateria).
//
// Uso:
//   node tests/test-gateway-zumbi-revive.cjs
//   BYPASS=/caminho/golivebypass.js node tests/test-gateway-zumbi-revive.cjs

;
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const Module = require("module");

const BYPASS = process.env.BYPASS || path.resolve(process.cwd(), "standalone/golivebypass.js");
let failures = 0;
function ok(name) { console.log("  [OK] " + name); }
function bad(name, extra) { failures++; console.log("  [FAIL] " + name + (extra ? ": " + extra : "")); }

// --- sandbox: carrega o bypass real com janela/session falsas ---
function carregarSandbox(settingsExtras) {
  const BASE = fs.mkdtempSync(path.join(os.tmpdir(), "fake-res-zumbi-"));
  const FAKE_RES = BASE + "/resources";
  fs.mkdirSync(FAKE_RES + "/_app.asar", { recursive: true });
  fs.writeFileSync(FAKE_RES + "/_app.asar/package.json", JSON.stringify({ name: "discord", main: "index.js" }));
  fs.writeFileSync(FAKE_RES + "/_app.asar/index.js", "// discord fake");
  fs.writeFileSync(FAKE_RES + "/settings.json", JSON.stringify(Object.assign(
    { enabled: true, routeMode: "tor", torAddr: "127.0.0.1:9050", excludedCountries: "BR" },
    settingsExtras || {}
  )));

  const executedScripts = [];
  const contadores = { fechar: 0, reload: 0 };
  let resumoAtual = null;
  let onBeforeRequestCb = null;

  const fakeWin = {
    isDestroyed: () => false,
    webContents: {
      getURL: () => "https://discord.com/channels/@me",
      executeJavaScript: (script) => {
        executedScripts.push(script);
        if (script.indexOf("__goliveGwResumo") !== -1) return Promise.resolve(resumoAtual);
        if (script.indexOf("__goliveGwFechar") !== -1) { contadores.fechar++; return Promise.resolve(true); }
        return Promise.resolve();
      },
      reload: () => { contadores.reload++; },
    },
  };
  const appStub = {
    on: () => {},
    whenReady: () => ({ then: () => {} }),
    setAppPath: () => {},
  };
  const sessionStub = {
    defaultSession: {
      resolveProxy: async () => "DIRECT",
      setProxy: async () => {},
      webRequest: { onBeforeRequest: (cb) => { onBeforeRequestCb = cb; } },
      closeAllConnections: async () => {},
    },
  };

  const code = fs.readFileSync(BYPASS, "utf8");
  const sandboxRequire = (name) => {
    if (name === "electron") return { app: appStub, session: sessionStub, BrowserWindow: { getAllWindows: () => [fakeWin] } };
    if (name === "original-fs") return require("fs");
    return Module._load(name, { filename: BYPASS }, false);
  };
  sandboxRequire.main = { filename: FAKE_RES + "/_app.asar/index.js" };
  const sandbox = {
    require: sandboxRequire,
    module: { exports: {} },
    exports: {},
    __dirname: FAKE_RES,
    __filename: BYPASS,
    console, process, Buffer,
    setTimeout, clearTimeout, setInterval, clearInterval,
    URL, URLSearchParams, Date,
  };
  sandbox.module.exports = sandbox.exports;
  sandbox.global = sandbox;
  vm.createContext(sandbox);
  Object.defineProperty(sandbox.process, "argv", { value: ["node", FAKE_RES + "/_app.asar/index.js"], writable: false });
  vm.runInContext(code, sandbox, { filename: BYPASS });

  return {
    sandbox,
    g: sandbox,
    executedScripts,
    contadores,
    setResumo: (r) => { resumoAtual = r; },
    getOnBeforeRequestCb: () => onBeforeRequestCb,
    vmSet: (expr) => vm.runInContext(expr, sandbox),
    vmGet: (expr) => vm.runInContext(expr, sandbox),
  };
}

function resumoZumbi(extras) {
  return Object.assign({
    estado: "aberta", srvHa: 1000, cliHa: 5000, subs: 0, srvFrames: 600,
    dispatches: 0, dispatchHa: -1, intentHa: 45000, activityHa: 45000,
    abertoHa: 300000, geracao: 1, opCounts: { "1": 8 }, midiaAberta: false,
    infladorOk: true, srvBytes: 600, srvBytesDesdeAtividade: 100,
  }, extras || {});
}

const RESUMO_SAUDAVEL = {
  estado: "aberta", srvHa: 1000, cliHa: 5000, subs: 2, srvFrames: 800,
  dispatches: 50, dispatchHa: 3000, intentHa: 45000, activityHa: 45000,
  abertoHa: 300000, geracao: 1, opCounts: { "1": 8, "14": 2 }, midiaAberta: false,
  infladorOk: true, srvBytes: 9000, srvBytesDesdeAtividade: 4000,
};

function resetarEstadoZumbi(app) {
  app.vmSet(`
    zumbiBannerAtivo = false;
    zumbiTentativaEm.length = 0;
    zumbiUltimaAcaoEm = 0;
    zumbiUltimaAcao = null;
    revivePendenteEm = 0;
    reviveFecharEm = 0;
    reviveFecharGeracao = 0;
    ultimaMidiaEm = 0;
    gatewayConnCount = 0;
    reloading = false;
  `);
}

async function poll(app) {
  app.g.checarGatewaySilente();
  await new Promise(r => setTimeout(r, 20));
}

function temBannerZumbi(app) {
  return app.executedScripts.some(s => s.indexOf("golivebypass-zumbi") !== -1);
}
function temBannerRecorrencia(app) {
  return app.executedScripts.some(s => s.indexOf("golivebypass-warn") !== -1);
}

// --- 1: nivel 1 (fechar) ---
async function testNivel1FechaWs() {
  const app = carregarSandbox();
  resetarEstadoZumbi(app);
  app.setResumo(resumoZumbi());
  await poll(app);
  if (app.contadores.fechar === 1) ok("zumbi sem midia dispara nivel 1: __goliveGwFechar chamado");
  else return bad("nivel 1 nao chamou __goliveGwFechar", "fechar=" + app.contadores.fechar);
  if (app.executedScripts.some(s => s.indexOf("__goliveGwFechar") !== -1)) ok("o close vai via executeJavaScript no shim");
  else bad("o close nao foi injetado no renderer");
  if (app.vmGet("revivePendenteEm") > 0) ok("revivePendenteEm marcado (a reconexao provocada sera ignorada)");
  else bad("revivePendenteEm nao foi marcado");
  if (app.vmGet("zumbiUltimaAcao") === "fechar" && app.vmGet("zumbiTentativaEm.length") === 1) {
    ok("tentativa registrada na escada (ultimaAcao=fechar)");
  } else bad("escada nao registrou a tentativa", "ultimaAcao=" + app.vmGet("zumbiUltimaAcao"));
  if (app.contadores.reload === 0 && !temBannerZumbi(app)) ok("nivel 1 nao recarrega nem mostra banner");
  else bad("nivel 1 recarregou ou mostrou banner");
}

// --- 2: reconexao do revive nao vira recorrencia ---
async function testReconexaoDoReviveNaoViraRecorrencia() {
  const app = carregarSandbox();
  resetarEstadoZumbi(app);
  app.vmSet("revivePendenteEm = Date.now(); gatewayConnCount = 1;");
  app.g.markGatewayRouted();
  if (app.vmGet("gatewayConnCount") === 1) {
    ok("markGatewayRouted com revive pendente: sessao recomeca a contar (nao e recorrencia)");
  } else return bad("a reconexao do revive foi contada como recorrencia", "gatewayConnCount=" + app.vmGet("gatewayConnCount"));
  if (app.vmGet("revivePendenteEm") === 0) ok("TTL do revive consumido pela reconexao");
  else bad("revivePendenteEm nao foi zerado");
  if (!temBannerRecorrencia(app) && app.contadores.reload === 0) {
    ok("sem aviso de recorrencia nem reload para a reconexao que NOSSA acao causou");
  } else bad("a reconexao do revive disparou banner/recorrencia");

  // Controle: sem revive pendente, a 2a conexao da sessao e recorrencia de verdade.
  resetarEstadoZumbi(app);
  app.vmSet("gatewayConnCount = 1;");
  app.g.markGatewayRouted();
  if (app.vmGet("gatewayConnCount") === 2) ok("sem revive pendente, a reconexao conta como recorrencia (comportamento normal preservado)");
  else bad("comportamento normal de recorrencia mudou", "gatewayConnCount=" + app.vmGet("gatewayConnCount"));
}

// --- 3: nivel 2 (reload) ---
async function testNivel2Reload() {
  const app = carregarSandbox();
  resetarEstadoZumbi(app);
  // Historico: nivel 1 rodou ha 4min (cooldown de 3min ja vencido) e o ws renasceu
  // (geracao 2) — e o zumbi persiste.
  app.vmSet(`
    zumbiTentativaEm = [Date.now() - 4 * 60_000];
    zumbiUltimaAcaoEm = Date.now() - 4 * 60_000;
    zumbiUltimaAcao = "fechar";
  `);
  app.setResumo(resumoZumbi({ geracao: 2 }));
  await poll(app);
  if (app.contadores.reload === 1) ok("zumbi persistente apos o close sobe para nivel 2: reload da janela");
  else return bad("nivel 2 nao recarregou", "reload=" + app.contadores.reload + " fechar=" + app.contadores.fechar);
  if (app.contadores.fechar === 0) ok("nivel 2 nao tenta fechar de novo");
  else bad("nivel 2 chamou __goliveGwFechar");
  if (app.vmGet("zumbiUltimaAcao") === "reload") ok("escada registrou a subida (ultimaAcao=reload)");
  else bad("escada nao registrou o reload");
}

// --- 4: teto de tentativas -> banner ---
async function testTetoViraBanner() {
  const app = carregarSandbox();
  resetarEstadoZumbi(app);
  app.vmSet(`
    zumbiTentativaEm = [Date.now() - 10 * 60_000, Date.now() - 5 * 60_000];
    zumbiUltimaAcaoEm = Date.now() - 5 * 60_000;
    zumbiUltimaAcao = "reload";
  `);
  app.setResumo(resumoZumbi());
  await poll(app);
  if (temBannerZumbi(app)) ok("teto de tentativas estourado: banner ambiental (decisao do usuario)");
  else return bad("teto estourado nao mostrou banner");
  if (app.contadores.fechar === 0 && app.contadores.reload === 0) ok("teto estourado nao age automatico");
  else bad("teto estourado agiu automatico", "fechar=" + app.contadores.fechar + " reload=" + app.contadores.reload);
}

// --- 5: midia aberta/recente -> banner (§6) ---
async function testMidiaNuncaAutomatico() {
  // 5a: websocket de midia aberto AGORA (em call/live)
  let app = carregarSandbox();
  resetarEstadoZumbi(app);
  app.setResumo(resumoZumbi({ midiaAberta: true }));
  await poll(app);
  if (temBannerZumbi(app) && app.contadores.fechar === 0 && app.contadores.reload === 0) {
    ok("midia aberta (call/live em andamento): banner, nunca fechar/reload (§6)");
  } else bad("midia aberta sofreu acao automatica", "fechar=" + app.contadores.fechar + " reload=" + app.contadores.reload);

  // 5b: midia fechada ha pouco (pode ainda ter call viva — ws recria)
  app = carregarSandbox();
  resetarEstadoZumbi(app);
  app.vmSet("ultimaMidiaEm = Date.now() - 60_000;");
  app.setResumo(resumoZumbi());
  await poll(app);
  if (temBannerZumbi(app) && app.contadores.fechar === 0 && app.contadores.reload === 0) {
    ok("midia recente (ha 1min): banner, nunca automatico (graca de 3min)");
  } else bad("midia recente sofreu acao automatica");
}

// --- 6: ws nao renasceu apos o close -> auto-cura com reload ---
async function testWsNaoRenasceuAutoCura() {
  const app = carregarSandbox();
  resetarEstadoZumbi(app);
  app.vmSet(`
    reviveFecharEm = Date.now() - 20_000;
    reviveFecharGeracao = 1;
    zumbiTentativaEm = [Date.now() - 20_000];
    zumbiUltimaAcaoEm = Date.now() - 20_000;
    zumbiUltimaAcao = "fechar";
  `);
  app.setResumo({
    estado: "fechada", srvHa: -1, cliHa: -1, subs: 0, srvFrames: 0,
    dispatches: 0, dispatchHa: -1, intentHa: -1, activityHa: -1, abertoHa: -1,
    geracao: 1, opCounts: {}, midiaAberta: false, infladorOk: false,
    srvBytes: 0, srvBytesDesdeAtividade: 0,
  });
  await poll(app);
  if (app.contadores.reload === 1) ok("ws nao renasceu apos o close (20s): auto-cura sobe direto pro reload");
  else return bad("auto-cura do close sem efeito nao recarregou", "reload=" + app.contadores.reload);
  if (app.vmGet("reviveFecharEm") === 0) ok("auto-cura consome o sinal de close pendente");
  else bad("reviveFecharEm nao foi zerado pela auto-cura");
}

// --- 7: dispatches voltaram -> sucesso credita ---
async function testSucessoCredita() {
  const app = carregarSandbox();
  resetarEstadoZumbi(app);
  // Uma tentativa ha 6min; a conexao atual sobreviveu ao aquecimento (5min) com
  // dispatch fluindo (ha 3s) — a cura foi de verdade.
  app.vmSet(`
    zumbiTentativaEm = [Date.now() - 6 * 60_000];
    zumbiUltimaAcaoEm = Date.now() - 6 * 60_000;
    zumbiUltimaAcao = "fechar";
  `);
  app.setResumo(resumoZumbi(Object.assign({}, RESUMO_SAUDAVEL)));
  await poll(app);
  if (app.vmGet("zumbiTentativaEm.length") === 0 && app.vmGet("zumbiUltimaAcao") === null) {
    ok("dispatches fluindo apos o aquecimento: escada credita sucesso e zera o teto");
  } else bad("sucesso do revive nao foi creditado", "tentativas=" + app.vmGet("zumbiTentativaEm.length"));
  if (app.contadores.fechar === 0 && app.contadores.reload === 0) ok("sessao saudavel nao sofre acao");
  else bad("sessao saudavel sofreu acao automatica");
}

// --- 8: silente segue banner-only ---
async function testSilenteBannerOnly() {
  const app = carregarSandbox();
  resetarEstadoZumbi(app);
  // Servidor INTEIRO calado (nem ACK): morte de rede de verdade — o cliente
  // renasce sozinho; o banner antecipa, mas nao mexemos no ws.
  app.setResumo(resumoZumbi({ srvHa: 200_000 }));
  await poll(app);
  if (temBannerZumbi(app)) ok("silente (servidor inteiro calado): banner antecipa o reconnect");
  else return bad("silente nao mostrou banner");
  if (app.contadores.fechar === 0 && app.contadores.reload === 0) ok("silente nao mexe no ws nem recarrega");
  else bad("silente agiu automatico");
}

// --- 9: autoRevive=false -> banner ---
async function testAutoReviveDesligado() {
  const app = carregarSandbox({ autoRevive: false });
  resetarEstadoZumbi(app);
  app.setResumo(resumoZumbi());
  await poll(app);
  if (app.vmGet("autoRevive") === false) ok("flag autoRevive lida do settings.json");
  else return bad("autoRevive nao foi lido como false");
  if (temBannerZumbi(app) && app.contadores.fechar === 0 && app.contadores.reload === 0) {
    ok("autoRevive=false: deteccao continua, acao fica sendo do usuario (banner)");
  } else bad("autoRevive=false agiu automatico", "fechar=" + app.contadores.fechar + " reload=" + app.contadores.reload);
}

// --- 10: guarda da rajada existe no fonte ---
function testGuardaRajadaNoFonte() {
  const src = fs.readFileSync(BYPASS, "utf8");
  if (src.indexOf("gw.revive | reconexao do revive: fora da janela de rajada") !== -1) {
    ok("rajada ignora a reconexao do revive (guarda no onBeforeRequest)");
  } else {
    bad("guarda da rajada ausente no fonte");
  }
  if (src.indexOf("window.__goliveGwFechar ? window.__goliveGwFechar() : false") !== -1) {
    ok("o main aciona o close pelo shim (executeJavaScript)");
  } else {
    bad("chamada do __goliveGwFechar ausente no fonte");
  }
}

(async () => {
  try {
    console.log("== nivel 1: zumbi sem midia -> close 4000 no ws do gateway ==");
    await testNivel1FechaWs();
    console.log("\n== a reconexao do revive nao vira recorrencia ==");
    await testReconexaoDoReviveNaoViraRecorrencia();
    console.log("\n== nivel 2: zumbi persistente apos o close -> reload ==");
    await testNivel2Reload();
    console.log("\n== teto de tentativas -> banner ==");
    await testTetoViraBanner();
    console.log("\n== midia aberta/recente: nunca automatico (§6) ==");
    await testMidiaNuncaAutomatico();
    console.log("\n== ws nao renasceu apos o close: auto-cura ==");
    await testWsNaoRenasceuAutoCura();
    console.log("\n== dispatches voltaram: sucesso credita ==");
    await testSucessoCredita();
    console.log("\n== silente segue banner-only ==");
    await testSilenteBannerOnly();
    console.log("\n== autoRevive=false: banner em vez de agir ==");
    await testAutoReviveDesligado();
    console.log("\n== guardas no fonte ==");
    testGuardaRajadaNoFonte();
  } catch (e) {
    console.error("ERRO:", e.message, e.stack);
    failures++;
  }
  console.log("");
  console.log(failures === 0 ? "RESULTADO: TUDO OK" : "RESULTADO: " + failures + " FALHA(S)");
  process.exit(failures === 0 ? 0 : 1);
})();
