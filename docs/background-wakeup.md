# 后台任务完成后续跑

这两个开关由 Codex 后端实现，Codex UI 使用现有轮次事件显示续跑结果。
需要构建并选择包含此改动的后端，并在桌面设置中启用“实验型后端”的 Release 或
Preview，重启后生效；只更新 UI 不会启用它们。

这两类能力和等待指引统一受 `Config.experimental_backend` 控制。桌面启动时由实际
启用的后端档位决定子进程标记 `CODEX_UI_EXPERIMENTAL_BACKEND=1`；禁用时桥接层
明确设为 `0`，覆盖继承环境。没有标记也默认关闭，它不是 `config.toml` 可启用的选项。
单纯设置 `CODEX_BIN` 指向自编译程序不会启用这些能力；网页桥接默认关闭。
关闭时模型工具声明不暴露唤醒参数，即使直接提交该参数或配置 `asyncRewake`，也不会
触发完成唤醒或等待指引。普通命令、后台进程以及异步 Hook 执行仍可正常使用。

关闭时回合调度也走上游原路径（2026-10-23 补门控）：续跑的准入检查与预留输入、回合
登记时的预留校验与被替换后放弃、关停中拒绝续跑，以及命令结束事件等待首次调用收尾，
都只在实验型后端生效。`asyncRewake` 在关闭时不计入 Hook 信任哈希，也不出现在
`configRequirements/read` 的结果里（未声明时），与原生一致。

## 后台命令

在 `exec_command` 参数中设置 `"wake_on_exit": true`。仅当首次调用返回仍在运行的
后台会话时，后端才登记完成通知。命令成功或失败退出后，后端向同一对话交付一次
退出信息和最多约 8 KiB 的输出摘要。空闲时开始新轮次，已有轮次时由其后续采样处理。
模型可以结束当前轮次等待结果，无需反复调用 `write_stdin`。

登记成功且命令仍在运行时，工具结果明确要求：继续独立工作；如果只剩等待，
结束当前轮次，不通过轮询、休眠或反复读取日志等待完成。直接调用将指引放在
结果头部，代码模式通过独立的 `completion_notification` 字段返回，保留原始 stdout。
后续 `write_stdin` 仍返回运行中状态时也会重复该指引；未启用、已完成或已取消
通知的命令不会附带它。

每次模型请求都会根据当前待完成的通知任务加入临时等待提醒；提醒不写入对话历史，
任务完成或通知取消后不会残留到下一次请求。`asyncRewake` Hook 的提醒明确说明
仅退出码 `2` 会主动唤醒，成功结束不触发唤醒。

这是一项模型行为指引，不会强制结束轮次或禁止工具调用。结束等待轮次不代表
用户任务已完成；后台结果也不代表用户回答或人工授权。实际模型是否遵守需要
另行在线验收，模拟模型测试仅验证提示内容、状态边界及后端没有空转请求。

默认关闭。同步完成的命令不会产生额外轮次；不要为常驻服务启用此选项。
显式终止进程、用户中断或会话关闭会取消对应的自动续跑。若 `write_stdin` 已先拿到
退出结果，尚未交付的退出唤醒会被抑制。

## 异步 Hook

在原有 `hooks.json` 或 TOML 命令 Hook 中增加 `"asyncRewake": true`，例如：

```json
{
  "hooks": {
    "PostToolUse": [{
      "matcher": "Bash",
      "hooks": [{
        "type": "command",
        "command": "python check_result.py",
        "asyncRewake": true
      }]
    }]
  }
}
```

`asyncRewake` 隐含异步执行；只有退出码 `2` 触发续跑。反馈优先取 stderr，stderr
为空时取 stdout，沿用 Hook 输出大小限制、信任审核、环境及超时规则。
Windows 使用 PowerShell 执行外部程序时，可在命令末尾加 `; exit $LASTEXITCODE`，
把程序的退出码原样交给 Hook 运行器；否则 PowerShell 可能把非零退出码转换为 `1`。
普通 `async: true` 保持原行为：完成后不会唤醒空闲对话。

`Interrupt` Hook 不允许自动唤醒；`SessionEnd` 仍同步执行。完成事件创建的新轮次
向 Stop Hook 传递 `stop_hook_active: true`，并禁止该 Stop Hook 再次异步唤醒，
避免无条件退出码 `2` 导致无限续跑。

## 生命周期边界

完成结果通过会话的待处理输入与现有轮次保留机制调度，不模拟用户输入，也不绕过
沙箱和审批。取消会清除尚未处理的完成结果，并使旧任务的迟到结果失效。
计划模式、目标暂停、用量限制或目标预算耗尽时保留结果，等待用户输入，不自动开始轮次。
本版本仅支持同一后端进程中的存活会话，不保存重启后恢复所需的后台任务状态，
也不包含 Claude 到 Codex 的跨应用桥接。

## 验证范围

新增集成测试使用真实本地命令进程、Hook 和本机模拟模型服务，覆盖正常/失败退出、
默认关闭、显式终止、用户中断、预算耗尽与 Stop Hook 防循环。轮次保留测试用门闩
控制中断发生在上下文构造或任务注册期间。单元测试另覆盖计划模式、迟切计划模式
后结果恢复、单次领取，以及后台输出不能作为人工授权。

测试入口：`core/tests/suite/background_wakeup.rs`、`unified_exec.rs` 的
`background_exit_wakeup`、`wake_reservation.rs`，以及 `core` 的 `background_` 单元测试。
Windows 测试进程需要足够的线程栈，例如 `RUST_MIN_STACK=16777216`。
这些验证不代表已切换正在运行的 Codex UI 后端，也不包含真实在线模型验收。

### 本地验证记录（2026-10-20，Windows）

- 唤醒集成测试：11 项通过；核心定向回归：92 项通过；Hook 回归：177 项通过。
- `cargo check -p codex-cli --bins -p codex-app-server --tests` 通过；
  `cargo clippy -p codex-core --lib --no-default-features` 通过。
- app-server JSON、TypeScript 及稳定/实验预计算协议包的一致性检查：4 项通过。
  Python SDK 同步新增字段；未运行 Python SDK 全套测试。
- 工具场景回归：99 项通过、4 项失败、1 项忽略。保留了 3 项插件/技能场景的
  路径或权限文本差异，以及 `incremental_tools` 的 `responses_lite` 断言失败，
  没有把这些差异直接接受为新快照。
- 另有 5 项 `turn_completion_metrics_follow_model_switch` 指标测试失败。
  临时换回原始任务调度实现后，同样 5 项失败；对照后已恢复本次实现。
  因此上述通过结果仅代表定向验证，不代表全套回归通过。

日志位于本地 `codex-rs/target/`：`wake-acceptance.log`、`wake-core-acceptance.log`、
`hooks-regression.log`、`wake-cli-check.log`、`wake-clippy.log`、
`wake-protocol-fixture-tests.log`、`tool-scenarios-final.log` 和 `wake-baseline-metrics.log`。

### 等待指引补强验证（同日）

- 13 项集成验收通过，验证命令结果指引、Hook 成功不承诺唤醒、取消后移除临时提醒、
  空闲时没有额外模型请求，以及原有完成/停止竞态。
- 核心定向回归 93 项通过；工具输出专项 30 项通过（两组存在重叠）；Hook 单元回归
  178 项通过。反转取消代际判断后，新增测试失败；恢复源码后 Hook 回归全部通过。
- 工具场景复测 99 项通过、4 项失败、1 项忽略，失败项与上面的原有场景记录一致。
  仅同步了新增返回字段导致的工具类型哈希变化，保留失败正文差异。
- 核心 Clippy 与完整 CLI 编译检查通过；没有替换正在运行的后端。
- 日志：`wait-guidance-integration.log`、`wait-guidance-core.log`、
  `wait-guidance-tool-output.log`、`wait-guidance-hooks-final.log`、
  `wait-guidance-mutation.log`、`wait-guidance-scenarios-final.log`、
  `wait-guidance-clippy.log` 和 `wait-guidance-cli.log`。

### 实验型后端门控验证（同日）

17 项集成、112 项核心定向回归、178 项 Hook 回归和 23 项桌面后端/桥接测试通过。
禁用时直接请求唤醒、继承环境残留启用标记、普通异步 Hook 和原生同步 Stop 阻断
均有覆盖；在隔离副本反转桥接开关后，测试按预期失败。核心 Clippy、完整 CLI 与
app-server 测试目标编译检查通过。工具场景为 99 项通过、4 项原有失败、1 项忽略。
日志位于 `codex-rs/target/experimental-gate-*.log`。未替换运行中的应用或后端。
