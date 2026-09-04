"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const standalone = fs.readFileSync(path.join(root, "standalone", "GoLiveBypass-Standalone.ps1"), "utf8");
const gui = fs.readFileSync(path.join(root, "golive-gui", "electron", "main.ts"), "utf8");
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

for (const [name, source] of [
  ["plugin installer", pluginInstaller],
  ["standalone installer", standalone],
  ["GUI", gui]
]) {
  assert(source.includes("15.0.21"), `${name} must pin the supported Tor 15.0.21 bundle`);
  assert(
    source.includes("f22b8b17cb18c9fa775dfcf68acf6a2fe788336535fe94645204ca85158aa490"),
    `${name} must pin the official Windows x64 Tor 15.0.21 SHA-256`
  );
  assert(
    !source.includes("tor-expert-bundle-windows-x86_64-13.5"),
    `${name} must not retain the obsolete Tor 13.5/0.4.8 Windows bundle`
  );
}

assert(pluginInstaller.includes("bundle-version.txt"));
assert(pluginInstaller.includes("Test-SupportedManagedTor"));
assert(pluginInstaller.includes("Tor version ([0-9]+"));
assert(oneClick.split("GoLiveBypassEnhanced - Windows one-click installer / migration").length - 1 === 1,
  "one-click wrapper must contain exactly one clean script body");
assert(
  pluginInstaller.includes("[switch] $Tor"),
  "mod installer needs an explicit Tor mode"
);
assert(
  pluginInstaller.includes("https://discord.com/api/download?platform=win&format=exe"),
  "clean install must bootstrap Discord from Discord's official download endpoint"
);
assert(
  pluginInstaller.includes("Get-AuthenticodeSignature") &&
  pluginInstaller.includes("assinatura valida, mas o editor nao e Discord"),
  "downloaded DiscordSetup.exe must be Authenticode-verified as Discord"
);
assert(
  pluginInstaller.includes("Start-Process -FilePath $setup -ArgumentList '-s'"),
  "official Discord bootstrap must use the silent installer"
);
assert(
  pluginInstaller.includes("Ensure-DiscordPatchTarget") &&
  pluginInstaller.indexOf("Ensure-DiscordPatchTarget", pluginInstaller.indexOf("function Invoke-Install")) <
    pluginInstaller.indexOf("$root = Select-Target $root", pluginInstaller.indexOf("function Invoke-Install")),
  "clean Discord bootstrap must happen before mod clone/build"
);
assert(
  pluginInstaller.includes("Install-Mod (Show-ModChoice)") &&
  pluginInstaller.includes("git clone --depth 1"),
  "missing Equicord/Vencord must still be bootstrapped from source"
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

assert(oneClick.includes("KINGCIR: Rei dos Doentes"),
  "one-click installer must show the requested KINGCIR signature");
assert(oneClick.includes("Start-Sleep -Seconds 3"),
  "KINGCIR signature must remain visible for three seconds before installation");

assert(
  oneClick.includes("GoLiveBypass-Installer.ps1") &&
  !oneClick.includes("GoLiveBypass-Standalone.ps1"),
  "one-click path must install the userplugin, not the standalone injector"
);

for (const marker of [
  "Restore-KnownGoLiveStandaloneInjections",
  "Test-KnownGoLiveStandaloneInjection",
  "Reset-GoLiveNativeState",
  "Remove-DuplicateGoLiveUserplugins",
  "Invoke-GoLiveCompatibilityMigration",
  "Assert-EnhancedBuildMarkers",
  "Assert-EnhancedInstallState",
  "MigrationResetCritical"
]) {
  assert(pluginInstaller.includes(marker), `legacy migration contract missing ${marker}`);
}

assert(pluginInstaller.includes("golivebypass\\.js"),
  "known legacy standalone detection must identify the old patcher by golivebypass.js");
assert(pluginInstaller.includes("PSObject.Properties.Remove('GoLiveBypass')"),
  "legacy native GoLiveBypass state must be removed without wiping other native plugin state");
assert(pluginInstaller.includes("Remove-CaminhoSilencioso $target"),
  "canonical userplugin directory must be replaced, not only overwritten file-by-file");
assert(pluginInstaller.includes("viewer-video-parado") &&
       pluginInstaller.includes("rtc.enhanced.status"),
  "installer must verify enhanced markers are present in compiled output");
assert(pluginInstaller.includes("sessionRouting -NotePropertyValue 'gateway'") &&
       pluginInstaller.includes("voiceRegion -NotePropertyValue ''") &&
       pluginInstaller.includes("streamRegion -NotePropertyValue ''"),
  "legacy installs must normalize routing and forced-region settings");
assert(pluginInstaller.includes("DiscordGoLiveBypass"),
  "installer should detect the known external DiscordGoLiveBypass launcher conflict");
assert(pluginInstaller.includes("external-bypass-run-entry.txt") &&
       pluginInstaller.includes("Remove-ItemProperty -Path $runKey -Name $p.Name"),
  "known conflicting launcher autostart must be backed up and disabled");
assert(oneClick.includes("Read-BackupInjectionText") &&
       oneClick.includes("$scores.Equicord += 1200") &&
       oneClick.includes("$scores.Vencord += 1200"),
  "wrapper must recover the pre-standalone active mod identity from _app.asar");
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
