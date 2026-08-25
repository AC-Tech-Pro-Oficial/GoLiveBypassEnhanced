// Pasta de logs estavel + espelho do log do bypass.
//
// O log do standalone (golivebypass.log) mora dentro do app.asar injetado no
// Discord e SOME quando o Discord atualiza ou o bypass e desativado. Aqui ele e
// espelhado para <settingsDir>/logs/, que sobrevive a updates — e o report de
// bug le deste lugar (o app.asar vira so fallback).

import fs from "fs";
import path from "path";

const MIRROR_MAX_BYTES = 2 * 1024 * 1024; // rotaciona igual ao standalone

export function settingsDirDe(raizHome: string, plataforma: string): string {
  if (plataforma === "win32") {
    const localAppData = process.env.LOCALAPPDATA || path.join(raizHome, "AppData", "Local");
    return path.join(localAppData, "GoLiveBypass");
  }
  const base = process.env.XDG_DATA_HOME || path.join(raizHome, ".local", "share");
  return path.join(base, "GoLiveBypass");
}

export function logsDir(raizHome: string, plataforma: string): string {
  return path.join(settingsDirDe(raizHome, plataforma), "logs");
}

export function garantirLogsDir(raizHome: string, plataforma: string): string {
  const dir = logsDir(raizHome, plataforma);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // sem pasta, segue sem espelho
  }
  return dir;
}

// Espelha o golivebypass.log injetado para logs/bypass.log, com rotacao
// (bypass.1.log). Chamado ao detectar installs e no writeSessionMarker.
// Falha silenciosa: nunca derruba o app por causa do espelho.
export function espelharLogBypass(
  origem: string,
  raizHome: string,
  plataforma: string,
): void {
  try {
    if (!origem || !fs.existsSync(origem)) return;
    const dir = garantirLogsDir(raizHome, plataforma);
    const alvo = path.join(dir, "bypass.log");
    const backup = path.join(dir, "bypass.1.log");

    if (fs.existsSync(alvo) && fs.statSync(alvo).size > MIRROR_MAX_BYTES) {
      fs.renameSync(alvo, backup);
    }
    fs.copyFileSync(origem, alvo);
  } catch {
    // silencioso
  }
}

// Caminhos de log do bypass na pasta estavel (para o report ler).
export function logsBypassDisponiveis(raizHome: string, plataforma: string): string[] {
  const dir = logsDir(raizHome, plataforma);
  const out: string[] = [];
  try {
    if (!fs.existsSync(dir)) return out;
    for (const nome of ["bypass.log", "bypass.1.log"]) {
      const p = path.join(dir, nome);
      if (fs.existsSync(p)) out.push(p);
    }
  } catch {
    // sem logs
  }
  return out;
}
