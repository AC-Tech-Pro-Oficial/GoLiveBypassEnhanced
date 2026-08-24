// Eventos de rede estruturados — o vocabulario canonicoo dos logs de diagnostico.
// Toda linha de rede responde tres perguntas sem grep: QUEM (host/saida), COMO
// (rota=tor|direta|proxy|reserva) e O QUE ACONTECEU (ok/code/errno/latencia_ms).
//
// Os pontos de instrumentacao vivem no main.ts; este modulo so sabe FALAR o formato.

import * as logger from "./logger";

export type Rota = "tor" | "direta" | "proxy" | "reserva" | "desconhecida";

export function gatewayConectando(host: string, rota: Rota) {
  logger.info("gateway", "ws.conectando", { host, rota });
}

export function gatewayResultado(host: string, ok: boolean, ms: number, code?: string) {
  const data: Record<string, unknown> = { host, ok, ms };
  if (code) data.code = code;
  if (ok) logger.info("gateway", "ws.resultado", data);
  else logger.warn("gateway", "ws.resultado", data);
}

export function gatewayDireto(host: string) {
  // O pior cenario para o usuario: o gateway nasceu pelo IP local (bloqueado).
  logger.warn("gateway", "ws.saiu_direto", { host });
}

export function torBootstrap(linhaTor: string) {
  // stdout do daemon: "Bootstrapped 85% (conn): ..." — guarda progresso e resumo
  const m = /Bootstrapped (\d+)% \(([^)]+)\)/.exec(linhaTor);
  if (m) logger.info("tor", "bootstrap", { progresso: `${m[1]}%`, etapa: m[2] });
}

export function torTunelVerificado(ms: number, porta: number) {
  logger.info("tor", "tunel.verificado", { ms, porta });
}

export function tunelRecusado(porta: number, tentativa: number, total: number, motivo?: string) {
  const data: Record<string, unknown> = { porta, tentativa, de: total };
  if (motivo) data.motivo = motivo;
  logger.warn("tor", "tunel.recusado", data);
}

export function torPortaReaproveitada(porta: number) {
  logger.info("tor", "porta.reaproveitada", { porta });
}

export function socksFalha(motivo: string, detalhe?: Record<string, unknown>) {
  logger.error("net", "socks.falha", { motivo, ...detalhe });
}

export function rotaEscolhida(host: string, rota: Rota, saida?: string, latenciaMs?: number) {
  const data: Record<string, unknown> = { host, rota };
  if (saida) data.saida = saida;
  if (latenciaMs !== undefined) data.latencia_ms = latenciaMs;
  logger.info("net", "rota.escolhida", data);
}

// Wrapper para operacoes de rede do processo (fetch/downloads): registra inicio,
// sucesso e falha com codigo — inclusive o erro que hoje some silencioso.
export async function comLogRede<T>(op: string, fn: () => Promise<T>): Promise<T> {
  const inicio = Date.now();
  try {
    const r = await fn();
    logger.info("net", "fetch.ok", { op, ms: Date.now() - inicio });
    return r;
  } catch (err) {
    const e = err as Error & { code?: string };
    logger.error("net", "fetch.falha", {
      op,
      code: e.code ?? "desconhecido",
      erro: e.message,
      ms: Date.now() - inicio,
    });
    throw err;
  }
}
