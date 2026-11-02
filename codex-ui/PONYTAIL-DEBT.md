# Ponytail 债务台账

初次扫描于 2026-11-02（提交 `de8f7cdce`，68 处标记）；同日按"修缺陷和有明确路径的低风险升级"修了一轮，现余 52 处。命令：

```bash
git grep --no-index --exclude-standard -nE '(#|//|/[*]|<!--|--) ?(shortcut|ponytail):'
```

全部标记都在 `codex-ui/` 下，`codex-rs/` 里没有。路径相对于 `codex-ui/`。`no-trigger` 表示注释里没写升级路径或触发条件。

## 本轮已修复（16 处，标记已删除）

- [src/styles/transcript.css](src/styles/transcript.css)、[Settings.tsx](src/components/Settings.tsx)：macOS 上系统字体现在会悬挂，度量值取自本机 Claude 4.4212.0 的 `[data-hang-face=system]`；其他平台仍不悬挂。
- [src/lib/codex.ts](src/lib/codex.ts) `submitPendingMessage`：待发送消息会记住自己是会话的第一条（`PendingMessage.fresh`），重试后照样自动生成标题。有测试。
- [server/context-usage.mjs](server/context-usage.mjs)：rollout 改为从上次读到的整行末尾接着读；文件变小或 inode 变了才从头读。有测试。
- [server/files.mjs](server/files.mjs)：已安装的编辑器每分钟重新探测一次。
- [server/process.mjs](server/process.mjs) `spawnArgs`：经 cmd.exe 启动 npm 的 `.cmd` shim 时，参数按 CommandLineToArgvW 规则加引号；orchestrator、title、executor 三处 spawn 都改用它。有测试；**没在 Windows 上实跑**。
- [server/orchestrator.mjs](server/orchestrator.mjs)：没有数据目录（CLI、Vite）时，statsig stable id 存到 `CODEX_HOME/codex-ui/`，不再每次启动都换。
- [src/components/Rail.tsx](src/components/Rail.tsx)：已关闭的变更行只保留最新 500 条。
- [src/lib/codex.ts](src/lib/codex.ts) `removePullRequest`：移除的 PR 按会话保留最近 200 个。有测试。
- [src/lib/cloud-automations.ts](src/lib/cloud-automations.ts) `listAll`：云端任务读到游标用完为止（游标重复就停），不再最多读 10 页。有测试。
- [src/lib/cloud-automations.ts](src/lib/cloud-automations.ts) `scheduleParts`：没写 BYHOUR / BYMINUTE 的规则按 DTSTART 的时刻计算 UNTIL 当天的结束日，不会再多出一次运行。原有一条测试固定的正是旧的错误结果，已改为正确值。
- [src/lib/linked.ts](src/lib/linked.ts) `sendPeerMessage`：发给不在视图里的会话时，后台悄悄加载后照常送达，不再报 NOT_LOADED。
- [src/components/ScheduledForm.tsx](src/components/ScheduledForm.tsx)：所选文件夹不是 Git 仓库时，"工作树"开关置灰；探测失败时保持原样。
- [src/components/Plugins.tsx](src/components/Plugins.tsx)：「显示更多」改为量渲染高度（超过 160px 才出现），不再按 480 个字符判断。
- [src/components/ScheduledShare.tsx](src/components/ScheduledShare.tsx)：「查看更多」改为量两行折叠后是否截断。
- [src/components/Scheduled.tsx](src/components/Scheduled.tsx)：列表的搜索、筛选和排序保存在页面路由里，点进任务再返回时还在；离开定时任务页才清空，和 Claude 的 URL 行为一致。
- [src/components/Composer.tsx](src/components/Composer.tsx)：按 ↑ 召回历史时跳过 app 自己发出的消息（heartbeat、cron、ci-monitor 等）；Esc Esc 回退选择器的列表不变。

另有 3 处范围缩小或注释改正，标记保留：`store.ts` 的 toast 计时（松开后已改为接着走剩余时间）、`orchestrator.mjs` 的 code_mode（布尔值其实没丢）、`claude-marks.mjs`（chunk 名核对到 4.4212.0）。

附带修了一个日期炸弹测试：`context/automation-tools.test.mjs` 写死的 `DTSTART:20261102T090000` 一过当天 9 点就会失败，已改成 2099 年。

## 台账外发现（已修）

- [server/claude-fonts.mjs](server/claude-fonts.mjs)：原来 `findIonDist` 只找 Windows 的 WindowsApps，Mac 版读不到 Claude 字体和工作动画，只能用替代字体和静态圆点。现在 `ionDistHere` 在 macOS 上会去找 `/Applications` 或 `~/Applications` 下 `Claude.app` 的 `ion-dist.asar`；`ionFiles` 能读文件夹，也能直接解析 asar 归档（Electron 里用 `original-fs`）。字体、许可文本和工作动画（`claude-marks.mjs`）都走这一层。已用本机 Claude 4.4212.0 在纯 Node 和 Electron 44 主进程里分别验证过，并用自造的 asar 归档补了测试。

## 剩余标记（54 处）

保留理由分五类：**有意**（注释写明是故意的设计或偏离）、**未触发**（注释写的升级条件还没出现）、**需后端**（要在 codex-rs 加协议字段，并按 AGENTS.md 绑实验型后端开关）、**大功能**（要做新功能或成片移植）、**不改**（升级反而有害）。

### context/

- [rrule.mjs:127](context/rrule.mjs#L127)：没写的 WEEKLY 星期几按 `now` 读。`now === Date.now()` 时和 ChatGPT 一致。有意。`no-trigger`
- [rrule.mjs:178](context/rrule.mjs#L178)：MONTHLY、YEARLY 等规则按本地挂钟算，ChatGPT 按 UTC。有意。`no-trigger`
- [rrule.mjs:245](context/rrule.mjs#L245)：没写的 HOURLY BYMINUTE 当作未写，和 ChatGPT 差几秒。有意。`no-trigger`
- [rrule.test.mjs:245](context/rrule.test.mjs#L245)：测试跳过夏令时切换前后的几个小时。有意。`no-trigger`

### desktop/

- [main.mjs:775](desktop/main.mjs#L775)：任务一结束就释放保持唤醒。upgrade: 连续多轮之间机器真打盹时加宽限。未触发。

### scripts/

- [claude-css.mjs:101](scripts/claude-css.mjs#L101)：跳过嵌套 CSS 规则。upgrade: Claude 样式表不再扁平时改写父选择器。未触发。

### server/

- [automations.mjs:7](server/automations.mjs#L7)：每个任务同步读几个小文件。不改：改成异步会破坏文件头写明的"进程内不交错"不变量。
- [automations.mjs:23](server/automations.mjs#L23)：runs.json 整份重写，只留 200 条。upgrade: 需要更长历史时改 runs.jsonl。未触发，而且要改存储格式。
- [automations.mjs:36](server/automations.mjs#L36)：TOML 控制字符转义成 `\uXXXX`。有意。`no-trigger`
- [automations.mjs:52](server/automations.mjs#L52)：从不写 project target，读进来的照样保留。有意。`no-trigger`
- [automations.mjs:229](server/automations.mjs#L229)：heartbeat 一次性任务也会结束。有意偏离 ChatGPT。`no-trigger`
- [automations.mjs:369](server/automations.mjs#L369)：重新同步时不加锁。upgrade: 真出现重复运行时加 `.sync-<nominal>` 占位文件。未触发；比较并交换已把窗口压到微秒级，加锁反而多了锁文件残留的风险。
- [automations.mjs:419](server/automations.mjs#L419)：slug 截到 64 个字符。upgrade: id 需要按全名区分时加短哈希。未触发；靠 -2、-3 后缀，id 已经唯一。
- [automations.mjs:580](server/automations.mjs#L580)：说明重试会沿用原来的 nominal 时间。有意。`no-trigger`
- [claude-marks.mjs:11](server/claude-marks.mjs#L11)：按 chunk 名找模块。upgrade: 改名后改搜 `as SHEET_URLS}`。未触发，2.42304 到 4.4212.0 都没变。
- [orchestrator.mjs:250](server/orchestrator.mjs#L250)：会替换用户 config.toml 里自己写的 `direct_only_tool_namespaces` 列表（布尔值 codex 会保留）。upgrade: 碰到有人配置时合并两份列表。未触发。
- [orchestrator.mjs:572](server/orchestrator.mjs#L572)：用 ChatGPT 私有的 profile 接口。upgrade: app-server 暴露 profile 字段后替换。需后端。
- [orchestrator.mjs:729](server/orchestrator.mjs#L729)：图片库自己读 bootstrap。upgrade: 请求量要紧时共用缓存。未触发，每个账号每分钟最多多一次请求。

### src/components/

- [Approvals.tsx:306](src/components/Approvals.tsx#L306)：SplitDropdownButton 是局部实现。upgrade: 别处也要用时移到 ui.tsx。未触发。
- [Browser.tsx:326](src/components/Browser.tsx#L326)：打开服务器对话框的添加表单，不往聊天里发提示词。有意。`no-trigger`
- [Composer.tsx:297](src/components/Composer.tsx#L297)：附件副本留在 `CODEX_HOME/attachments`。upgrade: 清扫自己的附件目录。不改：会删用户文件，需要单独设计确认。
- [FilePreview.tsx:20](src/components/FilePreview.tsx#L20)：编辑器是普通 textarea（无高亮、缩进参考线与空白标记）；引用式链接只在自己的块内解析。upgrade: 编辑成为日常路径时换成编辑器组件。
- [Images.tsx:1242](src/components/Images.tsx#L1242)：坐标映射和 Browser 的标注重复一份。upgrade: 第三个调用方出现时合并。未触发。
- [LibraryFile.tsx:905](src/components/LibraryFile.tsx#L905)：PPTX 预览不支持主题色、图表、表格等。大功能。`no-trigger`
- [Main.tsx:346](src/components/Main.tsx#L346)：聊天栏在右侧栏左边的剩余空间里居中。大功能：要移植 4.4212 的整套 `--session-rail-*` 布局变量，还要逐像素对照。`no-trigger`
- [Rail.tsx:2140](src/components/Rail.tsx#L2140)：每一轮都读全部绑定的 PR。upgrade: 一个会话绑很多时，其余只读一次。未触发。
- [Scheduled.tsx:293](src/components/Scheduled.tsx#L293)：没有秒表插图。upgrade: 需要时从安装包里读。大功能。
- [ScheduledDetail.tsx:282](src/components/ScheduledDetail.tsx#L282)：heartbeat 不保存运行记录，和 ChatGPT 一样。有意。`no-trigger`
- [Sidebar.tsx:1580](src/components/Sidebar.tsx#L1580)：第 50 次以前的运行会话重新加载后时钟消失。upgrade: bridge 按 thread id 查。未触发，而且要新增接口。
- [Terminal.tsx:17](src/components/Terminal.tsx#L17)：没有溢出菜单（标签条滚动）和键盘重排。upgrade: 标签页多到难找时补上。
- [Transcript.tsx:1400](src/components/Transcript.tsx#L1400)：并行调用里先结束的会让整次运行提前结束。需后端：调用让出时 Codex 只通知模型。`no-trigger`
- [content.tsx:783](src/components/content.tsx#L783)：用 3000 行代替 diffs 库的大小检查（原版逻辑没有追溯）。有意。`no-trigger`
- [ui.tsx:607](src/components/ui.tsx#L607)：子菜单用 160ms 宽限代替安全三角区。upgrade: 斜着移动还会丢菜单时移植三角区。未触发；改了需要实际交互验证。
- [ui.tsx:2036](src/components/ui.tsx#L2036)：变形动画只处理缩略图本身的圆角。upgrade: 出现 `object-fit: contain` 的缩略图时移植。未触发。

### src/lib/

- [automation-requests.ts:116](src/lib/automation-requests.ts#L116)：列表最多 200 个任务。upgrade: 加分页。不改：要给模型可见的工具加参数，偏离 ChatGPT 的字段定义。
- [automations.ts:285](src/lib/automations.ts#L285)：过点 10 分钟才算错过，因为抖动最多 5 分钟。有意。`no-trigger`
- [cloud-automations.ts:193](src/lib/cloud-automations.ts#L193)：Intl 不认识的时区当 UTC。upgrade: 服务端发来 ICU 没有的时区时加别名表。未触发。
- [codex.ts:973](src/lib/codex.ts#L973)：来自 atlas 和 chatgpt 的会话不进列表，因为 `ThreadSourceKind` 选不中 `Custom(...)`。需后端。`no-trigger`
- [codex.ts:1087](src/lib/codex.ts#L1087)：3 秒内读三次，更慢的交给 loadDescendants。有意。`no-trigger`
- [codex.ts:2209](src/lib/codex.ts#L2209)：`request_directory` / `/add-dir` 加的可写目录只在运行中的会话里有效，重启或换权限模式就没了。upgrade: 用户反映丢失时存进会话的 overrides。
- [context.ts:38](src/lib/context.ts#L38)：假定上下文阈值是 95%。upgrade: 读模型自己的值。需后端：app-server 的 `Model` 不带 `effective_context_window_percent`。
- [images.ts:606](src/lib/images.ts#L606)：两个字段名是猜的。有意。`no-trigger`
- [library-preview.ts:346](src/lib/library-preview.ts#L346)：已用外部 app 打开的副本留在 attachments，app 可能还开着它。有意。`no-trigger`
- [library.ts:370](src/lib/library.ts#L370)：只支持本地文件，不接云盘。大功能。`no-trigger`
- [library.ts:398](src/lib/library.ts#L398)：文件夹没有缩略图。大功能。`no-trigger`
- [library.ts:489](src/lib/library.ts#L489)：按扩展名判断文件类型，够收藏筛选用。有意。`no-trigger`
- [linked.ts:60](src/lib/linked.ts#L60)：每分钟扫一次过期提议，卡片自己判断时间。有意。`no-trigger`
- [markdown.ts:248](src/lib/markdown.ts#L248)：按块渲染看不到别处的链接定义，所以只在流式输出时按块渲染。有意。`no-trigger`
- [panes.ts:409](src/lib/panes.ts#L409)：更改面板的「测试 / 构建 / 生成文件」分类用路径规则代替 Claude 的分类器（未追到源码）。upgrade: 遇到分错的项目再放宽规则。
- [store.ts:586](src/lib/store.ts#L586)：面板视图超过 200 个时先删最旧的；每次写入都会把它挪到末尾。有意。`no-trigger`
- [store.ts:840](src/lib/store.ts#L840)：只存在本机，保留最新 200 条。upgrade: 改存为后端条目。大功能。
- [store.ts:889](src/lib/store.ts#L889)：只存在本机，保留最新 1000 条。upgrade: 改存为后端条目。大功能。
- [store.ts:1163](src/lib/store.ts#L1163)：被压在后面的 action toast 继续计时。要先算出堆叠里谁在前面。`no-trigger`

### src/styles/

- [composer.css:919](src/styles/composer.css#L919)：弹层内边距没有依据，按其他弹层取 12px。有意。`no-trigger`

**52 markers, 29 with no trigger.**
