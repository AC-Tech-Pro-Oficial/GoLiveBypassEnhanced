#!/bin/sh
#
# Sonda externa e independente do bypass: testa a cada 10s se o SOCKS do Tor local ainda
# aceita conexoes novas ate o gateway do Discord. Serve de verdade-terra para o teste de
# estabilidade de sessao longa -- o app pode achar que esta tudo bem sem realmente estar.
#
# Uso: ./tests/canary-probe.sh <arquivo-de-log>

set -u
LOG="${1:?uso: canary-probe.sh <arquivo-de-log>}"
PROXY="socks5h://127.0.0.1:9050"
URL="https://gateway.discord.gg/api/v9/gateway"

while true; do
    ts="$(date +%H:%M:%S)"
    resultado="$(curl -x "$PROXY" -m 6 -s -o /dev/null -w "%{http_code} %{time_total}s" "$URL" 2>&1)"
    code="$(printf '%s' "$resultado" | cut -d' ' -f1)"
    if [ "$code" = "200" ]; then
        printf '%s OK %s\n' "$ts" "$resultado" >> "$LOG"
    else
        printf '%s FALHOU %s\n' "$ts" "$resultado" >> "$LOG"
    fi
    sleep 10
done
