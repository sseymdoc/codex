// Apply the saved appearance before first paint so nothing flashes: theme, reduced motion, the
// new-session background animation, the chat text size and the transcript width (Settings →
// 常规 writes the same keys and attributes afterwards).
try {
  const root = document.documentElement;
  const theme = localStorage.getItem("codex-ui:theme") || "system";
  // The desktop shell (desktop/preload.cjs) themes its title bar to match.
  window.codexDesktop?.setTheme(theme);
  root.classList.toggle("dark", theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches));
  if (localStorage.getItem("codex-ui:motion") === "reduce" || matchMedia("(prefers-reduced-motion: reduce)").matches) root.dataset.reduceMotion = "true";
  // "system" (the default) is left unmarked.
  const background = localStorage.getItem("codex-ui:bg-anim");
  if (background === "enabled" || background === "disabled") root.dataset.bgAnim = background;
  const size = localStorage.getItem("codex-ui:chat-text-size");
  root.dataset.chatTextSize = size === "s" || size === "l" ? size : "m";
  // s 768 (the default) · m 960 · l 1280.
  const width = localStorage.getItem("codex-ui:transcript-width");
  root.dataset.transcriptWidth = width === "m" || width === "l" ? width : "s";
} catch {}

// Windows desktop shell: with the window-controls overlay on, the page draws the 36px chrome bar.
try {
  const overlay = navigator.windowControlsOverlay;
  const sync = () => {
    if (overlay?.visible) document.documentElement.dataset.wco = "";
    else delete document.documentElement.dataset.wco;
  };
  sync();
  overlay?.addEventListener("geometrychange", sync);
} catch {}
