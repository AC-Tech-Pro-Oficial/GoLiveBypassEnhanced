# Read-only, shareable diagnostics. Only fixed labels and numeric counters leave
# the local logs; never output raw lines, user IDs, addresses or credentials.
[CmdletBinding()]
param([string]$DataRoot = (Join-Path $env:LOCALAPPDATA 'GoLiveBypass'),
      [string]$DiscordLogRoot = (Join-Path $env:APPDATA 'discord\logs'))
$ErrorActionPreference = 'Stop'
function Read-Tail([string]$Path) {
    if (Test-Path -LiteralPath $Path -PathType Leaf) {
        return @(Get-Content -LiteralPath $Path -Tail 10000 -ErrorAction Stop)
    }
    return @()
}
$plugin = Read-Tail (Join-Path $DataRoot 'golivebypass.log')
$renderer = Read-Tail (Join-Path $DiscordLogRoot 'renderer_js.log')
$result = [ordered]@{
    schema = 2
    scope = 'Last 10000 lines per log; historical counts, not a live success verdict'
    pluginLogPresent = $plugin.Count -gt 0
    discordLogPresent = $renderer.Count -gt 0
    rtc = $null
    streamSamples = @()
    streamEvents = @()
    recoveryEvents = @()
    nativeVideo = @()
    errors = [ordered]@{}
}
$readiness = 'resumo=(sim|nao) installed=(sim|nao) voice_hooked=(sim|nao) connections=(\d+) streams=(\d+) stats_ok=(\d+) demand_known=(sim|nao) demand_active=(sim|nao)'
foreach ($line in $plugin) {
    # Capture only the fixed recovery vocabulary, never arbitrary error text.
    if ($line -match 'rtc\.enhanced \| ((?:sucesso )?nivel=[12] papel=(?:broadcaster|viewer) (?:sinal=(?:transmissor-video-parado|viewer-video-parado)|acao=(?:desktop-source-reapply|desktop-source-clear-reapply|viewer-fast-udp-reconnect|viewer-video-resubscribe)))\s*$' -or
        $line -match 'rtc\.enhanced \| ((?:recuperacao manual: (?:teto de tentativas|papel indisponivel|acao nativa indisponivel|nivel 2 sem progresso))|(?:tentativa cancelada: (?:stream terminou ou mudou|demanda terminou)))\s*$') {
        $result.recoveryEvents += $Matches[1]
        $result.recoveryEvents = @($result.recoveryEvents | Select-Object -Last 20)
    }
    if ($line -match $readiness) {
        $result.rtc = [ordered]@{ summary=$Matches[1]; installed=$Matches[2]; hooked=$Matches[3]; connections=[int]$Matches[4]; streams=[int]$Matches[5]; statsOk=[int]$Matches[6]; demandKnown=$Matches[7]; demandActive=$Matches[8] }
    }
    if ($line -match 'stream counters \| role=(broadcaster|viewer|unknown) stats_ok=(sim|nao) source=(sim|nao) capture=(-?\d+) input_fps=(-?\d+) encoded=(-?\d+) encode_fps=(-?\d+) bitrate=(-?\d+) decoded=(-?\d+) decode_fps=(-?\d+) received=(-?\d+)') {
        $result.streamSamples += [ordered]@{ role=$Matches[1]; statsOk=$Matches[2]; source=$Matches[3]; capture=[long]$Matches[4]; inputFps=[long]$Matches[5]; encoded=[long]$Matches[6]; encodeFps=[long]$Matches[7]; bitrate=[long]$Matches[8]; decoded=[long]$Matches[9]; decodeFps=[long]$Matches[10]; received=[long]$Matches[11] }
        $result.streamSamples = @($result.streamSamples | Select-Object -Last 8)
    }
}
foreach ($label in @('video-stream-receiver-ready-timeout', 'video-stream-receiver-ready-timeout-no-stream', 'video-stream-sender-ready-timeout', 'video-stream-sender-ready-timeout-no-stream', 'stream-soundshare-failed', 'stream-failed-to-start', 'video-encode-error', 'video-decode-error')) {
    $pattern = 'AV error reported: ' + [regex]::Escape($label) + '(?:\s|$)'
    $result.errors[$label] = @($renderer | Where-Object { $_ -match $pattern }).Count
}
# Preserve event order without copying any message payload or connection ID.
foreach ($line in $renderer) {
    if ($line -notmatch '\[RTCConnection\([^\r\n]*, stream\)\]') { continue }
    foreach ($eventLabel in @('Connecting to RTC server', 'Connected to RTC server', 'Disconnected from RTC server', 'Sending UDP info to RTC server', 'RTC connected to media server', 'Executing DAVE protocol transition', 'Remote media sink wants', 'Destroy RTCConnection')) {
        if ($line -match ('\] ' + [regex]::Escape($eventLabel))) {
            $result.streamEvents += $eventLabel
            $result.streamEvents = @($result.streamEvents | Select-Object -Last 30)
            break
        }
    }
}
# Discord's native log can distinguish encoder initialization from encryption
# failure. Only known codec names and numeric counters are emitted. These are
# historical samples and may include the default voice connection as well.
foreach ($name in @('discord-last-webrtc_0', 'discord-last-webrtc_1', 'discord-webrtc_0', 'discord-webrtc_1')) {
    foreach ($line in (Read-Tail (Join-Path $DiscordLogRoot $name))) {
        $sample = $null
        if ($line -match 'Initialize MultiEncoder for codec: (AV1|H264|H265|VP8|VP9)\b') {
            $sample = [ordered]@{ event='encoder-initialization'; codec=$Matches[1] }
        } elseif ($line -match 'Encrypted audio: (\d+), video: (\d+)\. Failed audio: (\d+), video: (\d+)') {
            $sample = [ordered]@{ event='encryption-counters'; audio=[long]$Matches[1]; video=[long]$Matches[2]; failedAudio=[long]$Matches[3]; failedVideo=[long]$Matches[4] }
        }
        if ($null -ne $sample) {
            # Timestamp syntax is fixed; no message payload is copied.
            $sample.log = $name
            if ($line -match '^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})\]') { $sample.time = $Matches[1] }
            $result.nativeVideo += $sample
        }
    }
}
$initializations = @($result.nativeVideo | Where-Object { $_.event -eq 'encoder-initialization' } | Sort-Object { $_['time'] } | Select-Object -Last 4)
$encryption = @($result.nativeVideo | Where-Object { $_.event -eq 'encryption-counters' } | Sort-Object { $_['time'] } | Select-Object -Last 8)
$result.nativeVideo = @(@($initializations + $encryption) | Sort-Object { $_['time'] })
$result | ConvertTo-Json -Depth 5
