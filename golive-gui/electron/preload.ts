import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
  activate: (proxy?: string) => ipcRenderer.invoke('activate', proxy),
  deactivate: () => ipcRenderer.invoke('deactivate'),
  getStatus: () => ipcRenderer.invoke('get-status'),
});
