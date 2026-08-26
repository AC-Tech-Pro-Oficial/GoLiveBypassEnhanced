#!/usr/bin/env python3
"""Harness de teste TUI para a VM Windows via SSH PTY."""
import os, pty, re, select, subprocess, time, fcntl, termios, struct
from dataclasses import dataclass
from typing import Optional
import pyte


class Key:
    UP, DOWN, RIGHT, LEFT = "\x1b[A", "\x1b[B", "\x1b[C", "\x1b[D"
    ENTER, ESC, BACK, TAB = "\r", "\x1b", "\x08", "\t"
    F5 = "\x1b[15~"


class SshPty:
    def __init__(self, host, user, password, cols=120, rows=30, extra_ssh_args=None, login_timeout=25.0):
        self.host, self.user, self.password = host, user, password
        self.cols, self.rows = cols, rows
        self.extra_ssh_args = extra_ssh_args or []
        self.login_timeout = login_timeout
        self.master_fd = self.proc = None
        self._buf = b""

    def open(self):
        args = ["sshpass", "-p", self.password, "ssh", "-tt",
                "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null",
                "-o", "ConnectTimeout=10"] + self.extra_ssh_args + [f"{self.user}@{self.host}"]
        self.master_fd, slave_fd = pty.openpty()
        fcntl.ioctl(slave_fd, termios.TIOCSWINSZ, struct.pack("HHHH", self.rows, self.cols, 0, 0))
        self.proc = subprocess.Popen(args, stdin=slave_fd, stdout=slave_fd, stderr=slave_fd, close_fds=True)
        os.close(slave_fd)
        self._wait_for_text(">", timeout=self.login_timeout, soft_fail=True)

    def close(self):
        if self.proc and self.proc.poll() is None:
            try: self.proc.terminate(); self.proc.wait(timeout=2)
            except Exception:
                try: self.proc.kill()
                except Exception: pass
        if self.master_fd is not None:
            try: os.close(self.master_fd)
            except Exception: pass
            self.master_fd = None

    def _read_chunk(self, timeout=0.3):
        if self.master_fd is None: return b""
        r, _, _ = select.select([self.master_fd], [], [], timeout)
        if not r: return b""
        try:
            data = os.read(self.master_fd, 65536)
            if not data: raise EOFError
            return data
        except (OSError, EOFError): return b""

    def drain(self, max_seconds=0.3):
        end = time.time() + max_seconds; out = b""
        while time.time() < end:
            chunk = self._read_chunk(timeout=0.1)
            if chunk: out += chunk
        return out

    def send(self, data, delay_after=0.05):
        if self.master_fd is None: return
        if isinstance(data, str): data = data.encode("utf-8")
        os.write(self.master_fd, data)
        time.sleep(delay_after)

    def send_line(self, line, delay_after=0.1):
        self.send((line + "\r\n").encode("utf-8"), delay_after=delay_after)

    def send_key(self, seq, delay_after=0.05):
        self.send(seq.encode("utf-8"), delay_after=delay_after)

    def send_enter(self): self.send_key(Key.ENTER, delay_after=0.1)
    def send_esc(self):   self.send_key(Key.ESC, delay_after=0.1)
    def send_arrow(self, direction):
        d = direction.lower()
        if d in ("up","k"):    self.send_key(Key.UP, delay_after=0.08)
        elif d in ("down","j"): self.send_key(Key.DOWN, delay_after=0.08)
        elif d in ("left","h"): self.send_key(Key.LEFT, delay_after=0.08)
        elif d in ("right","l"):self.send_key(Key.RIGHT, delay_after=0.08)
        else: raise ValueError(f"direcao invalida: {direction}")

    def resize(self, cols, rows):
        if self.master_fd is None: return
        fcntl.ioctl(self.master_fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
        self.cols, self.rows = cols, rows

    def _wait_for_text(self, needle, timeout=10.0, soft_fail=False):
        end = time.time() + timeout
        while time.time() < end:
            chunk = self._read_chunk(timeout=0.2)
            if chunk:
                self._buf += chunk
                if needle.encode("utf-8") in self._buf: return True
        if soft_fail: return False
        return False

    def wait_for_text(self, needle, timeout=10.0):
        return self._wait_for_text(needle, timeout, soft_fail=False)

    @property
    def raw_buffer(self):
        chunk = self._read_chunk(timeout=0.05)
        if chunk: self._buf += chunk
        return self._buf

    def clear_buffer(self): self._buf = b""


@dataclass
class ScreenSnapshot:
    cols: int; rows: int; lines: list; raw_tail: bytes; cursor_x: int; cursor_y: int

    def __str__(self):
        s = f"\n=== Tela {self.cols}x{self.rows} (cursor={self.cursor_x},{self.cursor_y}) ===\n"
        for i, line in enumerate(self.lines): s += f"{i:>3} | {line.rstrip()}\n"
        return s

    @property
    def display(self): return "\n".join(self.lines)
    def line(self, y): return self.lines[y] if 0 <= y < len(self.lines) else ""
    def find(self, needle):
        for y, line in enumerate(self.lines):
            x = line.find(needle)
            if x >= 0: return (x, y)
        return None
    def contains(self, *needles):
        return all(n in self.display for n in needles)
    def selected_index(self, marker="●", other="○"):
        idx = 0
        for line in self.lines:
            if other in line and marker not in line: idx += 1
            elif marker in line: return idx
        return None


class WinTuiSession(SshPty):
    def __init__(self, *a, **kw):
        super().__init__(*a, **kw)
        self.screen = pyte.Screen(self.cols, self.rows)
        self.stream = pyte.Stream(self.screen)

    def open(self, *a, **kw):
        super().open(*a, **kw)
        self._feed_pyte(self._buf); self._buf = b""

    def _read_chunk(self, timeout=0.3):
        chunk = super()._read_chunk(timeout=timeout)
        if chunk: self._feed_pyte(chunk)
        return chunk

    def _feed_pyte(self, data):
        try: self.stream.feed(data.decode("utf-8", errors="replace"))
        except Exception: pass

    def snapshot(self):
        self.drain(max_seconds=0.2)
        return ScreenSnapshot(cols=self.cols, rows=self.rows,
                              lines=list(self.screen.display),
                              raw_tail=self._buf[-2000:],
                              cursor_x=self.screen.cursor.x,
                              cursor_y=self.screen.cursor.y)

    def snapshot_after(self, wait=0.5):
        time.sleep(wait); return self.snapshot()

    def wait_for(self, predicate, timeout=10.0, poll=0.2, fail_msg="condição não satisfeita"):
        end = time.time() + timeout; snap = self.snapshot()
        while time.time() < end:
            if predicate(snap): return snap
            time.sleep(poll); snap = self.snapshot()
        raise TimeoutError(f"{fail_msg} (após {timeout}s)")

    def wait_for_text(self, needle, timeout=10.0, settle=0.3):
        end = time.time() + timeout; snap = self.snapshot()
        last_change = time.time(); last_display = snap.display
        while time.time() < end:
            if needle in snap.display and (time.time() - last_change) >= settle: return snap
            time.sleep(0.1); snap = self.snapshot()
            if snap.display != last_display: last_change = time.time(); last_display = snap.display
        raise TimeoutError(f"texto {needle!r} não apareceu (após {timeout}s)")

    def assert_no_garbled(self):
        snap = self.snapshot()
        for pat in [r"\\x1b\\[[?]?[0-9;]*[a-zA-Z]"]:
            for line in snap.lines:
                if re.search(pat, line): raise AssertionError(f"texto embaralhado: {pat} em {line!r}")
        return self


if __name__ == "__main__":
    s = WinTuiSession(host="192.168.122.198", user="teste", password="1241", cols=120, rows=30)
    s.open()
    s.send_line("echo HELLO_FROM_TUI")
    s.wait_for_text("HELLO_FROM_TUI", timeout=10)
    print(s.snapshot())
    s.close()
