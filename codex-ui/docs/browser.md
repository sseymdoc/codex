# 桌面浏览器：复用 Claude 2.42304.0.0

Codex UI 在 Electron `WebContentsView` 中显示网页，界面与 MCP 操作同一份页面。点击、填写、快照、截图、DOM/CSS 检查、视口、控制台和网络采集执行本机 Claude 包中的原始 CDP 类；外围界面、生命周期与 Codex 通信由本项目适配。

## 使用

需要保留 Claude **2.42304.0.0** 的本地 `app.asar`。加载顺序：浏览器设置选择的文件 → `CODEX_UI_CLAUDE_ASAR` → 已安装的 Claude 包。版本不匹配时拒绝执行。也可在“设置 → Codex → 浏览器 → 浏览器设置”选择文件。

仓库根目录：

```powershell
$env:CODEX_UI_CLAUDE_ASAR = 'F:\REA\Claude_2.42304.0.0_x64__pzs8sxrjxfjjc\app\resources\app.asar'
npm --prefix codex-ui run desktop
```

进入会话后点击“浏览器”或按 `Ctrl+Shift+B`。普通网页入口不注册本地浏览器 MCP。

## 复用与权限

加载器核对主模块 SHA-256 后，读取清单限定的 151 个声明，导出原始 `fdi` CDP 类和 `UY` 执行预算。原始内存保护保留，只适配本地日志及产品遥测。不会启动 Claude 主程序、登录 Claude 账号、加载包内原生附件或把 Claude bundle 复制进仓库。`vm` 隔离模块环境，不作为执行不可信代码的安全沙箱。

原始模块：`.vite/build/index.chunk-lzaSYO3Q.js`；SHA-256：`66a2071baf285aaa3d88aeace7344e7941c3df93c1ef3b21bc6cf64205c58d0d`。

调用链：**Codex app-server → 独立令牌 MCP → 原始 Claude CDP → 桌面真实网页**。配置仅注入单个 app-server 启动参数，不修改全局 Codex 配置。会话目录来自 app-server 确认的线程；模型不能通过参数选择其他线程。断线撤销令牌和未完成调用。

模型首次访问站点须经原生授权，支持本次会话或始终允许；撤销同时清除会话内授权。网页禁用 Node 和 preload，默认拒绝设备权限，限制私网与本地文件访问，阻止 Codex UI 内部服务。登录弹窗存在时暂停该标签的模型操作。菜单、对话框覆盖网页区域时隐藏原生视图。

Cookie 有临时、共享、按会话保存三种模式。更改模式关闭标签，不删除旧模式数据；清除需用户确认，没有打开标签也能清理。共享模式清理影响所有共享会话。

## 功能与边界

| 能力 | 接入情况 |
| --- | --- |
| 多标签、地址栏、前进后退、刷新、重排、重新打开关闭的标签 | 已实现 |
| 手机 375×812、平板 768×1024、自定义尺寸、响应式、颜色模式 | 已实现，调用原始 CDP |
| 截图、AX、DOM/CSS、React 信息、元素选择 | 原始执行模块；选择结果和截图附加到原会话草稿 |
| 手绘标注、截图保存、PDF、本地 HTML | 已接入桌面操作 |
| 原始 13 个 preview 工具 | 保留参数结构，增加 URL/标签适配；另加 5 个标签与导航工具 |
| 开发服务器配置、检测、启动、日志、停止、自动验证 | 已实现；只终止本管理器启动的进程树 |
| 外部 Chrome 扩展连接、外部浏览器 Cookie/站点数据迁移 | 未接入，使用独立桌面浏览器数据 |
| 跨应用重启恢复标签网址与后退历史 | 未实现；持久 Cookie 可保留，标签需重新打开 |
| 逐像素对照原版 UI、企业策略、原版私有云端服务 | 未验证或未接入 |

开发服务器优先读取 `.codex/launch.json`，不存在时兼容 `.claude/launch.json`，写回原配置文件。支持 `npm/pnpm/yarn/bun/node`，参数和端口须通过校验。模型首次启动命令须确认。自动验证对新建或带配置重新加载的会话生效。

```json
{"version":"0.0.1","autoVerify":false,"configurations":[{"name":"dev","runtimeExecutable":"npm","runtimeArgs":["run","dev"],"port":5173}]}
```

## 验证

全部验收使用独立临时资料，不替换或停止已安装的应用。

```powershell
npm --prefix codex-ui test
npm --prefix codex-ui run build
node codex-ui/desktop/browser-storage.test.mjs
# 下列两项由 Electron 运行；Windows 自动化需 Start-Process -Wait -PassThru 获取真实退出码。
.\node_modules\electron\dist\electron.exe codex-ui/desktop/browser-smoke.test.mjs
.\node_modules\electron\dist\electron.exe codex-ui/desktop/browser-ui-smoke.test.mjs
```

- Node 全套 209 项通过，0 失败、0 跳过；类型检查和生产构建通过。
- 真实原始 CDP：导航、填写、点击、POST 结果、AX、CSS、视口、PNG、网络和控制台通过。
- 真实 app-server/MCP/原生浏览器链路：4 次工具调用完成，网页结果返回 app-server。**模型响应由本机合成 SSE 服务提供，不是线上模型自主调用验收。**
- 权限撤销、执行前取消、导航中取消、服务启动中取消、服务器启动/停止/重启、端口占用、非法配置和启动失败通过。
- 两个独立 Electron 进程：临时 Cookie 消失、共享 Cookie 保留、按会话保留且隔离、无标签清理通过。
- 实际桌面入口：建立会话、打开浏览器、原生网页显示、菜单遮挡、手机视口通过；JavaScript 控制台无错误。Windows 跳转列表隐私限制日志不影响浏览器测试。

未验收：线上模型、外网 HTTPS 与复杂登录、系统文件/下载对话框的人手完成流程、跨平台和长时稳定性。

本机证据：

- 执行链与生命周期：`C:\Users\lys57\AppData\Local\Temp\codex-browser-electron-20261020-064934\stdout.log`。
- 原始页面 PNG：`C:\Users\lys57\AppData\Local\Temp\codex-browser-smoke-OlibYi\browser.png`。
- Cookie 双进程资料：`C:\Users\lys57\AppData\Local\Temp\codex-browser-storage-SaNP0D`。
- 桌面合成截图：`C:\Users\lys57\AppData\Local\Temp\codex-browser-ui-XRM2L3\browser-ui.png`、`browser-mobile.png`；按 Windows 高 DPI 物理坐标截取测试窗口。

测试脚本以 `.test.mjs` 结尾，现有打包规则会排除。没有新增生产依赖，也没有分发 Claude 执行 bundle。
