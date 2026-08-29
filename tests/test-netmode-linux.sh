#!/bin/sh
#
# Teste de regressao do modo de rede no settings.json do standalone (issue #108).
#
# Cenario do bug: o install_patcher regravava o settings.json preservando
# routeMode/torAddr so se ja existissem. O saveTorAddr da GUI criava o arquivo so
# com torAddr, o default virtual "tor" do readNetMode() nunca chegava ao disco e o
# runtime injetado nascia "auto" -- caindo no pool de gratuitas com o Tor de pe.
#
# Este teste extrai a install_patcher do golivebypass-standalone.sh e verifica a
# precedencia completa de gravacao. Nada toca no INSTALL_DIR real: cada caso roda
# em diretorio temporario, removido no fim.

set -u
PASS=0
FAIL=0

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT="$ROOT/standalone/golivebypass-standalone.sh"
[ -f "$SCRIPT" ] || { echo "nao achei o script standalone: $SCRIPT"; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# --- extrai a install_patcher e stuba as funcoes de saida do script ------------
# Maquina de estados no awk: o corpo do heredoc JSON da funcao contem uma linha
# "}" solta, entao o fim da funcao so vale DEPOIS do terminador "JSON" do heredoc.
awk '
    /^install_patcher\(\) \{/ { on = 1 }
    on { print }
    on && /^JSON$/ { heredoc = 1 }
    on && heredoc && /^}$/ { exit }
' "$SCRIPT" > "$WORK/func.sh"
grep -q '^install_patcher' "$WORK/func.sh" || { echo "install_patcher nao extraida de $SCRIPT"; exit 1; }
tail -1 "$WORK/func.sh" | grep -q '^}$' || { echo "extração da install_patcher incompleta"; exit 1; }

cat >> "$WORK/func.sh" <<'EOF'
ok() { :; }
warn() { :; }
fail() { echo "  [FAIL] fail() chamada: $*"; FAIL=$((FAIL+1)); }
EOF
# shellcheck disable=SC1090
. "$WORK/func.sh"

# --- helpers -------------------------------------------------------------------
setup() { # $1 = nome do caso; ambiente limpo, sem settings anterior
    CASE="$WORK/$1"
    HERE="$CASE/here"
    INSTALL_DIR="$CASE/data/GoLiveBypass"
    mkdir -p "$HERE"
    printf '/* stub */\n' > "$HERE/golivebypass.js"
    PATCHER_NAME="golivebypass.js"
    PROXY=""
    EXCLUDED="BR"
    NET_MODE=""
    TOR_ADDR_CLI=""
    TOR_MODE=0
    TOR_PORT="9060"
}

preexistente() { # $1 = corpo JSON (sem as chaves externas) do settings anterior
    mkdir -p "$INSTALL_DIR"
    printf '{\n%s\n}\n' "$1" > "$INSTALL_DIR/settings.json"
}

campo() { # $1 = chave; le do settings.json gravado (string ou booleano)
    sed -n "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"\{0,1\}\([^\",}]*\)\"\{0,1\}.*/\1/p" \
        "$INSTALL_DIR/settings.json" | head -1
}

assert_eq() { # $1 obtido, $2 esperado, $3 descricao
    if [ "$1" = "$2" ]; then
        PASS=$((PASS+1))
        printf '  [OK] %s\n' "$3"
    else
        FAIL=$((FAIL+1))
        printf '  [FAIL] %s (esperado: %s, obtido: %s)\n' "$3" "$2" "$1"
    fi
}

json_valido() {
    python3 - "$INSTALL_DIR/settings.json" <<'PY' 2>/dev/null
import json, sys
json.load(open(sys.argv[1], encoding="utf-8"))
PY
}

printf '\n========================================================\n'
printf ' routeMode/torAddr no settings.json (regressao #108)\n'
printf '========================================================\n'

# 1. Flag da GUI vence arquivo sem routeMode: o caminho exato do bug.
setup t1_flag_tor_sobre_arquivo_sem_chave
preexistente '    "enabled": true'
NET_MODE="tor"
TOR_ADDR_CLI="127.0.0.1:9050"
install_patcher
assert_eq "$(campo routeMode)" "tor" "t1 flag --net-mode tor grava routeMode"
assert_eq "$(campo torAddr)" "127.0.0.1:9050" "t1 flag --tor-addr grava torAddr"

# 2. Sem flag, o modo ja escolhido preserva (reativacao GUI/CLI).
setup t2_preserva_free_sem_flag
preexistente '    "routeMode": "free"'
install_patcher
assert_eq "$(campo routeMode)" "free" "t2 routeMode free preservado sem flag"

# 3. autoUpdate (chave da GUI no mesmo arquivo) sobrevive a regravacao.
setup t3_autoupdate_sobrevive
preexistente '    "autoUpdate": false'
install_patcher
assert_eq "$(campo autoUpdate)" "false" "t3 autoUpdate preservado"

# 4. Flag vence o arquivo; torAddr que ficou e inofensivo no free.
setup t4_flag_vence_arquivo
preexistente '    "routeMode": "tor",
    "torAddr": "127.0.0.1:9050"'
NET_MODE="free"
install_patcher
assert_eq "$(campo routeMode)" "free" "t4 --net-mode free vence o tor do arquivo"
assert_eq "$(campo torAddr)" "127.0.0.1:9050" "t4 torAddr preservado (ignorado no free)"

# 5. Proxy com aspas e barra invertida: o JSON gravado tem que ser valido.
setup t5_proxy_com_escapes
PROXY='socks5://user:p@ss"word\x/tool:1080'
install_patcher
if json_valido; then
    PASS=$((PASS+1))
    printf '  [OK] t5 JSON valido com proxy contendo aspas/backslash\n'
else
    FAIL=$((FAIL+1))
    printf '  [FAIL] t5 JSON invalido com proxy contendo aspas/backslash\n'
fi

# 6. CLI puro sem flag e sem arquivo: sem routeMode (o "auto" classico do runtime).
setup t6_cli_puro_sem_nada
install_patcher
assert_eq "$(campo routeMode)" "" "t6 CLI puro nao grava routeMode"
assert_eq "$(campo torAddr)" "" "t6 CLI puro nao grava torAddr"

# 7. --tor retrocompativel: modo tor na porta dedicada do script.
setup t7_tor_legacy
TOR_MODE=1
install_patcher
assert_eq "$(campo routeMode)" "tor" "t7 --tor grava routeMode tor"
assert_eq "$(campo torAddr)" "127.0.0.1:9060" "t7 --tor aponta para a porta dedicada"

# 8. --net-mode tor sem --tor-addr e sem arquivo: cai na porta que o script garante.
setup t8_tor_sem_endereco
NET_MODE="tor"
install_patcher
assert_eq "$(campo routeMode)" "tor" "t8 modo tor sem flag de endereco"
assert_eq "$(campo torAddr)" "127.0.0.1:9060" "t8 torAddr cai na porta dedicada do script"

# 9. Fluxo GUI completo: modo e endereco da flag + autoUpdate preservado juntos.
setup t9_gui_fluxo_completo
preexistente '    "autoUpdate": true,
    "routeMode": "auto"'
NET_MODE="tor"
TOR_ADDR_CLI="127.0.0.1:9050"
install_patcher
assert_eq "$(campo routeMode)" "tor" "t9 modo da GUI vence o auto do arquivo"
assert_eq "$(campo torAddr)" "127.0.0.1:9050" "t9 torAddr da GUI (Tor dela, porta provada)"
assert_eq "$(campo autoUpdate)" "true" "t9 autoUpdate preservado na mesma regravacao"

printf '\n========================================================\n'
printf ' Resumo dos Testes: %d passaram, %d falharam\n' "$PASS" "$FAIL"
printf '========================================================\n\n'

if [ "$FAIL" -gt 0 ]; then exit 1; fi
