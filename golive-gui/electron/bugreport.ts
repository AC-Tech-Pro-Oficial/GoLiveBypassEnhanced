// Cliente do report de bugs: coleta logs (GUI + standalone injetado no Discord),
// redige em camadas e envia para https://api.skyplaceia.com/bugs/v1/reports.
//
// Garantias de privacidade (testadas em tests/redact.test.ts):
//   L1 - padroes regex: credenciais em URL, headers de auth, tokens Discord, query do gateway
//   L2 - ocorrencias literais da proxy personalizada salva pelo usuario
//   L3 - varredura final: segredo sobrevivente = NADA sai da maquina

import { app } from "electron";
import fs from "fs";
import path from "path";
import * as logger from "./logger";
import * as logsDir from "./logsDir";
import {
  cortarDoFim,
  extrairSegredosDaProxy,
  redigir,
  segredosRemanescentes,
  type SegredosConhecidos,
} from "./redact";

const BUG_API_URL = "https://api.skyplaceia.com/bugs/v1/reports";
const BUG_BLOCK_STATUS_URL = "https://api.skyplaceia.com/bugs/v1/block-status";
// Token compartilhado da API de bugs. Extraivel por design (app distribuido);
// o escopo dele e so criar issue num repo publico, com rate limit por IP.
const BUG_API_TOKEN = "c3d0bff691ecc3ddc6f6ca10037b9ac967c62547e681d3749204e50800504511";

const LOG_TAIL_BYTES = 96 * 1024; // cauda do gui.log / golivebypass.log
// Teto total do bloco de log montado — abaixo dos 256KB que o servidor aceita
// (a API corta em 256KB, mas o JSON com escaping cresce; 240KB deixa folga).
const LOG_TOTAL_MAX = 240 * 1024;
const DESC_MAX = 8 * 1024;
const TITLE_MAX = 200;

export interface ReportPayload {
  title: string;
  description?: string;
  includeLogs: boolean;
}

export interface ReportResult {
  ok: boolean;
  issueUrl?: string;
  issueNumber?: number;
  error?: string;
  // Bloqueio por rate limit: o usuario mandou reports em excesso e o servidor
  // o bloqueou por `retryAfter` segundos.
  blocked?: boolean;
  retryAfter?: number;
}

function settingsDir(raizHome: string): string {
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA || path.join(raizHome, "AppData", "Local");
    return path.join(localAppData, "GoLiveBypass");
  }
  const base = process.env.XDG_DATA_HOME || path.join(raizHome, ".local", "share");
  return path.join(base, "GoLiveBypass");
}

function lerArquivoSeguro(file: string, maxBytes = LOG_TAIL_BYTES): string {
  try {
    if (!fs.existsSync(file)) return "";
    const buf = fs.readFileSync(file);
    const pedaco = buf.length > maxBytes ? buf.subarray(buf.length - maxBytes) : buf;
    let texto = pedaco.toString("utf8");
    if (pedaco.length < buf.length) texto = texto.slice(texto.indexOf("\n") + 1); // linha partida fora
    return texto;
    } catch {
    return "";
  }
}

// A proxy personalizada vive no settings.json da pasta compartilhada (e, em instalacoes
// antigas, dentro do app.asar injetado). De la saem APENAS os segredos p/ varredura.
export function coletarSegredos(dadosRaiz: string): SegredosConhecidos {
  const dir = settingsDir(dadosRaiz);
  const candidatos = [
    path.join(dir, "settings.json"),
    // installs antigos guardavam settings dentro do asar; varre os resources marcados na sessao
    ...installsDaSessao(dir).map((r) => path.join(r, "app.asar", "settings.json")),
  ];
  for (const file of candidatos) {
    try {
      if (!fs.existsSync(file)) continue;
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      if (typeof data.proxy === "string" && data.proxy.trim()) {
        const s = extrairSegredosDaProxy(data.proxy);
        if (s.length) return s;
      }
    } catch {
      // arquivo corrompido/asar: segue pro proximo candidato
    }
  }
  return [];
}

function installsDaSessao(dir: string): string[] {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, "session.json"), "utf8"));
    return Array.isArray(raw?.installs) ? raw.installs.filter((x: unknown) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

// Monta o bloco de log completo (ring buffer da GUI + caudas de arquivo), ja redigido.
export function montarLog(
  dadosRaiz: string,
  segredos: SegredosConhecidos,
  tokenApi: string,
): string {
  const partes: string[] = [];

  const recente = logger.getRecent();
  partes.push("=== sessao GUI (ring buffer) ===");
  partes.push(recente);

  // O gui.log complementa o ring buffer: o ring guarda as 1000 linhas mais
  // recentes; a cauda do arquivo so interessa pelo que VEIO ANTES disso.
  // Sem a dedup, o report repetia a sessao inteira duas vezes.
  const guiLog = lerArquivoSeguro(path.join(logsDir.logsDir(dadosRaiz, process.platform), "gui.log"));
  if (guiLog) {
    const primeiraDoRing = recente.split("\n").find((l) => l.trim() !== "");
    const complemento = primeiraDoRing
      ? guiLog.slice(0, guiLog.indexOf(primeiraDoRing))
      : guiLog;
    if (complemento.trim()) {
      partes.push("=== gui.log (antes do ring buffer) ===");
      partes.push(complemento.trimEnd());
    }
  }

  // Log do bypass — 1o o que o standalone realmente escreve no INSTALL_DIR
  // (<settingsDir>/golivebypass.log), depois o espelho estavel logs/bypass.log
  // e o app.asar injetado (fallbacks).
  const plataforma = process.platform;
  const bypassDireto = lerArquivoSeguro(path.join(settingsDir(dadosRaiz), "golivebypass.log"));
  if (bypassDireto) {
    partes.push("=== golivebypass.log (INSTALL_DIR) ===");
    partes.push(bypassDireto);
  }

  const bypassEstavel = logsDir.logsBypassDisponiveis(dadosRaiz, plataforma);
  for (const p of bypassEstavel) {
    const conteudo = lerArquivoSeguro(p);
    if (conteudo) {
      partes.push(`=== bypass.log (${path.basename(p)}) ===`);
      partes.push(conteudo);
    }
  }

  for (const resources of installsDaSessao(settingsDir(dadosRaiz))) {
    const alvo = fs.existsSync(path.join(resources, "app.asar"))
      ? path.join(resources, "app.asar", "golivebypass.log")
      : path.join(resources, "golivebypass.log");
    const conteudo = lerArquivoSeguro(alvo);
    if (conteudo) {
      partes.push(`=== golivebypass.log (${path.basename(path.dirname(resources))}) ===`);
      partes.push(conteudo);
    }
  }

  return redigir(partes.join("\n"), segredos, tokenApi);
}

// Metadados tecnicos: diagnostico sem identificar a pessoa nem expor a saida escolhida.
export function montarMeta(
  netMode: string,
  statusBypass: string,
  torAtivo: boolean,
  torPorta: number | null,
  routeModeDisco: string,
  autoRevive?: boolean,
): Record<string, string> {
  return {
    versao: app.getVersion(),
    plataforma: `${process.platform}-${process.arch}`,
    electron: process.versions.electron ?? "?",
    node: process.versions.node ?? "?",
    locale: app.getLocale() || "?",
    modoRoteamento: netMode === "auto" ? "personalizado" : netMode === "free" ? "gratuitas" : "tor",
    // O modo que o runtime VAI ler (settings.json no disco). Divergencia daqui com o
    // modoRoteamento de cima = drift de configuracao (o cenario da issue #108, que
    // dizia tor com o runtime rodando auto).
    routeModeDisco: routeModeDisco === "" ? "ausente" : routeModeDisco,
    // O revive automatico so age com a flag LIGADA (leitura do RUNTIME, nao da GUI):
    // report sem nenhum gw.revive com "desligado" aqui e comportamento esperado.
    autoRevive: autoRevive === false ? "desligado" : "ligado",
    bypass: statusBypass.toLowerCase(),
    tor: torAtivo ? `ativo:${torPorta ?? "?"}` : "inativo",
    uptime_s: String(Math.round(process.uptime())),
    installs: String(installsDaSessao(settingsDir(app.getPath("home"))).length),
    // Diagnostico da deteccao do Discord — sem caminhos completos do usuario.
    localappdata_presente: process.env.LOCALAPPDATA ? "sim" : "nao",
  };
}

export async function submitBugReport(
  payload: ReportPayload,
  ctx: {
    netMode: string;
    routeModeDisco?: string;
    autoRevive?: boolean;
    statusBypass: string;
    torAtivo: boolean;
    torPorta: number | null;
    installsFlavours?: string;
  },
): Promise<ReportResult> {
  const title = payload.title.trim().slice(0, TITLE_MAX);
  if (!title) return { ok: false, error: "Informe um resumo do problema." };

  const home = app.getPath("home");
  const segredos = payload.includeLogs ? coletarSegredos(home) : [];
  const description = (payload.description ?? "").slice(0, DESC_MAX);

  const corpo: { title: string; description: string; log?: string; meta: Record<string, string> } = {
    title,
    description: redigir(description, segredos, BUG_API_TOKEN),
    meta: {
      ...montarMeta(ctx.netMode, ctx.statusBypass, ctx.torAtivo, ctx.torPorta, ctx.routeModeDisco ?? "", ctx.autoRevive),
      // Flavours vistos na varredura (discord,vesktop,...) — mostra na hora se
      // um cliente paralelo foi achado ou se o report e de "nao achei o Vesktop".
      ...(ctx.installsFlavours ? { installs_flavours: ctx.installsFlavours } : {}),
    },
  };
  if (payload.includeLogs) corpo.log = cortarDoFim(montarLog(home, segredos, BUG_API_TOKEN), LOG_TOTAL_MAX);

  // L3 — ultima barreira: se algum segredo conhecido sobreviveu, nada sai daqui.
  if (payload.includeLogs) {
    const textoCompleto = JSON.stringify(corpo);
    const remanescentes = segredosRemanescentes(textoCompleto, segredos, BUG_API_TOKEN);
    if (remanescentes.length > 0) {
      logger.error("report", "envio bloqueado: segredo remanescente no payload");
      return {
        ok: false,
        error: "Envio bloqueado por seguranca: sua proxy apareceu nos logs. O report NAO foi enviado.",
      };
    }
  }

  try {
    // Antes de montar/enviar o report, consulta se este IP esta bloqueado por
    // spam. Se estiver, nem tenta — devolve o bloqueio com o tempo restante
    // para a UI mostrar a mensagem.
    const blockStatus = await consultarBlockStatus();
    if (blockStatus.blocked) {
      logger.warn("report", "bloqueado por rate limit antes do envio", { retry_after: blockStatus.retryAfter });
      return {
        ok: false,
        blocked: true,
        retryAfter: blockStatus.retryAfter,
        error: `Voce esta bloqueado por enviar reports em excesso. Tente de novo em ${blockStatus.retryAfter}s.`,
      };
    }

    const res = await fetch(BUG_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${BUG_API_TOKEN}`,
      },
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(15_000),
    });

    if (res.status === 201) {
      const data = (await res.json()) as { issue_url?: string; issue_number?: number };
      logger.info("report", "enviado", { issue: data.issue_number });
      return { ok: true, issueUrl: data.issue_url, issueNumber: data.issue_number };
    }
    if (res.status === 429) {
      // Bloqueado no meio do envio: o servidor devolve o tempo no header Retry-After.
      const retryAfter = Number(res.headers.get("Retry-After") ?? 60);
      logger.warn("report", "bloqueado por rate limit no envio", { retry_after: retryAfter });
      return {
        ok: false,
        blocked: true,
        retryAfter,
        error: `Voce esta bloqueado por enviar reports em excesso. Tente de novo em ${retryAfter}s.`,
      };
    }
    if (res.status === 401) return { ok: false, error: "Autenticacao recusada pelo servidor." };
    if (res.status === 413) return { ok: false, error: "Report grande demais. Tente anexar menos logs." };

    logger.error("report", "servidor recusou", { status: res.status });
    return { ok: false, error: `O servidor recusou o report (HTTP ${res.status}).` };
  } catch (err) {
    const e = err as Error & { name?: string };
    logger.warn("report", "falha de rede no envio", { erro: e.message });
    const offline = e.name === "TimeoutError" || e.name === "AbortError";
    return {
      ok: false,
      error: offline
        ? "Sem resposta do servidor (rede/timeout). Verifique sua conexao."
        : "Nao consegui enviar o report. Verifique sua conexao.",
    };
  }
}

// Consulta GET /v1/block-status. Se a consulta falhar (offline, 5xx), trata como
// nao bloqueado — o POST seguinte dara o veredito real (e o 429 cobre o caso).
async function consultarBlockStatus(): Promise<{ blocked: boolean; retryAfter: number }> {
  try {
    const res = await fetch(BUG_BLOCK_STATUS_URL, {
      method: "GET",
      headers: { Authorization: `Bearer ${BUG_API_TOKEN}` },
      signal: AbortSignal.timeout(5_000),
    });
    if (res.status !== 200) return { blocked: false, retryAfter: 0 };
    const data = (await res.json()) as { blocked?: boolean; retry_after?: number };
    return {
      blocked: data.blocked === true,
      retryAfter: Math.max(1, Math.round(data.retry_after ?? 0)),
    };
  } catch {
    return { blocked: false, retryAfter: 0 };
  }
}
