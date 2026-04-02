const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Window controls
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),

  // Network info
  getLocalInfo: () => ipcRenderer.invoke('get-local-info'),

  // Scanning
  startScan: (options) => ipcRenderer.invoke('start-scan', options),
  cancelScan: () => ipcRenderer.send('cancel-scan'),
  onScanProgress: (cb) => {
    ipcRenderer.on('scan-progress', (event, data) => cb(data));
  },
  removeScanListeners: () => {
    ipcRenderer.removeAllListeners('scan-progress');
  },

  // Export
  exportResults: (data) => ipcRenderer.invoke('export-results', data),
});
