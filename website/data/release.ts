export type ReleaseAssetKey =
  | 'windowsGui'
  | 'macDmg'
  | 'macZip'
  | 'linuxGui'
  | 'plugin'
  | 'pluginSha'
  | 'standaloneJs'
  | 'standaloneSha'

export const release = {
  owner: 'bezumiya',
  repo: 'GoLiveBypass',
  tag: 'v1.1.11',
  version: '1.1.11',
  channel: 'stable',
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

export const githubRepositoryUrl = `https://github.com/${release.owner}/${release.repo}`
export const githubReleasePageUrl = `${githubRepositoryUrl}/releases/tag/${release.tag}`

export function githubReleaseAssetUrl(asset: string) {
  return `${githubRepositoryUrl}/releases/download/${release.tag}/${encodeURIComponent(asset)}`
}

export function githubRawUrl(path: string) {
  const encodedPath = path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')

  return `https://raw.githubusercontent.com/${release.owner}/${release.repo}/main/${encodedPath}`
}

export const downloads = {
  windowsGui: githubReleaseAssetUrl(release.assets.windowsGui),
  macDmg: githubReleaseAssetUrl(release.assets.macDmg),
  macZip: githubReleaseAssetUrl(release.assets.macZip),
  linuxGui: githubReleaseAssetUrl(release.assets.linuxGui),
  plugin: githubReleaseAssetUrl(release.assets.plugin),
  pluginSha: githubReleaseAssetUrl(release.assets.pluginSha),
  standaloneJs: githubReleaseAssetUrl(release.assets.standaloneJs),
  standaloneSha: githubReleaseAssetUrl(release.assets.standaloneSha),
  installerWindows: githubRawUrl('installer/GoLiveBypass-Installer.ps1'),
  installerPosix: githubRawUrl('installer/golivebypass-installer.sh'),
  standaloneWindows: githubRawUrl('standalone/GoLiveBypass-Standalone.ps1'),
  standaloneWindowsBat: githubRawUrl('standalone/GoLiveBypass-Standalone.bat'),
  standalonePosix: githubRawUrl('standalone/golivebypass-standalone.sh'),
}
