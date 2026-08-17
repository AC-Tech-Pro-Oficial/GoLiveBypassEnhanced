/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { NativeSettings, RendererSettings } from "@main/settings";
import { app, IpcMainInvokeEvent, session } from "electron";
import { request } from "https";
import { connect } from "net";

const FREE_PROXY_API = "https://api.proxyscrape.com/v4/free-proxy-list/get";
const MAX_LIST_BYTES = 1024 * 1024;
const MAX_PROXY_CANDIDATES = 8;
const PROXY_TEST_TIMEOUT_MS = 5000;
const VALID_PROTOCOLS = new Set(["http", "socks4", "socks5"]);
const PROXY_RULES_RE = /^(socks4|socks5|https?):\/\/([^/\s]{1,253}):(\d{1,5})$/;

let appliedProxy: string | null = null;
let lastKnownProxy: string | null = null;

function readStoredProxy() {
    const proxy: unknown = NativeSettings.plain.plugins?.GoLiveBypass?.lastKnownProxy;
    return typeof proxy === "string" && PROXY_RULES_RE.test(proxy) ? proxy : "";
}

function storeProxy(proxy: string) {
    lastKnownProxy = proxy;
    NativeSettings.store.plugins.GoLiveBypass ??= {};
    NativeSettings.store.plugins.GoLiveBypass.lastKnownProxy = proxy;
}

function earlyProxy() {
    const settings = RendererSettings.plain.plugins?.GoLiveBypass;
    if (settings?.enabled !== true) return "";

    const { proxy } = settings;
    if (typeof proxy === "string" && PROXY_RULES_RE.test(proxy.trim())) return proxy.trim();

    return lastKnownProxy ?? readStoredProxy();
}

async function apply(proxyRules: string) {
    await session.defaultSession.setProxy({ proxyRules });
    appliedProxy = proxyRules;
}

function earlyApply() {
    const proxy = earlyProxy();
    if (proxy && proxy !== appliedProxy) apply(proxy).catch(() => { });
}

app.whenReady().then(() => {
    earlyApply();

    app.on("browser-window-created", (_event, win) => {
        earlyApply();
        win.webContents.on("did-start-navigation", e => {
            if (e.isMainFrame) earlyApply();
        });
    });
});

function parseProxy(proxyRules: string) {
    const match = PROXY_RULES_RE.exec(proxyRules);
    if (!match) return null;

    const port = Number(match[3]);
    if (port < 1 || port > 65535) return null;

    return { scheme: match[1], host: match[2], port };
}

function connectThroughProxy(scheme: string, host: string, port: number, target: string, targetPort: number): Promise<boolean> {
    return new Promise(resolve => {
        const socket = connect({ host, port });
        let settled = false;
        const done = (ok: boolean) => {
            if (settled) return;
            settled = true;
            socket.destroy();
            resolve(ok);
        };

        socket.setTimeout(PROXY_TEST_TIMEOUT_MS, () => done(false));
        socket.on("error", () => done(false));

        socket.once("connect", () => {
            if (scheme === "http" || scheme === "https") {
                socket.once("data", res => done(/^HTTP\/1\.[01] 200/.test(res.toString("latin1"))));
                socket.write(`CONNECT ${target}:${targetPort} HTTP/1.1\r\nHost: ${target}:${targetPort}\r\n\r\n`);
                return;
            }

            if (scheme === "socks5") {
                socket.once("data", greeting => {
                    if (greeting.length < 2 || greeting[1] !== 0) return done(false);

                    const hostBuf = Buffer.from(target, "latin1");
                    socket.once("data", res => done(res.length >= 2 && res[1] === 0));
                    socket.write(Buffer.concat([
                        Buffer.from([0x05, 0x01, 0x00, 0x03, hostBuf.length]),
                        hostBuf,
                        Buffer.from([targetPort >> 8, targetPort & 0xff])
                    ]));
                });
                socket.write(Buffer.from([0x05, 0x01, 0x00]));
                return;
            }

            const hostBuf = Buffer.from(target, "latin1");
            socket.once("data", res => done(res.length >= 2 && res[1] === 0x5a));
            socket.write(Buffer.concat([
                Buffer.from([0x04, 0x01, targetPort >> 8, targetPort & 0xff, 0, 0, 0, 1, 0]),
                hostBuf,
                Buffer.from([0])
            ]));
        });
    });
}

export async function applyProxy(_: IpcMainInvokeEvent, proxyRules: unknown, remember?: unknown) {
    if (typeof proxyRules !== "string" || !parseProxy(proxyRules.trim()))
        return { success: false as const, error: "Invalid proxy format. Use scheme://host:port." };

    try {
        await apply(proxyRules.trim());
        if (remember === true) storeProxy(proxyRules.trim());
        return { success: true as const, proxy: appliedProxy };
    } catch {
        return { success: false as const, error: "Failed to apply the proxy." };
    }
}

export async function clearProxy(_: IpcMainInvokeEvent) {
    try {
        await session.defaultSession.setProxy({ mode: "direct" });
        appliedProxy = null;
        return { success: true as const };
    } catch {
        return { success: false as const, error: "Failed to clear the proxy." };
    }
}

export function getActiveProxy(_: IpcMainInvokeEvent) {
    return appliedProxy;
}

export async function testProxy(_: IpcMainInvokeEvent, proxyRules: unknown) {
    const proxy = typeof proxyRules === "string" ? parseProxy(proxyRules.trim()) : null;
    if (!proxy)
        return { success: false as const, error: "Invalid proxy format. Use scheme://host:port." };

    const ok = await connectThroughProxy(proxy.scheme, proxy.host, proxy.port, "discord.com", 443);
    return ok
        ? { success: true as const }
        : { success: false as const, error: "The proxy did not accept a connection to discord.com." };
}

interface FreeProxyEntry {
    proxy: string;
    countryCode: string;
}

function parseFreeProxyList(body: string): FreeProxyEntry[] {
    const data: unknown = JSON.parse(body);
    if (typeof data !== "object" || data === null) return [];

    const { proxies } = data as { proxies?: unknown };
    if (!Array.isArray(proxies)) return [];

    const entries: FreeProxyEntry[] = [];
    for (const item of proxies) {
        if (typeof item !== "object" || item === null) continue;

        const { proxy, ip_data } = item as { proxy?: unknown; ip_data?: unknown };
        if (typeof proxy !== "string" || !PROXY_RULES_RE.test(proxy)) continue;

        const countryCode = typeof ip_data === "object" && ip_data !== null
            && typeof (ip_data as { countryCode?: unknown }).countryCode === "string"
            ? (ip_data as { countryCode: string }).countryCode.toUpperCase()
            : "";

        entries.push({ proxy, countryCode });
    }
    return entries;
}

export async function fetchFreeProxy(_: IpcMainInvokeEvent, protocol: unknown, excludedCountries: unknown) {
    if (typeof protocol !== "string" || !VALID_PROTOCOLS.has(protocol))
        return { success: false as const, error: "Unsupported proxy protocol." };

    const excluded = new Set(
        typeof excludedCountries === "string"
            ? excludedCountries.split(",").map(c => c.trim().toUpperCase()).filter(c => /^[A-Z]{2}$/.test(c))
            : []
    );

    let body: string;
    try {
        body = await downloadText(`${FREE_PROXY_API}?request=display_proxies&protocol=${protocol}&proxy_format=protocolipport&format=json&timeout=5000`);
    } catch {
        return { success: false as const, error: "Failed to fetch the free proxy list." };
    }

    let proxies: string[];
    try {
        proxies = parseFreeProxyList(body)
            .filter(e => !e.countryCode || !excluded.has(e.countryCode))
            .map(e => e.proxy);
    } catch {
        return { success: false as const, error: "Failed to parse the free proxy list." };
    }

    if (!proxies.length)
        return { success: false as const, error: "The free proxy list had no proxies outside the excluded countries." };

    for (let i = proxies.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [proxies[i], proxies[j]] = [proxies[j], proxies[i]];
    }

    for (const candidate of proxies.slice(0, MAX_PROXY_CANDIDATES)) {
        const parsed = parseProxy(candidate);
        if (!parsed) continue;

        if (await connectThroughProxy(parsed.scheme, parsed.host, parsed.port, "discord.com", 443))
            return { success: true as const, proxy: candidate };
    }

    return { success: false as const, error: "No working proxy found outside the excluded countries." };
}

function downloadText(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const req = request(url, res => {
            if (res.statusCode !== 200) {
                res.resume();
                return reject(new Error("Unexpected response status"));
            }

            let size = 0;
            const chunks: Buffer[] = [];
            res.on("data", (chunk: Buffer) => {
                size += chunk.length;
                if (size > MAX_LIST_BYTES)
                    req.destroy(new Error("Response too large"));
                else
                    chunks.push(chunk);
            });
            res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        });
        req.on("error", reject);
        req.setTimeout(15000, () => req.destroy(new Error("Request timed out")));
        req.end();
    });
}
