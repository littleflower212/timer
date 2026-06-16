const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('healthReminder', {
  getStatus: () => ipcRenderer.invoke('get-status'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  remindNow: (type) => ipcRenderer.invoke('remind-now', type),
  onStatusChanged: (callback) => {
    ipcRenderer.on('status-changed', callback);
    return () => ipcRenderer.removeListener('status-changed', callback);
  },
});
