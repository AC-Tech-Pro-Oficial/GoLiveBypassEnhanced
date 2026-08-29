# GoLiveBypass - Expertise e Arquitetura do Projeto

Este documento concentra conhecimento técnico sobre como o **GoLiveBypass** funciona por baixo dos panos, para servir de referência na evolução do projeto.

## 1. O Problema Original
O Discord atribui um experimento de servidor a partir do IP de origem do websocket de gateway. Contas cujo IP cai numa região restrita (como o Brasil) não recebem os botões de Go Live/câmera, e a transmissão trava, fica preta ou some na tela "Carregando" (RTC Connecting).

## 2. A Solução (GoLiveBypass)
O projeto injeta um script (`golivebypass.js`) direto no processo principal do Discord (dentro do `app.asar`), sem depender de Vencord/Equicord. O script sobe um roteador SOCKS5 local no loopback e instala um PAC (`session.defaultSession.setProxy({ mode: "pac_script", ... })`) que manda **só** `*.discord.gg` (o websocket de gateway/sinalização) por esse roteador; todo o resto sai `DIRECT`.

**Ponto chave, fácil de errar:** o áudio/vídeo do Go Live (WebRTC, hosts `*.discord.media`) **nunca passa pelo proxy**. Só a sinalização do gateway é roteada — o suficiente para o servidor atribuir o experimento pelo IP "certo" e liberar os botões. Depois disso a mídia sai pela conexão real do usuário, que é como o Discord já lida com WebRTC normalmente. Isso significa que problemas de transmissão (tela preta, vídeo cortando) quase nunca são causados por UDP/NAT no proxy — são outra coisa (ver seção 5).

## 3. Arquitetura da Injeção
- O Discord usa Electron; seu código mora em `resources/app.asar`.
- O GoLiveBypass (GUI Electron em `golive-gui/`, ou os scripts standalone `.ps1`/`.sh`) localiza as instalações do Discord (Estável, PTB, Canary).
- O `app.asar` original é renomeado para `_app.asar` (backup, usado para desativar depois).
- Uma pasta nova `app.asar` é criada, com `package.json` falso, `index.js` (`require('./golivebypass.js')`) e o próprio `golivebypass.js`.
- `golive-gui/electron/bypass.ts` é **gerado** a partir de `standalone/golivebypass.js` (`npm run sync-bypass` dentro de `golive-gui/`) como uma string embutida — o electron-builder empacota num asar e um arquivo solto não sobreviveria. Editar `standalone/golivebypass.js` sem rodar o sync (parte do `npm run compile`) deixa a GUI injetando código velho.
- A GUI grava o `settings.json` real (o que o script injetado lê) dentro do próprio `app.asar` injetado, não em `%LOCALAPPDATA%/GoLiveBypass/settings.json` — esse último é só o valor lembrado para pré-preencher o campo da UI. Só o log (`golivebypass.log`) fica garantido em `%LOCALAPPDATA%/GoLiveBypass`, de propósito, para sobreviver a atualização/desativação do Discord.

## 4. Escolha de saída (`golivebypass.js`)
Três modos, decididos por `routeMode` no settings.json:
- **Proxy manual/privado** (`settings.proxy` preenchido): usado na hora, sem esperar probe, para vencer a corrida contra o gateway (~12s de orçamento). Reservas e troca proativa por RTT ficam **desligadas** para saída manual (ver seção 5) — só troca em morte confirmada de verdade.
- **Tor** (`routeMode: "tor"`): a GUI sobe um Tor embutido; só ele conta, nunca cai para gratuita.
- **Gratuitas** (`routeMode: "free"` ou fallback do "auto"): baixa listas públicas de proxies SOCKS5, testa em paralelo (probe = túnel + TLS + `GET /api/v9/gateway`, aceita HTTP 200 ou 404 — a Cloudflare responde 404 nesse path hoje) e mantém um pote de reservas com batimento a cada 30s, troca proativa por RTT e recarga automática quando a sessão nasceu direta.

**Fluxo do `routeMode` no Linux (issue #108):** no Windows/macOS a GUI materializa `routeMode`/`torAddr` no settings.json de dentro do asar injetado; no Linux GUI e runtime **compartilham** `~/.local/share/GoLiveBypass/settings.json` (o stub do asar requer o patcher de `$INSTALL_DIR`). O default virtual `tor` do `readNetMode()` já fez o runtime nascer `auto` (default lá é diferente de propósito: CLI puro) e cair nas gratuitas com Tor de pé. Trava de segurança atual, em três camadas independentes: (1) `linuxActivate` materializa o modo no disco antes de injetar (via `updateSharedSettings`, merge atômico — escritores parciais de settings são proibidos); (2) o modo também vai por argv (`--net-mode`/`--tor-addr`) e a `install_patcher` grava a flag por cima do arquivo, preservando `autoUpdate`; (3) o primeiro log do bypass diz o modo efetivo, o `--status --json` expõe o `routeMode` do disco e o bug report manda `routeModeDisco` — qualquer divergência GUI×runtime é diagnosticável pelo log. Detalhe de probe: endereço Tor se prova com handshake TLS até `gateway.discord.gg` em qualquer modo — a Cloudflare recusa o probe HTTP de `discord.com` vindo de exit Tor, o que fazia o `auto` perder um Tor saudável.

## 5. Armadilha conhecida: reconexão do gateway mata o vídeo
O motor de voz/vídeo do Discord é um binário WASM fechado. Uma reconexão do websocket de gateway **no meio de uma Live/call** — mesmo limpa, mesmo trocando para uma saída boa, sem nunca vazar para IP direto — deixa o vídeo travado (só áudio) até a pessoa dar Ctrl+R. Isso está confirmado ao vivo (CDP, 2026-08-23) e é a causa mais provável de "proxy funciona mas a Live fica preta" quando a conectividade em si está ok.

Consequência prática: qualquer mecanismo que troque a saída ativa sem necessidade (heartbeat/RTT sendo "esperto" demais) é pior que não trocar. Isso é especialmente traiçoeiro com um proxy privado multiplexado (várias portas do mesmo servidor): o RTT entre portas é quase idêntico, então o filtro que deveria impedir troca por ruído (`SWAP_RESERVA_RAZAO`) quase nunca barra nada, e a "proteção" vira o próprio motivo da queda. Por isso `stockReserves`/`trySwapByRtt` ignoram saída manual — só a morte real (sem resposta em 2 batimentos) troca.

**Rotação de circuito do Tor (issue #122):** o Tor renova circuitos a cada ~10 min (`MaxCircuitDirtiness`) e um SOCKS CONNECT durante a construção do circuito novo leva 5-30s (o `SocksTimeout` do Tor é 60s+). Por isso, no modo tor, o batimento é **informativo** (nunca derruba a saída única — falso negativo do probe de 4s era garantia de janela de recusa a cada rotação, com janelas de 30-57 min sem gateway no log da issue) e o relay do gateway usa `TOR_RELAY_TIMEOUT_MS` (30s), não o prazo de 2.5s pensado para gratuita. A morte real do daemon é detectada pelo `listening()` no `detectTor` (chamado do `refreshExit`) e pelo watchdog da GUI.

## 6. Dificuldades técnicas conhecidas
- **EBUSY/EPERM no Windows:** o Electron (GUI) e o próprio Discord travam `app.asar` para leitura. A GUI usa `withNoAsar(fn)` (`process.noAsar = true`) para renomear/escrever `.asar` sem `EBUSY`.
- **Encerramento seguro:** mexer no Discord com ele aberto quebra a instalação — é obrigatório matar todos os processos (`Discord.exe`, todas as *flavours*) antes de injetar ou desinjetar.
- **Atualização automática do Windows é caseira:** o alvo de build é `portable` (não NSIS), então `electron-updater` não serve para Windows — o updater próprio baixa o exe novo da release do GitHub, confere digest e substitui `PORTABLE_EXECUTABLE_FILE` em uso (ver `golive-gui/electron/updater.ts`).
- **Build não assinado:** o exe atual não tem assinatura Authenticode. Combinado com o padrão portable-que-se-autosubstitui e a injeção em outro processo instalado, isso é gatilho clássico de heurística de ML de antivírus (ex.: Wacatac.B!ml, Sabsik.EN.A!ml) — falso positivo conhecido, não um bug funcional. Mitigação real exige assinatura de código (paga, ou gratuita via programa open source como o SignPath.io) — não há fix só de código que remova o padrão sem mudar a arquitetura.

## 7. VM de proxy privado (quando existir)
Se o projeto estiver usando um VM com `3proxy` para oferecer portas SOCKS5 multiplexadas (ex.: range `10000-10050`), confira sempre:
- `auth strong` + `users` **precisa** de uma linha `allow <usuario>` depois — sem ela o 3proxy aceita qualquer usuário/senha (proxy aberto), mesmo com `auth strong` configurado.
- `bandlimin`/`bandlimout` no 3proxy são compartilhados por todas as conexões do mesmo usuário (não é por conexão) — mas como só o gateway (sinalização, tráfego mínimo) passa pelo proxy, isso raramente é o gargalo real.
