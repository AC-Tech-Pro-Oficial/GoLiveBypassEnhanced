import { ipcRenderer } from 'electron';

(window as any).api = {
  platform: process.platform,
  activate: (proxy?: string) => ipcRenderer.invoke('activate', proxy),
  deactivate: () => ipcRenderer.invoke('deactivate'),
  getStatus: () => ipcRenderer.invoke('get-status'),
  getStartup: () => ipcRenderer.invoke('get-startup'),
  setStartup: (enabled: boolean) => ipcRenderer.invoke('set-startup', enabled),
  onRefreshStartup: (callback: () => void) => ipcRenderer.on('refresh-startup', callback),
};
