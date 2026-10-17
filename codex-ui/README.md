# Codex UI

A browser frontend for the Codex CLI. It talks to `codex app-server` (JSON-RPC v2) and is
styled after the Claude Design System (Claude Desktop v2.42304.0) reverse-engineered in
[open-claude-ui](https://github.com/sseymdoc/open-claude-ui): six-layer tokens with a compact /
comfortable density switch, clay kept for the agent's own work (working dots, its requests, the
arrival glow), a serif voice for agent prose with optical hanging punctuation, the floating
composer that folds into a pill while you read, usage ring meters, Oklab sheet cards, the
document rail and scroll-driven edge fades. The interface copy is Simplified Chinese.

## Features

- Thread history grouped by date, search, archive / unarchive, rename, fork, delete, unread
  markers, and colored sections (`threadSection/*`) with drag-and-drop between them.
- Command palette (`Ctrl` / `Cmd` + `K`) for jumping to threads and running app commands.
- Streaming transcript: markdown with highlighted code, collapsible reasoning, command rows with
  live output, grouped read/search exploration, file-change diffs, MCP / web search / sub-agent
  rows, review results, proposed plans and todo lists. Replies stream block by block with a
  grapheme reveal; long replies get a heading rail; images open in a lightbox. Edit a sent
  message or regenerate the last reply (`thread/revert`, files stay as they are), fork from
  any turn, export a thread as Markdown.
- Composer: `/` commands (`/model`, `/permissions`, `/plan`, `/review`, `/init`, `/compact`, ...),
  `@` fuzzy file mentions, `!` shell commands, pasted / dropped images, model, reasoning effort,
  permission preset and plan-mode pickers, a context-usage ring, steering while a turn runs, `Esc`
  to interrupt, per-thread drafts, and `/goal` for long-running goals (`thread/goal/*`) shown as a
  header pill you can pause, resume or clear.
- Approval cards for commands, file changes and extra permissions (with the server's decision
  set and `Y` / `A` / `P` / `N` / `Esc` shortcuts), `request_user_input` questions and MCP
  elicitation forms.
- Turn diff side panel, code review dialog (uncommitted changes, base branch, commit, custom),
  workspace picker, settings (theme, density, config defaults, account with rate-limit rings and a
  30-day token usage chart, MCP servers, skills, experimental features), ChatGPT / device-code /
  API-key sign-in, light and dark themes, narrow-screen layout.

## Usage

From the repository root (the package is part of the pnpm workspace):

```sh
pnpm install
cd codex-ui
pnpm build && pnpm start      # serves dist/ on http://127.0.0.1:7477
pnpm dev                      # Vite dev server with the same bridge on :5173
```

The server prints a URL with a one-time `?token=`; opening it stores the token in an HttpOnly
cookie. `pnpm start -- --help` lists the options:

| Option | Meaning |
| --- | --- |
| `--codex PATH` / `CODEX_BIN` | codex binary or npm launcher (`codex.js`). Default: `codex-rs/target/{release,debug}/codex`, then `codex` on `PATH`. |
| `--cwd DIR` | working directory for app-server and the default workspace for new chats. |
| `-c key=value` | config override forwarded to codex (repeatable). |
| `--port N` | listen port (default 7477, next free port if taken). |
| `--no-open` | do not open a browser. |
| `CODEX_UI_TOKEN` | use a fixed token instead of a random one. |

`CODEX_HOME` and other environment variables are passed through to app-server unchanged.

### Desktop app

`desktop/main.mjs` runs the same server inside Electron and shows it in a window:

```sh
pnpm desktop                  # build dist/ and open the window
pnpm package:desktop          # out/Codex UI-<platform>-<arch>/, e.g. "Codex UI.exe" on Windows
pnpm installer:desktop        # Windows: out/installer/Codex-UI-Setup-<version>.exe (NSIS)
```

It listens on 7478 so its settings (stored per origin) stay apart from the browser version's.
Links open in the system browser, and a second launch focuses the running window. On Windows
there is no native title bar: the app's headers drag the window, and the system caption buttons
float over the top-right corner in the in-app theme's colors. The desktop
app takes no command-line options: it reads `CODEX_BIN` and `CODEX_UI_TOKEN` from the
environment, and when started from a shortcut new chats default to the home folder. Set
`CODEX_BIN` as a user environment variable if `codex` is not on `PATH`. Under Electron, npm's
`codex.js` launcher runs with the `node` on `PATH`.

## How it works

Browsers cannot use the app-server WebSocket listener (it rejects requests that carry an
`Origin` header), so `server/bridge.mjs` starts one `codex app-server` child per page load over
stdio. Server messages stream to the page as Server-Sent Events (`GET /api/events`); client
messages are posted as newline-delimited JSON (`POST /api/send`).

Because app-server can run commands as the current user, every API request must use a loopback
`Host` (DNS rebinding), come from the page's own origin (CSRF), and carry the per-process token
cookie. The production server also sends a strict Content-Security-Policy, so rendered agent
output cannot load remote images or scripts.

```
server/bridge.mjs        stdio <-> SSE/POST bridge and request guards
server/serve.mjs         loopback server: dist/ plus the bridge
server/main.mjs          CLI (`pnpm start`)
desktop/main.mjs         Electron shell around serve.mjs
desktop/preload.cjs      the page's one call into the shell: its theme setting
src/lib/rpc.ts           JSON-RPC client over the bridge
src/lib/codex.ts         controller: requests, notification reducer, server-request queue
src/lib/store.ts         global store (rAF-batched updates)
src/components/          UI (Transcript, Composer, Approvals, Sidebar, Settings, ...)
src/styles/tokens.css    design tokens (palette, purpose, density, motion)
src/styles/base.css      reset, primitives (buttons, menus, dialogs, rings, toasts)
src/styles/chrome.css    layout, sidebar, headers, welcome, settings
src/styles/thread.css    transcript, markdown, tool rows, approvals, floating composer
```

Protocol types come straight from `codex-rs/app-server-protocol/schema/typescript` through the
`@protocol/*` path alias, so `pnpm typecheck` catches protocol drift.

## Checks

```sh
pnpm typecheck
pnpm test        # bridge guards and JSON-RPC relay, diff parsing, format helpers
```
