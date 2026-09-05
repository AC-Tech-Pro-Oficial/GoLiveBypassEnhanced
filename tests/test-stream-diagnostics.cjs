const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'golive-diagnostics-'));
const plugin = path.join(dir, 'golivebypass.log');
const renderer = path.join(dir, 'renderer_js.log');
try {
    fs.writeFileSync(plugin, 'token=private-fixture user=private-fixture\nstream counters | role=broadcaster stats_ok=sim source=sim capture=100 input_fps=30 encoded=0 encode_fps=0 bitrate=0 decoded=-1 decode_fps=-1 received=-1\n');
    fs.writeFileSync(renderer, '[AVError] AV error reported: video-stream-receiver-ready-timeout {"userId":"private-fixture"}\n[AVError] AV error reported: video-stream-receiver-ready-timeout-no-stream private-fixture\n[RTCConnection(private-fixture, stream)] Connected to RTC server wss://private-fixture\n');
    const output = execFileSync('powershell.exe', ['-NoProfile', '-File', path.resolve('installer/Get-StreamDiagnostics.ps1'), '-DataRoot', dir, '-DiscordLogRoot', dir], { encoding: 'utf8' });
    assert(!output.includes('private-fixture'));
    const result = JSON.parse(output);
    assert.equal(result.streamSamples[0].inputFps, 30);
    assert.equal(result.errors['video-stream-receiver-ready-timeout'], 1);
    assert.equal(result.errors['video-stream-receiver-ready-timeout-no-stream'], 1);
    assert.equal(result.rtc, null);
    assert.deepEqual(result.streamEvents, ['Connected to RTC server']);
    console.log('Stream diagnostics: numeric fields retained, raw data excluded, error names counted exactly');
} finally {
    for (const file of [plugin, renderer]) if (fs.existsSync(file)) fs.unlinkSync(file);
    fs.rmdirSync(dir);
}
