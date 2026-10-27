# Codex 0.164.0 官方优先合并报告

本轮补入上一轮受阻的 37 项官方提交：26 项文本冲突、2 项编译语义冲突、9 项依赖阻塞。连同上一轮已合入的 135 项，共纳入 172 / 175 项；剩余 3 项为已确定的范围或版本排除，见文末。旧报告保留，本文更新其未合入状态。

本报告仅对应源码整合和本地验证。尚未执行 Release 打包、安装、重启、推送或真实账户验收。

## 来源与合并边界

- 官方标签：`rust-v0.164.0`，提交 `6aaac694803004a63c6f393d153c96d22521a6b9`；最后一项功能提交为 `342ed69a174c206c1de52a59491b131e0753cfa5`。
- 官方归档：`codex-rust-v0.164.0.tar.gz`，SHA-256 `57f8c2f88fe5b6eaf08672212b6372362ca044bee43d6e57b6ad032152be772e`。
- 共同上游基线：`ce0323f2f2d3b25e82806cd555237da3db4e1897`；本轮本地起点：`c04f59e4d9cce6cf5f1f3af257027a93499a1975`。
- 隔离工作树：`.tmp/u164-official`；分支：`integration/upstream-0.164.0-official`。
- 37 项均逐项保留 `cherry picked from commit` 来源记录。独立本地适配提交与官方提交分开登记。
- 保留本地工作区身份 `0.164.0-alpha.3+codex-ui`，它不启用实验能力。
- 本轮验证源码 HEAD：`1ed953c3a00cbf67c137e76637b8478e7da8f7cd`；`codex-rs` 树：`46a2df988d123802a853e2da6cd10b2106d487f5`。
- 并行 UI 提交 `68164bd963`、`69c6b17edd`、`ee26889bb3` 已在隔离分支保留；合入前后后端树一致。UI 版本 `1.2.35` 来自并行工作，本任务未制作安装包。

## 官方源码保护与本地适配

官方改动保持原文；冲突通过迁移本地扩展、补齐本地调用方或使用官方生成器解决。未手改官方测试快照、删除官方测试或放宽断言。

1. 后台唤醒：完整保留官方 `reserve_pending_work_turn` 和 `should_wake_on_agent_messages`，本地 `background_wait.rs` 增加独立预约入口。关闭实验开关时直接调用官方入口；启用时另行检查关闭状态、计划模式、预算及后台队列。回归测试发现锁等待期间取消队列的竞态，先得到失败证据，再只在本地入口补最终队列检查。
2. 上下文快照：移除强加给官方 `WorldStateContributionInput` 的本地字段，改用既有步骤存储中的本地 `ContextSnapshotReuse` 标记；由 `Config.experimental_backend` 注入或移除。原生构造器保持不变。
3. 技能目录：保留官方步骤目录、准备接口、认证和云缓存锁；本地纯渲染缓存迁移到该接口，增加别名映射及渲染策略失效键，保留每回合调用归属。本地测试迁移并补失效覆盖。
4. 环境继承、模型钩子、WebSocket draining：保留官方锁顺序和业务流程；本地 UI 上下文及计时数据独立采集，不改写官方环境元组或钩子内容。
5. 连接器搜索：本地 `search_connectors.rs` 按官方 `Result<HeaderMap, AuthError>` 接口，在发请求前传播认证错误；全部调用位置已核对。
6. 协议生成物：stable / experimental `.zst`、JSON、TypeScript 和 Python SDK 类型均使用官方生成入口实际重建，保留本地协议扩展。
7. 本地 UI：为官方新增 `preModelRequest`、`postModelRequest` 补齐中文名称映射。

本地非原生能力沿用 `CODEX_UI_EXPERIMENTAL_BACKEND == "1"` 与 `Config.experimental_backend` 门控，覆盖声明、执行和自动调度；未引入通过普通配置、模型参数或版本号启用能力的路径。

源码审计结果：37 个官方新增源码文件与正式标签的 Git blob 完全相同；对 394 个 Rust 文件中由本轮 37 项官方提交拥有的 20,968 行进行最终归属比较，未发现受保护代码行被删除或改写。该行审计忽略空白和纯标点，不代表整棵本地扩展树与上游逐字节相同；新增文件的 blob 比较则为精确内容比较。

证据：`source-audit-1ed953c3a0.json`、`official-new-files-final.json`、`official-patches/`、`parallel-ui-provenance.json`，均位于本报告末尾的证据目录。

## 37 项逐项结果

以下各项均已通过隔离分支合回本地 `feat/codex-ui`。历史原因保留以便追溯；测试限制单独列在验收表中，不把环境失败等同于 Git 合并失败。

| 官方提交 | 本地提交 | 官方标题 | 原阻塞与处理 |
|---|---|---|---|
| `8c076942cb` | `e3f433714c` | Allow agent messages to wake idle root sessions behind a feature flag (#54961) | 官方预约与本地后台唤醒入口重叠；官方函数原样保留，本地逻辑移至独立入口。 |
| `70b3bb6d88` | `367e046c63` | Add observation-only model request lifecycle hooks (#55144) | 模型钩子与本地计时重叠，且协议二进制冲突；分离本地计时并由官方生成器重建。 |
| `d28be12577` | `c633a9f2d1` | Honor per-thread unload delays in app-server (#55270) | 协议压缩生成物或缺失前置源码导致冲突；恢复官方前置链并使用官方生成器重建协议。 |
| `a309f9206a` | `58ac075527` | Integrate discovery V2 with step-scoped skill catalogs (#55322) | 本地目录测试与额外快照字段不兼容；迁移本地测试和步骤存储标记，不修改官方接口。 |
| `d70c2c2cdf` | `6a5d5407e1` | Add configured thread environment inheritance for subagents (#55327) | 环境继承与本地 UI 上下文捕获重叠；官方锁顺序与元组保留，本地数据独立捕获。 |
| `03478b4b92` | `b3ffa68ccb` | Expose skill installations and stabilize package aliases (#55330) | 目录别名与本地快照路径重叠；接入官方目录并保留本地失效逻辑。 |
| `fbb2f9dbec` | `c915a523ee` | Use step environment snapshots for subagent inheritance (#55331) | 环境继承后续更新冲突；按官方顺序更新快照实现。 |
| `8f8e7a6e09` | `1abcf1f264` | Add experimental `thread/sample` requests to the app server (#55339) | 协议压缩生成物或缺失前置源码导致冲突；恢复官方前置链并使用官方生成器重建协议。 |
| `9b865ab31e` | `60c40e3516` | Prepare skill catalogs before building step tools (#55357) | 步骤目录重构与本地缓存交织；官方准备流程保留，本地缓存迁移并补回归。 |
| `e389b2444c` | `b1761a0608` | Add configured thread environment inheritance for subagents (#55375) | 环境继承最终更新冲突；保留官方步骤环境逻辑。 |
| `fea1d7f7d1` | `8303a0292c` | Add support for Academic Researchers plans (#55387) | 协议压缩生成物或缺失前置源码导致冲突；恢复官方前置链并使用官方生成器重建协议。 |
| `a4c9194247` | `79d76db8d1` | Add cancellation for experimental thread samples (#55441) | 协议压缩生成物或缺失前置源码导致冲突；恢复官方前置链并使用官方生成器重建协议。 |
| `014489466a` | `98f8577cbc` | Add optional MCP disablement for prediction forks and samples (#55463) | 协议压缩生成物或缺失前置源码导致冲突；恢复官方前置链并使用官方生成器重建协议。 |
| `f29d55ff06` | `6eac2d8704` | Propagate authentication header failures before sending requests (#55607) | 认证头变为可失败接口；仅适配本地连接器调用，错误在请求前返回。 |
| `e776b27eb0` | `62b7afb2db` | Add frozen cloud skill snapshots to the app server (#55631) | 云技能刷新与既有改动重叠；保留官方冻结技能实现。 |
| `cb00a67569` | `b53855495f` | Add runtime assertion authentication modes and an auth provider (#55636) | 认证接口或其后续依赖未合入；恢复官方认证链并适配本地调用后逐项应用。 |
| `66d0de9983` | `90367de592` | Add lifecycle hooks for inter-agent messages (#55657) | 代理消息钩子与本地测试重叠；保留官方实现和断言，迁移本地调用。 |
| `ec8edd576c` | `4842fd8947` | Refine enterprise MCP auth errors and request authority checks (#55691) | 认证接口或其后续依赖未合入；恢复官方认证链并适配本地调用后逐项应用。 |
| `feadd9441e` | `5b3becee81` | Preserve enterprise MCP authorization across runtime refreshes (#55696) | 认证接口或其后续依赖未合入；恢复官方认证链并适配本地调用后逐项应用。 |
| `6b13dffc5e` | `123390daf2` | Reuse Codex account grants for enterprise MCP authentication (#55698) | 认证接口或其后续依赖未合入；恢复官方认证链并适配本地调用后逐项应用。 |
| `b48277327d` | `44f7a6f444` | Centralize cloud skill cache state under the catalog lock (#55705) | 云缓存锁与前置目录迁移冲突；按官方状态结构集中缓存。 |
| `c419fd01a7` | `0f3bfd19cd` | Fix enterprise MCP credential selection and reauthentication (#55859) | 认证接口或其后续依赖未合入；恢复官方认证链并适配本地调用后逐项应用。 |
| `d138398cef` | `f249016a29` | Expand enterprise MCP authorization lifecycle test coverage (#55883) | 认证接口或其后续依赖未合入；恢复官方认证链并适配本地调用后逐项应用。 |
| `430a16799d` | `ca45d8c78c` | Preserve thread model settings across resume and revert (#55923) | 回合模型设置恢复与本地计时重叠；官方恢复实现原样保留。 |
| `a3b685331f` | `47cbd6bfa9` | Add local diagnostic ZIP exports to the app server (#55940) | 协议压缩生成物或缺失前置源码导致冲突；恢复官方前置链并使用官方生成器重建协议。 |
| `9e12b14891` | `95c3d147bc` | Refresh cloud plugin and skill catalogs after mid-turn auth changes (#55957) | 目录认证刷新依赖此前状态结构；前置目录重构恢复后按官方实现应用。 |
| `57232f111c` | `986c3c3913` | Add managed Desktop workspace storage requirements (#55965) | 协议压缩生成物或缺失前置源码导致冲突；恢复官方前置链并使用官方生成器重建协议。 |
| `3fd08b5405` | `2743fd6fe2` | Back off failed cloud skill and plugin catalog refreshes (#55968) | 目录刷新退避依赖此前状态结构；前置链恢复后按官方实现应用。 |
| `02c6a2d3f1` | `ce9c843207` | Drain WebSocket responses on mailbox preemption (#55969) | 抢占和 WebSocket draining 与本地计时、测试重叠；官方状态流程保留。 |
| `bd5a836567` | `f79944f0fc` | Refresh remote exec-server credentials after unauthorized responses (#55987) | 认证接口或其后续依赖未合入；恢复官方认证链并适配本地调用后逐项应用。 |
| `07cc649c65` | `2e14f5dc63` | Avoid double-counting retained reasoning in token usage (#55991) | token 核算与本地回合计时重叠；官方计算原样保留。 |
| `6203846fb3` | `dc62955eba` | Support confidential OAuth clients for enterprise-managed MCP auth (#56001) | 认证接口或其后续依赖未合入；恢复官方认证链并适配本地调用后逐项应用。 |
| `6f34d3d408` | `d03a12ee06` | Allow thread sampling after failed or interrupted turns (#56020) | 协议压缩生成物或缺失前置源码导致冲突；恢复官方前置链并使用官方生成器重建协议。 |
| `233119375d` | `74f8ac539a` | Keep slash command prefixes in editable composer text (#56021) | TUI 工作树测试上下文冲突；应用官方 composer 行为与测试。 |
| `943c70d8d2` | `bf10ef02dd` | Support client Responses API metadata in `thread/sample` (#56031) | 协议压缩生成物或缺失前置源码导致冲突；恢复官方前置链并使用官方生成器重建协议。 |
| `0769c6aeeb` | `8682d8a6be` | Enable executor cleanup hooks with V2 capability discovery (#56044) | V2 执行器清理钩子依赖目录重构；恢复前置链并保留官方清理流程。 |
| `342ed69a17` | `6440c62522` | Require managed configuration from the configured server (#56055) | 认证接口或其后续依赖未合入；恢复官方认证链并适配本地调用后逐项应用。 |

## 验收结果与限制

下列均为真实执行结果；环境复核分次记录，未把多次结果写成单次全绿。通过数为测试器报告值；官方测试内的平台提前返回规则保留，不能据此宣称 Linux / macOS 路径已在 Windows 实际执行。

| 检查 | 结果 | 证据／限制 |
|---|---|---|
| Debug 后端及辅助程序 `cargo build --locked --bins` | 通过 | CLI、app-server、code-mode-host、Windows sandbox / service、RMCP 测试辅助程序；`build-helpers-01.log` |
| 82 个 Windows 受影响包 `check --all-targets --keep-going` | 仍有旧基线失败 | 16 个 Rust 诊断与旧基线按错误种类和文件一致；7 个 GStreamer / GLib 系统构建依赖失败，旧日志亦存在 |
| 本地适配、快照与后台门控 | 21 / 21 通过 | `local-adapters-05-green.log`；取消竞态另保留 `04-red` 失败证据 |
| 21 个库的完整单元测试 | 6,958 项运行，环境复核后累计 6,956 项通过，2 项既有失败；5 项原有忽略 | 原轮 6,939 通过、19 失败；17 项通过正常 Windows 子进程、已构建辅助程序及真实 `python3` 转发器复核通过。`unit-nextest-02`、`unit-environment-01`、`hooks-environment-01` |
| 认证 API / SSE 集成 | 14 / 14 通过 | `api-integration-01.log`，包括认证错误不发送部分请求与重试边界 |
| app-server 集成 | 179 项运行，178 通过，1 项环境快照差异 | 采样、企业认证、线程恢复、冻结技能、诊断、配置与门控；`app-scenarios-01.log` |
| 核心进程集成 | 367 / 367 通过 | `core-scenarios-01.log`；覆盖目录、认证、代理调度、钩子、压缩与后台唤醒筛选集 |
| CLI 远端执行器认证刷新 | 1 / 1 通过 | `cli-auth-01.log`：401 刷新并重新加载轮换凭据 |
| 登录认证刷新 | 22 / 22 通过 | `login-auth-01.log` |
| code-mode-host 通信 | 12 / 12 通过 | `host-01.log`；gRPC / TCP 4 项、stdio 8 项 |
| Python SDK 合约、RPC、签名及生成检查 | 86 / 86 通过 | 官方锁定依赖和 Python 3.11；`sdk-contract-01.log` |
| 前端测试 | 467 / 467 通过 | `frontend-01.log` |
| 前端 TypeScript 类型检查 | 通过 | 补本地 HookName 映射后，`frontend-typecheck-02.json` 退出码 0 |

仍存在的旧基线与环境差异：

- `codex-exec` 4 个测试构造器缺本地 `description`；`codex-tui` 12 个构造器缺本地 `backgrounded`。不属于本轮新增编译错误；未借合并改写官方测试构造器。
- `codex-app-server-protocol::export::tests::generated_ts_optional_nullable_fields_only_in_params`：本地 `CodexUiContext` / `CodexUiDesktopContext` 的 3 个 optional nullable 字段触发既有断言。
- `codex-core::guardian::tests::guardian_ephemeral_retry_preserves_parallel_trunk_and_fork_history`：测试显式创建 4 MiB 子线程栈并溢出；已在旧主分支复现。
- `voice-host` 需要 GStreamer 1.28 / GLib / `pkg-config`，本机未提供；该包系统构建失败在旧基线亦存在，未安装全局 SDK。
- app-server 的 `sample_preserves_context_and_keeps_source_unchanged::threadhistorymode_legacy_turnstatus_completed_expects`：原线程文件字节一致性断言通过，后续上下文快照因真实用户 `~/.agents/skills` 进入目录而变化。官方 Windows `dirs` 使用系统 Known Folder，独立 `CODEX_HOME` 不能隔离；保留原测试和快照，未更改用户技能或系统配置。
- 早期 10 个 Cargo 并行编译进程发生内存不足，后续改为 1 个构建任务完成；该失败日志保留。受限进程中的 Windows API、`test_stdio_server` 缺失及 `python3` 命令缺失均经真实环境复核，不作为源码修复。

以上意味着源码整合已完成，但整个工作区全目标测试尚未全绿；本报告不宣称 Release 或真实账户运行验收通过。

## 仍未合入的全部提交：3 项

| 官方提交 | 内容 | 保留原因与后续计划 |
|---|---|---|
| `89461ea6833832b0551ce24ee32205824d5c108d` | Unix standalone 安装后清理旧版本 | 本次 Windows 实验后端范围外；将来维护 Unix 安装器时单独合入并运行安装器测试。 |
| `6fb1c3903d42e3cc7da2c89e3a045fe0ce137af4` | macOS Bazel 使用 hermetic dsymutil | 本次 Windows 实验后端范围外；将来进行 macOS Bazel 发布时合入并在 macOS 验证。 |
| `6aaac694803004a63c6f393d153c96d22521a6b9` | 正式版本号改为 `0.164.0` | 按已登记兼容例外保留 `0.164.0-alpha.3+codex-ui`；构建身份策略变更前继续排除。 |

已恢复的 37 项不再列为未合入。此前 135 项的完整映射见 [上一轮报告](upstream-0.164.0-integration-report.md)。

## 证据与工作区保护

完整证据目录：`D:/Visual_Studio/codex/.tmp/upstream-0.164.0-official-20261027-c04f59e4d9/`。原始补丁、逐次生成日志、失败日志、重试日志及旧工作树均保留。

源码已从 `ee26889bb3b193f1ea94f72b5d90f380007b1574` 快进合回本地 `feat/codex-ui`，源码 HEAD 为 `1ed953c3a00cbf67c137e76637b8478e7da8f7cd`。合回后的后端树与已验证树相同；本报告随后单独提交。

合回前后，12 个原有未提交／未跟踪文件的 SHA-256 全部一致，包括两份原有 Rust 文件、归档、CHANGELOG 和既有报告。未暂存、丢弃或清理这些文件。证据为 `pre-final-merge.json`、`post-source-merge.json`。

`commit-coverage-final.json` 已核对 172 项本地提交均在最终历史中，无丢失的官方源码文件；全部 175 项最终状态与完整 SHA 映射见 `final-commit-status.json`。

顺序验收脚本曾因目录变化未启动登录和宿主测试；其外层退出码 0 未被当成通过证据。保留 `sequential-runner-01-failure.json`，随后用绝对路径及独立进程完成两组验收，并核对各自日志和退出码。
