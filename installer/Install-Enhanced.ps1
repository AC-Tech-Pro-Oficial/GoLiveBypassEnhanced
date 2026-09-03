# GoLiveBypassEnhanced - Windows one-click installer / migration
#
# Safe default architecture:
#   Discord + existing/new Vencord/Equicord + enhanced GoLiveBypass userplugin + Tor
#
# It never intentionally replaces Vencord/Equicord with the standalone injector and
# never falls back to a public proxy.

[CmdletBinding()]
param(
    [ValidateSet('Auto', 'Equicord', 'Vencord')]
    [string] $Mod = 'Auto',

    [switch] $NoLaunch
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$RepoRaw = 'https://raw.githubusercontent.com/AC-Tech-Pro-Oficial/GoLiveBypassEnhanced/enhanced/rtc-viewer-recovery-v1'
$DiscordNames = @('Discord', 'DiscordPTB', 'DiscordCanary')

function Get-EffectiveLocalApp {
    if ($env:LOCALAPPDATA -and (Test-Path -LiteralPath $env:LOCALAPPDATA)) { return $env:LOCALAPPDATA }
    try {
        $p = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
        if ($p -and (Test-Path -LiteralPath $p)) { return $p }
    } catch { }
    if ($env:USERPROFILE) { return (Join-Path $env:USERPROFILE 'AppData\Local') }
    throw 'Nao consegui localizar LOCALAPPDATA.'
}

function Get-EffectiveRoamingApp {
    if ($env:APPDATA -and (Test-Path -LiteralPath $env:APPDATA)) { return $env:APPDATA }
    try {
        $p = [Environment]::GetFolderPath([Environment+SpecialFolder]::ApplicationData)
        if ($p -and (Test-Path -LiteralPath $p)) { return $p }
    } catch { }
    if ($env:USERPROFILE) { return (Join-Path $env:USERPROFILE 'AppData\Roaming') }
    throw 'Nao consegui localizar APPDATA.'
}

function Get-DiscordResources {
    $found = @()
    $local = Get-EffectiveLocalApp
    foreach ($name in $DiscordNames) {
        $root = Join-Path $local $name
        if (-not (Test-Path -LiteralPath $root)) { continue }

        $versions = Get-ChildItem -LiteralPath $root -Directory -Filter 'app-*' -ErrorAction SilentlyContinue |
            Sort-Object -Descending -Property @{ Expression = {
                try { [version]($_.Name -replace '^app-', '') } catch { [version]'0.0.0' }
            } }

        foreach ($version in $versions) {
            $resources = Join-Path $version.FullName 'resources'
            if ((Test-Path -LiteralPath (Join-Path $resources 'app.asar')) -or
                (Test-Path -LiteralPath (Join-Path $resources '_app.asar'))) {
                $found += [pscustomobject]@{ Name = $name; Resources = $resources }
                break
            }
        }
    }
    return $found
}

function Read-InjectionText([string]$resources) {
    try {
        $asar = Join-Path $resources 'app.asar'
        $dirIndex = Join-Path $asar 'index.js'
        if (Test-Path -LiteralPath $dirIndex -PathType Leaf) {
            return [IO.File]::ReadAllText($dirIndex)
        }

        if (Test-Path -LiteralPath $asar -PathType Leaf) {
            $item = Get-Item -LiteralPath $asar
            if ($item.Length -le 65536) { return [IO.File]::ReadAllText($asar) }
            [byte[]]$bytes = [IO.File]::ReadAllBytes($asar)
            $take = [Math]::Min(65536, $bytes.Length)
            return [Text.Encoding]::UTF8.GetString($bytes, 0, $take)
        }

        $legacyIndex = Join-Path $resources 'app\index.js'
        if (Test-Path -LiteralPath $legacyIndex -PathType Leaf) {
            return [IO.File]::ReadAllText($legacyIndex)
        }
    } catch { }
    return ''
}

function Get-InjectedPath([string]$resources) {
    $text = Read-InjectionText $resources
    if (-not $text) { return $null }
    $match = [regex]::Match($text, 'require\("(.+?)"\)')
    if ($match.Success) { return $match.Groups[1].Value -replace '\\\\', '\' }
    return $null
}

function Get-ModSettingsPath([string]$name) {
    $override = [Environment]::GetEnvironmentVariable("$($name.ToUpper())_USER_DATA_DIR")
    if ($override) { return (Join-Path $override 'settings\settings.json') }
    return (Join-Path (Get-EffectiveRoamingApp) "$name\settings\settings.json")
}

function Test-ModCheckout([string]$path) {
    if (-not $path -or -not (Test-Path -LiteralPath $path)) { return $false }
    return (Test-Path -LiteralPath (Join-Path $path 'package.json')) -and
        (Test-Path -LiteralPath (Join-Path $path 'src\utils\types.ts'))
}

function Detect-Mod {
    if ($Mod -ne 'Auto') { return $Mod }

    $scores = @{ Equicord = 0; Vencord = 0 }
    $settingsTimes = @{ Equicord = [datetime]::MinValue; Vencord = [datetime]::MinValue }

    # Strongest signal: what Discord is currently injected with.
    foreach ($target in Get-DiscordResources) {
        $text = Read-InjectionText $target.Resources
        if ($text -match '(?i)equicord') { $scores.Equicord += 1000 }
        if ($text -match '(?i)vencord') { $scores.Vencord += 1000 }
    }

    foreach ($name in @('Equicord', 'Vencord')) {
        $settings = Get-ModSettingsPath $name
        if (Test-Path -LiteralPath $settings) {
            $scores[$name] += 200
            $settingsTimes[$name] = (Get-Item -LiteralPath $settings).LastWriteTimeUtc
        }

        $checkout = Join-Path $env:USERPROFILE $name
        if (Test-ModCheckout $checkout) { $scores[$name] += 100 }
    }

    if ($scores.Equicord -gt $scores.Vencord) { return 'Equicord' }
    if ($scores.Vencord -gt $scores.Equicord) { return 'Vencord' }

    # If both have remnants, the settings file touched most recently is the least
    # destructive tie-breaker. With no evidence at all, install Equicord (project default).
    if ($settingsTimes.Vencord -gt $settingsTimes.Equicord) { return 'Vencord' }
    return 'Equicord'
}

function Stop-Discord {
    Get-Process -Name $DiscordNames -ErrorAction SilentlyContinue |
        Stop-Process -Force -ErrorAction SilentlyContinue

    for ($i = 0; $i -lt 40; $i++) {
        if (-not (Get-Process -Name $DiscordNames -ErrorAction SilentlyContinue)) { return }
        Start-Sleep -Milliseconds 250
    }
    throw 'O Discord nao fechou; feche pelo icone da bandeja e rode novamente.'
}

function Start-Discord {
    if ($NoLaunch) { return }
    $local = Get-EffectiveLocalApp
    foreach ($name in $DiscordNames) {
        $update = Join-Path $local "$name\Update.exe"
        if (Test-Path -LiteralPath $update) {
            Start-Process -FilePath $update -ArgumentList '--processStart', "$name.exe"
            return
        }
    }
}

function Get-StandaloneTargets {
    $targets = @()
    foreach ($target in Get-DiscordResources) {
        $asar = Join-Path $target.Resources 'app.asar'
        $index = Join-Path $asar 'index.js'
        $backup = Join-Path $target.Resources '_app.asar'
        if ((Test-Path -LiteralPath $asar -PathType Container) -and
            (Test-Path -LiteralPath $index -PathType Leaf) -and
            (Test-Path -LiteralPath $backup)) {
            try {
                if ([IO.File]::ReadAllText($index).Contains('golivebypass.js')) {
                    $targets += $target
                }
            } catch { }
        }
    }
    return $targets
}

function Restore-AccidentalStandalone {
    $targets = @(Get-StandaloneTargets)
    if ($targets.Count -eq 0) { return $false }

    Write-Host '  [*] Migrando a instalacao standalone para o userplugin (preserva Vencord/Equicord)...' -ForegroundColor Cyan
    Stop-Discord

    foreach ($target in $targets) {
        $asar = Join-Path $target.Resources 'app.asar'
        $backup = Join-Path $target.Resources '_app.asar'
        Remove-Item -LiteralPath $asar -Recurse -Force
        Rename-Item -LiteralPath $backup -NewName 'app.asar' -Force
        Write-Host "  [OK] $($target.Name): standalone removido; Discord original restaurado antes da reinjecao." -ForegroundColor Green
    }

    return $true
}

function Backup-ModSettings([string]$name) {
    $settings = Get-ModSettingsPath $name
    if (-not (Test-Path -LiteralPath $settings)) {
        return [pscustomobject]@{ Path = $settings; Backup = $null; PluginNames = @() }
    }

    $dir = Join-Path (Get-EffectiveLocalApp) 'GoLiveBypass\backups'
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
    $backup = Join-Path $dir "$name-settings-before-enhanced-$(Get-Date -Format 'yyyyMMdd-HHmmss').json"
    Copy-Item -LiteralPath $settings -Destination $backup -Force

    $names = @()
    try {
        $json = Get-Content -LiteralPath $settings -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($json.plugins) { $names = @($json.plugins.PSObject.Properties.Name) }
    } catch {
        throw "O settings.json do $name existe mas nao e JSON valido. Nao vou reescrever suas configuracoes. Backup: $backup"
    }

    Write-Host "  [OK] Backup das configuracoes do ${name}: $backup" -ForegroundColor Green
    return [pscustomobject]@{ Path = $settings; Backup = $backup; PluginNames = $names }
}

function Verify-SettingsPreserved($snapshot) {
    if (-not (Test-Path -LiteralPath $snapshot.Path)) { throw 'O arquivo de configuracoes do mod desapareceu.' }
    $json = Get-Content -LiteralPath $snapshot.Path -Raw -Encoding UTF8 | ConvertFrom-Json
    if (-not $json.plugins) { throw 'A secao de plugins do mod desapareceu.' }

    $afterNames = @($json.plugins.PSObject.Properties.Name)
    foreach ($name in $snapshot.PluginNames) {
        if ($afterNames -notcontains $name) {
            throw "O plugin preexistente '$name' sumiu das configuracoes."
        }
    }

    $glb = $json.plugins.GoLiveBypass
    if (-not $glb -or $glb.enabled -ne $true) { throw 'GoLiveBypass nao ficou ativado no mod.' }
    if ($glb.proxy -ne 'socks5://127.0.0.1:9060') {
        throw "GoLiveBypass nao ficou preso ao Tor local (proxy=$($glb.proxy))."
    }
}

function Verify-ModInjection([string]$name) {
    $ok = $false
    foreach ($target in Get-DiscordResources) {
        $asar = Join-Path $target.Resources 'app.asar'
        $standaloneIndex = Join-Path $asar 'index.js'
        if ((Test-Path -LiteralPath $asar -PathType Container) -and
            (Test-Path -LiteralPath $standaloneIndex -PathType Leaf)) {
            $text = [IO.File]::ReadAllText($standaloneIndex)
            if ($text.Contains('golivebypass.js')) {
                throw "$($target.Name) ainda esta com a injecao standalone; isso removeria os plugins do mod."
            }
        }

        $injected = Get-InjectedPath $target.Resources
        if ($injected -and $injected -match "(?i)$name") {
            $root = Split-Path -Parent (Split-Path -Parent $injected)
            if (Test-ModCheckout $root) {
                $plugin = Join-Path $root 'src\userplugins\goLiveBypass'
                foreach ($needed in @('index.tsx', 'native.ts', 'rtcRecovery.ts', 'rtcShim.ts', 'manifest.json')) {
                    if (-not (Test-Path -LiteralPath (Join-Path $plugin $needed))) {
                        throw "O build do $name nao recebeu $needed."
                    }
                }
                $manifest = Get-Content -LiteralPath (Join-Path $plugin 'manifest.json') -Raw | ConvertFrom-Json
                if ($manifest.updater.id -ne 'AC-Tech-Pro-Oficial/GoLiveBypassEnhanced') {
                    throw 'O plugin instalado ainda aponta o updater para outra origem.'
                }
                $ok = $true
            }
        }
    }

    if (-not $ok) { throw "Nao consegui confirmar que $name foi reinjetado com o plugin enhanced." }
}

Write-Host ''
Write-Host '  GoLiveBypassEnhanced' -ForegroundColor Magenta
Write-Host '  Vencord/Equicord preservado + Tor validado + RTC recovery' -ForegroundColor DarkGray
Write-Host ''

$selected = Detect-Mod
Write-Host "  [*] Mod escolhido: $selected" -ForegroundColor Cyan

$snapshot = Backup-ModSettings $selected
$migratedStandalone = $false
$work = Join-Path ([IO.Path]::GetTempPath()) 'GoLiveBypassEnhanced-oneclick'
New-Item -ItemType Directory -Path $work -Force | Out-Null
$installer = Join-Path $work 'GoLiveBypass-Installer.ps1'

try {
    $migratedStandalone = Restore-AccidentalStandalone

    Write-Host '  [*] Baixando o instalador enhanced do userplugin...' -ForegroundColor Cyan
    Invoke-WebRequest -UseBasicParsing -Uri "$RepoRaw/installer/GoLiveBypass-Installer.ps1" -OutFile $installer
    if ((Get-Item -LiteralPath $installer).Length -lt 50000) { throw 'Download do instalador veio incompleto.' }

    $installerText = [IO.File]::ReadAllText($installer)
    foreach ($required in @(
        'goLiveBypass/rtcRecovery.ts',
        'goLiveBypass/rtcShim.ts',
        'Test-TorGatewayTunnel',
        'AC-Tech-Pro-Oficial/GoLiveBypassEnhanced'
    )) {
        if (-not $installerText.Contains($required)) { throw "Instalador baixado nao contem o contrato enhanced esperado: $required" }
    }

    Write-Host '  [*] Instalando dependencias, $selected, plugin enhanced e Tor...' -ForegroundColor Cyan
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installer -Mode Install -Mod $selected -Tor -Yes
    if ($LASTEXITCODE -ne 0) { throw "O instalador do userplugin terminou com codigo $LASTEXITCODE." }

    Verify-SettingsPreserved $snapshot
    Verify-ModInjection $selected

    $runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
    $run = (Get-ItemProperty -Path $runKey -Name 'GoLiveBypassTor' -ErrorAction Stop).GoLiveBypassTor
    if ($run -notmatch '(?i)wscript\.exe' -or $run -notmatch '(?i)GoLiveBypassTor\.vbs') {
        throw "A inicializacao persistente do Tor nao ficou invisivel: $run"
    }

    Write-Host ''
    Write-Host '  [OK] Instalacao enhanced concluida.' -ForegroundColor Green
    Write-Host "  [OK] $selected e seus plugins/configuracoes foram preservados." -ForegroundColor Green
    Write-Host '  [OK] GoLiveBypass roda como userplugin, sem substituir app.asar pelo standalone.' -ForegroundColor Green
    Write-Host '  [OK] Tor so foi aceito depois de SOCKS5 + TLS ate gateway.discord.gg.' -ForegroundColor Green
    Write-Host '  [OK] Tor inicia invisivel nos proximos logons.' -ForegroundColor Green
    Write-Host ''
} catch {
    Write-Host ''
    Write-Host "  [X] Instalacao abortada: $($_.Exception.Message)" -ForegroundColor Red

    if ($snapshot.Backup -and (Test-Path -LiteralPath $snapshot.Backup)) {
        try {
            Stop-Discord
            New-Item -ItemType Directory -Path (Split-Path -Parent $snapshot.Path) -Force | Out-Null
            Copy-Item -LiteralPath $snapshot.Backup -Destination $snapshot.Path -Force
            Write-Host '  [OK] Configuracoes anteriores do mod restauradas do backup.' -ForegroundColor Green
        } catch {
            Write-Host "  [!] Nao consegui restaurar automaticamente o settings.json: $($_.Exception.Message)" -ForegroundColor Yellow
        }
    }

    try { Start-Discord } catch { }
    throw
} finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}
