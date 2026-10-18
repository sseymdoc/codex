# codex-ui 复刻审核（Claude Desktop 2.42304.0.0 · Code 标签页）

审核日期：2026-10-18。对照物：open-claude-ui `docs/claude-components-storybook.html`（W0–W22，含 6808ac9 的事实更正）与真实安装包 `Claude_2.42304.0.0_x64` 的 `ion-dist` chunk / `en-US.json`。范围只含 Code 标签页，不含 Chat 模式。

## 一、复刻诚实度

### 本轮核实并修正的项

| 项目 | 设计稿 / 安装包事实 | 本轮处理 |
| --- | --- | --- |
| 等宽字体栈 | `--cds-font-mono` = Anthropic Mono / SF Mono → ui-monospace → Menlo → Consolas | 去掉未分发的 Anthropic Mono，其余照搬（tokens.css） |
| 深色字重 | medium 460 / semibold 540 / bold 560 | `.dark` 覆盖三档字重 |
| 菜单阴影 | 1px 环来自 `--shadow-panel` 的 `--cds-ring-*` | `--cds-shadow-menu` 由 card-ring + popover 组成 |
| 用量环 | Code 外壳只在 approaching / exceeded limit 时显示；h-7 行，短文案 + 12px 环（stroke 1.5） | 阈值 75%，形态按 shared-6 wW/TW |
| 启动骨架 | `data-desktop-boot-placeholder`，10s 后让位给失败视图 | theme-init.js + App.tsx |
| 骨架折叠阈值 | 固定 700px | Boot 用 `innerWidth <= 700` |
| 重试节奏 | 0 / 15 / 30 s，±20% 抖动，180 s 内 | codex.ts `onClose` |
| 标题栏让位 | `ceil(140 / zoom)` px（Linux 120） | desktop/main.mjs `syncOverlay` |
| Quick Entry 渐变 | 纯色到纯色（无 f2 alpha） | quick.html |
| 设置搜索结果 | 按页分组：页行（图标 + 名，必要时带命中行），最多 3 条缩进子行，再加「+N more」；Ctrl+F 聚焦搜索框是真机行为 | Settings.tsx `searchSettings` 重写；Ctrl+F 保留 |
| 设置分隔 | 带标题的下一节之前，上一节最后一行 `!pb-0` | settings.css |
| 快捷键录制器 | 容器 gap-2 = 8px | settings.css |
| 关于页图标 | `#d97757` 是 Claude 品牌色 | 改为单色（文字色底 + 页面底色记号） |

### 刻意不复刻、或无法核实的项（README 已据实说明）

- 桌面壳：无应用菜单、关窗隐藏到托盘、跳转列表只有一项、zoom/theme 存在 `window-state.json`、第二实例聚焦、托盘图标不随主题换图。这些是 codex-ui 的选择，README 已与 Claude Desktop 的事实分开陈述。
- 设置弹窗尺寸：真机带侧栏且 `Pe()` 成立时放大到 `max(1024px, min(1280px, 100vw-6rem))` × `max(50rem, min(60rem, 100dvh-6rem))`；`Pe` 来自 shared-25 的 `Rm`，条件未解出，codex-ui 仍固定 1024px × 50rem。
- 设置侧栏分组：真机 Settings 组是 General / Account / Privacy / Capabilities / Memory，Customize 组是 Connectors / Plugins / Skills；About 是独立原生窗口。codex-ui 把「实验功能」放进设置组、把「关于」做成页面，是 Codex 自定分组。
- 设置弹窗退出动画（`data-ending-style`）未实现。
- 真机设置项里对 Codex 有意义但未做的：Local / Strict sandbox 模式选择（Codex 有 `windows.sandbox`）、「新会话默认开启远程控制」（协议支持非 ephemeral）、Output style（对应 `personality`）、桌面通知开关、Keep awake、Run on startup、Interface / Code font、Archive inactive sessions。
- Chat 标签页、Privacy / Capabilities 页、听写 / 语音快捷键、Worktree location、Allow bypass permissions：Claude 专有或 Codex 无对应，不移植。

## 二、Codex CLI 后端功能 → 前端对应

### 客户端方法（167 个）

- 前端已调用：105（本轮新增 `project/update`、`project/delete`）。
- 不适用于 GUI（服务端内部、legacy v1、attestation 等）：15。
- 未调用：47。其中值得注意的只剩 `thread/read`（本轮把类型表里未使用的声明删掉，避免误导）；其余是重复入口或 TUI 专属。

### 服务端请求（11 个）

前端处理 5 个：命令 / 文件改动 / 额外权限审批、`request_user_input`、MCP elicitation（含 `openai/form`，本轮在 initialize 里声明 `mcpServerOpenaiFormElicitation: true`，否则服务端不会下发表单）。其余 6 个按设计拒绝（attestation、legacy 审批等）。

### 通知（96 个）

前端处理 77 个（本轮新增 `thread/environment/connected|disconnected`，渲染为会话通知行）。未处理的主要是 realtime 转写类（语音模式已用 WebRTC 走 `thread/realtime/*` 的子集）与 `fuzzyFileSearch/*` 的会话型变体。

### 设置页每一项的后端落点

| 设置项 | 写入的键 / 调用的方法 |
| --- | --- |
| 主题、文字大小、宽度、默认视图、动效 | 浏览器 `localStorage`（真机同样存本地） |
| 模型 / 推理强度 | `config/batchWrite` `model` / `model_reasoning_effort` |
| 权限 | `approval_policy` + `sandbox_mode` |
| 托盘 / Quick Entry 快捷键 | Electron 壳层（`codexDesktop.setDesktopSettings`） |
| Windows 沙箱 | `windowsSandbox/readiness`、`windowsSandbox/setupStart` |
| 远程控制 | `remoteControl/status/read`、`enable|disable {ephemeral:true}`、`pairing/*`、`client/list|revoke` |
| 从其他代理导入 | `externalAgentConfig/detect|import` |
| 账户、额度、点数、用量 | `account/read|logout|login/start`、`account/rateLimits/read`、`account/rateLimitResetCredit/consume`、`account/usage/read` |
| 实验功能 | `experimentalFeature/list`、`experimentalFeature/enablement/set`（仅运行时；长期保留要写 `[features]`） |
| 记忆开关 | `features.memories`、`memories.use_memories`、`memories.generate_memories`、`thread/memoryMode/set` |
| 新版记忆 | `memory/status`；就绪后「启用新版」写 `memories.version = "v2"`（Codex 不会自动切换） |
| 记忆文件 | `fs/readDirectory` + `fs/readFile`，目录按 `memories.version` 选 `memories` 或 `memories_v2` |
| 插件 / 市场 | `plugin/installed|list|search|read|install|uninstall`、`marketplace/add|remove|upgrade`、`plugins.<id>.enabled` |
| 技能 | `skills/list`、`skills/config/write`、`skills/extraRoots/set`（额外目录仅运行时，前端另存本地） |
| 连接器 | `app/installed|read`、`apps.<id>.enabled`、`mcpServerStatus/list`、`config/mcpServer/reload`、`mcpServer/oauth/login` |
| Hooks | `hooks/list`、`hooks.state.<key>.enabled|trusted_hash` |
| 关于 | `initialize` 的 server info + `server/diagnostics` |

本轮修正的事实性文案：记忆页「满 20 个后启用」改为需手动启用并说明目录；关于页「所有数据都通过 app-server 读写」改为区分本地偏好；远程控制去掉无来源的「互相顶替」；Hooks 补「子代理」处理器；快捷键录制器保留表加入 codex-ui 自身快捷键，避免全局热键夺走页面快捷键。

## 三、校验

- `pnpm typecheck` 通过，`pnpm test` 40/40 通过，`vite build` 通过。
- Mock app-server 预览：浅色 / 深色、转录、审批卡、命令面板、设置页（搜索分组、记忆页、关于页）、项目重命名与删除均已实测。
