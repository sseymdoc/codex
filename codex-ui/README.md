# Codex UI

A browser and desktop frontend for the Codex CLI. It talks to `codex app-server` (JSON-RPC v2) and
replicates the **Code tab of Claude Desktop 2.42304.0.0** as documented by the claude.ai audit
(W0–W22) of [open-claude-ui](https://github.com/sseymdoc/open-claude-ui). Where the audit measured
only claude.ai's Chat tab, values and behavior come from the Code tab of the same 2.42304.0.0
package (compact density, sans transcript, the docked composer, the session rail). There is no chat
mode and no Claude / Code switch: every session is a Codex coding session. The interface copy is
Simplified Chinese. Effects the audit marks as unreachable in 2.42304.0.0 are not shipped.

## Features

- **Sidebar** (compact): sections and 最近, sorted by recent activity, name or creation time;
  forks and sub-agent threads nest under their family head with the `└` guide and screen-reader
  lineage; running / waiting / unread dots synced with the server's read state; the branch line or
  已屏蔽 + the pending question; rename, fork, move to a section or project, archive (archived
  sessions are a toggle in the 最近 menu), delete; drag between sections; keyboard roving focus;
  docked, peek, narrow-drawer and phone-sheet modes; a resizable width.
- **Command palette** (`Ctrl+K`): search or start a session (long text switches to a compose
  view), server-side content search with snippets, commands, and row action cards
  (`Alt+Enter`). `Ctrl+Shift+K` is search only; `Ctrl+/` lists every shortcut.
- **Transcript**: sans prose at the chat text size (S / M / L), per-block text insets, code blocks
  in the light / dark code themes, tool rows (read / search / edit / run, grouped commands, MCP
  with progress, web search, images, sub-agent reports and the agent grid), hook runs,
  auto-review rows with 仍然允许, thread notices (reroutes, verification, warnings, MCP sign-in),
  todo lists, file diffs. The working line follows the Code state machine (elapsed-time thinking
  labels, the 2s hold and 已思考 N 秒, phase labels from 正在发送… to 正在运行工具…, retries,
  compaction, background tasks). Normal / Thinking / Verbose views (`Ctrl+O`), copy as quote,
  chapters with pin-as-chapter, a sticky prompt, find in session, collapsing long prompts,
  in-place editing, fork, rewind (confirmed; history only, files stay), feedback.
- **Composer** (docked): Enter steers a running turn, `Ctrl+Enter` queues it; queue bands with
  send now, edit, remove and reorder; `+` menu (images, slash commands, skills, connectors,
  plugins, memory); mode menu (手动 / 接受编辑 / 计划 / 自动 / 完全访问 and custom permission
  profiles); model menu (number keys, more models, fast mode); the effort slider with the
  Ultracode charge bar; the usage ring with its popover; the env pill (folder or project);
  `!` shell mode; `@` file mentions; `↑` history; `Esc Esc` rewind picker; page-wide drop
  scrim; voice mode over WebRTC where the server offers it.
- **Approvals and questions**: docked approval cards with ghost cards behind them for commands,
  file changes and extra permissions (with the server's decision set and `Y` / `A` / `P` /
  `N` / `Esc`), paged `request_user_input` questions and MCP elicitation forms.
- **Session details rail**: environment (where it runs, folders, branch, project, Remote
  Control), goal, settings, connectors, context, usage, progress, changes (with pull requests),
  background tasks; reorder by drag, show / hide from the context menu, flat on narrow screens.
- **Panes**: turn changes (`Ctrl+Shift+D`), a file preview with live change highlights and the
  document rail, and terminals (`` Ctrl+` ``, tabs, xterm) running in the session's folder.
- **Settings**: general (appearance, transcript text size and width, default view, motion, new
  session defaults, this computer: Remote Control, the Windows sandbox, importing from other
  agents, the desktop app's tray and Quick Entry), account and usage (rate-limit rings, reset
  credits, a 30-day chart), memory, labs, plugins and marketplaces, skills, connectors (apps and
  MCP servers), hooks (trust and enable), about; search with deep-link highlights.
- **Sign-in**: ChatGPT in the browser, a device code, or an API key.

### Shortcuts

| Action | Browser | Desktop app |
| --- | --- | --- |
| Search or start a session / search only | `Ctrl+K` / `Ctrl+Shift+K` | same |
| Keyboard shortcuts | `Ctrl+/` | same |
| New session | `Ctrl+Shift+O` | `Ctrl+N` |
| Settings | `Ctrl+Shift+,` | `Ctrl+,` |
| Sidebar | `Ctrl+B` | same |
| Transcript view | `Ctrl+O` | same |
| Changes / terminal | `Ctrl+Shift+D` / `` Ctrl+` `` | same |
| Mode / model / effort menus | `Ctrl+Alt+M` / `Ctrl+Shift+I` / `Ctrl+Shift+E` | also `Ctrl+Shift+M` |
| Fast mode | `Ctrl+Alt+F` | same |
| Stop / rewind | `Esc` / `Esc Esc` | same |
| Find in session | — | `Ctrl+F` |
| Next / previous / Nth session, archive | — | `Ctrl+Tab`, `Ctrl+Shift+Tab`, `Ctrl+1…9`, `Ctrl+Shift+Backspace` |
| Zoom | — | `Ctrl+=` / `Ctrl+-` / `Ctrl+0` |
| Quick Entry | — | `Ctrl+Alt+Space` (configurable) |

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
| `--codex PATH` / `CODEX_BIN` | codex binary or npm launcher (`codex.js`). Default: `codex-rs/target/{release,debug}/codex`, then `codex` on `PATH`, then the newest copy installed by the Codex app or the VS Code extension. A path that does not exist is an error. |
| `--cwd DIR` | working directory for app-server and the default workspace for new sessions. |
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

It listens on 7478 so its settings (stored per origin) stay apart from the browser version's. As
in Claude Desktop 2.42304.0.0: on Windows the page draws a 36px chrome bar and the caption buttons
float over it; the window opens at 1200×800 (minimum 600×400, 600×600 while signed out) and
remembers its bounds, zoom (25%–500%) and theme; the default menu's accidental shortcuts are gone;
a tray icon keeps the app running when the window closes; Quick Entry opens a small prompt window
from anywhere; the jump list starts a new session; a launch skeleton and a load-failure overlay
with automatic retries cover start-up. Links open in the system browser, and a second launch
focuses the running window. The desktop app reads `CODEX_BIN` and `CODEX_UI_TOKEN` from the
environment; under Electron, npm's `codex.js` launcher runs with the `node` on `PATH`.

## How it works

Browsers cannot use the app-server WebSocket listener (it rejects requests that carry an
`Origin` header), so `server/bridge.mjs` starts one `codex app-server` child per page load over
stdio. Server messages stream to the page as Server-Sent Events (`GET /api/events`); client
messages are posted as newline-delimited JSON (`POST /api/send`). The page declares the
experimental API, so queues, terminals, search, plugins, memory, Remote Control and the other
experimental methods are available; methods an older codex does not know are detected and their
entry points hidden.

Because app-server can run commands as the current user, every API request must use a loopback
`Host` (DNS rebinding), come from the page's own origin (CSRF), and carry the per-process token
cookie. The production server also sends a strict Content-Security-Policy, so rendered agent
output cannot load remote images or scripts.

```
server/bridge.mjs          stdio <-> SSE/POST bridge, request guards, codex discovery
server/serve.mjs           loopback server: dist/ plus the bridge
server/main.mjs            CLI (`pnpm start`)
desktop/main.mjs           Electron shell: window state, zoom, tray, Quick Entry, jump list
desktop/preload.cjs        the page's calls into the shell
desktop/quick.html         the Quick Entry window
src/lib/rpc.ts             JSON-RPC client over the bridge
src/lib/codex.ts           controller: requests, notification reducer, server-request queue
src/lib/store.ts           global store (rAF-batched updates)
src/lib/protocol.ts        pure protocol helpers (errors, versions, review summaries, notices)
src/lib/session.ts         session lineage order, working-line labels, transcript views
src/lib/transcript.ts      transcript helpers (retries, chapters, agent grid, file links)
src/lib/voice.ts           voice mode over WebRTC (thread/realtime/*)
src/components/            UI: App shell, Sidebar, Palette, Main, Transcript, items, Composer,
                           Approvals, Rail, FilePreview, Terminal, Settings, Dialogs, ui atoms
src/styles/tokens.css      design tokens and keyframes (palette, density, type, motion)
src/styles/base.css        reset and atoms (buttons, menus, dialogs, rings, dots, toasts)
src/styles/shell.css       layout, sidebar, chrome bar, palette, launch and failure screens
src/styles/pages.css       session header, new-session page, rail, panes, terminal
src/styles/settings.css    settings, dialog content, sign-in
src/styles/transcript.css  transcript, prose, tool rows, working line, lightbox
src/styles/composer.css    dock, queue bands, composer and chin, pickers, approvals, questions
```

Protocol types come straight from `codex-rs/app-server-protocol/schema/typescript` through the
`@protocol/*` path alias, so `pnpm typecheck` catches protocol drift.

## Checks

```sh
pnpm typecheck
pnpm test        # bridge guards, discovery and relay; protocol, diff, format, session, transcript and preview helpers
```
