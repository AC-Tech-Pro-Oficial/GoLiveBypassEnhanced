const fs = require("fs");
const assert = require("assert");

const standalone = fs.readFileSync("standalone/golivebypass.js", "utf8");
const linux = fs.readFileSync("standalone/golivebypass-standalone.sh", "utf8");
const embedded = fs.readFileSync("golive-gui/electron/bypass.ts", "utf8");

function blockBetween(source, start, end) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a + start.length);
  assert(a >= 0 && b > a, `missing block ${start} -> ${end}`);
  return source.slice(a, b);
}

assert(
  standalone.includes('const routeMode = hasExplicitProxy ? "auto" : "tor";'),
  "standalone must normalize non-manual routing to Tor"
);

const choose = blockBetween(standalone, "async function chooseExit()", "\nlet lastExitAt");
for (const forbidden of ["cachedExit(", "pickFreeExit(", "huntExits("]) {
  assert(!choose.includes(forbidden), `chooseExit must not use public/cache fallback: ${forbidden}`);
}
assert(choose.includes("detectTor("), "chooseExit must use Tor when no explicit proxy exists");

const relay = blockBetween(standalone, "async function openThroughPool", "\n// O PAC roteia");
for (const forbidden of ["firstTunnel(", "cachedExit(", "pickFreeExit(", "pool.map("]) {
  assert(!relay.includes(forbidden), `live relay must not use public reserves: ${forbidden}`);
}
assert(relay.includes("refreshExit()"), "live relay should retry only through trusted selector");

const refresh = blockBetween(standalone, "function refreshExit()", "\n// ------------------------------------------------------------------ manter reserva viva");
for (const forbidden of ["pickFreeExit(", "huntExits(", "cachedExit("]) {
  assert(!refresh.includes(forbidden), `refresh must not seek public exits: ${forbidden}`);
}
assert(refresh.includes("manualProxy()") && refresh.includes("detectTor("),
  "refresh must be limited to explicit proxy or Tor");

assert(!linux.includes('""|auto|tor|free)'),
  "Linux enhanced standalone must not accept free net mode");
assert(linux.includes('free) fail "O modo free foi removido do enhanced.'),
  "Linux CLI should explain how legacy free mode is handled");

const expectedEmbedded = `export const bypassCode = ${JSON.stringify(standalone)}`;
assert.strictEqual(embedded, expectedEmbedded,
  "GUI embedded bypass must exactly match standalone trusted-routing source");

console.log("enhanced routing policy tests passed");
