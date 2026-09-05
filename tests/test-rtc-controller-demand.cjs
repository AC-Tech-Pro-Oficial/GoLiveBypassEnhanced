"use strict";

// Execute the production controllers, replacing only Electron and recovery I/O.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { stripTypeScriptTypes } = require("node:module");
const root = path.resolve(__dirname, "..");
const standalone = fs.readFileSync(path.join(root, "standalone/golivebypass.js"), "utf8");

function extractFunction(name) {
    const start = standalone.indexOf(`function ${name}(`);
    assert(start >= 0, `missing ${name}`);
    // These top-level functions all end at a column-zero closing brace.
    const end = standalone.indexOf("\n}", start);
    assert(end > start, `unterminated ${name}`);
    return standalone.slice(start, end + 2);
}

function context(role, demand) {
    const stats = role === "viewer"
        ? { role, framesDecoded: 0, decodeFrameRate: 0, decodeHa: 25_000, videoExpected: true }
        : { role, captureFrames: 600, inputFrameRate: 30, framesEncoded: 0,
            encodeFrameRate: 0, entradaHa: 0, saidaHa: 25_000 };
    return {
        voice: { installed: true, voiceHooked: true, instanceId: 123,
            demandKnown: demand.known, demandActive: demand.active,
            connections: [{ id: 7, kind: "stream", destroyed: false, createdHa: 60_000,
                sourceCached: role === "broadcaster", stats: { statsOk: true, sampleHa: 0, ...stats } }] },
        demanda: { demandHa: 0, changedHa: 20_000, ...demand },
        midia: { midiaAberta: true }
    };
}

function pluginHarness() {
    const ts = fs.readFileSync(path.join(root, "goLiveBypass/rtcRecovery.ts"), "utf8")
        .replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, "");
    const box = { Date, setTimeout, clearTimeout, setInterval, clearInterval, logs: [], actions: [] };
    vm.createContext(box);
    vm.runInContext(stripTypeScriptTypes(ts) + `
        logger = message => logs.push(message);
        activeWebContents = { isDestroyed: () => false };
        queryContext = async () => globalThis.ctx;
        isolated = async () => { actions.push('recover'); return { ok: true, role: 'viewer', action: 'test' }; };
        globalThis.api = { detect, healthy, tick, diagnoseReadiness,
            bootWithoutSender() {
                ensurePreload = () => { actions.push('register-preload'); return true; };
                startRtcRecovery(undefined, message => logs.push(message));
            },
            seed(role) { pending = { level: 1, role, generation: '123:7', startedAt: Date.now(), successAt: 0 }; },
            pending() { return pending; } };
    `, box);
    return box;
}

function standaloneHarness() {
    const names = ["streamNativaAtiva", "geracaoNativa", "avaliarRtcNativo", "rtcNativoSaudavel",
        "broadcasterRecoveryStillOwned", "acompanharRecuperacaoNativa"];
    const constants = [...standalone.matchAll(/^const (VOICE_[A-Z0-9_]+) = ([^;]+);/gm)]
        .map(match => `const ${match[1]} = ${match[2]};`).join("\n");
    const box = { Date, logs: [], actions: [] };
    vm.createContext(box);
    vm.runInContext(constants + "\n" + names.map(extractFunction).join("\n") + `
        let videoNativoPendente = null, videoNativoBloqueadoGeracao = '', videoNativoBloqueadoEm = 0;
        function log(message) { logs.push(message); }
        function hideVideoBanner() {}
        function iniciarRecuperacaoNativa() { actions.push('recover'); }
        function falharRecuperacaoNativa() { actions.push('failed'); }
        globalThis.api = { detect: avaliarRtcNativo, healthy: rtcNativoSaudavel,
            tick: acompanharRecuperacaoNativa,
            seed(role) { videoNativoPendente = { nivel: 1, papel: role, geracao: '123:7', inicioEm: Date.now(), sucessoEm: 0 }; },
            pending() { return videoNativoPendente; } };
    `, box);
    return box;
}

async function run() {
    for (const make of [pluginHarness, standaloneHarness]) {
        for (const demand of [{ known: false, active: false }, { known: true, active: false }]) {
            const box = make();
            const viewer = context("viewer", demand);
            assert.equal(box.api.detect(viewer), "viewer-video-parado", `${make.name}: inbound stall without outbound demand`);
            assert(!box.api.detect(context("broadcaster", demand)), `${make.name}: broadcaster still needs demand`);
            const healthyViewer = structuredClone(viewer);
            Object.assign(healthyViewer.voice.connections[0].stats, { framesDecoded: 120, decodeFrameRate: 30, decodeHa: 0 });
            assert(box.api.healthy(healthyViewer, "viewer"), `${make.name}: credit inbound progress without outbound demand`);
            const healthyBroadcaster = context("broadcaster", demand);
            Object.assign(healthyBroadcaster.voice.connections[0].stats, { framesEncoded: 120, encodeFrameRate: 30, saidaHa: 0 });
            assert(!box.api.healthy(healthyBroadcaster, "broadcaster"), `${make.name}: broadcaster health still needs demand`);
            box.ctx = viewer;
            box.api.seed("viewer");
            await box.api.tick(viewer);
            assert(box.api.pending(), `${make.name}: outbound demand loss must not cancel viewer`);
            assert.equal(box.actions.length, 0);
        }

        for (const mutation of ["disappear", "destroy", "generation", "source-clear"]) {
            const box = make();
            const role = mutation === "source-clear" ? "broadcaster" : "viewer";
            const current = context(role, { known: true, active: true });
            box.api.seed(role);
            if (mutation === "disappear") current.voice.connections = [];
            if (mutation === "destroy") current.voice.connections[0].destroyed = true;
            if (mutation === "generation") current.voice.connections[0].id++;
            if (mutation === "source-clear") current.voice.connections[0].sourceCached = false;
            box.ctx = current;
            await box.api.tick(current);
            assert.equal(box.api.pending(), null, `${make.name}: cancel ${mutation}`);
            assert.equal(box.actions.length, 0, `${make.name}: never act on replacement stream`);
        }
    }

    const box = pluginHarness();
    box.api.diagnoseReadiness(null, Date.now(), true);
    box.api.diagnoseReadiness({ installed: false, voiceHooked: false, connections: [] }, Date.now(), true);
    assert(box.logs.every(line => line.includes("installed=nao") && line.includes("voice_hooked=nao")));
    assert(!box.logs.some(line => line.includes("shim ativo")));
    box.api.bootWithoutSender();
    assert.equal(box.actions[0], "register-preload", "native boot must register preload before renderer IPC exists");
    console.log("RTC controllers: viewer demand, stream ownership, broadcaster guards and readiness diagnostics OK");
}

run().catch(error => { console.error(error); process.exitCode = 1; });
