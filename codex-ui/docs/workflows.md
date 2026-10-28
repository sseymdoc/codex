# 动态工作流（workflow 工具、追踪卡片与 Ultracode）

对照用户本机 Claude Desktop（live 10-28 前端包）与 Claude Code CLI `2.1.309`：Claude 的「动态工作流」是 Workflow 工具——模型写一段 JS 编排脚本，脚本在后台派出多个子代理，转录里出现带格子的追踪卡片。Codex 原本没有这一能力，本功能在 Codex 后端新增 `workflow` 工具（受实验型后端门控），前端照 Claude 画卡片、任务面板详情、审批卡、Ultracode 开关与设置。

## 分支与 cherry-pick

功能在 `feat/codex-ui-workflow` 分支上开发，起点为 `feat/codex-ui` 的 `d07dbfc0fc`。提交按顺序：

| 顺序 | 提交 | 内容 | 依赖 |
| --- | --- | --- | --- |
| 1 | `feat(codex-rs): 动态工作流 workflow 工具…` | 协议（`ThreadItem::Workflow`、`thread/workflows/stop`、`thread/workflows/list`、`codexUiWorkflows`、`CodexUiContext.workflows`）、生成的 schema / TS / `precomputed/*.zst`、core `src/workflow/`、app-server、测试 | 无 |
| 2 | `feat(codex-ui): 动态工作流卡片…` | 前端全部：卡片与格子、任务面板详情、停止、会话栏行、`/workflows`、审批卡、Ultracode、设置、宿主上下文、测试 | 1（生成的 TS 类型） |
| 3 | `fix(codex-rs): Ultracode 生效时接管多代理模式指令` | core `session/multi_agents.rs` / `session/host_context.rs` / `workflow/mod.rs` / `workflow/ultracode_mode.md`、app-server 测试 | 1 |
| 4 | `fix(codex-rs): Ultracode 下子代理只继承推理深度，工作流代理记录实际档位` | core `agent/child_config.rs` / `agent/control/spawn.rs` / `context/world_state/multi_agent_mode.rs` / `workflow/agent.rs`、`WorkflowAgent.effort` 与生成的 schema、测试 | 1、3 |
| 5 | `fix(codex-ui): 工作流代理表显示实际档位，关键字回合明确走 workflow` | `Workflow.tsx`、`context/index.mjs`、本文档 | 2、4（生成的 TS 类型） |

只挑后端时前端不受影响（旧前端不发 `workflows` 宿主上下文块，工具不会声明）。cherry-pick 冲突通常只出现在生成文件：重新运行 `write_schema_fixtures_from_env`（`CODEX_APP_SERVER_SCHEMA_EXPERIMENTAL=0` 与 `=1` 各一次）覆盖即可；`.zst` 也可以按 `{typescript, json_schema, internal_json_schema}` 条目三方合并后用 zstd 19 级回压。

## 后端（实验型后端门控）

| 部分 | 做法 |
| --- | --- |
| 声明 | `spec_plan.rs`：实验型后端、根代理、代码模式宿主可用、宿主上下文 `workflows.enabled` 全满足才注册；handler、RPC、唤醒各自再查 |
| 脚本执行 | 代码模式 V8 宿主单独开 session（与 `Feature::CodeMode` 无关）；自写 delegate；单行 prelude 提供 `agent` / `parallel` / `pipeline` / `phase` / `log` / `workflow`（嵌套一层）/ `args` / `budget`，`Math.random`、`Date.now`、无参 `Date` 抛错 |
| 校验 | `export const meta = {…}` 必须是首句纯字面量；用一个小 cell 求值 meta 并对正文做语法预检；内联脚本静态拒绝不确定调用；控制字符与超过 512 KiB 拒绝 |
| 子代理 | `codex_delegate` 一次性会话：审批固定 never（不弹审批，提权操作失败）、ephemeral、关掉多代理与 workflow 工具；`schema` 走 strict 结构化输出；并发 `min(16, CPU-2)`，单次运行最多 1000 个代理，单次 `parallel` / `pipeline` 最多 4096 项 |
| 进度 | 扩展条目 `workflow.run`：同一 id 反复发 `item/started` 全量快照（500 ms 节流），结束发 `item/completed`；rollout 只持久化启动快照与最终条目 |
| 审批 | 审批策略不为 never 时先发 pending 快照（带脚本与 args），再经 `request_user_input` 询问，问题 id `codex_ui_workflow_approval:<callId>`，选项 `Run workflow` / `Allow for this session`（仅按 name 调用）/ `Decline` |
| 结果 | `<workflow_result>` 片段（status、summary、result 截断 8000 字、failures、续跑说明、usage）走后台唤醒通道；完成时才取唤醒 token，主回合中断也照样回送；显式停止不回送 |
| 续跑 | 脚本保存到 `$CODEX_HOME/workflows/<thread>/scripts/`，`journal.jsonl` 记每个 `agent()` 的结果；`resumeFromRunId` 复用最长未改变前缀 |
| 已保存工作流 | 按 `meta.name` 查找项目内 `.codex/workflows/*.js`（逐级向上）与 `$CODEX_HOME/workflows/*.js` |
| Ultracode | `CodexUiContext.workflows` 的世界状态段：开启时发开启提醒，开过之后关掉才发关闭提醒 |
| 与「极限」并存 | 多代理 V2 模型（带 ultra 档的都是）有一条常驻的多代理模式指令（变化时重发）：Ultra 下是主动 spawn_agent，其余档位是「用户明说才派子代理」，两者都和 Ultracode 打架。Ultracode 生效时（还要求代码模式宿主可用，与 workflow 工具声明同条件）`effective_multi_agent_mode` 改发 `workflow/ultracode_mode.md`（委派走 workflow、spawn_agent 只做单个旁支、开关即用户明确同意），优先于配置与目录的 hint；关掉后自动恢复原生文案；模式变成 None（冷恢复时关掉了 agents）时也像 Proactive 一样补发 ExplicitRequestOnly 撤回。「极限」只剩推理深度（按 `multi_agent_reasoning_effort` → max → 最高非 ultra 档发出）：Ultracode 下 `prepare_agent_spawn_config` 把子代理（spawn_agent V1/V2 与 workflow `agent()`）继承或显式要的 Ultra 换成这个具体档位，子代理不再主动委派；fork 时丢掉 `<codex_ui_ultracode>` 片段（子代理没有 Ultracode）。关键字回合的提醒写明「走 workflow，不走 collaboration 工具」，压过 Ultra 的主动模式。前端照 Claude 现行版不联动 |

## 前端

| 场景 | 行为（Claude 参照） |
| --- | --- |
| 运行中 / 待审批 | 318px 卡片：标题、`工作流` 或 `正在启动工作流`、`N 个智能体`、计时、格子（换行最多 8 行，末尾一个待出现格）；点击在后台任务中定位到该运行（c3fef5c6f `oS` / `IC`） |
| 结束 | 单行 `已运行工作流 {name}`，停止或失败加徽标，悬停说明原因；被拒绝的写 `运行工作流 … 已拒绝` |
| 格子 | 每个代理一格；超出容量按状态比例压缩且每种状态至少一格；运行格按黄金比例错相脉动，90 秒无进展为停滞（黄色），失败红色（`Gx` / `Px` / `Rx`，与 Claude 原函数对拍 2 万轮 0 差异） |
| 后台任务面板 | 旧版 `PC` 布局：标题、停止按钮、状态与计时、智能体数与 token、描述、失败 / 停止说明框、阶段列表（运行中默认展开，16 格一行）、代理表（智能体 / 模型 / Token / 时间；模型列照模型药丸接上实际档位，如「GPT-5.5 超高」，取自 `WorkflowAgent.effort`，Claude 的表不显示档位；窄宽度依次隐藏 Token 与智能体列，错误可聚焦看原文） |
| 会话栏 | 工作流与子代理同用 AgentsSimple 图标，标题、计时、停止 |
| 停止 | `thread/workflows/stop`，共用「正在停止…」状态；后端已无该运行时就地标为已停止 |
| 重启后的残留 | 历史里仍为运行中的条目，首次显示时问一次 `thread/workflows/list`，不在列表中即标为已停止（`Y`） |
| 审批卡 | 通用工具卡：`允许 Codex 运行工作流 {name}？`、描述、可折叠带行号的脚本、args、用量提醒（链接打开任务面板）；拒绝 / 允许一次 / 在本次会话中允许 / 始终允许（仅已保存工作流，记在本机 `codex-ui:workflow-allow`） |
| Ultracode | 新版形态：合并模型菜单与独立努力弹层的滑块下一行开关，药丸尾部 ` · Ultracode`（pro 色）；按会话保存（`codex-ui:ultracode`，草稿的选择随会话建立迁移）；切换即同步宿主上下文 |
| 关键字 | 消息里单独出现的 `ultracode`（不在引号、反引号、括号、标签内，不接 `/` `\` `-`，不是 `ultracode?` 或 `ultracode.js`）让本回合附带 `codex-ui.workflow-keyword` 提醒 |
| 设置 | 设置 → 会话 → 动态工作流程（默认开，`codex-ui:dynamic-workflows`）；只在后端报告 `codexUiWorkflows` 时显示；关掉后不再声明工具，Ultracode 不可用 |
| `/workflows` | 别名 `/workflow`，打开后台任务并展开已完成区 |

## 本次不做

- `isolation: 'worktree'`（调用时报不可用）、暂停 / 跳过 / 重试单个代理、规模过大警告条、panels 版详情（`CC`）、保存工作流的界面、Ultracode 开启时滑块的光效。
- 每 10 条消息一次的 Ultracode 简短复述提醒（宿主上下文只在开关变化时注入）。

## 验证

- Rust：`codex-extension-items`、`codex-app-server-protocol`、`codex-rollout`、`codex-app-server-transport`、core 相关子集、app-server 的 `codex_ui_workflows`（真实 V8 宿主 + 假模型：实验型后端关闭时无标记且 RPC 报错、设置关闭不声明工具、审批后两个代理并行完成并唤醒父线程、停止后不回送）。
- 前端：`node --test`、`tsc`；端到端用本分支编出的 `codex.exe` + 假模型 + 无头 Edge：Ultracode 随草稿迁移、卡片 / 面板 / 结束行 / 回送、失败代理、面板停止、审批卡允许一次、关键字、设置关闭撤回工具。
