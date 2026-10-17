// Apply the saved theme and density before first paint so neither flashes.
try {
  const theme = localStorage.getItem("codex-ui:theme") || "system";
  const dark = theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  if (localStorage.getItem("codex-ui:density") === "comfortable") document.documentElement.dataset.density = "comfortable";
} catch {}
