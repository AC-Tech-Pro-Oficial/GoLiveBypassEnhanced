#!/usr/bin/env python3
"""T11: Tui-MenuMulti (multi-selecao de Discord) numa VM Windows real.

Carrega Tui-MenuMulti (e dependencias) do instalador via AST - sem executar o
instalador inteiro - e exercita: espaco marca, 'a' marca todos, Enter confirma
e Esc cancela. Precisa da VM com acesso SSH (mesma do run_tui_tests.py).

Uso:
    python3 run_multi.py            # host padrao do run_tui_tests.py
"""
import base64
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from win_tui_session import WinTuiSession

INSTALLER = "C:\\GLB-TEST\\GoLiveBypass-Installer.ps1"
HOST = os.environ.get("TUI_VM_HOST", "192.168.122.198")
USER = os.environ.get("TUI_VM_USER", "teste")
PASSWORD = os.environ.get("TUI_VM_PASSWORD", "1241")

# Extrai as funcoes da TUI por AST (sem rodar o script) e chama Tui-MenuMulti.
PS_TEMPLATE = r"""
$f = '{installer}'
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($f, [ref]$tokens, [ref]$errors)
$nomes = 'Tui-MenuMulti', 'Tui-GetKey', 'Tui-HideCursor', 'Tui-ShowCursor', 'Tui-ClearBelow', 'Test-TuiInteractive'
$ast.FindAll({{ param($c) $c -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $nomes -contains $c.Name }}, $true) |
    ForEach-Object {{ Invoke-Expression $_.Extent.Text }}
$script:TuiBg = ''; $script:TuiAccent = ''; $script:TuiDim = ''
$script:TuiBold = ''; $script:TuiRset = ''; $script:TuiFg = ''
$r = Tui-MenuMulti 'teste' @('um', 'dois', 'tres')
if ($null -eq $r) {{ Write-Output 'RESULTADO: CANCELADO' }} else {{ Write-Output ('RESULTADO: ' + ($r -join ' ')) }}
"""


def encoded(cmd: str) -> str:
    return base64.b64encode(cmd.encode("utf-16-le")).decode("ascii")


def rodar(s, keys, esperado):
    s.clear_buffer()
    s.send_line(
        f'powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand {encoded(PS_TEMPLATE.format(installer=INSTALLER))}',
        delay_after=1.0,
    )
    s.wait_for_text("teste", timeout=20)  # box do menu apareceu
    for k in keys:
        s.send(k, delay_after=0.15)
    s.wait_for_text(esperado, timeout=20)
    snap = s.snapshot()
    assert esperado in str(snap), f"esperado {esperado!r}, buffer: {snap!r}"
    s.send_line("", delay_after=0.2)


def main():
    print("=== T11: Tui-MenuMulti ===")
    s = WinTuiSession(host=HOST, user=USER, password=PASSWORD, cols=120, rows=30)
    s.open()
    try:
        # 1. espaco no primeiro, desce, espaco no segundo, Enter -> 1 2
        rodar(s, [" ", "\x1b[B", " ", "\r"], "RESULTADO: 1 2")
        print("  [OK] espaco marca itens escolhidos")
        # 2. 'a' marca todos, Enter -> 1 2 3
        rodar(s, ["a", "\r"], "RESULTADO: 1 2 3")
        print("  [OK] 'a' marca todos")
        # 3. Esc cancela
        rodar(s, [" ", "\x1b"], "RESULTADO: CANCELADO")
        print("  [OK] Esc cancela")
        # 4. Enter sem nada marcado nao confirma: Esc depois cancela
        rodar(s, ["\r", "\x1b"], "RESULTADO: CANCELADO")
        print("  [OK] Enter com nenhum marcado nao confirma")
    finally:
        s.send_line("exit", delay_after=0.2)
        s.close()
    print("RESULTADO: TUDO OK")


if __name__ == "__main__":
    main()
