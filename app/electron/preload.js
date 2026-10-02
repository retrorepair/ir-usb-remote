/*
 * Preload bridge. Deliberately tiny: WebHID is reached directly from the
 * renderer via navigator.hid, so the only privileged things needed here are
 * the file dialogs for importing and exporting configurations.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('host', {
  saveFile: (defaultName, contents) => ipcRenderer.invoke('save-file', { defaultName, contents }),
  openFile: () => ipcRenderer.invoke('open-file'),
  appVersion: () => ipcRenderer.invoke('app-version'),
  onHidChanged: (fn) => {
    const handler = () => fn();
    ipcRenderer.on('hid-changed', handler);
    return () => ipcRenderer.removeListener('hid-changed', handler);
  },
});
