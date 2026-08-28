# Design: seleção de alvo (qual Discord patchear) na TUI e no CLI

Data: 2026-08-28 · Status: aprovado (design A)
Issues relacionadas: relato de usuário com Discord oficial + cliente paralelo (conta secundária)

## Problema

Nenhum instalador deixa o usuário escolher **quais** instalações de Discord receber
o patch quando há mais de uma (ex.: Discord oficial + Vesktop com conta secundária):

| script | comportamento hoje |
|---|---|
| standalone .ps1 | patcheia TODOS os Discords achados, sem escolha |
| standalone .sh | idem (só pergunta em conflito: outro mod, flatpak zypak) |
| installer (plugin) .ps1 | roda `pnpm inject` pelado — **o instalador do próprio Vencord/Equicord pergunta** (lista deles, um alvo só) |
| installer (plugin) .sh | n=1 auto-seleciona; n>1 delega ao instalador do mod; n=0 oferece patch direto em paralelos |

## Decisões (aprovadas)

- Lista de opções inclui **oficiais + paralelos** (Discord, PTB, Canary, Vesktop,
  Equibop, Legcord — quando existirem).
- Seletor vale para **Instalar e Desinstalar** (modos que agem por Discord).
- Design A: multi-select próprio nos 4 scripts, com opção "Todos".
- Com 1 instalação só: **sem pergunta** (comportamento atual).
- Automação (`-Yes`/`--yes`/sem TTY): **todos**, preservando o comportamento atual
  (GUI e chamadas scriptadas não mudam).

## Abordagem escolhida

Multi-select próprio com a primitiva nova; no plugin installer, cada alvo marcado
recebe `pnpm inject -- --location <alvo>` (o flag é do Vencord/Equicord e o
`installer.sh` já o usa — mesmo código no Windows). Paralelos seguem o patch direto
(`inject_parallel`) que já existe, agora escolhível e multi-alvo.

Alternativas descartadas: pergunta sim/não por Discord (tedioso, não cobre o
installer) e escolha única (não atende "vários ou todos").

## Componentes

### 1. Primitiva de multi-seleção (4 scripts)

- `Tui-MenuMulti($title, $items)` (ps1) / `st_tui_multi(title, items...)` (sh):
  lista com `[x]/[ ]`, ↑↓ navega, **Espaço** marca/desmarca, **a** marca todos,
  **Enter** confirma (exige ≥1), **Esc** cancela. Reusa `Tui-GetKey`/`st_tui_getkey`,
  cores, caixa e mouse SGR existentes.
- Retorno: índices (1..N) dos marcados, em ordem; cancelamento = vazio/0 e o
  chamador aborta com `Cancelado.` (filtro de reporte já cobre).
- Fallback sem TTY: lista numerada + uma linha de entrada — `1,3`, `3-4`,
  `t`/`todos`, Enter = todos. Parser de ranges simples e testável.
- Item 1 da lista: `Todos os Discords (N)` — atalho que marca tudo.

### 2. Seleção de alvos (função por script)

Descobre instalações e pergunta **só quando >1**:

- **standalone .ps1**: usa `Get-DiscordResources` (oficiais) **+ detecção nova de
  paralelos no Windows**: `Vesktop`, `Equibop`, `Legcord` em
  `%LOCALAPPDATA%\<Nome>` e `%LOCALAPPDATA%\Programs\<Nome>` (padrões
  `resources\app.asar` e Squirrel `app-*`, validados com `Test-DiscordResourcesReady`).
  Nova função `Get-PatchTargets` que devolve `Flavour|Resources` unificado; o
  seletor roda antes do loop de Install **e** antes do loop de Uninstall (linhas
  ~779 e ~763); os loops passam a filtrar por alvos escolhidos. Aviso de
  OutroMod/confirm por alvo permanece dentro do loop.
- **standalone .sh**: mesma função (`list_patch_targets`) sobre `FOUND` — o .sh
  já detecta paralelos e flatpaks; o filtro seleciona linhas de `$FOUND`/`$lista`
  antes do `while` de Install (~1301) e de Uninstall (~1241). O Discord reaberto
  no fim vira o primeiro **selecionado**.
- **installer .ps1**: no fluxo Install, antes de `Invoke-Injection` (~843):
  alvos = oficiais (`Get-DiscordResources`) + paralelos (detecção nova, igual ao
  standalone). `Invoke-Injection($root, $targets)` vira loop: `Stop-Discord` uma
  vez, `pnpm inject -- --location <alvo>` por alvo oficial, patch direto por alvo
  paralelo; verificação `Test-InjectedFromCheckout` passa a validar os alvos
  escolhidos (todos com injecção apontando pro checkout). `n=1` e fluxo Update
  (re-injetar onde já foi injetado) mantêm o caminho de hoje.
- **installer .sh**: `inject_mod` (~1486) deixa de delegar ao instalador do mod
  quando `n>1`: nosso seletor (oficiais + `parallel_installs`), depois loop
  `run_inject`/`run_inject_root` com `--location` por oficial e `inject_parallel`
  por paralelo. `n=1` (auto) e `n=0` (fluxo paralelo atual, agora com seletor
  quando >1 paralelo) mantêm o comportamento.

### 3. Semântica preservada

- Avisos/confirms por alvo (OutroMod no standalone, zypak em flatpak, sudo
  fora do HOME) continuam rodando **dentro** da seleção, alvo a alvo.
- `Uninstall`/`Restore` do **plugin** ficam como estão (agem no checkout do mod,
  não por Discord).
- GUI: chama standalone com flags/sem TTY → continua "todos".
- Elevação/sudo no .sh decide por alvo escolhido (já é assim por instalação).

### 4. Rótulos

Item do seletor: `<Flavour> — <estado>` (ex.: `DiscordPTB — sem nada instalado`,
`Vesktop — cliente paralelo, sem mod`), reaproveitando
`Get-InjectionState`/`injection_state`; estado calculado só para exibição.

## Testes

- `tests/test-error-handling.ps1` / novos casos POSIX: parser do fallback textual
  (`1,3`, `3-4`, `t`, vazio → todos; lixo → re-ask).
- `tests/tui-windows` (harness python da TUI): caso do `Tui-MenuMulti` — marcar
  2 de 3, `a` marca todos, Esc cancela, Enter com 0 marcados não confirma.
- Smoke do fluxo: 2 Discords falsos na sandbox → seleção respeitada nos 4 scripts;
  1 Discord → nenhuma pergunta (assert via logs).
- `should_report` 14/14 intocado (cancelamento do seletor vira `Cancelado.`).

## Fora de escopo

- Escolha de alvo no Update do plugin (re-injeta onde já existe).
- Seleção na GUI Electron (ela gerencia a injeção direto, fora do CLI).
- Restaurar seleção anterior (sempre pergunta de novo; sem memória).
