#!/usr/bin/env python3
"""Bateria extra (T08-T10)."""
import os, sys, time
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from win_tui_session import WinTuiSession

INSTALLER = "C:\\GLB-TEST\\GoLiveBypass-Installer.ps1"


def t08_extreme_resize():
    print("\n=== T08 ===")
    s = WinTuiSession(host="192.168.122.198", user="teste", password="1241", cols=120, rows=30)
    s.open()
    try:
        s.send_line("cls")
        s.send_line(f'powershell -NoProfile -ExecutionPolicy Bypass -File "{INSTALLER}"')
        s.wait_for_text("O que voce quer fazer?", timeout=20)
        for cols, rows in [(1, 1), (5, 5), (300, 100), (1, 1), (120, 30)]:
            try:
                s.resize(cols, rows); time.sleep(0.5)
                snap = s.snapshot()
                print(f"  {cols}x{rows}: cursor=({snap.cursor_x},{snap.cursor_y})")
            except Exception as e: print(f"  {cols}x{rows}: ERRO {e}")
    finally: s.send_esc(); s.send_esc(); s.send_line("exit"); s.close()


def t09_big_terminal():
    print("\n=== T09 ===")
    s = WinTuiSession(host="192.168.122.198", user="teste", password="1241", cols=250, rows=60)
    s.open()
    try:
        s.send_line("cls")
        s.send_line(f'powershell -NoProfile -ExecutionPolicy Bypass -File "{INSTALLER}"')
        s.wait_for_text("O que voce quer fazer?", timeout=20)
        snap = s.snapshot()
        assert snap.contains("O que voce quer fazer")
        s.send_arrow("down"); time.sleep(0.3); s.send_arrow("down"); time.sleep(0.3)
        snap = s.snapshot()
        print(f"  250x60: cursor=({snap.cursor_x},{snap.cursor_y}) sel={snap.selected_index()}")
    finally: s.send_esc(); s.send_line("exit"); s.close()


def t10_keyboard_layout():
    print("\n=== T10 ===")
    s = WinTuiSession(host="192.168.122.198", user="teste", password="1241", cols=120, rows=30)
    s.open()
    try:
        s.send_line("cls")
        s.send_line(f'powershell -NoProfile -ExecutionPolicy Bypass -File "{INSTALLER}"')
        s.wait_for_text("O que voce quer fazer?", timeout=20)
        s.send("j"); time.sleep(0.3)
        snap = s.snapshot(); assert snap.selected_index() == 1
        s.send("k"); time.sleep(0.3)
        snap = s.snapshot(); assert snap.selected_index() == 0
    finally: s.send_esc(); s.send_line("exit"); s.close()


def main():
    results = {}
    for name, fn in [
        ("T08_extreme_resize", t08_extreme_resize),
        ("T09_big_terminal", t09_big_terminal),
        ("T10_vim_keys", t10_keyboard_layout),
    ]:
        t0 = time.time()
        try: fn(); results[name] = ("OK", time.time() - t0)
        except Exception as e:
            import traceback; traceback.print_exc()
            results[name] = ("FAIL", f"{type(e).__name__}: {e}")
    print("\n=== RESULTADO EXTRAS ===")
    for k, v in results.items(): print(f"  {k:>30}  ->  {v}")
    return 0 if all(r[0] == "OK" for r in results.values()) else 1


if __name__ == "__main__": sys.exit(main())
