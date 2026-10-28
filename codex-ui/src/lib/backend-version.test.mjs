// Run with `pnpm test` (Node >= 22.18 strips the TypeScript types of backend-version.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { CAPABILITIES, backendMismatch, mismatchText } from "./backend-version.ts";

const base = { userAgent: "codex_ui/0.164.0", codexHome: "C:/home/.codex", platformFamily: "windows", platformOs: "windows" };
const current = { ...base, ...Object.fromEntries(Object.keys(CAPABILITIES).map((key) => [key, key === "codexUiHostContextMaxBytes" ? 524288 : true])) };

test("a matching experimental backend, or none, is no mismatch", () => {
  assert.equal(backendMismatch(true, current), null);
  assert.equal(backendMismatch(true, null), null);
  // Disabled: the native backend reports none of the fields, and that is expected.
  assert.equal(backendMismatch(false, base), null);
});

test("an older backend names what it lacks; a native binary run as experimental lacks everything", () => {
  const { codexUiBackgroundTerminals, codexUiStdioEnvironments, ...older } = current;
  const mismatch = backendMismatch(true, older);
  assert.deepEqual(mismatch, { missing: ["SSH 环境", "在后台运行命令"], newer: false });
  assert.equal(mismatchText(mismatch), "实验型后端版本不匹配，部分功能不可用。");
  assert.match(mismatchText(mismatch, true), /旧，缺少SSH 环境、在后台运行命令。$/);
  assert.deepEqual(backendMismatch(true, base).missing, Object.values(CAPABILITIES));
});

test("fields this UI does not know mean a newer backend", () => {
  const mismatch = backendMismatch(true, { ...current, codexUiFutureThing: true });
  assert.deepEqual(mismatch, { missing: [], newer: true });
  assert.match(mismatchText(mismatch, true), /请更新 Codex UI/);
});
