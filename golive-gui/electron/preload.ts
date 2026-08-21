import { ipcRenderer } from 'electron';

(window as any).api = {
  activate: (proxy?: string) => ipcRenderer.invoke('activate', proxy),
  deactivate: () => ipcRenderer.invoke('deactivate'),
  getStatus: () => ipcRenderer.invoke('get-status'),
  getStartup: () => ipcRenderer.invoke('get-startup'),
  setStartup: (enabled: boolean) => ipcRenderer.invoke('set-startup', enabled),
  onRefreshStartup: (callback: () => void) => ipcRenderer.on('refresh-startup', callback),
  onLog: (cb: (chunk: string) => void) => {
    const listener = (_e: any, chunk: string) => cb(chunk);
    ipcRenderer.on('bypass-log', listener);
    return () => ipcRenderer.removeListener('bypass-log', listener);
  },
};
