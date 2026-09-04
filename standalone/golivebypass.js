/*
 * GoLiveBypass standalone - devolve o Go Live e a camera para contas brasileiras
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Roda dentro do processo principal do Discord, sem Equicord e sem Vencord. Nao ha renderer,
 * nao ha patch de webpack e nao ha etapa de build: este arquivo e carregado direto, entao o
 * usuario nao precisa de Node, nem de pnpm, nem de git.
 *
 * Por que so o processo principal basta: a trava do cliente vem de um experimento que o
 * servidor atribui a partir do IP de origem do websocket de gateway. Com o gateway saindo por
 * um IP nao bloqueado o experimento nao e atribuido, e os botoes ficam livres sozinhos. Nao ha
 * o que corrigir no cliente quando a origem esta certa.
 *
 * E por que o roteamento e por host, e nao pela sessao inteira: sem renderer nao existe o
 * aviso de "a sessao abriu", que e quando a versao de plugin solta o proxy. Uma regra que vale
 * so para o gateway nao precisa ser solta nunca, entao o resto do Discord sai direto o tempo
 * todo, na velocidade normal.
 */

"use strict";

const { app, session } = require("electron");
const { createServer, connect } = require("net");
const { connect: connectTls } = require("tls");
const { request } = require("https");
const fs = require("original-fs");
const { join, dirname, basename } = require("path");

const DISCORD_HOST = "discord.com";
const GEO_HOST = "cloudflare.com";

// So estes hosts atravessam o tunel. O gate e decidido na conexao do gateway, entao rotear
// mais que isso custaria velocidade em tudo sem comprar nada.
const ROUTED_HOSTS = ["gateway.discord.gg", "remote-auth-gateway.discord.gg"];

const PROBE_TIMEOUT_MS = 6000;
// Mais candidatas por lote nao custa relogio, porque elas correm juntas: custa a mais lenta,
// nao a soma. E com mais candidatas o minimo escolhido e melhor, o que se traduz direto em
// menos latencia em tudo que passa pelo gateway.
const PARALLEL_PROBES = 30;
// Cinco em vez de tres: as candidatas do lote correm juntas, entao guardar mais reserva nao
// custa relogio nenhum na busca e e exatamente o que sobra quando uma saida morre no meio de
// uma transmissao.
const POOL_SIZE = 5;
// Com cinco fontes, o limite alto de candidatas permite varrer uma fatia grande da oferta;
// o probe em paralelo faz a varredura custar o tempo do mais lento, nao a soma.
const MAX_CANDIDATES = 80;
const MIN_UPTIME = 90;
const MAX_LISTED_TIMEOUT = 1500;
const TOR_PORTS = [9052, 9150, 9050, 9250];
const TOR_PORT_TIMEOUT_MS = 400;
// Quanto uma conexao de gateway espera por uma saida antes de sair direta. Segurar para sempre
// travaria o login; soltar na hora perderia a corrida em toda abertura fria.
const HOLD_BUDGET_MS = 12_000;
// No modo "tor" o bootstrap do daemon leva ~20s numa maquina fria, e neste modo estourar o
// prazo nao vira saida direta (o serveSocks recusa), entao esperar mais e barato: o custo e
// o gateway demorar a conectar, nao vazar. No BOOT do Windows o orcamento e maior ainda na
// pratica: a GUI e um processo Electron a parte, que precisa terminar o proprio arranque
// ANTES de sequer chamar o Tor -- o Discord (nativo, mais rapido) costuma vencer a corrida
// (issue #116: "carregamento infinito" so no modo tor, so ao abrir com o Windows). Por isso
// 90s em vez de 45s: com o aviso visivel (showTorBootBanner) esperar mais nao confunde, e o
// custo so aparece no primeiro Discord aberto depois de ligar o PC.
const TOR_HOLD_BUDGET_MS = 90_000;
// O pool guardado vale por este tempo. A revalidacao acontece na abertura (probe real em
// cada saida), entao uma idade longa e segura: o que importa e ter candidatas para revalidar
// em vez de baixar a lista inteira (lenta) com o gateway ja conectando. 30min fazia o pool
// expirar entre aberturas do Discord e o gateway nascia direto — o "carregando infinitamente".
const CACHE_MAX_AGE_MS = 2 * 60 * 60 * 1000;
// Depois de uma busca por saida nova falhar, espera este intervalo antes de tentar de novo:
// a API de saidas gratuitas custa e nao responde mais rapido por repeticao. Quinze segundos
// mantem a resposta razoavel para a sessao que ficou sem saida (com vinte e cinco a morte da
// ativa virava quase um minuto enxugando o gateway).
const REFRESH_COOLDOWN_MS = 15_000;

// Trava da reposicao de rotina. Tres minutos, igual ao plugin: sem ela, um pote que nao
// consegue encher viraria uma varredura inteira da lista gratuita a cada trinta segundos, pela
// sessao toda. E separada da trava acima para a rotina nunca adiar a emergencia.
const STOCK_COOLDOWN_MS = 3 * 60_000;

// Prazo do tunel no trafego vivo, bem menor que o do teste: uma saida agonizante que demora a
// falhar faria o Chromium desistir do roteador inteiro.
const RELAY_TIMEOUT_MS = 2500;

// Prazo do tunel no modo tor, pelo contrario, folgado: o SOCKS CONNECT do Tor constroi
// circuito novo quando o anterior expirou (MaxCircuitDirtiness ~10 min) e isso leva 5-30s --
// o SocksTimeout do Tor e 60s+. Com o prazo de saida gratuita (2.5s) o cliente abortava uma
// conexao que o Tor completaria segundos depois, e o gateway so reconectava no proximo ciclo
// de backoff (janelas de minutos sem gateway na issue #122). No tor nao existe alternativa
// (nunca sai direto), entao esperar nao custa nada: o cliente do gateway ja recebeu a
// resposta do SOCKS e espera pacientemente o handshake.
const TOR_RELAY_TIMEOUT_MS = 30_000;

// De quanto em quanto tempo as saidas sao reconferidas com a sessao ja aberta. O refreshExit
// conserta depois que uma conexao falha; o batimento existe para que ela nao chegue a falhar.
// Trinta segundos e curto o bastante para a reserva estar quente quando o gateway reconectar,
// e longo o bastante para nao virar carga na saida gratuita, que costuma limitar conexoes.
const HEARTBEAT_MS = 30_000;
const HEARTBEAT_TIMEOUT_MS = 4000;

// Quantos batimentos seguidos uma saida pode errar antes de sair do pote. Cortar no primeiro
// seria cruel com saida gratuita congestionada, que erra um e volta; nunca cortar deixaria o
// pote cheio de endereco morto, que e o mesmo que nao ter reserva nenhuma.
const MAX_MISSED_BEATS = 2;

// Abaixo disto o batimento vai atras de reservas novas. Uma so nao e reserva: e a proxima a
// morrer.
const MIN_LIVE_RESERVES = 2;

// ------------------------------------------------------------------ estabilidade da sessao
// Uma saida gratuita passa no probe e ainda assim entrega mal: RTT alto e instavel faz o
// websocket do gateway perder heartbeat e reconectar em loop, derrubando o carregamento.
// A troca proativa ataca antes de a conexao sofrer.

// Acima disto a saida e considerada lenta demais para o gateway. Medido como EMA do RTT
// dos probes (a media exponencial suaviza picos momentaneos sem ignorar degradacao real).
const RTT_TROCA_MS = 450;
// RTT lento por N batimentos seguidos vira troca: um pico isolado nao aposenta saida boa.
const RTT_TROCA_BATIDAS = 3;
// Fator da EMA (0.3 = o RTT novo pesa 30%, o historico 70%).
const RTT_EMA_ALPHA = 0.3;

// O medidor mais confiavel de sofrimento e o proprio gateway: reconexoes em rajada (3+ em
// 180s) significam que a saida nao esta aguentando o trafego vivo, mesmo passando no probe.
// Acima disto, troca forcada de saida — e reseta o contador.
const RECONEXAO_JANELA_MS = 180_000;
const RECONEXAO_LIMITE = 3;

// Cooldown das trocas PROATIVAS (por RTT ou por rajada): quando o pool inteiro esta lento,
// trocar em cascata vira ping-pong entre ruins — cada troca faz o gateway renascer e a
// sessao recarregar. Esperar o cooldown suaviza; a troca por saida MORTA e emergencia e
// nao passa por aqui.
const SWAP_COOLDOWN_MS = 60_000;
// Nas trocas proativas, so vale trocar para uma reserva pELO MENOS tao boa quanto a atual:
// trocar para outra lenta (ou pior) nao ajuda o gateway e ainda o faz renascer a toa.
const SWAP_RESERVA_RAZAO = 1.2;

// Prazo global da busca por saidas, do inicio ao fim (nao por lote): o probe completo numa
// candidata de RTT medio leva ~4-8s (duas conexoes + TLS), entao um prazo curto por lote
// cortava os probes antes de aprovarem e a busca voltava vazia — o gateway nascia direto e
// a sessao ficava bloqueada (video nunca chega, so audio). Os lotes correm ate este prazo e
// a melhor aprovada que tiver chegado vence.
const HUNT_BUSCA_TOTAL_MS = 10_000;

const MAX_LOG_BYTES = 2 * 1024 * 1024;

// ------------------------------------------------------------------ recarga apos gateway direto
// O roteador abre direto para um host de gateway quando nenhuma saida entrega; essa sessao
// nasce pelo IP brasileiro e o servidor bloqueia (o "carregando infinitamente"). Quando a
// saida voltar a ficar pronta, recarregar a janela do Discord faz o gateway renascer atras
// dela. Guardas contra loop: teto por execucao, cooldown, single-flight e a saida tem que
// estar comprovadamente entregando antes do reload.
const RELOAD_MAX_RETRIES = 2;
const RELOAD_COOLDOWN_MS = 30_000;
// Depois de quanto tempo sem ver o gateway direto o sinal expira: uma recarga tardia
// derrubaria uma sessao que ja se recuperou sozinha.
const DIRECT_SIGNAL_TTL_MS = 60_000;
// A janela do cliente, nao a splash (que nunca tem URL discord.com).
const CLIENT_URL_RE = /^https:\/\/(?:canary|ptb\.)?discord\.com\/(?:app|channels|login)/;

const HERE = __dirname;
const SETTINGS_FILE = join(HERE, "settings.json");
const STATE_FILE = join(HERE, "state.json");

// O log vai para uma pasta ESTAVEL, nao para HERE. Quando a GUI injeta, HERE e a pasta do
// app.asar do Discord: um lugar que ninguem adivinha e que some quando o Discord se atualiza
// ou o bypass e desativado. A pasta abaixo e a mesma que o app e o plugin usam (%LOCALAPPDATA%
// \GoLiveBypass no Windows, $XDG_DATA_HOME/GoLiveBypass no Linux/Mac) -- e onde a pessoa
// naturalmente procura, e um arquivo so, que sobrevive a atualizacao do Discord.
function logDir() {
    const base = process.platform === "win32"
        ? process.env.LOCALAPPDATA
        : (process.env.XDG_DATA_HOME
            || (process.env.HOME ? join(process.env.HOME, ".local", "share") : undefined));
    return base ? join(base, "GoLiveBypass") : null;
}
const LOG_FILE = logDir() === null ? null : join(logDir(), "golivebypass.log");

let socksPort = 0;
let chosenExit = null;
let exitSettled = false;
// Reservas ja testadas. Uma saida gratuita morre sem avisar, e sem reserva a unica alternativa
// seria refazer a busca inteira no meio da sessao.
let pool = [];
const waitingForExit = [];
// Estado da re-selecao em runtime: so uma busca por vez, e nunca antes do cooldown.
let refreshingExit = null;
let lastRefreshAt = 0;
let lastStockAt = 0;
// Quantos batimentos seguidos cada saida errou. Fora do pote de proposito: o pote vai para
// disco, e isto e estado desta sessao.
const missedBeats = new Map();
let beating = false;
let stocking = null;

// Medicao de qualidade por saida (estado desta sessao): EMA do RTT dos probes e quantos
// batimentos seguidos ela ficou acima do teto. A troca por RTT so acontece depois de
// RTT_TROCA_BATIDAS leituras ruins seguidas — pico momentaneo nao aposenta saida boa.
const rttEma = new Map();          // proxy -> EMA do RTT (ms)
const rttLentoSeguidas = new Map(); // proxy -> batimentos ruins consecutivos

// Janela deslizante das reconexoes do gateway (so o cliente real conecta em
// gateway-*.discord.gg). A rajada e o sinal de que a saida nao aguenta o trafego vivo.
const gatewayReconexoes = [];      // timestamps das reconexoes na janela
let ultimaTrocaProativaEm = 0;    // cooldown das trocas proativas (RTT/rajada)

// Quarentena de saidas que ja causaram sofrimento: a saida passa no probe e mesmo assim o
// gateway sofre; sem um "nao voltar para essa agora", o refresh reelege exatamente ela (a
// mesma mai famosa do dia). Fica de fora por QUARENTENA_MS e o pool e obrigado a testar
// alternativas.
const QUARENTENA_MS = 90_000;
const quarentena = new Map();     // proxy -> ate quando fica evitada

function quarentenar(proxy, motivo) {
    if (proxy === null) return;
    if (proxy === manualProxy()) {
        log(safeProxy(proxy) + " poupada da quarentena por ser a saida configurada (" + motivo + ")");
        return;
    }
    const ate = Date.now() + QUARENTENA_MS;
    const ja = quarentena.get(proxy);
    if (ja === undefined || ate > ja) quarentena.set(proxy, ate);
    log(safeProxy(proxy) + " em quarentena ate daqui a " + Math.round(QUARENTENA_MS / 1000) + "s (" + motivo + ")");
}

function foraDeQuarentena(itens) {
    const agora = Date.now();
    for (const [proxy, ate] of quarentena) if (ate <= agora) quarentena.delete(proxy);
    return itens.filter(item => !quarentena.has(typeof item === "string" ? item : item.proxy));
}

// Troca proativa de saida com cooldown: impede o ping-pong entre saidas ruins quando o pool
// inteiro esta lento. A troca por saida MORTA (emergencia) chama trocarPara direto.
function trocaProativaPode() {
    return Date.now() - ultimaTrocaProativaEm > SWAP_COOLDOWN_MS;
}

function trocarPara(nova, motivo) {
    ultimaTrocaProativaEm = Date.now();
    gatewayReconexoes.length = 0;
    missedBeats.delete(nova);
    rttLentoSeguidas.delete(nova);
    const antiga = chosenExit;
    const vida = antiga === null || lastExitAt === 0 ? "?" : Math.round((Date.now() - lastExitAt) / 1000) + "s";
    log("saida.trocada | de=" + (antiga === null ? "nenhuma" : safeProxy(antiga)) +
        " para=" + safeProxy(nova) +
        " motivo=" + motivo +
        " vida_da_antiga=" + vida);
    chosenExit = nova;
    // Corrige o "saida pronta ha Ns" mentindo: sem isto, trocas em runtime
    // (openThroughPool) nao atualizavam e o log do gateway mostrava a idade
    // da saida ORIGINAL.
    lastExitAt = Date.now();
}

// Estado da recarga pos-gateway-direto.
let gatewayWentDirectAt = 0;   // quando o roteador abriu direto para um host de gateway
let reloadCount = 0;           // recargas nesta execucao (reseta quando a sessao volta roteada)
let lastReloadAt = 0;          // cooldown
let reloading = false;         // single-flight

// Estado do arranque frio em modo tor: quando o Discord abre (ou o Windows liga) antes do
// Tor da GUI terminar de subir, as conexoes de gateway ficam SEGURADAS (nunca vazam direto --
// ver HOLD_BUDGET_MS/TOR_HOLD_BUDGET_MS). Sem aviso a pessoa so ve "carregando" para sempre e
// nao sabe se travou ou se e so questao de tempo (issue #116). Este timestamp marca quando a
// espera comecou; zerado assim que uma saida real aparece (settleExit), momento em que o
// banner some e a janela recarrega sozinha em vez de esperar o proprio Discord perceber e
// tentar de novo por conta propria (que pode demorar mais que so tentar na hora).
let coldTorHoldSince = 0;

// Falhas seguidas do probe da saida MANUAL (nao do trafego vivo -- so a checagem de fundo em
// chooseExit). Uma falha isolada pode ser um blip; falhas repetidas em toda abertura sao o
// padrao de credencial/endereco errado (ex.: SOCKS5 recusa a autenticacao) que nenhum retry
// sozinho resolve -- e o "de Ctrl+R" que o projeto recomenda em outras issues NAO ajuda aqui,
// porque Ctrl+R so recarrega o renderer (a pagina), nao o processo principal onde mora o
// roteador: ele continua preferindo a mesma saida quebrada (issue: "loading infinito mesmo
// dando control r" -- o usuario reabria o Discord varias vezes achando que ia resolver, e a
// unica coisa que resolvia de verdade era o fallback automatico para o Tor, sem aviso nenhum
// de que o problema era a PROXY configurada). Contador de PROCESSO, nao persistido: reabrir
// o Discord comeca a contagem de novo, entao uma saida que voltou a funcionar nao carrega
// alarme velho.
let manualProxyFalhasSeguidas = 0;
const MANUAL_PROXY_AVISO_LIMITE = 2;
let manualProxyBannerMostrado = false;

// Pasta estavel onde a GUI le os logs (sobrevive a updates do Discord e a
// desativacao). Espelhar aqui e o que permite o report de bug pegar o log do
// bypass mesmo depois de o app.asar injetado ser apagado.
const MIRROR_DIR = (() => {
    try {
        if (process.platform === "win32" && process.env.LOCALAPPDATA) {
            return join(process.env.LOCALAPPDATA, "GoLiveBypass", "logs");
        }
        const base = process.env.XDG_DATA_HOME || join(require("os").homedir(), ".local", "share");
        return join(base, "GoLiveBypass", "logs");
    } catch {
        return "";
    }
})();
const MIRROR_MAX_BYTES = 2 * 1024 * 1024;

function log(line) {
    const stamp = new Date().toTimeString().slice(0, 8);
    if (LOG_FILE !== null) try {
        // Sem comando de diagnostico aqui, o arquivo e a unica forma de saber o que aconteceu.
        // Ele e cortado sozinho para nao crescer sem fim numa maquina que ninguem limpa.
        if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > MAX_LOG_BYTES) {
            fs.writeFileSync(LOG_FILE, fs.readFileSync(LOG_FILE, "utf8").slice(-MAX_LOG_BYTES / 2));
        } else if (!fs.existsSync(LOG_FILE)) {
            // A pasta pode nao existir ainda (injecao numa maquina que nunca rodou o app).
            fs.mkdirSync(dirname(LOG_FILE), { recursive: true });
        }
        fs.appendFileSync(LOG_FILE, stamp + " " + line + "\n");
    } catch {
        // Ficar sem registro e ruim; derrubar o Discord por causa do registro e pior.
    }

    // Espelho para a pasta estavel (falha silenciosa: nunca derruba o Discord).
    if (MIRROR_DIR !== "") {
        try {
            const alvo = join(MIRROR_DIR, "bypass.log");
            fs.mkdirSync(MIRROR_DIR, { recursive: true });
            if (fs.existsSync(alvo) && fs.statSync(alvo).size > MIRROR_MAX_BYTES) {
                fs.renameSync(alvo, join(MIRROR_DIR, "bypass.1.log"));
            }
            fs.appendFileSync(alvo, stamp + " " + line + "\n");
        } catch {
            // silencioso
        }
    }

    console.log("[GoLiveBypass]", line);
}

function readJson(file, fallback) {
    try {
        return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
        return fallback;
    }
}

function writeJson(file, value) {
    try {
        fs.writeFileSync(file, JSON.stringify(value, null, 4));
    } catch (error) {
        log("nao consegui gravar " + basename(file) + ": " + error.message);
    }
}

const settings = readJson(SETTINGS_FILE, {});
const excludedCountries = new Set(
    (typeof settings.excludedCountries === "string" ? settings.excludedCountries : "BR")
        .split(",").map(code => code.trim().toUpperCase()).filter(code => /^[A-Z]{2}$/.test(code))
);

// Enhanced trust policy: sem proxy explicita, a unica saida intermediaria permitida e Tor.
// Valores legados "auto"/"free" nao reativam listas publicas. Com proxy personalizada,
// "auto" continua sendo usado internamente apenas para permitir o fallback DIRETO do gateway
// se a saida escolhida estiver indisponivel; nunca significa procurar terceiros.
const hasExplicitProxy = typeof settings.proxy === "string" && settings.proxy.trim() !== "";
const routeMode = hasExplicitProxy ? "auto" : "tor";
// O endereco do Tor pode vir das settings (a GUI sobe o proprio numa porta dedicada).
const TOR_ADDR = typeof settings.torAddr === "string" && settings.torAddr !== ""
    ? settings.torAddr
    : "127.0.0.1:9050";
// Revive automatico do gateway zumbi (issues #145/#149/#153): close 4000 para o cliente
// renascer com RESUME, escalando para reload. Ligado por default e conservador por
// desenho (nunca em call/midia recente, teto de 2 tentativas por 30min); a GUI pode desligar.
const autoRevive = settings.autoRevive !== false;

// Primeira linha do log: o modo EFETIVO que este runtime vai usar. Sem ela, um settings.json
// regravado sem routeMode (escritor antigo, terceiro, versao anterior) deixava o runtime no
// "auto" enquanto a GUI jurava tor -- e o log nao tinha como provar o contrario (issue #108).
log("modo de roteamento: " + routeMode +
    (typeof settings.routeMode === "string" ? " (settings.json)" : " (padrao: settings.json sem routeMode)"));
if (!autoRevive) log("revive automatico do gateway: desligado (settings.json)");

// O trecho antes do @ e opcional e casado com ganancia, para a senha poder conter @ e : sem
// precisar de escape: quem recebe um endereco pronto da AWS costuma cola-lo como veio.
// Agora suporta RANGE de portas para proxies multiplexados, ex: 10000-10050
const PROXY_RE = /^(socks5|socks4|http|https):\/\/(?:(.+)@)?([^:/?#\s@]+):(\d{1,5})(?:-(\d{1,5}))?$/;

function parseProxy(value) {
    const match = PROXY_RE.exec(String(value).trim());
    if (match === null) return null;

    const portStart = Number(match[4]);
    if (portStart < 1 || portStart > 65535) return null;
    let finalPort = portStart;

    // Se tiver range, sorteia uma porta do range
    if (match[5] !== undefined) {
        const portEnd = Number(match[5]);
        if (portEnd >= portStart && portEnd <= 65535) {
            finalPort = Math.floor(Math.random() * (portEnd - portStart + 1)) + portStart;
        }
    }

    // Dividido no primeiro dois-pontos, entao a senha pode ter quantos quiser.
    const credentials = match[2] === undefined ? "" : match[2];
    const split = credentials.indexOf(":");
    const decode = value => {
        try {
            return decodeURIComponent(value);
        } catch {
            // Um % solto no meio da senha nao e escape, e literal.
            return value;
        }
    };

    return {
        scheme: match[1],
        user: credentials === "" ? "" : decode(split < 0 ? credentials : credentials.slice(0, split)),
        pass: credentials === "" || split < 0 ? "" : decode(credentials.slice(split + 1)),
        host: match[3],
        port: finalPort
    };
}

// Nunca registrar a senha: o registro vai para arquivo e as pessoas colam ele em relato de
// problema.
function safeProxy(value) {
    const parsed = parseProxy(value);
    if (parsed === null) return "endereco invalido";

    return parsed.scheme + "://" + (parsed.user === "" ? "" : parsed.user + ":***@") + parsed.host + ":" + parsed.port;
}

function manualProxy() {
    const raw = settings.proxy;
    if (typeof raw !== "string" || raw.trim() === "") return "";

    const parsed = parseProxy(raw);
    if (parsed === null) return null;

    // Retorna a string ja renderizada com a porta sorteada (se houver range)
    return parsed.scheme + "://" +
           (parsed.user !== "" ? parsed.user + ":" + parsed.pass + "@" : "") +
           parsed.host + ":" + parsed.port;
}

// Saida manual/privada configurada (com ou sem range multiplexado). Usada para desligar a
// reposicao de reserva e a troca proativa por RTT: sao mecanismos pensados para saida
// GRATUITA, que morre sem avisar e precisa de troca em segundo plano. Numa saida privada,
// entrar neles so custa (ver trySwapByRtt e stockReserves).
const usingManualProxy = typeof settings.proxy === "string" && settings.proxy.trim() !== "" && parseProxy(settings.proxy) !== null;

// A saida ativa e uma das portas configuradas pela pessoa? Comparacao por string falha
// para range: manualProxy() sorteia uma porta nova a cada chamada, entao a mesma saida
// ativa nunca bateria com uma leitura nova. Aqui confere host e se a porta cai dentro do
// intervalo configurado (um range vira um intervalo de 1 porta so).
function isManualAddress(proxy) {
    if (proxy === null || !usingManualProxy) return false;
    const match = PROXY_RE.exec(String(settings.proxy).trim());
    if (match === null) return false;
    const candidato = parseProxy(proxy);
    if (candidato === null || candidato.host !== match[3]) return false;
    const portStart = Number(match[4]);
    if (match[5] === undefined) return candidato.port === portStart;
    // Mesma convencao do parseProxy: range invalido (portEnd < portStart ou > 65535) cai
    // para porta unica (portStart). Sem isto, isManualAddress rejeita uma porta que o
    // parseProxy aceitou -- o tryReturnToManual nunca reconhece a ativa como manual e
    // fica tentando trocar a cada 90s para uma porta que ele mesmo ja' sorteou.
    const portEnd = Number(match[5]);
    if (portEnd < portStart || portEnd > 65535) return candidato.port === portStart;
    return candidato.port >= portStart && candidato.port <= portEnd;
}

// ------------------------------------------------------------------ falar com uma saida

function readReply(socket, size, done) {
    const chunks = [];
    let settled = false;

    const finish = reply => {
        if (settled) return;
        settled = true;
        socket.off("data", onData);
        socket.off("close", onClose);
        done(reply);
    };

    const onData = chunk => {
        chunks.push(chunk);
        const buffer = Buffer.concat(chunks);
        const wanted = size(buffer);
        if (wanted < 0 || buffer.length < wanted) return;

        socket.pause();
        if (buffer.length > wanted) socket.unshift(buffer.subarray(wanted));
        finish(buffer.subarray(0, wanted));
    };

    // Uma saida que aceita a conexao e fecha limpo no meio da negociacao nao gera erro nenhum:
    // FIN nao e erro. Sem escutar o fechamento o retorno so viria quando o prazo estourasse.
    const onClose = () => finish(null);

    socket.on("data", onData);
    socket.on("close", onClose);
    socket.resume();
}

function negotiateSocks5(socket, host, port, credentials, done) {
    // Oferecer o metodo 2 so quando ha credencial: um proxy que aceita os dois escolheria a
    // autenticacao a toa, e ai um usuario vazio seria recusado.
    socket.write(credentials.user === "" ? Buffer.from([5, 1, 0]) : Buffer.from([5, 2, 0, 2]));

    readReply(socket, buffer => (buffer.length < 2 ? -1 : 2), greeting => {
        if (greeting === null || greeting[0] !== 5) return done(false, "etapa=greeting motivo=sem_resposta");

        // 0 = sem autenticacao, 2 = usuario e senha (RFC 1929). Qualquer outra coisa, inclusive
        // 0xFF, significa que o proxy nao aceita nada que a gente sabe fazer.
        if (greeting[1] === 2) {
            const user = Buffer.from(credentials.user, "utf8");
            const pass = Buffer.from(credentials.pass, "utf8");
            if (user.length > 255 || pass.length > 255) return done(false, "etapa=auth motivo=credencial_longa");

            readReply(socket, buffer => (buffer.length < 2 ? -1 : 2), reply => {
                if (reply === null || reply[1] !== 0) return done(false, "etapa=auth motivo=recusada code=socks5:0x" + (reply && reply[1] !== undefined ? reply[1].toString(16) : "??"));
                sendTarget();
            });

            socket.write(Buffer.concat([
                Buffer.from([1, user.length]), user,
                Buffer.from([pass.length]), pass
            ]));
            return;
        }

        if (greeting[1] !== 0) return done(false, "etapa=greeting code=socks5:0x" + greeting[1].toString(16));
        sendTarget();
    });

    function sendTarget() {
        const name = Buffer.from(host, "utf8");
        const message = Buffer.alloc(7 + name.length);
        message[0] = 5;
        message[1] = 1;
        message[2] = 0;
        message[3] = 3;
        message[4] = name.length;
        name.copy(message, 5);
        message.writeUInt16BE(port, 5 + name.length);
        socket.write(message);

        readReply(socket, buffer => {
            if (buffer.length < 5) return -1;
            if (buffer[3] === 1) return 10;
            if (buffer[3] === 4) return 22;
            if (buffer[3] === 3) return 7 + buffer[4];
            return -1;
        }, reply => {
            if (reply !== null && reply[1] === 0) return done(true);
            const code = reply === null ? "??" : "0x" + reply[1].toString(16);
            done(false, "etapa=connect code=socks5:" + code);
        });
    }
}

function negotiateConnect(socket, host, port, credentials, done) {
    // O proxy HTTP nao negocia metodo: ou a credencial vai junto do CONNECT, ou ele responde
    // 407 e a conexao ja era.
    const auth = credentials.user === ""
        ? ""
        : "Proxy-Authorization: Basic " + Buffer.from(credentials.user + ":" + credentials.pass, "utf8").toString("base64") + "\r\n";

    socket.write("CONNECT " + host + ":" + port + " HTTP/1.1\r\nHost: " + host + ":" + port + "\r\n" + auth + "\r\n");

    readReply(socket, buffer => {
        const end = buffer.indexOf("\r\n\r\n");
        return end < 0 ? -1 : end + 4;
    }, reply => {
        if (reply === null) return done(false, "etapa=http motivo=sem_resposta");
        const linha = reply.toString("latin1").split("\r\n")[0];
        if (/ 200 /.test(linha)) return done(true);
        const status = (linha.match(/^HTTP\/\d\.\d (\d{3})/) || [])[1] || "??";
        done(false, "etapa=http code=" + status);
    });
}

function openTunnel(proxy, host, port, timeoutMs) {
    return new Promise(resolve => {
        const parsed = parseProxy(proxy);
        if (parsed === null) return resolve(null);

        let settled = false;
        const inicio = Date.now();
        const finish = (value, motivo) => {
            if (settled) return;
            settled = true;
            if (value === null) socket.destroy();
            else socket.setTimeout(0);
            // Log da causa da falha do tunel — o diagnostico que hoje some:
            // etapa (tcp/greeting/auth/connect/tls), errno (ECONNREFUSED/ETIMEDOUT)
            // e code (rep SOCKS / status HTTP do CONNECT).
            if (value === null && motivo) {
                log("[net] tunel.falha | alvo=" + host + ":" + port + " saida=" + safeProxy(proxy) + " " + motivo + " ms=" + (Date.now() - inicio));
            }
            resolve(value);
        };

        const socket = connect({ host: parsed.host, port: parsed.port });
        socket.setTimeout(timeoutMs || PROBE_TIMEOUT_MS, () => finish(null, "etapa=tcp motivo=timeout"));
        socket.on("error", e => finish(null, "etapa=tcp errno=" + (e && e.code ? e.code : "desconhecido")));
        socket.once("connect", () => {
            const done = (ok, motivo) => finish(ok ? socket : null, ok ? undefined : motivo);
            if (parsed.scheme === "socks5") negotiateSocks5(socket, host, port, parsed, done);
            else negotiateConnect(socket, host, port, parsed, done);
        });
    });
}

function readOverTls(socket, host, path, timeoutMs) {
    return new Promise(resolve => {
        let body = "";
        let settled = false;

        const finish = value => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            tls.destroy();
            resolve(value);
        };

        const timer = setTimeout(() => finish(null), timeoutMs || PROBE_TIMEOUT_MS);
        const tls = connectTls({ socket, servername: host, host }, () => {
            tls.write("GET " + path + " HTTP/1.1\r\nHost: " + host + "\r\nAccept: */*\r\nConnection: close\r\n\r\n");
        });

        tls.setEncoding("latin1");
        tls.on("error", () => finish(null));
        tls.on("data", chunk => {
            body += chunk;
            if (body.length > 65536) finish(body);
        });
        tls.on("end", () => finish(body));
    });
}

// So o aperto de mao TLS, sem pedir pagina nenhuma. Serve para hosts que nao respondem HTTP --
// o gateway e websocket -- e ainda assim prova o que importa: a saida alcanca o host e o
// certificado fecha, entao ela nao esta sendo barrada por reputacao ali.
function tlsHandshake(socket, host, timeoutMs) {
    return new Promise(resolve => {
        let settled = false;

        const finish = value => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            tls.destroy();
            resolve(value);
        };

        const timer = setTimeout(() => finish(false), timeoutMs || PROBE_TIMEOUT_MS);
        const tls = connectTls({ socket, servername: host, host }, () => finish(true));

        tls.on("error", () => finish(false));
        // Um host que aceita a conexao e fecha limpo antes do handshake nao gera erro: sem
        // isto o retorno so viria quando o prazo estourasse.
        tls.on("close", () => finish(false));
    });
}

// Prova o que interessa numa saida: o tunel negocia, o TLS fecha com certificado valido para o
// Discord, e o Discord responde 200 por ela. Saida barrada por reputacao falha exatamente aqui,
// que e o motivo de o teste nao ser contra um endereco qualquer.
async function probe(proxy, timeoutMs, torProbe) {
    const started = Date.now();

    // No modo "tor" o teste e feito contra o host que a saida REALMENTE vai carregar. O
    // discord.com fica atras da Cloudflare, que recusa o handshake TLS vindo de exit de Tor
    // ("tls alert handshake failure", medido em 2026-08-23) -- e o roteador nunca manda
    // discord.com pela saida, so *.discord.gg. Ou seja: a saida era reprovada por um host que
    // ela nunca ia atender, e o modo tor ficava preso em "porta aberta mas nao respondeu como
    // proxy" com o Tor de pe e o gateway alcancavel (TLS ate gateway.discord.gg em ~600ms).
    //
    // O mesmo vale para o detectTor nos modos auto/free (torProbe): sem isso, o probe HTTP
    // contra discord.com reprovava um Tor do sistema perfeitamente saudavel e o "auto"
    // ("Tor local se houver, senao gratuitas") caia direto no pool gratuito -- exatamente o
    // cenario da issue #108. A prova e o handshake TLS ate o gateway: o /api/v9/gateway nao
    // existe nesse host (ele e websocket), entao exigir HTTP 200 nao faria sentido. Um exit
    // que fecha TLS com o gateway entrega o que precisamos.
    const torHost = routeMode === "tor" || torProbe === true;
    const host = torHost ? ROUTED_HOSTS[0] : DISCORD_HOST;

    const socket = await openTunnel(proxy, host, 443, timeoutMs);
    if (socket === null) return null;

    if (torHost) {
        if (!await tlsHandshake(socket, host, timeoutMs)) return null;
    } else {
        const response = await readOverTls(socket, host, "/api/v9/gateway", timeoutMs);
        if (response === null || (!response.startsWith("HTTP/1.1 200") && !response.startsWith("HTTP/1.1 404"))) return null;
    }

    const ms = Date.now() - started;
    // Alimenta a EMA de RTT da saida: a troca proativa por lentidao le desta leitura.
    const ema = rttEma.has(proxy) ? rttEma.get(proxy) : ms;
    rttEma.set(proxy, ema + RTT_EMA_ALPHA * (ms - ema));

    return { proxy: proxy, ms: ms };
}

// O host que reporta o pais de saida quando o trace da Cloudflare nao traz um loc de pais
// real — exatamente o que acontece com exits do Tor (o loc vem como "T1") e com varias
// gratuitas. O ipwho.is responde via Tor/US; ifconfig.co provou ser instavel demais.

// Cache do pais de saida de Tor. O exit do Tor muda a cada ~10min (novo circuito), entao
// um cache de TOR_GEO_TTL_MS = 8min descreve o pais certo com 1 consulta por circuito,
// independente de quantas vezes o heartbeat rodou. Sem cache, o ipwho.is receberia 1
// consulta por batimento e estourava a cota -- 37 relays BR em 10k explica o porquê dessa
// escolha ter sido a primeira coisa pensada quando o modo tor virou "sem checagem de pais".
const TOR_GEO_TTL_MS = 8 * 60 * 1000;
const torGeoCache = new Map();

function torGeoFresh(entry) {
  return entry !== undefined && Date.now() < entry.ate;
}

async function exitCountryTorCached(proxy, timeoutMs) {
  const cached = torGeoCache.get(proxy);
  if (torGeoFresh(cached)) return cached.pais;
  const pais = await exitCountry(proxy, timeoutMs);
  if (pais === null) return null;
  torGeoCache.set(proxy, { pais: pais, ate: Date.now() + TOR_GEO_TTL_MS });
  return pais;
}


const GEO_FALLBACK_HOST = "ipwho.is";

async function exitCountry(proxy, timeoutMs) {
    // O trace da Cloudflare prova o tunel e o pais numa conexao so; e o caminho rapido.
    const socket = await openTunnel(proxy, GEO_HOST, 443, timeoutMs);
    if (socket !== null) {
        const response = await readOverTls(socket, GEO_HOST, "/cdn-cgi/trace", timeoutMs);
        const match = response === null ? null : /^loc=([A-Z]{2})/m.exec(response);
        // "T1" e o codigo especial que a Cloudflare usa para exits do Tor: nao e um pais.
        if (match !== null && match[1] !== "T1") return match[1];
    }

    // Fallback: sem um pais de verdade no trace, pergunta ao ipwho.is (JSON com
    // country_code). Sem isto, Tor e varias gratuitas eram recusadas como "saida em pais
    // desconhecido" mesmo com o tunel funcionando.
    try {
        const fallback = await openTunnel(proxy, GEO_FALLBACK_HOST, 443, timeoutMs);
        if (fallback !== null) {
            const json = await readOverTls(fallback, GEO_FALLBACK_HOST, "/?fields=country_code", timeoutMs);
            const iso = json === null ? null : /"country_code"\s*:\s*"([A-Z]{2})"/.exec(json);
            if (iso !== null) return iso[1];
        }
    } catch {
        // sem o pais, o chamador recusa a saida — melhor que assumption errada
    }

    return null;
}

// As duas conexoes em sequencia de proposito: saida gratuita sobrecarregada costuma limitar
// conexoes simultaneas, e abrir duas de uma vez reprovaria candidata boa. O paralelismo que
// importa e entre candidatas, no lote que chama esta funcao.
async function probeExit(proxy) {
    const result = await probe(proxy);
    if (result === null) return null;

    result.country = await exitCountry(proxy);
    return result;
}

// ------------------------------------------------------------------ escolher a saida

function downloadText(url, timeoutMs) {
    return new Promise((resolve, reject) => {
        const req = request(url, res => {
            if (res.statusCode !== 200) {
                res.resume();
                return reject(new Error("resposta inesperada: " + res.statusCode));
            }

            let body = "";
            res.setEncoding("utf8");
            res.on("data", chunk => {
                body += chunk;
                if (body.length > 4_000_000) req.destroy(new Error("resposta grande demais"));
            });
            res.on("end", () => resolve(body));
        });

        req.on("error", reject);
        req.setTimeout(timeoutMs || 15_000, () => req.destroy(new Error("tempo esgotado")));
        req.end();
    });
}

// As listas gratuitas de uma fonte so mudam de vez em quando e variam de qualidade; juntar
// varias fontes dilui a dependencia de uma unica lista e aumenta a chance de achar uma saida
// com RTT decente. A proxyscrape (formato JSON com uptime) segue sendo a primeira; as demais
// trazem candidatas de outras redes. Tudo e testado de verdade pelo probe antes de usar.
const FREE_PROXY_API = "https://api.proxyscrape.com/v4/free-proxy-list/get?request=display_proxies&protocol=socks5&proxy_format=protocolipport&format=json&timeout=1500";
const FREE_PROXY_FONTES = [
    { tipo: "proxyscrape", url: FREE_PROXY_API },
    { tipo: "plain", url: "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/socks5.txt" },
    { tipo: "plain", url: "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/socks5.txt" },
    { tipo: "plain", url: "https://raw.githubusercontent.com/clarketm/proxy-list/master/proxy-list-raw.txt" },
    { tipo: "geonode", url: "https://proxylist.geonode.com/api/proxy-list?limit=80&page=1&sort_by=lastChecked&sort_type=desc&protocols=socks5" }
];
// As fontes sao baixadas juntas; prazo curto para a mais lenta nao atrasar a escolha (o
// gateway espera no roteador por ate HOLD_BUDGET_MS).
const FONTES_TIMEOUT_MS = 6000;

// Cada formato de fonte vira a mesma coisa: { proxy, uptime?, timeout?, country? }. O
// timeout quando a fonte reporta e a latencia declarada — usada no ranqueamento, nao como
// verdade (o probe decide).
function parsePlain(body) {
    const itens = [];
    for (const linha of body.split("\n")) {
        const p = linha.trim();
        if (p === "" || p.startsWith("#")) continue;
        // listas "host:port" e "socks5://host:port" convivem; normaliza para o segundo.
        const proxy = p.includes("://") ? p : "socks5://" + p;
        if (parseProxy(proxy) !== null) itens.push({ proxy: proxy });
    }
    return itens;
}

function parseGeonode(body) {
    const data = JSON.parse(body);
    const list = Array.isArray(data.data) ? data.data : [];
    return list.map(entry => ({
        proxy: "socks5://" + entry.ip + ":" + entry.port,
        uptime: typeof entry.upTime === "number" ? entry.upTime : undefined,
        timeout: typeof entry.latency === "number" ? entry.latency : undefined,
        country: String(entry.country || "")
    })).filter(item => parseProxy(item.proxy) !== null);
}

function parseProxyScrape(body) {
    const data = JSON.parse(body);
    const list = Array.isArray(data.proxies) ? data.proxies : [];
    return list.map(entry => ({
        proxy: String(entry.proxy || ""),
        uptime: typeof entry.uptime === "number" ? entry.uptime : undefined,
        timeout: typeof entry.timeout === "number" ? entry.timeout : undefined,
        country: String((entry.ip_data && entry.ip_data.countryCode) || "")
    })).filter(item => item.proxy !== "" && parseProxy(item.proxy) !== null);
}

async function fetchFreeProxies() {
    // Se o usuario configurou um range multiplexado, usamos ele como nosso "pool publico" privado.
    // Isso impede que ao falhar a porta principal o app vaze para uma proxy publica aleatoria.
    const raw = settings.proxy;
    if (typeof raw === "string" && raw.trim() !== "") {
        const match = PROXY_RE.exec(raw.trim());
        if (match !== null && match[5] !== undefined) {
            const portStart = Number(match[4]);
            const portEnd = Number(match[5]);
            if (portEnd >= portStart && portEnd <= 65535) {
                const poolManual = [];
                for (let p = portStart; p <= portEnd; p++) {
                    const str = `${match[1]}://${match[2] ? match[2] + '@' : ''}${match[3]}:${p}`;
                    poolManual.push({ proxy: str, country: "BR" });
                }
                log("usando " + poolManual.length + " portas do pool multiplexado ao inves de proxies publicas");
                return poolManual;
            }
        }
    }

    const porFonte = await Promise.all(FREE_PROXY_FONTES.map(async fonte => {
        try {
            const body = await downloadText(fonte.url, FONTES_TIMEOUT_MS);
            log("fonte " + fonte.tipo + ": ok (" + body.length + " bytes)");
            if (fonte.tipo === "plain") return parsePlain(body);
            if (fonte.tipo === "geonode") return parseGeonode(body);
            return parseProxyScrape(body);
        } catch (e) {
            log("fonte " + fonte.tipo + ": falhou (" + (e && e.message ? e.message : "erro") + ")");
            return [];
        }
    }));

    // Junta as fontes e tira duplicata (primeira vence; a ordem das fontes define a
    // precedencia quando a mesma saida aparece em duas listas).
    const unicos = new Map();
    for (const itens of porFonte) {
        for (const item of itens) if (!unicos.has(item.proxy)) unicos.set(item.proxy, item);
    }
    return [...unicos.values()];
}

function rankFreeProxies(lista) {
    const base = foraDeQuarentena(lista)
        .filter(entry => entry && entry.proxy)
        .filter(entry => typeof entry.uptime !== "number" || entry.uptime >= MIN_UPTIME)
        .filter(entry => typeof entry.timeout !== "number" || entry.timeout <= MAX_LISTED_TIMEOUT)
        // A porta 4145 e quase toda de intermediario que responde por qualquer destino sem
        // encaminhar nada. Ela reprova no teste, mas so depois de gastar o prazo.
        .filter(entry => !String(entry.proxy).endsWith(":4145"))
        .filter(entry => !excludedCountries.has(String(entry.country).toUpperCase()));

    // As listas sem metadado (plain) nao tem timeout declarado: ordenar so por ele jogaria
    // ~2700 candidatas para o fim e o primeiro lote testaria apenas fontes com campo de
    // latencia — que podem estar todas mortas. Intercala mantendo a melhor de cada lado.
    const comTimeout = base.filter(e => typeof e.timeout === "number").sort((a, b) => a.timeout - b.timeout);
    const semTimeout = base.filter(e => typeof e.timeout !== "number");
    const intercalado = [];
    const fim = Math.max(comTimeout.length, semTimeout.length);
    for (let i = 0; i < fim && intercalado.length < MAX_CANDIDATES; i++) {
        if (i < comTimeout.length) intercalado.push(comTimeout[i]);
        if (i < semTimeout.length && intercalado.length < MAX_CANDIDATES) intercalado.push(semTimeout[i]);
    }

    return intercalado.map(entry => String(entry.proxy));
}

function listening(port, timeoutMs) {
    return new Promise(resolve => {
        const socket = connect({ host: "127.0.0.1", port: port });
        const finish = value => {
            socket.destroy();
            resolve(value);
        };

        socket.setTimeout(timeoutMs, () => finish(false));
        socket.on("error", () => finish(false));
        socket.once("connect", () => finish(true));
    });
}

function savePool() {
    writeJson(STATE_FILE, { pool: pool, at: Date.now() });
}

// Unica janela para o estado das saidas: chosenExit e pool sao locais deste arquivo, e sem isto
// nem o registro nem um teste conseguem dizer o que o batimento decidiu.
function poolStatus() {
    return {
        active: chosenExit,
        pool: pool.map(entry => entry.proxy),
        missed: [...missedBeats.entries()]
    };
}

async function detectTor(probeTimeoutMs) {
    // No modo "tor" o endereco vem das settings (a GUI sobe o proprio Tor). Nos outros
    // modos, comeca pelo endereco gravado nas settings e depois varre as portas
    // classicas de clientes Tor da maquina. O torAddr existe mesmo em free/auto: a
    // GUI grava a porta do Tor EMBUTIDO dela (9060) na injecao, e o fallback das
    // gratuitas (lista toda morta) precisa achar esse Tor -- varrer so as portas
    // classicas perdia um Tor vivo na 9060 e o gateway saia direto (issue #121).
    const candidatas = routeMode === "tor"
        ? [TOR_ADDR]
        : [...new Set([TOR_ADDR, ...TOR_PORTS.map(port => "127.0.0.1:" + port)])];

    // Quando o refresh chama o detectTor (Tor morreu no meio da sessao e o batimento
    // detectou), o probe do Tor pode estar em estado intermediario (SOCKS5 aceita mas
    // demora a responder) e timeoutar com 6s. O gateway fica segurado por esse tempo
    // e o Discord mostra "load infinito". O probe reduzido (3s) detecta a situacao
    // mais rapido, e o refreshExit cai para recarga antes do Discord desistir.
    const probeMs = probeTimeoutMs !== undefined ? probeTimeoutMs : PROBE_TIMEOUT_MS;
    const exitMs = probeTimeoutMs !== undefined ? Math.min(probeTimeoutMs, 4000) : 6000;

    for (const addr of candidatas) {
        const proxy = "socks5://" + addr;
        const port = Number(addr.split(":")[1] || 0);
        if (!await listening(port, TOR_PORT_TIMEOUT_MS)) continue;
        // torProbe: a prova e o TLS ate o gateway (Cloudflare recusa o HTTP de discord.com
        // vindo de exit Tor, mesmo com o circuito saudavel -- ver comentario do probe).
        if (await probe(proxy, probeMs, true) === null) {
            log("porta " + port + " esta aberta mas nao respondeu como proxy");
            continue;
        }

        // No modo "tor" a checagem de pais vem do cache (1 consulta / circuito).
        // No modo "free"/"auto" (gratuitas) ela tenta uma vez por probe; o cache aqui
        // tambem vale porque o exit do Tor nao muda com o modo de roteamento.
        const pais = await exitCountryTorCached(proxy, 6000);
        if (pais !== null && excludedCountries.has(pais)) {
            log("Tor na porta " + port + " recusado: saida em " + pais);
            continue;
        }
        log("Tor encontrado na porta " + port +
            (pais === null ? " (geo nao verificada)" : ", saida em " + pais));
        return proxy;
    }

    return null;
}

// Devolve as aprovadas da busca, sem mexer no pote nem na saida ativa: quem chama decide se
// isto e a escolha da sessao ou so reserva chegando por baixo. As aprovadas vem ORDENADAS
// pelo RTT do probe (menor primeiro): a primeira aprovada que chega costuma ser so a mais
// rapida de CHEGAR, nao a mais rapida de verdade — e colocar uma saida de 1.7s quando a
// busca tinha uma de 400ms e a propria instabilidade que derruba o gateway. Parou de cortar
// probes por lote: o prazo agora e global, e quem completa dentro dele entra na escolha.
async function huntExits() {
    let candidates;
    try {
        // Baixa as fontes juntas, junta sem duplicata e filtra/ranqueia.
        candidates = rankFreeProxies(await fetchFreeProxies());
    } catch (error) {
        log("nao consegui baixar a lista de saidas: " + error.message);
        return [];
    }

    log(candidates.length + " candidatas depois do ranqueamento");

    const prazoFinal = Date.now() + HUNT_BUSCA_TOTAL_MS;

    for (let i = 0; i < candidates.length; i += PARALLEL_PROBES) {
        const restante = prazoFinal - Date.now();
        if (restante <= 0) break;

        const batch = candidates.slice(i, i + PARALLEL_PROBES);

        // Todas as probes do lote podem completar; a escolha sai no prazo global OU quando o
        // lote terminou — o que vier primeiro. Uma aprovada que chega antes ja entra.
        const aprovadas = await new Promise(resolve => {
            const found = [];
            let pending = batch.length;
            let settled = false;
            const prazo = setTimeout(terminar, restante);

            function terminar() {
                if (settled) return;
                settled = true;
                clearTimeout(prazo);
                resolve(found);
            }

            for (const candidate of batch) {
                probeExit(candidate).then(r => {
                    if (settled) return;

                    if (r !== null && r.country !== null && !excludedCountries.has(r.country)) {
                        found.push(r);
                    } else if (r !== null) {
                        log(r.proxy + " recusada: saida em " + (r.country || "pais desconhecido"));
                    }

                    if (--pending === 0) terminar();
                });
            }
        });

        if (aprovadas.length === 0) continue;

        // Menor RTT primeiro: a ativa vira a melhor da busca, e o pool herda a mesma ordem.
        return aprovadas.sort((a, b) => a.ms - b.ms);
    }

    return [];
}

async function pickFreeExit() {
    const aprovadas = await huntExits();
    if (aprovadas.length === 0) return null;

    pool = aprovadas.slice(0, POOL_SIZE);
    log("escolhida " + pool[0].proxy + ": " + pool[0].ms + "ms, saida em " + pool[0].country);
    if (pool.length > 1) {
        log("reservas: " + pool.slice(1).map(e => e.proxy + " (" + e.ms + "ms " + e.country + ")").join(", "));
    }

    savePool();
    return pool[0].proxy;
}

// O pool esta frio quando nao ha state.json valido: ausente, corrompido, vazio ou
// fora da idade maxima. Leitura barata de proposito -- sem probe, sem quarentena --
// porque quem usa e o estouro do prazo de espera, onde cada milissegundo ja virou
// "Discord carregando". Lista publica de SOCKS5 e ruim por natureza (#95: dezenas de
// tunel.falha em sequencia), entao "pool frio" e o cenario comum de primeira abertura.
function poolFrio() {
    if (pool.length > 0) return false; // esta sessao ja achou saidas; nao e cold start
    const state = readJson(STATE_FILE, null);
    if (state === null || typeof state.at !== "number") return true;
    if (Date.now() - state.at > CACHE_MAX_AGE_MS) return true;
    const itens = Array.isArray(state.pool)
        ? state.pool.filter(e => e && typeof e.proxy === "string")
        : (typeof state.proxy === "string" ? [1] : []); // formato antigo, uma saida so
    return itens.length === 0;
}

async function cachedExit() {
    // No modo "tor" saida guardada nao vale nada: o cache so guarda gratuitas, e deixar
    // ele vencer a escolha fazia o gateway NASCER por proxy gratuita com o Tor de pe
    // (reprovado em teste: cache quente + routeMode tor -> "reaproveitando 3 de 3" e
    // saida gratuita usada sem o Tor ser consultado).
    if (routeMode === "tor") return null;
    const state = readJson(STATE_FILE, null);
    if (state === null || typeof state.at !== "number") return null;
    if (Date.now() - state.at > CACHE_MAX_AGE_MS) return null;

    // Versoes anteriores guardavam uma saida so, em state.proxy. As que estao em quarentena
    // nao sao reeleitas: quem causou sofrimento no passado recente nao volta so por estar
    // guardada.
    const guardadas = foraDeQuarentena(
        Array.isArray(state.pool)
            ? state.pool.filter(e => e && typeof e.proxy === "string")
            : (typeof state.proxy === "string" ? [{ proxy: state.proxy, ms: 0, country: "?" }] : [])
    );

    // Testadas em paralelo e escolhida a mais rapida de agora: a ordem de ontem nao vale hoje,
    // e testar uma por vez gastaria o orcamento inteiro na primeira que tivesse morrido.
    const vivas = (await Promise.all(guardadas.map(async e => {
        const r = await probe(e.proxy, 2500);
        return r === null ? null : { proxy: e.proxy, ms: r.ms, country: e.country };
    }))).filter(Boolean).sort((a, b) => a.ms - b.ms);

    if (vivas.length === 0) return null;

    pool = vivas;
    log("reaproveitando " + vivas.length + " de " + guardadas.length + " saidas guardadas, a melhor com " + vivas[0].ms + "ms");
    return vivas[0].proxy;
}

async function chooseExit() {
    const manual = manualProxy();
    if (manual === null) {
        log("o endereco em proxy nao e valido; ignorando e usando somente Tor local");
    } else if (manual !== "") {
        // Proxy personalizada e uma decisao explicita de confianca. Usa na hora para o
        // gateway nascer roteado; o probe em segundo plano so produz diagnostico.
        log("usando a saida que voce configurou: " + safeProxy(manual));
        probe(manual, 2500).then(ok => {
            if (ok === null) {
                log("a saida que voce configurou nao respondeu ao probe em segundo plano: " + safeProxy(manual));
                manualProxyFalhasSeguidas++;
                if (manualProxyFalhasSeguidas >= MANUAL_PROXY_AVISO_LIMITE) showManualProxyFailedBanner();
            } else {
                manualProxyFalhasSeguidas = 0;
            }
        });
        return manual;
    }

    // Nao consulta state.json/pool: ele pode conter saidas publicas de versoes antigas.
    const tor = await detectTor();
    if (tor !== null) return tor;
    log("enhanced: nenhum Tor respondeu em " + TOR_ADDR + "; nenhuma proxy publica sera usada");
    return null;
}

let lastExitAt = 0; // quando a saida atual foi escolhida (para o log do gateway visto)

function settleExit(proxy) {
    chosenExit = proxy;
    exitSettled = true;
    if (proxy !== null) lastExitAt = Date.now();
    while (waitingForExit.length > 0) waitingForExit.shift()(proxy);

    // Saida real depois de um arranque frio em modo tor: some com o aviso e recarrega a
    // janela na hora, em vez de esperar o Discord perceber sozinho que pode tentar de novo
    // (o backoff dele nao e nosso e pode demorar bem mais que isto). Guarda antes de
    // maybeReloadAfterDirect de proposito: sao sinais diferentes (seguro vs vazou), e o
    // primeiro nunca chega a marcar gatewayWentDirectAt (modo tor nunca vaza).
    if (proxy !== null && coldTorHoldSince !== 0) {
        coldTorHoldSince = 0;
        hideTorBootBanner();
        maybeReloadAfterColdHold();
    }

    // Saida nova no ar e o gateway tinha saido direto ha pouco: esta sessao nasceu bloqueada
    // e so um reload faz o gateway renascer atras da saida. Avalia (com todas as guardas).
    if (proxy !== null && gatewayWentDirectAt !== 0) {
        maybeReloadAfterDirect();
    }
}

// ------------------------------------------------------------------ recarga pos-gateway-direto

function clientWindow() {
    const janelas = janelasCliente();
    return janelas.length > 0 ? janelas[0] : null;
}

// TODAS as janelas do cliente (a #154 passou 3 minutos sem probe: o poll pode
// cair numa janela sem o shim enquanto a janela viva tem outro webContents).
function janelasCliente() {
    const achadas = [];
    for (const win of require("electron").BrowserWindow.getAllWindows()) {
        if (win.isDestroyed()) continue;
        try {
            if (CLIENT_URL_RE.test(win.webContents.getURL())) achadas.push(win);
        } catch {
            // janela morrendo
        }
    }
    return achadas;
}

// Reservas vivas no pool (excluindo a ativa). A recarga depende disto: renascer o gateway
// com o pool de 1 so deixava a sessao vulneravel a morte da ativa no renascimento (o caso
// do ciclo 7 do teste de estresse — 8s de "carregando" sem reserva para assumir).
const RELOAD_MIN_RESERVES = 1;
const RELOAD_RESERVE_WAIT_MS = 10_000;

function liveReserveCount() {
    return pool.filter(entry => entry.proxy !== chosenExit).length;
}

function maybeReloadAfterDirect() {
    // Sinal expirado: o gateway direto foi ha tempo demais, a sessao pode ter se recuperado.
    if (Date.now() - gatewayWentDirectAt > DIRECT_SIGNAL_TTL_MS) {
        gatewayWentDirectAt = 0;
        return;
    }
    if (reloading || reloadCount >= RELOAD_MAX_RETRIES) return;
    if (Date.now() - lastReloadAt < RELOAD_COOLDOWN_MS) return;

    const exit = chosenExit;
    if (exit === null) return;

    reloading = true;
    // A saida tem que estar comprovadamente entregando AGORA: recarregar com saida morta
    // repetiria a mesma falha e gastaria uma tentativa a toa.
    probe(exit, 2500).then(ok => {
        if (ok === null) {
            log("saida " + safeProxy(exit) + " nao respondeu, adiando a recarga");
            return;
        }

        // NAO cancela por roteado recente: a reconexao roteada depois da corrida perdida nao
        // desbloqueia a sessao (o veredito foi no CONNECTION_OPEN original, direto). So a
        // recarga da janela faz o gateway renascer atras da saida de verdade.

        // Espera por reserva viva (ate RELOAD_RESERVE_WAIT_MS): o renascimento pos-recarga
        // precisa de uma reserva para assumir na hora se a ativa morrer (o caso raro do ciclo
        // 7). Se o pool ja tem, segue direto. Se o gateway rotear no meio (corrida ganha),
        // cancela — a recarga nao e mais necessaria.
        ensureReserveThenReload(exit);
    }).catch(error => {
        log("a checagem antes da recarga falhou: " + error.message);
    }).finally(() => {
        reloading = false;
    });
}

function ensureReserveThenReload(exit) {
    const tryReload = () => {
        // Cancela se a sessao se resolveu sozinha (gateway passou pela saida).
        if (Date.now() - lastRoutedAt < 3000) {
            log("gateway ja passou pela saida, recarga desnecessaria");
            gatewayWentDirectAt = 0;
            return;
        }
        const win = clientWindow();
        if (win === null) {
            log("nao achei a janela do cliente Discord para recarregar");
            return;
        }
        reloadCount++;
        lastReloadAt = Date.now();
        gatewayWentDirectAt = 0; // so recarrega uma vez por sinal
        log("o gateway tinha saido direto, recarregando atras de " + safeProxy(exit) + " (tentativa " + reloadCount + " de " + RELOAD_MAX_RETRIES + ")");
        win.webContents.reload();
    };

    // Enhanced nao estoca terceiros. Tor/proxy explicita recarregam sem exigir reserva publica.
    if (routeMode === "tor" || usingManualProxy) return tryReload();
    if (liveReserveCount() >= RELOAD_MIN_RESERVES) return tryReload();

    // Sem reserva: busca em background e espera um pouco. A sessao ja esta bloqueada, entao
    // esperar nao piora; recarregar vulneravel deixaria o renascimento a merce da ativa.
    log("sem reserva viva, enchendo o pote antes de recarregar");
    stockReserves(liveReserveCount());

    const deadline = Date.now() + RELOAD_RESERVE_WAIT_MS;
    const poll = setInterval(() => {
        if (Date.now() - lastRoutedAt < 3000) {
            clearInterval(poll);
            log("gateway ja passou pela saida, recarga desnecessaria");
            gatewayWentDirectAt = 0;
            return;
        }
        if (liveReserveCount() >= RELOAD_MIN_RESERVES) {
            clearInterval(poll);
            log("reserva disponivel, recarregando agora");
            tryReload();
            return;
        }
        if (Date.now() >= deadline) {
            clearInterval(poll);
            // Prazo estourado: recarrega mesmo sem reserva — a sessao ja esta bloqueada, e
            // segurar mais so prolonga o "carregando". O refresh runtime cobre a morte.
            log("prazo de reserva estourado, recarregando mesmo assim");
            tryReload();
        }
    }, 2000);
}

// A sessao voltou a nascer roteada (conexao de gateway passou pela saida): reseta o teto de
// recargas — e o sinal de que a ultima recarga (se houve) funcionou.
let lastRoutedAt = 0;
// A saida ativa entregou trafego de gateway recentemente (isto e o probe mais fiel possivel:
// o proprio gateway esta vivo por ela). O batimento usa isto para NAO abrir uma conexao de
// probe na ativa a cada 30s — saida gratuita limita conexoes simultaneas, e o probe extra
// concorre com a conexao do gateway e pode derruba-la. A morte real da ativa aparece no
// trafego vivo (openThroughPool), nao precisa do probe para ser percebida.
let ativaEntregouEm = 0;
// Quantas vezes o gateway nasceu roteado nesta execucao. A primeira e so a abertura normal;
// da segunda em diante e uma RECONEXAO de verdade no meio da sessao (confirmado ao vivo em
// 2026-08-23, com CDP: mesmo uma troca limpa, sem vazar direto, sem trocar de saida visivel,
// trava o video do Go Live so-audio — o motor de voz/video do Discord e WASM fechado, entao
// nao da pra restartar so o stream por fora sem mexer no binario. O que da pra fazer com
// seguranca e avisar: a pessoa decide se vale reiniciar (Ctrl+R sai da call) ou nao.
let gatewayConnCount = 0;

// Quando vimos um websocket de voz/video pela ultima vez. O aviso de reconexao so faz sentido
// com chamada ou transmissao em andamento: fora disso a reconexao do gateway nao quebra nada
// visivel, e avisar so assustaria -- ainda por cima sugerindo um Ctrl+R que derruba a call.
//
// Esta marca so ATUALIZA quando um websocket de midia NOVO abre (entrar numa call, ligar a
// camera) -- uma call ja em andamento, sem novo handshake, nao a renova. Numa call longa e
// estavel (comum: streams/reunioes de dezenas de minutos) o timestamp fica parado desde a
// entrada. Por isso a janela e generosa (20min, nao 5): um valor curto classificaria uma
// call longa como "sem midia" e o autoReloadForCleanEngine recarregaria a janela NO MEIO da
// chamada, exatamente o dano que esta guarda existe para evitar. Vinte minutos nao elimina o
// risco para calls mais longas que isso (o projeto nao inspeciona o payload do gateway para
// saber se a call segue de pe -- so os hosts de handshake, por design), mas reduz bastante a
// janela de perigo sem custar nada em troca (o pior caso sem isto e so o banner manual, que
// ja e o comportamento seguro de antes desta funcao existir).
let ultimaMidiaEm = 0;
const MIDIA_RECENTE_MS = 20 * 60_000;

// Um Ctrl+R (ou a nossa propria recarga) comeca uma sessao NOVA: o gateway que nascer depois
// dela e o primeiro dela, nao uma reconexao no meio de nada. Sem zerar aqui, o aviso voltava
// justamente para quem seguiu o conselho dele -- recarregou por causa do aviso e levou o mesmo
// aviso de novo, agora sem motivo.
function watchReloads() {
    const electron = require("electron");
    electron.app.on("browser-window-created", (_evento, win) => {
        win.webContents.on("did-start-loading", () => {
            // A URL ainda e a de antes quando a recarga comeca: se era a do cliente, isto e um
            // reload de verdade, e nao a splash abrindo.
            let url = "";
            try {
                url = win.webContents.getURL();
            } catch {
                return; // janela morrendo
            }
            if (!CLIENT_URL_RE.test(url)) return;
            if (gatewayConnCount === 0) return;

            log("a janela do Discord recarregou: contagem de reconexao zerada");
            gatewayConnCount = 0;
            // Reload = sessao nova de verdade: o estado do zumbi/revive expira junto
            // (o banner era DOM do documento antigo e ja morreu com ele).
            zumbiBannerAtivo = false;
            zumbiTentativaEm.length = 0;
            zumbiUltimaAcaoEm = 0;
            zumbiUltimaAcao = null;
            revivePendenteEm = 0;
            reviveFecharEm = 0;
        });
    });
}

// Telemetria de sessao para o log: contagens acumuladas (a rotacao do arquivo
// apaga historia — uma linha resumida a cada janela preserva o quadro geral).
let sessaoRoteadas = 0;
let sessaoDiretas = 0;
let sessaoReloads = 0;
let sessaoRevives = 0;      // acoes da escada de revive (close 4000 + reloads por zumbi)
let ultimoVistoAt = 0;      // quando o gateway foi visto pela ultima vez (gw.visto)
let ultimoRoteadoAt = 0;    // quando o gateway roteou pela ultima vez (gw.roteado)
let sessaoInicio = Date.now();
let estatTimer = null;

function emitirEstat() {
    estatTimer = null;
    log("estat.sessao | uptime=" + Math.round((Date.now() - sessaoInicio) / 1000) + "s" +
        " roteadas=" + sessaoRoteadas + " diretas=" + sessaoDiretas +
        " reloads=" + sessaoReloads +
        " revives=" + sessaoRevives +
        " reconexoes_janela=" + (typeof gatewayReconexoes !== "undefined" ? gatewayReconexoes.length : "?") +
        " saida_atual=" + (chosenExit === null ? "nenhuma" : safeProxy(chosenExit)));
}
function agendarEstat() {
    if (estatTimer === null) {
        estatTimer = setTimeout(emitirEstat, 180_000);
    }
}

// === voice shim: inicio ===
// O Discord desktop atual nao usa window.RTCPeerConnection para a call/Go Live:
// as conexoes reais nascem no addon discord_voice. A beta 10 envolvia a API do
// Chromium e, por isso, reportava pcs=0 durante uma Live nativa saudavel. Este
// shim entra antes do bundle, envolve o carregamento do addon sem mudar seus
// argumentos/retornos e expoe somente forma + contadores sanitizados. A decisao
// de recuperacao fica no main; formato desconhecido nunca vira acao.
function instalarVoiceShim() {
    if (window.__goliveVoiceShim) return;

    var state = {
        installed: false,
        voiceHooked: false,
        instanceId: Date.now(),
        nextId: 1,
        connections: [],
        seen: new WeakMap(),
        modules: new WeakSet(),
        demandKnown: false,
        demandActive: false,
        demandAt: 0,
        demandChangedAt: 0,
        retry: 0,
    };
    window.__goliveVoiceShim = state;

    function safeKey(key) {
        key = String(key);
        if (/^[0-9]{10,}$/.test(key)) return '<numeric>';
        if (/^[A-Za-z_$][A-Za-z0-9_$-]{0,63}$/.test(key)) return key;
        return '<dynamic>';
    }

    function shape(value, depth, seen) {
        if (value === null) return 'null';
        if (value === undefined) return 'undefined';
        if (depth > 4) return typeof value;
        if (Array.isArray(value)) return { type: 'array', length: value.length };
        if (typeof value !== 'object') return typeof value;
        if (seen.has(value)) return 'circular';
        seen.add(value);
        var out = {};
        var keys;
        try { keys = Object.keys(value).slice(0, 160); } catch (e) { return 'inacessivel'; }
        for (var i = 0; i < keys.length; i++) {
            var key = keys[i];
            var cleanKey = safeKey(key);
            var child;
            try { child = value[key]; } catch (e) { out[cleanKey] = 'getter-error'; continue; }
            out[cleanKey] = shape(child, depth + 1, seen);
        }
        return out;
    }

    function finite(value) {
        return typeof value === 'number' && Number.isFinite(value) ? value : null;
    }

    // O discord_voice 0.0.84 manteve getStats no wrapper JS, mas removeu o
    // metodo correspondente do objeto nativo. A API viva e
    // getFilteredStats(2, callback): o filtro 2 devolve outbound + screenshare.
    // Normalizamos so campos confirmados; nenhuma string/SSRC sai do preload.
    function normalizeStats(raw) {
        var parsed = raw;
        try {
            if (typeof parsed === 'string') parsed = JSON.parse(parsed);
        } catch (e) {
            return { ok: false, reason: 'json', shape: 'string' };
        }
        if (!parsed || typeof parsed !== 'object') {
            return { ok: false, reason: 'formato', shape: shape(parsed, 0, new WeakSet()) };
        }

        var outbound = parsed.outbound;
        var video = outbound && outbound.video;
        if ((!video || typeof video !== 'object') && outbound && Array.isArray(outbound.videos)) {
            for (var vi = 0; vi < outbound.videos.length; vi++) {
                var candidate = outbound.videos[vi];
                if (!candidate || typeof candidate !== 'object') continue;
                if (!video || (finite(candidate.framesEncoded) || 0) > (finite(video.framesEncoded) || 0)) video = candidate;
            }
        }

        var screenshare = parsed.screenshare;
        var captureFrames = null;
        if (screenshare && typeof screenshare === 'object') {
            var captureTotal = 0;
            var captureFound = false;
            var captureKeys;
            try { captureKeys = Object.keys(screenshare); } catch (e) { captureKeys = []; }
            for (var ci = 0; ci < captureKeys.length; ci++) {
                var captureKey = captureKeys[ci];
                if (!/frames$/i.test(captureKey) || /(drop|fail|encode|sent|receive)/i.test(captureKey)) continue;
                var captureValue = finite(screenshare[captureKey]);
                if (captureValue === null) continue;
                captureTotal += captureValue;
                captureFound = true;
            }
            if (captureFound) captureFrames = captureTotal;
        }

        var inputFrameRate = video && typeof video === 'object' ? finite(video.inputFrameRate) : null;
        var framesEncoded = video && typeof video === 'object' ? finite(video.framesEncoded) : null;
        var encodeFrameRate = video && typeof video === 'object' ? finite(video.encodeFrameRate) : null;
        var broadcasterReady = (captureFrames !== null || inputFrameRate !== null) &&
            framesEncoded !== null && encodeFrameRate !== null;

        function decoderNode(value, depth) {
            if (!value || typeof value !== 'object' || depth > 5) return null;
            var decoded = finite(value.framesDecoded);
            var rate = finite(value.decodeFrameRate);
            if (rate === null) rate = finite(value.decodedFrameRate);
            if (rate === null) rate = finite(value.decodeFps);
            if (rate === null) rate = finite(value.framesPerSecond);
            var received = finite(value.framesReceived);
            if (decoded !== null || rate !== null) {
                return {
                    framesDecoded: decoded,
                    decodeFrameRate: rate,
                    framesReceived: received,
                };
            }
            var keys;
            try { keys = Object.keys(value).slice(0, 120); } catch (e) { return null; }
            for (var di = 0; di < keys.length; di++) {
                var key = keys[di];
                if (depth > 1 && !/(inbound|video|receiver|decode|remote|rtp)/i.test(key)) continue;
                var child;
                try { child = value[key]; } catch (e) { continue; }
                if (Array.isArray(child)) {
                    for (var ai = 0; ai < child.length; ai++) {
                        var fromArray = decoderNode(child[ai], depth + 1);
                        if (fromArray) return fromArray;
                    }
                } else {
                    var nested = decoderNode(child, depth + 1);
                    if (nested) return nested;
                }
            }
            return null;
        }

        var decodedVideo = decoderNode(parsed.inbound || parsed, 0);
        var framesDecoded = decodedVideo ? decodedVideo.framesDecoded : null;
        var decodeFrameRate = decodedVideo ? decodedVideo.decodeFrameRate : null;
        var framesReceived = decodedVideo ? decodedVideo.framesReceived : null;
        var viewerReady = framesDecoded !== null && decodeFrameRate !== null;

        if (!broadcasterReady && !viewerReady) {
            return { ok: false, reason: 'campos', shape: shape(parsed, 0, new WeakSet()) };
        }
        return {
            ok: true,
            broadcasterReady: broadcasterReady,
            viewerReady: viewerReady,
            captureFrames: captureFrames,
            inputFrameRate: inputFrameRate,
            framesEncoded: framesEncoded,
            encodeFrameRate: encodeFrameRate,
            mediaBitrate: video && typeof video === 'object' ? finite(video.mediaBitrate) : null,
            targetMediaBitrate: video && typeof video === 'object' ? finite(video.targetMediaBitrate) : null,
            width: video && Array.isArray(video.substreams) && video.substreams[0] ? finite(video.substreams[0].width) : null,
            height: video && Array.isArray(video.substreams) && video.substreams[0] ? finite(video.substreams[0].height) : null,
            suspended: !!(video && video.suspended === true),
            framesDecoded: framesDecoded,
            decodeFrameRate: decodeFrameRate,
            framesReceived: framesReceived,
            videoExpected: viewerReady,
        };
    }

    function connectionRoleHint(rec) {
        if (!rec || !rec.conn || rec.kind !== 'stream') return 'unknown';
        if (rec.sourceReplay) return 'broadcaster';
        try { if (typeof rec.conn.hasDesktopSource === 'function' && rec.conn.hasDesktopSource() === true) return 'broadcaster'; } catch (e) { }
        try {
            var local = rec.conn.userId;
            var remote = rec.conn.streamUserId;
            if (typeof remote === 'string' && remote.length > 0 && typeof local === 'string' && local.length > 0) {
                return remote === local ? 'broadcaster' : 'viewer';
            }
        } catch (e) { }
        return 'unknown';
    }

    function updateProgress(rec, stats) {
        var now = Date.now();
        var role = connectionRoleHint(rec);
        if (role === 'unknown') {
            if (stats.broadcasterReady && !stats.viewerReady) role = 'broadcaster';
            else if (stats.viewerReady && !stats.broadcasterReady) role = 'viewer';
        }
        rec.lastRole = role;
        if (!rec.progress) {
            rec.progress = {
                inputValue: stats.captureFrames,
                outputValue: stats.framesEncoded,
                decodedValue: stats.framesDecoded,
                inputAt: now,
                outputAt: now,
                decodedAt: now,
            };
        } else {
            if ((stats.captureFrames !== null && stats.captureFrames !== rec.progress.inputValue) ||
                (stats.inputFrameRate !== null && stats.inputFrameRate > 0)) rec.progress.inputAt = now;
            if ((stats.framesEncoded !== null && stats.framesEncoded !== rec.progress.outputValue) ||
                (stats.encodeFrameRate !== null && stats.encodeFrameRate > 0)) rec.progress.outputAt = now;
            if ((stats.framesDecoded !== null && stats.framesDecoded !== rec.progress.decodedValue) ||
                (stats.decodeFrameRate !== null && stats.decodeFrameRate > 0)) rec.progress.decodedAt = now;
            rec.progress.inputValue = stats.captureFrames;
            rec.progress.outputValue = stats.framesEncoded;
            rec.progress.decodedValue = stats.framesDecoded;
        }
        var relevantOk = role === 'broadcaster' ? stats.broadcasterReady :
            (role === 'viewer' ? stats.viewerReady : false);
        return {
            statsOk: relevantOk,
            role: role,
            captureFrames: stats.captureFrames,
            framesEncoded: stats.framesEncoded,
            inputFrameRate: stats.inputFrameRate,
            encodeFrameRate: stats.encodeFrameRate,
            mediaBitrate: stats.mediaBitrate,
            targetMediaBitrate: stats.targetMediaBitrate,
            width: stats.width,
            height: stats.height,
            suspended: stats.suspended,
            entradaHa: role === 'broadcaster' ? now - rec.progress.inputAt : -1,
            saidaHa: role === 'broadcaster' ? now - rec.progress.outputAt : -1,
            framesDecoded: stats.framesDecoded,
            decodeFrameRate: stats.decodeFrameRate,
            framesReceived: stats.framesReceived,
            decodeHa: role === 'viewer' ? now - rec.progress.decodedAt : -1,
            videoExpected: role === 'viewer' ? stats.videoExpected === true : false,
            sampleHa: 0,
        };
    }

    function registerConnection(kind, creator, options, conn) {
        if (!conn || (typeof conn !== 'object' && typeof conn !== 'function')) return conn;
        var existing = state.seen.get(conn);
        if (existing) {
            if (kind === 'stream') existing.kind = 'stream';
            return conn;
        }
        var rec = {
            id: state.nextId++,
            kind: kind,
            creator: creator,
            createdAt: Date.now(),
            destroyedAt: 0,
            optionShape: shape(options, 0, new WeakSet()),
            conn: conn,
            sourceReplay: null,
            replayingSource: false,
            recoveryClearingSource: false,
            lastRole: 'unknown',
        };
        state.seen.set(conn, rec);
        state.connections.push(rec);
        if (state.connections.length > 24) state.connections.shift();
        try {
            if (typeof conn.destroy === 'function') {
                var originalDestroy = conn.destroy;
                conn.destroy = function () {
                    rec.destroyedAt = Date.now();
                    rec.sourceReplay = null;
                    return originalDestroy.apply(this, arguments);
                };
            }
        } catch (e) { }

        if (kind === 'stream') {
            ['setDesktopSource', 'setDesktopSourceWithOptions'].forEach(function (name) {
                try {
                    var original = conn[name];
                    if (typeof original !== 'function') return;
                    conn[name] = function () {
                        if (!rec.replayingSource) {
                            rec.sourceReplay = { name: name, args: Array.prototype.slice.call(arguments) };
                        }
                        return original.apply(this, arguments);
                    };
                } catch (e) { }
            });
            try {
                var originalClear = conn.clearDesktopSource;
                if (typeof originalClear === 'function') {
                    conn.clearDesktopSource = function () {
                        if (!rec.recoveryClearingSource) rec.sourceReplay = null;
                        return originalClear.apply(this, arguments);
                    };
                }
            } catch (e) { }
        }
        return conn;
    }

    function hookVoice(voice) {
        if (!voice || (typeof voice !== 'object' && typeof voice !== 'function')) return voice;
        if (state.modules.has(voice)) return voice;
        state.modules.add(voice);
        var creators = [
            ['createVoiceConnectionWithOptions', 'voice'],
            ['createOwnStreamConnectionWithOptions', 'stream'],
        ];
        for (var i = 0; i < creators.length; i++) {
            (function (name, kind) {
                var original;
                try { original = voice[name]; } catch (e) { return; }
                if (typeof original !== 'function') return;
                voice[name] = function () {
                    state.pendingKind = kind;
                    var conn;
                    try { conn = original.apply(this, arguments); }
                    finally { state.pendingKind = null; }
                    return registerConnection(kind, name, arguments[1], conn);
                };
            })(creators[i][0], creators[i][1]);
        }
        // Backup para clientes que guardaram a referencia do factory antes do
        // nosso hook: o factory do index.js consulta VoiceEngine.VoiceConnection
        // dinamicamente ao criar uma conexao nova. Quando a chamada veio por um
        // factory ja envolvido, pendingKind evita registrar o objeto nativo e o
        // wrapper publico duas vezes; o retorno publico e registrado logo acima.
        try {
            var OriginalVoiceConnection = voice.VoiceConnection;
            if (typeof OriginalVoiceConnection === 'function') {
                function GoliveVoiceConnection() {
                    var args = Array.prototype.slice.call(arguments);
                    var instance = Reflect.construct(OriginalVoiceConnection, args, OriginalVoiceConnection);
                    if (!state.pendingKind) registerConnection('unknown', 'VoiceConnection', args[1], instance);
                    return instance;
                }
                Object.setPrototypeOf(GoliveVoiceConnection, OriginalVoiceConnection);
                GoliveVoiceConnection.prototype = OriginalVoiceConnection.prototype;
                voice.VoiceConnection = GoliveVoiceConnection;
            }
        } catch (e) { }
        state.voiceHooked = true;
        return voice;
    }

    function installNativeHook() {
        if (state.installed) return;
        var nativeModules;
        try { nativeModules = window.DiscordNative && window.DiscordNative.nativeModules; } catch (e) { }
        if (!nativeModules || typeof nativeModules.requireModule !== 'function') {
            if (state.retry++ < 200) setTimeout(installNativeHook, 25);
            return;
        }
        try {
            var originalRequire = nativeModules.requireModule;
            nativeModules.requireModule = function () {
                var loaded = originalRequire.apply(this, arguments);
                if (arguments[0] === 'discord_voice') return hookVoice(loaded);
                return loaded;
            };
            state.installed = true;
            // O preload original do Discord pode ter exigido o addon antes dos
            // preloads de sessao. Buscar o modulo aqui devolve a instancia em
            // cache e permite envolve-la antes de a interface criar a call.
            try { hookVoice(originalRequire.call(nativeModules, 'discord_voice')); } catch (e) { }
        } catch (e) {
            state.installed = false;
        }
    }

    function noteDemand(args) {
        try {
            var joined = Array.prototype.map.call(args, function (value) {
                return typeof value === 'string' ? value : '';
            }).join(' ');
            var marker = 'Remote media sink wants:';
            var at = joined.indexOf(marker);
            if (at < 0) return;
            var payload = JSON.parse(joined.slice(at + marker.length).trim());
            var positive = false;
            function walk(value) {
                if (positive || value === null || value === undefined) return;
                if (typeof value === 'number') { if (value > 0) positive = true; return; }
                if (typeof value === 'object') {
                    var values = Object.values(value);
                    for (var i = 0; i < values.length; i++) walk(values[i]);
                }
            }
            walk(payload && payload.pixelCounts);
            if (!positive && payload && typeof payload === 'object') {
                var entries = Object.entries(payload);
                for (var i = 0; i < entries.length; i++) {
                    var key = entries[i][0], value = entries[i][1];
                    if (key !== 'any' && key !== 'pixelCounts' && typeof value === 'number' && value > 0) positive = true;
                }
            }
            var now = Date.now();
            if (!state.demandKnown || state.demandActive !== positive) state.demandChangedAt = now;
            state.demandKnown = true;
            state.demandActive = positive;
            if (positive) state.demandAt = now;
        } catch (e) { }
    }

    ['log', 'info', 'debug'].forEach(function (method) {
        try {
            var original = console[method];
            if (typeof original !== 'function') return;
            console[method] = function () {
                noteDemand(arguments);
                return original.apply(this, arguments);
            };
        } catch (e) { }
    });

    function sample(rec) {
        return new Promise(function (resolve) {
            if (rec.destroyedAt > 0 || !rec.conn) return resolve({ statsOk: false, reason: 'destruida' });
            if (rec.kind !== 'stream') return resolve({ statsOk: false, reason: 'tipo' });
            if (typeof rec.conn.getFilteredStats !== 'function') {
                return resolve({ statsOk: false, reason: 'sem-metodo' });
            }
            var hint = connectionRoleHint(rec);
            var filters = hint === 'viewer' ? [1, 0, 2] : (hint === 'broadcaster' ? [2] : [2, 1, 0]);
            var done = false;
            var lastFailure = { statsOk: false, reason: 'campos' };

            function finish(value) {
                if (done) return;
                done = true;
                resolve(value);
            }

            function attempt(index) {
                if (done) return;
                if (index >= filters.length) return finish(lastFailure);
                var settled = false;
                var timer = setTimeout(function () {
                    if (settled || done) return;
                    settled = true;
                    attempt(index + 1);
                }, 800);
                function receive(raw) {
                    if (settled || done) return;
                    settled = true;
                    clearTimeout(timer);
                    var normalized = normalizeStats(raw);
                    if (normalized.ok) return finish(updateProgress(rec, normalized));
                    lastFailure = { statsOk: false, reason: normalized.reason, statsShape: normalized.shape };
                    attempt(index + 1);
                }
                try {
                    var returned = rec.conn.getFilteredStats(filters[index], function (raw) { receive(raw); });
                    if (returned && typeof returned.then === 'function') returned.then(receive, function () { attempt(index + 1); });
                } catch (e) {
                    clearTimeout(timer);
                    settled = true;
                    attempt(index + 1);
                }
            }
            attempt(0);
        });
    }

    window.__goliveVoiceDemandaResumo = function () {
        var now = Date.now();
        return {
            known: state.demandKnown,
            active: state.demandActive,
            demandHa: state.demandAt > 0 ? now - state.demandAt : -1,
            changedHa: state.demandChangedAt > 0 ? now - state.demandChangedAt : -1,
        };
    };

    window.__goliveVoiceResumo = function () {
        var now = Date.now();
        return Promise.all(state.connections.map(function (rec) {
            return sample(rec).then(function (sampled) {
                return {
                    id: rec.id,
                    kind: rec.kind,
                    creator: rec.creator,
                    createdHa: now - rec.createdAt,
                    destroyed: rec.destroyedAt > 0,
                    optionShape: rec.optionShape,
                    stats: sampled,
                };
            });
        })).then(function (connections) {
            return {
                installed: state.installed,
                voiceHooked: state.voiceHooked,
                instanceId: state.instanceId,
                demandKnown: state.demandKnown,
                demandActive: state.demandActive,
                demandHa: state.demandAt > 0 ? Date.now() - state.demandAt : -1,
                connections: connections,
            };
        });
    };

    // A decisao e feita no main. O preload executa apenas a acao segura
    // correspondente ao papel sanitizado da stream; IDs e argumentos ficam no closure.
    window.__goliveVoiceRecuperar = function (level) {
        if (level !== 1 && level !== 2) return { ok: false, level: 0, role: 'unknown', action: 'invalid-level' };
        var latestStream = null;
        for (var i = state.connections.length - 1; i >= 0; i--) {
            var rec = state.connections[i];
            if (!rec || rec.destroyedAt || !rec.conn || rec.kind !== 'stream') continue;
            latestStream = rec;
            break;
        }
        if (!latestStream) return { ok: false, level: level, role: 'unknown', action: 'no-stream' };
        var role = latestStream.lastRole || connectionRoleHint(latestStream);
        if (role === 'unknown') role = connectionRoleHint(latestStream);

        if (role === 'broadcaster') {
            var replay = latestStream.sourceReplay;
            if (!replay || typeof latestStream.conn[replay.name] !== 'function') {
                return { ok: false, level: level, role: role, action: 'source-unavailable' };
            }
            if (level === 1) {
                try {
                    latestStream.replayingSource = true;
                    latestStream.conn[replay.name].apply(latestStream.conn, replay.args);
                    return { ok: true, level: level, role: role, action: 'desktop-source-reapply' };
                } catch (e) {
                    return { ok: false, level: level, role: role, action: 'desktop-source-reapply-failed' };
                } finally {
                    latestStream.replayingSource = false;
                }
            }
            if (typeof latestStream.conn.clearDesktopSource !== 'function') {
                return { ok: false, level: level, role: role, action: 'source-clear-unavailable' };
            }
            try {
                latestStream.recoveryClearingSource = true;
                latestStream.conn.clearDesktopSource();
            } catch (e) {
                latestStream.recoveryClearingSource = false;
                return { ok: false, level: level, role: role, action: 'desktop-source-clear-failed' };
            }
            latestStream.recoveryClearingSource = false;
            setTimeout(function () {
                if (latestStream.destroyedAt || !latestStream.sourceReplay) return;
                try {
                    latestStream.replayingSource = true;
                    latestStream.conn[replay.name].apply(latestStream.conn, replay.args);
                } catch (e) { }
                finally { latestStream.replayingSource = false; }
            }, 200);
            return { ok: true, level: level, role: role, action: 'desktop-source-clear-reapply' };
        }

        if (role === 'viewer') {
            if (level === 1) {
                try {
                    if (typeof latestStream.conn.fastUdpReconnect !== 'function') {
                        return { ok: false, level: level, role: role, action: 'fast-udp-unavailable' };
                    }
                    latestStream.conn.fastUdpReconnect();
                    return { ok: true, level: level, role: role, action: 'viewer-fast-udp-reconnect' };
                } catch (e) {
                    return { ok: false, level: level, role: role, action: 'viewer-fast-udp-failed' };
                }
            }
            var remoteUser = null;
            try { remoteUser = latestStream.conn.streamUserId; } catch (e) { }
            if (typeof remoteUser !== 'string' || remoteUser.length === 0 ||
                typeof latestStream.conn.setLocalVideoDisabled !== 'function') {
                return { ok: false, level: level, role: role, action: 'viewer-resubscribe-unavailable' };
            }
            try {
                latestStream.conn.setLocalVideoDisabled(remoteUser, true);
                if (typeof latestStream.conn.fastUdpReconnect === 'function') latestStream.conn.fastUdpReconnect();
                setTimeout(function () {
                    if (latestStream.destroyedAt) return;
                    try { latestStream.conn.setLocalVideoDisabled(remoteUser, false); } catch (e) { }
                }, 200);
                return { ok: true, level: level, role: role, action: 'viewer-video-resubscribe' };
            } catch (e) {
                return { ok: false, level: level, role: role, action: 'viewer-resubscribe-failed' };
            }
        }
        return { ok: false, level: level, role: role, action: 'unknown-role' };
    };

    installNativeHook();
}
const SHIM_VOICE_SRC = '(' + instalarVoiceShim.toString() + ')();';
// === voice shim: fim ===

// === gateway: probe no renderer + pill + REVIVE automatico (issues #145/#149/#153) ===
// A beta.3 provou com logs (issues #149/#150) que o zumbi de aplicacao e
// INVISIVEL para a rede: durante os vaos (416s e 713s) o tunel seguiu carregando
// heartbeats — sessao protocolarmente viva, dados nao fluem. A #153 trouxe o
// ground truth do probe: ws aberta, heartbeats dos DOIS lados (srv_ha=1s,
// cli_ha=0s) e o usuario em loading infinito — o servidor ACEITA heartbeat mas
// nao entrega dispatch. Com o shim descomprimindo o servidor (DecompressionStream
// no renderer), dispatch deixou de ser indistinguivel de heartbeat e o caso
// "protocolo vivo, dados mortos" virou DETECTAVEL. Consequencias do desenho:
// 1. A cura SEM reload existe: fechar o ws com close(4000) — o mesmo codigo que o
//    proprio cliente usa ao receber op 7 (RECONNECT) — faz ele renascer sozinho
//    com RESUME, sem Ctrl+R. __goliveGwFechar() expoe isso ao main.
// 2. A escada de revive e automatica mas conservadora: nivel 1 = close 4000;
//    nivel 2 = reload (a cura que sempre funciona). NUNCA com midia aberta ou
//    recente (regra de MIDIA_RECENTE_MS/§6 — reconexao de gateway mata o video
//    da live). Teto de tentativas e cooldown; estourou, volta a ser ambiental
//    (banner + pill, decisao do usuario).
// 3. O alarme "silente" segue re-escopado: servidor INTEIRO calado (>3min sem
//    nenhum frame, nem ACK) e morte de rede de verdade — banner only, o cliente
//    reconecta sozinho em instantes.

// Shim do renderer: roda ANTES do bundle do Discord (CDP
// addScriptToEvaluateOnNewDocument, unico ponto sem corrida), no main world.
// Envolve o WebSocket para: (a) contar frames/bytes dos dois lados; (b) detectar
// ATIVIDADE do cliente e dispatch do servidor; (c) rastrear websockets de midia
// abertos (o pill usa para se esconder em call/transmissao).
//
// AGNOSTICO DE PROTOCOLO (issues #154/#156/#158, beta 6): o cliente atual do
// Discord manda frames BINARIOS (etf) — JSON.parse falha em todo send, o
// histograma de ops fica vazio (ops={} com cli_ha=1s no log da #156) e o
// inflador zlib quebrava para sempre ("sem decompress" em toda sessao), o que
// deixava a cura automatica como no-op (revives=0 no carregamento infinito).
// Entao o shim v3 nao depende mais de decodificar o payload:
// - atividade = BURST de envios (3+ em 30s) — heartbeat vem a cada ~41s, entao
//   burst so acontece com o usuario pedindo algo; funciona em JSON ou binario;
// - inflador RESINCRONIZA ate 3x por geracao em vez de morrer, e texto direto
//   (encoding=json) e processado sem inflate;
// - VOLUME de resposta: servidor saudavel responde ao pedido com centenas de
//   bytes; o zumbi devolve so o baseline de heartbeat (bytes) — sinal que nao
//   depende de saber o encoding do payload.
const SHIM_GATEWAY_SRC = "(function(){" +
    "  if (window.__goliveGwShim) return;" +
    "  window.__goliveGwShim = true;" +
    "  var midia = new Set();" +
    "  var geracao = 0;" +
    "  var opCounts = {};" +
    "  var gw = { estado: 'nenhum', srvEm: 0, cliEm: 0, op1Em: 0, subs: 0, srvFrames: 0," +
    "    dispatches: 0, dispatchEm: 0, intentEm: 0, abertoEm: 0, ws: null," +
    "    activityEm: 0, srvBytes: 0, srvBytesDesdeAtividade: 0, op4Em: 0 };" +
    "  var inflador = null;" +
    "  var infladorToken = 0;" +
    "  var infladorResyncs = 0;" +
    "  var cliEnvios = [];" +
    "  var textoPendente = '';" +
    "  var midiaAbertaEm = 0, midiaFechouEm = 0;" +
    "  window.__goliveGwResumo = function () {" +
    "    var agora = Date.now();" +
    "    return { estado: gw.estado," +
    "      srvHa: gw.srvEm ? agora - gw.srvEm : -1," +
    "      cliHa: gw.cliEm ? agora - gw.cliEm : -1," +
    "      subs: gw.subs, srvFrames: gw.srvFrames," +
    "      dispatches: gw.dispatches," +
    "      dispatchHa: gw.dispatchEm ? agora - gw.dispatchEm : -1," +
    "      intentHa: gw.intentEm ? agora - gw.intentEm : -1," +
    "      activityHa: gw.activityEm ? agora - gw.activityEm : -1," +
    "      op4Ha: gw.op4Em ? agora - gw.op4Em : -1," +
    "      midiaOpenHa: midiaAbertaEm ? agora - midiaAbertaEm : -1," +
    "      midiaCloseHa: midiaFechouEm ? agora - midiaFechouEm : -1," +
    "      abertoHa: gw.abertoEm ? agora - gw.abertoEm : -1," +
    "      geracao: geracao," +
    "      opCounts: opCounts," +
    "      srvBytes: gw.srvBytes," +
    "      srvBytesDesdeAtividade: gw.srvBytesDesdeAtividade," +
    "      midiaAberta: midia.size > 0," +
    "      infladorOk: !!inflador };" +
    "  };" +
    "  window.__goliveMidiaAberta = function () { return midia.size > 0; };" +
    "  window.__goliveMidiaFechar = function () {" +
    "    var fechados = 0;" +
    "    midia.forEach(function (w) {" +
    "      try { if (w.readyState === 1) { w.close(4000, 'golive-revive-voz'); fechados++; } } catch (e) { }" +
    "    });" +
    "    return fechados;" +
    "  };" +
    "  window.__goliveGwFechar = function () {" +
    "    var ws = gw.ws;" +
    "    if (!ws || ws.readyState !== 1) return false;" +
    "    try { ws.close(4000, 'golive-revive'); return true; } catch (e) { return false; }" +
    "  };" +
    // ATIVIDADE POR GAP: 3+ envios em 30s = usuario pedindo algo. Heartbeats sao
    // ~41s apart, entao 2 heartbeats + uma presenca solta nao fecha 3 em 30s.
    "  function registrarEnvio(agora) {" +
    "    cliEnvios.push(agora);" +
    "    while (cliEnvios.length > 0 && cliEnvios[0] < agora - 30_000) cliEnvios.shift();" +
    "    if (cliEnvios.length >= 3) {" +
    "      gw.activityEm = agora;" +
    "      gw.srvBytesDesdeAtividade = 0;" +
    "    }" +
    "  }" +
    // SNIFF do op em frames BINARIOS (issues #159/#160/#161, beta 8): o cliente
    // manda etf — 131 + tupla, com o op como PRIMEIRO elemento (inteiro pequeno
    // 97+1byte ou inteiro 98+4bytes BE). Interessa o op 4 (VOICE_STATE_UPDATE):
    // e o pedido de entrar em voz/stream. Parse defensivo — formato estranho
    // devolve -1 e nao registra nada (nunca falso op4).
    "  function opDeBinario(dados) {" +
    "    try {" +
    "      var u;" +
    "      if (dados instanceof ArrayBuffer) { u = new Uint8Array(dados); }" +
    "      else if (typeof dados.byteLength === 'number') { u = new Uint8Array(dados.buffer, dados.byteOffset || 0, dados.byteLength); }" +
    "      else { return -1; }" +
    "      if (u.length < 8 || u[0] !== 131) return -1;" +
    "      var p;" +
    "      if (u[1] === 104) { p = 3; }" +
    "      else if (u[1] === 105) { p = 6; }" +
    "      else { return -1; }" +
    "      var op = -1;" +
    "      if (u[p] === 97) { op = u[p + 1]; }" +
    "      else if (u[p] === 98) { op = (u[p + 1] * 16777216) + (u[p + 2] * 65536) + (u[p + 3] * 256) + u[p + 4]; }" +
    "      if (op < 0 || op > 20) return -1;" +
    "      return op;" +
    "    } catch (e) { return -1; }" +
    "  }" +
    // Conta dispatch (op 0) em payload decodificavel (texto direto ou inflado do
    // zlib-stream). Fatia payloads completos com contador de chaves respeitando
    // strings; o resto parcial fica para o proximo pedaco. Lixo nao-JSON so
    // acumula ate o teto e e descartado (nunca cresce eterno).
    "  function processarTextoPendente() {" +
    "    var s = textoPendente;" +
    "    if (s.length > 2_000_000) { textoPendente = ''; return; }" +
    "    var inicio = 0, prof = 0, emStr = false, esc = false;" +
    "    for (var i = 0; i < s.length; i++) {" +
    "      var c = s[i];" +
    "      if (emStr) {" +
    "        if (esc) esc = false;" +
    "        else if (c === '\\\\') esc = true;" +
    "        else if (c === '\"') emStr = false;" +
    "        continue;" +
    "      }" +
    "      if (c === '\"') { emStr = true; continue; }" +
    "      if (c === '{') prof++;" +
    "      else if (c === '}') {" +
    "        prof--;" +
    "        if (prof === 0) {" +
    "          try {" +
    "            var p = JSON.parse(s.slice(inicio, i + 1));" +
    "            if (p && typeof p === 'object' && p.op === 0) { gw.dispatches++; gw.dispatchEm = Date.now(); }" +
    "          } catch (e) { }" +
    "          inicio = i + 1;" +
    "        } else if (prof < 0) { prof = 0; inicio = i + 1; }" +
    "      }" +
    "    }" +
    "    textoPendente = inicio > 0 ? s.slice(inicio) : s;" +
    "  }" +
    // Fluxo zlib continuo (zlib-stream): um DecompressionStream por tentativa. Em
    // erro NAO morre mais para sempre (a #156 passou a sessao inteira com "sem
    // decompress"): resincroniza com stream novo ate 3x por geracao — cobre
    // dessincronia de fluxo continuo E servidores que mandam cada payload como
    // stream proprio. Exaustou, degrada para os contadores crus.
    "  function iniciarInflador() {" +
    "    if (typeof DecompressionStream === 'undefined') { inflador = null; return; }" +
    "    try {" +
    "      var ds = new DecompressionStream('deflate');" +
    "      var decod = new TextDecoder();" +
    "      var token = ++infladorToken;" +
    "      inflador = { writer: ds.writable.getWriter() };" +
    "      var reader = ds.readable.getReader();" +
    "      (function passo() {" +
    "        reader.read().then(function (r) {" +
    "          if (r.done || token !== infladorToken) return;" +
    "          textoPendente += decod.decode(r.value, { stream: true });" +
    "          try { processarTextoPendente(); } catch (e) { }" +
    "          passo();" +
    "        }, function () { if (token === infladorToken) falhaInflador(); });" +
    "      })();" +
    "    } catch (e) { inflador = null; }" +
    "  }" +
    "  function falhaInflador() {" +
    "    infladorToken++;" +
    "    if (infladorResyncs < 3) { infladorResyncs++; iniciarInflador(); }" +
    "    else { inflador = null; }" +
    "  }" +
    "  function inflarBinario(pedaco) {" +
    "    if (!inflador) return;" +
    "    if (typeof pedaco.arrayBuffer === 'function') {" +
    "      pedaco.arrayBuffer().then(function (buf) { escreverInflador(buf); }, function () { falhaInflador(); });" +
    "    } else {" +
    "      escreverInflador(pedaco);" +
    "    }" +
    "  }" +
    "  function escreverInflador(bytes) {" +
    "    if (!inflador) return;" +
    "    try {" +
    "      inflador.writer.write(bytes).then(null, function () { falhaInflador(); });" +
    "    } catch (e) { falhaInflador(); }" +
    "  }" +
    // RTC (beta 10): envolver o RTCPeerConnection para enxergar o que TOCA — o
    // audio de Go Live vem por RTC/UDP (nao pelo gateway), entao "escuto a stream
    // mas o video nao sai" so e visivel aqui dentro. getStats() separa os bytes
    // inbound por kind (audio vs video) e mostra se o usuario e quem transmite.
    "  var pcs = new Set();" +
    "  var rtc = { audioBytes: -1, videoBytes: -1, audioEm: 0, videoEm: 0, videoTrack: false, enviando: false };" +
    "  window.__goliveRtcResumo = function () {" +
    "    var lista = Array.from(pcs);" +
    "    var promessas = lista.map(function (pc) {" +
    "      return pc.getStats().then(function (stats) {" +
    "        var r = { audio: 0, video: 0, videoTrack: false, enviando: false };" +
    "        stats.forEach(function (s) {" +
    "          var kind = s.kind || s.mediaType;" +
    "          if (s.type === 'inbound-rtp' && kind === 'audio' && typeof s.bytesReceived === 'number') { r.audio += s.bytesReceived; }" +
    "          else if (s.type === 'inbound-rtp' && kind === 'video') { r.videoTrack = true; if (typeof s.bytesReceived === 'number') r.video += s.bytesReceived; }" +
    "          else if (s.type === 'outbound-rtp' && kind === 'video' && s.bytesSent > 0) { r.enviando = true; }" +
    "        });" +
    "        return r;" +
    "      }).catch(function () { return null; });" +
    "    });" +
    "    return Promise.all(promessas).then(function (rs) {" +
    "      var agora = Date.now();" +
    "      var audio = 0, video = 0, videoTrack = false, enviando = false;" +
    "      for (var i = 0; i < rs.length; i++) {" +
    "        var r = rs[i];" +
    "        if (!r) continue;" +
    "        audio += r.audio;" +
    "        if (r.videoTrack) { videoTrack = true; video += r.video; }" +
    "        if (r.enviando) enviando = true;" +
    "      }" +
    "      if (audio > rtc.audioBytes) rtc.audioEm = agora;" +
    "      if (video > rtc.videoBytes) rtc.videoEm = agora;" +
    "      rtc.audioBytes = audio; rtc.videoBytes = video;" +
    "      rtc.videoTrack = videoTrack; rtc.enviando = enviando;" +
    "      return { pcs: lista.length, audioBytes: rtc.audioBytes, videoBytes: rtc.videoBytes," +
    "        audioHa: rtc.audioEm ? agora - rtc.audioEm : -1," +
    "        videoHa: rtc.videoEm ? agora - rtc.videoEm : -1," +
    "        videoTrack: rtc.videoTrack, enviando: rtc.enviando };" +
    "    });" +
    "  };" +
    "  var OriginalRTCPeerConnection = window.RTCPeerConnection;" +
    "  function GoliveRTCPeerConnection(cfg, cert) {" +
    "    var pc = new OriginalRTCPeerConnection(cfg, cert);" +
    "    try {" +
    "      pcs.add(pc);" +
    "      pc.addEventListener('close', function () { pcs.delete(pc); });" +
    "    } catch (e) { }" +
    "    return pc;" +
    "  }" +
    "  GoliveRTCPeerConnection.prototype = OriginalRTCPeerConnection.prototype;" +
    "  window.RTCPeerConnection = GoliveRTCPeerConnection;" +
    "  var OriginalWebSocket = window.WebSocket;" +
    "  function GoliveWebSocket(url, protocolos) {" +
    "    var ws = protocolos === undefined ? new OriginalWebSocket(url) : new OriginalWebSocket(url, protocolos);" +
    "    try {" +
    "      var alvo = String(url);" +
    "      var ehMidia = false, ehGw = false;" +
    "      try { ehMidia = /(^|\\.)discord\\.media$/.test(new URL(alvo).hostname); } catch (e) { }" +
    "      try { ehGw = /(^|\\.)gateway(-[a-z0-9-]+)?\\.discord\\.gg$/.test(new URL(alvo).hostname); } catch (e) { }" +
    "      if (ehMidia) {" +
    "        midia.add(ws);" +
    "        ws.addEventListener('open', function () { midiaAbertaEm = Date.now(); });" +
    "        ws.addEventListener('close', function () { midia.delete(ws); midiaFechouEm = Date.now(); });" +
    "      }" +
    "      if (ehGw) {" +
    // Contadores por GERACAO (o cliente recria o ws a cada reconexao): intencao,
    // atividade e volume so significam dentro da mesma conexao.
    "        geracao++;" +
    "        gw.estado = 'conectando';" +
    "        gw.srvEm = 0; gw.cliEm = 0; gw.op1Em = 0; gw.subs = 0; gw.srvFrames = 0;" +
    "        gw.dispatches = 0; gw.dispatchEm = 0; gw.intentEm = 0; gw.abertoEm = 0;" +
    "        gw.activityEm = 0; gw.srvBytes = 0; gw.srvBytesDesdeAtividade = 0; gw.op4Em = 0;" +
    "        gw.ws = ws;" +
    "        opCounts = {};" +
    "        cliEnvios = [];" +
    "        textoPendente = '';" +
    "        infladorResyncs = 0;" +
    "        infladorToken++;" +
    "        iniciarInflador();" +
    "        ws.addEventListener('open', function () { gw.estado = 'aberta'; gw.abertoEm = Date.now(); });" +
    "        ws.addEventListener('close', function () { gw.estado = 'fechada'; gw.ws = null; });" +
    "        ws.addEventListener('message', function (ev) {" +
    "          var agora = Date.now();" +
    "          gw.srvEm = agora; gw.srvFrames++;" +
    "          var pedaco = ev.data;" +
    "          var tam = 0;" +
    "          if (typeof pedaco === 'string') {" +
    "            tam = pedaco.length;" +
    "            textoPendente += pedaco;" +
    "            try { processarTextoPendente(); } catch (e) { }" +
    "          } else if (pedaco && typeof pedaco.size === 'number') {" +
    "            tam = pedaco.size;" +
    "            inflarBinario(pedaco);" +
    "          } else if (pedaco && pedaco.byteLength) {" +
    "            tam = pedaco.byteLength;" +
    "            inflarBinario(pedaco);" +
    "          }" +
    "          gw.srvBytes += tam;" +
    "          gw.srvBytesDesdeAtividade += tam;" +
    "        });" +
    // Conta ops quando o payload e JSON texto (encodings antigos); no binario o
    // histograma fica vazio MESMO — o sniff de op (etf) e o gap de envios que cobrem.
    "        var enviar = ws.send.bind(ws);" +
    "        ws.send = function (dados) {" +
    "          var agora = Date.now();" +
    "          gw.cliEm = agora;" +
    "          registrarEnvio(agora);" +
    "          if (typeof dados === 'string') {" +
    "            try {" +
    "              var op = JSON.parse(dados).op;" +
    "              opCounts[op] = (opCounts[op] || 0) + 1;" +
    "              if (op === 1) { gw.op1Em = agora; }" +
    "              else {" +
    "                gw.intentEm = agora;" +
    "                if (op === 4) { gw.op4Em = agora; }" +
    "                if (op === 14 || op === 37) gw.subs++;" +
    "              }" +
    "            } catch (e) { }" +
    "          } else if (dados && (dados instanceof ArrayBuffer || typeof dados.byteLength === 'number')) {" +
    "            if (opDeBinario(dados) === 4) { gw.op4Em = agora; }" +
    "          } else if (dados && typeof dados.arrayBuffer === 'function') {" +
    "            dados.arrayBuffer().then(function (ab) {" +
    "              if (opDeBinario(ab) === 4) { gw.op4Em = Date.now(); }" +
    "            }, function () { });" +
    "          }" +
    "          return enviar(dados);" +
    "        };" +
    "      }" +
    "    } catch (e) { }" +
    "    return ws;" +
    "  }" +
    "  GoliveWebSocket.prototype = OriginalWebSocket.prototype;" +
    "  GoliveWebSocket.CONNECTING = 0; GoliveWebSocket.OPEN = 1;" +
    "  GoliveWebSocket.CLOSING = 2; GoliveWebSocket.CLOSED = 3;" +
    "  window.WebSocket = GoliveWebSocket;" +
    "})();";

// O MESMO shim, gravado em arquivo e registrado como PRELOAD de sessao: o preload
// roda antes de qualquer script da pagina em TODA janela/frame — sem CDP e sem
// corrida (issue #163: CDP falhou, o fallback do did-finish-load chegou depois do
// gateway conectar, e a sessao inteira ficou cega por 17 minutos). Preload e o
// vetor primario; CDP e o fallback do did-finish-load ficam como reforco — o shim
// se auto-guarda (__goliveGwShim), entao injecao dupla e inofensiva.
const SHIM_FILE = join(HERE, "golive-shim.js");
const SHIM_ALL_SRC = SHIM_GATEWAY_SRC + "\n" + SHIM_VOICE_SRC;

function registrarPreloadShim() {
    try {
        fs.writeFileSync(SHIM_FILE, SHIM_ALL_SRC);
    } catch (error) {
        log("nao consegui gravar o arquivo do shim: " + error.message);
        return;
    }
    try {
        const s = require("electron").session.defaultSession;
        if (typeof s.registerPreloadScript === "function") {
            s.registerPreloadScript({ type: "frame", id: "golive-shim", filePath: SHIM_FILE });
            log("gw.shim | preload do shim registrado na sessao (registerPreloadScript)");
        } else if (typeof s.setPreloads === "function") {
            const atuais = typeof s.getPreloads === "function" ? s.getPreloads() : [];
            if (atuais.indexOf(SHIM_FILE) === -1) s.setPreloads(atuais.concat([SHIM_FILE]));
            log("gw.shim | preload do shim registrado na sessao (setPreloads)");
        } else {
            log("gw.shim | sessao sem API de preload; ficam CDP e did-finish-load");
        }
    } catch (error) {
        log("nao consegui registrar o preload do shim: " + error.message);
    }
}

// Pill de recuperacao: elemento permanente, discreto, com reload a um clique —
// o usuario aperta no primeiro segundo de loading em vez de esperar o
// reconnect chegar sozinho (7-25 min nos relatos). Some em fullscreen e com
// midia aberta; o atalho Ctrl+Alt+R fica de pe mesmo assim (intencao explicita
// do usuario, entao executa mesmo em call — a decisao e dele, nao nossa).
const REVIVE_SRC = "(function(){" +
    "  if (window.__goliveRevive) return;" +
    "  window.__goliveRevive = true;" +
    "  function recarregar() { location.reload(); }" +
    "  window.addEventListener('keydown', function (ev) {" +
    "    if (ev.ctrlKey && ev.altKey && ev.code === 'KeyR') { ev.preventDefault(); ev.stopPropagation(); recarregar(); }" +
    "  }, true);" +
    "  var el = null;" +
    "  function criar() {" +
    "    el = document.createElement('div');" +
    "    el.id = 'golive-revive';" +
    "    el.title = 'Discord travado? Recarregar (Ctrl+Alt+R)';" +
    "    el.textContent = '\\u21BB';" +
    "    el.style.cssText = 'position:fixed;z-index:2147483646;bottom:18px;right:18px;width:24px;height:24px;" +
    "border-radius:50%;background:#2b2d31;color:#b5bac1;border:1px solid #4e5058;font-size:15px;" +
    "line-height:22px;text-align:center;cursor:pointer;opacity:.35;transition:opacity .15s;user-select:none;';" +
    "    el.onmouseenter = function(){ el.style.opacity = '1'; };" +
    "    el.onmouseleave = function(){ el.style.opacity = '.35'; };" +
    "    el.onclick = function(){ recarregar(); };" +
    "    document.body.appendChild(el);" +
    "  }" +
    "  setInterval(function () {" +
    "    var esconder = !!document.fullscreenElement || (window.__goliveMidiaAberta ? window.__goliveMidiaAberta() : false);" +
    "    if (esconder) { if (el) el.style.display = 'none'; return; }" +
    "    if (!el || !document.body.contains(el)) { criar(); }" +
    "    el.style.display = 'block';" +
    "  }, 2000);" +
"})();";

let zumbiBannerAtivo = false;
// Estado da escada de revive (ver decidirRevive). Tudo morre com reload da janela
// (watchReloads) — reload e sessao nova de verdade.
let zumbiTentativaEm = [];       // timestamps das tentativas (janela de GW_ZUMBI_JANELA_MS)
let zumbiUltimaAcaoEm = 0;       // cooldown entre acoes
let zumbiUltimaAcao = null;      // 'fechar' | 'reload'
let revivePendenteEm = 0;        // reconexao provocada pelo NOSSO close (TTL: fora da rajada/recorrencia)
let reviveFecharEm = 0;          // quando fechamos o ws (auto-cura se o cliente NAO renascer)
let reviveFecharGeracao = 0;     // geracao na hora do close

// Alarme re-escopado: "silente" = servidor INTEIRO calado (nem ACK de heartbeat) com o ws
// constando aberto — morte de rede real, o cliente renasce sozinho e o banner antecipa.
// "zumbi" = protocolo vivo dos dois lados (heartbeats respondendo) mas o usuario PEDIU algo
// e NAO chegou dispatch nenhum desde o pedido (issues #145/#149/#153). Precisa do inflador
// funcionando: sem decompress, dispatch e indistinguivel de heartbeat e o caso nao dispara.
const GW_SERVIDOR_SILENCIOSO_MS = 3 * 60_000;
const GW_PROBE_CHECAGEM_MS = 60_000;
// Deixa READY/RESUMED assentar apos abrir a conexao.
const GW_ZUMBI_AQUECIMENTO_MS = 2 * 60_000;
// Cliente mandando heartbeat (intervalo ~41s).
const GW_ZUMBI_CLIENTE_VIVO_MS = 90_000;
// Espera pos-intencao antes de declarar zumbi.
const GW_ZUMBI_ESPERA_MS = 30_000;
// Janela da atividade: o burst do usuario tem que ser RECENTE (foi ele que pediu
// a tela) mas ja com prazo vencido de resposta.
const GW_ZUMBI_ATIVIDADE_JANELA_MS = 90_000;
// Volume minimo de resposta do servidor saudavel a um pedido (bytes desde a
// atividade): dispatches somam centenas de bytes inflados; o zumbi devolve so o
// baseline de heartbeat (~bytes). Agnostico de encoding — vale para JSON ou etf.
const GW_ZUMBI_RESPOSTA_BYTES = 256;
// Fluxo de voz/stream (issues #159/#160/#161, beta 8): o cliente manda op 4
// (VOICE_STATE_UPDATE — entrar em voz/stream) e o gateway saudavel responde em
// segundos com o dispatch que faz o ws de midia (*.discord.media) abrir. Prazo
// de espera antes de declarar o fluxo travado.
const GW_STREAM_ESPERA_MS = 20_000;
// O op 4 tem que ser RECENTE (foi o clique do usuario que pediu a stream).
const GW_STREAM_JANELA_MS = 90_000;
// Guarda de SAIDA: um ws de midia que fechou ha pouco + op 4 = o usuario SAINDO
// de voz/stream (ou a stream acabando) — nesses casos nenhuma midia nova abre.
const GW_STREAM_LEAVE_MS = 15_000;
// RTC nativo do transmissor (issue #164): o preload do Discord vive no mundo
// isolado 999. O main junta sua telemetria de discord_voice com a demanda e os
// websockets observados no mundo principal; dado ausente nunca vira acao.
const VOICE_ISOLATED_WORLD_ID = 999;
const VOICE_PROBE_MS = 5_000;
const VOICE_PROBE_LOG_MS = 30_000;
const VOICE_STREAM_AQUECIMENTO_MS = 20_000;
const VOICE_VIEWER_AQUECIMENTO_MS = 10_000;
const VOICE_VIEWER_PARADO_MS = 10_000;
const VOICE_DEMANDA_GRACA_MS = 15_000;
const VOICE_ENTRADA_VIVA_MS = 15_000;
const VOICE_SAIDA_PARADA_MS = 20_000;
const VOICE_SAMPLE_MAX_MS = 10_000;
const VOICE_SAIDA_SUCESSO_MS = 8_000;
const VOICE_SUCESSO_SUSTENTADO_MS = 10_000;
// Safe recovery preserves the native connection, so recovery windows now wait
// for media progress rather than for teardown/recreation side effects.
const VOICE_NIVEL1_ESPERA_MS = 20_000;
const VOICE_NIVEL2_ESPERA_MS = 30_000;
const VOICE_ACAO_COOLDOWN_MS = 30_000;
const VOICE_TENTATIVAS = 2;
const VOICE_JANELA_MS = 30 * 60_000;
// Teto de tentativas da escada na janela.
const GW_ZUMBI_TENTATIVAS = 2;
// Janela de contagem das tentativas.
const GW_ZUMBI_JANELA_MS = 30 * 60_000;
// Cooldown entre tentativas da escada.
const GW_ZUMBI_COOLDOWN_MS = 3 * 60_000;
// A reconexao do nosso close deixa de ser "revive" (sair da rajada/recorrencia) depois disto.
const GW_REVIVE_TTL_MS = 60_000;
// Midia fechada ha menos de 3min: pode ainda ter call viva — nao age automatico.
const GW_REVIVE_MIDIA_GRACA_MS = 3 * 60_000;
// Prazo do cliente renascer o ws apos o close 4000.
const GW_REVIVE_RENASCE_MS = 15_000;

// Duas idades em ms (-1 = nunca); devolve a menor delas ignorando as ausentes.
function minIdade(a, b) {
    if (a < 0) return b;
    if (b < 0) return a;
    return Math.min(a, b);
}

// Funcao pura — os campos *Ha sao IDADES em ms desde o ultimo evento (o shim mede no
// momento do poll), comparadas DIRETO contra os prazos. A beta.4 fazia `agora - srvHa`
// (idade tratada como timestamp): o gate nunca filtrava e o banner disparava em falso.
//
// Zumbi tem DOIS caminhos, porque o cliente do Discord migrou para frames binarios
// (issues #154/#156/#158: ops={} e "sem decompress" em toda sessao, revives=0):
// 1. Payload decodificavel (JSON): dispatch starve — nada despachado desde o pedido.
// 2. Qualquer encoding (o caminho que salva o beta 8): o usuario deu um BURST de
//    envios (atividade) e o servidor devolveu MENOS que o baseline de heartbeat
//    (GW_ZUMBI_RESPOSTA_BYTES) desde entao. Saude = resposta de verdade ao pedido;
//    zumbi = sessao protocolarmente viva que ignora o que foi pedido.
function avaliarSinalGw(resumo, agora) {
    if (!resumo || resumo.estado !== 'aberta') return null;
    if (resumo.srvHa >= GW_SERVIDOR_SILENCIOSO_MS) return 'silente';
    if (resumo.abertoHa < 0 || resumo.abertoHa < GW_ZUMBI_AQUECIMENTO_MS) return null;
    if (resumo.cliHa < 0 || resumo.cliHa >= GW_ZUMBI_CLIENTE_VIVO_MS) return null;
    // CAMINHO 3 (o que pega o caso REAL da beta 8 — #159/#160/#161): o usuario
    // PEDIU entrada em voz/stream (op 4, sniffado do binario etf ou lido do JSON)
    // ha pouco, NENHUM ws de midia abriu desde o pedido e nao ha midia aberta —
    // o fluxo de voz nunca comecou e a view fica em "carregando" para sempre.
    // Nao depende de decode de dispatch nem de inflate: funciona com o servidor
    // empurrando dados ambiente (resp_bytes alto) como nos logs da beta 8.
    if (resumo.op4Ha >= 0 && resumo.op4Ha >= GW_STREAM_ESPERA_MS && resumo.op4Ha <= GW_STREAM_JANELA_MS &&
        resumo.midiaAberta !== true &&
        (resumo.midiaOpenHa < 0 || resumo.midiaOpenHa > resumo.op4Ha) &&
        (resumo.midiaCloseHa < 0 || resumo.midiaCloseHa > GW_STREAM_LEAVE_MS)) {
        return 'zumbi';
    }
    if (resumo.infladorOk !== true) return null;
    // O usuario pediu algo: op explicita (JSON) OU burst de envios (binario).
    const pediuHa = minIdade(resumo.intentHa, resumo.activityHa);
    if (pediuHa < 0 || pediuHa < GW_ZUMBI_ESPERA_MS || pediuHa > GW_ZUMBI_ATIVIDADE_JANELA_MS) return null;
    // Dispatch DEPOIS do pedido = dado chegando (saudavel) — caminho 1.
    if (resumo.dispatchHa >= 0 && resumo.dispatchHa < pediuHa) return null;
    // Caminho 2 (mundo binario, dispatchHa == -1 para sempre): o pedido ficou sem
    // resposta de volume. Com dispatches visiveis este checagem nao roda — o caminho
    // 1 mandou o veredito acima.
    if (resumo.dispatchHa < 0 && resumo.srvBytesDesdeAtividade >= GW_ZUMBI_RESPOSTA_BYTES) return null;
    return 'zumbi';
}

// Funcao pura da escada (testavel): com o zumbi confirmado, decide a acao.
// ctx: { agora, midiaAberta, midiaRecente, tentativas[], ultimaAcaoEm, ultimaAcao }
function decidirRevive(ctx) {
    // §6/AGENTS.md: reconexao de gateway mata o video de call/live em andamento — nunca agir.
    if (ctx.midiaAberta || ctx.midiaRecente) return { acao: 'banner', motivo: 'midia' };
    const tentativas = ctx.tentativas.filter(t => t >= ctx.agora - GW_ZUMBI_JANELA_MS);
    if (tentativas.length >= GW_ZUMBI_TENTATIVAS) return { acao: 'banner', motivo: 'teto_tentativas' };
    if (ctx.ultimaAcaoEm > 0 && ctx.agora - ctx.ultimaAcaoEm < GW_ZUMBI_COOLDOWN_MS) return { acao: 'nenhum', motivo: 'cooldown' };
    // Escada: a primeira acao e fechar (close 4000, RESUME preserva a sessao); se o close
    // nao curou, sobe para o reload — a cura que sempre funciona.
    if (ctx.ultimaAcao === 'fechar') return { acao: 'reload', motivo: 'nivel2' };
    return { acao: 'fechar', motivo: 'nivel1' };
}

const ZUMBI_BANNER_TEXT = "GoLiveBypass: a sessao do gateway esta sem resposta ha alguns " +
    "minutos — as telas podem ficar carregando para sempre. Clique em \"Reiniciar agora\" " +
    "abaixo (ou Ctrl+Alt+R) para recarregar a janela.";

// Banner flutuante generico (mesmo padrao visual, ids diferentes: os avisos
// coexistem sem um apagar o outro, e nunca empilham — um elemento so por id,
// sempre reaproveitado com o texto novo).
function mostrarBannerFixo(id, texto, corBorda) {
    const win = clientWindow();
    if (win === null) return;
    const script = "(function(){\n" +
        "  var el = document.getElementById('" + id + "');\n" +
        "  if (!el) {\n" +
        "    el = document.createElement('div');\n" +
        "    el.id = '" + id + "';\n" +
        "    el.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:2147483647;" +
        "display:flex;align-items:flex-start;gap:10px;width:320px;" +
        "background:#2b2d31;color:#f2f3f5;padding:14px 16px;border-radius:10px;" +
        "border-left:4px solid " + corBorda + ";" +
        "font:13px/1.45 \"gg sans\",-apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif;" +
        "box-shadow:0 8px 24px rgba(0,0,0,.45);" +
        "opacity:0;transform:translateY(8px);transition:opacity .2s ease,transform .2s ease;'; \n" +
        "    var icon = document.createElement('div');\n" +
        "    icon.textContent = '\\u26A0\\uFE0F';\n" +
        "    icon.style.cssText = 'font-size:18px;line-height:1;flex-shrink:0;margin-top:1px;';\n" +
        "    var body = document.createElement('div');\n" +
        "    body.style.cssText = 'flex:1;min-width:0;';\n" +
        "    var title = document.createElement('div');\n" +
        "    title.textContent = 'GoLiveBypass';\n" +
        "    title.style.cssText = 'font-weight:600;margin-bottom:3px;color:#fff;';\n" +
        "    var text = document.createElement('div');\n" +
        "    text.id = '" + id + "-text';\n" +
        "    text.style.cssText = 'color:#d8dadf;';\n" +
        "    var restartBtn = document.createElement('button');\n" +
        "    restartBtn.type = 'button';\n" +
        "    restartBtn.textContent = 'Reiniciar agora';\n" +
        "    restartBtn.style.cssText = 'margin-top:8px;padding:5px 10px;border:0;" +
        "border-radius:6px;background:#f0b232;color:#111214;font-weight:600;font-size:12px;" +
        "cursor:pointer;';\n" +
        "    restartBtn.onmouseenter = function(){ restartBtn.style.background = '#f5c862'; };\n" +
        "    restartBtn.onmouseleave = function(){ restartBtn.style.background = '#f0b232'; };\n" +
        "    restartBtn.onclick = function(){ location.reload(); };\n" +
        "    body.appendChild(title);\n" +
        "    body.appendChild(text);\n" +
        "    body.appendChild(restartBtn);\n" +
        "    var closeBtn = document.createElement('div');\n" +
        "    closeBtn.textContent = '\\u2715';\n" +
        "    closeBtn.style.cssText = 'cursor:pointer;color:#949ba4;font-size:14px;flex-shrink:0;padding:2px;';\n" +
        "    closeBtn.onclick = function(){ el.remove(); };\n" +
        "    el.appendChild(icon);\n" +
        "    el.appendChild(body);\n" +
        "    el.appendChild(closeBtn);\n" +
        "    document.body.appendChild(el);\n" +
        "    requestAnimationFrame(function(){ el.style.opacity = '1'; el.style.transform = 'translateY(0)'; });\n" +
        "  }\n" +
        "  document.getElementById('" + id + "-text').textContent = " + JSON.stringify(texto) + ";\n" +
        "})();";
    win.webContents.executeJavaScript(script).catch(error => log("falhei ao mostrar aviso de sessao muda: " + error.message));
}

function showZumbiBanner() {
    mostrarBannerFixo('golivebypass-zumbi', ZUMBI_BANNER_TEXT, '#f0b232');
}

// Recuperacao do VIDEO DE SAIDA do transmissor (issue #164). O probe da beta
// 10 observava RTCPeerConnection no Chromium e era cego (pcs=0): o Discord
// desktop usa discord_voice. A recuperacao enhanced e role-aware: broadcaster
// reaplica a fonte sem destruir RTC; viewer refresca transporte/subscricao de video.
// Voice, media sockets e gateway permanecem intactos.
let videoNativoTentativas = [];
let videoNativoUltimaAcaoEm = 0;
let videoNativoPendente = null;
let videoNativoBloqueadoGeracao = '';
let videoNativoBloqueadoEm = 0;
let videoBannerAtivo = false;
let voiceProbeRodando = false;
let voiceProbeUltimoLogEm = 0;
let voiceProbeUltimaAssinatura = '';
let voiceHookLogado = false;
let voiceUltimaGeracaoLogada = '';
let voiceIsolatedAvisado = false;

const VIDEO_BANNER_TEXT = "GoLiveBypass: confirmamos que a captura continua ativa, mas o " +
    "Discord parou de enviar os quadros da transmissao. A recuperacao automatica sem reload " +
    "foi esgotada; use \"Reiniciar agora\" somente se quiser reconstruir a call inteira.";

function showVideoBanner() {
    videoBannerAtivo = true;
    mostrarBannerFixo('golivebypass-video', VIDEO_BANNER_TEXT, '#f0b232');
}

function hideVideoBanner(win) {
    if (!videoBannerAtivo) return;
    videoBannerAtivo = false;
    try {
        win.webContents.executeJavaScript("(function(){var e=document.getElementById('golivebypass-video');if(e)e.remove();})()")
            .catch(() => { });
    } catch { }
}

function streamNativaAtiva(voice) {
    if (!voice || !Array.isArray(voice.connections)) return null;
    let achada = null;
    for (const conn of voice.connections) {
        if (!conn || conn.destroyed === true || conn.kind !== 'stream') continue;
        if (achada === null || conn.id > achada.id) achada = conn;
    }
    return achada;
}

function voiceNativaAtiva(voice) {
    if (!voice || !Array.isArray(voice.connections)) return null;
    let achada = null;
    for (const conn of voice.connections) {
        if (!conn || conn.destroyed === true || conn.kind !== 'voice') continue;
        if (achada === null || conn.id > achada.id) achada = conn;
    }
    return achada;
}

function geracaoNativa(voice, stream) {
    if (!voice || !stream) return '';
    return String(voice.instanceId || 'legacy') + ':' + String(stream.id);
}

// Role-aware, fail-closed native RTC detector. Broadcaster stalls are capture-live /
// encoder-dead; viewer stalls are established video with a decoder that never progresses.
function avaliarRtcNativo(ctx) {
    if (!ctx || !ctx.voice || ctx.voice.installed !== true || ctx.voice.voiceHooked !== true) return null;
    if (!ctx.midia || ctx.midia.midiaAberta !== true) return null;
    if (!ctx.demanda || ctx.demanda.known !== true || ctx.demanda.active !== true) return null;
    const stream = streamNativaAtiva(ctx.voice);
    if (!stream) return null;
    if (ctx.demanda.demandHa < 0 || ctx.demanda.demandHa > stream.createdHa + VOICE_DEMANDA_GRACA_MS) return null;
    const stats = stream.stats;
    if (!stats || stats.statsOk !== true) return null;
    if (stats.sampleHa < 0 || stats.sampleHa > VOICE_SAMPLE_MAX_MS) return null;
    const papel = stats.role ||
        ((typeof stats.framesEncoded === 'number' && typeof stats.encodeFrameRate === 'number') ? 'broadcaster' :
            ((typeof stats.framesDecoded === 'number' && typeof stats.decodeFrameRate === 'number') ? 'viewer' : 'unknown'));

    if (papel === 'broadcaster') {
        if (stream.createdHa < VOICE_STREAM_AQUECIMENTO_MS) return null;
        if (stats.entradaHa < 0 || stats.entradaHa > VOICE_ENTRADA_VIVA_MS) return null;
        if (!(typeof stats.captureFrames === 'number' || stats.inputFrameRate > 0)) return null;
        if (typeof stats.framesEncoded !== 'number' || typeof stats.encodeFrameRate !== 'number') return null;
        if (stats.saidaHa < VOICE_SAIDA_PARADA_MS) return null;
        return 'transmissor-video-parado';
    }

    if (papel === 'viewer') {
        if (stream.createdHa < VOICE_VIEWER_AQUECIMENTO_MS) return null;
        if (stats.videoExpected !== true) return null;
        if (typeof stats.framesDecoded !== 'number' || typeof stats.decodeFrameRate !== 'number') return null;
        if (stats.decodeFrameRate > 0) return null;
        if (stats.decodeHa < VOICE_VIEWER_PARADO_MS) return null;
        return 'viewer-video-parado';
    }
    return null;
}

function rtcNativoSaudavel(ctx, papelEsperado) {
    const stream = streamNativaAtiva(ctx && ctx.voice);
    if (!stream) return null;
    const stats = stream.stats;
    if (!ctx.demanda || ctx.demanda.known !== true || ctx.demanda.active !== true) return null;
    if (!ctx.midia || ctx.midia.midiaAberta !== true) return null;
    if (!stats || stats.statsOk !== true || stats.sampleHa > VOICE_SAMPLE_MAX_MS) return null;
    let papel = stats.role;
    if (papel !== 'broadcaster' && papel !== 'viewer') {
        papel = (typeof stats.framesEncoded === 'number' && typeof stats.encodeFrameRate === 'number') ? 'broadcaster' :
            ((typeof stats.framesDecoded === 'number' && typeof stats.decodeFrameRate === 'number') ? 'viewer' : 'unknown');
    }
    if (papelEsperado === 'broadcaster' || papelEsperado === 'viewer') {
        if (papel !== papelEsperado) return null;
    }
    if (papel === 'broadcaster') {
        if (stats.entradaHa < 0 || stats.entradaHa > VOICE_ENTRADA_VIVA_MS) return null;
        if (stats.saidaHa < 0 || stats.saidaHa > VOICE_SAIDA_SUCESSO_MS) return null;
        if (!(stats.encodeFrameRate > 0) || typeof stats.framesEncoded !== 'number') return null;
        return stream;
    }
    if (papel === 'viewer') {
        if (stats.videoExpected !== true) return null;
        if (stats.decodeHa < 0 || stats.decodeHa > VOICE_SAIDA_SUCESSO_MS) return null;
        if (!(stats.decodeFrameRate > 0) || typeof stats.framesDecoded !== 'number') return null;
        return stream;
    }
    return null;
}

function executarVoiceIsolado(win, code) {
    const wc = win && win.webContents;
    if (!wc || typeof wc.executeJavaScriptInIsolatedWorld !== 'function') {
        return Promise.reject(new Error('executeJavaScriptInIsolatedWorld indisponivel'));
    }
    return wc.executeJavaScriptInIsolatedWorld(VOICE_ISOLATED_WORLD_ID, [{ code }], true);
}

function consultarRtcNativo(win) {
    const voice = executarVoiceIsolado(win,
        'window.__goliveVoiceResumo ? window.__goliveVoiceResumo() : null');
    const pagina = win.webContents.executeJavaScript(
        "({demanda:window.__goliveVoiceDemandaResumo?window.__goliveVoiceDemandaResumo():null," +
        "midia:window.__goliveGwResumo?window.__goliveGwResumo():null})", true);
    return Promise.all([voice, pagina]).then(([voiceResumo, paginaResumo]) => ({
        win,
        voice: voiceResumo,
        demanda: paginaResumo && paginaResumo.demanda,
        midia: paginaResumo && paginaResumo.midia,
    }));
}

function falharRecuperacaoNativa(ctx, motivo) {
    const stream = streamNativaAtiva(ctx && ctx.voice);
    videoNativoBloqueadoGeracao = stream ? geracaoNativa(ctx.voice, stream) :
        (videoNativoPendente ? videoNativoPendente.geracao : '');
    videoNativoBloqueadoEm = Date.now();
    videoNativoPendente = null;
    log("gw.zumbi | video nativo confirmado mas acao manual (" + motivo + ")");
    if (!videoBannerAtivo) showVideoBanner();
}

function iniciarRecuperacaoNativa(ctx, nivel, sinal) {
    const agora = Date.now();
    while (videoNativoTentativas.length > 0 && videoNativoTentativas[0] < agora - VOICE_JANELA_MS) {
        videoNativoTentativas.shift();
    }
    if (videoNativoTentativas.length >= VOICE_TENTATIVAS) {
        falharRecuperacaoNativa(ctx, 'teto_tentativas');
        return;
    }
    const stream = streamNativaAtiva(ctx.voice);
    const stats = stream && stream.stats;
    const papel = stats && stats.role ? stats.role : (sinal === 'viewer-video-parado' ? 'viewer' : 'broadcaster');
    if (!stream || (papel !== 'viewer' && papel !== 'broadcaster')) {
        falharRecuperacaoNativa(ctx, 'papel_indisponivel');
        return;
    }
    const geracao = geracaoNativa(ctx.voice, stream);
    videoNativoTentativas.push(agora);
    videoNativoUltimaAcaoEm = agora;
    const tentativa = { nivel, geracao, papel, sinal, inicioEm: agora, sucessoEm: 0, confirmada: false, action: '' };
    videoNativoPendente = tentativa;
    sessaoRevives++;
    log("gw.revive | rtc nativo: nivel=" + nivel + " papel=" + papel + " sinal=" + String(sinal || '?'));
    executarVoiceIsolado(ctx.win,
        'window.__goliveVoiceRecuperar ? window.__goliveVoiceRecuperar(' + nivel + ') : null')
        .then(resultado => {
            if (videoNativoPendente !== tentativa) return;
            if (!resultado || resultado.ok !== true || resultado.role !== papel) {
                falharRecuperacaoNativa(ctx, 'acao_nativa_indisponivel');
                return;
            }
            tentativa.confirmada = true;
            tentativa.action = String(resultado.action || 'desconhecida');
            log("gw.revive | rtc nativo: nivel=" + nivel + " papel=" + papel + " acao=" + tentativa.action);
        })
        .catch(error => {
            if (videoNativoPendente === tentativa) falharRecuperacaoNativa(ctx, 'mundo_isolado: ' + error.message);
        });
}

function acompanharRecuperacaoNativa(ctx) {
    const pendente = videoNativoPendente;
    if (!pendente) return false;
    const agora = Date.now();
    const streamSaudavel = rtcNativoSaudavel(ctx, pendente.papel);
    if (streamSaudavel) {
        if (pendente.sucessoEm === 0) pendente.sucessoEm = agora;
        if (agora - pendente.sucessoEm >= VOICE_SUCESSO_SUSTENTADO_MS) {
            log("gw.revive | rtc nativo: sucesso nivel=" + pendente.nivel + " papel=" + pendente.papel +
                " acao=" + (pendente.action || '?') + " por=" + Math.round((agora - pendente.sucessoEm) / 1000) + "s");
            videoNativoPendente = null;
            videoNativoBloqueadoGeracao = '';
            videoNativoBloqueadoEm = 0;
            hideVideoBanner(ctx.win);
        }
        return true;
    }
    pendente.sucessoEm = 0;

    if (ctx.demanda && ctx.demanda.known === true && ctx.demanda.active !== true && ctx.demanda.changedHa >= 15_000) {
        log("gw.revive | rtc nativo: tentativa cancelada, demanda terminou");
        videoNativoPendente = null;
        return true;
    }

    const prazo = pendente.nivel === 1 ? VOICE_NIVEL1_ESPERA_MS : VOICE_NIVEL2_ESPERA_MS;
    if (agora - pendente.inicioEm < prazo) return true;
    if (pendente.nivel === 1) {
        log("gw.revive | rtc nativo: nivel=1 nao retomou progresso; subindo ao nivel=2 papel=" + pendente.papel);
        const sinal = pendente.sinal;
        videoNativoPendente = null;
        iniciarRecuperacaoNativa(ctx, 2, sinal);
        return true;
    }
    falharRecuperacaoNativa(ctx, 'nivel2_sem_progresso');
    return true;
}

function processarRtcNativo(ctx) {
    const agora = Date.now();
    while (videoNativoTentativas.length > 0 && videoNativoTentativas[0] < agora - VOICE_JANELA_MS) {
        videoNativoTentativas.shift();
    }
    if (acompanharRecuperacaoNativa(ctx)) return;
    const stream = streamNativaAtiva(ctx.voice);
    if (videoNativoBloqueadoEm > 0 && (agora - videoNativoBloqueadoEm >= VOICE_JANELA_MS ||
        (stream && geracaoNativa(ctx.voice, stream) !== videoNativoBloqueadoGeracao))) {
        videoNativoBloqueadoGeracao = '';
        videoNativoBloqueadoEm = 0;
        hideVideoBanner(ctx.win);
    }
    const sinal = avaliarRtcNativo(ctx);
    if (sinal === null) return;
    if (stream && geracaoNativa(ctx.voice, stream) === videoNativoBloqueadoGeracao) return;
    if (!autoRevive) {
        falharRecuperacaoNativa(ctx, 'autoRevive_desligado');
        return;
    }
    if (videoNativoUltimaAcaoEm > 0 && agora - videoNativoUltimaAcaoEm < VOICE_ACAO_COOLDOWN_MS) return;
    iniciarRecuperacaoNativa(ctx, 1, sinal);
}

function logRtcNativo(ctx) {
    const agora = Date.now();
    const stream = streamNativaAtiva(ctx.voice);
    const stats = stream && stream.stats;
    const assinatura = [
        !!(ctx.voice && ctx.voice.voiceHooked), stream ? stream.id : 0,
        stats && stats.role ? stats.role : '?', !!(ctx.demanda && ctx.demanda.active),
        stats ? !!stats.statsOk : false, videoNativoPendente ? videoNativoPendente.nivel : 0,
    ].join(':');
    if (assinatura === voiceProbeUltimaAssinatura && agora - voiceProbeUltimoLogEm < VOICE_PROBE_LOG_MS) return;
    voiceProbeUltimaAssinatura = assinatura;
    voiceProbeUltimoLogEm = agora;
    log("voice.probe | hook=" + (ctx.voice && ctx.voice.voiceHooked ? "sim" : "nao") +
        " stream=" + (stream ? stream.id : "nenhuma") +
        " papel=" + (stats && stats.role ? stats.role : "?") +
        " demanda=" + (ctx.demanda && ctx.demanda.known ? (ctx.demanda.active ? "sim" : "nao") : "?") +
        " demanda_ha=" + idadeSeg(ctx.demanda ? ctx.demanda.demandHa : -1) +
        " entrada_ha=" + idadeSeg(stats ? stats.entradaHa : -1) +
        " saida_ha=" + idadeSeg(stats ? stats.saidaHa : -1) +
        " video=" + (stats && stats.videoExpected ? "sim" : "?") +
        " video_ha=" + idadeSeg(stats ? stats.decodeHa : -1) +
        " fps_in=" + (stats && typeof stats.inputFrameRate === 'number' ? Math.round(stats.inputFrameRate) : "?") +
        " fps_out=" + (stats && typeof stats.encodeFrameRate === 'number' ? Math.round(stats.encodeFrameRate) : "?") +
        " fps_dec=" + (stats && typeof stats.decodeFrameRate === 'number' ? Math.round(stats.decodeFrameRate) : "?") +
        " frames=" + (stats && typeof stats.framesEncoded === 'number' ? Math.round(stats.framesEncoded) : "?") +
        " dec=" + (stats && typeof stats.framesDecoded === 'number' ? Math.round(stats.framesDecoded) : "?") +
        " stats=" + (stats && stats.statsOk ? "ok" : (stats && stats.reason ? stats.reason : "?")));
}

function checarRtcNativo() {
    if (voiceProbeRodando) return;
    const janelas = janelasCliente();
    if (janelas.length === 0) return;
    voiceProbeRodando = true;
    Promise.all(janelas.map(win => consultarRtcNativo(win).catch(error => ({ win, error })))).then(resultados => {
        let escolhido = null;
        for (const resultado of resultados) {
            if (!resultado || resultado.error || !resultado.voice) continue;
            if (escolhido === null || (streamNativaAtiva(resultado.voice) && !streamNativaAtiva(escolhido.voice))) {
                escolhido = resultado;
            }
        }
        if (escolhido === null) {
            if (!voiceIsolatedAvisado) {
                voiceIsolatedAvisado = true;
                const erro = resultados.find(r => r && r.error);
                log("voice.probe | mundo isolado indisponivel" + (erro ? ": " + erro.error.message : ""));
            }
            return;
        }
        voiceIsolatedAvisado = false;
        if (!voiceHookLogado && escolhido.voice.voiceHooked === true) {
            voiceHookLogado = true;
            log("voice.hook | discord_voice interceptado no preload isolado");
        }
        const stream = streamNativaAtiva(escolhido.voice);
        const geracao = stream ? geracaoNativa(escolhido.voice, stream) : '';
        if (stream && geracao !== voiceUltimaGeracaoLogada) {
            voiceUltimaGeracaoLogada = geracao;
            log("voice.conn | tipo=stream geracao=" + stream.id + " estado=ativa");
        }
        logRtcNativo(escolhido);
        processarRtcNativo(escolhido);
    }).catch(error => {
        log("voice.probe | falha no vigia nativo: " + error.message);
    }).finally(() => { voiceProbeRodando = false; });
}

function idadeSeg(ha) {
    return ha < 0 ? "?" : Math.round(ha / 1000) + "s";
}

function reloadPorRevive(motivo) {
    if (reloading) return;
    const win = clientWindow();
    if (win === null) return;
    log("gw.revive | recarregando a janela (" + motivo + ")");
    win.webContents.reload();
}

function vigiarZumbi(resumo, win) {
    const agora = Date.now();
    const decisao = decidirRevive({
        agora,
        midiaAberta: resumo.midiaAberta === true,
        midiaRecente: agora - ultimaMidiaEm < GW_REVIVE_MIDIA_GRACA_MS,
        tentativas: zumbiTentativaEm,
        ultimaAcaoEm: zumbiUltimaAcaoEm,
        ultimaAcao: zumbiUltimaAcao
    });
    if (decisao.acao === 'nenhum') return;
    if (decisao.acao === 'banner') {
        // Ambiental: em call/midia recente (§6) ou teto de tentativas estourado — o usuario decide.
        if (!zumbiBannerAtivo) {
            log("gw.zumbi | confirmado mas acao manual (" + decisao.motivo + "): dispatches=" +
                resumo.dispatches + " intent_ha=" + idadeSeg(resumo.intentHa));
            zumbiBannerAtivo = true;
            showZumbiBanner();
        }
        return;
    }
    if (!autoRevive) {
        // Flag desligada: deteccao e log continuam, acao fica sendo do usuario (banner).
        if (!zumbiBannerAtivo) { zumbiBannerAtivo = true; showZumbiBanner(); }
        return;
    }
    zumbiTentativaEm.push(agora);
    zumbiUltimaAcaoEm = agora;
    zumbiUltimaAcao = decisao.acao;
    sessaoRevives++;
    if (decisao.acao === 'fechar') {
        log("gw.revive | nivel=1: fechando o ws do gateway (close 4000) para o cliente renascer com RESUME" +
            " (dispatches=" + resumo.dispatches + " intent_ha=" + idadeSeg(resumo.intentHa) + ")");
        reviveFecharEm = agora;
        reviveFecharGeracao = resumo.geracao;
        revivePendenteEm = agora;
        win.webContents.executeJavaScript('window.__goliveGwFechar ? window.__goliveGwFechar() : false')
            .then(ok => {
                if (ok !== true) log("gw.revive | nao consegui fechar o ws (shim ausente ou ws nao aberto)");
            })
            .catch(error => log("gw.revive | falhei ao fechar o ws: " + error.message));
    } else {
        log("gw.revive | nivel=2: o close nao curou (dispatches=" + resumo.dispatches + "), recarregando a janela");
        reviveFecharEm = 0;
        reloadPorRevive("zumbi persiste apos o close");
    }
}

function checarGatewaySilente() {
    const janelas = janelasCliente();
    if (janelas.length === 0) return;
    const polls = janelas.map(win =>
        win.webContents.executeJavaScript('window.__goliveGwResumo ? window.__goliveGwResumo() : null', true)
            .then(resumo => ({ win, resumo }))
            .catch(() => ({ win, resumo: null })),
    );
    Promise.all(polls).then(resultados => {
        const agora = Date.now();
        // Escolhe o resumo mais util: janela com gateway de preferencia (a #154
        // provou que pode haver mais de uma janela de cliente, nem toda com shim).
        let resumo = null;
        let winResumo = null;
        for (const r of resultados) {
            if (!r.resumo) continue;
            if (resumo === null || (r.resumo.estado !== 'nenhum' && resumo.estado === 'nenhum')) {
                resumo = r.resumo;
                winResumo = r.win;
            }
        }
        if (resumo === null) {
            // Silencio diagnosticavel: a #154 passou 3 minutos sem NENHUMA linha de
            // probe porque o resumo ausente era engolido aqui.
            log("gw.probe | estado=sem-shim: nenhuma janela do cliente respondeu ao probe");
            return;
        }
        log("gw.probe | estado=" + resumo.estado +
            " srv_ha=" + idadeSeg(resumo.srvHa) +
            " cli_ha=" + idadeSeg(resumo.cliHa) +
            " subs=" + resumo.subs +
            " srv_frames=" + resumo.srvFrames +
            " dispatch_ha=" + idadeSeg(resumo.dispatchHa) +
            " dispatches=" + resumo.dispatches +
            " intent_ha=" + idadeSeg(resumo.intentHa) +
            " activity_ha=" + idadeSeg(resumo.activityHa) +
            " op4_ha=" + idadeSeg(resumo.op4Ha) +
            " midia_open_ha=" + idadeSeg(resumo.midiaOpenHa) +
            " midia_close_ha=" + idadeSeg(resumo.midiaCloseHa) +
            " aberto_ha=" + idadeSeg(resumo.abertoHa) +
            " geracao=" + resumo.geracao +
            " ops=" + JSON.stringify(resumo.opCounts || {}) +
            " resp_bytes=" + resumo.srvBytesDesdeAtividade +
            (resumo.infladorOk === false ? " (sem decompress)" : ""));
        // Auto-cura do nivel 1: fechamos o ws e o cliente NAO renasceu a conexao —
        // o close nao surtiu; sobe direto pro reload (a cura que sempre funciona).
        if (reviveFecharEm > 0) {
            if (resumo.geracao !== reviveFecharGeracao || resumo.estado === 'aberta') {
                reviveFecharEm = 0; // renasceu: a escada segue do ponto certo
            } else if ((resumo.estado === 'fechada' || resumo.estado === 'nenhum') &&
                agora - reviveFecharEm > GW_REVIVE_RENASCE_MS) {
                log("gw.revive | o ws nao renasceu apos o close, subindo direto pro reload");
                reviveFecharEm = 0;
                zumbiTentativaEm.push(agora);
                zumbiUltimaAcaoEm = agora;
                zumbiUltimaAcao = 'reload';
                sessaoRevives++;
                reloadPorRevive("ws nao renasceu apos o close");
                return;
            }
        }
        const sinal = avaliarSinalGw(resumo, agora);
        if (sinal === 'zumbi') {
            vigiarZumbi(resumo, winResumo);
            return;
        }
        if (sinal === 'silente') {
            if (!zumbiBannerAtivo) { zumbiBannerAtivo = true; showZumbiBanner(); }
            return;
        }
        // Recuperacao: remover o banner e creditar a escada. O credito so vale com a
        // conexao SOBREVIVENDO ao aquecimento com dado fluindo — senao o READY da
        // conexao nova (que sempre chega) creditaria sucesso a um revive que nao curou.
        const servidorFalando = resumo.estado === 'aberta' && resumo.srvHa >= 0 && resumo.srvHa < GW_SERVIDOR_SILENCIOSO_MS;
        const dadoFluindo = resumo.dispatchHa >= 0 && resumo.dispatchHa < 60_000;
        if (zumbiBannerAtivo && servidorFalando && (dadoFluindo || resumo.infladorOk !== true)) {
            zumbiBannerAtivo = false;
            log("gateway voltou a responder: banner de sessao muda removido");
        }
        if (zumbiTentativaEm.length > 0 && servidorFalando && dadoFluindo &&
            resumo.abertoHa >= GW_ZUMBI_AQUECIMENTO_MS) {
            log("gw.revive | sucesso: dispatches voltaram apos " + zumbiTentativaEm.length + " tentativa(s)");
            zumbiTentativaEm.length = 0;
            zumbiUltimaAcaoEm = 0;
            zumbiUltimaAcao = null;
        }
        // A midia nativa e observada por checarRtcNativo() em um intervalo
        // proprio de 5s. O antigo RTCPeerConnection do Chromium continua no
        // shim apenas como diagnostico legado, mas nao participa de decisoes.
    });
}

// Shim + pill: prender em TODO webContents novo (o Discord recria janelas e
// recarrega o tempo todo). O shim vai via CDP — addScriptToEvaluateOnNewDocument
// roda antes do primeiro script da pagina, a unica forma garantida de envolver o
// WebSocket antes do cliente do gateway nascer. O pill vai no did-finish-load
// (DOM pronto) e reinjeta a cada recarga.
function injetarInstrumentacao(wc) {
    try {
        wc.debugger.attach('1.3');
        wc.debugger.sendCommand('Page.enable').catch(() => { });
        wc.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: SHIM_ALL_SRC }).catch(() => { });
    } catch (error) {
        log("nao consegui prender o shim do gateway: " + error.message);
    }
    wc.on('did-finish-load', () => {
        try {
            let url = '';
            try { url = wc.getURL(); } catch { return; }
            if (!CLIENT_URL_RE.test(url)) return;
            // Fallback do shim (issue #154: sessao inteira sem probe — o
            // addScriptToEvaluateOnNewDocument pode nao anexar em alguma janela). O
            // shim se auto-guarda (__goliveGwShim), entao reinjetar aqui e no-op
            // quando ele ja vive; quando nao vive, entra em linha e cobre as
            // reconexoes seguintes (a conexao corrente, se existir, so e coberta
            // no proximo reconnect do cliente).
            wc.executeJavaScript('({ gateway: !!window.__goliveGwShim, voice: !!window.__goliveVoiceShim })')
                .then(shims => {
                    let fonte = '';
                    if (!shims || shims.gateway !== true) fonte += SHIM_GATEWAY_SRC + '\n';
                    if (!shims || shims.voice !== true) fonte += SHIM_VOICE_SRC;
                    if (fonte === '') return;
                    log("gw.shim | shim ausente neste documento, reinjetando no did-finish-load" +
                        " (gateway=" + !!(shims && shims.gateway) + " voice=" + !!(shims && shims.voice) + ")");
                    return wc.executeJavaScript(fonte);
                })
                .then(() => { wc.executeJavaScript(REVIVE_SRC).catch(() => { }); })
                .catch(() => { });
        } catch { }
    });
}

app.on("web-contents-created", (_evento, wc) => {
    try { injetarInstrumentacao(wc); } catch (error) { log(error.message); }
});
// === gateway: probe no renderer + pill de recuperacao: fim ===

function markGatewayRouted() {
    lastRoutedAt = Date.now();
    ativaEntregouEm = Date.now();
    sessaoRoteadas++;
    if (reloadCount > 0) {
        // A recarga que foi disparada (maybeReloadAfterDirect) acabou de renascer:
        // mede o tempo entre o disparo (lastReloadAt) e este roteado.
        const levou = lastReloadAt === 0 ? "?" : (Date.now() - lastReloadAt) + "ms";
        log("recarga.renasceu | levou=" + levou +
            " saida=" + (chosenExit === null ? "nenhuma" : safeProxy(chosenExit)));
        sessaoReloads++;
    }
    reloadCount = 0;

    gatewayConnCount++;
    const vistoHa = ultimoVistoAt === 0 ? -1 : Date.now() - ultimoVistoAt;
    log("gw.roteado | n_sessao=" + gatewayConnCount +
        " visto_ha=" + (vistoHa < 0 ? "?" : vistoHa + "ms") +
        " saida=" + (chosenExit === null ? "nenhuma" : safeProxy(chosenExit)));
    if (revivePendenteEm > 0 && Date.now() - revivePendenteEm < GW_REVIVE_TTL_MS) {
        // Esta conexao foi provocada pelo NOSSO revive (close 4000): nao e recorrencia,
        // e a cura chegando. Sem aviso, sem auto-reload; a sessao recomeca a contar.
        log("gw.revive | reconexao do revive chegou: sessao renasce limpa");
        revivePendenteEm = 0;
        gatewayConnCount = 1;
    } else if (gatewayConnCount > 1) {
        const comMidia = Date.now() - ultimaMidiaEm < MIDIA_RECENTE_MS;
        log("gateway reconectou no meio da sessao (recorrencia " + (gatewayConnCount - 1) + ")"
            + (comMidia ? ": avisando na tela" : ", sem chamada em andamento"));
        if (comMidia) showReconnectWarning(gatewayConnCount - 1);
        else autoReloadForCleanEngine(gatewayConnCount - 1);
    }
    agendarEstat();
}

// Aviso visual DENTRO do Discord (nao um dialogo do sistema): um elemento nosso, flutuante,
// injetado via CDP. Nao mexe em nada do Discord, so soma um div — furtivo o bastante para nao
// atrapalhar a transmissao, visivel o bastante para a pessoa perceber e decidir.
const WARN_BANNER_TEXT = "GoLiveBypass: o gateway reconectou no meio da sessao. Se o video da " +
    "sua transmissao travou (ficou so o audio), clique em \"Reiniciar agora\" abaixo (ou " +
    "Ctrl+R) -- isso sai da chamada de voz.";

// Reconexao do gateway SEM midia recente (nem call, nem live): o motor de midia
// (WASM) pode ter ficado stale com o gateway morto — e a PROXIMA tentativa de
// transmitir que pega o "RTC connecting" eterno (issue #129: usuario no tor com
// circuito resetando a cada ~50s-4min, ws morrendo e renascendo). Recarregar a
// janela AGORA, fora de chamada, entrega um motor limpo para o proximo Go Live.
// Com midia recente NAO recarrega: encerraria a chamada da pessoa (o banner
// manual continua valendo ai). Resguardos: saida comprovadamente viva (probe) e
// no maximo 1 reload a cada 3 min, para o ws flapado nao virar loop de reload.
let ultimoAutoReloadMidia = 0;
function autoReloadForCleanEngine(recorrencias) {
    if (reloading) return;
    if (Date.now() - ultimoAutoReloadMidia < 3 * 60_000) return;
    const exit = chosenExit;
    if (exit === null) return;
    probe(exit, 2500).then(ok => {
        if (ok === null) {
            log("saida " + safeProxy(exit) + " nao respondeu, adiando o reload limpo");
            return;
        }
        ultimoAutoReloadMidia = Date.now();
        const win = clientWindow();
        if (win === null) return;
        log("reconexao sem midia: recarregando a janela para limpar o motor de midia (recorrencia " + recorrencias + ")");
        win.webContents.reload();
    }).catch(() => { });
}

function showReconnectWarning(recorrencias) {
    const win = clientWindow();
    if (win === null) return;

    // Um elemento so, sempre reaproveitado: se a pessoa nao fechar, a proxima reconexao
    // atualiza o texto (com a contagem) em vez de empilhar um banner por cima do outro.
    const script = "(function(){\n" +
        "  var el = document.getElementById('golivebypass-warn');\n" +
        "  if (!el) {\n" +
        "    el = document.createElement('div');\n" +
        "    el.id = 'golivebypass-warn';\n" +
        "    el.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:2147483647;" +
        "display:flex;align-items:flex-start;gap:10px;width:320px;" +
        "background:#2b2d31;color:#f2f3f5;padding:14px 16px;border-radius:10px;" +
        "border-left:4px solid #f0b232;" +
        "font:13px/1.45 \"gg sans\",-apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif;" +
        "box-shadow:0 8px 24px rgba(0,0,0,.45);" +
        "opacity:0;transform:translateY(8px);transition:opacity .2s ease,transform .2s ease;'; \n" +
        "    var icon = document.createElement('div');\n" +
        "    icon.textContent = '\\u26A0\\uFE0F';\n" +
        "    icon.style.cssText = 'font-size:18px;line-height:1;flex-shrink:0;margin-top:1px;';\n" +
        "    var body = document.createElement('div');\n" +
        "    body.style.cssText = 'flex:1;min-width:0;';\n" +
        "    var title = document.createElement('div');\n" +
        "    title.textContent = 'GoLiveBypass';\n" +
        "    title.style.cssText = 'font-weight:600;margin-bottom:3px;color:#fff;';\n" +
        "    var text = document.createElement('div');\n" +
        "    text.id = 'golivebypass-warn-text';\n" +
        "    text.style.cssText = 'color:#d8dadf;';\n" +
        "    var restartBtn = document.createElement('button');\n" +
        "    restartBtn.type = 'button';\n" +
        "    restartBtn.textContent = 'Reiniciar agora';\n" +
        "    restartBtn.style.cssText = 'margin-top:8px;padding:5px 10px;border:0;" +
        "border-radius:6px;background:#f0b232;color:#111214;font-weight:600;font-size:12px;" +
        "cursor:pointer;';\n" +
        "    restartBtn.onmouseenter = function(){ restartBtn.style.background = '#f5c862'; };\n" +
        "    restartBtn.onmouseleave = function(){ restartBtn.style.background = '#f0b232'; };\n" +
        // location.reload() roda no CONTEXTO da pagina do Discord (nao volta para o main
        // process): equivale exatamente ao Ctrl+R que o texto do banner ja recomendava, so
        // que num clique em vez de exigir o atalho de teclado.
        "    restartBtn.onclick = function(){ location.reload(); };\n" +
        "    body.appendChild(title);\n" +
        "    body.appendChild(text);\n" +
        "    body.appendChild(restartBtn);\n" +
        "    var closeBtn = document.createElement('div');\n" +
        "    closeBtn.textContent = '\\u2715';\n" +
        "    closeBtn.style.cssText = 'cursor:pointer;color:#949ba4;font-size:14px;flex-shrink:0;padding:2px;';\n" +
        "    closeBtn.onmouseenter = function(){ closeBtn.style.color = '#f2f3f5'; };\n" +
        "    closeBtn.onmouseleave = function(){ closeBtn.style.color = '#949ba4'; };\n" +
        "    closeBtn.onclick = function(){ el.remove(); };\n" +
        "    el.appendChild(icon);\n" +
        "    el.appendChild(body);\n" +
        "    el.appendChild(closeBtn);\n" +
        "    document.body.appendChild(el);\n" +
        "    requestAnimationFrame(function(){ el.style.opacity = '1'; el.style.transform = 'translateY(0)'; });\n" +
        "  }\n" +
        "  document.getElementById('golivebypass-warn-text').textContent = " + JSON.stringify(WARN_BANNER_TEXT) + " + " +
        "(" + recorrencias + " > 1 ? ' (aconteceu ' + " + recorrencias + " + ' vezes nesta sessao)' : '');\n" +
        "})();";

    win.webContents.executeJavaScript(script).catch(error => log("falhei ao mostrar aviso: " + error.message));
}

// Aviso INFORMATIVO (nao e alerta de erro) de que o Discord esta esperando o Tor terminar de
// subir no arranque frio -- sem isto a pessoa so ve "carregando" parado, sem saber se travou
// ou se e so demora normal (issue #116: "carregamento infinito ao abrir o aplicativo", visto
// so em modo tor, so ao ligar o PC junto com o Windows -- a GUI e um processo Electron a
// parte e o Discord nativo costuma vencer a corrida de arranque). Elemento com id proprio,
// diferente do banner de reconexao: os dois podem coexistir sem um apagar o outro.
const TOR_WAIT_BANNER_TEXT = "GoLiveBypass: aguardando o Tor terminar de iniciar para " +
    "liberar o Discord. Isso e normal logo apos ligar o PC e costuma levar menos de um " +
    "minuto -- esta janela some sozinha assim que o Tor responder.";

// Quanto insistir achando a janela do cliente antes de desistir do aviso, e de quanto em
// quanto tempo. O Discord mostra uma splash SEM url discord.com por um tempo antes do app de
// verdade (clientWindow() so acha a segunda) -- sem retry, chamar showTorBootBanner() uma vez
// so no start() perderia a janela sempre que ela ainda nao existisse, e o aviso nunca
// apareceria justamente no caso mais comum (arranque frio == Discord tambem acabou de abrir).
const TOR_BOOT_BANNER_RETRY_MS = 1500;
const TOR_BOOT_BANNER_MAX_WAIT_MS = 20_000;

function showTorBootBanner(limiteMs) {
    // coldTorHoldSince zera assim que settleExit acha uma saida (ver settleExit): se isso
    // aconteceu enquanto esperavamos a janela aparecer, o aviso perdeu a validade -- mostra-lo
    // agora só confundiria (diria "aguardando" de algo que ja foi resolvido).
    if (coldTorHoldSince === 0) return;

    const win = clientWindow();
    if (win === null) {
        const limite = limiteMs !== undefined ? limiteMs : Date.now() + TOR_BOOT_BANNER_MAX_WAIT_MS;
        if (Date.now() >= limite) return; // desiste; a janela nao apareceu a tempo
        setTimeout(() => showTorBootBanner(limite), TOR_BOOT_BANNER_RETRY_MS);
        return;
    }

    // Sem contagem/atualizacao de texto (ao contrario do banner de reconexao): este e um
    // estado de "ainda nao", nao um evento que se repete -- se o elemento ja existe, nao ha
    // nada novo para mostrar.
    const script = "(function(){\n" +
        "  var el = document.getElementById('golivebypass-tor-wait');\n" +
        "  if (el) return;\n" +
        "  el = document.createElement('div');\n" +
        "  el.id = 'golivebypass-tor-wait';\n" +
        "  el.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:2147483647;" +
        "display:flex;align-items:flex-start;gap:10px;width:320px;" +
        "background:#2b2d31;color:#f2f3f5;padding:14px 16px;border-radius:10px;" +
        "border-left:4px solid #5865f2;" +
        "font:13px/1.45 \"gg sans\",-apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif;" +
        "box-shadow:0 8px 24px rgba(0,0,0,.45);" +
        "opacity:0;transform:translateY(8px);transition:opacity .2s ease,transform .2s ease;';\n" +
        "  var icon = document.createElement('div');\n" +
        "  icon.textContent = '\u23F3';\n" +
        "  icon.style.cssText = 'font-size:18px;line-height:1;flex-shrink:0;margin-top:1px;';\n" +
        "  var body = document.createElement('div');\n" +
        "  body.style.cssText = 'flex:1;min-width:0;';\n" +
        "  var title = document.createElement('div');\n" +
        "  title.textContent = 'GoLiveBypass';\n" +
        "  title.style.cssText = 'font-weight:600;margin-bottom:3px;color:#fff;';\n" +
        "  var text = document.createElement('div');\n" +
        "  text.style.cssText = 'color:#d8dadf;';\n" +
        "  text.textContent = " + JSON.stringify(TOR_WAIT_BANNER_TEXT) + ";\n" +
        "  body.appendChild(title);\n" +
        "  body.appendChild(text);\n" +
        "  el.appendChild(icon);\n" +
        "  el.appendChild(body);\n" +
        "  document.body.appendChild(el);\n" +
        "  requestAnimationFrame(function(){ el.style.opacity = '1'; el.style.transform = 'translateY(0)'; });\n" +
        "})();";

    win.webContents.executeJavaScript(script).catch(error => log("falhei ao mostrar aviso de espera do Tor: " + error.message));
}

function hideTorBootBanner() {
    const win = clientWindow();
    if (win === null) return;
    const script = "(function(){ var el = document.getElementById('golivebypass-tor-wait'); " +
        "if (el) { el.style.opacity = '0'; setTimeout(function(){ el.remove(); }, 250); } })();";
    win.webContents.executeJavaScript(script).catch(() => { });
}

// Prazo/intervalo de retentativa iguais aos do showTorBootBanner -- mesmo motivo: chooseExit()
// roda em start(), antes de a janela do CLIENTE existir (o Discord mostra uma splash sem url
// discord.com primeiro).
const MANUAL_PROXY_BANNER_RETRY_MS = 1500;
const MANUAL_PROXY_BANNER_MAX_WAIT_MS = 20_000;

const MANUAL_PROXY_BANNER_TEXT = "GoLiveBypass: a proxy que voce configurou nao respondeu " +
    "(varias vezes seguidas). Por enquanto o app esta usando uma saida automatica no lugar " +
    "dela. Reiniciar o Discord (ou dar Ctrl+R) nao resolve isso -- confira o endereco, " +
    "usuario e senha da proxy em Configuracoes.";

// So uma vez por processo (a flag e checada aqui dentro, nao no chamador): chooseExit() so
// chama isto depois do limite de falhas seguidas, mas o probe de fundo continua rodando a
// cada abertura de conexao -- sem a flag, cada falha nova tentaria mostrar/empilhar o aviso
// de novo.
function showManualProxyFailedBanner(limiteMs) {
    if (manualProxyBannerMostrado) return;

    const win = clientWindow();
    if (win === null) {
        const limite = limiteMs !== undefined ? limiteMs : Date.now() + MANUAL_PROXY_BANNER_MAX_WAIT_MS;
        if (Date.now() >= limite) return; // desiste; a janela nao apareceu a tempo
        setTimeout(() => showManualProxyFailedBanner(limite), MANUAL_PROXY_BANNER_RETRY_MS);
        return;
    }

    manualProxyBannerMostrado = true;

    const script = "(function(){\n" +
        "  var el = document.getElementById('golivebypass-manual-proxy-warn');\n" +
        "  if (el) return;\n" +
        "  el = document.createElement('div');\n" +
        "  el.id = 'golivebypass-manual-proxy-warn';\n" +
        "  el.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:2147483647;" +
        "display:flex;align-items:flex-start;gap:10px;width:320px;" +
        "background:#2b2d31;color:#f2f3f5;padding:14px 16px;border-radius:10px;" +
        "border-left:4px solid #f0b232;" +
        "font:13px/1.45 \"gg sans\",-apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif;" +
        "box-shadow:0 8px 24px rgba(0,0,0,.45);" +
        "opacity:0;transform:translateY(8px);transition:opacity .2s ease,transform .2s ease;';\n" +
        "  var icon = document.createElement('div');\n" +
        "  icon.textContent = '\u26A0\uFE0F';\n" +
        "  icon.style.cssText = 'font-size:18px;line-height:1;flex-shrink:0;margin-top:1px;';\n" +
        "  var body = document.createElement('div');\n" +
        "  body.style.cssText = 'flex:1;min-width:0;';\n" +
        "  var title = document.createElement('div');\n" +
        "  title.textContent = 'GoLiveBypass';\n" +
        "  title.style.cssText = 'font-weight:600;margin-bottom:3px;color:#fff;';\n" +
        "  var text = document.createElement('div');\n" +
        "  text.style.cssText = 'color:#d8dadf;';\n" +
        "  text.textContent = " + JSON.stringify(MANUAL_PROXY_BANNER_TEXT) + ";\n" +
        "  body.appendChild(title);\n" +
        "  body.appendChild(text);\n" +
        "  var closeBtn = document.createElement('div');\n" +
        "  closeBtn.textContent = '\\u2715';\n" +
        "  closeBtn.style.cssText = 'cursor:pointer;color:#949ba4;font-size:14px;flex-shrink:0;padding:2px;';\n" +
        "  closeBtn.onmouseenter = function(){ closeBtn.style.color = '#f2f3f5'; };\n" +
        "  closeBtn.onmouseleave = function(){ closeBtn.style.color = '#949ba4'; };\n" +
        "  closeBtn.onclick = function(){ el.remove(); };\n" +
        "  el.appendChild(icon);\n" +
        "  el.appendChild(body);\n" +
        "  el.appendChild(closeBtn);\n" +
        "  document.body.appendChild(el);\n" +
        "  requestAnimationFrame(function(){ el.style.opacity = '1'; el.style.transform = 'translateY(0)'; });\n" +
        "})();";

    win.webContents.executeJavaScript(script).catch(error => log("falhei ao mostrar aviso de proxy manual: " + error.message));
}

// O Tor respondeu depois de um arranque frio (issue #116): a conexao de gateway que estava
// segurada pode ja ter sido recusada (TOR_HOLD_BUDGET_MS estourado antes do Tor ficar
// pronto), e dai em diante quem decide QUANDO tentar de novo e o proprio Discord -- pode ser
// rapido, pode demorar bem mais que isto. Recarregar a janela agora forca uma tentativa
// imediata pela saida que acabou de ficar pronta, em vez de confiar no backoff dele. Guardas:
// saida comprovadamente viva (probe) e cancela se o gateway ja roteou sozinho enquanto o
// probe rodava (a conexao que estava esperando em currentExit foi entregue direto pelo
// waitingForExit, sem precisar de reload nenhum).
function maybeReloadAfterColdHold() {
    if (reloading) return;
    const exit = chosenExit;
    if (exit === null) return;

    reloading = true;
    probe(exit, 2500).then(ok => {
        if (ok === null) {
            log("saida " + safeProxy(exit) + " nao respondeu, adiando a recarga do arranque frio");
            return;
        }
        if (Date.now() - lastRoutedAt < 3000) {
            log("gateway ja roteou sozinho, recarga do arranque frio desnecessaria");
            return;
        }
        const win = clientWindow();
        if (win === null) return;
        reloadCount++;
        lastReloadAt = Date.now();
        log("Tor respondeu depois do arranque frio, recarregando atras de " + safeProxy(exit));
        win.webContents.reload();
    }).catch(error => {
        log("a checagem antes da recarga do arranque frio falhou: " + error.message);
    }).finally(() => {
        reloading = false;
    });
}

// Exposto para a bateria de testes (tests/test-exit-refresh.sh) marcar o sinal sem depender
// de uma conexao de gateway real no sandbox. Inofensivo em producao: so seta o mesmo
// timestamp que o serveSocks setaria ao abrir direto.
function _testMarkGatewayDirect() {
    gatewayWentDirectAt = Date.now();
}

// Exposto para a bateria de testes: marca o arranque frio em modo tor sem depender do
// start() inteiro (que sobe roteador local, instala PAC etc. -- pesado demais para o
// sandbox). Inofensivo em producao: so seta o mesmo timestamp que o start() setaria ao
// nao achar Tor no arranque.
function _testMarkColdTorHold() {
    coldTorHoldSince = Date.now();
}

// Exposto para a bateria de testes: marca "o gateway acabou de rotear" sem depender de uma
// conexao real no sandbox. Inofensivo em producao: so seta o mesmo timestamp que
// markGatewayRouted() setaria.
function _testMarkGatewayRouted() {
    lastRoutedAt = Date.now();
}

// Uma conexao de gateway que chega antes de existir saida espera aqui, e nao para sempre:
// estourado o prazo ela sai direta -- exceto no cold start do modo "gratuitas", onde o
// fallback do Tor local (#85) entra antes do direct (ver poolFrio). Discord aberto sem
// bypass e ruim; Discord que nao abre e muito pior, e foi o pior defeito que este projeto
// ja teve.
function currentExit() {
    if (exitSettled) return Promise.resolve(chosenExit);

    return new Promise(resolve => {
        const prazo = routeMode === "tor" ? TOR_HOLD_BUDGET_MS : HOLD_BUDGET_MS;
        const refreshRunning = refreshingExit;

        const timer = setTimeout(() => {
            const index = waitingForExit.indexOf(deliver);
            if (index >= 0) waitingForExit.splice(index, 1);
            log(routeMode === "tor"
                ? "a saida confiavel nao ficou pronta a tempo; recusando esta conexao, sem proxy publica"
                : "a proxy configurada nao ficou pronta a tempo; esta conexao pode seguir direta");
            resolve(null);
        }, prazo);

        const deliver = proxy => {
            clearTimeout(timer);
            resolve(proxy);
        };

        waitingForExit.push(deliver);

        if (refreshRunning !== null) {
            refreshRunning.then(() => {
                if (chosenExit !== null) {
                    const index = waitingForExit.indexOf(deliver);
                    if (index >= 0) waitingForExit.splice(index, 1);
                    clearTimeout(timer);
                    resolve(chosenExit);
                }
            });
        }
    });
}

// Todas as saidas conhecidas morreram no meio da sessao (acontece o tempo todo com saida
// gratuita). Em vez de cair para direto — que e o IP bloqueado, e o "carregando para sempre" —
// procura uma saida nova agora. Cooldown e dedupe: uma busca por vez, e nunca antes de 30s
// depois da ultima, senao uma saida ruim derrubaria a API de saidas num loop.
function refreshExit() {
    if (refreshingExit !== null) return refreshingExit;
    if (Date.now() - lastRefreshAt < REFRESH_COOLDOWN_MS) return Promise.resolve(null);

    lastRefreshAt = Date.now();
    refreshingExit = (async () => {
        const manual = manualProxy();
        let fresh = null;

        if (manual !== null && manual !== "") {
            const ok = await probe(manual, HEARTBEAT_TIMEOUT_MS);
            fresh = ok === null ? null : manual;
            if (fresh === null) log("proxy configurada ainda nao respondeu; nenhuma reserva publica sera buscada");
        } else {
            fresh = await detectTor(3000);
            if (fresh === null) log("Tor ainda nao respondeu; nenhuma reserva publica sera buscada");
        }

        if (fresh !== null) {
            settleExit(fresh);
            log("saida confiavel recuperada: " + safeProxy(fresh));
        }
        return fresh;
    })();

    return refreshingExit.finally(() => { refreshingExit = null; });
}

// ------------------------------------------------------------------ manter reserva viva

// Saida gratuita nao avisa que morreu: ela para de encaminhar, e quem descobre e a conexao que
// estava passando por ela. No meio de uma transmissao isso custa a sessao inteira -- o gateway
// reconecta, e se reconectar direto o servidor reavalia a conta e o video cai. O refreshExit
// conserta isso depois que a conexao ja falhou; o batimento existe para que ela nao falhe: de
// trinta em trinta segundos a ativa e as reservas sao reconferidas, e a troca acontece antes de
// o Discord precisar.
// Quanto esperar entre tentativas de voltar pra saida manual depois que a sessao caiu dela
// (para free/pool). Uma queda na VM pode ser passageira -- medido ao vivo em 2026-08-26: uma
// saida manual ficou fora por 48min e voltou sozinha -- e sem isto o app nunca mais tentava a
// saida de confianca da pessoa, nem com ela ja saudavel de novo: so reabrir o Discord resolvia.
const MANUAL_RETRY_COOLDOWN_MS = 90_000;
let lastManualRetryAt = 0;

// So mexe fora de chamada/transmissao em andamento (ultimaMidiaEm): reconectar o gateway no
// meio de uma Live e o proprio problema que a saida manual foi blindada contra em
// trySwapByRtt. Recuperar e melhor que ficar preso em gratuita, mas nao a troco de derrubar
// uma Live que por acaso esteja de pe na saida de fallback.
//
// Modo "tor" tem politica propria (so Tor conta) -- trocar a saida ativa Tor por uma proxy
// nao-Tor configurada em settings.proxy violaria a escolha da pessoa, igual ao que
// trySwapByRtt e stockReserves ja fazem.
async function tryReturnToManual() {
    if (routeMode === "tor") return;
    if (!usingManualProxy || isManualAddress(chosenExit)) return;
    if (Date.now() - ultimaMidiaEm < MIDIA_RECENTE_MS) return;
    if (Date.now() - lastManualRetryAt < MANUAL_RETRY_COOLDOWN_MS) return;
    lastManualRetryAt = Date.now();

    const manual = manualProxy();
    if (manual === null || manual === "") return;

    const ok = await probe(manual, HEARTBEAT_TIMEOUT_MS);
    if (ok === null) return;

    // Troca silenciosa: NAO chama trocarPara() para nao disparar o banner amarelo de
    // "reconexao no meio da sessao" na proxima reconexao. A guarda de midia recente
    // (MIDIA_RECENTE_MS) acima ja garante que NAO estamos em Live agora, mas a proxima
    // reconexao pode acontecer minutos depois, com o timestamp de midia ja ultrapassando
    // o MIDIA_RECENTE_MS (cenario: Live terminou pouco antes do fim da janela, a troca
    // acontece logo depois dela, e o gateway reconecta logo em seguida -- banner dispara
    // sem motivo). Zera o contador para que
    // a proxima reconexao seja contada como a primeira desta "sub-sessao" (sem recorrencia
    // para o banner). Mantem o cooldown de SWAP_COOLDOWN_MS manualmente para nao abrir
    // porta para trySwapByRtt em seguida.
    ultimaTrocaProativaEm = Date.now();
    gatewayReconexoes.length = 0;
    missedBeats.delete(manual);
    rttLentoSeguidas.delete(manual);
    const antiga = chosenExit;
    const vida = antiga === null || lastExitAt === 0 ? "?" : Math.round((Date.now() - lastExitAt) / 1000) + "s";
    log("saida.trocada | de=" + (antiga === null ? "nenhuma" : safeProxy(antiga)) +
        " para=" + safeProxy(manual) +
        " motivo=saida manual voltou a responder" +
        " vida_da_antiga=" + vida);
    chosenExit = manual;
    lastExitAt = Date.now();
    gatewayConnCount = 0;
}

async function beat() {
    // Um batimento lento nunca pode se sobrepor ao proximo: seriam duas rodadas de conexoes na
    // mesma saida ao mesmo tempo, que e justamente o que derruba as fracas.
    if (beating) return;
    beating = true;

    try {
        // Modo "tor" sem saida ativa (arranque sem Tor, ou Tor morreu antes de qualquer
        // escolha): re-tenta o Tor AQUI. Sem isto ninguem mais chamaria detectTor — os
        // caminhos do batimento so rodam com uma saida ativa — e a sessao ficaria presa
        // para sempre recusando conexoes mesmo depois de o Tor voltar.
        if (routeMode === "tor" && chosenExit === null) {
            const tor = await detectTor();
            if (tor !== null) {
                settleExit(tor);
                log("modo tor: Tor respondeu de novo em " + TOR_ADDR + ", religando a rota");
            }
            return;
        }
        await checkPool();
        await tryReturnToManual();
    } catch (error) {
        // Batimento e rede de seguranca. Se ele falhar, o caminho antigo continua valendo:
        // falhar no trafego vivo, cair para a reserva e, no fim, o refreshExit.
        log("o batimento falhou: " + error.message);
    } finally {
        beating = false;
    }
}

async function checkPool() {
    const active = chosenExit;

    // Modo tor: a saida e UNICA e o batimento nunca a derruba. O Tor renova os
    // circuitos a cada ~10 min (MaxCircuitDirtiness) e o probe de 4s falha durante
    // a construcao do circuito novo — derrubar a saida nesse falso negativo criava
    // a janela de recusa do gateway: reconexao segurada ate um probe passar,
    // repetida a cada rotacao (log da issue #122 mostra 30 e 57 MINUTOS sem ver o
    // gateway). Agora o probe e so informativo, com timeout folgado pra construcao
    // de circuito; a reconexao tenta o tunel direto e passa quando o circuito fica
    // pronto. A morte REAL do daemon e tratada pelo listening() do detectTor no
    // refreshExit — e pelo watchdog da GUI, que ressuscita o processo.
    if (routeMode === "tor") {
        if (active === null) return; // o beat ja tenta o detectTor nesse caso
        const ok = await probe(active, HEARTBEAT_TIMEOUT_MS * 4) !== null;
        if (ok) missedBeats.delete(active);
        else log("batimento do Tor falhou (circuito construindo?); mantendo a saida");
        return;
    }

    if (usingManualProxy) {
        if (active === null) {
            refreshExit().catch(error => log("retry da proxy configurada falhou: " + error.message));
            return;
        }
        const ok = await probe(active, HEARTBEAT_TIMEOUT_MS) !== null;
        if (ok) {
            missedBeats.delete(active);
            return;
        }
        const count = (missedBeats.get(active) || 0) + 1;
        missedBeats.set(active, count);
        if (count >= MAX_MISSED_BEATS) {
            missedBeats.delete(active);
            log("proxy configurada perdeu " + MAX_MISSED_BEATS + " batimentos; tentando somente ela novamente");
            refreshExit().catch(error => log("retry da proxy configurada falhou: " + error.message));
        }
        return;
    }

    // Codigo legado de pool fica inacessivel no enhanced: routeMode so chega aqui
    // sem Tor quando ha uma proxy explicita, coberta acima.
    // A ativa entra na rodada mesmo estando fora do pote: proxy do settings.json e Tor local
    // nunca sao guardados, e sao exatamente os que a pessoa mais sente quando caem.
    const targets = [];
    // Camada 3: se a ativa entregou trafego de gateway dentro da janela do batimento, ela
    // esta viva por definicao — pular o probe dela poupa uma conexao na saida gratuita, que
    // limita conexoes simultaneas. A morte real cai no openThroughPool e vira troca ali.
    if (active !== null && Date.now() - ativaEntregouEm > HEARTBEAT_MS) targets.push(active);
    for (const entry of pool) if (!targets.includes(entry.proxy)) targets.push(entry.proxy);
    if (targets.length === 0) return;

    const beats = await Promise.all(targets.map(async proxy => ({
        proxy: proxy,
        ok: await probe(proxy, HEARTBEAT_TIMEOUT_MS) !== null
    })));

    const dead = [];
    for (const entry of beats) {
        if (entry.ok) {
            missedBeats.delete(entry.proxy);
            continue;
        }

        const count = (missedBeats.get(entry.proxy) || 0) + 1;
        missedBeats.set(entry.proxy, count);
        if (count >= MAX_MISSED_BEATS) dead.push(entry.proxy);
    }

    if (dead.length > 0) {
        const survivors = pool.filter(entry => !dead.includes(entry.proxy));
        if (survivors.length !== pool.length) {
            log("fora do pote: " + dead.map(safeProxy).join(", ") + " (sem resposta em " + MAX_MISSED_BEATS + " batimentos)");
            pool = survivors;
            savePool();
        }

        for (const proxy of dead) missedBeats.delete(proxy);
    }

    const live = beats.filter(entry => entry.ok).map(entry => entry.proxy);

    // A ativa que foi pulada (entregou trafego na janela) e considerada viva: ela nao passou
    // por probe, mas tem prova viva de que funciona.
    if (active !== null && !targets.includes(active) && !live.includes(active)) live.push(active);

    // A ativa e trocada no primeiro erro, nao no segundo: trocar nao custa nada -- socket que ja
    // esta de pe continua no tunel antigo, so conexao nova nasce pela reserva -- e a proxima
    // conexao do gateway pode ser a reconexao que decide a transmissao.
    if (active !== null && !live.includes(active)) {
        const reserve = live.find(proxy => proxy !== active);
        if (reserve === undefined) {
            // Nada vivo. Comeca a busca agora, em vez de esperar a proxima conexao descobrir:
            // o refreshExit ja tem dedupe e cooldown, entao chamar daqui nao duplica trabalho.
            log(safeProxy(active) + " perdeu o batimento e nao ha reserva viva");
            refreshExit().catch(error => log("a busca por saida nova falhou: " + error.message));
            return;
        }

        // Emergencia (a ativa morreu): troca direto, sem cooldown.
        // No modo "tor" nao existe reserva que valha a pena: o Tor e a escolha explicita e
        // trocar para gratuita violaria o pedido. Segura — o refresh continua tentando o Tor.
        if (routeMode === "tor") {
            log("modo tor: o Tor caiu, segurando o gateway (sem saida direta)");
            refreshExit().catch(error => log("a busca pelo Tor falhou: " + error.message));
            return;
        }
        trocarPara(reserve, "perdeu o batimento");
    } else if (active !== null) {
        // A ativa esta viva no probe. Mesmo viva, pode estar lenta demais para o gateway
        // (RTT EMA alto): trocar antes de o websocket sofrer.
        const trocar = trySwapByRtt(active, live);
        if (trocar !== null) chosenExit = trocar;
    }

    // Sempre ordena o pool pelo RTT (EMA) ao salvar: a melhor reserva para assumir na hora
    // e a mais rapida, nao a que chegou primeiro.
    pool = [...pool].sort((a, b) => (a.proxy === chosenExit ? -1 : b.proxy === chosenExit ? 1 : (rttEma.get(a.proxy) ?? a.ms) - (rttEma.get(b.proxy) ?? b.ms)));
    savePool();

    stockReserves(live.filter(proxy => proxy !== chosenExit).length);
}

// A saida ativa passa no probe mas esta entregando mal (RTT EMA acima do teto por
// RTT_TROCA_BATIDAS batimentos seguidos). Troca para a reserva viva mais rapida antes de o
// gateway sofrer. Devolve a nova saida, ou null se nao houver troca.
function trySwapByRtt(active, live) {
    // No modo "tor" a saida e uma escolha explicita da pessoa: o RTT alto do Tor e normal
    // (1-1.4s medido) e trocar para gratuita violaria a escolha. Soh troca se o Tor morrer.
    if (routeMode === "tor") return null;

    // Saida manual/privada: as "reservas" no range multiplexado sao portas do MESMO servidor,
    // com RTT praticamente identico -- entao SWAP_RESERVA_RAZAO quase sempre deixa passar, e
    // qualquer chacoalhada de rede vira troca. Toda troca reconecta o gateway, e o motor de
    // voz/video do Discord (WASM) nao sobrevive a isso com a Live no ar: o video cai pra
    // sempre (so audio) mesmo trocando para uma saida boa. Nao vale o risco por causa de RTT.
    if (usingManualProxy) return null;

    const ema = rttEma.get(active);
    if (ema === undefined || ema < RTT_TROCA_MS) {
        rttLentoSeguidas.delete(active);
        return null;
    }

    const ruins = (rttLentoSeguidas.get(active) || 0) + 1;
    rttLentoSeguidas.set(active, ruins);
    if (ruins < RTT_TROCA_BATIDAS) {
        log(safeProxy(active) + " com RTT alto (" + Math.round(ema) + "ms), " + ruins + "/" + RTT_TROCA_BATIDAS + " batimentos");
        return null;
    }

    // Cooldown: quando o pool inteiro esta lento, esperar o cooldown antes de trocar de
    // novo evita o ping-pong entre ruins (cada troca renasce o gateway a toa).
    if (!trocaProativaPode()) {
        rttLentoSeguidas.delete(active);
        return null;
    }

    // Pelo menos 1 batimento de folga antes de trocar de novo pela mesma causa: evita
    // cascata quando a reserva tambem esta lenta.
    const alvo = live
        .filter(proxy => proxy !== active)
        .sort((a, b) => (rttEma.get(a) ?? Infinity) - (rttEma.get(b) ?? Infinity))[0];
    if (alvo === undefined) {
        log(safeProxy(active) + " lento mas sem reserva viva para trocar");
        rttLentoSeguidas.delete(active);
        return null;
    }

    // So vale trocar para uma reserva que nao seja visivelmente pior: a atual ja esta ruim,
    // mas piorar (ou trocar pelo mesmo nivel) so renasce o gateway a toa.
    const emaAlvo = rttEma.get(alvo) ?? Infinity;
    if (emaAlvo > ema * SWAP_RESERVA_RAZAO) {
        log(safeProxy(active) + " lento (" + Math.round(ema) + "ms EMA) e reserva pior (" + Math.round(emaAlvo) + "ms), mantendo e buscando reserva melhor");
        rttLentoSeguidas.delete(active);
        return null;
    }

    trocarPara(alvo, "ativa lenta " + Math.round(ema) + "ms EMA");
    rttLentoSeguidas.delete(active);
    return alvo;
}

// Repor reserva nao pode passar pelo refreshExit: aquele caminho troca a saida ativa, e trocar
// de IP com a ativa saudavel pediria uma reavaliacao do servidor a toa. Aqui o pote enche por
// baixo e quem esta entregando continua entregando.
function stockReserves(liveReserves) {
    // No modo "tor" nao existe reserva legitima: encher o pote com gratuitas violava a
    // escolha da pessoa e um dia essas gratuitas venciam o fallback do openThroughPool,
    // trocando a sessao pra fora do Tor sem ninguem pedir (visto ao vivo em 2026-08-23).
    if (routeMode === "tor") return;

    // Saida manual/privada (com ou sem range): nao ha ganho em manter reserva quente. O pote
    // so serve para a troca proativa por RTT (desligada para manual, ver trySwapByRtt) e para
    // o fallback de trafego morto no openThroughPool -- que ja tem seu proprio caminho via
    // refreshExit/huntExits quando a ativa falha de verdade. Manter isto vazio evita testar o
    // range inteiro (ate 51 portas em paralelo) a cada poucos minutos so para guardar reserva
    // que nunca vai ser usada.
    if (usingManualProxy) return;
    if (liveReserves >= MIN_LIVE_RESERVES || stocking !== null) return;

    // Relogio proprio, separado do refreshExit de proposito. Compartilhar os dois fazia a
    // reposicao de rotina adiar a busca de emergencia: o pote esvazia justamente quando as
    // saidas estao morrendo, que e quando a ativa tambem morre, entao a conexao de gateway que
    // pedisse socorro nessa janela sairia direta. Era a falha que este batimento existe para
    // impedir.
    if (Date.now() - lastStockAt < STOCK_COOLDOWN_MS) return;

    lastStockAt = Date.now();
    log("o pote esta com " + liveReserves + " reserva(s) viva(s), procurando mais em segundo plano");

    stocking = huntExits().then(aprovadas => {
        const known = pool.map(entry => entry.proxy);
        const fresh = aprovadas.filter(entry => !known.includes(entry.proxy));
        if (fresh.length === 0) return;

        // A ativa fica no pote mesmo sendo mais lenta que as novas: ela e o IP que o servidor ja
        // aceitou nesta sessao, e trocar por velocidade custaria uma reavaliacao.
        pool = [...pool, ...fresh]
            .sort((a, b) => (a.proxy === chosenExit ? -1 : b.proxy === chosenExit ? 1 : a.ms - b.ms))
            .slice(0, POOL_SIZE);

        savePool();
        log(fresh.length + " reserva(s) nova(s) no pote");
    }).catch(error => log("a busca de reserva falhou: " + error.message))
        .finally(() => { stocking = null; lastStockAt = Date.now(); });
}

// ------------------------------------------------------------------ o roteador local

function refuse(client) {
    if (!client.destroyed) client.end(Buffer.from([5, 2, 0, 1, 0, 0, 0, 0, 0, 0]));
}

function readTarget(client, done) {
    readReply(client, buffer => {
        if (buffer.length < 5) return -1;
        if (buffer[3] === 1) return 10;
        if (buffer[3] === 4) return 22;
        if (buffer[3] === 3) return 7 + buffer[4];
        return -1;
    }, message => {
        if (message === null || message[1] !== 1) return done(null);

        if (message[3] === 3) {
            const length = message[4];
            return done({ host: message.subarray(5, 5 + length).toString("utf8"), port: message.readUInt16BE(5 + length) });
        }
        if (message[3] === 1) return done({ host: Array.from(message.subarray(4, 8)).join("."), port: message.readUInt16BE(8) });

        return done(null);
    });
}

function openDirect(target) {
    return new Promise(resolve => {
        let settled = false;
        const finish = value => {
            if (settled) return;
            settled = true;
            if (value === null) direct.destroy();
            else direct.setTimeout(0);
            resolve(value);
        };

        const direct = connect({ host: target.host, port: target.port });
        direct.setTimeout(PROBE_TIMEOUT_MS, () => finish(null));
        direct.on("error", () => finish(null));
        direct.once("connect", () => finish(direct));
    });
}

// Abre o mesmo destino por varias saidas ao mesmo tempo e fica com a primeira que responder.
// Quem chega depois e fechado na hora: tunel aberto e esquecido segura uma conexao do outro
// lado, e saida gratuita costuma ter poucas.
function firstTunnel(candidates, target, timeoutMs) {
    return new Promise(resolve => {
        let pending = candidates.length;
        if (pending === 0) return resolve(null);

        let settled = false;

        for (const candidate of candidates) {
            openTunnel(candidate, target.host, target.port, timeoutMs).then(socket => {
                if (socket !== null && !settled) {
                    settled = true;
                    return resolve({ proxy: candidate, socket: socket });
                }

                if (socket !== null) socket.destroy();
                if (--pending === 0 && !settled) resolve(null);
            });
        }
    });
}

// Tenta a saida ativa e, se ela nao entregar, as reservas ja testadas. Trocar aqui custa uma
// conexao; esperar a proxima abertura do Discord custa a sessao inteira sem bypass.
async function openThroughPool(target) {
    const active = await currentExit();
    if (active === null) return null;

    const started = Date.now();
    const prazoTunel = routeMode === "tor" ? TOR_RELAY_TIMEOUT_MS : RELAY_TIMEOUT_MS;
    let socket = await openTunnel(active, target.host, target.port, prazoTunel);
    if (socket !== null) {
        markGatewayRouted();
        log("tunel.aberto | alvo=" + target.host + " saida=" + safeProxy(active) + " via=ativa latencia=" + (Date.now() - started) + "ms");
        return socket;
    }

    log(safeProxy(active) + " nao entregou " + target.host + "; nenhuma reserva publica sera tentada");

    const fresh = await refreshExit();
    if (fresh === null) return null;

    const retryTimeout = routeMode === "tor" ? TOR_RELAY_TIMEOUT_MS : RELAY_TIMEOUT_MS;
    socket = await openTunnel(fresh, target.host, target.port, retryTimeout);
    if (socket !== null) {
        chosenExit = fresh;
        lastExitAt = Date.now();
        markGatewayRouted();
        log("tunel.aberto | alvo=" + target.host + " saida=" + safeProxy(fresh) + " via=retry-confiavel latencia=" + (Date.now() - started) + "ms");
        return socket;
    }

    log(safeProxy(fresh) + " nao entregou " + target.host + " depois do retry confiavel");
    return null;
}

// O PAC roteia por sufixo de dominio de proposito: o Discord conecta o gateway em
// subdominios regionais (gateway-us-east1-b.discord.gg — o "-us-east1-b" vem ANTES de
// discord.gg), e o match exato deixava essas conexoes fora do roteador: o gateway nascia
// direto pelo IP brasileiro e o servidor bloqueava a sessao (o "carregando infinitamente").
// Roteamos *.discord.gg inteiro (gateway, remote-auth-gateway e qualquer subdominio futuro);
// os CDNs de midia sao discordapp.com, outro dominio, e nao passam por aqui.
const ROUTE_SUFFIX = ".discord.gg";

function isRoutedHost(host) {
    return host === "discord.gg" || host.endsWith(ROUTE_SUFFIX);
}

function serveSocks(client) {
    client.on("error", () => client.destroy());
    // Entrada malformada deixaria o socket pendurado para sempre, porque a negociacao nunca
    // completa e ninguem fecha. O prazo cobre isso.
    client.setTimeout(PROBE_TIMEOUT_MS, () => client.destroy());

    readReply(client, buffer => (buffer.length < 2 ? -1 : 2 + buffer[1]), greeting => {
        if (greeting === null || greeting[0] !== 5) return client.destroy();

        client.write(Buffer.from([5, 0]));
        readTarget(client, async target => {
            if (target === null) return refuse(client);

            // O roteador so aceita os hosts que o PAC manda para ele. Sem esta linha ele seria
            // um SOCKS aberto no loopback: qualquer processo da maquina usaria a sua saida para
            // qualquer destino, com a identidade do Discord no firewall.
            if (!isRoutedHost(target.host)) {
                log("recusando destino fora da lista: " + target.host);
                return refuse(client);
            }

            // Sucesso respondido antes de saber a saida, de proposito: o Chromium para de usar
            // um roteador que responda lento, e segurar a resposta aqui deixava o Discord
            // "carregando" por ate 12s (o prazo da escolha da saida). Se a saida falhar, o
            // socket fecha no meio do handshake e o cliente do gateway reconecta com backoff.
            client.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]));
            client.setTimeout(0);

            let upstream = await openThroughPool(target);

            if (upstream === null) {
                // No modo "tor" a promessa e outra: sem Tor nenhuma sessao presta (o gateway
                // nasceria pelo IP brasileiro e o video nunca viria). Recusar a conexao faz
                // o cliente do gateway re-tentar com backoff; o batimento religa a rota assim
                // que um Tor responder. Nao marca gatewayWentDirectAt: recusa nao e vazo.
                if (routeMode === "tor") {
                    log("modo tor: nenhuma saida entregou " + target.host + ", recusando esta conexao (sem vazo direta)");
                    client.destroy();
                    return;
                }
                // Recusar aqui prendia o Discord em "conectando" para sempre: o PAC nao tem
                // alternativa depois do ponto e virgula, entao uma recusa nao vira conexao
                // direta, vira nada. Sair direto custa o bypass desta conexao; recusar custa o
                // Discord inteiro, e saida gratuita morre no meio da sessao o tempo todo.
                log("nenhuma saida entregou " + target.host + ", esta conexao vai sair direta");
                // Sinal para o watchdog de recarga: o roteador abriu direto para um host de
                // gateway — a sessao nasceu (ou vai nascer) pelo IP brasileiro, e o servidor
                // provavelmente bloqueou. So o roteador sabe disto; e o gatilho confiavel.
                gatewayWentDirectAt = Date.now();
                sessaoDiretas++;
                log("saida.direta | alvo=" + target.host +
                    " saida_atual=" + (chosenExit === null ? "nenhuma" : safeProxy(chosenExit)));
                const tDireto = Date.now();
                upstream = await openDirect(target);
                // A saida pode ter estado de pe e falhado so nesta conexao (congestionamento,
                // giro de IP): com saida viva, a recarga repara a sessao na hora, em vez de
                // esperar o Ctrl+R da pessoa. Sem saida, o settleExit futuro chama isto.
                if (upstream !== null) {
                    log("direto.aberto | alvo=" + target.host + " levou=" + (Date.now() - tDireto) + "ms");
                    maybeReloadAfterDirect();
                } else {
                    log("direto: " + target.host + " falhou (sem rota local?)");
                }
            }

            if (upstream === null) return client.destroy();
            if (client.destroyed) return upstream.destroy();

            const saidaInfo = typeof chosenExit === "string" && chosenExit ? safeProxy(chosenExit) : "direta";
            const tTunel = Date.now();
            upstream.on("error", e => log("[net] tunel.caiu | alvo=" + target.host +
                " saida=" + saidaInfo +
                " errno=" + (e && e.code ? e.code : "desconhecido") +
                " vida=" + Math.round((Date.now() - tTunel) / 1000) + "s"));
            client.on("error", e => log("[net] cliente.falha | alvo=" + target.host + " errno=" + (e && e.code ? e.code : "desconhecido")));
            client.on("close", () => upstream.destroy());
            upstream.on("close", () => client.destroy());
            upstream.pipe(client);
            client.pipe(upstream);
        });
    });
}

function startRouter() {
    return new Promise(resolve => {
        const server = createServer(serveSocks);
        server.on("error", error => {
            log("o roteador local nao subiu: " + error.message);
            resolve(false);
        });
        // Loopback e porta escolhida pelo sistema: nao ha colisao possivel, e nada de fora da
        // maquina alcanca isto.
        server.listen(0, "127.0.0.1", () => {
            socksPort = server.address().port;
            log("roteador local escutando em 127.0.0.1:" + socksPort);
            resolve(true);
        });
    });
}

function pacScript(fallback) {
    // Sem alternativa depois do ponto e virgula de proposito. Com uma, uma falha faria o
    // Chromium marcar o roteador como ruim e mandar tudo pela alternativa sem avisar: PAC
    // servido, roteador de pe, e nenhuma conexao passando. A rede de seguranca fica dentro do
    // roteador, que cai para direto sozinho e registra isso.
    //
    // Casamento por sufixo de dominio (ver isRoutedHost): o gateway real conecta em
    // subdominios regionais (gateway-us-east1-b.discord.gg). endsWith("." + dominio) e nao
    // indexOf: aquele casaria discord.gg.evil.com.
    return "var routed = " + JSON.stringify(ROUTE_SUFFIX) + ";\n"
        + "function FindProxyForURL(url, host) {\n"
        + "    if (host === \"discord.gg\" || host.endsWith(routed)) return \"SOCKS5 127.0.0.1:" + socksPort + "\";\n"
        + "    return " + JSON.stringify(fallback) + ";\n"
        + "}\n";
}

async function installPac() {
    let fallback = "DIRECT";
    try {
        // Quem esta atras de proxy corporativo perderia o Discord se a regra virasse DIRECT na
        // marra, entao a regra do sistema e lida antes e devolvida a todo host nao roteado.
        const resolved = await session.defaultSession.resolveProxy("https://" + DISCORD_HOST);
        if (typeof resolved === "string" && resolved.trim() !== "") fallback = resolved.trim();
    } catch (error) {
        log("nao consegui ler a regra do sistema, usando DIRECT: " + error.message);
    }

    try {
        await session.defaultSession.setProxy({ mode: "pac_script", pacScript: "data:application/x-ns-proxy-autoconfig;base64," + Buffer.from(pacScript(fallback), "utf8").toString("base64") });
    } catch (error) {
        log("o Chromium recusou a regra: " + error.message);
        return false;
    }

    // Conferir em vez de supor: se a regra nao pegou, e melhor saber agora do que descobrir
    // pelo usuario dizendo que nao funciona. O canônico e um subdominio regional de exemplo:
    // o gateway real conecta em subdominios, e um PAC que so roteia o canônico passaria no
    // teste antigo mesmo estando quebrado para o que importa.
    try {
        const checks = [
            "https://" + ROUTED_HOSTS[0],
            "https://gateway-us-east1-b.discord.gg"
        ];
        const results = await Promise.all(checks.map(url => session.defaultSession.resolveProxy(url)));
        const ok = results.every(r => String(r).includes(String(socksPort)));
        if (!ok) {
            log("a regra foi aceita mas nao esta valendo (" + results.join(", ") + "), voltando para o sistema");
            await session.defaultSession.setProxy({ mode: "system" });
            return false;
        }
        log("regra no ar: *" + ROUTE_SUFFIX + " pelo roteador, o resto por " + fallback);

        // Fecha as conexoes existentes: o Discord reaberto rapido REUSA o websocket antigo
        // (fast connect), que nasceu direto antes do PAC e continuaria direto — o bypass
        // ficaria inerte (o teste de estresse pegou isto: "gateway visto" sem "roteado").
        // Sem fechar, a sessao bloqueada de antes continua valendo apos reabrir.
        try {
            await session.defaultSession.closeAllConnections();
            log("conexoes antigas fechadas, o gateway vai renascer pela rota");
        } catch (error) {
            log("nao consegui fechar as conexoes antigas: " + error.message);
        }
    } catch (error) {
        log("nao consegui conferir a regra: " + error.message);
    }

    return true;
}

// ------------------------------------------------------------------ sobreviver a atualizacao

const STUB_PACKAGE = JSON.stringify({ name: "discord", main: "index.js", version: "1.0.0" });

function patchResources(resources, patcherPath) {
    const asar = join(resources, "app.asar");
    const original = join(resources, "_app.asar");
    if (fs.existsSync(original) || !fs.existsSync(asar)) return false;

    try {
        if (fs.lstatSync(asar).isDirectory()) return false;
        fs.renameSync(asar, original);
        fs.mkdirSync(asar);
        fs.writeFileSync(join(asar, "package.json"), STUB_PACKAGE);
        fs.writeFileSync(join(asar, "index.js"), "require(" + JSON.stringify(patcherPath) + ");");
        return true;
    } catch (error) {
        log("nao consegui aplicar em " + resources + ": " + error.message);
        return false;
    }
}

// O Discord se atualiza numa pasta app-VERSAO nova, sem a nossa injecao, e o bypass sumiria em
// silencio na proxima abertura. Como esta versao ainda esta rodando quando a nova aparece, da
// para deixar ela pronta aqui.
function patchNewerSiblings(currentResources) {
    if (process.platform !== "win32") return;

    const currentDir = dirname(currentResources);
    const root = dirname(currentDir);
    const current = basename(currentDir);

    let names;
    try {
        names = fs.readdirSync(root);
    } catch {
        return;
    }

    for (const name of names) {
        if (!name.startsWith("app-") || name === current) continue;
        if (name.localeCompare(current, undefined, { numeric: true }) <= 0) continue;

        const resources = join(root, name, "resources");
        if (!fs.existsSync(resources)) continue;
        if (patchResources(resources, join(HERE, basename(__filename)))) log("versao nova encontrada, ja deixei pronta: " + name);
    }
}

// ------------------------------------------------------------------ entrada

// O Discord oficial carrega o app com require.main.filename apontando para o index.js do stub.
// Os clientes paralelos (Vesktop, Equibop, Legcord) passam o app como argumento e o
// require.main.filename vira "electron" — o argv[1] e o caminho confiavel nos dois casos.
// argv[1] aponta para o diretorio app.asar; require.main.filename para o index.js dentro dele.
const injectorPath = process.argv[1] || require.main.filename;
const stubDir = fs.existsSync(injectorPath) && fs.statSync(injectorPath).isDirectory() ? injectorPath : dirname(injectorPath);
const resourcesDir = join(stubDir, "..");
const asarPath = join(resourcesDir, "_app.asar");

async function start() {
    log("--- abrindo ---");

    // O preload do shim tem que estar registrado ANTES de o Discord criar as
    // janelas: o nosso whenReady corre antes do handler dele (o require do main
    // original acontece depois do require do bypass), e o registro aqui no topo
    // e sincrono — sem corrida (issue #163).
    registrarPreloadShim();

    if (settings.enabled === false) {
        log("desligado em settings.json, nao vou mexer em nada");
        return;
    }

    // A regra do PAC nao carrega usuario e senha: ela so diz o endereco. Quando a saida pede
    // autenticacao, quem responde e o Chromium, por este evento. Sem isto a saida com senha
    // passaria no nosso teste, que negocia na mao, e falharia no uso de verdade.
    app.on("login", (event, _webContents, _request, authInfo, callback) => {
        // Sem esta checagem responderiamos a qualquer site que pedisse senha, entregando a
        // credencial da saida para quem nao tem nada a ver com ela.
        if (!authInfo.isProxy || chosenExit === null) return;

        const parsed = parseProxy(chosenExit);
        if (parsed === null || parsed.user === "") return;
        if (authInfo.host !== parsed.host || authInfo.port !== parsed.port) return;

        event.preventDefault();
        callback(parsed.user, parsed.pass);
    });

    if (!await startRouter()) return;
    if (!await installPac()) return;

    // Observa os handshakes websocket do cliente: o gateway real conecta em subdominios
    // regionais (gateway-us-east1-b.discord.gg). O registro mostra se o gateway nasceu com
    // ou sem saida na mao — o diagnostico da corrida. A marcacao de "nasceu direto" fica no
    // serveSocks, no momento em que a conexao realmente sai direta; marcar aqui era cedo
    // demais, porque a conexao de gateway espera a saida no currentExit (ate 12s) e passa
    // roteada quando ela chega. O falso positivo ativava o fluxo de recarga em toda abertura
    // e o cancelava em seguida ("recarga desnecessaria"), deixando o mecanismo sem efeito
    // justamente nos casos em que a sessao tinha nascido direta de verdade.
    //
    // Este observador tambem e o medidor de sofrimento da saida: cada handshake NOVO do
    // gateway (reconexao) e contado numa janela. Rajada de reconexoes = a saida nao esta
    // aguentando o trafego vivo, mesmo passando no probe. Acima do limite, troca forcada
    // para a reserva mais rapida — o sinal mais confiavel que temos.
    // Zera a contagem de reconexao quando a janela recarrega: dali em diante e sessao nova.
    try {
        watchReloads();
    } catch (error) {
        log("nao consegui observar as recargas da janela: " + error.message);
    }

    // O callback e obrigatorio (sem ele a request pendura para sempre); nao modificamos nada.
    try {
        session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
            // Os websockets de voz/video moram em *.discord.media e nao passam pela saida (so
            // o gateway passa). Servem aqui como sinal de que existe chamada ou transmissao
            // em andamento -- e so nesse caso uma reconexao de gateway tem o que estragar.
            if (details.resourceType === "webSocket") {
                try {
                    if (new URL(details.url).hostname.endsWith(".discord.media")) {
                        ultimaMidiaEm = Date.now();
                    }
                } catch {
                    // url estranha; ignora
                }
            }

            if (details.resourceType === "webSocket" && isRoutedHost(new URL(details.url).hostname)) {
                // NUNCA logar a URL: a query do handshake autenticado carrega o token
                // do Discord. So o hostname + contagem da janela — o suficiente para
                // diagnosticar reconexoes sem vazar credencial.
                const agora = Date.now();
                const host = new URL(details.url).hostname;
                const saidaInfo = chosenExit === null
                    ? "sem saida ainda"
                    : "saida pronta ha " + Math.round((Date.now() - lastExitAt) / 1000) + "s";
                const ultimoVistoHa = ultimoVistoAt === 0 ? "?" : (agora - ultimoVistoAt) + "ms";
                ultimoVistoAt = agora;
                log("gw.visto | host=" + host +
                    " n_janela=" + gatewayReconexoes.length + "/180s" +
                    " n_sessao=" + (gatewayConnCount + 1) +
                    " ultimo_visto_ha=" + ultimoVistoHa +
                    " | " + saidaInfo);

                // Reconexao em rajada (ignora a primeira conexao da sessao, que nao e sinal).
                // A reconexao provocada pelo NOSSO revive tambem nao conta: alimentaria a
                // rajada e quarentenaria a saida sadia por uma acao nossa (o close 4000 do
                // revive SEMPRE causa uma reconexao — e o previsto).
                if (revivePendenteEm > 0 && agora - revivePendenteEm < GW_REVIVE_TTL_MS) {
                    log("gw.revive | reconexao do revive: fora da janela de rajada");
                } else if (chosenExit !== null) {
                    gatewayReconexoes.push(agora);
                    while (gatewayReconexoes.length > 0 && gatewayReconexoes[0] < agora - RECONEXAO_JANELA_MS) gatewayReconexoes.shift();

                    // Segunda reconexao na janela: ja e sinal de saida agonizante. Dispara o
                    // refresh em segundo plano — quando a rajada fechar (3+), ha candidato
                    // novo para trocar em vez de so a sauda velha do pool.
                    if (gatewayReconexoes.length === RECONEXAO_LIMITE - 1) {
                        log("gw.rajada_antecipada | n=" + gatewayReconexoes.length + "/180s");
                        refreshExit().catch(error => log("a busca antecipada falhou: " + error.message));
                    }

                    if (gatewayReconexoes.length >= RECONEXAO_LIMITE) {
                        // Intervalos entre as reconexoes da rajada (para o log).
                        const deltas = [];
                        for (let i = 1; i < gatewayReconexoes.length; i++) deltas.push(gatewayReconexoes[i] - gatewayReconexoes[i - 1]);
                        const minD = deltas.length ? Math.min(...deltas) : 0;
                        const medD = deltas.length ? Math.round(deltas.reduce((a, b) => a + b, 0) / deltas.length) : 0;

                        const emaAtual = rttEma.get(chosenExit) ?? Infinity;
                        // Cooldown + reserva que preste: trocar entre saidas ruins em cascata
                        // so renasce o gateway a toa; sem reserva melhor, a atual vai para a
                        // quarentena e a busca em 2o plano escolhe outra.
                        const alvo = pool
                            .map(entry => entry.proxy)
                            .filter(proxy => proxy !== chosenExit)
                            .sort((a, b) => (rttEma.get(a) ?? Infinity) - (rttEma.get(b) ?? Infinity))[0];
                        const emaAlvo = alvo === undefined ? Infinity : (rttEma.get(alvo) ?? Infinity);
                        const podeTrocar = !usingManualProxy && routeMode !== "tor" && alvo !== undefined && trocaProativaPode() && emaAlvo <= emaAtual * SWAP_RESERVA_RAZAO;
                        log("gw.rajada_limite | n=" + gatewayReconexoes.length + "/180s" +
                            " intervalo_min=" + minD + "ms intervalo_med=" + medD + "ms" +
                            " ema_atual=" + (emaAtual === Infinity ? "?" : Math.round(emaAtual) + "ms") +
                            " ema_alvo=" + (emaAlvo === Infinity ? "?" : Math.round(emaAlvo) + "ms") +
                            " troca=" + (podeTrocar ? "sim" : "nao") +
                            " motivo=" + (alvo === undefined ? "sem_reserva" : !trocaProativaPode() ? "cooldown" : "reserva_pior"));
                        if (podeTrocar) {
                            const antiga = chosenExit;
                            trocarPara(alvo, RECONEXAO_LIMITE + "+ reconexoes do gateway na janela");
                            quarentenar(antiga, "rajada de reconexoes");
                        } else {
                            gatewayReconexoes.length = 0;
                            quarentenar(chosenExit, RECONEXAO_LIMITE + "+ reconexoes sem troca util");
                            log(safeProxy(chosenExit) + " com " + RECONEXAO_LIMITE + "+ reconexoes do gateway sem troca util (cooldown ou reserva pior), em quarentena");
                        }
                    }
                }
            }
            callback({});
        });
    } catch (error) {
        log("nao consegui observar os websockets: " + error.message);
    }

    const exit = await chooseExit();
    if (exit === null && routeMode === "tor") {
        // Modo "tor": sem Tor no arranque NAO libera as conexoes pendentes para o direct.
        // Elas ficam seguradas ate o prazo delas; o batimento continua e quando um Tor
        // responder settleExit(tor) religa a rota. Vazar direto aqui renasceria o gateway
        // pelo IP brasileiro — exatamente o carregamento infinito que o projeto combate.
        log("modo tor: sem Tor no arranque, conexoes ficam seguradas ate um Tor responder");
        coldTorHoldSince = Date.now();
        showTorBootBanner();
    } else {
        settleExit(exit);
        log(exit === null ? "nenhuma saida respondeu, o gateway vai sair direto" : "saida escolhida: " + safeProxy(exit));
    }

    // So depois da primeira escolha: batimento correndo junto da busca inicial disputaria banda
    // com ela, e e a busca inicial que segura o gateway.
    setInterval(() => { beat(); }, HEARTBEAT_MS);
    log("batimento ligado: reconfiro as saidas a cada " + Math.round(HEARTBEAT_MS / 1000) + "s");
    setInterval(() => { checarGatewaySilente(); }, GW_PROBE_CHECAGEM_MS);
    log("vigia de gateway mudo ligado: polla o probe do renderer a cada " + Math.round(GW_PROBE_CHECAGEM_MS / 1000) + "s");
    setInterval(() => { checarRtcNativo(); }, VOICE_PROBE_MS);
    log("vigia de video nativo ligado: polla discord_voice a cada " + Math.round(VOICE_PROBE_MS / 1000) + "s");
}

try {
    const discordPkg = require(join(asarPath, "package.json"));
    require.main.filename = join(asarPath, discordPkg.main);
    app.setAppPath(asarPath);
} catch (error) {
    // Sem o Discord original nao ha o que fazer, e travar aqui deixaria o usuario sem app.
    console.error("[GoLiveBypass] nao achei o Discord original em " + asarPath, error);
    throw error;
}

app.whenReady().then(() => {
    // Nada aguarda isto de proposito: o Discord carrega em paralelo, e o gateway que chegar
    // antes da saida espera no roteador em vez de segurar a abertura inteira.
    start().catch(error => log("falhei ao preparar o bypass: " + error.message));

    try {
        patchNewerSiblings(resourcesDir);
    } catch (error) {
        log("falhei ao procurar versao nova: " + error.message);
    }
});

log("carregando o Discord original");
try {
    require(require.main.filename);
} catch (error) {
    // O Legcord (e quem mais empacotar o app como ESM com top-level await) nao carrega por
    // require — o import() dinamico cobre os dois mundos.
    if (error && (error.code === "ERR_REQUIRE_ASYNC_MODULE" || error.code === "ERR_REQUIRE_ESM")) {
        import(require.main.filename).catch((importError) => {
            console.error("[GoLiveBypass] nao consegui carregar o Discord original por import: " + importError.message);
            throw importError;
        });
    } else {
        throw error;
    }
}
