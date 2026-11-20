// Claude Desktop's @font-face rules (server/claude-fonts.mjs), linked here so Vite leaves the
// runtime-only URL alone.
try {
  const fonts = document.createElement("link");
  fonts.rel = "stylesheet";
  fonts.href = "/claude-fonts.css";
  fonts.setAttribute("blocking", "render");
  document.head.append(fonts);
} catch {}

// Renamed from Codex UI: its saved settings carry over once, before anything reads them.
try {
  for (const key of Object.keys(localStorage)) {
    if (!key.startsWith("codex-ui:")) continue;
    const next = `better-codex:${key.slice("codex-ui:".length)}`;
    if (localStorage.getItem(next) === null) localStorage.setItem(next, localStorage.getItem(key));
    localStorage.removeItem(key);
  }
} catch {}

// Apply the saved appearance before first paint so nothing flashes: theme, reduced motion, the
// new-session background animation, the chat text size, the transcript width and the interface
// font (Settings → 常规 and Codex → 外观 write the same keys and attributes afterwards).
try {
  const root = document.documentElement;
  // Interface font (shared-52 cm()): System and OpenDyslexic set data-font="system" and their own
  // marker; Anthropic Sans (the default) is left unmarked.
  const font = localStorage.getItem("better-codex:interface-font");
  if (font === "system" || font === "dyslexic") {
    root.dataset.font = "system";
    root.setAttribute(font === "system" ? "data-system-font" : "data-dyslexic-font", "");
    // The system face hangs on macOS only, as Settings.tsx applyInterfaceFont() marks it (platformName()).
    const agent = navigator.userAgent;
    if (font === "system" && !agent.includes("Windows") && agent.includes("Mac")) root.setAttribute("data-system-hang", "");
  }
  const theme = localStorage.getItem("better-codex:theme") || "system";
  // The desktop shell (desktop/preload.cjs) themes its title bar to match.
  window.codexDesktop?.setTheme(theme);
  const dark = theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  root.classList.toggle("dark", dark);
  // Claude's frame rules (claude.generated.css) read the mode from [data-mode].
  root.dataset.mode = dark ? "dark" : "light";
  if (localStorage.getItem("better-codex:motion") === "reduce" || matchMedia("(prefers-reduced-motion: reduce)").matches) root.dataset.reduceMotion = "true";
  // "system" (the default) is left unmarked.
  const background = localStorage.getItem("better-codex:bg-anim");
  if (background === "enabled" || background === "disabled") root.dataset.bgAnim = background;
  const size = localStorage.getItem("better-codex:chat-text-size");
  root.dataset.chatTextSize = size === "s" || size === "l" ? size : "m";
  // s 768 (the default) · m 960 · l 1280.
  const width = localStorage.getItem("better-codex:transcript-width");
  root.dataset.transcriptWidth = width === "m" || width === "l" ? width : "s";
} catch {}

// Windows desktop shell: with the window-controls overlay on, the page draws the 36px chrome bar.
// Only the Electron shell qualifies (shared-22 VN(): data-wco needs isClaudeApp); a browser that
// happens to report an overlay keeps the sidebar's own title row.
try {
  const overlay = window.codexDesktop ? navigator.windowControlsOverlay : undefined;
  const sync = () => {
    if (overlay?.visible) document.documentElement.dataset.wco = "";
    else delete document.documentElement.dataset.wco;
  };
  sync();
  overlay?.addEventListener("geometrychange", sync);
} catch {}
