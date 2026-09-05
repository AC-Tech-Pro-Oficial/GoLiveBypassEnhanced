"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const shim = fs.readFileSync(path.join(root, "goLiveBypass", "rtcShim.ts"), "utf8");
const recovery = fs.readFileSync(path.join(root, "goLiveBypass", "rtcRecovery.ts"), "utf8");
const native = fs.readFileSync(path.join(root, "goLiveBypass", "native.ts"), "utf8");
const index = fs.readFileSync(path.join(root, "goLiveBypass", "index.tsx"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "goLiveBypass", "manifest.json"), "utf8"));
const installer = fs.readFileSync(path.join(root, "installer", "GoLiveBypass-Installer.ps1"), "utf8");

for (const marker of [
  "framesDecoded",
  "decodeFrameRate",
  "fastUdpReconnect",
  "setDisableLocalVideo",
  "options.context === 'stream'",
  "expectedConnectionId",
  "desktop-source-reapply",
  "desktop-source-clear-reapply",
  "viewer-fast-udp-reconnect",
  "viewer-video-resubscribe"
]) {
  assert(shim.includes(marker), `RTC shim missing ${marker}`);
}

const recoveryStart = shim.indexOf("window.__goliveVoiceRecuperar = function");
const recoveryEnd = shim.indexOf("installNativeHook();", recoveryStart);
assert(recoveryStart >= 0 && recoveryEnd > recoveryStart);
assert(!/\.destroy\s*\(/.test(shim.slice(recoveryStart, recoveryEnd)),
  "plugin automatic RTC recovery must never destroy native connections");

for (const marker of [
  "transmissor-video-parado",
  "viewer-video-parado",
  "SUCCESS_SUSTAINED_MS",
  "startRtcRecovery",
  "stopRtcRecovery"
]) {
  assert(recovery.includes(marker), `RTC controller missing ${marker}`);
}

for (const marker of [
  "sourceCached",
  "sourceHa",
  "roleHint"
]) {
  assert(shim.includes(marker), `RTC shim diagnostics missing ${marker}`);
}

for (const marker of [
  "DIAGNOSTIC_THROTTLE_MS",
  "diagnoseMissingBroadcasterStats",
  "diag broadcaster",
  "source_cached="
]) {
  assert(recovery.includes(marker), `broadcaster observability missing ${marker}`);
}

for (const marker of [
  "broadcasterRecoveryStillOwned",
  "demandDropLogged",
  "demanda caiu mas a fonte broadcaster continua ativa; mantendo recuperacao",
  "stream.sourceCached !== true"
]) {
  assert(recovery.includes(marker), `friend broadcaster regression missing ${marker}`);
}

const diagStart = recovery.indexOf("function diagnoseMissingBroadcasterStats");
const diagEnd = recovery.indexOf("function detect(", diagStart);
assert(diagStart >= 0 && diagEnd > diagStart);
const diagBlock = recovery.slice(diagStart, diagEnd);
for (const forbidden of ["streamUserId", "userId", "sourceReplay.args"]) {
  assert(!diagBlock.includes(forbidden), `diagnostic must not expose private value ${forbidden}`);
}

for (const forbidden of ["__goliveMidiaFechar", ".reload(", "closeAllConnections"]) {
  assert(!recovery.includes(forbidden), `RTC controller must not use destructive action ${forbidden}`);
}

assert(native.includes('from "./rtcRecovery"'));
assert(native.includes("startRtcRecovery(event?.sender, log)"));
assert(native.includes("stopRtcRecovery()"));
assert(native.includes("rtcRecoveryStatus()"));

const pickStart = native.indexOf("async function pickExit(");
const pickEnd = native.indexOf("async function autoExit(", pickStart);
assert(pickStart >= 0 && pickEnd > pickStart);
const pickBlock = native.slice(pickStart, pickEnd);
assert(pickBlock.includes("proxy configurado indisponivel; nenhuma proxy publica sera usada"));
assert(pickBlock.includes("return settleExit(null)"),
  "configured Tor/private proxy must fail closed to direct, not public proxy discovery");

for (const marker of [
  "TOR_STARTUP_WAIT_MS",
  "TOR_STARTUP_STALL_MS",
  "waitForConfiguredTor",
  "startManagedTorIfPresent",
  'windowsHide: true',
  'detached: true'
]) {
  assert(native.includes(marker), `configured Tor cold-boot recovery missing ${marker}`);
}

assert.equal(manifest.updater.id, "AC-Tech-Pro-Oficial/GoLiveBypassEnhanced");
assert(installer.includes("goLiveBypass/rtcRecovery.ts"));
assert(installer.includes("goLiveBypass/rtcShim.ts"));

console.log("Vencord/Equicord enhanced RTC parity contract: OK");


(function testEnhancedRoutingTrustPolicy() {
  const autoStart = native.indexOf("async function autoExit(");
  const autoEnd = native.indexOf("\n}", autoStart);
  assert(autoStart >= 0 && autoEnd > autoStart, "autoExit block missing");
  const autoBlock = native.slice(autoStart, autoEnd + 2);
  assert(autoBlock.includes("torExit("), "blank enhanced proxy must prefer local Tor");
  for (const forbidden of ["sharedFreeExit(", "freeExit(", "readPool(", "FREE_PROXY_API"]) {
    assert(!autoBlock.includes(forbidden), `autoExit must not consult public proxy machinery: ${forbidden}`);
  }

  const serveStart = native.indexOf("async function serveRequest(");
  const serveEnd = native.indexOf("\nfunction pacScript", serveStart);
  assert(serveStart >= 0 && serveEnd > serveStart, "serveRequest block missing");
  const serveBlock = native.slice(serveStart, serveEnd);
  assert(!serveBlock.includes("firstTunnel("),
    "live gateway relay must not silently switch to a public reserve");

  const migrationStart = native.indexOf("function migrateLegacyPool()");
  const migrationEnd = native.indexOf("\n}", migrationStart);
  assert(migrationStart >= 0 && migrationEnd > migrationStart, "legacy pool migration block missing");
  const migrationBlock = native.slice(migrationStart, migrationEnd + 2);
  assert(migrationBlock.includes("delete (store as any).pool") &&
         migrationBlock.includes("delete (store as any).verifiedProxy"),
    "enhanced startup must erase inherited public-proxy pool state");

  const retryStart = native.indexOf("export async function retryWithProxy");
  const retryEnd = native.indexOf("\nexport async function testProxy", retryStart);
  assert(retryStart >= 0 && retryEnd > retryStart, "retryWithProxy block missing");
  const retryBlock = native.slice(retryStart, retryEnd);
  assert(retryBlock.includes("isTorProxy(through)") &&
         retryBlock.includes("torReachable(through, TOR_HEARTBEAT_TIMEOUT_MS)"),
    "Tor retry must use Tor-specific reachability rather than the generic proxy probe");

  assert(index.includes("Enhanced never falls back to public proxy lists."),
    "plugin settings must state the enhanced trust policy");

  for (const removed of [
    "FREE_PROXY_API",
    "rankFreeProxies(",
    "sharedFreeExit(",
    "function readPool(",
    "function writePool(",
    "function firstTunnel("
  ]) {
    assert(!native.includes(removed), `public proxy subsystem must be absent from enhanced plugin: ${removed}`);
  }
})();
