#!/bin/sh
#
# Testes da escada de revive do gateway zumbi (issues #145/#149/#153). Ver o
# cabecalho de test-gateway-zumbi-revive.cjs para o contexto completo.
#
# Uso:
#   ./tests/test-gateway-zumbi-revive.sh

set -eu

REPO="$(cd -- "$(dirname -- "$0")/.." && pwd)"

command -v node >/dev/null 2>&1 || { echo "Preciso do node para rodar este teste." >&2; exit 1; }

node "$REPO/tests/test-gateway-zumbi-revive.cjs"
