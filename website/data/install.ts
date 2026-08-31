import { githubRawUrl } from './release'

export type CommandPlatform = 'windows' | 'linux'

type CommandPair = {
  tui: string
  direct: string
  directNote: string
}

const installerWindows = githubRawUrl('installer/GoLiveBypass-Installer.ps1')
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
      tui: String.raw`irm ${installerWindows} -OutFile $env:TEMP\glb-installer.ps1; powershell -NoProfile -ExecutionPolicy Bypass -File "$env:TEMP\glb-installer.ps1"`,
      direct: String.raw`irm ${installerWindows} -OutFile $env:TEMP\glb-installer.ps1; powershell -NoProfile -ExecutionPolicy Bypass -File "$env:TEMP\glb-installer.ps1" -Mode Install -Mod Equicord -Yes`,
      directNote: 'O comando direto usa Equicord. Troque por Vencord se esse for o seu mod.',
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
