# GoLiveBypassEnhanced - Windows one-click installer / migration
#
# Safe architecture:
#   Discord + Vencord/Equicord + enhanced GoLiveBypass userplugin + local Tor
#
# This wrapper preserves the selected mod and its settings. It can also undo the
# older enhanced standalone injection before installing the userplugin.

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

function Show-KingcirSignature {
    $fallbackWidth = 24
    $fallbackHeight = 5
    $width = $fallbackWidth
    $height = $fallbackHeight
    $interactiveViewport = $false

    try {
        # Em um console real, usa a area visivel inteira. Em pipe/CI/host sem viewport,
        # Console.WindowWidth/Height pode lançar ou devolver valores estranhos; nesse caso
        # o splash compacto continua funcionando sem poluir centenas de linhas de log.
        if (-not [Console]::IsOutputRedirected) {
            $candidateWidth = [Console]::WindowWidth
            $candidateHeight = [Console]::WindowHeight
            if ($candidateWidth -ge 12 -and $candidateHeight -ge 5) {
                $width = $candidateWidth
                $height = $candidateHeight
                $interactiveViewport = $true
            }
        }
    } catch { }

    $label = 'KINGCIR'
    $innerWidth = [Math]::Max(1, $width - 2)
    $labelWidth = [Math]::Min($label.Length, $innerWidth)
    $visibleLabel = $label.Substring(0, $labelWidth)
    $left = [Math]::Floor(($innerWidth - $visibleLabel.Length) / 2)
    $right = $innerWidth - $visibleLabel.Length - $left
    $middleRow = [Math]::Floor(($height - 1) / 2)

    if ($interactiveViewport) {
        try { Clear-Host } catch { }
    }

    for ($row = 0; $row -lt $height; $row++) {
        if ($row -eq 0 -or $row -eq ($height - 1)) {
            $line = '#' * $width
        } elseif ($row -eq $middleRow) {
            $line = '#' + (' ' * $left) + $visibleLabel + (' ' * $right) + '#'
        } else {
            $line = '#' + (' ' * $innerWidth) + '#'
        }
        Write-Host $line -ForegroundColor Magenta
    }

    Start-Sleep -Seconds 2

    if ($interactiveViewport) {
        try { Clear-Host } catch { }
    }
}

Show-KingcirSignature

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
        }

        $legacyIndex = Join-Path $resources 'app\index.js'
        if (Test-Path -LiteralPath $legacyIndex -PathType Leaf) {
            return [IO.File]::ReadAllText($legacyIndex)
        }
    } catch { }

    return ''
}

function Read-BackupInjectionText([string]$resources) {
    try {
        $backup = Join-Path $resources '_app.asar'
        if (-not (Test-Path -LiteralPath $backup -PathType Leaf)) { return '' }
        $item = Get-Item -LiteralPath $backup
        if ($item.Length -gt 65536) { return '' }
        return [IO.File]::ReadAllText($backup)
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

function Test-ModCheckout([string]$path) {
    if (-not $path -or -not (Test-Path -LiteralPath $path)) { return $false }
    return (Test-Path -LiteralPath (Join-Path $path 'package.json')) -and
        (Test-Path -LiteralPath (Join-Path $path 'src\utils\types.ts'))
}

function Get-ModSettingsPath([string]$name) {
    $override = [Environment]::GetEnvironmentVariable("$($name.ToUpper())_USER_DATA_DIR")
    if ($override) { return (Join-Path $override 'settings\settings.json') }
    return (Join-Path (Get-EffectiveRoamingApp) "$name\settings\settings.json")
}

function Find-ModCheckout([string]$name) {
    foreach ($target in Get-DiscordResources) {
        $injected = Get-InjectedPath $target.Resources
        if (-not $injected) { continue }
        if ($injected -notmatch "(?i)$name") { continue }

        $root = Split-Path -Parent (Split-Path -Parent $injected)
        if (Test-ModCheckout $root) { return $root }
    }

    if ($env:USERPROFILE) {
        foreach ($candidate in @(
            (Join-Path $env:USERPROFILE $name),
            (Join-Path $env:USERPROFILE "Documents\$name"),
            (Join-Path $env:USERPROFILE "Desktop\$name"),
            (Join-Path $env:USERPROFILE "dev\$name"),
            (Join-Path $env:USERPROFILE "repos\$name")
        )) {
            if (Test-ModCheckout $candidate) { return $candidate }
        }
    }

    return $null
}

function Detect-Mod {
    if ($Mod -ne 'Auto') { return $Mod }

    $scores = @{ Equicord = 0; Vencord = 0 }
    $settingsTimes = @{ Equicord = [datetime]::MinValue; Vencord = [datetime]::MinValue }

    foreach ($target in Get-DiscordResources) {
        $text = Read-InjectionText $target.Resources
        if ($text -match '(?i)equicord') { $scores.Equicord += 1000 }
        if ($text -match '(?i)vencord') { $scores.Vencord += 1000 }

        # Se um standalone antigo estiver na frente, _app.asar normalmente e o stub
        # do Vencord/Equicord que ele substituiu. Use isso antes de timestamps.
        if ($text -match '(?i)golivebypass\.js') {
            $backupText = Read-BackupInjectionText $target.Resources
            if ($backupText -match '(?i)equicord') { $scores.Equicord += 1200 }
            if ($backupText -match '(?i)vencord') { $scores.Vencord += 1200 }
        }
    }

    foreach ($name in @('Equicord', 'Vencord')) {
        $settings = Get-ModSettingsPath $name
        if (Test-Path -LiteralPath $settings) {
            $scores[$name] += 200
            $settingsTimes[$name] = (Get-Item -LiteralPath $settings).LastWriteTimeUtc
        }

        if (Find-ModCheckout $name) { $scores[$name] += 100 }
    }

    if ($scores.Equicord -gt $scores.Vencord) { return 'Equicord' }
    if ($scores.Vencord -gt $scores.Equicord) { return 'Vencord' }
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
    if ($targets.Count -eq 0) { return }

    Write-Host '  [*] Migrando a injecao standalone anterior para o userplugin...' -ForegroundColor Cyan
    Stop-Discord

    foreach ($target in $targets) {
        $asar = Join-Path $target.Resources 'app.asar'
        $backup = Join-Path $target.Resources '_app.asar'

        Remove-Item -LiteralPath $asar -Recurse -Force
        Rename-Item -LiteralPath $backup -NewName 'app.asar' -Force

        Write-Host "  [OK] $($target.Name): app.asar anterior restaurado." -ForegroundColor Green
    }
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
        throw "O settings.json do $name nao e JSON valido. Backup: $backup"
    }

    Write-Host "  [OK] Backup das configuracoes do $($name): $backup" -ForegroundColor Green
    return [pscustomobject]@{ Path = $settings; Backup = $backup; PluginNames = $names }
}

function Restore-ModSettings($snapshot) {
    if (-not $snapshot.Backup -or -not (Test-Path -LiteralPath $snapshot.Backup)) { return }

    New-Item -ItemType Directory -Path (Split-Path -Parent $snapshot.Path) -Force | Out-Null
    Copy-Item -LiteralPath $snapshot.Backup -Destination $snapshot.Path -Force
}

function Verify-SettingsPreserved($snapshot) {
    if (-not (Test-Path -LiteralPath $snapshot.Path)) {
        throw 'O arquivo de configuracoes do mod desapareceu.'
    }

    $json = Get-Content -LiteralPath $snapshot.Path -Raw -Encoding UTF8 | ConvertFrom-Json
    if (-not $json.plugins) { throw 'A secao de plugins do mod desapareceu.' }

    $afterNames = @($json.plugins.PSObject.Properties.Name)
    foreach ($name in $snapshot.PluginNames) {
        # Aliases antigos do proprio GoLiveBypass sao removidos de proposito.
        $legacyAlias = $name -ne 'GoLiveBypass' -and (
            $name -eq 'GoLiveBypassEnhanced' -or
            $name -eq 'GoLiveBypassLegacy' -or
            $name -eq 'GoLiveBypassStandalone'
        )
        if ($legacyAlias) { continue }

        if ($afterNames -notcontains $name) {
            throw "O plugin preexistente '$name' sumiu das configuracoes."
        }
    }

    $glb = $json.plugins.GoLiveBypass
    if (-not $glb -or $glb.enabled -ne $true) {
        throw 'GoLiveBypass nao ficou ativado no mod.'
    }
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
                throw "$($target.Name) ainda esta usando a injecao standalone."
            }
        }

        $injected = Get-InjectedPath $target.Resources
        if (-not $injected -or $injected -notmatch "(?i)$name") { continue }

        $root = Split-Path -Parent (Split-Path -Parent $injected)
        if (-not (Test-ModCheckout $root)) { continue }

        $plugin = Join-Path $root 'src\userplugins\goLiveBypass'
        foreach ($needed in @('index.tsx', 'native.ts', 'rtcRecovery.ts', 'rtcShim.ts', 'manifest.json')) {
            if (-not (Test-Path -LiteralPath (Join-Path $plugin $needed))) {
                throw "O build do $name nao recebeu $needed."
            }
        }

        $manifest = Get-Content -LiteralPath (Join-Path $plugin 'manifest.json') -Raw | ConvertFrom-Json
        if ($manifest.updater.id -ne 'AC-Tech-Pro-Oficial/GoLiveBypassEnhanced') {
            throw 'O plugin instalado aponta o updater para uma origem incorreta.'
        }

        $ok = $true
    }

    if (-not $ok) {
        throw "Nao consegui confirmar a reinjecao do $name com o plugin enhanced."
    }
}

function Try-RepairModInjection([string]$name) {
    $root = Find-ModCheckout $name
    if (-not $root) { return }

    try {
        Stop-Discord
        Push-Location -LiteralPath $root
        try {
            foreach ($target in Get-DiscordResources) {
                $loc = Split-Path -Parent (Split-Path -Parent $target.Resources)
                & pnpm run inject -- --location $loc
                if ($LASTEXITCODE -ne 0) { & pnpm inject }
            }
        } finally {
            Pop-Location
        }

        Write-Host "  [OK] $name reinjetado durante o rollback." -ForegroundColor Green
    } catch {
        Write-Host "  [!] Nao consegui confirmar a reinjecao do $($name): $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

Write-Host ''
Write-Host '  GoLiveBypassEnhanced' -ForegroundColor Magenta
Write-Host '  Vencord/Equicord preservado + Tor validado + RTC recovery' -ForegroundColor DarkGray
Write-Host ''

$selected = Detect-Mod
Write-Host "  [*] Mod escolhido: $selected" -ForegroundColor Cyan

$snapshot = Backup-ModSettings $selected
$work = Join-Path ([IO.Path]::GetTempPath()) 'GoLiveBypassEnhanced-oneclick'
New-Item -ItemType Directory -Path $work -Force | Out-Null
$installer = Join-Path $work 'GoLiveBypass-Installer.ps1'

try {
    # A restauracao/migracao de standalone agora e feita pelo instalador canonico,
    # que consegue registrar a causa e normalizar settings/native state na mesma transacao.
    Write-Host '  [*] Inventariando instalacoes anteriores no instalador canonico...' -ForegroundColor Cyan

    Write-Host '  [*] Baixando o instalador enhanced do userplugin...' -ForegroundColor Cyan
    Invoke-WebRequest -UseBasicParsing -Uri "$RepoRaw/installer/GoLiveBypass-Installer.ps1" -OutFile $installer
    if ((Get-Item -LiteralPath $installer).Length -lt 50000) {
        throw 'Download do instalador veio incompleto.'
    }

    $installerText = [IO.File]::ReadAllText($installer)
    foreach ($required in @(
        'goLiveBypass/rtcRecovery.ts',
        'goLiveBypass/rtcShim.ts',
        'Test-TorGatewayTunnel',
        'AC-Tech-Pro-Oficial/GoLiveBypassEnhanced'
    )) {
        if (-not $installerText.Contains($required)) {
            throw "Instalador baixado nao contem o contrato enhanced esperado: $required"
        }
    }

    Write-Host "  [*] Instalando dependencias, $selected, plugin enhanced e Tor..." -ForegroundColor Cyan
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installer -Mode Install -Mod $selected -Tor -Yes
    if ($LASTEXITCODE -ne 0) {
        throw "O instalador do userplugin terminou com codigo $LASTEXITCODE."
    }

    Verify-SettingsPreserved $snapshot
    Verify-ModInjection $selected

    $runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
    $run = (Get-ItemProperty -Path $runKey -Name 'GoLiveBypassTor' -ErrorAction Stop).GoLiveBypassTor
    if ($run -notmatch '(?i)wscript\.exe' -or $run -notmatch '(?i)GoLiveBypassTor\.vbs') {
        throw "A inicializacao persistente do Tor nao ficou invisivel: $run"
    }

    Write-Host ''
    Write-Host '  [OK] Instalacao enhanced concluida.' -ForegroundColor Green
    Write-Host "  [OK] $selected e os plugins/configuracoes preexistentes foram preservados." -ForegroundColor Green
    Write-Host '  [OK] GoLiveBypass roda como userplugin, nao como substituto do mod.' -ForegroundColor Green
    Write-Host '  [OK] Tor passou SOCKS5 + TLS ate gateway.discord.gg.' -ForegroundColor Green
    Write-Host '  [OK] Tor inicia invisivel nos proximos logons.' -ForegroundColor Green
    Write-Host ''

    Start-Discord
} catch {
    Write-Host ''
    Write-Host "  [X] Instalacao abortada: $($_.Exception.Message)" -ForegroundColor Red

    try {
        Stop-Discord
        Restore-ModSettings $snapshot
        Write-Host '  [OK] Configuracoes anteriores do mod restauradas do backup.' -ForegroundColor Green
    } catch {
        Write-Host "  [!] Falha ao restaurar settings.json: $($_.Exception.Message)" -ForegroundColor Yellow
    }

    Try-RepairModInjection $selected
    try { Start-Discord } catch { }
    throw
} finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}
