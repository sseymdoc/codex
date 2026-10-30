// Run with `pnpm test`. library-preview.ts against a fake ChatGPT behind a fake bridge: fetch answers
// /api/cloud as server/bridge.mjs does ({ status, body }), /api/library/content and /attach with
// what a test gives, and /api/files/open; "./codex" is a stub, so no app-server, login or network.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { transformSync } from "esbuild";
import JSZip from "jszip";
import * as XLSX from "xlsx";
import { cloudAllowed } from "../../server/cloud.mjs";

globalThis.requestAnimationFrame ??= (callback) => setTimeout(callback, 0);
const saved = new Map();
globalThis.localStorage = { getItem: (key) => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, String(value)), removeItem: (key) => saved.delete(key) };
globalThis.__libraryCodexStub = { connectionId: () => "conn-1", callExperimental: async () => {}, errorMessage: (error) => String(error), openLibrary: () => {} };
const STUB = `data:text/javascript,${encodeURIComponent("const s = globalThis.__libraryCodexStub; export const connectionId = s.connectionId, callExperimental = s.callExperimental, errorMessage = s.errorMessage, openLibrary = s.openLibrary;")}`;
registerHooks({
  resolve: (specifier, context, next) => {
    if (specifier === "./codex" && /\/(cloud|library|library-preview)\.ts$/.test(context.parentURL ?? "")) return { url: STUB, shortCircuit: true };
    return next(/^\.\.?\/[^.]+$/.test(specifier) && context.parentURL?.endsWith(".ts") ? `${specifier}.ts` : specifier, context);
  },
  load: (url, context, next) =>
    url.startsWith("file:") && url.endsWith(".ts") ? { format: "module", shortCircuit: true, source: transformSync(readFileSync(new URL(url), "utf8"), { loader: "ts", format: "esm" }).code } : next(url, context),
});
const preview = await import("./library-preview.ts");
const library = await import("./library.ts");
const store = await import("./store.ts");
const { CloudError } = await import("./cloud.ts");

let accounts = 0;
const fresh = () => library.resetLibrary(`preview${++accounts}@example.com`);
const tick = () => new Promise((resolve) => setImmediate(resolve));
const settle = async () => {
  for (let i = 0; i < 20; i++) await tick();
};
const toasts = () => store.getState().toasts.filter((t) => !t.ending);
const clearToasts = () => store.setState({ toasts: [] });

/**
 * A fake ChatGPT and bridge. `routes` maps "METHOD path" to a body or (body, calls) => [status,
 * body] (a status of 0 is the bridge failing, a Promise holds the answer); `content` maps
 * "id|fileId" to a body or () => Response. Every /api/cloud call is checked against the bridge's routes.
 */
function bridge(t, { routes = {}, content = {}, attach = null, open = true } = {}) {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init = {}) => {
    if (url.startsWith("/api/library/content/")) {
      const params = new URL(url, "http://bridge").searchParams;
      calls.push({ content: `${params.get("id")}|${params.get("fileId") ?? ""}`, kind: params.get("kind") });
      const body = content[`${params.get("id")}|${params.get("fileId") ?? ""}`];
      if (body === undefined) return new Response("File unavailable.", { status: 404 });
      return typeof body === "function" ? body() : new Response(body);
    }
    if (url.startsWith("/api/library/attach")) {
      calls.push({ attach: init.method, url, body: init.body && JSON.parse(init.body) });
      return init.method === "DELETE" ? new Response(null, { status: 204 }) : new Response(JSON.stringify(attach), { status: attach ? 200 : 502 });
    }
    if (url.startsWith("/api/files/open")) {
      calls.push({ open: Object.fromEntries(new URL(url, "http://bridge").searchParams) });
      return new Response(null, { status: open ? 204 : 403 });
    }
    assert.equal(url, "/api/cloud?c=conn-1");
    const { method, path, body } = JSON.parse(init.body);
    calls.push({ method, path, body });
    assert.ok(cloudAllowed(method, path), `the bridge refuses ${method} ${path}`);
    const route = routes[`${method} ${path}`];
    const answered = route === undefined ? [404, { detail: "Not Found" }] : typeof route === "function" ? await route(body, calls) : [200, route];
    const [status, answer] = answered;
    if (status === 0) return new Response("无法连接 ChatGPT（socket hang up）", { status: 502 });
    return new Response(JSON.stringify({ status, body: answer }), { status: 200 });
  });
  return calls;
}

const node = (fields = {}) => library.parseNode({ id: "libfile_a", kind: "file", name: "a.txt", file_id: "file_a", access_kind: "owned", file_size_bytes: 10, ...fields });
const cloudCalls = (calls) => calls.filter((call) => call.method).map((call) => `${call.method} ${call.path}`);

// ---------------------------------------------------------------------------

test("each file gets the desktop app's preview kind, MIME type first, then file_extension, then the name", () => {
  const kind = (fields) => preview.previewKind(node(fields));
  const cases = [
    [{ library_artifact_type: "deep_research_report", name: "r.pdf", mime_type: "application/pdf" }, "deep-research"],
    [{ library_file_category: "image", name: "x.pdf" }, "image"],
    [{ mime_type: "image/webp; q=1", name: "x" }, "image"],
    [{ library_file_category: "pdf", name: "x" }, "pdf"],
    [{ mime_type: "APPLICATION/PDF", name: "x" }, "pdf"],
    [{ name: "报告.PDF" }, "pdf"],
    [{ mime_type: "application/x-ipynb+json", name: "a.txt" }, "ipynb"],
    [{ mime_type: "application/vnd.ms-excel.sheet.macroEnabled.12", name: "a" }, "xlsx"],
    [{ mime_type: "application/vnd.openxmlformats-officedocument.presentationml.presentation", name: "a" }, "pptx"],
    [{ mime_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", name: "a" }, "xlsx"],
    [{ mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", name: "a" }, "docx"],
    [{ mime_type: "text/csv", name: "a.txt" }, "csv"],
    [{ mime_type: "text/tab-separated-values", name: "a" }, "tsv"],
    [{ name: "a.xlsm" }, "xlsx"],
    [{ name: "a.docx", mime_type: "application/octet-stream" }, "docx"],
    // file_extension before the name; a pdf or tex extension ends the artifact search.
    [{ name: "a.csv", file_extension: "pptx" }, "pptx"],
    [{ name: "a.docx", file_extension: "tex" }, "unsupported"],
    [{ name: "a.tex" }, "unsupported"],
    [{ name: "README.mdx" }, "markdown"],
    [{ name: "a", mime_type: "text/markdown" }, "markdown"],
    [{ name: "page.HTM" }, "html"],
    [{ name: "a", mime_type: "text/html; charset=utf-8" }, "html"],
    [{ name: "x", library_file_category: "text" }, "text"],
    [{ name: "x", mime_type: "text/x-weird" }, "text"],
    [{ name: "x", mime_type: "application/x-ndjson" }, "text"],
    [{ name: "run.log" }, "text"],
    [{ name: "data.jsonl" }, "text"],
    [{ name: "clip.mp4", mime_type: "video/mp4" }, "unsupported"],
    [{ name: "song.mp3", mime_type: "audio/mpeg" }, "unsupported"],
    [{ name: "archive.zip" }, "unsupported"],
  ];
  for (const [fields, expected] of cases) assert.equal(kind(fields), expected, JSON.stringify(fields));
});

test("notes, flashcards and the fallback come before the kind; previews read only what fits", () => {
  const renderer = (fields) => preview.libraryRenderer(node(fields));
  assert.equal(renderer({ name: "笔记", library_artifact_type: "writing_block" }), "note");
  assert.equal(renderer({ name: "a.md" }), "note");
  assert.equal(renderer({ name: "a.MARKDOWN" }), "note");
  assert.equal(renderer({ name: "a", mime_type: "text/x-markdown" }), "note");
  assert.equal(renderer({ name: "a.txt", file_size_bytes: 200_000 }), "note");
  assert.equal(renderer({ name: "a.txt", file_size_bytes: 200_001 }), "text");
  assert.equal(renderer({ name: "a.txt", file_size_bytes: null }), "text");
  // Not the account's own, in the trash, or an automation plan: no editor.
  assert.equal(renderer({ name: "a.md", access_kind: "shared" }), "markdown");
  assert.equal(renderer({ name: "a.md", trashed_at: "2026-10-01T00:00:00Z" }), "markdown");
  assert.equal(renderer({ name: "a.md", library_artifact_type: "automation_plan" }), "unsupported");
  assert.equal(renderer({ name: "deck", library_artifact_type: "flashcards" }), "flashcards");
  for (const artifact of ["site", "site_preview", "app_block"]) assert.equal(renderer({ name: "a.html", library_artifact_type: artifact }), "unsupported");
  assert.equal(renderer({ name: "a.png", library_artifact_type: "saved_entity", library_file_category: "image" }), "unsupported");

  const block = (size, kind) => preview.previewBlock({ size }, kind);
  assert.deepEqual([block(null, "pdf"), block(41_943_040, "pdf"), block(41_943_041, "image"), block(10, "docx")], ["unknown", null, "tooLarge", null]);
  assert.deepEqual(["note", "flashcards", "deep-research", "unsupported"].map((kind) => block(null, kind)), [null, null, null, null]);

  const actions = (fields, kind) => preview.previewActions(node(fields), kind);
  assert.deepEqual(actions({ name: "a.png", library_file_category: "image" }, "image"), { download: true, versionHistory: true, openInApp: true, delete: true });
  assert.deepEqual(actions({ name: "a.pdf", file_size_bytes: 47_185_921 }, "pdf"), { download: true, versionHistory: true, openInApp: false, delete: false });
  assert.equal(actions({ name: "a.pdf", file_size_bytes: 47_185_920 }, "pdf").openInApp, true);
  assert.equal(actions({ name: "a.pdf", file_size_bytes: null }, "pdf").openInApp, false);
  assert.deepEqual(actions({ name: "r", library_artifact_type: "deep_research_report" }, "deep-research"), { download: true, versionHistory: false, openInApp: true, delete: true });
  assert.deepEqual(actions({ name: "deck", library_artifact_type: "flashcards" }, "flashcards"), { download: false, versionHistory: true, openInApp: false, delete: false });
  assert.equal(actions({ name: "a.md", access_kind: "shared" }, "note").delete, false);

  assert.equal(preview.libraryReadOnly(node({})), false);
  assert.equal(preview.libraryReadOnly(node({ access_kind: null })), true);
  assert.equal(preview.libraryReadOnly(node({}), { current: false }), true);
  assert.deepEqual(["a.pptx", "a.doc", "a.xlsm", "a.pdf", "img"].map((name) => preview.fileTypeLabel(node({ name, library_file_category: name === "img" ? "image" : null }))), ["PowerPoint", "Word 文档", "Excel 表格", "PDF", "图像"]);
});

test("a new note is named after its first line with text, as At / Ft / It name it", () => {
  const name = preview.noteFileName;
  const cases = [
    ["", "Untitled.md"],
    ["   \n\t\n", "Untitled.md"],
    ["\n\n# 季度计划\n正文", "季度计划.md"],
    ["**粗体** 和 *斜体* 与 [链接](https://x) ![图](y.png) `代码`", "粗体 和 斜体 与 链接 图 代码.md"],
    ["- [ ] 买牛奶", "买牛奶.md"],
    ["1. [x] 完成", "完成.md"],
    ["> 引用的话", "引用的话.md"],
    ["```js\nconsole.log(1)", "console.log(1).md"],
    ["<div>\n真正的标题", "真正的标题.md"],
    ["a/b\\c", "a-b-c.md"],
    ["notes.md", "notes.md"],
    ["NOTES.MD", "NOTES.md"],
    ["Tom &amp; Jerry &#x1F600;", "Tom & Jerry 😀.md"],
    ["  多个   空格\u0007 ", "多个 空格.md"],
    ["---\n标题", "标题.md"],
    ["/", "-.md"],
  ];
  for (const [content, expected] of cases) assert.equal(name(content), expected, JSON.stringify(content));
  // At most 50 graphemes, back to a word's end when the cut falls mid-word.
  const words = "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda";
  assert.equal(name(words), "alpha beta gamma delta epsilon zeta eta theta iota.md");
  assert.equal(name(`${"x".repeat(49)} y`), `${"x".repeat(49)}.md`);
  assert.equal(name(`${"x".repeat(50)} y`), `${"x".repeat(50)}.md`);
  assert.equal(name("字".repeat(60)), `${"字".repeat(50)}.md`);
  // A grapheme is one, however many code points.
  const family = String.fromCodePoint(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467);
  assert.equal(name(family.repeat(51)), `${family.repeat(50)}.md`);
});

test("a note's save failure is storage, size, or anything else (409 too)", () => {
  const cloud = (status, body) => preview.noteFailure(new CloudError(status, "x", undefined, true, body));
  assert.equal(cloud(400, { detail: { code: "library_storage_limit_exceeded" } }), "storage");
  assert.equal(cloud(403, { error_code: "library_storage_limit_exceeded" }), "storage");
  assert.equal(cloud(422, { detail: "library_storage_limit_exceeded" }), "storage");
  assert.equal(cloud(413, { detail: "too big" }), "size");
  assert.equal(cloud(409, { detail: "conflict" }), "save");
  assert.equal(cloud(500, null), "save");
  assert.equal(preview.noteFailure(new TypeError("Failed to fetch")), "save");
});

// ---------------------------------------------------------------------------
// The note session

const NOTE = "libfile_note";
const saveAnswer = (body, version = 2) => ({ id: NOTE, file_id: `file_v${version}`, file_name: body.file_name, directory_id: null, current_version_number: version, access_kind: "owned" });

test("typing saves once 500 ms after the last change, the latest text, empty as a newline", async (t) => {
  fresh();
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let version = 1;
  const calls = bridge(t, { routes: { [`PATCH /files/library/files/${NOTE}`]: (body) => [200, saveAnswer(body, ++version)] } });
  const session = preview.openNote(node({ id: NOTE, name: "旧名.md" }), "原文");
  const seen = [];
  session.subscribe(() => seen.push(session.state.saving));
  session.edit("一");
  t.mock.timers.tick(300);
  session.edit("一二");
  t.mock.timers.tick(300);
  session.edit("一二三");
  t.mock.timers.tick(499);
  await settle();
  assert.equal(cloudCalls(calls).length, 0);
  t.mock.timers.tick(1);
  await settle();
  assert.deepEqual(calls.filter((call) => call.method).map((call) => call.body), [{ inline_content: "一二三", file_name: "旧名.md" }]);
  assert.deepEqual([session.state.savedContent, session.state.versionNumber, session.state.file.fileId, session.state.saving], ["一二三", 2, "file_v2", false]);
  assert.ok(seen.includes(true));
  // Emptied, it saves a newline (the library takes no empty note).
  session.edit("");
  t.mock.timers.tick(500);
  await settle();
  assert.equal(calls.filter((call) => call.method).at(-1).body.inline_content, "\n");
  // Nothing changed: a flush sends nothing.
  assert.equal(await session.flush(), true);
  assert.equal(cloudCalls(calls).length, 2);
});

test("one save runs at a time and keeps going until the text stops changing", async (t) => {
  fresh();
  const held = [];
  const calls = bridge(t, { routes: { [`PATCH /files/library/files/${NOTE}`]: (body) => new Promise((resolve) => held.push(() => resolve([200, saveAnswer(body)]))) } });
  const session = preview.openNote(node({ id: NOTE, name: "n.md" }), "a");
  session.edit("ab");
  const first = session.flush();
  await settle();
  session.edit("abc");
  session.edit("abcd");
  const second = session.flush();
  assert.equal(second, first, "a flush during a save waits for that save");
  await settle();
  assert.equal(held.length, 1, "never two saves at once");
  held.shift()();
  await settle();
  assert.equal(held.length, 1, "the save goes on with the newer text");
  assert.equal(calls.filter((call) => call.method).at(-1).body.inline_content, "abcd");
  held.shift()();
  assert.equal(await first, true);
  assert.equal(cloudCalls(calls).length, 2);
  assert.equal(session.state.savedContent, "abcd");
});

test("after a failed save, typing waits for 重试; 409, 413 and a full storage say so", async (t) => {
  fresh();
  clearToasts();
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let answer = [500, { detail: "boom" }];
  const calls = bridge(t, { routes: { [`PATCH /files/library/files/${NOTE}`]: (body) => (answer[0] === 200 ? [200, saveAnswer(body)] : answer) } });
  const session = preview.openNote(node({ id: NOTE, name: "n.md" }), "a");
  session.edit("ab");
  t.mock.timers.tick(500);
  await settle();
  assert.equal(session.state.failure, "save");
  session.edit("abc");
  t.mock.timers.tick(5000);
  await settle();
  assert.equal(cloudCalls(calls).length, 1, "autosave waits after a failure");

  answer = [409, { detail: "The file changed" }];
  assert.equal(await session.flush(), false);
  assert.equal(session.state.failure, "save");
  answer = [413, { detail: "Request Entity Too Large" }];
  assert.equal(await session.flush(), false);
  assert.equal(session.state.failure, "size");
  // A full storage: a toast that stays, its 重试 saving again.
  answer = [400, { detail: { code: "library_storage_limit_exceeded", message: "full" } }];
  assert.equal(await session.flush(), false);
  assert.equal(session.state.failure, "storage");
  const [shown] = toasts();
  assert.deepEqual([shown.kind, shown.title, shown.timeout, shown.action.label], ["danger", "未成功保存笔记", Infinity, "重试"]);
  answer = [200];
  shown.action.run();
  await settle();
  assert.equal(session.state.failure, null);
  assert.equal(session.state.savedContent, "abc");
  assert.ok(!toasts().some((toast) => toast.title === "未成功保存笔记"), "the storage toast goes when saving again");
  assert.equal(calls.filter((call) => call.method).at(-1).body.inline_content, "abc");
  // A note past what the bridge carries in a call fails as too large, without a call.
  const before = cloudCalls(calls).length;
  session.edit("x".repeat(1024 * 1024));
  assert.equal(await session.flush(), false);
  assert.equal(session.state.failure, "size");
  assert.equal(cloudCalls(calls).length, before);
});

test("a new note is created on its first save with text, under one create_key, and named after its first line", async (t) => {
  fresh();
  let fail = 1;
  const created = (body) => ({ id: "libfile_new", file_id: "file_new", file_name: body.file_name, directory_id: "libdir_d", current_version_number: 1, access_kind: "owned" });
  const calls = bridge(t, {
    routes: {
      "POST /files/library/files/inline-content": (body) => (fail-- > 0 ? [0] : [200, created(body)]),
      "PATCH /files/library/files/libfile_new": (body) => [200, { ...created(body), current_version_number: 2 }],
    },
  });
  const session = preview.newNote("libdir_d");
  assert.equal(await session.flush(), true, "nothing typed: nothing made");
  session.edit("   ");
  assert.equal(await session.flush(), true, "only spaces: nothing made");
  assert.equal(cloudCalls(calls).length, 0);
  session.edit("# 第一行\n正文");
  assert.equal(session.state.fileName, "第一行.md");
  assert.equal(await session.flush(), false, "the bridge fails once");
  session.edit("# 改过的标题\n正文");
  // 重试 sends what the first try sent, under the same key: the create is idempotent.
  assert.equal(await session.flush(), true);
  const posts = calls.filter((call) => call.path === "/files/library/files/inline-content").map((call) => call.body);
  assert.equal(posts.length, 2);
  assert.deepEqual(posts[0], { content: "# 第一行\n正文", file_name: "第一行.md", create_key: session.key, directory_id: "libdir_d", library_file_info: { library_artifact_type: "writing_block" } });
  assert.deepEqual(posts[1], posts[0]);
  // The desktop app's noteId (slate-create-menu Qn).
  assert.match(session.key, /^library-note:[0-9a-f-]{36}$/);
  // Then the newer text and name go in as an update of the file it made.
  const patch = calls.find((call) => call.method === "PATCH");
  assert.deepEqual(patch.body, { inline_content: "# 改过的标题\n正文", file_name: "改过的标题.md" });
  assert.equal(session.state.file.id, "libfile_new");
  // Its name still follows the first line this session.
  session.edit("别的");
  assert.equal(session.state.fileName, "别的.md");
  // Opened by its file now, it is the same session.
  assert.equal(preview.openNote(node({ id: "libfile_new", name: "改过的标题.md" }), "x"), session);
});

test("closing flushes and stays open on failure; a view let go with unsaved changes toasts, and the draft comes back", async (t) => {
  fresh();
  clearToasts();
  let ok = false;
  bridge(t, { routes: { "POST /files/library/files/inline-content": (body) => (ok ? [200, { id: "libfile_d", file_id: "file_d", file_name: body.file_name, current_version_number: 1 }] : [500, {}]) } });
  const session = preview.newNote(null);
  const detach = session.attach();
  session.edit("草稿");
  assert.equal(await session.close(), false, "a failed save keeps it open");
  detach();
  await settle();
  const [shown] = toasts();
  assert.deepEqual([shown.kind, shown.timeout], ["danger", Infinity]);
  assert.match(shown.title, /^笔记更改未能保存。请返回资料库重试/);
  // 新建 → 笔记 opens that draft again, its text there.
  assert.equal(preview.newNote(null), session);
  assert.equal(session.state.content, "草稿");
  ok = true;
  const again = session.attach();
  again();
  await settle();
  assert.equal(session.state.file.id, "libfile_d");
  assert.notEqual(preview.newNote(null), session, "saved and let go: the next 新建 → 笔记 is a new note");
  // StrictMode's mount, unmount, mount: no toast, the session stays.
  clearToasts();
  const next = preview.newNote(null);
  next.attach()();
  const kept = next.attach();
  await settle();
  assert.equal(toasts().length, 0);
  kept();
});

test("a panel opened again takes the note's session as it is: no save on the hand-over, a failure still waiting", async (t) => {
  fresh();
  clearToasts();
  let ok = false;
  const calls = bridge(t, { routes: { [`PATCH /files/library/files/${NOTE}`]: (body) => (ok ? [200, saveAnswer(body)] : [500, {}]) } });
  const session = preview.openNote(node({ id: NOTE, name: "n.md" }), "原文");
  const first = session.attach();
  session.edit("改动");
  assert.equal(await session.flush(), false);
  ok = true;
  // The old panel lets go as the new one (found by the file's id) takes it, in one commit.
  first();
  assert.equal(preview.noteSessionOf(NOTE), session);
  const second = session.attach();
  await settle();
  assert.equal(cloudCalls(calls).length, 1, "nothing sent on the hand-over");
  assert.deepEqual([session.state.failure, session.state.content], ["save", "改动"]);
  assert.equal(toasts().length, 0);
  // Let go for good, it saves on the way out.
  second();
  await settle();
  assert.equal(cloudCalls(calls).length, 2);
  assert.equal(session.state.failure, null);
});

test("a full storage closes anyway and is not flushed on the way out", async (t) => {
  fresh();
  clearToasts();
  const calls = bridge(t, { routes: { [`PATCH /files/library/files/${NOTE}`]: () => [403, { error_code: "library_storage_limit_exceeded" }] } });
  const session = preview.openNote(node({ id: NOTE, name: "n.md" }), "a");
  const detach = session.attach();
  session.edit("ab");
  assert.equal(await session.close(), true);
  assert.equal(session.state.failure, "storage");
  detach();
  await settle();
  assert.equal(cloudCalls(calls).length, 1);
  assert.deepEqual(toasts().map((toast) => toast.title), ["未成功保存笔记"]);
});

test("a note renamed in the list saves under its new name; a new note's name keeps following its first line", async (t) => {
  fresh();
  let version = 1;
  const calls = bridge(t, {
    routes: {
      [`PATCH /files/library/files/${NOTE}`]: (body) => [200, saveAnswer(body, ++version)],
      "POST /files/library/files/inline-content": (body) => [200, { id: "libfile_made", file_id: "file_made", file_name: body.file_name, current_version_number: 1, access_kind: "owned" }],
    },
  });
  const session = preview.openNote(node({ id: NOTE, name: "a.md" }), "原文");
  session.adopt({ id: "libfile_other", name: "x.md" });
  assert.equal(session.state.fileName, "a.md", "another file's name is not its own");
  session.adopt({ id: NOTE, name: "b.md" });
  assert.deepEqual([session.state.fileName, session.state.file.name], ["b.md", "b.md"]);
  session.edit("改过");
  assert.equal(await session.flush(), true);
  assert.deepEqual(calls.filter((call) => call.method).map((call) => call.body), [{ inline_content: "改过", file_name: "b.md" }]);

  const made = preview.newNote(null);
  made.edit(["# 标题", "正文"].join(String.fromCharCode(10)));
  assert.equal(await made.flush(), true);
  made.adopt({ id: "libfile_made", name: "别名.md" });
  assert.equal(made.state.fileName, "标题.md", "a new note's name follows its first line this session (At)");
});

test("a restored version's text replaces the note's, read anew by its id; unreadable, editing waits for 重试", async (t) => {
  fresh();
  let readable = false;
  const calls = bridge(t, { content: { [`${NOTE}|`]: () => (readable ? new Response("恢复后的文本") : new Response("no", { status: 502 })) } });
  const session = preview.openNote(node({ id: NOTE, name: "n.md" }), "当前文本");
  const restored = node({ id: NOTE, name: "n.md", file_id: "file_v1", current_version_number: 3 });
  assert.equal(await session.reload(restored), false);
  assert.equal(session.state.restore, "failed");
  assert.equal(session.state.content, "当前文本");
  readable = true;
  assert.equal(await session.reload(), true, "重试 reads the same file again");
  assert.deepEqual([session.state.content, session.state.savedContent, session.state.versionNumber, session.state.restore], ["恢复后的文本", "恢复后的文本", 3, null]);
  // By the note's own id (content_url), not the restored version's file id.
  assert.deepEqual(calls.map((call) => call.content), [`${NOTE}|`, `${NOTE}|`]);
});

// ---------------------------------------------------------------------------
// Flashcards

const card = (id, front = `正面 ${id}`, back = `背面 ${id}`) => ({ id, front, back });
const deck = (cards, title = "生物") => ({ schema_version: 1, artifact_type: "flashcards", title, cards });

test("a flashcard set is checked as data C checks it", () => {
  const parse = preview.parseFlashcards;
  assert.deepEqual(parse({ ...deck([card("a")]), extra: 1, cards: [{ ...card("a"), hint: "x" }] }), deck([card("a")]));
  assert.equal(parse(deck([card("a")], "")), null);
  assert.ok(parse(deck([card("a")], "题".repeat(120))));
  assert.equal(parse(deck([card("a")], "题".repeat(121))), null);
  assert.equal(parse(deck([])), null);
  assert.ok(parse(deck(Array.from({ length: 100 }, (_, i) => card(`c${i}`)))));
  assert.equal(parse(deck(Array.from({ length: 101 }, (_, i) => card(`c${i}`)))), null);
  assert.equal(parse(deck([card("a"), card("a")])), null, "ids are distinct");
  assert.equal(parse(deck([card("")])), null);
  assert.ok(parse(deck([card("i".repeat(128))])));
  assert.equal(parse(deck([card("i".repeat(129))])), null);
  // Sides: 1–400 code points (an emoji is one).
  assert.ok(parse(deck([card("a", "😀".repeat(400))])));
  assert.equal(parse(deck([card("a", "😀".repeat(401))])), null);
  assert.equal(parse(deck([card("a", "")])), null);
  assert.equal(parse(deck([card("a", "f", 3)])), null);
  assert.equal(parse({ ...deck([card("a")]), schema_version: 2 }), null);
  assert.equal(parse({ ...deck([card("a")]), artifact_type: "quiz" }), null);
  assert.equal(parse([deck([card("a")])]), null);
  assert.equal(preview.flashcardSideTooLong("a".repeat(400)), false);
  assert.equal(preview.flashcardSideTooLong("a".repeat(401)), true);
});

test("an edit fits the set only as its editor saw it (persistence T), and goes in as C puts it", () => {
  const server = deck([card("a"), card("b")]);
  const fits = preview.flashcardEditApplies;
  assert.equal(fits({ card: card("c"), previousCard: null }, server), true);
  assert.equal(fits({ card: card("a"), previousCard: null }, server), false, "a new card's id is taken");
  assert.equal(fits({ card: card("a", "新"), previousCard: card("a") }, server), true);
  assert.equal(fits({ card: card("a", "新"), previousCard: card("a", "旧") }, server), false, "changed elsewhere since");
  assert.equal(fits({ card: card("z", "新"), previousCard: card("z") }, server), false, "deleted elsewhere since");
  assert.equal(fits({ card: card("a"), previousCard: card("a"), delete: true }, server), true);
  assert.equal(fits({ card: card("z"), previousCard: card("z"), delete: true }, server), true, "already gone");
  assert.equal(fits({ card: card("a"), previousCard: card("a"), delete: true }, deck([card("a")])), false, "the last card stays");
  const apply = preview.applyFlashcardEdit;
  assert.deepEqual(apply(server, { card: card("a", "新"), previousCard: card("a") }).cards.map((c) => c.front), ["新", "正面 b"]);
  assert.deepEqual(apply(server, { card: card("c"), previousCard: null }).cards.map((c) => c.id), ["a", "b", "c"]);
  assert.deepEqual(apply(server, { card: card("a"), previousCard: card("a"), delete: true }).cards.map((c) => c.id), ["b"]);
});

const DECK = "libfile_deck";
const deckNode = (fields = {}) => ({ id: DECK, kind: "file", name: "生物.flashcards", library_artifact_type: "flashcards", access_kind: "owned", ...fields });

test("a write reads the set anew, checks the card, and sends its version; a 409 is replayed once", async (t) => {
  fresh();
  let server = deck([card("a"), card("b")]);
  let conflicts = 1;
  const patches = [];
  const calls = bridge(t, {
    routes: {
      [`GET /files/library/files/${DECK}/node`]: () => [200, deckNode()],
      [`GET /files/library/files/${DECK}/versions?limit=1`]: () => [200, { items: [{ version_number: 7, is_current: false }, { version_number: 8, is_current: true }] }],
      [`PATCH /learning/flashcards/${DECK}`]: (body) => {
        patches.push(body);
        if (conflicts-- > 0) {
          // Someone else saved meanwhile, another card.
          server = deck([card("a"), card("b"), card("x")]);
          return [409, { detail: "version conflict" }];
        }
        server = body.artifact;
        return [200, { current_version_number: 9 }];
      },
    },
    content: { [`${DECK}|`]: () => new Response(JSON.stringify(server)) },
  });
  const queue = preview.flashcardQueue(DECK);
  assert.equal(preview.flashcardQueue(DECK), queue, "one queue per set");
  assert.deepEqual((await queue.load()).cards.map((c) => c.id), ["a", "b"]);
  const saved = [];
  queue.enqueue({ id: "e1", card: card("a", "新正面"), previousCard: card("a") }, { onSaved: () => saved.push("e1") });
  assert.deepEqual(preview.flashcardView(queue.state).cards.map((c) => c.front), ["新正面", "正面 b"], "shown at once");
  await settle();
  assert.equal(patches.length, 2);
  // No version on the node: the current one from versions; the replay reads again.
  assert.deepEqual(patches.map((body) => body.expected_current_version), [8, 8]);
  assert.deepEqual(patches[0].artifact.cards.map((c) => c.front), ["新正面", "正面 b"]);
  assert.deepEqual(patches[1].artifact.cards.map((c) => c.id), ["a", "b", "x"], "replayed over what is there now");
  assert.deepEqual(saved, ["e1"]);
  assert.deepEqual([queue.state.pending.length, queue.state.failed.length], [0, 0]);
  assert.deepEqual(queue.state.deck.cards.map((c) => c.front), ["新正面", "正面 b", "正面 x"]);
  // Every content read is the current set by its id.
  assert.ok(calls.filter((call) => call.content).every((call) => call.content === `${DECK}|`));
});

test("a card changed elsewhere is not overwritten; two 409s fail; writes go one at a time", async (t) => {
  fresh();
  clearToasts();
  let server = deck([card("a", "别人改的"), card("b")]);
  let status = 200;
  let inFlight = 0;
  let most = 0;
  const calls = bridge(t, {
    routes: {
      [`GET /files/library/files/${DECK}/node`]: () => [200, { ...deckNode(), current_version_number: 4 }],
      [`PATCH /learning/flashcards/${DECK}`]: async (body) => {
        most = Math.max(most, ++inFlight);
        await tick();
        inFlight--;
        if (status !== 200) return [status, { detail: "conflict" }];
        server = body.artifact;
        return [200, { current_version_number: 5 }];
      },
    },
    content: { [`${DECK}|`]: () => new Response(JSON.stringify(server)) },
  });
  const queue = preview.flashcardQueue(DECK);
  const recovered = [];
  queue.enqueue({ id: "e1", card: card("a", "我的"), previousCard: card("a") }, { onRecover: (edit) => recovered.push(edit.id) });
  await settle();
  assert.equal(calls.filter((call) => call.method === "PATCH").length, 0, "the card changed since its editor opened");
  assert.deepEqual(queue.state.failed.map((edit) => edit.id), ["e1"]);
  const [shown] = toasts();
  assert.deepEqual([shown.title, shown.kind, shown.timeout, shown.action.label], ["未能保存你对闪卡的更改", "danger", Infinity, "恢复草稿"]);
  shown.action.run();
  assert.deepEqual(recovered, ["e1"]);

  // Two writes queued: the second reads only after the first is written.
  queue.enqueue({ id: "e2", card: card("b", "b1"), previousCard: card("b") });
  queue.enqueue({ id: "e3", card: card("c"), previousCard: null });
  assert.deepEqual(queue.state.failed.length, 1, "e1's failure stays: another card");
  await settle();
  assert.equal(most, 1);
  const patches = calls.filter((call) => call.method === "PATCH").map((call) => call.body);
  assert.deepEqual(patches.map((body) => body.artifact.cards.map((c) => c.id)), [["a", "b"], ["a", "b", "c"]]);
  assert.deepEqual(patches.map((body) => body.expected_current_version), [4, 4]);
  // Re-queuing a card clears its failure.
  queue.enqueue({ id: "e4", card: card("a", "我的"), previousCard: card("a", "别人改的") });
  assert.equal(queue.state.failed.length, 0);
  await settle();
  // A 409 twice: replayed once, then failed.
  status = 409;
  const before = calls.filter((call) => call.method === "PATCH").length;
  queue.enqueue({ id: "e5", card: card("b", "b2"), previousCard: card("b", "b1") });
  await settle();
  assert.equal(calls.filter((call) => call.method === "PATCH").length - before, 2);
  assert.deepEqual(queue.state.failed.map((edit) => edit.id), ["e5"]);
  assert.deepEqual(queue.state.pending, []);
});

test("a set that is not the account's own, or not a set, is not written", async (t) => {
  fresh();
  clearToasts();
  const calls = bridge(t, {
    routes: { [`GET /files/library/files/${DECK}/node`]: () => [200, deckNode({ access_kind: "shared" })] },
    content: { [`${DECK}|`]: JSON.stringify(deck([card("a")])) },
  });
  assert.deepEqual(await preview.fetchFlashcardsMeta(DECK), { version: null, readOnly: true });
  const queue = preview.flashcardQueue(DECK);
  queue.enqueue({ id: "e1", card: card("b"), previousCard: null });
  await settle();
  assert.equal(calls.filter((call) => call.method === "PATCH").length, 0);
  assert.equal(queue.state.failed.length, 1);
  assert.equal(toasts()[0].action, undefined, "no 恢复草稿 without a way to reopen it");
});

test("flashcard reads: metadata through /node, an old version by its file id, the last review of each card", async (t) => {
  fresh();
  const calls = bridge(t, {
    routes: {
      [`GET /files/library/files/${DECK}/node`]: deckNode({ current_version_number: 3 }),
      "GET /files/library/files/libfile_other/node": { id: "libfile_other", kind: "file", name: "a.md", library_artifact_type: "writing_block", access_kind: "owned" },
      "GET /files/library/files/libfile_gone/node": { ...deckNode({ id: "libfile_gone" }), trashed_at: "2026-10-01T00:00:00Z" },
      [`GET /learning/flashcards/${DECK}/progress`]: { card_progress: { a: { review_count: 2, reviews: [{ outcome: "missed" }, { outcome: "known" }] }, b: { reviews: [{ outcome: "missed" }] }, c: { reviews: [] }, d: {} } },
    },
    content: { [`${DECK}|file_old`]: JSON.stringify(deck([card("old")])), [`${DECK}|`]: "not json" },
  });
  assert.deepEqual(await preview.fetchFlashcardsMeta(DECK), { version: 3, readOnly: false });
  await assert.rejects(preview.fetchFlashcardsMeta("libfile_other"));
  await assert.rejects(preview.fetchFlashcardsMeta("libfile_gone"));
  assert.deepEqual((await preview.fetchFlashcards({ id: DECK, name: "d" }, "file_old")).cards.map((c) => c.id), ["old"]);
  await assert.rejects(preview.fetchFlashcards({ id: DECK, name: "d" }));
  assert.deepEqual(await preview.fetchFlashcardProgress(DECK), { a: "known", b: "missed" });
  assert.ok(cloudCalls(calls).includes(`GET /learning/flashcards/${DECK}/progress`));
});

test("the CSV export quotes every value and defuses formulas", () => {
  const { name, text } = preview.flashcardsCsv(deck([card("a", "=1+1", 'say "hi"'), card("b", "+x", "-y"), card("c", "@z", "  =trim"), card("d", "\tTab", "line\nbreak"), card("e", "普通", "a,b")], 'Bio: "1/2"?.csv'));
  assert.equal(name, "Bio- -1-2--.csv");
  assert.equal(text, 'Front,Back\r\n"\'=1+1","say ""hi"""\r\n"\'+x","\'-y"\r\n"\'@z","\'  =trim"\r\n"\'\tTab","line\nbreak"\r\n"普通","a,b"\r\n');
  assert.equal(preview.flashcardsCsv(deck([card("a")], "  .flashcards")).name, "Flashcards.csv");
  assert.equal(preview.flashcardsCsv(deck([card("a")], "生物.FLASHCARDS")).name, "生物.csv");
});

// ---------------------------------------------------------------------------
// Files, versions, details, deep research

test("a file by id: /node, an own untyped image typed by its newest version", async (t) => {
  fresh();
  const calls = bridge(t, {
    routes: {
      "GET /files/library/files/libfile_img/node": { id: "libfile_img", kind: "file", name: "a.png", library_file_category: "image", library_artifact_type: null, access_kind: "owned", file_id: "file_img", file_extension: "png", record_creation_time: "2026-10-01T00:00:00Z", origination_thread_id: "c0ffee-1" },
      "GET /files/library/files/libfile_img/versions?limit=1": { items: [{ version_number: 1, library_artifact_type: "image_gen" }] },
      "GET /files/library/files/libfile_txt/node": { id: "libfile_txt", kind: "file", name: "a.txt", access_kind: "owned" },
    },
  });
  const image = await preview.fetchLibraryNode("libfile_img");
  assert.deepEqual([image.artifact, image.extension, image.access, image.createdAt, image.threadId], ["image_gen", "png", "owned", Date.parse("2026-10-01T00:00:00Z"), "c0ffee-1"]);
  assert.equal((await preview.fetchLibraryNode("libfile_txt")).name, "a.txt");
  assert.deepEqual(cloudCalls(calls), ["GET /files/library/files/libfile_img/node", "GET /files/library/files/libfile_img/versions?limit=1", "GET /files/library/files/libfile_txt/node"]);
  await assert.rejects(preview.fetchLibraryNode("libfile_missing"));
});

test("versions page by 20, group by day, preview by their file id, and restore against the current one", async (t) => {
  fresh();
  clearToasts();
  const day = (offset, hour) => new Date(2026, 9, 30 + offset, hour).toISOString();
  let restore = [200, { id: "libfile_a", file_id: "file_v4", file_name: "a.txt", current_version_number: 4, directory_id: null }];
  const calls = bridge(t, {
    routes: {
      "GET /files/library/files/libfile_a/versions?limit=20": { items: [
        { version_number: 3, is_current: true, file_id: "file_v3", file_name: "a.txt", version_created_at: day(0, 10), version_provenance: { action: "edit", actor: "user", actor_id: " user-2 ", actor_display_name: " 小明 " } },
        { version_number: 2, is_current: false, file_id: "file_v2", file_name: "a-old.txt", version_created_at: day(0, 9), version_provenance: { action: "edit", actor: "agent", reason: "整理" } },
        { version_number: 1, is_current: false, file_id: "file_v1", file_name: "a.txt", version_created_at: day(-1, 9), version_provenance: { action: "create" } },
        { version_number: null },
      ], cursor: "next+1" },
      "GET /files/library/files/libfile_a/versions?cursor=next%2B1&limit=20": { items: [{ version_number: 0, file_upload_time: day(-5, 9) }] },
      "POST /files/library/files/libfile_a/versions/1/restore": () => restore,
    },
  });
  const page = await preview.fetchLibraryVersions("libfile_a");
  assert.deepEqual(page.items.map((v) => [v.number, v.current, v.fileId, v.action, v.actor, v.actorId, v.reason]), [
    [3, true, "file_v3", "edit", "user", "user-2", null],
    [2, false, "file_v2", "edit", "agent", null, "整理"],
    [1, false, "file_v1", "create", null, null, null],
  ]);
  assert.equal(page.cursor, "next+1");
  const older = await preview.fetchLibraryVersions("libfile_a", page.cursor);
  // te: ChatGPT for the agent, 协作者 for anyone but this login, never a name; version 0 was made, the rest edited.
  assert.deepEqual(page.items.map((v) => [preview.versionAuthor(v, { userId: "user-1" }), preview.versionAuthor(v, { userId: "user-2" }), preview.versionAuthor(v, null), preview.versionAuthor(v, {})]), [
    ["协作者", null, null, null],
    ["ChatGPT", "ChatGPT", "ChatGPT", "ChatGPT"],
    [null, null, null, null],
  ]);
  // The real account's actor_id is the user id (user-…), the login's accountUserId user-…__<account>: either is this login.
  const me = { userId: "user-2", accountUserId: "user-2__acct-1" };
  assert.equal(preview.versionAuthor({ actor: "user", actorId: "user-2" }, me), null);
  assert.equal(preview.versionAuthor({ actor: "user", actorId: "user-2__acct-1" }, me), null);
  assert.equal(preview.versionAuthor({ actor: "user", actorId: "user-2__acct-1" }, { accountUserId: "user-2__acct-1" }), null);
  assert.equal(preview.versionAuthor({ actor: "user", actorId: "user-3" }, me), "协作者");
  assert.equal(preview.versionAuthor({ actor: "user", actorId: "user-2__acct-9" }, me), "协作者");
  assert.deepEqual([...page.items, ...older.items].map(preview.versionAction), ["edit", "edit", "create", "create"]);
  assert.equal(preview.versionAction({ action: null, number: 4 }), "edit");
  const days = preview.versionDays([...page.items, ...older.items], new Date(2026, 9, 30, 12).getTime());
  assert.deepEqual(days.map((group) => [group.kind, group.items.map((v) => v.number)]), [["today", [3, 2]], ["yesterday", [1]], ["date", [0]]]);

  const file = node({ id: "libfile_a" });
  const old = preview.versionNode(file, page.items[1]);
  assert.deepEqual([old.fileId, old.name, old.version], ["file_v2", "a-old.txt", 2]);
  assert.match(library.libraryContentUrl(old, "content"), /[?&]fileId=file_v2(&|$)/);

  const generation = library.libraryState().generation;
  const restored = await preview.restoreLibraryVersion(file, page.items[2], page.items[0]);
  assert.deepEqual([restored.fileId, restored.version], ["file_v4", 4]);
  assert.deepEqual(calls.find((call) => call.path?.endsWith("/restore")).body, { expected_current_version: 3 });
  assert.ok(library.libraryState().generation > generation, "the library reads anew");
  // The current version is never restored; a refusal toasts.
  assert.equal(await preview.restoreLibraryVersion(file, page.items[0], page.items[0]), null);
  restore = [409, { detail: "changed" }];
  assert.equal(await preview.restoreLibraryVersion(file, page.items[2], page.items[0]), null);
  assert.deepEqual(toasts().map((toast) => toast.title), ["文件已更改，或无法恢复此版本。请重试"]);
  assert.equal(calls.filter((call) => call.path?.endsWith("/restore")).length, 2);
});

test("file details: the newest version's time and the chat's title", async (t) => {
  fresh();
  bridge(t, {
    routes: {
      "GET /files/library/files/libfile_a/versions?limit=1": { items: [{ version_number: 2, version_created_at: "2026-10-29T08:00:00Z" }] },
      "GET /conversation/c0ffee-1": { title: "季度复盘", mapping: {} },
      "GET /files/library/files/libfile_b/versions?limit=1": () => [403, {}],
    },
  });
  assert.deepEqual(await preview.fetchLibraryFileInfo(node({ id: "libfile_a", origination_thread_id: "c0ffee-1" })), { updatedAt: Date.parse("2026-10-29T08:00:00Z"), chat: { id: "c0ffee-1", title: "季度复盘" } });
  const plain = node({ id: "libfile_b", updated_at: "2026-10-01T00:00:00Z", origination_thread_id: "gone" });
  assert.deepEqual(await preview.fetchLibraryFileInfo(plain), { updatedAt: Date.parse("2026-10-01T00:00:00Z"), chat: null });
});

test("a deep research report's text: get_state's first, then tool_output's; none is null", async (t) => {
  fresh();
  const path = "/files/library/files/libfile_dr/deep-research";
  let state = { isError: false, structuredContent: { status: "done", sections: [{ title: "摘要", content: "短" }, { report_markdown: "# 报告\n\n很长的正文……" }] } };
  const calls = bridge(t, {
    routes: {
      [`GET ${path}`]: { widget_state: {}, tool_output: { report: "tool_output 里的", title: "x" }, tool_response_metadata: {} },
      [`POST ${path}/tools/get_state`]: () => [200, state],
    },
  });
  assert.equal(await preview.fetchDeepResearch("libfile_dr"), "# 报告\n\n很长的正文……");
  assert.deepEqual(calls.filter((call) => call.method === "POST").map((call) => call.body), [{ args: {} }]);
  state = { isError: true, structuredContent: { text: "错误" } };
  assert.equal(await preview.fetchDeepResearch("libfile_dr"), "tool_output 里的");
  state = { isError: false, structuredContent: { items: [1, 2] } };
  assert.equal(await preview.fetchDeepResearch("libfile_dr"), "tool_output 里的");
  assert.equal(preview.reportText({ id: "x", count: 3, nested: { label: "y" } }), null);
  await assert.rejects(preview.fetchDeepResearch("libfile_none"));
});

test("text is cut at 5 000 000 characters; a file opens in its app from a saved copy, or the copy goes", async (t) => {
  fresh();
  const fake = bridge(t, {
    content: { "libfile_big|file_big": "x".repeat(5_000_001), "libfile_small|file_v1": "small" },
    attach: { path: "C:\\Users\\me\\.codex\\attachments\\0b5c3c4e-0d2a-4f7e-9c1d-2a6b8f0e4d21\\a.txt", label: "a.txt" },
  });
  const big = await preview.fetchLibraryText(node({ id: "libfile_big", file_id: "file_big" }));
  assert.deepEqual([big.text.length, big.truncated], [5_000_000, true]);
  assert.deepEqual(await preview.fetchLibraryText(node({ id: "libfile_small", file_id: "file_now" }), "file_v1"), { text: "small", truncated: false });
  await assert.rejects(preview.fetchLibraryText(node({ id: "libfile_missing" })));
  // A note's old version goes as kind=note (the bridge reads it as the writing-block history does), by the version's file id.
  assert.deepEqual(await preview.fetchLibraryText(node({ id: "libfile_small", file_id: "file_v1" }), null, "note"), { text: "small", truncated: false });
  assert.deepEqual(fake.filter((call) => call.content).map((call) => call.kind), ["content", "content", "content", "note"]);

  assert.equal(await preview.openLibraryFileInApp(node({ id: "libfile_a", file_id: "file_a", name: "a.txt", file_size_bytes: 5 })), "opened");
  const attach = fake.find((call) => call.attach === "POST");
  assert.deepEqual(attach.body, { id: "libfile_a", fileId: "file_a", name: "a.txt", size: 5 });
  assert.deepEqual(fake.find((call) => call.open).open, { path: "C:\\Users\\me\\.codex\\attachments\\0b5c3c4e-0d2a-4f7e-9c1d-2a6b8f0e4d21\\a.txt", editor: "default", root: "C:\\Users\\me\\.codex\\attachments\\0b5c3c4e-0d2a-4f7e-9c1d-2a6b8f0e4d21" });
  assert.equal(fake.some((call) => call.attach === "DELETE"), false);
  t.mock.restoreAll();
  const refused = bridge(t, { attach: { path: "C:\\h\\attachments\\0b5c3c4e-0d2a-4f7e-9c1d-2a6b8f0e4d21\\run.exe" }, open: false });
  assert.equal(await preview.openLibraryFileInApp(node({ name: "run.exe", file_size_bytes: 5 })), "refused");
  assert.match(refused.find((call) => call.attach === "DELETE").url, /path=C%3A%5Ch%5Cattachments%5C0b5c3c4e/);
  assert.equal(await preview.openLibraryFileInApp(node({ file_size_bytes: null })), "failed");
  assert.equal(await preview.openLibraryFileInApp(node({ file_size_bytes: 47_185_921 })), "failed");
});

// ---------------------------------------------------------------------------

test("an Office zip is inflated and counted before a renderer gets it, whatever its directory claims", async () => {
  const small = new JSZip();
  small.file("word/document.xml", "<w:document/>");
  small.file("media/a.bin", new Uint8Array(1000));
  const bytes = await small.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  const zip = await preview.unzipWithin(bytes);
  assert.equal(await zip.file("word/document.xml").async("string"), "<w:document/>");

  const bomb = new JSZip();
  bomb.file("a.xml", new Uint8Array(600_000));
  bomb.file("b.xml", new Uint8Array(600_000));
  const packed = await bomb.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  assert.ok(packed.length < 10_000, "zeros pack small");
  assert.equal(await preview.unzipWithin(packed, 1_000_000), null, "over the limit across entries");
  assert.ok(await preview.unzipWithin(packed, 1_200_000));

  // The central directory says 10 bytes each: still counted as inflated.
  const forged = packed.slice();
  const view = new DataView(forged.buffer);
  for (let at = 0; at < forged.length - 4; at++) {
    if (view.getUint32(at, true) === 0x02014b50) view.setUint32(at + 24, 10, true);
    if (view.getUint32(at, true) === 0x04034b50) view.setUint32(at + 22, 10, true);
  }
  const outcome = await preview.unzipWithin(forged, 1_000_000).catch(() => "rejected");
  assert.ok(outcome === null || outcome === "rejected", "never handed on as fitting");
  await assert.rejects(preview.unzipWithin(new TextEncoder().encode("not a zip")));
});

test("SheetJS reads only the entries that were counted, not a directory JSZip reads otherwise", async () => {
  const { deflateRawSync } = await import("node:zlib");
  // A zip by hand: `entries` name local records (by index) in the central directory, any number of times.
  const zipOf = (locals, entries) => {
    const parts = [];
    const offsets = [];
    let at = 0;
    for (const { name, data, size } of locals) {
      const head = Buffer.alloc(30);
      head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(8, 8);
      head.writeUInt32LE(data.length, 18); head.writeUInt32LE(size, 22); head.writeUInt16LE(Buffer.byteLength(name), 26);
      offsets.push(at);
      parts.push(head, Buffer.from(name), data);
      at += 30 + Buffer.byteLength(name) + data.length;
    }
    const directory = entries.map(({ local, name = locals[local].name, attributes = 0 }) => {
      const head = Buffer.alloc(46);
      head.writeUInt32LE(0x02014b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(20, 6); head.writeUInt16LE(8, 10);
      head.writeUInt32LE(locals[local].data.length, 20); head.writeUInt32LE(locals[local].size, 24); head.writeUInt16LE(Buffer.byteLength(name), 28);
      head.writeUInt32LE(attributes, 38); head.writeUInt32LE(offsets[local], 42);
      return Buffer.concat([head, Buffer.from(name)]);
    });
    const central = Buffer.concat(directory);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(central.length, 12); end.writeUInt32LE(at, 16);
    return new Uint8Array(Buffer.concat([...parts, central, end]));
  };
  const big = 2 * 1024 * 1024;
  const bomb = { name: "xl/workbook.xml", data: deflateRawSync(Buffer.alloc(big)), size: big };
  const tiny = { name: "xl/workbook.xml", data: deflateRawSync(Buffer.from("x")), size: 1 };
  const inflated = (bytes) => XLSX.CFB.read(bytes, { type: "array" }).FileIndex.reduce((sum, entry) => sum + (entry.content?.length ?? 0), 0);
  // One name three times over the bomb, then once over a byte: JSZip keeps the last.
  const repeated = zipOf([bomb, tiny], [{ local: 0 }, { local: 0 }, { local: 0 }, { local: 1 }]);
  // The bomb marked a directory (MS-DOS attribute 0x10): JSZip keeps no data for it.
  const folder = zipOf([bomb, { ...tiny, name: "xl/other.xml" }], [{ local: 0, attributes: 0x10 }, { local: 1 }]);
  for (const bytes of [repeated, folder]) {
    assert.ok(inflated(bytes) >= big, "read as it came, SheetJS inflates the bomb");
    const zip = await preview.unzipWithin(bytes, 1024);
    assert.ok(zip, "what JSZip counts fits");
    assert.ok(inflated(await preview.storedZip(zip)) <= 1024, "written out again, SheetJS gets only that");
  }
});
