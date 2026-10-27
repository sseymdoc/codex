# Codex 0.164.0 上游同步报告

日期：2026-10-27。仅同步后端及必要配套，保留本地构建身份和实验型后端开关。

## 处理结果

| 分类 | 提交数 | 处理 |
|---|---:|---|
| 已合入 | 135 | 整提交 `cherry-pick -x`，保留上游来源 |
| 试合并冲突 | 26 | 保留冲突路径和日志，整项暂缓 |
| 编译语义冲突 | 2 | 需适配本地扩展，整项暂缓 |
| 依赖阻塞 | 9 | 依赖已暂缓的认证接口，未留下不完整调用链 |
| 范围／版本排除 | 3 | 保留本地版本，跳过独立发布维护 |
| 总计 | 175 | 174 个普通提交及 1 个发布版本提交 |

未拆分冲突提交，未使用 `ours`／`theirs` 强行覆盖，也未将整个上游标签标记为已合并。

## 来源与交付身份

- 上游：[官方 rust-v0.164.0 发布](https://github.com/openai/codex/releases/tag/rust-v0.164.0)。
- 发布提交：`6aaac694803004a63c6f393d153c96d22521a6b9`。
- 发布源码树：`d0caeb3c076fbeade281c18295fada090c52cf8f`；已从本地压缩包内容重新计算并与官方匹配。
- 压缩包 SHA-256：`57f8c2f88fe5b6eaf08672212b6372362ca044bee43d6e57b6ad032152be772e`。
- 起始本地提交：`4ce80d9cbd94ba1b432998433694d9d9a9f8539a`；共同上游基线：`ce0323f2f2d3b25e82806cd555237da3db4e1897`。
- 集成代码提交：`7a7990c382a3bd55811300e8dc72a80d4d00dd46`；报告提交随后附加。
- 验证源码：`9711cd58588c5ceb2b829df8e65b73d203e94207` 加 4 项锁文件版本校准；校准已提交为 `e519108b2d`。
- 已验证后端源码树：`dfd7fd0df01671d59c2bdce61ab43dec9dde482f`，合入并行 UI 提交后完全一致。
- 保留并行提交：`2a19fae657`、`0634280a42`、`20efe70f3e`；前端版本随其保持为 `1.2.34`。
- 后端版本保持 `0.164.0-alpha.3+codex-ui`；新增 4 个工作区包的锁文件版本由 Cargo 对齐，未额外升级第三方依赖。
- 使用 Rust `1.99.1`、Windows x64 MSVC 和校验过的 V8 `152.2.0`；系统默认 Rust 仍为 `1.95.0`。

## 验证结果

| 检查 | 结果与边界 |
|---|---|
| Windows Debug 后端及配套程序 | `cargo build --locked` 成功；未制作或安装 Release 包 |
| 75 个受影响 Windows 包及测试目标 | 无新增编译错误；16 个错误与原始主分支逐条一致 |
| 核心单元测试，nextest 隔离执行 | 2,713 通过、1 个既有栈溢出失败、3 个原有忽略用例；与普通运行的测试名称集合一致，4 个重复注册条目去重 |
| 其余 13 个 Rust 模块单测 | 2,120 通过、1 个既有协议规则失败、2 个原有忽略用例 |
| app-server 实验门控和宿主上下文 | 20 通过；使用实际 app-server 进程与本地模型／MCP 模拟服务 |
| code-mode-host | stdio 8 通过、gRPC 4 通过 |
| 前端完整测试与类型检查 | 462 通过，`tsc --noEmit` 通过；保留并行 UI 提交后执行 |
| 协议生成物一致性 | TypeScript、JSON、稳定及实验预计算产物一致性测试均通过 |
| 实验门控静态复核 | 46 个含门控的文件，相关门控语句与本地基线一致 |
| 回归断言有效性 | 临时把关键路径比较符 `>` 改成 `>=`，并列完成时间用例失败；恢复原始字节后通过 |
| Python 打包测试 | 27 项运行，5 个平台相关错误、2 个跳过；错误已在原始主工作区复现 |

Rust 最终汇总共有 4,833 项通过。没有删除测试、修改断言或接受新快照来消除失败。

门控覆盖启动标记缺失、`0`、非标准值、`1`，以及关闭时直接请求扩展能力、普通配置不能启用扩展、动态撤销、子线程继承等路径。`AGENTS.md` 中的构建身份例外保持不变。

前端预热退出用例在受限执行环境失败；在正常 Windows 进程权限下，以四路并发执行全部 462 项测试通过。两次失败和复核日志均保留。

### 保留的原有失败

- `codex-exec` 的 4 个测试构造器缺少本地 `description` 字段；原始主分支 Rust 1.95.0 下复现。
- `codex-tui` 的 12 个测试构造器缺少本地 `backgrounded` 字段；原始主分支复现。
- `generated_ts_optional_nullable_fields_only_in_params` 拒绝原有 `CodexUiContext`／`CodexUiDesktopContext` 的 3 处可空字段；原始主分支复现相同字段列表。
- `guardian_ephemeral_retry_preserves_parallel_trunk_and_fork_history` 显式创建 4 MiB 子线程栈，出现 `STATUS_STACK_OVERFLOW`；原始主分支复现。增加外层 `RUST_MIN_STACK` 不改变该显式子线程限制。
- Python 打包测试的 Unix／macOS 可执行权限检查在 Windows 下失败；原始主工作区复现相同 5 个错误。

Linux 专用包和其他操作系统运行未验证；未进行安装、重启、推送或真实云模型调用。

## 试合并冲突：26 项

| 上游提交 | 原提交标题 | 冲突路径 |
|---|---|---|
| [8c076942cb](https://github.com/openai/codex/commit/8c076942cb70fba8e5c4732c23f1faabc4aed484) | Allow agent messages to wake idle root sessions behind a feature flag (#54961) | `codex-rs/core/src/session/turn_input.rs`<br>`codex-rs/core/src/tasks/mod.rs` |
| [70b3bb6d88](https://github.com/openai/codex/commit/70b3bb6d8814ab3f2045238b4ae14c43da99783b) | Add observation-only model request lifecycle hooks (#55144) | `codex-rs/app-server-protocol/schema/precomputed/app-server-exports-experimental.json.zst`<br>`codex-rs/app-server-protocol/schema/precomputed/app-server-exports-stable.json.zst`<br>`codex-rs/core/src/session/turn.rs` |
| [d28be12577](https://github.com/openai/codex/commit/d28be12577cf5e267c97d3018a490d76da4d28e7) | Honor per-thread unload delays in app-server (#55270) | `codex-rs/app-server-protocol/schema/precomputed/app-server-exports-experimental.json.zst` |
| [d70c2c2cdf](https://github.com/openai/codex/commit/d70c2c2cdf0226b4b5d393d30c6785850d0ce85b) | Add configured thread environment inheritance for subagents (#55327) | `codex-rs/core/src/session/mod.rs` |
| [03478b4b92](https://github.com/openai/codex/commit/03478b4b9217a6ff66eb343a5242b644ea0ce61c) | Expose skill installations and stabilize package aliases (#55330) | `codex-rs/core/tests/suite/scenarios.rs`<br>`codex-rs/ext/skills/src/world_state_catalogs.rs` |
| [fbb2f9dbec](https://github.com/openai/codex/commit/fbb2f9dbec300d59699e52a47ecd9fa49f28b948) | Use step environment snapshots for subagent inheritance (#55331) | `codex-rs/core/src/session/mod.rs` |
| [8f8e7a6e09](https://github.com/openai/codex/commit/8f8e7a6e095d36b9375b5202e05fc9d1bdb95584) | Add experimental `thread/sample` requests to the app server (#55339) | `codex-rs/app-server-protocol/schema/precomputed/app-server-exports-experimental.json.zst` |
| [9b865ab31e](https://github.com/openai/codex/commit/9b865ab31e2c225cb82d99d1e62d7a6f670729ca) | Prepare skill catalogs before building step tools (#55357) | `codex-rs/core/src/session/mod.rs`<br>`codex-rs/core/src/session/world_state.rs`<br>`codex-rs/ext/skills/src/aliases.rs`<br>`codex-rs/ext/skills/src/catalog_state.rs`<br>`codex-rs/ext/skills/src/invocation_tests.rs`<br>`codex-rs/ext/skills/src/state.rs`<br>`codex-rs/ext/skills/src/tools/installations.rs`<br>`codex-rs/ext/skills/src/tools/mod.rs`<br>`codex-rs/ext/skills/src/tools/read.rs`<br>`codex-rs/ext/skills/src/world_state_catalogs.rs`<br>`codex-rs/ext/skills/tests/skills_extension.rs`<br>`codex-rs/ext/skills/tests/skills_extension/merge_catalog_tests.rs`<br>`codex-rs/ext/skills/tests/skills_extension/presentation_dedup_tests.rs` |
| [e389b2444c](https://github.com/openai/codex/commit/e389b2444c75cbc92d40b2135ca5db300d076979) | Add configured thread environment inheritance for subagents (#55375) | `codex-rs/core/src/session/mod.rs`<br>`codex-rs/core/src/session/step_context.rs` |
| [fea1d7f7d1](https://github.com/openai/codex/commit/fea1d7f7d163521a868c344527da79ba0efc146d) | Add support for Academic Researchers plans (#55387) | `codex-rs/app-server-protocol/schema/precomputed/app-server-exports-experimental.json.zst`<br>`codex-rs/app-server-protocol/schema/precomputed/app-server-exports-stable.json.zst` |
| [a4c9194247](https://github.com/openai/codex/commit/a4c9194247c6a1e79aa3e72cc6cd77238f2ed354) | Add cancellation for experimental thread samples (#55441) | `codex-rs/app-server-protocol/schema/precomputed/app-server-exports-experimental.json.zst`<br>`codex-rs/app-server-protocol/src/protocol/common.rs`<br>`codex-rs/app-server-protocol/src/protocol/v2/thread_sample.rs`<br>`codex-rs/app-server/src/message_processor.rs`<br>`codex-rs/app-server/src/request_processors/thread_processor.rs`<br>`codex-rs/app-server/src/thread_sample.rs`<br>`codex-rs/app-server/tests/suite/v2/thread_sample.rs` |
| [014489466a](https://github.com/openai/codex/commit/014489466a1739c2c563cdfe57880c2c7c8680e3) | Add optional MCP disablement for prediction forks and samples (#55463) | `codex-rs/app-server-protocol/schema/precomputed/app-server-exports-experimental.json.zst`<br>`codex-rs/app-server-protocol/src/protocol/v2/thread_sample.rs`<br>`codex-rs/app-server/src/thread_sample.rs`<br>`codex-rs/app-server/tests/suite/v2/thread_sample.rs` |
| [e776b27eb0](https://github.com/openai/codex/commit/e776b27eb0422c3d10fba676c632ff08ffb4469b) | Add frozen cloud skill snapshots to the app server (#55631) | `codex-rs/app-server/src/mcp_refresh.rs` |
| [66d0de9983](https://github.com/openai/codex/commit/66d0de9983e82b266e89ee29523324c9d08a5472) | Add lifecycle hooks for inter-agent messages (#55657) | `codex-rs/core/src/session/turn_input_tests.rs`<br>`codex-rs/core/tests/suite/agent_control_tests.rs` |
| [b48277327d](https://github.com/openai/codex/commit/b48277327d427b92ace30c1ee9d4817f8fa836b7) | Centralize cloud skill cache state under the catalog lock (#55705) | `codex-rs/ext/skills/src/cloud_cache_tests.rs`<br>`codex-rs/ext/skills/src/state.rs` |
| [430a16799d](https://github.com/openai/codex/commit/430a16799d90e296fb27b1e94f206023902b7e56) | Preserve thread model settings across resume and revert (#55923) | `codex-rs/core/src/session/turn.rs` |
| [a3b685331f](https://github.com/openai/codex/commit/a3b685331fc700bec554b2fe2a929a65f4fe1548) | Add local diagnostic ZIP exports to the app server (#55940) | `codex-rs/app-server-protocol/schema/precomputed/app-server-exports-experimental.json.zst`<br>`codex-rs/app-server-protocol/schema/precomputed/app-server-exports-stable.json.zst` |
| [9e12b14891](https://github.com/openai/codex/commit/9e12b148918b6189b90ccd33be68f7811adfe81f) | Refresh cloud plugin and skill catalogs after mid-turn auth changes (#55957) | `codex-rs/ext/skills/src/cloud_cache_tests.rs`<br>`codex-rs/ext/skills/src/skills_extension_state.rs`<br>`codex-rs/ext/skills/src/state.rs` |
| [57232f111c](https://github.com/openai/codex/commit/57232f111c50e59d748d010048c9e10832ed79d7) | Add managed Desktop workspace storage requirements (#55965) | `codex-rs/app-server-protocol/schema/precomputed/app-server-exports-experimental.json.zst`<br>`codex-rs/app-server-protocol/schema/precomputed/app-server-exports-stable.json.zst` |
| [3fd08b5405](https://github.com/openai/codex/commit/3fd08b540570a5dd9c61d98560a0231f7b43891f) | Back off failed cloud skill and plugin catalog refreshes (#55968) | `codex-rs/core/tests/suite/skills_extension/cloud_lifecycle_tests.rs`<br>`codex-rs/ext/mcp/src/cloud_plugin.rs`<br>`codex-rs/ext/mcp/src/cloud_plugin_tests.rs`<br>`codex-rs/ext/skills/src/cloud_cache_tests.rs`<br>`codex-rs/ext/skills/src/skills_extension_state.rs`<br>`codex-rs/ext/skills/src/state.rs` |
| [02c6a2d3f1](https://github.com/openai/codex/commit/02c6a2d3f1a0b906f53770ad45ef61327509d551) | Drain WebSocket responses on mailbox preemption (#55969) | `codex-rs/core/src/session/turn.rs`<br>`codex-rs/core/src/stream_events_utils.rs`<br>`codex-rs/core/src/tools/parallel.rs`<br>`codex-rs/core/tests/suite/hooks.rs` |
| [07cc649c65](https://github.com/openai/codex/commit/07cc649c658be7018b6913299f12f843b24679f8) | Avoid double-counting retained reasoning in token usage (#55991) | `codex-rs/core/src/session/turn.rs` |
| [6f34d3d408](https://github.com/openai/codex/commit/6f34d3d40816dac9d7a6ca94c3e3974b3f40c532) | Allow thread sampling after failed or interrupted turns (#56020) | `codex-rs/app-server-protocol/schema/precomputed/app-server-exports-experimental.json.zst`<br>`codex-rs/app-server-protocol/src/protocol/v2/thread_sample.rs`<br>`codex-rs/app-server/src/thread_sample.rs`<br>`codex-rs/app-server/tests/suite/v2/thread_sample.rs` |
| [233119375d](https://github.com/openai/codex/commit/233119375db96d7b71acc5b17138c41114385167) | Keep slash command prefixes in editable composer text (#56021) | `codex-rs/tui/tests/suite/worktree_stack.rs` |
| [943c70d8d2](https://github.com/openai/codex/commit/943c70d8d203c61404744939eb64a1261acd5d97) | Support client Responses API metadata in `thread/sample` (#56031) | `codex-rs/app-server-protocol/schema/precomputed/app-server-exports-experimental.json.zst`<br>`codex-rs/app-server-protocol/src/protocol/v2/thread_sample.rs`<br>`codex-rs/app-server/src/thread_sample.rs`<br>`codex-rs/app-server/tests/suite/v2/thread_sample.rs` |
| [0769c6aeeb](https://github.com/openai/codex/commit/0769c6aeeb1a81cec715e496d2486ece6fcef21b) | Enable executor cleanup hooks with V2 capability discovery (#56044) | `codex-rs/core/src/hook_runtime.rs`<br>`codex-rs/core/src/session/mod.rs`<br>`codex-rs/core/src/session/step_context.rs`<br>`codex-rs/core/src/session/tests.rs`<br>`codex-rs/core/tests/suite/executor_discovery_v2.rs` |

其中部分后续提交因其前置提交已暂缓而出现修改／删除冲突；这些保留在首次试合并冲突分类，未重复计入后续依赖阻塞。

## 编译语义冲突：2 项

| 上游提交 | 原提交标题 | 原因 |
|---|---|---|
| [a309f9206a](https://github.com/openai/codex/commit/a309f9206aacc2feffde83ab7d8c50527fddcae3) | Integrate discovery V2 with step-scoped skill catalogs (#55322) | 新增 SkillCatalog::is_partial 与本地 context_snapshot_tests 构造器不兼容；上游新增 WorldStateContributionInput 构造器遗漏本地 reuse_context_snapshots 字段。扩展检查产生 9 个 E0063，需另行适配本地上下文快照扩展。 |
| [f29d55ff06](https://github.com/openai/codex/commit/f29d55ff0697a88226e8a9811b3c007e5f719cba) | Propagate authentication header failures before sending requests (#55607) | AuthProvider::to_auth_headers 改为 Result<HeaderMap, AuthError>，与本地 search_connectors.rs:135 的既有调用不兼容；check-02.log 记录 E0599。需要另行适配本地扩展。 |

## 依赖阻塞：9 项

以下提交依赖被暂缓的 `f29d55ff06` 认证接口变更，或其后续链条。先保留本地连接器搜索的有效接口，再由后续单独任务处理该组适配。

| 上游提交 | 原提交标题 | 证据／阻塞路径 |
|---|---|---|
| [cb00a67569](https://github.com/openai/codex/commit/cb00a67569450aea2fdb1b1f31fc042fc0b5416f) | Add runtime assertion authentication modes and an auth provider (#55636) | RuntimeAuthProvider 依赖 f29d55ff06 引入的 Result 返回值与 AuthError::Policy；unit-01.log 记录 E0053/E0599，主程序未引用该模块，已扩展全部受影响包的检查。<br>`codex-rs/runtime-agent-instance/src/auth.rs`<br>`codex-rs/runtime-agent-instance/src/manager_tests.rs` |
| [ec8edd576c](https://github.com/openai/codex/commit/ec8edd576cb4f938e44d3e837ae4e369b44083d5) | Refine enterprise MCP auth errors and request authority checks (#55691) | 移除前置不兼容提交后，整提交重新应用出现冲突；未手工解决。<br>`codex-rs/rmcp-client/src/streamable_http_retry_tests.rs` |
| [feadd9441e](https://github.com/openai/codex/commit/feadd9441e67f2d8970ffc390212c32f3dfbba43) | Preserve enterprise MCP authorization across runtime refreshes (#55696) | 移除前置不兼容提交后，整提交重新应用出现冲突；未手工解决。<br>`codex-rs/rmcp-client/src/ema_http_client.rs` |
| [6b13dffc5e](https://github.com/openai/codex/commit/6b13dffc5e4c334fe87f823b214ed15a4bf37a11) | Reuse Codex account grants for enterprise MCP authentication (#55698) | 移除前置不兼容提交后，整提交重新应用出现冲突；未手工解决。<br>`codex-rs/codex-mcp/src/ema_auth.rs` |
| [c419fd01a7](https://github.com/openai/codex/commit/c419fd01a70dd1d05356da443ac44328bda2e6f4) | Fix enterprise MCP credential selection and reauthentication (#55859) | 移除前置不兼容提交后，整提交重新应用出现冲突；未手工解决。<br>`codex-rs/codex-mcp/src/ema_account.rs`<br>`codex-rs/codex-mcp/src/ema_auth.rs`<br>`codex-rs/codex-mcp/src/ema_token_source.rs`<br>`codex-rs/codex-mcp/src/lib.rs`<br>`codex-rs/codex-mcp/src/mcp/mod_tests.rs` |
| [d138398cef](https://github.com/openai/codex/commit/d138398cef7d49e46fe33f1d0ddbd2ca0ed16aa4) | Expand enterprise MCP authorization lifecycle test coverage (#55883) | 移除前置不兼容提交后，整提交重新应用出现冲突；未手工解决。<br>`codex-rs/app-server/tests/suite/v2/account_enterprise_tests.rs` |
| [bd5a836567](https://github.com/openai/codex/commit/bd5a836567bf4182f327f08ac4af626525705806) | Refresh remote exec-server credentials after unauthorized responses (#55987) | 认证刷新实现依赖 f29d55ff06 的可失败认证头接口；移除前置提交后 model-provider/src/auth.rs:178、205 出现 E0308。<br>`codex-rs/model-provider/src/auth.rs` |
| [6203846fb3](https://github.com/openai/codex/commit/6203846fb3ef040f62eed9b35bc6629c8e88980a) | Support confidential OAuth clients for enterprise-managed MCP auth (#56001) | 移除前置不兼容提交后，整提交重新应用出现冲突；未手工解决。<br>`codex-rs/app-server/tests/suite/v2/account_enterprise_tests.rs`<br>`codex-rs/codex-mcp/src/ema_account.rs`<br>`codex-rs/codex-mcp/src/ema_token_source.rs` |
| [342ed69a17](https://github.com/openai/codex/commit/342ed69a174c206c1de52a59491b131e0753cfa5) | Require managed configuration from the configured server (#56055) | 移除前置不兼容提交后，整提交重新应用出现冲突；未手工解决。<br>`codex-rs/config/src/state.rs`<br>`codex-rs/core/tests/suite/scenarios_mcp_ema.rs`<br>`codex-rs/rmcp-client/src/ema_http_client_regression_tests.rs` |

## 范围或版本排除：3 项

| 上游提交 | 原提交标题 | 原因 |
|---|---|---|
| [89461ea683](https://github.com/openai/codex/commit/89461ea6833832b0551ce24ee32205824d5c108d) | Prune unused standalone releases after successful installation (#55149) | 范围外：独立 Unix 安装器维护 |
| [6fb1c3903d](https://github.com/openai/codex/commit/6fb1c3903d42e3cc7da2c89e3a045fe0ce137af4) | Use hermetic dsymutil for macOS Bazel builds (#55693) | 范围外：独立 macOS Bazel 发布工具维护 |
| [6aaac69480](https://github.com/openai/codex/commit/6aaac694803004a63c6f393d153c96d22521a6b9) | 正式发布版本号提交 | 保留现有构建身份，跳过仅修改版本号的发布提交 |

## 已合入提交：135 项

| 上游提交 | 本地提交 | 原提交标题 |
|---|---|---|
| [8d9f6466ff](https://github.com/openai/codex/commit/8d9f6466ff0294785d56f55b1fe363d132fe4133) | `b678e8eb1c` | Add negotiated zstd compression to app-server WebSockets (#54930) |
| [1cc7dc8f2a](https://github.com/openai/codex/commit/1cc7dc8f2acc63ce6c1cb72271e6b90a76136c2b) | `dd5d539f67` | Share additional tool declarations across response item clones (#54945) |
| [ffd3429d75](https://github.com/openai/codex/commit/ffd3429d754991183433b4d41b67551e5656ba27) | `bfa5d66da2` | Preserve model catalog caches across header credential rotation (#54946) |
| [7b44ac1661](https://github.com/openai/codex/commit/7b44ac1661433ae3a6f375fde873fa7123c935fe) | `a706fff4ea` | Gate app-server WebSocket compression behind a feature flag (#54949) |
| [99f617bf74](https://github.com/openai/codex/commit/99f617bf74284e10f621247fe490f2469565c0cc) | `ddfdfbc694` | Bucket admitted Guardian request metrics by input size (#55226) |
| [770ed6dcea](https://github.com/openai/codex/commit/770ed6dcea40fedb83bb831f6d5e3760a933cc9a) | `6e7a0cc09c` | Allow plus signs in metric tags (#55227) |
| [9dc3a1ce7e](https://github.com/openai/codex/commit/9dc3a1ce7ea53bb818b8dd69416d6dde70d0b680) | `4ef95e32ba` | Record Guardian sampling retries, attempts, and delivery outcomes (#55234) |
| [eb354a928b](https://github.com/openai/codex/commit/eb354a928b347856055b29fb55ecd740addf8f77) | `9dac913486` | Add Guardian review routing and cached score metrics (#55237) |
| [47db419304](https://github.com/openai/codex/commit/47db41930433487eb1419b3d5887bce7bd53fbe5) | `5f85eec0e8` | Batch thread history materialization into SQLite (#55244) |
| [5fe32c0001](https://github.com/openai/codex/commit/5fe32c00015a84e6b704f6f37460bc925cd93ec0) | `20a78977a7` | Preserve rollout access metadata across compression and restoration (#55252) |
| [9032fc7683](https://github.com/openai/codex/commit/9032fc76839e23a0e9defa71920089187fad1b51) | `40a31d028c` | Unload idle ephemeral composer prediction threads without delay (#55255) |
| [c0ce901923](https://github.com/openai/codex/commit/c0ce901923c81843d100659fe4cfa5cb0cb1068e) | `2c8f036dab` | Share dynamic tool specifications across turn snapshots (#55261) |
| [71ab2ea77b](https://github.com/openai/codex/commit/71ab2ea77bc7fca41bb641e8a131bcba7b304a21) | `3072644127` | Stop memory dual-write when v2 is selected (#55262) |
| [cc44ffb3e2](https://github.com/openai/codex/commit/cc44ffb3e2008e25dd216d59fa7871a0b9434346) | `75bedb57a8` | Start dormant MCP servers for hook calls (#55263) |
| [1b89beea82](https://github.com/openai/codex/commit/1b89beea82ae60e0dbeacb38f1ad2eae9dfed377) | `cd8b998f77` | Avoid cloning the full catalog for model metadata lookups (#55265) |
| [4635d48925](https://github.com/openai/codex/commit/4635d489254ba6d80eb6d2ef501929b0c617b6ec) | `60037ea8a1` | Stabilize daemon reconnect and Rosetta package startup tests (#55274) |
| [bb8f5304fc](https://github.com/openai/codex/commit/bb8f5304fcd9f901d8e0747fccb8c8904cbc504e) | `2a88876c58` | Fall back when macOS rejects high stdio descriptors (#55278) |
| [b1fd48c48e](https://github.com/openai/codex/commit/b1fd48c48e2cc227f4ea818a6030be9b86cde055) | `bdb2a3fb3b` | Avoid cloning events in the app-server thread listener (#55283) |
| [cca40e57a4](https://github.com/openai/codex/commit/cca40e57a468353bfa69a56bef93389475ed0faa) | `002822c2ad` | Track MCP enterprise auth cancellation across config reloads (#55287) |
| [4e7b9e285b](https://github.com/openai/codex/commit/4e7b9e285ba4ac6ce18ca452cf9e88d3d75ec857) | `353c5cff9a` | Recheck EMA request authority at HTTP boundaries (#55288) |
| [7c073196a1](https://github.com/openai/codex/commit/7c073196a1673a0b248b2e5edfb7548d2c2290ac) | `f36c70c7cb` | Keep only the latest adjacent reasoning effort update in requests (#55293) |
| [f6e8ca3fc1](https://github.com/openai/codex/commit/f6e8ca3fc12ea26a0b45395ca880164de9d4db32) | `5b2b73cbf0` | Encapsulate Responses API proxy authentication (#55296) |
| [a91b0bf1bf](https://github.com/openai/codex/commit/a91b0bf1bff472d5638e42fc0fedfffbb3569813) | `a3db75ff6e` | Add GitHub Actions OIDC token acquisition to the responses API proxy (#55297) |
| [8cac68328a](https://github.com/openai/codex/commit/8cac68328a9d74679c19923f2aa784915ef0e20b) | `01ec949968` | Add renewable federated auth primitives to the Responses API proxy (#55298) |
| [54f99017f2](https://github.com/openai/codex/commit/54f99017f23aefff4a1ed3912c47f789849f0257) | `bf39f98aa4` | Refresh rejected proxy credentials and back off failed renewals (#55299) |
| [1277bcfddc](https://github.com/openai/codex/commit/1277bcfddc69800c5e3538dccf3f26bedbd80290) | `b725f30c11` | Add one-shot app-server startup configuration discovery (#55300) |
| [f7a135ec61](https://github.com/openai/codex/commit/f7a135ec6173d19c881b7b7b0ef75f2e1e6d1985) | `916c5f8fd0` | Reconcile V2 executor plugins with cloud catalogs (#55301) |
| [cc1a4ec763](https://github.com/openai/codex/commit/cc1a4ec7637310af92313cf3ae0da729adddb23a) | `491f687507` | Stop the closest remote SHA search at zero distance (#55302) |
| [f6e03d4eac](https://github.com/openai/codex/commit/f6e03d4eacf8907fc7a5079cb7cf4bb51e759818) | `655dba8653` | Route skill reads by alias source (#55303) |
| [e4568a3538](https://github.com/openai/codex/commit/e4568a3538c9cab6627d64ff8cdfc7d98b79b7db) | `2d074588dd` | Reject TUI events from a different backend (#55304) |
| [57560e9d53](https://github.com/openai/codex/commit/57560e9d53f89c7737c7b2069ba2eb8fddbf0687) | `7b076b27f6` | Enable GitHub Actions OIDC authentication in the Responses API proxy (#55320) |
| [8dd6099e26](https://github.com/openai/codex/commit/8dd6099e265f14b80cb1b3fcf10c29a12bb6b23d) | `4e63f546aa` | Remove thread title generation spinners from the TUI (#55324) |
| [1569abc5dc](https://github.com/openai/codex/commit/1569abc5dcff34a161a37c0697617b5025e1a851) | `4d744208d4` | Enable enterprise-managed authorization for MCP connections (#55334) |
| [982695cdbc](https://github.com/openai/codex/commit/982695cdbcce52eb398b7cc8ba3fcec208ac00e3) | `2b02502db5` | Consolidate cached and fetched Codex manual handling (#55342) |
| [941b32bf57](https://github.com/openai/codex/commit/941b32bf57e520f506cda9741de615f64f53fbe6) | `fba73967b7` | Add Guardian retry metrics and preserve turn attribution (#55347) |
| [aeec726de8](https://github.com/openai/codex/commit/aeec726de8c08c7a13ecaf7e4e46d592e25a8222) | `d0c7ccadd0` | Reduce path storage in the file-search index (#55351) |
| [49df716ba9](https://github.com/openai/codex/commit/49df716ba92cf49a44140241b366d914c27cfc80) | `004fbceeb2` | Remove the long-thread accuracy warning after compaction (#55355) |
| [18d09e1eda](https://github.com/openai/codex/commit/18d09e1eda6811effcb4acc110795eec7e970135) | `05dea69c7b` | Add a shared cleanup lock guard for local log directories (#55358) |
| [ee8b4ea181](https://github.com/openai/codex/commit/ee8b4ea181dc5baa735c0cd9ec5009a85d2e46fb) | `51e611b571` | Import only the continuation of backgrounded Claude sessions (#55365) |
| [d9a36f6ec7](https://github.com/openai/codex/commit/d9a36f6ec7044b6f1e5d2ce7fd364660dc26efee) | `da77657cc4` | Support catalog templates for approved command prefixes (#55366) |
| [c953dacb42](https://github.com/openai/codex/commit/c953dacb42d2773d0ca9cc25a01129bba2ca36a8) | `2b9fd56006` | Enable incremental tools by default for Responses Lite (#55368) |
| [0d337e5fe7](https://github.com/openai/codex/commit/0d337e5fe78860b25053bb2eb37c3876e566c428) | `632e95057e` | Fix recall of command-line initial prompts in the TUI (#55372) |
| [c6e29b4fcb](https://github.com/openai/codex/commit/c6e29b4fcb1fa1ac127f5fa9346fe3c7022ff091) | `4373a5d3bc` | Migrate the Windows MXC sandbox to `mxc-sdk` (#55378) |
| [37594ab7cc](https://github.com/openai/codex/commit/37594ab7cc6f9ee8f5e900878cd7211190c451f0) | `3041718061` | Handle response body failures in OpenAI docs downloads (#55379) |
| [1e4ba692b8](https://github.com/openai/codex/commit/1e4ba692b841edc8e51295a631f07d83d9f69b0d) | `8c6a1b74bc` | Preserve thread metadata before rollout files are materialized (#55380) |
| [63ba55817a](https://github.com/openai/codex/commit/63ba55817a13e2b2cb546a4f1794e50054a60d56) | `ce6bc5e1c1` | Manage TUI backend sessions independently (#55381) |
| [b8f880bc38](https://github.com/openai/codex/commit/b8f880bc38b885bcca81cdfb50dae0ed18d7c3b4) | `3f397afb59` | Reject replaceable symlinks in pre-sandbox executable lookup (#55384) |
| [36e5861fd9](https://github.com/openai/codex/commit/36e5861fd9cfa795b1144d3b37113847db11916b) | `36625c06b0` | Mark `transcript_v2` as removed (#55388) |
| [e645309723](https://github.com/openai/codex/commit/e64530972398604464a6aa0d1ace7b9399e9e942) | `1b71140238` | Deduplicate native agent messages in Guardian review context (#55391) |
| [61fa059d49](https://github.com/openai/codex/commit/61fa059d49f3386836e18fb337e71d48da8e6642) | `a8efdf2dbf` | Use thread connections for enterprise MCP status listings (#55394) |
| [affa861ddf](https://github.com/openai/codex/commit/affa861ddf3525f4c7e0b6635eb7f26f95731c9e) | `731af85ea3` | Roll back interrupted Guardian reviews to preserve evidence (#55395) |
| [e05028e7b0](https://github.com/openai/codex/commit/e05028e7b0fdd6a483a720920594b65f0b85a872) | `422d725846` | Prefetch sibling rollout paths when reading history pages (#55396) |
| [896604a12d](https://github.com/openai/codex/commit/896604a12d0c7edea37b59ed340dd4e282172fa5) | `d68bf960bc` | Record OAuth provenance and login identity for account tokens (#55397) |
| [c3bb20602d](https://github.com/openai/codex/commit/c3bb20602d77b0c8e62f84e9956e8086f439dfeb) | `c811d22a1f` | Add wire types for runtime agent registration (#55398) |
| [431185b78b](https://github.com/openai/codex/commit/431185b78b3d283cc58b3434988b80e653a0d9bf) | `d911a3d3c1` | Defer environment disconnect notifications until recovery fails (#55401) |
| [79a19cbb30](https://github.com/openai/codex/commit/79a19cbb3008afe2882ccc2c5d93f02cde9a0823) | `9e12cecd96` | Add ephemeral runtime registration and signed assertions (#55402) |
| [c937a6eb7e](https://github.com/openai/codex/commit/c937a6eb7ea1ea6459da0c971e46c42621273255) | `a798ead17b` | Trace harness-side Noise handshake failures (#55406) |
| [1ccc0d64e8](https://github.com/openai/codex/commit/1ccc0d64e80ff5a189d072257a0198ec63857b1d) | `b2a6138fdd` | Clarify API key login and status messages (#55407) |
| [a3c643bf8d](https://github.com/openai/codex/commit/a3c643bf8da200a4b7b22b901f03e55108e59563) | `9db340a102` | Retry TUI startup after a server shutdown refusal (#55409) |
| [7827cd886d](https://github.com/openai/codex/commit/7827cd886db8d129e06bc843185d3d2b0d5cef52) | `1027d43824` | Track credential sources separately from auth owners (#55410) |
| [1a35bc4ccb](https://github.com/openai/codex/commit/1a35bc4ccbc38417bde1c3a0fc96624fca5b7dfe) | `7c7338a5a8` | Render async question prompts as Markdown in the TUI (#55411) |
| [091008729d](https://github.com/openai/codex/commit/091008729d5572712ac08964a9602eb71cf31428) | `bb90b915d2` | Share runtime authentication across requests and credential refreshes (#55413) |
| [8196bcdc18](https://github.com/openai/codex/commit/8196bcdc189ad2c189d631b321fa54b8e09b9bb0) | `e2911121e9` | Check daemon feature overrides and prompt for mismatch recovery (#55442) |
| [18795fc125](https://github.com/openai/codex/commit/18795fc12571a3530d3e4ac18366e41cd2f57448) | `eed19d55be` | Support Windows registry overrides for `requirements.toml` (#55456) |
| [e18a20d6eb](https://github.com/openai/codex/commit/e18a20d6eb6f5ede32a69fb56e3fe276d5e9d914) | `3d6984a940` | Add correlated diagnostics for Noise relay handshakes (#55498) |
| [46d252f8bf](https://github.com/openai/codex/commit/46d252f8bf8b09f4ef765bc72e40f02c229da3e6) | `6267ca5054` | Make the startup migration contention test deterministic (#55524) |
| [464add4958](https://github.com/openai/codex/commit/464add49587a7cb6032d5ab04faa8a1585947853) | `d293299c95` | Separate Guardian conversation preparation from execution (#55533) |
| [4be9cfdf30](https://github.com/openai/codex/commit/4be9cfdf30bcb1526099aaee4512b31c89df7500) | `f5a1543884` | Improve diagnostics for compressed rollout read failures (#55545) |
| [b2aa07db8a](https://github.com/openai/codex/commit/b2aa07db8ac892a865de888dd08726680fcf873c) | `7dcbedefe8` | Add scoped leases for persisted account OAuth grants (#55546) |
| [4dbd9d30ea](https://github.com/openai/codex/commit/4dbd9d30ea0466ec5bb1524f24c56cfc8ee4c5b1) | `6e3d47c44e` | Ignore the basic-toml advisory in dependency audits (#55547) |
| [e1b9c9457c](https://github.com/openai/codex/commit/e1b9c9457ceca75a99b034a5df39ac48c3998d15) | `0ccc2c6019` | Preserve parent history by default in full agent forks (#55548) |
| [e8aa7c1678](https://github.com/openai/codex/commit/e8aa7c1678caa9a368243d72bf0e9b7859d97f15) | `30c32b9fea` | Avoid panics after background compaction fails before a checkpoint (#55581) |
| [ab6095dde0](https://github.com/openai/codex/commit/ab6095dde0040bb8cdf8592acb89c344e5f27a56) | `1f577611d7` | Allow callers to control prompt cache keys independently of session IDs (#55587) |
| [60d78332fc](https://github.com/openai/codex/commit/60d78332fc6adbf7f4fd000ede9eabe8d52f4e86) | `89e01bac17` | Measure Guardian approval blocking time per turn (#55591) |
| [d34f104c22](https://github.com/openai/codex/commit/d34f104c22ae815fc213641b8a637c5947f14ac1) | `a52d16efd9` | Reject unpackaged Windows sandbox provisioning clients (#55593) |
| [fa71afc8a7](https://github.com/openai/codex/commit/fa71afc8a701a88cc8c92b94240f7a23e31b3568) | `a566b61760` | Rank `$` mentions by recent selection frequency (#55596) |
| [78d4c7c7fa](https://github.com/openai/codex/commit/78d4c7c7fae278d2b0a904316c274681c62461a8) | `b757f17cd5` | Extract shared TUI user prompt helpers from IDE context (#55597) |
| [61469096fe](https://github.com/openai/codex/commit/61469096fe086ccdbe87c06f9efc4ee59a4b51fe) | `59cd98ff23` | Update `rustls-webpki` and `webpki-roots` lockfile versions (#55616) |
| [5ac9888436](https://github.com/openai/codex/commit/5ac9888436003b24f748bb5938629a7bf0bfbc50) | `4bd18a1f1e` | Move Linux sandbox unit tests into separate files (#55620) |
| [aa081afb1b](https://github.com/openai/codex/commit/aa081afb1b044ee66c738b8808c07f13dfcff373) | `357d9d7f3e` | Refactor Guardian v2 Decisions snapshot comparison (#55623) |
| [48b6a9d8e0](https://github.com/openai/codex/commit/48b6a9d8e0b5e0d809a60eac1cb48486d6ba5107) | `ff5f984bfe` | Reserve a sibling rollout candidate slot for the first ancestor (#55627) |
| [7a152fbcf9](https://github.com/openai/codex/commit/7a152fbcf9ecd32d9fb4b45edf80127ee4c8499e) | `744f2b2cbf` | Treat code-mode collaboration messages as plaintext (#55633) |
| [a13ab7e4ed](https://github.com/openai/codex/commit/a13ab7e4ed6639a77f61df3939cbec4516208fd1) | `36ad401d91` | Enable Decisions comparisons for Guardian V2 conversation mode (#55635) |
| [305db3808c](https://github.com/openai/codex/commit/305db3808cf860ced585808ee4a191bb018a3b18) | `93b082ec90` | Make pending injections interrupt agent waits and sleep (#55644) |
| [98f92bd0b5](https://github.com/openai/codex/commit/98f92bd0b5574bb9debed669cd48443ee5167434) | `de9e623503` | Fix in-process app-server shutdown with full queues (#55645) |
| [c6e4438a5d](https://github.com/openai/codex/commit/c6e4438a5d5befe6c8e59b01b6534eb8f0792230) | `33bfe7e716` | Guard auth persistence and reloads against concurrent login changes (#55646) |
| [801bd4d773](https://github.com/openai/codex/commit/801bd4d773ab374959344c36640ddbdec270ddb7) | `4fcea50449` | Search compressed rollouts concurrently (#55652) |
| [87f3c3284e](https://github.com/openai/codex/commit/87f3c3284e1669b90ad9f4925039e9e3bc769b61) | `443df6b076` | Track code-mode cell lifecycle and result buffering time (#55653) |
| [2f5e242d9f](https://github.com/openai/codex/commit/2f5e242d9f869b0553bf37e007b85b2cbd9b31ef) | `764849d583` | Omit reasoning and compaction from Decisions snapshot comparisons (#55666) |
| [c465563aa9](https://github.com/openai/codex/commit/c465563aa9626d99420062135b187d299f904f81) | `722e3ca394` | Enable app routing for remote curated Agent Plugins (#55667) |
| [ef1604d8f5](https://github.com/openai/codex/commit/ef1604d8f5f01114ede3b3484901d5826378db0e) | `462cf06c2d` | Upgrade the Rust toolchain to 1.99.1 (#55677) |
| [2623f206bd](https://github.com/openai/codex/commit/2623f206bd40e0a9a9b16a49b4da415585c0e45f) | `4939a887eb` | Recheck account login ownership for enterprise MCP (#55680) |
| [7389eebf45](https://github.com/openai/codex/commit/7389eebf45df47895b386334bc1c5b9809eb9605) | `40e9a23a3a` | Fix TUI permission selection and session state handling (#55682) |
| [36512a34ff](https://github.com/openai/codex/commit/36512a34ffe71a48bd9aab66fc81c3b909ef2dfc) | `86ef411f8c` | Add account credential support to EMA token exchange helpers (#55685) |
| [69727ae170](https://github.com/openai/codex/commit/69727ae170297c1057108ea170e6f0cf41ba993f) | `7300d34649` | Clean up failed and abandoned marketplace staging directories (#55689) |
| [75c78768d2](https://github.com/openai/codex/commit/75c78768d2c04da11326adb2354ff32083fe60e8) | `1e6b91b77c` | Reclaim aged legacy marketplace staging directories (#55690) |
| [d4e03acb61](https://github.com/openai/codex/commit/d4e03acb6147dc83f5e013fd91f729da72712a03) | `e1c98ba9d2` | Tag tool registration metrics with effective incremental tools mode (#55692) |
| [35757adb72](https://github.com/openai/codex/commit/35757adb728b268a1e75eabeb3e4cf9a6def5c18) | `c7a3dcf6f9` | Enable MCP OAuth refresh coordination by default (#55701) |
| [3f31c0a040](https://github.com/openai/codex/commit/3f31c0a040ca58b86cea70a8d40ad79d481e45d2) | `201553884a` | Resolve MCP backend identity from runtime events in rollout traces (#55710) |
| [db58a987b8](https://github.com/openai/codex/commit/db58a987b8a0b94b81ab321f0e0192757758df67) | `43303bc46b` | Allow unified exec to fall back when credential masking is unavailable (#55719) |
| [57d4fac64a](https://github.com/openai/codex/commit/57d4fac64adbcaed0523ca6bf8d58c4ef6875157) | `e2dbf997b7` | Avoid redundant clones when sending app-server notifications (#55723) |
| [2744e8686c](https://github.com/openai/codex/commit/2744e8686c3defaa96f7aff6c51a9df961c51224) | `e1c3a39b0e` | Share prepared MCP tool definitions across sessions (#55724) |
| [d571eaf1f6](https://github.com/openai/codex/commit/d571eaf1f61d0d93a797506335a99a9950ffe37b) | `8de478015d` | Preserve code cell response metadata in rollout traces (#55725) |
| [c7234c1174](https://github.com/openai/codex/commit/c7234c1174b27d9c55199fba0d546dc27d1b0415) | `02d3352136` | Box session metadata and compaction payloads in `RolloutItem` (#55733) |
| [af91f6ef2c](https://github.com/openai/codex/commit/af91f6ef2cd66ead278ebe7d5751973eef430aee) | `c606fa91b9` | Add a critical-path utility for exclusive duration attribution (#55804) |
| [2213359bd3](https://github.com/openai/codex/commit/2213359bd33f9ffc818e3aeb534faf47544293bc) | `c050f894dd` | Measure Guardian review latency once with a monotonic clock (#55846) |
| [21b1f5f534](https://github.com/openai/codex/commit/21b1f5f5344db8adb6eb1be6a2e61f6085fdc8f8) | `fe30c10e57` | Bound retained turn analytics and clean up closed threads (#55847) |
| [4faf60f126](https://github.com/openai/codex/commit/4faf60f1265a495a68fd792701c60fa334714683) | `329b6be2fb` | Pause relay test time while inspecting handshake diagnostics (#55848) |
| [6bae551093](https://github.com/openai/codex/commit/6bae551093d24ad6539a7daba2d9a13b80b28d15) | `b9ad3bf04e` | Bound managed app-server and updater stderr logging (#55856) |
| [a6839a4812](https://github.com/openai/codex/commit/a6839a481223fb5faab539a9eb2b7174ae29e560) | `464060d007` | Skip conversation scoring superseded by newer scores and history (#55913) |
| [9b39316997](https://github.com/openai/codex/commit/9b39316997fd8bcecdb2007722f52ef858f0dbd8) | `9451a6ab88` | Bound remote installed-plugin inventory pagination (#55946) |
| [d685e61e1f](https://github.com/openai/codex/commit/d685e61e1f63b0222cc51017b175d20c14ecd02d) | `7135984eab` | Separate retained instruction collection from budget policy (#55954) |
| [067249a283](https://github.com/openai/codex/commit/067249a28329feec4a097f55413894acb4a6378a) | `1552b19f76` | Preserve provider model catalogs when refreshes fail (#55958) |
| [a47d1338c1](https://github.com/openai/codex/commit/a47d1338c1be494948e9694a91561f66921acb17) | `06165ed715` | Extract shared message-board code into `codex-message-board` (#55970) |
| [e41e882174](https://github.com/openai/codex/commit/e41e8821749ca6904b00161c31f097628d3756a9) | `7d85ba0e53` | Add storage namespaces for local message boards (#55971) |
| [8d06d62e15](https://github.com/openai/codex/commit/8d06d62e15ebbe1ad42324232b6e8a7e2e432793) | `c7dd6fec6a` | Allow consumers to select message-board tools (#55973) |
| [3c4c04b224](https://github.com/openai/codex/commit/3c4c04b224b55ce0eefca7fb8503b6f128d32b7d) | `b8c8c5e0f5` | Add an experimental command to migrate NFS databases to DELETE mode (#55975) |
| [17a0e6f63f](https://github.com/openai/codex/commit/17a0e6f63fad13f577ef87b36b4ea37fc06385e9) | `6b38b3f80d` | Route SQLite logs to an explicitly configured `log_dir` (#55978) |
| [d51e9c935f](https://github.com/openai/codex/commit/d51e9c935fab31e13f7b576a026ae56fb18603bf) | `45b8bcdd56` | Preserve per-execution trace context in code-mode stdio callbacks (#55993) |
| [d5bc4161b6](https://github.com/openai/codex/commit/d5bc4161b658cff3f2176aa422a52b3a06928214) | `d06cbd0090` | Add a Windows proxy authentication tunnel helper (#55994) |
| [f496b09bd1](https://github.com/openai/codex/commit/f496b09bd141af0a6ec1a7ebf3e5fc557ac795dc) | `0a3bacb26e` | Retry proxy CONNECT challenges with Windows authentication (#56000) |
| [82ef0672e3](https://github.com/openai/codex/commit/82ef0672e34391ffe1bd61e1185ed6e9d664a64e) | `82c89c8dc1` | Scope MITM credential substitution to trusted origins and placeholders (#56003) |
| [3206e532d7](https://github.com/openai/codex/commit/3206e532d7515c50f22af6dad3a20b9f3c38b639) | `51d3055d36` | Assert shell tool overlap directly in the parallelism test (#56006) |
| [bc45d61a9a](https://github.com/openai/codex/commit/bc45d61a9a0c5382d5ee342c1bf5c740f9ef1b77) | `b1548d7887` | Pause Tokio time in the reused Guardian session test (#56007) |
| [082900149c](https://github.com/openai/codex/commit/082900149cc7c0985e15a1d1ce0330a9e81e53b1) | `4a0d862f22` | Add a critical-path timing recorder for direct tool calls (#56008) |
| [deede7201d](https://github.com/openai/codex/commit/deede7201da27a178c39befa6b4959bb7d451645) | `6c43788d86` | Keep rollout trace terminal sessions distinct when process IDs are reused (#56011) |
| [aafd81a7ad](https://github.com/openai/codex/commit/aafd81a7ad3be2d8ddc3439056841af306cbddcc) | `12d84ec7a1` | Avoid nested CLI startup in the MCP OAuth persistence test (#56018) |
| [38da85f49e](https://github.com/openai/codex/commit/38da85f49e0ab8247d1840f7437ce06fd12d7856) | `25b02c01ab` | Preserve config overrides across CLI subcommand boundaries (#56022) |
| [d6a5c9d17e](https://github.com/openai/codex/commit/d6a5c9d17e8240a5dbd83cae1a3df23ed5aafcea) | `8768ae45af` | Group Bedrock API key entry with other AWS sign-in methods (#56023) |
| [e8bb1b6641](https://github.com/openai/codex/commit/e8bb1b664170a123af4b844a47e6c6e992b52fe2) | `688caeb333` | Limit decoded HTTP/3 response headers in the TCP tunnel (#56024) |
| [004c13292f](https://github.com/openai/codex/commit/004c13292f3ef05e51e2e90e5a2dc6b13b651916) | `0b84950f47` | Fix entrypoint lookup in package debug-symbol smoke tests (#56032) |
| [8440e76ae6](https://github.com/openai/codex/commit/8440e76ae6d4875a6f01398e09bd27734da741e7) | `57bc0bb3c4` | Enable the Bedrock setup wizard by default (#56033) |
| [09ec2451bf](https://github.com/openai/codex/commit/09ec2451bf9a6750a19f334e9bd0fd9ebe6494b5) | `585d43ce87` | Add request-scoped OAuth credentials and session lifecycle APIs (#56036) |
| [45179176e5](https://github.com/openai/codex/commit/45179176e52ab890a3cf5ce47e8ab585e7295f7e) | `29dd83aa3c` | Add a channel-backed cloud app-server client (#56037) |
| [2a77e82f09](https://github.com/openai/codex/commit/2a77e82f09212c9e1bbf02656afca5d8172c5f9e) | `9711cd5858` | Support configured credential providers in remote execution (#56049) |

## 本机证据

原始日志、历次筛选结果及失败分支均保留；证据目录为 `.tmp/upstream-0.164.0-20261027-4ce80d9cbd/`。该目录是本机验证材料，不随 Git 提交发布。

- [最终逐提交清单](../.tmp/upstream-0.164.0-20261027-4ce80d9cbd/picks-5.json)
- [原始工作区及文件哈希](../.tmp/upstream-0.164.0-20261027-4ce80d9cbd/baseline.json)
- [编译错误与基线逐条比对](../.tmp/upstream-0.164.0-20261027-4ce80d9cbd/baseline-errors-comparison.json)
- [运行失败与基线比对](../.tmp/upstream-0.164.0-20261027-4ce80d9cbd/runtime-baseline-comparison.json)
- [最终源码关联记录](../.tmp/upstream-0.164.0-20261027-4ce80d9cbd/final-source-provenance.json)
- [核心隔离测试日志](../.tmp/upstream-0.164.0-20261027-4ce80d9cbd/core-nextest-01.log)
- [最终前端测试日志](../.tmp/upstream-0.164.0-20261027-4ce80d9cbd/ui-final-tests-native.log)

原有两处未提交 Rust 文件、源码压缩包、CHANGELOG 和既有研究文档均按原始内容保留；共核对 12 个原有文件哈希。
