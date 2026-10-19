// Run with `pnpm test`. codex.ts imports its siblings without an extension and rpc.ts has parameter
// properties, which Node's type stripping alone cannot load: these hooks add ".ts" and transform.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { test } from "node:test";

registerHooks({
  resolve: (specifier, context, next) => next(/^\.\.?\/[^.]+$/.test(specifier) && context.parentURL?.endsWith(".ts") ? `${specifier}.ts` : specifier, context),
  load: (url, context, next) =>
    url.startsWith("file:") && url.endsWith(".ts") ? { format: "module", shortCircuit: true, source: stripTypeScriptTypes(readFileSync(new URL(url), "utf8"), { mode: "transform" }) } : next(url, context),
});
// setState notifies subscribers once per frame.
globalThis.requestAnimationFrame ??= (callback) => setTimeout(callback, 0);
const { Rpc } = await import("./rpc.ts");
const { getState, setState } = await import("./store.ts");
const { isArchivedThread, refreshThreads, unarchiveThread } = await import("./codex.ts");

test("取消归档 brings back the sub-agents archived with a session; only one that fails stays in 已归档", async () => {
  // p spawned c1, c1 spawned c2, and thread/archive took all three; c2 fails to come back.
  const parents = { p: null, c1: "p", c2: "c1" };
  const archived = new Set(Object.keys(parents));
  const unarchived = [];
  const under = (id, ancestor) => {
    for (let at = parents[id]; at; at = parents[at]) if (at === ancestor) return true;
    return false;
  };
  const thread = (id) => ({
    id,
    preview: id,
    ephemeral: false,
    parentThreadId: parents[id],
    source: parents[id] ? { subAgent: { thread_spawn: { parent_thread_id: parents[id], depth: 1, agent_nickname: id } } } : "cli",
  });
  Rpc.prototype.request = async (method, params) => {
    if (method === "thread/list") {
      const ids = Object.keys(parents).filter((id) => archived.has(id) === params.archived && (!params.ancestorThreadId || under(id, params.ancestorThreadId)));
      return { data: ids.map(thread), nextCursor: null };
    }
    if (method === "thread/unarchive" && params.threadId !== "c2") {
      archived.delete(params.threadId);
      unarchived.push(params.threadId);
      return {};
    }
    throw new Error(`${method} ${params.threadId} failed`);
  };
  setState((s) => ({ list: { ...s.list, status: "archived", archived: true } }));
  await refreshThreads();
  assert.deepEqual(getState().list.ids, ["p", "c1", "c2"]);

  await unarchiveThread("p");
  assert.deepEqual(unarchived, ["p", "c1"]);
  assert.deepEqual(getState().list.ids, ["c2"]);
  assert.deepEqual(["p", "c1", "c2"].map(isArchivedThread), [false, false, true]);
});
