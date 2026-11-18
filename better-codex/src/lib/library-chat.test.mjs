// Run with `pnpm test`. library-chat.ts against a fake bridge: fetch answers /api/cloud as
// server/bridge.mjs does ({ status, body }) and /api/library/attach with what a test gives; "./codex"
// is a stub (the environment, newChat), localStorage a map and window an EventTarget, so no
// app-server, login or network is involved.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { transformSync } from "esbuild";
import { cloudAllowed } from "../../server/cloud.mjs";

globalThis.requestAnimationFrame ??= (callback) => setTimeout(callback, 0);
globalThis.window ??= new EventTarget();
const saved = new Map();
globalThis.localStorage = { getItem: (key) => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, String(value)), removeItem: (key) => saved.delete(key) };
const codex = { kind: "local", chats: 0, opened: [] };
globalThis.__libraryCodexStub = {
  connectionId: () => "conn-1",
  callExperimental: async () => {},
  errorMessage: (error) => String(error),
  openLibrary: (route) => codex.opened.push(route),
  environmentKind: () => codex.kind,
  newChat: () => codex.chats++,
};
const STUB = `data:text/javascript,${encodeURIComponent("const s = globalThis.__libraryCodexStub; export const connectionId = s.connectionId, callExperimental = s.callExperimental, errorMessage = s.errorMessage, openLibrary = s.openLibrary, environmentKind = s.environmentKind, newChat = s.newChat;")}`;
registerHooks({
  resolve: (specifier, context, next) => {
    if (specifier === "./codex" && /\/(cloud|library|library-preview|library-chat)\.ts$/.test(context.parentURL ?? "")) return { url: STUB, shortCircuit: true };
    return next(/^\.\.?\/[^.]+$/.test(specifier) && context.parentURL?.endsWith(".ts") ? `${specifier}.ts` : specifier, context);
  },
  load: (url, context, next) =>
    url.startsWith("file:") && url.endsWith(".ts") ? { format: "module", shortCircuit: true, source: transformSync(readFileSync(new URL(url), "utf8"), { loader: "ts", format: "esm" }).code } : next(url, context),
});
const chat = await import("./library-chat.ts");
const library = await import("./library.ts");
const store = await import("./store.ts");
const { splitRequest } = await import("./questions.ts");

const tick = () => new Promise((resolve) => setImmediate(resolve));
const toasts = () => store.getState().toasts.filter((t) => !t.ending).map((t) => [t.kind, t.title]);
const clearToasts = () => store.setState({ toasts: [] });

/** A library file as parseNode makes it, `fields` over a plain uploaded PDF. */
const node = (fields = {}) => ({ ...library.parseNode({ id: "libfile_a", file_id: "file_a", file_name: "季度报告.pdf", mime_type: "application/pdf", file_size_bytes: 1024 }), ...fields });

/**
 * The bridge: /api/cloud answers from `routes` ("METHOD path" → body), every call checked against
 * its routes; /api/library/attach (POST) answers what `attach(body, signal)` resolves to ([status,
 * body]), DELETE logs the path.
 */
function bridge(t, { routes = {}, attach = async (body) => [200, { path: `C:\\codex\\attachments\\${body.id}\\${body.name}`, label: body.name }] } = {}) {
  const calls = { cloud: [], attach: [], detach: [] };
  t.mock.method(globalThis, "fetch", async (url, init = {}) => {
    if (url === "/api/cloud?c=conn-1") {
      const { method, path, body } = JSON.parse(init.body);
      calls.cloud.push({ method, path, body });
      assert.ok(cloudAllowed(method, path), `the bridge refuses ${method} ${path}`);
      const answer = routes[`${method} ${path}`];
      return new Response(JSON.stringify(answer === undefined ? { status: 404, body: { detail: "Not Found" } } : { status: 200, body: answer }), { status: 200 });
    }
    if (url === "/api/library/attach?c=conn-1" && init.method === "POST") {
      const body = JSON.parse(init.body);
      calls.attach.push(body);
      const [status, answer] = await attach(body, init.signal);
      init.signal?.throwIfAborted();
      return new Response(JSON.stringify(answer), { status });
    }
    const target = new URL(url, "http://bridge");
    if (target.pathname === "/api/library/attach" && init.method === "DELETE") {
      assert.equal(target.searchParams.get("c"), "conn-1");
      calls.detach.push(target.searchParams.get("path"));
      return new Response(null, { status: 204 });
    }
    throw new Error(`unexpected ${init.method ?? "GET"} ${url}`);
  });
  return calls;
}

/** An attach the test lets through (`release`) or that waits for its abort. */
function held() {
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  return {
    release: () => release(),
    attach: (body, signal) => new Promise((resolve, reject) => {
      signal?.addEventListener("abort", () => reject(signal.reason));
      gate.then(() => resolve([200, { path: `/codex/attachments/${body.id}/${body.name}`, label: `${body.name}` }]));
    }),
  };
}

let drafts = 0;
const draft = () => `draft-${++drafts}`;
const stored = (id) => JSON.parse(saved.get(`${chat.DRAFT_FILES}${id}`) ?? "null");

test("the picker asks /files/library as KNa does for native files, and keeps only what a chat takes", async (t) => {
  const items = [
    { id: "libfile_ok", file_id: "file_ok", file_name: "ok.pdf", file_size_bytes: 10, state: "ready" },
    { id: "libfile_owned", file_id: "file_o", file_name: "mine.png", access_kind: "owned", mime_type: "image/png" },
    { id: "external-gdrive:abc", file_id: "file_m", file_name: "drive.docx", access_kind: "mounted" },
    { id: "libfile_m", file_id: "file_m2", file_name: "mounted.docx", access_kind: "mounted" },
    { id: "libfile_shared", file_id: "file_s", file_name: "shared.pdf", access_kind: "shared" },
    { id: "libdir_x", kind: "directory", name: "文件夹" },
    { id: "libfile_cards", file_id: "file_c", file_name: "卡片", library_artifact_type: "flashcards" },
    { id: "libfile_saved", file_id: "file_v", file_name: "收藏", library_artifact_type: "saved_entity" },
    { id: "libfile_nofile", file_name: "no-file-id.txt" },
  ];
  const calls = bridge(t, { routes: { "POST /files/library": { items, cursor: "c2" } } });
  const page = await chat.fetchPickerPage("  季度 ", null);
  // A share goes as the account's own does (pr asks a chat nothing of access); a mounted one never.
  assert.deepEqual(page.items.map((item) => item.id), ["libfile_ok", "libfile_owned", "libfile_shared"]);
  assert.equal(page.cursor, "c2");
  await chat.fetchPickerPage("", "c2");
  assert.deepEqual(calls.cloud.map((call) => call.body), [
    { limit: 25, cursor: null, exclude_saved_responses: true, state: "ready", q: "季度" },
    { limit: 25, cursor: "c2", exclude_saved_responses: true, state: "ready", q: null },
  ]);
});

test("开始聊天 and 询问此文件 say why they wait: files only, ten at most, of a known size within 45 and 40 MiB", () => {
  const file = node();
  assert.equal(chat.startChatRefusal([file]), null);
  assert.equal(chat.startChatRefusal([]), "所选内容无法作为附件添加到聊天中");
  assert.equal(chat.startChatRefusal([file, node({ id: "libdir_a", kind: "directory" })]), "所选内容无法作为附件添加到聊天中");
  assert.equal(chat.startChatRefusal([file, node({ saved: true })]), "所选内容无法作为附件添加到聊天中");
  assert.equal(chat.startChatRefusal(Array.from({ length: 11 }, (_, i) => node({ id: `libfile_${i}` }))), "请减少所选项数量后再开始聊天");
  assert.equal(chat.startChatRefusal(Array.from({ length: 10 }, (_, i) => node({ id: `libfile_${i}` }))), null);
  assert.equal(chat.startChatRefusal([node({ size: null })]), "此文件太大，无法作为附件添加到本地聊天");
  assert.equal(chat.startChatRefusal([node({ size: 47_185_920 })]), null);
  assert.equal(chat.startChatRefusal([node({ size: 47_185_921 })]), "此文件太大，无法作为附件添加到本地聊天");
  const ask = "本地聊天仅支持大小已知且不超过 40 MB 的文件。请改用 ChatGPT 或下载此文件";
  assert.equal(chat.askRefusal(node({ size: 41_943_040 })), null);
  assert.equal(chat.askRefusal(node({ size: 41_943_041 })), ask);
  assert.equal(chat.askRefusal(node({ size: null })), ask);
  assert.equal(chat.askRefusal(node({ kind: "directory" })), "所选内容无法作为附件添加到聊天中");
  assert.equal(chat.environmentRefusal("local"), null);
  assert.equal(chat.environmentRefusal("cloud"), "云端任务只能发送文字消息");
  assert.equal(chat.environmentRefusal("ssh"), "资料库文件会保存在本机，只能添加到本地会话");
  assert.equal(chat.environmentRefusal(null), "资料库文件会保存在本机，只能添加到本地会话");
});

test("a draft's files download as pending chips, once each, and only ready ones are stored", async (t) => {
  clearToasts();
  const gate = held();
  const calls = bridge(t, { attach: gate.attach });
  const id = draft();
  const pdf = node();
  const png = node({ id: "libfile_png", fileId: "file_png", name: "图.png", mime: "image/png", version: 4 });
  const attaching = chat.attachDraftFiles(id, [pdf, png, node({ id: "libfile_big", size: 47_185_921 }), node({ id: "libfile_unknown", size: null }), pdf]);
  // Pending at once, the too-large ones left out with one toast, nothing stored yet.
  const pending = chat.draftFiles(id);
  assert.deepEqual(pending.map((chip) => [chip.libraryFileId, chip.state, chip.isImage]), [["libfile_a", "pending", false], ["libfile_png", "pending", true]]);
  assert.equal(pending[1].currentVersion, 4);
  assert.deepEqual(toasts(), [["danger", "此文件太大，无法作为附件添加到本地聊天"]]);
  assert.equal(stored(id), null);
  assert.deepEqual(calls.attach, [{ id: "libfile_a", fileId: "file_a", name: "季度报告.pdf", size: 1024 }, { id: "libfile_png", fileId: "file_png", name: "图.png", size: 1024 }]);
  // Picked again while it downloads: still one chip.
  await chat.attachDraftFiles(id, [pdf]);
  assert.equal(chat.draftFiles(id).length, 2);
  gate.release();
  await attaching;
  const ready = chat.draftFiles(id);
  assert.equal(chat.draftFiles(id), ready, "the same array until it changes");
  assert.deepEqual(ready.map((chip) => [chip.name, chip.path, chip.state, chip.owned, chip.abort]), [
    ["季度报告.pdf", "/codex/attachments/libfile_a/季度报告.pdf", "ready", true, undefined],
    ["图.png", "/codex/attachments/libfile_png/图.png", "ready", true, undefined],
  ]);
  assert.deepEqual(stored(id), ready.map(({ key, name, path, libraryFileId, fileId, currentVersion, isImage }) => ({ key, name, path, libraryFileId, fileId, ...(currentVersion === undefined ? {} : { currentVersion }), isImage, owned: true })));
  // What the message makes of them: the file block, the image once more as a localImage.
  const message = chat.libraryMessage([...ready, { ...ready[0], key: "p", state: "pending", path: undefined }], "看看");
  assert.deepEqual(message.images, [{ type: "localImage", path: "/codex/attachments/libfile_png/图.png" }]);
  assert.deepEqual(splitRequest(message.text), {
    files: [
      { label: "季度报告.pdf", path: ready[0].path, isImage: false, library: { fileId: "file_a", libraryFileId: "libfile_a" } },
      { label: "图.png", path: ready[1].path, isImage: true, library: { currentVersion: 4, fileId: "file_png", libraryFileId: "libfile_png" } },
    ],
    request: "看看",
  });
  // A model without image input: no Image attachment line, no localImage.
  const plain = chat.libraryMessage(ready, "看看", false);
  assert.deepEqual(plain.images, []);
  assert.equal(plain.text.includes("Image attachment"), false);
  assert.equal(chat.libraryMessage([], " 原样 ").text, " 原样 ");
  // ✕ on a ready chip deletes the draft's copy; the rest stays stored.
  chat.removeDraftFile(id, ready[0].key);
  assert.deepEqual(calls.detach, ["/codex/attachments/libfile_a/季度报告.pdf"]);
  assert.deepEqual(stored(id).map((chip) => chip.libraryFileId), ["libfile_png"]);
  // Sent: the chips go, the copies stay the message's.
  chat.setDraftFiles(id, []);
  assert.equal(stored(id), null);
  assert.deepEqual(calls.detach.length, 1);
});

test("a cancelled download stops, a failed one says so, and a copy that comes for no chip goes again", async (t) => {
  clearToasts();
  const gate = held();
  let fail = false;
  const calls = bridge(t, { attach: (body, signal) => (fail ? Promise.resolve([502, "upstream"]) : gate.attach(body, signal)) });
  const id = draft();
  const attaching = chat.attachDraftFiles(id, [node()]);
  const [chip] = chat.draftFiles(id);
  chat.removeDraftFile(id, chip.key);
  await attaching;
  assert.equal(chip.abort.signal.aborted, true);
  assert.deepEqual(chat.draftFiles(id), []);
  assert.deepEqual(calls.detach, []);
  // The bridge fails: an error chip with the reason, which a toast says too (b's catch), not stored; picked again, it gives way.
  assert.deepEqual(toasts(), []);
  fail = true;
  await chat.attachDraftFiles(id, [node()]);
  assert.deepEqual(chat.draftFiles(id).map((held) => [held.state, held.error]), [["error", "无法附加此资料库文件"]]);
  assert.deepEqual(toasts(), [["danger", "无法附加此资料库文件"]]);
  assert.equal(stored(id), null);
  clearToasts();
  fail = false;
  const again = chat.attachDraftFiles(id, [node()]);
  assert.deepEqual(chat.draftFiles(id).map((held) => held.state), ["pending"]);
  // The draft replaced meanwhile (a rewind): the copy that comes is deleted.
  chat.setDraftFiles(id, []);
  gate.release();
  await again;
  await tick();
  assert.deepEqual(calls.detach, ["/codex/attachments/libfile_a/季度报告.pdf"]);
  assert.deepEqual(toasts(), []);
});

test("restored files are the message's: never deleted, appended without repeats, and back after a reload", async (t) => {
  const calls = bridge(t);
  const id = draft();
  await chat.attachDraftFiles(id, [node()]);
  const files = [
    { label: "旧.pdf", path: "/codex/attachments/old/旧.pdf", isImage: false, library: { currentVersion: 2, fileId: "file_old", libraryFileId: "libfile_old" } },
    { label: "a.ts", path: "/repo/a.ts", isImage: false, library: null },
  ];
  // A rewind: the draft's own copy is discarded, the message's files come back ready.
  chat.restoreDraftFiles(id, files);
  assert.deepEqual(calls.detach, ["C:\\codex\\attachments\\libfile_a\\季度报告.pdf"]);
  assert.deepEqual(chat.draftFiles(id).map(({ name, path, libraryFileId, fileId, currentVersion, state, owned }) => ({ name, path, libraryFileId, fileId, currentVersion, state, owned })), [
    { name: "旧.pdf", path: "/codex/attachments/old/旧.pdf", libraryFileId: "libfile_old", fileId: "file_old", currentVersion: 2, state: "ready", owned: undefined },
    { name: "a.ts", path: "/repo/a.ts", libraryFileId: null, fileId: null, currentVersion: undefined, state: "ready", owned: undefined },
  ]);
  // A queued message taken back: after the draft's, a path already there skipped; a line range kept.
  chat.restoreDraftFiles(id, [files[1], { label: "b.md", path: "/repo/b.md", isImage: false, library: null, lines: "(line 2)" }], { queued: true });
  assert.deepEqual(chat.draftFiles(id).map((chip) => [chip.path, chip.lines, chip.owned]), [["/codex/attachments/old/旧.pdf", undefined, undefined], ["/repo/a.ts", undefined, undefined], ["/repo/b.md", "(line 2)", undefined]]);
  assert.equal(stored(id)[2].lines, "(line 2)");
  // Restored chips never delete what they name.
  chat.discardDraftFiles(id);
  assert.deepEqual(calls.detach.length, 1);
  // After a reload only localStorage has them: the ready ones, as they were stored (a line range only as a heading writes one).
  const reloaded = draft();
  saved.set(`${chat.DRAFT_FILES}${reloaded}`, JSON.stringify([{ key: "k1", name: "图.png", path: "/x/图.png", libraryFileId: "libfile_p", fileId: "file_p", currentVersion: 1, isImage: true, owned: true, lines: "(lines 1-2)" }, { key: "k2", name: "a", path: "/a", lines: "(line 1)\n## evil" }, { name: "no path" }, "junk"]));
  assert.deepEqual(chat.draftFiles(reloaded), [
    { key: "k1", name: "图.png", path: "/x/图.png", libraryFileId: "libfile_p", fileId: "file_p", currentVersion: 1, isImage: true, lines: "(lines 1-2)", state: "ready", owned: true },
    { key: "k2", name: "a", path: "/a", libraryFileId: null, fileId: null, isImage: false, state: "ready" },
  ]);
  saved.set(`${chat.DRAFT_FILES}broken`, "{");
  assert.deepEqual(chat.draftFiles("broken"), []);
});

test("a queued message's copies are the draft's again when it comes back, and go when it leaves the queue", async (t) => {
  const calls = bridge(t);
  const text = (chips) => [{ type: "text", text: chat.libraryMessage(chips, "稍后").text, text_elements: [] }];
  const id = draft();
  await chat.attachDraftFiles(id, [node(), node({ id: "libfile_b", fileId: "file_b", name: "b.txt" })]);
  const [a, b] = chat.draftFiles(id);
  // Sent: the chips leave the draft before the message goes, nothing deleted.
  chat.handOverDraftFiles(id, [a, b]);
  assert.deepEqual(chat.draftFiles(id), []);
  // Queued, then taken back (在输入框中编辑, ↑): the draft's own again, so ✕ deletes the copy.
  chat.restoreDraftFiles(id, splitRequest(text([a, b])[0].text).files, { queued: true });
  assert.deepEqual(chat.draftFiles(id).map((chip) => [chip.path, chip.owned]), [[a.path, true], [b.path, true]]);
  chat.removeDraftFile(id, chat.draftFiles(id)[0].key);
  assert.deepEqual(calls.detach, [a.path]);
  // Queued again and removed from the queue: its copy goes, once.
  const [back] = chat.draftFiles(id);
  chat.handOverDraftFiles(id, [back]);
  chat.dropQueuedFiles(text([back]));
  chat.dropQueuedFiles(text([back]));
  assert.deepEqual(calls.detach, [a.path, b.path]);
  // A recalled prompt's chip names a sent message's copy: queued, taken back and removed, it stays.
  const other = draft();
  await chat.attachDraftFiles(other, [node({ id: "libfile_c", fileId: "file_c", name: "c.txt" })]);
  const [c] = chat.draftFiles(other);
  chat.handOverDraftFiles(other, [c]);
  chat.restoreDraftFiles(other, splitRequest(text([c])[0].text).files);
  const [recalled] = chat.draftFiles(other);
  assert.equal(recalled.owned, undefined);
  chat.handOverDraftFiles(other, [recalled]);
  chat.restoreDraftFiles(other, splitRequest(text([recalled])[0].text).files, { queued: true });
  assert.equal(chat.draftFiles(other)[0].owned, undefined);
  chat.discardDraftFiles(other);
  chat.dropQueuedFiles(text([recalled]));
  assert.deepEqual(calls.detach, [a.path, b.path]);
});

test("only a copy the draft saved, or one under Codex's attachments, goes as a picture", (t) => {
  const server = store.getState().server;
  const home = "C:\\Users\\me\\.codex";
  store.setState({ server: { ...server, info: { codexHome: home } } });
  t.after(() => store.setState({ server }));
  const uuid = "0b1e2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
  const sent = (path, owned) => chat.libraryMessage([{ key: "k", name: "图.png", path, libraryFileId: null, fileId: null, isImage: true, state: "ready", ...(owned ? { owned } : {}) }], "看");
  const copy = `${home}\\attachments\\${uuid}\\图.png`;
  assert.deepEqual(sent(copy).images, [{ type: "localImage", path: copy }]);
  assert.equal(splitRequest(sent(copy).text).files[0].isImage, true);
  assert.equal(sent(`c:/users/me/.codex/attachments/${uuid.toUpperCase()}/图.png`).images.length, 1);
  // A restored chip's path is its message's text: elsewhere, it goes as a heading the model's sandboxed tools may open.
  for (const path of ["C:\\Users\\me\\Pictures\\passport.png", `${home}\\attachments\\not-a-uuid\\a.png`, `${home}\\attachments\\${uuid}\\..\\..\\secret.png`, `${home}\\attachments\\${uuid}\\.\\a.png`, `${home}\\other\\${uuid}\\a.png`, `${home}\\attachments\\..\\attachments\\${uuid}\\a.png`]) {
    const message = sent(path);
    assert.deepEqual(message.images, [], path);
    assert.equal(message.text.includes("Image attachment"), false, path);
    assert.equal(splitRequest(message.text).files[0].path, path);
  }
  // The draft's own copy goes as one before the server says where Codex keeps its home; nothing else does.
  store.setState({ server });
  assert.equal(sent("/elsewhere/a.png", true).images.length, 1);
  assert.equal(sent(copy).images.length, 0);
});

test("开始聊天 starts a new session only to fill a local one's composer, and 在资料库中打开 opens the file", async () => {
  clearToasts();
  const files = [node()];
  const asked = [];
  const take = (event) => {
    asked.push(event.detail);
    event.detail.outcome = "filled";
  };
  // Not here: a new session, then a toast, and no composer is asked.
  window.addEventListener("composer-library", take);
  for (const [kind, said] of [["ssh", "资料库文件会保存在本机，只能添加到本地会话"], ["cloud", "云端任务只能发送文字消息"], [null, "资料库文件会保存在本机，只能添加到本地会话"]]) {
    codex.kind = kind;
    clearToasts();
    const chats = codex.chats;
    assert.equal(await chat.startChatWithLibraryFiles(files, "问题"), "not_local");
    assert.equal(codex.chats, chats + 1);
    assert.deepEqual(toasts(), [["warning", said]]);
  }
  assert.deepEqual(asked, []);
  codex.kind = "local";
  assert.equal(await chat.startChatWithLibraryFiles(files, "这份报告讲了什么？"), "filled");
  assert.deepEqual(asked, [{ files, text: "这份报告讲了什么？", outcome: "filled" }]);
  window.removeEventListener("composer-library", take);
  assert.equal(await chat.startChatWithLibraryFiles(files), "unavailable");
  // composer-restore carries a message's words and files.
  const restored = [];
  const restore = (event) => restored.push(event.detail);
  window.addEventListener("composer-restore", restore);
  chat.restoreComposerDraft("正文", [{ label: "a", path: "/a", isImage: false, library: null }]);
  window.removeEventListener("composer-restore", restore);
  assert.deepEqual(restored, [{ text: "正文", files: [{ label: "a", path: "/a", isImage: false, library: null }] }]);
  chat.openInLibrary("libfile_a");
  assert.deepEqual(codex.opened.at(-1), { tab: library.libraryPrefs().lastTab, fileId: "libfile_a" });
});
