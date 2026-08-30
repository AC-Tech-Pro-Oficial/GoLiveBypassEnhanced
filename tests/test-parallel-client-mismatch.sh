#!/bin/sh
#
# Testes do detector de incompatibilidade mod x cliente paralelo em patch_parallel_one()
# (issues #123, #130, #132, #133 -- todas "Vesktop detectado, mas o checkout e Equicord",
# que sempre falhava com uma mensagem generica ("motivo no aviso acima") sem dizer a causa
# real: Equicord so builda dist/equibop.asar, nunca dist/vesktop.asar. Legcord tambem nunca
# sai de um build Equicord/Vencord -- e um projeto a parte.
#
# Extrai as funcoes puras do installer/golivebypass-installer.sh (ate o "banner" final, que
# dispara o menu) via awk, igual ao test-posix.sh, e chama patch_parallel_one() direto contra
# checkouts/clientes fake, sem rede nem Discord real.
#
# Uso:
#   ./tests/test-parallel-client-mismatch.sh
#   RUNTIME=docker ./tests/test-parallel-client-mismatch.sh

set -eu

REPO="$(cd -- "$(dirname -- "$0")/.." && pwd)"
PASS=0
FAIL=0

if command -v podman >/dev/null 2>&1; then
    RUNTIME="${RUNTIME:-podman}"
elif command -v docker >/dev/null 2>&1; then
    RUNTIME="${RUNTIME:-docker}"
else
    echo "Preciso do podman ou do docker para rodar este teste." >&2
    exit 1
fi

step() { printf '  [*] %s\n' "$1" >&2; }
ok()   { PASS=$((PASS + 1)); printf '  [OK] %s\n' "$1" >&2; }
bad()  { FAIL=$((FAIL + 1)); printf '  [FAIL] %s\n' "$1" >&2; }

IMG="debian:stable-slim"
SHELL_BIN="dash"

home="$(mktemp -d)"
mkdir -p "$home/testroot"

HARNESS="$(mktemp)"
# Extrai so as funcoes (para antes do "banner" que dispara o menu principal).
awk '/^banner$/{exit} {print}' "$REPO/installer/golivebypass-installer.sh" > "$HARNESS"
cat >> "$HARNESS" <<'H_EOF'

falhas=0
check() {
    # $1 = nome do teste, $2 = 0/1 (0 = passou)
    if [ "$2" -eq 0 ]; then
        printf '  [OK] %s\n' "$1"
    else
        falhas=$((falhas + 1))
        printf '  [FAIL] %s\n' "$1"
    fi
}

base=/home/testuser/testroot

# --- checkout fake "Equicord" (identificado pelo package.json, igual checkout_mod()) ---
equicord_root="$base/Equicord"
mkdir -p "$equicord_root/dist"
printf '{"name":"equicord"}' > "$equicord_root/package.json"
printf 'fake-equibop-asar' > "$equicord_root/dist/equibop.asar"

# --- clientes paralelos fake (so precisam de app.asar dentro) ---
vesktop_resources="$base/Vesktop"
mkdir -p "$vesktop_resources"
printf 'app.asar original' > "$vesktop_resources/app.asar"

equibop_resources="$base/Equibop"
mkdir -p "$equibop_resources"
printf 'app.asar original' > "$equibop_resources/app.asar"

# 1) checkout_mod detecta Equicord pelo package.json
mod="$(checkout_mod "$equicord_root")"
check "checkout_mod detecta Equicord" "$([ "$mod" = "Equicord" ] && echo 0 || echo 1)"

# 2) Equicord + Vesktop = mismatch (a causa raiz das issues #123/#130/#132/#133)
rc2=0; out2="$(patch_parallel_one "$equicord_root" "$vesktop_resources" 2>&1)" || rc2=$?
check "Equicord+Vesktop retorna falha (rc != 0)" "$([ "$rc2" -ne 0 ] && echo 0 || echo 1)"
case "$out2" in
    *Equicord*Vesktop*|*Vesktop*Equicord*) check "mensagem cita o mismatch Equicord/Vesktop" 0 ;;
    *) check "mensagem cita o mismatch Equicord/Vesktop" 1 ;;
esac
case "$out2" in
    *"pnpm build"*) check "mensagem NAO fala em rodar pnpm build (nunca resolveria)" 1 ;;
    *) check "mensagem NAO fala em rodar pnpm build (nunca resolveria)" 0 ;;
esac
# app.asar do Vesktop nao pode ter sido tocado
content_v="$(cat "$vesktop_resources/app.asar")"
check "app.asar do Vesktop continua intacto" "$([ "$content_v" = "app.asar original" ] && echo 0 || echo 1)"

# 3) Equicord + Equibop, com dist/equibop.asar presente = sucesso
rc3=0; out3="$(patch_parallel_one "$equicord_root" "$equibop_resources" 2>&1)" || rc3=$?
check "Equicord+Equibop com asar presente funciona (rc = 0)" "$([ "$rc3" -eq 0 ] && echo 0 || echo 1)"
content_e="$(cat "$equibop_resources/app.asar")"
check "app.asar do Equibop foi substituido pelo dist/equibop.asar" "$([ "$content_e" = "fake-equibop-asar" ] && echo 0 || echo 1)"
check "backup _app.asar foi criado" "$([ -f "$equibop_resources/_app.asar" ] && echo 0 || echo 1)"

# 4) Equicord + Equibop, mas SEM o build (esse caso continua sendo de verdade "rode build")
rm -f "$equicord_root/dist/equibop.asar"
equibop2_resources="$base/second/Equibop"
mkdir -p "$equibop2_resources"
printf 'app.asar original' > "$equibop2_resources/app.asar"
rc4=0; out4="$(patch_parallel_one "$equicord_root" "$equibop2_resources" 2>&1)" || rc4=$?
check "sem build o patch falha (rc != 0)" "$([ "$rc4" -ne 0 ] && echo 0 || echo 1)"
case "$out4" in
    *"pnpm build"*) check "esse caso SIM fala em rodar pnpm build" 0 ;;
    *) check "esse caso SIM fala em rodar pnpm build" 1 ;;
esac

echo "RESULTADO_INTERNO: $falhas"
exit "$falhas"
H_EOF

if "$RUNTIME" run --rm \
        -v "$HARNESS:/t.sh:ro" \
        -v "$home:/home/testuser" \
        -e HOME=/home/testuser \
        "$IMG" "$SHELL_BIN" /t.sh 2>&1 | tee /tmp/parallel-mismatch-out.txt | grep -E "\[OK\]|\[FAIL\]"; then
    :
fi

if grep -q "RESULTADO_INTERNO: 0" /tmp/parallel-mismatch-out.txt; then
    ok "deteccao de mismatch mod x cliente paralelo ($SHELL_BIN em $IMG)"
else
    bad "deteccao de mismatch mod x cliente paralelo ($SHELL_BIN em $IMG)"
fi

rm -f "$HARNESS" /tmp/parallel-mismatch-out.txt
"$RUNTIME" run --rm -u root -v "$home:/h" debian:stable-slim rm -rf /h >/dev/null 2>&1 || true
rm -rf "$home" 2>/dev/null || true

echo
echo "== Resultado: $PASS ok, $FAIL falhas =="
[ "$FAIL" -eq 0 ] || exit 1
