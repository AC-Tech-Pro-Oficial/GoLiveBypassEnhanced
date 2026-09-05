"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const BYPASS = process.env.BYPASS || path.resolve(process.cwd(), "standalone/golivebypass.js");
const source = fs.readFileSync(BYPASS, "utf8");
const begin = source.indexOf("// === voice shim: inicio ===");
const end = source.indexOf("// === voice shim: fim ===");
assert(begin >= 0 && end > begin, "voice shim markers must exist");

function extractConst(name) {
  const m = source.match(new RegExp(`const ${name} = ([\\s\\S]*?);\\n`));
  if (!m) throw new Error(`missing const ${name}`);
  return m[1];
}

function extractFunction(name) {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`missing function ${name}`);
  let brace = source.indexOf("{", start);
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let i = brace; i < source.length; i++) {
    const c = source[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") { quote = c; continue; }
    if (c === "{") depth++;
    if (c === "}" && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`unterminated function ${name}`);
}

function makeConnection({ localUser = "local-secret", streamUser = "local-secret", stats, desktop = false }) {
  const conn = {
    userId: localUser,
    streamUserId: streamUser,
    destroyed: false,
    destroyCalls: 0,
    fastReconnectCalls: 0,
    videoToggleCalls: [],
    desktopCalls: [],
    clearCalls: 0,
    desktopActive: desktop,
    setTransportOptions(options) { this.lastTransport = options; return 42; },
    destroy() { this.destroyCalls++; this.destroyed = true; },
    fastUdpReconnect() { this.fastReconnectCalls++; },
    setDisableLocalVideo(userId, disabled) { this.videoToggleCalls.push([userId, disabled]); },
    setDesktopSource(...args) { this.desktopCalls.push(["setDesktopSource", ...args]); this.desktopActive = true; },
    setDesktopSourceWithOptions(...args) { this.desktopCalls.push(["setDesktopSourceWithOptions", ...args]); this.desktopActive = true; },
    clearDesktopSource() { this.clearCalls++; this.desktopActive = false; },
    hasDesktopSource() { return this.desktopActive; },
    getFilteredStats(_filter, callback) { callback(JSON.stringify(stats)); },
  };
  return conn;
}

function bootHarness(connections, cacheGenericFactory = false, plugin = false) {
  const queue = connections.slice();
  const voice = {
    VoiceConnection: function VoiceConnection(_userId, options) { return options && options.__conn ? options.__conn : queue.shift(); },
    createVoiceConnectionWithOptions(userId, options, callback) {
      return new this.VoiceConnection(userId, options, callback);
    },
    createOwnStreamConnectionWithOptions(userId, options, callback) {
      return new this.VoiceConnection(userId, options, callback);
    },
  };
  const cachedCreateVoice = cacheGenericFactory ? voice.createVoiceConnectionWithOptions : null;
  const nativeModules = { requireModule(name) { return name === "discord_voice" ? voice : { name }; } };
  const sandbox = {
    window: { DiscordNative: { nativeModules } },
    console: { log() {}, info() {}, debug() {}, warn() {}, error() {} },
    Date, JSON, Object, Array, Number, Promise, WeakSet, WeakMap, Reflect,
    setTimeout, clearTimeout,
  };
  sandbox.window.window = sandbox.window;
  vm.createContext(sandbox);
  const shimCode = plugin
    ? fs.readFileSync(path.resolve(process.cwd(), "goLiveBypass/rtcShim.ts"), "utf8")
        .replace("export function installEnhancedRtcShim", "function installEnhancedRtcShim")
        .split("export const RTC_SHIM_SOURCE")[0] + "\ninstallEnhancedRtcShim();"
    : source.slice(begin, end) + "\ninstalarVoiceShim();";
  vm.runInContext(shimCode, sandbox, { filename: plugin ? "rtcShim.ts" : BYPASS });
  nativeModules.requireModule("discord_voice");
  return { sandbox, voice, cachedCreateVoice };
}

async function broadcasterRecoveryContract() {
  const broadcaster = makeConnection({
    desktop: false,
    localUser: "local-secret",
    streamUser: "local-secret",
    stats: {
      screenshare: { pipewireFrames: 5000 },
      outbound: { video: { inputFrameRate: 60, framesEncoded: 100, encodeFrameRate: 0, mediaBitrate: 0 } },
    },
  });
  const { sandbox, voice } = bootHarness([broadcaster]);
  voice.createOwnStreamConnectionWithOptions("local-secret", { __conn: broadcaster, context: "stream", streamUserId: "local-secret" });
  const secretHook = function privateCallback() {};
  broadcaster.setDesktopSource("screen-secret-id", secretHook, "screen");

  const summary = await sandbox.window.__goliveVoiceResumo();
  const encoded = JSON.stringify(summary);
  assert(!encoded.includes("screen-secret-id"), "desktop source id must never leave preload closure");
  assert(!encoded.includes("local-secret"), "user ids must never leave preload closure");
  assert.equal(summary.connections[0].stats.role, "broadcaster", "broadcaster role must be explicit");
  assert.equal(summary.connections[0].sourceCached, true,
    "selected broadcaster source must be exposed only as a sanitized cached/not-cached bit");
  assert.equal(summary.connections[0].roleHint, "broadcaster");

  const level1 = await sandbox.window.__goliveVoiceRecuperar(1, summary.instanceId, summary.connections[0].id);
  assert.equal(level1.ok, true);
  assert.equal(level1.role, "broadcaster");
  assert.equal(level1.action, "desktop-source-reapply");
  assert.equal(broadcaster.destroyCalls, 0, "broadcaster level 1 must not destroy RTC");
  assert.equal(broadcaster.desktopCalls.length, 2, "level 1 must replay exact desktop-source call");
  assert.strictEqual(broadcaster.desktopCalls[1][1], "screen-secret-id");
  assert.strictEqual(broadcaster.desktopCalls[1][2], secretHook);

  const level2 = await sandbox.window.__goliveVoiceRecuperar(2, summary.instanceId, summary.connections[0].id);
  assert.equal(level2.ok, true);
  assert.equal(level2.action, "desktop-source-clear-reapply");
  await new Promise(resolve => setTimeout(resolve, 350));
  assert.equal(broadcaster.destroyCalls, 0, "broadcaster level 2 must preserve RTC");
  assert.equal(broadcaster.clearCalls, 1, "level 2 must clear source once");
  assert.equal(broadcaster.desktopCalls.length, 3, "level 2 must reapply source after clear");
}

async function viewerRecoveryContract() {
  const viewer = makeConnection({
    desktop: false,
    localUser: "local-secret",
    streamUser: "remote-secret",
    stats: {
      inbound: { video: { framesDecoded: 0, decodeFrameRate: 0, framesReceived: 0 } },
    },
  });
  const voiceDefault = makeConnection({
    localUser: "local-secret",
    streamUser: undefined,
    stats: {},
  });
  const { sandbox, voice } = bootHarness([voiceDefault, viewer]);
  voice.createVoiceConnectionWithOptions("local-secret", { __conn: voiceDefault, context: "default" });
  // Current Discord uses the generic factory for viewers; context identifies the stream.
  voice.createVoiceConnectionWithOptions("local-secret", { __conn: viewer, context: "stream", streamUserId: "remote-secret" });

  const summary = await sandbox.window.__goliveVoiceResumo();
  const stream = summary.connections.find(c => c.kind === "stream");
  assert.equal(stream.stats.role, "viewer", "remote stream must be classified viewer");
  assert.equal(stream.stats.framesDecoded, 0);
  assert.equal(stream.stats.decodeFrameRate, 0);
  assert(!JSON.stringify(summary).includes("remote-secret"), "remote stream user id must stay private");

  const level1 = await sandbox.window.__goliveVoiceRecuperar(1, summary.instanceId, stream.id);
  assert.equal(level1.ok, true);
  assert.equal(level1.role, "viewer");
  assert.equal(level1.action, "viewer-fast-udp-reconnect");
  assert.equal(viewer.fastReconnectCalls, 1);
  assert.equal(viewer.destroyCalls, 0);
  assert.equal(voiceDefault.destroyCalls, 0, "primary voice must be preserved");

  const stale = await sandbox.window.__goliveVoiceRecuperar(2, summary.instanceId, stream.id + 1);
  assert.equal(stale.ok, false, "recovery must reject a replaced stream generation");
  assert.equal(stale.action, "stale-generation");
  assert.deepEqual(viewer.videoToggleCalls, [], "stale recovery must not touch the active stream");

  const level2 = await sandbox.window.__goliveVoiceRecuperar(2, summary.instanceId, stream.id);
  assert.equal(level2.ok, true);
  assert.equal(level2.action, "viewer-video-resubscribe");
  await new Promise(resolve => setTimeout(resolve, 350));
  assert.deepEqual(viewer.videoToggleCalls, [["remote-secret", true], ["remote-secret", false]]);
  assert.equal(viewer.destroyCalls, 0);
  assert.equal(voiceDefault.destroyCalls, 0);
}

async function cachedViewerFactoryContract() {
  const viewer = makeConnection({
    localUser: "local-secret",
    streamUser: "remote-secret",
    stats: { inbound: { video: { framesDecoded: 0, decodeFrameRate: 0, framesReceived: 0 } } },
  });
  // Current discord_voice returns a bound wrapper without identity fields.
  delete viewer.userId;
  delete viewer.streamUserId;
  const { sandbox, cachedCreateVoice } = bootHarness([viewer], true);
  cachedCreateVoice.call(sandbox.window.DiscordNative.nativeModules.requireModule("discord_voice"),
    "local-secret", { __conn: viewer, context: "stream", streamUserId: "remote-secret" });

  let summary = await sandbox.window.__goliveVoiceResumo();
  assert.equal(summary.connections[0].kind, "stream",
    "a cached generic factory must still classify a viewer from options.context");
  assert.equal(summary.connections[0].stats.role, "viewer");

  viewer.setDisableLocalVideo("remote-secret", true);
  summary = await sandbox.window.__goliveVoiceResumo();
  assert.equal(summary.connections[0].stats.videoExpected, false,
    "manual video disable must suppress automatic viewer recovery");
}

async function delayedRecoveryOwnershipContract() {
  for (const plugin of [false, true]) {
    const label = plugin ? "plugin" : "standalone";
    const broadcaster = makeConnection({
      stats: { screenshare: { capturedFrames: 100 }, outbound: { video: {
        inputFrameRate: 30, framesEncoded: 0, encodeFrameRate: 0,
      } } },
    });
    const senderHarness = bootHarness([broadcaster], false, plugin);
    senderHarness.voice.createOwnStreamConnectionWithOptions("local-secret",
      { __conn: broadcaster, context: "stream", streamUserId: "local-secret" });
    broadcaster.setDesktopSource("original-source", null, "screen");
    const sender = await senderHarness.sandbox.window.__goliveVoiceResumo();
    senderHarness.sandbox.window.__goliveVoiceRecuperar(2, sender.instanceId, sender.connections[0].id);
    broadcaster.setDesktopSource("new-user-selected-source", null, "screen");

    const viewer = makeConnection({
      streamUser: "remote-secret",
      stats: { inbound: { video: { framesDecoded: 0, decodeFrameRate: 0 } } },
    });
    const viewerHarness = bootHarness([viewer], false, plugin);
    viewerHarness.voice.createVoiceConnectionWithOptions("local-secret",
      { __conn: viewer, context: "stream", streamUserId: "remote-secret" });
    const receiver = await viewerHarness.sandbox.window.__goliveVoiceResumo();
    viewerHarness.sandbox.window.__goliveVoiceRecuperar(2, receiver.instanceId, receiver.connections[0].id);
    // An explicit user disable is meaningful even when recovery already disabled it.
    viewer.setDisableLocalVideo("remote-secret", true);
    await new Promise(resolve => setTimeout(resolve, 350));
    assert.deepEqual(broadcaster.desktopCalls.map(call => call[1]),
      ["original-source", "new-user-selected-source"],
      `${label}: delayed recovery must not restore the user's previous source`);
    assert.deepEqual(viewer.videoToggleCalls,
      [["remote-secret", true], ["remote-secret", true]],
      `${label}: delayed recovery must preserve intervening user video disable`);
    const after = await viewerHarness.sandbox.window.__goliveVoiceResumo();
    assert.equal(after.connections[0].stats.videoExpected, false,
      `${label}: user disable must continue to suppress automatic recovery`);
  }
}

function detectorContract() {
  const detectorCode = [
    "const VOICE_STREAM_AQUECIMENTO_MS = " + extractConst("VOICE_STREAM_AQUECIMENTO_MS") + ";",
    "const VOICE_VIEWER_AQUECIMENTO_MS = " + extractConst("VOICE_VIEWER_AQUECIMENTO_MS") + ";",
    "const VOICE_VIEWER_PARADO_MS = " + extractConst("VOICE_VIEWER_PARADO_MS") + ";",
    "const VOICE_DEMANDA_GRACA_MS = " + extractConst("VOICE_DEMANDA_GRACA_MS") + ";",
    "const VOICE_ENTRADA_VIVA_MS = " + extractConst("VOICE_ENTRADA_VIVA_MS") + ";",
    "const VOICE_SAIDA_PARADA_MS = " + extractConst("VOICE_SAIDA_PARADA_MS") + ";",
    "const VOICE_SAMPLE_MAX_MS = " + extractConst("VOICE_SAMPLE_MAX_MS") + ";",
    extractFunction("streamNativaAtiva"),
    extractFunction("avaliarRtcNativo"),
    "return avaliarRtcNativo;",
  ].join("\n");
  const detect = new Function(detectorCode)();

  const base = {
    voice: { installed: true, voiceHooked: true, connections: [{
      id: 9, kind: "stream", destroyed: false, createdHa: 30_000,
      stats: { statsOk: true, role: "viewer", sampleHa: 0, videoExpected: true,
        framesDecoded: 0, decodeFrameRate: 0, decodeHa: 15_000 },
    }] },
    demanda: { known: true, active: true, demandHa: 2_000, changedHa: 2_000 },
    midia: { midiaAberta: true },
  };
  assert.equal(detect(base), "viewer-video-parado", "#186 zero-decoder re-entry must trigger viewer path");
  assert.equal(detect({ ...base, voice: { ...base.voice, connections: [{ ...base.voice.connections[0], stats: {
    ...base.voice.connections[0].stats, framesDecoded: 8215, decodeFrameRate: 30, decodeHa: 0,
  } }] } }), null, "healthy ~30fps decoder must not trigger");
  assert.equal(detect({ ...base, voice: { ...base.voice, connections: [{ ...base.voice.connections[0], createdHa: 4_000 }] } }), null,
    "new viewer stream must get negotiation warm-up");
  assert.equal(detect({ ...base, demanda: { ...base.demanda, active: false } }), "viewer-video-parado",
    "outbound sink demand must not suppress inbound viewer recovery");
}

function friendBroadcasterDemandDropContract() {
  const helperCode = [
    extractFunction("streamNativaAtiva"),
    extractFunction("geracaoNativa"),
    extractFunction("broadcasterRecoveryStillOwned"),
    "return broadcasterRecoveryStillOwned;",
  ].join("\n");
  const stillOwned = new Function(helperCode)();

  const stream = {
    id: 2,
    kind: "stream",
    destroyed: false,
    sourceCached: true,
    stats: {
      statsOk: true,
      role: "broadcaster",
      inputFrameRate: 30,
      encodeFrameRate: 0,
      framesEncoded: 0,
    },
  };
  const ctx = { voice: { instanceId: 1234, connections: [stream] } };
  const pending = {
    papel: "broadcaster",
    geracao: "1234:2",
  };

  assert.equal(stillOwned(ctx, pending), true,
    "friend log: demand loss must not cancel while the same broadcaster source is still cached");
  assert.equal(stillOwned({ voice: { ...ctx.voice, connections: [{ ...stream, sourceCached: false }] } }, pending), false,
    "voluntary clearDesktopSource must make broadcaster recovery cancellable");
  assert.equal(stillOwned({ voice: { ...ctx.voice, connections: [{ ...stream, id: 3 }] } }, pending), false,
    "a different stream generation must not inherit the previous recovery");
}

function staticSafetyContract() {
  const recoveryStart = source.indexOf("window.__goliveVoiceRecuperar = function");
  const recoveryEnd = source.indexOf("installNativeHook();", recoveryStart);
  const recoveryBlock = source.slice(recoveryStart, recoveryEnd);
  assert(!/\.destroy\s*\(/.test(recoveryBlock), "automatic native recovery must never call destroy()");

  const start = source.indexOf("function iniciarRecuperacaoNativa(");
  const end = source.indexOf("function acompanharRecuperacaoNativa(", start);
  assert(!source.slice(start, end).includes("__goliveMidiaFechar"), "native RTC recovery must not close discord.media");
  assert(source.includes("demanda caiu mas a fonte broadcaster continua ativa; mantendo recuperacao"),
    "friend-log regression: broadcaster demand loss with cached source must keep L1->L2 recovery alive");
  assert(source.includes("sourceCached: !!rec.sourceReplay"),
    "standalone summary must expose only sanitized source ownership state");
}

async function nativeDemandContract() {
  for (const plugin of [false, true]) {
    const first = makeConnection({ stats: {}, desktop: true });
    const second = makeConnection({ stats: {}, desktop: true });
    const { sandbox, voice } = bootHarness([first, second], false, plugin);
    voice.createOwnStreamConnectionWithOptions('local-secret', { context: 'stream' });
    // No console event is emitted: renderer and preload have separate consoles.
    const options = { remoteSinkWantsPixelCount: 841424, privateToken: 'never-export' };
    assert.equal(first.setTransportOptions(options), 42);
    assert.equal(first.lastTransport, options);
    assert.equal(sandbox.window.__goliveVoiceDemandaResumo().active, true);
    first.setTransportOptions({ bitrate: 90000 });
    assert.equal(sandbox.window.__goliveVoiceDemandaResumo().active, true, 'partial transport update preserves demand');
    first.setTransportOptions({ remoteSinkWantsPixelCount: 0 });
    assert.equal(sandbox.window.__goliveVoiceDemandaResumo().active, false);
    first.setTransportOptions({ remoteSinkWantsPixelCount: 841424 });
    voice.createOwnStreamConnectionWithOptions('local-secret', { context: 'stream' });
    assert.equal(sandbox.window.__goliveVoiceDemandaResumo().known, false, 'new stream cannot inherit old demand');
    assert(!JSON.stringify(await sandbox.window.__goliveVoiceResumo()).includes('never-export'));
  }
}

async function keyframeRepairContract() {
  for (const plugin of [false, true]) {
    const conn = makeConnection({desktop:true,stats:{screenshare:{frames:300},outbound:{video:{inputFrameRate:30,framesEncoded:0,encodeFrameRate:0}}}});
    const {sandbox,voice}=bootHarness([conn],false,plugin);
    voice.createOwnStreamConnectionWithOptions('local-secret',{context:'stream',streamUserId:'local-secret'});
    conn.setDesktopSource('selected-source');
    conn.setTransportOptions({keyframeInterval:0,alwaysSendVideo:false});
    const summary=await sandbox.window.__goliveVoiceResumo();
    const result=sandbox.window.__goliveVoiceRecuperar(1,summary.instanceId,summary.connections[0].id);
    assert.equal(result.action,'desktop-source-keyframe-rearm');
    assert.equal(conn.lastTransport.keyframeInterval,1000);
    assert.equal(conn.lastTransport.alwaysSendVideo,true);
    const partial={keyframeInterval:5000,alwaysSendVideo:false,encodingVideoBitRate:1234};
    conn.setTransportOptions(partial);
    assert.equal(partial.keyframeInterval,5000,'caller options must remain unchanged');
    assert.equal(conn.lastTransport.keyframeInterval,1000);
    assert.equal(conn.lastTransport.encodingVideoBitRate,1234);
    conn.clearDesktopSource();
    assert.equal(conn.lastTransport.keyframeInterval,5000,'restore latest caller intent');
    assert.equal(conn.lastTransport.alwaysSendVideo,false);
    conn.setTransportOptions({keyframeInterval:0,alwaysSendVideo:false});
    conn.setDesktopSource('new-source');
    const next=await sandbox.window.__goliveVoiceResumo();
    sandbox.window.__goliveVoiceRecuperar(1,next.instanceId,next.connections[0].id);
    conn.setDesktopSource('user-switched-source');
    assert.equal(conn.lastTransport.keyframeInterval,0,'source switch cancels repair');
    assert.equal(conn.lastTransport.alwaysSendVideo,false);
  }
}

(async () => {
  await keyframeRepairContract();
  await nativeDemandContract();
  await broadcasterRecoveryContract();
  await viewerRecoveryContract();
  await cachedViewerFactoryContract();
  await delayedRecoveryOwnershipContract();
  detectorContract();
  friendBroadcasterDemandDropContract();
  staticSafetyContract();
  console.log("Enhanced RTC recovery: all regression contracts passed.");
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
