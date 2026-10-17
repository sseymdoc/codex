// Sandboxed preload (CommonJS, as sandboxed preloads must be). The page's one call into
// the shell: report the theme setting so the title bar and native UI follow it.

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("codexDesktop", {
  setTheme: (theme) => ipcRenderer.send("theme", theme),
});
