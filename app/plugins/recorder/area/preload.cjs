// The recorder's overlay windows (#376): the only bridge they get, on their own channels.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('recwin', {
  init: () => ipcRenderer.invoke('recorder:win-init'),
  send: (what, data) => ipcRenderer.send('recorder:win', what, data),
  // The main side's news for this window: the pen's state, a clear, a stroke (#380).
  onState: fn => ipcRenderer.on('recorder:win-state', (_e, s) => fn(s)),
});
