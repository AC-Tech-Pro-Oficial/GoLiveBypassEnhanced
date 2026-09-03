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

assert.equal(manifest.updater.id, "AC-Tech-Pro-Oficial/GoLiveBypassEnhanced");
assert(installer.includes("goLiveBypass/rtcRecovery.ts"));
assert(installer.includes("goLiveBypass/rtcShim.ts"));

console.log("Vencord/Equicord enhanced RTC parity contract: OK");
