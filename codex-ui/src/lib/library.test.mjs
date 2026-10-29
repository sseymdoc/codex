// Run with `pnpm test`. library.ts against a fake ChatGPT behind a fake bridge: fetch answers
// /api/cloud as server/bridge.mjs does ({ status, body }) and /api/library/available with its
// gates, "./codex" is a stub and localStorage a map, so no app-server, login or network is involved.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { transformSync } from "esbuild";
import { cloudAllowed } from "../../server/cloud.mjs";

globalThis.requestAnimationFrame ??= (callback) => setTimeout(callback, 0);
const saved = new Map();
globalThis.localStorage = { getItem: (key) => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, String(value)), removeItem: (key) => saved.delete(key) };
globalThis.__libraryCodexStub = { connectionId: () => "conn-1", callExperimental: async () => {}, errorMessage: (error) => String(error) };
const STUB = `data:text/javascript,${encodeURIComponent("const s = globalThis.__libraryCodexStub; export const connectionId = s.connectionId, callExperimental = s.callExperimental, errorMessage = s.errorMessage;")}`;
registerHooks({
  resolve: (specifier, context, next) => {
    if (specifier === "./codex" && /\/(cloud|library)\.ts$/.test(context.parentURL ?? "")) return { url: STUB, shortCircuit: true };
    return next(/^\.\.?\/[^.]+$/.test(specifier) && context.parentURL?.endsWith(".ts") ? `${specifier}.ts` : specifier, context);
  },
  load: (url, context, next) =>
    url.startsWith("file:") && url.endsWith(".ts") ? { format: "module", shortCircuit: true, source: transformSync(readFileSync(new URL(url), "utf8"), { loader: "ts", format: "esm" }).code } : next(url, context),
});
const library = await import("./library.ts");

/**
 * A fake ChatGPT: `routes` maps "METHOD path" to a body or (body, calls) => [status, body] (a
 * status of 0 is the bridge failing); every call is logged and checked against the bridge's routes.
 */
function chatgpt(t, routes, gates = { available: true, favorites: true, storageBanner: true, notes: false }) {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    if (url === "/api/library/available?c=conn-1") return new Response(JSON.stringify(gates), { status: 200 });
    assert.equal(url, "/api/cloud?c=conn-1");
    const { method, path, body } = JSON.parse(init.body);
    calls.push({ method, path, body });
    assert.ok(cloudAllowed(method, path), `the bridge refuses ${method} ${path}`);
    const route = routes[`${method} ${path}`];
    const [status, answer] = route === undefined ? [404, { detail: "Not Found" }] : typeof route === "function" ? route(body, calls) : [200, route];
    if (status === 0) return new Response("无法连接 ChatGPT（socket hang up）", { status: 502 });
    return new Response(JSON.stringify({ status, body: answer }), { status: 200 });
  });
  return calls;
}

const at = (query) => ({ tab: "suggested", directoryId: null, deleted: false, search: "", categories: [], sources: [], ...query });
let accounts = 0;
/** A fresh account each test: nothing cached from the one before. */
const fresh = () => library.resetLibrary(`user${++accounts}@example.com`);

const NODES = "/files/library/nodes?entry_surface=library";
const NODE_FLAGS = "include_saved_entities=true&include_sites=false&include_folder_counts=false&include_onedrive=false";

test("each location asks what the desktop app's OX asks, and the bridge lets every call through", () => {
  const cases = [
    // 推荐: ranked, saved entities in, no sites, no drive providers.
    [at({}), "POST", "/files/library", { limit: 50, include_saved_entities: true, include_sites: false, ranking: "suggested", providers: [] }],
    [at({ categories: ["documents", "pdfs"], sources: ["generated"] }), "POST", "/files/library", { limit: 50, categories: ["documents", "pdfs"], source: "generated", include_saved_entities: true, include_sites: false, ranking: "suggested", providers: [] }],
    // Two sources are no filter: the server takes one string.
    [at({ sources: ["uploaded", "generated"] }), "POST", "/files/library", { limit: 50, include_saved_entities: true, include_sites: false, ranking: "suggested", providers: [] }],
    // 图像's root: the singular category, no ranking.
    [at({ tab: "images" }), "POST", "/files/library", { limit: 50, categories: ["image"], include_saved_entities: true, include_sites: false }],
    [at({ tab: "images", sources: ["uploaded"] }), "POST", "/files/library", { limit: 50, categories: ["image"], source: "uploaded", include_saved_entities: true, include_sites: false }],
    // 全部 and 文件夹: nodes, files left out on 文件夹's root only.
    [at({ tab: "all" }), "GET", `${NODES}&include_hidden_files=false&include_files=true&${NODE_FLAGS}`, undefined],
    [at({ tab: "folders" }), "GET", `${NODES}&include_hidden_files=false&include_files=false&${NODE_FLAGS}`, undefined],
    // A folder (its id need not be libdir_), filters as repeated keys.
    [at({ tab: "folders", directoryId: "9f3c", categories: ["images", "pdfs"], sources: ["uploaded"] }), "GET", `${NODES}&parent_directory_id=9f3c&categories=images&categories=pdfs&source=uploaded&include_hidden_files=false&include_files=true&${NODE_FLAGS}`, undefined],
    // The trash first of all, its own search included.
    [at({ tab: "all", deleted: true }), "POST", "/files/library", { limit: 50, include_saved_entities: true, include_sites: false, trashed_only: true }],
    [at({ tab: "all", deleted: true, search: " 报告 ", categories: ["documents"] }), "POST", "/files/library", { limit: 50, q: "报告", categories: ["documents"], include_saved_entities: true, include_sites: false, trashed_only: true }],
    // The favorites' root before a search: filtered here, nothing sent.
    [at({ tab: "favorites", search: "x", categories: ["pdfs"] }), "GET", "/files/library/favorites?limit=50&include_sites=false", undefined],
    // A search: 20 a page, the library's lanes, native files only; in a folder, the folder's own provider (dJi).
    [at({ tab: "all", search: "季度" }), "POST", "/global/search", { query: "季度", limit: 20, entrypoint: "library_page", source_requests: [{ type: "library", filters: { lanes: ["image", "document", "folder"], library_providers: ["native", "native_shared"] } }] }],
    [at({ tab: "images", directoryId: "libdir_a", search: "图", categories: ["images"], sources: ["generated"] }), "POST", "/global/search", { query: "图", limit: 20, entrypoint: "library_page", source_requests: [{ type: "library", filters: { lanes: ["image", "document", "folder"], library_providers: ["native"], file_types: ["images"], source: "generated", directory_id: "libdir_a" } }] }],
  ];
  for (const [query, method, path, body] of cases) {
    const request = library.libraryRequest(query, null);
    assert.deepEqual(request, { method, path, ...(body ? { body } : {}) }, JSON.stringify(query));
    assert.ok(cloudAllowed(method, path), path);
  }
  // A cursor rides along: in the body, or the query.
  assert.equal(library.libraryRequest(at({ tab: "all" }), "c/1+2").path.includes("&cursor=c%2F1%2B2&"), true);
  assert.equal(library.libraryRequest(at({}), "next").body.cursor, "next");
  assert.ok(library.libraryRequest(at({ tab: "favorites" }), "f2").path.startsWith("/files/library/favorites?cursor=f2&"));
});

test("what each location shows: filters, file types, the view toggle, dates and sorting", () => {
  assert.equal(library.filtersShown(at({ tab: "folders" })), false);
  assert.equal(library.filtersShown(at({ tab: "folders", directoryId: "d" })), true);
  assert.equal(library.filtersShown(at({ tab: "folders", search: "a" })), true);
  assert.equal(library.typesShown(at({ tab: "images" })), false);
  assert.equal(library.typesShown(at({ tab: "images", search: "a" })), true);
  assert.equal(library.typesShown(at({ tab: "all", deleted: true })), true);
  // 图像's root is a grid with no toggle, searched or not (rEo); the image wall only unsearched.
  assert.deepEqual([at({ tab: "images" }), at({ tab: "images", search: "a" }), at({ tab: "images", directoryId: "d" }), at({ tab: "images", deleted: true })].map(library.gridOnly), [true, true, false, false]);
  assert.equal(library.imagesRoot(at({ tab: "images" })), true);
  assert.equal(library.imagesRoot(at({ tab: "images", search: "a" })), false);
  assert.deepEqual(
    [at({}), at({ tab: "all", search: "a" }), at({ tab: "all", deleted: true }), at({ tab: "favorites" }), at({ tab: "all" }), at({ tab: "all", directoryId: "d" })].map(library.dateKind),
    ["suggested", "suggested", "deleted", "saved", "modified", "modified"],
  );
  assert.deepEqual([at({ tab: "all" }), at({ tab: "all", deleted: true }), at({ tab: "favorites" }), at({ tab: "all", search: "a" }), at({ tab: "favorites", directoryId: "d" })].map(library.sortable), [true, false, false, false, true]);
});

test("both item shapes read as one; drive items are dropped; search times are seconds", () => {
  const folder = library.parseNode({ id: "4be0c1", kind: "directory", name: "项目", parent_directory_id: null, is_root: false, updated_at: "2026-10-28T10:00:00Z" });
  assert.deepEqual([folder.kind, folder.name, folder.parentId, folder.thumbnail], ["directory", "项目", null, false]);
  const file = library.parseNode({ id: "libfile_1", file_id: "file_1", file_name: "a.png", directory_id: "libdir_2", content_backing_kind: "sediment", mime_type: "image/png", file_size_bytes: 42, library_file_category: "image", library_artifact_type: null, file_upload_time: "2026-10-27T00:00:00Z", thumbnail_url: "https://chatgpt.com/library/files/libfile_1/thumbnail" });
  assert.deepEqual([file.kind, file.name, file.parentId, file.fileId, file.size, file.artifact, file.thumbnail, file.updatedAt], ["file", "a.png", "libdir_2", "file_1", 42, null, true, Date.parse("2026-10-27T00:00:00Z")]);
  assert.equal(library.parseNode({ id: "libdir_g", kind: "directory", name: "Google Drive", access_kind: "mounted" }), null);
  assert.equal(library.parseNode({ id: "external-gdrive:account:k:file:x", name: "doc" }), null);
  assert.equal(library.parseNode({ id: "library:collection:shared-with-me", kind: "directory", name: "与我共享" }), null);

  const hit = library.parseSearchResult({ id: "r1", source_type: "library", title: "季度报告.md", update_time: 1793000000, payload: { library_item_id: "libfile_9", parent_directory_id: "libdir_1", last_used_at: "2026-10-28T00:00:00Z", file_size_bytes: 7 } });
  assert.deepEqual([hit.id, hit.kind, hit.name, hit.parentId, hit.updatedAt, hit.size], ["libfile_9", "file", "季度报告.md", "libdir_1", 1793000000000, 7]);
  const dir = library.parseSearchResult({ source_type: "library", title: "归档", update_time: 1793000000, payload: { library_file: { directory_id: "libdir_7" } } });
  assert.deepEqual([dir.id, dir.kind, dir.name], ["libdir_7", "directory", "归档"]);
  assert.equal(library.parseSearchResult({ source_type: "conversation", title: "x", payload: { library_item_id: "libfile_1" } }), null);
});

test("pages follow the cursor, a dropped cursor starts over, and a list is kept 30 s", async (t) => {
  fresh();
  const query = at({ tab: "all" });
  const first = library.libraryRequest(query, null).path;
  const second = library.libraryRequest(query, "p2").path;
  let restart = true;
  const calls = chatgpt(t, {
    [`GET ${first}`]: { items: [{ id: "libfile_a", kind: "file", name: "a" }, { id: "libdir_m", kind: "directory", name: "Drive", access_kind: "mounted" }], cursor: "p2" },
    [`GET ${second}`]: () => (restart ? ((restart = false), [409, { detail: "page_cursor_restart_required" }]) : [200, { items: [{ id: "libfile_b", kind: "file", name: "b" }, { id: "libfile_a", kind: "file", name: "a" }], cursor: null }]),
  });
  await library.loadLibrary(query);
  const key = library.listKey(query);
  assert.deepEqual(library.libraryState().lists[key].items.map((node) => node.id), ["libfile_a"]);
  // Again within 30 s: no call.
  await library.loadLibrary(query);
  assert.equal(calls.length, 1);
  // The next page's cursor is refused: the list starts again from the first page.
  await library.loadLibrary(query, "more");
  assert.deepEqual(calls.map((call) => call.path), [first, second, first]);
  await library.loadLibrary(query, "more");
  const list = library.libraryState().lists[key];
  assert.deepEqual([list.items.map((node) => node.id), list.cursor, list.failed], [["libfile_a", "libfile_b"], null, null]);
  // A change anywhere: the list reads anew, keeping what it shows meanwhile.
  library.invalidateLibrary();
  assert.equal(library.libraryState().lists[key].items.length, 2);
  await library.loadLibrary(query);
  assert.equal(calls.length, 5);
});

test("a cursor dropped again fails instead of starting over in a loop; 重试 starts over", async (t) => {
  fresh();
  const query = at({ tab: "all" });
  const first = library.libraryRequest(query, null).path;
  const second = library.libraryRequest(query, "p2").path;
  const calls = chatgpt(t, {
    [`GET ${first}`]: { items: [{ id: "libfile_a", kind: "file", name: "a" }], cursor: "p2" },
    [`GET ${second}`]: () => [409, { detail: "page_cursor_restart_required" }],
  });
  await library.loadLibrary(query);
  await library.loadLibrary(query, "more");
  await library.loadLibrary(query, "more");
  // One first page more, then the failure: no cursor to retry from.
  assert.deepEqual(calls.map((call) => call.path), [first, second, first, second]);
  const list = library.libraryState().lists[library.listKey(query)];
  assert.deepEqual([list.items.map((node) => node.id), list.failed], [["libfile_a"], { status: 409, cursor: null }]);
  // The sentinel is gone while it fails; 重试 reads the first page.
  await library.loadLibrary(query, "refresh");
  assert.deepEqual(calls.map((call) => call.path), [first, second, first, second, first]);
  assert.equal(library.libraryState().lists[library.listKey(query)].failed, null);
});

test("the trash is asked whether it is empty on every visit; a folder's path is kept a minute, a failed one not at all", async (t) => {
  fresh();
  let trashed = [];
  let pathFails = true;
  const calls = chatgpt(t, {
    "POST /files/library": (body) => [200, body.trashed_only && body.limit === 1 && body.include_hidden_files ? { items: trashed } : { items: [] }],
    "GET /files/library/directories/path?directory_id=libdir_a": () => (pathFails ? [500, { detail: "x" }] : [200, { items: [{ id: "root", is_root: true }, { id: "libdir_a", name: "项目" }] }]),
  });
  await library.loadTrashEmpty();
  assert.equal(library.libraryState().trashEmpty, true);
  // Trashed elsewhere meanwhile: the next visit says so.
  trashed = [{ id: "libfile_t" }];
  await Promise.all([library.loadTrashEmpty(), library.loadTrashEmpty()]);
  assert.equal(library.libraryState().trashEmpty, false);
  assert.equal(calls.filter((call) => call.path === "/files/library").length, 2, "one call at a time");

  await library.loadPath("libdir_a");
  assert.equal(library.libraryState().paths.libdir_a, undefined);
  pathFails = false;
  await library.loadPath("libdir_a");
  assert.deepEqual(library.libraryState().paths.libdir_a.crumbs, [{ id: "libdir_a", name: "项目" }]);
  await library.loadPath("libdir_a");
  const pathCalls = () => calls.filter((call) => call.path.startsWith("/files/library/directories/path")).length;
  assert.equal(pathCalls(), 2);
  t.mock.method(Date, "now", () => library.libraryState().paths.libdir_a.at + 60_001);
  await library.loadPath("libdir_a");
  assert.equal(pathCalls(), 3);
});

test("a blip does not take the library from an account that has it; a verdict does", async (t) => {
  library.resetLibrary("blip@example.com");
  let answer = () => new Response(JSON.stringify({ available: true, favorites: true, storageBanner: false, notes: false }), { status: 200 });
  t.mock.method(globalThis, "fetch", async () => answer());
  const available = () => library.libraryState().available.available;
  await library.refreshLibraryAvailable(true);
  assert.equal(available(), true);
  for (const blip of [() => { throw new TypeError("fetch failed"); }, () => new Response("bad gateway", { status: 502 }), ...["unreachable", "accounts_unavailable", "statsig_unavailable", "settings_unavailable"].map((reason) => () => new Response(JSON.stringify({ available: false, reason }), { status: 200 }))]) {
    answer = blip;
    await library.refreshLibraryAvailable(true);
    assert.equal(available(), true);
  }
  answer = () => new Response(JSON.stringify({ available: false, reason: "gate_closed" }), { status: 200 });
  await library.refreshLibraryAvailable(true);
  assert.equal(available(), false);
  // Never known: a blip hides the entry.
  library.resetLibrary("blip2@example.com");
  answer = () => new Response("bad gateway", { status: 502 });
  await library.refreshLibraryAvailable(true);
  assert.equal(available(), false);
});

test("a failed page keeps what was shown and says which page to retry", async (t) => {
  fresh();
  const query = at({ tab: "all", directoryId: "libdir_x" });
  const path = library.libraryRequest(query, null).path;
  let status = 404;
  chatgpt(t, { [`GET ${path}`]: () => [status, status === 200 ? { items: [{ id: "libfile_1", kind: "file", name: "x" }], cursor: "n" } : { detail: "Not Found" }] });
  await library.loadLibrary(query);
  assert.deepEqual(library.libraryState().lists[library.listKey(query)].failed, { status: 404, cursor: null });
  status = 200;
  await library.loadLibrary(query);
  assert.equal(library.libraryState().lists[library.listKey(query)].items.length, 1);
});

test("favorites: available ones only, filtered here by name, source and type, read on while filtered", async (t) => {
  fresh();
  const favorite = (id, name, extra = {}) => ({ favorite_id: `fav_${id}`, created_at: "2026-10-20T00:00:00Z", availability: "available", item: { id, file_name: name, ...extra } });
  const query = at({ tab: "favorites", search: "报", categories: ["pdfs"], sources: ["uploaded"] });
  const page1 = library.libraryRequest(query, null).path;
  const page2 = library.libraryRequest(query, "f2").path;
  const calls = chatgpt(t, {
    [`GET ${page1}`]: { items: [favorite("libfile_1", "年报.pdf"), favorite("libfile_2", "周报.pdf", { library_artifact_type: "report" }), { favorite_id: "x", availability: "unavailable", item: { id: "libfile_3", file_name: "旧报.pdf" } }], cursor: "f2" },
    [`GET ${page2}`]: { items: [favorite("libfile_4", "日报.docx"), favorite("libfile_5", "月报.PDF", { saved_entity: { display_data: { name: "月报" } }, mime_type: "application/pdf" })], cursor: null },
  });
  await library.loadLibrary(query);
  const list = library.libraryState().lists[library.listKey(query)];
  assert.deepEqual(list.items.map((node) => [node.id, node.name]), [["libfile_1", "年报.pdf"], ["libfile_5", "月报"]]);
  assert.equal(list.items[0].savedAt, Date.parse("2026-10-20T00:00:00Z"));
  assert.equal(calls.length, 2);
});

test("a search reads its results and says when a source answered in part", async (t) => {
  fresh();
  const query = at({ tab: "all", search: "a" });
  const { path } = library.libraryRequest(query, null);
  chatgpt(t, {
    [`POST ${path}`]: { items: [{ id: "r", source_type: "library", title: "a.txt", update_time: 1, payload: { library_item_id: "libfile_a" } }], cursor: null, source_statuses: [{ source_type: "library", source_key: "library", status: "ok", has_more: false, provider_statuses: [{ provider: "native", status: "error" }] }] },
  });
  await library.loadLibrary(query);
  const list = library.libraryState().lists[library.listKey(query)];
  assert.deepEqual([list.items[0].name, list.incomplete], ["a.txt", true]);
});

test("a search's sources keep their last word across pages, and partial_results says it for them (xJi, Dt)", async (t) => {
  fresh();
  const query = at({ tab: "all", search: "b" });
  const status = (key, value) => ({ source_type: key, source_key: key, status: value, has_more: false });
  const pages = {
    first: { items: [], cursor: "s2", source_statuses: [status("library", "error"), status("connectors", "error")] },
    // library answers in full now; connectors says nothing more, so its error stands.
    s2: { items: [], cursor: "s3", source_statuses: [status("library", "ok")] },
    s3: { items: [], cursor: null, partial_results: true, source_statuses: [] },
  };
  chatgpt(t, { [`POST ${library.libraryRequest(query, null).path}`]: (body) => [200, pages[body.cursor ?? "first"]] });
  const seen = async (mode) => {
    await library.loadLibrary(query, mode);
    return library.libraryState().lists[library.listKey(query)].incomplete;
  };
  assert.equal(await seen(), true);
  assert.equal(await seen("more"), true);
  assert.equal(await seen("more"), false);
});

test("the list headers sort here: folders first, keys cycled, unknowns last", () => {
  const node = (id, kind, name, size, updatedAt) => ({ id, kind, name, size, updatedAt, lastUsedAt: null, trashedAt: null, savedAt: null });
  const items = [node("1", "file", "b10", 5, 3), node("2", "file", "b9", null, 1), node("3", "directory", "z", null, 2), node("4", "file", "a", 50, null)];
  const ids = (sort, kind = "modified") => library.sortNodes(items, sort, kind).map((n) => n.id);
  assert.deepEqual(ids({ key: "name", direction: "asc" }), ["3", "4", "2", "1"]);
  assert.deepEqual(ids({ key: "size", direction: "desc" }), ["3", "4", "1", "2"]);
  assert.deepEqual(ids({ key: "date", direction: "asc" }), ["3", "2", "1", "4"]);
  // In the trash folders take no lead.
  assert.deepEqual(library.sortNodes(items, { key: "name", direction: "desc" }, "deleted").map((n) => n.id), ["3", "1", "2", "4"]);
  assert.deepEqual(library.nextSort(null, "name"), { key: "name", direction: "asc" });
  assert.deepEqual(library.nextSort({ key: "name", direction: "asc" }, "name"), { key: "name", direction: "desc" });
  assert.equal(library.nextSort({ key: "name", direction: "desc" }, "name"), null);
  assert.deepEqual(library.nextSort({ key: "name", direction: "asc" }, "size"), { key: "size", direction: "desc" });
  // Last activity is the later of use and change.
  assert.equal(library.nodeDate({ ...node("x", "file", "x", 0, 10), lastUsedAt: 20 }, "suggested"), 20);
  assert.equal(library.nodeDate({ ...node("x", "file", "x", 0, 30), lastUsedAt: 20 }, "suggested"), 30);
});

test("availability, preferences and storage are the account's own", async (t) => {
  library.resetLibrary("prefs@example.com");
  chatgpt(t, {
    "GET /files/library/storage/usage": { used_bytes: 95, allowed_bytes: 100, remaining_bytes: 5, is_over_limit: false, limit_tier: "plus", plan_type: "plus" },
    "POST /files/library": (body) => [200, body.trashed_only && body.limit === 1 && body.include_hidden_files ? { items: [] } : { items: [{ id: "x" }] }],
  }, { available: true, favorites: false, storageBanner: true, notes: true, reason: "ignored" });
  await library.refreshLibraryAvailable(true);
  assert.deepEqual(library.libraryState().available, { available: true, favorites: false, storageBanner: true, notes: true });

  assert.deepEqual(library.libraryPrefs(), { viewMode: "grid", lastTab: "suggested" });
  library.setLibraryPrefs({ viewMode: "list", lastTab: "images" });
  assert.deepEqual(JSON.parse(saved.get("codex-ui:library:prefs@example.com")), { viewMode: "list", lastTab: "images" });
  library.resetLibrary("other@example.com");
  assert.deepEqual(library.libraryPrefs(), { viewMode: "grid", lastTab: "suggested" });
  library.resetLibrary("prefs@example.com");
  assert.deepEqual(library.libraryPrefs(), { viewMode: "list", lastTab: "images" });

  await library.loadStorage();
  const usage = library.libraryState().storage;
  assert.equal(library.storageLevel(usage), "almostFull");
  assert.equal(library.canUpgrade(usage), true);
  assert.equal(library.storageLevel({ ...usage, remainingBytes: 0 }), "full");
  assert.equal(library.storageLevel({ ...usage, remainingBytes: 50 }), null);
  assert.equal(library.canUpgrade({ ...usage, limitTier: "free", planType: "team" }), false);
  assert.equal(library.canUpgrade({ ...usage, limitTier: "pro" }), false);

  await library.loadTrashEmpty();
  assert.equal(library.libraryState().trashEmpty, true);
});

test("content addresses name the file and carry the node, or a version's file id", () => {
  const node = { id: "libfile_1", name: "季度 报告.pdf", fileId: "file_1" };
  assert.equal(library.libraryContentUrl(node, "thumbnail"), "/api/library/content/%E5%AD%A3%E5%BA%A6%20%E6%8A%A5%E5%91%8A.pdf?c=conn-1&id=libfile_1&kind=thumbnail&fileId=file_1");
  assert.ok(library.libraryContentUrl(node, "content", "file_v2").endsWith("&kind=content&fileId=file_v2"));
  assert.ok(library.libraryContentUrl({ ...node, fileId: null }, "download").endsWith("id=libfile_1&kind=download"));
});
