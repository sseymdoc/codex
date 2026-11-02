# codex-ui 复刻审核（Claude Desktop 3.1623 · Code 标签页）

初审 2026-10-19（2.42304.0.0），复核 2026-10-22（3.1623.4.0，见下文「〇、3.1623 复核」），2026-10-23 起按类别逐项深查（见「四、分类深查」），2026-11-02 对照 macOS 上的 4.4212.0 补齐缺口（见「五、4.4212 复核」）。范围只含 Code 标签页：不含 Chat 模式，也没有左上角的 Claude / Code 切换控件。

## 依据与方法

- **对照物**：初审用安装包 `Claude_2.42304.0.0_x64`，复核用本机安装的 `Claude_3.1623.4.0_x64`（`C:\Program Files\WindowsApps` 下，文件可直接读）。渲染层是 `app/resources/ion-dist`（chunk 与 `c6a992d55` 样式表），主进程是 `app.asar`（2.42304 为 `.vite/build/index.chunk-lzaSYO3Q.js`，3.1623.4 为 `index.chunk-CDtK409T.js`）。全程只读静态分析：没有读取、连接或干预任何正在运行的 Claude 进程。
- **函数名的版本**：3.1623 起渲染层由 React Compiler 编译，函数名与 2.42304 全部不同。下文凡未注明版本的「chunk 前缀 + 函数名」都指 2.42304；复核新增的出处写 3.1623 的名字。chunk 前缀两版之间基本稳定。
- **线上包**：用户的 Claude 实际加载 `assets-proxy.anthropic.com` 的线上网页包（HTTP 缓存里可读），构建与安装包不同。2026-10-22 对比：线上包比 3.1623 安装包只多约 410 条文案，与 Code 标签页有关的不到 20 条，所以以安装包为准。
- **参考**：open-claude-ui 设计稿（W0–W22）只作导引；与安装包冲突时以安装包为准。
- **做法**：先把 chunk 美化，再从 `defaultMessage` / `id` 建英文源串索引。按 12 个区域逐条对照：外壳、侧栏、首页、转录骨架、转录条目、输入框、审批与提问、面板、命令面板与对话框、设置、令牌与原子组件、后端。改动落到代码时，在注释里写明出处，格式是「chunk 前缀 + 函数名」（例如 `c4db265df Bt`）。文中的行号指美化后的文件。
- **文案**：一律用 Claude 官方 zh-Hans 译文，按所复刻组件实际用的 i18n id 取（`claude.ai/i18n/zh-Hans.json`，在 HTTP 缓存里，与 ion-dist `en-US.json` 按 id 对照；Claude 自己译得不一致的也照抄，唯 Plan → 计划不照「套餐」）。主进程文案取安装包 `resources/zh-Hans.json`。官方没有译文的串按同一语气自译（用「您」、引号用 “ ”、Remote Control 不译）。

## 〇、3.1623 复核（2026-10-22）

本机 Claude 在 2026-10-20 更新到 3.1623.0.0，2026-10-22 又更新到 3.1623.4.0；两者界面文案与主样式表完全相同，只是重新构建。

### 版本间变化概况

- **文案**：`en-US.json` 新增 1126 条、删除 414 条，大部分属于 Chat、Cowork 与计费。
- **令牌**：`c6a992d55` 里所有令牌作用域的值零改动，只有增删（新增 `--cds-fill-primary-layer`、`--cds-banner-neutral-*`、`--cds-toolbar-strip` 等，默认值下没有可见差异）。体积从 1.79 MB 降到 1.48 MB，是删掉了约 2500 个工具类和天气、console 主题、bubble-stack 等整块规则，不是拆分。
- **字体**：族名、20 个字体文件（SHA-1 相同）与 Anthropicons 的 371 个码位都不变，`server/claude-fonts.mjs` 在 3.1623 上照常工作。
- **开关读取**：未下发即关的读取在 3.1623 是 shared-0 `Ro`（`gb.isOn`）；杀开关写法 `!inPayload || on` 照旧。

### 本轮跟进

除注明的一项外，都不受服务端开关控制。

| 区域 | 3.1623 行为（出处） | codex-ui |
| --- | --- | --- |
| 侧栏 | 分组头菜单：「全部折叠 / 全部展开」「全部归档」始终显示，不可用时置灰并写明原因；「全选」的原因换新文案（shared-46 `JO` / `QO` / `rk`；`__gb__873492543` 是杀开关，未下发时为开） | `Sidebar.tsx` 分组头菜单、`ReasonTip` |
| 侧栏 | 「全部归档」确认：说明运行中的会话会被停止、尚未加载的不会归档（shared-46 `VD` / `BD`） | 同上 |
| 侧栏 | 多选菜单新增「将 N 个会话标记为已读」（U）；已读 / 未读两项只算空闲、非子代理的会话（ce4f4374c `tt`） | `Sidebar.tsx` 多选菜单 |
| 侧栏 | 单会话菜单：运行中或等待输入时已读 / 未读项照常显示但置灰，并说明原因（ce4f4374c `qe`、shared-20 `LS`） | `SessionMenu` |
| 侧栏 | 折叠的家族行计数「N 个未读」（shared-20 `HT.hiddenUnread`） | `Sidebar.tsx` |
| 侧栏 | 批量操作的提示：多选归档、取消归档、删除和分组「全部归档」成功后弹「已归档 / 已取消归档 / 已删除 N 个会话」（调用方给 3 秒，CDS 把不足 6 秒的时长抬到 6 秒，见「四 · 外壳」）（全部归档时有未加载的会话：「已归档 N 个会话。未加载的会话未归档。」），失败的另弹「N 个会话归档失败。请重试。」等；单个会话的归档、取消置顶、移动不提示（c39a247c4 `xt`、shared-46）。撤销 toast（6 秒，「撤销」与 Ctrl+Z，c48ea26ad `L`、shared-11 `Vf`）**受 `__gb__3095207653` 控制（`gb.isOn`，未下发为关），用户本机未下发**，按基线不做；toast 的操作按钮、Ctrl 快捷键，以及悬停、聚焦或窗口失焦时暂停保留 | `Sidebar.tsx` `archiveOrRestore` / `BulkDeleteDialog`、`store.ts` `toast` 超时 / `actionToast` / `holdToasts`、`App.tsx` Toasts |
| 输入框 | 套餐用量弹层：标题「套餐使用限额 · {套餐}」，右上量表按钮去设置，每行右侧是重置时间与百分比，sm 进度条，宽 360（c227f4d5e `O2` / `k2` / `j2`、shared-156 `GV`、c1564829c `T`） | `Composer.tsx` `PlanUsage` |
| 输入框 | 选择器行上下文圆环的轨道 alpha-4 → alpha-3（c227f4d5e `o4`） | `composer.css` |
| 会话栏 | 上下文卡片：新增「自上次更新以来」一段（实时数减去上次读取的已用量，先扣空闲再扣压缩缓冲）、空态「发送一条消息以查看明细。」；MCP、Skills、记忆文件行可点击（c2d611398 `ne`、c73f45bc3 `_S`） | `Rail.tsx` `ContextCard`、`context.ts` |
| 转录 | 章节列表宽度在 232–320 之间随内容变化，截断的标题悬停显示全文，重命名输入框自适应宽度（cf74bc599 `aC` / `sC`） | `Transcript.tsx`、`transcript.css` |
| 浏览器面板 | 视口子菜单删掉配色（cf580efe9） | `Browser.tsx` |
| 浏览器面板 | 「自动打开 Codex 写入的文件」：⋮ 菜单、浏览器设置与 设置 › Codex › 浏览器 三处开关，默认开；Codex 写入会话目录内的 HTML、SVG、图片或视频后，在浏览器面板打开（已开着就切过去并重新加载）；HTML 在该目录有开发服务器时不开（主进程 `pE` / `GT`、cf580efe9 `ki`、c71860c77 `vr`） | `browser.ts` `openWritten`、`desktop/browser.mjs` |
| 浏览器面板 | 选择元素按钮的提示附说明（cf580efe9 `sl` / `ul`） | `Browser.tsx` |
| 命令面板 | 有窗格时出现「展开窗格 / 折叠窗格」（Ctrl+Shift+\，c11959232） | `Palette.tsx` |
| 设置 | 快捷键录制时单按一个键有专门提示（c71860c77 `Ga`） | `Settings.tsx` |
| 桌面壳 | 退出确认：有回合或后台命令在跑时，菜单 / 托盘退出、无托盘时关窗和页面发起的重启先问；「等待 Codex」等回合结束再退；收到信号、Windows 注销关机或窗口已关时直接退出（`index.chunk-CDtK409T.js` `o2t` / `Q0t` / `K0t`） | `desktop/main.mjs`、`App.tsx` 上报 |

### 本轮跟进里与 3.1623 不同的地方

- 浏览器：自动打开不含 PDF（面板标签的请求过滤是否放行 Chromium 的 PDF 查看器没有验证，代码里有 `ponytail:`）；Claude 还会告诉模型「文件已在面板显示」，这要后端配合，按 AGENTS.md 没做；子代理写的文件不触发。选择元素按钮的标题保留「选择元素」：Claude 的「选择元素或添加标注」在选择模式里能直接标注，codex-ui 的不能。
- 用量弹层：套餐名取 ChatGPT 的 planType 或路由提供方名称；没有加载骨架和「无法加载」态。
- 上下文卡片：记忆文件列表里的两行（AGENTS.md / Codex 记忆）是汇总项，不可点；没有「自定义智能体」类别。
- 侧栏：没有「标为已完成」（Codex 没有这个状态）；全部归档确认的「{分区}：{标题}」不出现（codex-ui 只有分组一层）；toast 暂停结束后重新计时，带操作按钮的 toast 被别的 toast 挡住时不暂停（`ponytail:`）；批量失败提示不带出错原因（Claude 也只报个数）。
- 退出确认：选「仍要退出」时一并取消先前的等待（Claude 不清）；没有远程控制会话那一种确认，也不做 60 秒复查（计数只靠渲染进程上报）。

### 本轮没有跟

- **受开关控制，基线不跟**：侧栏撤销 toast（`__gb__3095207653`，见上表）；panels（fizzy-lake）改由 `__gb__3335190042` 写入 localStorage，仍为关；fizzy-lake 的 type 变体（回复类型 prose、ShimmerText copy-inks）；MCP 表单停靠卡（只对云端会话，`__gb__1345712912`）；sessionList 布局的分组依据（presets）。
- **Claude 专有**：Side chats（/btw）、SSH 登录提示。
- **条件没有核实**：会话栏环境卡的文件夹行在「能更换文件夹」时点整行打开「选择工作文件夹…」、菜单移到行尾 ⋮（cf74bc599 `NM`，条件来自 `du()`）；转录布局工具类（`data-transcript-column-row` 等）删掉后的节奏变化。
- **可见度低，留待以后**：设置搜索收录插件里的技能、分区内「more」就地展开（cc011544b）；Reset App Data 改版；`jump_to_last_message`（随 `jump_to_*` 家族）；终端「正在打开新标签页…」。
- **只在线上包**：中断后的「您已停止 Claude 的回复」、停止失败时的「未停止任何内容…」、浏览器「停止服务器并关闭」。

## 一、复刻诚实度

### 1. 基线：服务端开关一律取关闭值

真机很多界面由 GrowthBook 开关决定。读取函数（shared-25 `Zs` → `evalFeature`）对服务端没有下发的特性返回 `on:false`。codex-ui 没有 Anthropic 账号，拿不到任何下发，所以复刻的是**所有未知开关都关闭**时的 Code 标签页。这是一个自洽的真实形态，不是拼出来的。

| 开关 | 真机读取位置 | 关闭时的真机行为 | codex-ui |
| --- | --- | --- | --- |
| `claudeai_cc_epitaxy_session_presets_main` | shared-11 `Qo` / `$o`、`rc()`（经 `nc` 锁存）；cc43287c9 `P_` / `Y_` | 首页是问候语而不是启动卡片（shared-20 `oh`）；没有「会话详情」侧栏（cc43287c9 `an2` / `on2`、`railToggle`）；提问卡停靠在输入框上方（c12c146ad presentation 默认 `"dock"`）；侧栏走 classic 列表（shared-20 `SS()` → `cd()`） | 一致；唯「会话详情」侧栏按用户要求单独取开关开启时的形态（`Rail.tsx`） |
| `__gb__1669033294` | c2771e1f6 `B2 = Wr()` | 旧版命令面板：页脚提示、Tab 进入命令模式、没有行操作卡 | 后续按用户截图明确改为新版搜索形态，不显示分类栏；见 [搜索](search.md) |
| `ccd_palette_session_actions` | cf74bc599 `H2 = B(...)` | 命令面板里没有重命名、派生、移到分组、固定等会话命令，也没有 Ctrl+Alt+R / O | 一致 |
| `panels`（`data-cds-fizzy-lake`） | shared-4 `jf` → `kf`：允许列表 `Cf` 为空，所以 2.42304 里恒为关 | 平铺取 shared-18 `Tb`（块间距 12、外圈 8、最小宽 280）；侧边面板是 panel 级卡片（shared-frame `ah("panel")`：`rounded-card bg-surface-2 shadow-panel-sm`，深色 `shadow-sm` 加 1px `alpha-2` 描边） | **本轮改正**：此前是扁平 1px 分隔，属于不可达的 `panels` 形态 |
| 「杀开关」型门控（`!flag(...)`） | c8190f70d、c8e302838、cc28ac22a | 默认显示 | 保留显示 |

### 2. 各区域落点

| 区域 | 主要依据 | codex-ui | 要点 |
| --- | --- | --- | --- |
| 桌面壳 | app.asar `index.chunk-lzaSYO3Q.js` | `desktop/main.mjs`、`preload.cjs`、`quick.html` | 窗口 1200×800（最小 600×400，登录前 600×600），标题栏让位 `ceil(140 / zoom)`，缩放 25%–500%；应用菜单不显示为菜单栏（菜单按钮、单按 Alt 或 F10 打开）；托盘、Quick Entry（606×470）、跳转列表、通知、运行时防休眠、开机启动 |
| 页面外壳 | shared-19 / shared-20 | `App.tsx`、`shell.css` | Windows 36px 标题栏（菜单、侧边栏开关、返回 / 前进，提示在下方）；启动骨架；加载失败自动重试（0 / 15 / 30 s，±20%，180 s 内）；查找条；toast 在右下 |
| 侧栏 | shared-18–22、ce4f4374c；classic 路径 shared-21 `iU`、`Dq` / `bq` | `Sidebar.tsx`、`session.ts` | Filter ▸ 状态（活跃 / 已归档 / 全部）、分组（桌面默认按文件夹，shared-52 `_h()`）、排序；置顶；派生与子代理按家族嵌套；状态字形；右键与 ⋮ 共用一份菜单（单字母快捷键）；行内重命名；Shift / Ctrl 多选与批量操作；分组拖放；peek、窄窗口与手机 sheet |
| 首页 | shared-20 `oh`；cc43287c9 `n5` | `Main.tsx` Welcome、`landing.ts` | 问候语（欢迎回来 / 接下来做什么）；行动中心（需要输入、未读，可关闭、全部标为已读；Codex 项目）；环境胶囊、文件夹胶囊与最近文件夹 |
| 转录骨架 | c96d752d0、cf74bc599 | `Transcript.tsx`、`session.ts` | 工作行状态机；正常 / 思考 / 详细三种视图（Ctrl+O，按会话记住）；章节；会话内查找；回退确认（无法撤销、文件保持不变）；接近顶部时加载更早的历史 |
| 转录条目 | c96d752d0 `JIe`（默认版；Step 版由服务端 renderer 开关控制）；类名来自 c425fb3cf / cb6930dae | `items.tsx`、`transcript.ts` | 每个工具调用一行（动词 · 细节 · 结果 · 箭头），运行中的动词微光至少 650ms；命令摘要规则；MCP、子代理、diff、通知与 Hook 干预行 |
| 输入框 | c227f4d5e `bQ`（layout `"row"`，presets 开关打开时的 pickerRow）、cc43287c9 `kP`（singleRowCard）、shared-5 `Kd`、shared-6 `d_` / `wg` | `Composer.tsx` | 两页共用一张单行输入卡（高 44、r14；「+」在文字前，发送只在有内容时出现，语音在发送后）；卡下一行：左模式，右模型、努力程度（保持独立，不并进模型胶囊）、上下文环；模式菜单（手动 / 接受编辑 / 计划 / 自动，「绕过权限」需在设置里允许）；模型、努力程度、快速模式；上下文环与弹层（50% 起显示「压缩会话」、额度、「请求更多」）；+ 菜单；斜杠命令先插入、回车再执行；↑ 先取回排队消息 |
| 审批与提问 | c96d752d0 `Rj`（c12c146ad 外壳）、ccae33cda `Lt`、c8cf7b513、c96d752d0 `aDe`、c385ec32f；按键 ccbc7e432 / c6ffe955f；shared-10 `qx` | `Approvals.tsx`、`approvals.ts` | 停靠审批卡（后面最多两张幽灵卡；拒绝 \| 本次会话内允许 / 始终允许 \| 允许一次）；卡片出现后 400ms 内忽略点击；停靠提问卡（分页、其他、跳过）；计划模式的计划审批卡；MCP 表单与链接请求 |
| 面板 | c03935b01 `Ti`、cf53e1812、c4db265df `Bt`、c9543da06 `ed`、shared-19 `W7`、shared-18 `Tb` | `Panes.tsx`、`panes.ts` | 平铺：聊天 : 大面板 = 2 : 3，聊天 : 终端等 = 2 : 1，第二个面板竖向叠放；2rem 头部（⋮ 设置、展开 / 收起、关闭）；Ctrl+\ / Ctrl+Shift+\、F7 / Shift+F7；**本轮**改为 panel 卡片、12px 分隔条（悬停显示 3×56 指示条）、最小宽 280 |
| 命令面板与对话框 | c2771e1f6 `Dm`、ce8be540f / c01b6d4ec、shared-1 `jL`、c518a31cc `Te`；shared-frame `M_` | `Palette.tsx`、`palette.ts`、`Dialogs.tsx` | 后续改为[新版搜索](search.md)；快捷键面板；设置深链按真机 `gs()`（设置行用齿轮，自定义行用扳手）；对话框退出动画；删除确认默认聚焦「删除」 |
| 设置 | shared-19 `pA` / `Uk` / `qk` / `Nw` / `Pw`、cc011544b、shared-1 `gx` / `xx` / `hx`、c71860c77；插件详情 c24c8737b `wo` / `vo`、ce5c807c8、c0ad2fd1b、c5e7d44b0、c334c9fcc | `Settings.tsx`、`SettingsCustomize.tsx`、`settings.ts`、`plugins.ts` | 设置 / 这台电脑（仅桌面版）/ 自定义三组；Codex 页对应真机「Claude Code」页；搜索按真机的规范化与打分；关于从桌面版帮助菜单打开；插件详情头部是「分享 · ⋮（检查更新 / 卸载）· 开关」 |
| 令牌与原子组件 | c6a992d55 `.cds-root` / `[data-density=comfortable]`、shared-frame | `tokens.css`、`base.css`、`ui.tsx` | 两档密度；按钮梯度；菜单与子菜单；全页唯一的提示层（支持第二行说明）；分段控件、开关、复选框、键帽 |
| 字体 | c6a992d55 字体令牌与 `@font-face`；cd19fedd2 `interfaceFont`、shared-52 `cm()`、c96d752d0 `uI()`、c4a9ee384（悬挂度量）、cea462098（字体许可）、shared-frame `Ra()` | `server/claude-fonts.mjs`、`tokens.css`、`theme-init.js`、`Settings.tsx`、`quick.html` | 界面、回复与用户消息用 Anthropic Sans（Code 标签页的回复跟随界面字体，`uI()` 返回 `"sans"`），代码与终端用 Anthropic Mono，字标用 Anthropic Serif；中日韩回退链与真机相同；不合成粗体 / 斜体。界面字体（Anthropic Sans / 系统 / OpenDyslexic）在 Codex → 外观（真机放进「通用」要开 `__gb__1197194941`），说明后附「字体许可」；引号悬挂按所选字体的度量；代码字体写 `--cds-font-mono-override`；Quick Entry 同样用 anthropic-sans |

### 3. 与真机不同的地方

**Codex 专有、保留**（真机没有，或真机的位置在开关开启时才存在）：

- 目标（goal）：在「会话详情」侧栏的目标卡里（同真机开关开启时），「计划」面板顶部也保留一份，供侧栏隐藏时使用。
- 项目：Codex 的桌面项目当作本地环境，按真机环境选择器的方式管理。行尾的设置键打开「编辑环境」，左下角是「删除环境」；「新建环境」在本电脑上会预填当前文件夹。真机 Code 标签页的 Projects 早期体验已结束（c9543da06 “Projects early access has ended…”），侧栏也没有项目管理。
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

- 多块布局里，真机的聊天块也在 8px 外圈之内，并配合 `data-chat-gutter-*` 调整左右留白。codex-ui 的聊天列只在顶部内收（9px，标题栏抬起时 5px），左右与底部的外圈和 `data-chat-gutter-*` 没做。
- 子菜单用 160ms 的指针方向宽限代替 Base UI 的 safe polygon。
- 防休眠在回合结束后立即释放（真机会再等一会）。
- 托盘图标是在代码里画的 `</>`（Claude 自带图标文件）；缩放、主题和桌面设置存在 `window-state.json`；Quick Entry 关闭后不把焦点还给之前的应用（需要原生模块）。
- Anthropic 的字体文件（含图标字体 Anthropicons）不随 codex-ui 分发（字形归 Anthropic 所有）：服务端在运行时从本机安装的 Claude Desktop（Windows 的 MSIX 包 `WindowsApps\Claude_*`，取最新版本）读出主窗口样式表里的 `@font-face` 与字体文件，经 `/claude-fonts.css`、`/claude-fonts/*` 提供，「字体许可」读同一安装里的 `third-party-notices.txt`。没装 Claude Desktop 时 `/claude-fonts.css` 改给 `public/fonts` 里开源授权的替身，字体族名不变：图标是 Phosphor Icons（MIT）放到 Anthropicons 码位上生成的可变字体（`src/fonts/build-icons.py`，wght 400–700 的笔画粗细对齐 Anthropicons，Claude 独有的十来个图形换成最接近的 Phosphor 图形），Anthropic Sans / Mono 换成 Geist / Geist Mono（OFL，按 Anthropic 的行高度量），衬线体落到真机同款按度量校准的 Georgia，OpenDyslexic 一并内置；「字体许可」改读 codex-ui 自己的 `public/third-party-notices.txt`。
- 界面字体选「系统」时引号不悬挂：真机只在 macOS 上按系统字体的度量悬挂。

**真机有、这次没有做**：

- 面板：移动到左 / 右 / 上 / 下与 Fill / Tile 菜单（受开关控制）；关闭后记住原位置；面板的打开状态在重启后不恢复（比例会保存）；更改面板的未提交更改、对比分支、Commits、审查发现步进条、按文件夹分组和词级高亮；文件面板的文件树与编辑；终端的选择 shell、溢出菜单和拖动排序；计划面板自动打开（受开关控制）。
- 转录：词级高亮、代码块的「Open in terminal」、ANSI 着色（目前只剥离转义码）、「正在启动会话…」占位（`thread/start` 返回前 codex-ui 挂出的是待发送行「正在建立会话…」）。
- 输入框：Ctrl+R 历史搜索、在分叉会话中发送、发送并留在此页、`/copy` `/theme` `/export` `/cd` `/resume`；非图片附件（桌面桥没有 `getPathForFile`，菜单保持「添加图片」）；自动模式的「推荐」徽标（Codex 没有这个推荐来源）。
- 首页：Pull requests 区（Codex 没有 PR / CI 状态）。
- 命令面板：`jump_to_*` 命令（含 3.1623 新增的 `jump_to_last_message`）；项目结果（已归档搜索后续已补齐，见[搜索](search.md)）；设置项级深链。
- 设置：通知级别、Output style、Strict sandbox、Dynamic workflows；设置搜索不索引技能 / 插件 / 连接器的名称（3.1623 还收录插件里的技能）；「浏览连接器」的搜索只过滤已经分页加载的结果。
- 侧栏：行菜单里的导出与对话视图子菜单（标题栏会话菜单里有）、Ctrl+数字跳转提示、分组排序、标题生成动画、空状态插画、「标为已完成」；置顶行下不挂家族成员。
- 桌面壳：托盘里的用量行（服务端开关默认值未知）；3.1623 改版的 Reset App Data。
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
| 客户端方法 | 175（稳定 108 + 实验 67） | 120（含桥接层的 1 个） | 55 |
| 服务端请求 | 9 | 6 个处理；3 个按设计回错误 | — |
| 服务端通知 | 87（稳定 63 + 实验 24） | 66 | 21（其中 8 个在 initialize 里退订） |

口径：清单取自 `codex-rs/app-server-protocol`（`client_request_definitions!`、`server_request_definitions!`、`server_notification_definitions!`）。「使用」指 `src/`、`server/`、`desktop/` 里有以该方法名为字面参数的调用点，或通知 / 请求的 `case` 分支，并逐个确认有界面入口，见下表。2026-10-23 按分叉 HEAD 重新清点：方法与通知的名单和上一版相同，服务端请求删掉了 v1 遗留的两个；差别在使用面，见「四 · 后端」。

### 已用的客户端方法与界面入口

| 领域 | 方法 | 界面入口 |
| --- | --- | --- |
| 连接 | `initialize` | 启动连接；声明 `experimentalApi`、`openai/form` 扩展、退订的通知；`requestAttestation: false` |
| 连接 | `server/diagnostics` | 关于页的 app-server 内存与进程号 |
| 会话 | `thread/start`、`thread/resume`、`thread/unsubscribe` | 新建会话页发送；打开会话；切走后释放上一会话 |
| 会话 | `thread/list`、`thread/read`、`thread/turns/list` | 侧栏、首页行动中心、「查看全部」；打开会话时刷新已读回执；向上滚动加载更早的历史 |
| 会话 | `thread/name/set`、`thread/fork`、`thread/revert` | 行内重命名与重命名对话框；会话菜单「派生」与消息「从这里派生」；消息「回退到这里」（确认后执行） |
| 会话 | `thread/archive`、`thread/unarchive`、`thread/delete` | 会话菜单、批量操作、Ctrl+Shift+Backspace、设置 › Codex「归档不活跃的会话」；删除确认对话框 |
| 会话 | `thread/metadata/update` | 会话菜单「移至项目」与「从项目中移除」（`projectId: ""` 表示清除） |
| 会话 | `thread/settings/update`、`turn/settings/update` | 已打开的会话里切换模型、努力程度、权限模式、快速模式、计划模式时立即生效；失败回滚并提示 |
| 会话 | `thread/readState/update` | 标为已读 / 未读、行动中心「全部标为已读」 |
| 会话 | `thread/compact/start` | `/compact`、上下文弹层「压缩会话」 |
| 会话 | `thread/shellCommand` | 输入框 `!` 模式 |
| 会话 | `thread/memoryMode/set` | + 菜单「记忆」开关 |
| 会话 | `thread/attachment/list` | 会话菜单「打开拉取请求」（按 G） |
| 会话 | `thread/attachment/add`、`thread/attachment/remove` | 会话栏「拉取请求」卡：回复里 `<pr-created>` 报告的 PR、按会话分支查到的打开中 PR 自动绑定；PR 行的「移除」 |
| 会话 | `command/exec` | 只读查询（沙箱 `readOnly`）：拉取请求卡的 `gh pr view`；起始卡「继续未提交的工作」与会话栏分支用的 git 快照 |
| 会话 | `thread/search`、`thread/searchOccurrences` | Ctrl+Shift+K 内容搜索；会话内查找（Ctrl+F） |
| 会话 | `thread/approveGuardianDeniedAction` | 自动审查拒绝行的「仍然允许」 |
| 会话 | `thread/backgroundTerminals/list`、`…/terminate`、`…/clean` | 后台任务面板：列表、停止、停止所有后台任务 |
| 会话 | `thread/goal/get`、`thread/goal/set`、`thread/goal/clear` | 计划面板顶部的目标；`/goal` |
| 会话 | `thread/queue/add`、`…/list`、`…/delete`、`…/reorder`、`…/start` | 排队消息条：排队（Ctrl+Enter）、移除、重排、立即发送；「在输入框中编辑」= 删除后回填 |
| 分组与项目 | `threadSection/list`、`…/create`、`…/update`、`…/delete`、`thread/section/move` | 侧栏自定义分组：新建、重命名与颜色、删除、拖放与「移到分组」 |
| 分组与项目 | `project/list`、`project/create`、`project/update`、`project/delete` | 行动中心的项目区、标题栏项目徽标、环境菜单、「编辑环境」对话框 |
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
| 桥接层 | `getAuthStatus`（`server/bridge.mjs`） | 听写转写（`/api/transcribe`）与账户资料（`/api/account/profile`）向 app-server 取 ChatGPT 令牌 |
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
| `item/tool/call`、`account/chatgptAuthTokens/refresh`、`attestation/generate` | 回错误：codex-ui 没有注册动态工具，不用外部令牌模式，initialize 声明了 `requestAttestation: false`（v1 遗留的 `applyPatchApproval`、`execCommandApproval` 已从协议删除） |

### 已处理的通知（66 个）

| 领域 | 通知 | 界面 |
| --- | --- | --- |
| 会话 | `thread/started`、`thread/status/changed`、`thread/readState/changed`、`thread/archived`、`thread/unarchived`、`thread/deleted`、`thread/closed`、`thread/reverted`、`thread/name/updated`、`thread/settings/updated`、`thread/tokenUsage/updated` | 侧栏与标题栏状态、未读点、归档与删除、回退结果、标题、模式与模型同步（含计划模式）、上下文环 |
| 会话 | `thread/attachment/updated`、`thread/goal/updated`、`thread/goal/cleared`、`thread/queue/changed`、`thread/project/updated`、`project/changed`、`thread/environment/connected`、`thread/environment/disconnected` | 拉取请求链接、计划面板目标、排队条、项目归属、会话通知行 |
| 回合与条目 | `turn/started`、`turn/completed`、`turn/diff/updated`、`turn/plan/updated`、`item/started`、`item/completed`、`item/agentMessage/delta`、`item/plan/delta`、`item/reasoning/summaryTextDelta`、`item/reasoning/summaryPartAdded`、`item/reasoning/textDelta`、`item/commandExecution/outputDelta`、`item/fileChange/patchUpdated`、`item/mcpToolCall/progress`、`serverRequest/resolved` | 转录、工作行、更改面板、计划面板、审批卡撤下 |
| 审查与 Hook | `item/autoApprovalReview/started`、`item/autoApprovalReview/completed`、`autoApprovalReview/strictReviewRequired`、`hook/started`、`hook/completed` | 自动审查行、Hook 运行行 |
| 提示 | `error`、`warning`（只为不属于已加载会话的警告弹 toast）、`deprecationNotice`、`configWarning`、`model/rerouted`、`model/verification`、`model/safetyBuffering/updated`、`modelProvider/authRecoveryStarted`、`modelProvider/authRecoveryCompleted`、`windows/worldWritableWarning`、`windowsSandbox/setupCompleted` | 回合错误与重试、会话通知行、toast；安全缓冲时工作行的「改用更快的模型重试」 |
| 终端 | `process/outputDelta`、`process/exited` | 终端面板 |
| 账户 | `account/updated`、`account/rateLimits/updated`、`account/login/completed` | 账户与额度（按 `limitId` 合并；workspace 额度变化时重读）；登录结果（按 `loginId` 匹配） |
| 其他 | `mcpServer/oauthLogin/completed`、`mcpServer/startupStatus/updated`、`skills/changed`、`remoteControl/status/changed`、`externalAgentConfig/import/progress`、`externalAgentConfig/import/completed`、`fs/changed` | MCP 登录与状态、技能列表、Remote Control、导入进度、文件面板 |
| 语音 | `thread/realtime/started`、`thread/realtime/sdp`、`thread/realtime/error`、`thread/realtime/closed` | 语音模式（WebRTC 协商与状态） |

### 未用的客户端方法（55 个）及理由

**A. 不适用（19 个）**：服务端内部、宿主集成、测试或遗留接口。

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
| `getConversationSummary` | v1 遗留，`thread/read` 等已覆盖 |
| `mcpServer/event/stream/start`、`…/stop` | MCP 事件流调试接口 |
| `fs/writeFile`、`fs/remove`、`fs/copy` | 真机 Code 标签页的文件预览只读 |

**B. 已由其他方法覆盖（14 个）**

| 方法 | 覆盖方式 |
| --- | --- |
| `thread/queue/update` | 「在输入框中编辑」用删除加回填实现，回填不了的部分提示「消息已撤回。其附件无法放回输入框。」 |
| `project/read` | `project/list` 加 `project/changed` |
| `thread/items/list`、`thread/items/read` | `thread/turns/list`（`itemsView: "full"`） |
| `command/exec/write`、`…/terminate`、`…/resize` | 终端用 `process/*`，`!` 命令用 `thread/shellCommand`；`command/exec` 只用于一次性只读查询 |
| `config/value/write` | `config/batchWrite` |
| `fuzzyFileSearch/sessionStart`、`…/sessionUpdate`、`…/sessionStop` | 单次 `fuzzyFileSearch` 加取消令牌 |
| `thread/realtime/appendAudio`、`…/appendText`、`…/appendSpeech` | WebSocket 传输的替代通道；codex-ui 走 WebRTC，音频直接进浏览器 |

**C. 真机没有对应界面（22 个）**：按「如有」的要求不做。

| 方法 | 理由 |
| --- | --- |
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

### 未处理的通知（21 个）及理由

| 通知 | 理由 |
| --- | --- |
| `guardianWarning` | 会话自己的 Codex 警告不进转录（0b9b838450 起，真机转录没有这类行）；已退订 |
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
- 3.1623 复核（2026-10-22）：`pnpm typecheck` 0 错误，`pnpm test` 340/340。mock 预览里实测了单会话与多选菜单、分组头菜单的置灰原因、全部归档确认、用量弹层（宽 360、轨道色等于 `--cds-alpha-3`）、上下文卡片的「自上次更新以来」与可点击行（跳到 设置 › 连接器）、命令面板的展开 / 折叠窗格、章节列表的宽度与截断提示。Electron 里跑过 `desktop/browser-smoke.test.mjs`（通过），另用临时冒烟脚本验了自动打开写入文件（默认开；`.ts`、会话目录外和不存在的文件不开；打开时弹出面板；再写复用同一标签；关掉后不开且设置已保存）。没有验证的：退出确认（只读过代码，没在 Electron 里触发）、快捷键录制提示与浏览器面板菜单的实际外观（只在桌面壳里出现）。
- 撤销 toast 按基线关掉后（同日）：`pnpm typecheck` 0 错误，`pnpm test` 340/340。mock 预览里单会话归档不弹提示；多选归档 2 个弹「已归档 2 个会话」，没有撤销按钮，约 3.2 秒后移除（含 200ms 淡出）；分组全部归档弹「已归档 3 个会话」，鼠标悬停 5 秒仍在，移开后约 3 秒消失。多选取消归档、多选删除、「未加载的会话未归档」和各失败提示只过了类型检查，没在预览里触发。

## 四、分类深查（2026-10-23 起）

把审核拆成上面的 12 个区域，每轮查一两类；深色、密度、窄屏和键盘焦点随各类一起查。原子组件用渲染对照：离屏 Electron 里一边渲染 3.1623 ion-dist 的组件（`shared-frame` 导出，套 CDS 根 Provider），一边渲染 codex-ui 的对应组件，内容相同、两种密度、浅色与深色各一遍。状态用 CDP 强制 hover / active / focus-visible；菜单和提示气泡用真实指针悬停（它们按指针移动高亮或打开，不看 `:hover`）。每格逐像素比，同时比计算样式。

| 类别 | 状态 |
| --- | --- |
| 令牌与原子组件 | 2026-10-23 完成 |
| 外壳 | 2026-10-23 完成 |
| 侧栏 | 2026-10-23 完成 |
| 首页 | 2026-10-23 完成 |
| 转录骨架 | 2026-10-23 完成 |
| 转录条目 | 2026-10-23 完成 |
| 输入框 | 2026-10-23 完成 |
| 审批与提问 | 2026-10-23 完成 |
| 面板 | 2026-10-23 完成（后台任务窗格待定，用户决定先不动） |
| 命令面板与对话框 | 2026-10-23 完成 |
| 设置 | 2026-10-23 完成 |
| 后端 | 2026-10-23 完成 |

### 令牌与原子组件（2026-10-23）

比对范围：
- 令牌全集；Button（6 种变体 × 4 个尺寸 × 各状态）、Switch、Checkbox、SegmentedControl、Shortcut 键帽、Spinner、图标按钮。
- Menu：分组标题、图标行、快捷键、勾选、说明、分隔线、子菜单、禁用、危险项，含悬停与子菜单展开。
- Tooltip：纯文本、快捷键、说明行、长文本、多行、下方、下方带快捷键。
- Dialog：普通对话框与确认框。
- TextInput：空、有值、出错、禁用、lg。

已改：

| 项目 | Claude（出处） | 原来的 codex-ui |
| --- | --- | --- |
| 深色字重轴 | 深色下正文走 `"wght" 360`，medium 460、semibold 540、bold 560；设字重的类同时设轴，b / strong 用 bold 轴，th 由 font-weight 驱动（c6a992d55 `:where(.cds-root)`、`.font-*`、`.text-*`） | 只有 `.fw-*`、实心按钮和回复正文设了轴，其余正文是 400。现在 body 设 regular 轴，72 处 font-weight 声明配上对应的轴（图标字体不动）；浅色下这些令牌都是 normal，外观不变 |
| Tooltip 字重 | 文字在 dark scope 里，浅色下也是 360（shared-frame `um`） | 400 |
| Tooltip 宽度 | 换行后按最宽一行收窄（ShrinkWrap，shared-frame `nm`） | 固定 240 |
| Tooltip 位置 | 在下方时比偏移低 1px，在侧边低 0.5px（定位层是行盒，popup 是 inline-flex）；坐标按设备像素取整（floating-ui `roundByDPR`） | 正好 4px，坐标可落在半像素上；Popover 同样改为取整 |
| 子菜单宽度 | 按内容，128–320（Menu.Popup 不设宽） | 固定 320 |
| 菜单、对话框正文行高 | `text-body`（19 / 20） | 继承 body 的 1.5 倍（19.5 / 21） |
| 深色菜单 | 列表底部有 `--cds-ring-inner` 宽的透明边，深色下高 1px | 不加 |
| 无正文的对话框 | 标题区的下外边距和页脚的上外边距折叠，间距 12 / 16 | 20 / 28 |
| 输入框 | 禁用 0.4 透明；lg 的左右内边距随尺寸放大到 10 / 16 | 禁用不变淡；lg 仍是 8 / 12 |
| 分段控件 | 选项行高随尺寸（leading-body 各档） | 继承 |
| 键帽 | 单字符是正方形（shared-frame `Bs`） | 最小宽度加 3px 内边距 |
| 复选框 | 选中后悬停不出描边 | 出现 border-stronger 描边 |

复测：
- 按钮、开关、复选框、分段控件、键帽、Spinner：浅色与深色下各状态逐像素一致。
- 菜单：各行、子菜单位置与宽度一致；深色下高度也一致。
- Tooltip：位置与尺寸一致。
- Dialog：各部分位置与高度一致。
- 输入框：除出错态外各状态一致。出错态 Claude 由 Field 上下文设 `data-invalid`，单传 `aria-invalid` 不变红，所以对照不了，样式规则已逐条核对一致。
- mock 预览深色模式下扫描了首页、会话菜单、带 Markdown 的转录和设置页 8 个标签，没有字重与轴对不上的文字。

还有的差异，以及留给别的类别的：
- 文字抗锯齿：菜单与 Tooltip 在 Claude 是灰度抗锯齿（菜单列表常驻 `scroll-fade-y` 遮罩，Tooltip 定位层单独合成），codex-ui 是彩色子像素。要对齐菜单得把 `.popover` 拆成「外壳 + 带遮罩的列表」两层，改动面大，暂不跟。同一原因，被窗口限高、整体滚动的 `.popover` 两端没有淡出（`.menu-scroll` 有）。
- 对话框初始焦点：codex-ui 默认把带焦点环的初始焦点放主按钮（照 ConfirmDialog）；Claude 的通用 Dialog 交给 Base UI，落在第一个可聚焦元素、不显示焦点环。逐个对话框留到「命令面板与对话框」核对。
- Toast：已在「外壳」一轮查完（见下）。
- ShrinkWrap 在 Claude 还用于 shared-2 里一个可编辑消息块（疑似用户消息气泡），留到「转录条目」。
- 尺寸 sm 的输入框 codex-ui 没有，现有界面也没用到，不加。

校验：`pnpm typecheck` 0 错误，`pnpm test` 340/340。其中一次运行里，有个服务端用例的随机端口撞上 fetch 的禁用端口，报 `bad port`；重跑通过，与本轮改动无关。

### 外壳（2026-10-23）

比对范围：
- `--cds-page-bg` 在各处的取值。
- 窗框背景层：`.dframe-root` web 变体、侧栏、内容区、分隔线。
- 启动占位、Windows 标题栏、会话标题栏的半透明底。
- Toast：外观、类型、时长、位置。

Toast 用渲染对照：Claude 一侧用 shared-19 的 ToastProvider（`PO`）和 `IO().add`，codex-ui 一侧用 store 的 `toast()`。共 7 种：单行、带说明、warning、danger、合并计数、长文本、三张叠放；浅色与深色各一遍，逐像素比。

已改：

| 项目 | Claude（出处） | 原来的 codex-ui |
| --- | --- | --- |
| Toast 密度 | 视口挂在应用的 CDS 根上；用鼠标时根不设 `data-density`，即 compact：13 / 19，上下 8、左右 12（shared-frame `io`、shared-50 `nw`） | 落在 `:root` 的 comfortable：14 / 20，上下 12、左右 16 |
| Toast 图标位 | 图标外层随 20px 的图标高，单行 toast 高 36（shared-19 `wO`） | 定成一行高，单行高 35 |
| 失败提示的样式 | 应用层的 `addError` / `addApiError` 出 warning 变体：黄底、Warning 图标（shared-52）。`addDanger` 全包只有两处调用，Code 标签页里的那处是 GitHub CLI 登录失效 | 76 处失败提示都用 danger：红底、WarningCircle |
| Toast 时长 | 普通提示 6.5 秒；warning / danger 的纯文本标题 10 秒；调用方给的时长不足 6 秒时抬到 6 秒（shared-50 `WC`、shared-52 `PI`、shared-19 `fO`） | 一律 6.5 秒；侧栏批量提示 3 秒 |
| 重复提示的静默 | 合并过的 warning 被用户关掉，或撞上 30 秒上限而关闭后，30 秒内同样的提示不再弹（shared-50 `ew` 的 `KC`） | 没有 |
| Toast 让位 | 输入框停靠区的对话列（含两侧 32px 留白）与 toast 横向重叠、且底边离窗口底不到 200px 时，toast 抬到停靠区上方 16px，最高到离窗口顶 96px；模态对话框打开时不让位（shared-26 `NN` / `PN`；登记处在 cc43287c9） | 固定在右下角，会压住输入框右侧 |

核对一致、未改：
- **`--cds-page-bg`**：
  - 根为 `surface-1`（shared-50 `LT`）。
  - Surface panel 为 `surface-2`，popover 与对话框为 `surface-3`（shared-frame `Wh` / `Ny` / `Zf`）。
  - 提示气泡在深色作用域里，取深色的 `surface-0`。
  - codex-ui 的 `:root`、`.pane`、`.popover`、`.dialog` 取值相同。提示气泡里没有用到页面底色的挖空效果，不设。
- **窗框背景**：
  - 桌面端 `.dframe-root` 用 web 变体（shared-22 `RL`：`Ea()==="web"`）。
  - 内容区底为 `surface-1`。侧栏浅色为 `surface-0` 与 `surface-1` 各半，深色为页面底色 80% 混黑。分隔线是 0.5px `border`。
  - codex-ui 一致。3.1623 新增的 `--df-page-ground` 只给启动占位取色用。
- **启动占位**：
  - 3.1623 会记下上次的页面、侧栏和分隔线颜色（`reportBootPlaceholderColors`），下次启动按它画占位。codex-ui 直接用当前主题的令牌画，颜色相同。
  - 占位形状仍是默认形状，没有跟随真实侧栏的形状（`reportSidebarPlaceholder`，2.42304 起就有）。
- **Windows 标题栏**：3.1623 的 `ML` 与 2.42304 的 `LN` 结构、类名相同，codex-ui 不变。
- **会话标题栏半透明底**：只在 `panels` 开关打开时启用（shared-4 `Gp` / `Kp`）。基线为关，codex-ui 用不透明底正确。

还有的差异：
- Toast 让位只在 toast 出现、窗口或停靠区尺寸变化时重算。toast 显示期间打开对话框或切换会话，它不会跟着变（代码里有 `ponytail:`）；Claude 用 ResizeObserver 与 MutationObserver 持续跟踪。
- 跨类别：codex-ui 的 `:root` 是 comfortable，Claude 的根是 compact。
  - 对话框：Claude 大多显式包了 comfortable（cc43287c9、shared-20、shared-21、shared-22 等），所以目前一致。
  - 其余直接挂在根上的浮层，留到「命令面板与对话框」逐个核对。

复测：
- 7 种 toast 在浅色与深色下逐像素一致，最大通道差 ≤ 1。
- mock 预览（1024×768）：首页弹出 toast 后，`--toast-clearance` 为 84px，toast 底边在停靠区顶边上方 16px。
- `store.test.mjs` 的 toast 用例改为覆盖时长下限、warning 10 秒和 30 秒静默。

校验：`pnpm typecheck` 0 错误，`pnpm test` 340/340。

### 侧栏（2026-10-23）

做法：按用户要求，侧栏和窗框的标记改按 3.1623 源码重写，好让每条样式直接对照 Claude 的规则。
- 类名、data 属性和 Tailwind 类串原样照抄：
  - shared-18 `OD` / `wD` / `xD`（行）。
  - shared-21 `gz`（搜索）、`F8`（新建）、`I8`（导航行）、`YR`（手机抽屉头）、`nI`（折叠态触发按钮）、`sN`（分组的悬停 / 聚焦标记）。
  - shared-22 `RL`（窗框）、`SI`（aside）、`ML`（Windows 标题栏）、`wC`（分组）、`Fj` / `Pj`（已置顶与它的放置行）。
  - shared-19 `rP`（页脚用户按钮）。
- 新增 `Frame.tsx`：`div.dframe-root > [标题栏、aside、main.dframe-content > div.dframe-content-inner]`。侧栏把宽度和 `data-collapsed` / `data-phone-sheet` / `data-hovering` / `data-peeked` / `data-session-dragging` 写回窗框根节点（shared-22 `FL`）。
- 样式不再手写。`scripts/claude-css.mjs` 从 c6a992d55 与 shared-styles 里，抽出选择器所含类名全部出现在 `Sidebar.tsx` / `Frame.tsx` 中的规则，生成 `styles/claude.generated.css`：共 497 条，去掉 @layer，保留原顺序；`--check` 检查生成文件是否过期。
- `shell.css` 删掉旧侧栏和标题栏规则约 1160 行，只留 codex-ui 自己的部件：字标、菜单、拖动提示、头像、页面拖动带、浮层不可拖。

Claude 组件与 codex-ui 组件的差异，这样补齐：

| 项目 | 做法 |
| --- | --- |
| 图标 | Claude 的 Icon 是带内联 `font-size` 的 span。抽取时把 `span[style*=font-size]` 改写成 `span[data-cds="Icon"]`（新建圆圈 13px 粗体、标题栏按钮 16px）。折叠态触发按钮里，Claude 显式指定的 sm 图标不随 lg 按钮放大，codex-ui 用 `--btn-icon` 固定为 16 |
| 弹层触发 | codex-ui 的 Popover 会在触发按钮外包一层 `.popover-root`。页脚用户按钮要占满整行，所以给这层包装加 `display: flex` |
| 深色 | 窗框规则看 `[data-mode=dark]`。`theme-init.js` 和 `applyTheme` 在设 `.dark` 的同时写 `data-mode` |
| 令牌 | 补上 Claude 名下的 `--cds-gray-10/900`、`--_gray-10/850`（HSL 分量）、`--cds-neutral-50/60/70/150/900`（浅 / 深）、`--cds-panel-line`、`--cds-toolbar-line` |
| 抽取范围 | 只靠 `:not(.x)` 命中的全局规则不收（例如 base 层的 `button:not(.hide-focus-ring):focus-visible` 描边，否则全站按钮都会被它覆盖）；模板字符串 `${…}` 里的类名也算 |

改写后与原来不同、现在随 Claude 的地方：

| 项目 | Claude（出处） | 原来的 codex-ui |
| --- | --- | --- |
| 分组头按钮 | 先「筛选」后「+」（wC）；静止时是 muted，悬停分组头时变 secondary（shared-styles `--df-heading-ink`） | 先 + 后筛选，+ 为 secondary |
| 搜索框快捷键 | 键帽（gz 用 `Kbd`） | 纯文字 |
| 新建行快捷键 | 文字键加 `leading-none`（shared-18 `_D`），垂直居中不变 | 行高 16 |
| 侧栏分隔线 | `border-inline-end: 0.5px`，DPR 1 时取整为 1px | 0.5px 内阴影 |
| 会话行行高 | `[data-row-main-button]` 20px；桌面（无 `data-web`）恢复继承，即 19.5 | 一律 19.5 |
| 分组头、状态点 | 分组头下移 0.5px，状态点左移 1px（`--df-group-band-*`、装饰格 KD / qD） | 手写的近似值 |
| 浏览器里的标题行 | 字标在左、开关在右（SI 的 web 分支）；桌面端在 36px 标题栏里，不变 | 开关在左 |
| 手机抽屉 | 头部 44 高；搜索按钮占满宽度、左对齐（YR） | 头部较矮，搜索按钮居中 |
| 空分组提示 | 会话列表里隐藏（shared-styles `.df-session-list [data-empty-group-hint]`） | 显示「将会话拖动或移动到此处」 |

核对一致、未改：
- **未读状态点**：用 accent 色。3.1623 新增的灰色样式（shared-18 `kO`）受 fizzy-lake 的 type 变体控制，基线为关，所以不跟（从「〇 · 本轮没有跟」的「条件没有核实」里移到这里）。
- **行状态**：hover、选中、多选、菜单打开时的底色，键盘聚焦环（1px accent + 6px 光晕），浅色和深色下都与原来相同。

复测：
- 浏览器变体：30 个场景改写前后各拍一遍，逐像素比对，并比对计算样式。场景包括静止、悬停、选中、折叠分组、行菜单、多选、键盘焦点、四种分组方式、折叠 / peek、窄窗、手机抽屉、用户菜单、筛选菜单，以及其中几种的深色。差异都能对上上表或 Claude 规则本身。
- 桌面变体：用标题栏覆盖层加空的桌面桥补拍 7 个场景。36px 标题栏右侧让出 137px 系统按钮；停靠时会话标题落在 288 起的标题槽；折叠时标题跟在返回 / 前进之后；peek 从标题栏下浮出；深色正常。没有改写前的桌面基线，这部分只核对了结构。

同日补上首轮没跟的几项：

| 项目 | Claude（出处） | codex-ui |
| --- | --- | --- |
| 折叠时的左边缘 | 宽窗口折叠后，窗框起始边有一条 CDS ResizeHandle（shared-21 `RM`：`dframe-sidebar-edge`，浏览器 8px，桌面 12px 裁成 8px）。提示「显示侧边栏 · Ctrl+B」，第二行「拖动以调整大小」，跟着指针高度走（`trackCursorAxis: "y"`）。单击展开；拖出超过最窄宽度的一半（100px）就停靠，宽度跟随指针，松手后记住（`LM`、shared-16 `Ac`）；键盘 → / Enter 展开。靠近时的提示条和磁吸浮出受 `__gb__741807810` 控制（`iv()`，未下发为关），默认不画，设置 → 通用 → 外观 →「侧边栏边缘提示」可打开（lib/edgeMagnet.ts 移植 cec084e62 EdgeMagnetPeek，减弱动效时为 shared-21 `MM` 的静态提示）；边缘本身的开关 `__gb__3775304746` 是杀开关，按显示 | 新增 `SidebarEdge`。提示层支持 `data-tip-track="y"`，侧栏缩放把手也用上；拖动期间 `.dframe-root[data-resizing]` 保持 col-resize 指针、不选中文字（Claude 的拖动会话，shared-11 `yc`） |
| 折叠态触发按钮的位置 | 用 ResizeObserver 实测按钮右缘；与 CSS 推导值不同时写 `--df-trigger-right` / `--df-nav-extent`（shared-21 `nI`） | 新增 `CollapsedChrome`，同样实测 |
| 占位行 | 不在 SkeletonGroup 里的 CDS Skeleton：自带 2 秒的 `cds-shimmer` 扫光，各自 `role=status`，带「加载中」；新挂上的条与页面上最早的扫光对齐相位（shared-frame `Ad` / `id`） | 照做，`syncShimmer` |
| postcss | — | `claude-css.mjs` 依赖的 postcss 写进 `package.json` 的 devDependencies（^8.5.29，锁文件同步） |

1.2.20 安装包的样式取错了版本：构建前一刻，Windows 在 3.1623.4 旁边装上了 Claude 3.6556.1（正在运行的仍是 3.1623.4），`claude-css.mjs` 按「最新安装」取规则，结果 3.1623 的标记配上了 3.6556 的规则。导航行后的 12px 间隔在 3.1623 里会被压成 0，这下又撑开，会话列表整体下移 12px。85730e540f 把脚本固定到 3.1623.4（`--claude` 可另指），1.2.21 重新打包，1.2.20 的发布说明已标注被取代。

核对后不用改：侧栏首次显示时的淡入（shared-21 `pR` 的 `df-body-fade-in`）只在非 Code 模式、预渲染的侧栏交接时出现（`OF()` / `_F()`），Code 标签页里不会触发。所以去掉 `.app-body` 的整体淡入是对的。

校验：`pnpm typecheck` 0 错误，`pnpm test` 340/340，`node scripts/claude-css.mjs --check` 通过。`desktop/title-generation-smoke.test.mjs` 的选择器已改成新标记，但这个用例要真 codex 和 Electron，没有运行。

### 首页（2026-10-23）

比对范围：新会话页的启动卡片，包括最近使用的环境、「选择环境」、后续步骤、合并的受阻会话行与它的弹层、各行提示，以及卡片的居中与后续步骤让位。

做法同侧栏：标记照抄 cc43287c9，组件放进新文件 `StartCard.tsx`，样式由 `claude-css.mjs` 抽取，`pages.css` 删去旧的 `.start-*` 约 230 行。照抄的部分：
- `BG` / `FG`：卡片所在的列，以及让它居中的算法。
- `Uae`：卡片本身。
- `X5`：环境行；`v5` / `y5`：普通行和当前环境行。
- `Aae`：后续步骤。
- `G5`：卡片外框。
- `h5` / `g5` / `Vie` / `Hie`：行、行内淡色部分、关闭按钮的让位与位置。

为照抄而补的：

| 项目 | 做法 |
| --- | --- |
| 提示 | 提示层新增三个属性：`data-tip-align="start"`（与触发元素起点对齐）、`data-tip-wide`（最宽 480，cc5c56f5c `t`）、`data-tip-path`（路径只在分隔符后换行，cc5c56f5c `n`） |
| preflight | Claude 的标记依赖 Tailwind 的 preflight，以及 CDS 根上的边框色（c6a992d55 `@layer base`），codex-ui 没有全局加载这些。给侧栏、标题栏、启动卡片这几处 Claude 标记补一份零优先级的替身：外边距、内边距、边框归零，列表不带圆点，边框色取 `--cds-border` |
| 弹层包装 | codex-ui 的 Popover 会在菜单行外包一层，在卡片里设为 block，免得行被压窄 |
| 令牌 | 补 `--cds-neutral-30`（浅色 `#f6f6f4`，深色 gray-870） |
| 路径 | 用户主目录下的路径写成 `~` 开头（shared-46 `sL`），新增 `homeRelative`，带测试 |

改写后与原来不同、现在随 Claude 的地方：

| 项目 | Claude（出处） | 原来的 codex-ui |
| --- | --- | --- |
| 环境行提示 | 路径以 `~` 开头，只在分隔符后换行；提示在行的上方，与行首对齐，最宽 480（`_5` / `LF` / `IF`） | 原样路径，居中，最宽 240 |
| 后续步骤提示 | 对齐方式和最大宽度同上 | 居中 |
| 弹层里的受阻会话 | 不带关闭按钮（`H5`：列在弹层里时没有 dismiss） | 每行都能关闭 |
| 键盘关闭 | 用键盘按 X 关闭后，焦点留在卡片里：落到剩下的最后一行，没有就落到「选择环境」。用指针关闭才回到输入框（`Aae` / `YN`） | 一律回到输入框 |
| 行冻结 | 指针停在后续步骤上，或焦点在其中时，行不增、不换位；已完成的照常消失（`wae`） | 随时变化 |
| 后续步骤出现时机 | 等文件夹的 git 状态读完才一起出现，之后本次打开期间不再收起（`Tae`） | 会话行先出现，「继续未提交的工作」随后插进来 |
| 连点保护 | 点掉一行后 500ms 内，落在已消失那行位置上的第二下点击会被吞掉，免得双击按到补上来的行（`Aae` `le`） | 没有 |
| 居中方式 | 卡片上方放一个可伸长的占位块，最大高度取居中所需的间距（`BG` / `FG`） | 写 padding-top（2.42304 的做法），位置相同 |

核对一致、未改：
- 静止状态：浅色、深色下卡片区域与改写前逐像素一致。悬停底色、关闭按钮、提示、环境菜单也逐一看过。
- 行高 32、卡片宽 320、圆角 12、卡片之间间距 12。环境最多三个，当前环境若不在其中，就换掉第三个。
- 文案按 i18n id 与 zh-Hans 逐条核对过。「Claude 在 N 个会话中受阻」照例换成 Codex。

还有的差异：
- 列的左右留白原先用 `px-4` 代替 Claude 聊天列的 gutter（shared-6 `cg`），已在「转录骨架」一轮改为聊天列留白。
- 深色下，会话标题栏文字的抗锯齿从灰度变成了彩色子像素。原因是外框改写后，旧 `.app-body` 的淡入动画留下的合成层没了。这属于外壳，没有对照 Claude 核实。

校验：`pnpm typecheck` 0 错误，`pnpm test` 341/341，`node scripts/claude-css.mjs --check` 通过。提交为 087fffb6c4。

### 转录骨架（2026-10-23）

比对范围：
- 转录滚动区：两端渐隐、底部垫高，以及延伸到坞下的部分。
- 空态、加载中、加载失败。
- 加载更早的消息：顶部 40px 的状态带，以及首屏的「加载更早的消息」按钮。
- 「滚动到底部」按键。
- 回合与条目之间的间距。
- 工作行：TurnStatus、任务计数、重试文案。
- 章节标题与章节目录的刻度。
- 计划卡片。
- 聊天列的宽度与留白。

做法：codex-ui 的这些部分当初照 2.42304 实现，这轮的重点是找 3.1623 的增量。3.1623 改用 React Compiler 生成的缓存写法，函数体无法逐行比对。所以先按字符串字面量的重合度，把 codex-ui 注释里引用的约 40 个 2.42304 函数配上 3.1623 的对应函数，再比较两边的类名词元和文案 id。TurnStatus 所在的 c734f318c 整个 chunk 一起比。

结论：在 Code 会话里，这些部分 3.1623 与 2.42304 相同。变化只有以下几处，都不影响 codex-ui：
- 滚动区（c4a70913c `x`）多了 `topFade` / `bottomFade` 开关，默认都开；「滚动到底部」按键多了 stacks 变体，该开关为关。
- 转录外框（`nat` → `Ntt`）多了总览信息流和协调者会话的属性（`Q7`），Code 会话用不到。
- 行间距（`Snt` → `H7e`）多了 host 消息的分支，其余类名逐个一致。
- 重试文案挪进共享模块（c4a9ee384 `gm` / `vm`），输出仍是「原因 · 正在重试（n/m）」。
- 章节目录刻度的两段类名合成了一个模板，计划卡片的 `in_progress` 判断挪进了辅助函数，内容都没变。

已改：

| 项目 | Claude（出处） | 原来的 codex-ui |
| --- | --- | --- |
| 聊天列留白 | 会话格（`@container/tile-slot`，shared-20）宽 ≤ 560 时，留白由 32 收为 16（shared-6 `ag`）。侧栏或窗格把会话格挤窄时也会收 | 视口宽 ≤ 640 时才收。现在 `.main-col` 设为 tile-slot 容器，转录和新会话页都按会话格宽度判断 |
| 新会话页的列 | 卡片所在的列用聊天列的留白（shared-6 `cg`） | `px-4`（16） |

没跟：
- 滚动区的 `[contain:strict]`：codex-ui 的转录里还有直接用 `position: fixed` 的元素（右键菜单的锚点、图片预览）。加上后它们会改以滚动区定位，而视觉上没有差别，所以不加。

留到「转录条目」：
- 用户消息行（`fz` → `bI`：发送中的 CheckDouble 状态去掉，新增「已排队」）。
- +N −N 计数（`Vz` → `QN`）。
- 新增的消息表情回应行（`epitaxy-message-reactions`）。
- Hook 拦截提示（`NZ`）和错误行（`Wq`）已挪出 c96d752d0。
- 窄屏下用户气泡最宽 92% 的规则。

复测：mock 预览里，窗口 1280 宽时会话格 992、留白 32；800 宽时会话格 512，转录和新会话页的留白都是 16。在会话格里放一个 `position: fixed` 的探针，仍落在视口原点。

校验：`pnpm typecheck` 0 错误，`pnpm test` 341/341。改动未提交。

### 转录条目（2026-10-23）

比对范围：
- 工具调用行：动词 · 细节 · 结果，分组摘要，运行中的微光。
- 命令、MCP、子代理、Hook 拦截、通知、压缩、错误行。
- 用户消息气泡、已发送回执、提问的回复卡。
- 回复正文：Markdown、代码块、链接、图片。
- 文件卡片：头部、差异视图、+N −N 计数。
- 计划卡片与计划面板的任务列表。
- 已发送文件的卡片。

做法：同「转录骨架」。按字符串重合度，把 `items.tsx`、`content.tsx` 注释里引用的约 200 个 2.42304 函数配上 3.1623 的对应函数，再比较类名词元和文案 id。重合度低的改按 i18n id 定位（Hook 拦截卡、错误行、文件卡片头部）。

结论：多数条目两版相同，例如工具行（`JIe` → `KTe`）、Hook 拦截卡（`NZ` → `EX`）、压缩行、已发送文件的卡片（类名只是挪进了模板）。有变化的如下。

已改：

| 项目 | Claude 3.1623（出处） | 原来的 codex-ui |
| --- | --- | --- |
| 工具行的 +N −N 胶囊 | 改用 CDS DiffIndicator（c227f4d5e `Mw`），胶囊样式与 codex-ui 按行设计画的一致。增量有三处：计数整体 `dir="ltr"`；两个数字 `aria-hidden`；另给读屏一句「新增 N，删除 M」（`AUUK+jFHU3`） | 没有 `dir`，读屏念「+1 −1」 |
| 文件卡片头部的计数 | `dir="ltr"`（c44d00c7f `pa`） | 没有 |
| 任务列表 | `<ul role="list">`（cb6930dae `Lu` → `bd`） | 计划卡片和计划面板都没有 `role` |
| 错误行 | 标题 `break-words`，标题行 `max-w-full`（c96d752d0 `AK`，原 `Wq`）：长串在 480 列内换行 | 长串撑出列宽 |
| 窄屏的用户气泡 | 两个版本都没有 92% 的规则，气泡始终最宽 85% | 视口 ≤ 640 时 92%，规则来历不明，已删 |

没跟（Code 会话里用不到）：
- 频道消息的表情回应（`epitaxy-message-reactions`）。Code 会话没有频道。
- 用户消息行的「已排队」，以及远程、排队消息的读屏文字（`fz` → `bI`）。codex-ui 的排队消息留在输入框上方的队列里，不进转录。2.42304 发送中的 CheckDouble 状态，codex-ui 原本就没画。
- 回复根节点的 `data-cds-reply-type` 和气泡堆叠（`data-cds-bubble-stack-items`）。对应开关为关。
- 文件卡片头部的评审标记与评论数。codex-ui 没有差异评审。
- 代码块的「无底色」模式（透明底，复制键靠尾）。只在特定卡片里用，默认代码块没变。
- 链接：claude.ai `/chat/<uuid>` 链接在应用内打开；本地预览服务器链接的分支（判断恒为假）。
- 图片的「ask」模式（加载外部图片前先问）。只在设了链接策略的不可信内容里生效，Code 会话的回复没有。
- 用户消息编辑框里的 Alt+Enter 换行和 `dir="auto"`（`UX` → `O2`）。codex-ui 没有消息编辑；气泡正文本来就是 `unicode-bidi: plaintext`。
- 工作行的 SSH 重连（`T8` → `K6`），以及记忆工具的分组摘要（c24951e9f `Z` 的 `memory_recall` / `memory_save`）。Codex 没有对应的能力。
- 差异面板里的三处 `.diff-stat`（`Panes.tsx`）属于「面板」，留到那一轮。

复测（mock 预览）：
- 「统一按钮圆角」会话里，胶囊为 `dir="ltr"`，两个数字 `aria-hidden`，读屏文字是「新增 1，删除 1」。读屏文字绝对定位、不占位，胶囊仍是 43.6 × 16。
- 气泡最宽仍是 85%。
- 错误行放进 200 个字符的无空格长串，在列内折成 4 行，不再溢出。

校验：`pnpm typecheck` 0 错误，`pnpm test` 341/341，`claude-css.mjs --check` 通过。改动未提交。

### 输入框（2026-10-23）

比对范围：
- 输入卡与编辑器：占位文字、斜杠和 @ 弹层、历史记录、排队消息。
- 「+」菜单：附件、连接器、插件。
- 选择器行：模式、模型胶囊与模型菜单、努力程度滑杆、快速模式、地点胶囊。
- 上下文圆环与弹层、套餐用量弹层。
- 听写与语音按钮。
- ChatComposer 根组件和 chin。

做法：
- 从 `Composer.tsx`、`composer.css`、`dictation.ts`、`voice.ts` 的注释里取出约 110 处引用。
- 函数照前两轮的办法比：按字符串配对，再比类名词元和文案 id。
- 类名常量（shared-6 的行类名、c227f4d5e 的着色器与配色对象等）单独比值，结果全部相同。
- 按行号引用的部分（ChatComposer 根组件、占位文字），按 `data-cds` 标记或文案 id 定位后再比。
- 最后比整个 chunk 的文案 id，补查引用之外的增删。
- 审批卡、提问卡、MCP 表单的引用（c385ec32f、c96d752d0 `Rj`、shared-10 `eS`、shared-5 `EA`）留到「审批与提问」。

结论：输入框的主体两版相同，包括模式菜单、发送 / 停止 / 排队、斜杠与 @ 弹层的键盘逻辑（`SS` → `rE`）、模型行、努力程度滑杆，以及听写按钮的三种状态。有变化的如下。

已改：

| 项目 | Claude（出处） | 原来的 codex-ui |
| --- | --- | --- |
| 听写时的占位文字 | 听写录音时，空草稿的占位文字换成斜体的「正在聆听…」（`fFXFXLn7w9`），优先于其他占位文字（c227f4d5e `uM` → `kM`，shared-5 `eN`）。2.42304 就有，不是 3.1623 的增量 | 听写只体现在按钮上，占位文字不变 |
| 上下文弹层的限额段 | 标题右侧去设置的入口，从 ArrowRight 链接换成套餐弹层那个 UsageGaugeMiddle 量表按钮（ghost、xxs、仅图标、贴右，c1564829c `E` / `T`）。限额行不变，只是挪进了 c1564829c | ArrowRight 链接（`usage-link`，已删） |

没跟：
- 语音模式的占位文字：新增「思考中…」、听写「正在连接…」（shared-7 `NN`）。它们只用在聊天页的输入框（shared-9），Code 标签页的编辑器只认听写录音。
- 选择器行里新增的 `mx-xs gap-1`：所在分支的判断恒为 null，实际仍是 `gap-xs`。
- 斜杠 / @ 弹层的最大宽度：由 `max-w-lg` 改为 `max-w-[min(32rem,calc(100vw-16px))]`。codex-ui 的弹层以输入卡宽度为上限，本来就不会超出视口。
- ChatComposer 和 chin 新增的 `size="lg"`（正文字号、sm 按钮）：没有调用方传 `lg`，Code 输入框是 `md`。chin 新读的 `panels` 开关在基线里为关。根节点新增的 `data-composer-size` / `data-end-column` 只是标记，没有样式用到。
- 地点胶囊的 `caret`：只在云端自动环境存在时显示 CaretDown，codex-ui 只有本地。
- 模型胶囊：努力程度在 CDS 实验性配色下显示 primary 的分支被删掉了；codex-ui 本来就用 muted，这次只更新了注释。
- 模型菜单「更多模型」的几种新展示配置。codex-ui 已按用户要求去掉「更多模型」。
- 「+」菜单的插件：新增带搜索的构建器（「搜索插件」「N 个 Skills」），只走云端插件；本地分支与 2.42304 相同。
- c227f4d5e 里用量限额的几条提示换了新 id，英文没变；codex-ui 的限额提示按 Codex 的限额类型写，不用这几条。SSH、WSL、任务列表、MCP OAuth 的新文案与输入框无关。

复测（mock 预览）：
- 「统一按钮圆角」会话里，在页面内把 `getUserMedia` 换成 Web Audio 生成的假音频流，点「语音输入」进入录音。占位文字从「输入 / 以使用命令」变为「正在聆听…」，`font-style: italic`，颜色仍是占位色；按钮变为「停止听写」。刷新后恢复。
- 量表按钮：把副本放进 `.usage-line`，按钮 20 × 20，距行右 8px，垂直居中，与套餐弹层头部的按钮位置一致。

校验：`pnpm typecheck` 0 错误，`pnpm test` 341/341，`claude-css.mjs --check` 通过。改动未提交。

### 审批与提问（2026-10-23）

比对范围：
- 工具审批卡：按钮槽位与快捷键、参数清单、授权说明。
- 停靠外壳与幽灵卡、出现后 400ms 的防误触。
- 计划审批卡。
- 停靠提问卡：分页、其他、跳过、方向键与数字键。
- 提问的回执。
- MCP 表单与链接请求。

做法：
- 从 `Approvals.tsx`、`approvals.ts` 和 `composer.css` 的审批段取出约 50 处引用。
- 审批卡外壳（c12c146ad）和提问卡（ccae33cda）的 chunk 在 3.1623 里已不存在，c385ec32f 的函数也全部改名。所以写了跨 chunk 匹配：用函数里的文案 id 和长类名，在 3.1623 全部 chunk 里找候选，再按字符串重合度定位。结果如下：
  - 工具审批卡、参数清单、计划卡：cc32965c2
  - 外壳：c2d1aeb56
  - 提问卡：c9ed5627b
  - 表单字段与校验：ce3d4614c
  - 防误触计时与按钮行：shared-37
- 再按文案 id 逐条确认 2.42304 的审批文案在 3.1623 仍在，没有一条消失。
- 按键相关的 c6ffe955f、ccbc7e432、c8cf7b513：两版字符串与数字常量相同，只差导入路径。

结论：审批与提问在 Code 会话里两版相同。差异只是写法上的：
- 参数清单和计划卡的几段渲染、提问卡「其他」输入框的方向键处理、表单的输入类型映射，都提成了顶层辅助函数，类名不变。
- 提问回执（cb6930dae `da` → `pa`）一致。「转录条目」那轮这个函数配错了，这次补比。

已改：

| 项目 | Claude（出处） | 原来的 codex-ui |
| --- | --- | --- |
| 计划卡片上的文件拖放 | 计划卡片外壳的 `onDragEnter/Over/Leave/Drop` 都会拒绝文件：`dropEffect = "none"`，并阻止冒泡，页面级的拖放接不到（c96d752d0 `aDe` `q`，3.1623 提成 cc32965c2 `ys`）。2.42304 就有，不是 3.1623 的增量 | 文件拖到计划卡片上，会出页面级的拖放遮罩，松手后加进输入框的附件 |

没跟：
- URL 请求的新流程：没有 `elicitationId` 时，打开链接后停在卡片上，按钮换成「再次打开」+「我已完成，继续」（c385ec32f `S`）。Codex 协议的 `mode: "url"` 一定带 `elicitationId`，走的仍是原来的「打开链接（接受）→ 等待服务器确认」。
- 服务器名被隐去时的「一个连接器」兜底名和图标隐藏。Codex 总会给出 `serverName`。
- 提问标题行新增的 `data-question-stop-name` 标记（shared-5 `EA` → `$P`）。没有样式或选择器读取它。

复测（mock 预览）：
- 在「统一按钮圆角」会话里切到计划模式，发「做个计划」，回合结束后出计划卡片。
- 用带 File 的合成拖拽事件测试。在卡片上，`dragenter` / `dragover` / `drop` 都被 `preventDefault`，`dropEffect` 为 `none`，页面级拖放遮罩不出现，输入框没有新增附件。拖到转录区时遮罩照常出现，离开后消失。

校验：`pnpm typecheck` 0 错误，`pnpm test` 341/341，`claude-css.mjs --check` 通过。控制台里两条 400 来自 mock 会话不存在的 rollout 文件（`/api/context-usage`），与本轮无关。改动未提交。

### 面板（2026-10-23）

比对范围：
- 平铺与窗格外壳（头部、⋮ 菜单、展开 / 收起、关闭）和窗格快捷键。
- 更改窗格：差异视图、转到文件、并排显示、隐藏空白。
- 计划窗格、后台任务窗格。
- 终端窗格：标签、设置菜单、xterm 选项。
- 文件窗格与文档预览：大纲、本页内容。
- 浏览器窗格：地址栏、工具栏、起始页。

做法：
- 从 `Panes.tsx`、`panes.ts`、`Terminal.tsx`、`FilePreview.tsx`、`Browser.tsx`、`Lightbox.tsx`、`FileMenu.tsx`、`browser.css`，以及 `pages.css` 的窗格段，取出约 100 处引用。
- 函数照前几轮的办法比（同 chunk 配对 + 跨 chunk 匹配 + 文案 id 定位），常量单独比值。
- 再按文案 id 比各面板 chunk 的增删。
- 窗格快捷键表按括号配对取完整数组，逐项比较。

**新版基准换成了 3.1623.0。** 这一轮做到一半时，Claude 自动更新到 3.6556，`C:\Program Files\WindowsApps` 下的 3.1623.4 被移除。后半程改用 `F:\REA\Claude_3.1623.0.0_x64__pzs8sxrjxfjjc`：
- 它的两份样式表与 3.1623.4 同名同哈希（`c6a992d55-Bt_TAkxU.css`、`shared-styles-DpOz7vZ5.css`）。
- 这一轮从 3.1623.4 取出的 58 个函数体在其中都能逐字找到。
- JS 文件哈希不同，但这次涉及的代码没有差异。

同一原因，`scripts/claude-css.mjs` 默认找 WindowsApps 下的 3.1623.4，现在会报错。要加 `--claude F:/REA/Claude_3.1623.0.0_x64__pzs8sxrjxfjjc/app/resources/ion-dist/assets/v1`，加上后 `--check` 通过（生成结果不变）。

结论：面板在非 `panels` 形态下两版大体相同。以下都没有变化：
- 窗格外壳（`Bt` → `Q`）、差异布局（`nC`，挪到别的 chunk）、转到文件（`Fb` → `qS`）、窗格分派（`qO` → `oP`）。
- 文档大纲（`Hn` → `Qn`，`popover` 只是从模板里挪出来）、显示内容按钮（`Jn` → `ar`）。
- 终端选项、浏览器工具栏。
- 平铺常量（shared-18 `Tb`）、窗格头部类名（shared-6 `Ym` / `ph`）。

`panels` 的判定有变化，但结果仍为关：
- 2.42304 要求 fizzy-lake 允许列表含 `panels`，而列表是空的。
- 3.1623 多了本地开关 `spa:cai_curious_tower`，它跟随 GrowthBook 开关 `__gb__3335190042` 写入。用户本机 2026-10-20 读到的值是 `1`。
- 但公共判定 `Gf`（导出为 `Wo`）仍先要求允许列表含该部分，列表 `Nm` 依旧是空数组，所以 3.1623.4 里 `panels` 仍打不开。
- 窗格外壳、后台任务、chin 里新增的 `panels` 分支都走不到。

已改：

| 项目 | Claude（出处） | 原来的 codex-ui |
| --- | --- | --- |
| 终端设置的「光标闪烁」 | 减弱动态效果开启时置灰，悬停说明原因（cccc2cf0a `HO` → `$N`，`disabledReason` `PxWbNu0OlD`）。这条官方中文缺译，按 codex-ui 现有用词写作：「减弱动态效果开启时无法使用。如需使用，请在系统设置中关闭减弱动态效果，并在设置中将“动效”设为“系统”。」 | 照常可点。减弱动态效果时光标本来就不闪，开关却看不出无效 |
| 任务列表 | `<ul role="list">`（cb6930dae `Lu` → `bd`），计划窗格同样适用，已在「转录条目」一轮补上 | — |

待定：
- **后台任务窗格的分组。** 3.1623 的任务行（cccc2cf0a `hD` → `tM`）新增了 `childCount` / `nested` / `steps`。家族分组去掉了 2.42304 的卡片外壳（`relative isolate my-1 rounded-card p-xs` 加分隔线），改为无外壳的 `role="group"`：子任务放在单独的容器里，嵌套行用 `me-outset`，有说明时加 `pt-xs`。2.42304 家族里「已完成 N 项」的折叠行（`CE`）也去掉了。同时有停止和展开时，悬停停止键会给整行加底色。
- 用户决定先不动（2026-10-23）。codex-ui 的后台任务窗格是自己的画法：分「运行中 / 状态未知 / 已完成」、行带底线、子任务用左侧竖线缩进、家族内有「已完成 N」折叠。它和两版都不同；任务列表本身（`SE` → `dXe`）两版一致。要跟 3.1623 就得按它的结构重做这个窗格，这次没动，留给用户决定。

没跟：
- 窗格快捷键表只多了 PR 评论的上一条 / 下一条（Alt+F9 / Shift+Alt+F9）。更改窗格新增的未解决评论导航、`11jd482` 那段（受 `__gb__2060353499` 控制）也一样：Codex 没有 PR 评论。
- 标题栏窗格开关（cc43287c9 `uW` → `pW`）新增 `startingId`，会话还在创建时可以先挂在「启动中」的会话上。codex-ui 先建线程再开窗格，没有这个过渡态。
- 标签条新增 `maxLabelWidth`（`basisChromePx: 52`，标签宽度随文字），只有「侧边对话」传了 320，终端标签不受影响。
- 浏览器窗格：
  - 「返回浏览器」只在预览服务器加载失败时出现，codex-ui 没有预览服务器。
  - 远程主机文件的几条提示属于 SSH 会话。
  - 「选择元素或添加标注」：codex-ui 没有标注模式，按钮仍叫「选择元素」（已有注释）。
- 只读共享会话、终端「需要更新版本的 Claude 桌面应用」、侧边对话相关文案，都不适用。

复测（mock 预览）：
- 预览窗格被隐藏时 `requestAnimationFrame` 不触发，应用停在启动骨架。改为把首页 HTML 加上 rAF 垫片，写进同源 iframe 启动。
- 打开「统一按钮圆角」的终端窗格。
  - 动效为系统时，「光标闪烁」可点。
  - 给根节点设 `data-reduce-motion="true"` 后，它变为 `disabled`，外层 `reason-tip` 带上原因，悬停弹出提示。
  - 去掉属性后恢复可点。

校验：`pnpm typecheck` 0 错误，`pnpm test` 341/341，`claude-css.mjs --check --claude <3.1623.0>` 通过。改动未提交。

### 命令面板与对话框（2026-10-23）

比对范围：
- 搜索面板（新版搜索形态，见 [搜索](search.md)）：最近会话、操作、筛选、撰写切换、行菜单、键盘。
- 设置深链、命令注册、展开 / 折叠窗格。
- 快捷键面板。
- 对话框：重命名会话、新建分组、删除分组、归档 / 删除确认、回退确认。

做法：
- 从 `Palette.tsx`、`palette.ts`、`Dialogs.tsx`，以及 `shell.css` 的搜索面板段、`base.css` 的对话框段，取出约 40 处引用。
- 照前几轮的办法比函数和常量。
- 再对搜索面板、行、页脚、快捷键面板所在的 chunk（c2771e1f6、ce8be540f、c01b6d4ec、c518a31cc、c11959232、cdfb0c433）整体比较文案和类名。
- 新版基准仍是 `F:\REA` 的 3.1623.0（见「面板」一节）。

结论：
- 搜索面板主体（`Dm` → `w_`）、最近会话（`wd` → `hm`）、行与时间分段（ce8be540f `dn` / `Cn` / `sn`）、匹配高亮（cdfb0c433 `t`）的文案和类名都一致；`filtered` 的判断只是挪进了辅助函数。
- 以下对话框都一致：
  - 重命名会话（shared-16 `Od` → `Sp`）：标题改由 `copy` 传入，Code 标签页仍是「重命名会话」。
  - 新建分组（shared-20 `bx` → `sb`）、删除分组（shared-18 `vE` → `oD`）。
- 归档确认少了一条带「尚未加载的会话不会归档」的计数文案，已在「〇、3.1623 复核」的侧栏一节跟进（shared-46 `VD` / `BD`）。
- 整个 c2771e1f6 的类名差异只有下表两处。

已改：

| 项目 | Claude（出处） | 原来的 codex-ui |
| --- | --- | --- |
| 键盘移动时的滚动 | 选中行滚进视野改为 `behavior: "instant"`（c2771e1f6 `hp` → `dg`） | `smooth` |
| 「设置 → 使用情况」的图标 | 设置页 `usage` 一行用 UsageGaugeMiddle，其余设置行仍用齿轮（c2771e1f6 `gs` → `Ss`：`r.id==="usage"?ys:vs`） | 齿轮 |

没跟：
- 快捷键面板新增「上一条 / 下一条未解决的评论」（PR 评论）。Codex 没有。
- 「下一个 / 上一个会话」在 `xe()` 为真时不列 Ctrl+Tab（c518a31cc `Ce`）。`xe()` 含 GrowthBook 开关 `__gb__320800483`。用户本机 2026-10-25 读到为开，所以现在做成了设置 → 通用 → 外观 →「Ctrl+Tab 切换最近会话」，默认开：Ctrl+Tab 打开最近会话切换器（c4681072f HistorySwitcher），快捷键表另列「在最近打开的项之间切换」，下一个 / 上一个会话不再列 Ctrl+Tab。关掉开关时恢复原来的列法。
- 回退确认（cc43287c9 `_7` → `nle`）在有文件可恢复时显示「N 个文件 · +N −N」。codex-ui 的回退只截断对话、不还原文件（走 `none` 分支），没有这一行。
- 行里 Artifact 类型图标的新写法（ce8be540f 的 `palette` 上下文）。Codex 没有 Artifact。

复测（mock 预览，同样用 iframe 加 rAF 垫片启动）：
- Ctrl+K 打开搜索面板，筛选条件选「操作」，输入「设置」。「设置 → 使用情况」的图标码位是 `e130`（UsageGaugeMiddle），其余设置行是 `e0d6`（Settings）。
- 在面板里连按三次 ↓，`scrollIntoView` 三次收到的参数都是 `{block: "nearest", behavior: "instant"}`。

校验：`pnpm typecheck` 0 错误，`pnpm test` 341/341，`claude-css.mjs --check --claude <3.1623.0>` 通过。`desktop/palette-smoke.test.mjs`（Electron）通过。改动未提交。

### 设置（2026-10-23）

比对范围：
- 设置弹窗：外框、侧栏、导航行、分组、窄屏形态。
- 设置搜索。
- 行、分区与深链高亮。
- Codex 页（对应真机「Claude Code」页）、此电脑 → 系统页。
- 连接器列表与状态。
- 插件详情与分享。
- 登录页。

做法：
- 从 `Settings.tsx`、`SettingsCustomize.tsx`、`SettingsConnectors.tsx`、`settings.ts`、`plugins.ts`、`settings.css` 取出约 60 处引用，补上提取漏掉的 `Uk`（侧栏）、`qk`（导航行）。
- 照前几轮的办法比函数（同 chunk 配对、跨 chunk 匹配、按文案 id 定位）。
- c71860c77 在两版里都按设置页拆成几十个文件，按文案 id 重合度配对文件后再比。新版基准仍是 `F:\REA` 的 3.1623.0。

结论：
- 以下两版一致：
  - 侧栏 `Uk` → shared-46 `Ch`（只多了 `panels` 分支）、导航行 `qk` → `Ah`、分组 `Nw` / `Pw` → `zm` / `Bm`。
  - 行与分区（shared-1 `gx` / `xx` / `hx`）、连接器状态（2.42304 `Ko` → 3.1623 `Oo`，只多了管理员分配的两种情况）、登录起始页（`xm` → `of`）。
  - 分享对话框（c5e7d44b0）、插件详情的已有部分。
- 设置弹窗的根组件挪到了 shared-46（`Kh`），外框是 shared-19 `eg`。
- 「Claude Code」页（2.42304 `c71860c77-Bl2Tfe3A`）的行拆到了 `c71860c77-DUrdZF0U` 和新的 c8b630735。只有「插件」一行（「管理 Claude Code 插件、代理、钩子和连接器」）被删掉，codex-ui 本来就没有这一行。

已改：

| 项目 | Claude 3.1623（出处） | 原来的 codex-ui |
| --- | --- | --- |
| 窄屏（≤767px）的设置弹窗 | 不再用设置专用外框，改成普通对话框（shared-46 `Kh` → shared-19 `eg` 的 `stacked` 分支）：<br>· `Dialog.Popup size="lg" fullHeight`：宽 720，满高减去对话框边距，弹层底色，`shadow-panel-lg`，整体在 `p-xl` 内容区里滚动并带渐隐<br>· 顶部是对话框标准标题「设置」和关闭按钮<br>· 下面是一条 `pb-md` 的标签条（shared-46 `Lh` / `Rh`：`-mx-px px-px`、`scroll-fade-x`、不显示滚动条）<br>· 页面自己不滚动、不加左右内边距（cc011544b `jn` 的 `popupScrolls`） | 沿用 2.42304 的窄屏写法（shared-19 `Zk` / `Qk`）：设置外框，加 surface-1 底的自定义标题栏（15px 中粗），标签条在 12px 内边距里、底部一条分隔线，页面仍自己滚动 |
| 设置搜索的「另有 N 项」 | 除「Skills / 连接器 / 插件」三个自定义页外（shared-156 `lh`），点它不再跳页，而是在结果里就地列出该页的全部匹配，焦点留在搜索框，并用 `role="status"` 宣读「正在显示 {section} 中的另外 {count} 个匹配项」（`X9YCIEhPuo`）。清空、按 Tab、或搜索词实质变化时收回（cc011544b、`pn` 的 `n?.has(id) ? 全部 : 3`） | 一律关掉搜索并跳到该页 |

窄屏的做法：把设置专用外框的规则（尺寸、surface-2、隐藏标题、绝对定位的关闭按钮、内容区不滚动）限定在 ≥768px，窄屏回落到 codex-ui 的通用对话框（「令牌与原子组件」一轮已按 CDS Dialog 对齐），再补满高、宽 720、页面不自滚这几条。侧栏导航的 `scroll-fade-y` 换成两个方向都管的 `scroll-fade`：桌面上它只纵向溢出，效果不变；窄屏横向滚动时有两端渐隐。

没跟：
- 登录页的「使用您的 Claude API 账户」/「使用其他方式登录」/「设置 Bedrock、Vertex AI、Foundry 或网关」，以及几条失败提示（c632c9594 `Sm` → `sf`）。它们要桌面端提供 `showApiKeySignIn`，还要配置里明确允许 API 登录，普通用户在两版里都看不到。codex-ui 的「或使用 API 密钥登录」是给 Codex 的 API 密钥登录做的对应，保持不变。
- 「Claude Code」页新增的云环境、安全机制触发时自动切换模型。Claude 专有。
- 「此电脑 → 系统」页存储占用的「计算时间 / 正在刷新 / 将在进行中的操作完成后停止」。codex-ui 的系统页没有存储占用。
- 插件详情新增的插件设置表单（「需要设置」、必填字段、已保存的值）。Codex 插件没有这类设置项。
- 新版分享面板（share-sheet，c0ad2fd1b `Vt`）里「停止共享」的确认。codex-ui 画的是经典分享对话框（c5e7d44b0，两版文案相同），离开组织范围时也已先确认。
- 设置行可见性新增的电脑操作、账单条件（ca25db325 `O`）。

复测（mock 预览，iframe 加 rAF 垫片）：
- 700 宽打开设置：
  - 对话框 655 × 768，白底、圆角 12、大阴影，整体纵向滚动。
  - 标题栏内边距 24 / 24 / 12，标题「设置」22px 半粗，右上是关闭按钮。
  - 标签条紧接标题栏，下方 12px，带横向渐隐遮罩。
  - 页面内容从左右 24px 处开始，自身内边距为 0、不滚动。
- 1280 宽：外框仍是 1004 × 753，关闭按钮绝对定位在右上，标题视觉隐藏，页面内边距仍是 8 / 24 / 16。
- 设置搜索输入「记忆」得到三条匹配和「另有 1 项」。点它后：
  - 原位换成第 4 条「从会话生成记忆」。
  - 读屏宣读「正在显示 记忆 中的另外 1 个匹配项」。
  - 焦点仍在搜索框，当前页仍是「常规」。
  - 改搜索词后恢复成「另有 1 项」，宣读清空。
- 复测中途 Vite 给的 `settings.ts` 是浏览器缓存里的旧版本，重建 iframe 后重测通过。

校验：`pnpm typecheck` 0 错误，`pnpm test` 341/341（`settings.test.mjs` 补了展开后列出全部匹配的断言），`claude-css.mjs --check --claude <3.1623.0>` 通过。改动未提交。

### 标题栏（按用户截图对照 3.6556，2026-10-23）

用户给了一张截图，上下两条分别是 codex-ui 和本机 Claude（此时已更新到 3.6556.2）的标题栏，要求统一。逐项对照了 3.1623.0 与 3.6556.2 的打包代码：外框标题栏 shared-22 `ML` → `eR`、菜单按钮 shared-1 `lG` → `nK`、箭头 shared-20 `Zf` → `Cm`、窗格开关 cc43287c9 `fW` → `PW`、开关表 c73f45bc3 `mv` → `x_`、溢出菜单 `zv` → `K_` 及其菜单正文 cf74bc599 `iA` → `DA`。它们在两版里类名和文案都相同，所以下面几处都是 codex-ui 原本就有的偏差，不是 3.6556 的新改动。

已改：

| 项目 | Claude（出处） | 原来的 codex-ui |
| --- | --- | --- |
| 菜单、侧栏开关的图标 | 按钮拿到的是 `size="sm"` 的 Icon，在任何按钮里都固定 16px；返回 / 前进传的是图标名，按按钮尺寸画成 20px（lG、ML、Zf） | 四个图标都被按钮的 `--btn-icon` 放大成 20px |
| 窗格开关的顺序 | 终端、更改、浏览器（`preview`，桌面端显示为「浏览器」）、文件（`mv` / `x_`：`[...终端, 更改, ...preview, ...ios, ...android, ...file]`） | 文件排在浏览器前面 |
| 标题栏末尾的 ⋮（查看选项） | 溢出菜单在会话支持「保持唤醒」时就显示（`K_`：`keepAwake !== undefined`），本地会话在桌面端都满足，所以一直在。菜单里，折叠的窗格之后隔一条线，是「保持计算机唤醒 / 仅限本次会话」（`CapHOIPauL` / `SWSZIzLoC3`）：一个带开关的复选项，点它菜单不关（`keepOpen`） | 只在有折叠项、后台任务或计划时才出现，也没有这一项 |
| 按会话保持唤醒 | 会话的 `manualKeepAwake` 打开后，即使会话空闲也算一条唤醒请求，只受组织策略约束，与「工作时保持唤醒」和电池设置无关；会话归档、切换账户时清除，并随会话保存（app.asar 主进程 `ue` / `de` / `fe`、`CU`） | 只有全局的「Codex 工作时保持计算机唤醒」 |

实现：
- store 的 `keepAwake` 按会话 id 保存在 localStorage（`codex-ui:keep-awake`）；收到 `thread/archived` / `thread/deleted` 时清除。
- App 用新的 `holdAwake(n)` 把开着的会话数报给桌面壳。
- 主进程 `syncKeepAwake` 在 `manualAwake > 0` 时直接保持唤醒，不看全局设置和电池。

没跟：Claude 标题栏左侧的「对话 / 代码」切换。Codex 只有代码模式。

复测（mock 预览，iframe 加 rAF 垫片和 `codexDesktop` 替身，根节点加 `data-wco`）：
- 外框标题栏：菜单、侧栏开关 16px，返回 / 前进 20px，按钮仍是 28px。
- 会话标题栏的顺序是 隐藏会话栏、终端、更改、浏览器、文件、查看选项。
- 打开查看选项：后台任务、分隔线、「保持计算机唤醒 · 仅限本次会话」。
  - 点它后变为选中，开关打开，菜单保持打开；桌面壳收到 `holdAwake(1)`，localStorage 是 `["t-1"]`。
  - 再点一次收到 `holdAwake(0)`，记录清空。
- 主进程的阻止休眠没有在 Electron 里实测，只跑了语法检查；归档时清除的路径只过了类型检查。

校验：`pnpm typecheck` 0 错误，`pnpm test` 341/341，`claude-css.mjs --check --claude <3.1623.0>` 通过，`node --check` 检查 `main.mjs` / `preload.cjs` 通过。改动未提交。

### 选择环境（按用户截图，2026-10-23）

用户截图是新会话页「选择环境」打开的菜单：标题「环境」，每行列出环境的全部源文件夹路径，列表很长、出现带箭头的滚动条，弹层向上盖住了启动卡片。对照的是 3.1623.0 的环境选择器 cc43287c9 `P8`（3.6556.2 为 `N8`，文案 id、testid 和类名都相同），以及它的行 `z6`（`m8`）、「本电脑」行 `y8`（`uoe`）、新建环境行 `V6`（`zae`）、环境栏 `cie`、文件夹菜单 `F8` 和可搜索弹层 shared-frame `yT` / `HC`。启动卡片的「选择环境」（`Uae`）打开的就是这个选择器，锚在该行下方、起始对齐（`popupSide: "bottom"`、`popupAlign: "start"`）。

已改：

| 项目 | Claude（出处） | 原来的 codex-ui |
| --- | --- | --- |
| 弹层 | 可搜索弹层，最小宽 260，强制紧凑密度；顶部是无边框、无底色、无焦点环的搜索框「搜索环境…」，下面一条贯通全宽的细线（`yT` 页眉、`HC`、`fe density="compact"`） | 固定宽 320，跟随锚点密度，没有搜索 |
| 分组 | 只有「本地」一组：「本电脑」、最近用过的 1 个环境（`C8`/`Cn = 1`）、「更多」子菜单（Laptop 图标，右侧是其余数量，子菜单最小宽 220，`D8`），然后分隔线和「新建环境」（`V6`，Add 图标） | 「环境」组列出全部项目，再接「最近」文件夹、打开文件夹、新建环境和项目管理项 |
| 环境行 | 只有 Laptop 图标、名称和单选勾；行高亮时末尾出现 Settings 键（c227f4d5e `gQ` / `hQ`：图标大小、圆角 4、muted，悬停填 alpha-2），→ 键同样打开设置，读屏附「，编辑环境，右方向键」（`vQ`） | 名称下面逐行列出所有源文件夹路径 |
| 搜索 | 有查询时平铺匹配的「本电脑」和环境，没有匹配时显示「没有匹配项」（`N8` / `k8`：footnote、muted、pad md / sm） | 无 |
| 文件夹 | 「本电脑」时环境胶囊后面另有文件夹胶囊（`cie` 的 `environment-bar-folder`，Folder 图标，title 为路径，读屏「文件夹：{路径}」；排在环境胶囊后，收缩速度是它的 3 倍，`y6` `shrink-[3]`），打开 `F8`：「最近」最多 8 个文件夹，只显示名称，完整路径放在 title，同名时下面加父目录；当前文件夹不在其中就排在最前；然后是「打开文件夹…」。超过 8 个时出现「搜索文件夹…」，回车打开第一个匹配，没有就打开文件夹对话框 | 文件夹放在同一个菜单里，显示完整路径，悬停有移除按钮 |
| 环境胶囊 | 名称是环境名或「本电脑」；提示「Codex 的运行位置」（真机「Claude 的运行位置」）；读屏「环境：{名称}」 | 名称是项目名或文件夹名，提示是工作目录 |
| 编辑环境 | 标题「编辑环境」；页脚两端对齐，左侧是 ghost 红字「删除环境」，确认框「删除环境？」/「“{name}”将被删除。从该环境启动的会话将保留。此操作无法撤销。」/「删除环境」（ca690a791） | 标题「环境设置」；重命名、删除放在环境菜单里，删除确认写「删除项目？」 |

Codex 与 Claude 模型不同的地方：Codex 中，位于某个项目源文件夹内的文件夹会按该项目运行。所以文件夹菜单只列出不属于任何项目的文件夹；选「本电脑」时，切到这类文件夹里最近使用的一个，没有就打开文件夹对话框。

没跟：
- 「已收藏」组和行尾的星标。
- 数字快捷键（`E6` chords）。
- 云端、Remote Control、SSH、WSL 分组。
- 原先「最近」行的移除按钮（真机 `F8` 没有），以及它保存的移除记录。

文案取自 zh-Hans：`FNP5kSfpMQ` 搜索环境…、`MpsZ34EpZH` 本地、`Red8UM0oCv` 本电脑、`Lm50vatbmX` 更多、`YxxUA60sT0` 新建环境、`96GJ5wSQam` 没有匹配项、`1KBnKkGDBN` ，编辑环境，右方向键、`LAJFKqmd8k` 环境：{value}、`hSyWJr4x1N` 文件夹：{value}、`8tJfYE1sr+` 选择…、`iXpep1vGVo` 最近、`YzhKoa+aW/` 打开文件夹…、`biG+krWPOa` 搜索文件夹…、`cfNkVEwvig` 编辑环境、`sfqLM7DbXw` 删除环境、`1sJ0FTOE0U` / `Gf0ChGzaZb` 删除确认。

复测：mock 预览加 7 个与截图相同的项目（其中「codex」有 3 个源文件夹，「ntfy_bark」也有 3 个），内置浏览器 iframe 加 rAF 垫片，截图用无头 Edge。
- 「选择环境」：菜单 260 宽，在该行下方打开；紧凑密度，行高 24。
  - 内容依次是：搜索框（获得焦点）、细线、「本地」、本电脑、codex ✓、更多 6、分隔线、新建环境。
  - ↓ 进入第一行；Home / End 留在搜索框里。
- 搜索：「bar」得到 ntfy_bark、Bark；「电脑」只剩本电脑；「zzz」显示「没有匹配项」。
- 「更多」：子菜单宽 238，列出其余 6 个环境。在其中一行按 → 打开「编辑环境」。
  - 编辑框左下角是红字「删除环境」，点它弹出「删除环境？」确认框，取消后关闭。
- 胶囊菜单：从输入框下方的环境胶囊打开时空间不够，向上翻开。
  - 当前文件夹在「codex」项目里，而且没有项目外的文件夹，所以选「本电脑」打开文件夹对话框。
  - 切到项目外的文件夹后，胶囊变成「本电脑 · 📁 scratch」，文件夹胶囊的收缩系数为 3。
  - 它的菜单是「最近 / scratch / 打开文件夹…」，宽 128。

校验：`tsc --noEmit` 0 错误，`pnpm test` 341/341，`claude-css.mjs --check --claude <3.1623.0>` 通过。改动未提交。

### 窗口拖动（2026-10-23）

用户反馈桌面版窗口拖不动。用独立 Electron 探针复现：和桌面壳一样隐藏标题栏，开 overlay，用真实 preload，缩放 1.2，加载开发页面；再对窗口逐点发 `WM_NCHITTEST`（进程设为按显示器 DPI 感知，坐标按物理像素换算）。结果整条 36px 标题栏都返回 HTCLIENT，没有一处是 HTCAPTION。只有打开对话框、设置或命令面板时能拖，因为那时 `.dialog-drag-strip` 排在最后。

原因：
- Chromium 里 `app-region` 是继承属性。窗口的拖动形状按 DOM 顺序叠加每个带 region 的盒子：drag 并入，no-drag 减去。
- 3.1623 的外框根节点是 `dframe-root draggable-none`（shared-22，Claude 也是如此）。它的 `main.dframe-content` 覆盖整个窗口、包括顶部 36px，继承了 no-drag，又排在 `.dframe-chrome-bar.draggable` 之后，于是把整条标题栏减掉了。
- Claude 不受影响：c6a992d55 的基础规则 `*{…;app-region:initial}` 给每个元素重置了这个属性，只有显式设了 `.draggable` / `.draggable-none` 或可交互元素的盒子才算 region。codex-ui 移植 3.1623 外框时（545d255520，1.2.20 起的安装包）漏了这条。

改法：`base.css` 的 `*` 规则加上 `app-region: initial`，与 c6a992d55 相同。可交互元素的 no-drag 仍按原来的做法，只限定在标题栏、会话标题栏和窗格头部内，见「三 · 与真机不同的地方」。

复测（命中图：`#` 可拖，`.` 不可拖）：
- 首页：标题栏除菜单、侧栏开关、返回 / 前进和右侧按钮外都可拖。系统按钮仍是按钮。标题栏下方只有 5px 的会话区拖动带可拖，侧栏不可拖。
- 会话页：会话标题和各个窗格开关不可拖，它们之间的空隙可拖。
- 侧栏收起：同上，标题栏下 5px 拖动带横贯全宽。
- 打开对话框、设置或命令面板时，整条标题栏可拖。
- Quick Entry 窗口（quick.html）的 drag / no-drag 次序本来就对，没有改。

校验：`tsc --noEmit` 0 错误，`pnpm test` 341/341，`claude-css.mjs --check --claude <3.1623.0>` 通过。改动未提交。

### 点选后台任务后界面上移（2026-10-23）

用户截图：在会话里点选后台任务后，除侧栏和标题栏外，整个内容区上移了约 106px。转录文字跑到标题下面，后台任务窗格的头部移出窗口，第一条任务顶到窗口上沿。

原因：
- 会话栏后台任务卡里的任务行会调用 `openBackgroundTask`，窗格随后把该行 `scrollIntoView({block:"start"})`。Claude 的任务窗格也是这样做的（cccc2cf0a，`[data-task-id]` 行 `block:"start"`）。
- `scrollIntoView` 会滚动途经的每一个滚动容器。外框的 `main.dframe-content` 设的是 `overflow: hidden`（shared-styles 原样），而 `hidden` 仍可以被脚本滚动。
- 在 Claude 里它的内容不会超出边界，可滚动余量为 0；codex-ui 里只要有东西伸出窗口底边，这段余量就会被拿来把整页往上推。mock 里伸出的是输入框底栏 `.chin`（2px），用户的会话里伸出了更多。
- 复现：mock 会话 t-2 打开后台任务窗格并聚焦任务 → `main.dframe-content.scrollTop` 为 2。在 `.main` 底下多放 200px 溢出后再聚焦，滚动量是 106px，和截图一致。

改法：
- 外框内容列 `.dframe-root > .dframe-content` 改为 `overflow: clip`（shell.css）。绘制效果与 `hidden` 相同，但不是滚动容器，`scrollIntoView` 和聚焦都推不动它。
- 同类问题：窗格 `.pane`、`.pane-body` 和浮层会话栏的 `.rail-surface` 本身也不滚动，同样改为 `clip`。这样窗格里的 `scrollIntoView`（更改、文件、后台任务）不会再把窗格内容推到头部底下，会话栏「记忆」开关的 `scrollIntoView` 也推不动浮层。

复测（内置浏览器 iframe，加上同样版本的 Electron 窗口，WCO + 1.2 缩放）：
- 聚焦任务：滚动的容器为 0 个，任务行保持在原位置（y=106）。
- 加 200px 溢出再 `scrollIntoView`：`clip` 下仍为 0 个；把 `hidden` 临时换回去，`main.dframe-content` 上移 105.8px。

校验：`tsc --noEmit` 0 错误，`pnpm test` 341/341，`claude-css.mjs --check --claude <3.1623.0>` 通过。改动未提交。

### 后端（2026-10-23）

这一类不比 Claude，比的是 Codex 后端与 codex-ui 是否对得上，共五项：
1. 按分叉 HEAD 重新清点协议。
2. 核对通知的处理与退订。
3. 核对桥接层依赖的 Codex 数据格式。
4. 按 AGENTS.md 审查分叉自增能力的门控。
5. 反查前几轮记下的需要后端配合的功能。

**1. 协议清点**（第「二」节已按新结果更新）：
- 名单没变：客户端方法 175 个（实验 67），通知 87 个。
- 服务端请求从 11 个变成 9 个：v1 遗留的 `applyPatchApproval`、`execCommandApproval` 已从协议删除。
- 分叉没有自增方法，与分叉点 ce0323f2f2 和原生 0.163.0 的名单都相同。
- 用到的方法从 116 个变成 120 个，原文档记漏了 4 个：
  - 会话栏拉取请求卡的 `thread/attachment/add`、`thread/attachment/remove`。
  - 只读 `gh pr view` 与 git 快照用的 `command/exec`。
  - 桥接层取令牌的 `getAuthStatus`。
- `schema_fixtures` 测试通过，说明 codex-ui 编译所用的 TS 类型与 Rust 源码一致。`ThreadItem` 的 19 种条目，codex-ui 都有处理。
- 上游 openai/codex 在分叉点之后新增了 `feedback/save`、`thread/memory/read`、`thread/sample`、`thread/sample/cancel`。要等分叉合入上游才能用，本轮不做。

**2. 通知**：`guardianWarning` 从 0b9b838450 起就有意不进转录，但一直没有退订，现在加进 `initialize` 的退订列表（`OPT_OUT`）。在临时 CODEX_HOME 下对真实 codex 0.163.0 做 `initialize`，服务端接受这份列表。

**3. 桥接层**：
- 上下文明细的估算（`server/context-usage.mjs`）落后于 Codex 的 `history.rs`，现在按它改正：
  - `estimate_response_item_model_visible_bytes`：
    - `agent_message` 计作者、收件人和正文（加密内容按 9/16）。
    - `function_call_output` 加上 namespace。
    - `tool_search_call`、`local_shell_call`、`web_search_call` 只计各自参数的 JSON。
    - `image_generation_call` 按一张缩放图片加修订提示词计，不再把整段 base64 算进去。
    - `configuration_update`、`compaction_trigger` 与未知类型计 0。
    - 原图细节的文件图片按 10,000 个 patch 计。
  - `is_model_generated_item`：首个请求在第一个模型生成条目处结束，不再在 `agent_message`、配置更新或工具输出处提前截断。
- 用本机最近 40 份会话记录对比新旧结果：5 份不同，全是子代理会话。原因是首个请求里父代理发来的 `agent_message` 被当成了输出，“系统工具”一项虚高（例如 17,833 → 3,403）。新增的测试在旧代码上失败（工具 504，应为 500）。
- 其余接口（额度、cc-switch、听写、PDF、文件）依赖的 `model_provider` / `model_providers.<id>.base_url` 和 `getAuthStatus` 都还在。

**4. 门控审查**。逐个看了分叉在 codex-rs 下的 17 个提交，按能力归类。总开关本身没有问题：
- `CODEX_UI_EXPERIMENTAL_BACKEND` 只在 `core/src/config/mod.rs` 读一次，值必须严格等于 `"1"`。
- 不是 config.toml 的键，`CODEX_BIN` 和版本号也不参与判断。

以下能力在工具声明、运行时入口和自动调度三面都已门控，启用、禁用、禁用时直接请求三类测试也都有：后台完成唤醒、yield 引导、回合准备耗时、Windows 上的 Git Bash、连接器发现与工具加载、`backgrounded` 字段、git attribution 预取、skills 渲染快照复用。

找到并处理了五处缺口：

| 缺口 | 处理 |
| --- | --- |
| 命令用途 `description`（52ab00e6f5、fd5e4bbc8e、a240629ccd）完全没有门控：禁用时 `exec_command` 仍声明这个必填参数，运行时照收，并写进 CommandExecution、Begin/End 事件和审批 | 只在实验型后端声明（`required` 也跟着变）；禁用时模型照传也会在入口丢弃。测试：`shell_spec_tests::experimental_backend_controls_command_description`；禁用时的规格恢复为上游原样；启动失败测试分成 `native_drops_description` / `experimental_records_description` 两种；原生下的远程进程事件断言 `description` 为空 |
| 协议 `ConfiguredHookHandler.asyncRewake` 在禁用时也会输出 | 值为 false 时不输出（`skip_serializing_if`，和上游同类布尔字段一样），TS 类型变为 `asyncRewake?: boolean`，重新生成了 schema 夹具，Python SDK 类型照生成器格式手改（本机没有 `uv`）。仍然存在的情况：托管配置显式写了 `asyncRewake: true` 时会原样报告；Hook 引擎在禁用时本来就忽略它 |
| Hook 信任哈希在禁用时也算入 `asyncRewake`，原生忽略这个键，导致原生已信任的 Hook 变成“已修改” | 禁用时归一化为 false 再算哈希。测试：`discovery::tests::async_rewake_counts_toward_the_trust_hash_only_when_enabled`。测试辅助 `trust_discovered_hooks` 跟着按 `config.experimental_backend` 算哈希，`background_wakeup` 里三处配置改为先设开关、再信任 Hook |
| 工作区版本号 `0.164.0-alpha.3+codex-ui`（3b14787cf1）由构建决定，不随开关切换 | 按用户决定登记为例外，写进 AGENTS.md：这是为移动端 Remote 兼容设置的构建身份；连带变化（本地构建不再强制把凭据存为文件、上报的客户端版本）一并接受 |
| 后台唤醒提交（5c69cc11e5）顺带改了原生回合调度 | 按用户决定全部门控：续跑的准入检查与预留输入、带预留的启动、登记时被替换后放弃、邮箱改在锁内取出、关停中拒绝续跑、命令结束事件等待首次调用收尾，在禁用时都回到上游路径。`wake_reservation` 的 `task_registration` 用例改在实验型后端下跑，`context_construction` 仍按原生跑。只在存在后台唤醒输入时才起作用的部分（取消唤醒、`has_waking_input`、Stop Hook 标记）在禁用时与上游一致，没有另加分支 |

分叉改过的 42 个场景快照里，7 个只差在 `exec_command` 多出的 `description` 参数上，35 个只差在工具定义哈希上。修复后按禁用状态重新生成，42 个全部回到与分叉点 ce0323f2f2 逐字节相同，场景快照不再有分叉差异。

**5. 需要后端配合的功能**：只有一项，Claude 会告诉模型“文件已在面板显示”（浏览器面板自动打开写入的文件时）。3.6556 的主进程代码（`jk`）里没有看到这类通知，所以只记为候选，没有做。

**校验**（Windows，`cargo nextest`，`RUST_MIN_STACK=8388608`）：
- core 集成（场景、启动失败、`wake_reservation`、`background_wakeup`、`unified_exec`）：167 项，166 通过。
  - 唯一失败的 `incremental_tools…::responses_lite` 在 HEAD 上同样失败。
  - 单跑场景是 99 通过、4 失败，与 10-20 的记录一致：另外 3 个是 astra 插件/技能场景，本机路径和权限文本不同，HEAD 上就失败，快照保持原样，没有接受。
- core 单元（`shell_spec`、`unified_exec`、`tasks::`、`turn_input`、`async_watcher`、`input_queue`）：121 项，116 通过。
  - 5 项失败都是 `turn_completion_metrics_follow_model_switch`，换回 HEAD 源码同样失败。
- codex-hooks：179 项，172 通过，新增的信任哈希测试通过。
  - 7 项失败都是实际起进程的 `command_runner` / engine 用例。只把 `discovery.rs` 换回 HEAD 再跑，同样 7 项失败，属于本机环境问题，与本轮改动无关。
- codex-app-server-protocol：316 项全部通过，含 schema 夹具一致性检查。
- codex-ui：tsc 无错误，`node --test` 342 项全部通过，`claude-css.mjs --check` 通过。
- 两个本机测试的坑：
  - 上游测试库把 `INSTA_WORKSPACE_ROOT` 设成 `\\?\D:\…`，insta 在 Windows 上读不了，快照被静默跳过。必须显式设成普通路径 `D:\Visual_Studio\codex\codex-rs`，快照才会比较。
  - 做基线对照时用 `Copy-Item` 恢复文件会保留旧的修改时间，cargo 因此不重新编译，跑的仍是 HEAD 代码。恢复后要刷新时间戳。本节结果是刷新后重跑的。

## 五、4.4212 复核（2026-11-02）

对照物换成本机 macOS 的 Claude 4.4212.0（`/Applications/Claude.app`）：渲染层是 `Contents/Resources/ion-dist.asar` 的 `assets/v1`，主进程是 `app.asar` 的 `.vite/build/`（`ccd_*` 工具在 `index.chunk-BReS2dO4`，内联可视化在 `index.chunk-BBu5cdqa`，定时任务在 `index.chunk-BAxsXeW6`）。仍是只读静态分析。基线按用户本机实际开着的形态，不再限于「开关全关」。不做的范围：iOS/Android 模拟器、computer-use、浏览器窗格模式的工具，以及 Claude 专有服务（Remote Control、Output style、MCP 目录、迁到云端、Artifacts）。

### 缺口与处理

| 区域 | 4.4212（出处） | codex-ui |
| --- | --- | --- |
| 会话管理工具 | `ccd_session_mgmt`：列出 / 查看 / 搜索会话与事件、归档、停止、删除、改模型 / 强度 / 权限 / 快速模式、用量、导出 | `context/manage-tools.mjs`；`set_session_title`、`send_message` 扩到其他会话，不另建同名工具。`clear_session` 没有对应的 Codex 接口，不做 |
| 侧栏、视图、窗口工具 | `ccd_sidebar`（`W_`）、`ccd_view`（`Ov`）、`ccd_window`（`Db`） | 分组的增删改与归入、置顶、未读、标记为已完成、侧栏视图、关闭面板、对话记录视图、折叠侧栏。`*_section` 属 presets 布局，不做 |
| 连接器、定时任务工具 | `ccd_connectors`（`tt`）；`list_scheduled_tasks` 一组 | 三个连接器工具；`automation_update` 加 `run` / `runs` 两个 mode，不另建工具 |
| 本机与文件夹工具 | `ccd_host`（`Eu` / `Dc` / `Ls`）、`ccd_directory`（`Qo`） | `context/host-tools.mjs`：在编辑器中打开、在访达中显示、保持唤醒、存储用量、清理工作树、请求目录、换目录 |
| 内联可视化 | `visualize`（`getImagineServerDef`）；渲染 c96d752d0 `qX` | `show_widget` / `read_me`。指南是 codex-ui 自己写的（Claude 的不随仓库发行），全部模块约 12 KB，低于 Codex 1 万 token 的工具输出截断。`read_widget_context` 没核实到小组件侧接口，不做 |
| 文件面板 | c9bd7af9c 文件树与 `?` 搜索；c0a74d72b `Pi` / `Oi` 编辑 | 文件树、内容搜索（rg）、面板内编辑。编辑器是 textarea，不引 CodeMirror；唯一的写入口 `codexUi/files/write` 校验路径与哈希 |
| 更改面板 | c9bd7af9c `Kw` / `OT`、cbbf81135、c44d00c7f `Nu` | 未提交 / 比较对象 / 提交三种范围、按文件夹分组、测试与生成文件分开、字词高亮、标记为已查看、行评论发给 Codex。「在更改中查找」与图片前后对比不做 |
| 输入框 | cc183b3ab 斜杠命令；c518a31cc、c227f4d5e 快捷键；c4a9ee384 `Td` 附件 | 斜杠命令 `/copy` `/cd` `/add-dir` `/theme` `/help` `/tasks` `/autocompact` `/resume` `/storage` `/btw`，以及仅 Windows 有的 `/sandbox`；Ctrl+R、Ctrl+Enter、Ctrl+Alt+Enter；任意文件附件（Ctrl+U）；长粘贴占位 |
| 侧边聊天 | cc183b3ab `btw`；ca2ef848d 浮层；c9bd7af9c 多标签 | 每个会话一个浮层，在临时只读分叉里回答，可追问、清除、在新会话中继续。Claude 代码标签页的多标签与固定不做 |
| 转录与终端 | c966e2bd9 ANSI；c19e90103 `n_`；c9bd7af9c `Q2jUneEhyD` | ANSI 着色、代码块在终端中运行、选择 shell、拖动排序、拖入文件插路径、关闭确认。溢出菜单与键盘重排不做 |
| 侧栏与设置 | ce4f4374c `J2D0+ihfKQ` / `Pe`、cb63ed069、cbc28252c、c71860c77 存储 | 标记为已完成、打开方式、移到顶层、Ctrl+数字提示、行菜单导出与视图、代码字号、工作树位置、命令面板设置项、存储页。分支前缀不做（codex-ui 建工作树用 `--detach`） |

### 门控与信任边界

- 新的模型工具都挂在 `codex_ui_desktop` 上，随 `desktopEnabled`（实验型后端且 desktop UI）门控。`server/desktop-tools.test.mjs` 对每组都测了三种情形：启用时列出、禁用时为空、禁用时直接调用被拒且不到页面。侧边聊天、附件等只用原生 app-server 接口的界面功能不涉及后端门控。
- 写盘与删除：`codexUi/files/write`（realpath 在会话目录内、普通文件、≤8 MiB、哈希一致）、`server/storage.mjs`（只删桶里的链接工作树，默认跳过有未提交更改的）都有测试。
- `/api/attachments` 单个 45 MiB，超出 413。
- `/widget-frame` 响应头 CSP 为 `sandbox allow-scripts`，不同源，只放行四个 CDN，`frame-ancestors 'self'`。页面只采信帧的高度，以及用户在帧内点击触发的 `sendPrompt`（每秒一次、≤4000 字）和 http(s) 链接。Electron 拒绝子帧的权限申请，子帧也不能导航出应用自己的页面。

### 校验

- `node --test`：945 项，940 通过，5 项跳过；`tsc` 与 `vite build` 通过。
- 浏览器（Vite dev）：斜杠菜单、会话行菜单、更改面板、文件面板的编辑与文件树、侧边聊天（实问一次；Esc、点外部、清除、在新会话中继续）。
- Electron（一次性脚本、透明窗口）：小组件的浅色与深色渲染、从 CDN 加载 Chart.js、localStorage 与外部 fetch 被拦、高度上报。内置浏览器面板会拦截子帧请求，那里测不了小组件。
- 没测：小组件里真实点击触发 `sendPrompt`（会真的发出消息）、打包后的桌面版全流程、Windows。

