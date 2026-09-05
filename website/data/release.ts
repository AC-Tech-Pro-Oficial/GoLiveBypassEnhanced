export type ReleaseAssetKey =
  | 'windowsGui'
  | 'macDmg'
  | 'macZip'
  | 'linuxGui'
  | 'plugin'
  | 'pluginSha'
  | 'standaloneJs'
  | 'standaloneSha'

// Enhanced source/install provenance. While this feature branch is under live validation,
// raw script links deliberately follow the branch. After merge/release, switch ref to a
// stable tag or main; do not point enhanced executables back at upstream.
export const enhancedSource = {
  owner: 'AC-Tech-Pro-Oficial',
  repo: 'GoLiveBypassEnhanced',
  ref: 'enhanced/rtc-viewer-recovery-v1',
  channel: 'enhanced-beta',
} as const

// The enhanced fork has no binary release yet. These assets are retained only so the
// website can clearly label the existing upstream GUI as LEGACY instead of fabricating
// download URLs for a release that does not exist.
export const release = {
  owner: 'bezumiya',
  repo: 'GoLiveBypass',
  tag: 'v1.1.11',
  version: '1.1.11',
  channel: 'legacy-upstream',
  assets: {
    windowsGui: 'GoLiveBypass-1.1.11.exe',
    macDmg: 'GoLiveBypass.dmg',
    macZip: 'GoLiveBypass.zip',
    linuxGui: 'GoLiveBypass-1.1.11.AppImage',
    plugin: 'goLiveBypass-vencord.zip',
    pluginSha: 'goLiveBypass-vencord.zip.sha256',
    standaloneJs: 'GoLiveBypass-1.1.11-bypass.js',
    standaloneSha: 'GoLiveBypass-1.1.11-bypass.js.sha256',
  } satisfies Record<ReleaseAssetKey, string>,
} as const

export const githubRepositoryUrl =
  `https://github.com/${enhancedSource.owner}/${enhancedSource.repo}`

export const githubReleasePageUrl =
  `https://github.com/${release.owner}/${release.repo}/releases/tag/${release.tag}`

export function githubReleaseAssetUrl(asset: string) {
  return `https://github.com/${release.owner}/${release.repo}/releases/download/${release.tag}/${encodeURIComponent(asset)}`
}

export function githubRawUrl(path: string) {
  const encodedPath = path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')

  return `https://raw.githubusercontent.com/${enhancedSource.owner}/${enhancedSource.repo}/${enhancedSource.ref}/${encodedPath}`
}

export const enhancedPluginSourceUrl =
  `${githubRepositoryUrl}/tree/${enhancedSource.ref}/goLiveBypass`

export const downloads = {
  // Explicitly legacy/upstream binaries until GoLiveBypassEnhanced has a release.
  windowsGui: githubReleaseAssetUrl(release.assets.windowsGui),
  macDmg: githubReleaseAssetUrl(release.assets.macDmg),
  macZip: githubReleaseAssetUrl(release.assets.macZip),
  linuxGui: githubReleaseAssetUrl(release.assets.linuxGui),

  // Enhanced source/install paths.
  plugin: enhancedPluginSourceUrl,
  pluginSha: '',
  standaloneJs: githubRawUrl('standalone/golivebypass.js'),
  standaloneSha: '',
  installerWindows: githubRawUrl('installer/GoLiveBypass-Installer.ps1'),
  installerEnhancedWindows: githubRawUrl('installer/Install-Enhanced.ps1'),
  installerPosix: githubRawUrl('installer/golivebypass-installer.sh'),
  standaloneWindows: githubRawUrl('standalone/GoLiveBypass-Standalone.ps1'),
  standaloneWindowsBat: githubRawUrl('standalone/GoLiveBypass-Standalone.bat'),
  standalonePosix: githubRawUrl('standalone/golivebypass-standalone.sh'),
}
