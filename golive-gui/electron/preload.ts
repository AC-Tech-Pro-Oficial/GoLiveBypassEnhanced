import { ipcRenderer } from 'electron';

(window as any).api = {
  activate: () => ipcRenderer.invoke('activate'),
  deactivate: () => ipcRenderer.invoke('deactivate'),
  getStatus: () => ipcRenderer.invoke('get-status')
};
