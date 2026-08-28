#!/bin/sh
#
# Testes do fallback do Tor no cold start do modo "gratuitas" (issues #95/#98).
#
# Roda o golivebypass.js real em sandbox VM (node puro, sem container): nada
# toca rede externa -- o detectTor e stubado e o teste exercita o estouro do
# prazo de espera de currentExit com cache frio (entrega o Tor local), sem Tor
# (sai direta como antes) e com cache quente (fallback nao acionado).
#
# Uso:
#   ./tests/test-cold-start.sh

set -eu

REPO="$(cd -- "$(dirname -- "$0")/.." && pwd)"

command -v node >/dev/null 2>&1 || { echo "Preciso do node para rodar este teste." >&2; exit 1; }

node "$REPO/tests/test-cold-start-test.cjs"
