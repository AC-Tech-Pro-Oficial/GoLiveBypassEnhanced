/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { NativeSettings, RendererSettings } from "@main/settings";
import { app, IpcMainInvokeEvent, session } from "electron";
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { request } from "https";
import { connect, Socket } from "net";
import { dirname, join } from "path";
import { connect as connectTls } from "tls";

const FREE_PROXY_API = "https://api.proxyscrape.com/v4/free-proxy-list/get?request=display_proxies&protocol=socks5&proxy_format=protocolipport&format=json&timeout=1500";
const GEO_HOST = "cloudflare.com";
const DISCORD_HOST = "discord.com";

const MAX_LIST_BYTES = 1024 * 1024;
const PROBE_TIMEOUT_MS = 6000;
const PARALLEL_PROBES = 10;
const MAX_CANDIDATES = 40;
const MIN_UPTIME = 90;
const MAX_LISTED_TIMEOUT = 1500;
const SESSION_DEADLINE_MS = 120_000;
// Portas SOCKS de clientes Tor, em ordem de preferencia: 9052 e a porta comum de um Tor
// configurado a mao com bridge, e as outras sao Tor Browser, daemon e Brave. Uma porta
// fechada recusa na hora, entao tentar as quatro nao custa relogio nenhum.
const TOR_PORTS = [9052, 9150, 9050, 9250];
const TOR_PORT_TIMEOUT_MS = 400;
const MAX_LOG_LINES = 400;
const MAX_LOG_BYTES = 256 * 1024;
const MAX_RETRIES = 2;
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const BOOT_MARK_MAX_AGE_MS = 10 * 60 * 1000;
const BOOT_PROBE_TIMEOUT_MS = 2500;
const INTERCEPTING_PORTS = new Set([4145]);

// O trecho antes do @ e opcional e casado com ganancia, para a senha poder conter @ e : sem
// precisar de escape: quem recebe um endereco pronto da AWS costuma cola-lo como veio.
const PROXY_RULES_RE = /^(socks5|https?):\/\/(?:(.+)@)?([a-z0-9.-]{1,253}):(\d{1,5})$/;
// Os unicos hosts que precisam passar pelo proxy: e na conexao do gateway que o servidor
// decide se a conta pode transmitir. Imagem, anexo, GIF, video incorporado e a propria voz
// nunca encostam nele.
const GATEWAY_HOSTS = ["gateway.discord.gg", "remote-auth-gateway.discord.gg"];

let appliedProxy: string | null = null;
let deadline: ReturnType<typeof setTimeout> | undefined;

const history: string[] = [];

let retries = 0;

// A pasta e a mesma que o modo standalone usa. Quem experimentou os dois acha um arquivo so,
// em vez de descobrir depois que estava lendo o registro do outro.
function logDir() {
    const local = process.platform === "win32"
        ? process.env.LOCALAPPDATA
        : process.env.XDG_DATA_HOME ?? (process.env.HOME === undefined ? undefined : join(process.env.HOME, ".local", "share"));

    return local === undefined ? null : join(local, "GoLiveBypass");
}

const LOG_FILE = logDir() === null ? null : join(logDir() as string, "golivebypass.log");

function log(message: string) {
    const line = `${new Date().toISOString().slice(11, 23)} ${message}`;
    history.push(line);
    if (history.length > MAX_LOG_LINES) history.shift();

    if (LOG_FILE === null) return;
    try {
        // Cortado sozinho para nao crescer sem fim numa maquina que ninguem limpa.
        if (existsSync(LOG_FILE) && statSync(LOG_FILE).size > MAX_LOG_BYTES)
            writeFileSync(LOG_FILE, readFileSync(LOG_FILE, "utf8").slice(-MAX_LOG_BYTES / 2));
        else if (!existsSync(LOG_FILE))
            mkdirSync(dirname(LOG_FILE), { recursive: true });

        appendFileSync(LOG_FILE, `${line}\n`);
    } catch (error) {
        // Ficar sem registro e ruim; derrubar o Discord por causa do registro e pior.
        history.push(`${new Date().toISOString().slice(11, 23)} nao consegui gravar o arquivo de registro: ${error instanceof Error ? error.message : String(error)}`);
    }
}

// O renderer tem o que o processo principal nao ve: a atribuicao do servidor, o estado da
// transmissao, a regiao. Sem isto o arquivo contaria metade da historia.
export function logFromRenderer(_: IpcMainInvokeEvent, message: unknown) {
    if (typeof message === "string" && message.length > 0) log(message.slice(0, 2000));
}

function parseProxy(proxyRules: string) {
    const match = PROXY_RULES_RE.exec(proxyRules);
    if (!match) return null;

    const port = Number(match[4]);
    if (port < 1 || port > 65535) return null;

    // Dividido no primeiro dois-pontos, entao a senha pode ter quantos quiser.
    const credentials = match[2] ?? "";
    const split = credentials.indexOf(":");
    const decode = (value: string) => {
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
        port
    };
}

// Nunca registrar a senha: o registro vai para arquivo e as pessoas colam ele em relato de
// problema.
function safeProxy(proxyRules: string) {
    const parsed = parseProxy(proxyRules);
    if (parsed === null) return "endereco invalido";

    const credentials = parsed.user === "" ? "" : `${parsed.user}:***@`;
    return `${parsed.scheme}://${credentials}${parsed.host}:${parsed.port}`;
}

function markBoot(pending: boolean) {
    NativeSettings.store.plugins.GoLiveBypass ??= {};
    NativeSettings.store.plugins.GoLiveBypass.bootPending = pending ? Date.now() : 0;
}

function bootWasPending() {
    const mark: unknown = NativeSettings.plain.plugins?.GoLiveBypass?.bootPending;
    if (mark === true) return true;
    if (typeof mark !== "number" || mark === 0) return false;

    // A marca so e limpa quando o proxy e solto, entao fechar o Discord antes disso, mesmo
    // depois de horas de uso, deixava ela de pe e a abertura seguinte recusava proxy em
    // silencio. Uma abertura que travou de verdade e reaberta em minutos, nao em horas.
    return Date.now() - mark < BOOT_MARK_MAX_AGE_MS;
}

function listening(port: number, timeoutMs: number): Promise<boolean> {
    return new Promise(resolve => {
        const socket = connect({ host: "127.0.0.1", port });
        const finish = (open: boolean) => {
            socket.destroy();
            resolve(open);
        };

        socket.setTimeout(timeoutMs, () => finish(false));
        socket.once("connect", () => finish(true));
        socket.on("error", () => finish(false));
    });
}

function readCachedProxy() {
    const cache: unknown = NativeSettings.plain.plugins?.GoLiveBypass?.verifiedProxy;
    if (typeof cache !== "object" || cache === null) return null;

    const { proxy, at } = cache as { proxy?: unknown; at?: unknown; };
    if (typeof proxy !== "string" || parseProxy(proxy) === null) return null;
    if (typeof at !== "number" || Date.now() - at > CACHE_MAX_AGE_MS) return null;

    return proxy;
}

function storeCachedProxy(proxy: string) {
    NativeSettings.store.plugins.GoLiveBypass ??= {};
    NativeSettings.store.plugins.GoLiveBypass.verifiedProxy = { proxy, at: Date.now() };
}

function excludedCountries() {
    const raw: unknown = RendererSettings.plain.plugins?.GoLiveBypass?.excludedCountries;
    const codes = typeof raw === "string" ? raw.split(",") : ["BR"];

    return new Set(codes.map(code => code.trim().toUpperCase()).filter(code => /^[A-Z]{2}$/.test(code)));
}

async function bootProxy() {
    const manual = manualProxy();
    if (manual === null) {
        log("o proxy do campo Proxy nao e valido, nada foi aplicado");
        return "";
    }
    if (manual !== "") {
        // Sem testar, um proxy fora do ar viraria conexao direta pelo fallback direct:// e o
        // bypass falharia em silencio, que foi exatamente o que aconteceu com o Tor fechado.
        const started = Date.now();
        if (await probe(manual, BOOT_PROBE_TIMEOUT_MS) !== null) {
            log(`seu proxy respondeu em ${Date.now() - started}ms: ${safeProxy(manual)}`);
            return manual;
        }

        log(`seu proxy nao respondeu: ${safeProxy(manual)}`);
        log("se for Tor, ele precisa estar aberto ANTES do Discord. Procurando alternativa.");
    }

    for (const port of TOR_PORTS) {
        const tor = `socks5://127.0.0.1:${port}`;
        if (!await listening(port, TOR_PORT_TIMEOUT_MS)) continue;

        if (await probe(tor, BOOT_PROBE_TIMEOUT_MS) !== null) {
            log(`Tor local encontrado na porta ${port}`);
            return tor;
        }
        log(`porta ${port} aberta mas nao respondeu como proxy, ignorando`);
    }

    // Sem Tor local a escolha de uma proxy gratuita levaria dezenas de segundos, e o gateway
    // conecta antes disso. Reaproveitar a ultima que funcionou resolve, desde que ela seja
    // testada de novo agora: aplicar uma proxy morta as cegas foi o que travava o Discord.
    const cached = readCachedProxy();
    if (cached !== null) {
        const started = Date.now();
        if (await probe(cached, BOOT_PROBE_TIMEOUT_MS) !== null) {
            log(`proxy guardada revalidada em ${Date.now() - started}ms: ${cached}`);
            return cached;
        }
        log("a proxy guardada morreu, procurando outra");
    }

    log("procurando uma proxy nova, isso demora e o gateway pode conectar antes");
    const picked = await sharedFreeProxy(excludedCountries());
    log(picked === null ? "nenhuma proxy passou nos testes" : `proxy escolhida: ${picked}`);

    return picked ?? "";
}

function manualProxy() {
    const settings = RendererSettings.plain.plugins?.GoLiveBypass;
    if (settings?.enabled !== true) return null;

    const { proxy } = settings;
    if (typeof proxy !== "string" || proxy.trim() === "") return "";

    // Invalido nao pode virar "vazio": cair na lista gratuita mandaria a sessao para um proxy
    // que a pessoa nunca escolheu.
    return parseProxy(proxy.trim()) === null ? null : proxy.trim();
}

// Traduz o endereco para a diretiva que o PAC entende. Um proxy HTTP e "PROXY", um SOCKS4 e
// "SOCKS", e so o SOCKS5 tem nome proprio.
function pacDirective(proxy: string) {
    const parsed = parseProxy(proxy);
    if (parsed === null) return null;

    // O campo Proxy so aceita socks5, http e https, entao nao ha caso de SOCKS4 para tratar.
    return `${parsed.scheme === "socks5" ? "SOCKS5" : "PROXY"} ${parsed.host}:${parsed.port}`;
}

// So os hosts de gateway atravessam o proxy. O gate e decidido na conexao do gateway, entao
// mandar o resto junto nao compra nada e custa velocidade em imagem, anexo, GIF e video
// incorporado, que e o que o usuario sente.
async function pacFor(proxy: string) {
    const directive = pacDirective(proxy);
    if (directive === null) return null;

    let fallback = "DIRECT";
    try {
        // Lido antes de instalar a nossa regra, senao leriamos a nossa propria. Quem esta atras
        // de proxy corporativo perderia o Discord se isto virasse DIRECT na marra.
        const resolved = await session.defaultSession.resolveProxy(`https://${DISCORD_HOST}`);
        if (typeof resolved === "string" && resolved.trim() !== "") fallback = resolved.trim();
    } catch (error) {
        log(`nao consegui ler a regra do sistema, usando DIRECT: ${error instanceof Error ? error.message : String(error)}`);
    }

    // O "; DIRECT" depois da diretiva e a rede anti-travamento: sem ele, um proxy morto faria o
    // gateway simplesmente nao conectar, e o Discord ficaria presa na tela de abertura. O preco
    // e degradar em silencio, e quem cobre isso e a nova tentativa, que detecta o bloqueio e
    // recarrega atras de outra saida.
    const script = `var routed = ${JSON.stringify(GATEWAY_HOSTS)};\n`
        + "function FindProxyForURL(url, host) {\n"
        + "    for (var i = 0; i < routed.length; i++)\n"
        + `        if (host === routed[i]) return ${JSON.stringify(`${directive}; DIRECT`)};\n`
        + `    return ${JSON.stringify(fallback)};\n`
        + "}\n";

    return `data:application/x-ns-proxy-autoconfig;base64,${Buffer.from(script, "utf8").toString("base64")}`;
}

async function apply(proxy: string) {
    const pacScript = await pacFor(proxy);
    if (pacScript === null) return false;

    log(`aplicando ${safeProxy(proxy)} so em ${GATEWAY_HOSTS.join(", ")}; o resto da sessao sai direto`);
    try {
        await session.defaultSession.setProxy({ mode: "pac_script", pacScript });
        await session.defaultSession.closeAllConnections();
    } catch {
        return false;
    }

    appliedProxy = proxy;
    markBoot(true);
    log(`proxy aplicado: ${safeProxy(proxy)}`);

    clearTimeout(deadline);
    deadline = setTimeout(() => {
        log("a sessao nao abriu no prazo, soltando o proxy para nao travar o Discord");
        clear();
    }, SESSION_DEADLINE_MS);
    return true;
}

async function clear() {
    if (appliedProxy !== null) log(`soltando ${safeProxy(appliedProxy)}, o resto da sessao volta para a regra do sistema`);
    clearTimeout(deadline);
    deadline = undefined;
    appliedProxy = null;
    markBoot(false);

    log("proxy liberado, so o gateway continua nele");

    try {
        // "system" e o que uma sessao intocada usa. Voltar para "direct" arrancaria o proxy
        // do sistema de quem esta atras de PAC, VPN ou proxy corporativo.
        await session.defaultSession.setProxy({ mode: "system" });
        await session.defaultSession.closeAllConnections();
    } catch {
        return false;
    }
    return true;
}

function readReply(socket: Socket, size: (buffer: Buffer) => number, done: (reply: Buffer | null) => void) {
    const chunks: Buffer[] = [];
    let settled = false;

    const finish = (reply: Buffer | null) => {
        if (settled) return;
        settled = true;
        socket.off("data", onData);
        socket.off("close", onClose);
        done(reply);
    };

    const onData = (chunk: Buffer) => {
        chunks.push(chunk);
        const buffer = Buffer.concat(chunks);
        const wanted = size(buffer);
        if (wanted < 0 || buffer.length < wanted) return;

        socket.pause();
        if (buffer.length > wanted) socket.unshift(buffer.subarray(wanted));
        finish(buffer.subarray(0, wanted));
    };

    // Um proxy que aceita a conexao e fecha limpo no meio da negociacao nao gera erro nenhum:
    // FIN nao e erro. Sem escutar o fechamento o callback nunca era chamado e a candidata
    // gastava o prazo inteiro antes de cair, uma por uma, no caminho sequencial.
    const onClose = () => finish(null);

    socket.on("data", onData);
    socket.on("close", onClose);
    socket.resume();
}

function negotiateSocks5(socket: Socket, host: string, port: number, credentials: { user: string; pass: string; }, done: (ok: boolean) => void) {
    const requestTarget = () => {
        readReply(socket, buffer => {
            if (buffer.length < 4) return -1;
            if (buffer[3] === 1) return 10;
            if (buffer[3] === 4) return 22;
            return buffer.length < 5 ? -1 : 7 + buffer[4];
        }, reply => done(reply !== null && reply[1] === 0));

        const target = Buffer.from(host, "latin1");
        socket.write(Buffer.concat([
            Buffer.from([5, 1, 0, 3, target.length]),
            target,
            Buffer.from([port >> 8, port & 0xff])
        ]));
    };

    readReply(socket, buffer => buffer.length < 2 ? -1 : 2, greeting => {
        if (greeting === null) return done(false);

        // 0 = sem autenticacao, 2 = usuario e senha (RFC 1929). Qualquer outro metodo, ou 0xFF,
        // significa que o proxy nao aceita nada que a gente sabe fazer.
        if (greeting[1] === 0) return requestTarget();
        if (greeting[1] !== 2) return done(false);

        const user = Buffer.from(credentials.user, "utf8");
        const pass = Buffer.from(credentials.pass, "utf8");
        if (user.length > 255 || pass.length > 255) return done(false);

        readReply(socket, buffer => buffer.length < 2 ? -1 : 2, reply => {
            if (reply === null || reply[1] !== 0) return done(false);
            requestTarget();
        });

        socket.write(Buffer.concat([
            Buffer.from([1, user.length]), user,
            Buffer.from([pass.length]), pass
        ]));
    });

    // Oferecer o metodo 2 so quando ha credencial: um proxy que aceita os dois escolheria a
    // autenticacao a toa, e ai um usuario vazio seria recusado.
    socket.write(credentials.user === "" ? Buffer.from([5, 1, 0]) : Buffer.from([5, 2, 0, 2]));
}

function negotiateConnect(socket: Socket, host: string, port: number, credentials: { user: string; pass: string; }, done: (ok: boolean) => void) {
    readReply(socket, buffer => {
        const end = buffer.indexOf("\r\n\r\n");
        return end < 0 ? -1 : end + 4;
    }, reply => done(reply !== null && /^HTTP\/1\.[01] 200/.test(reply.toString("latin1"))));

    // O proxy HTTP nao negocia metodo: ou a credencial vai junto do CONNECT, ou ele responde
    // 407 e a conexao ja era.
    const auth = credentials.user === ""
        ? ""
        : `Proxy-Authorization: Basic ${Buffer.from(`${credentials.user}:${credentials.pass}`, "utf8").toString("base64")}\r\n`;

    socket.write(`CONNECT ${host}:${port} HTTP/1.1\r\nHost: ${host}:${port}\r\n${auth}\r\n`);
}

function openTunnel(proxy: string, host: string, port: number, timeoutMs = PROBE_TIMEOUT_MS): Promise<Socket | null> {
    const parsed = parseProxy(proxy);
    if (parsed === null) return Promise.resolve(null);

    return new Promise(resolve => {
        const socket = connect({ host: parsed.host, port: parsed.port });
        let settled = false;

        const finish = (tunnel: Socket | null) => {
            if (settled) return;
            settled = true;
            clearTimeout(guard);
            socket.setTimeout(0);
            if (tunnel === null) socket.destroy();
            resolve(tunnel);
        };

        const guard = setTimeout(() => finish(null), timeoutMs);
        socket.setTimeout(timeoutMs, () => finish(null));
        socket.on("error", () => finish(null));
        socket.once("connect", () => {
            const done = (ok: boolean) => finish(ok ? socket : null);
            if (parsed.scheme === "socks5") negotiateSocks5(socket, host, port, parsed, done);
            else negotiateConnect(socket, host, port, parsed, done);
        });
    });
}

function readOverTls(socket: Socket, host: string, path: string, timeoutMs = PROBE_TIMEOUT_MS): Promise<string | null> {
    return new Promise(resolve => {
        let body = "";
        let settled = false;

        const finish = (value: string | null) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            tls.destroy();
            resolve(value);
        };

        const timer = setTimeout(() => finish(null), timeoutMs);
        const tls = connectTls({ socket, servername: host, host }, () => {
            tls.write(`GET ${path} HTTP/1.1\r\nHost: ${host}\r\nAccept: */*\r\nConnection: close\r\n\r\n`);
        });

        tls.setEncoding("latin1");
        tls.on("error", () => finish(null));
        tls.on("data", (chunk: string) => {
            body += chunk;
            if (body.length > 65536) finish(body);
        });
        tls.on("end", () => finish(body));
    });
}

async function probe(proxy: string, timeoutMs = PROBE_TIMEOUT_MS) {
    const started = Date.now();

    const socket = await openTunnel(proxy, DISCORD_HOST, 443, timeoutMs);
    if (socket === null) return null;

    const response = await readOverTls(socket, DISCORD_HOST, "/api/v9/gateway", timeoutMs);
    if (response === null || !response.startsWith("HTTP/1.1 200")) return null;

    return { proxy, ms: Date.now() - started };
}

async function exitCountry(proxy: string, timeoutMs = PROBE_TIMEOUT_MS) {
    const socket = await openTunnel(proxy, GEO_HOST, 443, timeoutMs);
    if (socket === null) return null;

    // O trace responde em cerca de 200 bytes com loc=XX. O ifconfig.co que estava aqui
    // devolvia um JSON inteiro e, pior, a resposta nao era conferida: um 429 dele nao casava
    // o padrao e uma candidata boa era descartada como pais desconhecido.
    const response = await readOverTls(socket, GEO_HOST, "/cdn-cgi/trace", timeoutMs);
    if (response === null || !response.startsWith("HTTP/1.1 200")) return null;

    const match = /^loc=([A-Z]{2})/m.exec(response);
    return match === null ? null : match[1];
}

// As duas conexoes sao feitas em sequencia de proposito: proxy gratuita sobrecarregada costuma
// limitar conexoes simultaneas, e abrir duas de uma vez reprovaria candidata boa. O paralelismo
// que importa e entre candidatas, e esta funcao inteira roda dentro do lote. Antes o pais era
// conferido uma candidata por vez DEPOIS de o lote terminar, o que sozinho somava dezenas de
// segundos ao tempo ate a primeira saida, bem no caminho em que o gateway ja esta conectando.
async function probeExit(proxy: string) {
    const result = await probe(proxy);
    if (result === null) return null;

    return { ...result, country: await exitCountry(proxy) };
}

async function accepts(proxy: string, excluded: Set<string>) {
    const country = await exitCountry(proxy);
    return country !== null && !excluded.has(country);
}

function rankFreeProxies(body: string, excluded: Set<string>) {
    const data: unknown = JSON.parse(body);
    const { proxies } = data as { proxies?: unknown };
    if (!Array.isArray(proxies)) return [];

    const usable: { proxy: string; uptime: number; timeout: number; }[] = [];

    for (const item of proxies) {
        if (typeof item !== "object" || item === null) continue;

        const entry = item as {
            proxy?: unknown;
            alive?: unknown;
            uptime?: unknown;
            timeout?: unknown;
            ip_data?: { countryCode?: unknown; };
        };

        if (typeof entry.proxy !== "string" || entry.alive !== true) continue;

        const parsed = parseProxy(entry.proxy);
        if (parsed === null || INTERCEPTING_PORTS.has(parsed.port)) continue;

        const uptime = typeof entry.uptime === "number" ? entry.uptime : 0;
        const timeout = typeof entry.timeout === "number" ? entry.timeout : MAX_LISTED_TIMEOUT;
        if (uptime < MIN_UPTIME || timeout > MAX_LISTED_TIMEOUT) continue;

        const country = typeof entry.ip_data?.countryCode === "string" ? entry.ip_data.countryCode.toUpperCase() : "";
        if (excluded.has(country)) continue;

        usable.push({ proxy: entry.proxy, uptime, timeout });
    }

    return usable
        .sort((a, b) => b.uptime - a.uptime || a.timeout - b.timeout)
        .slice(0, MAX_CANDIDATES)
        .map(entry => entry.proxy);
}

// O boot e o pedido do renderer procuram proxy ao mesmo tempo. Duas buscas paralelas disputam
// a mesma banda e dobram o tempo ate a primeira proxy ficar pronta, que e exatamente a janela
// em que o gateway conecta sem protecao. Quem chegar depois espera a busca que ja esta correndo.
let hunting: Promise<string | null> | null = null;

function sharedFreeProxy(excluded: Set<string>) {
    hunting ??= pickFreeProxy(excluded).finally(() => { hunting = null; });
    return hunting;
}

async function pickFreeProxy(excluded: Set<string>) {
    let candidates: string[];
    try {
        candidates = rankFreeProxies(await downloadText(FREE_PROXY_API), excluded);
    } catch {
        return null;
    }

    log(`${candidates.length} candidatas depois do ranqueamento`);

    for (let i = 0; i < candidates.length; i += PARALLEL_PROBES) {
        // map passa (item, indice, array), entao .map(probe) mandava o indice como timeout
        // e todas as candidatas estouravam o prazo em milissegundos.
        const batch = await Promise.all(candidates.slice(i, i + PARALLEL_PROBES).map(candidate => probeExit(candidate)));
        const working = batch
            .filter((result): result is { proxy: string; ms: number; country: string | null; } => result !== null)
            .sort((a, b) => a.ms - b.ms);

        log(`lote ${Math.floor(i / PARALLEL_PROBES) + 1}: ${batch.length} testadas, ${working.length} alcancaram o Discord`);

        for (const candidate of working) {
            const { proxy, ms, country } = candidate;
            if (country !== null && !excluded.has(country)) {
                log(`${safeProxy(proxy)} passou: ${ms}ms, saida em ${country}`);
                storeCachedProxy(proxy);
                return proxy;
            }
            log(`${safeProxy(proxy)} recusada: saida em ${country ?? "pais desconhecido"}`);
        }
    }

    return null;
}

async function detectTor(excluded: Set<string>) {
    for (const port of TOR_PORTS) {
        const proxy = `socks5://127.0.0.1:${port}`;
        if (await probe(proxy) !== null && await accepts(proxy, excluded)) return proxy;
    }

    return null;
}

function downloadText(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const req = request(url, res => {
            if (res.statusCode !== 200) {
                res.resume();
                reject(new Error("Unexpected response status"));
                return;
            }

            const chunks: Buffer[] = [];
            let size = 0;
            let settled = false;

            res.on("data", (chunk: Buffer) => {
                if (settled) return;

                size += chunk.length;
                if (size > MAX_LIST_BYTES) {
                    settled = true;
                    res.destroy();
                    reject(new Error("Response too large"));
                    return;
                }

                chunks.push(chunk);
            });

            res.on("end", () => {
                if (settled) return;
                settled = true;
                resolve(Buffer.concat(chunks).toString("utf8"));
            });
        });

        req.on("error", reject);
        req.setTimeout(15_000, () => req.destroy(new Error("Request timed out")));
        req.end();
    });
}

app.whenReady().then(async () => {
    // A regra do PAC nao carrega usuario e senha: ela so diz o endereco. Quando o proxy pede
    // autenticacao, quem responde e o Chromium, por este evento. Sem isto o proxy com senha
    // passaria nos nossos testes, que negociam na mao, e falharia no uso de verdade.
    app.on("login", (event, _webContents, _request, authInfo, callback) => {
        // Sem isto responderiamos a qualquer site que pedisse senha, entregando a credencial do
        // proxy para quem nao tem nada a ver com ela.
        if (!authInfo.isProxy || appliedProxy === null) return;

        const parsed = parseProxy(appliedProxy);
        if (parsed === null || parsed.user === "") return;
        if (authInfo.host !== parsed.host || authInfo.port !== parsed.port) return;

        event.preventDefault();
        callback(parsed.user, parsed.pass);
    });

    app.on("browser-window-created", (_event, win) => {
        win.webContents.on("did-fail-load", (_failed, code, _description, _url, isMainFrame) => {
            if (isMainFrame && code !== -3 && appliedProxy !== null) {
                log(`a pagina falhou ao carregar (${code}), voltando para conexao direta`);
                clear();
            }
        });
    });

    log("=".repeat(60));
    log(`abrindo | ${process.platform} ${process.arch} | electron ${process.versions.electron} | chrome ${process.versions.chrome}`);

    const stored: Record<string, unknown> = RendererSettings.plain.plugins?.GoLiveBypass ?? {};
    const show = (key: string, fallback: string) => (typeof stored[key] === "string" && stored[key] !== "" ? String(stored[key]) : fallback);
    log(`configuracao | proxy ${show("proxy", "") === "" ? "automatico" : "definido por voce"} | regiao de call ${show("voiceRegion", "automatica")} | regiao de stream ${show("streamRegion", "automatica")} | paises fora ${show("excludedCountries", "BR")}`);

    if (bootWasPending()) {
        markBoot(false);
        log("a abertura anterior nao terminou dentro de 10 minutos, entao nao vou aplicar proxy desta vez");
        log("isso e a rede de seguranca contra Discord travado; a proxima abertura volta ao normal");
        return;
    }

    const proxy = await bootProxy();
    if (proxy) apply(proxy);
});

function requestedCountries(raw: unknown) {
    return new Set(
        typeof raw === "string"
            ? raw.split(",").map(code => code.trim().toUpperCase()).filter(code => /^[A-Z]{2}$/.test(code))
            : []
    );
}

export async function enable(_: IpcMainInvokeEvent, excludedCountries: unknown) {
    if (appliedProxy !== null) return { success: true as const, proxy: appliedProxy };

    const excluded = requestedCountries(excludedCountries);

    const manual = manualProxy();
    if (manual === null) return { success: false as const, error: "O endereco no campo Proxy nao e valido. Use socks5://host:porta." };

    const proxy = manual || await detectTor(excluded) || await sharedFreeProxy(excluded);
    if (proxy === null || proxy === "")
        return { success: false as const, error: "No proxy could carry a real request to Discord, so the connection stays direct." };

    return await apply(proxy)
        ? { success: true as const, proxy }
        : { success: false as const, error: "Electron refused the proxy." };
}

export async function disable(_: IpcMainInvokeEvent) {
    return { success: await clear() };
}

export function getActiveProxy(_: IpcMainInvokeEvent) {
    return appliedProxy;
}

export function getLog(_: IpcMainInvokeEvent) {
    return history.join("\n");
}

export function sessionWorked(_: IpcMainInvokeEvent) {
    if (retries > 0) log(`sessao liberada depois de ${retries} tentativa(s)`);
    retries = 0;
}

// Quando a sessao sobe sem passar pelo proxy, o servidor continua bloqueando video e nao ha
// como consertar sem refazer o gateway. Recarregar com o proxy no ar resolve, mas so pode
// acontecer um numero fixo de vezes: sem teto isso vira a tela de carregamento infinita.
export async function retryWithProxy(event: IpcMainInvokeEvent, excludedCountries: unknown) {
    if (retries >= MAX_RETRIES) {
        log(`o servidor continuou bloqueando apos ${retries} tentativas, desistindo`);
        await clear();
        return { retried: false as const, reason: "tentativas esgotadas" };
    }

    const stale = appliedProxy;

    // Na primeira tentativa a causa provavel e a corrida: o gateway nasceu antes de o proxy
    // ficar pronto, e recarregar por tras do mesmo endereco conserta. Se ele falhou de novo,
    // insistir nao adianta: o Chromium lembra por alguns minutos de um proxy que falhou e
    // passa a usar o direct:// da nossa lista, entao a sessao renasceria direta de qualquer
    // jeito. A partir da segunda tentativa a saida precisa ser outra.
    let proxy = retries === 0 ? stale : null;
    if (proxy !== null && await probe(proxy) === null) {
        log(`${safeProxy(proxy)} parou de responder no meio da sessao`);
        proxy = null;
    }
    if (proxy === null && stale !== null) await clear();

    // Sem proxy no ar, recarregar cairia no fallback direct:// e repetiria a mesma falha. Aqui
    // nao ha corrida com o gateway para ganhar, entao vale a busca completa em vez dos prazos
    // curtos do boot: gastar meio minuto e melhor que recarregar para nada.
    if (proxy === null) {
        const excluded = requestedCountries(excludedCountries);
        const manual = manualProxy();

        const found = (manual !== null && manual !== "" && await probe(manual) !== null ? manual : null)
            ?? await detectTor(excluded)
            ?? await sharedFreeProxy(excluded);

        // Achar de novo o endereco que acabou de falhar nao ajuda: para o Chromium ele
        // continua marcado, e a sessao nasceria direta outra vez.
        proxy = found === stale ? null : found;

        if (proxy === null || !await apply(proxy)) {
            log(found === null ? "nenhum proxy respondeu, a sessao continua direta" : "so achei a mesma saida que ja falhou");
            await clear();
            return { retried: false as const, reason: found === null ? "nenhum proxy respondeu" : "sem saida nova" };
        }
    }

    if (event.sender.isDestroyed()) return { retried: false as const, reason: "janela indisponivel" };

    retries++;
    log(`o servidor bloqueou esta sessao, recarregando atras de ${safeProxy(proxy)} (tentativa ${retries} de ${MAX_RETRIES})`);

    // event.sender e a janela que roda o plugin. Guardar a primeira janela criada nao servia:
    // a primeira do Discord e a tela de abertura, e recarregar ela nao recarrega o cliente.
    event.sender.reload();
    return { retried: true as const, attempt: retries };
}

export async function testProxy(_: IpcMainInvokeEvent, proxyRules: unknown) {
    if (typeof proxyRules !== "string" || parseProxy(proxyRules.trim()) === null)
        return { success: false as const, error: "Invalid proxy format. Use socks5://host:port." };

    const result = await probe(proxyRules.trim());
    if (result === null)
        return { success: false as const, error: "The proxy could not carry a real request to Discord." };

    return { success: true as const, ms: result.ms, country: await exitCountry(proxyRules.trim()) };
}
