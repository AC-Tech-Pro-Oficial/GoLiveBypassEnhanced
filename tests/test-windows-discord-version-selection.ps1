$ErrorActionPreference = 'Stop'

$repo = Split-Path -Parent $PSScriptRoot
$installer = Join-Path $repo 'installer\GoLiveBypass-Installer.ps1'
$tokens = $null
$errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($installer, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw "Installer PowerShell invalido: $($errors[0].Message)" }

foreach ($name in @('Test-DiscordResourcesReady', 'Get-DiscordResources', 'Get-InjectedPath', 'Restore-RecognizedModPatchBeforeReinject')) {
    $fn = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true)
    if (-not $fn) { throw "Funcao $name nao encontrada no instalador." }
    Invoke-Expression $fn.Extent.Text
}

$temp = Join-Path ([IO.Path]::GetTempPath()) ('golive-discord-selection-' + [guid]::NewGuid().ToString('N'))
$script:FakeLocalApp = $temp
$DiscordNames = @('Discord')
function Get-EffectiveLocalApp { return $script:FakeLocalApp }
function Write-Step([string]$message) { }
function Write-Ok([string]$message) { }
function Remove-CaminhoSilencioso([string]$path) {
    if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Recurse -Force }
}

try {
    $oldResources = Join-Path $temp 'Discord\app-1.0.100\resources'
    $newResources = Join-Path $temp 'Discord\app-1.0.200\resources'
    New-Item -ItemType Directory -Path $oldResources, $newResources -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $oldResources '_app.asar') -Value 'old backup'
    Set-Content -LiteralPath (Join-Path $newResources '_app.asar') -Value 'new backup'

    $found = @(Get-DiscordResources)
    if ($found.Count -ne 1) {
        throw "Esperava somente a versao ativa mais nova; recebi $($found.Count): $($found -join ', ')"
    }
    if ([IO.Path]::GetFullPath([string]$found[0]) -ne [IO.Path]::GetFullPath($newResources)) {
        throw "Versao selecionada incorreta: $($found[0])"
    }

    Remove-Item -LiteralPath (Join-Path $newResources '_app.asar') -Force
    $found = @(Get-DiscordResources)
    if ($found.Count -ne 1 -or [IO.Path]::GetFullPath([string]$found[0]) -ne [IO.Path]::GetFullPath($oldResources)) {
        throw 'Quando a versao mais nova esta incompleta, a mais nova utilizavel deve ser selecionada.'
    }

    # Equilotl writes a small binary asar containing the loader's require() near its tail.
    # Prove that the real parser identifies it and that checkout replacement restores only
    # a recognized Vencord/Equicord patch with a valid original backup.
    $activeResources = $newResources
    $oldLoader = Join-Path $temp 'Equicord\dist\desktop\patcher.js'
    $newRoot = Join-Path $temp 'Equicord-next'
    New-Item -ItemType Directory -Path (Split-Path -Parent $oldLoader), $newRoot -Force | Out-Null
    $loaderBytes = [Text.Encoding]::UTF8.GetBytes("binary-header`0require(`"$($oldLoader -replace '\\', '\\')`");")
    [IO.File]::WriteAllBytes((Join-Path $activeResources 'app.asar'), $loaderBytes)
    Set-Content -LiteralPath (Join-Path $activeResources '_app.asar') -Value 'original Discord asar'
    $parsed = Get-InjectedPath $activeResources
    if (-not $parsed -or -not $parsed.StartsWith((Split-Path -Parent (Split-Path -Parent $oldLoader)), [StringComparison]::OrdinalIgnoreCase)) {
        throw "Loader Equicord binario nao foi identificado: '$parsed'"
    }

    $target = [pscustomobject]@{ Tipo = 'O'; Flavour = 'Discord'; Resources = $activeResources }
    Restore-RecognizedModPatchBeforeReinject $newRoot @($target)
    if (Test-Path -LiteralPath (Join-Path $activeResources '_app.asar')) {
        throw '_app.asar deveria ter sido consumido pela restauracao segura.'
    }
    if ((Get-Content -LiteralPath (Join-Path $activeResources 'app.asar') -Raw).Trim() -ne 'original Discord asar') {
        throw 'A restauracao segura nao recolocou o app.asar original.'
    }

    $unknownLoader = Join-Path $temp 'OtherMod\dist\desktop\patcher.js'
    $unknownBytes = [Text.Encoding]::UTF8.GetBytes("binary-header`0require(`"$($unknownLoader -replace '\\', '\\')`");")
    [IO.File]::WriteAllBytes((Join-Path $activeResources 'app.asar'), $unknownBytes)
    Set-Content -LiteralPath (Join-Path $activeResources '_app.asar') -Value 'second original'
    $blocked = $false
    try { Restore-RecognizedModPatchBeforeReinject $newRoot @($target) } catch { $blocked = $_.Exception.Message -match 'mod desconhecido' }
    if (-not $blocked -or -not (Test-Path -LiteralPath (Join-Path $activeResources '_app.asar'))) {
        throw 'Patch desconhecido deve falhar fechado e preservar o backup.'
    }

    Write-Host 'Windows Discord version selection: OK'
} finally {
    Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue
}
