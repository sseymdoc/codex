// Sandboxed preload (CommonJS, as sandboxed preloads must be): the page's calls into the
// shell. The page tells desktop from browser by `window.codexDesktop` being defined. The types
// are in src/components/ui.tsx (Window.codexDesktop).

const { contextBridge, ipcRenderer } = require("electron");

/** A subscription to one channel from the main process; returns the unsubscribe. */
const listen = (channel) => (callback) => {
  const listener = (_event, ...args) => callback(...args);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld("codexDesktop", {
  /** The theme setting, so the title bar, window ground and prefers-color-scheme follow it. */
  setTheme: (theme) => ipcRenderer.send("theme", theme),
  /** Flash the taskbar button while something waits on the user (only with drawAttention on). */
  attention: (on) => ipcRenderer.send("attention", !!on),
  /** Restart the app (load-error overlay, "重启 Codex"). */
  relaunch: () => ipcRenderer.send("relaunch"),
  /** Whether the account is signed in: signed out opens the 600×600 sign-in window next launch. */
  setAuthWindow: (signedIn) => ipcRenderer.send("auth-window", !!signedIn),
  versions: { electron: process.versions.electron, chrome: process.versions.chrome },
  /** { menuBar, quickEntry, quickEntryShortcut, drawAttention, keepAwake, keepAwakeOnBattery, runOnStartup }. */
  getDesktopSettings: () => ipcRenderer.invoke("desktop-settings:get"),
  /** Applies a partial change; a hotkey the system refuses comes back as { ok: false, error }. */
  setDesktopSettings: (patch) => ipcRenderer.invoke("desktop-settings:set", patch),
  /** Quick Entry window (quick.html): the typed prompt to start a session with, or null to close. */
  quickEntry: (text) => ipcRenderer.send("quick-entry", typeof text === "string" ? text : null),
  /** Quick Entry window: the card's size, to move the window back inside the work area. */
  quickSkooch: (width, height) => ipcRenderer.send("quick-skooch", Number(width), Number(height)),
  /** The page is listening: a jump-list launch of a closed app runs now. */
  ready: () => ipcRenderer.send("page-ready"),
  /** The app menu at the pointer (chrome bar 菜单). */
  popupMenu: () => ipcRenderer.send("menu-popup"),
  /** { session, sidebar, back, forward } for the app menu. */
  setMenuState: (state) => ipcRenderer.send("menu-state", state),
  /** A turn runs in some session (keep-awake). */
  setWorking: (on) => ipcRenderer.send("working", !!on),
  /** { tag, title, body, threadId, allowOnce?, silent?, urgency? }. */
  notify: (notification) => ipcRenderer.send("notify", notification),
  closeNotification: (tag) => ipcRenderer.send("notification-close", tag),
  /** { waiting, folders, last }, or null. */
  setJumpList: (list) => ipcRenderer.send("jump-list", list),
  /** Jump list / Quick Entry: (prompt, cwd), "" when absent. */
  onNewSession: listen("new-session"),
  /** Jump list / notification click: (threadId). */
  onOpenThread: listen("open-thread"),
  /** App menu items and the keys the shell takes: (command). */
  onMenuCommand: listen("menu-command"),
  /** A notification's 允许一次: ({ action: "allow_once", requestId }). */
  onNotificationAction: listen("notification-action"),
});
