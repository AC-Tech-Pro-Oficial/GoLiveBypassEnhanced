# Enhanced native RTC recovery

Date: 2026-09-03

## Goal

Turn the fork into an independently maintained enhanced build that preserves the reliable Tor gateway path while fixing the two native RTC failure classes that are currently conflated: broadcaster encoder stalls and viewer decoder stalls after join/re-entry.

## Evidence

The current fork still uses the beta-10-era native recovery implementation. It samples `discord_voice`, but its automatic action destroys the stream connection at level 1 and destroys stream + voice at level 2.

The project's later 2026-08-31 design notes already invalidate `destroy()` for broadcaster recovery: live tests showed that destruction can remove the desktop-source association and that an apparent recovery was only incidental. The safe broadcaster boundary discovered in the native object is `setDesktopSource*` / `clearDesktopSource()` on the existing stream connection.

Issue #186 provides a separate viewer failure. A healthy viewer decoded at about 30 FPS and accumulated thousands of decoded frames. After re-entry, the viewer stream repeatedly reported zero decoder FPS and zero decoded frames. Closing the stream socket produced replacement sockets, but every replacement remained at zero decoded frames. Gateway/Tor remained healthy during the failure. Therefore socket destruction is not an adequate receiver reset.

## Routing

- Keep `routeMode=tor` as the trusted default path for gateway/signaling.
- Do not add public proxies to the enhanced reliability path.
- Keep `*.discord.media` direct by default. The production evidence shows a healthy Tor gateway and an initially healthy direct media path before the native decoder state becomes stuck.
- Do not route bulk media through Tor unless future telemetry demonstrates that media origin/routing is itself the failing layer.

## Architecture

### 1. One native stream registry, two roles

The preload continues to wrap `discord_voice` factories transparently. Every confidently classified stream connection receives a private runtime role:

- `broadcaster`: the connection owns the desktop source or its stream identity matches the local connection identity;
- `viewer`: the stream identity is a remote user and decoder stats are present;
- `unknown`: ambiguity. Unknown connections are observed only and never automatically mutated.

Raw user IDs, stream IDs, source IDs, endpoints and option objects never cross the isolated-world boundary or enter logs.

### 2. Broadcaster telemetry

For broadcaster streams, sample the existing confirmed outbound/screenshare fields:

- capture/input progress;
- `framesEncoded`;
- encoder FPS;
- bitrate/resolution when available.

The detector requires active viewer demand, open media, a warmed stream, live capture and stalled encoded output. It fails closed on unknown stats.

### 3. Broadcaster recovery

The shim privately records the last successful `setDesktopSource` or `setDesktopSourceWithOptions` invocation by reference on the exact connection. These arguments are never serialized or logged.

Level 1:

- replay the stored `setDesktopSource*` call on the same native connection;
- preserve voice, RTC transport, gateway and media sockets.

Level 2:

- call `clearDesktopSource()` under an internal recovery guard that does not erase the stored source;
- reapply the same stored `setDesktopSource*` arguments after a short delay;
- preserve voice and RTC transport.

There is no automatic broadcaster fallback to `destroy()`, closing `discord.media`, gateway reconnect or renderer reload.

### 4. Viewer telemetry

For viewer streams, normalize inbound decoder information when the native stats shape exposes it. The normalizer supports the currently observed/native-style fields (`framesDecoded`, decode FPS/frame rate) and defensively searches nested inbound/video objects without persisting unknown payloads.

The shim tracks age since real decoder progress. A viewer is considered stuck only when all of these hold:

- stream role is confidently `viewer`;
- stream and media are established and warmed;
- viewer demand is active;
- video is expected;
- decoder stats are known;
- decoded frame count has not advanced for the configured threshold;
- decode FPS is zero/non-progressing.

A new stream gets an explicit warm-up period to avoid treating normal negotiation as failure.

### 5. Viewer recovery

Level 1 — transport refresh:

- call `fastUdpReconnect()` on the exact viewer stream connection when available;
- do not destroy stream or voice;
- keep the primary voice connection intact.

Level 2 — targeted video resubscription:

- obtain the private `streamUserId` from the exact connection;
- call `setLocalVideoDisabled(streamUserId, true)`;
- re-enable it after a short delay with `setLocalVideoDisabled(streamUserId, false)`;
- optionally combine with one `fastUdpReconnect()` on the same stream if available;
- never expose the user ID outside the preload closure.

If these methods/identity are unavailable, fail closed and surface the existing manual-recovery banner rather than guessing.

### 6. Recovery success

A recovery is successful only after sustained media progress:

- broadcaster: encoded output resumes for at least 10 seconds;
- viewer: decoded frame count advances / decode FPS is positive for at least 10 seconds.

A new native socket or connection object alone never counts as success. This directly guards against the #186 failure where sockets were recreated but `dec=0` persisted.

### 7. State machine and limits

Broadcaster and viewer use the same outer polling cadence but independent role-aware decisions. Recovery attempts remain capped at two per 30-minute window with cooldowns. Ending viewer demand cancels escalation. Unknown/partial stats never trigger mutations.

### 8. Distribution

`standalone/golivebypass.js` remains canonical. `golive-gui/electron/bypass.ts` is regenerated with the existing `sync-bypass` script. The Vencord/Equicord plugin is a separate implementation; this first enhanced branch does not silently claim parity there. Any temporary gap must be documented.

## Tests

Automated coverage must prove:

- `destroy()` is never used by enhanced automatic RTC recovery;
- desktop-source arguments remain private and are replayed exactly;
- voluntary `clearDesktopSource()` invalidates replay state;
- broadcaster level 1 replays source without closing RTC;
- broadcaster level 2 clear+replays without destroying voice/stream;
- viewer level 1 calls only `fastUdpReconnect()` on the viewer stream;
- viewer level 2 toggles only that remote stream's local video subscription and preserves voice;
- viewer detection reproduces the #186 pattern: healthy decode -> re-entry -> sustained `fps_dec=0`, `dec=0`;
- replacement sockets with zero decoded progress do not count as recovery;
- unknown roles and incomplete stats fail closed;
- summaries/logs do not contain source arguments or remote user IDs;
- GUI mirror matches the canonical standalone source after sync.

## Live validation

Automated tests validate state-machine behavior, not Discord server behavior. Final live validation should use a prerelease build and verify at least:

1. healthy Tor startup;
2. broadcaster Go Live with a viewer for 10+ minutes;
3. viewer leave/re-enter cycles;
4. recovery log shows transport/subscription actions rather than destruction;
5. decoded frames resume after a recovery;
6. voice remains connected throughout viewer recovery;
7. no false positive during voice-only calls or short video renegotiations.
