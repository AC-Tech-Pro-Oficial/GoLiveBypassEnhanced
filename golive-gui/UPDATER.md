# Auto-update do GoLiveBypass — guia do mantenedor

O app se atualiza sozinho consultando as **releases do GitHub** (`api.github.com`),
sem servidor intermediário. Este documento explica como configurar, publicar e
testar — inclui o que é obrigatório para o auto-update funcionar em cada SO.

## Como funciona

| SO | Mecanismo | Requisito de confiança |
|----|-----------|-------------------------|
| Windows | Updater portable próprio (`electron/updater.ts`) | release do fork Enhanced + URL/redirect em host GitHub permitido + digest **SHA-256** válido; assinatura Authenticode é recomendada como camada adicional de identidade |
| Linux | `electron-updater` nativo (AppImageUpdater) | metadata publicado pela release do fork |
| macOS | `electron-updater` nativo (MacUpdater) | release **assinada com Developer ID e notarizada**; CI recusa publicar sem os secrets obrigatórios |

O `publish` está configurado em `golive-gui/package.json` para:

```json
"publish": {
  "provider": "github",
  "owner": "AC-Tech-Pro-Oficial",
  "repo": "GoLiveBypassEnhanced",
  "releaseType": "release"
}
```

### Trust boundary do Windows portable

O updater de Windows não confia apenas em “HTTPS”:

1. consulta releases somente de `AC-Tech-Pro-Oficial/GoLiveBypassEnhanced`;
2. aceita download/redirect somente em hosts GitHub explicitamente permitidos;
3. recusa anexos sem digest no formato exato `sha256:<64 hex>`;
4. recalcula SHA-256 do arquivo antes da troca;
5. limita o download a 250 MB;
6. encerra conexões sem progresso após 30 s e remove arquivo parcial;
7. só então executa a coreografia de substituição/rollback.

Isso protege integridade de transporte/asset. **Não substitui code signing**: se a própria conta/release do GitHub fosse comprometida, um atacante poderia publicar binário e digest novos. Para reduzir esse risco, a próxima camada recomendada para Windows é um certificado Authenticode dedicado e verificação do publisher antes da troca. Um certificado Apple Developer ID não é, em geral, o certificado de assinatura Windows.

## Publicar uma release

1. Crie a tag `vX.Y.Z` no commit exato.
2. Dispare manualmente o workflow **build-gui**, informando tag e canal.
3. O CI usa checkout da **tag**, não da branch móvel.
4. Windows/Linux publicam os artefatos e metadata do updater.
5. macOS só publica no lane estável e somente quando todos os secrets de assinatura/notarização estão presentes.

O macOS release job exige:
- `CSC_LINK`
- `CSC_KEY_PASSWORD`
- `APPLE_ID`
- `APPLE_APP_SPECIFIC_PASSWORD`
- `APPLE_TEAM_ID`

Se qualquer um estiver ausente, a publicação falha; não existe fallback para distribuir silenciosamente um macOS build sem assinatura.

O `package.json` usa hardened runtime + entitlements mínimos necessários ao Electron/JIT e solicita notarização.

### Canal beta no macOS

O workflow continua sem publicar macOS no canal beta. Isso agora é uma decisão de rollout/validação, **não** porque o updater esteja desabilitado. Quando o lane beta assinado/notarizado for validado, ele pode ser habilitado separadamente.

## Assinatura

### macOS

Obrigatória para o release publicado. Valide artefatos com:

```sh
codesign -dv --verbose=2 GoLiveBypass.app
spctl -a -vv GoLiveBypass.app
```

Para notarização, mantenha `APPLE_TEAM_ID` e as credenciais Apple configuradas apenas como GitHub Actions secrets.

### Windows

O updater Enhanced já valida origem GitHub + SHA-256. Para identidade do publisher e melhor comportamento do SmartScreen, use um **certificado de code signing Windows** no CI. Quando essa infraestrutura existir, a recomendação é tornar assinatura + verificação do publisher um gate obrigatório de release, não apenas opcional.

## Notificação ao usuário

O fluxo de atualização avisa antes de instalar:

- **Mac/Linux**: o download corre em background; ao terminar, aparece um diálogo
  *"GoLiveBypass X.Y.Z foi baixada — Reiniciar agora?"* — só instala com o OK
- **Windows portable**: ao detectar a versão nova, pergunta *"Atualizar agora?"*
  antes de baixar/substituir

## Teste E2E (procedimento validado)

### Linux (AppImage) — fluxo completo

```bash
# 1. Build da versão "nova" apontando para o fork de teste
cd golive-gui
sed -i 's/"owner": "AC-Tech-Pro-Oficial"/"owner": "SEU_FORK"/' package.json
sed -i 's/"version": "1.0.0"/"version": "1.1.5"/' package.json
npm run build:linux

# 2. Publica a release de teste no fork (AppImage + latest-linux.yml)
gh release create v1.1.5-test --repo SEU_FORK/GoLiveBypassEnhanced \
  dist-app/GoLiveBypass.AppImage dist-app/latest-linux.yml

# 3. Build da versão "antiga" (1.0.0) e extrai para rodar sem o AppImageLauncher
sed -i 's/"version": "1.1.5"/"version": "1.0.0"/' package.json
npm run build:linux
./dist-app/GoLiveBypass.AppImage --appimage-extract   # gera squashfs-root/

# 4. Roda a antiga com APPIMAGE apontando para o arquivo a substituir
APPIMAGE=$PWD/dist-app/GoLiveBypass.AppImage \
  ./squashfs-root/golive-gui --no-sandbox
```

**Resultado esperado no log**: `Checking for update` → `Found version 1.1.5` →
`New version 1.1.5 has been downloaded` → o arquivo `GoLiveBypass.AppImage` é
substituído (tamanho muda) → reexecuta.

> ⚠️ O AppImageLauncher (binfmt) intercepta AppImages e quebra o teste. A
> extração com `--appimage-extract` + env `APPIMAGE` contorna isso.

### Windows (portable) — procedimento

```bash
# 1. Build da versão "nova" no fork
sed -i 's/"owner": "AC-Tech-Pro-Oficial"/"owner": "SEU_FORK"/' package.json
sed -i 's/"version": "1.0.0"/"version": "1.1.5"/' package.json
npm run build:win          # ou publish:win com GH_TOKEN

# 2. Publica a release com GoLiveBypass.exe (+ latest.yml)
gh release create v1.1.5-test --repo SEU_FORK/GoLiveBypassEnhanced \
  dist-app/GoLiveBypass.exe dist-app/latest.yml

# 3. Roda o exe antigo (1.0.0); ele detecta a 1.1.5, pergunta "Atualizar agora?",
#    baixa, substitui o exe em uso (com retry) e reabre a versão nova
```

**Pontos de atenção no Windows**:
- O updater usa `PORTABLE_EXECUTABLE_FILE` (variável do electron-builder
  portable) para achar o exe em uso — sem ela o update é pulado
- A substituição tem retry (até 10 tentativas, 1s entre elas) porque o Windows
  segura o exe em uso por um instante após o fechamento
- Teste também o fluxo "Depois": o app continua rodando e a checagem periódica
  (a cada 4h) oferece de novo

### macOS — procedimento

```bash
# Com os secrets de assinatura configurados:
npm run publish:mac          # gera dmg/zip assinados + latest-mac.yml

# Roda o app antigo (1.0.0) num Mac; o autoUpdater detecta, baixa em background,
# mostra "Reiniciar agora?" e aplica no quit (Squirrel.Mac aplica no relaunch)
```

**Validações no macOS**:
- `codesign -dv --verbose=2 GoLiveBypass.app` deve mostrar `Developer ID Application`
- `spctl -a -vv GoLiveBypass.dmg` deve passar (notarização ok)
- O `latest-mac.yml` precisa estar na release junto do dmg/zip

## Testes por distro Linux

O AppImage roda em qualquer distro, mas o comportamento do auto-update varia
com o ambiente. Validar em pelo menos uma de cada grupo:

### Grupo A — sem AppImageLauncher (mais comum: Ubuntu, Fedora, Arch puros)

O fluxo padrão do electron-updater funciona sem ajustes: o AppImage é
substituído in-place e reexecutado.

```bash
# 1. Publica a release de teste (v1.1.5) no fork (ver seção anterior)
# 2. Copia o AppImage antigo (v1.0.0) para um diretório e roda
mkdir -p ~/teste-update && cp dist-app/GoLiveBypass-1.0.0.AppImage ~/teste-update/
chmod +x ~/teste-update/GoLiveBypass-1.0.0.AppImage
~/teste-update/GoLiveBypass-1.0.0.AppImage
# 3. Confirma: detecta -> baixa -> dialogo -> antigo morre -> novo abre
#    (o arquivo em ~/teste-update agora tem o tamanho/versao da 1.1.5)
```

### Grupo B — com AppImageLauncher (KDE neon, Kubuntu, alguns Arch)

O launcher intercepta AppImages e os renomeia com hash ao integrar
(`GoLiveBypass-1.1.5_<hash>.AppImage`). O fluxo funciona, mas:

- O arquivo atualizado aparece com nome `GoLiveBypass-1.1.5_<hash>` em
  `~/Applications/` — **não** sobrescreve o antigo
- O app antigo deve **morrer** (o `markQuittingForUpdate` garante) e o novo
  abre integrado

**Teste**: rodar o AppImage antigo de `~/Applications/` (integrado), atualizar,
e conferir que o processo antigo sumiu (`pgrep -af golive-gui`) e o novo subiu.

### Grupo C — sandbox/flatpak ou AppImage lido de mount temporário

Se o AppImage for montado de um path temporário (ex.: teste extraído com
`--appimage-extract`), o `APPIMAGE` env aponta para um arquivo que o updater
não consegue substituir de forma estável. **Não é um cenário de produção** —
use o AppImage inteiro (grupo A/B).

## Solução de problemas

| Sintoma | Causa provável |
|---------|----------------|
| `Cannot find latest-linux.yml ... 404` | Release sem o metadata (CI antigo ou upload manual) — publique com `--publish always` |
| `APPIMAGE env is not defined` | App rodando fora do runtime AppImage (teste extraído) — rode o AppImage normal ou set `APPIMAGE` |
| `Update for version X is not available` | A release tem a **mesma versão** do app rodando — suba a versão no package.json |
| macOS: job de release falha | Secrets de Developer ID/notarização ausentes ou inválidos — corrija antes de publicar |
| `downgrade is disallowed` | A release é mais antiga que a versão local — publique uma versão maior |
| App fecha mas não abre após atualizar | App antigo segurando o lock de instância única — o `before-quit` não deve adiar o quit durante o update (o `markQuittingForUpdate` cuida disso; confira se o build tem esse fix) |
| AppImageLauncher renomeia o arquivo com hash | Esperado: o nome versionado (`GoLiveBypass-1.1.5_<hash>`) evita sobrescrever o antigo; o app novo abre integrado |
