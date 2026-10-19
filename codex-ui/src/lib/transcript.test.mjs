// Run with `pnpm test` (Node >= 22.18 strips the TypeScript types of transcript.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  activeChapter,
  chapterList,
  chapterTitle,
  commandSummary,
  hookFeedback,
  looksLikePath,
  mcpLabel,
  NO_CHAPTERS,
  parseFileRef,
  pinChapter,
  quoteText,
  quoteThinking,
  renameChapter,
  resolvePath,
  retryParts,
  shellOf,
  showsToc,
  stripAnsi,
  toolBlocks,
  unpinChapter,
  wordDelay,
} from "./transcript.ts";

test("retry parts read the attempt counter and the short reason", () => {
  assert.deepEqual(retryParts("Reconnecting... 2/5"), { reason: "请求失败", attempt: 2, max: 5 });
  assert.deepEqual(retryParts("Reconnecting... waiting for network"), { reason: "请求失败", attempt: null, max: null });
  assert.deepEqual(retryParts({ message: "Reconnecting... 3/10", codexErrorInfo: "serverOverloaded" }), { reason: "模型过载", attempt: 3, max: 10 });
  assert.equal(retryParts({ message: "x", codexErrorInfo: "unauthorized" }).reason, "身份验证失败");
  assert.equal(retryParts({ message: "x", codexErrorInfo: { usageLimitExceeded: {} } }).reason, "速率受限");
  assert.equal(retryParts({ message: "x", codexErrorInfo: { responseStreamDisconnected: { httpStatusCode: 502 } } }).reason, "请求失败");
  assert.equal(retryParts(null).reason, "请求失败");
});

test("thinking copies as a quote with an estimated token count", () => {
  assert.equal(quoteThinking("先看设置页\n\n再改"), "> **Thinking** (~2 tok)\n>\n> 先看设置页\n>\n> 再改");
  assert.equal(quoteText(" a\nb \n"), "> a\n> b\n\n");
});

test("chapter titles keep the first non-empty line, 40 characters at most", () => {
  assert.equal(chapterTitle("\n  标题行  \n正文"), "标题行");
  assert.equal(chapterTitle("x".repeat(45)), `${"x".repeat(40)}…`);
  assert.equal(chapterTitle("  \n "), "");
});

test("pins become chapters in transcript order after the session start", () => {
  let store = pinChapter(NO_CHAPTERS, "m3", "第三条", "c3");
  store = pinChapter(store, "m1", "第一条", "c1");
  assert.equal(pinChapter(store, "m1", "again", "c9"), store, "one pin per reply");
  store = renameChapter(store, "c1", "改名");
  const chapters = chapterList(["p0", "m1", "m2", "m3"], store);
  assert.deepEqual(
    chapters.map((c) => [c.id, c.title, c.anchor]),
    [
      ["session-start", "会话开始", "p0"],
      ["c1", "改名", "m1"],
      ["c3", "第三条", "m3"],
    ],
  );
  assert.equal(showsToc(chapters), true);
  assert.equal(showsToc(chapterList(["p0"], unpinChapter(unpinChapter(store, "m1"), "m3"))), false);
  assert.deepEqual(chapterList([], store), [], "no turns, no chapters");
});

test("the active chapter is the last one above the reading line", () => {
  assert.equal(activeChapter([0, 100, null, 300], 150, false), 1);
  assert.equal(activeChapter([0, 100, 200], -5, false), 0);
  assert.equal(activeChapter([0, 100, 200], 0, true), 2);
  assert.equal(activeChapter([], 0, false), -1);
});

test("adjacent reads of one file and changes to one file share a row", () => {
  const read = (id, path) => ({ type: "commandExecution", id, source: "agent", commandActions: [{ type: "read", command: `cat ${path}`, name: path, path }] });
  const run = (id) => ({ type: "commandExecution", id, source: "agent", commandActions: [{ type: "unknown", command: "npm test" }] });
  const change = (path, kind = "update") => ({ path, kind: kind === "update" ? { type: "update", move_path: null } : { type: kind }, diff: "" });
  const edit = (id, ...changes) => ({ type: "fileChange", id, status: "completed", changes });
  const blocks = toolBlocks([
    read("r1", "a.ts"),
    read("r2", "a.ts"),
    read("r3", "b.ts"),
    run("c1"),
    read("r4", "b.ts"),
    edit("e1", change("a.ts"), change("b.ts")),
    edit("e2", change("b.ts")),
    edit("e3", change("b.ts", "add")),
  ]);
  assert.deepEqual(
    blocks.map((b) => (b.kind === "item" ? b.item.id : b.kind === "reads" ? `reads:${b.items.map((i) => i.id)}` : `file:${b.parts.map((p) => `${p.item.id}.${p.index}`)}`)),
    ["reads:r1,r2", "reads:r3", "c1", "reads:r4", "file:e1.0", "file:e1.1,e2.0", "file:e3.0"],
  );
});

test("the shell and script come out of the shlex-joined argv", () => {
  assert.deepEqual(shellOf("bash -lc 'npm test'"), { shell: "bash", script: "npm test" });
  assert.deepEqual(shellOf(`/bin/zsh -lc 'echo '"'"'hi'"'"''`), { shell: "bash", script: "echo 'hi'" });
  assert.deepEqual(shellOf(String.raw`'C:\WINDOWS\System32\WindowsPowerShell\v1.0\powershell.exe' -NoProfile -Command 'Get-ChildItem src'`), {
    shell: "powershell",
    script: "Get-ChildItem src",
  });
  assert.deepEqual(shellOf("git status"), { shell: "bash", script: "git status" });
});

test("a command summary keeps four plain words of a known program", () => {
  assert.equal(commandSummary("npm test"), "npm test");
  assert.equal(commandSummary("cd web && pnpm run build --filter app"), "pnpm run build…");
  assert.equal(commandSummary("git log --oneline -5"), "git log…");
  assert.equal(commandSummary("rg -n foo src"), "rg…");
  assert.equal(commandSummary("python -m pytest tests/unit -x"), "python…");
  assert.equal(commandSummary("ls src/lib tests docs extra"), "ls src/lib tests docs…");
  assert.equal(commandSummary("npm test\nnpm run lint"), "npm test…", "more lines");
  assert.equal(commandSummary("cat a.ts | head -20"), "cat a.ts…");
  assert.equal(commandSummary("curl https://x.dev"), null, "unknown program");
  assert.equal(commandSummary("echo $(whoami)"), null, "substitution");
  assert.equal(commandSummary("git clone https://user:pw@host/repo"), null, "credential");
  assert.equal(commandSummary("npm publish --token abc"), null, "credential flag");
  assert.equal(commandSummary("Get-ChildItem src", "powershell"), "Get-ChildItem src");
  assert.equal(commandSummary("   "), null);
});

test("terminal escapes are stripped and MCP tools read server: tool", () => {
  assert.equal(stripAnsi("\x1b[31mred\x1b[0m plain \x1b]0;title\x07"), "red plain ");
  assert.equal(mcpLabel("github_api", "list__issues"), "github api: list issues");
});

test("tool hook feedback lands on the tool row nearest in time", () => {
  const spans = [
    { id: "t1", start: 10_000, end: 12_000 },
    { id: "t2", start: 20_000 },
  ];
  const hook = (eventName, startedAt, kind = "feedback", text = "注意") => ({ eventName, startedAt, entries: [{ kind, text }] });
  const notes = hookFeedback([hook("preToolUse", 19), hook("postToolUse", 12), hook("postToolUse", 13, "context"), hook("stop", 21)], spans);
  assert.deepEqual([...notes], [
    ["t2", ["注意"]],
    ["t1", ["注意"]],
  ]);
  assert.equal(hookFeedback([hook("preToolUse", 1)], []).size, 0);
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

test("word delays are capped", () => {
  assert.deepEqual([0, 1, 5, 100].map(wordDelay), [0, 20, 100, 300]);
});
