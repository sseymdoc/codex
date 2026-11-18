// Run with `pnpm test` (Node >= 22.18 strips the TypeScript types of emphasis.ts).
// Expected renders are Claude 2.42304's Alluvium on the same text (c86867935 A; snapshot(false)
// for a reply still being written), as marked draws them.
import assert from "node:assert/strict";
import { test } from "node:test";
import { Marked } from "marked";
import { emphasis } from "./emphasis.ts";
import { frontier } from "./frontier.ts";

// markdown.ts needs a DOM (DOMPurify); render as renderBlocks does, with marked and emphasis.ts.
const marked = new Marked({ gfm: true }, emphasis);
const render = (text) => marked.parse(text).replaceAll("\n", "");
const streamed = (text) => {
  const { tokens, last } = frontier(text);
  const list = tokens.filter((token) => token.type !== "space");
  return list.map((token, i) => render(i === list.length - 1 ? (last ?? token.raw) : token.raw));
};
const shows = (draw, cases) => {
  for (const [text, html] of Object.entries(cases)) assert.equal([draw(text)].flat().join(""), html, JSON.stringify(text));
};

test("emphasis next to CJK punctuation or between Han characters pairs: only whitespace counts", () => {
  shows(render, {
    "这是**「重点」**和": "<p>这是<strong>「重点」</strong>和</p>",
    "用**“引号”**包起来": "<p>用<strong>“引号”</strong>包起来</p>",
    "和__下划线__。": "<p>和<strong>下划线</strong>。</p>",
    "**注意：**这里": "<p><strong>注意：</strong>这里</p>",
    "*「斜」*和**「粗」**": "<p><em>「斜」</em>和<strong>「粗」</strong></p>",
    "前面**[链接](http://x)**后面": '<p>前面<strong><a href="http://x">链接</a></strong>后面</p>',
    "前面**`code`**后面": "<p>前面<strong><code>code</code></strong>后面</p>",
    "## 小结：**「已完成」**": "<h2>小结：<strong>「已完成」</strong></h2>",
    "- **第一步：**安装": "<ul><li><strong>第一步：</strong>安装</li></ul>",
    "| 文件 | 说明 |\n|---|---|\n| a | **（可选）**跳过 |": "<table><thead><tr><th>文件</th><th>说明</th></tr></thead><tbody><tr><td>a</td><td><strong>（可选）</strong>跳过</td></tr></tbody></table>",
  });
});

test("a run with whitespace on both sides is text, a `_` inside an ASCII word too; the rule of three holds", () => {
  shows(render, {
    "x * y 和 2*3*4": "<p>x * y 和 2<em>3</em>4</p>",
    "snake_case_name 和 _「斜」_": "<p>snake_case_name 和 <em>「斜」</em></p>",
    "a_中_ 与 中_a_": "<p>a<em>中</em> 与 中<em>a</em></p>",
    "**粗*斜*体**": "<p><strong>粗<em>斜</em>体</strong></p>",
    // The `*` can close as well as open, so a `**` closer makes three: no pair.
    "中*文**。": "<p>中*文**。</p>",
  });
});

test("while a reply streams, emphasis opened next to CJK punctuation draws open", () => {
  shows(streamed, {
    "这是**「重点": "<p>这是<strong>「重点</strong></p>",
    "**注意：": "<p><strong>注意：</strong></p>",
    "**注意：**这": "<p><strong>注意：</strong>这</p>",
    "用**“引号”": "<p>用<strong>“引号”</strong></p>",
    "和__下划线": "<p>和<strong>下划线</strong></p>",
    "和_「斜": "<p>和<em>「斜</em></p>",
    "前面**`co": "<p>前面<strong><code>co</code></strong></p>",
    "- **第一步：": "<ul><li><strong>第一步：</strong></li></ul>",
    "| a | b |\n|---|---|\n| x | 是**「重": "<table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>x</td><td>是<strong>「重</strong></td></tr></tbody></table>",
  });
});

test("a strikethrough is exactly two `~`, whatever is around them; one `~` or three are text", () => {
  shows(render, {
    "约 1~2 天，或 3~5 天": "<p>约 1~2 天，或 3~5 天</p>",
    "这是~~「删除」~~和": "<p>这是<del>「删除」</del>和</p>",
    "用~~“引号”~~包": "<p>用<del>“引号”</del>包</p>",
    "a ~~ b ~~ c": "<p>a <del> b </del> c</p>",
    "~a~ 和 ~~~a~~~": "<p>~a~ 和 ~~~a~~~</p>",
    "| a | b |\n|---|---|\n| x | 是~~「旧」~~新，1~2 天 |": "<table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>x</td><td>是<del>「旧」</del>新，1~2 天</td></tr></tbody></table>",
    // It shares emphasis's stack: a closer turns what is open above its opener to text.
    "*a ~~b* c~~": "<p><em>a ~~b</em> c~~</p>",
    "~~a *b~~ c*": "<p><del>a *b</del> c*</p>",
    // A span's content pairs as part of the whole text: its first run follows a marker, not a space.
    ".a~~__”」_~~": "<p>.a<del>__”」_</del></p>",
    "a*__b_*": "<p>a<em>__b_</em></p>",
  });
});

test("while a reply streams, a strikethrough draws open; a lone `~` at the end and an empty mark draw nothing", () => {
  shows(streamed, {
    "约 1~": "<p>约 1</p>",
    "约 1~2 天，或 3~": "<p>约 1~2 天，或 3</p>",
    "这是~~「删": "<p>这是<del>「删</del></p>",
    "这是~~": "<p>这是</p>",
    "a ~~ b": "<p>a <del> b</del></p>",
    "和**~": "<p>和</p>",
    "说明：*~~": "<p>说明：</p>",
    "- ~~第一": "<ul><li><del>第一</del></li></ul>",
    "| a | b |\n|---|---|\n| x | 是~~「旧": "<table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>x</td><td>是<del>「旧</del></td></tr></tbody></table>",
  });
});

test("a reply with ranges and strikethrough: shown words only grow at their end, and no `~~` or star is left", () => {
  const deltas = ["预计 1~", "2 天，~~旧", "方案~~改成**新", "方案**~", "~（推荐）~~。\n\n- ~~第", "一项~~（完成）\n- 用~~“引", "号”~~包\n"];
  const shown = (text) => streamed(text).map((html) => html.replace(/<[^>]*>/g, "").replaceAll("​", ""));
  let text = "";
  let before = [];
  for (const delta of deltas) {
    text += delta;
    const now = shown(text);
    before.forEach((block, i) => assert.ok(now[i].startsWith(block), `b${i}: ${JSON.stringify(block)} → ${JSON.stringify(now[i])}`));
    before = now;
  }
  assert.ok(!/~~|\*/.test(before.join("")), JSON.stringify(before));
});

test("a Chinese reply's shown words only grow at their end, and no star or underscore is left", () => {
  const deltas = ["我改了 **「两", "个文件」**，**注", "意：**先跑 `pn", "pm test`，再看 __下", "划线__。\n\n- **第一", "步：**安装\n- 用**“引", "号”**包起来\n"];
  const shown = (text) => streamed(text).map((html) => html.replace(/<[^>]*>/g, "").replaceAll("​", ""));
  let text = "";
  let before = [];
  for (const delta of deltas) {
    text += delta;
    const now = shown(text);
    before.forEach((block, i) => assert.ok(now[i].startsWith(block), `b${i}: ${JSON.stringify(block)} → ${JSON.stringify(now[i])}`));
    before = now;
  }
  assert.ok(!/[*_]/.test(before.join("")), JSON.stringify(before));
});
