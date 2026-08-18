/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { NativeSettings, RendererSettings } from "@main/settings";
import { app, IpcMainInvokeEvent, session } from "electron";
import { request } from "https";
import { connect, Socket } from "net";
import { connect as connectTls } from "tls";

const FREE_PROXY_API = "https://api.proxyscrape.com/v4/free-proxy-list/get?request=display_proxies&protocol=socks5&proxy_format=protocolipport&format=json&timeout=1500";
const GEO_HOST = "ifconfig.co";
const DISCORD_HOST = "discord.com";

const MAX_LIST_BYTES = 1024 * 1024;
const PROBE_TIMEOUT_MS = 6000;
const PARALLEL_PROBES = 10;
const MAX_CANDIDATES = 40;
const MIN_UPTIME = 90;
const MAX_LISTED_TIMEOUT = 1500;
const SESSION_DEADLINE_MS = 120_000;
const TOR_PORTS = [9150, 9050];
const TOR_PORT_TIMEOUT_MS = 400;
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const BOOT_PROBE_TIMEOUT_MS = 2500;
const INTERCEPTING_PORTS = new Set([4145]);

const PROXY_RULES_RE = /^(socks5|https?):\/\/([a-z0-9.-]{1,253}):(\d{1,5})$/;
const PROXY_BYPASS_RULES = "cdn.discordapp.com;*.discordapp.net;*.discord.media;<local>";

let appliedProxy: string | null = null;
let deadline: ReturnType<typeof setTimeout> | undefined;

function parseProxy(proxyRules: string) {
    const match = PROXY_RULES_RE.exec(proxyRules);
    if (!match) return null;

    const port = Number(match[3]);
    if (port < 1 || port > 65535) return null;

    return { scheme: match[1], host: match[2], port };
}

function markBoot(pending: boolean) {
    NativeSettings.store.plugins.GoLiveBypass ??= {};
    NativeSettings.store.plugins.GoLiveBypass.bootPending = pending;
}

function bootWasPending() {
    return NativeSettings.plain.plugins?.GoLiveBypass?.bootPending === true;
}

function listening(port: number, timeoutMs: number): Promise<boolean> {
    return new Promise(resolve => {
        const socket = connect({ host: "127.0.0.1", port });
        const finish = (open: boolean) => {
            socket.destroy();
            resolve(open);
        };

        socket.setTimeout(timeoutMs, () => finish(false));
        socket.once("connect", () => finish(true));
        socket.on("error", () => finish(false));
    });
}

function readCachedProxy() {
    const cache: unknown = NativeSettings.plain.plugins?.GoLiveBypass?.verifiedProxy;
    if (typeof cache !== "object" || cache === null) return null;

    const { proxy, at } = cache as { proxy?: unknown; at?: unknown; };
    if (typeof proxy !== "string" || parseProxy(proxy) === null) return null;
    if (typeof at !== "number" || Date.now() - at > CACHE_MAX_AGE_MS) return null;

    return proxy;
}

function storeCachedProxy(proxy: string) {
    NativeSettings.store.plugins.GoLiveBypass ??= {};
    NativeSettings.store.plugins.GoLiveBypass.verifiedProxy = { proxy, at: Date.now() };
}

function excludedCountries() {
    const raw: unknown = RendererSettings.plain.plugins?.GoLiveBypass?.excludedCountries;
    const codes = typeof raw === "string" ? raw.split(",") : ["BR"];

    return new Set(codes.map(code => code.trim().toUpperCase()).filter(code => /^[A-Z]{2}$/.test(code)));
}

async function bootProxy() {
    const manual = manualProxy();
    if (manual === null || manual !== "") return manual ?? "";

    for (const port of TOR_PORTS) {
        const tor = `socks5://127.0.0.1:${port}`;
        if (await listening(port, TOR_PORT_TIMEOUT_MS) && await probe(tor, BOOT_PROBE_TIMEOUT_MS) !== null) return tor;
    }

    // Sem Tor local a escolha de uma proxy gratuita levaria dezenas de segundos, e o gateway
    // conecta antes disso. Reaproveitar a ultima que funcionou resolve, desde que ela seja
    // testada de novo agora: aplicar uma proxy morta as cegas foi o que travava o Discord.
    const cached = readCachedProxy();
    if (cached !== null && await probe(cached, BOOT_PROBE_TIMEOUT_MS) !== null) return cached;

    return await pickFreeProxy(excludedCountries()) ?? "";
}

function manualProxy() {
    const settings = RendererSettings.plain.plugins?.GoLiveBypass;
    if (settings?.enabled !== true) return null;

    const { proxy } = settings;
    if (typeof proxy !== "string" || proxy.trim() === "") return "";

    // Invalido nao pode virar "vazio": cair na lista gratuita mandaria a sessao para um proxy
    // que a pessoa nunca escolheu.
    return parseProxy(proxy.trim()) === null ? null : proxy.trim();
}

async function apply(proxy: string) {
    try {
        await session.defaultSession.setProxy({
            proxyRules: `${proxy},direct://`,
            proxyBypassRules: PROXY_BYPASS_RULES
        });
        await session.defaultSession.closeAllConnections();
    } catch {
        return false;
    }

    appliedProxy = proxy;
    markBoot(true);

    clearTimeout(deadline);
    deadline = setTimeout(clear, SESSION_DEADLINE_MS);
    return true;
}

async function clear() {
    clearTimeout(deadline);
    deadline = undefined;
    appliedProxy = null;
    markBoot(false);

    try {
        // "system" e o que uma sessao intocada usa. Voltar para "direct" arrancaria o proxy
        // do sistema de quem esta atras de PAC, VPN ou proxy corporativo.
        await session.defaultSession.setProxy({ mode: "system" });
        await session.defaultSession.closeAllConnections();
    } catch {
        return false;
    }
    return true;
}

function readReply(socket: Socket, size: (buffer: Buffer) => number, done: (reply: Buffer | null) => void) {
    const chunks: Buffer[] = [];

    const onData = (chunk: Buffer) => {
        chunks.push(chunk);
        const buffer = Buffer.concat(chunks);
        const wanted = size(buffer);
        if (wanted < 0 || buffer.length < wanted) return;

        socket.off("data", onData);
        socket.pause();
        if (buffer.length > wanted) socket.unshift(buffer.subarray(wanted));
        done(buffer.subarray(0, wanted));
    };

    socket.on("data", onData);
    socket.resume();
}

function negotiateSocks5(socket: Socket, host: string, port: number, done: (ok: boolean) => void) {
    readReply(socket, buffer => buffer.length < 2 ? -1 : 2, greeting => {
        if (greeting === null || greeting[1] !== 0) return done(false);

        readReply(socket, buffer => {
            if (buffer.length < 4) return -1;
            if (buffer[3] === 1) return 10;
            if (buffer[3] === 4) return 22;
            return buffer.length < 5 ? -1 : 7 + buffer[4];
        }, reply => done(reply !== null && reply[1] === 0));

        const target = Buffer.from(host, "latin1");
        socket.write(Buffer.concat([
            Buffer.from([5, 1, 0, 3, target.length]),
            target,
            Buffer.from([port >> 8, port & 0xff])
        ]));
    });

    socket.write(Buffer.from([5, 1, 0]));
}

function negotiateConnect(socket: Socket, host: string, port: number, done: (ok: boolean) => void) {
    readReply(socket, buffer => {
        const end = buffer.indexOf("\r\n\r\n");
        return end < 0 ? -1 : end + 4;
    }, reply => done(reply !== null && /^HTTP\/1\.[01] 200/.test(reply.toString("latin1"))));

    socket.write(`CONNECT ${host}:${port} HTTP/1.1\r\nHost: ${host}:${port}\r\n\r\n`);
}

function openTunnel(proxy: string, host: string, port: number, timeoutMs = PROBE_TIMEOUT_MS): Promise<Socket | null> {
    const parsed = parseProxy(proxy);
    if (parsed === null) return Promise.resolve(null);

    return new Promise(resolve => {
        const socket = connect({ host: parsed.host, port: parsed.port });
        let settled = false;

        const finish = (tunnel: Socket | null) => {
            if (settled) return;
            settled = true;
            clearTimeout(guard);
            socket.setTimeout(0);
            if (tunnel === null) socket.destroy();
            resolve(tunnel);
        };

        const guard = setTimeout(() => finish(null), timeoutMs);
        socket.setTimeout(timeoutMs, () => finish(null));
        socket.on("error", () => finish(null));
        socket.once("connect", () => {
            const done = (ok: boolean) => finish(ok ? socket : null);
            if (parsed.scheme === "socks5") negotiateSocks5(socket, host, port, done);
            else negotiateConnect(socket, host, port, done);
        });
    });
}

function readOverTls(socket: Socket, host: string, path: string, timeoutMs = PROBE_TIMEOUT_MS): Promise<string | null> {
    return new Promise(resolve => {
        let body = "";
        let settled = false;

        const finish = (value: string | null) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            tls.destroy();
            resolve(value);
        };

        const timer = setTimeout(() => finish(null), timeoutMs);
        const tls = connectTls({ socket, servername: host, host }, () => {
            tls.write(`GET ${path} HTTP/1.1\r\nHost: ${host}\r\nAccept: */*\r\nConnection: close\r\n\r\n`);
        });

        tls.setEncoding("latin1");
        tls.on("error", () => finish(null));
        tls.on("data", (chunk: string) => {
            body += chunk;
            if (body.length > 65536) finish(body);
        });
        tls.on("end", () => finish(body));
    });
}

async function probe(proxy: string, timeoutMs = PROBE_TIMEOUT_MS) {
    const started = Date.now();

    const socket = await openTunnel(proxy, DISCORD_HOST, 443, timeoutMs);
    if (socket === null) return null;

    const response = await readOverTls(socket, DISCORD_HOST, "/api/v9/gateway", timeoutMs);
    if (response === null || !response.startsWith("HTTP/1.1 200")) return null;

    return { proxy, ms: Date.now() - started };
}

async function exitCountry(proxy: string) {
    const socket = await openTunnel(proxy, GEO_HOST, 443);
    if (socket === null) return null;

    const response = await readOverTls(socket, GEO_HOST, "/json");
    if (response === null) return null;

    const match = /"country_iso"\s*:\s*"([A-Za-z]{2})"|"country(?:Code)?"\s*:\s*"([A-Za-z]{2})"/.exec(response);
    if (match === null) return null;

    return (match[1] ?? match[2]).toUpperCase();
}

async function accepts(proxy: string, excluded: Set<string>) {
    const country = await exitCountry(proxy);
    return country !== null && !excluded.has(country);
}

function rankFreeProxies(body: string, excluded: Set<string>) {
    const data: unknown = JSON.parse(body);
    const { proxies } = data as { proxies?: unknown };
    if (!Array.isArray(proxies)) return [];

    const usable: { proxy: string; uptime: number; timeout: number; }[] = [];

    for (const item of proxies) {
        if (typeof item !== "object" || item === null) continue;

        const entry = item as {
            proxy?: unknown;
            alive?: unknown;
            uptime?: unknown;
            timeout?: unknown;
            ip_data?: { countryCode?: unknown; };
        };

        if (typeof entry.proxy !== "string" || entry.alive !== true) continue;

        const parsed = parseProxy(entry.proxy);
        if (parsed === null || INTERCEPTING_PORTS.has(parsed.port)) continue;

        const uptime = typeof entry.uptime === "number" ? entry.uptime : 0;
        const timeout = typeof entry.timeout === "number" ? entry.timeout : MAX_LISTED_TIMEOUT;
        if (uptime < MIN_UPTIME || timeout > MAX_LISTED_TIMEOUT) continue;

        const country = typeof entry.ip_data?.countryCode === "string" ? entry.ip_data.countryCode.toUpperCase() : "";
        if (excluded.has(country)) continue;

        usable.push({ proxy: entry.proxy, uptime, timeout });
    }

    return usable
        .sort((a, b) => b.uptime - a.uptime || a.timeout - b.timeout)
        .slice(0, MAX_CANDIDATES)
        .map(entry => entry.proxy);
}

async function pickFreeProxy(excluded: Set<string>) {
    let candidates: string[];
    try {
        candidates = rankFreeProxies(await downloadText(FREE_PROXY_API), excluded);
    } catch {
        return null;
    }

    for (let i = 0; i < candidates.length; i += PARALLEL_PROBES) {
        const batch = await Promise.all(candidates.slice(i, i + PARALLEL_PROBES).map(probe));
        const working = batch
            .filter((result): result is { proxy: string; ms: number; } => result !== null)
            .sort((a, b) => a.ms - b.ms);

        for (const candidate of working) {
            if (await accepts(candidate.proxy, excluded)) {
                storeCachedProxy(candidate.proxy);
                return candidate.proxy;
            }
        }
    }

    return null;
}

async function detectTor(excluded: Set<string>) {
    for (const port of TOR_PORTS) {
        const proxy = `socks5://127.0.0.1:${port}`;
        if (await probe(proxy) !== null && await accepts(proxy, excluded)) return proxy;
    }

    return null;
}

function downloadText(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const req = request(url, res => {
            if (res.statusCode !== 200) {
                res.resume();
                reject(new Error("Unexpected response status"));
                return;
            }

            const chunks: Buffer[] = [];
            let size = 0;
            let settled = false;

            res.on("data", (chunk: Buffer) => {
                if (settled) return;

                size += chunk.length;
                if (size > MAX_LIST_BYTES) {
                    settled = true;
                    res.destroy();
                    reject(new Error("Response too large"));
                    return;
                }

                chunks.push(chunk);
            });

            res.on("end", () => {
                if (settled) return;
                settled = true;
                resolve(Buffer.concat(chunks).toString("utf8"));
            });
        });

        req.on("error", reject);
        req.setTimeout(15_000, () => req.destroy(new Error("Request timed out")));
        req.end();
    });
}

app.whenReady().then(async () => {
    app.on("browser-window-created", (_event, win) => {
        win.webContents.on("did-fail-load", (_failed, code, _description, _url, isMainFrame) => {
            if (isMainFrame && code !== -3 && appliedProxy !== null) clear();
        });
    });

    if (bootWasPending()) {
        markBoot(false);
        return;
    }

    const proxy = await bootProxy();
    if (proxy) apply(proxy);
});

export async function enable(_: IpcMainInvokeEvent, excludedCountries: unknown) {
    if (appliedProxy !== null) return { success: true as const, proxy: appliedProxy };

    const excluded = new Set(
        typeof excludedCountries === "string"
            ? excludedCountries.split(",").map(code => code.trim().toUpperCase()).filter(code => /^[A-Z]{2}$/.test(code))
            : []
    );

    const manual = manualProxy();
    if (manual === null) return { success: false as const, error: "O endereco no campo Proxy nao e valido. Use socks5://host:porta." };

    const proxy = manual || await detectTor(excluded) || await pickFreeProxy(excluded);
    if (proxy === null || proxy === "")
        return { success: false as const, error: "No proxy could carry a real request to Discord, so the connection stays direct." };

    return await apply(proxy)
        ? { success: true as const, proxy }
        : { success: false as const, error: "Electron refused the proxy." };
}

export async function disable(_: IpcMainInvokeEvent) {
    return { success: await clear() };
}

export function getActiveProxy(_: IpcMainInvokeEvent) {
    return appliedProxy;
}

export async function testProxy(_: IpcMainInvokeEvent, proxyRules: unknown) {
    if (typeof proxyRules !== "string" || parseProxy(proxyRules.trim()) === null)
        return { success: false as const, error: "Invalid proxy format. Use socks5://host:port." };

    const result = await probe(proxyRules.trim());
    if (result === null)
        return { success: false as const, error: "The proxy could not carry a real request to Discord." };

    return { success: true as const, ms: result.ms, country: await exitCountry(proxyRules.trim()) };
}
