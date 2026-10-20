# 连接器工具访问与目录搜索

桌面端的“设置 → 功能 → 常规”提供以下启动偏好，修改后重启应用生效：

- **工具访问模式**：默认按需加载，复用原生 `tool_search`。全部加载将允许直接公开的 MCP 工具定义提供给模型；保留工具禁用、权限、声明大小限制和严格 Code Mode 的原生约束。不支持工具搜索的模型沿用直接加载。
- **连接器搜索**：默认开启。模型可调用 `search_connectors`，按名称、描述和分类检索当前 ChatGPT 账号的连接器目录，最多返回 8 项及连接链接。目录仅在工具调用时读取，复用原生分页、缓存和隐藏条目过滤。过滤已连接、禁用和不再推荐的连接器；连接及授权由用户打开链接完成。

两项偏好保存在桌面端 `window-state.json`。桥接进程覆盖继承的 `CODEX_UI_TOOL_ACCESS_MODE` 和 `CODEX_UI_CONNECTOR_SEARCH`，由本次启动的桌面偏好决定值。后端仅在 `CODEX_UI_EXPERIMENTAL_BACKEND=1` 生成的 `Config.experimental_backend` 下应用扩展行为。禁用实验型后端时保持原生按需加载和原生显式安装推荐行为，目录搜索工具不会声明，直接调用也会被拒绝。

切换加载模式不会从已有会话历史中清除之前加载的工具定义；新会话能完整采用新的加载方式。

搜索需要 ChatGPT 登录和当前后端支持应用功能。API key 不会发送至连接器目录。搜索采用现有 BM25 关键词检索；模型使用英文服务名称或能力关键词查询。它不搜索任意互联网 MCP 市场，不会自动安装、连接或授予权限。

源码增加设置不等于现有 Release 二进制已支持；需要包含本次改动的桌面端及后端构建。浏览器版保持原生行为。

验证：`npm test`、`npm run build`；构建后用 Electron 运行 `desktop/tool-access-smoke.test.mjs`。Rust 针对性测试位于 `core/src/tools/handlers/search_connectors.rs`、`core/src/tools/spec_plan_tests.rs` 和 `core/tests/suite/search_tool.rs`，均不需要真实用户的连接器授权。
