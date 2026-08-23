#!/bin/sh
#
# Tail continuo do golivebypass.log para o teste de estabilidade de sessao longa (Go Live
# ativo). Copia tudo para o arquivo de sessao e destaca os eventos-chave no console.
#
# Uso: ./tests/live-session-monitor.sh <arquivo-de-log-destino>

set -u
DEST="${1:?uso: live-session-monitor.sh <arquivo-de-log-destino>}"
SRC="/home/pdl/.local/share/GoLiveBypass/golivebypass.log"

# So a partir de agora: o log de baterias anteriores nao interessa para esta sessao.
offset="$(wc -l < "$SRC" 2>/dev/null || echo 0)"

tail -n +"$((offset + 1))" -F "$SRC" 2>/dev/null | while IFS= read -r line; do
    printf '%s\n' "$line" >> "$DEST"
    case "$line" in
        *"perdeu o batimento"*|*"parou de entregar"*|*" -> "*|*"modo tor: o Tor caiu"*|*"recusando esta conexao"*|*"vai sair direta"*)
            printf '>>> %s\n' "$line"
            ;;
        *"gateway visto"*|*"roteado:"*|*"saida escolhida"*)
            printf '%s\n' "$line"
            ;;
    esac
done
