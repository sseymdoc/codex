// Run with `pnpm test`. markdown.ts's marked side, local links on and off. DOMPurify needs a DOM, so
// it is a pass-through here: what is checked is the HTML marked hands it, the first of the two
// layers (raw HTML escaped by the html renderer, then DOMPurify in the page).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { transformSync } from "esbuild";

const PURIFY = `data:text/javascript,${encodeURIComponent("export default { addHook() {}, sanitize: (html) => html };")}`;
registerHooks({
  resolve: (specifier, context, next) => {
    if (specifier === "dompurify") return { url: PURIFY, shortCircuit: true };
    return next(/^\.\.?\/[^.]+$/.test(specifier) && context.parentURL?.endsWith(".ts") ? `${specifier}.ts` : specifier, context);
  },
  load: (url, context, next) =>
    url.startsWith("file:") && url.endsWith(".ts") ? { format: "module", shortCircuit: true, source: transformSync(readFileSync(new URL(url), "utf8"), { loader: "ts", format: "esm" }).code } : next(url, context),
});
const { renderBlocks, renderMarkdown } = await import("./markdown.ts");

const LOCAL = [
  "[说明](docs/readme.md)",
  "[盘](C:/Users/me/secret.txt)",
  "[文件](file:///etc/passwd)",
  "![截图](./shot.png)",
  "![](../a.png)",
  "看 `src/lib/markdown.ts` 这里",
  "[终端](#terminal/0123abcd)",
];

test("local links are this machine's files by default, text with localLinks off", () => {
  const on = LOCAL.map((text) => renderMarkdown(text));
  assert.ok(on.every((html) => html.includes("data-path") || html.includes("data-terminal")), on.join("\n"));
  assert.ok(on[3].includes("<md-image>"));

  const off = LOCAL.map((text) => renderMarkdown(text, false, false, false));
  for (const html of off) {
    assert.doesNotMatch(html, /data-path|data-terminal|md-image|<a |<img /, html);
  }
  assert.deepEqual(off.map((html) => html.replace(/<\/?p>|\n/g, "")), ["说明", "盘", "文件", "截图", "", "看 <code>src/lib/markdown.ts</code> 这里", "终端"]);
  // Web links and data images are as they were; DOMPurify's hook makes a remote image a link.
  assert.match(renderMarkdown("[站点](https://example.com/a)", false, false, false), /<a href="https:\/\/example\.com\/a">站点<\/a>/);
  assert.match(renderMarkdown("![x](https://example.com/a.png)", false, false, false), /<img src="https:\/\/example\.com\/a\.png" alt="x">/);
  // The switch is back on for the next render.
  assert.match(renderMarkdown("[a](b.md)"), /data-path="b\.md"/);
});

test("blocks keep local and remote renders apart in their cache", () => {
  const text = "[a](notes/a.md)\n\n[b](notes/b.md)\n\nend";
  const off = renderBlocks(text, false, false, false, false);
  const on = renderBlocks(text);
  assert.ok(off.slice(0, 2).every((html) => !html.includes("data-path")), off.join("\n"));
  assert.ok(on.slice(0, 2).every((html) => html.includes("data-path")), on.join("\n"));
  assert.ok(renderBlocks(text, false, false, false, false).slice(0, 2).every((html) => !html.includes("data-path")));
});

test("raw HTML from a file stays text: no meta refresh, no handler", () => {
  for (const text of [
    '<meta http-equiv="refresh" content="0;url=https://evil.example/">',
    "前面 <img src=x onerror=alert(1)> 后面",
    '<div style="position:fixed;inset:0" onclick="x()">覆盖</div>',
    "<script>alert(1)</script>",
    '[x](javascript:alert(1) "t")',
    '![a" onerror="alert(1)](https://example.com/a.png)',
  ]) {
    const html = renderMarkdown(text, false, false, false);
    // A tag of its own, or a handler as an attribute (escaped text or a quoted value may say "onerror=").
    assert.doesNotMatch(html, /<(?:meta|script|div|img src=x)|<[a-z]+(?:\s+[a-z-]+(?:="[^"]*")?)*\s+on[a-z]+=/i, html);
  }
});

test("a shell fence, or an unlabeled common one-liner, gets 在终端中运行; hidden characters never do", () => {
  const run = (text) => renderMarkdown(text, false, false, true).includes("data-run");
  assert.equal(run("```bash\nnpm test\n```"), true);
  assert.equal(run("```zsh\nls -la\n```"), true);
  assert.equal(run("```\ngit status\n```"), true);
  assert.equal(run("```\ngit log | head\n```"), false);
  assert.equal(run("```js\nconsole.log(1)\n```"), false);
  assert.equal(run("```powershell\nGet-ChildItem\n```"), false);
  assert.equal(run("```bash\necho ‮hi\n```"), false);
  assert.equal(run("```bash\n\n```"), false);
});
