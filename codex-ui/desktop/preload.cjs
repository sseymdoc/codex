// Sandboxed preload (CommonJS, as sandboxed preloads must be): the page's calls into the
// shell. The page tells desktop from browser by `window.codexDesktop` being defined.

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("codexDesktop", {
  /** The theme setting, so the title bar, window ground and prefers-color-scheme follow it. */
  setTheme: (theme) => ipcRenderer.send("theme", theme),
  /** Flash the taskbar button while something waits on the user and the window is unfocused. */
  attention: (on) => ipcRenderer.send("attention", !!on),
  /** Restart the app (load-error overlay, "重启 Codex"). */
  relaunch: () => ipcRenderer.send("relaunch"),
  /** Whether the account is signed in: signed out opens the 600×600 sign-in window next launch. */
  setAuthWindow: (signedIn) => ipcRenderer.send("auth-window", !!signedIn),
  versions: { electron: process.versions.electron, chrome: process.versions.chrome },
  /** Settings → 通用 → 系统: { menuBar, quickEntry, quickEntryShortcut }. */
  getDesktopSettings: () => ipcRenderer.invoke("desktop-settings:get"),
  /** Applies a partial change; a hotkey the system refuses comes back as { ok: false, error }. */
  setDesktopSettings: (patch) => ipcRenderer.invoke("desktop-settings:set", patch),
  /** Quick Entry window (quick.html): the typed prompt to start a session with, or null to close. */
  quickEntry: (text) => ipcRenderer.send("quick-entry", typeof text === "string" ? text : null),
  /** Jump list「新建会话」("") and Quick Entry (its prompt) ask for a new session; returns the unsubscribe. */
  onNewSession: (callback) => {
    const listener = (_event, prompt) => callback(typeof prompt === "string" ? prompt : "");
    ipcRenderer.on("new-session", listener);
    return () => ipcRenderer.removeListener("new-session", listener);
  },
});
