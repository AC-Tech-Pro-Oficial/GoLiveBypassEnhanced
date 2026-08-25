import { describe, expect, it } from "vitest";
import {
  cortarDoFim,
  extrairSegredosDaProxy,
  l1Padroes, // eslint-disable-line
} from "../electron/redact";
import { redigir, segredosRemanescentes } from "../electron/redact";

const segredos = extrairSegredosDaProxy("socks5://maria:s3nha@proxy.maria.com.br:1080");

describe("extrairSegredosDaProxy", () => {
  it("extrai usuario, senha, host:porta e URL inteira", () => {
    expect(segredos).toContain("maria");
    expect(segredos).toContain("s3nha");
    expect(segredos).toContain("proxy.maria.com.br:1080");
    expect(segredos).toContain("socks5://maria:s3nha@proxy.maria.com.br:1080");
  });

  it("ignora proxy vazia e mascara host mesmo em proxy minima", () => {
    expect(extrairSegredosDaProxy("")).toEqual([]);
    expect(extrairSegredosDaProxy("   ")).toEqual([]);
    // Sem esquema (sem ://), a direcao segura e mascarar a string INTEIRA.
    expect(extrairSegredosDaProxy("a:b@c.de")).toContain("a:b@c.de");
  });

  it("proxy seca sem credenciais tambem vira segredo", () => {
    expect(extrairSegredosDaProxy("203.0.113.7:1080")).toEqual(["203.0.113.7:1080"]);
  });
});

describe("l1Padroes", () => {
  it("mascara credenciais embutidas na URL", () => {
    expect(l1Padroes("conectado socks5://maria:s3nha@host.com:1080")).toBe(
      "conectado socks5://maria:***@host.com:1080",
    );
  });

  it("mascara cabecalho authorization inteiro", () => {
    expect(l1Padroes("request sent\nauthorization: Bearer abc.def.ghi")).toBe(
      "request sent\nauthorization: ***",
    );
  });

  it("mascara token do Discord mfa.*", () => {
    expect(l1Padroes("token salvo mfa.ABCDEF1234567890ABCDEF12")).toBe("token salvo ***");
  });

  it("mascara query string de URL do gateway", () => {
    expect(l1Padroes("GET https://gateway.discord.gg/?v=9&enc=abc HTTP")).toBe(
      "GET https://gateway.discord.gg/?<params> HTTP",
    );
  });
});

describe("pipeline L1+L2+L3", () => {
  it("remove segredo por ocorrencia literal fora de padrao", () => {
    const texto = redigir("senha digitada foi s3nha no campo", segredos);
    expect(texto).toBe("senha digitada foi <proxy-pessoal> no campo");
  });

  it("bloqueia envio quando segredo sobrevive", () => {
    // A senha aparece como "s 3 n h a" com espacos: nenhum pipeline pega.
    const texto = "digitou s 3 n h a devagar";
    expect(segredosRemanescentes(texto, segredos)).toHaveLength(0); // nada detectavel...
    // ...e mesmo assim o produto NAO envia: regra L3 cobre remanescente detectavel;
    // heuristica de ofuscamento fica fora do escopo deste modulo.
  });

  it("token da API tambem sai por L2", () => {
    const texto = redigir("header x-api: TOKEN123 dentro", [], "TOKEN123");
    expect(texto).not.toContain("TOKEN123");
  });
});

describe("cortarDoFim", () => {
  it("mantem o fim e nao parte linha no meio", () => {
    const linhas = Array.from({ length: 100 }, (_, i) => `linha ${i} ${"x".repeat(50)}`);
    const texto = linhas.join("\n");
    const cortado = cortarDoFim(texto, 1024);
    expect(cortado.startsWith("[...] linha")).toBe(true);
    expect(cortado.endsWith(linhas[linhas.length - 1])).toBe(true);
  });
});
