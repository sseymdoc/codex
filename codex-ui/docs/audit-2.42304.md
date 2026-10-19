# codex-ui 复刻审核（Claude Desktop 2.42304.0.0 · Code 标签页）

审核日期：2026-10-19。范围只含 Code 标签页：不含 Chat 模式，也没有左上角的 Claude / Code 切换控件。

## 依据与方法

- **对照物**：安装包 `Claude_2.42304.0.0_x64`。渲染层是 `app/resources/ion-dist`（chunk 与 `c6a992d55` 样式表），主进程是 `app.asar`（`.vite/build/index.chunk-lzaSYO3Q.js`）。全程只读静态分析：没有读取、连接或干预任何正在运行的 Claude 进程。
- **参考**：open-claude-ui 设计稿（W0–W22）只作导引；与安装包冲突时以安装包为准。
- **做法**：先把 chunk 美化，再从 `defaultMessage` / `id` 建英文源串索引。按 12 个区域逐条对照：外壳、侧栏、首页、转录骨架、转录条目、输入框、审批与提问、面板、命令面板与对话框、设置、令牌与原子组件、后端。改动落到代码时，在注释里写明出处，格式是「chunk 前缀 + 函数名」（例如 `c4db265df Bt`）。文中的行号指美化后的文件。
- **文案**：按桌面壳自带 `zh-Hans.json` 的语气翻译（用「您」、引号用 “ ”、Remote Control 不译）。官方没有译文的串（如通知）按同一语气自译。

## 一、复刻诚实度

### 1. 基线：服务端开关一律取关闭值

真机很多界面由 GrowthBook 开关决定。读取函数（shared-25 `Zs` → `evalFeature`）对服务端没有下发的特性返回 `on:false`。codex-ui 没有 Anthropic 账号，拿不到任何下发，所以复刻的是**所有未知开关都关闭**时的 Code 标签页。这是一个自洽的真实形态，不是拼出来的。

| 开关 | 真机读取位置 | 关闭时的真机行为 | codex-ui |
| --- | --- | --- | --- |
| `claudeai_cc_epitaxy_session_presets_main` | shared-11 `Qo` / `$o`、`rc()`（经 `nc` 锁存）；cc43287c9 `P_` / `Y_` | 首页是问候语而不是启动卡片（shared-20 `oh`）；没有「会话详情」侧栏（cc43287c9 `an2` / `on2`、`railToggle`）；提问卡停靠在输入框上方（c12c146ad presentation 默认 `"dock"`）；侧栏走 classic 列表（shared-20 `SS()` → `cd()`） | 一致；唯「会话详情」侧栏按用户要求单独取开关开启时的形态（`Rail.tsx`） |
| `__gb__1669033294` | c2771e1f6 `B2 = Wr()` | 旧版命令面板：页脚提示、Tab 进入命令模式、没有行操作卡 | 一致 |
| `ccd_palette_session_actions` | cf74bc599 `H2 = B(...)` | 命令面板里没有重命名、派生、移到分组、固定等会话命令，也没有 Ctrl+Alt+R / O | 一致 |
| `panels`（`data-cds-fizzy-lake`） | shared-4 `jf` → `kf`：允许列表 `Cf` 为空，所以 2.42304 里恒为关 | 平铺取 shared-18 `Tb`（块间距 12、外圈 8、最小宽 280）；侧边面板是 panel 级卡片（shared-frame `ah("panel")`：`rounded-card bg-surface-2 shadow-panel-sm`，深色 `shadow-sm` 加 1px `alpha-2` 描边） | **本轮改正**：此前是扁平 1px 分隔，属于不可达的 `panels` 形态 |
| 「杀开关」型门控（`!flag(...)`） | c8190f70d、c8e302838、cc28ac22a | 默认显示 | 保留显示 |

### 2. 各区域落点

| 区域 | 主要依据 | codex-ui | 要点 |
| --- | --- | --- | --- |
| 桌面壳 | app.asar `index.chunk-lzaSYO3Q.js` | `desktop/main.mjs`、`preload.cjs`、`quick.html` | 窗口 1200×800（最小 600×400，登录前 600×600），标题栏让位 `ceil(140 / zoom)`，缩放 25%–500%；应用菜单不显示为菜单栏（菜单按钮、单按 Alt 或 F10 打开）；托盘、Quick Entry（606×470）、跳转列表、通知、运行时防休眠、开机启动 |
| 页面外壳 | shared-19 / shared-20 | `App.tsx`、`shell.css` | Windows 36px 标题栏（菜单、侧边栏开关、返回 / 前进，提示在下方）；启动骨架；加载失败自动重试（0 / 15 / 30 s，±20%，180 s 内）；查找条；toast 在右下 |
| 侧栏 | shared-18–22、ce4f4374c；classic 路径 shared-21 `iU`、`Dq` / `bq` | `Sidebar.tsx`、`session.ts` | Filter ▸ 状态（活跃 / 已归档 / 全部）、分组（桌面默认按文件夹，shared-52 `_h()`）、排序；置顶；派生与子代理按家族嵌套；状态字形；右键与 ⋮ 共用一份菜单（单字母快捷键）；行内重命名；Shift / Ctrl 多选与批量操作；分组拖放；peek、窄窗口与手机 sheet |
| 首页 | shared-20 `oh`；cc43287c9 `n5` | `Main.tsx` Welcome、`landing.ts` | 问候语（欢迎回来 / 接下来做什么）；行动中心（需要输入、未读，可关闭、全部标为已读；Codex 项目）；文件夹胶囊与最近文件夹 |
| 转录骨架 | c96d752d0、cf74bc599 | `Transcript.tsx`、`session.ts` | 工作行状态机；正常 / 思考 / 详细三种视图（Ctrl+O，按会话记住）；章节；会话内查找；回退确认（无法撤销、文件保持不变）；接近顶部时加载更早的历史 |
| 转录条目 | c96d752d0 `JIe`（默认版；Step 版由服务端 renderer 开关控制）；类名来自 c425fb3cf / cb6930dae | `items.tsx`、`transcript.ts` | 每个工具调用一行（动词 · 细节 · 结果 · 箭头），运行中的动词微光至少 650ms；命令摘要规则；MCP、子代理、diff、通知与 Hook 干预行 |
| 输入框 | c227f4d5e `bQ`（layout `"row"`，presets 开关打开时的 pickerRow）、cc43287c9 `kP`（singleRowCard）、shared-5 `Kd`、shared-6 `d_` / `wg` | `Composer.tsx` | 两页共用一张单行输入卡（高 44、r14；「+」在文字前，发送只在有内容时出现，语音在发送后）；卡下一行：左模式，右模型、努力程度（保持独立，不并进模型胶囊）、上下文环；模式菜单（手动 / 接受编辑 / 计划 / 自动，「绕过权限」需在设置里允许）；模型、努力程度、快速模式；上下文环与弹层（50% 起显示「压缩会话」、额度、「请求更多」）；+ 菜单；斜杠命令先插入、回车再执行；↑ 先取回排队消息 |
| 审批与提问 | c96d752d0 `Rj`（c12c146ad 外壳）、ccae33cda `Lt`、c8cf7b513、c96d752d0 `aDe`、c385ec32f；按键 ccbc7e432 / c6ffe955f；shared-10 `qx` | `Approvals.tsx`、`approvals.ts` | 停靠审批卡（后面最多两张幽灵卡；拒绝 \| 本次会话内允许 / 始终允许 \| 允许一次）；卡片出现后 400ms 内忽略点击；停靠提问卡（分页、其他、跳过）；计划模式的计划审批卡；MCP 表单与链接请求 |
| 面板 | c03935b01 `Ti`、cf53e1812、c4db265df `Bt`、c9543da06 `ed`、shared-19 `W7`、shared-18 `Tb` | `Panes.tsx`、`panes.ts` | 平铺：聊天 : 大面板 = 2 : 3，聊天 : 终端等 = 2 : 1，第二个面板竖向叠放；2rem 头部（⋮ 设置、展开 / 收起、关闭）；Ctrl+\ / Ctrl+Shift+\、F7 / Shift+F7；**本轮**改为 panel 卡片、12px 分隔条（悬停显示 3×56 指示条）、最小宽 280 |
| 命令面板与对话框 | c2771e1f6 `Dm`、ce8be540f / c01b6d4ec、shared-1 `jL`、c518a31cc `Te`；shared-frame `M_` | `Palette.tsx`、`palette.ts`、`Dialogs.tsx` | 旧版面板；快捷键面板；设置深链按真机 `gs()`（设置行用齿轮，自定义行用扳手）；对话框退出动画；删除确认默认聚焦「删除」 |
| 设置 | shared-19 `pA` / `Uk` / `qk` / `Nw` / `Pw`、cc011544b、shared-1 `gx` / `xx` / `hx`、c71860c77；插件详情 c24c8737b `wo` / `vo`、ce5c807c8、c0ad2fd1b、c5e7d44b0、c334c9fcc | `Settings.tsx`、`SettingsCustomize.tsx`、`settings.ts`、`plugins.ts` | 设置 / 这台电脑（仅桌面版）/ 自定义三组；Codex 页对应真机「Claude Code」页；搜索按真机的规范化与打分；关于从桌面版帮助菜单打开；插件详情头部是「分享 · ⋮（检查更新 / 卸载）· 开关」 |
| 令牌与原子组件 | c6a992d55 `.cds-root` / `[data-density=comfortable]`、shared-frame | `tokens.css`、`base.css`、`ui.tsx` | 两档密度；按钮梯度；菜单与子菜单；全页唯一的提示层（支持第二行说明）；分段控件、开关、复选框、键帽 |
| 字体 | c6a992d55 字体令牌与 `@font-face`；cd19fedd2 `interfaceFont`、shared-52 `cm()`、c96d752d0 `uI()`、c4a9ee384（悬挂度量）、cea462098（字体许可）、shared-frame `Ra()` | `server/claude-fonts.mjs`、`tokens.css`、`theme-init.js`、`Settings.tsx`、`quick.html` | 界面、回复与用户消息用 Anthropic Sans（Code 标签页的回复跟随界面字体，`uI()` 返回 `"sans"`），代码与终端用 Anthropic Mono，字标用 Anthropic Serif；中日韩回退链与真机相同；不合成粗体 / 斜体。界面字体（Anthropic Sans / 系统 / OpenDyslexic）在 Codex → 外观（真机放进「通用」要开 `__gb__1197194941`），说明后附「字体许可」；引号悬挂按所选字体的度量；代码字体写 `--cds-font-mono-override`；Quick Entry 同样用 anthropic-sans |

### 3. 与真机不同的地方

**Codex 专有、保留**（真机没有，或真机的位置在开关开启时才存在）：

- 目标（goal）：在「会话详情」侧栏的目标卡里（同真机开关开启时），「计划」面板顶部也保留一份，供侧栏隐藏时使用。
- 项目：文件夹胶囊菜单保留「设为项目 / 重命名项目 / 删除项目」。真机 Code 标签页的 Projects 早期体验已结束（c9543da06 “Projects early access has ended…”），侧栏也没有项目管理；去掉的话 Codex 的项目就没有任何入口。
- 自动审查拒绝行的「仍然允许」、记忆、Hooks、Windows 本地沙箱、Remote Control 配对、从其他代理导入、实验功能页、语音模式（WebRTC）。
- 后台任务面板的「停止所有后台任务」（`thread/backgroundTerminals/clean`）；命令面板的「审查代码改动」「打开文件夹…」；分组颜色。

**为适配 Codex 后端而不同**：

- 更改面板默认显示「本轮更改」。真机默认「所有更改」，但 Codex 的 `gitDiffToRemote` 在仓库没有远端时会报错，所以「所有更改」作为可选范围。
- 侧栏按环境分组时用文件夹名，不从仓库地址解析 owner/name。
- 后台任务没有「已完成」分组：Codex 只列出运行中的进程。
- 提问卡去掉了「Codex 不会等待您回答」：codex-ui 不会自动回答非阻塞问题，这句话不成立。
- 卡片出现后 400ms 内的按键直接忽略（真机是放行但不执行）；「窗口重新获焦且没有指针操作时忽略」这条规则没有照搬。
- 命令向运行中进程写入的 stdin（`item/commandExecution/terminalInteraction`）不显示：真机命令卡没有这一行。initialize 里已退订该通知；终端回显开着时，写入的内容仍会出现在命令输出里。
- 插件分享（c0ad2fd1b 的分享面板，按经典样式 c5e7d44b0 `k` 绘制）：协议没有成员目录，面板只列出已有的人，不能邀请，也不能改角色。「常规访问」用 Codex 的三档可见范围代替真机的两档：仅限受邀用户 / 工作区中拥有链接的人 / 工作区中的所有人。新建分享只能选前两档（`plugin/share/save` 不接受 `LISTED`）；改范围时把原有成员原样交回 `updateTargets`。「停止分享」「已分享」列表和「取回到本地」是 Codex 专有；「设为私密」确认（c0ad2fd1b `Xt`）只在离开「工作区中的所有人」且无法再发布时出现。「上传新版本」也是 Codex 专有：已分享且插件文件夹在这台电脑上时，`plugin/share/save` 只带 `pluginPath` 与 `remotePluginId`（带了它就不能再传 `discoverability` / `shareTargets`），把本地改动推到原有分享；真机唯一的更新路径是组织库发布（c63fee29b `Ge` 的 `isUpdate`，带发布说明和安装方式），它要等服务端下发文案（`5b2kir`），开关全关时不出现。
- 「检查更新」只出现在 ChatGPT 远端安装的插件上：`plugin/reconcile` 只同步这类插件。本地市场里的插件仍由「全部更新」（`marketplace/upgrade`）更新。

**近似处理**（代码里有 `ponytail:` 注释写明上限）：

- 多块布局里，真机的聊天块也在 8px 外圈之内，并配合 `data-chat-gutter-*` 调整左右留白。codex-ui 的聊天列保持满高，只有面板列留外圈。
- 子菜单用 160ms 的指针方向宽限代替 Base UI 的 safe polygon。
- 防休眠在回合结束后立即释放（真机会再等一会）；toast 在鼠标悬停时不暂停计时。
- 托盘图标是在代码里画的 `</>`（Claude 自带图标文件）；缩放、主题和桌面设置存在 `window-state.json`；Quick Entry 关闭后不把焦点还给之前的应用（需要原生模块）。
- Anthropic 的字体文件（含图标字体 Anthropicons）不随 codex-ui 分发（字形归 Anthropic 所有）：服务端在运行时从本机安装的 Claude Desktop（Windows 的 MSIX 包 `WindowsApps\Claude_*`，取最新版本）读出主窗口样式表里的 `@font-face` 与字体文件，经 `/claude-fonts.css`、`/claude-fonts/*` 提供，「字体许可」读同一安装里的 `third-party-notices.txt`。没装 Claude Desktop 时 `/claude-fonts.css` 改给 `public/fonts` 里开源授权的替身，字体族名不变：图标是 Phosphor Icons（MIT）放到 Anthropicons 码位上生成的可变字体（`src/fonts/build-icons.py`，wght 400–700 的笔画粗细对齐 Anthropicons，Claude 独有的十来个图形换成最接近的 Phosphor 图形），Anthropic Sans / Mono 换成 Geist / Geist Mono（OFL，按 Anthropic 的行高度量），衬线体落到真机同款按度量校准的 Georgia，OpenDyslexic 一并内置；「字体许可」改读 codex-ui 自己的 `public/third-party-notices.txt`。
- 界面字体选「系统」时引号不悬挂：真机只在 macOS 上按系统字体的度量悬挂。

**真机有、这次没有做**：

- 面板：移动到左 / 右 / 上 / 下与 Fill / Tile 菜单（受开关控制）；关闭后记住原位置；面板的打开状态在重启后不恢复（比例会保存）；更改面板的未提交更改、对比分支、Commits、审查发现步进条、按文件夹分组和词级高亮；文件面板的文件树与编辑；终端的选择 shell、溢出菜单和拖动排序；计划面板自动打开（受开关控制）。
- 转录：morph 动画、词级高亮、图集左右切换、「Open in terminal」、ANSI 着色（目前只剥离转义码）、「正在启动会话…」（`thread/start` 返回前转录还没挂载）。
- 输入框：Ctrl+R 历史搜索、在分叉会话中发送、发送并留在此页、`/copy` `/theme` `/export` `/cd` `/resume`；非图片附件（桌面桥没有 `getPathForFile`，菜单保持「添加图片」）；自动模式的「推荐」徽标（Codex 没有这个推荐来源）。
- 首页：Pull requests 区（Codex 没有 PR / CI 状态）。
- 命令面板：`jump_to_*` 命令；项目与已归档结果；设置项级深链；灯箱的多图、拖拽平移与 Ctrl+滚轮。
- 设置：通知级别、Output style、Strict sandbox、代码主题、Dynamic workflows；设置搜索不索引技能 / 插件 / 连接器的名称；「浏览连接器」没有搜索框，只能分页加载。
- 侧栏：导出、Ctrl+数字跳转提示、分组排序、标题生成动画、对话视图子菜单、空状态插画；置顶行下不挂家族成员。
- 桌面壳：托盘里的用量行（服务端开关默认值未知）。
- 审批：URL 请求的完成等待态、文件 diff 预览（受开关控制，默认值未知）；计划卡出现时不自动打开计划面板。
- 原子组件：按钮的 busy / pressed 态、复选框的 indeterminate 态，以及 `--cds-z-tooltip` 等几个没有使用方的令牌。

**Claude 专有、不移植**：Chat 标签页与 Claude / Code 切换；环境预设、PR 与 CI 状态、worktree、云端与 SSH 会话、Output style、Privacy / Capabilities 页、听写快捷键、Worktree location；会话的分享、复制链接、Routines、打开方式、批量改模型。

### 4. 静态分析核实不了的部分

- 真实账号下服务端开关的取值（例如 Step 版工具行、文件 diff 预览、托盘用量行）。codex-ui 一律取关闭值；某个账号如果开着，它看到的真机会和 codex-ui 不同。
- 窄窗口下真机面板是否改为浮层（`[data-pane-overlay]`、`--tile-overlay-*`）以及浮层的尺寸。codex-ui 在 860px 以下把面板列改为右侧浮层。
- 聊天块在多块布局里的上下留白（见上文「近似处理」）。
- MCP Apps 小组件（c6f6cf4c2、c98ac6b4b 里有 iframe 宿主）是否会出现在 Code 标签页。

## 二、Codex CLI 后端功能 → 前端对应

### 统计

| 类别 | 总数 | 前端使用 | 未用 |
| --- | --- | --- | --- |
| 客户端方法 | 175（稳定 108 + 实验 67） | 116 | 59 |
| 服务端请求 | 11（9 个 + 2 个 v1 遗留） | 6 个处理；5 个按设计回错误 | — |
| 服务端通知 | 87（稳定 63 + 实验 24） | 67 | 20（其中 7 个在 initialize 里退订） |

口径：清单取自 `codex-rs/app-server-protocol`（`client_request_definitions!`、`server_request_definitions!`、`ServerNotification`）。「使用」指 `src/` 里有以该方法名为字面参数的调用点，或通知 / 请求的 `case` 分支，并逐个确认有界面入口，见下表。上一版文档的「167 个方法、96 个通知、处理 77 个」不准确。

### 已用的客户端方法与界面入口

| 领域 | 方法 | 界面入口 |
| --- | --- | --- |
| 连接 | `initialize` | 启动连接；声明 `experimentalApi`、`openai/form` 扩展、退订的通知；`requestAttestation: false` |
| 连接 | `server/diagnostics` | 关于页的 app-server 内存与进程号 |
| 会话 | `thread/start`、`thread/resume`、`thread/unsubscribe` | 新建会话页发送；打开会话；切走后释放上一会话 |
| 会话 | `thread/list`、`thread/read`、`thread/turns/list` | 侧栏、首页行动中心、「查看全部」；打开会话时刷新已读回执；向上滚动加载更早的历史 |
| 会话 | `thread/name/set`、`thread/fork`、`thread/revert` | 行内重命名与重命名对话框；会话菜单「派生」与消息「从这里派生」；消息「回退到这里」（确认后执行） |
| 会话 | `thread/archive`、`thread/unarchive`、`thread/delete` | 会话菜单、批量操作、Ctrl+Shift+Backspace、设置 › Codex「归档不活跃的会话」；删除确认对话框 |
| 会话 | `thread/metadata/update` | 文件夹胶囊「设为项目」与移出项目（`projectId: ""` 表示清除） |
| 会话 | `thread/settings/update`、`turn/settings/update` | 已打开的会话里切换模型、努力程度、权限模式、快速模式、计划模式时立即生效；失败回滚并提示 |
| 会话 | `thread/readState/update` | 标为已读 / 未读、行动中心「全部标为已读」 |
| 会话 | `thread/compact/start` | `/compact`、上下文弹层「压缩会话」 |
| 会话 | `thread/shellCommand` | 输入框 `!` 模式 |
| 会话 | `thread/memoryMode/set` | + 菜单「记忆」开关 |
| 会话 | `thread/attachment/list` | 会话菜单「打开拉取请求」（按 G） |
| 会话 | `thread/search`、`thread/searchOccurrences` | Ctrl+Shift+K 内容搜索；会话内查找（Ctrl+F） |
| 会话 | `thread/approveGuardianDeniedAction` | 自动审查拒绝行的「仍然允许」 |
| 会话 | `thread/backgroundTerminals/list`、`…/terminate`、`…/clean` | 后台任务面板：列表、停止、停止所有后台任务 |
| 会话 | `thread/goal/get`、`thread/goal/set`、`thread/goal/clear` | 计划面板顶部的目标；`/goal` |
| 会话 | `thread/queue/add`、`…/list`、`…/delete`、`…/reorder`、`…/start` | 排队消息条：排队（Ctrl+Enter）、移除、重排、立即发送；「在输入框中编辑」= 删除后回填 |
| 分组与项目 | `threadSection/list`、`…/create`、`…/update`、`…/delete`、`thread/section/move` | 侧栏自定义分组：新建、重命名与颜色、删除、拖放与「移到分组」 |
| 分组与项目 | `project/list`、`project/create`、`project/update`、`project/delete` | 行动中心的项目区、标题栏项目徽标、文件夹胶囊菜单 |
| 回合 | `turn/start`、`turn/steer`、`turn/interrupt` | 发送；运行中按 Enter 引导；停止按钮与 Esc |
| 回合 | `review/start` | 「审查代码改动」对话框 |
| 模型与模式 | `model/list`、`collaborationMode/list`、`permissionProfile/list` | 模型菜单；计划模式；模式菜单里的自定义权限配置 |
| 模型与模式 | `experimentalFeature/list`、`experimentalFeature/enablement/set` | 设置 › 实验功能 |
| 文件 | `fs/readFile`、`fs/readDirectory`、`fs/watch`、`fs/unwatch` | 文件面板（实时更新）、文件夹选择对话框、设置 › 记忆文件 |
| 文件 | `fuzzyFileSearch` | `@` 文件提及；更改 / 文件面板的「转到文件」（Ctrl+P） |
| 文件 | `gitDiffToRemote` | 更改面板的「所有更改」范围 |
| 终端 | `process/spawn`、`process/writeStdin`、`process/resizePty`、`process/kill` | 终端面板（多标签、xterm） |
| 自定义 | `skills/list`、`skills/config/write`、`skills/extraRoots/set` | 设置 › 技能：列表、启用、额外技能目录；+ 菜单的技能 |
| 自定义 | `plugin/list`、`plugin/search`、`plugin/installed`、`plugin/read`、`plugin/install`、`plugin/uninstall` | 设置 › 插件：已安装、目录、搜索、详情、安装与卸载；+ 菜单「管理插件 / 浏览插件」 |
| 自定义 | `plugin/share/save`、`plugin/share/updateTargets`、`plugin/share/list`、`plugin/share/checkout`、`plugin/share/delete` | 设置 › 插件：插件详情的「分享」面板（分享、常规访问、复制链接、上传新版本、停止分享）；「已分享」列表与「取回到本地」 |
| 自定义 | `plugin/reconcile` | 设置 › 插件：远端插件详情 ⋮ 菜单的「检查更新」 |
| 自定义 | `marketplace/add`、`marketplace/remove`、`marketplace/upgrade` | 设置 › 插件 › 插件市场：添加、移除、全部更新 |
| 自定义 | `app/installed`、`app/read`、`app/list` | 设置 › 连接器（应用）；+ 菜单的连接器开关；「浏览连接器」 |
| 自定义 | `mcpServerStatus/list`、`config/mcpServer/reload`、`mcpServer/oauth/login` | 设置 › 连接器 › MCP 服务器：状态、重新加载、登录（带 `threadId`，按 `loginId` 匹配完成通知） |
| 自定义 | `hooks/list` | 设置 › Hooks（信任与启用写回 config） |
| 记忆 | `memory/status`、`memory/reset` | 设置 › 记忆：新版记忆状态、清空记忆 |
| 配置 | `config/read`、`config/batchWrite`、`configRequirements/read` | 启动时读配置；设置里的各项写回；托管约束限制模式、Remote Control 与登录方式 |
| 账户 | `account/read`、`account/login/start`、`account/login/cancel`、`account/logout` | 登录页（ChatGPT、设备码、API Key；按 `loginId` 匹配完成）；账户菜单「退出登录」 |
| 账户 | `account/rateLimits/read`、`account/rateLimitResetCredit/consume`、`account/usage/read` | 上下文弹层与设置 › 用量的额度（按 `limitId` 合并）；重置额度；30 天用量 |
| 账户 | `account/sendAddCreditsNudgeEmail` | 额度用尽时的「请求更多」 |
| 账户 | `feedback/upload` | 反馈对话框 |
| 远程控制 | `remoteControl/status/read`、`…/enable`、`…/disable`、`…/pairing/start`、`…/pairing/status`、`…/client/list`、`…/client/revoke` | 设置 › Codex › Remote Control：开关、配对、已连接设备与撤销 |
| Windows 沙箱 | `windowsSandbox/readiness`、`windowsSandbox/setupStart` | 设置 › Codex「本地沙箱」 |
| 导入 | `externalAgentConfig/detect`、`externalAgentConfig/import` | 设置 › 导入 |
| 语音 | `thread/realtime/start`、`thread/realtime/stop` | 输入框的语音按钮（服务端支持时显示） |

### 服务端请求

| 请求 | 处理 |
| --- | --- |
| `item/commandExecution/requestApproval`、`item/fileChange/requestApproval`、`item/permissions/requestApproval` | 停靠审批卡，按服务端给的决定集出按钮 |
| `item/tool/requestUserInput` | 停靠提问卡 |
| `mcpServer/elicitation/request` | MCP 表单（含 `openai/form`）与链接请求 |
| `currentTime/read`（实验） | 自动回复本机当前时间（配置选了外部时钟时才会发） |
| `item/tool/call`、`account/chatgptAuthTokens/refresh`、`attestation/generate`、`applyPatchApproval`、`execCommandApproval` | 回错误：codex-ui 没有注册动态工具，不用外部令牌模式，initialize 声明了 `requestAttestation: false`；后两个是 v1 遗留，v2 客户端收不到 |

### 已处理的通知（67 个）

| 领域 | 通知 | 界面 |
| --- | --- | --- |
| 会话 | `thread/started`、`thread/status/changed`、`thread/readState/changed`、`thread/archived`、`thread/unarchived`、`thread/deleted`、`thread/closed`、`thread/reverted`、`thread/name/updated`、`thread/settings/updated`、`thread/tokenUsage/updated` | 侧栏与标题栏状态、未读点、归档与删除、回退结果、标题、模式与模型同步（含计划模式）、上下文环 |
| 会话 | `thread/attachment/updated`、`thread/goal/updated`、`thread/goal/cleared`、`thread/queue/changed`、`thread/project/updated`、`project/changed`、`thread/environment/connected`、`thread/environment/disconnected` | 拉取请求链接、计划面板目标、排队条、项目归属、会话通知行 |
| 回合与条目 | `turn/started`、`turn/completed`、`turn/diff/updated`、`turn/plan/updated`、`item/started`、`item/completed`、`item/agentMessage/delta`、`item/plan/delta`、`item/reasoning/summaryTextDelta`、`item/reasoning/summaryPartAdded`、`item/reasoning/textDelta`、`item/commandExecution/outputDelta`、`item/fileChange/patchUpdated`、`item/mcpToolCall/progress`、`serverRequest/resolved` | 转录、工作行、更改面板、计划面板、审批卡撤下 |
| 审查与 Hook | `item/autoApprovalReview/started`、`item/autoApprovalReview/completed`、`autoApprovalReview/strictReviewRequired`、`hook/started`、`hook/completed` | 自动审查行、Hook 运行行 |
| 提示 | `error`、`warning`、`guardianWarning`、`deprecationNotice`、`configWarning`、`model/rerouted`、`model/verification`、`model/safetyBuffering/updated`、`modelProvider/authRecoveryStarted`、`modelProvider/authRecoveryCompleted`、`windows/worldWritableWarning`、`windowsSandbox/setupCompleted` | 回合错误与重试、会话通知行、toast；安全缓冲时工作行的「改用更快的模型重试」 |
| 终端 | `process/outputDelta`、`process/exited` | 终端面板 |
| 账户 | `account/updated`、`account/rateLimits/updated`、`account/login/completed` | 账户与额度（按 `limitId` 合并；workspace 额度变化时重读）；登录结果（按 `loginId` 匹配） |
| 其他 | `mcpServer/oauthLogin/completed`、`mcpServer/startupStatus/updated`、`skills/changed`、`remoteControl/status/changed`、`externalAgentConfig/import/progress`、`externalAgentConfig/import/completed`、`fs/changed` | MCP 登录与状态、技能列表、Remote Control、导入进度、文件面板 |
| 语音 | `thread/realtime/started`、`thread/realtime/sdp`、`thread/realtime/error`、`thread/realtime/closed` | 语音模式（WebRTC 协商与状态） |

### 未用的客户端方法（59 个）及理由

**A. 不适用（20 个）**：服务端内部、宿主集成、测试或遗留接口。

| 方法 | 理由 |
| --- | --- |
| `userVerification/status`、`…/enroll`、`…/delete`、`…/verify`、`…/cancel` | 服务端只对名为 Codex Desktop（stdio）或 codex-tui 且有生物识别硬件的连接启用，登记由宿主负责 |
| `thread/increment_elicitation`、`thread/decrement_elicitation` | 供外部帮手在等待时暂停超时计时 |
| `thread/prediction/request` | 服务端直接返回 -32601（未实现） |
| `thread/inject_items` | 向历史注入原始 Responses API 条目，供宿主集成 |
| `thread/loaded/list` | 多客户端协调与调试；`thread/status/changed` 已够用 |
| `thread/attachmentOwner/list` | 按资源反查会话，界面没有对应场景 |
| `rollout/compress` | 后台维护任务；真机 Code 设置没有存储压缩项 |
| `mock/experimentalMethod` | 测试专用 |
| `getConversationSummary`、`getAuthStatus` | v1 遗留，`account/read` 等已覆盖 |
| `mcpServer/event/stream/start`、`…/stop` | MCP 事件流调试接口 |
| `fs/writeFile`、`fs/remove`、`fs/copy` | 真机 Code 标签页的文件预览只读 |

**B. 已由其他方法覆盖（15 个）**

| 方法 | 覆盖方式 |
| --- | --- |
| `thread/queue/update` | 「在输入框中编辑」用删除加回填实现，回填不了的部分提示「消息已撤回。其附件无法放回输入框。」 |
| `project/read` | `project/list` 加 `project/changed` |
| `thread/items/list`、`thread/items/read` | `thread/turns/list`（`itemsView: "full"`） |
| `command/exec`、`…/write`、`…/terminate`、`…/resize` | 终端用 `process/*`，`!` 命令用 `thread/shellCommand` |
| `config/value/write` | `config/batchWrite` |
| `fuzzyFileSearch/sessionStart`、`…/sessionUpdate`、`…/sessionStop` | 单次 `fuzzyFileSearch` 加取消令牌 |
| `thread/realtime/appendAudio`、`…/appendText`、`…/appendSpeech` | WebSocket 传输的替代通道；codex-ui 走 WebRTC，音频直接进浏览器 |

**C. 真机没有对应界面（24 个）**：按「如有」的要求不做。

| 方法 | 理由 |
| --- | --- |
| `thread/attachment/add`、`thread/attachment/remove` | 真机的「track / stop tracking pull request」只是 Claude 调工具时权限卡里的文案，没有用户按钮；可能的位置（详情栏 PR 卡）只在开关开启时存在 |
| `project/import`、`project/move` | Codex 专有；真机 Code 标签页的 Projects 已结束 |
| `plugin/skill/read` | 安装前预览远端插件的技能正文，真机没有对应入口 |
| `fs/createDirectory`、`fs/getMetadata` | 真机用系统原生文件夹对话框 |
| `thread/timeline/list`、`thread/realtime/listVoices` | 语音转写历史与音色选择；真机 Code 标签页没有语音对话 |
| `account/gatewayOAuth/read`、`…/login`、`…/cancel` | 网关提供方专用；codex-ui 不声明 `explicitGatewayOauth`，服务端会自己打开浏览器登录 |
| `modelProvider/capabilities/read` | 真机没有按提供方隐藏能力的界面 |
| `environment/add`、`environment/info`、`environment/status` | 远端执行环境；真机的 SSH / 云端环境机制不同，属 Claude 专有部分 |
| `account/bedrock/discover`、`…/setup`、`…/checkGovCloudRequirements` | 真机的 Bedrock 配置在第三方推理设置里，不在 Code 标签页 |
| `account/workspaceMessages/read` | 工作区公告（TUI 每 5 分钟拉取）；真机没有对应 |
| `externalAgentConfig/import/recordHistory`、`…/readHistories` | 导入历史；真机没有对应 |
| `mcpServer/resource/read`、`mcpServer/tool/call` | 渲染 MCP Apps 小组件才需要；是否出现在 Code 标签页没能确认（见一.4） |

**D. 真机有对应、这次没有做（0 个）**：上一版列在这里的插件分享（`plugin/share/*`）与 `plugin/reconcile` 已补上，见「已用」表；与真机的差别见一.3。

### 未处理的通知（20 个）及理由

| 通知 | 理由 |
| --- | --- |
| `item/fileChange/outputDelta`、`thread/compacted` | 已废弃（改由 `item/fileChange/patchUpdated` 与 `contextCompaction` 条目）；已退订 |
| `item/commandExecution/terminalInteraction` | 真机命令卡没有 stdin 行；已退订 |
| `rawResponseItem/completed`、`rawResponse/completed`、`turn/moderationMetadata` | 内部数据；已退订 |
| `app/list/updated` | 单条可达数 MB；「浏览连接器」打开时重新拉取；已退订 |
| `thread/prediction/updated` | 对应的请求服务端未实现 |
| `command/exec/outputDelta` | 没有使用 `command/exec` |
| `mcpServer/event/stream/notification` | 没有开启 MCP 事件流 |
| `account/gatewayOAuth/changed` | 同 `account/gatewayOAuth/*` |
| `fuzzyFileSearch/sessionUpdated`、`fuzzyFileSearch/sessionCompleted` | 没有使用会话式搜索 |
| `thread/realtime/itemAdded`、`…/item/started`、`…/item/transcript/delta`、`…/item/completed`、`…/transcript/delta`、`…/transcript/done` | 语音模式不显示转写（Codex 专有功能，真机 Code 标签页没有语音对话） |
| `thread/realtime/outputAudio/delta` | WebRTC 下音频直接进浏览器 |

### 设置页每一项的后端落点

| 设置页 | 设置项 | 写入的键 / 调用的方法 |
| --- | --- | --- |
| 通用 | 主题、对话文字大小、对话宽度、动效 | 浏览器 `localStorage`（真机同样存在本地） |
| 用量 | 用量统计、重置额度、额度与点数 | `account/usage/read`、`account/rateLimitResetCredit/consume`、`account/rateLimits/read`、`account/read` |
| 记忆 | 启用、在新会话中使用、从会话中生成、新版记忆、清空、记忆文件 | `features.memories`、`memories.use_memories`、`memories.generate_memories`、`memories.version`；`memory/status`、`memory/reset`；`fs/readDirectory` + `fs/readFile` |
| Codex | 界面字体、代码字体、默认对话视图 | `localStorage` |
| Codex | Remote Control | `remoteControl/*`（`enable` / `disable`、`pairing/*`、`client/list` / `revoke`） |
| Codex | 允许绕过权限模式、通知时引起注意、运行时防休眠、归档不活跃的会话 | `localStorage` 与桌面壳设置；归档调用 `thread/archive` |
| Codex | 本地沙箱（Windows） | `windowsSandbox/readiness`、`windowsSandbox/setupStart`；`windows.sandbox` |
| Codex | 新会话默认值：模型、推理强度、权限 | `config/batchWrite`：`model`、`model_reasoning_effort`、`approval_policy` + `sandbox_mode` |
| 导入 | 检测、导入 | `externalAgentConfig/detect`、`externalAgentConfig/import` |
| 实验功能 | 各功能开关 | `experimentalFeature/list`、`experimentalFeature/enablement/set`（运行时生效） |
| 系统（桌面版） | 版本、开机时运行、快速输入快捷键、系统托盘 | 桌面壳（`codexDesktop.setDesktopSettings`） |
| 技能 | 列表与启用、额外技能目录 | `skills/list`、`skills/config/write`、`skills/extraRoots/set` |
| 连接器 | 浏览连接器、应用、MCP 服务器 | `app/list`、`app/installed` / `app/read`、`apps.<id>.enabled`、`mcpServerStatus/list`、`config/mcpServer/reload`、`mcpServer/oauth/login` |
| 插件 | 已安装、已分享、目录、插件市场；详情的分享与检查更新 | `plugin/*`（含 `plugin/share/*`、`plugin/reconcile`）、`marketplace/*`、`plugins.<id>.enabled` |
| Hooks | 信任与启用 | `hooks/list`、`hooks.state.<key>.enabled` / `trusted_hash` |
| 关于 | 版本与诊断 | `initialize` 返回的服务端信息、`server/diagnostics` |

## 三、校验

- `pnpm typecheck` 0 错误；`pnpm test` 81/81 通过；`pnpm build` 通过。
- 插件分享与检查更新（2026-10-19 补上）也在 mock 预览里实测过：分享（`save` 收到插件文件夹与所选范围）、复制链接、改范围（`updateTargets` 原样带回原有成员，不含所有者和工作区主体）、「设为私密」确认、停止分享、取回到本地、上传新版本（`save` 只收到插件文件夹与 `remotePluginId`，从插件详情和「已分享」列表各传一次，mock 版本 1.0.0 → 1.0.1 → 1.0.2；不在这台电脑上的分享不显示这个按钮）、检查更新的「已从 1.2.0 更新到 1.3.0。」与「插件已是最新版本。」，以及深色模式下的分享面板。
- 字体（2026-10-19 补上）在全新的 Electron 进程里用 CDP `CSS.getPlatformFontsForNode` 按角色核对过实际渲染的字体。Anthropic Sans 下，界面、回复与用户消息是 Anthropic Sans Variable Text（中文落到 Microsoft YaHei UI），行内代码与代码块是 Anthropic Mono Web，字标是 Anthropic Serif Variable Text，粗体是真粗体。「系统」下全部落到 Microsoft YaHei UI，引号不悬挂；OpenDyslexic 下回复是 OpenDyslexic，悬挂 0.573em。设置里切换即时生效并记住；「字体许可」读到全文，标题固定、正文在框内滚动；Quick Entry 按 `main.mjs` 的方式（file:// 页 + 环回地址上的字体）加载成功；终端的字符格按 Anthropic Mono 测量（7.2px），在代码字体里填入网页字体 OpenDyslexic Mono 后重新测量为 8.78px。本轮 `pnpm typecheck` 0 错误，`pnpm test` 85/85。
- 用 mock app-server 在浏览器预览里实测过：首页问候语与行动中心、侧栏菜单与行内重命名、转录工具行、更改面板的两种范围、后台任务面板、视图选项、审批卡（允许一次）、提问卡（答案回传）、模式菜单、计划审批卡、上下文弹层、设置、命令面板、toast、深色模式、手机宽度、新建会话流程；本轮另测了卡片式面板的浅色与深色外观（圆角 10px、块间距 12px、外圈 8px，深色底色 `#1a1a19` 与真机 `surface-2` 一致）。
- 没有验证的：连接真实 codex app-server 的端到端流程（预览只用了 mock）；依赖 ChatGPT 账户的功能（额度用尽时的「请求更多」、浏览连接器、Remote Control 配对、插件分享与检查更新）；语音模式；打包后的 Windows 桌面壳（托盘、跳转列表、通知），本轮没有重新打包。
