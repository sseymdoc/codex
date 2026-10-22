// Electron shell: runs the same loopback server as `pnpm start` and shows it in a window
// instead of a browser tab. Window behavior follows Claude Desktop 2.42304.0.0's main
// process (app.asar .vite/build/index.chunk-lzaSYO3Q.js, read-only): window-state.json,
// zoom 25%–500%, the title bar overlay, the hidden app menu, the context menu, the 600×600
// sign-in window, notifications, taskbar attention, keep-awake, the tray, Quick Entry and the
// jump list.

import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  net,
  Notification,
  powerMonitor,
  powerSaveBlocker,
  screen,
  session,
  shell,
  Tray,
} from "electron";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { crc32, deflateSync } from "node:zlib";
import { parseArgs } from "../server/bridge.mjs";
import { backendChannel, createBackendManager } from "./backend.mjs";
import { claudeFontCss } from "../server/claude-fonts.mjs";
import { serve } from "../server/serve.mjs";
import { createDesktopBrowser } from "./browser.mjs";
import { isBrowserServiceUrl } from "../server/browser-policy.mjs";

const THEMES = ["light", "dark", "system"];
// Windows / Linux: the page draws the 36px chrome bar ([data-wco], shell.css) and the system
// caption buttons float over its right end. ponytail: on macOS codex-ui keeps the native frame;
// Claude Desktop hides it (titleBarStyle hidden, trafficLightPosition round(22.5 × zoom − 6),
// the sidebar's title row dragging the window) — port that when codex-ui ships for macOS.
const customTitleBar = process.platform !== "darwin";
// shared-25 gl() / shared-19 RK(): the caption buttons' reserve in CSS px, ceil(140 / zoom)
// (Linux 120), 0 in full screen. The chrome bar goes by the overlay's env(titlebar-area-*) and
// falls back to this until it reports them (shared-19 zK).
const CAPTION_RESERVE = process.platform === "linux" ? 120 : 140;
// lzaSYO3Q V$n / oI: the default app window and the signed-out sign-in window.
const APP_SIZE = { width: 1200, height: 800 };
const AUTH_SIZE = { width: 600, height: 600 };
// lzaSYO3Q uLi() / EKn / bF(): zoom moves in Chromium levels of .5, factor = 1.2^level, 25%–500%.
const ZOOM_STEP = 0.5;
const MIN_LEVEL = Math.log(0.25) / Math.log(1.2);
const MAX_LEVEL = Math.log(5) / Math.log(1.2);
// Only our page asks for these: the microphone for voice mode, clipboard writes for copy buttons.
const PERMISSIONS = new Set(["media", "clipboard-sanitized-write"]);
// lzaSYO3Q Cze / I5r × L5r / R5r: the Windows Quick Entry hotkey (legacyQuickEntryEnabled, on by
// default), its transparent window (quick.html draws the card at the top of it), and the margin
// it keeps from the work area's right and bottom edges when the card grows.
const QUICK_SHORTCUT = "Ctrl+Alt+Space";
const QUICK_SIZE = { width: 606, height: 470 };
const QUICK_MARGIN = 30;
// lzaSYO3Q nqn() / $Kn: a global hotkey needs a modifier unless it is F1–F24.
const MODIFIERS = new Set(["Ctrl", "Control", "Alt", "Option", "AltGr", "Shift", "Super", "Meta", "Cmd", "Command", "CmdOrCtrl", "CommandOrControl"]);
// c71860c77 shortcut recorder: registration refused / accelerator not accepted.
const SHORTCUT_TAKEN = "其他应用已在使用此快捷键。请尝试其他组合键。";
const SHORTCUT_UNSUPPORTED = "不支持此快捷键组合。请尝试其他组合。";
// Jump-list tasks start a second instance with these; the running one picks them up.
const NEW_SESSION_ARG = "--new-session";
const OPEN_THREAD_ARG = "--open-thread";
const CWD_ARG = "--cwd";
// lzaSYO3Q Z4a() / R6a(): the login item passes this, and such a launch stays in the tray.
const STARTUP_ARG = "--startup";
// lzaSYO3Q O0n / k0n / j0n: jump-list labels end at 60 characters; 3 folders, 5 waiting sessions.
const JUMP_LABEL = 60;
const JUMP_FOLDERS = 3;
const JUMP_WAITING = 5;
// The installer's appId (package.json build.appId): its Start menu shortcut carries it, and
// Windows shows a packaged app's notifications under that id only.
const APP_ID = "dev.codex-ui.desktop";
// An unpackaged run starts Electron with the app path first; tasks and the login item repeat it.
const APP_ARGS = app.isPackaged ? [] : [path.resolve(process.argv[1])];
const ICON = path.join(import.meta.dirname, "icon.ico");
const PRELOAD = path.join(import.meta.dirname, "preload.cjs");
// The tray glyph, drawn below instead of shipped: the app icon's </> as strokes on a 16-unit grid.
const GLYPH = [
  [1.5, 8, 5, 4.5],
  [1.5, 8, 5, 11.5],
  [9.5, 2.5, 6.5, 13.5],
  [14.5, 8, 11, 4.5],
  [14.5, 8, 11, 11.5],
];

let win;
let quick;
let tray;
let boundShortcut = null;
let quitting = false;
let origin = "";
let state = {};
let saveTimer;
let backendManager;
let choosingBackend = false;
// The window opened as the 600×600 sign-in window; its bounds are not the app's.
let authMode = false;
// No window-state.json yet: the tray explains itself once.
let firstRun = false;
// A login launch started hidden; showing it applies the saved maximized state.
let maximizeOnShow = false;
// The page's report for the app menu (setMenuState).
let menuState = { session: false, sidebar: true, back: false, forward: false };
// The page's report (setWorking): how many sessions run a turn, the background commands still
// running as "session\tcommand" keys, and the power-save blocker held meanwhile.
let working = 0;
let shells = [];
let awakeBlocker = -1;
// The quit prompt (quitGuard()): the next quit skips it, it is up, what runs once it lets the
// quit go, and 等待 Codex's check.
let unguarded = false;
let asking = false;
let proceed = null;
let idleWait = null;
// Alt went down with nothing else pressed since (lzaSYO3Q QPi).
let altAlone = false;
// A jump-list launch of a closed app, run once the page listens (preload ready()).
let launch = parseLaunch(process.argv);
const notifications = new Map();
let browserBackendEnabled = false;
const browser = createDesktopBrowser({
  isExperimentalBackend: () => browserBackendEnabled,
  getWindow: () => win,
  getSettings: () => state.browser ?? {},
  saveSettings: (patch) => {
    const previous = state;
    saveState({ browser: { ...state.browser, ...patch } });
    try { flushState(true); } catch (error) { state = previous; throw error; }
  },
  isOwnOrigin: (raw) => isBrowserServiceUrl(raw, origin),
  emit: (event) => toPage("browser-state", event),
});


if (!app.requestSingleInstanceLock()) {
  app.exit();
} else {
  app.on("second-instance", (_event, argv) => runLaunch(parseLaunch(argv)));
  // CDtK409T: the last window gone (oj()) or a signal (wIn()) quits without the prompt.
  app.on("window-all-closed", quitNow);
  for (const signal of ["SIGINT", "SIGTERM", "SIGQUIT", "SIGHUP"]) process.on(signal, quitNow);
  app.on("before-quit", (event) => {
    if (!quitting) {
      if (unguarded) unguarded = false;
      else if (holdQuit(quitNow)) return event.preventDefault();
      event.preventDefault();
      quitting = true;
      backendManager?.close();
      void browser.close().finally(() => app.quit());
    }
    // Quick Entry is not closable (lzaSYO3Q quick-entry-cleanup) and would hold the quit up.
    if (quick && !quick.isDestroyed()) quick.destroy();
    flushState();
  });
  app.on("will-quit", () => globalShortcut.unregisterAll());
  start().catch((error) => {
    dialog.showErrorBox("Codex UI", error.message);
    app.exit(1);
  });
}

async function start() {
  firstRun = !existsSync(stateFile());
  state = readState();
  backendManager = createBackendManager({
    root: path.join(app.getPath("userData"), "backends"),
    channel: backendChannel(state.backendChannel),
    onChange: (status) => toPage("backend-state", status),
  });
  const backend = backendManager.startup();
  browserBackendEnabled = backend.channel !== "disabled";
  if (state.backendChannel !== backend.channel || state.experimentalBackend === true) {
    saveState({ backendChannel: backend.channel, experimentalBackend: false });
    flushState();
  }
  // Help → 故障排查 → 禁用硬件加速 takes effect here, before the app is ready.
  if (state.disableHardwareAcceleration) app.disableHardwareAcceleration();
  if (process.platform === "win32" && app.isPackaged) app.setAppUserModelId(APP_ID);
  // Before any window exists, so the first frame already has the user's theme.
  nativeTheme.themeSource = THEMES.includes(state.theme) ? state.theme : "system";
  // No menu bar, so not Electron's default menu and its accelerators (Ctrl+R, Ctrl+W,
  // Ctrl+Shift+I) either: the app menu only pops up (appMenu()), as Claude Desktop's hidden one.
  Menu.setApplicationMenu(null);
  const [server] = await Promise.all([
    serve({
      ...parseArgs([]),
      codex: backend.codex,
      experimentalBackend: browserBackendEnabled,
      toolAccessMode: desktopSettings().toolAccessMode,
      connectorSearch: desktopSettings().connectorSearch,
      localBuilds: false,
      // ChatGPT's transcription endpoint challenges Node's HTTP stack.
      transcribeFetch: net.fetch,
      // A shortcut starts us in the install folder; new chats default to home instead.
      cwd: process.env.INIT_CWD || homedir(),
      // localStorage (theme, drafts) is per origin, so keep clear of the browser version's 7477.
      port: 7478,
      browser,
    }),
    app.whenReady(),
  ]);
  app.on("quit", server.close);
  origin = new URL(server.url).origin;

  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    callback(PERMISSIONS.has(permission) && sameOrigin(details.requestingUrl ?? contents.getURL()));
  });

  authMode = state.signedIn === false;
  const hidden = process.argv.includes(STARTUP_ARG) && desktopSettings().menuBar;
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
  if (hidden) maximizeOnShow = !authMode && !!state.maximized;
  else {
    if (!authMode && state.maximized) win.maximize();
    win.once("ready-to-show", () => win.show());
  }
  for (const name of ["resize", "move", "maximize", "unmaximize", "enter-full-screen", "leave-full-screen"]) {
    win.on(name, rememberBounds);
  }
  win.on("enter-full-screen", syncOverlay);
  win.on("leave-full-screen", syncOverlay);
  win.on("focus", () => win.flashFrame(false));
  win.on("blur", () => (altAlone = false));
  // With the tray up, closing the window only hides it; the tray's 退出 quits. Without it the
  // app quits, the window staying until the quit prompt lets it go (CDtK409T main window
  // "close", menuBarEnabled → isi()).
  win.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    if (!desktopSettings().menuBar) return app.quit();
    if (!win.isFullScreen()) return win.hide();
    win.once("leave-full-screen", () => win.hide());
    win.setFullScreen(false);
  });
  // A page-initiated window.close() skips "close"; without the window there is nothing to show.
  win.on("closed", quitNow);
  // CDtK409T DIn(): the Windows session ending quits without the prompt.
  win.on("session-end", quitNow);

  const settings = desktopSettings();
  syncTray();
  syncJumpList({ waiting: [], folders: [], last: null });
  const error = bindQuick(settings.quickEntry ? settings.quickEntryShortcut : null);
  if (error) console.warn(`Quick Entry ${settings.quickEntryShortcut}: ${error}`);
  // Settings → 系统 / 通用 (c7357c32b menuBar / quickEntryShortcut, dockBounceEnabled,
  // ccKeepAwakeWhileWorking / ccKeepAwakeOnBattery, the login item).
  ipcMain.handle("browser:request", (event, request) => {
    if (!fromPage(event)) throw new Error("forbidden");
    return browser.request(request);
  });
  ipcMain.handle("desktop-settings:get", (event) => (fromPage(event) ? { ...desktopSettings(), runOnStartup: runsOnStartup() } : null));
  ipcMain.handle("desktop-settings:set", (event, patch) => (fromPage(event) ? setDesktopSettings(patch) : { ok: false, error: "forbidden" }));
  ipcMain.handle("backend:get", (event) => fromPage(event) ? backendManager.status() : null);
  ipcMain.handle("backend:log", (event) => fromPage(event) && existsSync(backendManager.logFile()) ? shell.openPath(backendManager.logFile()) : "暂无构建日志。");
  ipcMain.on("quick-entry", (event, text) => {
    if (fromQuick(event)) dismissQuick(text);
  });
  ipcMain.on("quick-skooch", (event, width, height) => {
    if (fromQuick(event)) skoochQuick(width, height);
  });

  // The page reports its theme setting (preload.cjs). Following it instead of the OS keeps
  // prefers-color-scheme, native menus and the caption buttons in step with the page.
  ipcMain.on("theme", (event, theme) => {
    if (!fromPage(event) || !THEMES.includes(theme)) return;
    nativeTheme.themeSource = theme;
    saveState({ theme });
  });
  // lzaSYO3Q: a theme change repaints the overlay, the tray icon and the window ground.
  nativeTheme.on("updated", () => {
    if (win.isDestroyed()) return;
    win.setBackgroundColor(background());
    syncOverlay();
    tray?.setImage(trayIcon());
  });
  // Something needs the user (an approval, a question) while the window is in the background
  // (lzaSYO3Q requestUserAttention: only with dockBounceEnabled, off by default).
  ipcMain.on("attention", (event, on) => {
    if (!fromPage(event)) return;
    if (!on) win.flashFrame(false);
    else if (desktopSettings().drawAttention && !win.isFocused()) win.flashFrame(true);
  });
  // The load-error overlay's 重启 Codex and Settings' 重启应用 ask first, as Claude's overlay
  // restart does (CDtK409T restartWithSessionGuard r2t).
  ipcMain.on("relaunch", (event) => {
    if (!fromPage(event)) return;
    quitGuard(() => {
      app.relaunch();
      quitNow();
    });
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
  ipcMain.on("page-ready", (event) => {
    if (!fromPage(event) || !launch) return;
    runLaunch(launch);
    launch = null;
  });
  ipcMain.on("menu-popup", (event) => {
    if (fromPage(event)) popupMenu(false);
  });
  ipcMain.on("menu-state", (event, next) => {
    if (!fromPage(event) || !next || typeof next !== "object") return;
    menuState = { session: !!next.session, sidebar: !!next.sidebar, back: !!next.back, forward: !!next.forward };
  });
  ipcMain.on("working", (event, sessions, keys) => {
    if (!fromPage(event)) return;
    working = Number.isInteger(sessions) && sessions > 0 ? sessions : 0;
    shells = Array.isArray(keys) ? keys.filter((key) => typeof key === "string") : [];
    syncKeepAwake();
    idleWait?.();
  });
  powerMonitor.on("on-battery", syncKeepAwake);
  powerMonitor.on("on-ac", syncKeepAwake);
  ipcMain.on("notify", (event, payload) => {
    if (fromPage(event)) notify(payload);
  });
  ipcMain.on("notification-close", (event, tag) => {
    if (!fromPage(event)) return;
    notifications.get(tag)?.close();
    notifications.delete(tag);
  });
  ipcMain.on("jump-list", (event, list) => {
    if (fromPage(event)) syncJumpList(list);
  });

  const contents = win.webContents;
  contents.on("before-input-event", (event, input) => {
    // lzaSYO3Q QPi(): Alt pressed and released with nothing in between opens the menu, as F10 does.
    if (input.key === "Alt") {
      const plain = !input.control && !input.shift && !input.meta;
      if (input.type === "keyDown") {
        if (!input.isAutoRepeat) altAlone = plain;
      } else if (input.type === "keyUp") {
        if (altAlone && plain) popupMenu(true);
        altAlone = false;
      }
      return;
    }
    if (input.type !== "keyDown") return;
    altAlone = false;
    if (input.key === "F12" && !app.isPackaged) {
      contents.toggleDevTools();
      return event.preventDefault();
    }
    const key = input.key.toLowerCase();
    if (!input.control && !input.alt && !input.meta && !input.shift) {
      // View → 全屏 / 重新加载 and the hidden "Open Application Menu" (lzaSYO3Q XIi).
      if (key === "f11") toggleFullScreen();
      else if (key === "f5") contents.reload();
      else if (key === "f10") popupMenu(true);
      else return;
      return event.preventDefault();
    }
    if (!input.control || input.alt || input.meta) return;
    // File → 关闭会话 (Ctrl+W while a session is open; the page does it) / 关闭窗口 (lzaSYO3Q $Ti).
    // View → zoom (lzaSYO3Q JIi): Ctrl+= / Ctrl+Plus / Ctrl+numadd, Ctrl+- / Ctrl+numsub, Ctrl+0 /
    // Ctrl+num0. Ctrl+Shift+- is not one of them.
    if (key === "w") {
      if (menuState.session && !input.shift) toPage("menu-command", "closeSession");
      else win.close();
    } else if (key === "=" || key === "+") zoomBy(ZOOM_STEP);
    else if (key === "-") zoomBy(-ZOOM_STEP);
    else if (key === "0" && !input.shift) setZoomLevel(0);
    else return;
    event.preventDefault();
  });
  contents.on("before-mouse-event", (_event, mouse) => {
    if (mouse.type === "mouseDown") altAlone = false;
  });
  // No "zoom-changed" listener: Claude Desktop has none (2.42304 and 3.1623), so Ctrl + wheel and a
  // touchpad pinch that arrives as one leave the app's zoom alone; only the keys above and the
  // View menu zoom.
  // The caption reserve and zoom factor are written into the page after every load.
  contents.on("did-finish-load", syncOverlay);

  // Links open in the system browser; anything but http(s) stays closed, and so do the app's own
  // pages, which the browser could only answer with 未授权 (the token lives in this session).
  contents.on("did-start-loading", () => browser.hide());
  contents.setWindowOpenHandler(({ url }) => {
    if (!browser.openLink(url)) openExternal(url);
    return { action: "deny" };
  });
  contents.on("will-navigate", (event, url) => {
    if (sameOrigin(url)) return;
    event.preventDefault();
    if (!browser.openLink(url)) openExternal(url);
  });
  contents.on("context-menu", (_event, params) => contextMenu(params).popup({ window: win }));

  await win.loadURL(server.url);
  backendManager.resume();
}

// ---------------------------------------------------------------------------
// The app menu (lzaSYO3Q dLi: 文件 / 编辑 / 视图 / 转到 / 帮助, official zh-Hans labels) with
// the items Codex has. It is never a menu bar: the chrome bar's 菜单 button pops it at the
// pointer, Alt or F10 from the keyboard. Every accelerator is display-only: the page owns its
// keys (useShortcuts, the find bar, Alt+← / Alt+→) and before-input-event takes the shell's own.

function appMenu() {
  const page = (command) => () => toPage("menu-command", command);
  const key = (accelerator) => ({ accelerator, registerAccelerator: false });
  const zoom = win.webContents.getZoomLevel();
  const close = () => win.close();
  return Menu.buildFromTemplate([
    {
      label: "文件",
      submenu: [
        { label: "新建会话", ...key("Ctrl+N"), click: page("new") },
        { type: "separator" },
        { label: "设置", ...key("Ctrl+,"), click: page("settings") },
        { type: "separator" },
        ...(menuState.session
          ? [
              { label: "关闭会话", ...key("Ctrl+W"), click: page("closeSession") },
              { label: "关闭窗口", ...key("Ctrl+Shift+W"), click: close },
            ]
          : [{ label: "关闭窗口", ...key("Ctrl+W"), click: close }]),
        { type: "separator" },
        { label: "退出", click: () => app.quit() },
      ],
    },
    {
      label: "编辑",
      submenu: [
        { label: "撤销", role: "undo", ...key("Ctrl+Z") },
        { label: "重做", role: "redo", ...key("Ctrl+Y") },
        { type: "separator" },
        { label: "剪切", role: "cut", ...key("Ctrl+X") },
        { label: "复制", role: "copy", ...key("Ctrl+C") },
        { label: "粘贴", role: "paste", ...key("Ctrl+V") },
        { label: "删除", role: "delete" },
        { label: "全选", role: "selectAll", ...key("Ctrl+A") },
        { type: "separator" },
        { label: "查找…", ...key("Ctrl+F"), click: page("find") },
        { label: "查找下一个", ...key("F3"), click: page("findNext") },
        { label: "查找上一个", ...key("Shift+F3"), click: page("findPrevious") },
      ],
    },
    {
      label: "视图",
      submenu: [
        { label: "命令面板…", ...key("Ctrl+K"), click: page("palette") },
        { label: "侧边栏", type: "checkbox", checked: menuState.sidebar, ...key("Ctrl+B"), click: page("sidebar") },
        { type: "separator" },
        { label: "终端", ...key("Ctrl+`"), click: page("terminal") },
        { label: "更改", ...key("Ctrl+Shift+D"), click: page("diff") },
        { label: "浏览器", ...key("Ctrl+Shift+B"), click: page("browser") },
        { type: "separator" },
        { label: "实际大小", ...key("Ctrl+0"), enabled: zoom !== 0, click: () => setZoomLevel(0) },
        { label: "放大", ...key("Ctrl+Plus"), enabled: zoom < MAX_LEVEL, click: () => zoomBy(ZOOM_STEP) },
        { label: "缩小", ...key("Ctrl+-"), enabled: zoom > MIN_LEVEL, click: () => zoomBy(-ZOOM_STEP) },
        { type: "separator" },
        { label: "全屏", type: "checkbox", checked: win.isFullScreen(), ...key("F11"), click: toggleFullScreen },
        { type: "separator" },
        { label: "重新加载", ...key("F5"), click: () => win.webContents.reload() },
      ],
    },
    {
      label: "转到",
      submenu: [
        { label: "返回", ...key("Alt+Left"), enabled: menuState.back, click: page("back") },
        { label: "前进", ...key("Alt+Right"), enabled: menuState.forward, click: page("forward") },
        { type: "separator" },
        { label: "上一个会话", ...key("Ctrl+Shift+Tab"), click: page("previousSession") },
        { label: "下一个会话", ...key("Ctrl+Tab"), click: page("nextSession") },
        { type: "separator" },
        { label: "搜索…", ...key("Ctrl+Shift+K"), click: page("search") },
      ],
    },
    {
      label: "帮助",
      submenu: [
        { label: "键盘快捷键", ...key("Ctrl+/"), click: page("shortcuts") },
        { type: "separator" },
        {
          label: "故障排查",
          submenu: [
            { label: "在文件资源管理器中显示日志", click: showLogs },
            { type: "separator" },
            { label: "禁用硬件加速", type: "checkbox", checked: !!state.disableHardwareAcceleration, click: (item) => void setHardwareAcceleration(item.checked) },
          ],
        },
        { type: "separator" },
        { label: "关于 Codex", click: page("about") },
      ],
    },
  ]);
}

/** lzaSYO3Q ZPi(): at the pointer, or from the keyboard 12 × 38 (× zoom) in from the window's corner. */
function popupMenu(keyboard) {
  if (!win || win.isDestroyed()) return;
  const zoom = win.webContents.getZoomFactor();
  appMenu().popup({ window: win, ...(keyboard && { x: Math.round(12 * zoom), y: Math.round(38 * zoom), sourceType: "keyboard" }) });
}

function toggleFullScreen() {
  win.setFullScreen(!win.isFullScreen());
}

// Help → 故障排查 → 在文件资源管理器中显示日志: codex's own log folder.
function showLogs() {
  const home = process.env.CODEX_HOME || path.join(homedir(), ".codex");
  const logs = path.join(home, "log");
  void shell.openPath(existsSync(logs) ? logs : home);
}

// Help → 故障排查 → 禁用硬件加速: applies from the next start, which is offered right away.
async function setHardwareAcceleration(disabled) {
  saveState({ disableHardwareAcceleration: disabled });
  flushState();
  const { response } = await dialog.showMessageBox({ type: "info", message: "需要重启", detail: "请重启 Codex 以应用更改。", buttons: ["稍后", "立即重启"], defaultId: 1 });
  if (response !== 1) return;
  // CDtK409T jA(): this restart does not ask about running work.
  app.relaunch();
  quitNow();
}

/**
 * The page's context menu (lzaSYO3Q HU), groups apart: spelling suggestions, 添加到词典, link,
 * image, 撤销 / 重做 while editing, then 剪切 / 复制 / 粘贴 (复制 alone outside fields), 全选.
 */
function contextMenu(params) {
  const flags = params.editFlags;
  const groups = [];
  if (params.dictionarySuggestions.length) {
    groups.push(params.dictionarySuggestions.map((word) => ({ label: word, click: () => win.webContents.replaceMisspelling(word) })));
  }
  if (params.misspelledWord) {
    groups.push([{ label: "添加到词典", click: () => win.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord) }]);
  }
  if (params.linkURL) {
    groups.push([
      ...(openable(params.linkURL) ? [{ label: "在默认浏览器中打开链接", click: () => shell.openExternal(params.linkURL) }] : []),
      { label: "复制链接地址", click: () => clipboard.writeText(params.linkURL) },
    ]);
  }
  if (params.hasImageContents) {
    groups.push([
      { label: "复制图片", click: () => win.webContents.copyImageAt(params.x, params.y) },
      ...(params.srcURL ? [{ label: "复制图片地址", click: () => clipboard.writeText(params.srcURL) }] : []),
    ]);
  }
  if (params.isEditable && (flags.canUndo || flags.canRedo)) {
    groups.push([
      { label: "撤销", role: "undo", accelerator: "Ctrl+Z", enabled: flags.canUndo },
      { label: "重做", role: "redo", accelerator: "Ctrl+Y", enabled: flags.canRedo },
    ]);
  }
  const copy = { label: "复制", role: "copy", accelerator: "Ctrl+C", enabled: flags.canCopy };
  groups.push(
    params.isEditable
      ? [{ label: "剪切", role: "cut", accelerator: "Ctrl+X", enabled: flags.canCut }, copy, { label: "粘贴", role: "paste", accelerator: "Ctrl+V", enabled: flags.canPaste }]
      : [copy],
  );
  if (flags.canSelectAll) groups.push([{ label: "全选", role: "selectAll", accelerator: "Ctrl+A" }]);
  return Menu.buildFromTemplate(groups.flatMap((group, index) => (index ? [{ type: "separator" }, ...group] : group)));
}

/** http(s) without credentials, and not our own page. */
function openable(url) {
  try {
    const parsed = new URL(url);
    return /^https?:$/.test(parsed.protocol) && !parsed.username && !parsed.password && parsed.origin !== origin;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Desktop settings, kept in window-state.json (the login item lives with the OS): the tray
// (menuBarEnabled), the Quick Entry hotkey and its accelerator, taskbar attention, keep-awake.
// A hotkey change binds the new key first and keeps the old one if refused.

function desktopSettings() {
  return {
    menuBar: state.menuBar !== false,
    quickEntry: state.quickEntry !== false,
    quickEntryShortcut: typeof state.quickEntryShortcut === "string" ? state.quickEntryShortcut : QUICK_SHORTCUT,
    drawAttention: state.drawAttention === true,
    keepAwake: state.keepAwake !== false,
    keepAwakeOnBattery: state.keepAwakeOnBattery !== false,
    backendChannel: backendManager?.status().channel ?? backendChannel(state.backendChannel),
    toolAccessMode: state.toolAccessMode === "all" ? "all" : "on-demand",
    connectorSearch: state.connectorSearch !== false,
  };
}

async function setDesktopSettings(patch) {
  if (patch?.backendChannel !== undefined) {
    try {
      if (choosingBackend) throw new Error("后端选择尚未完成。");
      if (patch.backendChannel === "custom") {
        choosingBackend = true;
        try {
          const result = await dialog.showOpenDialog(win, {
            title: "选择自定义后端包", properties: ["openFile"],
            filters: [{ name: "后端包（tar.gz）", extensions: ["gz"] }],
          });
          if (result.canceled || !result.filePaths.length) return { ok: true };
          await backendManager.installCustom(result.filePaths[0]);
        } finally { choosingBackend = false; }
      } else await backendManager.select(patch.backendChannel);
    }
    catch (error) { return { ok: false, error: error.message }; }
  }
  const current = desktopSettings();
  const next = { ...current };
  for (const name of ["menuBar", "quickEntry", "drawAttention", "keepAwake", "keepAwakeOnBattery", "connectorSearch"]) {
    if (typeof patch?.[name] === "boolean") next[name] = patch[name];
  }
  if (typeof patch?.quickEntryShortcut === "string") next.quickEntryShortcut = patch.quickEntryShortcut.trim();
  if (["on-demand", "all"].includes(patch?.toolAccessMode)) next.toolAccessMode = patch.toolAccessMode;
  if (next.quickEntry !== current.quickEntry || next.quickEntryShortcut !== current.quickEntryShortcut) {
    const error = bindQuick(next.quickEntry ? next.quickEntryShortcut : null);
    if (error) return { ok: false, error };
  }
  if (typeof patch?.runOnStartup === "boolean" && process.platform !== "linux") {
    app.setLoginItemSettings({ openAtLogin: patch.runOnStartup, enabled: patch.runOnStartup, ...loginItem() });
  }
  saveState(next);
  syncTray();
  syncKeepAwake();
  if (!next.drawAttention && !win.isDestroyed()) win.flashFrame(false);
  return { ok: true };
}

// lzaSYO3Q Z4a(): the login item launches the app with --startup.
function loginItem() {
  return { path: process.execPath, args: [...APP_ARGS, STARTUP_ARG].map(quote) };
}

function runsOnStartup() {
  return process.platform !== "linux" && app.getLoginItemSettings(loginItem()).openAtLogin;
}

// lzaSYO3Q ccKeepAwakeWhileWorking / ccKeepAwakeOnBattery: idle sleep is held off while a turn
// runs (prevent-app-suspension; a closed lid still sleeps), on battery too unless that is off.
// ponytail: lets go the moment work ends, where Claude Desktop waits a little; add a grace if
// chained turns ever let the machine doze between them.
function syncKeepAwake() {
  const { keepAwake, keepAwakeOnBattery } = desktopSettings();
  const hold = working > 0 && keepAwake && (keepAwakeOnBattery || !powerMonitor.isOnBatteryPower());
  if (hold && awakeBlocker === -1) awakeBlocker = powerSaveBlocker.start("prevent-app-suspension");
  else if (!hold && awakeBlocker !== -1) {
    powerSaveBlocker.stop(awakeBlocker);
    awakeBlocker = -1;
  }
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
    return globalShortcut.register(accelerator, onQuickHotkey) ? null : SHORTCUT_TAKEN;
  } catch {
    return SHORTCUT_UNSUPPORTED;
  }
}

// ---------------------------------------------------------------------------
// The quit prompt (3.1623.4 index.chunk-CDtK409T.js installQuitSessionGuard Z0t, Q0t, o2t and
// scheduleRestartWhenIdle K0t): 退出 from the app menu or the tray, closing the window without
// the tray and the page's restart ask first while a session runs a turn or background commands
// still run. 仍要退出 goes ahead; 等待 Codex goes once no turn runs and no background command
// has started since the prompt; 取消 stays, an earlier 等待 Codex included. Claude's copy in its
// zh-Hans (resources/zh-Hans.json), Claude read as Codex.

/** Quits without the prompt (CDtK409T e2t / oj()). */
function quitNow() {
  unguarded = true;
  app.quit();
}

/** CDtK409T Q0t(): with work running, asks (one prompt at a time) and runs `next` only if allowed; true when held. */
function holdQuit(next) {
  if (!working && !shells.length) return false;
  proceed = next;
  if (!asking) void askQuit();
  return true;
}

/** CDtK409T i2t() (restartWithSessionGuard): `next` now, or once the prompt allows it. */
function quitGuard(next) {
  if (!holdQuit(next)) next();
}

/** CDtK409T o2t(): 等待 Codex only while a turn runs, the default button the second one. */
async function askQuit() {
  const busy = working > 0;
  const shellSessions = new Set(shells.map((key) => key.split("\t")[0])).size;
  const open = new Set(shells);
  const options = {
    type: "warning",
    message: busy ? "Codex 仍在处理中" : "后台命令仍在运行",
    detail: [
      busy && `Codex 正在 ${working} 个会话中工作。现在退出将中断该工作。`,
      shellSessions > 0 && `${shellSessions} 个会话中有后台命令正在运行。${busy ? "即使您等待 Codex，退出也会停止这些命令。" : "退出将停止这些命令。"}`,
    ]
      .filter(Boolean)
      .join("\n\n"),
    buttons: ["仍要退出", ...(busy ? ["等待 Codex"] : []), "取消"],
    defaultId: 1,
    cancelId: busy ? 2 : 1,
    noLink: true,
  };
  const parent = win && !win.isDestroyed() && win.isVisible() ? win : undefined;
  asking = true;
  let response;
  try {
    ({ response } = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options));
  } finally {
    asking = false;
  }
  const next = proceed;
  proceed = null;
  idleWait = null;
  if (response === 0) return next();
  if (response !== 1 || !busy) return;
  // K0t: the commands the prompt named may go on; one started since keeps the wait.
  idleWait = () => {
    if (working || shells.some((key) => !open.has(key))) return;
    idleWait = null;
    next();
  };
  idleWait();
}

// ---------------------------------------------------------------------------
// Notifications (lzaSYO3Q rH.show()). The page decides when one is due; a click brings the
// window up on that session, 允许一次 answers the request without it.

function notify(payload) {
  if (!payload || typeof payload !== "object" || !Notification.isSupported()) return;
  const { tag, title, body, threadId, allowOnce, silent, urgency } = payload;
  if (typeof tag !== "string" || typeof title !== "string" || typeof body !== "string" || !validId(threadId)) return;
  const request = typeof allowOnce === "string" || typeof allowOnce === "number" ? allowOnce : null;
  notifications.get(tag)?.close();
  const notification = new Notification({
    title: title.slice(0, 200),
    body: body.slice(0, 1000),
    silent: !!silent,
    urgency: urgency === "low" ? "low" : "normal",
    icon: ICON,
    actions: request === null ? [] : [{ type: "button", text: "允许一次" }],
  });
  const forget = () => notifications.get(tag) === notification && notifications.delete(tag);
  notification.on("click", () => {
    forget();
    runLaunch({ thread: threadId });
  });
  notification.on("action", (details) => {
    forget();
    if (request !== null && details.actionIndex === 0) toPage("notification-action", { action: "allow_once", requestId: request });
  });
  notification.on("close", forget);
  notifications.set(tag, notification);
  notification.show();
}

// ---------------------------------------------------------------------------
// The tray (lzaSYO3Q u8a() / mLi() / l8a()): the app name as tooltip, a click opens Quick Entry,
// the menu is 显示应用 · 退出 (the plan-usage rows between them sit behind a server flag), the
// icon follows the theme, and the very first launch explains the tray once.

function syncTray() {
  if (!desktopSettings().menuBar) {
    tray?.destroy();
    tray = undefined;
    return;
  }
  if (tray) return;
  tray = new Tray(trayIcon());
  tray.setToolTip("Codex");
  tray.setContextMenu(
    Menu.buildFromTemplate([{ label: "显示应用", click: showMain }, { type: "separator" }, { label: "退出", click: () => app.quit() }]),
  );
  tray.on("click", toggleQuick);
  if (!firstRun || process.platform !== "win32") return;
  firstRun = false;
  tray.displayBalloon({
    iconType: "info",
    title: "Codex 在系统托盘中运行",
    content: "即使您关闭窗口，Codex 仍会在后台运行。单击系统托盘中的 Codex 图标可重新打开应用，右键单击则可退出。",
  });
}

/** Dark strokes for a light theme, light ones for a dark theme, at 1× and 2×. */
function trayIcon() {
  const rgb = nativeTheme.shouldUseDarkColors ? [255, 255, 255] : [11, 11, 11];
  const image = nativeImage.createFromBuffer(glyphPng(16, rgb), { scaleFactor: 1 });
  image.addRepresentation({ scaleFactor: 2, buffer: glyphPng(32, rgb) });
  return image;
}

/** GLYPH as anti-aliased 1.8-unit strokes with round ends, encoded as a `size`-pixel RGBA PNG. */
function glyphPng(size, [r, g, b]) {
  const scale = size / 16;
  const row = size * 4 + 1;
  const pixels = Buffer.alloc(row * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = (x + 0.5) / scale;
      const py = (y + 0.5) / scale;
      let distance = Infinity;
      for (const [x1, y1, x2, y2] of GLYPH) {
        const dx = x2 - x1;
        const dy = y2 - y1;
        const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
        distance = Math.min(distance, Math.hypot(px - x1 - t * dx, py - y1 - t * dy));
      }
      const alpha = Math.max(0, Math.min(1, (0.9 - distance) * scale + 0.5));
      pixels.set([r, g, b, Math.round(alpha * 255)], y * row + 1 + x * 4);
    }
  }
  const chunk = (type, data) => {
    const out = Buffer.alloc(data.length + 12);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, "latin1");
    data.copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, data.length + 8)), data.length + 8);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // 8 bits per channel
  header[9] = 6; // RGBA
  return Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), chunk("IHDR", header), chunk("IDAT", deflateSync(pixels)), chunk("IEND", Buffer.alloc(0))]);
}

// lzaSYO3Q Dq(): restore, focus or show the main window.
function showMain() {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  else if (!win.isVisible()) {
    if (maximizeOnShow) win.maximize();
    maximizeOnShow = false;
    win.show();
  }
  win.focus();
}

function toPage(channel, ...args) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
}

/** Quick Entry, the jump list: the page starts a session (in `cwd` if given), sending `prompt` when there is one. */
function newSession(prompt, cwd = "") {
  showMain();
  toPage("new-session", prompt, cwd);
}

// ---------------------------------------------------------------------------
// The jump list (lzaSYO3Q z0n / B0n): 需要您输入 (up to 5 sessions waiting on the user, oldest
// first) and 新建 Code 会话 (the 3 latest folders) as custom categories, then the tasks 新建 Code
// 会话 and 继续“{title}”. Entries the user removed stay away; if Windows refuses custom
// categories the tasks still go in. The page sends the lists; null (signed out) clears it.

function syncJumpList(list) {
  if (process.platform !== "win32") return;
  if (list === null) return void app.setJumpList(null);
  if (!list || typeof list !== "object") return;
  const removed = new Set(app.getJumpListSettings().removedItems.map((item) => item.args));
  const task = (title, args) => ({
    type: "task",
    title,
    program: process.execPath,
    args: [...APP_ARGS, ...args].map(quote).join(" "),
    iconPath: process.execPath,
    iconIndex: 0,
  });
  const kept = (items) => items.filter((item) => !removed.has(item.args));
  const sessions = (entries) => (Array.isArray(entries) ? entries.filter((entry) => validId(entry?.id)) : []);
  const waiting = kept(sessions(list.waiting).slice(0, JUMP_WAITING).map((entry) => task(label(entry.title), [`${OPEN_THREAD_ARG}=${entry.id}`])));
  const folders = kept(
    (Array.isArray(list.folders) ? list.folders.filter((folder) => folder && validPath(folder)) : [])
      .slice(0, JUMP_FOLDERS)
      .map((folder) => task(label(path.basename(folder) || folder), [NEW_SESSION_ARG, `${CWD_ARG}=${folder}`])),
  );
  const [last] = sessions(list.last ? [list.last] : []);
  const tasks = {
    type: "tasks",
    items: kept([task("新建 Code 会话", [NEW_SESSION_ARG]), ...(last ? [task(`继续“${label(last.title)}”`, [`${OPEN_THREAD_ARG}=${last.id}`])] : [])]),
  };
  const categories = [
    ...(waiting.length ? [{ type: "custom", name: "需要您输入", items: waiting }] : []),
    ...(folders.length ? [{ type: "custom", name: "新建 Code 会话", items: folders }] : []),
    tasks,
  ];
  if (app.setJumpList(categories) === "customCategoryAccessDeniedError") app.setJumpList([tasks]);
}

/** --open-thread=<id>, or --new-session [--cwd=<folder>], from a jump-list task; null for neither. */
function parseLaunch(argv) {
  const value = (name) => argv.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
  const thread = value(OPEN_THREAD_ARG);
  if (thread !== undefined) return validId(thread) ? { thread } : null;
  if (!argv.includes(NEW_SESSION_ARG)) return null;
  const cwd = value(CWD_ARG) ?? "";
  return { cwd: validPath(cwd) ? cwd : "" };
}

/** A second launch, a notification click or a jump-list launch: the window comes up on what was asked. */
function runLaunch(request) {
  if (request?.thread) {
    showMain();
    toPage("open-thread", request.thread);
  } else if (request) newSession("", request.cwd);
  else showMain();
}

function validId(value) {
  return typeof value === "string" && /^[\w.:-]{1,128}$/.test(value);
}

// Jump-list arguments are quoted, so a path may hold neither a quote nor a control character.
function validPath(value) {
  return typeof value === "string" && value.length < 1024 && !/["\u0000-\u001f]/.test(value);
}

/** Windows command-line quoting; trailing backslashes double so they do not escape the quote. */
function quote(arg) {
  return `"${arg.replace(/(\\+)$/, "$1$1")}"`;
}

/** At most 60 characters (graphemes by code point), single line. */
function label(text) {
  const chars = Array.from(String(text ?? "").replace(/[\u0000-\u001f]+/g, " ").trim());
  return chars.length > JUMP_LABEL ? `${chars.slice(0, JUMP_LABEL - 1).join("")}…` : chars.join("");
}

// ---------------------------------------------------------------------------
// Quick Entry (lzaSYO3Q V5r / K5r): a transparent, frameless, always-on-top 606 × 470 window at
// its last position (else centred on the primary display). The hotkey or a tray click toggles
// it; losing focus, Esc or a click beside the card dismisses it. Signed out, the main window
// opens instead; in full screen the hotkey starts a session in the main window.

function onQuickHotkey() {
  if (win && !win.isDestroyed() && win.isFullScreen()) newSession("");
  else toggleQuick();
}

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
    titleBarStyle: "hidden",
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    // Alt+F4 must not destroy it; before-quit does (lzaSYO3Q closable: false).
    closable: false,
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
  // Claude's quick window sets its text in anthropic-sans (quick_window main-CiwjW8Wn.css): this
  // file:// page takes the main window's @font-face rules, pointed at the loopback server.
  w.webContents.on("dom-ready", () => void w.webContents.insertCSS(claudeFontCss(origin)));
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

// lzaSYO3Q requestSkooch: a card grown past the work area's bottom or right edge moves the
// window back in, 30px clear of it.
function skoochQuick(width, height) {
  if (!(width > 0) || !(height > 0)) return;
  const [x, y] = quick.getPosition();
  const area = screen.getDisplayNearestPoint({ x, y }).workArea;
  const bottom = area.y + area.height;
  const right = area.x + area.width;
  const nextX = x + width <= right ? x : right - width - QUICK_MARGIN;
  const nextY = y + height <= bottom ? y : bottom - height - QUICK_MARGIN;
  if (nextX !== x || nextY !== y) quick.setPosition(Math.round(nextX), Math.round(nextY));
}

// lzaSYO3Q K5r(): more than two characters start a session in the main window; less just closes.
function dismissQuick(text) {
  if (quick && !quick.isDestroyed()) quick.hide();
  if (typeof text === "string" && text.trim().length > 2) newSession(text);
}

function fromPage(event) {
  return !!win && !win.isDestroyed() && event.sender === win.webContents;
}

function fromQuick(event) {
  return !!quick && !quick.isDestroyed() && event.sender === quick.webContents;
}

function sameOrigin(url) {
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}

function openExternal(url) {
  if (openable(url)) shell.openExternal(url);
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

/** The overlay, and in the page the caption reserve (0 in full screen) and the zoom factor the find bar undoes. */
function syncOverlay() {
  if (!win || win.isDestroyed()) return;
  const zoom = win.webContents.getZoomFactor();
  let script = `document.documentElement.style.setProperty("--zoom-factor", "${zoom}");`;
  if (customTitleBar) {
    win.setTitleBarOverlay(overlay());
    const reserve = win.isFullScreen() ? 0 : Math.ceil(CAPTION_RESERVE / zoom);
    script += `document.documentElement.style.setProperty("--df-chrome-bar-caption-reserve", "${reserve}px");`;
  }
  win.webContents.executeJavaScript(script, true).catch(() => {});
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
// window-state.json (lzaSYO3Q Yxe): bounds, maximized and whether the last session ended signed
// in; codex-ui also keeps the zoom level, theme and the desktop settings here (Claude Desktop's
// SPA remembers the zoom in localStorage, desktop-frame.mainViewZoomFactor.v1). Writes are
// debounced 1s (Xxe) and atomic.

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

function flushState(reportError = false) {
  clearTimeout(saveTimer);
  try {
    const file = stateFile();
    writeFileSync(`${file}.tmp`, JSON.stringify(state));
    renameSync(`${file}.tmp`, file);
  } catch (error) {
    if (reportError === true) throw new Error(`无法保存浏览器设置：${error.message}`);
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
