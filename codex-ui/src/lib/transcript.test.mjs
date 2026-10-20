// Run with `pnpm test` (Node >= 22.18 strips the TypeScript types of transcript.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  activeChapter,
  chapterList,
  chapterTitle,
  commandDescription,
  commandSummary,
  groupSummary,
  holdsMark,
  hookFeedback,
  limitParts,
  looksLikePath,
  markActivity,
  markTail,
  mcpLabel,
  NO_CHAPTERS,
  parseFileRef,
  pinChapter,
  planCard,
  quoteText,
  quoteThinking,
  renameChapter,
  resolvePath,
  retryParts,
  rollUp,
  shellOf,
  showsToc,
  stripAnsi,
  thoughtLines,
  toolBlocks,
  unpinChapter,
  writtenChars,
} from "./transcript.ts";

test("retry parts read the attempt counter and the short reason", () => {
  assert.deepEqual(retryParts("Reconnecting... 2/5"), { reason: "请求失败", attempt: 2, max: 5 });
  assert.deepEqual(retryParts("Reconnecting... waiting for network"), { reason: "请求失败", attempt: null, max: null });
  assert.deepEqual(retryParts({ message: "Reconnecting... 3/10", codexErrorInfo: "serverOverloaded" }), { reason: "模型过载", attempt: 3, max: 10 });
  assert.equal(retryParts({ message: "x", codexErrorInfo: "unauthorized" }).reason, "身份验证失败");
  assert.equal(retryParts({ message: "x", codexErrorInfo: { usageLimitExceeded: {} } }).reason, "已限流");
  assert.equal(retryParts({ message: "x", codexErrorInfo: { responseStreamDisconnected: { httpStatusCode: 502 } } }).reason, "请求失败");
  assert.equal(retryParts(null).reason, "请求失败");
});

test("retry reasons fall back to structured HTTP 429 without overriding known categories", () => {
  for (const kind of ["httpConnectionFailed", "responseStreamConnectionFailed", "responseStreamDisconnected", "responseTooManyFailedAttempts"]) {
    assert.deepEqual(retryParts({ message: "Reconnecting... 1/5", codexErrorInfo: { [kind]: { httpStatusCode: 429 } } }), { reason: "已限流", attempt: 1, max: 5 });
  }
  assert.equal(retryParts({ codexErrorInfo: { serverOverloaded: { httpStatusCode: 429 } } }).reason, "模型过载");
  for (const detail of [null, 429, { httpStatusCode: null }, { httpStatusCode: 502 }, { httpStatusCode: "429" }]) {
    assert.equal(retryParts({ codexErrorInfo: { httpConnectionFailed: detail } }).reason, "请求失败");
  }
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

test("adjacent tool rows roll up into a group until text, a shown thought or a standalone item", () => {
  const run = (id, status = "completed", source = "agent") => ({ type: "commandExecution", id, source, status, commandActions: [{ type: "unknown", command: "npm test" }] });
  const items = [
    run("c1"),
    { type: "reasoning", id: "t1", summary: ["想一想"], content: [] },
    run("c2"),
    { type: "agentMessage", id: "m1", text: "好了" },
    run("c3"),
    { type: "plan", id: "p1", text: "计划" },
    run("c4"),
    run("u1", "completed", "userShell"),
    run("c5"),
    { type: "collabAgentToolCall", id: "w1", tool: "wait", status: "completed", receiverThreadIds: ["a"], agentsStates: { a: { status: "completed", message: "报告" } } },
    run("c6"),
    { type: "collabAgentToolCall", id: "w2", tool: "wait", status: "completed", receiverThreadIds: ["a"], agentsStates: {} },
  ];
  const shape = (entries) => entries.map((e) => (e.kind === "group" ? e.blocks.map((b) => b.item.id).join("+") : e.block.item.id));
  assert.deepEqual(shape(rollUp(toolBlocks(items), false)), ["c1+c2", "m1", "c3", "p1", "c4", "u1", "c5", "w1", "c6+w2"]);
  assert.deepEqual(shape(rollUp(toolBlocks(items), true)).slice(0, 3), ["c1", "t1", "c2"], "a shown thought splits the group");
  assert.deepEqual(shape(rollUp(toolBlocks([run("c7"), { type: "contextCompaction", id: "k1" }, run("c8")]), false)), ["c7+k1+c8"], "a compaction among the calls joins them");
  const empty = { type: "reasoning", id: "t2", summary: [], content: [" "] };
  assert.deepEqual(shape(rollUp(toolBlocks([run("c9"), empty, run("c10")]), true)), ["c9+c10"], "an empty thought draws nothing, so it splits nothing");
  assert.deepEqual(thoughtLines({ summary: ["**正在核对字体**", "**Checking fonts**\n\nThe **bold** goes, `code` stays.", "", "**Still stream"], content: [] }), [
    "正在核对字体",
    "Checking fonts\n\nThe bold goes, `code` stays.",
    "Still stream",
  ]);
});

test("the turn's last row holds the mark only as a call's row or a group, a hidden thought after it or not", () => {
  const run = (id, source = "agent") => ({ type: "commandExecution", id, source, status: "completed", commandActions: [{ type: "unknown", command: "npm test" }] });
  const thought = { type: "reasoning", id: "t1", summary: ["想一想"], content: [] };
  const tail = (items, thinking = false) => markTail(rollUp(toolBlocks(items), thinking));
  assert.equal(tail([run("c1")]), 0);
  assert.equal(tail([run("c1"), thought]), 0, "a hidden thought draws nothing");
  assert.equal(tail([run("c1"), thought], true), -1, "a shown one ends the run");
  assert.equal(tail([run("c1"), run("c2")]), 0, "a group");
  assert.equal(tail([run("c1"), { type: "agentMessage", id: "m1", text: "好了" }]), -1);
  assert.equal(tail([run("u1", "userShell")]), -1, "your own command");
  assert.equal(tail([{ type: "collabAgentToolCall", id: "s1", tool: "spawnAgent", status: "completed", receiverThreadIds: [], agentsStates: {} }]), -1, "a sub-agent's row");
  assert.equal(tail([{ type: "webSearch", id: "w1", query: "codex" }]), 0);
  assert.equal(tail([]), -1);
  assert.equal(holdsMark({ kind: "block", block: { kind: "file", parts: [] } }), true);
});

test("a group's line counts what its calls did, the plain tools last", () => {
  const text = (parts) => parts.map((p) => (p.meta ? `${p.verb} ${p.meta}` : p.verb)).join(", ");
  const read = (id, path, status = "completed") => ({ type: "commandExecution", id, source: "agent", status, commandActions: [{ type: "read", command: `cat ${path}`, name: path, path }] });
  const run = (id, status = "completed") => ({ type: "commandExecution", id, source: "agent", status, commandActions: [{ type: "unknown", command: "npm test" }] });
  const edit = (id, path, status = "completed", kind = "update") => ({
    type: "fileChange",
    id,
    status,
    changes: [{ path, kind: kind === "update" ? { type: "update", move_path: null } : { type: kind }, diff: "" }],
  });
  const mcp = (id) => ({ type: "mcpToolCall", id, server: "s", tool: "t", status: "completed" });
  const summary = (items, blocked) => groupSummary(toolBlocks(items), blocked);

  assert.equal(text(summary([mcp("t1"), read("r1", "a.ts"), run("c1"), read("r2", "a.ts"), read("r3", "b.ts"), edit("e1", "c.ts", "completed", "add")])), "已读取 2 个文件, 已运行 1 个命令, 已创建 1 个文件, 已使用 1 个工具");
  assert.equal(text(summary([read("r1", "a.ts"), run("c1"), edit("e1", "a.ts")])), "已读取和已编辑 a.ts, 已运行 1 个命令", "one file shares a part named after it");
  assert.equal(text(summary([run("c1", "failed"), run("c2"), run("c3", "declined")])), "已运行 3 个命令（1 个失败）");
  assert.equal(text(summary([run("c1"), mcp("t1")], new Set(["c1"]))), "已运行 1 个命令（已阻止 1 个）, 已使用 1 个工具");
  const failed = summary([run("c1", "failed"), run("c2", "failed")]);
  assert.deepEqual([text(failed), failed[0].isError, failed[0].failedMeta], ["已运行 2 个命令", true, "2 个命令（2 个失败）"]);
  assert.equal(summary([edit("e1", "a.ts", "failed"), run("c1"), edit("e2", "a.ts")])[0].failed, undefined, "the last edit of a file stands");

  const compaction = { type: "contextCompaction", id: "k1" };
  assert.equal(text(summary([run("c1"), compaction, read("r1", "a.ts"), mcp("t1")])), "已运行 1 个命令, 压缩了 会话, 已读取 a.ts, 已使用 1 个工具");
  assert.equal(text(summary([mcp("t1"), compaction, run("c1")])), "压缩了 会话, 已运行 1 个命令, 已使用 1 个工具", "before the first part that began after it");
  assert.equal(text(summary([run("c1"), compaction])), "已运行 1 个命令, 压缩了 会话");

  assert.deepEqual(summary([read("r1", "a.ts"), edit("e1", "a.ts")])[0].file, { path: "a.ts", preferDiff: true }, "a clean file part opens its diff");
  assert.deepEqual(summary([read("r1", "a.ts"), read("r2", "a.ts")])[0].file, { path: "a.ts", preferDiff: false }, "only read: the file itself");
  assert.equal(summary([read("r1", "a.ts"), edit("e1", "a.ts", "failed")])[0].file, undefined, "a failure in it: no link");
  assert.equal(summary([{ type: "imageView", id: "v1", path: "a.png" }, run("c1")])[0].file, undefined, "an image view is no read");

  const five = summary([read("r1", "a.ts"), read("r2", "b.ts"), run("c1"), edit("e1", "c.ts"), mcp("t1"), mcp("t2"), { type: "webSearch", id: "w1", query: "q", action: null }]);
  assert.equal(text(limitParts(five)), "已读取 2 个文件, 已运行 1 个命令, 已编辑 1 个文件, 以及另外 3 项操作");
  assert.equal(limitParts(five.slice(0, 4)).length, 4, "four parts all show");
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

test("command purposes stay plain and fall back when absent or blank", () => {
  assert.equal(commandDescription("  运行 codex-ui 的全部测试  "), "运行 codex-ui 的全部测试");
  assert.equal(commandDescription("\u001b[31m检查类型\u001b[0m\n并列出\tcodex.ts 的改动"), "检查类型 并列出 codex.ts 的改动");
  assert.equal(commandDescription("检查\u202e类型"), "检查 类型");
  assert.equal(commandDescription("<b>测试</b>"), "<b>测试</b>");
  for (const value of [undefined, null, "", " \n\t", "\u001b[0m"]) assert.equal(commandDescription(value), null);
  const read = (id, description) => ({ type: "commandExecution", id, description, source: "agent", commandActions: [{ type: "read", path: "codex.ts" }] });
  assert.deepEqual(toolBlocks([read("types", "检查接口类型"), read("changes", "检查改动位置")]).map((block) => block.kind), ["item", "item"]);
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

test("the plan card follows the running turn, a later message, waiting and leftover tasks", () => {
  const steps = (...statuses) => statuses.map((status, i) => ({ step: `s${i}`, status }));
  const turn = (status, items, plan) => ({ status, items: items.map((type, i) => ({ id: `i${i}`, type })), plan });
  const running = turn("inProgress", ["userMessage", "commandExecution"], { steps: steps("completed", "inProgress", "pending"), at: 1 });
  const card = planCard(running, false, []);
  assert.deepEqual([card.visible.length, card.start, card.openAfter, card.fromBefore, card.spin, card.tasksAt], [3, 0, 0, false, true, -1]);
  assert.equal(planCard(running, true, []).spin, false);
  assert.equal(planCard(turn("inProgress", ["userMessage"], { steps: [], at: 1 }), false, []), null);
  // A message sent after the plan: from before, still; dropped once every step is done.
  const steered = turn("inProgress", ["userMessage", "commandExecution", "userMessage"], { steps: steps("inProgress"), at: 2 });
  assert.deepEqual([planCard(steered, false, []).fromBefore, planCard(steered, false, []).spin], [true, false]);
  assert.equal(planCard({ ...steered, plan: { steps: steps("completed"), at: 2 } }, false, []), null);
  assert.equal(planCard({ ...steered, plan: { steps: steps("inProgress"), at: 3 } }, false, []).fromBefore, false);
  // A compaction since holds the spinner without the note.
  const compacted = turn("inProgress", ["userMessage", "contextCompaction"], { steps: steps("inProgress"), at: 1 });
  assert.deepEqual([planCard(compacted, false, []).fromBefore, planCard(compacted, false, []).spin], [false, false]);
  // Ended: only while a background task the turn started runs, counted under the open step.
  const ended = { ...running, status: "completed" };
  assert.equal(planCard(ended, false, []), null);
  assert.equal(planCard(ended, false, [{ itemId: "elsewhere" }]), null);
  const lingering = planCard(ended, false, [{ itemId: "i1" }]);
  assert.deepEqual([lingering.tasks, lingering.tasksAt, lingering.spin], [1, 1, false]);
  // Twelve at a time from the step before the first open one, the last twelve at most.
  const long = (open) => turn("inProgress", ["userMessage"], { steps: steps(...Array.from({ length: 20 }, (_, i) => (i < open ? "completed" : i === open ? "inProgress" : "pending"))), at: 1 });
  const early = planCard(long(0), false, []);
  assert.deepEqual([early.start, early.visible.length, early.openAfter], [0, 12, 8]);
  const middle = planCard(long(5), false, []);
  assert.deepEqual([middle.start, middle.visible[0].step, middle.openAfter], [4, "s4", 4]);
  const late = planCard(long(18), false, []);
  assert.deepEqual([late.start, late.visible.at(-1).step, late.openAfter], [8, "s19", 0]);
});

test("the working mark plays the call since the latest reasoning, an unfinished one first", () => {
  const cmd = (status, ...types) => ({ type: "commandExecution", id: "c", status, commandActions: types.map((type) => ({ type })) });
  const mcp = (tool, status = "completed") => ({ type: "mcpToolCall", id: "m", server: "s", tool, status });
  const reasoning = { type: "reasoning", id: "r", summary: [], content: [] };
  const reply = { type: "agentMessage", id: "a", text: "" };
  const prompt = { type: "userMessage", id: "u", content: [] };
  const edit = { type: "fileChange", id: "f", status: "inProgress", changes: [] };
  assert.equal(markActivity([]), "think");
  assert.equal(markActivity([prompt, reply]), "think");
  assert.equal(markActivity([prompt, cmd("completed", "read", "search"), reply]), "read");
  assert.equal(markActivity([cmd("completed", "read", "unknown")]), "code");
  assert.equal(markActivity([cmd("completed"), reasoning]), "think");
  assert.equal(markActivity([cmd("completed"), prompt]), "think");
  assert.equal(markActivity([reasoning, edit, { type: "webSearch", id: "w" }]), "write");
  assert.equal(markActivity([edit, reasoning, { type: "webSearch", id: "w" }]), "search");
  assert.equal(markActivity([mcp("create_issue")]), "write");
  assert.equal(markActivity([mcp("run-query")]), "code");
  assert.equal(markActivity([mcp("search_docs")]), "read");
  assert.equal(markActivity([mcp("summarize")]), "default");
});

test("the token count takes what the model wrote and calls, not its reasoning", () => {
  const reasoning = { type: "reasoning", id: "r", summary: ["先确认圆角令牌"], content: ["raw"] };
  const add = { path: "a.css", kind: { type: "add" }, diff: "+x\n" };
  assert.equal(writtenChars([]), 0);
  assert.equal(writtenChars([{ type: "userMessage", id: "u", content: [] }, reasoning]), 0);
  assert.equal(writtenChars([reasoning, { type: "agentMessage", id: "a", text: "abcd" }, { type: "plan", id: "p", text: "ef" }]), 6);
  assert.equal(writtenChars([{ type: "commandExecution", id: "c", command: "rg -n x" }, { type: "fileChange", id: "f", changes: [add, add] }]), 13);
  assert.equal(writtenChars([{ type: "mcpToolCall", id: "m", arguments: { q: 1 } }, { type: "dynamicToolCall", id: "d", arguments: null }]), 7);
  assert.equal(writtenChars([{ type: "webSearch", id: "w", query: "codex" }, { type: "imageView", id: "i", path: "a.png" }, { type: "collabAgentToolCall", id: "s", prompt: null }]), 10);
});
