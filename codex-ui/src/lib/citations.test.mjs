// Run with `pnpm test`. Cases after codex-rs tui markdown_render/file_citations_tests.rs.
import assert from "node:assert/strict";
import { test } from "node:test";
import { fileCitations } from "./citations.ts";
import { outputFiles } from "./diff.ts";

const cite = (attrs) => `:codex-file-citation{${attrs}}`;
const paths = (text) => fileCitations(text).map((c) => c.path);

test("a citation is found in prose, with its line, purpose and label", () => {
  assert.deepEqual(fileCitations(`见 ${cite('path="src/a.ts" purpose="source" line_range_start="12" line_range_end="20"')} 一处`), [
    { type: "codexCitation", raw: cite('path="src/a.ts" purpose="source" line_range_start="12" line_range_end="20"'), path: "src/a.ts", purpose: "source", line: 12, label: undefined },
  ]);
  const [out] = fileCitations(`- ${cite("path='C:/x/报告.pdf' label=\"报告\"")}`);
  assert.equal(out.purpose, "output");
  assert.equal(out.label, "报告");
  assert.deepEqual(paths(`${cite('path="a.pdf"')}${cite('path="b.pdf"')}`), ["a.pdf", "b.pdf"]);
});

test("code, links and a backslash keep a citation as text", () => {
  assert.deepEqual(paths("`" + cite('path="a.pdf"') + "`"), []);
  assert.deepEqual(paths("```\n" + cite('path="a.pdf"') + "\n```"), []);
  assert.deepEqual(paths(`[${cite('path="a.pdf"')}](https://x)`), []);
  assert.deepEqual(paths("\\" + cite('path="a.pdf"')), []);
  assert.deepEqual(paths("\\\\" + cite('path="a.pdf"')), ["a.pdf"]);
  assert.deepEqual(paths("::::codex-file-citation{path=\"a.pdf\"}"), []);
});

test("an empty or missing path is no citation; an escaped quote falls back to backslash escaping", () => {
  assert.deepEqual(paths(cite('path=""')), []);
  assert.deepEqual(paths(cite('purpose="output"')), []);
  assert.deepEqual(paths(cite('path="a.pdf" path="b.pdf"')), []);
  assert.deepEqual(paths(cite('path="a\\"b.pdf"')), ['a"b.pdf']);
  assert.deepEqual(paths(cite('path="a\\b.pdf"')), ["a\\b.pdf"]);
});

test("输出 lists the files a reply cites as output, resolved against the session folder", () => {
  const turns = [
    { items: [{ type: "agentMessage", id: "m", text: `${cite('path="out/a.pdf"')} ${cite('path="src/b.ts" purpose="source"')} \`${cite('path="c.pdf"')}\`` }] },
  ];
  assert.deepEqual(outputFiles(turns, "C:\\repo", true), ["C:\\repo\\out\\a.pdf"]);
});
