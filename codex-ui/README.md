# Codex UI

A browser frontend for the Codex CLI. It talks to `codex app-server` (JSON-RPC v2) and
replicates the Code tab of claude.ai as measured in the claude.ai audit (W0-W15) of
[open-claude-ui](https://github.com/sseymdoc/open-claude-ui): CDS surfaces, ink alphas and focus
rings, comfortable density by default (compact is a setting), squish-on-press buttons, 32px menu
rows, the serif greeting and agent prose, brand clay only on the send key and the Spark mark, and
the Code tab's session lineage, details rail and thinking line. There is no chat mode and no
Claude / Code switch: every session is a Codex coding session. The interface copy is Simplified
Chinese.

## Features

- Sidebar: colored sections (`threadSection/*`) and 最近, sorted by recent activity, name or
  creation time; forks nest under the session they came from; status dots for running, unread
  and waiting-on-you sessions; the session's branch; rename, fork, move, archive, delete, drag
  between sections, and a resizable width (double-click the edge to reset).
- Command palette (`Ctrl` / `Cmd` + `K`) with server-side session search and app commands.
- Transcript: markdown with highlighted code, command rows with live output, grouped read/search
  exploration, file-change diffs, MCP / web search / sub-agent rows, review results, proposed
  plans and todo lists. Three views (标准 / 思考 / 详细, `Ctrl+O`, default in settings) decide
  whether reasoning and full tool output show. A working line shows the Spark, elapsed time, an
  output-token estimate and what Codex is doing. Each turn ends with copy, retry
  (`thread/revert`, files stay as they are), fork from here and the files it changed. Edit a sent
  message, export a session as Markdown; long replies get a heading rail; images open in a
  lightbox.
- Composer: `/` commands (`/model`, `/permissions`, `/plan`, `/review`, `/init`, `/compact`, ...),
  `@` fuzzy file mentions, `!` shell commands, pasted / dropped images, skills and plan mode from
  the `+` menu; model, reasoning effort and permission menus plus a context ring under the box.
  Messages sent while a turn runs are queued (`thread/queue/*`, sent when the turn ends; send now,
  edit, remove or reorder them) or steer the turn when the server has no queue. `Esc` interrupts,
  drafts are kept per session, and `/goal` sets a long-running goal (`thread/goal/*`) shown as a
  header pill you can pause, resume or clear.
- Session details rail: environment, goal, settings, context-window breakdown, plan progress,
  rate limits, connectors and the latest changes.
- Approval cards for commands, file changes and extra permissions (with the server's decision
  set and `Y` / `A` / `P` / `N` / `Esc` shortcuts), `request_user_input` questions and MCP
  elicitation forms; a waiting session shows 已屏蔽 and the request in the sidebar.
- Per-turn diff side panel (history sessions use their file-change items), code review dialog
  (uncommitted changes, base branch, commit, custom), workspace picker, settings (theme, density,
  default view, config defaults, account with rate-limit rings and a 30-day token usage chart, MCP
  servers, skills, experimental features), ChatGPT / device-code / API-key sign-in, light and dark
  themes, narrow-window and phone layouts.

| Shortcut | Action |
| --- | --- |
| `Ctrl+K` | command palette |
| `Ctrl+Shift+O` | new session |
| `Ctrl+B` | show or hide the sidebar |
| `Ctrl+Shift+D` | diff panel |
| `Ctrl+,` | settings |
| `Ctrl+O` | cycle the transcript view |
| `Ctrl+U` | attach an image |
| `Ctrl+Shift+I` | model menu |

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
there is no native title bar: the page draws a 36px chrome bar (Spark mark and sidebar toggle)
that drags the window, and the system caption buttons float over its right end in the in-app
theme's colors. The desktop
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
src/lib/session.ts       session lineage order, working-line labels, transcript views
src/components/          UI (Transcript, Composer, Approvals, Sidebar, Rail, Settings, ...)
src/styles/tokens.css    design tokens (palette, purpose, density, motion)
src/styles/base.css      reset, primitives (buttons, menus, dialogs, rings, toasts)
src/styles/chrome.css    layout, sidebar, headers, welcome, settings
src/styles/thread.css    transcript, markdown, tool rows, approvals, composer dock
```

Protocol types come straight from `codex-rs/app-server-protocol/schema/typescript` through the
`@protocol/*` path alias, so `pnpm typecheck` catches protocol drift.

## Checks

```sh
pnpm typecheck
pnpm test        # bridge guards and JSON-RPC relay, diff parsing, format and session helpers
```
