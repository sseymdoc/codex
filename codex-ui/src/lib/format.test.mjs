// Run with `pnpm test` (Node >= 22.18 strips the TypeScript types of format.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { externalUrl, hangQuotes, threadMarkdown } from "./format.ts";

test("externalUrl only opens https links without credentials", () => {
  assert.equal(externalUrl("https://example.com/authorize?state=1"), "https://example.com/authorize?state=1");
  for (const unsafe of ["http://example.com/", "javascript:alert(1)", "https://user:pass@example.com/", "file:///etc/passwd", "not a url"]) {
    assert.equal(externalUrl(unsafe), null, unsafe);
  }
});

test("threadMarkdown keeps prompts, replies, commands and edits in order", () => {
  const turns = [
    {
      items: [
        { type: "userMessage", id: "u1", content: [{ type: "text", text: "修一下测试", text_elements: [] }, { type: "image", url: "data:," }] },
        { type: "reasoning", id: "r1", summary: ["想一想"], content: [] },
        { type: "commandExecution", id: "c1", command: "npm test" },
        { type: "fileChange", id: "f1", changes: [{ path: "src/a.ts" }] },
        { type: "agentMessage", id: "a1", text: "已修复。\n" },
      ],
    },
    { items: [{ type: "userMessage", id: "u2", content: [{ type: "text", text: "谢谢", text_elements: [] }] }] },
  ];
  assert.equal(
    threadMarkdown("会话", turns),
    "# 会话\n\n## 你\n\n修一下测试\n\n## Codex\n\n```sh\n$ npm test\n```\n\n- 修改 `src/a.ts`\n\n已修复。\n\n## 你\n\n谢谢\n",
  );
});

test("hangQuotes wraps only a quote that opens a paragraph or heading", () => {
  assert.equal(hangQuotes("<p>“引用”</p>"), '<p><span data-hang-quote="dq">“</span>引用”</p>');
  assert.equal(hangQuotes("<h2>&#39;single&#39;</h2>"), '<h2><span data-hang-quote="sq">&#39;</span>single&#39;</h2>');
  assert.equal(hangQuotes("<p>说“你好”</p><li>“不悬挂”</li>"), "<p>说“你好”</p><li>“不悬挂”</li>");
});
