/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Paragraph } from "@components/Paragraph";
import { Logger } from "@utils/Logger";
import { useAwaiter } from "@utils/react";
import definePlugin, { OptionType, PluginNative } from "@utils/types";
import { findStoreLazy } from "@webpack";
import { Constants, MaskedLink, RestAPI, SearchableSelect, showToast, Toasts } from "@webpack/common";

const Native = VencordNative?.pluginHelpers?.GoLiveBypass as PluginNative<typeof import("./native")> | undefined;

const logger = new Logger("GoLiveBypass");

interface RegionStore {
    getPreferredRegion(): string | null;
    getPreferredRegions(): string[] | null;
    shouldIncludePreferredRegion(): boolean;
}

interface VoiceRegion {
    id: string;
    name: string;
    optimal: boolean;
    deprecated: boolean;
    custom: boolean;
}

interface MediaEngineStore {
    supportsInApp(kind: string): boolean;
}

const RTCRegionStore: RegionStore = findStoreLazy("RTCRegionStore");
const MediaEngineStore: MediaEngineStore = findStoreLazy("MediaEngineStore");

const AUTOMATIC = "";
const VOICE_KEYS: "voiceRegion"[] = ["voiceRegion"];
const STREAM_KEYS: "streamRegion"[] = ["streamRegion"];

let original: RegionStore | undefined;
let bypassRequested = false;

interface RegionSelectProps {
    value: string;
    placeholder: string;
    automaticLabel: string;
    onChange(region: string): void;
}

function RegionSelect({ value, placeholder, automaticLabel, onChange }: RegionSelectProps) {
    const [regions, error, pending] = useAwaiter(
        async () => {
            const { body } = await RestAPI.get({ url: Constants.Endpoints.REGIONS() });
            return (body as VoiceRegion[]).filter(region => !region.deprecated && !region.custom);
        },
        { fallbackValue: [] as VoiceRegion[] }
    );

    if (pending) return <Paragraph>Loading the region list.</Paragraph>;
    if (error) return <Paragraph>Discord did not hand over the region list. Log in and reopen settings to try again.</Paragraph>;

    const options = [
        { label: automaticLabel, value: AUTOMATIC },
        ...regions.map(region => ({ label: region.optimal ? `${region.name}, optimal for you` : region.name, value: region.id }))
    ];

    return (
        <SearchableSelect
            placeholder={placeholder}
            maxVisibleItems={8}
            options={options}
            value={options.find(option => option.value === value)?.value}
            onChange={onChange}
            closeOnSelect
        />
    );
}

function VoiceRegionPicker() {
    const { voiceRegion } = settings.use(VOICE_KEYS);

    return (
        <RegionSelect
            value={voiceRegion}
            placeholder="Pick the region your calls should connect through"
            automaticLabel="Automatic, whatever Discord picks"
            onChange={region => settings.store.voiceRegion = region}
        />
    );
}

function StreamRegionPicker() {
    const { streamRegion } = settings.use(STREAM_KEYS);

    return (
        <RegionSelect
            value={streamRegion}
            placeholder="Pick the region your screen share should go through"
            automaticLabel="Same region as your call"
            onChange={region => settings.store.streamRegion = region}
        />
    );
}

function AboutPlugin() {
    return (
        <Paragraph>
            Made by bezumiya. Source and issues on <MaskedLink href="https://github.com/bezumiya/GoLiveBypass">GitHub</MaskedLink>, and I post about it on <MaskedLink href="https://twitter.com/obezumiya">Twitter</MaskedLink>.
        </Paragraph>
    );
}

const settings = definePluginSettings({
    voiceRegion: {
        type: OptionType.COMPONENT,
        component: VoiceRegionPicker,
        default: AUTOMATIC
    },
    streamRegion: {
        type: OptionType.COMPONENT,
        component: StreamRegionPicker,
        default: AUTOMATIC
    },
    proxy: {
        type: OptionType.STRING,
        description: "Proxy used only while your session is being created, like socks5://127.0.0.1:9050 for Tor. Leave empty and your session is created through a free proxy picked and tested for you, which means a stranger carries your login.",
        default: "",
        isValid: (value: string) => value.trim() === "" || /^(socks5|https?):\/\/[a-z0-9.-]{1,253}:\d{1,5}$/.test(value.trim())
            || "Use socks5://host:porta, http://host:porta ou https://host:porta."
    },
    excludedCountries: {
        type: OptionType.STRING,
        description: "Two letter country codes, comma separated, whose proxies are never used. The real exit address is checked, not the one the list claims.",
        default: "BR"
    }
});

function forcedRegion() {
    const region = settings.store.voiceRegion;
    if (typeof region !== "string") return null;

    const trimmed = region.trim();
    return trimmed === AUTOMATIC ? null : trimmed;
}

function forceRegion() {
    if (original !== undefined) return;

    const store = RTCRegionStore;
    if (typeof store.getPreferredRegion !== "function"
        || typeof store.getPreferredRegions !== "function"
        || typeof store.shouldIncludePreferredRegion !== "function") {
        showToast("GoLiveBypass could not find Discord's region picker, so your call region is untouched.", Toasts.Type.FAILURE);
        return;
    }

    const saved: RegionStore = {
        getPreferredRegion: store.getPreferredRegion,
        getPreferredRegions: store.getPreferredRegions,
        shouldIncludePreferredRegion: store.shouldIncludePreferredRegion
    };

    store.getPreferredRegion = function () {
        return forcedRegion() ?? saved.getPreferredRegion.call(this);
    };

    store.getPreferredRegions = function () {
        const forced = forcedRegion();
        const ranked = saved.getPreferredRegions.call(this);
        return forced === null ? ranked : [forced, ...(ranked ?? []).filter(region => region !== forced)];
    };

    store.shouldIncludePreferredRegion = function () {
        return forcedRegion() !== null || saved.shouldIncludePreferredRegion.call(this);
    };

    original = saved;
}

function restoreRegion() {
    if (original === undefined) return;

    RTCRegionStore.getPreferredRegion = original.getPreferredRegion;
    RTCRegionStore.getPreferredRegions = original.getPreferredRegions;
    RTCRegionStore.shouldIncludePreferredRegion = original.shouldIncludePreferredRegion;
    original = undefined;
}

async function startBypass() {
    if (!Native || bypassRequested) return;
    bypassRequested = true;
    showToast("GoLiveBypass is looking for a proxy. Wait for the next toast before you log in.");

    try {
        const result = await Native.enable(settings.store.excludedCountries);
        if (result.success) {
            showToast(`GoLiveBypass is creating your session through ${result.proxy}.`);
            return;
        }

        bypassRequested = false;
        showToast(`GoLiveBypass could not start. ${result.error}`, Toasts.Type.FAILURE);
    } catch (error) {
        bypassRequested = false;
        logger.error("Failed to reach the desktop process", error);
    }
}

function videoIsBlocked() {
    const store = MediaEngineStore;
    return typeof store.supportsInApp === "function" && !store.supportsInApp("VIDEO");
}

async function releaseProxy() {
    let wasProxied = false;

    if (Native) {
        try {
            wasProxied = await Native.getActiveProxy() !== null;
            if (wasProxied) await Native.disable();
            bypassRequested = false;
        } catch (error) {
            logger.error("Failed to reach the desktop process", error);
        }
    }

    if (!wasProxied) return;

    showToast(videoIsBlocked()
        ? "Discord still has Go Live blocked on this session. Close Discord from the tray and open it again."
        : "Go Live is unlocked on this session. Only the gateway stays on the proxy, everything else is direct now.",
    videoIsBlocked() ? Toasts.Type.FAILURE : Toasts.Type.SUCCESS);
}

export default definePlugin({
    name: "GoLiveBypass",
    description: "Turns Go Live and camera back on for Brazilian accounts by neutralising Discord's video guard, and keeps your calls on the region you pick.",
    authors: [{ name: "bezumiya", id: 1366453661970071633n }],
    tags: ["Voice", "Privacy"],
    settings,
    settingsAboutComponent: AboutPlugin,

    patches: [
        {
            find: "\"2026-08-video-guard\"",
            replacement: {
                match: /(?<=name:"2026-08-video-guard".{0,100}?)variations:\{.{0,120}?\}\}(?=\}\))/,
                replace: "variations:{}"
            }
        },
        {
            find: ".STREAM_CREATE,{type:",
            replacement: {
                match: /(?<=\.STREAM_CREATE,\{.{0,80}?preferred_region:)\i/,
                replace: "$self.pickStreamRegion($&)"
            }
        }
    ],

    pickStreamRegion(fallback: string | null) {
        const region = settings.store.streamRegion;
        return typeof region === "string" && region !== AUTOMATIC ? region : fallback;
    },

    flux: {
        CONNECTION_OPEN() {
            releaseProxy();
        },

        LOGOUT() {
            startBypass();
        }
    },

    start() {
        forceRegion();
    },

    stop() {
        restoreRegion();
        releaseProxy();
    }
});
