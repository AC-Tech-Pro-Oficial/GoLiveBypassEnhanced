"use strict";
//
// Testes do aviso de proxy manual permanentemente quebrada (issue #134: "loading infinito
// mesmo dando control r"). O usuario tinha uma proxy configurada que recusava a autenticacao
// (SOCKS5 etapa=auth) em TODA abertura -- o fallback automatico para o Tor funcionava, mas
// sem nenhum aviso de que o problema era a PROXY, o usuario ficava dando Ctrl+R repetidas
// vezes (e reabrindo o Discord inteiro) tentando "consertar", sem efeito: Ctrl+R so recarrega
// o renderer, nao o processo principal onde o roteador continua preferindo a mesma saida
// quebrada a cada abertura nova.
//
// Nao precisa de container: nada toca rede externa (probe e clientWindow via BrowserWindow
// sao stubados e a sandbox vm carrega o bypass real, igual aos outros testes desta bateria).
//
// Uso:
//   node tests/test-manual-proxy-banner-test.cjs
//   BYPASS=/caminho/golivebypass.js node tests/test-manual-proxy-banner-test.cjs

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const Module = require("module");

const BYPASS = process.env.BYPASS || path.resolve(process.cwd(), "standalone/golivebypass.js");
let failures = 0;
function ok(name) { console.log("  [OK] " + name); }
function bad(name, extra) { failures++; console.log("  [FAIL] " + name + (extra ? ": " + extra : "")); }

const BASE = process.env.FAKE_RES_BASE || "/tmp/fake-res-manual-proxy";
const FAKE_RES = BASE + "/resources";
const MANUAL_PROXY = "socks5://user:pass@1.2.3.4:1080";
fs.mkdirSync(FAKE_RES + "/_app.asar", { recursive: true });
fs.writeFileSync(FAKE_RES + "/_app.asar/package.json", JSON.stringify({ name: "discord", main: "index.js" }));
fs.writeFileSync(FAKE_RES + "/_app.asar/index.js", "// discord fake");
// routeMode "auto" (default) com proxy preenchida = a saida manual/privada do #4 do AGENTS.md.
fs.writeFileSync(FAKE_RES + "/settings.json", JSON.stringify({ enabled: true, proxy: MANUAL_PROXY, excludedCountries: "BR" }));

const executedScripts = [];
const fakeWin = {
  isDestroyed: () => false,
  webContents: {
    getURL: () => "https://discord.com/channels/@me",
    executeJavaScript: (script) => { executedScripts.push(script); return Promise.resolve(); },
    reload: () => {},
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
const logs = [];
const origLog = g.log;
g.log = (line) => { logs.push(String(line)); origLog(line); };

async function testConstantsExist() {
  const src = fs.readFileSync(BYPASS, "utf8");
  if (/const MANUAL_PROXY_AVISO_LIMITE = 2;/.test(src)) ok("MANUAL_PROXY_AVISO_LIMITE definido (2)");
  else bad("MANUAL_PROXY_AVISO_LIMITE nao encontrado ou valor mudou");
}

async function testNoBannerOnSingleFailure() {
  executedScripts.length = 0;
  g.probe = async () => null; // proxy manual sempre falha (etapa=auth, etc.)

  await g.chooseExit();
  await new Promise(r => setTimeout(r, 20)); // deixa o .then() do probe rodar

  if (executedScripts.length === 0) ok("uma falha isolada nao mostra o banner ainda");
  else bad("banner apareceu cedo demais (so 1 falha)");
}

async function testBannerAfterRepeatedFailures() {
  executedScripts.length = 0;
  // A 1a chamada (no teste anterior) ja contou 1 falha; mais uma chamada bate o limite (2).
  await g.chooseExit();
  await new Promise(r => setTimeout(r, 20));

  const shown = executedScripts.find(s => s.includes("golivebypass-manual-proxy-warn"));
  if (shown) ok("banner aparece depois de MANUAL_PROXY_AVISO_LIMITE falhas seguidas");
  else return bad("banner nao apareceu apos o limite de falhas");

  if (shown.includes("Ctrl+R") && shown.includes("Configura")) {
    ok("texto do banner explica que Ctrl+R nao resolve e aponta para Configuracoes");
  } else {
    bad("texto do banner nao tem a orientacao esperada");
  }
}

async function testBannerNotRepeatedAfterShown() {
  executedScripts.length = 0;
  // Mais falhas depois do banner ja mostrado: nao deve injetar de novo (idempotente).
  await g.chooseExit();
  await g.chooseExit();
  await new Promise(r => setTimeout(r, 20));

  const again = executedScripts.filter(s => s.includes("golivebypass-manual-proxy-warn"));
  if (again.length === 0) ok("banner nao repete depois de ja mostrado (idempotente, 1x por processo)");
  else bad("banner foi mostrado de novo", "chamadas=" + again.length);
}

async function testCounterResetsOnSuccess() {
  // Reinicia o cenario: nova sandbox, dessa vez com um probe que falha 1x e depois funciona --
  // o contador de falhas seguidas precisa voltar a 0, senao uma proxy que so oscilou uma vez
  // acabaria disparando o aviso bem antes do limite real na proxima instabilidade.
  const code2 = fs.readFileSync(BYPASS, "utf8");
  const executedScripts2 = [];
  const fakeWin2 = { isDestroyed: () => false, webContents: { getURL: () => "https://discord.com/channels/@me", executeJavaScript: (s) => { executedScripts2.push(s); return Promise.resolve(); }, reload: () => {} } };
  // Sandbox nova (nao reaproveita a de cima): cada require() precisa apontar pro fakeWin2
  // certo, e rodar vm.runInContext duas vezes no MESMO contexto redeclara os const do topo
  // do arquivo (SyntaxError) -- por isso o require() certo entra ANTES da unica execucao.
  const sandboxRequire2 = (name) => {
    if (name === "electron") return { app: appStub, session: sessionStub, BrowserWindow: { getAllWindows: () => [fakeWin2] } };
    if (name === "original-fs") return require("fs");
    return Module._load(name, { filename: BYPASS }, false);
  };
  sandboxRequire2.main = { filename: FAKE_RES + "/_app.asar/index.js" };
  const sandbox2 = {
    require: sandboxRequire2, module: { exports: {} }, exports: {},
    __dirname: FAKE_RES, __filename: BYPASS,
    console, process, Buffer, setTimeout, clearTimeout, setInterval, clearInterval, URL, URLSearchParams, Date,
  };
  sandbox2.module.exports = sandbox2.exports;
  sandbox2.global = sandbox2;
  vm.createContext(sandbox2);
  Object.defineProperty(sandbox2.process, "argv", { value: ["node", FAKE_RES + "/_app.asar/index.js"], writable: false });
  vm.runInContext(code2, sandbox2, { filename: BYPASS });
  const g2 = sandbox2;

  let attempt = 0;
  g2.probe = async () => { attempt++; return attempt === 1 ? null : { proxy: MANUAL_PROXY, ms: 5 }; };

  await g2.chooseExit(); // falha 1
  await new Promise(r => setTimeout(r, 20));
  await g2.chooseExit(); // sucesso -- deveria zerar o contador
  await new Promise(r => setTimeout(r, 20));
  await g2.chooseExit(); // falha (conta como 1a de novo, nao 3a)
  await new Promise(r => setTimeout(r, 20));

  const shown2 = executedScripts2.some(s => s.includes("golivebypass-manual-proxy-warn"));
  if (!shown2) ok("uma resposta boa no meio zera o contador (nao soma com falhas de antes)");
  else bad("banner apareceu cedo demais -- contador nao foi zerado por uma resposta boa");
}

(async () => {
  try {
    console.log("== MANUAL_PROXY_AVISO_LIMITE definido ==");
    await testConstantsExist();
    console.log("\n== 1a falha nao mostra banner ainda ==");
    await testNoBannerOnSingleFailure();
    console.log("\n== banner aparece apos o limite de falhas seguidas ==");
    await testBannerAfterRepeatedFailures();
    console.log("\n== banner nao repete depois de mostrado ==");
    await testBannerNotRepeatedAfterShown();
    console.log("\n== uma resposta boa zera o contador de falhas seguidas ==");
    await testCounterResetsOnSuccess();
  } catch (e) {
    console.error("ERRO:", e.message, e.stack);
    failures++;
  }
  console.log("");
  console.log(failures === 0 ? "RESULTADO: TUDO OK" : "RESULTADO: " + failures + " FALHA(S)");
  process.exit(failures === 0 ? 0 : 1);
})();
