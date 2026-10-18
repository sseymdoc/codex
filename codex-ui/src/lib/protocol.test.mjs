// Run with `pnpm test` (Node >= 22.18 strips the TypeScript types of protocol.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  base64ToBytes,
  base64ToText,
  finalAnswer,
  guardianEvent,
  guardianWarningShown,
  mcpRuntimeStatus,
  noActiveTurn,
  notSteerable,
  overridable,
  parseVersion,
  readStateConflict,
  rerouteText,
  reviewSummary,
  textToBase64,
  unsupported,
  upsertBy,
  worldWritableText,
} from "./protocol.ts";

test("unsupported recognises unknown, gated and unimplemented methods only", () => {
  assert.ok(unsupported({ code: -32600, message: "Invalid request: unknown variant `thread/items/read`, expected one of …" }));
  assert.ok(unsupported({ code: -32600, message: "memory/status requires experimentalApi capability" }));
  assert.ok(unsupported({ code: -32601, message: "thread/prediction/request is not implemented yet" }));
  assert.ok(!unsupported({ code: -32600, message: "thread not found: 01a1" }));
  assert.ok(!unsupported({ code: -32603, message: "failed to list apps" }));
  assert.ok(!unsupported(new Error("network")));
  assert.ok(!unsupported(null));
});

test("steer errors are told apart", () => {
  const review = { code: -32600, message: "cannot steer a review turn", data: { codexErrorInfo: { activeTurnNotSteerable: { turnKind: "review" } } } };
  assert.ok(notSteerable(review));
  assert.ok(notSteerable({ code: -32600, message: "cannot steer a compact turn" }));
  assert.ok(!notSteerable({ code: -32600, message: "no active turn to steer" }));
  assert.ok(noActiveTurn({ code: -32600, message: "no active turn to steer" }));
  assert.ok(noActiveTurn({ code: -32600, message: "expected active turn id `a` but found `b`" }));
  assert.ok(!noActiveTurn(review));
});

test("readStateConflict returns the server's current receipt", () => {
  const readState = { firstUnread: null, revision: "r2" };
  assert.deepEqual(readStateConflict({ code: -32600, message: "conflict", data: { reason: "readStateConflict", readState } }), readState);
  assert.equal(readStateConflict({ code: -32600, message: "x", data: { reason: "serverShuttingDown" } }), null);
  assert.equal(readStateConflict(new Error("x")), null);
});

test("parseVersion reads the codex version from initialize's userAgent", () => {
  assert.equal(parseVersion("codex_ui/0.163.0-alpha.10.2 (Windows 10.0.26300; x86_64) xterm-256color (codex_ui; 0.1.0)"), "0.163.0-alpha.10.2");
  assert.equal(parseVersion("codex_app_server/0.140.0 (mock)"), "0.140.0");
  assert.equal(parseVersion(""), null);
  assert.equal(parseVersion(null), null);
});

const denied = {
  id: "review-1",
  targetItemId: "item-9",
  startedAtMs: 1000,
  completedAtMs: 2500,
  review: { status: "denied", riskLevel: "high", userAuthorization: "low", rationale: "Deletes files outside the workspace." },
  action: { type: "applyPatch", cwd: "D:\\repo", files: ["D:\\repo\\a.ts", "D:\\repo\\b.ts"] },
};

test("review summaries and override eligibility follow the action type", () => {
  assert.equal(reviewSummary(denied.action), "修改 2 个文件");
  assert.equal(reviewSummary({ type: "applyPatch", cwd: "/r", files: ["/r/a.ts"] }), "修改 /r/a.ts");
  assert.equal(reviewSummary({ type: "command", source: "shell", command: "rm -rf build", cwd: "/r" }), "rm -rf build");
  assert.equal(reviewSummary({ type: "execve", source: "unifiedExec", program: "/bin/ls", argv: [], cwd: "/r" }), "/bin/ls");
  assert.equal(reviewSummary({ type: "networkAccess", target: "https://example.com", host: "example.com", protocol: "https", port: 443 }), "访问 https://example.com");
  assert.equal(
    reviewSummary({ type: "mcpToolCall", server: "github", toolName: "create_pr", connectorId: null, connectorName: null, toolTitle: null }),
    "MCP create_pr（github）",
  );
  assert.equal(reviewSummary({ type: "requestPermissions", reason: " 写入 ~/.ssh ", permissions: {} }), "申请权限：写入 ~/.ssh");
  assert.ok(overridable(denied.action));
  assert.ok(!overridable({ type: "writeStdin", approvalId: "a", processId: "p", stdin: "y\n", cwd: "/r" }));
  assert.ok(!overridable({ type: "requestPermissions", reason: null, permissions: {} }));
});

test("guardianEvent rebuilds the core assessment event in snake_case", () => {
  assert.deepEqual(guardianEvent("turn-3", denied), {
    id: "review-1",
    turn_id: "turn-3",
    started_at_ms: 1000,
    completed_at_ms: 2500,
    target_item_id: "item-9",
    status: "denied",
    risk_level: "high",
    user_authorization: "low",
    rationale: "Deletes files outside the workspace.",
    decision_source: "agent",
    action: { type: "apply_patch", cwd: "D:\\repo", files: ["D:\\repo\\a.ts", "D:\\repo\\b.ts"] },
  });
  const mcp = guardianEvent("t", {
    ...denied,
    targetItemId: null,
    completedAtMs: null,
    review: { status: "timedOut", riskLevel: null, userAuthorization: null, rationale: null },
    action: { type: "mcpToolCall", server: "github", toolName: "create_pr", connectorId: "c1", connectorName: "GitHub", toolTitle: null },
  });
  assert.equal(mcp.status, "timed_out");
  assert.deepEqual(mcp.action, { type: "mcp_tool_call", server: "github", tool_name: "create_pr", connector_id: "c1", connector_name: "GitHub", tool_title: null });
  assert.ok(!("target_item_id" in mcp) && !("completed_at_ms" in mcp) && !("risk_level" in mcp));
  const exec = guardianEvent("t", { ...denied, action: { type: "execve", source: "unifiedExec", program: "ls", argv: ["ls"], cwd: "/r" } });
  assert.deepEqual(exec.action, { type: "execve", source: "unified_exec", program: "ls", argv: ["ls"], cwd: "/r" });
});

test("notice copy", () => {
  assert.ok(!guardianWarningShown("Automatic approval review approved (low risk)"));
  assert.ok(guardianWarningShown("Automatic approval review denied the command"));
  assert.deepEqual(rerouteText("gpt-6-astra", "gpt-6-luna", "highRiskCyberActivity"), { text: "本轮已改用 gpt-6-luna（原为 gpt-6-astra）", detail: "检测到高风险网络安全活动" });
  assert.deepEqual(worldWritableText({ samplePaths: ["C:\\a", "C:\\b", "C:\\c", "C:\\d"], extraCount: 7, failedScan: false }), {
    title: "以下目录对所有用户可写，Windows 沙箱保护不到",
    detail: "C:\\a、C:\\b、C:\\c（另有 7 个）",
  });
  assert.equal(worldWritableText({ samplePaths: [], extraCount: 0, failedScan: true }).title, "无法检查哪些目录对所有用户可写");
});

test("mcpRuntimeStatus maps startup states onto connection statuses", () => {
  assert.equal(mcpRuntimeStatus("ready", null), "connected");
  assert.equal(mcpRuntimeStatus("starting", null), "starting");
  assert.equal(mcpRuntimeStatus("failed", null), "failed");
  assert.equal(mcpRuntimeStatus("failed", "reauthenticationRequired"), "authenticationRequired");
  assert.equal(mcpRuntimeStatus("cancelled", null), "cancelled");
});

test("upsertBy replaces in place or appends", () => {
  const list = [{ id: "a", v: 1 }, { id: "b", v: 1 }];
  assert.deepEqual(upsertBy(list, (x) => x.id, { id: "b", v: 2 }), [{ id: "a", v: 1 }, { id: "b", v: 2 }]);
  assert.deepEqual(upsertBy(list, (x) => x.id, { id: "c", v: 1 }).map((x) => x.id), ["a", "b", "c"]);
  assert.equal(list[1].v, 1);
});

test("base64 helpers round-trip UTF-8", () => {
  const text = "ls -la ~/项目\r\n";
  assert.equal(base64ToText(textToBase64(text)), text);
  assert.deepEqual([...base64ToBytes(textToBase64("é"))], [0xc3, 0xa9]);
});

test("finalAnswer prefers the last final_answer, then the last non-commentary reply", () => {
  const agent = (text, phase) => ({ type: "agentMessage", id: text, text, phase, memoryCitation: null, delivery: null, questions: null });
  const turns = [
    { startedAt: 2, items: [agent("看一下", "commentary"), agent("完成：已补齐表单校验。", "final_answer"), agent("顺带说明", null)] },
    { startedAt: 1, items: [agent("旧的回复", null)] },
  ];
  assert.equal(finalAnswer(turns), "完成：已补齐表单校验。");
  assert.equal(finalAnswer([{ startedAt: 1, items: [agent("只有过程", "commentary"), agent("答复", null)] }]), "答复");
  assert.equal(finalAnswer([{ startedAt: 1, items: [agent("只有过程", "commentary")] }]), null);
  assert.equal(finalAnswer([]), null);
});
