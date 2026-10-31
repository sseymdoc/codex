import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createChatStore } from "./chat-store.mjs";

test("history survives restart, separates accounts, and deletes only its selected record", () => {
  const root = mkdtempSync(path.join(tmpdir(), "siwc-history-"));
  const store = createChatStore(root);
  const first = store.create("profile-a", "model-a"), second = store.create("profile-a", "model-b");
  first.turns.push({ id: randomUUID(), user: "你好", assistant: "您好", model: "model-a", status: "completed" });
  store.write(first);
  assert.deepEqual(createChatStore(root).read("profile-a", first.id), first);
  assert.deepEqual(store.list("profile-b"), []);
  assert.throws(() => store.read("profile-b", first.id), { code: "ENOENT" });
  store.remove("profile-a", first.id);
  assert.equal(store.read("profile-a", second.id).id, second.id);
});

test("corrupt history stays visible and byte-preserved; client paths cannot escape the account", () => {
  const root = mkdtempSync(path.join(tmpdir(), "siwc-history-"));
  const store = createChatStore(root), chat = store.create("account", "model");
  const file = path.join(root, "account", `${chat.id}.json`);
  writeFileSync(file, "incomplete original bytes");
  assert.throws(() => store.read("account", chat.id), { code: "history_invalid" });
  assert.equal(store.list("account")[0].unreadable, true);
  assert.equal(readFileSync(file, "utf8"), "incomplete original bytes");
  assert.throws(() => store.read("../outside", chat.id), { code: "history_invalid" });
  assert.throws(() => store.remove("account", "../../outside"), { code: "history_invalid" });
});
