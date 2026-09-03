/*
 * Role-aware native RTC recovery controller for the Vencord/Equicord plugin.
 *
 * The native Discord objects stay in the isolated preload world. This module
 * only receives sanitized role/progress summaries and asks the preload to run
 * narrowly-scoped recovery actions. It never destroys voice/stream objects,
 * closes discord.media, changes gateway routing, or reloads Discord.
 */

import { session, type WebContents } from "electron";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { RTC_SHIM_SOURCE } from "./rtcShim";

const WORLD_ID = 999;
const PROBE_MS = 5_000;
const STREAM_WARMUP_MS = 20_000;
const VIEWER_WARMUP_MS = 10_000;
const VIEWER_STALL_MS = 10_000;
const INPUT_LIVE_MS = 15_000;
const OUTPUT_STALL_MS = 20_000;
const SAMPLE_MAX_MS = 10_000;
const SUCCESS_FRESH_MS = 8_000;
const SUCCESS_SUSTAINED_MS = 10_000;
const LEVEL1_WAIT_MS = 20_000;
const LEVEL2_WAIT_MS = 30_000;
const ACTION_COOLDOWN_MS = 30_000;
const MAX_ATTEMPTS = 2;
const ATTEMPT_WINDOW_MS = 30 * 60_000;

const PRELOAD_ID = "golive-enhanced-rtc";
let preloadPath: string | null = null;
let preloadRegistered = false;
let activeWebContents: WebContents | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let ticking = false;
let logger: ((message: string) => void) | null = null;
let attempts: number[] = [];
let lastActionAt = 0;
let blockedGeneration = "";
let blockedAt = 0;

type Role = "broadcaster" | "viewer" | "unknown";
type Signal = "transmissor-video-parado" | "viewer-video-parado";

interface PendingRecovery {
    level: 1 | 2;
    role: Exclude<Role, "unknown">;
    signal: Signal;
    generation: string;
    startedAt: number;
    successAt: number;
    action: string;
}

let pending: PendingRecovery | null = null;

function log(message: string) {
    logger?.(`rtc.enhanced | ${message}`);
}

function dataDir() {
    const base = process.platform === "win32"
        ? process.env.LOCALAPPDATA
        : process.env.XDG_DATA_HOME ?? (process.env.HOME ? join(process.env.HOME, ".local", "share") : undefined);
    return base ? join(base, "GoLiveBypass") : null;
}

function ensurePreload() {
    const dir = dataDir();
    if (!dir) {
        log("preload indisponivel: pasta de dados nao resolvida");
        return false;
    }

    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const path = join(dir, "golive-plugin-rtc-shim.js");
    writeFileSync(path, RTC_SHIM_SOURCE, "utf8");
    preloadPath = path;

    if (preloadRegistered) return true;

    const s = session.defaultSession as any;
    try {
        if (typeof s.registerPreloadScript === "function") {
            try {
                if (typeof s.unregisterPreloadScript === "function") s.unregisterPreloadScript(PRELOAD_ID);
            } catch { }
            s.registerPreloadScript({ type: "frame", id: PRELOAD_ID, filePath: path });
            preloadRegistered = true;
            log("preload registrado para novas paginas");
            return true;
        }

        if (typeof s.setPreloads === "function") {
            const current: string[] = typeof s.getPreloads === "function" ? s.getPreloads() : [];
            if (!current.includes(path)) s.setPreloads([...current, path]);
            preloadRegistered = true;
            log("preload registrado via setPreloads");
            return true;
        }
    } catch (error) {
        log(`falha ao registrar preload: ${error instanceof Error ? error.message : String(error)}`);
        return false;
    }

    log("Electron sem API de session preload; usando apenas injecao da pagina atual");
    return false;
}

function unregisterPreload() {
    if (!preloadRegistered) return;
    const s = session.defaultSession as any;
    try {
        if (typeof s.unregisterPreloadScript === "function") {
            s.unregisterPreloadScript(PRELOAD_ID);
        } else if (typeof s.setPreloads === "function" && preloadPath) {
            const current: string[] = typeof s.getPreloads === "function" ? s.getPreloads() : [];
            s.setPreloads(current.filter(path => path !== preloadPath));
        }
    } catch { }
    preloadRegistered = false;
}

async function isolated<T>(webContents: WebContents, code: string): Promise<T | null> {
    if (webContents.isDestroyed()) return null;
    try {
        return await webContents.executeJavaScriptInIsolatedWorld(WORLD_ID, [{ code }], true) as T;
    } catch {
        return null;
    }
}

async function injectCurrent(webContents: WebContents) {
    const result = await isolated<any>(webContents,
        `(function(){ ${RTC_SHIM_SOURCE}; return !!window.__goliveVoiceResumo; })()`);
    if (result === true) log("shim ativo na pagina atual");
}

interface VoiceContext {
    voice: any;
}

async function queryContext(webContents: WebContents): Promise<VoiceContext | null> {
    return isolated<VoiceContext>(webContents,
        `(async function(){
            if (!window.__goliveVoiceResumo) return null;
            return { voice: await window.__goliveVoiceResumo() };
        })()`);
}

function activeStream(voice: any) {
    const connections = Array.isArray(voice?.connections) ? voice.connections : [];
    for (let i = connections.length - 1; i >= 0; i--) {
        const connection = connections[i];
        if (connection?.kind === "stream" && connection.destroyed !== true) return connection;
    }
    return null;
}

function roleOf(stats: any): Role {
    if (stats?.role === "broadcaster" || stats?.role === "viewer") return stats.role;
    if (typeof stats?.framesEncoded === "number" && typeof stats?.encodeFrameRate === "number") return "broadcaster";
    if (typeof stats?.framesDecoded === "number" && typeof stats?.decodeFrameRate === "number") return "viewer";
    return "unknown";
}

function generation(voice: any, stream: any) {
    return String(voice?.instanceId ?? "legacy") + ":" + String(stream?.id ?? "none");
}

function detect(ctx: VoiceContext): Signal | null {
    const voice = ctx?.voice;
    if (!voice || voice.installed !== true || voice.voiceHooked !== true) return null;
    if (voice.demandKnown !== true || voice.demandActive !== true) return null;

    const stream = activeStream(voice);
    const stats = stream?.stats;
    if (!stream || !stats || stats.statsOk !== true) return null;
    if (typeof stats.sampleHa !== "number" || stats.sampleHa < 0 || stats.sampleHa > SAMPLE_MAX_MS) return null;

    const role = roleOf(stats);
    if (role === "broadcaster") {
        if (stream.createdHa < STREAM_WARMUP_MS) return null;
        if (typeof stats.entradaHa !== "number" || stats.entradaHa < 0 || stats.entradaHa > INPUT_LIVE_MS) return null;
        if (!(typeof stats.captureFrames === "number" || stats.inputFrameRate > 0)) return null;
        if (typeof stats.framesEncoded !== "number" || typeof stats.encodeFrameRate !== "number") return null;
        if (typeof stats.saidaHa !== "number" || stats.saidaHa < OUTPUT_STALL_MS) return null;
        return "transmissor-video-parado";
    }

    if (role === "viewer") {
        if (stream.createdHa < VIEWER_WARMUP_MS) return null;
        if (stats.videoExpected !== true) return null;
        if (typeof stats.framesDecoded !== "number" || typeof stats.decodeFrameRate !== "number") return null;
        if (stats.decodeFrameRate > 0) return null;
        if (typeof stats.decodeHa !== "number" || stats.decodeHa < VIEWER_STALL_MS) return null;
        return "viewer-video-parado";
    }

    return null;
}

function healthy(ctx: VoiceContext, expectedRole: Exclude<Role, "unknown">) {
    const voice = ctx?.voice;
    if (!voice || voice.demandKnown !== true || voice.demandActive !== true) return false;
    const stream = activeStream(voice);
    const stats = stream?.stats;
    if (!stream || !stats || stats.statsOk !== true) return false;
    if (roleOf(stats) !== expectedRole) return false;
    if (typeof stats.sampleHa !== "number" || stats.sampleHa < 0 || stats.sampleHa > SAMPLE_MAX_MS) return false;

    if (expectedRole === "broadcaster") {
        return typeof stats.framesEncoded === "number" &&
            stats.encodeFrameRate > 0 &&
            typeof stats.saidaHa === "number" &&
            stats.saidaHa >= 0 &&
            stats.saidaHa <= SUCCESS_FRESH_MS;
    }

    return stats.videoExpected === true &&
        typeof stats.framesDecoded === "number" &&
        stats.decodeFrameRate > 0 &&
        typeof stats.decodeHa === "number" &&
        stats.decodeHa >= 0 &&
        stats.decodeHa <= SUCCESS_FRESH_MS;
}

function pruneAttempts(now = Date.now()) {
    attempts = attempts.filter(at => at >= now - ATTEMPT_WINDOW_MS);
}

function blockCurrent(ctx: VoiceContext, reason: string) {
    const stream = activeStream(ctx?.voice);
    if (stream) {
        blockedGeneration = generation(ctx.voice, stream);
        blockedAt = Date.now();
    }
    pending = null;
    log(`recuperacao manual: ${reason}`);
}

async function performRecovery(webContents: WebContents, ctx: VoiceContext, level: 1 | 2, signal: Signal) {
    const now = Date.now();
    pruneAttempts(now);
    if (attempts.length >= MAX_ATTEMPTS) {
        blockCurrent(ctx, "teto de tentativas");
        return;
    }

    const stream = activeStream(ctx.voice);
    const role = roleOf(stream?.stats);
    if (!stream || (role !== "broadcaster" && role !== "viewer")) {
        blockCurrent(ctx, "papel indisponivel");
        return;
    }

    attempts.push(now);
    lastActionAt = now;
    const attempt: PendingRecovery = {
        level,
        role,
        signal,
        generation: generation(ctx.voice, stream),
        startedAt: now,
        successAt: 0,
        action: ""
    };
    pending = attempt;

    log(`nivel=${level} papel=${role} sinal=${signal}`);
    const result = await isolated<any>(webContents,
        `window.__goliveVoiceRecuperar ? window.__goliveVoiceRecuperar(${level}) : null`);

    if (pending !== attempt) return;
    if (!result || result.ok !== true || result.role !== role) {
        blockCurrent(ctx, "acao nativa indisponivel");
        return;
    }

    attempt.action = String(result.action || "desconhecida");
    log(`nivel=${level} papel=${role} acao=${attempt.action}`);
}

async function tick() {
    if (ticking) return;
    const webContents = activeWebContents;
    if (!webContents || webContents.isDestroyed()) return;

    ticking = true;
    try {
        const ctx = await queryContext(webContents);
        if (!ctx?.voice) return;

        const now = Date.now();
        pruneAttempts(now);

        if (blockedAt > 0) {
            const stream = activeStream(ctx.voice);
            const current = stream ? generation(ctx.voice, stream) : "";
            if (now - blockedAt >= ATTEMPT_WINDOW_MS || (current && current !== blockedGeneration)) {
                blockedAt = 0;
                blockedGeneration = "";
            }
        }

        if (pending) {
            const attempt = pending;
            if (healthy(ctx, attempt.role)) {
                if (attempt.successAt === 0) attempt.successAt = now;
                if (now - attempt.successAt >= SUCCESS_SUSTAINED_MS) {
                    log(`sucesso nivel=${attempt.level} papel=${attempt.role} acao=${attempt.action || "?"}`);
                    pending = null;
                    blockedAt = 0;
                    blockedGeneration = "";
                }
                return;
            }

            attempt.successAt = 0;
            if (ctx.voice.demandKnown === true && ctx.voice.demandActive !== true) {
                log("tentativa cancelada: demanda terminou");
                pending = null;
                return;
            }

            const wait = attempt.level === 1 ? LEVEL1_WAIT_MS : LEVEL2_WAIT_MS;
            if (now - attempt.startedAt < wait) return;

            if (attempt.level === 1) {
                const signal = attempt.signal;
                pending = null;
                await performRecovery(webContents, ctx, 2, signal);
            } else {
                blockCurrent(ctx, "nivel 2 sem progresso");
            }
            return;
        }

        const signal = detect(ctx);
        if (!signal) return;

        const stream = activeStream(ctx.voice);
        if (blockedAt > 0 && stream && generation(ctx.voice, stream) === blockedGeneration) return;
        if (lastActionAt > 0 && now - lastActionAt < ACTION_COOLDOWN_MS) return;

        await performRecovery(webContents, ctx, 1, signal);
    } finally {
        ticking = false;
    }
}

export function startRtcRecovery(webContents: WebContents | undefined, logFn: (message: string) => void) {
    logger = logFn;
    if (!webContents || webContents.isDestroyed()) {
        log("webContents indisponivel; recuperacao fica passiva");
        return;
    }

    activeWebContents = webContents;
    ensurePreload();
    void injectCurrent(webContents);

    if (timer === null) {
        timer = setInterval(() => void tick(), PROBE_MS);
        (timer as any).unref?.();
    }
}

export function stopRtcRecovery() {
    if (timer !== null) {
        clearInterval(timer);
        timer = null;
    }
    pending = null;
    activeWebContents = null;
    ticking = false;
    unregisterPreload();
    log("controlador parado");
    logger = null;
}

export function rtcRecoveryStatus() {
    return {
        active: timer !== null && activeWebContents !== null && !activeWebContents.isDestroyed(),
        pending: pending ? { level: pending.level, role: pending.role, action: pending.action } : null,
        attempts: attempts.length,
        blocked: blockedAt > 0
    };
}
