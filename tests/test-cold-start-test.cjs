"use strict";
//
// Teste do fallback do Tor no estouro do prazo de espera (cold start do modo
// "gratuitas") -- issues #95 e #98.
//
// Lista publica de SOCKS5 e ruim por natureza: no cold start as candidatas
// comumente nao ficam prontas dentro de HOLD_BUDGET_MS (12s) e a primeira
// conexao do gateway nascia DIRETA (IP brasileiro, sessao bloqueada, reload a
// toa -- golivebypass.log da issue #98: saida escolhida so aos 20s). Agora o
// estouro tenta o MESMO fallback do #85 (Tor local) antes do direct; sem Tor,
// sai direta como sempre. Com cache quente (state.json valido), o fallback nao
// e acionado -- gratuitas guardadas continuam na frente.
//
// Nao precisa de container: nada toca rede externa (detectTor e stubado e a
// sandbox vm carrega o bypass real).
//
// Uso:
//   node tests/test-cold-start-test.cjs
//   BYPASS=/caminho/golivebypass.js node tests/test-cold-start-test.cjs

const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const Module = require("module");

const BYPASS = process.env.BYPASS || path.resolve(__dirname, "..", "standalone", "golivebypass.js");
const BASE = fs.mkdtempSync(path.join(os.tmpdir(), "golive-cold-"));
const FAKE_RES = path.join(BASE, "resources");
let failures = 0;
function ok(name) { console.log("  [OK] " + name); }
function bad(name, extra) { failures++; console.log("  [FAIL] " + name + (extra ? ": " + extra : "")); }

const TOR = "socks5://127.0.0.1:9050";

// Carrega o bypass numa sandbox vm nova (estado limpo por caso).
function loadBypass() {
  fs.rmSync(FAKE_RES, { recursive: true, force: true });
  fs.mkdirSync(path.join(FAKE_RES, "_app.asar"), { recursive: true });
  fs.writeFileSync(path.join(FAKE_RES, "_app.asar", "package.json"), JSON.stringify({ name: "discord", main: "index.js" }));
  fs.writeFileSync(path.join(FAKE_RES, "_app.asar", "index.js"), "// discord fake");
  fs.writeFileSync(path.join(FAKE_RES, "settings.json"), JSON.stringify({ enabled: true, proxy: "", routeMode: "free", excludedCountries: "BR" }));

  const appStub = { on: () => {}, whenReady: () => ({ then: () => {} }), setAppPath: () => {} };
  const sessionStub = { defaultSession: { resolveProxy: async () => "DIRECT", setProxy: async () => {} } };
  const code = fs.readFileSync(BYPASS, "utf8");
  const sandboxRequire = (name) => {
    if (name === "electron") return { app: appStub, session: sessionStub };
    if (name === "original-fs") return require("fs");
    return Module._load(name, { filename: BYPASS }, false);
  };
  sandboxRequire.main = { filename: path.join(FAKE_RES, "_app.asar", "index.js") };
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
  Object.defineProperty(sandbox.process, "argv", { value: ["node", path.join(FAKE_RES, "_app.asar", "index.js")], writable: false });
  vm.runInContext(code, sandbox, { filename: BYPASS });

  const g = sandbox;
  const logs = [];
  const origLog = g.log;
  g.log = (line) => { logs.push(String(line)); origLog(line); };
  return { g, logs };
}

async function caso1_cold_com_tor() {
  console.log("== 1. cold start + Tor local disponivel: entrega o Tor em vez de sair direta ==");
  const { g, logs } = loadBypass();
  g.detectTor = async () => TOR;
  const resultado = await g.currentExit();
  if (resultado === TOR) ok("currentExit entregou o Tor local");
  else bad("currentExit deveria entregar o Tor", String(resultado));
  if (logs.some(l => l.includes("gratuitas nao ficaram prontas a tempo (12s)"))) ok("log do estouro com o prazo presente");
  else bad("log do estouro ausente");
  if (logs.some(l => l.includes("tentando o Tor local antes de sair direta"))) ok("fallback do Tor acionado");
  else bad("fallback do Tor nao acionado");
  if (!logs.some(l => l.includes("sem Tor local tambem"))) ok("nao logou ausencia de Tor");
  else bad("logou 'sem Tor local' com Tor disponivel");
}

async function caso2_cold_sem_tor() {
  console.log("== 2. cold start sem Tor: sai direta como antes ==");
  const { g, logs } = loadBypass();
  g.detectTor = async () => null;
  const resultado = await g.currentExit();
  if (resultado === null) ok("sem Tor, currentExit resolve null (direct)");
  else bad("sem Tor deveria resolver null", String(resultado));
  if (logs.some(l => l.includes("sem Tor local tambem"))) ok("log de ausencia de Tor presente");
  else bad("log de ausencia de Tor ausente");
}

async function caso3_cache_quente() {
  console.log("== 3. cache quente: nem consulta o Tor (gratuitas guardadas na frente) ==");
  const { g, logs } = loadBypass();
  fs.writeFileSync(path.join(FAKE_RES, "state.json"), JSON.stringify({ pool: [{ proxy: TOR, ms: 10, country: "US" }], at: Date.now() }));
  g.detectTor = async () => { throw new Error("nao deveria consultar Tor com cache quente"); };
  const resultado = await g.currentExit();
  if (resultado === null) ok("cache quente segue o prazo normal (null/direct)");
  else bad("cache quente deveria resolver null", String(resultado));
  if (!logs.some(l => l.includes("tentando o Tor local"))) ok("fallback do Tor NAO acionado com cache quente");
  else bad("fallback do Tor acionado com cache quente (nao deveria)");
}

function caso4_gates_no_source() {
  console.log("== 4. gates no source: fallback limitado a routeMode free + pool frio ==");
  const src = fs.readFileSync(BYPASS, "utf8");
  if (/routeMode === "free" && poolFrio\(\)/.test(src)) ok("gate do fallback: routeMode free && poolFrio()");
  else bad("gate do fallback ausente ou alterado");
  if (/function poolFrio\(\)/.test(src)) ok("helper poolFrio() presente");
  else bad("helper poolFrio() ausente");
}

(async () => {
  try {
    await caso1_cold_com_tor();      // ~12s (HOLD_BUDGET_MS real)
    await caso2_cold_sem_tor();      // ~12s
    await caso3_cache_quente();      // ~12s
    caso4_gates_no_source();
  } catch (e) {
    console.error("ERRO:", e.message, e.stack);
    failures++;
  }
  fs.rmSync(BASE, { recursive: true, force: true });
  console.log("");
  if (failures === 0) console.log("RESULTADO: TUDO OK");
  else console.log("RESULTADO: " + failures + " FALHA(S)");
  process.exit(failures === 0 ? 0 : 1);
})();
