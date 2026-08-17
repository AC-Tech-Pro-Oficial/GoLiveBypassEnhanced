/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType, PluginNative } from "@utils/types";
import { showToast, Toasts } from "@webpack/common";

const Native = VencordNative?.pluginHelpers?.GoLiveBypass as PluginNative<typeof import("./native")> | undefined;

const WATCHDOG_TIMEOUT_MS = 120_000;
const LAST_APPLY_KEY = "GoLiveBypass_lastApply";
const LAST_APPLY_GRACE_MS = 3 * 60_000;

const settings = definePluginSettings({
    proxy: {
        type: OptionType.STRING,
        description: "Proxy used only during login, like socks5://127.0.0.1:9050 for Tor. Leave empty to fetch a free proxy automatically.",
        default: ""
    },
    freeProxyProtocol: {
        type: OptionType.SELECT,
        description: "Protocol used when fetching a free proxy. Ignored when a manual proxy is set.",
        options: [
            { label: "SOCKS5 (recommended)", value: "socks5", default: true },
            { label: "HTTP", value: "http" },
            { label: "SOCKS4", value: "socks4" }
        ]
    },
    excludedCountries: {
        type: OptionType.STRING,
        description: "Two-letter country codes, comma separated, whose proxies are never used, like BR,RU. Only applies to automatically fetched free proxies.",
        default: "BR"
    }
});

let proxyApplied = false;
let watchdog: ReturnType<typeof setTimeout> | undefined;

function stopWatchdog() {
    if (watchdog !== undefined) {
        clearTimeout(watchdog);
        watchdog = undefined;
    }
}

function startWatchdog() {
    stopWatchdog();
    watchdog = setTimeout(() => {
        if (!proxyApplied) return;
        showToast("GoLiveBypass timed out waiting for the login. The proxy may be dead, clearing it.", Toasts.Type.FAILURE);
        clearGoLiveBypass("timeout");
    }, WATCHDOG_TIMEOUT_MS);
}

async function applyGoLiveBypass() {
    if (!Native || proxyApplied) return;

    try {
        const manual = settings.store.proxy.trim();
        let proxy = manual;
        if (!proxy) {
            const res = await Native.fetchFreeProxy(settings.store.freeProxyProtocol, settings.store.excludedCountries);
            if (!res.success) {
                showToast(`GoLiveBypass could not get a free proxy. ${res.error}`, Toasts.Type.FAILURE);
                return;
            }
            proxy = res.proxy;
        }

        const res = await Native.applyProxy(proxy, !manual);
        if (res.success) {
            proxyApplied = true;
            startWatchdog();
            await DataStore.set(LAST_APPLY_KEY, Date.now());
            showToast(`GoLiveBypass active. Login traffic goes through ${proxy}.`);
        } else {
            showToast(`GoLiveBypass failed. ${res.error}`, Toasts.Type.FAILURE);
        }
    } catch (e) {
        console.error("[GoLiveBypass] Failed to apply the proxy", e);
        showToast("GoLiveBypass failed to talk to the desktop process.", Toasts.Type.FAILURE);
    }
}

async function clearGoLiveBypass(reason: string) {
    stopWatchdog();
    if (!Native || !proxyApplied) return;

    try {
        const res = await Native.clearProxy();
        proxyApplied = false;
        await DataStore.del(LAST_APPLY_KEY);
        if (res.success)
            showToast(`GoLiveBypass off (${reason}). Direct connection restored.`, Toasts.Type.SUCCESS);
    } catch (e) {
        console.error("[GoLiveBypass] Failed to clear the proxy", e);
    }
}

export default definePlugin({
    name: "GoLiveBypass",
    description: "Boots Discord behind a proxy (Tor or tested free proxy) so the session registers outside Brazil, restoring Go Live and camera. Drops the proxy once the session is ready.",
    authors: [{ name: "Bezu", id: 0n }],
    tags: ["Privacy"],
    settings,

    flux: {
        LOGIN_SUCCESS() {
            clearGoLiveBypass("login finished");
        },

        CONNECTION_OPEN() {
            clearGoLiveBypass("session ready");
        },

        LOGOUT() {
            applyGoLiveBypass();
        }
    },

    async start() {
        if (!Native) return;

        if (!settings.store.proxy.trim()) {
            const lastApply = await DataStore.get<number>(LAST_APPLY_KEY);
            if (lastApply && Date.now() - lastApply < LAST_APPLY_GRACE_MS) {
                await DataStore.del(LAST_APPLY_KEY);
                showToast("GoLiveBypass skipped. The last proxied attempt did not finish, check your proxy settings.", Toasts.Type.FAILURE);
                return;
            }
        }

        try {
            const active = await Native.getActiveProxy();
            if (active) {
                proxyApplied = true;
                startWatchdog();
                await DataStore.set(LAST_APPLY_KEY, Date.now());
                showToast(`GoLiveBypass active. Login traffic goes through ${active}.`);
                return;
            }
        } catch (e) {
            console.error("[GoLiveBypass] Failed to check the active proxy", e);
        }

        applyGoLiveBypass();
    },

    stop() {
        clearGoLiveBypass("plugin disabled");
    }
});
