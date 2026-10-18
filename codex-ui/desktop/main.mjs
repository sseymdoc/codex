// Electron shell: runs the same loopback server as `pnpm start` and shows it in a window
// instead of a browser tab. Window behavior follows Claude Desktop 2.42304.0.0's main
// process (app.asar .vite/build/index.chunk-lzaSYO3Q.js, read-only): window-state.json,
// zoom 25%–500%, the title bar overlay, the 600×600 sign-in window, taskbar attention, the tray,
// Quick Entry and the jump list.

import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, nativeTheme, screen, session, shell, Tray } from "electron";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { parseArgs } from "../server/bridge.mjs";
import { serve } from "../server/serve.mjs";

// Electron has no context menu of its own; give back the browser's basics.
const MENU_LABELS = { cut: "剪切", copy: "复制", paste: "粘贴", selectAll: "全选" };
const THEMES = ["light", "dark", "system"];
// Windows / Linux: the page draws the 36px chrome bar ([data-wco], shell.css) and the system
// caption buttons float over its right end. macOS keeps the native frame.
const customTitleBar = process.platform !== "darwin";
// lzaSYO3Q V$n / oI: the default app window and the signed-out sign-in window.
const APP_SIZE = { width: 1200, height: 800 };
const AUTH_SIZE = { width: 600, height: 600 };
// lzaSYO3Q uLi() / EKn / bF(): zoom moves in Chromium levels of .5, factor = 1.2^level, 25%–500%.
const ZOOM_STEP = 0.5;
const MIN_LEVEL = Math.log(0.25) / Math.log(1.2);
const MAX_LEVEL = Math.log(5) / Math.log(1.2);
// Only our page asks for these: the microphone for voice mode, clipboard writes for copy buttons.
const PERMISSIONS = new Set(["media", "clipboard-sanitized-write"]);
// lzaSYO3Q Cze / I5r × L5r: the Windows Quick Entry hotkey (legacyQuickEntryEnabled, on by default)
// and its transparent window; quick.html draws the card at the top of it.
const QUICK_SHORTCUT = "Ctrl+Alt+Space";
// lzaSYO3Q nqn() / $Kn: a global hotkey needs a modifier unless it is F1–F24.
const MODIFIERS = new Set(["Ctrl", "Control", "Alt", "Option", "AltGr", "Shift", "Super", "Meta", "Cmd", "Command", "CmdOrCtrl", "CommandOrControl"]);
// c71860c77 shortcut recorder: registration refused / accelerator not accepted.
const SHORTCUT_TAKEN = "这个快捷键已被其他应用占用，请换一个组合。";
const SHORTCUT_UNSUPPORTED = "这个快捷键组合不受支持，请换一个组合。";
const QUICK_SIZE = { width: 606, height: 470 };
// The jump list's「新建会话」starts a second instance with this; the first one picks it up.
const NEW_SESSION_ARG = "--new-session";
const ICON = path.join(import.meta.dirname, "icon.ico");
const PRELOAD = path.join(import.meta.dirname, "preload.cjs");

let win;
let quick;
let tray;
let boundShortcut = null;
let quitting = false;
let origin = "";
let state = {};
let saveTimer;
// The window opened as the 600×600 sign-in window; its bounds are not the app's.
let authMode = false;

if (!app.requestSingleInstanceLock()) {
  app.exit();
} else {
  app.on("second-instance", (_event, argv) => {
    if (argv.includes(NEW_SESSION_ARG)) newSession("");
    else showMain();
  });
  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", () => {
    quitting = true;
    flushState();
  });
  app.on("will-quit", () => globalShortcut.unregisterAll());
  start().catch((error) => {
    dialog.showErrorBox("Codex UI", error.message);
    app.exit(1);
  });
}

async function start() {
  state = readState();
  // Before any window exists, so the first frame already has the user's theme.
  nativeTheme.themeSource = THEMES.includes(state.theme) ? state.theme : "system";
  // No application menu: its accelerators (Ctrl+Shift+I DevTools, Ctrl+R reload, Ctrl+W close)
  // would shadow the page's shortcuts. Zoom is handled below; text editing keys work without it.
  Menu.setApplicationMenu(null);
  const [server] = await Promise.all([
    serve({
      ...parseArgs([]),
      // A shortcut starts us in the install folder; new chats default to home instead.
      cwd: process.env.INIT_CWD || homedir(),
      // localStorage (theme, drafts) is per origin, so keep clear of the browser version's 7477.
      port: 7478,
    }),
    app.whenReady(),
  ]);
  app.on("quit", server.close);
  origin = new URL(server.url).origin;

  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    callback(PERMISSIONS.has(permission) && sameOrigin(details.requestingUrl ?? contents.getURL()));
  });

  authMode = state.signedIn === false;
  const placed = authMode ? null : placedBounds(state.bounds);
  win = new BrowserWindow({
    ...(placed ?? (authMode ? AUTH_SIZE : APP_SIZE)),
    minWidth: 600,
    minHeight: 400,
    // The native window shows its page color until the page paints (lzaSYO3Q MF()).
    backgroundColor: background(),
    show: false,
    icon: ICON,
    ...(customTitleBar && { titleBarStyle: "hidden", titleBarOverlay: overlay() }),
    webPreferences: { preload: PRELOAD, zoomFactor: 1.2 ** savedZoom() },
  });
  if (!authMode && state.maximized) win.maximize();
  win.once("ready-to-show", () => win.show());
  for (const name of ["resize", "move", "maximize", "unmaximize", "enter-full-screen", "leave-full-screen"]) {
    win.on(name, rememberBounds);
  }
  win.on("focus", () => win.flashFrame(false));
  // With the tray up, closing the window only hides it; the tray's 退出 quits. Without it the
  // window closes and the app with it (lzaSYO3Q main window "close", menuBarEnabled).
  win.on("close", (event) => {
    if (quitting || !desktopSettings().menuBar) return;
    event.preventDefault();
    if (!win.isFullScreen()) return win.hide();
    win.once("leave-full-screen", () => win.hide());
    win.setFullScreen(false);
  });
  // A page-initiated window.close() skips "close"; without the window there is nothing to show.
  win.on("closed", () => app.quit());

  const settings = desktopSettings();
  syncTray();
  const error = bindQuick(settings.quickEntry ? settings.quickEntryShortcut : null);
  if (error) console.warn(`Quick Entry ${settings.quickEntryShortcut}: ${error}`);
  // Settings → 通用 → 系统 (c7357c32b menuBar / quickEntryShortcut).
  ipcMain.handle("desktop-settings:get", (event) => (fromPage(event) ? desktopSettings() : null));
  ipcMain.handle("desktop-settings:set", (event, patch) => (fromPage(event) ? setDesktopSettings(patch) : { ok: false, error: "forbidden" }));
  ipcMain.on("quick-entry", (event, text) => {
    if (quick && !quick.isDestroyed() && event.sender === quick.webContents) dismissQuick(text);
  });
  if (process.platform === "win32") {
    // An unpackaged run starts Electron with the app path first; the task has to repeat it.
    const args = [...(app.isPackaged ? [] : [path.resolve(process.argv[1])]), NEW_SESSION_ARG];
    app.setUserTasks([
      {
        program: process.execPath,
        arguments: args.map((arg) => `"${arg}"`).join(" "),
        iconPath: process.execPath,
        iconIndex: 0,
        title: "新建会话",
        description: "新建会话",
      },
    ]);
  }

  // The page reports its theme setting (preload.cjs). Following it instead of the OS keeps
  // prefers-color-scheme, native menus and the caption buttons in step with the page.
  ipcMain.on("theme", (event, theme) => {
    if (!fromPage(event) || !THEMES.includes(theme)) return;
    nativeTheme.themeSource = theme;
    saveState({ theme });
  });
  nativeTheme.on("updated", () => {
    if (win.isDestroyed()) return;
    win.setBackgroundColor(background());
    syncOverlay();
  });
  // Something needs the user (an approval, a question) while the window is in the background.
  ipcMain.on("attention", (event, on) => {
    if (!fromPage(event)) return;
    if (!on) win.flashFrame(false);
    else if (!win.isFocused()) win.flashFrame(true);
  });
  ipcMain.on("relaunch", (event) => {
    if (!fromPage(event)) return;
    app.relaunch();
    app.quit();
  });
  // Signed out → the next launch opens the 600×600 sign-in window; signing in there moves
  // the window back to the saved app bounds (lzaSYO3Q V6a(): u = signedIn ? "app" : "login").
  ipcMain.on("auth-window", (event, signedIn) => {
    if (!fromPage(event)) return;
    saveState({ signedIn: !!signedIn });
    if (!signedIn || !authMode) return;
    authMode = false;
    const bounds = placedBounds(state.bounds);
    if (bounds) win.setBounds(bounds);
    else {
      win.setSize(APP_SIZE.width, APP_SIZE.height);
      win.center();
    }
    if (state.maximized) win.maximize();
  });

  const contents = win.webContents;
  contents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    if (input.key === "F12" && !app.isPackaged) {
      contents.toggleDevTools();
      return event.preventDefault();
    }
    if (!input.control || input.alt || input.meta) return;
    if (input.key === "=" || input.key === "+") zoomBy(ZOOM_STEP);
    else if (input.key === "-" || input.key === "_") zoomBy(-ZOOM_STEP);
    else if (input.key === "0" && !input.shift) setZoomLevel(0);
    else return;
    event.preventDefault();
  });
  // Ctrl + wheel; Electron reports it and leaves zooming to us.
  contents.on("zoom-changed", (_event, direction) => zoomBy(direction === "in" ? ZOOM_STEP : -ZOOM_STEP));

  // Links open in the system browser; anything but http(s) stays closed.
  contents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: "deny" };
  });
  contents.on("will-navigate", (event, url) => {
    if (sameOrigin(url)) return;
    event.preventDefault();
    openExternal(url);
  });
  contents.on("context-menu", (_event, { isEditable, selectionText }) => {
    const roles = isEditable ? ["cut", "copy", "paste", "selectAll"] : selectionText ? ["copy"] : [];
    if (roles.length) Menu.buildFromTemplate(roles.map((role) => ({ role, label: MENU_LABELS[role] }))).popup();
  });

  await win.loadURL(server.url);
}

// ---------------------------------------------------------------------------
// Desktop settings, kept in window-state.json: the tray (menuBarEnabled), the Quick Entry hotkey
// and its accelerator. A hotkey change binds the new key first and keeps the old one if refused.

function desktopSettings() {
  return {
    menuBar: state.menuBar !== false,
    quickEntry: state.quickEntry !== false,
    quickEntryShortcut: typeof state.quickEntryShortcut === "string" ? state.quickEntryShortcut : QUICK_SHORTCUT,
  };
}

function setDesktopSettings(patch) {
  const current = desktopSettings();
  const next = { ...current };
  if (typeof patch?.menuBar === "boolean") next.menuBar = patch.menuBar;
  if (typeof patch?.quickEntry === "boolean") next.quickEntry = patch.quickEntry;
  if (typeof patch?.quickEntryShortcut === "string") next.quickEntryShortcut = patch.quickEntryShortcut.trim();
  if (next.quickEntry !== current.quickEntry || next.quickEntryShortcut !== current.quickEntryShortcut) {
    const error = bindQuick(next.quickEntry ? next.quickEntryShortcut : null);
    if (error) return { ok: false, error };
  }
  saveState(next);
  syncTray();
  return { ok: true };
}

/** Binds the Quick Entry hotkey (null: none); a refused key leaves the previous one bound. */
function bindQuick(accelerator) {
  const previous = boundShortcut;
  if (previous) globalShortcut.unregister(previous);
  boundShortcut = null;
  if (!accelerator) return null;
  const error = register(accelerator);
  if (!error) boundShortcut = accelerator;
  else if (previous && !register(previous)) boundShortcut = previous;
  return error;
}

function register(accelerator) {
  const keys = accelerator.split("+");
  if (!keys.some((key) => MODIFIERS.has(key)) && !/^F([1-9]|1[0-9]|2[0-4])$/.test(accelerator)) return SHORTCUT_UNSUPPORTED;
  try {
    return globalShortcut.register(accelerator, toggleQuick) ? null : SHORTCUT_TAKEN;
  } catch {
    return SHORTCUT_UNSUPPORTED;
  }
}

// lzaSYO3Q u8a() / mLi(): the app name as tooltip, a click opens Quick Entry (f8a), the menu is
// 显示 Codex · 退出 (the usage rows in between need the plan's live usage; not done).
function syncTray() {
  const on = desktopSettings().menuBar;
  if (!on) {
    tray?.destroy();
    tray = undefined;
    return;
  }
  if (tray) return;
  tray = new Tray(ICON);
  tray.setToolTip("Codex");
  tray.setContextMenu(
    Menu.buildFromTemplate([{ label: "显示 Codex", click: showMain }, { type: "separator" }, { label: "退出", click: () => app.quit() }]),
  );
  tray.on("click", toggleQuick);
}

// lzaSYO3Q Dq(): restore, focus or show the main window.
function showMain() {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  else if (!win.isVisible()) win.show();
  win.focus();
}

/** Jump list / Quick Entry: the page starts a session, sending `prompt` when there is one. */
function newSession(prompt) {
  showMain();
  if (win && !win.isDestroyed()) win.webContents.send("new-session", prompt);
}

// ---------------------------------------------------------------------------
// Quick Entry (lzaSYO3Q V5r / K5r): a transparent, frameless, always-on-top 606 × 470 window at
// its last position (else centred on the primary display). The hotkey or a tray click toggles
// it; losing focus, Esc or a click beside the card dismisses it. Signed out, the main window
// opens instead.

function toggleQuick() {
  if (quick && !quick.isDestroyed() && quick.isVisible()) return dismissQuick(null);
  if (state.signedIn === false) return showMain();
  const w = quickWindow();
  const [x, y] = quickPosition();
  w.setPosition(x, y);
  const show = () => {
    w.show();
    w.focus();
  };
  if (w.webContents.isLoading()) w.once("ready-to-show", show);
  else show();
}

function quickWindow() {
  if (quick && !quick.isDestroyed()) return quick;
  const w = new BrowserWindow({
    ...QUICK_SIZE,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    show: false,
    webPreferences: { preload: PRELOAD },
  });
  w.setAlwaysOnTop(true, "pop-up-menu");
  w.on("blur", () => dismissQuick(null));
  w.on("hide", () => saveState({ quickAt: w.getPosition() }));
  w.on("closed", () => {
    if (quick === w) quick = null;
  });
  w.loadFile(path.join(import.meta.dirname, "quick.html"));
  quick = w;
  return w;
}

function quickPosition() {
  const at = state.quickAt;
  const placed = Array.isArray(at) && at.every(Number.isFinite) ? placedBounds({ x: at[0], y: at[1], ...QUICK_SIZE }) : null;
  if (placed) return [placed.x, placed.y];
  const area = screen.getPrimaryDisplay().workArea;
  return [Math.round(area.x + (area.width - QUICK_SIZE.width) / 2), Math.round(area.y + (area.height - QUICK_SIZE.height) / 2)];
}

// lzaSYO3Q K5r(): more than two characters start a session in the main window; less just closes.
function dismissQuick(text) {
  if (quick && !quick.isDestroyed()) quick.hide();
  if (typeof text === "string" && text.trim().length > 2) newSession(text);
}

function fromPage(event) {
  return !!win && !win.isDestroyed() && event.sender === win.webContents;
}

function sameOrigin(url) {
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}

function openExternal(url) {
  if (/^https?:/i.test(url)) shell.openExternal(url);
}

function background() {
  return nativeTheme.shouldUseDarkColors ? "#151515" : "#fcfcfb";
}

// lzaSYO3Q RYn(): transparent over the chrome bar, Claude Desktop's caption glyph colors, and a
// height that follows the zoom so the native buttons stay as tall as the 36px bar.
function overlay() {
  const factor = win && !win.isDestroyed() ? win.webContents.getZoomFactor() : 1.2 ** savedZoom();
  return {
    color: "#00000000",
    symbolColor: nativeTheme.shouldUseDarkColors ? "#c2c0b6" : "#3d3d3a",
    height: Math.max(24, Math.round(36 * factor)),
  };
}

function syncOverlay() {
  if (customTitleBar && win && !win.isDestroyed()) win.setTitleBarOverlay(overlay());
}

function setZoomLevel(level) {
  const next = Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, level));
  win.webContents.setZoomLevel(next);
  saveState({ zoom: next });
  syncOverlay();
}

function zoomBy(step) {
  setZoomLevel(Math.round((win.webContents.getZoomLevel() + step) / ZOOM_STEP) * ZOOM_STEP);
}

function savedZoom() {
  return Number.isFinite(state.zoom) ? Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, state.zoom)) : 0;
}

// ---------------------------------------------------------------------------
// window-state.json (lzaSYO3Q Yxe): bounds, maximized, zoom, theme and whether the last
// session ended signed in. Writes are debounced 1s (Xxe) and atomic.

function stateFile() {
  return path.join(app.getPath("userData"), "window-state.json");
}

function readState() {
  try {
    const value = JSON.parse(readFileSync(stateFile(), "utf8"));
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

function saveState(patch) {
  state = { ...state, ...patch };
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushState, 1000);
}

function flushState() {
  clearTimeout(saveTimer);
  try {
    const file = stateFile();
    writeFileSync(`${file}.tmp`, JSON.stringify(state));
    renameSync(`${file}.tmp`, file);
  } catch {
    // A read-only profile: the window just opens at the default size next time.
  }
}

function rememberBounds() {
  if (authMode || win.isDestroyed() || win.isMinimized()) return;
  saveState({ bounds: win.getNormalBounds(), maximized: win.isMaximized() });
}

/** Saved bounds if they still land on a connected display, clamped to its work area. */
function placedBounds(bounds) {
  if (!bounds || !(bounds.width > 0) || !(bounds.height > 0)) return null;
  const area = screen.getDisplayMatching(bounds).workArea;
  const width = Math.min(bounds.width, area.width);
  const height = Math.min(bounds.height, area.height);
  const visible =
    bounds.x + width > area.x + 48 && bounds.x < area.x + area.width - 48 && bounds.y >= area.y - 8 && bounds.y < area.y + area.height - 48;
  return visible ? { x: bounds.x, y: bounds.y, width, height } : null;
}
