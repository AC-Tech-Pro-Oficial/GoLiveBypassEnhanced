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
    schema = 1
    scope = 'Last 10000 lines per log; historical counts, not a live success verdict'
    pluginLogPresent = $plugin.Count -gt 0
    discordLogPresent = $renderer.Count -gt 0
    rtc = $null
    streamSamples = @()
    streamEvents = @()
    errors = [ordered]@{}
}
$readiness = 'resumo=(sim|nao) installed=(sim|nao) voice_hooked=(sim|nao) connections=(\d+) streams=(\d+) stats_ok=(\d+) demand_known=(sim|nao) demand_active=(sim|nao)'
foreach ($line in $plugin) {
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
$result | ConvertTo-Json -Depth 5
