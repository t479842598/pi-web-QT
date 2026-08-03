const { contextBridge, ipcRenderer } = require("electron");

// Electron window controls — used by AppTitleBar for the frameless title bar.
contextBridge.exposeInMainWorld("electron", {
  isElectron: true,
  windowControls: {
    minimize: () => ipcRenderer.send("window:minimize"),
    toggleMaximize: () => ipcRenderer.send("window:toggle-maximize"),
    close: () => ipcRenderer.send("window:close"),
    isMaximized: () => ipcRenderer.invoke("window:is-maximized"),
    onMaximizedChange: (callback) => {
      const listener = (_event, maximized) => callback(maximized);
      ipcRenderer.on("window:maximized-changed", listener);
      return () => ipcRenderer.removeListener("window:maximized-changed", listener);
    },
  },
});

// Existing setup-wizard bridge (first-run configuration) + desktop workspace helpers.
contextBridge.exposeInMainWorld("piDesktop", {
  // Setup wizard (first run): save config & start server / check port / load config
  saveAndStart: (config) => ipcRenderer.invoke("save-and-start", config),
  checkPort: (port) => ipcRenderer.invoke("check-port", port),
  onLoadConfig: (callback) => {
    ipcRenderer.on("load-config", (_event, config) => callback(config));
  },
  // Native OS directory picker — used by the workspace selector.
  selectDirectory: () => ipcRenderer.invoke("dialog:select-directory"),
  // Open PI theme folder / docs in the OS shell.
  openThemeFolder: () => ipcRenderer.invoke("shell:open-theme-folder"),
  openThemeDocs: () => ipcRenderer.invoke("shell:open-theme-docs"),
});
