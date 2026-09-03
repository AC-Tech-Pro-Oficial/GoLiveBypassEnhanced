"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const standalone = fs.readFileSync(path.join(root, "standalone", "GoLiveBypass-Standalone.ps1"), "utf8");
const installer = fs.readFileSync(path.join(root, "installer", "Install-Enhanced.ps1"), "utf8");
const click = fs.readFileSync(path.join(root, "INSTALL-ENHANCED.cmd"), "utf8");

assert(
  standalone.includes("https://raw.githubusercontent.com/AC-Tech-Pro-Oficial/GoLiveBypassEnhanced/enhanced/rtc-viewer-recovery-v1"),
  "standalone installer must fetch the enhanced fork, not upstream main"
);
assert(
  !standalone.includes('$url = "https://raw.githubusercontent.com/bezumiya/GoLiveBypass/main/standalone/$PatcherName"'),
  "enhanced standalone installer must not silently replace itself with upstream patcher"
);
assert(
  standalone.includes("Reparando a inicializacao oculta do Tor") &&
  standalone.includes("Set-RunKey"),
  "already-running Tor must still migrate the startup entry"
);
assert(
  standalone.includes("wscript.exe") &&
  standalone.includes("GoLiveBypassTor.vbs") &&
  standalone.includes("-WindowStyle Hidden"),
  "Tor startup/current-session launch must be hidden"
);
assert(installer.includes("GoLiveBypass-Standalone.ps1"));
assert(installer.includes("standalone/golivebypass.js"));
assert(installer.includes("-Mode Install -Tor -Yes"));
assert(installer.includes("viewer-video-parado"));
assert(installer.includes("viewer-fast-udp-reconnect"));
assert(installer.includes("routeMode") && installer.includes("127.0.0.1:9060"));
assert(installer.includes("wscript\\.exe") && installer.includes("GoLiveBypassTor\\.vbs"));
assert(click.includes("Install-Enhanced.ps1"));
assert(click.includes("ExecutionPolicy Bypass"));

console.log("Windows enhanced installer contract: OK");
