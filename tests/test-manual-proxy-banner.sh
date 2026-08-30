#!/bin/sh
#
# Testes do aviso de proxy manual permanentemente quebrada (issue #134: "loading infinito
# mesmo dando control r"). Ver o cabecalho de test-manual-proxy-banner-test.cjs para o
# contexto completo.
#
# Uso:
#   ./tests/test-manual-proxy-banner.sh

set -eu

REPO="$(cd -- "$(dirname -- "$0")/.." && pwd)"

command -v node >/dev/null 2>&1 || { echo "Preciso do node para rodar este teste." >&2; exit 1; }

node "$REPO/tests/test-manual-proxy-banner-test.cjs"
