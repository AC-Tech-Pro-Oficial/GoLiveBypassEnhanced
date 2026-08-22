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
const FREE_PROXY_API = "https://api.proxyscrape.com/v4/free-proxy-list/get?request=display_proxies&protocol=socks5&proxy_format=protocolipport&format=json&timeout=1500";

// So estes hosts atravessam o tunel. O gate e decidido na conexao do gateway, entao rotear
// mais que isso custaria velocidade em tudo sem comprar nada.
const ROUTED_HOSTS = ["gateway.discord.gg", "remote-auth-gateway.discord.gg"];

const PROBE_TIMEOUT_MS = 6000;
// Mais candidatas por lote nao custa relogio, porque elas correm juntas: custa a mais lenta,
// nao a soma. E com mais candidatas o minimo escolhido e melhor, o que se traduz direto em
// menos latencia em tudo que passa pelo gateway.
const PARALLEL_PROBES = 20;
// Cinco em vez de tres: as candidatas do lote correm juntas, entao guardar mais reserva nao
// custa relogio nenhum na busca e e exatamente o que sobra quando uma saida morre no meio de
// uma transmissao.
const POOL_SIZE = 5;
const MAX_CANDIDATES = 40;
const MIN_UPTIME = 90;
const MAX_LISTED_TIMEOUT = 1500;
const TOR_PORTS = [9052, 9150, 9050, 9250];
const TOR_PORT_TIMEOUT_MS = 400;
// Quanto uma conexao de gateway espera por uma saida antes de sair direta. Segurar para sempre
// travaria o login; soltar na hora perderia a corrida em toda abertura fria.
const HOLD_BUDGET_MS = 12_000;
// O pool guardado vale por este tempo. A revalidacao acontece na abertura (probe real em
// cada saida), entao uma idade longa e segura: o que importa e ter candidatas para revalidar
// em vez de baixar a lista inteira (lenta) com o gateway ja conectando. 30min fazia o pool
// expirar entre aberturas do Discord e o gateway nascia direto — o "carregando infinitamente".
const CACHE_MAX_AGE_MS = 2 * 60 * 60 * 1000;
// Depois de uma busca por saida nova falhar, espera este intervalo antes de tentar de novo:
// a API de saidas gratuitas custa e nao responde mais rapido por repeticao.
const REFRESH_COOLDOWN_MS = 30_000;

// Trava da reposicao de rotina. Tres minutos, igual ao plugin: sem ela, um pote que nao
// consegue encher viraria uma varredura inteira da lista gratuita a cada trinta segundos, pela
// sessao toda. E separada da trava acima para a rotina nunca adiar a emergencia.
const STOCK_COOLDOWN_MS = 3 * 60_000;

// Prazo do tunel no trafego vivo, bem menor que o do teste: uma saida agonizante que demora a
// falhar faria o Chromium desistir do roteador inteiro.
const RELAY_TIMEOUT_MS = 2500;

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
const LOG_FILE = join(HERE, "golivebypass.log");

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

// Estado da recarga pos-gateway-direto.
let gatewayWentDirectAt = 0;   // quando o roteador abriu direto para um host de gateway
let reloadCount = 0;           // recargas nesta execucao (reseta quando a sessao volta roteada)
let lastReloadAt = 0;          // cooldown
let reloading = false;         // single-flight

function log(line) {
    const stamp = new Date().toTimeString().slice(0, 8);
    try {
        // Sem comando de diagnostico aqui, o arquivo e a unica forma de saber o que aconteceu.
        // Ele e cortado sozinho para nao crescer sem fim numa maquina que ninguem limpa.
        if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > MAX_LOG_BYTES) {
            fs.writeFileSync(LOG_FILE, fs.readFileSync(LOG_FILE, "utf8").slice(-MAX_LOG_BYTES / 2));
        }
        fs.appendFileSync(LOG_FILE, stamp + " " + line + "\n");
    } catch {
        // Ficar sem registro e ruim; derrubar o Discord por causa do registro e pior.
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

// O trecho antes do @ e opcional e casado com ganancia, para a senha poder conter @ e : sem
// precisar de escape: quem recebe um endereco pronto da AWS costuma cola-lo como veio.
const PROXY_RE = /^(socks5|socks4|http|https):\/\/(?:(.+)@)?([^:/?#\s@]+):(\d{1,5})$/;

function parseProxy(value) {
    const match = PROXY_RE.exec(String(value).trim());
    if (match === null) return null;

    const port = Number(match[4]);
    if (port < 1 || port > 65535) return null;

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
        port: port
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

    return parseProxy(raw) === null ? null : raw.trim();
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
        if (greeting === null || greeting[0] !== 5) return done(false);

        // 0 = sem autenticacao, 2 = usuario e senha (RFC 1929). Qualquer outra coisa, inclusive
        // 0xFF, significa que o proxy nao aceita nada que a gente sabe fazer.
        if (greeting[1] === 2) {
            const user = Buffer.from(credentials.user, "utf8");
            const pass = Buffer.from(credentials.pass, "utf8");
            if (user.length > 255 || pass.length > 255) return done(false);

            readReply(socket, buffer => (buffer.length < 2 ? -1 : 2), reply => {
                if (reply === null || reply[1] !== 0) return done(false);
                sendTarget();
            });

            socket.write(Buffer.concat([
                Buffer.from([1, user.length]), user,
                Buffer.from([pass.length]), pass
            ]));
            return;
        }

        if (greeting[1] !== 0) return done(false);
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
        }, reply => done(reply !== null && reply[1] === 0));
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
    }, reply => done(reply !== null && / 200 /.test(reply.toString("latin1").split("\r\n")[0])));
}

function openTunnel(proxy, host, port, timeoutMs) {
    return new Promise(resolve => {
        const parsed = parseProxy(proxy);
        if (parsed === null) return resolve(null);

        let settled = false;
        const finish = value => {
            if (settled) return;
            settled = true;
            if (value === null) socket.destroy();
            else socket.setTimeout(0);
            resolve(value);
        };

        const socket = connect({ host: parsed.host, port: parsed.port });
        socket.setTimeout(timeoutMs || PROBE_TIMEOUT_MS, () => finish(null));
        socket.on("error", () => finish(null));
        socket.once("connect", () => {
            const done = ok => finish(ok ? socket : null);
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

// Prova o que interessa numa saida: o tunel negocia, o TLS fecha com certificado valido para o
// Discord, e o Discord responde 200 por ela. Saida barrada por reputacao falha exatamente aqui,
// que e o motivo de o teste nao ser contra um endereco qualquer.
async function probe(proxy, timeoutMs) {
    const started = Date.now();

    const socket = await openTunnel(proxy, DISCORD_HOST, 443, timeoutMs);
    if (socket === null) return null;

    const response = await readOverTls(socket, DISCORD_HOST, "/api/v9/gateway", timeoutMs);
    if (response === null || !response.startsWith("HTTP/1.1 200")) return null;

    return { proxy: proxy, ms: Date.now() - started };
}

async function exitCountry(proxy, timeoutMs) {
    const socket = await openTunnel(proxy, GEO_HOST, 443, timeoutMs);
    if (socket === null) return null;

    const response = await readOverTls(socket, GEO_HOST, "/cdn-cgi/trace", timeoutMs);
    if (response === null || !response.startsWith("HTTP/1.1 200")) return null;

    const match = /^loc=([A-Z]{2})/m.exec(response);
    return match === null ? null : match[1];
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

function downloadText(url) {
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
        req.setTimeout(15_000, () => req.destroy(new Error("tempo esgotado")));
        req.end();
    });
}

function rankFreeProxies(body) {
    const data = JSON.parse(body);
    const list = Array.isArray(data.proxies) ? data.proxies : [];

    return list
        .filter(entry => entry && entry.alive !== false && entry.proxy)
        .filter(entry => typeof entry.uptime !== "number" || entry.uptime >= MIN_UPTIME)
        .filter(entry => typeof entry.timeout !== "number" || entry.timeout <= MAX_LISTED_TIMEOUT)
        // A porta 4145 e quase toda de intermediario que responde por qualquer destino sem
        // encaminhar nada. Ela reprova no teste, mas so depois de gastar o prazo.
        .filter(entry => !String(entry.proxy).endsWith(":4145"))
        .filter(entry => !excludedCountries.has(String(entry.ip_data && entry.ip_data.countryCode).toUpperCase()))
        .sort((a, b) => (a.timeout || 9999) - (b.timeout || 9999))
        .slice(0, MAX_CANDIDATES)
        .map(entry => String(entry.proxy));
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

async function detectTor() {
    for (const port of TOR_PORTS) {
        const proxy = "socks5://127.0.0.1:" + port;
        if (!await listening(port, TOR_PORT_TIMEOUT_MS)) continue;
        if (await probe(proxy) === null) {
            log("porta " + port + " esta aberta mas nao respondeu como proxy");
            continue;
        }

        const country = await exitCountry(proxy);
        if (country !== null && !excludedCountries.has(country)) {
            log("Tor encontrado na porta " + port + ", saida em " + country);
            return proxy;
        }
        log("Tor na porta " + port + " recusado: saida em " + (country || "pais desconhecido"));
    }

    return null;
}

// Devolve as aprovadas do primeiro lote que der alguma, sem mexer no pote nem na saida ativa:
// quem chama decide se isto e a escolha da sessao ou so reserva chegando por baixo.
async function huntExits() {
    let candidates;
    try {
        candidates = rankFreeProxies(await downloadText(FREE_PROXY_API));
    } catch (error) {
        log("nao consegui baixar a lista de saidas: " + error.message);
        return [];
    }

    log(candidates.length + " candidatas depois do ranqueamento");

    for (let i = 0; i < candidates.length; i += PARALLEL_PROBES) {
        const batch = candidates.slice(i, i + PARALLEL_PROBES);

        // A PRIMEIRA aprovada ganha, sem esperar o lote inteiro: o gateway conecta em 2-4s e
        // um lote que espera a candidata mais lenta (probe + pais, ate 12s cada) fazia a saida
        // nunca ganhar a corrida — o gateway nascia direto (o "carregando infinitamente").
        // O ms das demais ainda e medido para o ranqueamento do pote, mas nao segura a escolha.
        const aprovadas = await new Promise(resolve => {
            const found = [];
            let pending = batch.length;
            let settled = false;

            for (const candidate of batch) {
                probeExit(candidate).then(r => {
                    if (settled) return;

                    if (r !== null && r.country !== null && !excludedCountries.has(r.country)) {
                        found.push(r);
                        // primeira aprovada: resolve na hora com o que ja temos
                        settled = true;
                        resolve(found);
                        return;
                    }

                    if (r !== null && (r.country === null || excludedCountries.has(r.country))) {
                        log(r.proxy + " recusada: saida em " + (r.country || "pais desconhecido"));
                    }

                    if (--pending === 0 && !settled) resolve(found);
                });
            }
        });

        if (aprovadas.length === 0) continue;

        // Devolve so a primeira aprovada: as outras probes do lote terminam, mas o resultado
        // delas e descartado (o Promise ja resolveu). O pote se enche ao longo das chamadas
        // seguintes de stockReserves, uma saida por vez -- o que importa aqui e nao segurar a
        // escolha esperando a candidata mais lenta do lote.
        return aprovadas;
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

async function cachedExit() {
    const state = readJson(STATE_FILE, null);
    if (state === null || typeof state.at !== "number") return null;
    if (Date.now() - state.at > CACHE_MAX_AGE_MS) return null;

    // Versoes anteriores guardavam uma saida so, em state.proxy.
    const guardadas = Array.isArray(state.pool)
        ? state.pool.filter(e => e && typeof e.proxy === "string")
        : (typeof state.proxy === "string" ? [{ proxy: state.proxy, ms: 0, country: "?" }] : []);

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
        log("o endereco em proxy nao e valido, ignorando");
    } else if (manual !== "") {
        if (await probe(manual, 2500) !== null) {
            log("usando a saida que voce configurou: " + safeProxy(manual));
            return manual;
        }
        log("a saida que voce configurou nao respondeu: " + safeProxy(manual));
    }

    const cached = await cachedExit();
    if (cached !== null) return cached;

    return await detectTor() || await pickFreeExit();
}

let lastExitAt = 0; // quando a saida atual foi escolhida (para o log do gateway visto)

function settleExit(proxy) {
    chosenExit = proxy;
    exitSettled = true;
    if (proxy !== null) lastExitAt = Date.now();
    while (waitingForExit.length > 0) waitingForExit.shift()(proxy);

    // Saida nova no ar e o gateway tinha saido direto ha pouco: esta sessao nasceu bloqueada
    // e so um reload faz o gateway renascer atras da saida. Avalia (com todas as guardas).
    if (proxy !== null && gatewayWentDirectAt !== 0) {
        maybeReloadAfterDirect();
    }
}

// ------------------------------------------------------------------ recarga pos-gateway-direto

function clientWindow() {
    for (const win of require("electron").BrowserWindow.getAllWindows()) {
        if (win.isDestroyed()) continue;
        const url = win.webContents.getURL();
        if (CLIENT_URL_RE.test(url)) return win;
    }
    return null;
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
function markGatewayRouted() {
    lastRoutedAt = Date.now();
    if (reloadCount > 0) log("gateway voltou a passar pela saida, teto de recarga resetado");
    reloadCount = 0;
}

// Exposto para a bateria de testes (tests/test-exit-refresh.sh) marcar o sinal sem depender
// de uma conexao de gateway real no sandbox. Inofensivo em producao: so seta o mesmo
// timestamp que o serveSocks setaria ao abrir direto.
function _testMarkGatewayDirect() {
    gatewayWentDirectAt = Date.now();
}

// Uma conexao de gateway que chega antes de existir saida espera aqui, e nao para sempre:
// estourado o prazo ela sai direta. Discord aberto sem bypass e ruim; Discord que nao abre e
// muito pior, e foi o pior defeito que este projeto ja teve.
function currentExit() {
    if (exitSettled) return Promise.resolve(chosenExit);

    return new Promise(resolve => {
        const timer = setTimeout(() => {
            const index = waitingForExit.indexOf(deliver);
            if (index >= 0) waitingForExit.splice(index, 1);
            log("a saida nao ficou pronta a tempo, esta conexao vai sair direta");
            resolve(null);
        }, HOLD_BUDGET_MS);

        const deliver = proxy => {
            clearTimeout(timer);
            resolve(proxy);
        };

        waitingForExit.push(deliver);
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
        log("nenhuma saida do pool entregou, procurando uma saida nova");
        const fresh = await pickFreeExit();
        if (fresh !== null) {
            settleExit(fresh);
            log("saida nova encontrada: " + safeProxy(fresh));
        } else {
            log("nenhuma saida nova disponivel agora");
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
async function beat() {
    // Um batimento lento nunca pode se sobrepor ao proximo: seriam duas rodadas de conexoes na
    // mesma saida ao mesmo tempo, que e justamente o que derruba as fracas.
    if (beating) return;
    beating = true;

    try {
        await checkPool();
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

    // A ativa entra na rodada mesmo estando fora do pote: proxy do settings.json e Tor local
    // nunca sao guardados, e sao exatamente os que a pessoa mais sente quando caem.
    const targets = [];
    if (active !== null) targets.push(active);
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

        log(safeProxy(active) + " perdeu o batimento, assumindo a reserva " + safeProxy(reserve));
        chosenExit = reserve;
    }

    stockReserves(live.filter(proxy => proxy !== chosenExit).length);
}

// Repor reserva nao pode passar pelo refreshExit: aquele caminho troca a saida ativa, e trocar
// de IP com a ativa saudavel pediria uma reavaliacao do servidor a toa. Aqui o pote enche por
// baixo e quem esta entregando continua entregando.
function stockReserves(liveReserves) {
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

    // A ativa sozinha primeiro: ela e o IP que o servidor ja viu nesta sessao, e trocar sem
    // precisar seria pedir uma reavaliacao a toa.
    const direto = await openTunnel(active, target.host, target.port, RELAY_TIMEOUT_MS);
    if (direto !== null) {
        markGatewayRouted();
        log("roteado: " + target.host + " pela ativa " + safeProxy(active));
        return direto;
    }

    log(safeProxy(active) + " nao entregou " + target.host);

    // As reservas correm todas juntas em vez de uma por vez: enfileiradas, o prazo de cada uma
    // somava com o gateway ja reconectando, e o Chromium desiste do roteador antes disso.
    const won = await firstTunnel(pool.map(entry => entry.proxy).filter(proxy => proxy !== active), target, RELAY_TIMEOUT_MS);
    if (won !== null) {
        log("a saida " + safeProxy(active) + " parou de entregar, troquei para " + safeProxy(won.proxy));
        chosenExit = won.proxy;
        missedBeats.delete(active);
        pool = pool.filter(entry => entry.proxy !== active);
        savePool();
        markGatewayRouted();
        log("roteado: " + target.host + " pela reserva " + safeProxy(won.proxy));
        return won.socket;
    }

    // Pool inteiro morto: antes de render a conexao ao IP brasileiro (o "carregando para
    // sempre"), tenta o cache do state.json (revalidacao rapida, ~1-2s) e so entao a lista
    // nova (lenta, ~4s+). No caso do ciclo 7 o pool tinha 1 saida que morreu; o cache teria
    // saidas guardadas de aberturas anteriores para assumir na hora.
    const cached = await cachedExit();
    if (cached !== null) {
        const socket = await openTunnel(cached, target.host, target.port, PROBE_TIMEOUT_MS);
        if (socket !== null) {
            chosenExit = cached;
            markGatewayRouted();
            log("roteado: " + target.host + " pela saida do cache " + safeProxy(cached));
            return socket;
        }
        log(safeProxy(cached) + " do cache nao entregou " + target.host);
    }

    const fresh = await refreshExit();
    if (fresh !== null) {
        const socket = await openTunnel(fresh, target.host, target.port, PROBE_TIMEOUT_MS);
        if (socket !== null) {
            markGatewayRouted();
            log("roteado: " + target.host + " pela saida nova " + safeProxy(fresh));
            return socket;
        }
        log(safeProxy(fresh) + " nao entregou " + target.host + " logo depois de escolhida");
    }

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
                // Recusar aqui prendia o Discord em "conectando" para sempre: o PAC nao tem
                // alternativa depois do ponto e virgula, entao uma recusa nao vira conexao
                // direta, vira nada. Sair direto custa o bypass desta conexao; recusar custa o
                // Discord inteiro, e saida gratuita morre no meio da sessao o tempo todo.
                log("nenhuma saida entregou " + target.host + ", esta conexao vai sair direta");
                // Sinal para o watchdog de recarga: o roteador abriu direto para um host de
                // gateway — a sessao nasceu (ou vai nascer) pelo IP brasileiro, e o servidor
                // provavelmente bloqueou. So o roteador sabe disto; e o gatilho confiavel.
                gatewayWentDirectAt = Date.now();
                upstream = await openDirect(target);
            }

            if (upstream === null) return client.destroy();
            if (client.destroyed) return upstream.destroy();

            upstream.on("error", () => client.destroy());
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

const STUB_PACKAGE = JSON.stringify({ name: "discord", main: "index.js" });

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

const injectorPath = require.main.filename;
const resourcesDir = join(dirname(injectorPath), "..");
const asarPath = join(resourcesDir, "_app.asar");

async function start() {
    log("--- abrindo ---");

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
    // regionais (gateway-us-east1-b.discord.gg). O SINAL de corrida perdida: se o handshake
    // do gateway aparece quando AINDA NAO HA SAIDA escolhida, ele nasceu direto pelo IP
    // brasileiro — o servidor ja avaliou o bloqueio nesse CONNECTION_OPEN e nenhuma
    // reconexao roteada posterior desbloqueia (o plugin detecta o mesmo no renderer e
    // recarrega). Marca a recarga guardada na hora.
    // O callback e obrigatorio (sem ele a request pendura para sempre); nao modificamos nada.
    try {
        session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
            if (details.resourceType === "webSocket" && isRoutedHost(new URL(details.url).hostname)) {
                const saidaInfo = chosenExit === null
                    ? "sem saida ainda"
                    : "saida pronta ha " + Math.round((Date.now() - lastExitAt) / 1000) + "s";
                log("gateway visto: " + details.url.slice(0, 80) + " | " + saidaInfo);

                // Corrida perdida: gateway nasceu SEM saida -> sessao bloqueada. A reconexao
                // roteada que vier depois NAO desbloqueia (o veredito foi no CONNECTION_OPEN
                // original); so a recarga da janela faz o gateway renascer atras da saida.
                if (chosenExit === null && gatewayWentDirectAt === 0) {
                    log("gateway nasceu sem saida, marcando para recarga");
                    gatewayWentDirectAt = Date.now();
                    // Aguarda a saida ficar pronta (a recarga so roda com saida viva no probe);
                    // settleExit chama maybeReloadAfterDirect quando ela chegar.
                }
            }
            callback({});
        });
    } catch (error) {
        log("nao consegui observar os websockets: " + error.message);
    }

    const exit = await chooseExit();
    settleExit(exit);
    log(exit === null ? "nenhuma saida respondeu, o gateway vai sair direto" : "saida escolhida: " + safeProxy(exit));

    // So depois da primeira escolha: batimento correndo junto da busca inicial disputaria banda
    // com ela, e e a busca inicial que segura o gateway.
    setInterval(() => { beat(); }, HEARTBEAT_MS);
    log("batimento ligado: reconfiro as saidas a cada " + Math.round(HEARTBEAT_MS / 1000) + "s");
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
require(require.main.filename);
