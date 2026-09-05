# Changelog

- Aligns Windows Discord discovery with Equilotl by selecting only the newest usable `app-*` directory for each Discord channel. Stale Squirrel versions no longer force a needless reinjection of the already-patched active version.
- Fixes recognized-checkout cleanup for the normal `Equicord\dist\desktop` and `Vencord\dist\desktop` paths, while preserving the fail-closed guard for unrelated injectors or missing `_app.asar` backups.
- Fixes Windows reinstalls when Discord already points to another recognized Vencord/Equicord checkout. The installer now safely restores the validated `_app.asar` before reinjection instead of entering Equilotl's failing `Unpatching first` path.
- Fixes the RTC recovery path against Discord's current native voice ABI. Viewer streams are now identified from `connectionOptions.context` even though Discord creates them through the generic voice factory, private local/stream identities are retained only inside the isolated preload, and viewer resubscription calls the live `setDisableLocalVideo` method.
- Removes the outbound broadcaster-demand requirement from viewer stall detection. Discord's `video-stream-receiver-ready-timeout` can now trigger the targeted UDP reconnect and video resubscription while broadcaster recovery keeps its stricter remote-demand guard.
- Registers the RTC preload before renderer IPC is available, replaces the misleading "shim active" signal with sanitized hook/connection readiness, rejects recovery actions for stale connection generations, and cancels escalation if the observed stream is replaced or intentionally stopped.
- Adds executable regressions for cached native factories, generic-factory viewer classification, the current bound-wrapper ABI, disabled-video suppression, viewer recovery without broadcaster demand, and stale-generation rejection.
- Changes the Windows one-line splash to a full-terminal `KINGCIR` frame for two seconds, with a compact fallback for redirected/non-interactive output.
- Hardens the Electron GUI boundary: `nodeIntegration: false`, `contextIsolation: true`, `contextBridge` preload API, trusted external-link allowlist, and wrapped IPC notifications that do not expose Electron event objects.
- Redacts local user/home paths from public bug reports and blocks submission if a known local path survives the final privacy scan.
- Adds an explicit GUI tests + TypeScript/Vite compile job to the enhanced verification workflow.

## Enhanced fork — RTC recovery v1

### Changed
- Replaces destructive native RTC recovery with role-aware state machines. Broadcaster stalls replay/clear+replay the exact captured desktop source on the same native connection; viewer stalls use `fastUdpReconnect()` then a targeted `setLocalVideoDisabled(streamUserId, true/false)` resubscription.
- Adds decoder telemetry and a regression for issue #186: a viewer that previously decoded ~30 FPS can re-enter with `fps_dec=0` / `dec=0`; replacement sockets alone no longer count as recovery.
- Recovery success now requires 10 seconds of sustained encoded/decoded frame progress. Voice, `discord.media`, gateway and renderer are preserved by automatic RTC recovery.
- Fixes a broadcaster-start failure captured in a real Windows log: capture remained alive at ~30 FPS while encoded FPS/frames stayed at zero; after level-1 source replay, Discord dropped the remote-demand signal and the old controller incorrectly cancelled just before level 2. Pending broadcaster recovery now survives that demand drop only while the same native stream still owns a sanitized cached desktop source. A voluntary `clearDesktopSource()` clears that ownership bit and still cancels recovery, preventing a stopped share from being resurrected.
- Adds sanitized `fonte=sim/nao` / source-age diagnostics to the standalone/GUI voice probe so future broadcaster failures show whether the desktop source is still logically selected without exposing source IDs or arguments.
- Ports the same role-aware RTC shim/controller into the Vencord/Equicord userplugin; clean current Vencord and Equicord checkouts are compiled in CI.
- Reworks the one-click Windows path to preserve/reinject Vencord or Equicord instead of replacing their `app.asar` with the standalone injector. Existing mod settings/plugins are backed up and verified after installation, with rollback/reinjection on failure.
- Makes the same one-liner a zero-to-ready bootstrap on clean Windows machines: if no compatible Discord client exists, it downloads the current official Discord Stable installer from Discord, validates its Authenticode signature, installs it silently, then clones/builds Equicord by default (or Vencord when explicitly selected), installs the enhanced plugin, and provisions hidden Tor before the first normal Discord launch.
- Adds explicit legacy/conflict migration: restores known old standalone injections, transactionally replaces stale GoLiveBypass userplugin source, clears only GoLiveBypass native routing/cache state, resets migrated voice/stream regions to Automatic, preserves unrelated mod/plugin state, and verifies enhanced RTC markers in the compiled bundle before declaring success.
- Recovers the active Vencord/Equicord identity from the standalone `_app.asar` backup when both source checkouts exist, and backs up/disables a known competing `DiscordGoLiveBypass` Windows autostart without deleting that third-party executable.
- Uses a full-terminal `KINGCIR` frame for two seconds in the public one-click installer, with a compact non-interactive fallback.
- Keeps Tor as the trusted gateway route and leaves bulk media direct. Explicit/unattended Tor never falls through to the public proxy pool.
- Replaces the obsolete Tor Browser 13.5 / Tor 0.4.8 Expert Bundle with Tor Browser 15.0.21 / Tor 0.4.9.11. Tor Project intentionally ended 0.4.8 network compatibility on 2026-09-01.
- Pins the official Expert Bundle SHA-256, migrates old managed Tor binaries through a version marker, verifies the extracted `tor.exe` generation and `torrc`, and requires a real SOCKS5 + TLS path to `gateway.discord.gg` before installation succeeds.
- Fixes Windows Tor startup where file logging itself could abort Tor 0.4.9; managed startup uses stdout/stderr capture for diagnostics instead.

Todas as mudanças notáveis deste projeto são documentadas aqui. O formato segue
[Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e o versionamento
segue [Semantic Versioning](https://semver.org/lang/pt-BR/).

## [1.1.12] - Unreleased

### Adicionado
- **Recuperação nativa do vídeo de saída do Go Live** (próxima beta,
  [#164](https://github.com/bezumiya/GoLiveBypass/issues/164)): o teste ao vivo
  no Linux mostrou por que o gatilho RTC da beta 10 era cego: o Discord desktop
  não cria a Live em `window.RTCPeerConnection`; ela vive no addon
  `discord_voice`. No travamento reproduzido, a demanda do espectador continuou
  positiva e a captura avançou de 2.760 para 3.667 quadros em 15s (~60 fps), mas
  `framesEncoded`, bitrate e resolução ficaram exatamente em zero. O novo preload:
  - envolve de forma transparente e idempotente
    `createVoiceConnectionWithOptions`/`createOwnStreamConnectionWithOptions`,
    classifica `voice` vs `stream` pelo factory exato e nunca age sobre
    `unknown`;
  - usa a API realmente implementada nesta versão do addon,
    `getFilteredStats(2, callback)` (o `getStats` do wrapper JS está stale), e
    reduz o JSON a captura, FPS, quadros codificados, bitrate, resolução e idades
    de progressão — sem IDs, endpoints, tokens ou stats brutos no log;
  - combina as conexões do mundo isolado do preload (world 999) com
    `Remote media sink wants` e os ws `discord.media` do mundo principal;
  - só confirma o zumbi com stream aquecida + mídia aberta + demanda positiva +
    captura viva há <15s + saída congelada por ≥20s. A renegociação normal de
    ~3s observada ao vivo não chega ao limiar, e dado incompleto falha fechado.
  - nível 1 chama `destroy()` **somente na stream nativa**. No ensaio, isso
    iniciou uma reconstrução tardia do próprio Discord: voice e mídia fecharam
    depois, um documento/preload novo nasceu, a call e a Live foram refeitas e a
    geração nova estabilizou em ~60 fps, 1920×1088, com dois receptores — sem
    Ctrl+R manual e sem o nível 2 conseguir/precisar agir. A escada agora espera
    60s pelo teardown, mais 45s quando ele já começou, e dá 30s de aquecimento a
    uma geração nova; sucesso exige 10s de progressão contínua, nunca um pulso.
    Só se voice/mídia continuarem presas após o prazo o nível 2 destrói voice +
    stream e fecha `discord.media`; não existe reload automático nosso.
  - telemetria nova: `voice.hook`, `voice.conn`, `voice.probe` e
    `gw.revive | video nativo ...`. O standalone é a fonte e a GUI recebe o
    mesmo código via `sync-bypass`; testes novos cobrem transparência, privacidade,
    filtro nativo, mundo isolado, detector, níveis e colisão de geração após o
    reload interno.
- **Injeção à prova de corrida: o shim vira preload de sessão** (beta 10,
  [#163](https://github.com/bezumiya/GoLiveBypass/issues/163)): a #163 pegou uma
  sessão inteira **cega** — o CDP não anexou, o fallback do `did-finish-load`
  reinjetou DEPOIS do gateway já ter conectado, e o gateway não reconectou mais
  (25+ min de túnel saudável): 17 minutos de probes `estado=nenhum`. Como nós
  controlamos o app.asar injetado, o shim agora é gravado em
  `golive-shim.js` e registrado como **preload de sessão**
  (`registerPreloadScript`, com fallback para `setPreloads`) — preload roda
  antes de qualquer script da página, em toda janela/frame, sem CDP e sem
  corrida. CDP e fallback ficam como reforço (tudo self-guardado: injeção dupla
  é inofensiva).
- **Instrumentação RTC + gatilho "áudio vivo, vídeo parado" + cura de voz**
  (beta 10): o nyxxy revelou o sintoma decisivo — **o áudio da transmissão
  toca, mas o vídeo nunca sai**. Áudio de Go Live vai por RTC/UDP (não pelo
  gateway): a conexão de voz ESTÁ de pé — o que trava é a ativação do vídeo.
  - O shim agora envolve o `RTCPeerConnection`: `__goliveRtcResumo()` agrega
    `getStats()` por PC — bytes inbound de **áudio vs vídeo**, se existe track
    de vídeo esperada e se o usuário é quem transmite.
  - Linha nova no vigia: `rtc.probe | pcs=.. audio_ha=.. video_ha=.. track=..
    enviando=..` — junto do `gw.probe`, o log conta sinalização + mídia.
  - **Gatilho** (`avaliarRtcVideo`, função pura): mídia aberta há ≥ 20s +
    **áudio vivo** (< 60s) + **track de vídeo esperada** (call só de voz nunca
    dispara) + **vídeo parado** (nunca chegou byte ou ≥ 120s) + **não é quem
    transmite** = video-travado.
  - **Cura**: reconstruir a VOZ, não a janela — `__goliveMidiaFechar()` fecha o
    ws `*.discord.media` com close(4000); o cliente reconecta/resume a voz e
    re-negocia o vídeo, **sem derrubar a sessão do Discord** (a regra §6 segue
    intacta — sem reload com mídia aberta). Escada própria: 2 tentativas/30min
    com cooldown de 3min; exauriu → banner dedicado (`golivebypass-video`) que
    explica o que aconteceu. Recuperação: vídeo voltou a crescer → sucesso.
- **Gatilho de stream travada: sniff do op 4 + fluxo de mídia** (beta 9,
  retorno da beta 8 nas issues [#159](https://github.com/bezumiya/GoLiveBypass/issues/159),
  [#160](https://github.com/bezumiya/GoLiveBypass/issues/160) e
  [#161](https://github.com/bezumiya/GoLiveBypass/issues/161)): a beta 8
  instrumentou o caso real e os logs contaram a história inteira — o shim
  anexou (o fallback da #154 disparou), o burst de atividade funcionou, e o
  `resp_bytes` revelou que **o gateway segue entregando MUITOS dados** (2,6 mil
  a 77 mil bytes por janela) mesmo com a stream travada no carregamento. O
  zumbi da nova geração não é o servidor calado: é o servidor que **empurra
  dados ambiente mas não PROCESSA pedidos novos** — o op 4 (VOICE_STATE_UPDATE,
  o "quero assistir") sai e o dispatch que abriria a conexão de voz
  (`*.discord.media`) nunca vem; a view gira eternamente e só o Ctrl+R cura.
  O gatilho novo é de precisão cirúrgica e independe de decodificar o payload:
  - **Sniff do op no frame binário (etf)**: `131` + tupla + inteiro na cabeça do
    termo — o op 4 é extraído em ~10 linhas defensivas (formato estranho devolve
    -1 e nunca vira falso op 4). No mundo JSON o op 4 já era lido.
  - **Assinatura**: op 4 enviado há 20-90s + **nenhum ws de mídia abriu desde o
    pedido** + sem mídia aberta agora = o fluxo de voz nunca começou → a escada
    dispara (close 4000 → o cliente renasce com RESUME e a stream abre sem
    Ctrl+R; persistindo, reload).
  - **Guarda de SAÍDA**: ws de mídia fechado há menos de 15s + op 4 = usuário
    SAINDO de voz/stream — nesses casos nenhuma mídia nova abre, então não
    dispara. E com mídia aberta (em call), a regra §6 segue bloqueando tudo.
  - `gw.probe` novo: `op4_ha`, `midia_open_ha`, `midia_close_ha` — o próximo
    relato prova sozinho se o sniff pegou o op no binário.
- **Shim v3: reviver do zumbi que funciona de verdade no Discord atual** (beta 8,
  retorno da beta 6 nas issues [#154](https://github.com/bezumiya/GoLiveBypass/issues/154),
  [#156](https://github.com/bezumiya/GoLiveBypass/issues/156) e
  [#158](https://github.com/bezumiya/GoLiveBypass/issues/158)): a beta 6 provou
  com logs que a cura automática do carregamento infinito era **no-op na
  produção** — `revives=0` para sempre. O cliente atual do Discord manda frames
  **binários** (etf): `JSON.parse` falhava em todo send (histograma vazio,
  `ops={}` com `cli_ha=1s`), o intent nunca era registrado, e o inflador zlib
  morria na primeira adversidade (`"sem decompress"` em toda a sessão da #156) —
  sem decode de cliente E de servidor, nenhuma assinatura de zumbi disparava. O
  shim v3 não depende mais de decodificar o payload:
  - **Atividade por burst** (agnóstico de encoding): 3+ envios em 30s = usuário
    pedindo algo — heartbeat vem a cada ~41s, então 2 heartbeats + presença solta
    nunca fecham o burst; funciona com JSON ou binário.
  - **Inflador que resincroniza** em vez de morrer: até 3 resyncs por geração
    (cobre dessincronia de fluxo contínuo E payload por stream), texto direto
    (`encoding=json`) é processado sem inflate, e lixo não acumula eterno.
  - **Detecção por volume**: servidor saudável responde ao pedido com centenas de
    bytes; o zumbi devolve só o baseline de heartbeat — sinal que independe de
    saber o encoding (`dispatch starve` continua valendo no mundo JSON).
- **Probe que nunca mais silencia** (beta 8, [#154](https://github.com/bezumiya/GoLiveBypass/issues/154)):
  a sessão inteira da #154 passou sem NENHUMA linha de probe — o shim do CDP não
  anexou numa das janelas e o resumo ausente era engolido. Agora: o vigia polla
  TODAS as janelas do cliente (escolhe a que tem gateway), loga
  `estado=sem-shim` quando ninguém responde, e o `did-finish-load` reinjeta o
  shim (self-guardado) quando o CDP não anexou.
- **Instalador standalone sobrevive a caminhos 8.3** (beta 8,
  [#155](https://github.com/bezumiya/GoLiveBypass/issues/155)):
  `Remove-Item -LiteralPath` explode com `PSArgumentException` ("Não existe um
  objeto no caminho especificado C:\Users\JOO~1...") em usuário com nome curto
  8.3 no perfil — o provider normaliza o caminho mesmo com `-LiteralPath`, e
  `-ErrorAction SilentlyContinue` não segura essa. As limpezas de arquivo/temp
  (download do Tor, zips de update) agora vão por `Remove-CaminhoSilencioso`
  (.NET direto, sem provider).
- **Canal beta: opt-in de testes na GUI + auto-update que distingue stable/beta**
  (beta 7): betas agora podem ser publicadas no GitHub como **prerelease** — e a
  garantia da regra §9 fica **estrutural**: `/releases/latest` nunca devolve
  prerelease, então o usuário do canal estável nem fica sabendo que a beta existe
  (o acidente da beta.3, que virou "latest" e disparou update em massa, ficou
  impossível de repetir). Quem quiser testar liga **"Participar dos testes (canal
  beta)"** nas configurações (settings `updateChannel`, default `stable`):
  - **Windows** (updater próprio): a checagem de 4h passa a varrer
    `/releases?per_page=20` e escolher a candidata de **maior versão** com exe
    anexado (estáveis + prereleases) via `updater-channel.ts` — semver de verdade
    com regra de prerelease, leitura VIVA do canal a cada checagem (toggle vale
    sem reiniciar), e o diálogo marca "(beta)". A comparação antiga por string
    (`latest !== current`) morreu junto: ela ofereceria **downgrade** de
    `1.1.12-beta.7` para `1.1.12` a quem ficasse no canal estável.
  - **Linux** (AppImage/electron-updater): canal beta nativo —
    `autoUpdater.allowPrerelease` lê o `beta.yml` que o electron-builder publica
    sozinho para versão com prerelease. Lido no boot (o electron-updater checa
    uma vez por sessão; o toggle vale no próximo reinício).
  - **macOS**: fora (updater desabilitado por falta de assinatura; o toggle nem
    aparece lá).
  - **Publicação:** tag (ex.: `v1.1.12-beta.7`) + `workflow_dispatch` do
    `build-gui.yml` com `canal=beta` — jobs de windows/linux publicam com
    `-c.publish.releaseType=prerelease` (linux gera o `beta.yml` sozinho), mac e
    assets do plugin/CLI pulam (um `goLiveBypass-vencord.zip` beta numa
    prerelease poderia ser pego pelo updater do plugin), e o job `beta-marcar`
    reforça `gh release edit --prerelease` e escreve a linha "**Canal: beta**" na
    nota. Desligar o toggle devolve ao estável na próxima release, sem downgrade
    (`1.1.12` stable > `1.1.12-beta.7` pelo semver). Testes:
    `tests/updater-channel.test.ts` (semver, escolha por canal, sem downgrade e
    wiring do updater/workflow).
- **Revive automático do gateway zumbi: detecção de dispatch starve + close 4000**
  ([#153](https://github.com/bezumiya/GoLiveBypass/issues/153), beta 6): o log da
  #153 trouxe o ground truth que faltava — durante o loading infinito o probe da
  beta 4 mostrou `estado=aberta srv_ha=1s cli_ha=0s subs=0`: ws aberta,
  heartbeats respondendo DOS DOIS lados e o usuário travado. O zumbi não é o
  servidor calado (isso o alarme "silente" já pega): é o servidor que **aceita
  heartbeat mas não entrega dispatch** — protocolo vivo, dados mortos. Com o shim
  descomprimindo o fluxo zlib do servidor no renderer (`DecompressionStream`, um
  stream contínuo por geração de ws), dispatch deixou de ser indistinguível de
  heartbeat e o caso virou detectável: **zumbi = o usuário pediu algo (qualquer op
  ≠ 1) e NÃO chegou dispatch nenhum desde o pedido**, com conexão quente dos dois
  lados e aquecimento de 2min para o READY assentar. O histograma de TODAS as ops
  do cliente vai no `gw.probe` (o `subs=0` eterno da #153 sugere que o cliente
  migrou do op 14 — contar tudo decide isso sem chute). A cura sem Ctrl+R existe:
  **fechar o ws com close(4000)** — o mesmo código que o próprio cliente usa ao
  receber op 7 (RECONNECT) — faz ele renascer sozinho com RESUME. A escada é
  automática e conservadora: nível 1 = close 4000; não curou, nível 2 = reload (a
  cura que sempre funciona); o ws não renasceu em 15s = reload direto (auto-cura);
  **nunca com mídia aberta ou recente <3min** (§6: reconexão mata o vídeo da live —
  nesse caso só banner + pill, decisão do usuário); teto de 2 tentativas por 30min
  com cooldown de 3min; estourou, volta a ser ambiental. A reconexão que o PRÓPRIO
  revive provoca é reconhecida (TTL de 60s): não vira "recorrência no meio da
  sessão", não alimenta a rajada e não quarentena a saída sadia. Sucesso só é
  creditado com a conexão sobrevivendo ao aquecimento com dispatch fluindo (o
  READY da conexão nova, que sempre chega, não engana o creditar). Toggle "Reviver
  gateway travado automaticamente" na GUI (settings `autoRevive`, default ligado;
  desligado = detecção e log continuam, a ação fica sendo do usuário). O `gw.probe`
  novo (`dispatch_ha`/`intent_ha`/`aberto_ha`/`geracao`/ops) entrega o veredito
  H1 (servidor envelhecido — close+RESUME cura) vs H2 (store engasgada — só o
  reload cura) no próximo relato. O **report de bug** acompanha: a tabela
  Sistema passou a dizer `autoRevive` na leitura do RUNTIME (mesma lógica do
  `routeModeDisco` — report sem nenhum `gw.revive` com a flag desligada é
  comportamento esperado, não bug) e o `estat.sessao` ganhou `revives=` com a
  contagem de ações da escada na sessão. Testes: `tests/gateway-probe.test.ts` (25
  cenários — shim com zlib REAL comprimido no teste, fechar, gerações, alarme em
  idades, escada) e `tests/test-gateway-zumbi-revive.cjs` (sandbox vm com o script
  real: escada completa, guardas de recorrência, auto-cura, mídia, flag).
- **Pill de recuperação permanente + probe do gateway no renderer** (beta 4,
  [#149](https://github.com/bezumiya/GoLiveBypass/issues/149)): o teste real do
  William na beta 3 provou que o **zumbi de aplicação é indistinguível na rede** —
  durante os vãos (416s e 713s) o túnel seguiu carregando heartbeats (o alarme da
  beta 3 não disparou) — e como a conexão é TLS ponta a ponta com payload
  comprimido, nenhum detector do lado da rede separa heartbeat de dado. Três
  mudanças: (1) um **pill "↻" permanente** dentro do Discord — discreto
  (opacidade 35%, hover 100%) — que recarrega a janela num clique:
  o usuário resolve no primeiro segundo de loading em vez de esperar os 7-25 min
  do reconnect; some sozinho em fullscreen e com websocket de mídia aberto (call/
  transmissão), e o atalho **Ctrl+Alt+R** fica de pé mesmo assim (intenções
  explícitas do usuário executam mesmo em chamada — a decisão é dele, nunca
  nossa). (2) Um **shim no renderer** injetado via CDP
  (`addScriptToEvaluateOnNewDocument`, antes do bundle — única forma sem corrida)
  que envolve o `WebSocket` do gateway e conta frames: cliente em JSON texto (o
  zlib do Discord é só servidor→cliente; op 1 heartbeat, op 14 subscribe =
  intenção de navegar), servidor comprimido em contagem/cadência — o vigia polla
  a cada 60s e loga `gw.probe`, então o próximo relato chega com ground truth em
  vez de dedução. (3) O alarme de rede foi **re-escopado** pelo probe: dispara só
  com o servidor inteiro calado (>3min sem NENHUM frame, nem ACK) — morte de
  rede real; o detector de bytes da beta 3 foi removido (mascarado pelos
  heartbeats, provou inútil para a variante real). Testes:
  `tests/gateway-probe.test.ts` executa o shim e o alarme REAIS extraídos do
  script (8 cenários, incluindo wire-up e remoção do antigo).
- **Alarme de "gateway zumbi"** ([#145](https://github.com/bezumiya/GoLiveBypass/issues/145),
  beta 3): a sessão de gateway pode ficar muda sem morrer de forma visível — o TCP não
  gera `tunel.caiu`, o Discord não reconecta (nada de `gw.visto`), e as telas ficam
  carregando para sempre enquanto isso (o relato: ~14,5 minutos sem nenhum connect novo,
  com o bypass achando que tudo estava bem, porque o batimento só prova o túnel do Tor,
  não a sessão do Discord). O sinal de vida de um gateway saudável são os heartbeats
  (bytes nos dois sentidos a cada ~40s): 5 minutos de silêncio total — nenhum byte no
  túnel e nenhum connect novo — agora dispara um banner manual dentro do Discord
  ("sessão sem resposta — Reiniciar agora"), que some sozinho se o sinal voltar.
  Manual de propósito: reload automático aqui seria o "esperto demais" que encerra
  chamada (mesma regra da janela de mídia recente). Testes: `tests/gateway-zumbi.test.ts`
  executa o bloco real do detector extraído do script (tempo falso, 7 cenários).
- **Guarda contra ativação duplicada** ([#145](https://github.com/bezumiya/GoLiveBypass/issues/145),
  beta 3): duas ativações em segundos (reativação de boot + clique com o status ainda
  velho) injetavam duas vezes — cada injeção fecha as conexões antigas e faz o gateway
  renascer; no relato da #145 a segunda derrubou a sessão recém-nascida da primeira,
  7 segundos depois. Agora a segunda chamada aguarda a primeira terminar, e
  re-ativação idêntica (mesma proxy, mesmo modo) sobre um bypass já injetado é
  ignorada. Mudou proxy ou modo? Re-injeta de verdade. Testes:
  `tests/ativacao-guard.test.ts`.
- **Aviso visível + recarga automática no arranque frio em modo Tor** (beta 2,
  [#116](https://github.com/bezumiya/GoLiveBypass/issues/116)): a GUI é um
  processo Electron à parte do Discord e, no boot do Windows, precisa
  terminar o próprio arranque antes de sequer chamar o Tor — o Discord
  (nativo, mais rápido, e também com "Iniciar com Windows" ligado) costuma
  vencer essa corrida. O bypass já fazia a coisa seguramente (segura o
  gateway, nunca vaza direto pelo IP brasileiro), mas sem aviso a pessoa só
  via "carregando" parado, sem saber se travou. Agora: (1) um banner
  informativo aparece na janela do Discord avisando que o Tor está subindo
  (com retentativa até a janela do cliente existir — o Discord mostra uma
  splash sem URL antes do app de verdade); (2) assim que o Tor responde, a
  janela recarrega sozinha na hora (se o gateway ainda não tiver roteado por
  conta própria), em vez de esperar o backoff do próprio Discord tentar de
  novo. Testado ao vivo (Discord + Tor reais numa VM Windows): o arranque
  frio, a detecção do Tor pelo batimento e a recarga (ou o cancelamento dela
  quando o gateway já roteou sozinho) se comportaram como esperado.
- **Orçamento de espera do Tor no arranque frio aumentado de 45s para 90s**
  (`TOR_HOLD_BUDGET_MS`): com o aviso visível acima, esperar mais não
  confunde mais ninguém, e reduz quantos ciclos de recusa+retentativa o
  Discord precisa até o Tor (que pode legitimamente levar mais de 45s numa
  máquina fria) responder.
- **Botão "Reiniciar agora" no banner de reconexão durante uma
  chamada/transmissão**: o aviso amarelo que já existia (issue #129/#131)
  pedia Ctrl+R por texto; agora tem um botão que faz o mesmo
  (`location.reload()` na própria janela do Discord) com um clique.
- **Janela de "chamada recente" alargada de 5 para 20 minutos**
  (`MIDIA_RECENTE_MS`): essa marca só é atualizada quando um websocket de
  mídia NOVO abre (entrar numa call, ligar a câmera) — uma call já em
  andamento, sem reconectar por dentro, não a renova. Em calls/streams
  longas (comuns, de dezenas de minutos) o valor antigo de 5 min podia
  classificar uma chamada ainda ativa como "sem mídia" e a recarga
  automática (abaixo) reiniciaria a janela **no meio da chamada** — o oposto
  do que a guarda existe para evitar. Vinte minutos reduz bastante essa
  janela de risco (não elimina para calls mais longas: o projeto não
  inspeciona o payload do gateway para saber se a call segue de pé, só os
  hosts do handshake, por design).
- **Mitigação do "RTC connecting" eterno após instabilidade do Tor** (beta:
  [#129](https://github.com/bezumiya/GoLiveBypass/issues/129),
  [#131](https://github.com/bezumiya/GoLiveBypass/issues/131)): quando o
  gateway reconecta **sem chamada/transmissão recente** (ver janela acima),
  a janela do Discord é recarregada proativamente (após provar que a saída
  está entregando) — o motor de vídeo renasce limpo em vez de travar na
  próxima tentativa de Go Live. Com chamada em andamento continua só o
  banner manual (reload encerraria a call). Máximo de 1 reload a cada 3 min.
- **Singleton do `garantirTor`**: chamadas concorrentes (boot + janela)
  spawnavam dois `tor.exe` — um perdia a porta e morria com "Reading config
  failed".

### Corrigido
- **Instalador Linux morria em silêncio antes do menu** (sem issue): com o último
  install varrido sendo um Discord puro (o caso mais comum), o filtro
  `is_parallel_install "$r" && printf` de `parallel_installs()` fazia o `while`
  sair com status 1, o assignment `parallels="$(parallel_installs)"` falhava e o
  `set -e` encerrava o script inteiro sem mensagem nenhuma — o usuário via
  "Detectado: ... Fonte nao encontrado" e nada mais acontecia. O filtro agora é
  um `if`, que termina em status 0 quando a condição é falsa, e a detecção de
  clientes paralelos (Vesktop/Equibop/Legcord) continua idêntica. Regressão no
  `tests/test-posix.sh` (seção 9), rodando em sh/ash/bash/dash.
- **Banner de zumbi da beta 4 disparava em falso — e ficava preso** (achado no
  ciclo da #153): `avaliarSinalGw()` comparava a IDADE do último frame (`srvHa`,
  em ms desde o evento) como se fosse timestamp (`agora - srvHa`); o gate de
  3min nunca filtrava e qualquer ws aberta devolvia "silente" — o banner de
  sessão muda subia ~60s depois de abrir o Discord e o latch só saía se o ws
  fechasse. O teste antigo passava porque alimentava o resumo com TIMESTAMP —
  codificava o contrato errado. O contrato agora é de IDADES dos dois lados
  (shim e teste codificam o real).
- **Botão ficava em "Ativar" com o bypass já de pé após a reativação de boot**
  ([#149](https://github.com/bezumiya/GoLiveBypass/issues/149), beta 5 —
  confirmado pelo testador na beta 4): a janela costuma carregar NO MEIO da
  reativação automática do boot (o Tor demora segundos para subir) e nada a
  avisava quando ela terminava — o botão ficava em "Ativar", e o clique nesse
  estado era o gatilho exato da duplicação que a guarda da beta 4 neutralizou.
  A reativação de boot agora atualiza a janela e a bandeja ao terminar, no
  sucesso e na falha.
- **Instalador crashava com "Invalid handle. Parameter name: handle" ao perguntar no
  console** ([#146](https://github.com/bezumiya/GoLiveBypass/issues/146)): quando o
  instalador é lançado por um caminho que não abre console de verdade (atalho,
  automação, wrapper), o `Read-Host` do menu explode dentro do `FileStream` com um
  handle de stdin morto — crash cru, sem dizer nada. Todos os prompts (menus de
  escolha, proxy, persistência, update) agora passam por um `Read-Escolha` que
  converte o crash em uma mensagem com o que fazer ("rode de novo com duplo clique
  no .bat ou de uma janela normal do PowerShell"). É ambiente de uso, não bug — o
  aviso não abre issue automática (`Test-ShouldReport`).
- **Instalador: alvo de injeção sem caminho virava `DriveNotFoundException`
  críptico** ([#136](https://github.com/bezumiya/GoLiveBypass/issues/136), "Cannot
  find drive. A drive with the name '@{Flavour=Discord; Resources=C' does not
  exist"): um alvo cujo `Resources` não é string, usado como path, faz o PowerShell
  entender o trecho antes do `:` como nome de drive. Não reproduziu no código atual
  (verificado na VM Windows com pipeline completo e dois alvos falsos), então é
  ciclo velho ou estado de máquina — mas a classe morreu: `Get-PatchTargets` agora
  coerciona para string, descarta caminho vazio e valida todos os alvos antes de
  devolver (parando na causa, longe do sintoma). E o relato automático ganhou
  `ScriptStackTrace` quando o `InvocationInfo` não traz linha — a próxima ocorrência
  chega com a pilha exata em vez de vir sem localização nenhuma.
- **Auto-update do Windows portable não funcionava — nunca** ([#135](https://github.com/bezumiya/GoLiveBypass/issues/135),
  "Auto-update não funciona"): o popup aparecia, o download e a conferência de
  digest passavam, e a instalação morria sempre em "não consegui substituir o
  exe em uso" — dez retentativas de 1s e silêncio. A causa: a troca tentava
  **apagar** o executável em execução (`rmSync`), e o Windows nega delete de
  imagem mapeada em memória com EPERM para sempre, não é questão de esperar.
  A troca agora acontece em dois tempos. Primeiro, ainda dentro do processo e
  com rollback: o exe em uso sai do caminho com um **rename** (o Windows
  permite) para `GoLiveBypass.exe.old` e o baixado entra no lugar — se o novo
  não entrar, o antigo volta, porque é melhor seguir na versão atual que ficar
  com atalho quebrado. Segundo, o relançamento: um helper externo (`.bat`
  disparado por `wscript`, sem janela) espera o processo velho morrer de
  verdade — a sonda é o próprio delete do `.old`, que o Windows recusa enquanto
  a imagem roda — antes de abrir o exe novo, sem corrida contra o lock de
  instância única ("fecha mas não abre"); ao fim limpa a sobra `.old` e a si
  mesmo. O conteúdo do `.bat` é 100% ASCII com os caminhos chegando como
  argumento e o `.vbs` vai em UTF-16 com BOM: o cmd lê `.bat` no codepage OEM e
  o wscript lê `.vbs` como ANSI, então caminho embutido no conteúdo embaralharia
  para qualquer usuário com acento no nome (João, Conceição — público majoritário
  do projeto). Esgotadas as esperas, o helper lança mesmo assim, e a falha de
  instalação passou a mostrar um diálogo dizendo que a versão atual segue
  funcionando e onde baixar manualmente — em vez do silêncio do relato ("clico
  para atualizar, e nada acontece"). No caminho do AppImage, o `close` da janela
  agora respeita a marca de quit-por-update (era a causa latente do mesmo
  "fecha mas não abre" lá), e o Tor embutido fica de propósito rodando durante a
  troca: o processo novo o adota pela porta 9060 e o gateway nunca cai. Testes:
  `tests/updater-replace.test.ts` (troca, sobra de update anterior, rollback,
  limpeza no boot, conteúdo dos helpers sem disparar nada de verdade).

- **"Falha ao injetar" em cliente paralelo (Vesktop/Equibop/Legcord) sem dizer o motivo real**
  ([#123](https://github.com/bezumiya/GoLiveBypass/issues/123),
  [#130](https://github.com/bezumiya/GoLiveBypass/issues/130),
  [#132](https://github.com/bezumiya/GoLiveBypass/issues/132),
  [#133](https://github.com/bezumiya/GoLiveBypass/issues/133)): quatro relatos do mesmo
  padrão — "patch direto falhou (motivo no aviso acima)" — mas o "aviso" só ia para o
  console, nunca para o relato automático de bug (`--- logs ---` sempre vazio), obrigando
  diagnóstico manual toda vez. Causa raiz encontrada: Equicord e Vencord são forks
  **diferentes** — o build do Equicord só empacota `dist/equibop.asar` (o cliente dele), o
  do Vencord só `dist/vesktop.asar` (o dele); nenhum dos dois gera o `.asar` do outro. Quem
  tem o Vesktop instalado (comum: gente que usa só o Vesktop, sem Discord oficial) mas está
  com um checkout Equicord (a escolha mais comum) sempre batia nessa parede — e a mensagem
  antiga ("rode `pnpm build` e tente de novo") era **enganosa**: nenhum `pnpm build` nesse
  checkout jamais geraria `vesktop.asar`. Legcord é um projeto à parte (não é fork de
  nenhum dos dois) e tinha o mesmo problema. Agora o instalador (`.ps1` e `.sh`) detecta o
  mod do checkout (`Get-CheckoutMod`/`checkout_mod`, já existente) e, se o par mod×cliente
  não bate, explica exatamente isso — com o texto chegando de verdade no relato automático
  de bug (o `.ps1` agora devolve o motivo real em vez de "no aviso acima"). Teste de
  regressão novo: `tests/test-parallel-client-mismatch.sh` (dash/debian, 10 asserções) e
  validação funcional ao vivo do `.ps1` numa VM Windows (5 cenários: mismatch detectado,
  sucesso normal, build realmente faltando, cliente desconhecido, e a checagem de mod).

- **Aviso quando a proxy manual configurada está permanentemente quebrada**
  ([#134](https://github.com/bezumiya/GoLiveBypass/issues/134), "loading infinito
  mesmo dando control r"): com uma saída manual (`settings.proxy`) configurada
  mas recusando a conexão em toda tentativa (visto no relato: SOCKS5 recusando
  a autenticação, `etapa=auth`), o app já caía para Tor/gratuitas
  automaticamente — mas sem avisar a pessoa, que ficava dando Ctrl+R e
  reabrindo o Discord tentando "consertar" algo que só uma troca da própria
  proxy resolveria. **Ctrl+R não ajuda nesse caso**: ele só recarrega a
  página (renderer), não o processo principal onde o roteador roda — a
  saída manual quebrada continua sendo a preferida a cada abertura nova.
  Agora, depois de 2 falhas seguidas do probe em segundo plano, um banner
  avisa que a proxy configurada não respondeu, que o app está usando uma
  saída automática por baixo, e que reiniciar não resolve — é preciso
  checar o endereço/usuário/senha em Configurações. Contador por processo
  (uma resposta boa zera), banner uma vez só por sessão.

### Plugin Vencord/Equicord (`goLiveBypass/native.ts`)
O plugin é uma implementação separada do bypass (não gerada a partir de
`standalone/golivebypass.js`, arquitetura própria: patches de webpack +
roteador local + IPC com o renderer). Repetia o padrão da
[#37](https://github.com/bezumiya/GoLiveBypass/issues/37) — nenhuma das
mitigações de estabilidade das versões recentes tinha chegado até ele. Esta
rodada portou as duas mais críticas, adaptadas à arquitetura do plugin (não
uma cópia mecânica do standalone):
- **Rotação de circuito do Tor não derruba mais o gateway** (porte do
  [#122](https://github.com/bezumiya/GoLiveBypass/issues/122)): `isTorProxy()`
  identifica quando a saída ativa é um Tor local (auto-detectado ou digitado
  à mão no campo Proxy) e dá a ela prazo bem mais largo no trafego vivo
  (`TOR_RELAY_TIMEOUT_MS`, 30s) e no batimento (`TOR_HEARTBEAT_TIMEOUT_MS`,
  informativo — nunca troca nem descarta a saída). Antes, qualquer saída
  (Tor incluído) usava os prazos curtos pensados para proxy gratuita, e uma
  falha de probe durante a construção de um circuito novo (a cada ~10min)
  trocava de saída ou reconectava o gateway à toa.
- **Reload de sessão bloqueada não derruba mais uma call/transmissão em
  andamento**: `retryWithProxy` recarregava a janela do Discord **sem
  nenhuma verificação** sempre que o servidor continuava bloqueando o vídeo
  — reconectar o gateway no meio de uma call trava o motor de vídeo até um
  Ctrl+R manual (confirmado ao vivo no standalone, issue #129/#131, mesmo
  motor de vídeo dos dois lados). Agora um hook em
  `session.defaultSession.webRequest` observa quando um websocket de mídia
  (`*.discord.media`) abre — se houver um recente (call/transmissão em
  andamento, janela de 20min), o reload não acontece e a pessoa recebe um
  toast explicando em vez de ter a call encerrada por baixo do pé.
- **Detecção do Tor (auto ou manual) até 10x mais rápida**: achada testando
  ao vivo numa VM — o Tor configurado à mão (ou auto-detectado) usava a
  mesma função de teste da saída gratuita (`measure`, duas requisições HTTP
  completas em série: trace da Cloudflare + checagem do gateway), com prazo
  curto pensado para vencer a corrida do gateway (2,5s). Contra um Tor são
  mas não instantâneo isso reprovava a saída — visto ao vivo: Tor
  respondendo fora do plugin, `measure()` ainda assim estourando o prazo
  dentro dele, e a sessão caindo para uma saída gratuita aleatória com o Tor
  perfeitamente saudável do lado. `torReachable()` novo faz só o handshake
  TLS até o gateway (o único host que decide o bloqueio) com prazo bem mais
  largo; `torCountry()` novo faz a checagem de país à parte, com prazo curto
  e best-effort (não filtra se não responder a tempo — melhor destravar
  agora que ficar preso num geo-check inconclusivo). Confirmado ao vivo: o
  proxy Tor manual, que antes falhava e caía para uma saída gratuita da
  Coreia do Sul, passou a responder em ~1,1s.

Fora do escopo desta rodada (documentado como trabalho futuro): o plugin não
tem um modo "só Tor, nunca vaza direto" equivalente ao `routeMode` do
standalone/GUI — ele sempre tenta manual → pote → Tor → gratuitas → direto,
nessa ordem, com um teto de 12s. Sem relato específico de "carregamento
infinito ao abrir" para o plugin (o padrão da issue #116 é sobre a corrida
GUI×Discord no boot do Windows, que não existe da mesma forma aqui), não
implementei um modo equivalente nesta rodada — adicionar um exigiria nova
opção de settings e mudança maior na cadeia `pickExit`/`autoExit`. Também
ficaram de fora o **alarme de "gateway zumbi"** do beta 3 (#145), o **pill de
recuperação + probe** do beta 4 (#149) e o **revive automático** do beta 6
(#153 — detecção de dispatch starve + close 4000 + escada até reload): no
plugin eles sairiam mais precisos (o renderer enxerga o socket do gateway, o
timestamp da última mensagem e o decompress sem CDP) — o pill e o close do ws
são quase diretos lá — mas o porte não entrou neste ciclo; o plugin segue sem
nenhum deles até o próximo. A recuperação nativa de vídeo da #164 também fica
fora do plugin nesta rodada: ela depende do preload de sessão no processo
principal, do world isolado 999 e do ciclo de vida de `discord_voice`; o plugin
tem IPC/patches próprios e precisa de um porte manual com as mesmas guardas,
nunca de uma cópia literal do standalone.

**Pendência da regra de sincronização (seção 4 do AGENTS.md):** o aviso de
proxy manual quebrada da issue #134 (ver acima, nesta mesma versão) só foi
implementado no standalone/GUI até agora — o plugin tem o mesmo padrão de
falha silenciosa em `pickExit()` (loga em `history`/arquivo, nunca mostra
`showToast`) e merece o mesmo aviso, adaptado ao mecanismo de toast dele.
Não portado nesta rodada por escopo/tempo; fica para a próxima.

## [1.1.11] - 2026-08-29

Hotfix de estabilidade do ciclo 1.1.10: o bypass agora **sobrevive ao reboot**
de verdade (sem botão verde de novo), o Tor não derruba mais o gateway nas
rotações de circuito, e os instaladores de linha de comando voltam a
funcionar de ponta a ponta.

### Adicionado
- **Re-injeção automática no boot (`autoInject`)**: uma flag gravada nas
  configurações lembra que o bypass estava ativo. No boot, se a injeção não
  estiver no disco (o quit limpo a restaura), a GUI reativa sozinha — sem
  esperar o clique no botão verde. Zerada apenas quando o usuário desativa
  explicitamente. No modo tor, espera o daemon subir antes de injetar.
- **`diagnostico.ps1`**: coletor de boot/autostart para o Windows (somente
  leitura, proxy nunca impressa): Run key com detecção de caminho morto,
  tarefas agendadas, processos/portas, tails de log, eventos de erro, AV de
  terceiros e estado de injeção. Salva um `.txt` no Desktop para o suporte.
- **`COMO-INSTALAR.md` dentro do zip do plugin**: o `goLiveBypass-vencord.zip`
  sai com as instruções junto dos 3 arquivos fonte, e o card de conflito da
  GUI + os avisos dos CLIs apontam para o tutorial completo do README.

### Corrigido
- **O bypass apagava a si mesmo a cada reboot**: o `revertOrphanedInjection`
  revertia a injeção NOSSA e INTACTA sempre que o PC desligava sem quit
  limpo — no Windows ela é autocontida (stub + patcher + settings dentro do
  asar) e funcionava sozinha. Agora só reverte quando os arquivos internos
  quebrarem de verdade; no Linux ela persiste enquanto o patcher existir no
  `INSTALL_DIR`.
- **Trocar de modo no seletor não chegava ao runtime no Windows**
  ([#121](https://github.com/bezumiya/GoLiveBypass/issues/121)): o
  settings.json dentro do asar só era reescrito na ATIVAÇÃO — o bypass
  rodava no modo velho atravessando reinícios do Discord, e com a lista
  gratuita morta o fallback varria só as portas clássicas do Tor e perdia o
  daemon da GUI na 9060 (gateway direto, IP BR). Agora a troca reescreve a
  injeção na hora (com aviso de que vale no próximo start) e o fallback
  começa pelo `torAddr` gravado.
- **Rotação de circuito do Tor derrubava o gateway no modo tor**
  ([#122](https://github.com/bezumiya/GoLiveBypass/issues/122)): o batimento
  de 4s marcava a saída única como morta durante a construção do circuito
  novo (5-30s) e o relay abortava em 2.5s — janelas de minutos (no log do
  relato, 30 e 57 min) sem gateway. Batimento agora é informativo no modo
  tor e o relay usa 30s, atravessando a construção do circuito.
- **EBUSY ao ativar com o Discord recém-fechado**: o retry do
  rename/remove era passivo — handle de processo vivo não some com espera.
  As primeiras tentativas re-executam o kill do Discord; as demais aguardam
  o SO liberar (antivírus/indexador).
- **Autostart do Windows quebrado para usuários do portable**: a Run key era
  gravada com o exe EXTRAÍDO do `%TEMP%` (o portable se auto-extrai a cada
  execução) — limpou o temp, o boot falhava em silêncio com o checkbox
  marcado. Agora grava o exe original (`PORTABLE_EXECUTABLE_FILE`) e se
  auto-cura a cada abertura. O Tor do logon também não abre mais janela de
  terminal (wrapper VBS via wscript).
- **Seletor de Discords com checkboxes vazios e injeção com `Path` nulo** no
  instalador: `Get-PatchTargets` tratava strings como objetos (`.Flavour`
  dava `$null`) — e uma regressão minha stringificou os objetos do
  standalone, que já estavam certos. Ambos restaurados com o formato certo
  de cada `Get-DiscordResources`.
- **Instalação nova pela linha de comando falhava no injector**: o
  `--location` mandava `...\Discord\app-1.0.x` ao instalador do
  Vencord/Equicord, que espera a raiz (`...\Discord`) — o `.sh` do Linux já
  mandava certo. Relato de usuário com o print do
  `EquilotlCli` rejeitando o caminho.
- **Falha de injeção sem detalhe** ([#120](https://github.com/bezumiya/GoLiveBypass/issues/120)):
  o "Falha ao injetar em algum dos Discords escolhidos" agora carrega o
  alvo e o código de saída no relato automático.
- **Bug report mentia o modo no Windows**: `routeModeDisco` lia a
  preferência da GUI, não o que o runtime vai ler (o settings dentro do
  asar injetado) — divergência GUI×runtime agora é visível no relato.

## [1.1.10] - 2026-08-29

### Adicionado
- **Versão visível na UI**: número da versão agora aparece no header
  (`Go Live · Brasil · v1.1.9`), no título da janela (`GoLiveBypass
  v1.1.9`) e no tooltip + label do menu da bandeja do sistema.
  ([#93](https://github.com/bezumiya/GoLiveBypass/pull/93))
- **Toggle "Avisar sobre atualizações"**: switch na UI (mesmo padrão do
  "Iniciar com Windows") + checkbox no menu da bandeja. Quando
  desativado, o app não chama `checkForUpdatesAndNotify` nem exibe o
  diálogo de update-downloaded. Persistido em `settings.json` como
  `autoUpdate: boolean` (default `true`; settings corrompido → `true`
  pelo fallback seguro).
  ([#93](https://github.com/bezumiya/GoLiveBypass/pull/93))
- **Fallback para Tor em modo `gratuitas`**: quando a lista de
  `proxyList.txt` morre toda (`pickFreeExit` retorna null), o bypass
  agora tenta o Tor local como fallback antes de cair para saída
  direta. Antes, lista morta em modo `free` significava "load infinito"
  no Discord (gateway conectava direto pelo IP BR). Fecha
  [#85](https://github.com/bezumiya/GoLiveBypass/issues/85).
  ([#86](https://github.com/bezumiya/GoLiveBypass/pull/86))
- **Startup do Windows portable funcional**: o "Iniciar com Windows"
  agora grava em `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`
  via `reg.exe`, com aspas para suportar caminhos com espaço (`C:\Program
  Files\`) e arg `--hidden` para subir só na bandeja. Antes o
  `app.setLoginItemSettings` do Electron retornava sucesso silencioso
  mas nada acontecia (delega ao instalador Squirrel/MSI, que não existe
  em portable). Linux `.desktop` e macOS `setLoginItemSettings`
  preservados. Fecha
  [#84](https://github.com/bezumiya/GoLiveBypass/issues/84).
  ([#86](https://github.com/bezumiya/GoLiveBypass/pull/86))
- **Escolha de qual Discord patchear na TUI e no CLI**: com mais de uma
  instalação (Discord oficial, PTB, Canary, Vesktop, Equibop, Legcord), os
  quatro instaladores agora perguntam quais recebem o patch — um, vários ou
  todos — em vez de patchear tudo sem avisar (standalone) ou delegar a
  escolha ao instalador do próprio mod, que só patcheia um e não conhece
  clientes paralelos (plugin). Multi-select estilo checkbox no menu (Espaço
  marca, `a` marca todos) e entrada textual (`1,3`, `2-4`, `t`) em terminal
  pequeno. Com uma instalação só, nada muda; `-Yes`/sem TTY continuam
  agindo em todos (a GUI não é afetada). A detecção de clientes paralelos
  agora existe também no Windows.

### Corrigido
- **Modo de roteamento da GUI era ignorado no Linux** (`routeMode` nunca
  chegava ao runtime): o `readNetMode()` da GUI tem default **virtual**
  `tor` — mostra Tor sem gravar nada — e o `linuxActivate` chamava o
  script standalone só com `--yes`/`--proxy`, nunca passando o modo. O
  `saveTorAddr()` criava o `settings.json` só com `torAddr` e o
  `install_patcher` regravava o arquivo preservando `routeMode` só se já
  existisse. Resultado: o runtime injetado nascia no default `auto` e, no
  `auto`, o probe do Tor contra `discord.com` é recusado pela Cloudflare
  (`tls alert handshake failure` com exit Tor), então `detectTor()`
  falhava com o Tor saudável na 9050 e o bypass caía no pool de
  **proxies gratuitas** — exatamente o log da
  [#108](https://github.com/bezumiya/GoLiveBypass/issues/108) ("22
  candidatas", saída `socks5://193.25.215.182`), com a GUI jurando que
  estava em Tor. Agora, com defesa em profundidade: a GUI materializa
  `routeMode`/`torAddr` no settings.json compartilhado **antes de toda
  ativação** (escrita atômica por merge, `updateSharedSettings`, que
  todas as preferências da GUI usam); o modo também viaja por argv
  (`--net-mode`/`--tor-addr`, novos, com `--tor` retrocompatível) e o
  script grava o que vier na flag por cima do arquivo — imune a escritor
  antigo/terceiro que regrave o settings.json sem a chave. A TUI do
  standalone também grava o modo explícito em toda escolha (a opção
  "gratuitas" não gravava `routeMode: free` e o CLI puro herdava
  `auto`). No runtime, o probe de um endereço Tor passou a provar o
  túnel com handshake TLS até o gateway (`gateway.discord.gg`) em
  qualquer modo — o que o `auto` prometia ("Tor local se houver") volta
  a valer mesmo com a Cloudflare na frente. Observabilidade pra drift
  futuro: a primeira linha do log do bypass agora diz o modo efetivo
  (`modo de roteamento: tor (settings.json)`), o `--status --json`
  reporta o `routeMode` do disco, e o bug report inclui
  `routeModeDisco` (o modo que o runtime vai ler, não só o do seletor).
  O fluxo Windows/macOS não muda (já materializava o modo dentro do
  app.asar injetado). Fecha
  [#108](https://github.com/bezumiya/GoLiveBypass/issues/108).
- **Preferência "Avisar sobre atualizações" zerava a cada ativação no
  Linux**: o `autoUpdate` da GUI vive no mesmo `settings.json`
  compartilhado, e o heredoc do `install_patcher` regravava o arquivo
  com um conjunto fixo de chaves, apagando a preferência. Agora a chave
  é preservada na regravação (e o merge da GUI nunca mais escreve
  subsets parciais).
- **`--uninstall`/`--restore` abortavam no meio com Tor do sistema**: o
  `remove_tor` rodava `systemctl --user disable --now
  golivebypass-tor.service` sem `|| true` — quando a unit não existe
  (o usuário usa o Tor da distro na 9050, não o embutido), o erro de
  "unit does not exist" tripava o `set -eu` e o script saía com código
  ≠ 0 antes do fim. A GUI recebia o erro e mostrava como mensagem as
  últimas linhas do stderr — que eram o ruído inofensivo de
  `LD_PRELOAD` (`ERROR: ld.so: ... cannot be preloaded`) típico de
  distros imutáveis (Bluefin/Bazzite), o famoso `Error occurred in
  handler for 'deactivate'`. Os `systemctl` agora toleram ausência da
  unit, e a GUI filtra o ruído `ld.so` do stderr antes de compor a
  mensagem de erro.
- **`Set-RunKey` apagava todas as entradas de inicialização do usuário**: no
  provider de registro do PowerShell (ao contrário do de arquivos),
  `New-Item -Path <chave> -Force` numa chave que **já existe** apaga a chave e
  recria vazia. Como o `Set-RunKey` do instalador e do standalone chamava isso
  em `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` antes de gravar o
  `GoLiveBypassTor`, toda execução limpava o startup da máquina (Spotify,
  Steam, Discord…) e deixava só a nossa entrada. Passava despercebido porque os
  poucos apps que reescrevem a própria entrada a cada abertura (como o Docker
  Desktop) reaparecem sozinhos, e porque a chave `StartupApproved` — que a tela
  "Inicializar" do Windows lê — não é tocada e continua listando tudo, então a
  lista da interface parece intacta. Agora a chave Run só é criada se realmente
  faltar.
- **Refresh do Tor em modo `tor` segurava o gateway por até 12s** quando o
  daemon oscilava: `refreshExit` chamava `detectTor()` com timeout de 6s
  para o probe + 6s para `exitCountryTorCached`. Em modo `tor` o bypass
  recusa saída direta (vazaria IP BR), então o Discord ficava preso em
  "load infinito" até o refresh terminar. Agora o refresh usa probe curto
  (3s) e o `currentExit` espera o refresh terminar em vez de recusar na
  hora. ([#87](https://github.com/bezumiya/GoLiveBypass/issues/87),
  [#89](https://github.com/bezumiya/GoLiveBypass/pull/89))
  - Nota: o fix já estava aplicado em `main` antes desta versão (cherry-pick
    manual, sem o commit formal do PR). Esta entrada apenas documenta a
    equivalência com o upstream.
- **Serviço do Tor embutido quebrava no boot do Linux** com `status=127`
  em distros com libevent recente (Arch, Fedora 40+): o bundle
  `tor-expert-bundle-13.5` foi compilado contra uma libevent 2.1 que ainda
  exporta `evutil_secure_rng_add_bytes` (removido em versões mais novas), e
  o `ld.so` resolvia para a libevent do sistema, fazendo o daemon abortar
  antes de subir. O `golivebypass-installer.sh` e o `golivebypass-standalone.sh`
  agora gravam `Environment=LD_LIBRARY_PATH=$TOR_LIBDIR` na unit do
  systemd (user e system) e exportam a variável nos fallbacks `nohup`, e a
  GUI Electron (que já fazia o mesmo em `main.ts`) continua o
  comportamento. O `tor` da porta 9060 agora sobe limpo no logon.
- **AppImage no Linux: `.desktop` de autostart apontava para o mountpoint
  temporário** (`/tmp/.mount_GoLiveXXX/golive-gui`) que some junto com o
  AppImage desmontado. O helper `realExecPath()` em `startup.ts` agora
  prioriza a env `APPIMAGE` (definida pelo runtime do AppImage) quando
  ela existe, garantindo que o `Exec=` do `.desktop` em
  `~/.config/autostart/golivebypass.desktop` aponte para o `.AppImage`
  real no disco.
- **Standalone Windows falhava ao substituir Vencord/Equicord** com
  `Cannot create a file when that file already exists`: nesses estados o
  `_app.asar` (backup do original feito pelo mod) já existe, e o fluxo só
  chamava `Remove-Injection` para o estado `OutroMod`. O `Rename-Item
  -Force` do `Install-Injection` não sobrescreve destino existente no
  Windows (`-Force` só afeta atributos escondidos). Agora o
  `Install-Injection` restaura o original antes de renomear, cobrindo
  também corrida com o updater entre a checagem de estado e a injeção.
  Fecha [#103](https://github.com/bezumiya/GoLiveBypass/issues/103).
- **Instalador/standalone quebravam com caminho nulo e viravam issue
  falsa no GitHub**: funções utilitárias (`Test-DiscordResourcesReady`,
  `Get-InjectedPath`, `Save-Text`, `Find-Checkout*`, `Install-Patcher`)
  passavam variáveis não inicializadas para `Join-Path`/`Split-Path`/
  `Test-Path`, estourando `Não é possível associar o argumento ao
  parâmetro 'Path' porque ele é nulo` — e o filtro de auto-report só
  reconhecia a mensagem sem acentos, então esse erro de ambiente abria
  issue como se fosse bug. Agora há checagens defensivas de `$null`/
  string vazia nas funções de resolução de caminho, fallback para
  `$USERPROFILE\AppData\Local` e `[IO.Path]::GetTempPath()`, o
  `Install-Patcher` do standalone baixa o `golivebypass.js` do GitHub
  quando rodado via `irm | iex` (sem `$PSScriptRoot`), e o
  `Test-ShouldReport` aceita as variantes acentuadas (PT-BR e EN).
  Fecha [#99](https://github.com/bezumiya/GoLiveBypass/issues/99).
  ([#107](https://github.com/bezumiya/GoLiveBypass/pull/107))
- **Cold start no modo `gratuitas` nascia direto (IP bloqueado)**: com listas
  públicas instáveis, as candidatas não ficavam prontas dentro do prazo de
  12s e a 1ª conexão do gateway saía direta — sessão bloqueada + 2 reloads
  (o "carregando infinitamente" da #98). Agora, estourado o prazo com o
  cache frio (sem saídas validadas em `state.json`), o bypass tenta o
  fallback do Tor local — o mesmo do #85 — antes do direct; sem Tor,
  comporta-se como antes. Cache quente, modo `tor` e saída manual
  inalterados. Mitiga
  [#98](https://github.com/bezumiya/GoLiveBypass/issues/98).
- **Relatórios de bug do instalador/standalone chegavam sem log nem
  metadata**: o payload usava `includeLogs`, campo que a API nem lê — issues
  como a #94 chegavam com log vazio e sem contexto. Agora o payload segue o
  formato da GUI (`log` + `meta`), com o tipo da exceção, o 1º frame do
  stack e a flag `caminho_8_3` (variáveis gravadas na forma 8.3 curta, tipo
  `C:\Users\CSAR~1`, que deixam de resolver quando a geração de nomes curtos
  está desligada no Windows — a causa provável da #94). O caminho base
  (`LOCALAPPDATA`/`TEMP`) agora é validado de verdade: se a variável existir
  mas não resolver, cai para o caminho canônico do Windows. Mitiga
  [#94](https://github.com/bezumiya/GoLiveBypass/issues/94).

## [1.1.9] - 2026-08-26

### Adicionado
- **TUI estilo OpenCode** nos 4 instaladores de terminal (PowerShell + bash):
  menus com caixas, setas, mouse SGR (Linux) e teclado (Windows). Sem
  dependência externa e sem binário extra. Cai automaticamente para os menus
  `[1]/[2]/[3]` quando o terminal não tem TTY ou `-Yes/--yes` foi passado.
  ([#50](https://github.com/bezumiya/GoLiveBypass/pull/50))
- **Auto-detecção de clientes paralelos** (Equibop, Vesktop, Legcord AUR) no
  instalador de plugin: agora varre `/usr/share`, `/usr/lib`, `/usr/lib64`,
  `/opt` e `~/.local/share`. Antes, só o Discord oficial era detectado.
  ([#50](https://github.com/bezumiya/GoLiveBypass/pull/50))
- **Instalação automática do Tor** nos 4 instaladores e no plugin: baixa o
  Expert Bundle 13.5, confere SHA-256, extrai e registra serviço persistente
  (systemd user/system no Linux, Run key no Windows) na porta 9060. Modo
  "Tor automático" nos menus. ([#48](https://github.com/bezumiya/GoLiveBypass/pull/48))
- **Auto-report de bugs** nos instaladores de terminal: ao falhar, monta
  diagnóstico sanitizado (versão, OS, cauda do log) e faz POST na API de
  bugs. Credenciais e tokens são redacted antes do envio. Erros de uso não
  reportam. ([#50](https://github.com/bezumiya/GoLiveBypass/pull/50))
- **Watchdog do Tor** na GUI: detecta quando o daemon da 9060 morre ou trava
  no meio da sessão e ressuscita o mesmo Tor (sem trocar de saída).
  Aciona após 2 falhas seguidas com heartbeat de 30s. ([#60](https://github.com/bezumiya/GoLiveBypass/pull/60))
- **Saída manual volta sozinha depois de cair**: o batimento tenta a saída
  manual a cada ~90s quando ela está fora (medido: até 48 min fora, voltou
  sozinha). Não tenta durante chamada ou Live em andamento. ([#64](https://github.com/bezumiya/GoLiveBypass/pull/64))
- **Botão "Testar" da GUI** aceita range `host:portaInicial-portaFinal` —
  testando uma porta sorteada do range, igual à ativação. ([#64](https://github.com/bezumiya/GoLiveBypass/pull/64))
- **Checagem de país do exit do Tor** no bypass: ~37 relays Tor são
  brasileiros (0.4% do total) e o servidor do Discord bloqueia Go Live com
  IP BR. Cache de país com TTL de 8 min (1 consulta por circuito, não por
  batimento). Recusa exits em BR e segura o gateway em vez de abrir direto
  pelo IP brasileiro. ([#76](https://github.com/bezumiya/GoLiveBypass/issues/76))
- **Job `release-assets` no CI** (Onda 2 do auto-update): publica 4 assets
  extras na release — `goLiveBypass-vencord.zip` (userplugin Vencord com
  `manifest.json` fixo para sempre baixar a versão mais recente),
  `goLiveBypass-vencord.zip.sha256`, `GoLiveBypass-<ver>-bypass.js` e o
  `.sha256` do bypass. Roda em paralelo com os builds da GUI.
  ([#77](https://github.com/bezumiya/GoLiveBypass/pull/77))

### Corrigido
- **TUI quebrava no cmd/conhost** clássico: a interface aparecia cheia de
  `[48;5;235m` com cursor pulando. Agora habilita VT no stdout via
  `SetConsoleMode(ENABLE_VIRTUAL_TERMINAL_PROCESSING)` ou cai para os menus
  textuais. ([#63](https://github.com/bezumiya/GoLiveBypass/pull/63))
- **3 bugs da TUI nos instaladores Windows** (caixa embaralhada, primeiro
  item pulado). 10/10 testes verdes no harness de `tests/tui-windows/`.
  ([#72](https://github.com/bezumiya/GoLiveBypass/pull/72))
- **`Invoke-CheckUpdate` quebrava** com erro `Write-Yellow`/`Write-Dim`/
  `Write-Green` (cmdlets inexistentes). Trocado por `Write-Host -ForegroundColor`.
  ([#75](https://github.com/bezumiya/GoLiveBypass/pull/75))
- **Serviço do Tor no Windows** rodava como `LocalService` e não conseguia
  escrever em `%LOCALAPPDATA%` — ficava parado. Trocado para Run key do
  usuário (mesmo contexto da GUI), com `Start-Process` para subir o daemon
  na hora. ([#48](https://github.com/bezumiya/GoLiveBypass/pull/48))
- **Banner "Ctrl+R" espúrio** após retorno silencioso para saída manual
  (`gatewayConnCount` ficava em 2+ e disparava o aviso sem motivo). Agora
  a troca zera o contador junto com `gatewayReconexoes`.
  ([#71](https://github.com/bezumiya/GoLiveBypass/pull/71))
- **`tryReturnToManual` violava o AGENTS.md** em modo Tor: trocava Tor →
  manual quando a manual voltava, mesmo o modo `tor` sendo exclusivo.
  Adicionada guarda `if (routeMode === "tor") return;` (mesma proteção de
  `trySwapByRtt` e `stockReserves`). ([#71](https://github.com/bezumiya/GoLiveBypass/pull/71))
- **`isManualAddress` inconsistente com `parseProxy`** para range inválido:
  aceitava `socks5://h:100-50` como porta única 100 mas rejeitava a ativa.
  `tryReturnToManual` ficava preso tentando trocar para uma porta que ele
  mesmo já tinha sorteado. Alinhada a convenção e rejeita `portEnd > 65535`.
  ([#71](https://github.com/bezumiya/GoLiveBypass/pull/71))
- **Auto-report abria issue para erros de uso** (5 issues #65-#69
  desnecessárias): "Cancelado.", "O Discord não fechou", "Ctrl+C cancelou",
  dependência faltando, CLI digitada errada, path errado e mensagens
  equivalentes. Adicionada deny-list em `Test-ShouldReport` (ps1) e
  `should_report` (sh) nos 4 scripts. Bugs reais (bypass, patcher,
  instalador) continuam reportando.
  ([#65](https://github.com/bezumiya/GoLiveBypass/issues/65),
  [#79](https://github.com/bezumiya/GoLiveBypass/pull/79))
- **TUI em `[ "$TUI_COLS" -le 20 ]` com `set -e`** abortava o shell: o
  teste falso retornava 1 e o `tui_menu` nunca era desenhado. Trocado por
  `if ...; then ...; fi; return 0`. ([#50](https://github.com/bezumiya/GoLiveBypass/pull/50))
- **Mouse SGR no `tui_is_interactive`** exigia `-t 1` (stdout) além de
  `-t 0` (stdin), quebrando em pty/emuladores onde o stdout não reporta
  tty. Reduzido para só `[ -t 0 ]`.

### Infraestrutura
- **CI**: novo job `release-assets` publica userplugin Vencord + bypass
  standalone + hashes SHA-256 (Onda 2 do auto-update).
  ([#77](https://github.com/bezumiya/GoLiveBypass/pull/77))
- **Testes**: +9 suites de teste novas
  (`tests/tui-windows/`, `tests/test-auto-update.{sh,ps1,edge.sh}`,
  `tests/test-ci-release.sh`, `tests/test-userplugin-e2e.sh`,
  `golive-gui/tests/torwatchdog.test.ts`,
  `golive-gui/tests/pr64-proxy-url.test.ts`,
  `standalone/tests-pr64/test-{is-manual-address,parse-proxy-range,try-return-to-manual}.js`).
  Harness automatizado para TUI Windows (10/10 verde).
- **Docs**: `docs/auto-update-plugin/00-sumario-executivo.md` e
  `02-plano-auto-update.md` documentam as duas ondas do auto-update.

### Estatísticas
- 15 commits, 5.926 inserções, 33 deleções em 28 arquivos.
- PRs: [#50](https://github.com/bezumiya/GoLiveBypass/pull/50),
  [#48](https://github.com/bezumiya/GoLiveBypass/pull/48),
  [#60](https://github.com/bezumiya/GoLiveBypass/pull/60),
  [#63](https://github.com/bezumiya/GoLiveBypass/pull/63),
  [#64](https://github.com/bezumiya/GoLiveBypass/pull/64),
  [#70](https://github.com/bezumiya/GoLiveBypass/pull/70),
  [#71](https://github.com/bezumiya/GoLiveBypass/pull/71),
  [#72](https://github.com/bezumiya/GoLiveBypass/pull/72),
  [#75](https://github.com/bezumiya/GoLiveBypass/pull/75),
  [#77](https://github.com/bezumiya/GoLiveBypass/pull/77),
  [#79](https://github.com/bezumiya/GoLiveBypass/pull/79),
  [#82](https://github.com/bezumiya/GoLiveBypass/pull/82).
- Issues: [#65](https://github.com/bezumiya/GoLiveBypass/issues/65),
  [#76](https://github.com/bezumiya/GoLiveBypass/issues/76).

## [1.1.8] - 2026-08-22

### Adicionado
- Reporte automático de bugs com logs detalhados e rate limit agressivo
  (PR [#42](https://github.com/bezumiya/GoLiveBypass/pull/42)).
- Modo dev com janela de logs, VPS testável e report de bug na GUI
  (PR [#42](https://github.com/bezumiya/GoLiveBypass/pull/42)).
- Sync-bypass: regenerar `bypass.ts` a partir do `golivebypass.js`
  (PR [#38](https://github.com/bezumiya/GoLiveBypass/pull/38)).

### Corrigido
- Proxy manual/privada não troca por RTT/reserva, só por morte real
  (PR [#38](https://github.com/bezumiya/GoLiveBypass/pull/38)).
- Detectar Discord mesmo com pasta `app-*` incompleta durante update.
- Elevação sem TTY, status honesto e modo dev só em `npm run dev`.
- API: fail-fast no boot — conferir labels do repo alvo antes de subir.

## [1.1.7] e anteriores

Veja o histórico de tags e commits para o que veio antes.
## Enhanced fork — native viewer demand and recovery ownership

- Diagnostic schema 2 includes existing recovery actions plus allowlisted native codec initialization and encryption counters, with fixed-format timestamps. This distinguishes an unexecuted recovery from recovery that ran without restoring video; it does not alter Discord settings or media behavior.
- Fixes broadcaster recovery remaining disarmed when Discord logs viewer demand in the renderer but the observer runs in an isolated preload. Demand now comes from the current stream's native `setTransportOptions.remoteSinkWantsPixelCount`, preserving the original call and its arguments.
- Prevents delayed recovery from restoring an old source after a source switch or re-enabling video after a user toggle. Ported to standalone and the generated GUI payload.
- Adds fixed numeric plugin stream counters and a read-only `installer/Get-StreamDiagnostics.ps1` collector. It emits no raw log lines, IDs, proxy credentials or addresses.
- Validation covers native observer behavior without console messages, zero demand, stream replacement, delayed user changes, and diagnostic filtering. Error 2012 remains a viewer timeout symptom; these checks do not establish successful streaming on the affected friend's computer.
- Still outside this fix: simultaneous-stream scheduling, capture/transport failures unrelated to frozen encoding, and live verification on the affected sender and viewer.
## Enhanced fork — inactive native encoder recovery

- Reproduced capture at 30 FPS with native simulcast inactive, zero encoded frames and growing encoder-queue drops on the local Windows sender. AV1, H.265, H.264 and VP8 all stalled. Setting a one-second keyframe interval together with `alwaysSendVideo` restored sustained AV1 encoding and encryption; restoring the prior setting reproduced the stall.
- Level-one broadcaster recovery now applies that transport repair when the prior values are known. It preserves codec selection and the gateway, holds the repair for the selected source, and restores the latest original settings on source change or stop. It may keep encoding while that share has no viewers; it does not start a share or select a source.
- Ported to standalone and regenerated GUI payload. Added executable restoration and caller-options preservation tests. Receiver-visible video/audio and a fresh installed-session check remain separate validation requirements.
- The installed Equicord StreamingCodecDisabler references removed `setAv1Enabled`/`setH265Enabled`/`setH264Enabled` methods. Its checkbox was not proof of a negotiated codec change. No codec-disabler dependency is introduced by this repair.
