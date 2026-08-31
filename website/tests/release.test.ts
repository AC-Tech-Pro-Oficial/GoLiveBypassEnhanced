import { describe, expect, it } from 'vitest'
import {
  downloads,
  githubReleaseAssetUrl,
  githubRawUrl,
  release,
} from '../data/release'
import { terminalCommands } from '../data/install'

describe('release downloads', () => {
  it('monta um asset direto da release configurada', () => {
    expect(githubReleaseAssetUrl(release.assets.plugin)).toBe(
      'https://github.com/bezumiya/GoLiveBypass/releases/download/v1.1.11/goLiveBypass-vencord.zip',
    )
  })

  it('codifica nomes de arquivo sem chamar a API do GitHub', () => {
    expect(githubReleaseAssetUrl('arquivo de teste.zip')).toContain('arquivo%20de%20teste.zip')
    expect(githubRawUrl('installer/golivebypass-installer.sh')).toBe(
      'https://raw.githubusercontent.com/bezumiya/GoLiveBypass/main/installer/golivebypass-installer.sh',
    )
  })

  it('expõe os caminhos usados pelas páginas', () => {
    expect(downloads.windowsGui).toContain('/releases/download/v1.1.11/')
    expect(downloads.installerPosix).toContain('/main/installer/golivebypass-installer.sh')
  })

  it('monta comandos reais para TUI e modo direto', () => {
    expect(terminalCommands.windows.plugin.tui).toContain('GoLiveBypass-Installer.ps1')
    expect(terminalCommands.windows.plugin.tui).not.toContain('-Yes')
    expect(terminalCommands.windows.plugin.direct).toContain('-Mode Install -Mod Equicord -Yes')
    expect(terminalCommands.windows.standalone.tui).toContain('GoLiveBypass-Standalone.ps1')
    expect(terminalCommands.windows.standalone.direct).toContain('-Mode Install -Yes')
    expect(terminalCommands.linux.standalone.tui).toContain('standalone/golivebypass.js')
    expect(terminalCommands.linux.standalone.direct).toContain('--yes')
  })
})
