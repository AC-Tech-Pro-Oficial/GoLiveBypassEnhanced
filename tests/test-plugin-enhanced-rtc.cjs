"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const shim = fs.readFileSync(path.join(root, "goLiveBypass", "rtcShim.ts"), "utf8");
const recovery = fs.readFileSync(path.join(root, "goLiveBypass", "rtcRecovery.ts"), "utf8");
const native = fs.readFileSync(path.join(root, "goLiveBypass", "native.ts"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "goLiveBypass", "manifest.json"), "utf8"));
const installer = fs.readFileSync(path.join(root, "installer", "GoLiveBypass-Installer.ps1"), "utf8");

for (const marker of [
  "framesDecoded",
  "decodeFrameRate",
  "fastUdpReconnect",
  "setLocalVideoDisabled",
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
