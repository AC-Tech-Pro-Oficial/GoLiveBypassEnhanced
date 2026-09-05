const fs = require("fs");
const path = require("path");
const assert = require("assert");

const distributedClients = [
  "installer/GoLiveBypass-Installer.ps1",
  "installer/golivebypass-installer.sh",
  "standalone/GoLiveBypass-Standalone.ps1",
  "standalone/golivebypass-standalone.sh",
  "golive-gui/electron/bugreport.ts",
  "golive-gui/electron/main.ts",
];

for (const rel of distributedClients) {
  const source = fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
  for (const forbidden of [
    "BugApiToken",
    "BUG_API_TOKEN",
    "GOLIVE_BUG_API_TOKEN",
    "bugReportToken",
    "Authorization: Bearer",
  ]) {
    assert(!source.includes(forbidden), `${rel} reintroduced distributed report credential: ${forbidden}`);
  }
}

const psClients = distributedClients.filter(p => p.endsWith(".ps1"));
for (const rel of psClients) {
  const source = fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
  assert(source.includes("Enviar diagnostico sanitizado para uma issue publica"),
    `${rel} must require explicit consent before publishing installer diagnostics`);
}

for (const rel of [
  "installer/golivebypass-installer.sh",
  "standalone/golivebypass-standalone.sh",
]) {
  const source = fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
  assert(source.includes("report_json_quote"),
    `${rel} must JSON-encode multiline diagnostics safely`);
  assert(source.includes("Enviar diagnostico sanitizado para uma issue publica"),
    `${rel} must require explicit consent before publishing diagnostics`);
}

console.log("distributed bug-report trust contract: ok");
