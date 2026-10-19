// Run with `pnpm test` (Node >= 22.18 strips the TypeScript types of frontier.ts).
// Expected renders are Claude 2.42304's Alluvium on the same half-finished text (c86867935
// snapshot(false)), as marked draws them.
import assert from "node:assert/strict";
import { test } from "node:test";
import { Marked } from "marked";
import { frontier } from "./frontier.ts";

// markdown.ts needs a DOM (DOMPurify); render the blocks as renderBlocks does, with plain marked.
const marked = new Marked({ gfm: true });
const blocks = (text) => {
  const { tokens, last } = frontier(text);
  const list = tokens.filter((token) => token.type !== "space");
  return list.map((token, i) => marked.parse(i === list.length - 1 ? (last ?? token.raw) : token.raw).replaceAll("\n", ""));
};
const shows = (cases) => {
  for (const [text, html] of Object.entries(cases)) assert.equal(blocks(text).join(""), html, JSON.stringify(text));
};

test("open emphasis and strikethrough draw open; a marker with nothing after it is text", () => {
  shows({
    "Hello **wor": "<p>Hello <strong>wor</strong></p>",
    "Hello **": "<p>Hello **</p>",
    "Hello _wor": "<p>Hello <em>wor</em></p>",
    "**bold *nested": "<p><strong>bold <em>nested</em></strong></p>",
    "**bold*": "<p><strong>bold*</strong></p>",
    "**bold** and *it": "<p><strong>bold</strong> and <em>it</em></p>",
    "foo**bar": "<p>foo<strong>bar</strong></p>",
    "x * y": "<p>x * y</p>",
    "a_b_c": "<p>a_b_c</p>",
    "Hello ~~del": "<p>Hello <del>del</del></p>",
    "Hello ~del": "<p>Hello ~del</p>",
    // A lone `~` or `\` at the end, and a strikethrough with nothing in it yet, draw nothing.
    "Hello ~": "<p>Hello </p>",
    "Hello ~~": "<p>Hello </p>",
    "end \\": "<p>end </p>",
    "end \\*": "<p>end *</p>",
  });
});

test("an open code span draws as code, an empty one as an empty chip, a short closer run left out", () => {
  shows({
    "a `co": "<p>a <code>co</code></p>",
    "a `": "<p>a <code>​</code></p>",
    "a ``co`": "<p>a <code>co</code></p>",
    "a ```co": "<p>a <code>co</code></p>",
    "a `co`": "<p>a <code>co</code></p>",
  });
});

test("a link draws once its destination starts; before that its brackets are text", () => {
  shows({
    "see [label": "<p>see [label</p>",
    "see [label]": "<p>see [label]</p>",
    "see [label](": '<p>see <a href="">label</a></p>',
    "see [label](http://exa": '<p>see <a href="http://exa">label</a></p>',
    "see ![alt](a.png": '<p>see <img src="a.png" alt="alt"></p>',
    "see [**b": "<p>see [<strong>b</strong></p>",
    '[a](u "ti': '<p><a href="u" title="ti">a</a></p>',
    "**see [docs](http://x": '<p><strong>see <a href="http://x">docs</a></strong></p>',
    "go http://exa": '<p>go <a href="http://exa">http://exa</a></p>',
  });
});

test("a last line that may still turn into a block marker is held back", () => {
  for (const line of ["#", "# ", "## ", "-", "- ", "*", "+ ", "1", "1.", "1. ", "12)", ">", "> ", "> - ", "> # ", "`", "```", "---", "***", "- - -", "_ ", "$$", "\\", "\\("])
    assert.deepEqual(blocks(line), [], JSON.stringify(line));
  shows({
    "# T": "<h1>T</h1>",
    "#T": "<p>#T</p>",
    "Para\n- ": "<p>Para</p>",
    "Para\n1": "<p>Para</p>",
    "Para\n> ": "<p>Para</p>",
    "Para\n```": "<p>Para</p>",
    "- a\n- ": "<ul><li>a</li></ul>",
    "- a\n  - ": "<ul><li>a</li></ul>",
    "1. a\n    - ": "<ol><li>a</li></ol>",
    // A setext underline: still the paragraph, until its line ends.
    "Text\n=": "<p>Text</p>",
    "Text\n---": "<p>Text</p>",
    "Text\n---\n": "<h2>Text</h2>",
    // Spaces alone are no blank line yet.
    "Para **open\n   ": "<p>Para <strong>open</strong></p>",
  });
});

test("a table shows once its delimiter row ends, with no empty row for a lone pipe", () => {
  const head = "<table><thead><tr><th>文件</th><th>改动</th></tr></thead>";
  shows({
    "| 文件 | 改动 |": "<p>| 文件 | 改动 |</p>",
    "| 文件 | 改动 |\n|": "<p>| 文件 | 改动 |</p>",
    "| 文件 | 改动 |\n|---": "<p>| 文件 | 改动 |</p>",
    "| 文件 | 改动 |\n|---|---|": "<p>| 文件 | 改动 |</p>",
    "| 文件 | 改动 |\n|---|---|\n": `${head}</table>`,
    "| 文件 | 改动 |\n|---|---|\n|": `${head}</table>`,
    "| 文件 | 改动 |\n|---|---|\n| a | **b": `${head}<tbody><tr><td>a</td><td><strong>b</strong></td></tr></tbody></table>`,
    // A row that has ended keeps its cells' text as written.
    "| 文件 | 改动 |\n|---|---|\n| a | **b |": `${head}<tbody><tr><td>a</td><td>**b</td></tr></tbody></table>`,
  });
});

test("a fence's last line waits while it may still be the closer; any other line is code", () => {
  shows({
    "```p": '<pre><code class="language-p"></code></pre>',
    "```py\nprint(1)\n``": '<pre><code class="language-py">print(1)</code></pre>',
    "```py\nprint(1)\n```": '<pre><code class="language-py">print(1)</code></pre>',
    "```py\n- ": '<pre><code class="language-py">- </code></pre>',
  });
});

test("marks in a block that has ended are text; a heading keeps its closing hashes while written", () => {
  shows({
    "Para **open\n\nNext": "<p>Para **open</p><p>Next</p>",
    "Para **open\n": "<p>Para <strong>open</strong></p>",
    "- a **b": "<ul><li>a <strong>b</strong></li></ul>",
    "- a **b\n\n": "<ul><li>a **b</li></ul>",
    "> q **b\n>": "<blockquote><p>q <strong>b</strong></p></blockquote>",
    "> q **b\n>\n": "<blockquote><p>q **b</p></blockquote>",
    "## Title #": "<h2>Title #</h2>",
    "## Ti**t": "<h2>Ti<strong>t</strong></h2>",
    "- [ ] ": '<ul><li><input disabled="" type="checkbox"> ​</li></ul>',
  });
});

test("shown words keep their block and offset as a reply grows, so the reveal ledger replays none", () => {
  const deltas = ["我改了 **两", "个文件**，主要是 `rev", "eal.ts` 的账本：\n\n1. 先跑 `pnpm", " test`\n2. 再看 ~~旧", "的~~ 新的 *斜", "体*\n\n> 注意：", "*不要* 直接改 `main`。\n\n#", "# 小结\n\n```t", "s\nconst x = 1;\n``", "`\n"];
  const shown = (text) => blocks(text).map((html) => html.replace(/<[^>]*>/g, "").replaceAll("​", ""));
  let text = "";
  let before = [];
  for (const delta of deltas) {
    text += delta;
    const now = shown(text);
    before.forEach((block, i) => assert.ok(now[i].startsWith(block), `b${i}: ${JSON.stringify(block)} → ${JSON.stringify(now[i])}`));
    before = now;
  }
});
