# PowerShell test script for error handling and null-safety validation
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
if (-not $repoRoot) { $repoRoot = (Get-Location).Path }

$installerPath = Join-Path $repoRoot 'installer\GoLiveBypass-Installer.ps1'
$standalonePath = Join-Path $repoRoot 'standalone\GoLiveBypass-Standalone.ps1'

# Garante UTF-8 com BOM para compatibilidade com o parser do Windows PowerShell 5.1
$utf8Bom = New-Object System.Text.UTF8Encoding($true)
foreach ($f in @($installerPath, $standalonePath)) {
    if (Test-Path -LiteralPath $f) {
        $text = [System.IO.File]::ReadAllText($f, [System.Text.Encoding]::UTF8)
        [System.IO.File]::WriteAllText($f, $text, $utf8Bom)
    }
}

Write-Host "`n========================================================" -ForegroundColor Cyan
Write-Host " 1. Validando Sintaxe dos Scripts PowerShell" -ForegroundColor Cyan
Write-Host "========================================================" -ForegroundColor Cyan

function Test-ScriptSyntax($path) {
    $tokens = $null
    $errors = $null
    [System.Management.Automation.Language.Parser]::ParseFile($path, [ref]$tokens, [ref]$errors) | Out-Null
    if ($errors.Count -gt 0) {
        Write-Host "  [FAIL] $path possui erros de sintaxe:" -ForegroundColor Red
        $errors | ForEach-Object { Write-Host "    Linha $($_.Extent.StartLineNumber): $($_.Message)" }
        return $false
    }
    Write-Host "  [OK] $($path | Split-Path -Leaf) - Sintaxe valida" -ForegroundColor Green
    return $true
}

$syntaxOk1 = Test-ScriptSyntax $installerPath
$syntaxOk2 = Test-ScriptSyntax $standalonePath
if (-not $syntaxOk1 -or -not $syntaxOk2) {
    exit 1
}

Write-Host "`n========================================================" -ForegroundColor Cyan
Write-Host " 2. Carregando e Testando Funcoes" -ForegroundColor Cyan
Write-Host "========================================================" -ForegroundColor Cyan

# Carrega funcoes do instalador
$installerContent = Get-Content -LiteralPath $installerPath -Raw
$idx = $installerContent.LastIndexOf("Show-Banner")
$truncatedInstaller = $installerContent.Substring(0, $idx)
$tempInstaller = Join-Path ([System.IO.Path]::GetTempPath()) "test-temp-installer.ps1"
Set-Content -LiteralPath $tempInstaller -Value $truncatedInstaller -Encoding UTF8
. $tempInstaller

# Salva referencia para Test-ShouldReport do instalador
$installerShouldReport = ${function:Test-ShouldReport}

# Carrega funcoes do standalone
$standaloneContent = Get-Content -LiteralPath $standalonePath -Raw
$idx2 = $standaloneContent.IndexOf("Write-Host ''`nWrite-Host '  GoLiveBypass standalone'")
if ($idx2 -lt 0) { $idx2 = $standaloneContent.IndexOf("Write-Host ''`r`nWrite-Host '  GoLiveBypass standalone'") }
$truncatedStandalone = $standaloneContent.Substring(0, $idx2)
$tempStandalone = Join-Path ([System.IO.Path]::GetTempPath()) "test-temp-standalone.ps1"
Set-Content -LiteralPath $tempStandalone -Value $truncatedStandalone -Encoding UTF8
. $tempStandalone

$standaloneShouldReport = ${function:Test-ShouldReport}

$pass = 0
$fail = 0

function Assert-Equal($actual, $expected, $desc) {
    if ($actual -eq $expected) {
        $script:pass++
        Write-Host "  [OK] $desc (Resultado: $actual)" -ForegroundColor Green
    } else {
        $script:fail++
        Write-Host "  [FAIL] $desc (Esperado: $expected, Obtido: $actual)" -ForegroundColor Red
    }
}

Write-Host "`n-- 2.1 Test-ShouldReport (Instalador e Standalone) --" -ForegroundColor Yellow

$testMessages = @(
    # Mensagens que NAO devem reportar (retornam $false)
    @{ Msg = "Não é possível associar o argumento ao parâmetro 'Path' porque ele é nulo."; Expected = $false; Desc = "PT-BR com acentos (erro da issue)" },
    @{ Msg = "Nao e possivel associar o argumento ao parametro 'Path' porque ele e nulo."; Expected = $false; Desc = "PT-BR sem acentos" },
    @{ Msg = "Não é possível associar o argumento ao parâmetro 'LiteralPath' porque ele é uma cadeia de caracteres vazia."; Expected = $false; Desc = "PT-BR cadeia de caracteres vazia" },
    @{ Msg = "Cannot bind argument to parameter 'Path' because it is null."; Expected = $false; Desc = "EN parameter is null" },
    @{ Msg = "Cannot bind argument to parameter 'Path' because it is an empty string."; Expected = $false; Desc = "EN parameter empty string" },
    @{ Msg = "A operacao foi cancelada pelo usuario."; Expected = $false; Desc = "Cancelado pelo usuario PT" },
    @{ Msg = "A operação foi cancelada pelo usuário."; Expected = $false; Desc = "Cancelado pelo usuário acentuado" },
    @{ Msg = "The operation was canceled by the user."; Expected = $false; Desc = "Canceled by user EN" },
    @{ Msg = "Illegal characters in path."; Expected = $false; Desc = "Illegal characters" },
    @{ Msg = "O Discord nao fechou. Feche pelo icone na bandeja e rode de novo."; Expected = $false; Desc = "Discord nao fechou" },
    @{ Msg = "Opcao desconhecida: --foo"; Expected = $false; Desc = "Opcao desconhecida" },
    @{ Msg = "git clone falhou"; Expected = $false; Desc = "git clone falhou" },
    
    # Mensagens que DEVEM reportar (retornam $true)
    @{ Msg = "NullReferenceException: Object reference not set to an instance of an object."; Expected = $true; Desc = "Excecao inesperada" },
    @{ Msg = "Erro desconhecido ao processar pacote asar."; Expected = $true; Desc = "Erro desconhecido" }
)

foreach ($t in $testMessages) {
    $resInst = & $installerShouldReport $t.Msg
    Assert-Equal $resInst $t.Expected "Installer Test-ShouldReport: $($t.Desc)"
    
    $resStand = & $standaloneShouldReport $t.Msg
    Assert-Equal $resStand $t.Expected "Standalone Test-ShouldReport: $($t.Desc)"
}

Write-Host "`n-- 2.2 Null/Empty Safety em Funcoes Auxiliares --" -ForegroundColor Yellow

# Test-DiscordResourcesReady
Assert-Equal (Test-DiscordResourcesReady $null) $false "Test-DiscordResourcesReady($null) retorna $false"
Assert-Equal (Test-DiscordResourcesReady "") $false "Test-DiscordResourcesReady('') retorna $false"

# Get-InjectedPath
Assert-Equal (Get-InjectedPath $null) $null "Get-InjectedPath($null) retorna $null"
Assert-Equal (Get-InjectedPath "") $null "Get-InjectedPath('') retorna $null"

# Test-InjectedFromCheckout
Assert-Equal (Test-InjectedFromCheckout $null) $false "Test-InjectedFromCheckout($null) retorna $false"
Assert-Equal (Test-InjectedFromCheckout "") $false "Test-InjectedFromCheckout('') retorna $false"

# Get-InstalledPluginVersion
Assert-Equal (Get-InstalledPluginVersion $null) $null "Get-InstalledPluginVersion($null) retorna $null"
Assert-Equal (Get-InstalledPluginVersion "") $null "Get-InstalledPluginVersion('') retorna $null"

# Backup-Plugin
try {
    Backup-Plugin $null
    Assert-Equal $true $true "Backup-Plugin($null) nao lanca excecao"
} catch {
    Assert-Equal $false $true "Backup-Plugin($null) lancou excecao: $($_.Exception.Message)"
}

# Save-Text
try {
    Save-Text $null "test content"
    Assert-Equal $true $true "Save-Text($null, ...) nao lanca excecao"
} catch {
    Assert-Equal $false $true "Save-Text($null, ...) lancou excecao: $($_.Exception.Message)"
}

# Get-InjectionState
Assert-Equal (Get-InjectionState $null) 'Vanilla' "Get-InjectionState($null) retorna Vanilla"
Assert-Equal (Get-InjectionState "") 'Vanilla' "Get-InjectionState('') retorna Vanilla"

# Test-ModCheckout
Assert-Equal (Test-ModCheckout $null) $false "Test-ModCheckout($null) retorna $false"
Assert-Equal (Test-ModCheckout "") $false "Test-ModCheckout('') retorna $false"

Write-Host "`n-- 2.3 Testando Install-Patcher sem PSScriptRoot --" -ForegroundColor Yellow

$origPSScriptRoot = $PSScriptRoot
$origInstallDir = $InstallDir
$testInstallDir = Join-Path ([System.IO.Path]::GetTempPath()) "GoLiveBypassTest_$([Guid]::NewGuid().ToString('N'))"
$InstallDir = $testInstallDir

try {
    $PSScriptRoot = $null
    Install-Patcher
    $installedPatcher = Join-Path $testInstallDir 'golivebypass.js'
    $settingsFile = Join-Path $testInstallDir 'settings.json'
    
    Assert-Equal (Test-Path -LiteralPath $installedPatcher) $true "Install-Patcher cria golivebypass.js mesmo sem PSScriptRoot"
    Assert-Equal (Test-Path -LiteralPath $settingsFile) $true "Install-Patcher cria settings.json mesmo sem PSScriptRoot"
} catch {
    Assert-Equal $false $true "Install-Patcher sem PSScriptRoot falhou: $($_.Exception.Message)"
} finally {
    if (Test-Path -LiteralPath $testInstallDir) {
        Remove-Item -LiteralPath $testInstallDir -Recurse -Force -ErrorAction SilentlyContinue
    }
    $InstallDir = $origInstallDir
}

Write-Host "`n-- 2.4 Get-EffectiveLocalApp / Get-ReportMeta (caminho 8.3, issue #94) --" -ForegroundColor Yellow

$origLocalAppData = $env:LOCALAPPDATA
try {
    # LOCALAPPDATA apontando para caminho que NAO existe (forma 8.3 orfa): tem que
    # cair para o fallback que resolve, nunca devolver o caminho quebrado.
    $env:LOCALAPPDATA = Join-Path ([System.IO.Path]::GetTempPath()) "nao-existe-$(Get-Random)"
    $fallback = Get-EffectiveLocalApp
    Assert-Equal (Test-Path -LiteralPath $fallback) $true "Get-EffectiveLocalApp cai para fallback resolvivel com LOCALAPPDATA orfao"
    Assert-Equal ($fallback -eq $env:LOCALAPPDATA) $false "Get-EffectiveLocalApp nao devolve o caminho orfao"

    # LOCALAPPDATA valido: devolvido sem mudanca.
    $valido = [System.IO.Path]::GetTempPath().TrimEnd('\', '/')
    $env:LOCALAPPDATA = $valido
    Assert-Equal (Get-EffectiveLocalApp) $valido "Get-EffectiveLocalApp devolve LOCALAPPDATA valido sem alteracao"
} finally {
    $env:LOCALAPPDATA = $origLocalAppData
}

try {
    # Get-ReportMeta: flag caminho_8_3 marca variaveis gravadas na forma curta
    # (ex. C:\Users\CSAR~1) -- o cenario reportado na issue #94.
    $env:LOCALAPPDATA = 'C:\Users\CSAR~1\AppData\Local'
    $metaCurto = Get-ReportMeta $null
    Assert-Equal $metaCurto['caminho_8_3'] 'sim' "Get-ReportMeta marca caminho_8_3=sim para forma curta"

    $env:LOCALAPPDATA = $origLocalAppData
    $metaNormal = Get-ReportMeta $null
    Assert-Equal $metaNormal['caminho_8_3'] 'nao' "Get-ReportMeta marca caminho_8_3=nao para forma longa"
    Assert-Equal ($null -eq $metaNormal['excecao']) $true "Get-ReportMeta sem ErrorRecord nao define 'excecao'"
} finally {
    $env:LOCALAPPDATA = $origLocalAppData
}

# Cleanup temp files
Remove-Item -LiteralPath $tempInstaller, $tempStandalone -Force -ErrorAction SilentlyContinue

Write-Host "`n========================================================" -ForegroundColor Cyan
Write-Host " Resumo dos Testes: $pass passaram, $fail falharam" -ForegroundColor $(if ($fail -eq 0) { 'Green' } else { 'Red' })
Write-Host "========================================================`n" -ForegroundColor Cyan

if ($fail -gt 0) { exit 1 }
