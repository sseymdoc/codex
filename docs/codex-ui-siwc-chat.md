# Codex UI SIWC Chat

Windows 桌面端通过 OpenAI 官方 Sign in with ChatGPT DevKit 使用账号授权的 ChatGPT 套餐推理。聊天记录保存在本机，与 Codex Code 线程、ChatGPT 官网历史分别管理。

## 使用与边界

在设置中启用实验型后端，重启并使用包含 `codexUiSiwcChat` 能力的匹配后端。侧栏出现“聊天”；未登录 Codex 时，原登录页也提供“进入 ChatGPT 聊天”。在 Chat 页面用系统浏览器完成独立 SIWC 授权。Code 登录凭据不用于此流程。

首版支持账号选择、模型目录、文本多轮、流式回复、停止、复制、本地历史和删除。停止或失败时保留已收到的文字；后续请求保留可见的历史文本，不自动重发上一轮。只有收到完整结束事件才标记完成。网页旧会话、项目文件、MCP、终端、附件、语音和自动摘要不在此入口提供。

模型与可用额度由授权账号决定，模型目录本身不证明推理权限。“管理用量”打开官方 ChatGPT 用量设置。DevKit 当前单次请求有 180 秒期限，长推理可能中断；不会静默改用 API key 或其他模型。

## 本地数据

- Electron 用户目录下的 `siwc-chat/credentials/` 保存 SDK 账号注册和凭据；凭据使用 Windows 系统加密。加密或解密失败时保留文件，不降级到明文，也不重置原注册。
- `siwc-chat/history/<profile-id>/<chat-id>.json` 保存该注册下的聊天正文。聊天正文是本地 JSON，凭据不写入历史、前端存储或日志。
- 注销和切换账号不会删除历史；切换会取消原账号的生成。删除操作只移除当前明确选定的本地聊天。
- 原子替换保存记录；进程退出中断的回复在下次读取时标记为中断，不自动续发。损坏文件保留并在列表中提示。

## 开发与构建

本地 SDK 固定于 `0a36fefeb913055c8c7a1a29b63d82b96b2e841a`，保留在 `codex-ui/vendor/siwc/`，上游文件不作修改。宿主设置 `sendHostId: true`，提供异步 `safeStorage` 加密适配。SDK 的 OAuth、JWT 验证、轮换凭据与流解析实现直接复用。

`pnpm --filter codex-ui build` 同时构建前端和 `server/siwc-dist/index.mjs`。SDK 及运行依赖打成独立 Node bundle，安装包无需 `node_modules`；该目录同时包含上游许可证、第三方通知与来源记录。后端需要同步构建新增能力声明，仅更新前端不会使旧后端获得该能力。

认证和聊天请求沿用本地桥的回环主机、同源和认证 Cookie 校验。运行服务还要求桌面宿主、实验型启动状态与同一 app-server 初始化响应的能力确认同时成立。关闭时直接调用登录、模型、历史和发送接口同样拒绝，SDK 不初始化；新增能力不注册模型工具或自动调度。

## 许可

SDK 使用 `Sign-in with ChatGPT DevKit Noncommercial License v1.0`，不能按项目根 Apache-2.0 许可重新标注。当前接入按本地非商业用途实现；服务授权和商业用途仍分别受对应条件约束。分发时保留 SDK 的许可与通知。完整原文和固定来源位于 vendor 目录及运行 bundle 的许可文件中。

## 验证记录（2026-10-31）

- 上游 SDK：56 项通过，1 项 Unix 专属权限测试在 Windows 跳过。
- 新增 Chat 服务、持久化、账号隔离、桥接门控、流取消、错误过滤和前端状态合并测试通过。
- Rust 初始化测试覆盖启动标记缺失、`0`、`true`、`1` 与实验协议开关的 8 种组合，通过。
- 官方 schema 生成器在隔离目录运行，只同步 InitializeResponse 相关导出；4 项 schema 一致性检查通过。受字段新增影响的 app-server-transport 测试目标已编译通过。
- 真实 Electron 使用隔离临时资料目录、系统加密的模拟凭据和模拟远端响应，验证两轮聊天、停止、额度错误、页面重载后读取、删除及无令牌前端存储。也加载打包 ASAR 内的实际 SDK 完成同样验证。此证据不等于真实账号或服务端权益验收。
- 完整 UI 测试复查：914 项通过、5 项跳过、1 项旧预热退出测试失败；该失败在变更前 orchestrator 的隔离副本中同样复现。首次全量测试还遇到随机端口被 fetch 拒绝，单独复测已通过。日志保存在 `.tmp/siwc-node-tests*.log` 和 `.tmp/siwc-prewarm-baseline.log`。
- 完整协议测试另有既有 optional-nullable 规则失败，指向未修改的 `CodexUiContext` / `CodexUiDesktopContext` 字段；本次新增能力的生成一致性已单独通过。原始日志保留在 `.tmp/siwc-protocol-tests.log`。

本次没有访问真实 ChatGPT 账号或向官网旧会话发送消息。安装与真实 SIWC 授权、真实模型推理仍需单独验收。
