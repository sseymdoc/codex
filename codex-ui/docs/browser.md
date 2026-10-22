# Codex UI 原生桌面浏览器

浏览器由应用自带的 Electron Chromium 与本项目的 `desktop/browser-cdp.mjs` 提供。无需安装 Claude、保留任何版本的原包、选择 `app.asar` 或配置 Claude 路径。旧版保存的原包路径会被忽略，不迁移或删除现有 Cookie。

## 使用

在仓库根目录运行 `npm --prefix codex-ui run desktop`，进入会话后点击“浏览器”或按 `Ctrl+Shift+B`。开发服务器、标签、浏览数据和站点授权继续使用原有界面。

执行器基于公开的 [Electron Debugger](https://www.electronjs.org/docs/latest/api/debugger) 和 [Chrome DevTools Protocol](https://chromedevtools.github.io/devtools-protocol/)。界面与 MCP 操作同一个 `WebContentsView` 网页：

**Codex app-server → 独立令牌 MCP → 自有 BrowserCDP → Electron 原生网页**。

本次移除了原包加载器、声明位置清单、哈希校验与模块选择设置。没有复制或随包加载第三方可执行 bundle，没有新增生产依赖。原有 18 个工具名称与会话鉴权保持兼容。

## 站点权限（2026-10-21）

按 [Claude 官方桌面说明](https://code.claude.com/docs/en/desktop#approve-claudes-actions-on-a-site)和本地 Claude Desktop 2.42304.0.0 的已观察规则对齐：

- 本机开发预览（`localhost`、`*.localhost`、`127/8`、`::1` 等）无需逐端口授权。私有局域网不按本机预览豁免，Codex UI 内部服务在各本机别名和 WebSocket 地址下仍拒绝访问。
- 外部站点使用输入框上方的会话审批卡，提供拒绝、允许一次、始终允许；共用现有审批卡的快捷键和 400ms 防误触。开发服务器启动确认也进入会话卡片。
- 允许一次仅覆盖当前工具调用；始终允许立即原子保存到桌面资料目录的 `window-state.json`，保存失败会报错并回滚内存设置。手动打开站点不会自动授予模型读写权限。
- 同一套站点规则覆盖建标签、导航、重定向、页面读写、鼠标目标框架与模型打开的新窗口。设置中可添加、移除和清空已允许网站；撤销会取消待处理授权，取消或拒绝不会留下空白标签。
- 模型工具声明、直接运行入口和自动验证指引仅在实验型后端 Release / Preview 启动后开放，使用现有 `CODEX_UI_EXPERIMENTAL_BACKEND` → `Config.experimental_backend` 启动链。禁用时不注入浏览器 MCP、不接受直接工具调用、不追加自动验证指引；手动浏览器保留。

本地原包参考为 `app/resources/app.asar` 的 `.vite/build/index.chunk-lzaSYO3Q.js`，ASAR SHA-256 为 `8f4d3dec5e4f3ddffb150321060b18807d83a40f3a65618fe4f29325379da9db`，该 JS SHA-256 为 `66a2071baf285aaa3d88aeace7344e7941c3df93c1ef3b21bc6cf64205c58d0d`。关注函数为 `cN` / `fN`（本机地址）、`bUn`（会话审批卡）、`dP`（保存网站授权）与 `yUn`（撤销）。REA 整包关系图受内存限制，覆盖不完整；部分未分析的原生附件与 ASAR 声明哈希不符。以上对齐依据为实际 JS 字节和官方文档，不把静态分析当成 Claude 真机运行证据。

Claude 云端安全服务的组织站点策略、风险分类器和 Chrome 扩展账号授权仍不在本地执行器中。

## 自动打开写入的文件（2026-10-22）

按 Claude 3.1623 的 `launchAutoOpenFiles`（主进程 `pE` / `GT`）：Codex 的文件改动完成后，会话目录内新增或修改的 HTML、SVG、图片和视频在该会话的浏览器面板打开；已有显示同一文件的标签就切过去并重新加载。会话不在屏幕上、HTML 所在目录有开发服务器、文件不在会话目录内或已不存在时不打开。开关在 ⋮ 菜单、浏览器设置和 设置 › Codex › 浏览器，默认开，保存在 `window-state.json`。与 Claude 不同：PDF 暂不打开（面板标签的请求过滤是否放行 Chromium PDF 查看器未验证）；不告诉模型文件已经打开（需要后端配合）。视口子菜单按 3.1623 去掉了配色项，模型工具 `preview_resize` 仍可设置配色。

## 能力与边界

| 能力 | 实现 |
| --- | --- |
| 导航、多标签、设备尺寸、颜色模式 | Electron 网页与 CDP Emulation |
| 截图、缩放、元素选择与标注附件 | 原生页面捕获、CDP Overlay；附加到来源会话 |
| 点击、双击、文本/选择框/可编辑区域填写、开放 Shadow DOM | CDP Input 与 DOM；拒绝文件输入、禁用及遮挡目标 |
| AX 快照、DOM/CSS、React 组件名 | CDP Accessibility 与有界页面检查 |
| 控制台、网络请求、响应正文 | CDP 事件；控制台/请求各保留最近 500 条，正文最多 2 MiB |
| 中止与回收 | 每条协议命令最多 10 秒，工具预算 30 秒；取消和调试器断开拒绝挂起请求，释放鼠标状态 |
| Cookie 临时、共享、按会话保存 | 原有 Chromium 分区不变；共享清理影响所有共享会话 |
| 开发服务器 | 原有配置、检测、启动、日志与进程回收不变 |

网页禁用 Node 和 preload，默认拒绝设备权限；限制私网与本地文件访问，阻止访问 Codex UI 内部服务。模型访问未授权的外部站点须经会话卡片授权；本机开发预览豁免，撤销清除当前调用授权。原生菜单覆盖网页时隐藏视图，登录弹窗存在时暂停该标签的模型操作。鼠标操作核对目标是否仍可见，以及命中框架来源；无法确认时拒绝输入。

MCP 配置只注入单个 app-server，不修改全局 Codex 配置。模型不能通过参数选择另一会话目录，断线撤销专用令牌及未完成请求。页面内容始终是不可信数据。

开发服务器优先读取 `.codex/launch.json`，不存在时兼容项目的 `.claude/launch.json`；兼容配置文件不需要 Claude 安装包。写回原配置，支持 `npm/pnpm/yarn/bun/node`，模型首次执行命令需确认。

```json
{"version":"0.0.1","autoVerify":false,"configurations":[{"name":"dev","runtimeExecutable":"npm","runtimeArgs":["run","dev"],"port":5173}]}
```

仍未接入外部浏览器 Cookie/站点数据迁移、外部 Chrome 扩展、跨应用重启恢复标签历史或企业组织策略。关闭的 Shadow DOM 与跨进程 iframe 不提供通用选择器穿透；不能可靠确认目标时拒绝操作。持久 Cookie 可跨重启保留，标签需重新打开。

## 验证

```powershell
npm --prefix codex-ui test
npm --prefix codex-ui run build
node codex-ui/desktop/browser-storage.test.mjs
# 通过 Electron 运行；Windows 自动化用 Start-Process -Wait -PassThru 取得真实退出码。
.\node_modules\electron\dist\electron.exe codex-ui/desktop/browser-permissions.test.mjs
.\node_modules\electron\dist\electron.exe codex-ui/desktop/browser-smoke.test.mjs
.\node_modules\electron\dist\electron.exe codex-ui/desktop/browser-ui-smoke.test.mjs
```

独立资料目录验收，不替换或停止已安装应用。运行时可将已废弃的 `CODEX_UI_CLAUDE_ASAR` 故意设为不存在的路径，确认完全不参与执行。

- 全套 307 项测试、类型检查与生产构建通过；没有跳过依赖原包的测试。
- 原生执行器：真实页面填写/点击/双击、AX、DOM/CSS、开放 Shadow DOM、选择框、编辑区、元素选择与截图、PNG 缩放、响应正文、手机/深色模拟通过。
- 安全与回收：文件输入拒绝、遮挡拒绝、取消挂起脚本、过期预算阻止迟到输入、调试器断开拒绝挂起命令、日志与正文上限通过。
- 生命周期：权限撤销、导航中取消、服务器启动中取消、启动/停止/重启、端口占用、非法配置及失败通过。
- 执行链：真实 app-server/MCP/原生网页完成 4 次工具调用并返回真实结果；**模型响应来自本机合成 SSE，不是线上模型自主调用验收**。

未验收：线上模型、复杂登录/外网 HTTPS、系统文件对话框的人手流程、跨平台和长时稳定性。

桌面入口与截图通过：`C:\Users\lys57\AppData\Local\Temp\codex-native-ui-20261020-152737\stdout.log`、`C:\Users\lys57\AppData\Local\Temp\codex-browser-ui-zfZt7E\browser-ui.png`。Cookie 双进程包含“旧 archive 设置一旦被读取就抛错”的回归。

原生执行链与扩展能力证据：`C:\Users\lys57\AppData\Local\Temp\codex-native-browser-20261020-152919\stdout.log`；页面截图在 `C:\Users\lys57\AppData\Local\Temp\codex-browser-smoke-5wnkb6\browser.png`。

2026-10-21 本轮回归：307 项 Node 测试、类型检查、生产构建、独立 Electron 站点授权、原生浏览器/MCP、Cookie 双进程和真实桌面审批卡通过。模型仍为本机合成 SSE；没有线上模型自主验收，也没有替换或停止已安装应用。

- 授权行为：`C:\Users\lys57\AppData\Local\Temp\codex-browser-permissions-retry-20261021-043828\stdout.log`。
- 原生执行链：`C:\Users\lys57\AppData\Local\Temp\codex-browser-regression-20261021-043939\stdout.log`。
- 桌面审批卡：`C:\Users\lys57\AppData\Local\Temp\codex-browser-ui-rXJeLY\browser-permission-card.png`；日志：`C:\Users\lys57\AppData\Local\Temp\codex-browser-ui-permissions-20261021-044030\stdout.log`。
- Cookie：`C:\Users\lys57\AppData\Local\Temp\codex-browser-storage-wFBGWL`。

REA 证据包：`C:\Users\lys57\AppData\Local\Temp\codex-browser-permissions-SLEyjS\claude-browser-evidence.json`。
