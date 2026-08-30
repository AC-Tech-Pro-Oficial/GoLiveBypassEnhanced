# GoLiveBypass — diagnostico de boot/autostart para o Windows.
#
# So le o sistema (nada e alterado). Coleta o estado de tudo que participa do
# "iniciar com o Windows": Run key (com deteccao de caminho morto), tarefas
# agendadas, processos, portas do Tor, logs, eventos de erro e antivirus de
# terceiros. A proxy do usuario e NUNCA impressa (o settings.json e filtrado).
#
# Uso (sem admin):
#   powershell -NoProfile -ExecutionPolicy Bypass -File diagnostico.ps1
# Ou de uma linha so:
#   iirm https://raw.githubusercontent.com/bezumiya/GoLiveBypass/main/diagnostico.ps1 -OutFile $env:TEMP\glb-diag.ps1; powershell -NoProfile -ExecutionPolicy Bypass -File $env:TEMP\glb-diag.ps1
#
# No fim salva tudo em Desktop\GoLiveBypass-diagnostico-<data>.txt para mandar
# ao suporte.

$ErrorActionPreference = 'Continue'
$lines = [System.Collections.Generic.List[string]]::new()
$localApp = $env:LOCALAPPDATA
$glbDir = Join-Path $localApp 'GoLiveBypass'
$outFile = Join-Path ([Environment]::GetFolderPath('Desktop')) ("GoLiveBypass-diagnostico-{0}.txt" -f (Get-Date -Format 'yyyy-MM-dd-HHmm'))

function L([string]$t = '') { $lines.Add($t); Write-Host $t }
function Sec([string]$t) { L ''; L ('=== ' + $t + ' ' + ('=' * [Math]::Max(0, 60 - $t.Length))) }
function Redact([string]$t) {
    # Mesmo espirito do Invoke-SanitizeBug do instalador: a proxy nunca sai.
    $t = [regex]::Replace($t, '([a-z][a-z0-9+.-]*://)([^/ @:]+):([^/@]+)@', '$1$2:***@')
    $t = [regex]::Replace($t, '\b(mfa\.[A-Za-z0-9_-]{20,}|[A-Za-z0-9_-]{23,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{27,})\b', '***')
    return $t
}

L "GoLiveBypass - diagnostico de boot"
L ("gerado em: " + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))

Sec 'Sistema'
try {
    $os = Get-CimInstance Win32_OperatingSystem
    L ("windows : {0} (build {1}) {2}" -f $os.Caption, $os.BuildNumber, $os.OSArchitecture)
    $boot = $os.LastBootUpTime
    L ("ultimo boot: {0} (ligado ha {1:h\:mm})" -f $boot, ((Get-Date) - $boot))
} catch { L ("erro: " + $_.Exception.Message) }
try {
    $sessao = quser 2>&1 | Out-String
    L ("sessao  : " + (($sessao -split "`n" | Select-Object -Skip 1 | ForEach-Object { ($_ -split '\s+')[0..2] -join ' ' }) -join ' | '))
} catch { L 'sessao: quser indisponivel' }

Sec 'Executaveis do GoLiveBypass no disco'
try {
    $caminhos = @(
        (Join-Path $glbDir 'GoLiveBypass.exe'),
        (Join-Path ([Environment]::GetFolderPath('Desktop')) 'GoLiveBypass.exe')
    )
    foreach ($base in @($env:USERPROFILE + '\Downloads', $env:USERPROFILE + '\Desktop', $env:USERPROFILE)) {
        Get-ChildItem -Path $base -Filter 'GoLiveBypass*.exe' -File -ErrorAction SilentlyContinue -Depth 1 |
            ForEach-Object { $caminhos += $_.FullName }
    }
    $vistos = @{}
    foreach ($c in ($caminhos | Where-Object { $_ } | Select-Object -Unique)) {
        if ($vistos.ContainsKey($c.ToLower())) { continue }
        $vistos[$c.ToLower()] = $true
        if (Test-Path -LiteralPath $c) {
            $f = Get-Item -LiteralPath $c
            L ("  existe : {0} ({1:N0} bytes, {2})" -f $c, $f.Length, $f.LastWriteTime)
        } else {
            L ("  falta  : {0}" -f $c)
        }
    }
} catch { L ("erro: " + $_.Exception.Message) }

Sec 'Run key (HKCU\...\CurrentVersion\Run)'
try {
    $runValues = (Get-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -ErrorAction Stop)
    foreach ($name in @('GoLiveBypass', 'GoLiveBypassTor')) {
        $v = $runValues.$name
        if (-not $v) { L ("  {0}: AUSENTE" -f $name); continue }
        L ("  {0}: {1}" -f $name, (Redact $v))
        # O erro classico do "nao abre no boot": o caminho gravado nao existe mais.
        foreach ($m in [regex]::Matches($v, '"([^"]+)"|(\S+\.exe)')) {
            $cand = if ($m.Groups[1].Value) { $m.Groups[1].Value } else { $m.Groups[2].Value }
            if (-not $cand) { continue }
            $existe = Test-Path -LiteralPath $cand
            L ("    caminho: {0} -> {1}" -f $cand, $(if ($existe) { 'OK existe' } else { '*** NAO EXISTE (boot falha em silencio) ***' }))
        }
        if ($name -eq 'GoLiveBypass' -and $v -notmatch '--hidden') {
            L '    aviso: sem --hidden (a janela abre no boot em vez de so a bandeja)'
        }
    }
    if (-not $runValues.PSObject.Properties.Name -match 'GoLiveBypass') { L '  nenhuma entrada GoLiveBypass*' }
} catch { L ("erro: " + $_.Exception.Message) }

Sec 'Tarefas agendadas e pasta Startup'
try {
    Get-ScheduledTask -ErrorAction SilentlyContinue | Where-Object { $_.TaskName -like '*GoLive*' -or $_.Actions.Execute -like '*GoLiveBypass*' } |
        ForEach-Object { L ("  tarefa: {0} state={1} exec={2}" -f $_.TaskName, $_.State, (Redact (($_.Actions | ForEach-Object { $_.Execute + ' ' + $_.Arguments }) -join ' '))) }
    $startup = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup'
    Get-ChildItem -LiteralPath $startup -ErrorAction SilentlyContinue | ForEach-Object { L ("  startup: " + $_.Name) }
} catch { L ("erro: " + $_.Exception.Message) }

Sec 'Processos e portas agora'
try {
    foreach ($img in @('GoLiveBypass', 'tor')) {
        $p = Get-Process $img -ErrorAction SilentlyContinue
        L ("  {0}: {1}" -f $img, $(if ($p) { "rodando (pid " + ($p.Id -join ',') + ")" } else { 'nao rodando' }))
    }
    $net = netstat -ano | Select-String ':(9060|9050)\s.*LISTENING'
    L ("  portas  : " + $(if ($net) { ($net | ForEach-Object { $_.Line.Trim() }) -join ' ; ' } else { '9060/9050 nao escutando' }))
} catch { L ("erro: " + $_.Exception.Message) }

Sec 'Configuracao (settings.json compartilhado)'
try {
    $sf = Join-Path $glbDir 'settings.json'
    if (Test-Path -LiteralPath $sf) {
        # A proxy NUNCA sai: so as chaves de diagnostico.
        $s = Get-Content -LiteralPath $sf -Raw | ConvertFrom-Json
        L ("  routeMode : " + $(if ($null -ne $s.routeMode) { $s.routeMode } else { 'AUSENTE (runtime cai no auto)' }))
        L ("  torAddr   : " + $(if ($null -ne $s.torAddr) { $s.torAddr } else { 'AUSENTE' }))
        L ("  autoUpdate: " + $(if ($null -ne $s.autoUpdate) { $s.autoUpdate } else { 'AUSENTE' }))
        L ("  tem proxy : " + $(if ($s.proxy) { 'sim (valor oculto)' } else { 'nao' }))
    } else { L '  settings.json nao existe' }
} catch { L ("erro: " + $_.Exception.Message) }

Sec 'Tor embutido'
try {
    $torExe = Join-Path $glbDir 'Tor\tor\tor.exe'
    $torrc = Join-Path $glbDir 'Tor\torrc'
    $vbs = Join-Path $glbDir 'Tor\GoLiveBypassTor.vbs'
    L ("  tor.exe : " + $(if (Test-Path -LiteralPath $torExe) { 'existe' } else { 'NAO (o modo tor baixa na primeira ativacao)' }))
    L ("  torrc   : " + $(if (Test-Path -LiteralPath $torrc) { ((Get-Content -LiteralPath $torrc | Select-String 'SocksPort') | Out-String).Trim() } else { 'nao existe' }))
    L ("  vbs     : " + $(if (Test-Path -LiteralPath $vbs) { (Get-Content -LiteralPath $vbs -Raw | Out-String).Trim() } else { 'sem wrapper (Run key antiga = terminal visivel no boot)' }))
} catch { L ("erro: " + $_.Exception.Message) }

Sec 'Logs (ultimas linhas)'
try {
    foreach ($log in @('golivebypass.log', 'gui.log', 'bypass.log')) {
        $lp = Get-ChildItem -Path $glbDir -Filter $log -Recurse -File -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($lp) {
            # -LiteralPath quer STRING: passar o FileInfo faz o ToString() virar so o
            # nome ("gui.log") e o Get-Content procurar na raiz atual.
            $total = (Get-Content -LiteralPath $lp.FullName | Measure-Object -Line).Lines
            L ("--- {0} (ultimas 20 de {1}, mtime {2})" -f $lp.FullName, $total, $lp.LastWriteTime)
            Get-Content -LiteralPath $lp.FullName -Tail 20 | ForEach-Object { L ('  ' + (Redact $_)) }
        } else {
            L ("--- {0}: nao existe" -f $log)
        }
    }
} catch { L ("erro: " + $_.Exception.Message) }

Sec 'Erros do Windows (7 dias, app/tor)'
try {
    $ev = Get-WinEvent -FilterHashtable @{ LogName = 'Application'; StartTime = (Get-Date).AddDays(-7); Level = 2 } -ErrorAction SilentlyContinue |
        Where-Object { $_.Message -match 'GoLiveBypass|tor\.exe' } | Select-Object -First 5
    if ($ev) {
        $ev | ForEach-Object {
            $msg = (($_.Message -split "`n") | Select-Object -First 4) -join ' | '
            L ("  [{0}] {1}: {2}" -f $_.TimeCreated, $_.ProviderName, $msg)
        }
    } else { L '  nenhum erro registrado para GoLiveBypass/tor' }
    $wer = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\Windows\WER\ReportArchive" -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -match 'GoLiveBypass' } | Select-Object -First 3
    if ($wer) { $wer | ForEach-Object { L ("  WER: " + $_.Name) } }
} catch { L ("erro: " + $_.Exception.Message) }

Sec 'Antivirus de terceiros (podem bloquear o Run key)'
try {
    Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntiVirusProduct -ErrorAction Stop |
        ForEach-Object { L ("  {0} (estado {1})" -f $_.displayName, $_.productState) }
} catch { L '  indisponivel' }

Sec 'Discord: estado da injecao'
try {
    foreach ($name in @('Discord', 'DiscordPTB', 'DiscordCanary', 'DiscordDevelopment')) {
        $root = Join-Path $localApp $name
        if (-not (Test-Path -LiteralPath $root)) { continue }
        Get-ChildItem -LiteralPath $root -Directory -Filter 'app-*' -ErrorAction SilentlyContinue | ForEach-Object {
            $res = Join-Path $_.FullName 'resources'
            $asar = Join-Path $res 'app.asar'
            $orig = Join-Path $res '_app.asar'
            $estado = if (Test-Path -LiteralPath $orig) {
                if (Test-Path -LiteralPath (Join-Path $asar 'index.js')) { 'GoLiveBypass' } else { 'outro mod' }
            } elseif (Test-Path -LiteralPath $asar) { 'vanilla (app.asar arquivo)' } else { 'desconhecido' }
            L ("  {0}: {1}" -f $_.Name, $estado)
        }
    }
} catch { L ("erro: " + $_.Exception.Message) }

Sec 'Fim'
L ("salvo em: " + $outFile)
L 'manda esse arquivo ao suporte (a proxy do usuario e ocultada automaticamente).'

$lines | ForEach-Object { Redact $_ } | Out-File -LiteralPath $outFile -Encoding utf8
Write-Host ''
Write-Host ("Diagnostico salvo em: " + $outFile)
