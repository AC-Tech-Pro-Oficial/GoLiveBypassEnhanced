#!/usr/bin/env python3
"""
Helper minimo para o ControlPort do Tor (sem dependencias externas) -- usado no teste de
estabilidade de sessao longa em tests/live-session-*.

Uso:
    tor-ctl.py --test                    autentica e confere a versao (smoke test)
    tor-ctl.py --streams                 lista os streams ativos (id, circuito, alvo)
    tor-ctl.py --circuits                lista os circuitos abertos com idade
    tor-ctl.py --kill-stream-to HOST     acha o circuito do stream cujo alvo bate com HOST
                                          (substring) e derruba esse circuito (CLOSECIRCUIT)

A senha vem de TOR_CTL_PASSWORD no ambiente (default: a senha de teste desta sessao).
"""
import argparse
import os
import socket
import sys
import time

HOST = "127.0.0.1"
PORT = 9051
PASSWORD = os.environ.get("TOR_CTL_PASSWORD", "golivebypass-test-2026")


def connect():
    s = socket.create_connection((HOST, PORT), timeout=5)
    return s


def send(s, line):
    s.sendall((line + "\r\n").encode("utf-8"))


def read_reply(s):
    buf = b""
    s.settimeout(5)
    while True:
        chunk = s.recv(4096)
        if not chunk:
            break
        buf += chunk
        # Resposta multi-linha termina numa linha "250 OK" (ou codigo final sem "-"/"+" depois do codigo).
        lines = buf.split(b"\r\n")
        for line in lines:
            if len(line) >= 4 and line[3:4] == b" ":
                return buf.decode("utf-8", "replace")
    return buf.decode("utf-8", "replace")


def authenticate(s):
    send(s, 'AUTHENTICATE "' + PASSWORD + '"')
    reply = read_reply(s)
    if not reply.startswith("250"):
        print("Falha na autenticacao:", reply, file=sys.stderr)
        sys.exit(1)


def getinfo(s, key):
    send(s, "GETINFO " + key)
    return read_reply(s)


def cmd_test():
    s = connect()
    authenticate(s)
    print(getinfo(s, "version").strip())
    print("ControlPort OK")


def cmd_streams():
    s = connect()
    authenticate(s)
    print(getinfo(s, "stream-status"))


def cmd_circuits():
    s = connect()
    authenticate(s)
    print(getinfo(s, "circuit-status"))


def cmd_kill_circuit(circ_id):
    s = connect()
    authenticate(s)
    print("derrubando circuito", circ_id)
    send(s, "CLOSECIRCUIT " + circ_id)
    print(read_reply(s).strip())


def cmd_kill_stream_to(host_substr):
    s = connect()
    authenticate(s)
    streams = getinfo(s, "stream-status")
    target_circ = None
    for line in streams.splitlines():
        # Formato: "streamid circstatus circid target ..." (ver control-spec.txt secao 4.1.6)
        parts = line.split()
        if len(parts) >= 4 and host_substr in parts[3]:
            target_circ = parts[2]
            print("stream encontrado:", line.strip())
            break

    if target_circ is None:
        print("nenhum stream ativo com alvo contendo '" + host_substr + "'", file=sys.stderr)
        print("streams atuais:\n" + streams, file=sys.stderr)
        sys.exit(1)

    print("derrubando circuito", target_circ)
    send(s, "CLOSECIRCUIT " + target_circ)
    print(read_reply(s).strip())


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--test", action="store_true")
    parser.add_argument("--streams", action="store_true")
    parser.add_argument("--circuits", action="store_true")
    parser.add_argument("--kill-stream-to", metavar="HOST")
    parser.add_argument("--kill-circuit", metavar="ID")
    args = parser.parse_args()

    if args.test:
        cmd_test()
    elif args.streams:
        cmd_streams()
    elif args.circuits:
        cmd_circuits()
    elif args.kill_stream_to:
        cmd_kill_stream_to(args.kill_stream_to)
    elif args.kill_circuit:
        cmd_kill_circuit(args.kill_circuit)
    else:
        parser.print_help()
