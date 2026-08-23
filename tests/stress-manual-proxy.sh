#!/bin/sh
#
# Teste de estresse com proxy MANUAL — valida a corrida na abertura.
#
# O gateway conecta em <1s; a saida manual so vence a corrida se a escolha ja
# estiver pronta antes dele nascer. Para cada ciclo:
#   1. Abre o Discord e aguarda o gateway conectar (ate MAX_CONNECT s)
#   2. Confere a ORDEM dos eventos no log:
#      - "usando a saida que voce configurou" ANTES do primeiro "gateway visto"
#      - gateway visto com "saida pronta ha Xs" (e nao "sem saida ainda")
#      - nenhum "nasceu sem saida" (o sinal precoce foi removido)
#      - "roteado:" presente e nenhum "vai sair direta"
#   3. Fecha e parte para o proximo
#
# Diferente do stress-test.sh, NAO mexe nas settings e NAO reaplica o bypass:
# usa exatamente o que esta instalado em ~/.local/share/GoLiveBypass.
#
# Uso:
#   ./tests/stress-manual-proxy.sh [N]

set -u
set +e

REPO="$(cd -- "$(dirname -- "$0")/.." && pwd)"
CYCLES="${1:-3}"
LOG="/home/pdl/.local/share/GoLiveBypass/golivebypass.log"
SETTINGS="/home/pdl/.local/share/GoLiveBypass/settings.json"
MAX_CONNECT=90
PASS=0
FAIL=0

step() { printf '\n== %s ==\n' "$1"; }
ok()   { PASS=$((PASS + 1)); printf '  [OK] %s\n' "$1"; }
bad()  { FAIL=$((FAIL + 1)); printf '  [FAIL] %s\n' "$1"; }

# Fecha o Discord de verdade e espera morrer
kill_discord() {
    pkill -x Discord 2>/dev/null
    pkill -x discord 2>/dev/null
    pkill -x DiscordPTB 2>/dev/null
    pkill -x DiscordCanary 2>/dev/null
    k=0
    while [ "$k" -lt 20 ]; do
        pgrep -x Discord >/dev/null 2>&1 || pgrep -x discord >/dev/null 2>&1 || return 0
        sleep 0.5
        k=$((k + 1))
    done
    pkill -9 -x Discord 2>/dev/null
    pkill -9 -x discord 2>/dev/null
    return 0
}

# O teste so faz sentido com a saida manual configurada
manual="$(sed -n 's/.*"proxy"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$SETTINGS" | head -1)"
if [ -z "$manual" ]; then
    echo "settings.json sem proxy manual configurada; configure o campo \"proxy\" e rode de novo."
    exit 1
fi
escaped="$(printf '%s' "$manual" | sed 's/:/\\:/g')"

LOG_DIR="$REPO/tests/stress-logs"
rm -rf "$LOG_DIR"
mkdir -p "$LOG_DIR"

echo "Bateria: $CYCLES ciclos com a proxy manual ($escaped)"
echo "Logs por ciclo em: $LOG_DIR"
echo

i=1
while [ "$i" -le "$CYCLES" ]; do
    offset=$(wc -l < "$LOG" 2>/dev/null || echo 0)
    start=$(date +%s)

    setsid nohup discord >/dev/null 2>&1 < /dev/null &
    disown 2>/dev/null || true

    # 1. Aguarda o gateway conectar (evento NOVO no log)
    waited=0
    connected=0
    while [ "$waited" -lt "$MAX_CONNECT" ]; do
        if tail -n +$((offset + 1)) "$LOG" 2>/dev/null | grep -qE "gateway visto|roteado:"; then
            connected=1
            break
        fi
        sleep 1
        waited=$((waited + 1))
    done

    connect_time=$(( $(date +%s) - start ))
    sleep 5

    eventos="$(tail -n +$((offset + 1)) "$LOG" 2>/dev/null)"
    printf '%s\n' "$eventos" > "$LOG_DIR/ciclo-$i.log"

    sem_saida="$(printf '%s\n' "$eventos" | grep -c "sem saida ainda")"
    nasceu_sem_saida="$(printf '%s\n' "$eventos" | grep -c "nasceu sem saida")"
    roteado="$(printf '%s\n' "$eventos" | grep -c "roteado:")"
    direto="$(printf '%s\n' "$eventos" | grep -c "vai sair direta")"
    recargas="$(printf '%s\n' "$eventos" | grep -c "recarga")"

    # A ordem importa: a saida manual tem que estar na mao ANTES do gateway nascer
    primeiro_visto="$(printf '%s\n' "$eventos" | grep -n "gateway visto" | head -1 | cut -d: -f1)"
    primeiro_da_saida="$(printf '%s\n' "$eventos" | grep -n "usando a saida que voce configurou" | head -1 | cut -d: -f1)"
    depois="nao-avaliou"
    if [ -n "$primeiro_visto" ] && [ -n "$primeiro_da_saida" ]; then
        if [ "$primeiro_da_saida" -le "$primeiro_visto" ]; then depois="sim"; else depois="NAO"; fi
    fi

    if [ "$connected" -eq 1 ]; then
        ok "ciclo $i: gateway em ${connect_time}s | roteado=$roteado direto=$direto recargas=$recargas"
        if [ "$depois" = "NAO" ]; then
            bad "ciclo $i: gateway visto ANTES da saida manual estar escolhida (corrida perdida)"
        elif [ "$depois" = "sim" ]; then
            ok "ciclo $i: saida manual na mao antes do gateway (corrida ganha)"
        fi
        if [ "$sem_saida" -gt 0 ]; then
            bad "ciclo $i: gateway vista com 'sem saida ainda' ($sem_saida vez(es))"
        fi
        if [ "$nasceu_sem_saida" -gt 0 ]; then
            bad "ciclo $i: 'nasceu sem saida' ainda aparece ($nasceu_sem_saida vez(es))"
        fi
        if [ "$roteado" -eq 0 ] && [ "$sem_saida" -eq 0 ]; then
            bad "ciclo $i: sem 'sem saida' mas tambem sem 'roteado:'"
        fi
        if [ "$direto" -gt 0 ]; then
            bad "ciclo $i: caiu para direto $direto vez(es)"
        fi
    else
        bad "ciclo $i: gateway NAO conectou em ${MAX_CONNECT}s"
    fi

    kill_discord
    sleep 2
    i=$((i + 1))
done

echo
echo "== Resultado: $PASS ok, $FAIL falhas em $CYCLES ciclos =="
echo "== Resumo da bateria =="
grep -hc "usando a saida que voce configurou" "$LOG_DIR"/ciclo-*.log 2>/dev/null
echo "  saidas manuais usadas:  $(grep -h "usando a saida" "$LOG_DIR"/ciclo-*.log | wc -l)"
echo "  gateways vistos:        $(grep -h "gateway visto" "$LOG_DIR"/ciclo-*.log | wc -l)"
echo "  com sem saida ainda:    $(grep -h "sem saida ainda" "$LOG_DIR"/ciclo-*.log | wc -l)"
echo "  roteados:               $(grep -h "roteado:" "$LOG_DIR"/ciclo-*.log | wc -l)"
echo "  diretos:                $(grep -h "vai sair direta" "$LOG_DIR"/ciclo-*.log | wc -l)"

[ "$FAIL" -eq 0 ] || exit 1