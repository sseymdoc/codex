// Run with `pnpm test` (Node >= 22.18 strips the TypeScript types of approvals.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { commandDecisions, commandSlots, fieldError, formContent, formShown, stdinInput } from "./approvals.ts";

const prefix = { acceptWithExecpolicyAmendment: { execpolicy_amendment: ["npm", "test"] } };
const allowHost = { applyNetworkPolicyAmendment: { network_policy_amendment: { host: "example.com", action: "allow" } } };
const denyHost = { applyNetworkPolicyAmendment: { network_policy_amendment: { host: "example.com", action: "deny" } } };

test("older servers get the server's default decisions", () => {
  assert.deepEqual(commandDecisions({ proposedExecpolicyAmendment: ["npm", "test"] }), ["accept", prefix, "cancel"]);
  assert.deepEqual(commandDecisions({ additionalPermissions: { network: { enabled: true } } }), ["accept", "cancel"]);
  assert.deepEqual(
    commandDecisions({ networkApprovalContext: { host: "example.com", protocol: "https" }, proposedNetworkPolicyAmendments: [denyHost.applyNetworkPolicyAmendment.network_policy_amendment, allowHost.applyNetworkPolicyAmendment.network_policy_amendment] }),
    ["accept", "acceptForSession", allowHost, "cancel"],
  );
  assert.deepEqual(commandDecisions({ availableDecisions: ["accept", "decline"] }), ["accept", "decline"]);
});

test("decisions fill Claude's deny / session / always / once slots", () => {
  assert.deepEqual(commandSlots(["accept", prefix, "cancel"]), { once: "accept", always: prefix, deny: "cancel" });
  // Decline wins the deny slot whatever the order; a host deny rule gets no slot.
  assert.deepEqual(commandSlots(["cancel", "accept", "acceptForSession", denyHost, allowHost, "decline"]), {
    deny: "decline",
    once: "accept",
    session: "acceptForSession",
    always: allowHost,
  });
  // A prefix spanning lines is never offered.
  assert.equal(commandSlots(["accept", { acceptWithExecpolicyAmendment: { execpolicy_amendment: ["bash", "-lc", "a\nb"] } }]).always, undefined);
});

test("form fields report the chat form's first problem", () => {
  assert.equal(fieldError({ type: "string" }, "  ", true), "此字段为必填项。");
  assert.equal(fieldError({ type: "boolean" }, false, true), "必须勾选此字段。");
  assert.equal(fieldError({ type: "array", items: { type: "string", enum: ["a"] } }, [], true), "请至少选择一个选项。");
  assert.equal(fieldError({ type: "array", items: { type: "string", enum: ["a", "b"] }, maxItems: 1 }, ["a", "b"], false), "最多选择 1 项。");
  assert.equal(fieldError({ type: "string", minLength: 3 }, "ab", false), "长度不得少于 3 个字符。");
  assert.equal(fieldError({ type: "string", format: "email" }, "a@b", false), "请输入有效的邮箱地址。");
  assert.equal(fieldError({ type: "string", format: "email" }, "a@b.co", false), null);
  assert.equal(fieldError({ type: "string", format: "uri" }, "ftp://x.y", false), "URL 必须以 http:// 或 https:// 开头。");
  assert.equal(fieldError({ type: "string", format: "uri" }, "nope", false), "请输入有效的 URL。");
  assert.equal(fieldError({ type: "string", format: "date" }, "0999-01-01", false), "请输入四位数年份。");
  assert.equal(fieldError({ type: "integer", minimum: 2 }, 1.5, false), "必须为整数。");
  assert.equal(fieldError({ type: "number", maximum: 2 }, 3, false), "不得超过 2。");
  assert.equal(fieldError({ type: "string" }, undefined, false), null);
});

test("form content keeps filled fields and sends date-times as instants", () => {
  const schema = {
    type: "object",
    properties: { name: { type: "string" }, note: { type: "string" }, ok: { type: "boolean" }, at: { type: "string", format: "date-time" } },
    required: ["name"],
  };
  const content = formContent(schema, { name: "x", note: "", ok: false, at: "2026-01-02T03:04" });
  assert.deepEqual(Object.keys(content), ["name", "ok", "at"]);
  assert.equal(content.at, new Date("2026-01-02T03:04").toISOString());
  assert.equal(formShown({ type: "object", properties: { pick: { type: "object" } }, required: ["pick"] }), false);
  assert.equal(formShown({ type: "object", properties: { pick: { type: "object" } } }), true);
});

test("stdin approvals show the input shlex quoted", () => {
  assert.equal(stdinInput("write_stdin --session-id 7 'ls -la\n'"), "ls -la\n");
  assert.equal(stdinInput(`write_stdin --session-id 7 'it'"'"'s'`), "it's");
  assert.equal(stdinInput(`write_stdin --session-id 7 "a\\"b\\$c"`), 'a"b$c');
  assert.equal(stdinInput("write_stdin --session-id 7 y"), "y");
  assert.equal(stdinInput("npm test"), null);
  assert.equal(stdinInput("write_stdin --session-id 7 'open"), null);
});
