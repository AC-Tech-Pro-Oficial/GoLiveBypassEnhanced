import { enhancedSource, githubRawUrl } from './release'

export type CommandPlatform = 'windows' | 'linux'

type CommandPair = {
  tui: string
  direct: string
  directNote: string
}

const installerWindows = githubRawUrl('installer/GoLiveBypass-Installer.ps1')
const enhancedWindows = githubRawUrl('installer/Install-Enhanced.ps1')
const enhancedCommitApi = `https://api.github.com/repos/${enhancedSource.owner}/${enhancedSource.repo}/commits/`
const enhancedRawBase = `https://raw.githubusercontent.com/${enhancedSource.owner}/${enhancedSource.repo}`
const enhancedPinnedPrefix = String.raw`$ErrorActionPreference='Stop'; $b='${enhancedSource.ref}'; $u='${enhancedCommitApi}'+[Uri]::EscapeDataString($b); $r=irm $u -Headers @{'User-Agent'='GoLiveBypassEnhanced-Installer'}; if([string]$r.sha -notmatch '^[0-9a-fA-F]{40}$'){throw 'GitHub nao devolveu um commit valido'}; $env:GOLIVE_ENHANCED_REF=[string]$r.sha;`
const installerLinux = githubRawUrl('installer/golivebypass-installer.sh')
const standaloneWindows = githubRawUrl('standalone/GoLiveBypass-Standalone.ps1')
const standaloneLinux = githubRawUrl('standalone/golivebypass-standalone.sh')
const standalonePayload = githubRawUrl('standalone/golivebypass.js')

const posixTempPrefix = '${TMPDIR:-/tmp}'
const standaloneLinuxBootstrap = String.raw`tmp="$(mktemp -d "${posixTempPrefix}/golivebypass.XXXXXX")" && curl -fsSL ${standaloneLinux} -o "$tmp/golivebypass-standalone.sh" && curl -fsSL ${standalonePayload} -o "$tmp/golivebypass.js" && chmod +x "$tmp/golivebypass-standalone.sh" && "$tmp/golivebypass-standalone.sh"`
const standaloneLinuxDirect = String.raw`tmp="$(mktemp -d "${posixTempPrefix}/golivebypass.XXXXXX")" && curl -fsSL ${standaloneLinux} -o "$tmp/golivebypass-standalone.sh" && curl -fsSL ${standalonePayload} -o "$tmp/golivebypass.js" && chmod +x "$tmp/golivebypass-standalone.sh" && "$tmp/golivebypass-standalone.sh" --yes`

export const terminalCommands: Record<CommandPlatform, { plugin: CommandPair; standalone: CommandPair }> = {
  windows: {
    plugin: {
      tui: String.raw`${enhancedPinnedPrefix} $s=irm ('${enhancedRawBase}/'+$r.sha+'/installer/Install-Enhanced.ps1'); iex $s`,
      direct: String.raw`${enhancedPinnedPrefix} irm ('${enhancedRawBase}/'+$r.sha+'/installer/Install-Enhanced.ps1') -OutFile $env:TEMP\glb-enhanced.ps1; powershell -NoProfile -ExecutionPolicy Bypass -File $env:TEMP\glb-enhanced.ps1 -Mod Equicord`,
      directNote: 'O primeiro comando detecta Vencord/Equicord e migra automaticamente. O direto força Equicord.',
    },
    standalone: {
      tui: String.raw`irm ${standaloneWindows} -OutFile $env:TEMP\glb-standalone.ps1; powershell -NoProfile -ExecutionPolicy Bypass -File "$env:TEMP\glb-standalone.ps1"`,
      direct: String.raw`irm ${standaloneWindows} -OutFile $env:TEMP\glb-standalone.ps1; powershell -NoProfile -ExecutionPolicy Bypass -File "$env:TEMP\glb-standalone.ps1" -Mode Install -Yes`,
      directNote: 'Use apenas com o Discord puro. Não rode por cima de Equicord ou Vencord.',
    },
  },
  linux: {
    plugin: {
      tui: String.raw`curl -fsSL ${installerLinux} -o /tmp/glb-installer.sh && chmod +x /tmp/glb-installer.sh && /tmp/glb-installer.sh`,
      direct: String.raw`curl -fsSL ${installerLinux} -o /tmp/glb-installer.sh && chmod +x /tmp/glb-installer.sh && /tmp/glb-installer.sh --install --mod equicord --yes`,
      directNote: 'O comando direto usa Equicord. Troque equicord por vencord se esse for o seu mod.',
    },
    standalone: {
      tui: standaloneLinuxBootstrap,
      direct: standaloneLinuxDirect,
      directNote: 'Use apenas com o Discord puro. Não rode por cima de Equicord ou Vencord.',
    },
  },
}
