# Claude Desktop 版本差异比对

对齐 Claude Desktop 新版本时用：比较两个版本的 ion-dist 打包代码，检查 codex-ui 源码注释里引用过的 Claude 函数在新版里有没有变化（类名、文案、常量、数组条目），再决定要不要移植。

脚本只读安装目录，输出全部写到临时目录，不会写进仓库。

## 准备

- Node 24（`zh-table.mjs` 要用 `zlib.zstdDecompressSync`）。`acorn` 按 Node 的模块解析规则从仓库的 `node_modules` 读取，它是传递依赖，被 hoist 到仓库根目录，`pnpm install` 之后就有。
- Python 3，只有 `arrdiff.py` 用到，用 `python -I` 运行。
- 环境变量：

| 变量 | 含义 |
| --- | --- |
| `CLAUDE_DIFF_A` | 旧版的 `ion-dist/assets/v1` 目录（必填） |
| `CLAUDE_DIFF_B` | 新版的 `ion-dist/assets/v1` 目录（必填） |
| `CLAUDE_DIFF_OUT` | 输出目录，默认是 `<系统临时目录>/claude-diff` |
| `CLAUDE_DIFF_ZH` | 文案对照表，默认是 `$CLAUDE_DIFF_OUT/id-en-zh.tsv`。没有这个文件也能运行，中文列会显示 `?` |

安装目录在 `C:\Program Files\WindowsApps\Claude_<版本>_x64__pzs8sxrjxfjjc\app\resources\ion-dist\assets\v1`。Windows 更新 Claude 后会删掉旧版目录，所以开新一轮比对前，先把旧版整个包复制出来，例如 `F:\REA\Claude_3.1623.0.0_x64__pzs8sxrjxfjjc`。

PowerShell：

```powershell
$env:CLAUDE_DIFF_A = 'F:\REA\Claude_2.42304.0.0_x64__pzs8sxrjxfjjc\app\resources\ion-dist\assets\v1'
$env:CLAUDE_DIFF_B = 'F:\REA\Claude_3.1623.0.0_x64__pzs8sxrjxfjjc\app\resources\ion-dist\assets\v1'
```

Git Bash：

```bash
export CLAUDE_DIFF_A='F:/REA/Claude_2.42304.0.0_x64__pzs8sxrjxfjjc/app/resources/ion-dist/assets/v1'
export CLAUDE_DIFF_B='F:/REA/Claude_3.1623.0.0_x64__pzs8sxrjxfjjc/app/resources/ion-dist/assets/v1'
```

下文的命令都在 `codex-ui/` 目录下运行，`$OUT` 指输出目录。

## 名词

- **chunk**：`assets/v1` 里去掉 8 位哈希后的文件名，如 `c227f4d5e-DhqumBwo.js` → `c227f4d5e`，`shared-5-DXoxd-Km.js` → `shared-5`（哈希里也可能有 `-`）。不同版本的哈希不一样，但 chunk 名通常保持不变。
- **引用**：codex-ui 注释里写的 `c227f4d5e bQ`、`shared-5 Kd / wg`、`` cc43287c9 `kP`, `Lp` ``，即 chunk 名后面跟顶层绑定名（压缩后的名字）。大部分引用是按 2.42304 写的；按 3.1623 重建的部分（侧栏、框架、开始卡片等）引用的是 3.1623 的名字，以 2.42304 为 A 时，这类引用在 A 列显示为 `-` 或 `nochunk`，B 列却有值。以后以 3.1623 为 A 比对更新的版本时，按 2.42304 写的引用要先用 2.42304 → 3.1623 的配对结果换算成 3.1623 的名字。

## 脚本

| 脚本 | 用法 | 作用 |
| --- | --- | --- |
| `cites.mjs` | `node cites.mjs <文件...>` | 从 codex-ui 源码里抽出全部引用，去重后按「chunk 名字」每行一条输出。会混进少量英文单词（如 `shell`、`up`），`exists` 那一步会把它们筛出来 |
| `exists.mjs` | `node exists.mjs <引用清单>` | 判断每个名字在 A、B 同名 chunk 里是不是顶层绑定，属于哪一种：`fn`、`class`，或常量初始值的节点类型（`Call`、`ArrowFunction`、`lit`、`Templatelit`、`Object`、`Array` 等），导出别名显示为 `export→本地名:种类`；`-` 表示不是顶层绑定，`nochunk` 表示该版本没有这个 chunk |
| `fnmatch.mjs` | `node fnmatch.mjs <chunk>[:<chunkB>] <名字...>` | 在 B 的同名 chunk 里（写成 `chunkA:chunkB` 时在另一个 chunk 里），按字符串字面量的 Jaccard 重合度给每个 A 函数找最像的 B 函数，并列出只在一侧出现的字符串。两边的函数体写到 `$OUT/<chunk>.<名字>.{A,B}.txt` |
| `anymatch.mjs` | `node anymatch.mjs <chunk> <名字...>` | 同上，但在 B 的全部 chunk 里找：先挑出含该函数文案 id 和长字符串最多的 3 个 chunk，再在其中配对。函数体同样写到 `$OUT` |
| `tokdiff.mjs` | `node tokdiff.mjs <chunk> <名字...>` | 读 fnmatch / anymatch 写出的函数体，列出只在一侧出现的类名词元和文案 id（`id:xxxxxxxxxx`）。字符串只是被合并或拆开的不算差异 |
| `sweep.sh` | `bash sweep.sh <引用清单>` | 按 chunk 批量跑 fnmatch + tokdiff，只打印配对结果、没配上的（`??`）和词元有变化的（`Δ`） |
| `idmatch.mjs` | `node idmatch.mjs <chunk> <名字...>` | 列出 A 函数用到的每个文案 id 现在位于 B 的哪些 chunk、哪个顶层声明里；`GONE` 表示新版已经不用这个 id |
| `uses.mjs` | `node uses.mjs <chunk> <导出名> [每个文件最多几处=4]` | 在 B 里找哪些 chunk 导入了该 chunk 的这个导出（导出名是 `export{本地名 as 导出名}` 里的后者），并打印上下文 |
| `around.mjs` | `node around.mjs <A\|B> <chunk> <字符串> [输出文件]` | 取出包含该字符串第一次出现位置的顶层声明，写到输出文件（默认是 `$OUT/around.txt`） |
| `constdiff.mjs` | `node constdiff.mjs <chunk> <名字...>` | 检查 A 的顶层常量（字符串、模板、对象、数组）在 B 同名 chunk 里是否有完全相同的源码（`${…}` 引用已屏蔽），没有就给出词元最接近的常量和两侧的差异 |
| `classes.mjs` | `node classes.mjs <文件>` | 按出现顺序列出一段代码里像类名的字符串，并带上左侧 40 个字符的上下文（属于哪个 prop 或调用） |
| `filetok.mjs` | `node filetok.mjs <a.txt> <b.txt>` | 与 tokdiff 相同，但直接比较任意两个文件（例如 around 取出的两段代码） |
| `copydiff.mjs` | `node copydiff.mjs <a.txt> <b.txt>` | 列出只在一侧出现的 `defaultMessage` / `id` 文案，附官方简体中文 |
| `arrdiff.py` | `python -I arrdiff.py <a.txt> <b.txt> <字符串>` | 从字符串所在位置开始按括号配对取出整个数组字面量，拆成 `{…}` 条目，打印只在一侧出现的条目（`when:` / `gate:` 的压缩名已屏蔽）。字符串必须恰好从数组的 `[` 开始 |
| `zh-table.mjs` | `node zh-table.mjs <Cache_Data> <ion-dist/i18n...>` | 生成文案对照表，见下文 |
| `lib.mjs` | — | 共享部分：环境变量、chunk 查找、acorn 解析、函数和词元提取 |

## 典型流程

以一个组件文件为例：

```bash
node scripts/claude-diff/cites.mjs src/components/Composer.tsx > "$OUT/composer-cites.txt"
node scripts/claude-diff/exists.mjs "$OUT/composer-cites.txt"
bash scripts/claude-diff/sweep.sh "$OUT/composer-cites.txt"
```

1. **抽引用**：用 `cites.mjs` 从要检查的源码文件里得到引用清单。
2. **exists**：A 列是 `-` 的，多半是注释里的普通英文或引用写错了，先核对注释。B 列显示 `nochunk` 说明该 chunk 在新版里被合并或拆分了。B 列显示 `-` 很常见，因为压缩名每个版本都不一样，不代表被删。
3. **sweep**：逐个看 `Δ` 行，它们是类名或文案真正变化的地方。`-> 名字 (1.00)` 且没有 `Δ` 的函数可以视为没变。
4. **复核低重合度和没配上的**：重合度低于 0.5 左右、出现 `?? no match` 或 `?? Error: no chunk … in B` 时，先用 `anymatch.mjs` 跨 chunk 查找，或用 `idmatch.mjs` 看它的文案 id 搬到了哪里。确定新位置后，用 `fnmatch.mjs <chunkA>:<chunkB>` 重新配对，再跑 `tokdiff.mjs`。字符串很少的小函数可能被错配到无关函数，即使重合度显示 1.00，也要用 idmatch 或 around 核对。
5. **常量**：exists 里种类为 `lit` / `Templatelit` / `Object` / `Array` 的，用 `constdiff.mjs` 检查。
6. **细看**：用 `around.mjs` 按文案 id 或类名取出两边的声明，再用 `classes.mjs`、`filetok.mjs`、`copydiff.mjs` 和 `arrdiff.py`（菜单项之类的数组）比较；用 `uses.mjs` 查新组件在哪里被用到。

## 已知坑

- **React Compiler 让函数体形状不同**：3.x 的组件经过 React Compiler 编译，多了 `$[n]` 缓存槽和 `J1($,…)` / `K1(…)` 之类的守卫，函数体结构和长度与 2.x 完全不同。fnmatch 的 `shape differs (… chars)` 基本没有参考价值，应以 tokdiff / copydiff 的词元和文案差异为准。另外，字符串是用正则抽取的，模板字符串多的函数会把两段字符串之间的代码也当作"字符串"，fnmatch 的 `-` / `+` 列表里出现的长代码片段都是噪音。
- **chunk 会合并或消失**：新版会把组件挪到别的 chunk，例如 2.42304 c227f4d5e 里 PR 菜单的 `review-changes` 在 3.1623 位于 c219730b0。遇到 `nochunk` 或 `no chunk … in B` 时，用 anymatch / idmatch 找到新位置，再用 `chunkA:chunkB` 配对。
- **输出文件会被覆盖**：fnmatch 和 anymatch 写的是同一组 `$OUT/<chunk>.<名字>.{A,B}.txt`，tokdiff 读到的是最后一次写入的内容。
- **Git Bash 的 heredoc 会吃反斜杠**：在 Claude Code 的 Bash 工具里，用 heredoc 或命令行直接传入含 `\n`、`\\`、`\u` 的字符串（比如 around / arrdiff 的查找字符串）时，反斜杠会被改写，结果就是找不到。应该先把命令写成脚本文件，再用 `bash 文件.sh` 运行。
- **耗时**：anymatch、idmatch、uses 会读入 B 的全部 chunk（约 3700 个文件），每次 1–2 秒。sweep 一个组件文件的引用清单（十几个 chunk，含 2 MB 以上的 c96d752d0）大约 5 秒。

## 文案对照表（id → 英文 → 官方简体中文）

copydiff 和 idmatch 用它给文案 id 标注中英文。表的内容是 Claude 的文案，**不要提交进仓库**，生成后放在 `$OUT`（或 `CLAUDE_DIFF_ZH` 指定的位置）。

Claude Desktop 安装包里没有简体中文的网页文案。Code 标签页的中文来自 `https://claude.ai/i18n/zh-Hans.json?v=<哈希>`，直接请求 claude.ai 会遇到 Cloudflare 验证，只能从 Claude Desktop 的 Chromium HTTP 缓存里读取。英文在 ion-dist 的 `i18n/en-US.json` 和 `i18n/dynamic/en-US.json` 里，按 id 合并后就是这张表。

```bash
node scripts/claude-diff/zh-table.mjs \
  "$LOCALAPPDATA/Claude-Data/claude_pzs8sxrjxfjjc/Cache/Cache_Data" \
  F:/REA/Claude_2.42304.0.0_x64__pzs8sxrjxfjjc/app/resources/ion-dist/i18n \
  F:/REA/Claude_3.1623.0.0_x64__pzs8sxrjxfjjc/app/resources/ion-dist/i18n
```

- 缓存目录默认在 `%APPDATA%\Claude\Cache\Cache_Data`。用户数据迁移过时在新的数据目录下，例如本机是 `%LOCALAPPDATA%\Claude-Data\claude_pzs8sxrjxfjjc\Cache\Cache_Data`。Claude 需要以中文界面打开过一次，缓存里才有这个文件。
- 脚本扫描 `data_1` 里的缓存条目，取 `v=` 最新的那份 `i18n/zh-Hans.json`，支持 br / zstd 压缩。
- 英文侧传两个版本的 `i18n` 目录，A、B 两版的 id 就都能查到。缓存里是当前线上网页版的中文，可能比两个 ion-dist 都新，所以只有旧版用到的 id，中文列可能为空。
- 每行格式是 `id<TAB>英文<TAB>中文`，缺失的一侧留空，换行写成 `\n`。
