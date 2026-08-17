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

## Dependências: o que baixar e como instalar

Você precisa de **4 programas** antes de começar. Instale na ordem. Depois de instalar cada um, **feche e abra o terminal de novo** — o Windows só reconhece programas novos em terminais abertos depois da instalação.

### 1. Git — o programa que baixa código do GitHub

É ele que faz o `git clone` (baixar) deste repositório e do Equicord/Vencord.

**Windows (jeito mais fácil):**
1. Abra o **PowerShell** (tecla Windows → digite "PowerShell" → Enter)
2. Rode: `winget install Git.Git`
3. Ou, se preferir baixar manualmente: entre em [git-scm.com/download/win](https://git-scm.com/download/win), baixe o instalador de 64-bit e clique em **Next** em tudo (as opções padrão são as certas)

**Linux:** `sudo apt install git` (Debian/Ubuntu) ou o equivalente da sua distro.
**macOS:** `brew install git`.

**Confira se deu certo** (num terminal novo): `git --version` → deve mostrar algo como `git version 2.x.x`. Se disser "comando não encontrado", feche e abra o terminal.

### 2. Node.js 22 ou superior — o motor que compila o plugin

O Equicord/Vencord é feito em TypeScript, e quem transforma isso no programa final é o Node. **Versão menor que 22 quebra o build.**

**Windows/macOS:**
1. Entre em [nodejs.org](https://nodejs.org/) e baixe o botão verde **LTS** (qualquer LTS a partir do 22)
2. Instale clicando em **Next** em tudo — deixe marcada a opção de adicionar ao PATH (vem marcada)
3. Ou pelo terminal: `winget install OpenJS.NodeJS.LTS`

**Linux:** use o [NodeSource](https://github.com/nodesource/distributions) — o Node dos repositórios da distro costuma ser velho demais.

**Confira:** `node --version` → precisa mostrar `v22.x.x` ou maior.

### 3. pnpm — o instalador de peças do projeto

O projeto usa **pnpm** (e não o npm que vem com o Node) para baixar as bibliotecas do build. Você não baixa instalador nenhum: o Node já traz o **Corepack**, que ativa o pnpm com dois comandos.

Num terminal (depois de instalar o Node):

```bash
corepack enable
corepack prepare pnpm@latest --activate
```

Se der erro de permissão no Windows, abra o PowerShell **como administrador** e rode de novo. Se o Corepack não existir, a alternativa é: `npm install -g pnpm`.

**Confira:** `pnpm --version` → o projeto foi testado com pnpm 11.

### 4. Discord para computador — onde o plugin vai rodar

O plugin **só funciona no app de computador** (ele usa recursos do Electron que o navegador não tem):

- **Discord normal**: baixe em [discord.com/download](https://discord.com/download) (stable, PTB ou Canary servem); ou
- **Vesktop/Equibop**: apps alternativos que já trazem o mod embutido.
- **Não funciona** no Discord aberto no navegador nem no celular.

### Opcional: Tor Browser — para proxy manual (recomendado para anonimato)

Se quiser usar Tor em vez da proxy gratuita automática, instale o [Tor Browser](https://www.torproject.org/download/) e **abra ele antes de abrir o Discord**. O endereço dele é `socks5://127.0.0.1:9150`. Se não configurar nada, o plugin busca e testa uma proxy gratuita sozinho — sem nenhuma dependência extra.

## Instalação: passo a passo completo

Escolha **Equicord** ou **Vencord** — os dois funcionam, o processo é idêntico. Os exemplos usam Equicord; para Vencord, troque o link do clone por `https://github.com/Vendicated/Vencord` e a pasta para `Vencord`.

### Passo 1 — Baixe o código do Equicord

Abra o terminal, vá para a pasta onde quer guardar o projeto e clone:

```bash
cd Documents
git clone https://github.com/Equicord/Equicord
cd Equicord
```

### Passo 2 — Instale as bibliotecas do build

```bash
pnpm install
```

Isso baixa tudo que o Equicord precisa para compilar (demora um pouco na primeira vez, é normal).

### Passo 3 — Baixe o plugin e coloque na pasta certa

Duas formas de baixar este repositório:

- **Pelo terminal** (estando fora da pasta Equicord): `git clone https://github.com/bezumiya/GoLiveBypass`
- **Pelo navegador**: abra [github.com/bezumiya/GoLiveBypass](https://github.com/bezumiya/GoLiveBypass), clique no botão verde **Code → Download ZIP** e extraia o arquivo

Depois copie a pasta **`goLiveBypass`** (a que contém `index.ts` e `native.ts`) para dentro de:

```
Equicord/src/userplugins/goLiveBypass
```

**Atenção aos detalhes que mais quebram:**

- A pasta `userplugins` **não existe por padrão** — crie ela dentro de `src/`
- Ela fica em `src/userplugins`, **ao lado** de `src/plugins` — **nunca dentro** de `src/plugins` (isso gera o erro `Could not resolve "./plugins/userplugins"` no build)
- No final, o caminho dos arquivos deve ser exatamente `src/userplugins/goLiveBypass/index.ts` e `src/userplugins/goLiveBypass/native.ts`

### Passo 4 — Compile

```bash
pnpm build
```

Isso gera a pasta `dist/` com o Equicord modificado já incluindo o plugin. Se aparecer algum erro vermelho, leia a seção **Solução de problemas** antes de tentar de novo.

### Passo 5 — Injete no Discord

**Feche o Discord completamente antes** (ícone na bandeja perto do relógio → botão direito → **Quit Discord**). Depois:

```bash
pnpm inject
```

O instalador abre uma janelinha perguntando **qual Discord** você usa (Stable, PTB ou Canary) — escolha o seu e confirme. É isso que "injetar" faz: ele aponta o seu Discord para o build que você compilou. Para desfazer depois, basta rodar `pnpm uninject` na mesma pasta.

### Passo 6 — Ative o plugin e use

1. Abra o Discord
2. Vá em **Configurações → Equicord (ou Vencord) → Plugins** e ative **GoLiveBypass**
3. Aperte **Ctrl+R** para recarregar — a sessão renasce atrás da proxy (você verá o toast `GoLiveBypass active...` e depois `GoLiveBypass off. Direct connection restored.`)
4. Entre num canal de voz: **Go Live e câmera liberados**

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
