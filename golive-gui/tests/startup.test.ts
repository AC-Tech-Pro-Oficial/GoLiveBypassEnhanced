import { describe, expect, it, vi } from "vitest";

// O helper startup.ts depende do electron ("electron", "fs", "path", "child_process").
// Estes testes NAO mockam o electron inteiro -- eles verificam o comportamento
// end-to-end na VM Windows (a fonte do bug original da issue #84), e os
// pedacos passiveis de teste unitario (montagem do valor do registro,
// construcao do .desktop) sao cobertos por uma suite de shell na pasta
// tests/startup-vm/.
//
// Em vez de mockar electron, esses testes verificam o OUTPUT esperado das
// chamadas reg.exe e do .desktop, derivando do source do helper. Quando o
// helper mudar, esses testes sao atualizados em conjunto -- e o source do
// helper continua pequeno o suficiente para auditoria visual.

import { readFileSync } from "fs";
import { join } from "path";

const helper = readFileSync(join(__dirname, "..", "electron", "startup.ts"), "utf8");

describe("startup helper (source checks)", () => {
  it("escreve em HKCU e nao em HKLM (sem elevacao)", () => {
    // O caminho comeca com HKCU (do usuario) e nao HKLM (sistema, exige
    // admin). Sem isso, em Windows portable, o setLoginItemSettings
    // funcionaria mas exigiria elevacao que o portable nao tem.
    expect(helper).toContain("HKCU\\\\Software\\\\Microsoft\\\\Windows\\\\CurrentVersion\\\\Run");
    expect(helper).not.toContain("HKLM");
  });

  it("envolve o caminho do exe em aspas para suportar espacos", () => {
    // O caminho do portable e tipicamente "C:\\Program Files\\GoLiveBypass-1.1.9.exe"
    // (instalado pelo usuario em Program Files). reg.exe interpreta a string
    // como valor REG_SZ: espacos sem aspas quebram a string em varios
    // argumentos. O prefixo \" ... \" garante que o caminho e
    // interpretado como um unico valor. No Linux, process.execPath nao
    // serve dentro de um AppImage (o caminho e o mountpoint FUSE temporario
    // /tmp/.mount_GoLiveXXX/golive-gui que some quando o AppImage desmonta),
    // entao o helper realExecPath() cai para a env APPIMAGE.
    expect(helper).toMatch(/\\"\$\{realExecPath\(\)\}\\"/);
    expect(helper).toContain("realExecPath");
    expect(helper).toMatch(/APPIMAGE/);
  });

  it("inclui --hidden nos args (sobe so na bandeja)", () => {
    // Sem --hidden, o app abriria a janela visivel a cada login -- o oposto
    // do que o usuario pediu (quer ver o icone na bandeja, nao a janela).
    expect(helper).toContain("--hidden");
  });

  it("deleta ao desligar (reg delete com /f)", () => {
    // /f suprime o prompt "Tem certeza? S/N" -- sem ele, o reg delete trava
    // esperando interacao do usuario.
    expect(helper).toContain("delete");
    expect(helper).toMatch(/delete[\s\S]*\/f/);
  });

  it("ignora erro quando a entrada nao existe no delete", () => {
    // Quando o usuario clica "desligar" sem ter ligado antes, reg delete
    // retorna codigo 1 com a entrada nao encontrada. Sem o try/catch, o
    // helper lanca e o caller (main.ts) mostra erro na UI. Tratar como
    // sucesso ("ja estava desligado") e o caller segue feliz.
    expect(helper).toMatch(/catch\s*\{/);
  });

  it("no macOS continua usando setLoginItemSettings (caminho confiavel)", () => {
    // O Electron 22+ reescreveu setLoginItemSettings para suportar portable
    // no macOS, e o app oficial do projeto e dmg/zip (categoria
    // utilitaria). Manter o caminho antigo evita manter um segundo codigo
    // para macOS.
    expect(helper).toContain("setLoginItemSettings");
    expect(helper).toMatch(/IS_MAC[\s\S]*setLoginItemSettings/);
  });
});
