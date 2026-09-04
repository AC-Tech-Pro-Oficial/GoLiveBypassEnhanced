// Redacao do report em camadas — arquivo PURO (zero imports de Electron) para ser
// testavel com vitest sem mock de app.
//
//   L1 — padroes conhecidos (regex): credenciais em URL, cabecalhos de auth,
//        tokens do Discord, query string de URL do gateway, o proprio token da API.
//   L2 — segredos conhecidos: valores REAIS configurados pelo usuario (usuario,
//        senha e host da proxy personalizada em settings.json) removidos por
//        ocorrencia literal — pega vazamento fora de padrao tambem.
//   L3 — varredura final: sobrou algum segredo conhecido no payload? Entao nada
//        sai da maquina: o envio falha por seguranca.
//
// Regra do produto: hosts/portas de gateway do Discord e saidas podem aparecer
// (diagnostico precisa disso); credenciais da proxy personalizada JAMAIS.

export type SegredosConhecidos = string[];

// Credenciais embutidas na URL: scheme://usuario:senha@host -> usuario:***@host
const RE_CREDS_URL = /(\w[\w+.-]*:\/\/)([^\s/:@]+):([^\s/@]+)@/g;
// Cabecalhos de autenticacao inteiros (linha em log de rede, dump, etc.)
const RE_HEADER_AUTH = /^((?:proxy-)?authorization\s*:\s*).+$/gim;
// Tokens do Discord (formato mfa.* e JWT-like de 3 segmentos)
const RE_DISCORD_TOKEN = /\b(mfa\.[\w-]{20,}|[MN][\w-]{23}\.[\w-]{6}\.[\w-]{27,40})\b/g;
// Query string de URL do gateway carrega params de sessao — so o host interessa
const RE_GATEWAY_QUERY = /(https:\/\/gateway[^?\s]+)\?\S*/g;

export function l1Padroes(texto: string): string {
  return (
    texto
      .replace(RE_CREDS_URL, (_tudo, scheme, user) => `${scheme}${user}:***@`)
      .replace(RE_HEADER_AUTH, "$1***")
      .replace(RE_DISCORD_TOKEN, "***")
      .replace(RE_GATEWAY_QUERY, "$1?<params>")
  );
}

// Extrai os segredos da proxy personalizada salva pelo usuario. A proxy vem como
// socks5://usuario:senha@host:porta (ou host:porta seca). Devolve as variantes
// literais que NAO PODEM aparecer no report.
export function extrairSegredosDaProxy(proxySalva: string): SegredosConhecidos {
  const segredos: SegredosConhecidos = [];
  const p = proxySalva.trim();
  if (!p) return segredos;

  const m = /^[a-z][a-z0-9+.-]*:\/\/([^/@]+)@(.+)$/i.exec(p);
  if (m) {
    const [, auth, resto] = m;
    const doisPontos = auth.indexOf(":");
    if (doisPontos > 0) {
      segredos.push(auth.slice(0, doisPontos)); // usuario
      segredos.push(auth.slice(doisPontos + 1)); // senha
    } else {
      segredos.push(auth); // so usuario
    }
    const hostPorta = resto.split(/[/?#]/)[0];
    if (hostPorta) segredos.push(hostPorta); // host:porta
    segredos.push(p); // a URL inteira
  }
  // Proxy sem credencial: o host:porta identifica o provedor do usuario — tambem sai.
  if (segredos.length === 0 && p.length >= 7) {
    segredos.push(p);
  }
  return segredos.filter((s) => s.length >= 3);
}

export function redigirLiterais(
  texto: string,
  valores: SegredosConhecidos,
  marcador = "<dado-sensivel>",
): string {
  let out = texto;
  for (const s of valores) {
    if (s.length < 3) continue;
    // split/join em vez de replace com regex: o valor pode conter metacaracteres.
    out = out.split(s).join(marcador);
  }
  return out;
}

export function l2Segredos(texto: string, segredos: SegredosConhecidos): string {
  return redigirLiterais(texto, segredos, "<proxy-pessoal>");
}

export function redigir(texto: string, segredos: SegredosConhecidos, tokenApi?: string): string {
  let out = l1Padroes(texto);
  const todos = tokenApi ? [...segredos, tokenApi] : segredos;
  return l2Segredos(out, todos);
}

// L3: devolve os segredos que SOBREVIVERAM ao pipeline. Lista nao-vazia = bloquear
// o envio (nada deve sair da maquina com segredo do usuario dentro).
export function segredosRemanescentes(
  texto: string,
  segredos: SegredosConhecidos,
  tokenApi?: string,
): string[] {
  const todos = tokenApi ? [...segredos, tokenApi] : segredos;
  return todos.filter((s) => s.length >= 3 && texto.includes(s));
}

// Corta preservando o fim (o recente importa mais) sem partir uma linha no meio.
export function cortarDoFim(texto: string, maxBytes: number): string {
  const buf = Buffer.from(texto, "utf8");
  if (buf.length <= maxBytes) return texto;
  const cauda = buf.subarray(buf.length - maxBytes);
  const primeiraQuebra = cauda.indexOf(10); // \n
  const inicio = primeiraQuebra >= 0 ? primeiraQuebra + 1 : 0;
  return "[...] " + cauda.subarray(inicio).toString("utf8");
}
