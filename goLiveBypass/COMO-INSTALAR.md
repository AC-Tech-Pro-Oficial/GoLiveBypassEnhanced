# GoLiveBypassEnhanced — plugin do Vencord/Equicord

Esta pasta traz os **5 arquivos fonte** do plugin Enhanced:

- `index.tsx`
- `native.ts`
- `rtcRecovery.ts`
- `rtcShim.ts`
- `manifest.json`

O caminho recomendado no Windows é o instalador Enhanced: ele detecta Vencord/Equicord, preserva os outros plugins/settings, migra instalações antigas, compila o plugin e provisiona/valida o Tor.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "irm 'https://raw.githubusercontent.com/AC-Tech-Pro-Oficial/GoLiveBypassEnhanced/enhanced/rtc-viewer-recovery-v1/installer/Install-Enhanced.ps1' | iex"
```

## Instalação manual

Use o fluxo manual somente se você quiser controlar o checkout/build por conta própria.

1. Tenha Node.js e pnpm. Git é conveniente, mas o instalador Enhanced também suporta source archive.
2. Baixe o código do Equicord ou Vencord.
3. Copie **a pasta inteira** `goLiveBypass` para `src/userplugins/` do checkout. Não copie por cima de uma versão antiga arquivo por arquivo; remova/substitua a pasta anterior para não deixar TypeScript obsoleto.
4. O caminho final deve conter todos os cinco arquivos, por exemplo:
   `src/userplugins/goLiveBypass/rtcRecovery.ts`.
5. Na raiz do mod, rode `pnpm install`, `pnpm build` e `pnpm inject`.
6. Reinicie o Discord por completo e ative **GoLiveBypass**.

## Rede

O Enhanced usa **Tor local por padrão**. Deixar o campo Proxy vazio significa “usar Tor”; não significa procurar uma proxy pública.

Se você quiser uma saída própria, configure explicitamente uma proxy SOCKS5/HTTP de confiança. O Enhanced não cai silenciosamente para listas públicas.

## Já tenho Vencord/Equicord ou usei outro GoLiveBypass

Prefira o instalador Enhanced acima. Ele foi feito para este caso:

- identifica o mod ativo, inclusive quando um standalone antigo está mascarando a injeção;
- faz backup das configurações;
- remove somente estado legado do próprio GoLiveBypass;
- substitui a pasta do userplugin de forma staged/atômica;
- preserva plugins e settings não relacionados;
- recompila e confirma marcadores Enhanced no bundle;
- reinjeta o mesmo Vencord/Equicord;
- configura e valida Tor em `127.0.0.1:9060`.

Evite instalar o standalone por cima de Vencord/Equicord. Ele existe para Discord puro; o userplugin é o caminho compatível com mods.

## Projeto Enhanced

https://github.com/AC-Tech-Pro-Oficial/GoLiveBypassEnhanced
