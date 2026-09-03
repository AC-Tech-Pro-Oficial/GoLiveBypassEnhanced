#!/usr/bin/env python3
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "standalone" / "golivebypass.js"
LEGACY_TEST = ROOT / "tests" / "test-native-rtc-recovery.cjs"
CHANGELOG = ROOT / "CHANGELOG.md"


def sub_once(text: str, pattern: str, replacement: str, label: str) -> str:
    out, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f"patch anchor failed for {label}: expected 1 match, got {count}")
    return out


src = SOURCE.read_text(encoding="utf-8")

voice_core = r'''    function normalizeStats(raw) {
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
            var local = rec.conn.userId;
            var remote = rec.conn.streamUserId;
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
            videoExpected: role === 'viewer' ? stats.videoExpected === true : false,
            sampleHa: 0,
        };
    }

    function registerConnection(kind, creator, options, conn) {
        if (!conn || (typeof conn !== 'object' && typeof conn !== 'function')) return conn;
        var existing = state.seen.get(conn);
        if (existing) {
            if (kind === 'stream') existing.kind = 'stream';
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
            sourceReplay: null,
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
                    return originalDestroy.apply(this, arguments);
                };
            }
        } catch (e) { }

        if (kind === 'stream') {
            ['setDesktopSource', 'setDesktopSourceWithOptions'].forEach(function (name) {
                try {
                    var original = conn[name];
                    if (typeof original !== 'function') return;
                    conn[name] = function () {
                        if (!rec.replayingSource) {
                            rec.sourceReplay = { name: name, args: Array.prototype.slice.call(arguments) };
                        }
                        return original.apply(this, arguments);
                    };
                } catch (e) { }
            });
            try {
                var originalClear = conn.clearDesktopSource;
                if (typeof originalClear === 'function') {
                    conn.clearDesktopSource = function () {
                        if (!rec.recoveryClearingSource) rec.sourceReplay = null;
                        return originalClear.apply(this, arguments);
                    };
                }
            } catch (e) { }
        }
        return conn;
    }

'''

src = sub_once(
    src,
    r"    function normalizeStats\(raw\) \{[\s\S]*?\n    function hookVoice\(voice\) \{",
    voice_core + "    function hookVoice(voice) {",
    "voice normalize/progress/registry",
)

sample_impl = r'''    function sample(rec) {
        return new Promise(function (resolve) {
            if (rec.destroyedAt > 0 || !rec.conn) return resolve({ statsOk: false, reason: 'destruida' });
            if (rec.kind !== 'stream') return resolve({ statsOk: false, reason: 'tipo' });
            if (typeof rec.conn.getFilteredStats !== 'function') {
                return resolve({ statsOk: false, reason: 'sem-metodo' });
            }
            var hint = connectionRoleHint(rec);
            var filters = hint === 'viewer' ? [1, 0, 2] : (hint === 'broadcaster' ? [2] : [2, 1, 0]);
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

'''

src = sub_once(
    src,
    r"    function sample\(rec\) \{[\s\S]*?\n    window\.__goliveVoiceDemandaResumo = function \(\) \{",
    sample_impl + "    window.__goliveVoiceDemandaResumo = function () {",
    "voice sampling",
)

recovery_impl = r'''    // A decisao e feita no main. O preload executa apenas a acao segura
    // correspondente ao papel sanitizado da stream; IDs e argumentos ficam no closure.
    window.__goliveVoiceRecuperar = function (level) {
        if (level !== 1 && level !== 2) return { ok: false, level: 0, role: 'unknown', action: 'invalid-level' };
        var latestStream = null;
        for (var i = state.connections.length - 1; i >= 0; i--) {
            var rec = state.connections[i];
            if (!rec || rec.destroyedAt || !rec.conn || rec.kind !== 'stream') continue;
            latestStream = rec;
            break;
        }
        if (!latestStream) return { ok: false, level: level, role: 'unknown', action: 'no-stream' };
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
                if (latestStream.destroyedAt || !latestStream.sourceReplay) return;
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
            var remoteUser = null;
            try { remoteUser = latestStream.conn.streamUserId; } catch (e) { }
            if (typeof remoteUser !== 'string' || remoteUser.length === 0 ||
                typeof latestStream.conn.setLocalVideoDisabled !== 'function') {
                return { ok: false, level: level, role: role, action: 'viewer-resubscribe-unavailable' };
            }
            try {
                latestStream.conn.setLocalVideoDisabled(remoteUser, true);
                if (typeof latestStream.conn.fastUdpReconnect === 'function') latestStream.conn.fastUdpReconnect();
                setTimeout(function () {
                    if (latestStream.destroyedAt) return;
                    try { latestStream.conn.setLocalVideoDisabled(remoteUser, false); } catch (e) { }
                }, 200);
                return { ok: true, level: level, role: role, action: 'viewer-video-resubscribe' };
            } catch (e) {
                return { ok: false, level: level, role: role, action: 'viewer-resubscribe-failed' };
            }
        }
        return { ok: false, level: level, role: role, action: 'unknown-role' };
    };

'''

src = sub_once(
    src,
    r"    // A decisao e feita no main\.[\s\S]*?\n    installNativeHook\(\);",
    recovery_impl + "    installNativeHook();",
    "voice recovery",
)

constants_old = r'''const VOICE_STREAM_AQUECIMENTO_MS = 20_000;
const VOICE_DEMANDA_GRACA_MS = 15_000;
const VOICE_ENTRADA_VIVA_MS = 15_000;
const VOICE_SAIDA_PARADA_MS = 20_000;
const VOICE_SAMPLE_MAX_MS = 10_000;
const VOICE_SAIDA_SUCESSO_MS = 8_000;
const VOICE_SUCESSO_SUSTENTADO_MS = 10_000;
// No ensaio ao vivo, destroy(stream) iniciou uma reconstrução tardia: a stream
// sumiu na hora, voice/midia fecharam entre 25-50s e a nova stream codificou em
// ~80s. Aos 60s distinguimos "voz ainda presa" de "teardown ja em curso".
const VOICE_NIVEL1_ESPERA_MS = 60_000;
const VOICE_RECONSTRUCAO_GRACA_MS = 45_000;
const VOICE_NOVA_GERACAO_GRACA_MS = 30_000;
const VOICE_NIVEL2_ESPERA_MS = 45_000;'''
constants_new = r'''const VOICE_STREAM_AQUECIMENTO_MS = 20_000;
const VOICE_VIEWER_AQUECIMENTO_MS = 10_000;
const VOICE_VIEWER_PARADO_MS = 10_000;
const VOICE_DEMANDA_GRACA_MS = 15_000;
const VOICE_ENTRADA_VIVA_MS = 15_000;
const VOICE_SAIDA_PARADA_MS = 20_000;
const VOICE_SAMPLE_MAX_MS = 10_000;
const VOICE_SAIDA_SUCESSO_MS = 8_000;
const VOICE_SUCESSO_SUSTENTADO_MS = 10_000;
// Safe recovery preserves the native connection, so recovery windows now wait
// for media progress rather than for teardown/recreation side effects.
const VOICE_NIVEL1_ESPERA_MS = 20_000;
const VOICE_NIVEL2_ESPERA_MS = 30_000;'''
if constants_old not in src:
    raise SystemExit("patch anchor failed for voice constants")
src = src.replace(constants_old, constants_new, 1)

detector_impl = r'''// Role-aware, fail-closed native RTC detector. Broadcaster stalls are capture-live /
// encoder-dead; viewer stalls are established video with a decoder that never progresses.
function avaliarRtcNativo(ctx) {
    if (!ctx || !ctx.voice || ctx.voice.installed !== true || ctx.voice.voiceHooked !== true) return null;
    if (!ctx.midia || ctx.midia.midiaAberta !== true) return null;
    if (!ctx.demanda || ctx.demanda.known !== true || ctx.demanda.active !== true) return null;
    const stream = streamNativaAtiva(ctx.voice);
    if (!stream) return null;
    if (ctx.demanda.demandHa < 0 || ctx.demanda.demandHa > stream.createdHa + VOICE_DEMANDA_GRACA_MS) return null;
    const stats = stream.stats;
    if (!stats || stats.statsOk !== true) return null;
    if (stats.sampleHa < 0 || stats.sampleHa > VOICE_SAMPLE_MAX_MS) return null;
    const papel = stats.role ||
        ((typeof stats.framesEncoded === 'number' && typeof stats.encodeFrameRate === 'number') ? 'broadcaster' :
            ((typeof stats.framesDecoded === 'number' && typeof stats.decodeFrameRate === 'number') ? 'viewer' : 'unknown'));

    if (papel === 'broadcaster') {
        if (stream.createdHa < VOICE_STREAM_AQUECIMENTO_MS) return null;
        if (stats.entradaHa < 0 || stats.entradaHa > VOICE_ENTRADA_VIVA_MS) return null;
        if (!(typeof stats.captureFrames === 'number' || stats.inputFrameRate > 0)) return null;
        if (typeof stats.framesEncoded !== 'number' || typeof stats.encodeFrameRate !== 'number') return null;
        if (stats.saidaHa < VOICE_SAIDA_PARADA_MS) return null;
        return 'transmissor-video-parado';
    }

    if (papel === 'viewer') {
        if (stream.createdHa < VOICE_VIEWER_AQUECIMENTO_MS) return null;
        if (stats.videoExpected !== true) return null;
        if (typeof stats.framesDecoded !== 'number' || typeof stats.decodeFrameRate !== 'number') return null;
        if (stats.decodeFrameRate > 0) return null;
        if (stats.decodeHa < VOICE_VIEWER_PARADO_MS) return null;
        return 'viewer-video-parado';
    }
    return null;
}

function rtcNativoSaudavel(ctx, papelEsperado) {
    const stream = streamNativaAtiva(ctx && ctx.voice);
    if (!stream) return null;
    const stats = stream.stats;
    if (!ctx.demanda || ctx.demanda.known !== true || ctx.demanda.active !== true) return null;
    if (!ctx.midia || ctx.midia.midiaAberta !== true) return null;
    if (!stats || stats.statsOk !== true || stats.sampleHa > VOICE_SAMPLE_MAX_MS) return null;
    let papel = stats.role;
    if (papel !== 'broadcaster' && papel !== 'viewer') {
        papel = (typeof stats.framesEncoded === 'number' && typeof stats.encodeFrameRate === 'number') ? 'broadcaster' :
            ((typeof stats.framesDecoded === 'number' && typeof stats.decodeFrameRate === 'number') ? 'viewer' : 'unknown');
    }
    if (papelEsperado === 'broadcaster' || papelEsperado === 'viewer') {
        if (papel !== papelEsperado) return null;
    }
    if (papel === 'broadcaster') {
        if (stats.entradaHa < 0 || stats.entradaHa > VOICE_ENTRADA_VIVA_MS) return null;
        if (stats.saidaHa < 0 || stats.saidaHa > VOICE_SAIDA_SUCESSO_MS) return null;
        if (!(stats.encodeFrameRate > 0) || typeof stats.framesEncoded !== 'number') return null;
        return stream;
    }
    if (papel === 'viewer') {
        if (stats.videoExpected !== true) return null;
        if (stats.decodeHa < 0 || stats.decodeHa > VOICE_SAIDA_SUCESSO_MS) return null;
        if (!(stats.decodeFrameRate > 0) || typeof stats.framesDecoded !== 'number') return null;
        return stream;
    }
    return null;
}

'''

src = sub_once(
    src,
    r"// Funcao pura e fail-closed\.[\s\S]*?\nfunction executarVoiceIsolado\(win, code\) \{",
    detector_impl + "function executarVoiceIsolado(win, code) {",
    "main detector/health",
)

state_machine = r'''function iniciarRecuperacaoNativa(ctx, nivel, sinal) {
    const agora = Date.now();
    while (videoNativoTentativas.length > 0 && videoNativoTentativas[0] < agora - VOICE_JANELA_MS) {
        videoNativoTentativas.shift();
    }
    if (videoNativoTentativas.length >= VOICE_TENTATIVAS) {
        falharRecuperacaoNativa(ctx, 'teto_tentativas');
        return;
    }
    const stream = streamNativaAtiva(ctx.voice);
    const stats = stream && stream.stats;
    const papel = stats && stats.role ? stats.role : (sinal === 'viewer-video-parado' ? 'viewer' : 'broadcaster');
    if (!stream || (papel !== 'viewer' && papel !== 'broadcaster')) {
        falharRecuperacaoNativa(ctx, 'papel_indisponivel');
        return;
    }
    const geracao = geracaoNativa(ctx.voice, stream);
    videoNativoTentativas.push(agora);
    videoNativoUltimaAcaoEm = agora;
    const tentativa = { nivel, geracao, papel, sinal, inicioEm: agora, sucessoEm: 0, confirmada: false, action: '' };
    videoNativoPendente = tentativa;
    sessaoRevives++;
    log("gw.revive | rtc nativo: nivel=" + nivel + " papel=" + papel + " sinal=" + String(sinal || '?'));
    executarVoiceIsolado(ctx.win,
        'window.__goliveVoiceRecuperar ? window.__goliveVoiceRecuperar(' + nivel + ') : null')
        .then(resultado => {
            if (videoNativoPendente !== tentativa) return;
            if (!resultado || resultado.ok !== true || resultado.role !== papel) {
                falharRecuperacaoNativa(ctx, 'acao_nativa_indisponivel');
                return;
            }
            tentativa.confirmada = true;
            tentativa.action = String(resultado.action || 'desconhecida');
            log("gw.revive | rtc nativo: nivel=" + nivel + " papel=" + papel + " acao=" + tentativa.action);
        })
        .catch(error => {
            if (videoNativoPendente === tentativa) falharRecuperacaoNativa(ctx, 'mundo_isolado: ' + error.message);
        });
}

function acompanharRecuperacaoNativa(ctx) {
    const pendente = videoNativoPendente;
    if (!pendente) return false;
    const agora = Date.now();
    const streamSaudavel = rtcNativoSaudavel(ctx, pendente.papel);
    if (streamSaudavel) {
        if (pendente.sucessoEm === 0) pendente.sucessoEm = agora;
        if (agora - pendente.sucessoEm >= VOICE_SUCESSO_SUSTENTADO_MS) {
            log("gw.revive | rtc nativo: sucesso nivel=" + pendente.nivel + " papel=" + pendente.papel +
                " acao=" + (pendente.action || '?') + " por=" + Math.round((agora - pendente.sucessoEm) / 1000) + "s");
            videoNativoPendente = null;
            videoNativoBloqueadoGeracao = '';
            videoNativoBloqueadoEm = 0;
            hideVideoBanner(ctx.win);
        }
        return true;
    }
    pendente.sucessoEm = 0;

    if (ctx.demanda && ctx.demanda.known === true && ctx.demanda.active !== true && ctx.demanda.changedHa >= 15_000) {
        log("gw.revive | rtc nativo: tentativa cancelada, demanda terminou");
        videoNativoPendente = null;
        return true;
    }

    const prazo = pendente.nivel === 1 ? VOICE_NIVEL1_ESPERA_MS : VOICE_NIVEL2_ESPERA_MS;
    if (agora - pendente.inicioEm < prazo) return true;
    if (pendente.nivel === 1) {
        log("gw.revive | rtc nativo: nivel=1 nao retomou progresso; subindo ao nivel=2 papel=" + pendente.papel);
        const sinal = pendente.sinal;
        videoNativoPendente = null;
        iniciarRecuperacaoNativa(ctx, 2, sinal);
        return true;
    }
    falharRecuperacaoNativa(ctx, 'nivel2_sem_progresso');
    return true;
}

function processarRtcNativo(ctx) {
    const agora = Date.now();
    while (videoNativoTentativas.length > 0 && videoNativoTentativas[0] < agora - VOICE_JANELA_MS) {
        videoNativoTentativas.shift();
    }
    if (acompanharRecuperacaoNativa(ctx)) return;
    const stream = streamNativaAtiva(ctx.voice);
    if (videoNativoBloqueadoEm > 0 && (agora - videoNativoBloqueadoEm >= VOICE_JANELA_MS ||
        (stream && geracaoNativa(ctx.voice, stream) !== videoNativoBloqueadoGeracao))) {
        videoNativoBloqueadoGeracao = '';
        videoNativoBloqueadoEm = 0;
        hideVideoBanner(ctx.win);
    }
    const sinal = avaliarRtcNativo(ctx);
    if (sinal === null) return;
    if (stream && geracaoNativa(ctx.voice, stream) === videoNativoBloqueadoGeracao) return;
    if (!autoRevive) {
        falharRecuperacaoNativa(ctx, 'autoRevive_desligado');
        return;
    }
    if (videoNativoUltimaAcaoEm > 0 && agora - videoNativoUltimaAcaoEm < VOICE_ACAO_COOLDOWN_MS) return;
    iniciarRecuperacaoNativa(ctx, 1, sinal);
}

'''

src = sub_once(
    src,
    r"function iniciarRecuperacaoNativa\(ctx, nivel, geracaoAnterior\) \{[\s\S]*?\nfunction logRtcNativo\(ctx\) \{",
    state_machine + "function logRtcNativo(ctx) {",
    "main recovery state machine",
)

log_impl = r'''function logRtcNativo(ctx) {
    const agora = Date.now();
    const stream = streamNativaAtiva(ctx.voice);
    const stats = stream && stream.stats;
    const assinatura = [
        !!(ctx.voice && ctx.voice.voiceHooked), stream ? stream.id : 0,
        stats && stats.role ? stats.role : '?', !!(ctx.demanda && ctx.demanda.active),
        stats ? !!stats.statsOk : false, videoNativoPendente ? videoNativoPendente.nivel : 0,
    ].join(':');
    if (assinatura === voiceProbeUltimaAssinatura && agora - voiceProbeUltimoLogEm < VOICE_PROBE_LOG_MS) return;
    voiceProbeUltimaAssinatura = assinatura;
    voiceProbeUltimoLogEm = agora;
    log("voice.probe | hook=" + (ctx.voice && ctx.voice.voiceHooked ? "sim" : "nao") +
        " stream=" + (stream ? stream.id : "nenhuma") +
        " papel=" + (stats && stats.role ? stats.role : "?") +
        " demanda=" + (ctx.demanda && ctx.demanda.known ? (ctx.demanda.active ? "sim" : "nao") : "?") +
        " demanda_ha=" + idadeSeg(ctx.demanda ? ctx.demanda.demandHa : -1) +
        " entrada_ha=" + idadeSeg(stats ? stats.entradaHa : -1) +
        " saida_ha=" + idadeSeg(stats ? stats.saidaHa : -1) +
        " video=" + (stats && stats.videoExpected ? "sim" : "?") +
        " video_ha=" + idadeSeg(stats ? stats.decodeHa : -1) +
        " fps_in=" + (stats && typeof stats.inputFrameRate === 'number' ? Math.round(stats.inputFrameRate) : "?") +
        " fps_out=" + (stats && typeof stats.encodeFrameRate === 'number' ? Math.round(stats.encodeFrameRate) : "?") +
        " fps_dec=" + (stats && typeof stats.decodeFrameRate === 'number' ? Math.round(stats.decodeFrameRate) : "?") +
        " frames=" + (stats && typeof stats.framesEncoded === 'number' ? Math.round(stats.framesEncoded) : "?") +
        " dec=" + (stats && typeof stats.framesDecoded === 'number' ? Math.round(stats.framesDecoded) : "?") +
        " stats=" + (stats && stats.statsOk ? "ok" : (stats && stats.reason ? stats.reason : "?")));
}

'''

src = sub_once(
    src,
    r"function logRtcNativo\(ctx\) \{[\s\S]*?\nfunction checarRtcNativo\(\) \{",
    log_impl + "function checarRtcNativo() {",
    "native RTC log",
)

# Legacy comments still describe destructive behavior; make the local documentation match code.
src = src.replace(
    "// desktop usa discord_voice. Agora a primeira acao destroi somente a conexao\n// stream nativa; se ela nao renascer saudavel, o nivel 2 destroi tambem voice e\n// fecha os ws de midia. Nunca ha reload automatico.",
    "// desktop usa discord_voice. A recuperacao enhanced e role-aware: broadcaster\n// reaplica a fonte sem destruir RTC; viewer refresca transporte/subscricao de video.\n// Voice, media sockets e gateway permanecem intactos.",
    1,
)

SOURCE.write_text(src, encoding="utf-8")

legacy = LEGACY_TEST.read_text(encoding="utf-8")
legacy = legacy.replace('"video-nativo-travado"', '"transmissor-video-parado"')
legacy = sub_once(
    legacy,
    r"  const level1 = sandbox\.window\.__goliveVoiceRecuperar\(1\);[\s\S]*?  else bad\(\"nivel 2 destruiu conexao unknown\"\);\n",
    r'''  const recoveryStart = source.indexOf("window.__goliveVoiceRecuperar = function");
  const recoveryEnd = source.indexOf("installNativeHook();", recoveryStart);
  const recoveryBlock = source.slice(recoveryStart, recoveryEnd);
  if (!/\\.destroy\\s*\\(/.test(recoveryBlock)) ok("recuperacao nativa nao usa destroy automaticamente");
  else bad("recuperacao enhanced ainda chama destroy");
  if (recoveryBlock.includes("desktop-source-reapply") && recoveryBlock.includes("viewer-fast-udp-reconnect") &&
      recoveryBlock.includes("viewer-video-resubscribe")) ok("contratos seguros de broadcaster e viewer estao presentes");
  else bad("acoes enhanced de RTC ausentes");
  if (!cachedConn.destroyed && !voiceConn.destroyed && !streamConn.destroyed) ok("teste legado confirma ausencia de destruicao automatica");
  else bad("alguma conexao foi destruida antes da recuperacao enhanced");
''',
    "legacy destructive assertions",
)
LEGACY_TEST.write_text(legacy, encoding="utf-8")

changelog = CHANGELOG.read_text(encoding="utf-8")
entry = '''## Enhanced fork — RTC recovery v1\n\n### Changed\n- Replaces destructive native RTC recovery with role-aware state machines. Broadcaster stalls replay/clear+replay the exact captured desktop source on the same native connection; viewer stalls use `fastUdpReconnect()` then a targeted `setLocalVideoDisabled(streamUserId, true/false)` resubscription.\n- Adds decoder telemetry and a regression for issue #186: a viewer that previously decoded ~30 FPS can re-enter with `fps_dec=0` / `dec=0`; replacement sockets alone no longer count as recovery.\n- Recovery success now requires 10 seconds of sustained encoded/decoded frame progress. Voice, `discord.media`, gateway and renderer are preserved by automatic RTC recovery.\n- Keeps Tor as the trusted gateway route and leaves bulk media direct; public proxy fallback is not added to the enhanced reliability path.\n\n### Known gap\n- The standalone/GUI path is enhanced first. The separately implemented Vencord/Equicord plugin does not yet claim parity with this role-aware RTC recovery.\n\n'''
if "## Enhanced fork — RTC recovery v1" not in changelog:
    marker = "# Changelog\n\n"
    if marker not in changelog:
        raise SystemExit("changelog header anchor missing")
    changelog = changelog.replace(marker, marker + entry, 1)
CHANGELOG.write_text(changelog, encoding="utf-8")

print("Enhanced RTC transform applied successfully")
