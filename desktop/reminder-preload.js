const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('reminderApi', {
  snooze: (type) => ipcRenderer.invoke('snooze', type),
});
