#!/usr/bin/env bash
#
# GoLiveBypass standalone - instalador para Linux
#
# Instala direto no Discord, sem Equicord e sem Vencord. Nao precisa de Node, nem de pnpm,
# nem de git: o bypass e um arquivo .js que o proprio Discord carrega.
#
# Funciona tambem com o Discord instalado por flatpak, do sistema ou do usuario.
#
# Uso:
#   ./golivebypass-standalone.sh
#   ./golivebypass-standalone.sh --proxy socks5://127.0.0.1:9050
#   ./golivebypass-standalone.sh --uninstall
#   ./golivebypass-standalone.sh --status

set -euo pipefail

PATCHER_NAME="golivebypass.js"
INSTALL_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/GoLiveBypass"
STUB_PACKAGE='{"name":"discord","main":"index.js"}'
FLATPAK_IDS=("com.discordapp.Discord" "com.discordapp.DiscordPTB" "com.discordapp.DiscordCanary")
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

MODE="install"
PROXY=""
EXCLUDED="BR"
ASSUME_YES=0

C_OFF=$'\033[0m'; C_CYAN=$'\033[36m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'; C_RED=$'\033[31m'; C_DIM=$'\033[2m'

# Tudo em stderr: estas funcoes sao chamadas de dentro de $(...), e escrever em stdout faria o
# texto colar no valor de retorno. Foi assim que a primeira versao do instalador de Linux
# devolveu "[*] procurando... /caminho" como se fosse um caminho.
step() { printf '  %s[*]%s %s\n' "$C_CYAN" "$C_OFF" "$1" >&2; }
ok()   { printf '  %s[OK]%s %s\n' "$C_GREEN" "$C_OFF" "$1" >&2; }
warn() { printf '  %s[!]%s %s\n' "$C_YELLOW" "$C_OFF" "$1" >&2; }
fail() { printf '  %s[X]%s %s\n' "$C_RED" "$C_OFF" "$1" >&2; exit 1; }

while [ $# -gt 0 ]; do
    case "$1" in
        --proxy) PROXY="${2:-}"; shift ;;
        --excluded-countries) EXCLUDED="${2:-BR}"; shift ;;
        --uninstall) MODE="uninstall" ;;
        --status) MODE="status" ;;
        -y|--yes) ASSUME_YES=1 ;;
        -h|--help) sed -n '3,14p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) fail "Opcao desconhecida: $1" ;;
    esac
    shift
done

have() { command -v "$1" >/dev/null 2>&1; }

# Ler campo a campo em vez de dar source: /etc/os-release e shell valido, e um arquivo torto
# executaria comando neste script, que logo depois chama sudo.
os_field() {
    [ -r /etc/os-release ] || return 0
    sed -n "s/^$1=//p" /etc/os-release | tr -d '"' | head -1
    return 0
}

# O trecho antes do @ e opcional e casado com ganancia, para a senha poder conter @ e :
# codificados. Sem validar aqui, um endereco com erro de digitacao viraria configuracao e o
# bypass cairia para a lista gratuita sem dizer por que.
if [ -n "$PROXY" ] && ! [[ "$PROXY" =~ ^(socks5|socks4|https?)://(.+@)?[^:/@[:space:]]+:[0-9]{1,5}$ ]]; then
    printf '\n  %s[X]%s Endereco de proxy invalido.\n' "$C_RED" "$C_OFF" >&2
    printf '      %sUse socks5://host:porta, ou socks5://usuario:senha@host:porta.%s\n' "$C_DIM" "$C_OFF" >&2
    printf '      %sSenha com @ ou : precisa vir codificada (@ vira %%40, : vira %%3A).%s\n\n' "$C_DIM" "$C_OFF" >&2
    exit 1
fi

confirm() {
    [ "$ASSUME_YES" -eq 1 ] && return 0
    local answer
    printf '  %s [s/N] ' "$1" >&2
    read -r answer || return 1
    [[ "$answer" =~ ^[sSyY] ]]
}

# Procura o app.asar de verdade em vez de confiar numa lista de caminhos.
#
# O ponto que quebra qualquer lista feita de memoria: desde a versao 1.0.136, de maio de 2026,
# o pacote de Linux do Discord (tar.gz, .deb, o oficial do Arch e o RPM) traz SO um bootstrap.
# O app de verdade, com o app.asar, e baixado na primeira execucao para dentro do HOME. Quem
# so olha /usr/share e /opt nao acha Discord nenhum numa instalacao atual.
discord_dirs() {
    local raiz sub base id

    base="${XDG_CONFIG_HOME:-$HOME/.config}"
    for sub in \
        "$base"/discord/app-*/resources \
        "$base"/discordptb/app-*/resources \
        "$base"/discordcanary/app-*/resources
    do
        if [ -e "$sub/app.asar" ] || [ -e "$sub/_app.asar" ]; then
            printf '%s\n' "$sub"
        fi
    done

    # Pacotes que ainda embutem o app: discord_arch_electron do AUR (/usr/share/discord),
    # discord-electron-openasar (/usr/lib/discord), os AUR de PTB e Canary (/opt), e qualquer
    # tar.gz antigo que a pessoa tenha extraido na mao.
    for raiz in \
        /usr/share/discord /usr/share/discord-ptb /usr/share/discord-canary \
        /usr/lib/discord /usr/lib/discord-ptb /usr/lib/discord-canary /usr/lib64/discord \
        /opt/discord /opt/Discord /opt/discord-ptb /opt/discord-canary \
        /usr/local/share/discord \
        "$HOME/.local/share/discord" "$HOME/Discord" "$HOME/discord"
    do
        [ -d "$raiz" ] || continue
        for sub in "$raiz/resources" "$raiz"; do
            if [ -e "$sub/app.asar" ] || [ -e "$sub/_app.asar" ]; then
                printf '%s\n' "$sub"
                break
            fi
        done
    done

    # Flatpak. O deploy do ostree e do root, mas e um diretorio comum: a injecao troca o nome
    # do app.asar e cria uma pasta ao lado, sem reescrever arquivo nenhum, entao os objetos do
    # repositorio ficam intactos. O que muda em relacao ao resto e que um `flatpak update`
    # refaz o deploy inteiro e leva a injecao junto.
    for raiz in /var/lib/flatpak/app "${XDG_DATA_HOME:-$HOME/.local/share}/flatpak/app"; do
        [ -d "$raiz" ] || continue
        for id in "${FLATPAK_IDS[@]}"; do
            for sub in "$raiz/$id"/current/active/files/*/resources; do
                if [ -e "$sub/app.asar" ] || [ -e "$sub/_app.asar" ]; then
                    printf '%s\n' "$sub"
                fi
            done
        done
    done

    # O mesmo bootstrap de que fala o comentario la em cima, so que dentro do flatpak: o HOME
    # do Discord vira ~/.var/app/<id>, e o app baixado cai la. Este e do proprio usuario.
    for id in "${FLATPAK_IDS[@]}"; do
        for sub in "$HOME/.var/app/$id"/config/discord*/app-*/resources; do
            if [ -e "$sub/app.asar" ] || [ -e "$sub/_app.asar" ]; then
                printf '%s\n' "$sub"
            fi
        done
    done

    return 0
}

# O id do flatpak a que um caminho pertence, ou nada se o caminho nao for de flatpak.
flatpak_app_id() {
    local parte
    while IFS= read -r parte; do
        case "$parte" in com.discordapp.*) printf '%s\n' "$parte"; return 0 ;; esac
    done < <(printf '%s\n' "${1:-}" | tr '/' '\n')
    return 1
}

flatpak_is_user_install() {
    have flatpak && flatpak info --user "$1" >/dev/null 2>&1
}

# A liberacao ja existente aparece no --show-permissions, que nao precisa de raiz. Conferir
# antes evita pedir a senha do sudo toda vez que o instalador roda de novo.
flatpak_has_access() {
    local entrada
    # Entrada por entrada, e comparando o texto inteiro: depois de um --nofilesystem a pasta
    # continua aparecendo na lista, so que como !pasta. Procurar o pedaco solto acharia essa
    # negacao e concluiria que o acesso existe, justamente quando ele nao existe mais.
    while IFS= read -r entrada; do
        case "$entrada" in
            "$2"|"$2:rw"|"$2:ro"|"$2:create") return 0 ;;
        esac
    done < <(flatpak info --show-permissions "$1" 2>/dev/null | sed -n 's/^filesystems=//p' | tr ';' '\n')
    return 1
}

# O flatpak so enxerga o proprio sandbox, e o bypass mora fora dele. Sem esta liberacao o
# index.js injetado faz require de um caminho que de dentro do sandbox nao existe, e o Discord
# abre em tela branca. Precisa ser leitura e escrita: o registro tambem e gravado aqui.
grant_flatpak_access() {
    local id="$1" dir="$2"
    have flatpak || return 0
    flatpak_has_access "$id" "$dir" && return 0

    if flatpak_is_user_install "$id"; then
        flatpak override --user "$id" --filesystem="$dir" >/dev/null 2>&1 && return 0
    else
        step "Liberando $dir para o $id"
        sudo flatpak override "$id" --filesystem="$dir" >/dev/null 2>&1 && return 0
    fi

    warn "Nao consegui liberar $dir para o $id. Se o Discord abrir em branco, rode:"
    printf '      %sflatpak override %s--filesystem=%s %s%s\n' \
        "$C_DIM" "$(flatpak_is_user_install "$id" && printf -- '--user ')" "$dir" "$id" "$C_OFF" >&2
    return 1
}

revoke_flatpak_access() {
    local id="$1" dir="$2"
    have flatpak || return 0

    if flatpak_is_user_install "$id"; then
        flatpak override --user "$id" --nofilesystem="$dir" >/dev/null 2>&1 || true
    else
        sudo flatpak override "$id" --nofilesystem="$dir" >/dev/null 2>&1 || true
    fi
    return 0
}

# O pacote discord-electron-openasar ja substitui o app.asar pelo OpenAsar. Injetar por cima
# apagaria o OpenAsar da pessoa sem avisar.
aviso_openasar() {
    local dir="$1"
    case "$dir" in
        /usr/lib/discord*) warn "Esta instalacao parece ser a do openasar. Injetar aqui substitui o OpenAsar." ;;
    esac
    return 0
}

# O snap monta o app dentro de um squashfs, que e somente leitura de verdade: nem o root
# escreve la. Detectar isso vale mais que falhar no meio com "permissao negada". O flatpak nao
# entra nesta lista: o deploy dele e um diretorio comum, e a injecao funciona.
aviso_empacotado() {
    if have snap && snap list 2>/dev/null | grep -qi "^discord"; then
        warn "Voce tem o Discord por snap, e ali o sistema de arquivos e somente leitura."
        printf '      %sA injecao nao acontece dentro de um snap. Para usar o standalone,%s\n' "$C_DIM" "$C_OFF" >&2
        printf '      %sinstale o Discord por flatpak, pelo site oficial ou pela sua distro.%s\n' "$C_DIM" "$C_OFF" >&2
    fi

    return 0
}

injection_state() {
    local resources="$1"
    [ -f "$resources/_app.asar" ] || { printf 'vanilla\n'; return 0; }

    if [ -f "$resources/app.asar/index.js" ] && grep -qF "$PATCHER_NAME" "$resources/app.asar/index.js" 2>/dev/null; then
        printf 'nosso\n'
    else
        printf 'outromod\n'
    fi
    return 0
}

# Escrever em /usr/share exige raiz; em ~/.local/share nao. Pedir sudo sempre seria grosseiro,
# e nunca pedir quebraria a instalacao mais comum.
as_root() {
    if [ -w "$1" ]; then
        shift
        "$@"
    else
        local dir="$1"; shift
        step "Preciso do sudo para escrever em $dir"
        sudo "$@"
    fi
}

# O Discord de flatpak roda em outro namespace de PID: o pgrep costuma ve-lo, mas o pkill pode
# nao alcanca-lo. O `flatpak ps` e o `flatpak kill` respondem por essa parte.
discord_running() {
    pgrep -x Discord >/dev/null 2>&1 && return 0
    pgrep -x DiscordPTB >/dev/null 2>&1 && return 0

    # Um `flatpak ps` so, e nao um por id: isto roda em laco de dois em dois segundos enquanto
    # o modo temporario espera o Discord fechar.
    if have flatpak; then
        local rodando
        rodando="$(flatpak ps --columns=application 2>/dev/null || true)"
        case "$rodando" in *com.discordapp.*) return 0 ;; esac
    fi
    return 1
}

stop_discord() {
    discord_running || return 0
    step "Fechando o Discord"
    pkill -x Discord 2>/dev/null || true
    pkill -x DiscordPTB 2>/dev/null || true
    if have flatpak; then
        local id
        for id in "${FLATPAK_IDS[@]}"; do
            flatpak kill "$id" >/dev/null 2>&1 || true
        done
    fi

    local i
    for i in $(seq 1 40); do
        sleep 0.25
        discord_running || return 0
    done
    fail "O Discord nao fechou. Feche na mao e rode de novo."
}

install_patcher() {
    [ -f "$HERE/$PATCHER_NAME" ] || fail "Nao achei $PATCHER_NAME ao lado deste script."

    mkdir -p "$INSTALL_DIR"
    cp "$HERE/$PATCHER_NAME" "$INSTALL_DIR/$PATCHER_NAME"
    ok "Bypass copiado para $INSTALL_DIR"

    # A configuracao fica fora da pasta do Discord: uma atualizacao apaga resources/ inteiro e
    # levaria a proxy do usuario junto.
    local proxy_value="$PROXY"
    if [ -z "$proxy_value" ] && [ -f "$INSTALL_DIR/settings.json" ]; then
        proxy_value="$(sed -n 's/.*"proxy"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$INSTALL_DIR/settings.json" | head -1)"
    fi

    # A barra invertida e a aspas quebrariam o JSON, e uma senha pode ter as duas. Sem escapar,
    # o arquivo sairia invalido e o bypass voltaria ao padrao em silencio.
    local proxy_json
    proxy_json="$(printf '%s' "$proxy_value" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')"

    cat > "$INSTALL_DIR/settings.json" <<JSON
{
    "enabled": true,
    "proxy": "$proxy_json",
    "excludedCountries": "$EXCLUDED"
}
JSON

    # 600 porque o arquivo pode conter a senha da proxy da pessoa.
    chmod 600 "$INSTALL_DIR/settings.json" 2>/dev/null || true
    ok "Configuracao gravada em $INSTALL_DIR/settings.json"
}

install_injection() {
    local resources="$1"
    local patcher="$INSTALL_DIR/$PATCHER_NAME"

    as_root "$resources" mv "$resources/app.asar" "$resources/_app.asar"

    if ! as_root "$resources" mkdir -p "$resources/app.asar"; then
        as_root "$resources" mv "$resources/_app.asar" "$resources/app.asar"
        fail "Nao consegui criar a pasta de injecao."
    fi

    local tmp
    tmp="$(mktemp -d)"
    printf '%s' "$STUB_PACKAGE" > "$tmp/package.json"
    printf 'require(%s);\n' "\"$patcher\"" > "$tmp/index.js"
    as_root "$resources" cp "$tmp/package.json" "$tmp/index.js" "$resources/app.asar/"
    rm -rf "$tmp"
}

remove_injection() {
    local resources="$1"
    [ -f "$resources/_app.asar" ] || return 1

    as_root "$resources" rm -rf "$resources/app.asar"
    as_root "$resources" mv "$resources/_app.asar" "$resources/app.asar"
    return 0
}

printf '\n  %sGoLiveBypass standalone%s\n' "$C_CYAN" "$C_OFF" >&2
printf '  %sGo Live e camera de volta, direto no Discord%s\n' "$C_DIM" "$C_OFF" >&2

DISTRO="$(os_field PRETTY_NAME)"
[ -n "$DISTRO" ] || DISTRO="Linux"
printf '  %s%s%s\n\n' "$C_DIM" "$DISTRO" "$C_OFF" >&2

aviso_empacotado
mapfile -t FOUND < <(discord_dirs)
[ "${#FOUND[@]}" -gt 0 ] || fail "Nao achei nenhum Discord instalado."

if [ "$MODE" = "status" ]; then
    for resources in "${FOUND[@]}"; do
        case "$(injection_state "$resources")" in
            vanilla)  printf '  %s: sem nada instalado\n' "$resources" >&2 ;;
            nosso)    printf '  %s: com o GoLiveBypass standalone\n' "$resources" >&2 ;;
            outromod) printf '  %s: com Equicord/Vencord (ou outro mod)\n' "$resources" >&2 ;;
        esac
    done
    [ -f "$INSTALL_DIR/golivebypass.log" ] && tail -12 "$INSTALL_DIR/golivebypass.log" >&2
    exit 0
fi

if [ "$MODE" = "uninstall" ]; then
    stop_discord
    for resources in "${FOUND[@]}"; do
        if [ "$(injection_state "$resources")" != "nosso" ]; then
            warn "$resources nao tem o standalone, deixando como esta."
            continue
        fi
        remove_injection "$resources" && ok "$resources voltou ao normal."
        if id="$(flatpak_app_id "$resources")"; then
            revoke_flatpak_access "$id" "$INSTALL_DIR"
        fi
    done
    exit 0
fi

for resources in "${FOUND[@]}"; do
    state="$(injection_state "$resources")"
    printf '  %s: %s\n' "$resources" "$state" >&2

    if [ "$state" = "outromod" ]; then
        warn "Este Discord ja tem Equicord ou Vencord injetado."
        printf '      %sO standalone ocupa o mesmo lugar, entao instalar aqui desliga o outro mod.%s\n' "$C_DIM" "$C_OFF" >&2
        printf '      %sSe voce usa Equicord ou Vencord, prefira o plugin: ele convive com o resto.%s\n' "$C_DIM" "$C_OFF" >&2
        confirm "Substituir o mod em $resources pelo standalone?" || { warn "Deixei como estava."; continue; }
    fi

    install_patcher

    # Antes do stop_discord de proposito: vale tanto para a injecao nova quanto para a que ja
    # estava la, que sai por baixo daqui pelo continue.
    if id="$(flatpak_app_id "$resources")"; then
        grant_flatpak_access "$id" "$INSTALL_DIR"
    fi

    stop_discord

    [ "$state" = "outromod" ] && remove_injection "$resources"
    if [ "$(injection_state "$resources")" = "nosso" ]; then
        ok "Ja estava injetado, so atualizei o bypass."
        continue
    fi

    install_injection "$resources"
    ok "$resources pronto."
done

printf '\n  %sAbra o Discord. O Go Live deve voltar sozinho.%s\n' "$C_GREEN" "$C_OFF" >&2

# O updater do Discord baixa a versao nova numa pasta app-<versao> inteiramente nova, entao a
# injecao fica na pasta velha e simplesmente para de valer. Nao ha como impedir isso do lado de
# fora; avisar e o que da para fazer com honestidade.
case " ${FOUND[*]} " in
    *"/app-"*)
        printf '  %sQuando o Discord se atualizar, ele cria uma pasta app-<versao> nova e a%s\n' "$C_DIM" "$C_OFF" >&2
        printf '  %sinjecao fica para tras. Rode este instalador de novo depois de atualizar.%s\n' "$C_DIM" "$C_OFF" >&2 ;;
esac

# O deploy do flatpak e refeito do zero a cada atualizacao, e a injecao mora dentro dele. Nao
# da para impedir isso de fora, e nem o proprio bypass consegue se remendar depois: dentro do
# sandbox a pasta do app e montada somente leitura. So resta avisar antes de acontecer.
case " ${FOUND[*]} " in
    *"/flatpak/app/"*)
        printf '  %sEste Discord e flatpak: um "flatpak update" desfaz a injecao. Quando isso%s\n' "$C_DIM" "$C_OFF" >&2
        printf '  %sacontecer, rode este instalador de novo.%s\n' "$C_DIM" "$C_OFF" >&2 ;;
esac
printf '  %sRegistro em %s/golivebypass.log%s\n' "$C_DIM" "$INSTALL_DIR" "$C_OFF" >&2
printf '  %sPara desfazer: ./golivebypass-standalone.sh --uninstall%s\n\n' "$C_DIM" "$C_OFF" >&2
