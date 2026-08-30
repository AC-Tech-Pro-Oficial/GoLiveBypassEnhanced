"use strict";
//
// Testes do arranque frio em modo tor (issue #116: "carregamento infinito ao abrir o
// aplicativo", visto so em modo tor, so ao ligar o PC junto com o Windows).
//
// A GUI e um processo Electron a parte do Discord: no boot ela precisa terminar o proprio
// arranque ANTES de sequer chamar o Tor, e o Discord (nativo, mais rapido, e que tambem pode
// estar com "Iniciar com Windows" ligado) costuma vencer essa corrida. O bypass injetado faz a
// coisa certa em termos de seguranca (segura o gateway, nunca vaza direto pelo IP brasileiro),
// mas sem aviso a pessoa so via "carregando" parado, sem saber se travou.
//
// Este teste cobre a parte nova:
// 1. showTorBootBanner()/hideTorBootBanner(): aviso informativo dentro da janela do Discord,
//    com retry ate a janela do CLIENTE existir (o Discord mostra uma splash sem url
//    discord.com por um tempo antes do app de verdade).
// 2. settleExit() aciona maybeReloadAfterColdHold() quando uma saida aparece depois de um
//    arranque frio -- recarrega a janela na hora em vez de esperar o proprio Discord tentar
//    de novo por conta propria (backoff dele, nao nosso).
// 3. showReconnectWarning() ganhou um botao "Reiniciar agora" (location.reload() no clique),
//    para o Ctrl+R do banner de reconexao virar um clique em vez de atalho de teclado.
// 4. TOR_HOLD_BUDGET_MS/MIDIA_RECENTE_MS foram ajustados (ver CHANGELOG).
//
// Nao precisa de container: nada toca rede externa (probe e clientWindow via BrowserWindow
// sao stubados e a sandbox vm carrega o bypass real, igual aos outros testes desta bateria).
//
// Uso:
//   node tests/test-cold-tor-boot-test.cjs
//   BYPASS=/caminho/golivebypass.js node tests/test-cold-tor-boot-test.cjs

;
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const Module = require("module");

const BYPASS = process.env.BYPASS || path.resolve(process.cwd(), "standalone/golivebypass.js");
let failures = 0;
function ok(name) { console.log("  [OK] " + name); }
function bad(name, extra) { failures++; console.log("  [FAIL] " + name + (extra ? ": " + extra : "")); }

const BASE = process.env.FAKE_RES_BASE || "/tmp/fake-res-beta2";
const FAKE_RES = BASE + "/resources";
fs.mkdirSync(FAKE_RES + "/_app.asar", { recursive: true });
fs.writeFileSync(FAKE_RES + "/_app.asar/package.json", JSON.stringify({ name: "discord", main: "index.js" }));
fs.writeFileSync(FAKE_RES + "/_app.asar/index.js", "// discord fake");
fs.writeFileSync(FAKE_RES + "/settings.json", JSON.stringify({ enabled: true, proxy: "", routeMode: "tor", torAddr: "127.0.0.1:9050", excludedCountries: "BR" }));

// --- fake BrowserWindow capturando executeJavaScript/reload ---
const executedScripts = [];
let reloadCalls = 0;
const fakeWin = {
  isDestroyed: () => false,
  webContents: {
    getURL: () => "https://discord.com/channels/@me",
    executeJavaScript: (script) => { executedScripts.push(script); return Promise.resolve(); },
    reload: () => { reloadCalls++; },
  },
};
const BrowserWindowStub = { getAllWindows: () => [fakeWin] };

const appStub = { on: () => {}, whenReady: () => ({ then: () => {} }), setAppPath: () => {} };
const sessionStub = { defaultSession: { resolveProxy: async () => "DIRECT", setProxy: async () => {}, webRequest: { onBeforeRequest: () => {} }, closeAllConnections: async () => {} } };

const code = fs.readFileSync(BYPASS, "utf8");
const sandboxRequire = (name) => {
  if (name === "electron") return { app: appStub, session: sessionStub, BrowserWindow: BrowserWindowStub };
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

const g = sandbox;
const sandboxRef = sandbox;

function scriptParses(name, script) {
  try {
    new vm.Script(script, { filename: name });
    ok(name + ": JS gerado eh sintaticamente valido (" + script.length + " chars)");
    return true;
  } catch (e) {
    bad(name + ": JS gerado tem erro de sintaxe", e.message);
    return false;
  }
}

async function testTorBootBanner() {
  executedScripts.length = 0;
  g._testMarkColdTorHold();
  g.showTorBootBanner();
  await new Promise(r => setTimeout(r, 10));
  if (executedScripts.length !== 1) return bad("showTorBootBanner deveria injetar 1 script", "injetou " + executedScripts.length);
  const s = executedScripts[0];
  scriptParses("showTorBootBanner", s);
  if (s.includes("golivebypass-tor-wait")) ok("showTorBootBanner usa id proprio (golivebypass-tor-wait)");
  else bad("showTorBootBanner nao usa o id esperado");
  if (s.includes("aguardando o Tor")) ok("showTorBootBanner contem o texto de espera do Tor");
  else bad("showTorBootBanner sem o texto esperado");

  executedScripts.length = 0;
  g.hideTorBootBanner();
  await new Promise(r => setTimeout(r, 10));
  if (executedScripts.length !== 1) return bad("hideTorBootBanner deveria injetar 1 script");
  scriptParses("hideTorBootBanner", executedScripts[0]);
  if (executedScripts[0].includes("golivebypass-tor-wait")) ok("hideTorBootBanner mira o id certo");
}

async function testReconnectWarningButton() {
  executedScripts.length = 0;
  g.showReconnectWarning(1);
  await new Promise(r => setTimeout(r, 10));
  if (executedScripts.length !== 1) return bad("showReconnectWarning deveria injetar 1 script");
  const s = executedScripts[0];
  scriptParses("showReconnectWarning", s);
  if (s.includes("Reiniciar agora") && s.includes("location.reload()")) {
    ok("showReconnectWarning tem botao 'Reiniciar agora' com location.reload()");
  } else {
    bad("showReconnectWarning sem o botao esperado");
  }
}

async function testColdHoldReloadFlow() {
  // Simula: start() encontrou routeMode tor sem saida, marcou coldTorHoldSince e mostrou o banner.
  executedScripts.length = 0;
  reloadCalls = 0;
  g._testMarkColdTorHold();
  const origProbe = g.probe;
  g.probe = async () => ({ proxy: "socks5://127.0.0.1:9060", ms: 5 });

  g.settleExit("socks5://127.0.0.1:9060");
  // hideTorBootBanner roda sincrono dentro do settleExit; maybeReloadAfterColdHold depende
  // da promise do probe (microtask/timer) -- espera ela terminar antes de conferir o reload.
  const hideScript = executedScripts.find(s => s.includes("golivebypass-tor-wait"));
  if (hideScript) ok("settleExit chama hideTorBootBanner na hora (sincrono, antes do probe)");
  else bad("settleExit nao escondeu o banner de espera do Tor");

  await new Promise(r => setTimeout(r, 30));
  if (reloadCalls === 1) ok("maybeReloadAfterColdHold recarrega a janela depois do probe confirmar a saida");
  else bad("maybeReloadAfterColdHold nao recarregou como esperado", "reloadCalls=" + reloadCalls);

  // coldTorHoldSince (let, nao vira propriedade do sandbox) foi zerado por settleExit: uma
  // segunda chamada, sem um novo _testMarkColdTorHold, nao deve repetir banner nem reload.
  executedScripts.length = 0;
  reloadCalls = 0;
  g.settleExit("socks5://127.0.0.1:9060");
  await new Promise(r => setTimeout(r, 30));
  if (executedScripts.length === 0 && reloadCalls === 0) {
    ok("settleExit chamado de novo sem novo arranque frio marcado nao repete banner/reload (coldTorHoldSince foi zerado)");
  } else {
    bad("settleExit repetiu banner/reload sem um novo arranque frio marcado");
  }

  g.probe = origProbe;
}

async function testColdHoldSkipsIfAlreadyRouted() {
  // Se o gateway ja roteou sozinho (lastRoutedAt recente) enquanto o probe corria, nao
  // recarrega -- a corrida foi ganha sem ajuda.
  executedScripts.length = 0;
  reloadCalls = 0;
  g._testMarkColdTorHold();
  const origProbe = g.probe;
  g.probe = async () => { g._testMarkGatewayRouted(); return { proxy: "socks5://127.0.0.1:9060", ms: 5 }; };

  g.settleExit("socks5://127.0.0.1:9060");
  await new Promise(r => setTimeout(r, 30));

  if (reloadCalls === 0) ok("maybeReloadAfterColdHold nao recarrega se o gateway ja roteou sozinho");
  else bad("maybeReloadAfterColdHold recarregou mesmo com gateway ja roteado");

  g.probe = origProbe;
}

function testNoOldHoldNoOp() {
  // Sem arranque frio pendente (coldTorHoldSince == 0), settleExit nao deve mexer no banner.
  executedScripts.length = 0;
  reloadCalls = 0;
  g.coldTorHoldSince = 0;
  g.gatewayWentDirectAt = 0;
  g.settleExit("socks5://127.0.0.1:9060");
  if (executedScripts.length === 0 && reloadCalls === 0) {
    ok("settleExit sem arranque frio pendente nao mexe em banner nem recarrega");
  } else {
    bad("settleExit mexeu em banner/reload sem coldTorHoldSince setado");
  }
}

function testConstants() {
  const src = fs.readFileSync(BYPASS, "utf8");
  if (/TOR_HOLD_BUDGET_MS = 90_000/.test(src)) ok("TOR_HOLD_BUDGET_MS aumentado para 90s");
  else bad("TOR_HOLD_BUDGET_MS nao esta em 90_000");
  if (/MIDIA_RECENTE_MS = 20 \* 60_000/.test(src)) ok("MIDIA_RECENTE_MS aumentado para 20min");
  else bad("MIDIA_RECENTE_MS nao esta em 20 * 60_000");
}


async function testTorBootBannerRetriesUntilWindowExists() {
  // Simula o Discord ainda na splash (sem URL discord.com) quando start() chama a primeira
  // vez: showTorBootBanner deve tentar de novo (TOR_BOOT_BANNER_RETRY_MS) em vez de desistir
  // na hora -- sem isso o aviso nunca apareceria no caso mais comum (Discord tambem acabou
  // de abrir).
  executedScripts.length = 0;
  g._testMarkColdTorHold();
  fakeWin.webContents.getURL = () => "file:///splash.html"; // nao bate com CLIENT_URL_RE
  g.showTorBootBanner();
  await new Promise(r => setTimeout(r, 300));
  if (executedScripts.length === 0) ok("sem janela do cliente ainda, nao injeta nada de imediato");
  else bad("injetou algo mesmo sem janela do cliente pronta");

  // "Discord termina de abrir": a URL passa a bater com CLIENT_URL_RE antes do proximo retry.
  fakeWin.webContents.getURL = () => "https://discord.com/channels/@me";
  await new Promise(r => setTimeout(r, 1700)); // > TOR_BOOT_BANNER_RETRY_MS (1500ms)
  if (executedScripts.some(s => s.includes("golivebypass-tor-wait"))) {
    ok("showTorBootBanner tenta de novo e acha a janela assim que ela aparece");
  } else {
    bad("showTorBootBanner nao tentou de novo depois da janela aparecer");
  }
}

async function testTorBootBannerGivesUpIfAlreadyResolved() {
  // Se coldTorHoldSince ja foi zerado (settleExit resolveu) enquanto a janela nao existia,
  // o retry agendado nao deve mostrar um aviso desatualizado quando finalmente rodar.
  executedScripts.length = 0;
  g._testMarkColdTorHold();
  fakeWin.webContents.getURL = () => "file:///splash.html";
  g.showTorBootBanner();
  await new Promise(r => setTimeout(r, 100));
  // "resolve" antes do retry disparar: simula settleExit tendo zerado o estado.
  vm.runInContext("coldTorHoldSince = 0;", sandboxRef);
  fakeWin.webContents.getURL = () => "https://discord.com/channels/@me";
  await new Promise(r => setTimeout(r, 1700));
  if (executedScripts.length === 0) {
    ok("retry agendado nao mostra aviso desatualizado depois que coldTorHoldSince zerou");
  } else {
    bad("retry mostrou aviso mesmo depois do estado ja ter sido resolvido");
  }
}

(async () => {
  try {
    console.log("== showTorBootBanner / hideTorBootBanner ==");
    await testTorBootBanner();
    console.log("\n== showReconnectWarning com botao Reiniciar agora ==");
    await testReconnectWarningButton();
    console.log("\n== settleExit aciona reload apos arranque frio (issue #116) ==");
    await testColdHoldReloadFlow();
    console.log("\n== settleExit nao recarrega se o gateway ja roteou sozinho ==");
    await testColdHoldSkipsIfAlreadyRouted();
    console.log("\n== showTorBootBanner tenta de novo ate achar a janela do cliente ==");
    await testTorBootBannerRetriesUntilWindowExists();
    console.log("\n== showTorBootBanner nao mostra aviso desatualizado apos coldTorHoldSince zerar ==");
    await testTorBootBannerGivesUpIfAlreadyResolved();
    console.log("\n== settleExit sem arranque frio pendente eh no-op ==");
    testNoOldHoldNoOp();
    console.log("\n== constantes ajustadas ==");
    testConstants();
  } catch (e) {
    console.error("ERRO:", e.message, e.stack);
    failures++;
  }
  console.log("");
  console.log(failures === 0 ? "RESULTADO: TUDO OK" : "RESULTADO: " + failures + " FALHA(S)");
  process.exit(failures === 0 ? 0 : 1);
})();
