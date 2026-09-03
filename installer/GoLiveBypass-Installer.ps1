<#
    GoLiveBypass - instalador automatico

    Encontra sozinho o Equicord ou o Vencord que voce tem, instala o plugin, compila e
    injeta. Se voce nao tiver nenhum dos dois, pergunta qual quer e instala junto.

    Uso:
      .\GoLiveBypass-Installer.ps1
      .\GoLiveBypass-Installer.ps1 -Source "C:\caminho\do\Equicord"
      .\GoLiveBypass-Installer.ps1 -PluginSource "C:\caminho\do\GoLiveBypass\goLiveBypass"
      .\GoLiveBypass-Installer.ps1 -Mod Equicord -Yes
      .\GoLiveBypass-Installer.ps1 -Mode Uninstall
      .\GoLiveBypass-Installer.ps1 -Mode CheckUpdate   # so consulta o GitHub, nao mexe
      .\GoLiveBypass-Installer.ps1 -Mode Update        # aplica update se houver

    Obrigado ao Vithor (https://github.com/Vith0r), que escreveu o primeiro instalador do
    GoLiveBypass e abriu o caminho para este aqui.
#>

[CmdletBinding()]
param(
    [ValidateSet('Menu', 'Install', 'Uninstall', 'Restore', 'CheckUpdate', 'Update', 'TestTor')]
    [string] $Mode = 'Menu',

    [ValidateSet('Equicord', 'Vencord')]
    [string] $Mod = '',

    [string] $Source = '',

    # Instala o plugin de uma pasta local em vez de baixar do GitHub. Serve para testar uma
    # mudanca antes de publicar: sem isto o instalador sempre traz o que esta no repositorio,
    # e um teste feito assim mede a versao errada sem avisar.
    [string] $PluginSource = '',

    # Enhanced unattended installs are Tor-only. This never means
    # "fall back to an unknown public proxy".
    [switch] $Tor,

    [switch] $Yes
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# Libera a execucao so para este processo. Em maquina com politica de dominio isso pode ser
# recusado, e nesse caso nao ha o que fazer aqui: o proprio .bat ja abre com -ExecutionPolicy Bypass.
try { Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force } catch { }

$RepoRaw = 'https://raw.githubusercontent.com/AC-Tech-Pro-Oficial/GoLiveBypassEnhanced/enhanced/rtc-viewer-recovery-v1'
$PluginFiles = @('goLiveBypass/index.tsx', 'goLiveBypass/native.ts', 'goLiveBypass/rtcRecovery.ts', 'goLiveBypass/rtcShim.ts', 'goLiveBypass/manifest.json')
$PluginDirName = 'goLiveBypass'
$DiscordNames = @('Discord', 'DiscordCanary', 'DiscordPTB')

# O caminho base tem que RESOLVER, nao apenas existir na variavel (mesmo raciocinio do
# standalone): perfil com nome acentuado/especial pode ter %LOCALAPPDATA% gravado na
# forma 8.3 curta (ex. C:\Users\CSAR~1\AppData\Local), que para de resolver quando a
# geracao de nomes curtos esta desligada no Windows (#94: "Nao existe um objeto no
# caminho especificado C:\Users\CSAR~1"). A cadeia cai para o GetFolderPath (caminho
# longo canonico) e por ultimo monta a partir do USERPROFILE.
function Get-EffectiveLocalApp {
    if ($env:LOCALAPPDATA -and (Test-Path -LiteralPath $env:LOCALAPPDATA)) { return $env:LOCALAPPDATA }
    try {
        $shell = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
        if ($shell -and (Test-Path -LiteralPath $shell)) { return $shell }
    } catch { }
    if ($env:USERPROFILE) { return (Join-Path $env:USERPROFILE 'AppData\Local') }
    return $env:LOCALAPPDATA
}

$Mods = @{
    Equicord = @{ Git = 'https://github.com/Equicord/Equicord'; Label = 'Equicord'; Note = 'recomendado, inclui tudo do Vencord e mais plugins' }
    Vencord  = @{ Git = 'https://github.com/Vendicated/Vencord'; Label = 'Vencord'; Note = 'o original, mais enxuto' }
}

# Tor embutido. Tor 0.4.8 e anteriores deixaram de funcionar na rede em 2026-09-01,
# entao o enhanced fork fixa o Expert Bundle atual (Tor Browser 15.0.21 / Tor 0.4.9.11).
# A porta dedicada 9060 evita conflito com Tor do sistema (9050) ou Tor Browser (9150).
$TorBundle = '15.0.21'
$TorPort = 9060
$TorUrls = @{
    'tor-expert-bundle-windows-x86_64-15.0.21.tar.gz' = @{
        Url = 'https://dist.torproject.org/torbrowser/15.0.21/tor-expert-bundle-windows-x86_64-15.0.21.tar.gz'
        Sha256 = 'f22b8b17cb18c9fa775dfcf68acf6a2fe788336535fe94645204ca85158aa490'
    }
}
$script:LastTorProbe = 'nao executado'

function Write-Step($text) { Write-Host "  [*] $text" -ForegroundColor DarkGray }
function Write-Ok($text) { Write-Host "  [OK] $text" -ForegroundColor Green }
function Write-Warn($text) { Write-Host "  [!] $text" -ForegroundColor Yellow }
function Write-Err($text) { Write-Host "  [X] $text" -ForegroundColor Red }

# Apaga arquivo/pasta SEM passar pelo provider do PowerShell: Remove-Item
# -LiteralPath explode com PSArgumentException ("Nao existe um objeto no caminho
# especificado C:\Users\JOO~1...") em caminhos com nome curto 8.3 — o provider
# normaliza o caminho mesmo com -LiteralPath, e -ErrorAction SilentlyContinue nao
# segura essa (issue #155). O .NET apaga direto.
function Remove-CaminhoSilencioso($caminho) {
    if (-not $caminho) { return }
    try {
        $cheio = [System.IO.Path]::GetFullPath($caminho)
        if ([System.IO.File]::Exists($cheio)) { [System.IO.File]::Delete($cheio); return }
        if ([System.IO.Directory]::Exists($cheio)) { [System.IO.Directory]::Delete($cheio, $true) }
    } catch { }
}

function Show-Banner {
    Write-Host ''
    Write-Host '  GoLiveBypass' -ForegroundColor Cyan
    Write-Host '  Go Live e camera de volta no Discord' -ForegroundColor DarkGray
    Write-Host '  https://github.com/AC-Tech-Pro-Oficial/GoLiveBypassEnhanced' -ForegroundColor DarkGray
    Write-Host ''
}

function Read-Escolha($prompt) {
    # Console sem teclado (stdin com handle morto — o instalador lancado por
    # atalho/automacao que nao abre console de verdade): o Read-Host explode
    # dentro do FileStream com "Invalid handle. Parameter name: handle" — e a
    # pessoa so ve um crash cru (issue #146). Mensagem com o que fazer; e
    # ambiente de uso, nao bug, entao nao vira issue.
    try {
        return (Read-Host $prompt)
    } catch {
        throw 'Este console nao aceita entrada de teclado. Feche e rode o instalador de novo com duplo clique no GoLiveBypass-Installer.bat (ou de uma janela normal do PowerShell).'
    }
}

function Confirm-Action($question) {
    if ($Yes) { return $true }
    return (Read-Escolha "  $question [s/N]") -match '^[sSyY]'
}

# =========================================================================== Report de bugs
# Igual a GUI: ao falhar, monta diagnostico sanitizado e POST na API de bugs
# (abre issue no bezumiya/GoLiveBypass). Nunca bloqueia o fluxo.

$script:BugApiUrl = 'https://api.skyplaceia.com/bugs/v1/reports'
$script:BugApiToken = 'c3d0bff691ecc3ddc6f6ca10037b9ac967c62547e681d3749204e50800504511'

function Invoke-BugReport([string]$title, [string]$description, [string]$log = '', [hashtable]$meta = @{}) {
    if ($Yes) { return }  # automacao: nao spammar a API
    # Dedupe: o mesmo erro NAO reabre issue. Os 3 reports duplos da 1.1.11
    # (issues 124-126) vieram daqui: cada rodada do mesmo bug abria issue nova.
    # Assinatura = titulo + primeira linha da descricao, com data; janela de 48h.
    try {
        $primeiraLinha = ($description -split "`n" | Select-Object -First 1)
        if ($primeiraLinha.Length -gt 300) { $primeiraLinha = $primeiraLinha.Substring(0, 300) }
        $sha = [System.Security.Cryptography.SHA256]::Create()
        $hash = ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes("$title|$primeiraLinha"))) -replace '-', '').Substring(0, 16)
        $sha.Dispose()
        $stateFile = Join-Path (Get-EffectiveLocalApp) 'GoLiveBypass\.last-report'
        if (Test-Path -LiteralPath $stateFile) {
            $campos = @((Get-Content -LiteralPath $stateFile -First 1) -split ' ')
            if ($campos.Count -ge 2 -and $campos[0] -eq $hash) {
                try {
                    $ultimo = [datetime]::ParseExact($campos[1], 'yyyyMMddHHmm', [Globalization.CultureInfo]::InvariantCulture)
                    if (((Get-Date) - $ultimo).TotalHours -lt 48) {
                        Write-Host '  [i] Esse erro ja foi reportado a menos de 48h — nao vou reabrir a issue.' -ForegroundColor DarkGray
                        return
                    }
                } catch { }
            }
        }
        New-Item -ItemType Directory -Path (Split-Path -Parent $stateFile) -Force -ErrorAction SilentlyContinue | Out-Null
        Set-Content -LiteralPath $stateFile -Value "$hash $(Get-Date -Format 'yyyyMMddHHmm')" -ErrorAction SilentlyContinue
    } catch { }
    $desc = Invoke-SanitizeBug $description
    # Mesma forma do payload da GUI (golive-gui/electron/bugreport.ts): {title,
    # description, log, meta}. O formato antigo (includeLogs) nunca foi lido pela
    # API -- os reports do instalador/standalone chegavam no GitHub com log e
    # metadata vazios (ex.: issue #94).
    $body = @{ title = $title; description = $desc; log = $log; meta = $meta } | ConvertTo-Json
    try {
        Invoke-RestMethod -Method Post -Uri $script:BugApiUrl -Body $body -ContentType 'application/json' -Headers @{ Authorization = "Bearer $($script:BugApiToken)" } -TimeoutSec 15 -ErrorAction Stop | Out-Null
        Write-Host ''
        Write-Host '  [OK] Relatorio enviado. Obrigado — os devs vao ver a issue no GitHub.' -ForegroundColor Green
    } catch {
        Write-Host ''
        Write-Host '  [!] Nao consegui enviar o relatorio automatico. Rode de novo e mande a saida.' -ForegroundColor Yellow
    }
}

function Invoke-SanitizeBug([string]$text) {
    $text = [regex]::Replace($text, '([a-z][a-z0-9+.-]*://)([^/ @:]+):([^/@]+)@', '$1$2:***@')
    $text = [regex]::Replace($text, '\b(mfa\.[A-Za-z0-9_-]{20,}|[A-Za-z0-9_-]{23,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{27,})\b', '***')
    $text = [regex]::Replace($text, '(https://gateway[^ ?]+)\?[^ ]*', '$1?<params>')
    # proxy personalizada digitada na instalacao (nunca sai)
    if ($script:UltimaProxy) { $text = $text.Replace($script:UltimaProxy, '<proxy-pessoal>') }
    return $text
}

# Metadata do report, mesmo espirito da GUI (bugreport.ts montarMeta): so flags de
# diagnostico, sem caminhos completos do usuario. caminho_8_3 marca variaveis de
# ambiente gravadas na forma curta (ex. C:\Users\CSAR~1) -- o cenario da issue #94.
function Get-ReportMeta($ErrorRecord) {
    $short = $false
    foreach ($v in @($env:LOCALAPPDATA, $env:USERPROFILE, $env:TEMP)) {
        if ($v -and $v -match '~\d($|\\)') { $short = $true; break }
    }
    $meta = @{
        versao                = 'instalador'
        plataforma            = "win32-$env:PROCESSOR_ARCHITECTURE"
        locale                = "$(if ($PSUICulture -and $PSUICulture.Name) { $PSUICulture.Name } else { '?' })"
        localappdata_presente = "$(if ($env:LOCALAPPDATA) { 'sim' } else { 'nao' })"
        caminho_8_3           = "$(if ($short) { 'sim' } else { 'nao' })"
    }
    if ($ErrorRecord -and $ErrorRecord.Exception) {
        $meta['excecao'] = $ErrorRecord.Exception.GetType().FullName
    }
    return $meta
}

function Invoke-SendAutoReport([string]$summary, [string]$extra = '', $ErrorRecord = $null) {
    if ($Yes) { return }
    $desc = "$extra`n`n--- logs ---`n"
    $tail = ''
    try {
        $logDir = Join-Path (Get-EffectiveLocalApp) 'GoLiveBypass'
        foreach ($log in @('golivebypass.log', 'gui.log')) {
            $lp = Join-Path $logDir $log
            if (Test-Path -LiteralPath $lp) {
                $tail += (Get-Content -LiteralPath $lp -Tail 40 -ErrorAction SilentlyContinue | Out-String)
            }
        }
    } catch { }
    if ($ErrorRecord -and $ErrorRecord.Exception) {
        $frame = ''
        try {
            $st = $ErrorRecord.Exception.StackTrace
            if ($st) { $frame = (($st -split "`n") | Select-Object -First 1).Trim() }
        } catch { }
        $desc += "`n`nexcecao: " + $ErrorRecord.Exception.GetType().FullName
        if ($frame) { $desc += "`nframe: " + $frame }
        # A LINHA do script: sem ela um "Invalid handle" de FileStream nao diz nada
        # (issue #127). O catch do instalador mostra no console; o report so via aqui.
        $info = $ErrorRecord.InvocationInfo
        if ($info -and $info.ScriptLineNumber) {
            $desc += "`nlinha do script: $($info.ScriptLineNumber): $($info.Line.Trim())"
        } elseif ($ErrorRecord.ScriptStackTrace) {
            # Excecao .NET surfada pelo pipeline as vezes chega sem InvocationInfo
            # util (#136: DriveNotFoundException sem linha nenhuma no relato). O
            # ScriptStackTrace e preenchido sempre que existe frame de script.
            $pilha = ($ErrorRecord.ScriptStackTrace -split "`n" | Select-Object -First 2) -join ' | '
            $desc += "`npilha: " + $pilha
        }
    }
    Invoke-BugReport $summary $desc $tail (Get-ReportMeta $ErrorRecord)
}

# Test-ShouldReport <mensagem>: $false se a mensagem NAO deve abrir issue.
# Mesmo espelho do should_report() do .sh: erros de uso (dependencia faltando,
# CLI digitada errada, path errado, ferramenta externa quebrada) nao viram
# issue. O resto (bug real) continua reportando.
function Test-ShouldReport([string]$msg) {
    # cancelamento e instrucoes de uso
    if ($msg -eq 'Cancelado.') { return $false }
    # console sem teclado (issue #146): ambiente de uso, o aviso ja diz o que fazer
    if ($msg -like '*Este console nao aceita entrada de teclado*') { return $false }
    # Cancelamento via Ctrl+C no Read-Host: PowerShell lanca a mensagem nativa
    # "Esse comando nao pode ser executado devido ao erro: A operacao foi cancelada
    # pelo usuario." (PT-BR) / "This command cannot be executed ... The operation
    # was canceled by the user." (EN). E cancelamento do usuario, nao bug.
    if ($msg -like '*cancelada pelo usu*rio*') { return $false }
    if ($msg -like '*canceled by the user*') { return $false }
    if ($msg -like '*cadeia de caracteres vazia*') { return $false }
    if ($msg -like '*empty string*') { return $false }
    if ($msg -like 'Illegal characters in path*') { return $false }
    if ($msg -like '*associar*par*metro*') { return $false }
    if ($msg -like '*Cannot bind argument*') { return $false }
    if ($msg -like '*porque ele ? nulo*' -or $msg -like '*because it is null*') { return $false }
    if ($msg -like 'Nao e possivel associar*') { return $false }
    if ($msg -like 'O Discord nao fechou*') { return $false }
    # input / uso do usuario
    if ($msg -like 'Opcao desconhecida: *') { return $false }
    if ($msg -like 'Formato invalido. Use socks5://*') { return $false }
    if ($msg -like 'Endereco da proxy invalido*') { return $false }
    if ($msg -like 'Nao consegui baixar *') { return $false }
    # dependencia faltando (ambiente)
    if ($msg -like 'Instale *') { return $false }
    if ($msg -like 'O npm nao conseguiu instalar o pnpm*') { return $false }
    if ($msg -like 'Nao consegui deixar o pnpm funcionando*') { return $false }
    # path / checkout errado
    if ($msg -like 'Nao encontrei o checkout do Equicord/Vencord*') { return $false }
    if ($msg -like 'Nao achei *') { return $false }
    if ($msg -like '*ja existe e nao parece um checkout*') { return $false }
    if ($msg -like 'Nao achei o patcher *') { return $false }
    if ($msg -like 'Nao achei nenhum Discord instalado*') { return $false }
    # ferramenta externa (ambiente)
    if ($msg -eq 'git clone falhou') { return $false }
    if ($msg -eq 'pnpm install falhou') { return $false }
    if ($msg -eq 'pnpm build falhou') { return $false }
    if ($msg -eq 'pnpm inject falhou') { return $false }
    # desinstalacao / elevacao parcial
    if ($msg -like 'Nao consegui desinstalar de todos*') { return $false }
    if ($msg -like 'NADA foi injetado*') { return $false }
    # default: e bug, reporta
    return $true
}

# =========================================================================== /Report de bugs

# =========================================================================== TUI (PowerShell)
# Interface no estilo OpenCode: dark, caixas, setas/Enter. Mouse: o console do Windows
# nao expoe cliques de forma confiavel por aqui; a navegacao e por teclado (up/down/Enter/Esc/j/k)
# e o mouse SGR fica como melhoria futura. Sem TTY (pipe) ou com -Yes, cai para os menus atuais.

# Diz se o console suporta ANSI (modo VT). O conhost classico do Windows (cmd rodando o
# powershell.exe) NAO interpreta escapes por padrao: a TUI apareceria cheia de "[48;5;235m".
# Tentamos habilitar o modo VT via P/Invoke; se der certo, ANSI funciona (Windows Terminal,
# VS Code, conhost com VT ativo). Se nao der, a TUI cai para os menus [1]/[2]/[3] simples.
function Test-TuiAnsi {
    try {
        # GetStdHandle(-11) = stdout; o modo VT e um bit (0x0004).
        Add-Type -Namespace Win32 -Name Console -MemberDefinition @'
[DllImport("kernel32.dll", SetLastError = true)]
public static extern IntPtr GetStdHandle(int nStdHandle);
[DllImport("kernel32.dll", SetLastError = true)]
public static extern bool GetConsoleMode(IntPtr hConsoleHandle, out uint lpMode);
[DllImport("kernel32.dll", SetLastError = true)]
public static extern bool SetConsoleMode(IntPtr hConsoleHandle, uint dwMode);
'@ -ErrorAction Stop
        $h = [Win32.Console]::GetStdHandle(-11)
        if ($h -eq [IntPtr]::Zero) { return $false }
        $mode = [uint32]0
        if (-not [Win32.Console]::GetConsoleMode($h, [ref]$mode)) { return $false }
        # Venv: 0x0004 = ENABLE_VIRTUAL_TERMINAL_PROCESSING
        if (($mode -band 0x0004) -eq 0x0004) { return $true }
        $novo = $mode -bor 0x0004
        [Win32.Console]::SetConsoleMode($h, $novo) | Out-Null
        return $true
    } catch {
        return $false
    }
}

function Test-TuiInteractive {
    if ($Yes) { return $false }
    if ([Console]::IsInputRedirected -or [Console]::IsOutputRedirected) { return $false }
    # Sem ANSI de verdade (conhost classico) os escapes quebram a tela: cai para os menus
    # [1]/[2]/[3] atuais, que funcionam em qualquer console.
    return (Test-TuiAnsi)
}

function Tui-Color($fg, $bg) { "$([char]27)[$fg$([char]27)[$bg" }  # acento/reset via ANSI

# Pequena paleta da TUI (sempre ANSI; o console padrao do Windows suporta no WT/PowerShell 7).
$script:TuiBg = "$([char]27)[48;5;235m"
$script:TuiFg = "$([char]27)[38;5;252m"
$script:TuiAccent = "$([char]27)[38;5;75m"
$script:TuiOk = "$([char]27)[38;5;114m"
$script:TuiDim = "$([char]27)[38;5;240m"
$script:TuiBold = "$([char]27)[1m"
$script:TuiRset = "$([char]27)[0m"

function Tui-HideCursor { Write-Host "$([char]27)[?25l" -NoNewline }
function Tui-ShowCursor { Write-Host "$([char]27)[?25h" -NoNewline }
function Tui-ClearBelow([int]$row) { Write-Host "$([char]27)[$row;0H$([char]27)[J" -NoNewline }

function Tui-GetKey {
    # Na janela do Windows (powershell.exe), [Console]::ReadKey($true) captura setas e Enter.
    # Drenar o buffer antes: SSH/conhost costuma injetar um Enter espúrio no início da
    # sessão que faria o TUI pular direto o primeiro item. Aqui limpamos tudo que estiver
    # enfileirado e lemos só a próxima tecla "real" do usuário.
    if ([Console]::KeyAvailable) {
        $sw = [System.Diagnostics.Stopwatch]::StartNew()
        while ([Console]::KeyAvailable -and $sw.ElapsedMilliseconds -lt 80) {
            [void][Console]::ReadKey($true)
        }
    }
    try {
        $k = [Console]::ReadKey($true)
        switch ($k.Key) {
            'UpArrow'  { return 'up' }
            'DownArrow' { return 'down' }
            'Enter'    { return 'enter' }
            'Escape'   { return 'esc' }
            default {
                if ($k.KeyChar -eq 'j') { return 'down' }
                if ($k.KeyChar -eq 'k') { return 'up' }
                if ($k.KeyChar -eq 'q') { return 'esc' }
                if ($k.KeyChar -eq ' ') { return 'space' }
                if ($k.KeyChar -eq 'a') { return 'all' }
                return 'other'
            }
        }
    } catch { return 'other' }
}

function Tui-Box([string]$title, [string[]]$lines) {
    $w = 62
    $top = '─' * ($w - 8)
    $bottom = '─' * ($w - 2)
    Write-Host "$($script:TuiBg)$($script:TuiRset)┌─ $($script:TuiAccent)$title$($script:TuiRset) ─$($script:TuiDim)$top$($script:TuiRset)" -NoNewline
    Write-Host ''
    foreach ($txt in $lines) {
        $pad = ' ' * [Math]::Max(0, ($w - 4 - $txt.Length))
        Write-Host "$($script:TuiBg)$($script:TuiRset)│ $txt$pad │$($script:TuiRset)" -NoNewline
        Write-Host ''
    }
    Write-Host "$($script:TuiBg)$($script:TuiRset)└$bottom┘$($script:TuiRset)" -NoNewline
    Write-Host ''
}

function Tui-Menu([string]$title, [string[]]$items) {
    if (-not (Test-TuiInteractive)) { return 0 }
    $sel = 0
    $n = $items.Count
    Tui-HideCursor
    try {
        while ($true) {
            Tui-ClearBelow 1
            Write-Host "`r" -NoNewline
            $top = '─' * (62 - 8)
            Write-Host "$($script:TuiBg)$($script:TuiRset)┌─ $($script:TuiAccent)$title$($script:TuiRset) ─$($script:TuiDim)$top$($script:TuiRset)" -NoNewline
            Write-Host ''
            for ($i = 0; $i -lt $n; $i++) {
                $txt = $items[$i]
                $pad = ' ' * [Math]::Max(0, (62 - 6 - $txt.Length))
                if ($i -eq $sel) {
                    Write-Host "$($script:TuiBg)│ $($script:TuiAccent)●$($script:TuiRset) $($script:TuiBold)$txt$($script:TuiRset)$pad │$($script:TuiRset)" -NoNewline
                } else {
                    Write-Host "$($script:TuiBg)│ $($script:TuiDim)○$($script:TuiRset) $txt$pad │$($script:TuiRset)" -NoNewline
                }
                Write-Host ''
            }
            Write-Host "$($script:TuiBg)└$('─' * (62 - 2))┘$($script:TuiRset)" -NoNewline
            Write-Host ''
            Write-Host "  $($script:TuiDim)[↑↓] navegar · [Enter] escolher · [Esc] cancelar$($script:TuiRset)" -NoNewline
            $key = Tui-GetKey
            switch ($key) {
                'up'   { if ($sel -gt 0) { $sel-- } }
                'down' { if ($sel -lt $n - 1) { $sel++ } }
                'enter' { break }
                'esc'  { $sel = -1; break }
            }
            if ($key -eq 'enter' -or $key -eq 'esc') { break }
        }
    } finally {
        Tui-ShowCursor
    }
    if ($sel -ge 0) { return $sel + 1 } else { return 0 }
}

function Tui-MenuMulti([string]$title, [string[]]$items) {
    # Multi-selecao estilo checkbox (escolher QUAL Discord patchear): Espaco
    # marca/desmarca, 'a' marca/desmarca todos, Enter confirma (exige >= 1),
    # Esc cancela. Devolve os indices (1..N) marcados em ordem, ou nada se
    # cancelado.
    if (-not (Test-TuiInteractive)) { return $null }
    $sel = 0
    $n = $items.Count
    $marks = New-Object bool[] $n
    Tui-HideCursor
    try {
        while ($true) {
            Tui-ClearBelow 1
            Write-Host "`r" -NoNewline
            $top = '─' * (62 - 8)
            Write-Host "$($script:TuiBg)$($script:TuiRset)┌─ $($script:TuiAccent)$title$($script:TuiRset) ─$($script:TuiDim)$top$($script:TuiRset)" -NoNewline
            Write-Host ''
            for ($i = 0; $i -lt $n; $i++) {
                $txt = $items[$i]
                $pad = ' ' * [Math]::Max(0, (62 - 8 - $txt.Length))
                $box = if ($marks[$i]) { '[x]' } else { '[ ]' }
                $cor = if ($marks[$i]) { $script:TuiFg } else { $script:TuiDim }
                if ($i -eq $sel) {
                    Write-Host "$($script:TuiBg)│ $($script:TuiAccent)$box$($script:TuiRset) $($script:TuiBold)$txt$($script:TuiRset)$pad │$($script:TuiRset)" -NoNewline
                } else {
                    Write-Host "$($script:TuiBg)│ $($script:TuiDim)$box$($script:TuiRset) $cor$txt$($script:TuiRset)$pad │$($script:TuiRset)" -NoNewline
                }
                Write-Host ''
            }
            Write-Host "$($script:TuiBg)└$('─' * (62 - 2))┘$($script:TuiRset)" -NoNewline
            Write-Host ''
            Write-Host "  $($script:TuiDim)[↑↓] navegar · [Espaço] marcar · [a] todos · [Enter] confirmar · [Esc] cancelar$($script:TuiRset)" -NoNewline
            $key = Tui-GetKey
            if ($key -eq 'space') { $marks[$sel] = -not $marks[$sel]; continue }
            if ($key -eq 'all') {
                $tudoMarcado = $true
                foreach ($m in $marks) { if (-not $m) { $tudoMarcado = $false; break } }
                $novo = -not $tudoMarcado
                for ($i = 0; $i -lt $n; $i++) { $marks[$i] = $novo }
                continue
            }
            switch ($key) {
                'up'   { if ($sel -gt 0) { $sel-- } }
                'down' { if ($sel -lt $n - 1) { $sel++ } }
            }
            if ($key -eq 'esc') { $sel = -1; break }
            if ($key -eq 'enter') {
                $algum = $false
                foreach ($m in $marks) { if ($m) { $algum = $true; break } }
                if ($algum) { break }
            }
        }
    } finally {
        Tui-ShowCursor
    }
    if ($sel -lt 0) { return $null }
    $out = @()
    for ($i = 0; $i -lt $n; $i++) { if ($marks[$i]) { $out += ($i + 1) } }
    return $out
}

function Tui-Input([string]$label, [string]$initial = '') {
    Write-Host "$($script:TuiBg)$($script:TuiFg)  ${label}: $($script:TuiAccent)$initial" -NoNewline
    Tui-ShowCursor
    $v = Read-Host
    Tui-HideCursor
    return ($v -replace '\s+$', '')
}

function Tui-Confirm([string]$question) {
    if (-not (Test-TuiInteractive)) { return (Confirm-Action $question) }
    $ans = Read-Host "$($script:TuiBg)$($script:TuiFg)  $question [s/N]"
    return ($ans -match '^[sSyY]')
}

function Tui-Progress([string]$msg) { Write-Host "$($script:TuiBg)$([char]27)[2K`r$($script:TuiAccent)[*]$($script:TuiRset) $msg" -NoNewline }
function Tui-Done { Write-Host "$($script:TuiBg)$([char]27)[2K`r$($script:TuiOk)[OK]$($script:TuiRset)" }

# =========================================================================== /TUI

function Save-Text($path, $text) {
    if (-not $path) { return }
    $dir = Split-Path -Parent $path
    if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    [IO.File]::WriteAllText($path, $text, (New-Object System.Text.UTF8Encoding($false)))
}

function Get-RepoFile($relativePath) {
    if ($PSScriptRoot) {
        $parent = Split-Path -Parent $PSScriptRoot
        if ($parent) {
            $local = Join-Path $parent ($relativePath -replace '/', '\')
            if (Test-Path -LiteralPath $local) { return [IO.File]::ReadAllText($local) }
        }
    }

    try {
        return (Invoke-WebRequest -UseBasicParsing -Uri "$RepoRaw/$relativePath").Content
    } catch {
        throw "Nao consegui baixar $relativePath. Verifique sua conexao."
    }
}

function Test-Tool($name) {
    return [bool] (Get-Command $name -ErrorAction SilentlyContinue)
}

# O endereco da proxy pode carregar usuario e senha, e ele e mostrado na tela e em resumo de
# instalacao. A senha some daqui.
function Hide-ProxySecret($proxy) {
    if ($proxy -match '^([a-z0-9]+)://(?:([^:@]+)(?::[^@]*)?@)?(.+)$') {
        $user = if ($matches[2]) { "$($matches[2]):***@" } else { '' }
        return "$($matches[1])://$user$($matches[3])"
    }
    return $proxy
}

# O corepack cria o atalho do pnpm antes de saber que versao usar. Na primeira execucao ele
# busca essa versao no registro do npm e confere a assinatura com chaves embutidas nele; as
# chaves do corepack que vem no Node 22 estao velhas, entao o atalho existe e mesmo assim
# quebra com "Cannot find matching keyid". So testar se o comando existe nao prova nada.
$script:PnpmVersion = ''

function Test-Pnpm {
    if (-not (Test-Tool 'pnpm')) { return $false }

    # Um atalho do corepack existe mesmo quando nao funciona, entao a unica prova que vale e
    # executar. O 2>$null evita assustar quem so vai ver a instalacao seguir depois.
    # A saida e capturada inteira antes de olhar o codigo. Filtrar com Select-Object no meio do
    # cano interrompe o comando por cima, e o codigo de saida deixa de valer: um pnpm que
    # funciona era reprovado.
    # O atalho do corepack pode nao so falhar como EXPLODIR: a pergunta "Corepack is about to
    # download" sem resposta vira erro terminante por causa do ErrorActionPreference=Stop daqui.
    # Sem o try/catch a excecao escapava do probe e derrubava o instalador inteiro, em vez de
    # cair no npm install -g. Relato real: o instalador morria apontando a linha 16 do shim.
    try { $found = & pnpm --version 2>$null } catch { return $false }
    if ($LASTEXITCODE -ne 0) { return $false }

    $script:PnpmVersion = ($found | Select-Object -First 1)
    return $true
}

function Update-PathFromEnvironment {
    $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $user = [Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = @($machine, $user | Where-Object { $_ }) -join ';'
}

function Test-ModCheckout($path) {
    if (-not $path) { return $false }
    if (-not (Test-Path -LiteralPath (Join-Path $path 'package.json'))) { return $false }
    return Test-Path -LiteralPath (Join-Path $path 'src\utils\types.ts')
}

function Test-DiscordResourcesReady($resources) {
    if (-not $resources) { return $false }
    $asar = Join-Path $resources 'app.asar'
    $original = Join-Path $resources '_app.asar'
    return (Test-Path -LiteralPath $asar) -or (Test-Path -LiteralPath $original)
}

function Get-DiscordResources {
    $found = @()
    $localApp = Get-EffectiveLocalApp
    if (-not $localApp) { return $found }
    foreach ($name in $DiscordNames) {
        $root = Join-Path $localApp $name
        if (-not (Test-Path -LiteralPath $root)) { continue }

        $apps = Get-ChildItem -LiteralPath $root -Directory -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -match '^app-[0-9]' } |
            Sort-Object -Descending -Property @{ Expression = {
                try { [version]($_.Name -replace '^app-', '') } catch { [version]'0.0.0' }
            } }

        foreach ($app in $apps) {
            if (-not $app -or -not $app.FullName) { continue }
            $resources = Join-Path $app.FullName 'resources'
            if (Test-DiscordResourcesReady $resources) {
                $found += $resources
            }
        }
    }
    return $found
}

function Get-InjectedPath($resources) {
    # O instalador do Equicord e o do Vencord trocam o app.asar por um stub cujo index.js so
    # faz require da pasta de build. Numa instalacao a partir do fonte esse require aponta
    # direto para <checkout>\dist\desktop, que e a forma mais confiavel de achar o checkout.
    if (-not $resources) { return $null }
    $candidates = @()

    $stub = Join-Path $resources 'app.asar'
    if (Test-Path -LiteralPath $stub) {
        $item = Get-Item -LiteralPath $stub
        # app.asar pode ser uma pasta; nesse caso .Length devolve 1 e nao o tamanho do arquivo.
        # E a leitura precisa ser UTF-8: em ASCII um caminho com acento vira "Jo??o".
        if ($item -is [IO.FileInfo] -and $item.Length -lt 65536) {
            $candidates += [IO.File]::ReadAllText($stub)
        }
    }

    $index = Join-Path $resources 'app\index.js'
    if (Test-Path -LiteralPath $index) {
        $candidates += Get-Content -LiteralPath $index -Raw -ErrorAction SilentlyContinue
    }

    foreach ($text in $candidates) {
        if (-not $text) { continue }
        $match = [regex]::Match($text, 'require\("(.+?)"\)')
        if ($match.Success) { return $match.Groups[1].Value -replace '\\\\', '\' }
    }

    return $null
}

function Get-InstalledMod {
    foreach ($resources in Get-DiscordResources) {
        $injected = Get-InjectedPath $resources
        if (-not $injected) { continue }
        if ($injected -match 'equibop') { return 'Equibop' }
        if ($injected -match 'equicord') { return 'Equicord' }
        if ($injected -match 'vesktop') { return 'Vesktop' }
        if ($injected -match 'vencord') { return 'Vencord' }
    }
    return $null
}

function Find-CheckoutFromInjection {
    foreach ($resources in Get-DiscordResources) {
        $injected = Get-InjectedPath $resources
        if (-not $injected) { continue }

        # <checkout>\dist\desktop -> <checkout>
        $parent1 = Split-Path -Parent $injected
        if (-not $parent1) { continue }
        $root = Split-Path -Parent $parent1
        if ($root -and (Test-ModCheckout $root)) {
            if (-not $Mod -or (Get-CheckoutMod $root) -eq $Mod) { return $root }
        }
    }
    return $null
}

function Find-CheckoutOnDisk {
    if (-not $env:USERPROFILE) { return $null }
    $roots = @($env:USERPROFILE)
    foreach ($sub in @('Documents', 'Desktop', 'Downloads', 'dev', 'repos', 'projects', 'git', 'source', 'source\repos')) {
        $roots += (Join-Path $env:USERPROFILE $sub)
    }
    foreach ($drive in (Get-PSDrive -PSProvider FileSystem -ErrorAction SilentlyContinue)) {
        if ($drive.Root -and $drive.Root -match '^[A-Za-z]:\\$') { $roots += $drive.Root }
    }

    $seen = @{}
    foreach ($root in $roots) {
        if (-not $root -or $seen.ContainsKey($root) -or -not (Test-Path -LiteralPath $root)) { continue }
        $seen[$root] = $true

        $candidates = Get-ChildItem -LiteralPath $root -Directory -ErrorAction SilentlyContinue |
            Where-Object {
                if ($Mod) { $_.Name -ieq $Mod }
                else { $_.Name -match '^(Equicord|Vencord)$' }
            }

        foreach ($dir in $candidates) {
            if ($dir -and $dir.FullName -and (Test-ModCheckout $dir.FullName)) { return $dir.FullName }
        }
    }

    Write-Step 'Procurando um pouco mais fundo no seu perfil'
    $deep = Get-ChildItem -LiteralPath $env:USERPROFILE -Directory -Recurse -Depth 3 -ErrorAction SilentlyContinue |
        Where-Object {
            if ($Mod) { $_.Name -ieq $Mod }
            else { $_.Name -match '^(Equicord|Vencord)$' }
        } |
        Select-Object -First 20

    foreach ($dir in $deep) {
        if ($dir -and $dir.FullName -and (Test-ModCheckout $dir.FullName)) { return $dir.FullName }
    }

    return $null
}

function Find-Checkout {
    if ($Source) {
        if (Test-ModCheckout $Source) { return $Source }
        throw "Nao encontrei um checkout do Equicord ou Vencord em $Source"
    }

    $root = Find-CheckoutFromInjection
    if ($root) {
        Write-Ok "Achei pelo Discord: $root"
        return $root
    }

    $root = Find-CheckoutOnDisk
    if ($root) {
        Write-Ok "Achei no disco: $root"
        return $root
    }

    return $null
}

function Test-InjectedFromCheckout($root) {
    if (-not $root) { return $false }
    foreach ($resources in Get-DiscordResources) {
        $injected = Get-InjectedPath $resources
        if ($injected -and $injected.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) { return $true }
    }
    return $false
}

# Clientes paralelos no Windows (Vesktop/Equibop/Legcord): mesmo padrao
# electron-builder do Discord. O instalador de mod deles nao reconhece esses
# clientes (recebem copia do dist\<cliente>.asar), os oficiais recebem pnpm
# inject --location.
$ParallelNames = @('Vesktop', 'Equibop', 'Legcord')

function Get-PatchTargets {
    # Oficiais + paralelos num formato so (Flavour|Resources|Tipo): 'O' recebe
    # pnpm inject --location, 'P' recebe a copia do asar do mod.
    $targets = @()
    foreach ($install in (Get-DiscordResources)) {
        # Get-DiscordResources devolve STRINGS (caminhos de resources), nao objetos:
        # .Flavour/.Resources numa string devolvem $null no PowerShell — a TUI de
        # selecao mostrava checkboxes vazios e o Split-Path da injecao recebia nulo
        # ("Nao e possivel associar o argumento ao parametro Path").
        $resources = [string]$install
        if (-not $resources.Trim()) { continue }
        $flavour = Split-Path -Leaf (Split-Path -Parent (Split-Path -Parent $resources))
        $targets += [pscustomobject]@{ Flavour = $flavour; Resources = $resources; Tipo = 'O' }
    }
    if ($env:LOCALAPPDATA) {
        foreach ($name in $ParallelNames) {
            foreach ($base in @((Join-Path $env:LOCALAPPDATA $name), (Join-Path $env:LOCALAPPDATA "Programs\$name"))) {
                if (-not (Test-Path -LiteralPath $base)) { continue }
                # Padrao Squirrel: app-<versao>\resources. Direto: <base>\resources.
                $candidate = Join-Path $base 'resources'
                if (-not (Test-DiscordResourcesReady $candidate)) {
                    $versions = Get-ChildItem -LiteralPath $base -Directory -Filter 'app-*' -ErrorAction SilentlyContinue |
                        Sort-Object Name -Descending
                    foreach ($ver in $versions) {
                        $c = Join-Path $ver.FullName 'resources'
                        if (Test-DiscordResourcesReady $c) { $candidate = $c; break }
                    }
                }
                if (Test-DiscordResourcesReady $candidate) {
                    $targets += [pscustomobject]@{ Flavour = $name; Resources = $candidate; Tipo = 'P' }
                    break
                }
            }
        }
    }
    # Defesa em profundidade (#136): um alvo com Resources vazio ou nao-string,
    # usado como path la na frente, virava o DriveNotFoundException
    # "A drive with the name '@{Flavour=Discord; Resources=C' does not exist" —
    # o PowerShell entende o trecho antes do ":" como nome de drive. Nunca deve
    # acontecer; se acontecer, para AQUI com o motivo na mesa em vez de explodir
    # longe da causa.
    foreach ($t in $targets) {
        if (-not $t.Resources -or -not ($t.Resources -is [string]) -or -not $t.Resources.Trim()) {
            throw "Alvo de injecao nasceu sem caminho (Flavour='$($t.Flavour)'). Bug do instalador — reporte com este print."
        }
    }
    return $targets
}

function Select-InjectionTargets($targets) {
    # 1 alvo: sem pergunta (como antes). -Yes: todos os oficiais (paralelos so
    # quando nao existe oficial — comportamento de antes do seletor). Com TTY e
    # mais de um: multi-select - um, varios ou todos; Esc cancela.
    if (-not $targets -or @($targets).Count -le 1) { return $targets }
    if ($Yes -or -not (Test-TuiInteractive)) {
        $oficiais = @($targets | Where-Object { $_.Tipo -eq 'O' })
        if ($oficiais.Count -gt 0) { return $oficiais }
        return $targets
    }
    $labels = foreach ($t in $targets) {
        $suf = if ($t.Tipo -eq 'P') { ' (cliente paralelo)' } else { '' }
        "$($t.Flavour)$suf"
    }
    $escolha = Tui-MenuMulti 'Quais Discords recebem o plugin?' $labels
    if (-not $escolha) { throw 'Cancelado.' }
    $escolhidos = @()
    foreach ($i in $escolha) { $escolhidos += $targets[$i - 1] }
    return $escolhidos
}

# Qual .asar cada mod consegue gerar para cada cliente paralelo. Equicord e Vencord sao forks
# DIFERENTES: o build do Equicord so empacota equibop.asar (o cliente dele), o do Vencord so
# vesktop.asar (o dele) -- nenhum dos dois gera o .asar do outro. Legcord e um projeto A PARTE
# (nao e fork de nenhum dos dois): nenhum checkout Equicord/Vencord gera legcord.asar, entao
# "rode pnpm build e tente de novo" era enganoso nesse caso -- nenhum build ia gerar aquele
# arquivo. Isso e a causa raiz por tras de #123/#130/#132/#133 (sempre Vesktop detectado com
# um checkout Equicord): o "aviso acima" que a mensagem de erro citava nunca chegava no relato
# de bug (so ia para o console), entao a causa ficava invisivel para quem nao colava o
# terminal inteiro.
$ParallelAsarPorMod = @{
    Equicord = @{ Equibop = 'equibop.asar' }
    Vencord  = @{ Vesktop = 'vesktop.asar' }
}

function Copy-PatchParallel($root, $resources) {
    # Patch direto em cliente paralelo: o build do mod gera dist\<cliente>.asar;
    # copia sobre o app.asar do cliente, com backup _app.asar (idempotente).
    $nome = $null
    switch -Regex ($resources) {
        '(?i)equibop' { $nome = 'Equibop' }
        '(?i)vesktop' { $nome = 'Vesktop' }
        '(?i)legcord' { $nome = 'Legcord' }
        default {
            $motivo = "cliente paralelo desconhecido: $resources"
            Write-Warn $motivo
            return [pscustomobject]@{ Ok = $false; Motivo = $motivo }
        }
    }

    $mod = Get-CheckoutMod $root
    $asarName = $ParallelAsarPorMod[$mod][$nome]
    if (-not $asarName) {
        $motivo = "$nome nao e gerado por um checkout $mod (Equicord builda so o Equibop, Vencord so o Vesktop; Legcord e um app a parte -- nenhum dos dois builda ele). Use um checkout do mod certo para $nome (-Source), ou injete o $nome pelo instalador dele mesmo."
        Write-Warn $motivo
        return [pscustomobject]@{ Ok = $false; Motivo = $motivo }
    }

    $asar = Join-Path $root "dist\$asarName"
    if (-not (Test-Path -LiteralPath $asar)) {
        $motivo = "o build nao gerou $asar. Rode 'pnpm build' no checkout $mod e tente de novo."
        Write-Warn $motivo
        return [pscustomobject]@{ Ok = $false; Motivo = $motivo }
    }
    $appAsar = Join-Path $resources 'app.asar'
    $backup = Join-Path $resources '_app.asar'
    if (-not (Test-Path -LiteralPath $backup) -and (Test-Path -LiteralPath $appAsar)) {
        Copy-Item -LiteralPath $appAsar -Destination $backup
        Write-Ok "Backup criado em $backup"
    }
    Copy-Item -LiteralPath $asar -Destination $appAsar -Force
    Write-Ok "$nome patcheado: $appAsar"
    return [pscustomobject]@{ Ok = $true; Motivo = '' }
}

function Show-ModChoice {
    if ($Mod) { return $Mod }

    $installed = Get-InstalledMod

    if (Test-TuiInteractive) {
        $tui = Tui-Menu 'Qual mod instalar?' @("Equicord — $($Mods.Equicord.Note)", "Vencord — $($Mods.Vencord.Note)")
        switch ($tui) {
            1 { return 'Equicord' }
            2 { return 'Vencord' }
            default { throw 'Cancelado.' }
        }
    }

    Write-Host ''
    if ($installed) {
        Write-Warn "Voce tem o $installed instalado, mas nao achei o codigo fonte dele."
        Write-Host '  Plugins de usuario so existem compilando do fonte, entao preciso baixar o repositorio.' -ForegroundColor DarkGray
    } else {
        Write-Warn 'Nao encontrei Equicord nem Vencord no seu computador.'
        Write-Host '  Posso baixar e instalar um dos dois junto com o plugin.' -ForegroundColor DarkGray
    }

    Write-Host ''
    Write-Host '  Qual voce quer instalar?' -ForegroundColor White
    Write-Host ''
    Write-Host "    [1] Equicord    $($Mods.Equicord.Note)" -ForegroundColor Green
    Write-Host "    [2] Vencord     $($Mods.Vencord.Note)" -ForegroundColor Cyan
    Write-Host '    [0] Cancelar' -ForegroundColor Gray
    Write-Host ''

    switch (Read-Escolha '  Escolha') {
        '1' { return 'Equicord' }
        '2' { return 'Vencord' }
        default { throw 'Cancelado.' }
    }
}

function Install-Pnpm {
    # O corepack vem ligado no Node 22 e cria um atalho do pnpm que quebra na primeira
    # execucao: as chaves de assinatura embutidas estao velhas ("Cannot find matching
    # keyid") ou ele pergunta "Corepack is about to download..." e, sem quem responder,
    # derruba o instalador. Desligar o corepack tira esse atalho do caminho; quem ja tiver
    # o pnpm de verdade instalado passa a ser encontrado de novo.
    # "disable pnpm", e nao "disable" seco: o segundo leva o atalho do yarn junto, e o yarn
    # nao e nosso para desligar. Esta funcao so roda com o pnpm ja reprovado no Test-Pnpm,
    # entao quem tem um corepack que funciona nunca passa por aqui.
    if (Test-Tool 'corepack') {
        Write-Step 'Desligando o atalho quebrado do pnpm no corepack'
        & corepack disable pnpm 2>$null | Out-Null
        if ($LASTEXITCODE -eq 0) { Update-PathFromEnvironment }
    }

    if (Test-Pnpm) { return }

    Write-Step 'Instalando o pnpm pelo npm'
    & npm install -g pnpm | Out-Host

    if ($LASTEXITCODE -eq 0) {
        Update-PathFromEnvironment
        if (Test-Pnpm) { return }
    }

    # O npm global mora na pasta do Node; com o Node instalado em "Arquivos de Programas"
    # (o instalador padrao do site), escrever ali exige admin e o npm falha com EPERM.
    # Num prefixo dentro do perfil o npm escreve sem admin, e o pnpm entra no PATH desta
    # sessao e fica registrado no PATH do usuario para as proximas.
    Write-Step 'O npm nao conseguiu escrever na pasta global; instalando num prefixo do seu perfil'
    $pnpmHome = Join-Path $env:LOCALAPPDATA 'pnpm-global'
    & npm install -g --prefix $pnpmHome pnpm | Out-Host
    if ($LASTEXITCODE -ne 0) {
        throw 'O npm nao conseguiu instalar o pnpm. Rode "npm install -g pnpm" num terminal como administrador e tente de novo.'
    }

    $env:Path = "$pnpmHome;$env:Path"
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    if ($userPath -notlike "*$pnpmHome*") {
        [Environment]::SetEnvironmentVariable('Path', "$pnpmHome;$userPath", 'User')
    }

    if (-not (Test-Pnpm)) {
        # Ultimo recurso, e o mais robusto: o instalador oficial baixa o binario standalone
        # do pnpm (que nem precisa do Node instalado) para %LOCALAPPDATA%\pnpm, sem admin
        # e sem depender do npm. O instalador pode ser 5.1 (sem verificacao de assinatura)
        # e ainda assim valida o checksum por baixo.
        Write-Step 'Baixando o pnpm do site oficial (pasta do usuario, sem admin)'
        $installer = Join-Path $env:TEMP 'install-pnpm.ps1'
        try {
            Invoke-WebRequest -UseBasicParsing -Uri 'https://get.pnpm.io/install.ps1' -OutFile $installer
            & powershell -NoProfile -ExecutionPolicy Bypass -File $installer 2>&1 | Out-Host
        } catch {
            Write-Step 'O download do site oficial falhou; seguindo para a checagem final.'
        }
        Update-PathFromEnvironment
        # O setup do pnpm grava o PATH do usuario; no caso de nao ter gravado, os dois
        # caminhos possiveis (com e sem \bin) entram aqui na sessao.
        $pnpmHome = Join-Path $env:LOCALAPPDATA 'pnpm'
        $env:Path = "$pnpmHome\bin;$pnpmHome;$env:Path"
    }

    if (-not (Test-Pnpm)) {
        throw 'Nao consegui deixar o pnpm funcionando. Abra um terminal e rode: npm install -g pnpm'
    }
}

function Install-Toolchain($needGit) {
    $missing = @()
    if ($needGit -and -not (Test-Tool 'git')) { $missing += 'git' }
    if (-not (Test-Tool 'node')) { $missing += 'node' }

    if ($missing.Count -gt 0) {
        Write-Warn "Faltando no seu PATH: $($missing -join ', ')"

        if (-not (Test-Tool 'winget')) {
            throw "Instale $($missing -join ' e ') manualmente e rode de novo."
        }

        if (-not (Confirm-Action 'Instalar agora com o winget?')) {
            throw "Instale $($missing -join ' e ') e rode de novo."
        }

        foreach ($tool in $missing) {
            $id = if ($tool -eq 'git') { 'Git.Git' } else { 'OpenJS.NodeJS.LTS' }
            Write-Step "winget install $id"
            & winget install --id $id --accept-source-agreements --accept-package-agreements --silent | Out-Host
        }

        Update-PathFromEnvironment
        $stillMissing = @()
        if ($needGit -and -not (Test-Tool 'git')) { $stillMissing += 'git' }
        if (-not (Test-Tool 'node')) { $stillMissing += 'node' }
        if ($stillMissing.Count -gt 0) {
            throw "O winget instalou $($stillMissing -join ', '), mas o executavel ainda nao apareceu no PATH desta sessao. Reinicie o Windows uma vez e rode o mesmo instalador novamente."
        }
    }

    if (-not (Test-Pnpm)) { Install-Pnpm }

    Write-Ok "pnpm $script:PnpmVersion"
}

function Install-Mod($choice) {
    $info = $Mods[$choice]
    $target = Join-Path $env:USERPROFILE $info.Label

    Write-Host ''
    Write-Host '  Vou fazer:' -ForegroundColor White
    Write-Host "    1. Baixar o $($info.Label) em $target" -ForegroundColor DarkGray
    Write-Host '    2. Instalar as dependencias' -ForegroundColor DarkGray
    Write-Host '    3. Compilar junto com o GoLiveBypass' -ForegroundColor DarkGray
    Write-Host '    4. Injetar no Discord (o Discord vai fechar)' -ForegroundColor DarkGray
    Write-Host ''
    if (-not (Confirm-Action 'Pode seguir?')) { throw 'Cancelado.' }

    Install-Toolchain $true

    if (Test-Path -LiteralPath $target) {
        if (-not (Test-ModCheckout $target)) {
            throw "$target ja existe e nao parece um checkout. Apague a pasta ou use -Source."
        }
        Write-Step "Ja existe um checkout em $target, reaproveitando"
        return $target
    }

    Write-Step "git clone $($info.Git)"
    & git clone --depth 1 $info.Git $target | Out-Host
    if ($LASTEXITCODE -ne 0) { throw 'git clone falhou' }

    return $target
}

function Stop-Discord {
    if (-not (Get-Process -Name $DiscordNames -ErrorAction SilentlyContinue)) { return }

    Write-Step 'Fechando o Discord'
    Get-Process -Name $DiscordNames -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

    for ($i = 0; $i -lt 30; $i++) {
        Start-Sleep -Milliseconds 300
        if (-not (Get-Process -Name $DiscordNames -ErrorAction SilentlyContinue)) { return }
    }

    throw 'O Discord nao fechou. Feche pelo icone na bandeja e rode de novo.'
}

function Copy-Plugin($root) {
    if (-not $root) { throw 'Caminho do checkout invalido para copiar o plugin.' }
    $target = Join-Path $root "src\userplugins\$PluginDirName"
    Write-Step "Instalando o plugin em $target"

    if (-not (Test-Path -LiteralPath $target)) { New-Item -ItemType Directory -Path $target -Force | Out-Null }

    # versoes antigas usavam index.ts; deixar os dois quebra o build
    $stale = Join-Path $target 'index.ts'
    if (Test-Path -LiteralPath $stale) { Remove-Item -LiteralPath $stale -Force }

    foreach ($file in $PluginFiles) {
        $leaf = Split-Path -Leaf $file
        if (-not $PluginSource -or [string]::IsNullOrWhiteSpace($PluginSource)) {
            Save-Text (Join-Path $target $leaf) (Get-RepoFile $file)
            continue
        }

        $local = Join-Path $PluginSource $leaf
        if (-not (Test-Path -LiteralPath $local)) { throw "Nao achei $leaf em $PluginSource." }
        Copy-Item -LiteralPath $local -Destination (Join-Path $target $leaf) -Force
    }

    if ($PluginSource -and -not [string]::IsNullOrWhiteSpace($PluginSource)) {
        Write-Warn "Plugin copiado de $PluginSource, e nao do GitHub."
    }
}

function Build-Mod($root) {
    if (-not $root) { throw 'Caminho do checkout invalido para compilar o mod.' }
    Push-Location -LiteralPath $root
    try {
        if (-not (Test-Path -LiteralPath (Join-Path $root 'node_modules'))) {
            Write-Step 'Instalando dependencias (na primeira vez demora alguns minutos)'
            & pnpm install
            if ($LASTEXITCODE -ne 0) { throw 'pnpm install falhou' }
        }

        Write-Step 'Compilando'
        & pnpm build
        if ($LASTEXITCODE -ne 0) { throw 'pnpm build falhou' }
    } finally {
        Pop-Location
    }
}

function Invoke-Injection($root, $targets) {
    if (-not $root) { throw 'Caminho do checkout invalido para injetar o mod.' }
    Push-Location -LiteralPath $root
    try {
        Stop-Discord
        $falha = $false
        # Detalhe por alvo: sem isto o relato automatico chegava so com a mensagem
        # generica e o log do RUNTIME (que nada diz sobre a injecao) -- issue #120.
        $detalhes = [System.Collections.Generic.List[string]]::new()
        foreach ($t in @($targets)) {
            if ($t.Tipo -eq 'P') {
                $resultado = Copy-PatchParallel $root $t.Resources
                if (-not $resultado.Ok) {
                    $falha = $true
                    # O motivo real (nao mais "no aviso acima"): antes disto, o motivo so ia
                    # para o console via Write-Warn e nunca chegava no relato automatico de bug
                    # (issues #123/#130/#132/#133, todas com "--- logs ---" vazio).
                    $detalhes.Add("cliente paralelo ($($t.Resources)): $($resultado.Motivo)")
                }
                continue
            }
            Write-Step "Injetando no $($t.Flavour)"
            # O --location espera a RAIZ da instalacao (...\Discord), nao o app-1.0.x:
            # e de la que o instalador do mod varre os app-*\resources. Espelho do
            # install_location() do .sh (dois dirnames). Passar o app-1.0.x fazia o
            # injector nao achar a instalacao e toda instalacao nova pela linha de
            # comando falhar (relato 1.1.11-beta.1).
            $loc = Split-Path -Parent (Split-Path -Parent $t.Resources)
            & pnpm run inject -- --location $loc
            if ($LASTEXITCODE -ne 0) {
                # Nem todo pnpm come o -- : cai no caminho de sempre (o instalador
                # do mod pergunta) — espelho do run_inject do .sh.
                & pnpm inject
                if ($LASTEXITCODE -ne 0) {
                    $falha = $true
                    $detalhes.Add("$($t.Flavour): pnpm inject saiu com codigo $LASTEXITCODE ($($t.Resources))")
                }
            }
        }
        if ($falha) {
            $msg = 'Falha ao injetar em algum dos Discords escolhidos.'
            if ($detalhes.Count -gt 0) { $msg = "$msg -- " + ($detalhes -join '; ') }
            throw $msg
        }
    } finally {
        Pop-Location
    }
}

function Start-Discord {
    foreach ($name in $DiscordNames) {
        $exe = Join-Path $env:LOCALAPPDATA "$name\Update.exe"
        if (Test-Path -LiteralPath $exe) {
            Start-Process -FilePath $exe -ArgumentList '--processStart', "$name.exe"
            return
        }
    }
}

function Invoke-Install($root) {
    $root = Select-Target $root

    # Um comando nativo escreve na saida da funcao que o chama, e Select-Target chama outras que
    # rodam npm e git. Se qualquer uma voltar a deixar escapar, $root chega como array e o
    # Test-Path quebra ao ligar um elemento vazio, com uma mensagem sobre parametro que nao diz
    # nada. Ficar com a ultima linha nao esconde erro: a checagem logo abaixo continua valendo.
    $root = @($root) | Where-Object { $_ } | Select-Object -Last 1

    # Sem esta checagem, um checkout que nao ficou pronto virava "nao e possivel associar o
    # argumento ao parametro Path", que nao diz nada a quem esta instalando.
    if (-not $root -or -not (Test-Path -LiteralPath $root)) {
        throw 'Nao consegui preparar a pasta do Equicord/Vencord. Rode de novo, ou use -Source "C:\caminho\do\Equicord" apontando para um checkout que voce ja tenha.'
    }
    $proxy = Select-Proxy
    $permanent = Select-Persistence

    Install-Toolchain $false
    Copy-Plugin $root
    Build-Mod $root

    $targets = @(Select-InjectionTargets @(Get-PatchTargets))
    $oficiais = @($targets | Where-Object { $_.Tipo -eq 'O' })
    $paralelos = @($targets | Where-Object { $_.Tipo -eq 'P' })

    # Ja injetado = TODOS os oficiais escolhidos ja apontam para este checkout.
    $oficialPendente = $false
    foreach ($t in $oficiais) {
        $inj = Get-InjectedPath $t.Resources
        if (-not $inj -or -not $inj.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) { $oficialPendente = $true }
    }

    if ($oficialPendente -or $paralelos.Count -gt 0) {
        Invoke-Injection $root $targets
    } else {
        Write-Step 'O Discord ja carrega deste checkout, so reiniciando'
        Stop-Discord
    }

    # Com o Discord fechado: aberto, ele regrava o settings.json a partir da memoria e
    # apaga o que escrevemos aqui.
    Set-PluginSettings $root $proxy

    Start-Discord

    Write-Host ''
    Write-Ok 'Pronto. O plugin ja vem ativado, nao precisa mexer em nada.'
    if ($proxy) {
        # A senha nao aparece na tela: a pessoa costuma tirar print desta parte para mostrar que
        # deu certo.
        Write-Host "  Proxy: $(Hide-ProxySecret $proxy)" -ForegroundColor DarkGray
    } else {
        Write-Host '  Proxy: gratuita, escolhida e testada sozinha a cada abertura' -ForegroundColor DarkGray
    }
    Write-Host '  Entre numa call e use Go Live ou a camera.' -ForegroundColor DarkGray

    if (-not $permanent) {
        if ($weInjected) {
            Wait-DiscordExit $root
        } else {
            Write-Warn 'O Discord ja estava injetado antes de eu rodar, entao nao vou desfazer isso.'
            Write-Host '  Para remover depois: .\GoLiveBypass-Installer.ps1 -Mode Uninstall' -ForegroundColor DarkGray
        }
    }
}

function Invoke-Uninstall {
    $root = Find-Checkout
    if (-not $root) { throw 'Nao encontrei o checkout do Equicord/Vencord. Use -Source.' }

    $target = Join-Path $root "src\userplugins\$PluginDirName"
    if (Test-Path -LiteralPath $target) {
        Write-Step "Removendo $target"
        Remove-Item -LiteralPath $target -Recurse -Force
    } else {
        Write-Warn 'O plugin nao estava instalado nesse checkout.'
    }

    Remove-Tor
    Build-Mod $root
    Stop-Discord
    Start-Discord

    Write-Host ''
    Write-Ok 'Plugin removido. Seu Equicord/Vencord continua funcionando.'
}

# =============================================================================== interface

function Get-CheckoutMod($root) {
    # A identidade vem do package.json, nao do nome da pasta: quem baixou o ZIP tem o repo
    # numa pasta chamada Equicord-main, e ai o nome da pasta nao diz nada.
    $manifest = Join-Path $root 'package.json'
    if (Test-Path -LiteralPath $manifest) {
        try {
            $name = (Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json).name
            if ($name -match 'equicord') { return 'Equicord' }
            if ($name -match 'vencord') { return 'Vencord' }
        } catch { }
    }

    if ((Split-Path -Leaf $root) -match 'vencord') { return 'Vencord' }
    return 'Equicord'
}

function Get-ModSettingsFile($root) {
    # Mesma regra do proprio mod (src/main/utils/constants.ts):
    #   DATA_DIR = <MOD>_USER_DATA_DIR ?? %APPDATA%\<Mod>
    #   SETTINGS_FILE = DATA_DIR\settings\settings.json
    $mod = Get-CheckoutMod $root

    $override = [Environment]::GetEnvironmentVariable("$($mod.ToUpper())_USER_DATA_DIR")
    if ($override) { return (Join-Path $override 'settings\settings.json') }

    return (Join-Path $env:APPDATA "$mod\settings\settings.json")
}

function Set-PluginSettings($root, $proxy) {
    $file = Get-ModSettingsFile $root

    $settings = $null
    if (Test-Path -LiteralPath $file) {
        try { $settings = Get-Content -LiteralPath $file -Raw | ConvertFrom-Json } catch { $settings = 'ilegivel' }
    }

    # Nunca reescrever por cima de um arquivo que nao deu para ler: isso apagaria todos os
    # plugins da pessoa. Melhor guardar uma copia e deixar ela ativar o plugin na mao.
    if ($settings -is [string]) {
        $backup = "$file.bak-$(Get-Date -Format yyyyMMdd-HHmmss)"
        Copy-Item -LiteralPath $file -Destination $backup -Force
        Write-Warn "Nao consegui ler $file, entao nao mexi nele. Copia em $backup"
        Write-Warn 'Ative o GoLiveBypass na mao em Configuracoes > Plugins.'
        return
    }

    if ($null -eq $settings) { $settings = [pscustomobject]@{} }

    if (-not $settings.PSObject.Properties['plugins']) {
        $settings | Add-Member -NotePropertyName plugins -NotePropertyValue ([pscustomobject]@{}) -Force
    }

    $existing = $settings.plugins.PSObject.Properties['GoLiveBypass']
    $plugin = if ($existing) { $existing.Value } else { [pscustomobject]@{} }

    $plugin | Add-Member -NotePropertyName enabled -NotePropertyValue $true -Force
    $plugin | Add-Member -NotePropertyName proxy -NotePropertyValue $proxy -Force
    if (-not $plugin.PSObject.Properties['excludedCountries']) {
        $plugin | Add-Member -NotePropertyName excludedCountries -NotePropertyValue 'BR' -Force
    }

    $settings.plugins | Add-Member -NotePropertyName GoLiveBypass -NotePropertyValue $plugin -Force

    Save-Text $file ($settings | ConvertTo-Json -Depth 10)

    $written = $null
    try { $written = (Get-Content -LiteralPath $file -Raw | ConvertFrom-Json).plugins.GoLiveBypass } catch { }
    if ($written -and $written.enabled) {
        Write-Step "Plugin ativado em $file"
    } else {
        Write-Warn "Nao consegui confirmar a escrita em $file"
        Write-Host '  Ative o GoLiveBypass na mao em Configuracoes > Plugins.' -ForegroundColor DarkGray
    }
}

function Show-Status($root) {
    $discord = (Get-DiscordResources).Count
    $mod = Get-InstalledMod

    Write-Host '  Detectado:' -ForegroundColor White
    if ($discord -gt 0) { Write-Host "    Discord   instalado ($discord versao(oes))" -ForegroundColor DarkGray }
    else { Write-Host '    Discord   nao encontrado' -ForegroundColor Yellow }

    if ($mod) { Write-Host "    Mod       $mod" -ForegroundColor DarkGray }
    else { Write-Host '    Mod       nenhum' -ForegroundColor DarkGray }

    if ($root) {
        Write-Host "    Fonte     $root" -ForegroundColor DarkGray
        $plugin = Join-Path $root "src\userplugins\$PluginDirName"
        if (Test-Path -LiteralPath $plugin) { Write-Host '    Plugin    ja instalado' -ForegroundColor Green }
        else { Write-Host '    Plugin    nao instalado' -ForegroundColor DarkGray }
    } else {
        Write-Host '    Fonte     nao encontrado' -ForegroundColor DarkGray
    }
    Write-Host ''
}

function Select-Target($root) {
    if (-not $root) { return (Install-Mod (Show-ModChoice)) }
    if ($Yes) { return $root }

    $name = Split-Path -Leaf $root

    if (Test-TuiInteractive) {
        $tui = Tui-Menu 'Onde instalar?' @("Usar o $name que ja esta aqui", "Baixar e usar outro (Equicord ou Vencord)")
        if ($tui -eq 2) { return (Install-Mod (Show-ModChoice)) }
        return $root
    }

    Write-Host '  Onde instalar?' -ForegroundColor White
    Write-Host ''
    Write-Host "    [1] Usar o $name que ja esta aqui" -ForegroundColor Green
    Write-Host "        $root" -ForegroundColor DarkGray
    Write-Host '    [2] Baixar e usar outro (Equicord ou Vencord)' -ForegroundColor Cyan
    Write-Host ''

    switch (Read-Escolha '  Escolha') {
        '2' { return (Install-Mod (Show-ModChoice)) }
        default { return $root }
    }
}

# =============================================================== Tor embutido

function Get-TorBaseDir {
    return (Join-Path (Get-EffectiveLocalApp) 'GoLiveBypass\Tor')
}

function Get-TorExe {
    return (Join-Path (Get-TorBaseDir) 'tor\tor.exe')
}

function Get-ManagedTorVersion($exe) {
    if (-not $exe -or -not (Test-Path -LiteralPath $exe)) { return $null }
    try {
        $out = & $exe --version 2>$null
        if ($LASTEXITCODE -ne 0) { return $null }
        $text = ($out | Out-String).Trim()
        $match = [regex]::Match($text, 'Tor version ([0-9]+\.[0-9]+\.[0-9]+(?:\.[0-9]+)?)')
        if ($match.Success) { return $match.Groups[1].Value }
    } catch { }
    return $null
}

function Test-SupportedManagedTor($exe) {
    $version = Get-ManagedTorVersion $exe
    if (-not $version) { return $false }
    try {
        return ([version]$version) -ge ([version]'0.4.9.0')
    } catch {
        return $false
    }
}

function Test-TorReady {
    # Cheap bootstrap hint only. A listening SOCKS port is NOT readiness.
    try {
        $client = New-Object System.Net.Sockets.TcpClient
        $task = $client.ConnectAsync('127.0.0.1', $TorPort)
        if (-not $task.Wait(1500)) { $client.Close(); return $false }
        $ok = $client.Connected
        $client.Close()
        return $ok
    } catch { return $false }
}

function Read-ExactBytes($stream, [int]$count) {
    [byte[]]$buffer = New-Object byte[] $count
    $offset = 0
    while ($offset -lt $count) {
        $read = $stream.Read($buffer, $offset, $count - $offset)
        if ($read -le 0) { throw 'socket fechou antes da resposta completa' }
        $offset += $read
    }
    return ,$buffer
}

function Test-TorGatewayTunnel([int]$TimeoutMs = 20000) {
    $target = 'gateway.discord.gg'
    $client = $null
    $ssl = $null
    $script:LastTorProbe = 'TCP local'

    try {
        $client = New-Object System.Net.Sockets.TcpClient
        $connect = $client.BeginConnect('127.0.0.1', $TorPort, $null, $null)
        if (-not $connect.AsyncWaitHandle.WaitOne(1500)) {
            $script:LastTorProbe = 'timeout conectando na porta SOCKS local'
            return $false
        }
        $client.EndConnect($connect)

        $stream = $client.GetStream()
        $stream.ReadTimeout = $TimeoutMs
        $stream.WriteTimeout = $TimeoutMs

        $script:LastTorProbe = 'SOCKS5 greeting'
        [byte[]]$hello = @(5, 1, 0)
        $stream.Write($hello, 0, $hello.Length)
        $helloReply = Read-ExactBytes $stream 2
        if ($helloReply.Length -ne 2 -or $helloReply[0] -ne 5 -or $helloReply[1] -ne 0) {
            $script:LastTorProbe = 'SOCKS5 greeting recusado'
            return $false
        }

        $script:LastTorProbe = 'SOCKS5 CONNECT gateway.discord.gg:443'
        [byte[]]$hostBytes = [Text.Encoding]::ASCII.GetBytes($target)
        [byte[]]$request = New-Object byte[] ($hostBytes.Length + 7)
        $request[0] = 5
        $request[1] = 1
        $request[2] = 0
        $request[3] = 3
        $request[4] = [byte]$hostBytes.Length
        [Array]::Copy($hostBytes, 0, $request, 5, $hostBytes.Length)
        $request[5 + $hostBytes.Length] = 1
        $request[6 + $hostBytes.Length] = 187
        $stream.Write($request, 0, $request.Length)

        $head = Read-ExactBytes $stream 4
        if ($head.Length -ne 4 -or $head[0] -ne 5) {
            $script:LastTorProbe = 'resposta SOCKS invalida'
            return $false
        }
        if ($head[1] -ne 0) {
            $script:LastTorProbe = "SOCKS CONNECT recusado (codigo $($head[1]))"
            return $false
        }

        switch ($head[3]) {
            1 { [void](Read-ExactBytes $stream 6) }
            3 {
                $size = Read-ExactBytes $stream 1
                [void](Read-ExactBytes $stream ([int]$size[0] + 2))
            }
            4 { [void](Read-ExactBytes $stream 18) }
            default {
                $script:LastTorProbe = 'tipo de endereco SOCKS desconhecido'
                return $false
            }
        }

        $script:LastTorProbe = 'TLS gateway.discord.gg'
        $ssl = New-Object System.Net.Security.SslStream($stream, $false)
        $auth = $ssl.BeginAuthenticateAsClient($target, $null, $null)
        if (-not $auth.AsyncWaitHandle.WaitOne($TimeoutMs)) {
            $script:LastTorProbe = 'timeout no TLS do gateway'
            return $false
        }
        $ssl.EndAuthenticateAsClient($auth)
        if (-not $ssl.IsAuthenticated) {
            $script:LastTorProbe = 'TLS terminou sem autenticacao'
            return $false
        }

        $script:LastTorProbe = 'OK SOCKS5 + TLS'
        return $true
    } catch {
        $script:LastTorProbe = "erro em probe: $($_.Exception.GetType().Name): $($_.Exception.Message)"
        return $false
    } finally {
        if ($ssl) { try { $ssl.Dispose() } catch { } }
        if ($client) { try { $client.Close() } catch { } }
    }
}

function Test-TorGatewayWithCurl([int]$TimeoutSeconds = 25) {
    $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
    if (-not $curl) { return $false }

    try {
        $out = & $curl.Source --silent --show-error --socks5-hostname "127.0.0.1:$TorPort" --connect-timeout 15 --max-time $TimeoutSeconds --output NUL --write-out '%{http_code}' 'https://gateway.discord.gg/?v=10&encoding=json' 2>$null
        if ($LASTEXITCODE -eq 0 -and "$out" -match '^\d{3}$' -and "$out" -ne '000') {
            $script:LastTorProbe = "OK via curl (HTTP $out)"
            return $true
        }
    } catch { }

    return $false
}

function Wait-TorGateway([int]$TimeoutSeconds = 90) {
    $watch = [Diagnostics.Stopwatch]::StartNew()
    $lastStatusAt = -10000
    $announcedPort = $false

    while ($watch.Elapsed.TotalSeconds -lt $TimeoutSeconds) {
        if (Test-TorReady) {
            if (-not $announcedPort) {
                Write-Step 'Porta SOCKS aberta; aguardando circuito funcional ate o gateway do Discord'
                $announcedPort = $true
            }

            if ((Test-TorGatewayTunnel 20000) -or (Test-TorGatewayWithCurl 25)) {
                return $true
            }

            if (($watch.ElapsedMilliseconds - $lastStatusAt) -ge 10000) {
                Write-Step "Tor ainda inicializando: $script:LastTorProbe"
                $lastStatusAt = $watch.ElapsedMilliseconds
            }
        }

        Start-Sleep -Milliseconds 1000
    }

    return $false
}

function Stop-ManagedTor($exe) {
    if (-not $exe -or -not (Test-Path -LiteralPath $exe)) { return }
    try {
        $target = [IO.Path]::GetFullPath($exe)
        Get-CimInstance Win32_Process -Filter "Name='tor.exe'" -ErrorAction SilentlyContinue | ForEach-Object {
            try {
                if ($_.ExecutablePath -and [IO.Path]::GetFullPath($_.ExecutablePath) -eq $target) {
                    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
                }
            } catch { }
        }
    } catch { }
}

function Test-LegacyTorStartup {
    try {
        $key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
        $props = Get-ItemProperty -Path $key -ErrorAction SilentlyContinue
        foreach ($p in $props.PSObject.Properties) {
            if ($p.Name -like 'PS*' -or -not ($p.Value -is [string])) { continue }
            $value = [string]$p.Value
            if ($value -match '(?i)GoLiveBypass[\\/]Tor' -and
                $value -match '(?i)tor\.exe' -and
                $value -notmatch '(?i)wscript\.exe') {
                return $true
            }
        }
    } catch { }
    return $false
}

function Remove-LegacyTorStartupEntries {
    try {
        $key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
        $props = Get-ItemProperty -Path $key -ErrorAction SilentlyContinue
        foreach ($p in $props.PSObject.Properties) {
            if ($p.Name -like 'PS*' -or $p.Name -eq 'GoLiveBypassTor' -or -not ($p.Value -is [string])) { continue }
            $value = [string]$p.Value
            if ($value -match '(?i)GoLiveBypass[\\/]Tor' -and $value -match '(?i)tor\.exe') {
                Remove-ItemProperty -Path $key -Name $p.Name -ErrorAction SilentlyContinue
            }
        }
    } catch { }
}

function Get-TorServiceStatus {
    try {
        $svc = Get-CimInstance Win32_Service -Filter "Name='tor'" -ErrorAction SilentlyContinue
        if ($svc -and $svc.State -eq 'Running') { return 'running' }
        return 'absent'
    } catch { return 'unknown' }
}

function Install-Tor {
    $base = Get-TorBaseDir
    $exe = Get-TorExe
    $torrc = Join-Path $base 'torrc'
    $bootstrapLog = Join-Path $base 'tor-bootstrap.log'
    $marker = Join-Path $base 'bundle-version.txt'
    $legacyVisibleStartup = Test-LegacyTorStartup

    $installedBundle = $null
    if (Test-Path -LiteralPath $marker) {
        try { $installedBundle = (Get-Content -LiteralPath $marker -Raw).Trim() } catch { }
    }

    if ((Test-Path -LiteralPath $exe) -and $installedBundle -ne $TorBundle) {
        Write-Step "Atualizando Tor antigo para Expert Bundle $TorBundle (Tor 0.4.9.11)"
        Stop-ManagedTor $exe
        Start-Sleep -Milliseconds 600
        Remove-CaminhoSilencioso (Join-Path $base 'tor')
        Remove-CaminhoSilencioso (Join-Path $base 'data')
        Remove-CaminhoSilencioso $marker
    }

    if ((Test-Path -LiteralPath $exe) -and (Test-Path -LiteralPath $marker) -and
        (Test-SupportedManagedTor $exe) -and (Test-TorReady)) {
        Write-Step "Tor $TorBundle escutando em 127.0.0.1:$TorPort; validando circuito"
        if (Wait-TorGateway 45) {
            [void](Set-RunKey $exe $torrc)
            Remove-LegacyTorStartupEntries
            Write-Ok 'Tor abriu SOCKS + TLS ate gateway.discord.gg.'
            return $true
        }

        Write-Warn "Tor atual esta escutando mas nao entrega o gateway ($script:LastTorProbe); reiniciando somente este daemon."
        Stop-ManagedTor $exe
        Start-Sleep -Milliseconds 700
    }

    if (-not (Test-Path -LiteralPath $exe)) {
        Write-Step "Baixando Tor Expert Bundle $TorBundle (Tor 0.4.9.11, ~22 MB)"
        $asset = $TorUrls.Values | Select-Object -First 1
        $temp = if ($env:TEMP -and (Test-Path -LiteralPath $env:TEMP)) { $env:TEMP } else { [System.IO.Path]::GetTempPath() }
        $archive = Join-Path $temp $asset.Url.Split('/')[-1]

        try {
            Invoke-WebRequest -UseBasicParsing -Uri $asset.Url -OutFile $archive
        } catch {
            Write-Warn "Falha ao baixar o Tor: $($_.Exception.Message)"
            return $false
        }

        Write-Step 'Conferindo SHA-256 oficial'
        $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $archive).Hash.ToLower()
        if ($hash -ne $asset.Sha256.ToLower()) {
            Remove-CaminhoSilencioso $archive
            Write-Warn "SHA-256 do Tor nao confere (obtido $hash). Abortando."
            return $false
        }

        Write-Step 'Extraindo o Tor'
        New-Item -ItemType Directory -Path $base -Force | Out-Null
        & tar -xzf $archive -C $base --exclude 'tor/pluggable_transports/*' --exclude 'debug/*'
        if ($LASTEXITCODE -ne 0) {
            Write-Warn 'Falha ao extrair o bundle do Tor.'
            return $false
        }
        Remove-CaminhoSilencioso $archive
    }

    if (-not (Test-Path -LiteralPath $exe)) {
        Write-Warn "O binario do Tor nao apareceu em $exe."
        return $false
    }

    $dataDir = Join-Path $base 'data-state'
    New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
    $torrcText = @"
SocksPort $TorPort
ClientOnly 1
DataDirectory $dataDir
$(
    if (Test-Path -LiteralPath (Join-Path $base 'data\geoip')) {
        "GeoIPFile $(Join-Path $base 'data\geoip')"
    } elseif (Test-Path -LiteralPath (Join-Path $base 'tor\data\geoip')) {
        "GeoIPFile $(Join-Path $base 'tor\data\geoip')"
    }
)
$(
    if (Test-Path -LiteralPath (Join-Path $base 'data\geoip6')) {
        "GeoIPv6File $(Join-Path $base 'data\geoip6')"
    } elseif (Test-Path -LiteralPath (Join-Path $base 'tor\data\geoip6')) {
        "GeoIPv6File $(Join-Path $base 'tor\data\geoip6')"
    }
)
# File logging itself can make Tor abort on Windows if the target is parsed
# differently across Tor generations. The managed launcher captures stdout/stderr.
Log notice stdout
"@
    Save-Text $torrc $torrcText

    $actualTorVersion = Get-ManagedTorVersion $exe
    if (-not (Test-SupportedManagedTor $exe)) {
        Write-Warn "O tor.exe baixado nao iniciou corretamente ou e antigo (versao detectada: $actualTorVersion)."
        return $false
    }
    Write-Step "Binario Tor confirmado: $actualTorVersion"

    Write-Step 'Validando torrc com o proprio Tor'
    $verifyOutput = @()
    try {
        $verifyOutput = @(& $exe --verify-config -f $torrc 2>&1)
        $verifyExit = $LASTEXITCODE
    } catch {
        Write-Warn "tor.exe falhou antes do bootstrap: $($_.Exception.Message)"
        return $false
    }
    if ($verifyExit -ne 0) {
        Write-Warn "torrc recusado pelo Tor (codigo $verifyExit)."
        $verifyOutput | Select-Object -Last 20 | ForEach-Object { Write-Host "      $_" -ForegroundColor DarkGray }
        return $false
    }

    Write-Step 'Registrando o Tor na inicializacao do usuario (invisivel)'
    if (-not (Set-RunKey $exe $torrc)) { return $false }
    Remove-LegacyTorStartupEntries

    Stop-ManagedTor $exe
    Start-Sleep -Milliseconds 300
    Write-Step 'Iniciando o Tor sem janela'
    $torStdout = Join-Path $base 'tor-startup.stdout.log'
    $torStderr = Join-Path $base 'tor-startup.stderr.log'
    Remove-CaminhoSilencioso $torStdout
    Remove-CaminhoSilencioso $torStderr

    try {
        $torProcess = Start-Process -FilePath $exe -ArgumentList '-f', $torrc -WindowStyle Hidden -PassThru `
            -RedirectStandardOutput $torStdout -RedirectStandardError $torStderr
    } catch {
        Write-Warn "Windows nao conseguiu iniciar tor.exe: $($_.Exception.Message)"
        return $false
    }

    Start-Sleep -Milliseconds 1200
    try {
        if ($torProcess.HasExited) {
            Write-Warn "tor.exe encerrou imediatamente (codigo $($torProcess.ExitCode))."
            foreach ($startupLog in @($torStderr, $torStdout, $bootstrapLog)) {
                if (Test-Path -LiteralPath $startupLog) {
                    Write-Host "      --- $(Split-Path -Leaf $startupLog) ---" -ForegroundColor DarkGray
                    Get-Content -LiteralPath $startupLog -Tail 40 | ForEach-Object {
                        Write-Host "      $_" -ForegroundColor DarkGray
                    }
                }
            }
            return $false
        }
    } catch { }

    Write-Step 'Esperando bootstrap + SOCKS + TLS ate gateway.discord.gg'
    if (-not (Wait-TorGateway 120)) {
        Write-Warn "Tor nao conseguiu entregar o gateway: $script:LastTorProbe"
        foreach ($diagLog in @($torStderr, $torStdout, $bootstrapLog)) {
            if (Test-Path -LiteralPath $diagLog) {
                Write-Host "      --- $(Split-Path -Leaf $diagLog) ---" -ForegroundColor DarkGray
                Get-Content -LiteralPath $diagLog -Tail 40 | ForEach-Object {
                    Write-Host "      $_" -ForegroundColor DarkGray
                }
            }
        }
        return $false
    }

    $actualTorVersion = Get-ManagedTorVersion $exe
    Save-Text $marker $TorBundle
    Write-Ok "Tor $TorBundle / $actualTorVersion pronto em 127.0.0.1:$TorPort (SOCKS5 + TLS confirmado)."
    return $true
}

function Set-RunKey($exe, $torrc) {
    try {
        # ATENCAO: nada de "New-Item -Path <chave> -Force" aqui. No provider de
        # registro (diferente do de arquivos) o -Force numa chave que ja existe
        # APAGA a chave e recria vazia, levando junto todas as entradas de
        # inicializacao do usuario (Spotify, Steam, Discord...).
        # A chave Run sempre existe no Windows; so criamos se realmente faltar.
        $key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
        if (-not (Test-Path -LiteralPath $key)) {
            New-Item -Path $key -Force | Out-Null
        }
        # O tor.exe e binario CONSOLE: a Run key apontando direto para ele abre uma
        # janela de terminal visivel a cada logon. O wrapper .vbs via wscript.exe
        # (aplicacao GUI-subsystem) lanca o tor com janela 0 = invisivel, sem o
        # flash de console.
        $vbs = Join-Path (Split-Path -Parent $torrc) 'GoLiveBypassTor.vbs'
        $inner = "`"$exe`" -f `"$torrc`"".Replace('"', '""')
        # Unicode (UTF-16 com BOM): wscript detecta o BOM e le caminhos com acento
        # que o ANSI do sistema nao representaria.
        [System.IO.File]::WriteAllText($vbs, "CreateObject(`"WScript.Shell`").Run `"$inner`", 0, False", [System.Text.Encoding]::Unicode)
        $command = "`"$env:SystemRoot\System32\wscript.exe`" `"$vbs`""
        Set-ItemProperty -Path $key -Name 'GoLiveBypassTor' -Value $command
        Write-Ok 'Tor registrado para subir no proximo logon, sem janela de terminal (GoLiveBypassTor).'
        return $true
    } catch {
        Write-Warn "Nao consegui registrar a inicializacao: $($_.Exception.Message)"
        return $false
    }
}

function Remove-Tor {
    # Desinstala o que este instalador criou: a Run key. Se existir um servico "tor" apontando
    # para a nossa pasta (instalacao anterior), remove tambem; se for de outra pessoa, nao mexe.
    $exe = Get-TorExe
    try {
        $key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
        Remove-ItemProperty -Path $key -Name 'GoLiveBypassTor' -ErrorAction SilentlyContinue
    } catch { }
    # O wrapper invisivel que o Set-RunKey gravou ao lado do torrc tambem sai.
    try {
        Remove-Item -LiteralPath (Join-Path (Get-TorBaseDir) 'GoLiveBypassTor.vbs') -Force -ErrorAction SilentlyContinue
    } catch { }

    if (Test-Path -LiteralPath $exe) {
        try {
            $service = Get-CimInstance Win32_Service -Filter "Name='tor' AND PathName LIKE '%GoLiveBypass%'" -ErrorAction SilentlyContinue
            if ($service) {
                Write-Step 'Removendo o servico do Tor'
                & $exe --service stop 2>&1 | Out-Null
                & $exe --service remove 2>&1 | Out-Null
            }
        } catch { }
    }

    # O binario fica: a GUI usa o mesmo e sem ela nao faz mal.
    if (Test-Path -LiteralPath $exe) {
        Write-Host '  [*] O binario do Tor em %LOCALAPPDATA%\GoLiveBypass\Tor permanece (usado tambem pela GUI).' -ForegroundColor DarkGray
    }
}

function Select-Proxy {
    if ($Tor -or $Yes) {
        if (-not (Install-Tor)) {
            throw 'Tor nao conseguiu abrir um tunel TLS ate gateway.discord.gg. O Discord nao sera alterado.'
        }
        return "socks5://127.0.0.1:$TorPort"
    }

    if (Test-TuiInteractive) {
        $tui = Tui-Menu 'Como o bypass vai sair para fora do Brasil?' @(
            'Tor automatico (recomendado, baixa e sobe sozinho)',
            'Proxy minha (socks5://host:porta)',
            'Proxy publica gratuita (somente se voce escolher explicitamente)'
        )
        switch ($tui) {
            2 {
                $manual = (Tui-Input 'Endereco da proxy').Trim()
                if ($manual -notmatch '^(socks5|https?)://(?:.+@)?[a-z0-9.-]{1,253}:\d{1,5}(?:-\d{1,5})?$') {
                    throw 'Formato invalido. Use socks5://host:porta, ou socks5://usuario:senha@host:porta.'
                }
                return $manual
            }
            3 { return '' }
            default {
                if (-not (Install-Tor)) {
                    throw 'Tor nao conseguiu abrir um tunel TLS ate gateway.discord.gg. Nao vou cair para proxy publica.'
                }
                return "socks5://127.0.0.1:$TorPort"
            }
        }
    }

    Write-Host ''
    Write-Host '  Como o bypass vai sair para fora do Brasil?' -ForegroundColor White
    Write-Host ''
    Write-Host '    [1] Tor automatico (recomendado)' -ForegroundColor Green
    Write-Host '        Baixa, valida SOCKS+TLS e deixa o daemon invisivel.' -ForegroundColor DarkGray
    Write-Host '    [2] Proxy minha' -ForegroundColor Cyan
    Write-Host '        socks5://host:porta ou https://host:porta' -ForegroundColor DarkGray
    Write-Host '    [3] Proxy publica gratuita (opt-in)' -ForegroundColor Yellow
    Write-Host '        So use se voce aceitar confiar em uma saida publica.' -ForegroundColor DarkGray
    Write-Host ''

    switch (Read-Escolha '  Escolha') {
        '2' {
            Write-Host '  Se a sua proxy pedir login, use socks5://usuario:senha@host:porta' -ForegroundColor DarkGray
            $manual = (Read-Escolha '  Endereco da proxy').Trim()
            if ($manual -notmatch '^(socks5|https?)://(?:.+@)?[a-z0-9.-]{1,253}:\d{1,5}(?:-\d{1,5})?$') {
                throw 'Formato invalido. Use socks5://host:porta, ou socks5://usuario:senha@host:porta.'
            }
            return $manual
        }
        '3' { return '' }
        default {
            if (-not (Install-Tor)) {
                throw 'Tor nao conseguiu abrir um tunel TLS ate gateway.discord.gg. Nao vou cair para proxy publica.'
            }
            return "socks5://127.0.0.1:$TorPort"
        }
    }
}

function Select-Persistence {
    if ($Yes) { return $true }

    if (Test-TuiInteractive) {
        $tui = Tui-Menu 'Como voce quer deixar o Discord?' @(
            'Permanente (abre com o mod toda vez)',
            'Temporario (desfaz quando voce fechar o Discord)'
        )
        return $tui -ne 2
    }

    Write-Host ''
    Write-Host '  Como voce quer deixar o Discord?' -ForegroundColor White
    Write-Host ''
    Write-Host '    [1] Permanente' -ForegroundColor Green
    Write-Host '        O Discord abre com o mod toda vez, ate voce remover.' -ForegroundColor DarkGray
    Write-Host '    [2] Temporario' -ForegroundColor Yellow
    Write-Host '        Vale so nesta sessao. Quando voce fechar o Discord, a injecao e desfeita.' -ForegroundColor DarkGray
    Write-Host ''

    return (Read-Escolha '  Escolha') -ne '2'
}

function Wait-DiscordExit($root) {
    Write-Host ''
    Write-Ok 'Discord aberto com o GoLiveBypass.'
    Write-Warn 'Deixe esta janela aberta. Quando voce fechar o Discord, eu desfaco a injecao.'
    Write-Host '  Se fechar esta janela antes, rode: .\GoLiveBypass-Installer.ps1 -Mode Uninstall' -ForegroundColor DarkGray

    try {
        # Esperar o Discord APARECER antes de esperar ele sumir. Sem isso, o Update.exe ainda
        # nao trocou de processo e o laco acha que ja fechou, desfazendo tudo em 5 segundos.
        for ($i = 0; $i -lt 90; $i++) {
            if (Get-Process -Name $DiscordNames -ErrorAction SilentlyContinue) { break }
            Start-Sleep -Seconds 1
        }

        if (-not (Get-Process -Name $DiscordNames -ErrorAction SilentlyContinue)) {
            Write-Warn 'O Discord nao abriu em 90s. Vou desfazer a injecao agora.'
        } else {
            while (Get-Process -Name $DiscordNames -ErrorAction SilentlyContinue) { Start-Sleep -Seconds 2 }
            Write-Host ''
            Write-Step 'Discord fechado, desfazendo a injecao'
        }
    } finally {
        # finally para que Ctrl+C tambem desfaca, em vez de deixar o Discord injetado.
        Push-Location -LiteralPath $root
        try {
            & pnpm uninject
            if ($LASTEXITCODE -ne 0) { Write-Warn 'O pnpm uninject falhou. Rode "pnpm uninject" na pasta do mod.' }
            else { Write-Ok 'Discord restaurado.' }
        } finally { Pop-Location }
    }
}

function Invoke-RestoreEverything {
    $root = Find-Checkout
    if ($root) {
        $target = Join-Path $root "src\userplugins\$PluginDirName"
        if (Test-Path -LiteralPath $target) {
            Write-Step "Removendo $target"
            Remove-Item -LiteralPath $target -Recurse -Force
        }

        Stop-Discord
        Push-Location -LiteralPath $root
        try {
            Write-Step 'Desfazendo a injecao'
            & pnpm uninject
        } finally { Pop-Location }
    } else {
        Write-Warn 'Nao achei o fonte do mod, entao so posso parar por aqui.'
    }

    Remove-Tor
    Write-Host ''
    Write-Ok 'Tudo restaurado. Seu Discord voltou ao normal.'
}

function Show-MainMenu {
    $root = Find-Checkout
    Show-Status $root

    if (Test-TuiInteractive) {
        $tui = Tui-Menu 'O que voce quer fazer?' @(
            'Instalar ou atualizar o GoLiveBypass',
            'Remover so o plugin (o mod continua)',
            'Restaurar tudo (remove o plugin e desfaz a injecao)',
            'Sair'
        )
        switch ($tui) {
            1 { Invoke-Install $root }
            2 { Invoke-Uninstall }
            3 { Invoke-RestoreEverything }
            default { Write-Host '  Ate mais.' -ForegroundColor DarkGray }
        }
        return
    }

    Write-Host '  O que voce quer fazer?' -ForegroundColor White
    Write-Host ''
    Write-Host '    [1] Instalar ou atualizar o GoLiveBypass' -ForegroundColor Green
    Write-Host '    [2] Remover so o plugin (o mod continua)' -ForegroundColor Yellow
    Write-Host '    [3] Restaurar tudo (remove o plugin e desfaz a injecao)' -ForegroundColor Red
    Write-Host '    [0] Sair' -ForegroundColor Gray
    Write-Host ''

    switch (Read-Escolha '  Escolha') {
        '1' { Invoke-Install $root }
        '2' { Invoke-Uninstall }
        '3' { Invoke-RestoreEverything }
        default { Write-Host '  Ate mais.' -ForegroundColor DarkGray }
    }
}


# -----------------------------------------------------------------------------
# Auto-update via GitHub Releases
#
# Compara a versao do plugin instalado (lida de goLiveBypass/manifest.json)
# com a tag da release mais recente do GitHub. Reusa Get-RepoFile para o
# caminho "nao tem zip" e adiciona o caminho "tem zip" (com validacao de
# SHA-256 contra o asset companion .sha256).
# -----------------------------------------------------------------------------

$GitHubRepo = 'AC-Tech-Pro-Oficial/GoLiveBypassEnhanced'
$GitHubApi  = "https://api.github.com/repos/$GitHubRepo"

# Consulta a release mais recente. Devolve um objeto com .Tag e .AssetUrl
# (pode ser $null para qualquer um). RC=0 mesmo se a consulta falhou: o
# --check-update nao pode derrubar o instalador por falta de rede.
function Get-LatestRelease {
    try {
        $headers = @{ 'User-Agent' = 'GoLiveBypass-Installer'; 'Accept' = 'application/vnd.github+json' }
        $release = Invoke-RestMethod -Uri "$GitHubApi/releases/latest" -Headers $headers -TimeoutSec 15
    } catch {
        return $null
    }

    $tag = $null
    if ($release.PSObject.Properties['tag_name'] -and $release.tag_name) {
        # tag_name vem como "v1.1.8"; o manifest usa "1.1.8" (sem o v)
        $tag = $release.tag_name -replace '^v', ''
    }

    $zip = $null
    foreach ($a in $release.assets) {
        if ($a.name -like 'goLiveBypass-vencord*.zip') {
            $zip = $a.browser_download_url
            break
        }
    }

    return [PSCustomObject]@{ Tag = $tag; AssetUrl = $zip }
}

# Le a versao do manifest.json em $root/src/userplugins/$PluginDirName.
# Devolve $null se nao existir.
function Get-InstalledPluginVersion($root) {
    if (-not $root) { return $null }
    $manifest = Join-Path $root "src\userplugins\$PluginDirName\manifest.json"
    if (-not (Test-Path -LiteralPath $manifest)) { return $null }
    try {
        $j = Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json
        if ($j.PSObject.Properties['version'] -and $j.version) { return [string]$j.version }
    } catch {}
    return $null
}

# Compara duas versoes semver. Retorna -1/0/+1.
# [version] casts lidam com 1.2.3 mas nao com "1.2.3-beta" - usamos o tipo
# apenas para a parte numerica.
function Compare-Version($installed, $latest) {
    if (-not $latest) { return 0 }   # sem informacao do GitHub: sem atualizacao
    if (-not $installed) { return -1 }  # sem versao local: vale conferir

    $a = [version]($installed -replace '-.*$', '')
    $b = [version]($latest    -replace '-.*$', '')
    if ($b -gt $a) { return -1 }
    if ($b -lt $a) { return  1 }
    return 0
}

# Faz backup do plugin atual em $root/src/userplugins/.$PluginDirName.bak/
# com timestamp YYYYMMDDHHMMSS, mantendo so os 3 mais recentes.
function Backup-Plugin($root) {
    if (-not $root) { return }
    $target = Join-Path $root "src\userplugins\$PluginDirName"
    if (-not (Test-Path -LiteralPath $target)) { return }

    $backupRoot = Join-Path $root "src\userplugins\.${PluginDirName}.bak"
    if (-not (Test-Path -LiteralPath $backupRoot)) { New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null }

    $stamp = Get-Date -Format 'yyyyMMddHHmmss'
    $dest = Join-Path $backupRoot $stamp
    Copy-Item -LiteralPath $target -Destination $dest -Recurse -Force

    # Mantem so os 3 mais recentes (ordem alfabetica = timestamp)
    $items = Get-ChildItem -LiteralPath $backupRoot -Directory | Sort-Object Name
    if ($items.Count -gt 3) {
        $items | Select-Object -First ($items.Count - 3) | ForEach-Object {
            Remove-Item -LiteralPath $_.FullName -Recurse -Force
        }
    }
}

# --check-update: imprime o status e sai. NUNCA baixa nada.
function Invoke-CheckUpdate {
    $root = Find-Checkout
    if (-not $root) {
        Write-Host "  plugin: " -NoNewline
        Write-Host "nao encontrado" -ForegroundColor Yellow -NoNewline
        Write-Host " (rode uma vez para instalar)"
        return
    }

    $installed = Get-InstalledPluginVersion $root
    if ($installed) {
        Write-Host "  plugin: instalado (" -NoNewline
        Write-Host "v$installed" -ForegroundColor DarkGray -NoNewline
        Write-Host ")"
    } else {
        Write-Host "  plugin: " -NoNewline
        Write-Host "instalado (versao desconhecida)" -ForegroundColor Yellow
    }

    $release = Get-LatestRelease
    if (-not $release -or -not $release.Tag) {
        Write-Host "  remote: " -NoNewline
        Write-Host "nao consegui consultar (rede ou rate limit)" -ForegroundColor DarkGray
        return
    }

    Write-Host "  remote: " -NoNewline
        Write-Host "v$($release.Tag)" -ForegroundColor DarkGray

    if (-not $installed) {
        Write-Host "  resultado: " -NoNewline
        Write-Host "versao local desconhecida - rode --update para alinhar" -ForegroundColor Yellow
        return
    }

    $cmp = Compare-Version $installed $release.Tag
    switch ($cmp) {
        0  { Write-Host "  resultado: " -NoNewline
        Write-Host "voce esta na versao mais recente" -ForegroundColor Green }
        1  { Write-Host "  resultado: " -NoNewline
        Write-Host "versao local mais nova que a release (fork?)" -ForegroundColor DarkGray }
        -1 { Write-Host "  resultado: " -NoNewline
        Write-Host "ha versao nova - rode sem --check-update para atualizar" -ForegroundColor Yellow }
    }
}

# --update: faz o trabalho. Baixa o zip, valida SHA-256, extrai.
function Invoke-Update {
    $root = Find-Checkout
    if (-not $root) { throw "Nao achei o checkout do mod. Rode o instalador uma vez (sem --update) para descobrir." }

    $installed = Get-InstalledPluginVersion $root
    $release = Get-LatestRelease
    if (-not $release -or -not $release.Tag) { throw "Nao consegui consultar a release mais recente (rede ou rate limit do GitHub)." }

    if ($installed) {
        $cmp = Compare-Version $installed $release.Tag
        if ($cmp -eq 0) {
            Write-Ok "Voce ja esta na v$($release.Tag) (a mais recente)."
            return
        }
        if ($cmp -eq 1) {
            Write-Warn "Versao local (v$installed) e mais nova que a release (v$($release.Tag))."
            if (-not $Yes -and $Host.UI.RawUI) {
                $ans = Read-Escolha "  Atualizar mesmo assim? (S/N)"
                if ($ans -ne 'S' -and $ans -ne 's') { Write-Warn 'Atualizacao cancelada.'; return }
            }
        }
    }

    Write-Step "Fazendo backup do plugin atual"
    Backup-Plugin $root

    if ($release.AssetUrl) {
        Invoke-UpdateFromZip $root $release.AssetUrl $release.Tag
    } else {
        # Fallback: a release nao tem o asset do userplugin
        Write-Warn "Release v$($release.Tag) nao tem o zip do userplugin. Caindo no download via RepoRaw."
        Copy-Plugin $root
    }

    Build-Mod $root
    if (-not (Test-InjectedFromCheckout $root)) { Invoke-Injection $root @((Get-PatchTargets) | Where-Object { $_.Tipo -eq 'O' }) }

    Write-Host ''
    Write-Ok "Atualizado para v$($release.Tag). Reinicie o Discord para carregar a nova versao."
}

# Baixa o zip, valida SHA-256, extrai por cima do plugin atual.
function Invoke-UpdateFromZip($root, $zipUrl, $expectedVersion) {
    $tempDir = Join-Path $env:TEMP "GoLiveBypass-update-$expectedVersion"
    if (Test-Path -LiteralPath $tempDir) { Remove-Item -LiteralPath $tempDir -Recurse -Force }
    New-Item -ItemType Directory -Path $tempDir -Force | Out-Null
    $zipFile = Join-Path $tempDir 'plugin.zip'

    Write-Step "Baixando $zipUrl"
    try {
        Invoke-WebRequest -Uri $zipUrl -OutFile $zipFile -UseBasicParsing -TimeoutSec 60
    } catch {
        Remove-CaminhoSilencioso $tempDir
        throw "Download do zip falhou: $($_.Exception.Message)"
    }

    Write-Step "Validando SHA-256"
    $shaUrl = "$zipUrl.sha256"
    $shaExpected = $null
    try {
        $shaContent = (Invoke-WebRequest -Uri $shaUrl -UseBasicParsing -TimeoutSec 15).Content.Trim()
        $shaExpected = ($shaContent -split '\s+')[0].ToLower()
    } catch {
        Remove-CaminhoSilencioso $tempDir
        throw "Release sem arquivo .sha256 (asset companion). Sem hash, sem update."
    }
    $shaActual = (Get-FileHash -LiteralPath $zipFile -Algorithm SHA256).Hash.ToLower()
    if ($shaActual -ne $shaExpected) {
        Remove-CaminhoSilencioso $tempDir
        throw "SHA-256 nao confere: esperado $shaExpected, obtido $shaActual."
    }
    Write-Ok 'SHA-256 confere'

    Write-Step "Extraindo o plugin"
    $extractDir = Join-Path $tempDir 'extract'
    New-Item -ItemType Directory -Path $extractDir -Force | Out-Null
    try {
        Expand-Archive -LiteralPath $zipFile -DestinationPath $extractDir -Force
    } catch {
        Remove-CaminhoSilencioso $tempDir
        throw "Extracao falhou: $($_.Exception.Message)"
    }

    $target = Join-Path $root "src\userplugins\$PluginDirName"
    if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
    New-Item -ItemType Directory -Path $target -Force | Out-Null

    # O zip tem a pasta raiz goLiveBypass/; copia o conteudo
    $extracted = Get-ChildItem -LiteralPath $extractDir -Directory | Select-Object -First 1
    if (-not $extracted) {
        Remove-CaminhoSilencioso $tempDir
        throw 'Zip nao tem a pasta esperada (goLiveBypass/).'
    }
    Get-ChildItem -LiteralPath $extracted.FullName -Force | ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination $target -Recurse -Force
    }

    Remove-CaminhoSilencioso $tempDir
    Write-Ok 'Plugin extraido'
}

Show-Banner

try {
    switch ($Mode) {
        'Install'     { Invoke-Install (Find-Checkout) }
        'Uninstall'   { Invoke-Uninstall }
        'Restore'     { Invoke-RestoreEverything }
        'CheckUpdate' { Invoke-CheckUpdate }
        'Update'      { Invoke-Update }
        'TestTor'     {
            if (-not (Install-Tor)) { throw 'Teste Tor falhou: sem tunel TLS ate gateway.discord.gg.' }
            Write-Ok 'Teste Tor: SOCKS5 + TLS ate gateway.discord.gg funcionando.'
        }
        default       { Show-MainMenu }
    }
} catch {
    Write-Host ''
    Write-Err $_.Exception.Message

    # Sem isto o relato vira so a mensagem do PowerShell, que nao diz onde quebrou. Com a linha
    # e o comando, um print de tela ja basta para achar a causa.
    $info = $_.InvocationInfo
    if ($info -and $info.ScriptLineNumber) {
        Write-Host "      linha $($info.ScriptLineNumber): $($info.Line.Trim())" -ForegroundColor DarkGray
    }
    Write-Host '      Se for relatar, mande esta linha junto.' -ForegroundColor DarkGray

    # Report automatico (se nao for automacao): a issue abre no GitHub.
    # Erros de uso (dependencia, CLI typo, path errado, ferramenta externa) nao viram issue.
    if (Test-ShouldReport $_.Exception.Message) {
        Invoke-SendAutoReport "Falha no instalador GoLiveBypass: $($_.Exception.Message)" $_.Exception.Message $_
    }
    exit 1
}

Write-Host ''
