# 本地环境与桌面项目兼容

**入口**：新建会话页的“选择环境”或输入框下方的环境胶囊 → 新建环境；环境行悬停时末尾的设置键（或按 →）、会话环境卡片的齿轮打开“编辑环境”。对话框照用户 Claude 现行版本（live bundle 10-25，`ca690a791` 的 `EpitaxyEnvironmentDialog`）的本地环境做：只有本地一种会话类型时，Claude 不显示“会话类型”标签，codex-ui 目前也不显示。

**对话框**：

- 名称：未手动修改时随首个文件夹自动起名；与其他环境重名时改用最近的有意义的上级文件夹名（`app (client)`），仍重名再加序号。与其他环境或保留名（本电脑、本地、SSH、云端、Remote Control）重名时提示“已有其他环境使用此名称。”或“此名称已被保留。”，并禁用提交。
- 文件夹：右侧“添加”下拉列出最近文件夹，底部“选择…”打开文件夹选择框。第一个文件夹是会话启动目录，其余为附加文件夹。每行显示分支按钮、“工作树”勾选和悬停时出现的移除键。
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

## 会话环境卡片

首行显示笔记本图标、会话所属环境名称和设置齿轮；工作目录显示名称及父路径，其他源文件夹逐行显示。环境优先按会话的 `projectId` 读取，旧会话才按工作目录匹配；不会跟随新会话的环境选择。齿轮打开同一个编辑对话框，保存不切换当前会话的工作目录。

## 验证

- 单测：`src/lib/environments.test.mjs`（metadata 编解码与合并、.env 解析校验序列化、起名、分支排序）；`src/lib/codex.test.mjs`（metadata 只在给出时发送；选中环境时先建工作树再 `thread/start`，附加文件夹映射进同一工作树并作为 `runtimeWorkspaceRoots`，变量随启动、冷恢复、分叉下发；无工作树时先切分支，失败则不起会话）；`server/git.test.mjs`（分支列表、工作树位置与游离 HEAD、失败不留目录、`codex-thread.json` 归属、切分支拒绝选项式名称）；`server/bridge.test.mjs`（bridge 自己应答这些方法）。
- 真实 Codex 0.163.0 app-server（临时 `CODEX_HOME`，不登录）：`thread/start` 接受 `runtimeWorkspaceRoots` 与 `shell_environment_policy.set`，原样回报工作区根；开启 Windows 沙盒的 workspace-write 下，附加文件夹出现在 `writableRoots` 中。
- 浏览器 + mock app-server：新建、编辑、分支菜单、工作树勾选、同仓库附加文件夹、环境变量子页（受管变量报错、完成后焦点回到入口行）、保留名报错、未保存确认、两种删除确认；发送首条消息时 bridge 在临时目录建出真实工作树（游离在所选分支），`thread/start` 的 cwd、工作区根和变量与设置一致。

## 参考证据

用户 Claude 的 HTTP 缓存（`%LOCALAPPDATA%\Claude-Data\claude_pzs8sxrjxfjjc\Cache\Cache_Data`）中 10-25 版本的 `ca690a791`（对话框）、`cd8823d73`（文件夹字段、行、分支按钮、工作树勾选）、`c3f9f1667` / `c44400d5b`（环境变量编辑与 .env 规则）、`c579ebf88`（起名）、`c2d49627e`（删除确认）、`shared-20`（会话类型名与保留名），中文取同 id 的 `claude.ai/i18n/zh-Hans.json`。SSH、云端和 Remote Control 类型尚未接入。
