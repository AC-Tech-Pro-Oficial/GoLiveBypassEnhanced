# Enhanced RTC Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace destructive native RTC recovery with role-aware broadcaster source reset and viewer decoder recovery while preserving the existing Tor gateway architecture.

**Architecture:** Extend the isolated `discord_voice` shim so each stream connection exposes only sanitized role-aware telemetry while retaining sensitive recovery state privately. Keep the main-process detector pure and role-aware. Use the existing canonical standalone -> generated GUI synchronization path.

**Tech Stack:** Electron main/preload JavaScript, Discord `discord_voice` native wrapper, Node.js test harness (`vm`), npm/TypeScript/Vitest for GUI verification, GitHub Actions for reproducible branch execution.

**Spec:** `docs/superpowers/specs/2026-09-03-enhanced-rtc-recovery-design.md`

## Global Constraints

- Keep Tor as the trusted gateway/signaling route; do not add public proxies to the enhanced path.
- Keep `*.discord.media` direct unless future evidence proves media routing is the fault layer.
- Never automatically destroy native stream/voice connections for RTC recovery.
- Never automatically reload the renderer or reconnect the gateway while media is active.
- Never serialize/log desktop-source arguments, user IDs, stream IDs, endpoints or raw stats.
- Unknown roles/methods/stats fail closed.
- `standalone/golivebypass.js` remains canonical; GUI mirror is generated only by `golive-gui/scripts/sync-bypass.mjs`.

---

### Task 1: Add regression harness for enhanced RTC behavior

**Files:**
- Create: `tests/test-enhanced-rtc-recovery.cjs`
- Create: `tests/test-enhanced-rtc-recovery.sh`

**Interfaces:**
- Consumes: markers/functions from `standalone/golivebypass.js`.
- Produces: a deterministic Node test that validates the enhanced shim and role-aware detector.

- [ ] **Step 1: Write the failing regression test**

The harness must construct fake `discord_voice` connections with these methods/properties:

```js
{
  userId,
  streamUserId,
  fastUdpReconnect(),
  setLocalVideoDisabled(userId, disabled),
  setDesktopSource(...args),
  setDesktopSourceWithOptions(options),
  clearDesktopSource(),
  hasDesktopSource(),
  getFilteredStats(filter, callback)
}
```

Required assertions:

```js
assert.equal(broadcasterRecovery.level1.action, "desktop-source-reapply");
assert.equal(broadcaster.destroyCalls, 0);
assert.equal(viewerRecovery.level1.action, "viewer-fast-udp-reconnect");
assert.equal(viewer.fastReconnectCalls, 1);
assert.deepEqual(viewer.videoToggleCalls, [[remoteUser, true], [remoteUser, false]]);
assert.equal(viewer.destroyCalls, 0);
assert.equal(voice.destroyCalls, 0);
assert.equal(detectViewer(stuckFixture), "viewer-video-parado");
assert.equal(detectViewer(healthyFixture), null);
```

The fixture must model #186: healthy decoder progress followed by a new/re-entered viewer stream whose decode FPS and decoded frame count stay at zero.

- [ ] **Step 2: Run the test before implementation**

Run:

```bash
node tests/test-enhanced-rtc-recovery.cjs
```

Expected: FAIL because role-aware recovery / decoder telemetry is absent and current recovery still destroys connections.

- [ ] **Step 3: Commit the failing test**

```bash
git add tests/test-enhanced-rtc-recovery.cjs tests/test-enhanced-rtc-recovery.sh
git commit -m "test: reproduce viewer decoder stall and safe RTC recovery"
```

---

### Task 2: Make the native preload role-aware and retain safe private recovery state

**Files:**
- Modify: `standalone/golivebypass.js` inside `// === voice shim: inicio ===` / `// === voice shim: fim ===`.
- Test: `tests/test-enhanced-rtc-recovery.cjs`.

**Interfaces:**
- Produces sanitized per-stream stats fields: `role`, `videoExpected`, `framesDecoded`, `decodeFrameRate`, `decodeHa`, plus existing broadcaster fields.
- Produces private per-record source replay state that never appears in `__goliveVoiceResumo()`.

- [ ] **Step 1: Extend native stats normalization**

Normalize broadcaster outbound/screenshare as today, plus viewer inbound video. Support direct inbound/video objects and a defensive nested scan for objects containing decoder counters. Return `role: "broadcaster" | "viewer" | "unknown"` only when evidence is sufficient.

- [ ] **Step 2: Track decoder progress separately**

Add per-record progress timestamps for decoded frames so a new viewer starts in warm-up and only becomes stuck after sustained non-progression.

- [ ] **Step 3: Capture desktop-source operations privately**

Wrap `setDesktopSource`, `setDesktopSourceWithOptions`, and `clearDesktopSource` on the exact stream connection. Store the last source method + arguments only in the closure. Voluntary clear invalidates the stored source; recovery clear uses an internal guard so it can replay.

- [ ] **Step 4: Preserve privacy in summaries**

`__goliveVoiceResumo()` may expose sanitized role and counters but never the captured source arguments or `userId` / `streamUserId`.

- [ ] **Step 5: Run the regression test**

Run:

```bash
node tests/test-enhanced-rtc-recovery.cjs
```

Expected: role/stat/source-state assertions pass; recovery assertions may still fail until Task 3.

---

### Task 3: Replace destructive native actions with role-aware recovery

**Files:**
- Modify: `standalone/golivebypass.js` (`window.__goliveVoiceRecuperar`).
- Test: `tests/test-enhanced-rtc-recovery.cjs`.

**Interfaces:**
- `window.__goliveVoiceRecuperar(level)` returns a sanitized action result:

```js
{ ok, level, role, action }
```

- [ ] **Step 1: Broadcaster level 1**

Replay the privately stored `setDesktopSource*` invocation on the same stream connection. Return `action: "desktop-source-reapply"`.

- [ ] **Step 2: Broadcaster level 2**

Call `clearDesktopSource()` under the recovery guard, then reapply the captured source after a short timer. Return `action: "desktop-source-clear-reapply"`. Do not call `destroy()` or close media.

- [ ] **Step 3: Viewer level 1**

Call `fastUdpReconnect()` on the exact viewer stream. Return `action: "viewer-fast-udp-reconnect"`.

- [ ] **Step 4: Viewer level 2**

Using the private `streamUserId`, call `setLocalVideoDisabled(id, true)` then re-enable after a short timer; optionally issue one `fastUdpReconnect()` on the same stream. Return `action: "viewer-video-resubscribe"`.

- [ ] **Step 5: Fail closed**

If role, source state, remote identity or required native methods are absent, return `ok:false` and make no destructive fallback.

- [ ] **Step 6: Run regression tests**

Run:

```bash
node tests/test-enhanced-rtc-recovery.cjs
node tests/test-native-rtc-recovery.cjs
```

Expected: enhanced test passes; legacy native test is updated in Task 5 if it encodes the obsolete destructive contract.

---

### Task 4: Make main-process detection and success criteria role-aware

**Files:**
- Modify: `standalone/golivebypass.js` around `avaliarRtcNativo`, `rtcNativoSaudavel`, `iniciarRecuperacaoNativa`, `acompanharRecuperacaoNativa`, `processarRtcNativo`, `logRtcNativo`.
- Test: `tests/test-enhanced-rtc-recovery.cjs`.

**Interfaces:**
- `avaliarRtcNativo(ctx)` returns `"transmissor-video-parado"`, `"viewer-video-parado"`, or `null`.
- Recovery success is progress-based, not generation/socket-based.

- [ ] **Step 1: Add viewer thresholds**

Use a viewer warm-up of at least 10 seconds, decoder-stall threshold of at least 10 seconds, existing sample freshness, active demand and open media.

- [ ] **Step 2: Split pure detector by role**

Broadcaster path keeps capture-live/output-stalled conditions. Viewer path requires expected video, known decoded counters, zero/non-progressing decode FPS and decoder non-progression past the threshold.

- [ ] **Step 3: Make health role-aware**

Broadcaster health = encoded output advancing. Viewer health = decoded output advancing. Same-generation recovery is valid because safe actions intentionally preserve the connection.

- [ ] **Step 4: Remove socket-generation success assumption**

Do not credit recovery merely because a native connection/socket ID changes. Require 10 seconds of sustained role-specific progress.

- [ ] **Step 5: Remove level-2 media close**

The main process must not call `__goliveMidiaFechar()` from native RTC recovery.

- [ ] **Step 6: Improve sanitized logs**

Log role/action and decoder/encoder counters, never private IDs.

- [ ] **Step 7: Run tests**

```bash
node tests/test-enhanced-rtc-recovery.cjs
node tests/test-gateway-zumbi-revive.cjs
```

Expected: both pass.

---

### Task 5: Replace obsolete legacy RTC assertions and document fork behavior

**Files:**
- Modify: `tests/test-native-rtc-recovery.cjs`.
- Modify: `CHANGELOG.md`.

**Interfaces:**
- Legacy test continues validating transparent/idempotent hooking and privacy but no longer requires destructive `destroy()` behavior.

- [ ] **Step 1: Update legacy recovery assertions**

Replace assertions such as "nivel 1 destroi somente a conexao stream" and "nivel 2 destroi stream + voice" with the safe source replay / viewer transport contract.

- [ ] **Step 2: Add changelog entry**

Document the enhanced fork's role-aware native RTC state machines, the #186 regression fixture, Tor routing policy and the temporary Vencord/Equicord parity gap.

- [ ] **Step 3: Run both native suites**

```bash
node tests/test-native-rtc-recovery.cjs
node tests/test-enhanced-rtc-recovery.cjs
```

Expected: PASS.

---

### Task 6: Regenerate GUI mirror and perform full verification

**Files:**
- Generated modify: `golive-gui/electron/bypass.ts`.

**Interfaces:**
- GUI embedded bypass must exactly represent the canonical standalone source.

- [ ] **Step 1: Sync canonical source**

```bash
cd golive-gui
npm ci
npm run sync-bypass
```

- [ ] **Step 2: Run focused Node suites**

```bash
cd ..
node tests/test-enhanced-rtc-recovery.cjs
node tests/test-native-rtc-recovery.cjs
node tests/test-gateway-zumbi-revive.cjs
```

- [ ] **Step 3: Run GUI tests and compile**

```bash
cd golive-gui
npm test
npm run compile
```

Expected: all tests and TypeScript/Vite compilation pass.

- [ ] **Step 4: Verify generated mirror**

Run `npm run sync-bypass` a second time and verify the working tree remains clean for `golive-gui/electron/bypass.ts`.

- [ ] **Step 5: Commit implementation**

```bash
git add standalone/golivebypass.js golive-gui/electron/bypass.ts tests CHANGELOG.md
git commit -m "fix: add role-aware native RTC recovery"
```

---

### Task 7: Review and open pull request

**Files:**
- No new implementation files.

- [ ] **Step 1: Compare branch to main**

Confirm only intended RTC/docs/tests/generated changes are present.

- [ ] **Step 2: Check CI/status**

Require all available branch/PR checks to pass.

- [ ] **Step 3: Open PR**

Title:

```text
fix: add role-aware native RTC recovery
```

Body must summarize broadcaster source replay, viewer UDP/subscription reset, Tor policy, #186 regression, tests and the limitation that live Discord validation is still required.
