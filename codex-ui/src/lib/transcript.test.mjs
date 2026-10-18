// Run with `pnpm test` (Node >= 22.18 strips the TypeScript types of transcript.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  activeChapter,
  agentCell,
  agentPulse,
  agentTally,
  chapterList,
  chapterTitle,
  hookVisible,
  looksLikePath,
  NO_CHAPTERS,
  parseFileRef,
  pinChapter,
  quoteText,
  quoteThinking,
  renameChapter,
  resolvePath,
  retryParts,
  showsToc,
  unpinChapter,
  wordDelay,
} from "./transcript.ts";

test("retry parts read the attempt counter and the reason", () => {
  assert.deepEqual(retryParts("Reconnecting... 2/5"), { reason: "连接中断", attempt: 2, max: 5 });
  assert.deepEqual(retryParts("Reconnecting... waiting for network"), { reason: "等待网络", attempt: null, max: null });
  assert.deepEqual(retryParts({ message: "Reconnecting... 3/10", codexErrorInfo: "serverOverloaded" }), { reason: "服务器繁忙", attempt: 3, max: 10 });
  assert.equal(retryParts({ message: "x", codexErrorInfo: { responseStreamDisconnected: { httpStatusCode: 502 } } }).reason, "连接中断");
  assert.equal(retryParts(null).reason, "连接中断");
});

test("thinking copies as a quote with an estimated token count", () => {
  assert.equal(quoteThinking("先看设置页\n\n再改"), "> **思考** (~2 tok)\n>\n> 先看设置页\n>\n> 再改");
  assert.equal(quoteText(" a\nb \n"), "> a\n> b\n\n");
});

test("chapter titles keep the first non-empty line, 40 characters at most", () => {
  assert.equal(chapterTitle("\n  标题行  \n正文"), "标题行");
  assert.equal(chapterTitle("x".repeat(45)), `${"x".repeat(40)}…`);
});

test("pins become chapters in transcript order after the session start", () => {
  let store = pinChapter(NO_CHAPTERS, "m3", "第三条", "c3");
  store = pinChapter(store, "m1", "第一条", "c1");
  assert.equal(pinChapter(store, "m1", "again", "c9"), store, "one pin per reply");
  store = renameChapter(store, "c1", "改名");
  const chapters = chapterList("会话标题", ["p0", "m1", "m2", "m3"], store);
  assert.deepEqual(
    chapters.map((c) => [c.id, c.title, c.anchor]),
    [
      ["session-start", "会话标题", "p0"],
      ["c1", "改名", "m1"],
      ["c3", "第三条", "m3"],
    ],
  );
  assert.equal(showsToc(chapters), true);
  assert.equal(showsToc(chapterList("会话标题", ["p0"], unpinChapter(unpinChapter(store, "m1"), "m3"))), false);
  assert.deepEqual(chapterList(null, ["m1"], store).map((c) => c.id), ["c1"], "no session start without a title");
});

test("the active chapter is the last one above the reading line", () => {
  assert.equal(activeChapter([0, 100, null, 300], 150, false), 1);
  assert.equal(activeChapter([0, 100, 200], -5, false), 0);
  assert.equal(activeChapter([0, 100, 200], 0, true), 2);
  assert.equal(activeChapter([], 0, false), -1);
});

test("agent states map onto grid cells and pulse out of step", () => {
  const cells = ["completed", "running", "running", "pendingInit", "interrupted", "errored", "shutdown"].map(agentCell);
  assert.deepEqual(agentTally(cells), { done: 2, running: 2, stalled: 1, pending: 1, error: 1 });
  const a = agentPulse(1);
  const b = agentPulse(2);
  assert.ok(a.duration >= 2.4 && a.duration <= 3.8 && a.delay <= 0 && -a.delay < a.duration);
  assert.notEqual(a.duration.toFixed(3), b.duration.toFixed(3));
});

test("file references parse, filter and resolve against the session folder", () => {
  assert.deepEqual(parseFileRef("src/auth/login.ts:15"), { path: "src/auth/login.ts", line: 15 });
  assert.deepEqual(parseFileRef("a.ts:3:7"), { path: "a.ts", line: 3 });
  assert.deepEqual(parseFileRef("README.md#L4"), { path: "README.md", line: 4 });
  assert.deepEqual(parseFileRef("C:\\proj\\a.ts"), { path: "C:\\proj\\a.ts" });
  assert.deepEqual(
    ["login.ts", "src/auth/login.ts:15", "Dockerfile", "user.passwordHash", "verifyPassword", "/api/users", "https://x.dev/a.js", ".ts"].map(looksLikePath),
    [true, true, true, false, false, false, false, false],
  );
  assert.equal(resolvePath("src/a.ts", "D:\\proj"), "D:\\proj\\src\\a.ts");
  assert.equal(resolvePath("./a.ts", "/home/u/"), "/home/u/a.ts");
  assert.equal(resolvePath("C:\\x.ts", "D:\\proj"), "C:\\x.ts");
  assert.equal(resolvePath("/etc/hosts", "D:\\proj"), "/etc/hosts");
});

test("only notable hook runs get a row; word delays are capped", () => {
  assert.equal(hookVisible({ status: "completed", entries: [] }), false);
  assert.equal(hookVisible({ status: "completed", entries: [{}] }), true);
  assert.equal(hookVisible({ status: "blocked", entries: [] }), true);
  assert.deepEqual([0, 1, 5, 100].map(wordDelay), [0, 20, 100, 300]);
});
