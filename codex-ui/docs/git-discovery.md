# Git 自动识别与窗口差异

验证日期：2026-10-20；后端为桌面实际使用的 Codex 0.163.0。

## 原因

- 新建会话的 `thread/start` 通过 `build_thread_from_snapshot` 返回 `gitInfo: null`；实测临时会话重现。
- 持久化后 `thread/read` / `thread/list` 能返回保存的 Git 信息。原环境栏只读 `thread.meta.gitInfo.branch`，新会话缺少补取，旧会话又可能一直显示保存时的分支。
- 原发送路径没有把界面检测的 Git 数据交给模型。界面显示分支不等于模型收到仓库状态，更不等于自动执行提交。

## Claude 对照

只读检查用户提供的 `F:\REA\Claude_2.42304.0.0_x64__pzs8sxrjxfjjc`，没有运行 Claude。

| 目标 | 静态证据 |
| --- | --- |
| `ion-dist/assets/v1/cc43287c9-DAfOi8yP.js`，`JZ` | 新建页按选中目录查询 Git，5 秒 freshness，窗口获得焦点时刷新 |
| `ion-dist/assets/v1/cf74bc599-D9NZWRyl.js`，`cO` / `fO` | 旧会话仍按工作目录查询，以实时分支覆盖历史元数据 |
| `ion-dist/assets/v1/shared-11-BuQ3CK5I.js`，`Rd` / `zd` / `Id` | 按 cwd 缓存、snapshot 初始化、状态订阅与晚到结果保护 |
| `app.asar/.vite/build/index.chunk-C_qk6eGw.js`，`GitStatusService` | 5 秒缓存；没有 origin 的本地仓库也返回 Git 信息 |
| `index.chunk-Bn6onBlX.js` / `index.chunk-lzaSYO3Q.js` | Git 变化使缓存失效并向窗口分发更新 |

REA 前端父证据：`ev_88edb8e5eba4e169efa137957714f645467320351845e36bd0efd7e49871125e`。
ASAR SHA-256：`8f4d3dec5e4f3ddffb150321060b18807d83a40f3a65618fe4f29325379da9db`。
REA 范围为三个前端 bundle；后续主进程和共享模块证据来自定向静态读取。

## Codex 适配

- 新建页、会话环境栏和消息发送共享按 cwd 查询的 Git 快照，5 秒缓存；打开会话、窗口获得焦点、工作目录改变、命令/文件操作和轮次完成时刷新。
- 有限时的只读 `command/exec`，禁用 fsmonitor 和可选写锁；覆盖无远程、空仓库、detached HEAD、重命名和读取失败。
- 保存最后成功快照供界面使用；临时失败以 `unavailable` 交给模型。变更期间未完成的读取会重新查询，旧目录结果不能覆盖新目录。
- `turn/start.additionalContext` 分开传递时间戳快照（`untrusted`）和 Git 工作流指示（`application`），不改写用户消息。仓库值不进入开发者指令，远程地址移除凭据、查询参数和片段。
- 工作流指示要求先检查状态、保护其他改动、验证后选择性本地提交，并尊重用户例外；不自动初始化仓库或推送。

模型上下文是 Codex 适配设计：没有从 Claude 桌面包确认 Claude CLI 的提示词注入方式，也没有观察到“检测 Git 后无条件自动提交”的机制。没有移植 Claude 的 `add -A` 行为。

## 验证

- `npm test --prefix codex-ui`：194 项通过；`npm run build --prefix codex-ui` 通过。
- Chrome + 真实 Codex 0.163.0 app-server + 独立 CODEX_HOME / Git 测试仓库：新会话首次发送即显示 `ui-git-before`。
- 仅在测试仓库切换到 `ui-git-after`，数据库仍保存 `ui-git-before`；重新打开已有会话，环境栏显示 `ui-git-after`。
- 模型替身只监听本机：在实际 `/v1/responses` 请求中确认初始及更新后的快照，数据为 user 上下文，工作流为 developer 上下文。未用真实模型判断其是否一定遵循提交指示。
- 本地证据保存在被忽略的 `codex-ui/out/git-validation/`。早期采样误取历史第一份快照，已保留记录并修正为最新快照；最后一次采样断言通过。

此次验证没有替换已安装的桌面程序，也没有重启用户正在运行的会话。该版本使用前端事件刷新，没有复制 Claude 的主进程文件系统 watch；外部修改会在回到窗口或下一次刷新时出现。
