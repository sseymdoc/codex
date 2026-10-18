import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { applyTheme } from "./components/Settings";
import { applyMotion } from "./components/ui";
import { connect } from "./lib/codex";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/shell.css";
import "./styles/pages.css";
import "./styles/settings.css";
import "./styles/transcript.css";
import "./styles/composer.css";

// theme-init.js painted the saved choices; follow the OS when it changes underneath them.
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => applyTheme());
matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", applyMotion);

connect();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
