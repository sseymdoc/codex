# 本地环境与桌面项目兼容

**入口**：新建会话页的“选择环境”或输入框下方的环境胶囊 → 新建环境；环境行悬停时末尾的设置键（或按 →）、会话环境卡片的齿轮打开“编辑环境”。对话框照用户 Claude 现行版本（live bundle 10-25，`ca690a791` 的 `EpitaxyEnvironmentDialog`）的本地环境做：只有本地一种会话类型时，Claude 不显示“会话类型”标签，codex-ui 目前也不显示。

**对话框**：

- 名称：未手动修改时随首个文件夹自动起名；与其他环境重名时改用最近的有意义的上级文件夹名（`app (client)`），仍重名再加序号。与其他环境或保留名（本电脑、本地、SSH、云端、Remote Control）重名时提示“已有其他环境使用此名称。”或“此名称已被保留。”，并禁用提交。
- 文件夹：右侧“添加”下拉列出最近文件夹，底部“选择…”与 Claude 一样直接打开系统的“选择文件夹”对话框（桌面版经 `codexDesktop.pickFolder`；浏览器中没有系统对话框，仍用应用内的文件夹浏览）。第一个文件夹是会话启动目录，其余为附加文件夹。每行显示分支按钮、“工作树”勾选和悬停时出现的移除键。
  - 分支：未开工作树时为“将此文件夹切换到”，开工作树时为“工作树起始分支”；不选时分别指当前分支和默认分支。附加文件夹不开工作树时分支按钮禁用（开启工作树后即可选择分支。）。
  - 与前面某个文件夹同仓库的附加文件夹显示“与 {name} 相同的工作树”，或禁用勾选并说明“此文件夹与 {name} 位于同一仓库中。”。不在仓库里的文件夹显示“不是 Git 仓库”。
- 环境变量：点入子页，以 .env 格式编辑（解析、引号与转义规则移植自 Claude `c44400d5b`，与原函数 20 万例随机对拍一致）。`PATH` 和 Codex 自己为命令设置的 `CODEX_*` 变量不能覆盖。
- 有改动时关闭会先问“要创建此环境吗？”或“保存更改？”；删除环境时，如果该环境有会话，可选择保留会话或“同时删除 # 个会话”。

**数据**：环境保存为 Codex app-server 的 `project/create` 记录：原生 `name`、`roots`（启动文件夹 + 附加文件夹）和 `idempotencyKey`；工作树、分支和环境变量写在 `metadata["codexUi.environment"]`（JSON）。`project/update` 会整体替换 metadata，所以保存时保留桌面版写入的其他键（如 `appearance.*`、`codex.*`）。环境变量以明文存在 `CODEX_HOME` 的项目库里，官方桌面版也能读到。

**启动会话**：只有明确选中的环境才按它的设置启动；落在某个环境文件夹里的普通文件夹会话仍归属该环境，并带上它的环境变量。

1. 工作树：按 Codex 桌面版和 `codex-worktree` 的约定，由 bridge 在 `[desktop] git-worktree-root`（默认 `$CODEX_HOME/worktrees`）下建随机 4 位目录 / 仓库名，`git worktree add --detach` 到所选分支；同仓库的后续文件夹映射到同一工作树内。会话建好后在工作树的 Git 目录写 `codex-thread.json`（`{version:1, ownerThreadId}`），桌面版的工作树清理据此识别归属。
2. 未开工作树但选了分支：启动前在原文件夹 `git switch`。有本地改动导致切换失败时不起会话，保留草稿并提示。
3. `thread/start` 带 `runtimeWorkspaceRoots: [启动目录, ...附加文件夹]`，附加文件夹因此进入工作区根，workspace-write 下可写（与 Claude 的 `--add-dir` 一致）。
4. 环境变量作为 `config["shell_environment_policy.set"]` 传入；配置层按表合并，与 config.toml 的 `set` 共存、同名以环境为准。覆盖不随会话持久化，所以冷启动恢复和分叉时同样下发。

Git 操作由 codex-ui bridge 自己完成（`server/git.mjs`，在 `server/orchestrator.mjs` 拦截 `codexUi/git/branches`、`codexUi/git/switch`、`codexUi/worktree/create`、`codexUi/worktree/bind`），不经过 app-server，也不改 Codex 后端。

## SSH 环境

**门控**：SSH 依赖自编译后端的扩展，按 AGENTS.md 绑定“实验型后端”开关。后端只在 `CODEX_UI_EXPERIMENTAL_BACKEND=1`（即 `Config.experimental_backend`）且客户端声明 experimentalApi 时，在 `initialize` 里报告 `codexUiStdioEnvironments: true`，并接受两个新方法；否则这两个方法直接报错“requires the Codex UI experimental backend”，也不注册任何环境。codex-ui 只在收到该标志时显示“会话类型”标签（本地 / SSH）；已有的 SSH 环境在菜单里置灰，启动或恢复其会话时提示需要开启实验型后端。

- `environment/addStdio {environmentId, program, args, env?, cwd?}`：注册一个以本机子进程（stdio）为 exec-server 的环境，内部复用 `environments.toml` 中 `program` 条目的传输方式（`codex-rs/exec-server` 新增公开的 `StdioEnvironmentOptions` / `upsert_stdio_environment`），惰性连接。
- `environment/readDirectory {environmentId, path}`：经该环境的文件系统列目录，`path` 按环境自己的路径语法。

**连接**：SSH 连接（名称、`user@host` 或 `~/.ssh/config` 别名、端口、密钥）保存在 codex-ui 的本地存储中（Claude 存在其用户设置里）；添加 / 编辑对话框照 Claude 的校验规则（拒绝 `ssh://` 前缀、选项式写法、非法主机名和用户名、越界端口），可“测试连接”。会话启动时注册为 `codexui-ssh-<连接 ID>`：`ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new [-p 端口] [-i 密钥] -- 主机 "sh -lc 'exec codex exec-server --listen stdio'"`。stdin 被协议占用，只支持密钥或 ssh-agent；远端需装有 codex。后端只在内存中保存这些环境，所以冷恢复和分叉 SSH 会话前会按需重新注册。

**文件夹与启动**：SSH 环境的项目 `roots` 为空，主机与远端文件夹写在 metadata 的 `ssh` 字段。“添加”菜单可“选择…”（远端文件夹浏览，经 `environment/info` 取默认目录、`environment/readDirectory` 列目录）或“输入路径…”（必须是以 / 开头的绝对路径）。不选文件夹时用主机的默认文件夹。`thread/start` 带 `environments: [{environmentId, cwd: 第一个文件夹, runtimeWorkspaceRoots: 全部文件夹}]`，模型的命令、改文件和读文件都在远端执行；环境变量同样经 `shell_environment_policy.set` 下发。SSH 文件夹暂不提供工作树勾选（Claude 由单独的开关控制）。会话环境卡片显示主机上的文件夹，不提供“在终端中打开”。

**验证**：`codex-rs/app-server/tests/suite/v2/codex_ui_stdio_environments.rs` 覆盖开关缺失或为 0 时两个方法被拒且不注册、开启时注册与列目录、空程序和未知环境的报错及 `initialize` 标志；用新编译的 codex 以 `exec-server --listen stdio` 代替 ssh 实测：注册后 `pending`，`environment/info` 连上后 `ready`，列目录与带 `environments` 的 `thread/start` 成功，关闭开关时全部拒绝。codex-ui 单测覆盖主机只注册一次、远端文件夹与默认文件夹、未开开关时不起会话。

## 云端环境（Codex Cloud）

**范围与可用性**：云端环境把任务交给 Codex Cloud（chatgpt.com/codex）运行，不改后端，只由 bridge 代为调用 ChatGPT 的私有接口 `/wham`。“会话类型”里的“云端”标签只在以 ChatGPT 账户登录时出现；API Key 登录时已有的云端环境在菜单里置灰。bridge 的 `POST /api/cloud?c=<连接>` 只放行固定的一组路由（`server/cloud.mjs`：云环境的列表 / 详情 / 新建 / 编辑，GitHub 仓库与分支，任务的列表 / 详情 / 轮次 / 新建与追问 / 取消 / 归档 / 已读），其余一律 403；令牌经本会话 app-server 的 `getAuthStatus` 取得、401 时刷新重试一次，始终不交给页面。地址取 `CODEX_API_BASE_URL`（默认 `https://chatgpt.com/backend-api`）。`/wham` 未公开，接口可能变化或被拦截。

**对话框**：云端面板照 Claude 的云端类型：“云环境”下拉（列表底部“添加云环境…”）、所选云环境的代码仓库与任务起始分支（默认用仓库的默认分支，可搜索 GitHub 分支），以及“变量、网络访问和设置脚本是 {env} 的一部分。编辑”。名称随云环境自动起名。环境本身仍是一个 Codex 项目：`roots` 为空，metadata 的 `cloud` 字段记 `{ environmentId, branch? }`，没有本地环境变量。

**添加 / 编辑云环境**：照 Claude 的云环境表单：名称，然后“网络访问 / 设置脚本 / 环境变量”三行各开子页；添加时另选 GitHub 代码仓库（Codex Cloud 一个环境绑定一个仓库，创建后不能改；ChatGPT 未连接 GitHub 时给出“连接到 GitHub”）。网络级别映射到 Codex 的 `agent_network_access`：无 = `off`，受信任 = `on` + 常用依赖预设（`codex`），完全访问 = `on` + `all`，自定义 = 允许的域名，勾选“同时包含常见包管理器的默认列表”时叠加 `codex` 预设，否则为 `none` 预设并至少要一个域名。新建按官方扩展的默认值（通用镜像、`/workspace`、仅自己可见、开启容器缓存）；编辑时先读详情，PATCH 带回 `etag`，描述、维护脚本、共享设置等表单不改的字段原样保留，密钥一律不动。

**任务**：在云端环境里发首条消息即新建云任务（只收文字），随后主栏显示任务页，侧栏“云端”分组列出当前任务（服务端每页最多 20 个，显示最新一页；运行中 15 秒、否则 2 分钟刷新一次，与官方扩展相同）。任务页按会话的样式显示提示词、回复（含运行中的工作日志）、每轮的差异卡片和状态；运行中每 5 秒读一次详情，打开的任务有新回复时标记已读。输入框发送追问（基于最新回复的轮次，代码模式）。标题栏：取消任务（运行中）、应用到本地（选一个本地 Git 文件夹，bridge 先 `git apply --check` 再整体应用，冲突时不改任何文件）、在网页中打开、归档。云任务不是 app-server 会话，不进会话列表、历史与面板。

**验证**：`server/bridge.test.mjs` 用假 `/wham` 覆盖令牌刷新、白名单与令牌不外泄；`server/git.test.mjs` 覆盖差异整体应用或不应用；`src/lib/cloud.test.mjs` 以假 bridge 覆盖云环境解析、网络级别双向映射、新建与编辑的请求体、仓库搜索与未连接 GitHub、任务轮次（多次尝试只显示当前一条、差异轮补全最新差异、失败原因）、新建 / 追问 / 已读 / 归档 / 应用，且每个请求都经过 bridge 白名单。浏览器 + mock app-server（假 ChatGPT 令牌）+ 假 `/wham` 服务走完：选云环境与分支、编辑云环境并保存、添加云环境、建环境、发消息建任务、轮询到完成、追问、应用到本地仓库、归档。2026-10-26 经用户同意，用真实账号做过只读冒烟（只发 GET，令牌不刷新）：云环境列表与详情、GitHub 仓库、分支、任务列表都按上述结构解析正确；据此改为每页 20 个任务（超出返回 400），错误体兼容 `{ error: { message } }`，编辑时网络配置的规则与拒绝列表、devcontainer 等较新字段原样带回。该账号没有云任务，任务详情与轮次的解析只经过假服务验证。

## 本电脑与临时工作区

照 Claude 的无文件夹启动（live 10-28 `cc43287c9` 文件夹菜单的“无文件夹”项、`shared-11` 的 scratchLabel；主进程 `index.chunk-Uk7wsaDw.js` 的 `createScratchWorkspace` / `startScratchWorkspaceSweep`）：

- **默认无文件夹**：新会话页不再预填启动目录（桌面版原先是用户主目录）。只有用 `--cwd` 显式指定时，bridge 才在 hello 里带 `folder`，作为新会话的文件夹。选“本电脑”会清空文件夹，文件夹胶囊显示“选择…”，文件夹菜单顶部的“无文件夹”打勾。
- **临时工作区**：在“本电脑”且没有文件夹时发送，bridge 的 `POST /api/scratch` 会在 `<CODEX_HOME>/codex-ui/scratch-workspaces/` 下新建 `scratch-<日期>-<6 位十六进制>`，作为这个会话的 cwd。每个会话一个，不复用。Claude 放在自己的 userData 下并按账户 / 组织分目录；这里放在 CODEX_HOME 下，和定时任务目录并列。心跳任务的“此任务的新会话”在无文件夹时同样新建临时工作区。
- **显示**：会话环境卡片显示“无文件夹”，不显示路径，也没有“保存”。侧边栏按文件夹分组时，归入“不在项目中工作”。最近文件夹列表不收它。
- **清理**：页面在连接后 2 分钟清理一次，之后每 6 小时一次。`GET /api/scratch` 列出空了 1 小时、或一周内树里没有任何改动的工作区。页面用 `thread/list`（`cwd` 过滤，归档与未归档都查，`modelProviders: []`，包含全部来源）排除仍有会话在用的，其余逐个 `POST /api/scratch/remove`。bridge 删除前会再核对：目录直属根目录、名称合规、仍然过期。查询失败时什么都不删。会话换到别的文件夹后，原临时工作区里的文件不会复制过去（Claude 会复制），一周后被清理。
- **验证**：`server/scratch.test.mjs` 覆盖新建、两种过期判定、删除前的核对，以及只有 `--cwd` 才给 `folder`；`src/lib/scratch.test.mjs` 覆盖清理时排除有会话在用的（含翻页和已归档的）、查询失败不删。真实 codex 0.163 实测：会话发过首条消息后，`thread/list` 的 cwd 过滤能按原路径、正斜杠写法和大写写法找到它，归档后用 `archived: true` 也能找到；刚 `thread/start`、还没发消息的会话列不出来，但这时工作区是空的，最多被删掉一个空文件夹。浏览器 + 真实 codex + 假 Responses 实测：新会话页显示“本电脑 · 选择…”；两次发送各建一个工作区，会话 cwd 即为它，环境卡片显示“本电脑 / 无文件夹”；清理时删掉了孤立的过期工作区，有会话在用的过期工作区和新建的都保留。

## 会话环境卡片

照用户 Claude 现行版本（live bundle 10-27：`cf74bc599` 的 `RA` 环境卡片与 `vM` 数据、`c6314ba87` 的文件夹菜单 `he` 与改目录 `Z`、`cb1afaa4b` 的文件夹名与分支名菜单、`c856385e2` 的“在资源管理器中显示”、`c73f45bc3` 的保存与编辑环境、`c60746e70` 的 `Aa` / `ja`、`shared-20` 的 `Bq` / `sl`）做，按选择器行开启时的分支（底部“另存为环境”行此时不显示）。

- **首行**：会话所属环境的名称，不属于任何环境时为“本电脑”；图标本地为笔记本，SSH 为命令行。提示的标题是会话类型（本地会话 / SSH 会话），下面是本名（本地写“本电脑”，SSH 写连接的主机；有端口时加“主机 · host:port”）。环境优先按会话的 `projectId` 读取，没有再按工作目录匹配（环境变量也按这个规则下发，所以落在环境文件夹里的会话算作该环境；Claude 只认会话启动时所用的环境），不跟随新会话的环境选择。
- **保存 / 编辑环境**：不属于任何环境的本地会话，首行末尾显示“保存”（aria-label 另存为环境），点击后打开预填了工作目录的新建环境对话框；创建后和 Claude 的 `fu` 一样把新环境选为下一个新会话的环境，再用 `thread/metadata/update` 把会话移入新环境（相当于 Claude 的 `On(sessionId, env.id)`）。工作目录在 Codex 工作树根下的会话不显示“保存”：Claude 保存的是工作树的源文件夹，Codex 不提供这个信息。属于本地环境的会话改为显示齿轮“编辑环境”；SSH 环境的会话没有齿轮（Claude 的 `pu` 只给本地环境），在环境选择菜单里编辑。
- **SSH 状态**：卡片显示时、窗口重新获得焦点时，以及每 30 秒读一次上游的 `environment/status`（只读，不会触发连接）。`ready` 不显示；`pending` 在轮次进行中显示“正在连接”，否则显示“未连接”；`disconnected` 显示红色的“已断开连接”，原因写在提示的“状态”一行；`unknown`、找不到连接或未开实验型后端（此时不发请求）都显示“未连接”。Codex 没有“正在重新连接”这一状态。
- **文件夹**：工作目录显示名称和父路径，附加文件夹逐行显示（提示“附加文件夹”）。每个文件夹的菜单都分三组：“在资源管理器中显示”（本地会话；经 bridge `/api/files/reveal`，失败时提示“无法在资源管理器中显示此项。该项可能已删除或已移动。”）和“在 GitHub 上打开仓库”（origin 是 GitHub 时显示，其他主机显示“在 {host} 上打开仓库”）／“复制 ▸ 路径 · 分支名称”（没有分支时为“复制路径”）和“更改文件夹…”（只有工作目录有）／“在终端中打开”。仓库和分支取各自文件夹的 git：工作目录用会话的 `gitInfo`，附加文件夹在卡片显示时经 `command/exec` 各读一次（`folderGitInfo`，和会话的读取共用 5 秒缓存）。分支名的菜单是“复制分支名称”／“在终端中打开”，与 Claude 一致。摘要显示文件夹名，没有时显示分支名。
- **更改文件夹…**：本地会话才有。桌面版用系统的“选择文件夹”对话框，浏览器里用应用内的文件夹浏览（标题“更改工作目录”）。网络（UNC）路径直接拒绝，提示“网络（UNC）路径不能用作会话工作目录。”；`\\wsl$\…` 与 `\\wsl.localhost\…` 放行，前者改写为后者（照 `Z`）。选的就是当前目录时提示“会话已在此目录中。”。选好后发 `thread/settings/update {threadId, cwd}`，对之后的轮次生效，卡片和 Git 信息立即跟着变，并提示“会话已移至 {目录}”（轮次进行中改时提示“本轮结束后将移至 {文件夹}”）；服务端拒绝时恢复原文件夹并提示“无法更改会话目录。”。没有 `thread/settings/update` 的服务端，这个文件夹会作为覆盖在下一次 `turn/start` 时以 `cwd` 发出。真实 Codex 0.163（临时 `CODEX_HOME`，不登录）接受这个更新并在 `thread/settings/updated` 里报回新目录，但不检查目录是否存在，所以只从选择器里选。按 `core/src/session/session.rs`，改 cwd 而不指定工作区根时，根列表里的旧工作目录被换成新目录，附加根保留。宿主上下文在每次发消息前按新目录重新同步。
- **不做**：Claude 的“添加文件夹…”（Codex 只在 `thread/start` 时接受 `runtimeWorkspaceRoots`，进行中的会话加不进去；用户决定不做，2026-10-27）；会话记录开头的“在 {地点} 上启动 · 另存为环境 · 暂不”脚注（`cf74bc599` 的 `Bx`，用户决定这次不做，2026-10-27；“本轮结束后将移至 / 当前在…中工作”那一行只在 Claude 自己的换目录工具搬动临时会话时出现，Codex 不会触发）；Remote Control 的右键菜单（`gj` 的打开 / 复制链接要有会话链接，Codex 的 Remote Control 状态里没有）；改目录时的信任确认；Remote Control 会话类型。

## 验证

- 单测：`src/lib/environments.test.mjs`（metadata 编解码与合并、.env 解析校验序列化、起名、分支排序）；`src/lib/codex.test.mjs`（metadata 只在给出时发送；选中环境时先建工作树再 `thread/start`，附加文件夹映射进同一工作树并作为 `runtimeWorkspaceRoots`，变量随启动、冷恢复、分叉下发；无工作树时先切分支，失败则不起会话）；`server/git.test.mjs`（分支列表、工作树位置与游离 HEAD、失败不留目录、`codex-thread.json` 归属、切分支拒绝选项式名称）；`server/bridge.test.mjs`（bridge 自己应答这些方法）。
- 真实 Codex 0.163.0 app-server（临时 `CODEX_HOME`，不登录）：`thread/start` 接受 `runtimeWorkspaceRoots` 与 `shell_environment_policy.set`，原样回报工作区根；开启 Windows 沙盒的 workspace-write 下，附加文件夹出现在 `writableRoots` 中。
- 浏览器 + mock app-server：新建、编辑、分支菜单、工作树勾选、同仓库附加文件夹、环境变量子页（受管变量报错、完成后焦点回到入口行）、保留名报错、未保存确认、两种删除确认；发送首条消息时 bridge 在临时目录建出真实工作树（游离在所选分支），`thread/start` 的 cwd、工作区根和变量与设置一致。

## 参考证据

用户 Claude 的 HTTP 缓存（`%LOCALAPPDATA%\Claude-Data\claude_pzs8sxrjxfjjc\Cache\Cache_Data`）中 10-25 版本的 `ca690a791`（对话框）、`cd8823d73`（文件夹字段、行、分支按钮、工作树勾选）、`c3f9f1667` / `c44400d5b`（环境变量编辑与 .env 规则）、`c579ebf88`（起名）、`c2d49627e`（删除确认）、`shared-20`（会话类型名与保留名），中文取同 id 的 `claude.ai/i18n/zh-Hans.json`。SSH 部分另参照 `cf6ae6197`（SSH 连接对话框与校验）、`shared-28`（主机名与用户名规则）、`ca720915e`（远端文件夹浏览）；云端部分参照 `ca690a791` 的云端面板、`c73f2f585` / `c1d8251e4`（云环境表单与文案），`/wham` 的请求与响应结构取自 `codex-rs/backend-client`、`codex-rs/cloud-tasks-client` 和官方 VS Code 扩展的 webview。Remote Control 类型尚未接入。
