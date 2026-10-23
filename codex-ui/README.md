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
  older history loads as you scroll up. Only newly created conversations get an automatic concise
  topic title through the dedicated `POST /api/title` endpoint (`{ description, model? }` → `{ title }`).
  Its private backend process uses the highest visible `gpt-<version>-luna` model that advertises fast
  mode while `fast_mode` is enabled; otherwise it uses the conversation's model. It runs in a temporary
  workspace, without the page's browser binding, project instructions, MCP servers or plugins. The
  30-second deadline includes startup; cancellation, disconnection and app shutdown stop the worker.
  Saved names are preserved, failures show the first 30 characters of the opening message, and old
  unnamed conversations are never renamed automatically. Only applying the result uses the normal
  `thread/name/set` metadata RPC; naming adds no chat turn.
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
  终端 (tabs, xterm), 计划 (the turn's todo list and the Codex goal), 后台任务 (shells and sub-agents,
  including nested agents discovered by lineage; running and finished sections, transcript links and stop controls).
  Task events refresh the viewed session; discovery backs off from 1 to 30 seconds only while work
  runs, pauses when the page is hidden, and stops when all tasks finish. Opening or focusing the
  session checks once, including old agents, without a permanent polling interval.
- **Session rail** (会话栏, the header's first toggle): 环境 (folder, branch, Remote Control), 目标,
  上下文 (with 压缩会话), 连接器 (MCP servers, 登录 / 重新连接) and 后台任务 cards, folded per
  session, hidden from the heading's right-click menu; docked beside the chat where the column has
  room, a floating panel where it does not.
- **Command palette** (`Ctrl+K`, the original layout): quick actions and recent sessions, `Tab` for
  commands; `Ctrl+Shift+K` searches session content; `Ctrl+/` lists every shortcut.
- **Settings**: 设置 (通用, 用量, 记忆, Codex, 导入, 实验功能) / 这台电脑 (系统, desktop only) /
  自定义 (技能, 连接器, 插件, Hooks); search with the bundle's ranking; 关于 opens from the desktop app's Help menu.
  Desktop 设置 → 功能 also exposes [connector tool access and directory search](docs/connector-tool-access.md), gated by the experimental backend and applied after restart.
- **Sign-in**: in the desktop app a splash, then ChatGPT in the browser, a device code or an API
  key; the web page in a browser.
  The account menu automatically reads the signed-in ChatGPT profile's nickname and avatar on
  connection and account changes. Credentials stay in the local bridge. The private
  `/wham/profiles/me` endpoint is optional: unavailable profiles fall back to the email prefix,
  and missing or failed images fall back to an initial. API-key and local-model labels stay unchanged.
  Failed profile reads retry after 1 and 5 seconds; returning to the window, restoring connectivity,
  or opening the account menu retries a still-missing profile without restarting the app.

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

## Application service

`server/orchestrator.mjs` exports `createOrchestrator(options)`, the in-process owner of app-server
connections, child processes, prewarming, private RPC replies, browser MCP bindings and title workers.
The desktop, browser CLI and Vite entrypoints each create one instance and inject it into the HTTP
adapter. The service neither imports Electron/React nor receives HTTP request/response objects.

| Layer | Owns |
| --- | --- |
| Orchestrator | Backend startup snapshot, process/connection lifecycle, JSON-RPC forwarding, private account/transcription requests, title cancellation and browser MCP routing. |
| `server/backend.mjs` | Package selection, verification, installation and updates; instantiated by the orchestrator only for the desktop host. |
| HTTP bridge | Loopback/origin/token checks, request validation, routes, status codes and SSE framing. |
| Electron host | Windows, tray, dialogs, native browser views and OS integration; passes browser capabilities and `net.fetch` to the service. |
| UI and existing storage | Presentation state, drafts, `localStorage` and the unchanged `window-state.json`. |

The internal connection API is `connect(host, { event, message, end })`, `send(id, messages)` and
`disconnect(id)`. Event callbacks receive the existing `hello`, `fatal` and `exit` payloads; message
callbacks receive raw JSON-RPC lines. `prewarm(host)` and `close()` own the worker lifecycle.
Account, transcription, title and browser MCP operations return ordinary data/promises, keeping
credentials and process handles private. Public HTTP, SSE, desktop IPC and app-server protocols do
not change.

Desktop backend settings are captured once at service creation. Selecting another package or
changing experimental preferences still requires restarting the application. Browser capabilities,
their direct MCP entrypoint and prewarming retain the experimental-backend gate. Each page still
owns its app-server process, a disconnect still stops it, and titles still use separate restricted
workers. This is not a daemon or a reconnect-and-resume feature.

On desktop exit, `stopMaintenance()` stops backend preparation/updates, the host closes native
browser views, and the server closes the orchestrator before closing HTTP. `close()` is idempotent
and prevents further prewarming. The browser CLI and Vite close their service with their server.

`server/orchestrator.test.mjs` tests the service directly without HTTP or Electron. Existing bridge,
prewarm, title, backend and desktop smoke tests exercise the host adapters and unchanged behavior.

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

**Settings → 实验性功能 → 实验型后端** uses the shared segmented control: 禁用 / Release /
Preview / 自定义. `backendChannel` in `window-state.json` defaults to `disabled`; the old boolean switch
does not silently opt users into a download. Release installs the latest published complete
`codex-package-<target>.tar.gz` from `sseymdoc/codex`, verifying GitHub's SHA-256 asset digest.
Preview first prepares that Release, then clones the repository's default branch and compiles
`codex-rs` locally in the background with Git, Rust and the platform's C++ build tools. It prepares
the pinned sandbox-enabled V8 artifacts with the same checksum chain as upstream's CI.
自定义 opens a native file picker for a local `.tar.gz` package. It copies the package into a
new profile-owned version directory, checks archive paths and file types, requires the matching
`bin/codex` and `bin/codex-code-mode-host` executables, and probes the entrypoint before switching.
When `codex-backend.json` is present, its target and file SHA-256 values must also match. Cancelling
the picker or failing validation preserves the previous channel and package. Use “选择其他后端包”
to replace a custom package; the running process changes only after restart. Custom packages
receive no automatic Release updates. A selected package contains executable code and should
come from a source the user trusts.
The UI shows preparation progress, errors, a build-log link and a restart button. Restarting
uses the prepared Preview, or the Release while Preview is still being built. Downloads,
sources, build outputs and installed versions live in the desktop profile's `backends` directory;
they never overwrite this checkout or the original backend. Release checks for updates silently
at startup and every six hours, downloads and verifies changed packages in the background, and
uses them on the next normal restart without update messages or restart prompts. Failed checks
keep the installed backend. Disabled, Preview and Custom do not run these update checks; Preview keeps
reusing its existing installed files and source cache.
Interrupted preparation resumes the same source commit; an interrupted initial clone is kept
separate from the complete checkout, so restarting cannot reuse a half-written Git index.
If neither the selected backend nor its Release bootstrap has its matching `codex-code-mode-host`,
startup saves the channel as disabled and restores the original backend. Disabled desktop
launches use `CODEX_BIN`, `PATH` and installed copies, skipping automatic repository-build discovery.
`CODEX_EXPERIMENTAL_BIN` is no longer used by the desktop app. A repository without a published
complete package reports that prerequisite instead of substituting an unrelated upstream release.
Non-native backend capabilities use a shared launch gate. The desktop passes its effective
startup selection to the bridge, which explicitly sets `CODEX_UI_EXPERIMENTAL_BACKEND=1` for
Release/Preview/Custom or `0` when disabled, overriding inherited environment values. The patched
backend reads this into `Config.experimental_backend`; a custom `CODEX_BIN` alone does not
enable extensions. Background-completion wakes and waiting guidance require this gate.
The browser bridge leaves it off. Changes take effect together with the backend after restart.
The manual `Codex UI backend release` workflow builds and verifies the Windows x64 package from
one commit, then publishes it under a `backend-v…` tag. It is never triggered by an ordinary push.

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
server/title.mjs           dedicated naming worker: isolated process, prompt, parsing and deadline
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
summary as a fallback for older servers and history. Only the experimental backend
(`CODEX_UI_EXPERIMENTAL_BACKEND=1`: Release or Preview in the desktop experimental-backend control)
advertises `description` as required, including nested calls inside `exec`; otherwise the command
tool keeps its native declaration and a description the model sends anyway is dropped. Runtime
parsing still accepts older calls. A patched `CODEX_BIN` alone does not turn it on, and rebuilding
the UI alone does not add this field to an installed app-server. Preview prepares the sandbox-enabled V8 pair published
by `openai/codex`, verifies its manifest against the source checkout's pinned hash, then verifies
the archive and binding against that manifest. It never disables the V8 sandbox to make a build pass.

## 后端准备阶段耗时

包含此改动的自编译后端在桌面“实验型后端”选择 Release / Preview 并重启后，
会通过现有本地日志记录 `codex_core::turn_preparation`。入口只检查
`Config.experimental_backend`（由启动标记 `CODEX_UI_EXPERIMENTAL_BACKEND=1` 派生）；
关闭时不取时、不记录，普通配置、模型参数和 `CODEX_BIN` 不会启用测量。
无需增加模型工具、协议参数或外部监控服务。

每条记录包含 `thread_id`、`turn_id`、固定的 `phase`、毫秒数 `duration_ms` 和 `outcome`。
`finished` 表示该阶段返回，可能包含业务错误或 Hook 拦截，并不代表成功；
`interrupted` 表示阶段未到达结束点，例如取消或提前返回。不会记录输入、附件或凭据。

| phase | 测量范围 |
| --- | --- |
| `turn_setup_total` | `run_turn` 入口到首次采样循环前的准备总耗时 |
| `guardian_input` | 需要时检查 Guardian 输入 |
| `async_hook_results` | 收集上一轮异步 Hook 结果 |
| `pre_sampling_compaction` | 启用时执行采样前压缩检查 |
| `mcp_requirements` | 解析本轮所需 MCP 与插件 |
| `step_context` | 捕获一致的工具、权限、环境与模型上下文 |
| `initial_context` | 构建并记录初始上下文 |
| `diff_display_roots` | 准备差异展示目录，与初始上下文并行 |
| `skills_and_plugins` | 准备技能与插件注入内容 |
| `session_start_hooks` | 执行待运行的会话启动 Hook |
| `guardian_finalize` | Guardian 输入定稿及需要时的压缩与重建 |
| `prompt_hooks_and_record` | 执行用户输入 Hook 并记录输入 |
| `post_input_setup` | 输入后的状态、注入、后台压缩检查与配置统计 |
| `sampling_input` | 每次采样前处理待输入、步骤激活与历史快照 |
| `sampling_setup` | 初始化本次采样的基础指令和工具运行时 |
| `prompt_build` | 每次请求/重试的提示词与请求元数据准备 |
| `request_setup` | 推理调用前的本地准备，到调用模型客户端 `stream` 为止 |

`initial_context` 还会记录内部阶段：`context_world_state`（运行环境与扩展状态），
`context_environment`（时间、Shell 版本与环境描述），其下的 `context_clock`（时钟读取）和
`context_environment_render`（Shell 版本与环境描述），`context_world_extensions`（扩展状态贡献），
`context_history_update`（完整上下文或差异构建），`context_full_render`（首次完整渲染），
`context_plugins_load`、`context_plugin_recommendations`、`context_initial_extensions`，
以及 `context_record_items`、`context_persist_world_state`、`context_checkpoint`（历史与持久化）。
这些阶段会嵌套，且只在相应路径实际执行时出现。

会话启动 Hook 分为 `session_start_request`（请求和预览准备）、
`session_start_dispatch`（执行及开始/完成事件）、`session_start_record`（附加上下文写入）。
单个 Hook 自身耗时继续使用已有 `hook/completed` 通知中的 `run.durationMs`，
不要把并行 Hook 的耗时相加当作启动 Hook 总耗时。

`turn_setup_total` 包含其内部阶段；`initial_context` 与 `diff_display_roots` 并行，
不能直接将所有行相加。`sampling_input`、`sampling_setup`、`prompt_build`、`request_setup`
也会出现在后续模型调用和重试中，应按同一轮次的日志顺序查看。
这些时间不包含 `stream` 内部的鉴权、序列化、连接、代理转发或远端模型生成；
会话初始化和模型预热继续使用原有的 `codex.startup_phase`，首字响应使用现有 TTFT 指标。

通过故障排查入口查看本地日志，或在当前日志数据库查询：

```sql
SELECT ts, thread_id, feedback_log_body
FROM logs
WHERE target = 'codex_core::turn_preparation'
ORDER BY id DESC
LIMIT 100;
```

## Checks

```sh
pnpm typecheck
pnpm test        # bridge guards, discovery and relay; the pure helpers under src/lib
pnpm exec electron desktop/title-generation-smoke.test.mjs  # isolated desktop + real backend, local model fixture
```
