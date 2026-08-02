const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("piDesktop", {
  saveAndStart: (config) => ipcRenderer.invoke("save-and-start", config),
  checkPort: (port) => ipcRenderer.invoke("check-port", port),
  onLoadConfig: (callback) => {
    ipcRenderer.on("load-config", (_event, config) => callback(config));
  },
});
