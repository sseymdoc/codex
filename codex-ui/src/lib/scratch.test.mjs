// Run with `pnpm test`. scratch.ts against a fake bridge (fetch) and a stub "./codex" (thread/list).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { transformSync } from "esbuild";

const lists = [];
globalThis.__scratchCodexStub = {
  connectionId: () => "conn-1",
  whenReadsSettled: async () => {},
  call: async (method, params) => {
    assert.equal(method, "thread/list");
    lists.push(params);
    return globalThis.__scratchPages(params);
  },
};
const STUB = `data:text/javascript,${encodeURIComponent("const s = globalThis.__scratchCodexStub; export const connectionId = s.connectionId, call = s.call, whenReadsSettled = s.whenReadsSettled;")}`;
registerHooks({
  resolve: (specifier, context, next) => {
    if (specifier === "./codex" && context.parentURL?.endsWith("/scratch.ts")) return { url: STUB, shortCircuit: true };
    return next(/^\.\.?\/[^.]+$/.test(specifier) && context.parentURL?.endsWith(".ts") ? `${specifier}.ts` : specifier, context);
  },
  load: (url, context, next) =>
    url.startsWith("file:") && url.endsWith(".ts") ? { format: "module", shortCircuit: true, source: transformSync(readFileSync(new URL(url), "utf8"), { loader: "ts", format: "esm" }).code } : next(url, context),
});
const { inScratch, sweepScratch } = await import("./scratch.ts");

const ROOT = "C:\\Users\\me\\.codex\\codex-ui\\scratch-workspaces";
const [held, orphan, archived, paged] = ["held", "orphan", "archived", "paged"].map((name) => `${ROOT}\\scratch-2026-10-20-${name}`);

test("the sweep removes only the stale workspaces no session, archived or on a later page, works in", async (t) => {
  lists.length = 0;
  globalThis.__scratchPages = ({ archived: inArchive, cursor }) =>
    inArchive ? { data: [{ cwd: archived }], nextCursor: null }
    : cursor === "p2" ? { data: [{ cwd: paged }], nextCursor: null }
    : { data: [{ cwd: held.replaceAll("\\", "/").toUpperCase() }], nextCursor: "p2" };
  const removed = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    if (url === "/api/scratch?c=conn-1" && init.method === "GET") return Response.json({ paths: [held, orphan, archived, paged] });
    const match = /^\/api\/scratch\/remove\?c=conn-1&path=(.+)$/.exec(url);
    assert.ok(match && init.method === "POST", url);
    removed.push(decodeURIComponent(match[1]));
    return Response.json({ removed: true });
  });
  await sweepScratch();
  assert.deepEqual(removed, [orphan]);
  // Every provider and source, both archive states, every page.
  assert.deepEqual(lists.map(({ archived: a, cursor }) => [a, cursor]), [[false, null], [false, "p2"], [true, null]]);
  for (const params of lists) {
    assert.deepEqual(params.cwd, [held, orphan, archived, paged]);
    assert.deepEqual(params.modelProviders, []);
    assert.ok(params.sourceKinds.includes("cli") && params.sourceKinds.includes("subAgent"));
  }
});

test("the sweep asks nothing of Codex when no workspace is stale, and removes nothing when a listing fails", async (t) => {
  lists.length = 0;
  t.mock.method(globalThis, "fetch", async () => Response.json({ paths: [] }));
  await sweepScratch();
  assert.equal(lists.length, 0);
  globalThis.__scratchPages = () => { throw new Error("thread/list failed"); };
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url) => (calls.push(url), Response.json({ paths: [orphan] })));
  await assert.rejects(sweepScratch(), /thread\/list failed/);
  assert.deepEqual(calls, ["/api/scratch?c=conn-1"]);
});

test("inScratch knows the scratch root under CODEX_HOME, whatever the separators or case", () => {
  const home = "C:\\Users\\me\\.codex";
  assert.equal(inScratch(orphan, home), true);
  assert.equal(inScratch("c:/users/ME/.codex/codex-ui/scratch-workspaces/scratch-x", home), true);
  for (const path of [ROOT, `${home}\\codex-ui\\automations\\a`, "D:\\work", "", null]) assert.equal(inScratch(path, home), false);
  assert.equal(inScratch(orphan, null), false);
});
