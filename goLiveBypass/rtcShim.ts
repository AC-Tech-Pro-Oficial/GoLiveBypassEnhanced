// @ts-nocheck
/*
 * Enhanced native RTC shim shared with the Vencord/Equicord distribution.
 *
 * This is deliberately self-contained because Electron serializes the function
 * into an isolated-world session preload. Keep IDs/source args inside the
 * closure; only sanitized summaries/actions cross back to the main process.
 */

export function installEnhancedRtcShim() {
    if (window.__goliveVoiceShim) return;

    var state = {
        installed: false,
        voiceHooked: false,
        instanceId: Date.now(),
        nextId: 1,
        connections: [],
        seen: new WeakMap(),
        modules: new WeakSet(),
        retry: 0,
    };
    window.__goliveVoiceShim = state;

    function safeKey(key) {
        key = String(key);
        if (/^[0-9]{10,}$/.test(key)) return '<numeric>';
        if (/^[A-Za-z_$][A-Za-z0-9_$-]{0,63}$/.test(key)) return key;
        return '<dynamic>';
    }

    function shape(value, depth, seen) {
        if (value === null) return 'null';
        if (value === undefined) return 'undefined';
        if (depth > 4) return typeof value;
        if (Array.isArray(value)) return { type: 'array', length: value.length };
        if (typeof value !== 'object') return typeof value;
        if (seen.has(value)) return 'circular';
        seen.add(value);
        var out = {};
        var keys;
        try { keys = Object.keys(value).slice(0, 160); } catch (e) { return 'inacessivel'; }
        for (var i = 0; i < keys.length; i++) {
            var key = keys[i];
            var cleanKey = safeKey(key);
            var child;
            try { child = value[key]; } catch (e) { out[cleanKey] = 'getter-error'; continue; }
            out[cleanKey] = shape(child, depth + 1, seen);
        }
        return out;
    }

    function finite(value) {
        return typeof value === 'number' && Number.isFinite(value) ? value : null;
    }

    // O discord_voice 0.0.84 manteve getStats no wrapper JS, mas removeu o
    // metodo correspondente do objeto nativo. A API viva e
    // getFilteredStats(2, callback): o filtro 2 devolve outbound + screenshare.
    // Normalizamos so campos confirmados; nenhuma string/SSRC sai do preload.
    function normalizeStats(raw) {
        var parsed = raw;
        try {
            if (typeof parsed === 'string') parsed = JSON.parse(parsed);
        } catch (e) {
            return { ok: false, reason: 'json', shape: 'string' };
        }
        if (!parsed || typeof parsed !== 'object') {
            return { ok: false, reason: 'formato', shape: shape(parsed, 0, new WeakSet()) };
        }

        var outbound = parsed.outbound;
        var video = outbound && outbound.video;
        if ((!video || typeof video !== 'object') && outbound && Array.isArray(outbound.videos)) {
            for (var vi = 0; vi < outbound.videos.length; vi++) {
                var candidate = outbound.videos[vi];
                if (!candidate || typeof candidate !== 'object') continue;
                if (!video || (finite(candidate.framesEncoded) || 0) > (finite(video.framesEncoded) || 0)) video = candidate;
            }
        }

        var screenshare = parsed.screenshare;
        var captureFrames = null;
        if (screenshare && typeof screenshare === 'object') {
            var captureTotal = 0;
            var captureFound = false;
            var captureKeys;
            try { captureKeys = Object.keys(screenshare); } catch (e) { captureKeys = []; }
            for (var ci = 0; ci < captureKeys.length; ci++) {
                var captureKey = captureKeys[ci];
                if (!/frames$/i.test(captureKey) || /(drop|fail|encode|sent|receive)/i.test(captureKey)) continue;
                var captureValue = finite(screenshare[captureKey]);
                if (captureValue === null) continue;
                captureTotal += captureValue;
                captureFound = true;
            }
            if (captureFound) captureFrames = captureTotal;
        }

        var inputFrameRate = video && typeof video === 'object' ? finite(video.inputFrameRate) : null;
        var framesEncoded = video && typeof video === 'object' ? finite(video.framesEncoded) : null;
        var encodeFrameRate = video && typeof video === 'object' ? finite(video.encodeFrameRate) : null;
        var broadcasterReady = (captureFrames !== null || inputFrameRate !== null) &&
            framesEncoded !== null && encodeFrameRate !== null;

        function decoderNode(value, depth) {
            if (!value || typeof value !== 'object' || depth > 5) return null;
            var decoded = finite(value.framesDecoded);
            var rate = finite(value.decodeFrameRate);
            if (rate === null) rate = finite(value.decodedFrameRate);
            if (rate === null) rate = finite(value.decodeFps);
            if (rate === null) rate = finite(value.framesPerSecond);
            var received = finite(value.framesReceived);
            if (decoded !== null || rate !== null) {
                return {
                    framesDecoded: decoded,
                    decodeFrameRate: rate,
                    framesReceived: received,
                };
            }
            var keys;
            try { keys = Object.keys(value).slice(0, 120); } catch (e) { return null; }
            for (var di = 0; di < keys.length; di++) {
                var key = keys[di];
                if (depth > 1 && !/(inbound|video|receiver|decode|remote|rtp)/i.test(key)) continue;
                var child;
                try { child = value[key]; } catch (e) { continue; }
                if (Array.isArray(child)) {
                    for (var ai = 0; ai < child.length; ai++) {
                        var fromArray = decoderNode(child[ai], depth + 1);
                        if (fromArray) return fromArray;
                    }
                } else {
                    var nested = decoderNode(child, depth + 1);
                    if (nested) return nested;
                }
            }
            return null;
        }

        var decodedVideo = decoderNode(parsed.inbound || parsed, 0);
        var framesDecoded = decodedVideo ? decodedVideo.framesDecoded : null;
        var decodeFrameRate = decodedVideo ? decodedVideo.decodeFrameRate : null;
        var framesReceived = decodedVideo ? decodedVideo.framesReceived : null;
        var viewerReady = framesDecoded !== null && decodeFrameRate !== null;

        if (!broadcasterReady && !viewerReady) {
            return { ok: false, reason: 'campos', shape: shape(parsed, 0, new WeakSet()) };
        }
        return {
            ok: true,
            broadcasterReady: broadcasterReady,
            viewerReady: viewerReady,
            captureFrames: captureFrames,
            inputFrameRate: inputFrameRate,
            framesEncoded: framesEncoded,
            encodeFrameRate: encodeFrameRate,
            mediaBitrate: video && typeof video === 'object' ? finite(video.mediaBitrate) : null,
            targetMediaBitrate: video && typeof video === 'object' ? finite(video.targetMediaBitrate) : null,
            width: video && Array.isArray(video.substreams) && video.substreams[0] ? finite(video.substreams[0].width) : null,
            height: video && Array.isArray(video.substreams) && video.substreams[0] ? finite(video.substreams[0].height) : null,
            suspended: !!(video && video.suspended === true),
            framesDecoded: framesDecoded,
            decodeFrameRate: decodeFrameRate,
            framesReceived: framesReceived,
            videoExpected: viewerReady,
        };
    }

    function connectionRoleHint(rec) {
        if (!rec || !rec.conn || rec.kind !== 'stream') return 'unknown';
        if (rec.sourceReplay) return 'broadcaster';
        try { if (typeof rec.conn.hasDesktopSource === 'function' && rec.conn.hasDesktopSource() === true) return 'broadcaster'; } catch (e) { }
        try {
            var local = rec.localUser;
            var remote = rec.streamUser;
            if (typeof remote === 'string' && remote.length > 0 && typeof local === 'string' && local.length > 0) {
                return remote === local ? 'broadcaster' : 'viewer';
            }
        } catch (e) { }
        return 'unknown';
    }

    function updateProgress(rec, stats) {
        var now = Date.now();
        var role = connectionRoleHint(rec);
        if (role === 'unknown') {
            if (stats.broadcasterReady && !stats.viewerReady) role = 'broadcaster';
            else if (stats.viewerReady && !stats.broadcasterReady) role = 'viewer';
        }
        rec.lastRole = role;
        if (!rec.progress) {
            rec.progress = {
                inputValue: stats.captureFrames,
                outputValue: stats.framesEncoded,
                decodedValue: stats.framesDecoded,
                inputAt: now,
                outputAt: now,
                decodedAt: now,
            };
        } else {
            if ((stats.captureFrames !== null && stats.captureFrames !== rec.progress.inputValue) ||
                (stats.inputFrameRate !== null && stats.inputFrameRate > 0)) rec.progress.inputAt = now;
            if ((stats.framesEncoded !== null && stats.framesEncoded !== rec.progress.outputValue) ||
                (stats.encodeFrameRate !== null && stats.encodeFrameRate > 0)) rec.progress.outputAt = now;
            if ((stats.framesDecoded !== null && stats.framesDecoded !== rec.progress.decodedValue) ||
                (stats.decodeFrameRate !== null && stats.decodeFrameRate > 0)) rec.progress.decodedAt = now;
            rec.progress.inputValue = stats.captureFrames;
            rec.progress.outputValue = stats.framesEncoded;
            rec.progress.decodedValue = stats.framesDecoded;
        }
        var relevantOk = role === 'broadcaster' ? stats.broadcasterReady :
            (role === 'viewer' ? stats.viewerReady : false);
        return {
            statsOk: relevantOk,
            role: role,
            captureFrames: stats.captureFrames,
            framesEncoded: stats.framesEncoded,
            inputFrameRate: stats.inputFrameRate,
            encodeFrameRate: stats.encodeFrameRate,
            mediaBitrate: stats.mediaBitrate,
            targetMediaBitrate: stats.targetMediaBitrate,
            width: stats.width,
            height: stats.height,
            suspended: stats.suspended,
            entradaHa: role === 'broadcaster' ? now - rec.progress.inputAt : -1,
            saidaHa: role === 'broadcaster' ? now - rec.progress.outputAt : -1,
            framesDecoded: stats.framesDecoded,
            decodeFrameRate: stats.decodeFrameRate,
            framesReceived: stats.framesReceived,
            decodeHa: role === 'viewer' ? now - rec.progress.decodedAt : -1,
            videoExpected: role === 'viewer' ? stats.videoExpected === true && !rec.localVideoDisabled : false,
            sampleHa: 0,
        };
    }

    function registerConnection(kind, creator, options, conn, localUser) {
        if (!conn || (typeof conn !== 'object' && typeof conn !== 'function')) return conn;
        // Viewer streams use createVoiceConnectionWithOptions in current Discord.
        // The options context is authoritative; the returned native wrapper does
        // not expose userId/streamUserId properties.
        if (options && options.context === 'stream') kind = 'stream';
        else if (options && options.context === 'default') kind = 'voice';
        var existing = state.seen.get(conn);
        if (existing) {
            if (kind === 'stream') existing.kind = 'stream';
            if (typeof localUser === 'string') existing.localUser = localUser;
            if (options && typeof options.streamUserId === 'string') existing.streamUser = options.streamUserId;
            return conn;
        }
        var rec = {
            id: state.nextId++,
            kind: kind,
            creator: creator,
            createdAt: Date.now(),
            destroyedAt: 0,
            optionShape: shape(options, 0, new WeakSet()),
            conn: conn,
            localUser: typeof localUser === 'string' ? localUser : conn.userId,
            streamUser: options && typeof options.streamUserId === 'string' ? options.streamUserId : conn.streamUserId,
            localVideoDisabled: false,
            localVideoRevision: 0,
            sourceReplay: null,
            sourceAt: 0,
            replayingSource: false,
            recoveryClearingSource: false,
            lastRole: 'unknown',
        };
        state.seen.set(conn, rec);
        state.connections.push(rec);
        if (state.connections.length > 24) state.connections.shift();
        try {
            if (typeof conn.destroy === 'function') {
                var originalDestroy = conn.destroy;
                conn.destroy = function () {
                    rec.destroyedAt = Date.now();
                    rec.sourceReplay = null;
                    rec.sourceAt = 0;
                    return originalDestroy.apply(this, arguments);
                };
            }
        } catch (e) { }

        if (kind === 'stream') {
            // Discord forwards effective remote viewer demand through this native
            // method. Renderer console messages live in a different JS world.
            // Read only the numeric pixel count; never retain transport options.
            rec.keyframeRepair = false;
            rec.keyframeBaseline = null;
            rec.alwaysSendBaseline = null;
            rec.restoreKeyframeRepair = function () {
                if (!rec.keyframeRepair) return;
                originalTransport.call(conn, { keyframeInterval: rec.keyframeBaseline, alwaysSendVideo: rec.alwaysSendBaseline });
                rec.keyframeRepair = false;
            };
            rec.demandKnown = false;
            rec.demandActive = false;
            rec.demandAt = 0;
            rec.demandChangedAt = 0;
            try {
                var originalTransport = conn.setTransportOptions;
                if (typeof originalTransport === 'function') {
                    conn.setTransportOptions = function (options) {
                        var effective = options;
                        if (options && typeof options === 'object') {
                            if (finite(options.keyframeInterval) !== null) rec.keyframeBaseline = options.keyframeInterval;
                            if (typeof options.alwaysSendVideo === 'boolean') rec.alwaysSendBaseline = options.alwaysSendVideo;
                            if (rec.keyframeRepair) effective = Object.assign({}, options, { keyframeInterval: 1000, alwaysSendVideo: true });
                        }
                        var forwarded = Array.prototype.slice.call(arguments);
                        forwarded[0] = effective;
                        var result = originalTransport.apply(this, forwarded);
                        var pixels = options && finite(options.remoteSinkWantsPixelCount);
                        if (pixels !== null && pixels !== undefined && pixels >= 0) {
                            var now = Date.now();
                            var active = pixels > 0;
                            if (!rec.demandKnown || rec.demandActive !== active) rec.demandChangedAt = now;
                            rec.demandKnown = true;
                            rec.demandActive = active;
                            if (active) rec.demandAt = now;
                        }
                        return result;
                    };
                }
            } catch (e) { }
            try {
                var originalDisable = conn.setDisableLocalVideo;
                if (typeof originalDisable === 'function') {
                    conn.setDisableLocalVideo = function (userId, disabled) {
                        if (userId === rec.streamUser) {
                            rec.localVideoDisabled = disabled === true;
                            rec.localVideoRevision++;
                        }
                        return originalDisable.apply(this, arguments);
                    };
                }
            } catch (e) { }
            ['setDesktopSource', 'setDesktopSourceWithOptions'].forEach(function (name) {
                try {
                    var original = conn[name];
                    if (typeof original !== 'function') return;
                    conn[name] = function () {
                        if (!rec.replayingSource) {
                            rec.restoreKeyframeRepair();
                            rec.sourceReplay = { name: name, args: Array.prototype.slice.call(arguments) };
                            rec.sourceAt = Date.now();
                        }
                        return original.apply(this, arguments);
                    };
                } catch (e) { }
            });
            try {
                var originalClear = conn.clearDesktopSource;
                if (typeof originalClear === 'function') {
                    conn.clearDesktopSource = function () {
                        if (!rec.recoveryClearingSource) {
                            rec.restoreKeyframeRepair();
                            rec.sourceReplay = null;
                            rec.sourceAt = 0;
                        }
                        return originalClear.apply(this, arguments);
                    };
                }
            } catch (e) { }
        }
        return conn;
    }

    function hookVoice(voice) {
        if (!voice || (typeof voice !== 'object' && typeof voice !== 'function')) return voice;
        if (state.modules.has(voice)) return voice;
        state.modules.add(voice);
        var creators = [
            ['createVoiceConnectionWithOptions', 'voice'],
            ['createOwnStreamConnectionWithOptions', 'stream'],
        ];
        for (var i = 0; i < creators.length; i++) {
            (function (name, kind) {
                var original;
                try { original = voice[name]; } catch (e) { return; }
                if (typeof original !== 'function') return;
                voice[name] = function () {
                    state.pendingKind = kind;
                    var conn;
                    try { conn = original.apply(this, arguments); }
                    finally { state.pendingKind = null; }
                    return registerConnection(kind, name, arguments[1], conn, arguments[0]);
                };
            })(creators[i][0], creators[i][1]);
        }
        // Backup para clientes que guardaram a referencia do factory antes do
        // nosso hook: o factory do index.js consulta VoiceEngine.VoiceConnection
        // dinamicamente ao criar uma conexao nova. Quando a chamada veio por um
        // factory ja envolvido, pendingKind evita registrar o objeto nativo e o
        // wrapper publico duas vezes; o retorno publico e registrado logo acima.
        try {
            var OriginalVoiceConnection = voice.VoiceConnection;
            if (typeof OriginalVoiceConnection === 'function') {
                function GoliveVoiceConnection() {
                    var args = Array.prototype.slice.call(arguments);
                    var instance = Reflect.construct(OriginalVoiceConnection, args, OriginalVoiceConnection);
                    if (!state.pendingKind) registerConnection('unknown', 'VoiceConnection', args[1], instance, args[0]);
                    return instance;
                }
                Object.setPrototypeOf(GoliveVoiceConnection, OriginalVoiceConnection);
                GoliveVoiceConnection.prototype = OriginalVoiceConnection.prototype;
                voice.VoiceConnection = GoliveVoiceConnection;
            }
        } catch (e) { }
        state.voiceHooked = true;
        return voice;
    }

    function installNativeHook() {
        if (state.installed) return;
        var nativeModules;
        try { nativeModules = window.DiscordNative && window.DiscordNative.nativeModules; } catch (e) { }
        if (!nativeModules || typeof nativeModules.requireModule !== 'function') {
            if (state.retry++ < 200) setTimeout(installNativeHook, 25);
            return;
        }
        try {
            var originalRequire = nativeModules.requireModule;
            nativeModules.requireModule = function () {
                var loaded = originalRequire.apply(this, arguments);
                if (arguments[0] === 'discord_voice') return hookVoice(loaded);
                return loaded;
            };
            state.installed = true;
            // O preload original do Discord pode ter exigido o addon antes dos
            // preloads de sessao. Buscar o modulo aqui devolve a instancia em
            // cache e permite envolve-la antes de a interface criar a call.
            try { hookVoice(originalRequire.call(nativeModules, 'discord_voice')); } catch (e) { }
        } catch (e) {
            state.installed = false;
        }
    }

    function sample(rec) {
        return new Promise(function (resolve) {
            if (rec.destroyedAt > 0 || !rec.conn) return resolve({ statsOk: false, reason: 'destruida' });
            if (rec.kind !== 'stream') return resolve({ statsOk: false, reason: 'tipo' });
            if (typeof rec.conn.getFilteredStats !== 'function') {
                return resolve({ statsOk: false, reason: 'sem-metodo' });
            }
            var hint = connectionRoleHint(rec);
            // Native bitmask: TRANSPORT=1, OUTBOUND=2, INBOUND=4, ALL=7.
            var filters = hint === 'viewer' ? [4] : (hint === 'broadcaster' ? [2] : [7]);
            var done = false;
            var lastFailure = { statsOk: false, reason: 'campos' };

            function finish(value) {
                if (done) return;
                done = true;
                resolve(value);
            }

            function attempt(index) {
                if (done) return;
                if (index >= filters.length) return finish(lastFailure);
                var settled = false;
                var timer = setTimeout(function () {
                    if (settled || done) return;
                    settled = true;
                    attempt(index + 1);
                }, 800);
                function receive(raw) {
                    if (settled || done) return;
                    settled = true;
                    clearTimeout(timer);
                    var normalized = normalizeStats(raw);
                    if (normalized.ok) return finish(updateProgress(rec, normalized));
                    lastFailure = { statsOk: false, reason: normalized.reason, statsShape: normalized.shape };
                    attempt(index + 1);
                }
                try {
                    var returned = rec.conn.getFilteredStats(filters[index], function (raw) { receive(raw); });
                    if (returned && typeof returned.then === 'function') returned.then(receive, function () { attempt(index + 1); });
                } catch (e) {
                    clearTimeout(timer);
                    settled = true;
                    attempt(index + 1);
                }
            }
            attempt(0);
        });
    }

    window.__goliveVoiceDemandaResumo = function () {
        var now = Date.now();
        var rec = null;
        for (var i = state.connections.length - 1; i >= 0; i--) {
            var candidate = state.connections[i];
            if (candidate.kind === 'stream' && !candidate.destroyedAt) { rec = candidate; break; }
        }
        return {
            known: !!(rec && rec.demandKnown),
            active: !!(rec && rec.demandActive),
            demandHa: rec && rec.demandAt > 0 ? now - rec.demandAt : -1,
            changedHa: rec && rec.demandChangedAt > 0 ? now - rec.demandChangedAt : -1,
        };
    };

    window.__goliveVoiceResumo = function () {
        var now = Date.now();
        return Promise.all(state.connections.map(function (rec) {
            return sample(rec).then(function (sampled) {
                return {
                    id: rec.id,
                    kind: rec.kind,
                    creator: rec.creator,
                    createdHa: now - rec.createdAt,
                    destroyed: rec.destroyedAt > 0,
                    optionShape: rec.optionShape,
                    roleHint: connectionRoleHint(rec),
                    sourceCached: !!rec.sourceReplay,
                    sourceHa: rec.sourceReplay && rec.sourceAt > 0 ? now - rec.sourceAt : -1,
                    stats: sampled,
                };
            });
        })).then(function (connections) {
            return {
                installed: state.installed,
                voiceHooked: state.voiceHooked,
                instanceId: state.instanceId,
                demandKnown: window.__goliveVoiceDemandaResumo().known,
                demandActive: window.__goliveVoiceDemandaResumo().active,
                demandHa: window.__goliveVoiceDemandaResumo().demandHa,
                connections: connections,
            };
        });
    };

    // A decisao e feita no main. O preload executa apenas a acao segura
    // correspondente ao papel sanitizado da stream; IDs e argumentos ficam no closure.
    window.__goliveVoiceRecuperar = function (level, expectedInstanceId, expectedConnectionId) {
        if (level !== 1 && level !== 2) return { ok: false, level: 0, role: 'unknown', action: 'invalid-level' };
        var latestStream = null;
        for (var i = state.connections.length - 1; i >= 0; i--) {
            var rec = state.connections[i];
            if (!rec || rec.destroyedAt || !rec.conn || rec.kind !== 'stream') continue;
            latestStream = rec;
            break;
        }
        if (!latestStream) return { ok: false, level: level, role: 'unknown', action: 'no-stream' };
        if (String(state.instanceId) !== String(expectedInstanceId) ||
            String(latestStream.id) !== String(expectedConnectionId)) {
            return { ok: false, level: level, role: 'unknown', action: 'stale-generation' };
        }
        var role = latestStream.lastRole || connectionRoleHint(latestStream);
        if (role === 'unknown') role = connectionRoleHint(latestStream);

        if (role === 'broadcaster') {
            var replay = latestStream.sourceReplay;
            if (!replay || typeof latestStream.conn[replay.name] !== 'function') {
                return { ok: false, level: level, role: role, action: 'source-unavailable' };
            }
            if (level === 1) {
                try {
                    latestStream.replayingSource = true;
                    latestStream.conn[replay.name].apply(latestStream.conn, replay.args);
                    // Capture can remain live while native simulcast is inactive.
                    // A one-second keyframe interval plus alwaysSendVideo restarted
                    // encoding in the live A/B test; codecs and gateway stay intact.
                    // Only override known transport state, and only for this source.
                    if (latestStream.keyframeBaseline !== null && latestStream.alwaysSendBaseline !== null &&
                        typeof latestStream.conn.setTransportOptions === 'function') {
                        latestStream.keyframeRepair = true;
                        latestStream.conn.setTransportOptions({});
                        return { ok: true, level: level, role: role, action: 'desktop-source-keyframe-rearm' };
                    }
                    return { ok: true, level: level, role: role, action: 'desktop-source-reapply' };
                } catch (e) {
                    return { ok: false, level: level, role: role, action: 'desktop-source-reapply-failed' };
                } finally {
                    latestStream.replayingSource = false;
                }
            }
            if (typeof latestStream.conn.clearDesktopSource !== 'function') {
                return { ok: false, level: level, role: role, action: 'source-clear-unavailable' };
            }
            try {
                latestStream.recoveryClearingSource = true;
                latestStream.conn.clearDesktopSource();
            } catch (e) {
                latestStream.recoveryClearingSource = false;
                return { ok: false, level: level, role: role, action: 'desktop-source-clear-failed' };
            }
            latestStream.recoveryClearingSource = false;
            setTimeout(function () {
                if (latestStream.destroyedAt || latestStream.sourceReplay !== replay) return;
                try {
                    latestStream.replayingSource = true;
                    latestStream.conn[replay.name].apply(latestStream.conn, replay.args);
                } catch (e) { }
                finally { latestStream.replayingSource = false; }
            }, 200);
            return { ok: true, level: level, role: role, action: 'desktop-source-clear-reapply' };
        }

        if (role === 'viewer') {
            if (level === 1) {
                try {
                    if (typeof latestStream.conn.fastUdpReconnect !== 'function') {
                        return { ok: false, level: level, role: role, action: 'fast-udp-unavailable' };
                    }
                    latestStream.conn.fastUdpReconnect();
                    return { ok: true, level: level, role: role, action: 'viewer-fast-udp-reconnect' };
                } catch (e) {
                    return { ok: false, level: level, role: role, action: 'viewer-fast-udp-failed' };
                }
            }
            var remoteUser = latestStream.streamUser;
            if (typeof remoteUser !== 'string' || remoteUser.length === 0 ||
                typeof latestStream.conn.setDisableLocalVideo !== 'function') {
                return { ok: false, level: level, role: role, action: 'viewer-resubscribe-unavailable' };
            }
            try {
                latestStream.conn.setDisableLocalVideo(remoteUser, true);
                var videoRevision = latestStream.localVideoRevision;
                if (typeof latestStream.conn.fastUdpReconnect === 'function') latestStream.conn.fastUdpReconnect();
                setTimeout(function () {
                    if (latestStream.destroyedAt || latestStream.localVideoRevision !== videoRevision) return;
                    try { latestStream.conn.setDisableLocalVideo(remoteUser, false); } catch (e) { }
                }, 200);
                return { ok: true, level: level, role: role, action: 'viewer-video-resubscribe' };
            } catch (e) {
                return { ok: false, level: level, role: role, action: 'viewer-resubscribe-failed' };
            }
        }
        return { ok: false, level: level, role: role, action: 'unknown-role' };
    };

    installNativeHook();
}

export const RTC_SHIM_SOURCE = "(" + installEnhancedRtcShim.toString() + ")();";
