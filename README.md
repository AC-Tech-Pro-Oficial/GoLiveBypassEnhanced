# GoLiveBypass — Bypass do Go Live no Discord (Brasil)

Plugin para **Equicord** e **Vencord**, feito por um desenvolvedor brasileiro, que **devolve o Go Live e a câmera para usuários brasileiros**: ele sobe o Discord inteiro atrás de uma proxy fora do Brasil (Tor ou proxy gratuita automática testada) **em cada abertura e reload do app**, fazendo o gate de região do Discord liberar os recursos — e depois remove a proxy, deixando a conexão direta. De quebra, seu IP real não fica exposto na autenticação.

> **English summary below / Resumo em inglês no final.**

## Por que este plugin existe

Em agosto de 2026, a ANPD [ordenou que o Discord suspendesse as transmissões ao vivo (Go Live) no Brasil](https://www.gov.br/anpd/pt-br/assuntos/noticias/em-medida-preventiva-anpd-determina-que-discord-suspenda-transmissoes-ao-vivo-no-brasil), pouco depois de o país ter bloqueado o X (Twitter). Para quem depende dessas plataformas para se comunicar, organizar e denunciar, o recado foi claro: o acesso e a privacidade dos brasileiros na internet podem ser cortados por canetaço.

O GoLiveBypass nasce dessa luta. Ele é uma ferramenta de **privacidade e resistência à censura**: garante que o momento mais sensível da sua sessão — a autenticação, quando sua conta é vinculada ao seu endereço de IP — aconteça atrás de uma proxy anônima.

**O que ele entrega, verificado na prática:** como a sessão do Discord nasce inteira atrás da proxy, o **Go Live e a câmera voltam a funcionar** para contas brasileiras — veja a seção abaixo.

## Go Live no Brasil: por que funciona

Testes práticos mostram que o bloqueio do Go Live funciona assim:

- O Discord verifica sua região **apenas no momento em que você entra num canal de voz** (`VOICE STATE UPDATE`), usando o **IP da conexão WebSocket do gateway** — e **nunca reavalia** durante a chamada.
- O WebSocket do gateway é aberto no boot do app. Se ele nasce atrás de uma proxy fora do Brasil, o gate de região libera telas e câmera para contas brasileiras.
- A mídia (UDP) não passa por verificação nenhuma — ela pode sair direta pelo seu IP real sem derrubar a liberação.

Ou seja, o fluxo do GoLiveBypass — **boot inteiro atrás da proxy → proxy removida após a sessão abrir** — reproduz automaticamente o bypass manual "ligar VPN, abrir o Discord, entrar na call, desligar a VPN".

**Ressalvas honestas:**

- A liberação vale enquanto o WebSocket do gateway continuar vivo. Se ele cair e reconectar pelo seu IP real (queda de internet, troca de rede), a próxima entrada em canal de voz volta a ser avaliada como BR — dê Ctrl+R para repetir o ciclo atrás da proxy.
- Isso depende de comportamento atual do Discord, que pode mudar a qualquer momento.
- Usar proxy/VPN para contornar a restrição pode violar os Termos de Serviço do Discord. Risco de punição à conta é baixo, mas existe — considere usar uma conta secundária.

## Avisos importantes

- **Só funciona no app desktop** (Discord com Equicord/Vencord injetado, Vesktop ou Equibop). Não funciona na versão de navegador/extensão.
- **Proxies gratuitas são fracas para anonimato**: o operador da proxy vê seus metadados de conexão, muitas estão mortas ou são lentas, e o Discord pode pedir captcha/verificação extra para IPs de proxies públicas. Para anonimato real, **use Tor** (`socks5://127.0.0.1:9050`).
- Usar clientes modificados viola os Termos de Serviço do Discord. Use por sua conta e risco.
- A proxy cobre a inicialização e o login. Após a sessão abrir (`CONNECTION_OPEN`), o tráfego volta a ser direto com seu IP real.
- Num reload (Ctrl+R), os primeiros instantes do boot podem sair diretos antes do plugin aplicar a proxy. Com proxy manual (Tor), a aplicação no processo principal acontece o mais cedo possível.

## Como funciona

1. A proxy é aplicada **pelo processo principal do app, antes de qualquer carregamento de página** — na abertura do app e em **todo reload (Ctrl+R)** — e também logo após um **logout**. Ou seja, a sessão do Discord (autenticação, gateway e os flags de funcionalidades que o servidor libera por região/IP) nasce inteira atrás da proxy.
2. Com proxy manual configurada (ex.: Tor), a aplicação acontece o mais cedo possível, antes da primeira requisição. Sem proxy manual, a última proxy gratuita que funcionou fica **salva em disco** e é reutilizada em todo boot (inclusive boot frio), enquanto o renderer busca uma nova em paralelo.
3. Ao completar o login (`LOGIN_SUCCESS` / `CONNECTION_OPEN`), a proxy é removida e a conexão direta é restaurada — como no fluxo "ligar VPN, abrir o Discord, desligar VPN".
4. Proteções contra travamento:
   - proxies gratuitas são **testadas antes de aplicar** (handshake SOCKS5/SOCKS4a ou HTTP CONNECT contra `discord.com:443`, até 8 candidatas) e **filtradas por país** (padrão: sem BR);
   - **watchdog de 120s**: se a sessão não abrir, a proxy é removida com um aviso;
   - **loop-breaker**: se uma tentativa com proxy não terminar, a próxima inicialização pula a proxy por 3 minutos.

## Dependências

Antes de instalar o plugin, você precisa de quatro coisas. As três primeiras são ferramentas de build; a quarta é o app onde o plugin vai rodar.

### 1. Git — para baixar os códigos-fonte

É o programa que clona este repositório e o do Equicord/Vencord.

- **Windows**: baixe em [git-scm.com/download/win](https://git-scm.com/download/win) e instale com as opções padrão, ou rode `winget install Git.Git` no terminal.
- **Linux**: `sudo apt install git` (Debian/Ubuntu) ou o equivalente da sua distro.
- **macOS**: `brew install git` ou use o que já vem com as Xcode Command Line Tools.
- Verifique: `git --version` — qualquer versão recente serve.

### 2. Node.js 22 ou superior — para compilar o plugin

O Equicord/Vencord é escrito em TypeScript e o build roda em Node. Versões antigas quebram o build, então confira a sua.

- **Windows/macOS**: baixe o instalador **LTS** em [nodejs.org](https://nodejs.org/) (qualquer LTS ≥ 22 serve), ou `winget install OpenJS.NodeJS.LTS`.
- **Linux**: use o [NodeSource](https://github.com/nodesource/distributions) ou o gerenciador de pacotes da sua distro (evite versões muito antigas dos repositórios).
- Verifique: `node --version` — precisa mostrar `v22` ou maior.

### 3. pnpm — o gerenciador de pacotes do projeto

O Equicord/Vencord usa pnpm (não npm) para instalar as dependências do build. A forma mais fácil de instalar é pelo **Corepack**, que já vem com o Node:

```bash
corepack enable
corepack prepare pnpm@latest --activate
```

- Se o Corepack não estiver disponível, instale global: `npm install -g pnpm`.
- Verifique: `pnpm --version` — o projeto foi testado com pnpm 11.

### 4. Um cliente Discord desktop — onde o plugin roda

O plugin só funciona em app desktop (usa recursos do Electron):

- **Discord normal** (stable, PTB ou Canary) — o `pnpm inject` do Equicord/Vencord instala o mod nele; ou
- **Vesktop / Equibop** — que já vêm com Vencord/Equicord embutido.
- **Não funciona** no Discord do navegador nem no app de celular.

### Opcional: Tor Browser — proxy manual recomendada

Se quiser usar Tor em vez da proxy gratuita automática, instale o [Tor Browser](https://www.torproject.org/download/) e deixe-o aberto antes de abrir o Discord. O SOCKS dele fica em `socks5://127.0.0.1:9150`. Sem proxy manual configurada, o plugin busca e testa uma proxy gratuita sozinho — nenhuma dependência extra necessária.

## Instalação

### Equicord

```bash
git clone https://github.com/Equicord/Equicord
cd Equicord
pnpm install

# copie a pasta goLiveBypass deste repositório para:
#   Equicord/src/userplugins/goLiveBypass

pnpm build
pnpm inject   # escolha seu Discord no instalador
```

Reinicie o Discord completamente (bandeja do sistema → Quit Discord) e ative o plugin em **Settings → Equicord → Plugins → GoLiveBypass**.

### Vencord

O processo é idêntico, usando o repositório do Vencord:

```bash
git clone https://github.com/Vendicated/Vencord
cd Vencord
pnpm install

# copie a pasta goLiveBypass deste repositório para:
#   Vencord/src/userplugins/goLiveBypass

pnpm build
pnpm inject
```

Reinicie o Discord e ative o plugin em **Settings → Vencord → Plugins → GoLiveBypass**.

### Vesktop / Equibop

Copie a pasta para `src/userplugins/goLiveBypass` no código do Equicord/Vencord, rode `pnpm build` e aponte o Vesktop/Equibop para esse build (ou use a opção de dev settings). O plugin usa IPC nativo, então precisa de um build desktop completo.

## Configuração

Nas settings do plugin:

- **Proxy**: proxy usada na inicialização/login, no formato `esquema://host:porta`.
  - Tor (recomendado): `socks5://127.0.0.1:9050` (Tor Browser aberto) ou `socks5://127.0.0.1:9150` (daemon Tor), dependendo do seu setup.
  - **Deixe vazio** para buscar uma proxy gratuita automática (testada antes de aplicar).
- **Free proxy protocol**: protocolo usado na busca automática (SOCKS5, HTTP ou SOCKS4). Ignorado quando há proxy manual.
- **Excluded countries**: códigos de país de duas letras separados por vírgula cujas proxies nunca são usadas na busca automática (padrão: `BR`). Exemplo: `BR,RU,CN`.

## Uso

1. Ative o plugin e configure sua proxy (ou deixe a automática).
2. Abra o Discord, dê Ctrl+R ou faça logout — um toast confirma: `GoLiveBypass active. Login traffic goes through ...`.
3. Ao entrar: `GoLiveBypass off. Direct connection restored.` — o resto do uso segue com conexão direta.

## Solução de problemas

- **Discord carregando infinitamente**: as proteções (watchdog + loop-breaker) devem destravar sozinhas em até ~1 minuto. Se persistir, desative o plugin editando `%APPDATA%/Equicord/settings/settings.json` (ou `%APPDATA%/Vencord/settings/settings.json`) com o Discord fechado: `"GoLiveBypass": { "enabled": false }`.
- **"GoLiveBypass could not get a free proxy"**: a lista gratuita não tinha nenhuma proxy funcional. Tente outro protocolo ou configure uma proxy manual.
- **Captcha ou verificação de telefone no login**: o Discord marca muitos IPs de proxies públicas. Use Tor ou outra proxy.
- **Erro de build `Could not resolve "./plugins/userplugins"`**: você copiou a pasta para dentro de `src/plugins/` por engano. O caminho certo é `src/userplugins/goLiveBypass` — a pasta `userplugins` fica em `src/`, **ao lado** de `plugins`, e pode ser necessário criá-la.
- **Plugin não aparece na lista**: confirme que a pasta está em `src/userplugins/goLiveBypass` (com `index.ts` e `native.ts`) e que você rodou `pnpm build` + `pnpm inject` e reiniciou o Discord.

## Estrutura

```
goLiveBypass/
├── index.ts   # renderer: settings, eventos de fluxo, watchdog, toasts
└── native.ts  # processo principal: session.setProxy, teste de proxies, lista gratuita
```

## Licença

GPL-3.0-or-later, mesma licença do Vencord/Equicord. Veja [LICENSE](LICENSE).

---

# English

**GoLiveBypass** is an **Equicord/Vencord** plugin, made by a Brazilian developer, that **restores Go Live and camera for Brazilian Discord users**: it boots Discord entirely behind a proxy outside Brazil (Tor or a tested, automatically fetched free proxy) **on every launch and reload**, so Discord's region gate — evaluated once at voice-channel join using the gateway WebSocket origin IP, and never re-evaluated mid-call — unlocks the features. The proxy is dropped once the session opens, restoring a direct connection. As a bonus, your real IP stays hidden during authentication.

It was written after Brazil's data protection authority (ANPD) [ordered Discord to suspend live streaming (Go Live) in Brazil](https://www.gov.br/anpd/pt-br/assuntos/noticias/em-medida-preventiva-anpd-determina-que-discord-suspenda-transmissoes-ao-vivo-no-brasil) in August 2026, shortly after the country blocked X (Twitter). It works while the gateway WebSocket stays alive — if it reconnects over your real IP, press Ctrl+R to boot behind the proxy again. Bypassing the restriction may violate Discord's ToS.

- Desktop only (injected Discord, Vesktop or Equibop). Not available on the browser extension.
- Dependencies: Git, Node.js 22+, pnpm 11 (via `corepack enable`), and a desktop Discord client (or Vesktop/Equibop). Optionally Tor Browser for a manual proxy.
- Free proxies are weak for anonymity — prefer Tor: `socks5://127.0.0.1:9050`.
- Install: copy the `goLiveBypass` folder into `src/userplugins/` of your Equicord or Vencord clone, then `pnpm install && pnpm build && pnpm inject`, fully restart Discord, and enable **GoLiveBypass** in plugin settings.
- Free proxies are tested before use and filtered by country (default: no BR); a 120s watchdog and a startup loop-breaker prevent infinite reload loops.
- License: GPL-3.0-or-later.
