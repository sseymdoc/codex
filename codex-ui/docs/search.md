# 搜索

按 Claude Desktop 2.42304.0.0 新版搜索面板对齐；Codex UI 只有 Code 模式，因此不显示内容分类标签。

- 侧栏“搜索”、`Ctrl+K` 和 `Ctrl+Shift+K` 打开同一个搜索界面。空白时先显示最多 8 条最近会话，再显示新建会话操作。
- 输入后以 200ms 防抖搜索所有会话的标题和正文，最多 25 条结果；显示正文摘要及匹配文字。长文本仍是搜索，粘贴多行文本时合为一行。
- `↑` / `↓` 选择，`Enter` 打开；选中行的 `…` 或 `Alt+Enter` 打开已有会话菜单，沿用固定、重命名、分叉、分组、归档、删除等操作及原有确认流程。
- 空白搜索框内按 `/` 打开筛选，支持未归档会话、已归档会话及操作搜索；没有虚构后端尚未提供的项目或仓库筛选。
- `Tab` 在搜索和新会话撰写间切换并保留文本；撰写时 `Enter` 发送、`Shift+Enter` 换行。搜索结果中不插入会发送查询内容的快捷操作。
- `Esc` 或点击遮罩关闭，恢复打开前的焦点。旧后端缺少 `thread/search` 时降级为标题搜索，并在界面注明；搜索失败可重试。

参考包只读，不打包或执行 Claude 的代码。复用 `Palette`、`Popover`、`SessionMenuItems` 及现有 RPC；参考公开 [cmdk](https://github.com/dip/cmdk) 的搜索菜单交互，没有新增依赖。

依据：`c2771e1f6` 的 `Dm` / `wd`、`ce8be540f` 的 `dn` 与行菜单，以及用户提供的新版截图。与旧审核基线相比，这是明确采用新版搜索形态的一处例外；没有复制跨模式分类或仅适用于 Claude 服务的能力。

## 验证

```powershell
npm --prefix codex-ui test
npm --prefix codex-ui run build
# Windows 通过 Start-Process -Wait -PassThru 取得退出码：
node_modules\electron\dist\electron.exe codex-ui/desktop/palette-smoke.test.mjs
```

桌面验收使用独立资料目录、真实 Chromium 与合成 RPC，覆盖正文命中、会话打开、行菜单与归档筛选、空结果、错误重试、旧后端降级、长查询、多行粘贴、输入竞态、撰写切换、焦点恢复及 320/768/1024/1440px 布局。不连接真实账户或修改现有会话；截图和结果保留在输出的临时目录。
