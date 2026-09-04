import { contextBridge, ipcRenderer } from 'electron';

const api = {
  getStatus: () => ipcRenderer.invoke('get-status'),
  startLogWatch: () => ipcRenderer.invoke('start-log-watch'),
  stopLogWatch: () => ipcRenderer.invoke('stop-log-watch'),
  getDiagnostic: (payload: { status: string; note?: string }) =>
    ipcRenderer.invoke('get-diagnostic', payload),
  openBugReport: (payload: { status: string; note?: string; title?: string }) =>
    ipcRenderer.invoke('open-bug-report', payload),
  openLogFolder: () => ipcRenderer.invoke('open-log-folder'),
  onLogChunk: (callback: (chunk: string) => void) => {
    ipcRenderer.on('log-chunk', (_event, chunk: string) => callback(chunk));
  },
  onRefreshStatus: (callback: () => void) => {
    ipcRenderer.on('refresh-status', () => callback());
  },
};

contextBridge.exposeInMainWorld('api', api);
