import { ipcRenderer } from 'electron';

(window as any).api = {
  platform: process.platform,
  activate: (proxy?: string) => ipcRenderer.invoke('activate', proxy),
  deactivate: () => ipcRenderer.invoke('deactivate'),
  getStatus: () => ipcRenderer.invoke('get-status'),
  getProxy: () => ipcRenderer.invoke('get-proxy'),
  getPlatform: () => ipcRenderer.invoke('get-platform'),
  getStartup: () => ipcRenderer.invoke('get-startup'),
  setStartup: (enabled: boolean) => ipcRenderer.invoke('set-startup', enabled),
  getNetMode: () => ipcRenderer.invoke('get-net-mode'),
  setNetMode: (mode: string) => ipcRenderer.invoke('set-net-mode', mode),
  getTorStatus: () => ipcRenderer.invoke('get-tor-status'),
  installTor: () => ipcRenderer.invoke('install-tor'),
  onRefreshStartup: (callback: () => void) => ipcRenderer.on('refresh-startup', callback),
  onRefreshStatus: (callback: () => void) => ipcRenderer.on('refresh-status', callback),
  resizeWindow: (height: number) => ipcRenderer.send('resize-window', height),
  setTheme: (theme: string) => ipcRenderer.send('set-theme', theme),
  reportBug: (payload: { title: string; description: string; includeLogs: boolean }) => ipcRenderer.invoke('report-bug', payload),
};
