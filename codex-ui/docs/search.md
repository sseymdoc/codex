# 搜索

按 Claude Desktop 2.42304.0.0 新版搜索面板对齐；Codex UI 只有 Code 模式，因此不显示内容分类标签。

- 侧栏“搜索”、`Ctrl+K` 和 `Ctrl+Shift+K` 打开同一个搜索界面。空白时先显示最多 8 条最近会话，再显示新建会话操作。
- 输入后以 200ms 防抖搜索未归档及已归档会话的标题和正文，合并后按最近活动排序，最多 25 条结果；归档结果显示“已归档”，保留正文摘要及匹配文字。长文本仍是搜索，粘贴多行文本时合为一行。
- `↑` / `↓` 选择，`Enter` 打开；选中行的 `…` 或 `Alt+Enter` 打开已有会话菜单，沿用固定、重命名、分叉、分组、归档、删除等操作及原有确认流程。
- 输入框旁的筛选按钮始终可用，触屏及已有查询时也能切换全部会话、未归档会话、已归档会话或操作搜索，并保留查询。空白搜索框内也可按 `/` 打开筛选。默认空白时只显示最近的未归档会话；选择已归档后显示归档记录。
- 打开归档结果沿用只读历史加载，不恢复运行或自动取消归档；行菜单保留显式“取消归档”操作。
- `Tab` 在搜索和新会话撰写间切换并保留文本；撰写时 `Enter` 发送、`Shift+Enter` 换行。搜索结果中不插入会发送查询内容的快捷操作。
- `Esc` 或点击遮罩关闭，恢复打开前的焦点。旧后端缺少 `thread/search` 时降级为标题搜索，并在界面注明；搜索失败可重试。

参考包只读，不打包或执行 Claude 的代码。复用 `Palette`、`Popover`、`SessionMenuItems` 及现有 RPC；参考公开 [cmdk](https://github.com/dip/cmdk) 的搜索菜单交互，没有新增依赖。

依据：`c2771e1f6` 的 `Dm` / `wd`、`ce8be540f` 的 `dn` 与行菜单，以及用户提供的新版截图。与旧审核基线相比，这是明确采用新版搜索形态的一处例外；没有复制跨模式分类或仅适用于 Claude 服务的能力。

归档搜索补充核验：本机 Claude Desktop `3.6556.2.0` 的 `ion-dist/assets/v1/c2771e1f6-C1UCZLNP.js`，SHA-256 `2faab5ee9d3722b7951e8a3e610d968cce1c395a40dcf3e870d7ca2302f9287e`。通过普通文件读取静态核对 `Du` / `eu`：非空查询或显式包含归档时，合并 live / archived 候选；空白默认只取 live。这是本次采用的交互依据，没有运行 Claude 脚本。其服务端和桌面数据接口不能直接用于 Codex，查询继续复用原生 `thread/search` 的 `archived` 参数，旧后端沿用 `thread/list` 降级；本次没有增加自编译后端能力或依赖。

## 验证

```powershell
npm --prefix codex-ui test
npm --prefix codex-ui run build
# Windows 通过 Start-Process -Wait -PassThru 取得退出码：
node_modules\electron\dist\electron.exe codex-ui/desktop/palette-smoke.test.mjs
```

桌面验收使用独立资料目录、真实 Chromium 与合成 RPC，覆盖正文命中、混合结果排序及 25 条上限、归档只读打开、行菜单与归档筛选、触屏筛选、空结果、单侧查询失败及重试、旧后端降级、长查询、多行粘贴、输入竞态、撰写切换、焦点恢复及 320/768/1024/1440px 布局。不连接真实账户或修改现有会话；截图和结果保留在输出的临时目录。

2026-10-25 验证：构建通过；清除测试进程继承的 `CODEX_UI_BROWSER_TOKEN` / `CODEX_UI_EXPERIMENTAL_BACKEND` 后，在正常 Windows 进程环境下单测 385/385 通过。Chromium `152.0.7977.130` 桌面验收通过，已检查宽屏与 320px 截图。沙箱内的 Electron 启动及预热子进程终止曾受权限限制，未为测试修改 ACL 或关闭 Chromium 沙箱。未替换已安装应用，未用真实会话数据验收。
