# Codex UI

A browser and desktop frontend for the Codex CLI. It talks to `codex app-server` (JSON-RPC v2) and
replicates the **Code tab of Claude Desktop 2.42304.0.0**, read from the package's shipped
`ion-dist` bundle and `app.asar` (static analysis only), with the design docs of
[open-claude-ui](https://github.com/sseymdoc/open-claude-ui) as a guide; where the two disagree,
the bundle wins.

- **One variant, the flag-off one.** The bundle's GrowthBook reader returns *off* for a flag the
  server did not send, and one flag (`claudeai_cc_epitaxy_session_presets_main`) switches a whole
  set of screens. codex-ui is that flag-off Code tab throughout: the greeting home page, the
  classic session list, the docked question card, the original command palette. The one
  exception is the flag-on "Session details" rail (会话栏), carried over on its own. Other flags
  with an unknown default are treated the same way; "kill switch" flags (`!flag`) therefore stay on.
- **Codex, not Claude.** There is no chat mode and no Claude / Code switch. Features that need
  Claude's own services (environment presets, pull-request and CI status, worktrees, cloud and SSH
  sessions, Output style) are left out; Codex's own (goals, auto-review, projects, memory, hooks,
  the Windows sandbox, Remote Control pairing) stay, marked as such in the code.
- **Copy.** The interface is Simplified Chinese, translated from the bundle's English strings in
  the voice of the desktop app's own `zh-Hans.json` (您, “ ”, Remote Control untranslated).

## Features

- **Sidebar** (classic list): 新建, 自定义 and search; Filter ▸ Status (active / archived / all),
  group by folder (the desktop default), date or custom group, sort by name, creation or activity;
  pinned sessions; forks and sub-agents nested under their family head with the vertical guide and
  screen-reader lineage; status glyphs (idle, running, awaiting input, unread, error, archived);
  the same session menu on right click and ⋮ with single-key shortcuts; inline rename; Shift /
  Ctrl multi-select with batch actions; server-synced custom groups with drag and drop; peek,
  narrow-window and phone-sheet modes; a resizable width.
- **New session page**: the greeting (欢迎回来 / 接下来做什么), the action center (sessions that
  need input or are unread, with dismiss and mark-all-read; Codex projects), the folder pill
  with recent folders and named local environments, the composer docked at the bottom.
  选择环境 → 新建环境 opens a name and source-folder form; environments use Codex desktop's
  `project/*` records, so both clients can read them under the same `CODEX_HOME`.
  See [local environments](docs/local-environments.md) for compatibility and validation boundaries.
- **Session**: the title row (where it runs, the session menu, repo pill, project badge, pane
  toggles that fold into 视图选项); a transcript after the default Code renderer: one row per tool
  call (Ran / Read / Searched / Edited … with the bundle's command-summary rules), MCP and
  sub-agent rows, diffs in the git colors, code blocks, notices and hook interventions; the
  working-line state machine; message actions (copy, rewind to here, fork from here, pin as
  chapter); rewind (`thread/revert`, confirmed: it cannot be undone and files stay changed);
  chapters; Normal / Thinking / Verbose views (`Ctrl+O`, remembered per session); find in session;
  older history loads as you scroll up. Unnamed sessions get a concise topic title from a separate
  ephemeral session using the same model; saved names are preserved. Naming times out after 30 seconds
  and falls back to the first 30 characters of the opening message. Opening an existing unnamed session
  also attempts naming; its messages stay unchanged.
- **Composer**: one single-line composer on both pages; mode menu (手动 / 接受编辑 / 计划 / 自动, and
  绕过权限 once Settings → Codex allows it; custom permission profiles); model menu with fast
  mode; effort; the context ring and its popover (context window, 压缩会话 from 50%, plan usage
  limits, 请求更多 when a workspace runs out); `+` menu (images, slash commands, skills, connector
  switches, browse connectors, plugins); slash commands are inserted, then run on Enter; `@`
  mentions; `↑` history, the queued message first; queue bands; `!` shell mode; voice over WebRTC
  where the server offers it. Picks on an open session apply at once (`thread/settings/update`).
- **Approvals and questions**: docked cards (拒绝 | 在本次会话中允许 / 始终允许 | 允许一次) with
  `Esc`, `Ctrl+Enter`, `Ctrl+Shift+Enter` and digits, swallowing clicks for 400ms after they
  appear; the plan approval card in plan mode; the docked question card (paged, 其他, 跳过); MCP
  elicitation forms and URL requests.
- **Panes**: tiled, resizable panes on the right: 更改 (this turn or every change via
  `gitDiffToRemote`, file list, go to file, `F7` / `Shift+F7` between changes), 文件 (preview tabs),
  终端 (tabs, xterm), 计划 (the turn's todo list and the Codex goal), 后台任务.
- **Session rail** (会话栏, the header's first toggle): 环境 (folder, branch, Remote Control), 目标,
  上下文 (with 压缩会话), 连接器 (MCP servers, 登录 / 重新连接) and 后台任务 cards, folded per
  session, hidden from the heading's right-click menu; docked beside the chat where the column has
  room, a floating panel where it does not.
- **Command palette** (`Ctrl+K`, the original layout): quick actions and recent sessions, `Tab` for
  commands; `Ctrl+Shift+K` searches session content; `Ctrl+/` lists every shortcut.
- **Settings**: 设置 (通用, 用量, 记忆, Codex, 导入, 实验功能) / 这台电脑 (系统, desktop only) /
  自定义 (技能, 连接器, 插件, Hooks); search with the bundle's ranking; 关于 opens from the desktop app's Help menu.
- **Sign-in**: in the desktop app a splash, then ChatGPT in the browser, a device code or an API
  key; the web page in a browser.

### Shortcuts

| Action | Browser | Desktop app |
| --- | --- | --- |
| Search or start a session / search only | `Ctrl+K` / `Ctrl+Shift+K` | same |
| Keyboard shortcuts | `Ctrl+/` | same |
| New session | `Ctrl+Shift+O` | `Ctrl+N` |
| Settings | `Ctrl+Shift+,` | `Ctrl+,` |
| Sidebar | `Ctrl+B` | same |
| Transcript view | `Ctrl+O` | same |
| Changes / terminal / files | `Ctrl+Shift+D` / `` Ctrl+` `` / `Ctrl+Shift+F` | same |
| Close / expand the pane | `Ctrl+\` / `Ctrl+Shift+\` | same |
| File list, go to file, next / previous change | `Ctrl+Shift+Y`, `Ctrl+P`, `F7` / `Shift+F7` | same |
| Mode / model / effort menus | `Ctrl+Alt+M` / `Ctrl+Shift+I` / `Ctrl+Shift+E` | also `Ctrl+Shift+M` |
| Fast mode | `Ctrl+Alt+F` | same |
| Stop / rewind | `Esc` / `Esc Esc` | same |
| Find in session, next / previous hit | — | `Ctrl+F`, `F3` / `Shift+F3` |
| Back / forward | — | `Alt+←` / `Alt+→` |
| App menu, reload, full screen | — | `Alt` or `F10`, `F5`, `F11` |
| Close the session / the window | — | `Ctrl+W` / `Ctrl+Shift+W` |
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

The server prints a URL with a per-process `?token=`; opening it stores the token in an HttpOnly
cookie (the token stays valid for the life of the process). `pnpm start -- --help` lists the options:

| Option | Meaning |
| --- | --- |
| `--codex PATH` / `CODEX_BIN` | codex binary or npm launcher (`codex.js`). If the configured command is missing, falls back to `codex-rs/target/{release,debug}/codex`, then `codex` on `PATH`, then copies installed by the Codex app or the VS Code extension, newest first. Local builds without a sibling `codex-code-mode-host` are skipped. |
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
in Claude Desktop 2.42304.0.0:

- **Window**: on Windows the page draws a 36px chrome bar with 菜单, the sidebar switch and
  返回 / 前进; the caption buttons float over it and the bar reserves `ceil(140 / zoom)` px for
  them (none in full screen). The window opens at 1200×800 (minimum 600×400, 600×600 while signed
  out) and remembers its bounds; zoom runs from 25% to 500%, and the find bar stays at 100%.
  Closing the window hides it while the tray is on and quits otherwise; a second launch brings it
  back. Links open in the system browser; the context menu has spelling, link, image and editing
  items.
- **App menu**: 文件 / 编辑 / 视图 / 转到 / 帮助, never shown as a menu bar: 菜单, a lone `Alt` or
  `F10` opens it. It lists the page's own shortcuts; `F5` reloads, `F11` toggles full screen,
  `Ctrl+W` closes the session (the window when none is open). 帮助 → 故障排查 shows codex's log
  folder (`CODEX_HOME/log`) or turns hardware acceleration off after a restart.
- **Tray and Quick Entry**: the tray icon follows the theme, shows the app name, and a click opens
  Quick Entry, a transparent 606×470 prompt window from anywhere (in full screen the hotkey starts
  a session in the window instead); the first launch explains the tray in a balloon.
- **Jump list**: 需要您输入 (sessions with a request waiting), 新建 Code 会话 in the latest folders,
  and the tasks 新建 Code 会话 and 继续“…”; it works on a closed app too.
- **Notifications**: approvals (with 允许一次), questions and finished or failed turns, while the
  window is in the background or shows another session; a click opens the session.
- **Settings → 系统**: a running turn keeps the computer awake (on battery too, unless switched
  off), the taskbar button flashes when something waits only if asked to, and the app can start
  with the system, in the tray.
- **Start-up**: a launch skeleton stays until the first connection; an app-server exit restarts it
  behind the skeleton three times, and the next exit within five minutes shows 反复崩溃 without
  automatic retries. A load-failure overlay retries automatically (0 / 15 / 30 s, ±20%, while
  within 180 s; early when the window comes back).

codex-ui's own choices, not Claude Desktop's: zoom, theme and the desktop settings are kept in
`window-state.json`; the tray icon is the app icon's `</>` drawn in code (Claude ships its own
icons); Quick Entry does not hand focus back to the app that had it (that needs a native module).
The desktop app reads `CODEX_BIN` and `CODEX_UI_TOKEN` from the environment; under Electron, npm's
`codex.js` launcher runs with the `node` on `PATH`.

**Settings → 实验性功能 → 启用实验型后端** is off by default and saved in `window-state.json`.
Changes take effect after restarting the desktop app. Set `CODEX_EXPERIMENTAL_BIN` to the full
path of the experimental `codex` binary; without it, development launches look in this checkout's
`codex-rs/target/{release,debug}`. The experimental binary needs a sibling `codex-code-mode-host`.
If either is missing at startup, the switch is saved as off and the original backend is used.
With the switch off, desktop launches use `CODEX_BIN`, `PATH` and installed copies, skipping
automatic repository-build discovery. `CODEX_BIN` remains the original backend override.

The local workspace version tracks the upstream source baseline with a `+codex-ui` build suffix.
Keep it when rebuilding the experimental backend: both Remote enrollment and the initialization
handshake use this version. An unversioned `0.0.0` build connects to the relay but mobile Remote
rejects it as outdated. Restart Codex UI after rebuilding to load the new backend.

## How it works

Browsers cannot use the app-server WebSocket listener (it rejects requests that carry an
`Origin` header), so `server/bridge.mjs` starts one `codex app-server` child per page load over
stdio. Server messages stream to the page as Server-Sent Events (`GET /api/events`); client
messages are posted as newline-delimited JSON (`POST /api/send`). The page declares the
experimental API, so queues, terminals, search, plugins, memory, Remote Control and the other
experimental methods are available; methods an older codex does not know are detected and their
entry points hidden.

When a local [opencodex](https://github.com/lidge-jun/opencodex) proxy routes models to other
providers (`provider/model` slugs), Codex's own limits still describe only the ChatGPT account.
`GET /api/opencodex/quotas` reads the proxy's per-provider quota (`/api/provider-quotas`) with the
one-shot read capability its runtime record allows (never the admin token), and the usage popover
shows the quota of the provider the selected model goes to. A prepaid balance reads as a bar of
what has been spent since the page first saw it. A balance only shows the net change between two
reads, so the page re-reads every 5½ minutes while it is open, just past the proxy's 5-minute cache,
which keeps a top-up from hiding more than a few minutes of spending.

[cc-switch](https://github.com/farion1231/cc-switch) instead points Codex itself at another
provider by rewriting `config.toml`, so every model spends that provider's quota.
`GET /api/ccswitch/quota` opens cc-switch's database read-only and, while `config.toml` still
selects the provider cc-switch made current (or its takeover proxy stands in on loopback), runs the
usage query cc-switch has set up for it: the General, NewAPI and Sub2API templates, the native
balances (DeepSeek, StepFun, SiliconFlow, OpenRouter, Novita) and the Kimi, Zhipu and MiniMax
coding plans. Keys never leave the bridge. Custom usage scripts stay in cc-switch, which sandboxes
them as untrusted code; the popover says so instead of running one.

A ChatGPT account with credits left gets a credits bar under its limits, metered the same way as
a balance and read to a tenth of a percent. Credits only run down once the limits are used up, so
the usage ring keeps showing the limits.

App-server reports only how full the window is (`thread/tokenUsage/updated`), so the session
rail's context card reads the breakdown from the thread's rollout: `GET /api/context-usage` takes
`Thread.path` (an absolute `rollout-*.jsonl`, never any other file), sorts what the window holds
by the kind Codex records for each part and sizes it the way Codex does (bytes / 4). The first
request's real input count stands in for the tool definitions a rollout leaves out, and messages
are the live total less the rest, so the bar always adds up to the header.

Because app-server can run commands as the current user, every API request must use a loopback
`Host` (DNS rebinding), come from the page's own origin (CSRF), and carry the per-process token
cookie. The production server also sends a strict Content-Security-Policy, so rendered agent
output cannot load remote images or scripts.

```
server/bridge.mjs          stdio <-> SSE/POST bridge, request guards, codex discovery
server/ccswitch.mjs        the quota of cc-switch's current Codex provider, read-only
server/context-usage.mjs   a thread's context breakdown, read from its rollout
server/serve.mjs           loopback server: dist/ plus the bridge
server/main.mjs            CLI (`pnpm start`)
desktop/main.mjs           Electron shell: window state, zoom, tray, Quick Entry, jump list
desktop/preload.cjs        the page's calls into the shell
desktop/quick.html         the Quick Entry window
desktop/installer.nsh      NSIS include: DPI-aware setup; redraws installer-sidebar.bmp to scale
src/lib/rpc.ts             JSON-RPC client over the bridge
src/lib/codex.ts           controller: requests, notification reducer, server-request queue
src/lib/store.ts           global store (rAF-batched updates)
src/lib/protocol.ts        pure protocol helpers (errors, versions, review summaries, notices)
src/lib/session.ts         session lineage order and buckets, working-line labels, transcript views
src/lib/transcript.ts      transcript helpers (retries, chapters, command summaries, file links)
src/lib/panes.ts           tiled panes: open / close / expand, sizes, diff helpers
src/lib/landing.ts         the new session page's action center
src/lib/approvals.ts       approval button slots, form validation, stdin approvals
src/lib/palette.ts         palette time buckets, row budget, match highlights
src/lib/settings.ts        settings search ranking (the bundle's normalization and scores)
src/lib/shortcut.ts        shortcut parsing and Windows key names
src/lib/voice.ts           voice mode over WebRTC (thread/realtime/*)
src/lib/context.ts         context card: legend and meter, auto-compact point, MCP tool sizes
src/components/            UI: App shell, Sidebar, Palette, Main, Transcript, items, Composer,
                           Approvals, Panes, FilePreview, Terminal, Settings, Dialogs, ui atoms
src/styles/tokens.css      design tokens and keyframes (palette, density, type, motion)
src/styles/base.css        reset and atoms (buttons, menus, dialogs, rings, dots, toasts)
src/styles/shell.css       layout, sidebar, chrome bar, palette, launch and failure screens
src/styles/pages.css       session header, new-session page, panes, terminal, files
src/styles/settings.css    settings, dialog content, sign-in
src/styles/transcript.css  transcript, prose, tool rows, working line, lightbox
src/styles/composer.css    dock, queue bands, composer and its picker row, approvals, questions
```

Protocol types come straight from `codex-rs/app-server-protocol/schema/typescript` through the
`@protocol/*` path alias, so `pnpm typecheck` catches protocol drift.

Command rows use the model-provided `description` as their title, with the existing command
summary as a fallback for older servers and history. The command tool advertises `description`
as required, including nested calls inside `exec`; runtime parsing still accepts older calls.
Build `codex-rs` with
`cargo build -p codex-cli -p codex-code-mode-host`, point `CODEX_EXPERIMENTAL_BIN` at the resulting
`codex` binary, and enable the desktop experimental-backend switch to enable titles
(the browser version uses `CODEX_BIN` instead);
rebuilding the UI alone does not add this field to an installed app-server.

On Windows, the pinned [V8 release](https://github.com/denoland/rusty_v8/releases/tag/v152.2.0)
does not publish sandbox-enabled prebuilt artifacts, so building the host currently needs a
V8 source build. Until that host is available, incomplete local builds are skipped.

## Checks

```sh
pnpm typecheck
pnpm test        # bridge guards, discovery and relay; the pure helpers under src/lib
```
