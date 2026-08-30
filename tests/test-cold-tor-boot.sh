#!/bin/sh
#
# Testes do arranque frio em modo tor (issue #116). Ver o cabecalho de
# test-cold-tor-boot-test.cjs para o contexto completo.
#
# Uso:
#   ./tests/test-cold-tor-boot.sh

set -eu

REPO="$(cd -- "$(dirname -- "$0")/.." && pwd)"

command -v node >/dev/null 2>&1 || { echo "Preciso do node para rodar este teste." >&2; exit 1; }

node "$REPO/tests/test-cold-tor-boot-test.cjs"
