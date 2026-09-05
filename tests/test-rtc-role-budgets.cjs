"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { stripTypeScriptTypes } = require("node:module");
const root = path.resolve(__dirname, "..");

function harness(plugin) {
    let now = 100_000;
    const box = { Date: { now: () => now }, actions: [], setInterval, clearInterval };
    vm.createContext(box);
    let source;
    if (plugin) {
        source = stripTypeScriptTypes(fs.readFileSync(path.join(root, "goLiveBypass/rtcRecovery.ts"), "utf8")
            .replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, "")) + `
            activeWebContents = { isDestroyed: () => false };
            queryContext = async () => globalThis.ctx;
            isolated = async () => { const role = activeStream(ctx.voice).stats.role;
                actions.push(role); return {ok:true, role, action:'test'}; };
            globalThis.tickController = tick;
        `;
    } else {
        const full = fs.readFileSync(path.join(root, "standalone/golivebypass.js"), "utf8");
        const start = full.indexOf("const videoNativoTentativas =");
        const end = full.indexOf("function logRtcNativo(", start);
        source = [...full.matchAll(/^const (VOICE_[A-Z0-9_]+) = ([^;]+);/gm)]
            .map(m => `const ${m[1]} = ${m[2]};`).join("\n") + "\n" + full.slice(start, end) + `
            let sessaoRevives = 0, autoRevive = true;
            function log() {}
            showVideoBanner = () => {};
            hideVideoBanner = () => {};
            executarVoiceIsolado = async () => { const role = streamNativaAtiva(ctx.voice).stats.role;
                actions.push(role); return {ok:true, role, action:'test'}; };
            globalThis.tickController = () => processarRtcNativo(ctx);
        `;
    }
    vm.runInContext(source, box);
    return {
        actions: box.actions,
        advance(ms) { now += ms; },
        async tick(role, id) {
            const stats = role === "viewer"
                ? { role, framesDecoded: 0, decodeFrameRate: 0, decodeHa: 25_000, videoExpected: true }
                : { role, captureFrames: 600, inputFrameRate: 30, framesEncoded: 0,
                    encodeFrameRate: 0, entradaHa: 0, saidaHa: 25_000 };
            box.ctx = {
                voice: { installed: true, voiceHooked: true, instanceId: 123,
                    demandKnown: true, demandActive: true,
                    connections: [{ id, kind: "stream", destroyed: false, createdHa: 60_000,
                        sourceCached: role === "broadcaster", stats: { statsOk: true, sampleHa: 0, ...stats } }] },
                demanda: { known: true, active: true, demandHa: 0 }, midia: { midiaAberta: true }
            };
            await box.tickController();
        }
    };
}

(async () => {
    for (const plugin of [true, false]) {
        const label = plugin ? "plugin" : "standalone";
        for (const first of ["viewer", "broadcaster"]) {
            const other = first === "viewer" ? "broadcaster" : "viewer";
            const h = harness(plugin);
            await h.tick(first, 1);
            h.advance(20_000);
            await h.tick(first, 1); // level 2 consumes that role's remaining attempt
            assert.equal(h.actions.length, 2, label);
            await h.tick(other, 2); // no cooldown or extra poll from the old pending role
            assert.equal(h.actions.length, 3, `${label}: exhausted ${first} must not block ${other}`);
            assert.equal(h.actions[2], other);
            h.advance(20_000);
            await h.tick(other, 2);
            assert.equal(h.actions.length, 4, label);
            h.advance(31_000);
            await h.tick(first, 3);
            await h.tick(other, 4);
            await h.tick(first, 5);
            assert.equal(h.actions.length, 4, `${label}: new generations never reset either budget`);
            h.advance(30 * 60_000 + 1);
            await h.tick(first, 6);
            assert.equal(h.actions.length, 5, `${label}: attempt window eventually expires`);
        }
        const h = harness(plugin);
        await h.tick("viewer", 1);
        await h.tick("viewer", 2);
        assert.equal(h.actions.length, 1, `${label}: same-role cooldown survives replacement`);
        h.advance(30_000);
        await h.tick("viewer", 2);
        assert.equal(h.actions.length, 2, `${label}: same-role cooldown expires`);
    }
    console.log("RTC role budgets: independent caps/cooldowns, replacement cancellation and expiry OK");
})().catch(error => { console.error(error); process.exitCode = 1; });
