# GoLiveBypassEnhanced - one-click Windows installer
# Downloads the enhanced standalone installer + patcher from this branch,
# installs/updates Discord in Tor mode, and verifies hidden Tor startup.

[CmdletBinding()]
param(
    [switch] $NoLaunch
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$RepoRaw = 'https://raw.githubusercontent.com/AC-Tech-Pro-Oficial/GoLiveBypassEnhanced/enhanced/rtc-viewer-recovery-v1'

function Get-EffectiveLocalApp {
    if ($env:LOCALAPPDATA -and (Test-Path -LiteralPath $env:LOCALAPPDATA)) { return $env:LOCALAPPDATA }
    try {
        $p = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
        if ($p -and (Test-Path -LiteralPath $p)) { return $p }
    } catch { }
    if ($env:USERPROFILE) { return (Join-Path $env:USERPROFILE 'AppData\Local') }
    throw 'Nao consegui localizar LOCALAPPDATA.'
}

function Test-Port([int] $Port) {
    try {
        $client = New-Object System.Net.Sockets.TcpClient
        $task = $client.ConnectAsync('127.0.0.1', $Port)
        if (-not $task.Wait(1500)) { $client.Close(); return $false }
        $ok = $client.Connected
        $client.Close()
        return $ok
    } catch { return $false }
}

function Start-DiscordFlavour([string] $Name) {
    $update = Join-Path (Get-EffectiveLocalApp) "$Name\Update.exe"
    if (-not (Test-Path -LiteralPath $update)) { return $false }
    Start-Process -FilePath $update -ArgumentList '--processStart', "$Name.exe"
    return $true
}

Write-Host ''
Write-Host '  GoLiveBypassEnhanced' -ForegroundColor Magenta
Write-Host '  Instalacao automatica + Tor oculto' -ForegroundColor DarkGray
Write-Host ''

$runningBefore = @()
foreach ($name in @('Discord', 'DiscordPTB', 'DiscordCanary')) {
    if (Get-Process -Name $name -ErrorAction SilentlyContinue) { $runningBefore += $name }
}

# Detecta instalacoes antigas que iniciavam nosso tor.exe diretamente e, por isso,
# deixavam um console aberto. So consideramos entradas que apontam para a NOSSA pasta.
$legacyVisibleTor = $false
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
try {
    $props = Get-ItemProperty -Path $runKey -ErrorAction SilentlyContinue
    foreach ($p in $props.PSObject.Properties) {
        if ($p.Name -like 'PS*' -or -not ($p.Value -is [string])) { continue }
        $v = [string]$p.Value
        if ($v -match '(?i)GoLiveBypass[\\/]Tor' -and $v -match '(?i)tor\.exe' -and $v -notmatch '(?i)wscript\.exe') {
            $legacyVisibleTor = $true
        }
    }
} catch { }

$work = Join-Path ([System.IO.Path]::GetTempPath()) 'GoLiveBypassEnhanced-installer'
New-Item -ItemType Directory -Path $work -Force | Out-Null
$installer = Join-Path $work 'GoLiveBypass-Standalone.ps1'
$patcher = Join-Path $work 'golivebypass.js'

try {
    Write-Host '  [*] Baixando o instalador enhanced...' -ForegroundColor Cyan
    Invoke-WebRequest -UseBasicParsing -Uri "$RepoRaw/standalone/GoLiveBypass-Standalone.ps1" -OutFile $installer
    Invoke-WebRequest -UseBasicParsing -Uri "$RepoRaw/standalone/golivebypass.js" -OutFile $patcher

    if ((Get-Item -LiteralPath $installer).Length -lt 10000) { throw 'Download do instalador veio incompleto.' }
    if ((Get-Item -LiteralPath $patcher).Length -lt 100000) { throw 'Download do bypass veio incompleto.' }

    Write-Host '  [*] Instalando/atualizando em modo Tor...' -ForegroundColor Cyan
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installer -Mode Install -Tor -Yes
    if ($LASTEXITCODE -ne 0) { throw "O instalador terminou com codigo $LASTEXITCODE." }

    $local = Get-EffectiveLocalApp
    $installDir = Join-Path $local 'GoLiveBypass'
    $installedJs = Join-Path $installDir 'golivebypass.js'
    $settingsPath = Join-Path $installDir 'settings.json'

    if (-not (Test-Path -LiteralPath $installedJs)) { throw 'O golivebypass.js nao apareceu na pasta instalada.' }
    $installedCode = [IO.File]::ReadAllText($installedJs)
    if (-not $installedCode.Contains('viewer-video-parado') -or -not $installedCode.Contains('viewer-fast-udp-reconnect')) {
        throw 'A instalacao nao contem a recuperacao enhanced de viewer esperada.'
    }

    if (-not (Test-Path -LiteralPath $settingsPath)) { throw 'settings.json nao foi criado.' }
    $settings = Get-Content -LiteralPath $settingsPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($settings.routeMode -ne 'tor' -or $settings.torAddr -ne '127.0.0.1:9060') {
        throw "Modo Tor nao ficou configurado corretamente (routeMode=$($settings.routeMode), torAddr=$($settings.torAddr))."
    }

    if (-not (Test-Port 9060)) { throw 'Tor nao esta atendendo na porta 9060 depois da instalacao.' }

    $run = (Get-ItemProperty -Path $runKey -Name 'GoLiveBypassTor' -ErrorAction Stop).GoLiveBypassTor
    if ($run -notmatch '(?i)wscript\.exe' -or $run -notmatch '(?i)GoLiveBypassTor\.vbs') {
        throw "A inicializacao do Tor nao ficou oculta: $run"
    }

    # Remove duplicatas antigas SOMENTE quando apontam para a pasta Tor do GoLiveBypass.
    try {
        $props = Get-ItemProperty -Path $runKey -ErrorAction SilentlyContinue
        foreach ($p in $props.PSObject.Properties) {
            if ($p.Name -like 'PS*' -or $p.Name -eq 'GoLiveBypassTor' -or -not ($p.Value -is [string])) { continue }
            $v = [string]$p.Value
            if ($v -match '(?i)GoLiveBypass[\\/]Tor' -and $v -match '(?i)tor\.exe') {
                Remove-ItemProperty -Path $runKey -Name $p.Name -ErrorAction SilentlyContinue
                $legacyVisibleTor = $true
            }
        }
    } catch { }

    # Se a sessao atual nasceu de uma entrada antiga visivel, derruba APENAS o tor.exe
    # que vive na nossa pasta e o relanca oculto. Tor Browser/outros daemons nao sao tocados.
    if ($legacyVisibleTor) {
        $torExe = Join-Path $installDir 'Tor\tor\tor.exe'
        $torrc = Join-Path $installDir 'Tor\torrc'
        if ((Test-Path -LiteralPath $torExe) -and (Test-Path -LiteralPath $torrc)) {
            try {
                $target = [IO.Path]::GetFullPath($torExe)
                Get-CimInstance Win32_Process -Filter "Name='tor.exe'" -ErrorAction SilentlyContinue | ForEach-Object {
                    try {
                        if ($_.ExecutablePath -and [IO.Path]::GetFullPath($_.ExecutablePath) -eq $target) {
                            Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
                        }
                    } catch { }
                }
                Start-Sleep -Milliseconds 500
                Start-Process -FilePath $torExe -ArgumentList '-f', $torrc -WindowStyle Hidden
                for ($i = 0; $i -lt 20 -and -not (Test-Port 9060); $i++) { Start-Sleep -Milliseconds 500 }
                if (-not (Test-Port 9060)) { throw 'Tor nao voltou depois da migracao para o modo oculto.' }
                Write-Host '  [OK] Tor antigo visivel foi reiniciado em modo oculto.' -ForegroundColor Green
            } catch {
                throw "Falha ao migrar o Tor visivel para oculto: $($_.Exception.Message)"
            }
        }
    }

    Write-Host ''
    Write-Host '  [OK] Enhanced instalado e validado.' -ForegroundColor Green
    Write-Host '  [OK] Tor ativo em 127.0.0.1:9060.' -ForegroundColor Green
    Write-Host '  [OK] Proximo logon: Tor inicia invisivel, sem terminal.' -ForegroundColor Green

    if (-not $NoLaunch -and $runningBefore.Count -gt 0) {
        Start-Sleep -Milliseconds 700
        foreach ($name in $runningBefore) {
            if (Start-DiscordFlavour $name) {
                Write-Host "  [OK] $name reaberto." -ForegroundColor Green
            }
        }
    }

    Write-Host ''
    Write-Host '  Pronto.' -ForegroundColor White
} finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}
