# Codex UI

A browser frontend for the Codex CLI. It talks to `codex app-server` (JSON-RPC v2) and is
styled after the Claude Design System reverse-engineered in
[open-claude-ui](https://github.com/Caho1/open-claude-ui): clay accent, low-contrast surface
ladder, hairline rings, spring easing, serif greeting. The interface copy is Simplified Chinese.

## Features

- Thread history grouped by date, search, archive / unarchive, rename, fork, delete.
- Streaming transcript: markdown with highlighted code, collapsible reasoning, command rows with
  live output, grouped read/search exploration, file-change diffs, MCP / web search / sub-agent
  rows, review results, proposed plans and todo lists.
- Composer: `/` commands (`/model`, `/permissions`, `/plan`, `/review`, `/init`, `/compact`, ...),
  `@` fuzzy file mentions, `!` shell commands, pasted / dropped images, model, reasoning effort,
  permission preset and plan-mode pickers, a context-usage ring, steering while a turn runs, `Esc`
  to interrupt.
- Approval cards for commands, file changes and extra permissions (with the server's decision
  set and `Y` / `A` / `P` / `N` / `Esc` shortcuts), `request_user_input` questions and MCP
  elicitation forms.
- Turn diff side panel, code review dialog (uncommitted changes, base branch, commit, custom),
  workspace picker, settings (theme, config defaults, account and rate limits, MCP servers,
  skills), ChatGPT / device-code / API-key sign-in, light and dark themes, narrow-screen layout.

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
server/main.mjs          production static server
src/lib/rpc.ts           JSON-RPC client over the bridge
src/lib/codex.ts         controller: requests, notification reducer, server-request queue
src/lib/store.ts         global store (rAF-batched updates)
src/components/          UI (Transcript, Composer, Approvals, Sidebar, Settings, ...)
src/styles/tokens.css    design tokens; app.css holds component styles
```

Protocol types come straight from `codex-rs/app-server-protocol/schema/typescript` through the
`@protocol/*` path alias, so `pnpm typecheck` catches protocol drift.

## Checks

```sh
pnpm typecheck
pnpm test        # bridge guards and JSON-RPC relay, diff parsing
```
