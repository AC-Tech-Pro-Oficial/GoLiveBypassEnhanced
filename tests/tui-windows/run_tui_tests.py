#!/usr/bin/env python3
"""Bateria principal (T01-T07)."""
import os, sys, time, subprocess
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from win_tui_session import WinTuiSession

INSTALLER = "C:\\GLB-TEST\\GoLiveBypass-Installer.ps1"
STANDALONE = "C:\\GLB-TEST\\GoLiveBypass-Standalone.ps1"


def ssh_cmd(cmd, timeout=15):
    return subprocess.run(
        ["sshpass", "-p", "1241", "ssh", "-o", "StrictHostKeyChecking=no",
         "-o", "UserKnownHostsFile=/dev/null", "teste@192.168.122.198", cmd],
        capture_output=True, text=True, timeout=timeout)


def setup():
    print("=== SETUP ===")
    r = ssh_cmd("dir C:\\GLB-TEST")
    print(r.stdout[-500:])


def t01_main_menu_cmd():
    print("\n=== T01 ===")
    s = WinTuiSession(host="192.168.122.198", user="teste", password="1241", cols=120, rows=30)
    s.open()
    try:
        s.send_line("cls"); s.wait_for_text(">", timeout=5)
        s.send_line(f'powershell -NoProfile -ExecutionPolicy Bypass -File "{INSTALLER}"')
        snap = s.wait_for_text("O que voce quer fazer?", timeout=30)
        assert snap.contains("Instalar ou atualizar")
        assert snap.contains("Remover"); assert snap.contains("Restaurar")
        assert snap.selected_index() == 0
        s.send_arrow("down"); snap = s.snapshot_after(0.3); assert snap.selected_index() == 1
        s.send_arrow("down"); snap = s.snapshot_after(0.3); assert snap.selected_index() == 2
        s.send_arrow("up"); snap = s.snapshot_after(0.3); assert snap.selected_index() == 1
    finally:
        for _ in range(3): s.send_esc(); time.sleep(0.3)
        s.send_line("exit"); s.close()


def t02_standalone_pwsh():
    print("\n=== T02 ===")
    s = WinTuiSession(host="192.168.122.198", user="teste", password="1241", cols=120, rows=30)
    s.open()
    try:
        s.send_line("cls")
        s.send_line("powershell -ExecutionPolicy Bypass")
        s.wait_for_text("PS ", timeout=15)
        s.send_line(f'& "{STANDALONE}"')
        snap = s.wait_for_text("GoLiveBypass standalone", timeout=30)
        assert snap.contains("Instalar / atualizar o bypass")
        s.send_esc()
    finally:
        for _ in range(3): s.send_esc(); time.sleep(0.3)
        time.sleep(0.5)
        try: s.send_line("exit")
        except Exception: pass
        try: s.wait_for_text("teste@DESKTOP", timeout=10)
        except Exception: pass
        try: s.send_line("exit")
        except Exception: pass
        s.close()


def t03_no_tty():
    print("\n=== T03 ===")
    s = WinTuiSession(host="192.168.122.198", user="teste", password="1241", cols=120, rows=30)
    s.open()
    try:
        s.send_line("cls")
        s.send_line(f'powershell -NoProfile -ExecutionPolicy Bypass -File "{INSTALLER}" -Yes')
        time.sleep(4)
        snap = s.snapshot()
        ok = ("[1]" in snap.display or "[2]" in snap.display
              or "O que voce quer fazer" in snap.display
              or "Falta" in snap.display or "Erro" in snap.display
              or "Install" in snap.display)
        assert ok
    finally: s.close()


def t04_resize():
    print("\n=== T04 ===")
    s = WinTuiSession(host="192.168.122.198", user="teste", password="1241", cols=120, rows=30)
    s.open()
    try:
        s.send_line("cls")
        s.send_line(f'powershell -NoProfile -ExecutionPolicy Bypass -File "{INSTALLER}"')
        s.wait_for_text("O que voce quer fazer?", timeout=30)
        for cols, rows in [(40, 15), (200, 50), (80, 24), (10, 5), (120, 30)]:
            s.resize(cols, rows); time.sleep(0.4)
            snap = s.snapshot()
            ok = snap.contains("O que voce quer fazer") or "PS " in snap.display
            print(f"  {cols}x{rows}: ok={ok}")
    finally: s.send_esc(); s.send_line("exit"); s.close()


def t05_key_storm():
    print("\n=== T05 ===")
    s = WinTuiSession(host="192.168.122.198", user="teste", password="1241", cols=120, rows=30)
    s.open()
    try:
        s.send_line("cls")
        s.send_line(f'powershell -NoProfile -ExecutionPolicy Bypass -File "{INSTALLER}"')
        s.wait_for_text("O que voce quer fazer?", timeout=30)
        for _ in range(20): s.send_arrow("down")
        for _ in range(15): s.send_arrow("up")
        for _ in range(5):
            s.send_esc(); time.sleep(0.1)
        s.assert_no_garbled()
        print("  sem leak de ANSI")
    finally: s.send_line("exit"); s.close()


def t06_ansi_leak():
    print("\n=== T06 ===")
    s = WinTuiSession(host="192.168.122.198", user="teste", password="1241", cols=120, rows=30)
    s.open()
    try:
        s.send_line("cls")
        s.send_line(f'powershell -NoProfile -ExecutionPolicy Bypass -File "{INSTALLER}"')
        s.wait_for_text("O que voce quer fazer?", timeout=30)
        for _ in range(3): s.send_esc(); time.sleep(0.3)
        for _ in range(10): s.send_arrow("down")
        s.assert_no_garbled()
    finally: s.send_line("exit"); s.close()


def t07_setup_wizard():
    print("\n=== T07 ===")
    s = WinTuiSession(host="192.168.122.198", user="teste", password="1241", cols=120, rows=30)
    s.open()
    try:
        s.send_line("cls")
        s.send_line(f'powershell -NoProfile -ExecutionPolicy Bypass -File "{INSTALLER}"')
        s.wait_for_text("O que voce quer fazer?", timeout=30)
        s.send_enter()
        snap = s.wait_for_text("Qual mod instalar", timeout=10)
        assert snap.contains("Equicord")
        assert snap.selected_index() == 0
        s.send_arrow("down"); snap = s.snapshot_after(0.3)
        assert snap.selected_index() == 1
        s.send_esc()
    finally:
        for _ in range(3): s.send_esc(); time.sleep(0.3)
        s.send_line("exit"); s.close()


def main():
    setup()
    results = {}
    for name, fn in [
        ("T01_main_menu_cmd",  t01_main_menu_cmd),
        ("T02_standalone_pwsh", t02_standalone_pwsh),
        ("T03_no_tty",         t03_no_tty),
        ("T04_resize",         t04_resize),
        ("T05_key_storm",      t05_key_storm),
        ("T06_ansi_leak",      t06_ansi_leak),
        ("T07_setup_wizard",   t07_setup_wizard),
    ]:
        t0 = time.time()
        try: fn(); results[name] = ("OK", time.time() - t0)
        except Exception as e:
            import traceback; traceback.print_exc()
            results[name] = ("FAIL", f"{type(e).__name__}: {e}")
        print()
    print("=== RESULTADO ===")
    for k, v in results.items(): print(f"  {k:>30}  ->  {v}")
    return 0 if all(r[0] == "OK" for r in results.values()) else 1


if __name__ == "__main__": sys.exit(main())
