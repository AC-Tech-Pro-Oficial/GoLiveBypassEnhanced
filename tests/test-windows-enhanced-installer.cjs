"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const standalone = fs.readFileSync(path.join(root, "standalone", "GoLiveBypass-Standalone.ps1"), "utf8");
const pluginInstaller = fs.readFileSync(path.join(root, "installer", "GoLiveBypass-Installer.ps1"), "utf8");
const oneClick = fs.readFileSync(path.join(root, "installer", "Install-Enhanced.ps1"), "utf8");
const click = fs.readFileSync(path.join(root, "INSTALL-ENHANCED.cmd"), "utf8");

assert(
  standalone.includes("https://raw.githubusercontent.com/AC-Tech-Pro-Oficial/GoLiveBypassEnhanced/enhanced/rtc-viewer-recovery-v1"),
  "standalone fallback must still fetch the enhanced fork"
);

assert(
  pluginInstaller.includes("goLiveBypass/rtcRecovery.ts") &&
  pluginInstaller.includes("goLiveBypass/rtcShim.ts"),
  "mod installer must ship enhanced RTC modules"
);
assert(
  pluginInstaller.includes("[switch] $Tor"),
  "mod installer needs an explicit Tor mode"
);
assert(
  !pluginInstaller.includes("if ($Yes) { return '' }"),
  "-Yes must never silently select public proxies"
);
assert(
  pluginInstaller.includes("Test-TorGatewayTunnel") &&
  pluginInstaller.includes("gateway.discord.gg") &&
  pluginInstaller.includes("SslStream"),
  "Tor readiness must prove SOCKS CONNECT plus TLS to Discord"
);
assert(
  !pluginInstaller.includes("Seguindo com proxy gratuita"),
  "requested Tor must fail closed instead of falling back to a public proxy"
);
assert(
  pluginInstaller.includes("wscript.exe") &&
  pluginInstaller.includes("GoLiveBypassTor.vbs") &&
  pluginInstaller.includes("-WindowStyle Hidden"),
  "persistent/current Tor launch must be hidden"
);
assert(
  pluginInstaller.includes("Test-LegacyTorStartup") &&
  pluginInstaller.includes("Stop-ManagedTor"),
  "legacy visible Tor startup must migrate safely"
);

assert(
  oneClick.includes("GoLiveBypass-Installer.ps1") &&
  !oneClick.includes("GoLiveBypass-Standalone.ps1"),
  "one-click path must install the userplugin, not the standalone injector"
);
assert(
  oneClick.includes("Restore-AccidentalStandalone"),
  "one-click path must repair machines affected by the old standalone command"
);
assert(
  oneClick.includes("-Mode Install -Mod $selected -Tor -Yes"),
  "one-click path must invoke the mod installer in explicit Tor mode"
);
assert(
  oneClick.includes("Backup-ModSettings") &&
  oneClick.includes("Verify-SettingsPreserved"),
  "one-click path must backup and verify existing mod settings/plugins"
);
assert(
  oneClick.includes("rtcRecovery.ts") &&
  oneClick.includes("rtcShim.ts"),
  "one-click verification must require enhanced plugin modules"
);
assert(
  oneClick.includes("AC-Tech-Pro-Oficial/GoLiveBypassEnhanced"),
  "one-click path must stay pinned to the enhanced fork"
);
assert(
  oneClick.includes("wscript\\.exe") &&
  oneClick.includes("GoLiveBypassTor\\.vbs"),
  "one-click verification must require hidden Tor persistence"
);

assert(click.includes("Install-Enhanced.ps1"));
assert(click.includes("ExecutionPolicy Bypass"));

console.log("Windows enhanced installer/coexistence contract: OK");
