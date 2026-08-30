import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

// A decisao da guarda vive no main.ts com estado de modulo (ativacaoCorrente /
// assinaturaUltimaAtivacao), entao o que se testa aqui e a logica de decisao,
// espelhada, mais o fato de ela existir e estar ligada no activateBypass.
// A guarda existe por causa da #145: duas ativacoes em 7s (boot + clique com
// status velho) injetaram duas vezes e a segunda derrubou o gateway recem-nascido.

function assinaturaAtivacao(proxy: string, modo: string): string {
  return JSON.stringify({ proxy: proxy.trim(), modo });
}

function devePularReativacao(args: {
  assinatura: string;
  assinaturaAnterior: string;
  status: string;
  injetadas: boolean[];
}): boolean {
  return (
    args.assinatura === args.assinaturaAnterior &&
    args.status === "ACTIVE" &&
    args.injetadas.every(Boolean)
  );
}

describe("guarda de ativacao duplicada", () => {
  const base = {
    assinaturaAnterior: assinaturaAtivacao("", "tor"),
    status: "ACTIVE",
    injetadas: [true],
  };

  it("pula quando ja ativo, injetado e com a mesma proxy/modo", () => {
    expect(
      devePularReativacao({ ...base, assinatura: assinaturaAtivacao("", "tor") }),
    ).toBe(true);
  });

  it("normaliza espacos da proxy na assinatura (o campo da UI vem com espaco a mais)", () => {
    expect(assinaturaAtivacao("  ", "tor")).toBe(assinaturaAtivacao("", "tor"));
    expect(
      devePularReativacao({
        ...base,
        assinaturaAnterior: assinaturaAtivacao("socks5://x:1080", "tor"),
        assinatura: assinaturaAtivacao(" socks5://x:1080 ", "tor"),
      }),
    ).toBe(true);
  });

  it("nao pula quando a proxy mudou (re-injecao legitima)", () => {
    expect(
      devePularReativacao({ ...base, assinatura: assinaturaAtivacao("socks5://x:1080", "tor") }),
    ).toBe(false);
  });

  it("nao pula quando o modo mudou", () => {
    expect(
      devePularReativacao({ ...base, assinatura: assinaturaAtivacao("", "free") }),
    ).toBe(false);
  });

  it("nao pula com status INACTIVE (o activate precisa re-injetar)", () => {
    expect(
      devePularReativacao({ ...base, status: "INACTIVE", assinatura: assinaturaAtivacao("", "tor") }),
    ).toBe(false);
  });

  it("nao pula quando algum install perdeu a injecao", () => {
    expect(
      devePularReativacao({
        ...base,
        injetadas: [true, false],
        assinatura: assinaturaAtivacao("", "tor"),
      }),
    ).toBe(false);
  });

  it("o main.ts realmente serializa ativacoes e compara a assinatura antes de injetar", () => {
    const src = fs.readFileSync(path.resolve(process.cwd(), "electron/main.ts"), "utf8");
    expect(src).toContain("if (ativacaoCorrente !== null)");
    expect(src).toContain("assinaturaUltimaAtivacao = assinatura;");
    expect(src).toContain("getStatus() === \"ACTIVE\" &&");
  });

  it("a reativacao de boot atualiza janela e bandeja no fim (sucesso ou falha)", () => {
    // Relato do testador na beta 4 (#149): a janela carregava no meio da
    // reativacao e o botao ficava em "Ativar" com o bypass ja de pe.
    const src = fs.readFileSync(path.resolve(process.cwd(), "electron/main.ts"), "utf8");
    expect(src).toMatch(/autoInject: bypass reativado"[\s\S]{0,600}refreshWindowStatus\(\);/);
    expect(src).toMatch(/autoInject falhou:[\s\S]{0,600}refreshWindowStatus\(\);/);
  });
});
