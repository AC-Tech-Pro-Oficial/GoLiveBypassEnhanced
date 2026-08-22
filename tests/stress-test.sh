#!/bin/sh
#
# Teste de estresse do GoLiveBypass — mede ESTABILIDADE, nao so velocidade.
#
# Para cada ciclo:
#   1. Abre o Discord e aguarda o gateway conectar (ate MAX_CONNECT s)
#   2. Mantem aberto por HOLD_TIME s verificando estabilidade:
#      - gateway passou pela saida ("roteado:")?
#      - caiu para direto ("sair direta")?
#      - trocou de saida no meio ("parou de entregar")?
#      - o gateway reconectou ("gateway visto" repetido)?
#   3. Fecha e parte para o proximo
#
# O Discord fica aberto o suficiente para o fast connect morrer e o gateway
# renascer pela rota — e o que mede o "carregou rapido mas estavel".
#
# Uso:
#   ./tests/stress-test.sh [N] [HOLD_TIME]

set -u
set +e

REPO="$(cd -- "$(dirname -- "$0")/.." && pwd)"
CYCLES="${1:-10}"
HOLD_TIME="${2:-30}"          # segundos que o Discord fica aberto por ciclo
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

# Garante settings sem proxy (proxies gratuitas)
cat > "$SETTINGS" << 'EOF'
{
    "enabled": true,
    "proxy": "",
    "excludedCountries": "BR"
}
EOF

# Reaplica o bypass (copia o golivebypass.js novo)
"$REPO/standalone/golivebypass-standalone.sh" --yes >/dev/null 2>&1
kill_discord

# Logs por ciclo: a rotacao do golivebypass.log (2MB) apaga o historico no meio da bateria;
# cada ciclo salva o trecho que lhe pertence para o debug nao perder nada.
LOG_DIR="$REPO/tests/stress-logs"
rm -rf "$LOG_DIR"
mkdir -p "$LOG_DIR"

echo "Bateria: $CYCLES ciclos, Discord aberto por ${HOLD_TIME}s por ciclo, proxies gratuitas"
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

    # 2. Mantem aberto por HOLD_TIME verificando estabilidade
    sleep "$HOLD_TIME"

    # 3. Coleta eventos do ciclo (offset ate agora)
    eventos="$(tail -n +$((offset + 1)) "$LOG" 2>/dev/null)"
    roteado="$(printf '%s\n' "$eventos" | grep -c "roteado:")"
    direto="$(printf '%s\n' "$eventos" | grep -c "vai sair direta")"
    trocas="$(printf '%s\n' "$eventos" | grep -c "parou de entregar")"
    gateways="$(printf '%s\n' "$eventos" | grep -c "gateway visto")"
    saida="$(printf '%s\n' "$eventos" | grep "saida escolhida" | tail -1 | sed 's/.*saida escolhida: //')"

    # Salva o log deste ciclo (antes da rotacao apagar)
    printf '%s\n' "$eventos" > "$LOG_DIR/ciclo-$i.log"

    # Tempo ate o primeiro roteado (o "carregando" real = gateway visto -> passou pela saida)
    t_visto="$(printf '%s\n' "$eventos" | grep "gateway visto" | head -1 | cut -c1-8)"
    t_roteado="$(printf '%s\n' "$eventos" | grep "roteado:" | head -1 | cut -c1-8)"
    if [ -n "$t_visto" ] && [ -n "$t_roteado" ]; then
        # converte HH:MM:SS para segundos
        s_visto=$(echo "$t_visto" | awk -F: '{print $1*3600+$2*60+$3}')
        s_roteado=$(echo "$t_roteado" | awk -F: '{print $1*3600+$2*60+$3}')
        # vira a meia-noite entre os dois
        if [ "$s_roteado" -lt "$s_visto" ]; then s_roteado=$((s_roteado + 86400)); fi
        ate_roteado=$((s_roteado - s_visto))
    else
        ate_roteado=-1
    fi

    if [ "$connected" -eq 1 ]; then
        ok "ciclo $i: gateway em ${connect_time}s | roteado=$roteado ate_roteado=${ate_roteado}s direto=$direto trocas=$trocas reconexoes=$((gateways - 1)) (saida: ${saida:-?})"
        if [ "$ate_roteado" -ge 0 ] && [ "$ate_roteado" -gt 15 ]; then
            bad "ciclo $i: gateway demorou ${ate_roteado}s para passar pela saida (carregando longo)"
        fi
        if [ "$roteado" -eq 0 ] && [ "$gateways" -ge 1 ]; then
            bad "ciclo $i: gateway visto mas NUNCA passou pela saida (fast connect direto?)"
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
echo
echo "== Resumo =="
echo "  aberturas:        $(grep -c 'abrindo' "$LOG")"
echo "  conexoes roteadas: $(grep -c 'roteado:' "$LOG")"
echo "  quedas p/ direto:  $(grep -c 'vai sair direta' "$LOG")"
echo "  trocas de saida:   $(grep -c 'parou de entregar' "$LOG")"

[ "$FAIL" -eq 0 ] || exit 1
