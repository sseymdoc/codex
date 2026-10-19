# 本地环境与桌面项目兼容

**入口**：新建会话页或输入框下方的环境菜单 → 新建环境。填写名称、添加一个或多个源文件夹，再选择创建环境。也可从“将此文件夹设为项目…”进入，预填当前文件夹及其名称。

**数据**：环境直接保存为 Codex app-server 的 `project/create` 记录，使用原生 `name`、`roots: [{ path }]` 和 `idempotencyKey`。读取、重命名及删除复用 `project/list`、`project/update`、`project/delete`。两个客户端使用同一 `CODEX_HOME` 时读取同一项目库；其他进程创建的项目可在重新连接后读取。这不涉及 ChatGPT 网页的云端项目。

**选择**：创建成功后选择新项目，首个源文件夹成为新会话工作目录；`thread/start.projectId` 指向该项目。多个源文件夹按原生格式保存，不额外扩大沙箱权限。环境菜单、新建页和输入框显示项目名称，重叠源文件夹的不同项目仍保留独立 ID。取消或失败保留原工作目录；失败表单保留输入，不创建本地假记录。不支持项目接口的旧服务会显示版本提示。

## 参考证据

只读分析用户指定的 `F:\REA\Claude_2.42304.0.0_x64__pzs8sxrjxfjjc`，没有启动 Claude。

- `ion-dist/assets/v1/cc43287c9-DAfOi8yP.js`：环境菜单的 New environment 入口及新建状态。
- `ion-dist/assets/v1/ca690a791-BG2HOgzO.js`：New environment 对话框、名称、本地文件夹、取消和 Create environment。
- REA 父证据：`ev_12f8e999849ba17a132f72e9259211d02715719eaa06114cd5e5c2ceb9014d06`。
- 目录身份 SHA-256：`c52bb551a26216395cb6616650b86af315b30c721e547b3c6cf597b194dc2521`。

REA 定向分析六个前端 bundle，静态关系图为部分覆盖；这里只参考已观察到的本地创建交互。没有移植 Claude 的云端、SSH、WSL、环境变量或启动脚本配置。

## 验证

- 自动测试覆盖项目请求格式、去重、失败不改工作目录、旧服务兼容、配置刷新、会话项目 ID，以及重叠文件夹的独立项目显示。
- `npm test --prefix codex-ui`：200 项通过；`npm run build --prefix codex-ui` 通过。
- Chrome + 真实 Codex 0.163.0 app-server，使用独立 `CODEX_HOME`：界面创建中文名称和两个根目录，另一个 app-server 通过 `project/list` / `project/read` 完整读回；`thread/start` 返回相同项目 ID。
- 另一个进程通过原生 `project/create` 创建项目，重复幂等键返回同一 ID；界面重载后可读取并选择该项目。
- 浏览器验证空表单禁用、目录选择、取消保留环境、无效路径拒绝、键盘焦点和 Escape；320 / 768 / 1024 / 1440 宽度没有水平溢出，控制台无警告或错误。
- 本地原始证据位于被忽略的 `codex-ui/out/environment-validation/`，与既有测试证据分开保存。

**验收边界**：完成了原生接口和持久化兼容验证；没有在 ChatGPT 桌面客户端内执行实际互显验收，也没有替换已安装的 Codex UI 程序。
