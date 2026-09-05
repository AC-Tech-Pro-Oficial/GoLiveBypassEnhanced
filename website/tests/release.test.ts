import { describe, expect, it } from 'vitest'
import {
  downloads,
  enhancedSource,
  githubReleaseAssetUrl,
  githubRawUrl,
  release,
} from '../data/release'
import { terminalCommands } from '../data/install'

describe('release downloads', () => {
  it('keeps legacy GUI binaries explicitly on the upstream release until enhanced has one', () => {
    expect(release.channel).toBe('legacy-upstream')
    expect(githubReleaseAssetUrl(release.assets.windowsGui)).toBe(
      'https://github.com/bezumiya/GoLiveBypass/releases/download/v1.1.11/GoLiveBypass-1.1.11.exe',
    )
  })

  it('builds all source/install URLs from the enhanced fork feature ref', () => {
    expect(enhancedSource.owner).toBe('AC-Tech-Pro-Oficial')
    expect(githubRawUrl('installer/golivebypass-installer.sh')).toBe(
      'https://raw.githubusercontent.com/AC-Tech-Pro-Oficial/GoLiveBypassEnhanced/enhanced/rtc-viewer-recovery-v1/installer/golivebypass-installer.sh',
    )
    expect(downloads.plugin).toContain('/AC-Tech-Pro-Oficial/GoLiveBypassEnhanced/tree/')
  })

  it('exposes the migration-aware immutable Windows bootstrap', () => {
    expect(downloads.installerEnhancedWindows).toContain('/installer/Install-Enhanced.ps1')
    expect(terminalCommands.windows.plugin.tui).toContain('api.github.com/repos/AC-Tech-Pro-Oficial/GoLiveBypassEnhanced/commits/')
    expect(terminalCommands.windows.plugin.tui).toContain('GOLIVE_ENHANCED_REF')
    expect(terminalCommands.windows.plugin.tui).toContain("+$r.sha+'/installer/Install-Enhanced.ps1'")
    expect(terminalCommands.windows.plugin.tui).toContain('iex $s')
    expect(terminalCommands.windows.plugin.direct).toContain('GOLIVE_ENHANCED_REF')
    expect(terminalCommands.windows.plugin.direct).toContain('-Mod Equicord')
  })

  it('keeps standalone commands on enhanced source', () => {
    expect(terminalCommands.windows.standalone.tui).toContain('GoLiveBypass-Standalone.ps1')
    expect(terminalCommands.windows.standalone.direct).toContain('-Mode Install -Yes')
    expect(terminalCommands.linux.standalone.tui).toContain('standalone/golivebypass.js')
    expect(terminalCommands.linux.standalone.direct).toContain('--yes')
  })
})
