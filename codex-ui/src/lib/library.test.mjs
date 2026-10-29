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
const opened = [];
globalThis.__libraryCodexStub = { connectionId: () => "conn-1", callExperimental: async () => {}, errorMessage: (error) => String(error), openLibrary: (route) => opened.push(route) };
const STUB = `data:text/javascript,${encodeURIComponent("const s = globalThis.__libraryCodexStub; export const connectionId = s.connectionId, callExperimental = s.callExperimental, errorMessage = s.errorMessage, openLibrary = s.openLibrary;")}`;
registerHooks({
  resolve: (specifier, context, next) => {
    if (specifier === "./codex" && /\/(cloud|library)\.ts$/.test(context.parentURL ?? "")) return { url: STUB, shortCircuit: true };
    return next(/^\.\.?\/[^.]+$/.test(specifier) && context.parentURL?.endsWith(".ts") ? `${specifier}.ts` : specifier, context);
  },
  load: (url, context, next) =>
    url.startsWith("file:") && url.endsWith(".ts") ? { format: "module", shortCircuit: true, source: transformSync(readFileSync(new URL(url), "utf8"), { loader: "ts", format: "esm" }).code } : next(url, context),
});
const library = await import("./library.ts");
const store = await import("./store.ts");

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
  assert.deepEqual([dir.id, dir.kind, dir.name, dir.parentId], ["libdir_7", "directory", "归档", null]);
  // A folder's directory_id is its own: a root folder's parent is none, not itself (bJi).
  const rootFolder = library.parseSearchResult({ source_type: "library", title: "F", payload: { directory_id: "libdir_F", parent_directory_id: null } });
  assert.deepEqual([rootFolder.id, rootFolder.parentId], ["libdir_F", null]);
  assert.equal(library.parseSearchResult({ source_type: "library", title: "G", payload: { directory_id: "libdir_G", parent_directory_id: "libdir_P" } }).parentId, "libdir_P");
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
  // A second ask while one runs waits for that one's answer (the move's folder check reads it after).
  const first = library.loadPath("libdir_a");
  await library.loadPath("libdir_a");
  assert.deepEqual(library.libraryState().paths.libdir_a.crumbs, [{ id: "libdir_a", name: "项目" }]);
  await first;
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

// ---------------------------------------------------------------------------
// Changes (MCs / NCs) and uploads

const titles = () => store.getState().toasts.map((toast) => toast.title);
/** No toast left, nor its timer. */
function clearToasts() {
  for (const toast of store.getState().toasts) store.dismissToast(toast.id);
  store.setState({ toasts: [] });
}
const file = (id, extra = {}) => library.parseNode({ id, kind: "file", name: `${id}.txt`, file_id: `file_${id}`, parent_directory_id: "libdir_p", ...extra });
const folder = (id, extra = {}) => library.parseNode({ id, kind: "directory", name: id, parent_directory_id: "libdir_p", ...extra });
const FOLDER_P = at({ tab: "all", directoryId: "libdir_p" });
/** `items` as the shown list of libdir_p. */
async function shown(t, items) {
  const path = library.libraryRequest(FOLDER_P, null).path;
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ status: 200, body: { items, cursor: null } }), { status: 200 }));
  await library.loadLibrary(FOLDER_P, "refresh");
  t.mock.restoreAll();
  assert.ok(path);
}
const ids = () => library.libraryState().lists[library.listKey(FOLDER_P)].items.map((node) => node.id);

test("item shapes say what is the account's own, and the menu offers what La does", () => {
  assert.deepEqual([file("a").own, file("a").saved], [true, false]);
  for (const raw of [{ access_kind: "shared" }, { provider: "native_shared" }, { library_provider: "native_shared" }, { shared_by: { id: "u" } }, { direct_share_id: "s" }, { parent_directory_id: "library:shared-directory:x" }, { is_root: true }, { library_artifact_type: "site" }, { library_artifact_type: "page" }]) {
    assert.equal(file("a", raw).own, false, JSON.stringify(raw));
  }
  const snapshot = file("s", { library_artifact_type: "chat_message_snapshot" });
  assert.deepEqual([snapshot.own, snapshot.saved], [false, true]);
  assert.deepEqual(library.itemActions(file("a"), false), { restore: false, deleteForever: false, rename: true, download: true, favorite: true, move: true, delete: true });
  assert.deepEqual(library.itemActions(file("a", { trashed_at: "2026-10-28T00:00:00Z" }), true), { restore: true, deleteForever: true, rename: false, download: false, favorite: false, move: false, delete: false });
  // Folders: no download or favorite, nor anything in the trash; flashcards no download; a share only download and favorite.
  assert.deepEqual(library.itemActions(folder("d"), false), { restore: false, deleteForever: false, rename: true, download: false, favorite: false, move: true, delete: true });
  assert.equal(library.itemActions(folder("d"), true).restore, false);
  assert.equal(library.itemActions(file("f", { library_artifact_type: "flashcards" }), false).download, false);
  assert.deepEqual(library.itemActions(file("x", { access_kind: "shared" }), false), { restore: false, deleteForever: false, rename: false, download: true, favorite: true, move: false, delete: false });
  assert.equal(library.isRootLevel({ parentId: null }, undefined), true);
  assert.equal(library.isRootLevel({ parentId: "root1" }, "root1"), true);
  assert.equal(library.isRootLevel({ parentId: "libdir_p" }, "root1"), false);
});

test("names: a folder never starts with a dot, a file keeps its extension (QI)", () => {
  assert.equal(library.folderNameError(" .git"), "文件夹名称不能以“.”开头。");
  assert.equal(library.folderNameError("a.b"), null);
  assert.deepEqual(["a.TXT", "dir/a.tar.gz", ".env", "a.", "a"].map(library.extensionOf), ["txt", "gz", null, null, null]);
  assert.equal(library.renameError({ kind: "file", name: "报告.md" }, "总结.md"), null);
  assert.equal(library.renameError({ kind: "file", name: "报告.md" }, "总结.txt"), "无法更改文件扩展名");
  // Adding one to a file that had none changes it too.
  assert.equal(library.renameError({ kind: "file", name: "Makefile" }, "Makefile.txt"), "无法更改文件扩展名");
  assert.equal(library.renameError({ kind: "directory", name: "a" }, ".a"), "文件夹名称不能以“.”开头。");
  assert.equal(library.serverMessage(new (class extends Error {})()), null);
});

test("delete: files to the trash 25 a time through delete-batch, hidden meanwhile; folders and the rest one by one", async (t) => {
  fresh();
  clearToasts();
  const files = Array.from({ length: 27 }, (_, index) => file(`f${index}`));
  const lone = file("lone", { file_id: null });
  const dir = folder("libdir_d");
  const share = file("shared", { access_kind: "shared" });
  await shown(t, [...files, lone, dir, share].map((node) => ({ id: node.id, kind: node.kind, name: node.name })));
  const seen = [];
  const generation = library.libraryState().generation;
  const calls = chatgpt(t, {
    "POST /files/library/files/delete-batch": (body) => {
      seen.push({ count: body.files.length, hidden: body.files.every((entry) => library.libraryState().hidden[entry.library_file_id] && library.libraryState().busy[entry.library_file_id]) });
      return [200, { files: body.files.map((entry) => ({ library_file_id: entry.library_file_id, success: entry.library_file_id !== "f3" })) }];
    },
    "DELETE /files/library/directories/libdir_d": { success: true },
    "DELETE /files/library/files/lone?parent_directory_id=libdir_p&file_name=lone.txt&soft_delete=true": { success: true },
  });
  // While it runs, the lists show without what goes.
  const pending = library.deleteLibraryItems([...files, lone, dir, share]);
  const during = library.overlay(library.libraryState().lists[library.listKey(FOLDER_P)], library.libraryState().hidden, library.libraryState().renamed);
  assert.equal(during.items.some((node) => node.id === "f0"), false);
  const done = await pending;
  assert.deepEqual(seen, [{ count: 25, hidden: true }, { count: 2, hidden: true }]);
  assert.deepEqual(calls[0].body.files[0], { library_file_id: "f0", file_id: "file_f0", parent_directory_id: "libdir_p", file_name: "f0.txt" });
  assert.deepEqual(calls.slice(2).map((call) => `${call.method} ${call.path}`), ["DELETE /files/library/files/lone?parent_directory_id=libdir_p&file_name=lone.txt&soft_delete=true", "DELETE /files/library/directories/libdir_d"]);
  assert.deepEqual(done.sort(), [...files.filter((node) => node.id !== "f3").map((node) => node.id), "lone", "libdir_d"].sort());
  // Only the failure comes back (and the share, never touched); one toast for the batch.
  assert.deepEqual(ids(), ["f3", "shared"]);
  assert.deepEqual([library.libraryState().hidden, library.libraryState().busy], [{}, {}]);
  assert.deepEqual(titles(), ["删除文件未成功。"]);
  assert.equal(library.libraryState().generation, generation + 1);
});

test("a file busy with a rename is not batched (the confirmation waits for it); another account stops a one-by-one change", async (t) => {
  fresh();
  clearToasts();
  const [x, y] = [file("x1"), file("y1")];
  let open;
  const gate = new Promise((resolve) => (open = resolve));
  let sent = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    const { method, path } = JSON.parse(init.body);
    assert.ok(cloudAllowed(method, path), `the bridge refuses ${method} ${path}`);
    sent.push(`${method} ${path}`);
    if (method === "PATCH") await gate;
    const body = method === "PATCH" ? { file_name: "x2.txt" } : path.endsWith("/delete-batch") ? { files: [{ library_file_id: "y1", success: true }] } : { success: true };
    return new Response(JSON.stringify({ status: 200, body }), { status: 200 });
  });
  const renaming = library.renameLibraryItem(x, "x2.txt");
  assert.deepEqual([library.deletesInBatch(x), library.deletesInBatch(y), library.deletesInBatch(file("n", { file_id: null })), library.deletesInBatch(folder("libdir_q"))], [false, true, false, false]);
  // y goes through the batch; x is refused while busy, nothing sent for it, and left to the dialog.
  assert.deepEqual(await library.deleteLibraryItems([x, y]), ["y1"]);
  assert.deepEqual(sent, ["PATCH /files/library/files/x1", "POST /files/library/files/delete-batch"]);
  assert.deepEqual(titles(), []);
  open();
  await renaming;

  // Folders go one by one: signed in as someone else during the first, the rest are not sent.
  sent = [];
  t.mock.restoreAll();
  t.mock.method(globalThis, "fetch", async (url, init) => {
    const { method, path } = JSON.parse(init.body);
    sent.push(`${method} ${path}`);
    library.resetLibrary(`other${accounts}@example.com`);
    return new Response(JSON.stringify({ status: 200, body: { success: true } }), { status: 200 });
  });
  assert.deepEqual(await library.deleteLibraryItems([folder("libdir_1"), folder("libdir_2"), folder("libdir_3")]), ["libdir_1"]);
  assert.deepEqual(sent, ["DELETE /files/library/directories/libdir_1"]);
});

test("in the trash: 永久删除 and 恢复 go one by one, each failure toasting its own", async (t) => {
  fresh();
  clearToasts();
  const trashed = { trashed_at: "2026-10-28T00:00:00Z" };
  const [t1, t2] = [file("t1", trashed), file("t2", trashed)];
  const calls = chatgpt(t, {
    "DELETE /files/library/files/t1?file_id=file_t1&parent_directory_id=libdir_p&file_name=t1.txt&soft_delete=false": { success: true },
    "DELETE /files/library/files/t2?file_id=file_t2&parent_directory_id=libdir_p&file_name=t2.txt&soft_delete=false": () => [500, { detail: "boom" }],
    "POST /files/library/files/t1/restore": {},
    "POST /files/library/files/t2/restore": () => [404, { detail: "Not Found" }],
  });
  assert.deepEqual(await library.deleteLibraryItems([t1, t2], { permanently: true }), ["t1"]);
  assert.equal(calls.some((call) => call.path.includes("delete-batch")), false);
  assert.deepEqual(titles(), ["删除文件未成功。"]);
  clearToasts();
  assert.deepEqual(await library.restoreLibraryItems([t1, t2, folder("libdir_x")]), ["t1"]);
  assert.deepEqual(calls.slice(2).map((call) => [call.method, call.path, call.body]), [["POST", "/files/library/files/t1/restore", undefined], ["POST", "/files/library/files/t2/restore", undefined]]);
  assert.deepEqual(titles(), ["无法恢复文件"]);
});

test("move: a folder by its parent, a file through …/move; a drop hides them meanwhile and brings back a failure", async (t) => {
  fresh();
  clearToasts();
  const dir = folder("libdir_a");
  const f1 = file("f1");
  const there = file("f2", { parent_directory_id: "libdir_t" });
  const target = folder("libdir_t");
  await shown(t, [dir, f1, there, target].map((node) => ({ id: node.id, kind: node.kind, name: node.name, parent_directory_id: node.parentId })));
  let during;
  const calls = chatgpt(t, {
    "PATCH /files/library/directories/libdir_a": () => {
      during = { hidden: { ...library.libraryState().hidden }, busy: { ...library.libraryState().busy } };
      return [200, { id: "libdir_a" }];
    },
    "PATCH /files/library/files/f1/move": { success: false },
  });
  const done = await library.moveLibraryItems([dir, f1, there, target], "libdir_t", { optimistic: true });
  assert.deepEqual(calls.map((call) => [call.method, call.path, call.body]), [
    ["PATCH", "/files/library/directories/libdir_a", { parent_directory_id: "libdir_t" }],
    ["PATCH", "/files/library/files/f1/move", { directory_id: "libdir_t" }],
  ]);
  assert.deepEqual(during, { hidden: { libdir_a: true, f1: true }, busy: { libdir_a: true, libdir_t: true } });
  // The one already there counts as moved; the failure is back in the list.
  assert.deepEqual(done, ["f2", "libdir_a"]);
  assert.deepEqual(ids(), ["f1", "f2", "libdir_t"]);
  assert.deepEqual([library.libraryState().hidden, library.libraryState().busy], [{}, {}]);
  assert.deepEqual(titles(), ["无法移动 f1.txt"]);
});

test("move to the root: what is at the root already stays; the root is asked once a minute", async (t) => {
  fresh();
  const calls = chatgpt(t, {
    "GET /files/library/directories/path": { items: [{ id: "root1", is_root: true, name: "" }] },
    "PATCH /files/library/files/f1/move": { success: true },
  });
  assert.equal(await library.loadLibraryRoot(), "root1");
  assert.equal(await library.loadLibraryRoot(), "root1");
  assert.equal(library.libraryState().root, "root1");
  const atRoot = file("r1", { parent_directory_id: "root1" });
  assert.deepEqual(await library.moveLibraryItems([atRoot, file("f1")], null), ["r1", "f1"]);
  assert.deepEqual(calls.map((call) => [call.method, call.path, call.body]), [["GET", "/files/library/directories/path", undefined], ["PATCH", "/files/library/files/f1/move", { directory_id: null }]]);
});

test("rename: a file shows its new name at once and keeps the old one if it fails; a folder's 409 in the server's words", async (t) => {
  fresh();
  clearToasts();
  const f1 = file("f1");
  const dir = folder("libdir_a");
  await shown(t, [{ id: "f1", kind: "file", name: "f1.txt" }, { id: "libdir_a", kind: "directory", name: "libdir_a" }]);
  let during;
  let fail = false;
  const calls = chatgpt(t, {
    "PATCH /files/library/files/f1": () => {
      during = library.overlay(library.libraryState().lists[library.listKey(FOLDER_P)], library.libraryState().hidden, library.libraryState().renamed).items[0].name;
      return fail ? [500, { detail: "x" }] : [200, { id: "f1", file_name: "新名字.txt" }];
    },
    "PATCH /files/library/directories/libdir_a": (body) => (body.name === "重名" ? [409, { detail: "已有同名文件夹" }] : [500, {}]),
  });
  const generation = library.libraryState().generation;
  assert.equal(await library.renameLibraryItem(f1, " 新名字.txt "), true);
  assert.deepEqual(calls[0].body, { file_name: "新名字.txt" });
  assert.equal(during, "新名字.txt");
  const list = () => library.libraryState().lists[library.listKey(FOLDER_P)].items;
  assert.equal(list()[0].name, "新名字.txt");
  assert.deepEqual([library.libraryState().renamed, library.libraryState().generation], [{}, generation + 1]);
  fail = true;
  assert.equal(await library.renameLibraryItem({ ...f1, name: "新名字.txt" }, "又一个.txt"), false);
  assert.equal(list()[0].name, "新名字.txt");
  assert.equal(await library.renameLibraryItem(dir, "重名"), false);
  assert.deepEqual(calls.at(-1).body, { name: "重名" });
  assert.equal(await library.renameLibraryItem(dir, "别的"), false);
  assert.deepEqual(titles(), ["重命名 新名字.txt 未成功。", "已有同名文件夹", "文件夹重命名未成功。"]);
  // Unchanged or empty: nothing sent.
  const count = calls.length;
  await library.renameLibraryItem(dir, " libdir_a ");
  await library.renameLibraryItem(dir, "  ");
  assert.equal(calls.length, count);
});

test("新建文件夹: POST directories; a 409 says the server's message, a dot never goes", async (t) => {
  fresh();
  clearToasts();
  const calls = chatgpt(t, {
    "POST /files/library/directories": (body) => (body.name === "重名" ? [409, { error: { message: "已有同名文件夹" } }] : [200, { id: "libdir_new", kind: "directory" }]),
  });
  const made = await library.createLibraryFolder(" 项目 ", "libdir_p");
  assert.deepEqual(calls[0].body, { name: "项目", parent_directory_id: "libdir_p" });
  assert.deepEqual([made.id, made.kind, made.name, made.parentId, made.own], ["libdir_new", "directory", "项目", "libdir_p", true]);
  assert.equal(await library.createLibraryFolder("重名", null), null);
  assert.deepEqual(calls[1].body, { name: "重名", parent_directory_id: null });
  assert.equal(await library.createLibraryFolder(".隐藏", null), null);
  assert.equal(calls.length, 2);
  assert.deepEqual(titles(), ["已有同名文件夹"]);
});

test("favorites: status 50 at a time, kept 30 s; adding and removing without guessing, then a toast", async (t) => {
  library.resetLibrary("fav@example.com");
  clearToasts();
  opened.length = 0;
  let failing = false;
  const calls = chatgpt(t, {
    "POST /files/library/favorites/status": (body) => [200, { items: body.target_refs.map((ref) => ({ target_ref: ref, availability: ref.library_file_id === "u" ? "unavailable" : "available", favorite: ref.library_file_id === "f0" ? { favorite_id: "fav_0" } : null })) }],
    "POST /files/library/favorites": () => (failing ? [500, {}] : [200, { favorite_id: "fav_1" }]),
    "DELETE /files/library/favorites/fav_0": { success: true },
  });
  // Without the gate known on: nothing asked.
  await library.loadFavoriteStatus(["f0"]);
  assert.equal(calls.length, 0);
  await library.refreshLibraryAvailable(true);
  const many = [...Array.from({ length: 50 }, (_, index) => `f${index}`), "u"];
  await library.loadFavoriteStatus([...many, "f0"]);
  assert.deepEqual(calls.map((call) => call.body.target_refs.length), [50, 1]);
  assert.deepEqual(calls[0].body.target_refs[0], { type: "library_file", library_file_id: "f0" });
  const status = library.libraryState().favorites;
  assert.deepEqual([status.f0.favoriteId, status.f1.favoriteId, status.u.unavailable], ["fav_0", null, true]);
  await library.loadFavoriteStatus(["f0", "f1"]);
  assert.equal(calls.length, 2);

  assert.equal(await library.setLibraryFavorite(file("f1"), true), true);
  assert.deepEqual(calls[2].body, { target_ref: { type: "library_file", library_file_id: "f1" } });
  assert.equal(library.libraryState().favorites.f1.favoriteId, "fav_1");
  const added = store.getState().toasts.find((toast) => toast.title === "已添加到收藏夹");
  assert.equal(added.action.label, "查看");
  added.action.run();
  assert.deepEqual(opened, [{ tab: "favorites" }]);
  assert.equal(await library.setLibraryFavorite(file("f0"), false), true);
  assert.equal(calls[3].path, "/files/library/favorites/fav_0");
  assert.equal(library.libraryState().favorites.f0.favoriteId, null);
  failing = true;
  assert.equal(await library.setLibraryFavorite(file("f2"), true), false);
  assert.deepEqual(titles(), ["已添加到收藏夹", "已从收藏夹中移除", "无法更新收藏"]);
  // Not a favorite: nothing to remove.
  assert.equal(await library.setLibraryFavorite(file("f5"), false), false);
  assert.equal(calls.length, 5);
});

test("清空回收站: emptied, some left, or not at all", async (t) => {
  fresh();
  clearToasts();
  let answer = [200, { deleted_count: 3, failed_count: 0 }];
  chatgpt(t, { "DELETE /files/library/trash": () => answer });
  assert.equal(await library.emptyLibraryTrash(), true);
  assert.equal(library.libraryState().trashEmpty, true);
  answer = [200, { deleted_count: 1, failed_count: 2 }];
  assert.equal(await library.emptyLibraryTrash(), false);
  answer = [0];
  assert.equal(await library.emptyLibraryTrash(), false);
  assert.deepEqual(titles(), ["回收站已清空", "部分项目无法删除。请重试。", "未成功清空回收站"]);
});

test("downloads one file after another through the bridge; opened and the move dialog's folders", async (t) => {
  fresh();
  const clicked = [];
  globalThis.document = { createElement: () => ({ click() { clicked.push([this.href, this.download]); }, remove() {} }), body: { append() {} } };
  let sent;
  try {
    sent = library.downloadLibraryFiles([file("a"), folder("libdir_d"), file("cards", { library_artifact_type: "flashcards" }), file("b")]);
  } finally {
    delete globalThis.document;
  }
  // What went leaves the toolbar's selection (Ca).
  assert.deepEqual(sent, ["a", "b"]);
  assert.deepEqual(clicked, [[library.libraryContentUrl(file("a"), "download"), "a.txt"], [library.libraryContentUrl(file("b"), "download"), "b.txt"]]);
  assert.ok(clicked[0][0].includes("kind=download"));

  const page = (cursor) => `/files/library/nodes?parent_directory_id=libdir_p${cursor ? `&cursor=${cursor}` : ""}&include_files=false&include_saved_entities=false`;
  const calls = chatgpt(t, {
    "POST /files/library/files/a/opened": {},
    [`GET ${page()}`]: { items: [{ id: "libdir_1", kind: "directory", name: "一" }, { id: "x", kind: "file", name: "x.txt" }], cursor: "c2" },
    [`GET ${page("c2")}`]: { items: [{ id: "libdir_2", kind: "directory", name: "二" }, { id: "libdir_s", kind: "directory", name: "共享", access_kind: "shared" }], cursor: "c2" },
  });
  library.markLibraryFileOpened(file("a"));
  library.markLibraryFileOpened(folder("libdir_d"));
  const folders = await library.fetchMoveFolders("libdir_p");
  assert.deepEqual(folders.map((node) => node.id), ["libdir_1", "libdir_2"]);
  assert.deepEqual(calls.map((call) => call.path), ["/files/library/files/a/opened", page(), page("c2")]);
});

/** A fake /api/library/upload: each call waits until the test answers it, and fails when aborted. */
function bridgeUploads(t) {
  const calls = [];
  t.mock.method(globalThis, "fetch", (url, init) => {
    assert.ok(url.startsWith("/api/library/upload?"), url);
    return new Promise((resolve, reject) => {
      const call = { params: new URL(url, "http://x").searchParams, body: init.body, signal: init.signal, answer: (lines, status = 200) => resolve(new Response(lines.map((line) => `${JSON.stringify(line)}\n`).join(""), { status })), fail: reject };
      calls.push(call);
      init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    });
  });
  return calls;
}

const settle = async (check) => {
  for (let i = 0; i < 100 && !check(); i++) await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(check());
};
const row = (name) => library.libraryState().uploads.find((item) => item.name === name);
const named = (name, text = "x", type = "text/plain") => new File([text], name, { type });

test("uploads: five at a time in one batch, each row through its stages; a batch at a time", async (t) => {
  fresh();
  library.removeLibraryUpload();
  const calls = bridgeUploads(t);
  const route = { tab: "suggested" };
  store.setState({ libraryRoute: route });
  const generation = library.libraryState().generation;
  const files = Array.from({ length: 7 }, (_, index) => named(`f${index}.txt`));
  const huge = { name: "huge.bin", size: 536870913, type: "" };
  const batch = library.uploadToLibrary([...files, named(".env"), named("empty.txt", ""), huge], "libdir_up");
  // Refused here, as the bridge would: no call for them.
  assert.deepEqual([row(".env").status, row(".env").error, row("empty.txt").error, row("huge.bin").error], ["failed", "文件名不能以“.”开头", "无法上传空文件", "此文件过大，无法上传。请尝试上传较小的文件"]);
  assert.equal(library.libraryState().uploads[0].name, "f0.txt");
  // While it runs no other batch starts, nor may the page offer one.
  assert.equal(library.libraryState().uploading, true);
  assert.equal(library.uploadAllowed(at({ tab: "all", directoryId: "libdir_up" }), true), false);
  await library.uploadToLibrary([named("later.txt")], null);
  assert.equal(row("later.txt"), undefined);

  await settle(() => calls.length === 5);
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls.length, 5);
  assert.deepEqual(Object.fromEntries(calls[0].params), { c: "conn-1", name: "f0.txt", type: "text/plain", size: "1", directoryId: "libdir_up" });
  assert.equal(calls[0].body, files[0]);
  assert.deepEqual(files.slice(0, 5).map((one) => row(one.name).status), Array(5).fill("uploading"));
  assert.equal(row("f5.txt").status, "queued");

  calls[0].answer([{ stage: "uploading" }, { stage: "processing", progress: 20 }, { done: true, libraryFileId: "libfile_0" }]);
  await settle(() => calls.length === 6);
  assert.deepEqual([row("f0.txt").status, row("f0.txt").libraryFileId, row("f0.txt").progress], ["uploaded", "libfile_0", 100]);
  calls[1].answer([{ stage: "uploading" }, { error: "无法上传", code: null, retryable: true }]);
  calls[2].answer([{ stage: "processing", progress: 0 }, { error: "上传可能已完成。重试前请先查看资料库", code: "processing_failed", uncertain: true }]);
  library.cancelLibraryUpload(row("f3.txt").id);
  calls[4].answer([{ error: "你的存储空间已满。请移除文件以腾出空间，然后重试", code: "library_storage_limit_exceeded" }]);
  await settle(() => calls.length === 7);
  // The stream stops after processing began: the file may be in.
  calls[5].answer([{ stage: "processing", progress: 20 }]);
  calls[6].answer([{ done: true, libraryFileId: null }]);
  await batch;

  assert.equal(calls[3].signal.aborted, true);
  assert.equal(row("f3.txt"), undefined);
  const states = ["f1.txt", "f2.txt", "f4.txt", "f5.txt", "f6.txt"].map((name) => [row(name).status, row(name).retryable, row(name).error]);
  assert.deepEqual(states, [
    ["failed", true, "无法上传"],
    ["failed", false, "上传可能已完成。重试前请先查看资料库"],
    ["failed", false, "你的存储空间已满。请移除文件以腾出空间，然后重试"],
    ["failed", false, "上传可能已完成。重试前请先查看资料库"],
    ["uploaded", false, null],
  ]);
  // Done: the library reads anew, and the page, still where it was, shows the folder's 全部.
  assert.equal(library.libraryState().uploading, false);
  assert.ok(library.libraryState().generation > generation);
  assert.deepEqual(store.getState().libraryRoute, { tab: "all", directoryId: "libdir_up" });

  // 重试 goes again on its own, outside a batch.
  const before = library.libraryState().generation;
  const retried = library.retryLibraryUpload(row("f1.txt").id);
  assert.equal(row("f1.txt").status, "queued");
  await settle(() => calls.length === 8);
  assert.equal(library.libraryState().uploading, false);
  calls[7].answer([{ done: true, libraryFileId: "libfile_1" }]);
  await retried;
  assert.equal(row("f1.txt").status, "uploaded");
  assert.equal(library.libraryState().generation, before + 1);
  // Nothing to retry on the rest.
  await library.retryLibraryUpload(row("f2.txt").id);
  assert.equal(calls.length, 8);

  library.removeLibraryUpload(row("f4.txt").id);
  assert.equal(row("f4.txt"), undefined);
  // An uploaded row is not removed alone; the panel's close takes every finished one.
  library.removeLibraryUpload(row("f6.txt").id);
  assert.ok(row("f6.txt"));
  library.removeLibraryUpload();
  assert.deepEqual(library.libraryState().uploads, []);
});

test("uploads: the page moved on, nothing went in, or the bridge was unreachable", async (t) => {
  fresh();
  library.removeLibraryUpload();
  const calls = bridgeUploads(t);
  store.setState({ libraryRoute: { tab: "images" } });
  const batch = library.uploadToLibrary([named("a.png", "x", "image/png")], null);
  await settle(() => calls.length === 1);
  // Opened a folder meanwhile: it stays there.
  const elsewhere = { tab: "all", directoryId: "libdir_z" };
  store.setState({ libraryRoute: elsewhere });
  calls[0].answer([{ done: true, libraryFileId: "libfile_a" }]);
  await batch;
  assert.equal(store.getState().libraryRoute, elsewhere);
  assert.equal(calls[0].params.has("directoryId"), false);
  // The same route, but a filter put on meanwhile (actions compares search too): it stays.
  const suggested = { tab: "suggested" };
  store.setState({ libraryRoute: suggested });
  library.showLibrarySearch('["",[],[]]');
  const filtered = library.uploadToLibrary([named("e.txt")], null);
  await settle(() => calls.length === 2);
  library.showLibrarySearch('["",[],["uploaded"]]');
  calls[1].answer([{ done: true, libraryFileId: "libfile_e" }]);
  await filtered;
  assert.equal(store.getState().libraryRoute, suggested);
  library.showLibrarySearch("");
  store.setState({ libraryRoute: elsewhere });

  const generation = library.libraryState().generation;
  const failed = library.uploadToLibrary([named("b.txt"), named("c.txt")], null);
  await settle(() => calls.length === 4);
  calls[2].fail(new TypeError("fetch failed"));
  calls[3].answer([], 502);
  await failed;
  assert.deepEqual([row("b.txt").status, row("b.txt").retryable, row("c.txt").retryable], ["failed", true, true]);
  // The bridge says whether 重试 may pass (ke's m from the HTTP status): a 4xx without a code may not.
  const final = library.uploadToLibrary([named("d.txt")], null);
  await settle(() => calls.length === 5);
  calls[4].answer([{ stage: "uploading" }, { error: "无法上传", code: null, retryable: false }]);
  await final;
  assert.deepEqual([row("d.txt").status, row("d.txt").retryable], ["failed", false]);
  // Nothing went in: no reading anew, no move.
  assert.equal(library.libraryState().generation, generation);
  assert.equal(store.getState().libraryRoute, elsewhere);
  library.removeLibraryUpload();
});

test("uploads: another account stops what runs; nothing of it is retried into the new one", async (t) => {
  library.resetLibrary("first@example.com");
  library.removeLibraryUpload();
  const calls = bridgeUploads(t);
  const route = { tab: "all" };
  store.setState({ libraryRoute: route });
  const files = Array.from({ length: 6 }, (_, index) => named(`g${index}.txt`));
  const batch = library.uploadToLibrary(files, null);
  await settle(() => calls.length === 5);
  calls[0].answer([{ error: "无法上传", code: null, retryable: true }]);
  await settle(() => calls.length === 6);
  assert.equal(row("g0.txt").retryable, true);
  library.resetLibrary("second@example.com");
  await batch;
  assert.ok(calls.slice(1).every((call) => call.signal.aborted));
  assert.deepEqual(files.map((one) => [row(one.name).status, row(one.name).error, row(one.name).retryable]), Array(6).fill(["failed", "账户已切换。请重新选择此文件进行上传", false]));
  assert.equal(store.getState().libraryRoute, route);
  await library.retryLibraryUpload(row("g0.txt").id);
  assert.equal(calls.length, 6);
  library.removeLibraryUpload();
});

test("uploads are open only where the desktop app opens them (U)", () => {
  const open = (query, uploading = false) => library.uploadAllowed(at(query), uploading);
  assert.deepEqual(
    [open({}), open({ tab: "all", directoryId: "d" }), open({}, true), open({ deleted: true }), open({ search: "a" }), open({ categories: ["pdfs"] }), open({ tab: "images", categories: ["images"] }), open({ sources: ["uploaded"] })],
    [true, true, false, false, false, false, true, false],
  );
});
