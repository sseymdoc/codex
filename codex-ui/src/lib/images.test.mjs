// Run with `pnpm test`. images.ts with "./codex" as a stub (no app-server): each test sets what
// the session calls and the fs/* RPCs answer, and every call is logged. The 图像 page's sends go
// through local sessions only; ChatGPT is a fake behind /api/cloud (as server/bridge.mjs answers,
// { status, body }), and a fetch to anything but an allowed /api/cloud route fails.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { transformSync } from "esbuild";
import { cloudAllowed } from "../../server/cloud.mjs";

globalThis.__imagesCodexStub = {};
const STUB = `data:text/javascript,${encodeURIComponent(
  "const s = globalThis.__imagesCodexStub; export const call = (...a) => s.call(...a), listSkills = (...a) => s.listSkills(...a), openThread = (...a) => s.openThread(...a), readDirectory = (...a) => s.readDirectory(...a), sendMessage = (...a) => s.sendMessage(...a), startThread = (...a) => s.startThread(...a), errorMessage = (e) => (e instanceof Error ? e.message : String(e)), connectionId = () => s.connection ?? \"conn-1\", callExperimental = async () => {}, openLibrary = () => {};",
)}`;
registerHooks({
  resolve: (specifier, context, next) => {
    if (specifier === "./codex" && /\/(images|cloud|dots|library)\.ts$/.test(context.parentURL ?? "")) return { url: STUB, shortCircuit: true };
    return next(/^\.\.?\/[^.]+$/.test(specifier) && context.parentURL?.endsWith(".ts") ? `${specifier}.ts` : specifier, context);
  },
  load: (url, context, next) =>
    url.startsWith("file:") && url.endsWith(".ts") ? { format: "module", shortCircuit: true, source: transformSync(readFileSync(new URL(url), "utf8"), { loader: "ts", format: "esm" }).code } : next(url, context),
});
// setState notifies subscribers once per frame.
globalThis.requestAnimationFrame ??= (callback) => setTimeout(callback, 0);
const { getState, setState } = await import("./store.ts");
const images = await import("./images.ts");

const SKILL = { name: "imagegen", path: "C:\\Users\\me\\.codex\\skills\\.system\\imagegen\\SKILL.md", enabled: true };

/** The stubbed session calls, logged in order; `skills` is what skills/list lists. */
function session(t, { skills = [SKILL], fail = {} } = {}) {
  const log = [];
  const before = getState();
  t.after(() => setState(before));
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.ok(url.startsWith("/api/cloud") && cloudAllowed(JSON.parse(init.body).method, JSON.parse(init.body).path), `unexpected fetch ${url}`);
    return new Response("{}");
  });
  Object.assign(globalThis.__imagesCodexStub, {
    listSkills: async (cwd) => {
      log.push(["listSkills", cwd]);
      if (fail.listSkills) throw new Error("skills/list failed");
      return [{ cwd: "", skills: [{ name: "pdf", path: "C:\\skills\\pdf\\SKILL.md", enabled: true }, ...skills], errors: [] }];
    },
    startThread: async (pending, plain) => {
      log.push(["startThread", pending, plain]);
      if (fail.startThread) throw new Error("connection lost");
      return "img-1";
    },
    openThread: async (id) => void log.push(["openThread", id]),
    sendMessage: async (id, input, opts) => {
      log.push(["sendMessage", id, input, opts]);
      if (fail.sendMessage) throw new Error("turn/start failed");
    },
  });
  return log;
}

const model = (id, { isDefault = false, image = true } = {}) => ({ id, model: id, isDefault, inputModalities: image ? ["text", "image"] : ["text"] });
const chatgpt = (planType = "plus") => ({ account: { type: "chatgpt", email: "me@example.com", planType }, requiresOpenaiAuth: true });
const picture = (n) => ({ name: `${n}.png`, url: `data:image/png;base64,${n}` });
const text = (value) => ({ type: "text", text: value, text_elements: [] });

test("L1 a send starts a plain session on the image model with images, the imagegen skill, then the text, and clears the draft", async (t) => {
  const log = session(t);
  setState((s) => ({ account: chatgpt(), models: [model("chat", { isDefault: true, image: false }), model("vision")], prefs: { ...s.prefs, model: "chat" } }));
  assert.equal(images.addDraftImages([1, 2, 3].map(picture), 5), true);
  assert.equal(images.addDraftImages([4, 5, 6].map(picture), 5), false, "five at most");
  assert.deepEqual(images.imagesState().draft.images.map((image) => image.name), ["1.png", "2.png", "3.png", "4.png", "5.png"]);
  images.removeDraftImage(images.imagesState().draft.images[0].key);
  images.setDraftText("一只戴帽子的猫");
  await images.sendDraft("一只戴帽子的猫");
  const urls = [2, 3, 4, 5].map((n) => ({ type: "image", url: `data:image/png;base64,${n}` }));
  assert.deepEqual(log, [
    ["listSkills", ""],
    ["startThread", undefined, { model: "vision" }],
    ["openThread", "img-1"],
    ["sendMessage", "img-1", [...urls, { type: "skill", name: "imagegen", path: SKILL.path }, text("一只戴帽子的猫")], { fresh: true }],
  ]);
  assert.deepEqual(images.imagesState().draft, { text: "", images: [] });
});

test("L1 a missing, disabled or unlisted imagegen skill leaves the skill out and still sends", async (t) => {
  for (const [skills, fail] of [[[], {}], [[{ ...SKILL, enabled: false }], {}], [[SKILL], { listSkills: true }]]) {
    const log = session(t, { skills, fail });
    await images.imagesSend("画一座灯塔", []);
    assert.deepEqual(log.find(([name]) => name === "sendMessage")[2], [text("画一座灯塔")]);
  }
});

test("L1 a session that does not start keeps the draft; a failed send stays with the session", async (t) => {
  let log = session(t, { fail: { startThread: true } });
  images.addDraftImages([picture(1)], 5);
  images.setDraftText("留着");
  await assert.rejects(images.sendDraft("留着"), /connection lost/);
  assert.equal(log.some(([name]) => name === "openThread"), false);
  assert.equal(images.imagesState().draft.text, "留着");
  assert.equal(images.imagesState().draft.images.length, 1);
  log = session(t, { fail: { sendMessage: true } });
  await images.sendDraft("留着");
  assert.deepEqual(log.map(([name]) => name), ["listSkills", "startThread", "openThread", "sendMessage"]);
  assert.deepEqual(images.imagesState().draft, { text: "", images: [] });
});

test("L2 the viewer's edit prompts are the desktop app's, with the source image first", async (t) => {
  assert.deepEqual(images.ASPECT_RATIOS.map(({ label, ratio }) => [label, images.editPrompt({ aspectRatio: ratio })]), [
    ["正方形", "将宽高比设为 1:1"],
    ["竖向", "将宽高比设为 3:4"],
    ["故事版式", "将宽高比设为 9:16"],
    ["横向", "将宽高比设为 4:3"],
    ["宽屏", "将宽高比设为 16:9"],
  ]);
  assert.equal(images.editPrompt("removeBackground"), "移除此图像的背景。保持所有前景主体不变且完整，边缘干净平滑。将背景设为透明。");
  assert.equal(images.editPrompt("remove"), "从第一张图像中移除第二张图像中标记的区域");
  assert.equal(images.aspectInstruction("海边日落", "16:9"), "海边日落\n\n输出宽高比：16:9。若上文中的宽高比或构图指令与此输出比例冲突，请以此比例为准。");
  assert.equal(images.aspectInstruction("海边日落", null), "海边日落");
  const log = session(t);
  const source = { type: "localImage", path: "C:\\Users\\me\\.codex\\generated_images\\t1\\a.png" };
  const mask = { type: "image", url: "data:image/png;base64,MASK" };
  await images.imagesSend(images.editPrompt("remove"), [source, mask]);
  assert.deepEqual(log.find(([name]) => name === "sendMessage")[2], [source, mask, { type: "skill", name: "imagegen", path: SKILL.path }, text("从第一张图像中移除第二张图像中标记的区域")]);
});

test("L2 移除 and 标注 send the source image first and the mask or the marked-up copy second", async (t) => {
  const path = "C:\\Users\\me\\.codex\\generated_images\\t1\\a.png";
  const skill = { type: "skill", name: "imagegen", path: SKILL.path };
  let log = session(t);
  await images.imagesEdit({ path }, images.editPrompt("remove"), "data:image/png;base64,MASK");
  assert.deepEqual(log.find(([name]) => name === "sendMessage")[2], [
    { type: "localImage", path },
    { type: "image", url: "data:image/png;base64,MASK" },
    skill,
    text("从第一张图像中移除第二张图像中标记的区域"),
  ]);
  log = session(t);
  await images.imagesEdit({ path }, images.markupPrompt("把圈出的杯子换成红色"), "data:image/png;base64,MARKED");
  assert.deepEqual(log.find(([name]) => name === "sendMessage")[2], [
    { type: "localImage", path },
    { type: "image", url: "data:image/png;base64,MARKED" },
    skill,
    text("按第二张图像中标出的位置修改第一张图像：把圈出的杯子换成红色"),
  ]);
  assert.equal(images.markupPrompt(""), "按第二张图像中标出的位置修改第一张图像。");
  // 调整大小, 移除背景 and 描述修改内容: the source image alone.
  log = session(t);
  await images.imagesEdit({ path }, images.editPrompt({ aspectRatio: "16:9" }));
  assert.deepEqual(log.find(([name]) => name === "sendMessage")[2], [{ type: "localImage", path }, skill, text("将宽高比设为 16:9")]);
});

test("L3 comments read as percentages with one decimal at most, clamped and numbered, with nothing else", async (t) => {
  assert.equal(
    images.commentPrompt([{ x: 0.1234, y: 0.45, text: "加一顶帽子" }, { x: -0.2, y: 1.7, text: "背景更亮" }, { x: 0.33333, y: 0.0005, text: "去掉文字" }]),
    "图像 1：\n1.（x：12.3%，y：45%）加一顶帽子\n2.（x：0%，y：100%）背景更亮\n3.（x：33.3%，y：0.1%）去掉文字",
  );
  // Rounded, not cut: 0.12345 → 12.3%, 0.99999 → 100%, 0.00049 → 0%; a comment's own lines stay as typed.
  assert.equal(
    images.commentPrompt([{ x: 0.12345, y: 0.99999, text: "第一行\n第二行" }, { x: 0.00049, y: 0.5, text: "b" }]),
    "图像 1：\n1.（x：12.3%，y：100%）第一行\n第二行\n2.（x：0%，y：50%）b",
  );
  assert.doesNotMatch(images.commentPrompt([{ x: 0.5, y: 0.5, text: "a" }]), /补充说明/);
  assert.equal(images.commentPrompt([]), "");
  // 发送 carries the source image and that text only: no marked-up copy, no 补充说明.
  const log = session(t);
  const path = "C:\\Users\\me\\.codex\\generated_images\\t1\\a.png";
  await images.imagesEdit({ path }, images.commentPrompt([{ x: 0.25, y: 0.75, text: "加一只鸟" }, { x: 0.5, y: 0.1, text: "天空更蓝" }]));
  assert.deepEqual(log.find(([name]) => name === "sendMessage")[2], [
    { type: "localImage", path },
    { type: "skill", name: "imagegen", path: SKILL.path },
    text("图像 1：\n1.（x：25%，y：75%）加一只鸟\n2.（x：50%，y：10%）天空更蓝"),
  ]);
});

/** fs/* under a fake CODEX_HOME: `tree` maps a folder to its entries, `times` a file to its mtime. */
function codexHome(t, tree, times = {}) {
  const calls = [];
  let inFlight = 0, most = 0;
  setState((s) => ({ server: { ...s.server, info: { ...s.server.info, codexHome: "C:\\Users\\me\\.codex" } } }));
  Object.assign(globalThis.__imagesCodexStub, {
    readDirectory: async (path) => {
      calls.push(["readDirectory", path]);
      if (!tree[path]) throw new Error(`os error 3: ${path}`);
      return tree[path];
    },
    call: async (method, params) => {
      calls.push([method, params.path]);
      assert.equal(method, "fs/getMetadata");
      inFlight++;
      most = Math.max(most, inFlight);
      await new Promise((resolve) => setImmediate(resolve));
      inFlight--;
      if (params.path in times) return { isFile: true, isDirectory: false, isSymlink: false, createdAtMs: 0, modifiedAtMs: times[params.path] };
      if (tree[params.path]) return { isFile: false, isDirectory: true, isSymlink: false, createdAtMs: 0, modifiedAtMs: 0 };
      throw new Error("not found");
    },
  });
  return { calls, most: () => most };
}

const ROOT = "C:\\Users\\me\\.codex\\generated_images";
const dir = (fileName) => ({ fileName, isDirectory: true, isFile: false });
const file = (fileName) => ({ fileName, isDirectory: false, isFile: true });

test("L6 this machine's images: two levels of generated_images, PNGs only, newest first", async (t) => {
  session(t);
  codexHome(t, {
    [ROOT]: [dir("t1"), file("notes.txt"), dir("t2")],
    [`${ROOT}\\t1`]: [file("a.png"), file("b.PNG"), file("c.jpg"), dir("nested")],
    [`${ROOT}\\t2`]: [file("d.png")],
  }, { [`${ROOT}\\t1\\a.png`]: 100, [`${ROOT}\\t1\\b.PNG`]: 300, [`${ROOT}\\t2\\d.png`]: 200 });
  assert.deepEqual(await images.listLocal(), [
    { path: `${ROOT}\\t1\\b.PNG`, name: "b.PNG", threadId: "t1", time: 300 },
    { path: `${ROOT}\\t2\\d.png`, name: "d.png", threadId: "t2", time: 200 },
    { path: `${ROOT}\\t1\\a.png`, name: "a.png", threadId: "t1", time: 100 },
  ]);
});

test("L6 no generated_images folder lists nothing; one that cannot be read is an error", async (t) => {
  session(t);
  codexHome(t, {});
  assert.deepEqual(await images.listLocal(), []);
  await images.loadLocal();
  assert.deepEqual(images.imagesState().local, []);
  assert.equal(images.imagesState().localError, null);
  const { calls } = codexHome(t, { [ROOT]: undefined });
  globalThis.__imagesCodexStub.call = async (method, params) => (calls.push([method, params.path]), { isFile: false, isDirectory: true, isSymlink: false, createdAtMs: 0, modifiedAtMs: 0 });
  await assert.rejects(images.listLocal(), /os error 3/);
  await images.loadLocal();
  assert.match(images.imagesState().localError, /os error 3/);
  assert.deepEqual(images.imagesState().local, [], "the last list stays");
  setState((s) => ({ server: { ...s.server, info: { ...s.server.info, codexHome: undefined } } }));
  assert.deepEqual(await images.listLocal(), []);
});

test("L6 stats run eight at a time and a file that cannot be stat'ed sorts last", async (t) => {
  session(t);
  const names = Array.from({ length: 20 }, (_, i) => `${i}.png`);
  const times = Object.fromEntries(names.slice(1).map((name, i) => [`${ROOT}\\t1\\${name}`, i + 1]));
  const fs = codexHome(t, { [ROOT]: [dir("t1")], [`${ROOT}\\t1`]: names.map(file) }, times);
  const listed = await images.listLocal();
  assert.equal(listed.length, 20);
  assert.equal(listed.at(0).name, "19.png");
  assert.deepEqual(listed.at(-1), { path: `${ROOT}\\t1\\0.png`, name: "0.png", threadId: "t1", time: 0 });
  assert.ok(fs.most() <= 8, `at most 8 stats at once (saw ${fs.most()})`);
  assert.ok(fs.most() > 1, "stats overlap");
});

test("L7 the channel and the entry: ChatGPT login, plan, image model and the feature switches", (t) => {
  session(t);
  const cases = [
    // [account, models, prefs.model, features, channel, entry, imageModel]
    [null, [model("vision", { isDefault: true })], null, {}, false, false, "vision"],
    [{ account: { type: "apiKey" }, requiresOpenaiAuth: true }, [model("vision", { isDefault: true })], null, {}, false, false, "vision"],
    [chatgpt("free"), [model("vision", { isDefault: true })], null, {}, false, true, "vision"],
    [chatgpt(), [model("vision", { isDefault: true })], null, {}, true, true, "vision"],
    [chatgpt(), [model("vision", { isDefault: true })], null, { image_generation: false }, false, true, "vision"],
    [chatgpt(), [model("vision", { isDefault: true })], null, { in_app_chat: false }, true, false, "vision"],
    // The draft's pick when it takes images, else the default one that does, else the first one that does.
    [chatgpt(), [model("a", { isDefault: true }), model("b")], "b", {}, true, true, "b"],
    [chatgpt(), [model("chat", { image: false }), model("a"), model("b", { isDefault: true })], "chat", {}, true, true, "b"],
    [chatgpt(), [model("chat", { isDefault: true, image: false }), model("a"), model("b")], "chat", {}, true, true, "a"],
    [chatgpt(), [model("chat", { isDefault: true, image: false })], null, {}, false, true, undefined],
    // A pick the catalog does not list is trusted; before the catalog loads, the pick (or the default).
    [chatgpt(), [model("vision", { isDefault: true })], "custom-model", {}, true, true, "custom-model"],
    [chatgpt(), [], null, {}, true, true, null],
    // No pick: config.toml's model when it takes images (left to the server), else the default one that does.
    [chatgpt(), [model("a"), model("b", { isDefault: true })], null, {}, true, true, null, "a"],
    [chatgpt(), [model("chat", { image: false }), model("b", { isDefault: true })], null, {}, true, true, "b", "chat"],
  ];
  for (const [account, models, picked, features, channel, entry, chosen, configModel] of cases) {
    setState((s) => ({
      account, models, hiddenModels: [], prefs: { ...s.prefs, model: picked }, config: { model: configModel },
      features: Object.entries(features).map(([name, enabled]) => ({ name, enabled })),
    }));
    const label = JSON.stringify({ account: account?.account ?? null, models: models.map((m) => m.id), picked, features, configModel });
    assert.equal(images.imageModel(), chosen, label);
    assert.equal(images.imageChannel(), channel, label);
    assert.equal(images.imagesEntryOn(getState()), entry, label);
  }
  // The server's effective switches, not config.toml's table (a legacy imagegenext = false, a profile).
  setState({ config: { features: { image_generation: false, in_app_chat: false } }, features: [], account: chatgpt(), models: [] });
  assert.equal(images.imagesEntryOn(getState()), true, "no feature list yet");
  assert.equal(images.imageChannel(), true, "no feature list yet");
});

test("L7 the image_gen quota shows only once spent, with its reset time", (t) => {
  session(t);
  const quota = (usedPercent, resetsAt = 1_800_000_000) => ({ rateLimitsByLimitId: { image_gen: { primary: { usedPercent, windowDurationMins: null, resetsAt } } } });
  for (const [rateLimits, reset] of [[null, null], [{ rateLimitsByLimitId: {} }, null], [quota(99), null], [quota(100), 1_800_000_000], [quota(100, null), null]]) {
    setState({ rateLimits });
    assert.equal(images.imageQuotaReset(getState()), reset);
  }
});

/** /api/images/available answering with `respond()` (a Response, or a throw), every ask logged. */
function availability(t, respond) {
  const asked = [];
  const answer = { respond };
  t.mock.method(globalThis, "fetch", async (url) => {
    asked.push(url);
    assert.equal(url, "/api/images/available?c=conn-1");
    return answer.respond();
  });
  return { asked, answer };
}

const json = (body) => new Response(JSON.stringify(body));
const GATES_ON = { available: true, preview: false, autoSendWithAttachments: true, sectionOrder: ["动漫", 3, "trending"], promptShare: true, promptShareLabel: "image_with_prompt", savedReferences: true, shareAudience: "workspace", reason: "settings_unavailable" };

test("L7 the entry and the page's switches come from /api/images/available; no answer shows the entry and keeps the last switches", async (t) => {
  session(t);
  setState({ account: chatgpt(), features: [] });
  const { asked, answer } = availability(t, () => json(GATES_ON));
  await images.refreshImagesAvailable(true);
  let s = images.imagesState();
  assert.deepEqual([s.entry, s.availabilityError], [true, false]);
  assert.deepEqual(s.gates, { preview: false, autoSendWithAttachments: true, sectionOrder: ["动漫", "trending"], promptShare: true, promptShareLabel: "image_with_prompt", savedReferences: true, shareAudience: "workspace" });
  // The tabs follow section_order ("trending" is 热门), the rest after.
  const groups = images.catalogGroups({ groups: [{ id: "g", items: [{ id: "a", section: "Templates" }, { id: "b" }, { id: "c", section: "动漫" }] }] }, null);
  assert.deepEqual(images.catalogSections(groups, s.gates.sectionOrder), ["动漫", "", "Templates"]);
  // At most once a minute unless forced (a new connection or account, 重试).
  await images.refreshImagesAvailable();
  assert.equal(asked.length, 1);
  // No answer: the entry shows, the last switches stand, the preview says 无法检查是否可用.
  for (const failed of [() => new Response("bridge down", { status: 502 }), () => { throw new TypeError("fetch failed"); }]) {
    answer.respond = failed;
    await images.refreshImagesAvailable(true);
    s = images.imagesState();
    assert.deepEqual([s.entry, s.availabilityError, s.gates.preview, s.gates.savedReferences], [true, true, false, true]);
  }
  // An answer whose switches were not read upstream (the bridge's defaults) keeps the last ones; with
  // the account read (the bootstrap failed), who a link reaches is the answer's.
  for (const [reason, audience] of [["accounts_unavailable", "workspace"], ["statsig_unavailable", "public"]]) {
    answer.respond = () => json({ available: true, preview: true, autoSendWithAttachments: false, sectionOrder: [], promptShare: false, promptShareLabel: "prompt_with_image", savedReferences: false, shareAudience: "public", reason });
    await images.refreshImagesAvailable(true);
    s = images.imagesState();
    assert.deepEqual([s.entry, s.availabilityError, s.gates.preview, s.gates.sectionOrder, s.gates.promptShare, s.gates.shareAudience], [true, false, false, ["动漫", "trending"], true, audience], reason);
  }
  // An answer clears it; a verdict hides the entry; an old bridge's answer without the switches is the defaults.
  answer.respond = () => json({ available: false, reason: "image_gen_holdout" });
  await images.refreshImagesAvailable(true);
  s = images.imagesState();
  assert.deepEqual([s.entry, s.availabilityError], [null, false]);
  assert.deepEqual(s.gates, { preview: true, autoSendWithAttachments: false, sectionOrder: [], promptShare: false, promptShareLabel: "prompt_with_image", savedReferences: false, shareAudience: "unknown" });
  answer.respond = () => json(GATES_ON);
  await images.refreshImagesAvailable(true);
  assert.equal(images.imagesState().entry, true);
});

test("L7 an answer that comes after the login stopped counting, or after a newer ask, is dropped", async (t) => {
  session(t);
  setState({ account: chatgpt(), features: [] });
  const waiting = [];
  availability(t, () => new Promise((resolve) => waiting.push(resolve)));
  const late = images.refreshImagesAvailable(true);
  await new Promise((resolve) => setImmediate(resolve));
  setState({ account: { account: { type: "apiKey" }, requiresOpenaiAuth: true } });
  waiting.shift()(json({ available: false }));
  await late;
  assert.equal(images.imagesState().entry, true, "the answer for a login that no longer counts changes nothing");
  setState({ account: chatgpt() });
  const older = images.refreshImagesAvailable(true);
  await new Promise((resolve) => setImmediate(resolve));
  const newer = images.refreshImagesAvailable(true);
  await new Promise((resolve) => setImmediate(resolve));
  waiting[1](json({ available: true, preview: true }));
  await newer;
  waiting[0](json({ available: false }));
  await older;
  assert.deepEqual([images.imagesState().entry, images.imagesState().gates.preview], [true, true]);
});

/** A card with `source` and `strategy` (cardRoute reads only its action). */
const card = (source, strategy = "auto_send") => ({ id: `${source}-${strategy}`, title: "卡片", description: "", prompt: "把照片变成水彩画", image: "", alt: "", section: "", action: { source, strategy, min: 1, max: null } });

test("L4 a card's route (suggestions G): with the preview off a styles card sends or opens the photo dialog, the rest fill the composer", () => {
  const preview = { preview: true, autoSendWithAttachments: true };
  const off = { preview: false, autoSendWithAttachments: false };
  const sends = { preview: false, autoSendWithAttachments: true };
  const cases = [
    // [card, gates, images in the composer, route]
    [card("sketch"), preview, 0, "sketch"],
    [card("sketch"), off, 3, "sketch"],
    [card("styles"), preview, 2, "preview"],
    [card("camera_or_gallery", "prefill_composer"), preview, 0, "preview"],
    [card("styles"), sends, 2, "send"],
    [card("styles"), sends, 0, "dialog"],
    [card("styles"), off, 2, "dialog"],
    // Not auto_send, not a styles card: the composer, whatever the strategy.
    [card("styles", "prefill_composer"), sends, 2, "prefill"],
    [card("camera_or_gallery"), sends, 2, "prefill"],
    [card("camera_or_gallery", "prefill_composer"), off, 0, "prefill"],
    [card("prompt_only", "prefill_composer"), off, 0, "prefill"],
    [card(""), off, 0, "prefill"],
  ];
  for (const [item, gates, attached, route] of cases) assert.equal(images.cardRoute(item, gates, attached), route, `${item.id} ${JSON.stringify(gates)} ${attached}`);
  // The reference picker comes up over the page for a card that takes photos.
  assert.deepEqual(["camera_or_gallery", "styles", "prompt_only", "sketch", ""].map((source) => images.takesPhotos(card(source))), [true, true, false, false, false]);
});

test("L4 a prefilled card's prompt replaces the composer's text; a send with given photos sends those alone and clears the draft", async (t) => {
  const log = session(t);
  images.setDraftText("我自己写的");
  images.addDraftImages([picture(1)], 5);
  const item = card("camera_or_gallery", "prefill_composer");
  images.prefill(item);
  assert.equal(images.imagesState().draft.text, "把照片变成水彩画");
  assert.equal(images.imagesState().template, item);
  assert.equal(images.imagesState().draft.images.length, 1, "the composer's photos stay");
  // The photo dialog: the card's prompt with the photo picked, not the composer's.
  await images.sendDraft(item.prompt, [{ type: "image", url: "data:image/png;base64,PICKED" }]);
  assert.deepEqual(log.find(([name]) => name === "sendMessage")[2], [{ type: "image", url: "data:image/png;base64,PICKED" }, { type: "skill", name: "imagegen", path: SKILL.path }, text("把照片变成水彩画")]);
  assert.deepEqual([images.imagesState().draft, images.imagesState().template], [{ text: "", images: [] }, null]);
});

test("L4 a send while another is on its way does nothing (a card clicked twice); once it is done the next goes", async (t) => {
  const log = session(t);
  await Promise.all([images.sendDraft("一座灯塔"), images.sendDraft("一座灯塔")]);
  assert.equal(log.filter(([name]) => name === "startThread").length, 1);
  await images.sendDraft("一座灯塔");
  assert.equal(log.filter(([name]) => name === "startThread").length, 2);
});

/**
 * A fake ChatGPT behind the bridge's /api/cloud: `routes` maps "GET path" to a body or to
 * (calls) => [status, body] (status 0: the bridge itself fails); every call is logged and checked
 * against the bridge's routes. Anything else the page fetches fails the test.
 */
function backend(t, routes, other = () => assert.fail("unexpected fetch")) {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    if (url !== "/api/cloud?c=conn-1") return other(url, init);
    const { method, path } = JSON.parse(init.body);
    assert.ok(cloudAllowed(method, path), `the bridge refuses ${method} ${path}`);
    calls.push(path);
    const route = routes[`${method} ${path}`];
    const [status, body] = route === undefined ? [404, { detail: "Not Found" }] : typeof route === "function" ? route(calls) : [200, route];
    return status === 0 ? new Response("bridge down", { status: 502 }) : new Response(JSON.stringify({ status, body }));
  });
  return calls;
}

const proxied = (url) => `/api/dots/content?${new URLSearchParams({ c: "conn-1", url, name: "" })}`;
const fileUrl = (fileId) => `/api/library/content/image.png?${new URLSearchParams({ c: "conn-1", id: fileId, kind: "content", fileId })}`;
/** What a picture's address may be: the bridge's own, or https on an open OpenAI host the page's CSP lets in. */
const shown = (src) => src === "" || src.startsWith("/api/") || /^https:\/\/(?:[a-z0-9-]+\.)*(?:oaiusercontent\.com|persistent\.oaistatic\.com|cdn\.openai\.com|images\.openai\.com)\//.test(src);

test("L4 the catalog: init's collections with the styles' suggestions in the first group holding a style", () => {
  const init = {
    groups: [
      { id: "g1", kind: "prompt_collection", title: "风格", presentation: "image_card", items: [{ id: "a", title: "A", prompt_text: "pa" }, { id: "s1", title: "S1" }] },
      { id: "banner", kind: "hero_banner", items: [{ id: "s2" }] },
      { id: "g2", title: "第二组", presentation: "portrait", items: [{ id: "s2", title: "S2" }] },
      { id: "g3", presentation: "text_pill", items: [] },
      { id: "g4", presentation: "carousel", items: [{ id: "c", title: "C" }] },
    ],
  };
  const styles = { styles: [{ id: "s2" }, { id: "s1" }, {}], image_suggestions: [{ id: "x", title: "X", prompt_text: "px" }, { title: "no id" }] };
  const groups = images.catalogGroups(init, styles);
  // The first collection holding a style takes the suggestions; other kinds, empty groups and items without an id go.
  assert.deepEqual(groups.map((g) => [g.id, g.title, g.presentation, g.items.map((i) => i.id)]), [
    ["g1", "风格", "image_card", ["x"]],
    ["g2", "第二组", "image_card", ["s2"]],
    ["g4", "", "image_card", ["c"]],
  ]);
  // No suggestions: init's groups as they are.
  assert.deepEqual(images.catalogGroups(init, { styles: [{ id: "s1" }], image_suggestions: [] })[0].items.map((i) => i.id), ["a", "s1"]);
  assert.deepEqual(images.catalogGroups(init, undefined)[0].items.map((i) => i.id), ["a", "s1"]);
  assert.deepEqual(images.catalogGroups({}, styles), []);
  assert.deepEqual(images.catalogGroups({ groups: "nope" }, null), []);
});

test("L4 an item's action, its picture and its group's presentation, read defensively", () => {
  const [pills, icons] = images.catalogGroups({
    groups: [
      { id: "p", presentation: "text_pill", action: { strategy: "prefill_composer", input_requirements: { source: "prompt_only" } }, items: [{ id: "1" }, { id: "2", action: { input_requirements: { source: "sketch" } } }] },
      { id: "i", presentation: "icon_pill", items: [
        { id: "3", image_url: " ", image_variant_urls: ["/estuary/content?id=file_3"] },
        { id: "4", action: { strategy: "auto_send", input_requirements: { source: "styles", min_count: 2, max_count: 8 } }, image_url: "https://evil.example/x.png" },
        { id: "5", image_variants: ["https://images.openai.com/a.webp"], image_alt: "一只猫", section: "Templates", description: "做成贴纸" },
      ] },
    ],
  }, null);
  assert.equal(pills.presentation, "text_pill");
  assert.equal(icons.presentation, "icon_pill");
  // The group's action when the item names none; the desktop app's default when neither does.
  assert.deepEqual(pills.items.map((i) => i.action), [
    { source: "prompt_only", strategy: "prefill_composer", min: 0, max: null },
    { source: "sketch", strategy: "auto_send", min: 1, max: null },
  ]);
  assert.deepEqual(icons.items.map((i) => i.action), [
    { source: "camera_or_gallery", strategy: "auto_send", min: 1, max: null },
    { source: "styles", strategy: "auto_send", min: 2, max: 8 },
    { source: "camera_or_gallery", strategy: "auto_send", min: 1, max: null },
  ]);
  // The address stays as ChatGPT gives it (the bridge's carry the connection's id) and shows as the page renders.
  assert.deepEqual(icons.items.map((i) => i.image), ["/estuary/content?id=file_3", "https://evil.example/x.png", "https://images.openai.com/a.webp"]);
  assert.deepEqual(icons.items.map((i) => images.imageSrc(i.image)), [proxied("/backend-api/estuary/content?id=file_3"), "", "https://images.openai.com/a.webp"]);
  assert.deepEqual(icons.items[2], { id: "5", title: "", description: "做成贴纸", prompt: "", image: "https://images.openai.com/a.webp", alt: "一只猫", section: "Templates", action: icons.items[2].action });
  // Tabs: each section once ("" is 热门), in the given order with the rest after.
  const groups = images.catalogGroups({ groups: [{ id: "g", items: [{ id: "a", section: "Templates" }, { id: "b" }, { id: "c", section: "动物" }, { id: "d", section: "Templates" }] }] }, null);
  assert.deepEqual(images.catalogSections(groups), ["Templates", "", "动物"]);
  assert.deepEqual(images.catalogSections(groups, ["trending", "动物"]), ["", "动物", "Templates"]);
  assert.deepEqual(["", "Templates", "动物"].map(images.sectionLabel), ["热门", "模板", "动物"]);
});

test("L4 loadCatalog reads init and styles; a failed half keeps the other and says so, in the browser as the desktop app's only", async (t) => {
  session(t);
  const init = { groups: [{ id: "g", items: [{ id: "s1" }, { id: "b" }] }] };
  const styles = { styles: [{ id: "s1" }], image_suggestions: [{ id: "x" }] };
  let failStyles = false;
  const calls = backend(t, {
    "GET /images/init": init,
    "GET /images/styles?include_image_suggestions=true": () => (failStyles ? [500, { detail: "boom" }] : [200, styles]),
    "GET /my/recent/image_gen?limit=25": { items: [], cursor: null },
  });
  images.visitImages("catalog@example.com");
  // The visit's own reads are dropped by the one after.
  calls.length = 0;
  await images.loadCatalog();
  assert.deepEqual(calls.filter((path) => path.startsWith("/images/")), ["/images/init", "/images/styles?include_image_suggestions=true"]);
  assert.deepEqual(images.imagesState().catalog.groups.map((g) => g.items.map((i) => i.id)), [["x"]]);
  assert.equal(images.imagesState().catalog.error, null);
  failStyles = true;
  await images.loadCatalog();
  assert.deepEqual(images.imagesState().catalog.groups.map((g) => g.items.map((i) => i.id)), [["x"]], "the styles last read stay");
  // ChatGPT answered here before: a failure now is an error, in the browser too.
  assert.equal(images.imagesState().catalog.error, "error");
  // Another login starts over; in the browser, reads that never went through are the desktop app's only.
  backend(t, { "GET /images/init": () => [0], "GET /images/styles?include_image_suggestions=true": () => [403, {}], "GET /my/recent/image_gen?limit=25": { items: [] } });
  images.visitImages("other@example.com");
  assert.deepEqual(images.imagesState().catalog, { groups: null, error: null });
  await images.loadCatalog();
  assert.deepEqual(images.imagesState().catalog, { groups: null, error: "desktop" });
  globalThis.window = { codexDesktop: {} };
  t.after(() => delete globalThis.window);
  await images.loadCatalog();
  assert.deepEqual(images.imagesState().catalog, { groups: null, error: "error" });
});

const generated = (id, extra = {}) => ({ id, title: `图 ${id}`, url: `https://chatgpt.com/backend-api/estuary/content?id=${id}`, asset_pointer: `sediment://file_${id}`, conversation_id: `c-${id}`, ...extra });

test("L5 the history pages 25 then 20 by its cursor, leaves archived and repeated images out, and maps every address", async (t) => {
  session(t);
  const calls = backend(t, {
    "GET /images/init": { groups: [] },
    "GET /images/styles?include_image_suggestions=true": {},
    "GET /my/recent/image_gen?limit=25": {
      items: [
        generated("1", { encodings: { thumbnail: { path: "/estuary/content?id=t1" } } }),
        generated("2", { is_archived: true }),
        generated("3", { output_blocked: true }),
        { id: "4", url: "https://sdmntprwestus.oaiusercontent.com/files/4.png?sig=x" },
        { id: "5", url: "http://chatgpt.com/x.png", encodings: { thumbnail: { path: "https://evil.example/t.png" } } },
        { title: "no id" },
      ],
      cursor: "c=2/3",
    },
    "GET /my/recent/image_gen?limit=20&after=c%3D2%2F3": { items: [generated("1"), generated("6")], cursor: null },
  });
  // The visit reads the first page; asking again waits for it.
  images.visitImages("history@example.com");
  assert.equal(await images.loadHistory(), true);
  let { history } = images.imagesState();
  assert.deepEqual(history.items.map((i) => i.id), ["1", "3", "4", "5"]);
  assert.equal(history.cursor, "c=2/3");
  const [one, three, four, five] = history.items;
  const pictures = (image) => [images.cloudThumb(image), images.cloudSrc(image)];
  assert.deepEqual(one, {
    id: "1", title: "图 1", thumb: "/estuary/content?id=t1", url: "https://chatgpt.com/backend-api/estuary/content?id=1", pointer: "sediment://file_1", fileId: "file_1", conversationId: "c-1", blocked: false, time: null,
    width: null, height: null, thinking: false,
  });
  assert.deepEqual(pictures(one), [proxied("/backend-api/estuary/content?id=t1"), fileUrl("file_1")]);
  assert.deepEqual([...pictures(three), three.blocked], ["", "", true]);
  assert.deepEqual([...pictures(four), four.fileId, four.conversationId], ["https://sdmntprwestus.oaiusercontent.com/files/4.png?sig=x", "https://sdmntprwestus.oaiusercontent.com/files/4.png?sig=x", null, null]);
  assert.deepEqual(pictures(five), ["", ""]);
  // After a reconnect the same items show at the new connection's addresses (the bridge refuses an old one's with 410).
  globalThis.__imagesCodexStub.connection = "conn-2";
  try {
    assert.deepEqual(pictures(one).map((src) => new URLSearchParams(src.split("?")[1]).get("c")), ["conn-2", "conn-2"]);
  } finally {
    delete globalThis.__imagesCodexStub.connection;
  }
  // 下载 reads bytes from the page's own origin: a signed file host's address goes through the bridge, other hosts' not at all.
  assert.deepEqual([fileUrl("file_1"), images.cloudSrc(four), "https://cdn.openai.com/a.png", ""].map(images.readableSrc), [
    fileUrl("file_1"), proxied("https://sdmntprwestus.oaiusercontent.com/files/4.png?sig=x"), "", "",
  ]);
  assert.equal(await images.loadHistory(true), true);
  history = images.imagesState().history;
  assert.deepEqual(history.items.map((i) => i.id), ["1", "3", "4", "5", "6"]);
  assert.equal(history.cursor, null);
  // The end: nothing more is asked for.
  assert.equal(await images.loadHistory(true), false);
  assert.deepEqual(calls.filter((path) => path.startsWith("/my/")), ["/my/recent/image_gen?limit=25", "/my/recent/image_gen?limit=20&after=c%3D2%2F3"]);
  for (const image of history.items) assert.ok(pictures(image).every(shown), pictures(image).join(" "));
});

test("L5 a next page that fails keeps what was read and 重试 asks for that page alone; a reload starts from the first", async (t) => {
  session(t);
  let fail = true;
  const calls = backend(t, {
    "GET /images/init": { groups: [] },
    "GET /images/styles?include_image_suggestions=true": {},
    "GET /my/recent/image_gen?limit=25": { items: [generated("1")], cursor: "p2" },
    "GET /my/recent/image_gen?limit=20&after=p2": () => (fail ? [503, { detail: "busy" }] : [200, { items: [generated("2")], cursor: "p3" }]),
  });
  images.visitImages("retry@example.com");
  await images.loadHistory();
  // Asked twice while it is on its way: one request.
  const [first, again] = [images.loadHistory(true), images.loadHistory(true)];
  assert.equal(first, again);
  assert.equal(await first, false);
  let { history } = images.imagesState();
  assert.deepEqual([history.items.map((i) => i.id), history.cursor, history.loading, history.error], [["1"], "p2", null, { kind: "error", more: true }], "the first page went through: an error, in the browser too");
  fail = false;
  assert.equal(await images.loadHistory(history.error.more), true);
  history = images.imagesState().history;
  assert.deepEqual([history.items.map((i) => i.id), history.cursor, history.error], [["1", "2"], "p3", null]);
  assert.equal(await images.loadHistory(), true);
  assert.deepEqual(images.imagesState().history.items.map((i) => i.id), ["1"], "a reload is the first page again");
  assert.deepEqual(calls.filter((path) => path.startsWith("/my/")), [
    "/my/recent/image_gen?limit=25", "/my/recent/image_gen?limit=20&after=p2", "/my/recent/image_gen?limit=20&after=p2", "/my/recent/image_gen?limit=25",
  ]);
});

test("L5 imageSrc: chatgpt.com through the bridge at its own base, OpenAI's open hosts as they are, nothing else", () => {
  const cases = [
    ["/estuary/content?id=file_1", proxied("/backend-api/estuary/content?id=file_1")],
    ["/backend-api/estuary/content?id=file_1&ts=2", proxied("/backend-api/estuary/content?id=file_1&ts=2")],
    ["https://chatgpt.com/backend-api/estuary/content?id=file_1", proxied("/backend-api/estuary/content?id=file_1")],
    ["https://files.oaiusercontent.com/file-1?se=1&sig=a%2Bb", "https://files.oaiusercontent.com/file-1?se=1&sig=a%2Bb"],
    ["https://sdmntpraustraliaeast.oaiusercontent.com/f.png", "https://sdmntpraustraliaeast.oaiusercontent.com/f.png"],
    ["https://persistent.oaistatic.com/images-app/a.webp", "https://persistent.oaistatic.com/images-app/a.webp"],
    ["https://cdn.openai.com/a.png", "https://cdn.openai.com/a.png"],
    ["https://images.openai.com/a.png", "https://images.openai.com/a.png"],
    ["http://files.oaiusercontent.com/a.png", ""],
    ["https://files.oaiusercontent.com:8443/a.png", ""],
    ["https://user:pw@images.openai.com/a.png", ""],
    ["https://oaiusercontent.com.evil.example/a.png", ""],
    ["https://chatgpt.com.evil.example/a.png", ""],
    ["//evil.example/a.png", ""],
    ["https://evil.example/a.png", ""],
    ["data:image/png;base64,AA", ""],
    ["javascript:alert(1)", ""],
    ["/estuary\\content", ""],
    ["", ""],
    [null, ""],
  ];
  for (const [raw, src] of cases) {
    assert.equal(images.imageSrc(raw), src, String(raw));
    assert.ok(shown(src), src);
  }
});

test("L6 this machine's images and ChatGPT's by time, below ChatGPT's oldest only once it has no more pages", () => {
  const mine = (path, time) => ({ path, name: path, threadId: "t", time });
  const theirs = (id, time) => ({ id, title: "", thumb: "", url: "", fileId: null, conversationId: null, blocked: false, time });
  const local = [mine("L5", 500), mine("L3", 300), mine("L1", 100)];
  const cloud = [theirs("C4", 400), theirs("C2", 200)];
  const keys = (list) => list.map((image) => image.key.replace("cloud:", ""));
  assert.deepEqual(keys(images.gallery(local, cloud, true)), ["L5", "C4", "L3", "C2"]);
  // The viewer's image stays while it is below that oldest one (it was opened before the page came in).
  assert.deepEqual(keys(images.gallery(local, cloud, true, "L1")), ["L5", "C4", "L3", "C2", "L1"]);
  assert.deepEqual(keys(images.gallery(local, cloud, false)), ["L5", "C4", "L3", "C2", "L1"]);
  assert.deepEqual(images.gallery(local, cloud, false).map((image) => image.kind), ["local", "cloud", "local", "cloud", "local"]);
  // No time on ChatGPT's images: this machine's lead, ChatGPT's after in the server's order.
  assert.deepEqual(keys(images.gallery(local, [theirs("C9", null), theirs("C8", 900)], true)), ["L5", "L3", "L1", "C9", "C8"]);
  // ChatGPT empty or out of reach (the browser): this machine's alone, all of them.
  assert.deepEqual(keys(images.gallery(local, [], true)), ["L5", "L3", "L1"]);
  assert.deepEqual(keys(images.gallery([], cloud, true)), ["C4", "C2"]);
});

test("L6 in the browser ChatGPT's history is the desktop app's only and this machine's images still show", async (t) => {
  session(t);
  backend(t, { "GET /my/recent/image_gen?limit=25": () => [403, { detail: "Just a moment..." }], "GET /images/init": () => [403, {}], "GET /images/styles?include_image_suggestions=true": () => [403, {}] });
  images.visitImages("browser@example.com");
  assert.equal(await images.loadHistory(), false);
  const { history } = images.imagesState();
  assert.deepEqual([history.items, history.error], [null, { kind: "desktop", more: false }]);
  const local = [{ path: "L1", name: "L1", threadId: "t", time: 1 }];
  assert.deepEqual(images.gallery(local, history.items ?? [], !!history.cursor).map((image) => image.key), ["L1"]);
  // ChatGPT's own times come in ms whichever way it says them.
  backend(t, { "GET /my/recent/image_gen?limit=25": { items: [{ id: "a", created_at: 1_700_000_000 }, { id: "b", create_time: "2026-10-30T00:00:00Z" }, { id: "c", created_at: 1_700_000_000_123 }] } });
  await images.loadHistory();
  assert.deepEqual(images.imagesState().history.items.map((i) => i.time), [1_700_000_000_000, Date.parse("2026-10-30T00:00:00Z"), 1_700_000_000_123]);
});

test("L8 saved references: every page by next_cursor, stopping on a cursor seen before; the account's own first as 我", async (t) => {
  session(t);
  const calls = backend(t, {
    "GET /files/library/reference-images?limit=50": {
      items: [
        { id: "r1", entity_type: "pet", entity_name: "小黑", asset_pointer: "sediment://file_r1", thumbnail_url: "https://sdmntprwestus.oaiusercontent.com/r1.png", content_url: "https://evil.example/r1.png" },
        { id: "r2", entity_type: "self", entity_name: "Lys", asset_pointer: "file-service://file-r2", content_url: "/estuary/content?id=file-r2" },
      ],
      next_cursor: "n1",
    },
    "GET /files/library/reference-images?cursor=n1&limit=50": {
      items: [
        { id: "r3", entity_type: "place", entity_name: "家", asset_pointer: null },
        { id: "r4", entity_type: "pet", entity_name: "小白", asset_pointer: "sediment://file_r4", thumbnail_asset_pointer: "sediment://file_r4t", thumbnail_url: null, content_url: null },
        { entity_name: "no id" },
      ],
      next_cursor: "n1",
    },
  });
  const refs = await images.loadReferences();
  assert.deepEqual(refs, [
    { id: "r2", name: "我", self: true, fileId: "file-r2", url: "/estuary/content?id=file-r2", thumbFileId: "file-r2" },
    { id: "r1", name: "小黑", self: false, fileId: "file_r1", url: "https://sdmntprwestus.oaiusercontent.com/r1.png", thumbFileId: "file_r1" },
    { id: "r3", name: "家", self: false, fileId: null, url: "", thumbFileId: null },
    { id: "r4", name: "小白", self: false, fileId: "file_r4", url: "", thumbFileId: "file_r4t" },
  ]);
  // The tile's picture: its address, else its thumbnail's file (the desktop app's Ve).
  assert.deepEqual(refs.map((ref) => images.photoSrc(ref.url, ref.thumbFileId)), [
    proxied("/backend-api/estuary/content?id=file-r2"), "https://sdmntprwestus.oaiusercontent.com/r1.png", "", fileUrl("file_r4t"),
  ]);
  assert.deepEqual(calls, ["/files/library/reference-images?limit=50", "/files/library/reference-images?cursor=n1&limit=50"]);
  // A page that fails fails the list (the preview says so with 重试, where savedReferences lets the row in).
  backend(t, { "GET /files/library/reference-images?limit=50": () => [500, { detail: "boom" }] });
  await assert.rejects(images.loadReferences(), /500/);
});

test("L8 recent uploads, and a picked or edited ChatGPT image read as a data URL through the library's file address", async (t) => {
  const log = session(t);
  const asked = [];
  const calls = backend(t, {
    "GET /my/recent/uploaded_images?limit=25&images_app_only=true": { items: [{ file_id: "file_u1", download_url: "https://files.oaiusercontent.com/u1" }, { download_url: "x" }] },
  }, async (url) => {
    asked.push(url);
    return url === fileUrl("file_9") ? new Response(new Uint8Array([137, 80, 78, 71]), { headers: { "Content-Type": "image/png" } }) : new Response("gone", { status: 404 });
  });
  assert.deepEqual(await images.loadUploads(), [{ fileId: "file_u1", url: "https://files.oaiusercontent.com/u1" }]);
  assert.deepEqual(calls, ["/my/recent/uploaded_images?limit=25&images_app_only=true"]);
  assert.equal(await images.fileBytes("file_9"), "data:image/png;base64,iVBORw==");
  await assert.rejects(images.fileBytes("file_0"), /gone/);
  await images.imagesEdit({ fileId: "file_9" }, "把天空改成黄昏");
  assert.deepEqual(log.find(([name]) => name === "sendMessage")[2], [{ type: "image", url: "data:image/png;base64,iVBORw==" }, { type: "skill", name: "imagegen", path: SKILL.path }, text("把天空改成黄昏")]);
  assert.deepEqual(asked, [fileUrl("file_9"), fileUrl("file_0"), fileUrl("file_9")]);
});

// Sharing (chatgpt-image-share over chatgpt-conversation-share-dialog). Each test shares its own
// images: what was shared stays in the module's store for the session, as the desktop app's cache.

/** A ChatGPT history image as parseImage reads one. */
const cloudImage = (id, extra = {}) => ({
  id, title: "", thumb: "", url: "", pointer: `sediment://file_${id}`, fileId: `file_${id}`, conversationId: `conv-${id}`, blocked: false, time: null, width: null, height: null, thinking: false, ...extra,
});

/**
 * A fake ChatGPT for the share calls: `routes` maps "METHOD path" to (body, calls) => [status, body];
 * every call is logged with its body and checked against the bridge's routes.
 */
function shareBackend(t, routes) {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(url, "/api/cloud?c=conn-1");
    const { method, path, body } = JSON.parse(init.body);
    assert.ok(cloudAllowed(method, path), `the bridge refuses ${method} ${path}`);
    calls.push({ method, path, body });
    const route = routes[`${method} ${path}`];
    const [status, answer] = route ? route(body, calls) : [404, { detail: "Not Found" }];
    return new Response(JSON.stringify({ status, body: answer }));
  });
  return calls;
}

const shareOf = (image) => images.imagesState().shares[images.shareKey(image)];

// A chat's mapping: nodes by id, each pointing at its parent.
const node = (id, parent, message) => [id, { id, parent, ...(message ? { message } : {}), children: [] }];
const chat = (...nodes) => ({ mapping: Object.fromEntries(nodes), current_node: nodes.at(-1)[0] });
const said = (id, text, metadata = {}) => ({ id, author: { role: "user" }, content: { content_type: "text", parts: [text] }, metadata });
const tool = (id, parts, metadata = {}, name = "image_gen.text2im") => ({ id, author: { role: "tool", name }, content: { content_type: "multimodal_text", parts }, metadata });
const picturePart = (pointer, extra = {}) => ({ content_type: "image_asset_pointer", asset_pointer: pointer, width: 1024, height: 1024, ...extra });

test("L9 the prompt behind an image: the image part's dalle prompt, else the user's message above it; the image's title, else the prompt", () => {
  const image = { id: "gen_1", pointer: "sediment://file_1" };
  // An image tool's part with its own prompt, the title from its message (<|endoftext|> taken out).
  const dalle = chat(
    node("root", null),
    node("u1", "root", said("m-u1", "画一只戴帽子的猫")),
    node("a1", "u1", { id: "m-a1", author: { role: "assistant" }, content: { content_type: "text", parts: [""] } }),
    node("t1", "a1", tool("m-t1", [picturePart("sediment://file_0"), picturePart("sediment://file_1", { metadata: { dalle: { prompt: "A cat wearing a hat" } } })], { image_gen_title: " 戴帽子的猫<|endoftext|>" })),
  );
  assert.deepEqual(images.promptSource(dalle, image), { messageId: "m-t1", pointer: "sediment://file_1", content: { title: "戴帽子的猫", prompt: "A cat wearing a hat" } });
  // No prompt of its own: the user's text; no title: the prompt, 200 characters (code points) at most.
  const long = "🐱".repeat(250);
  const plain = chat(node("u1", null, said("m-u1", long)), node("t1", "u1", tool("m-t1", [picturePart("sediment://file_1")], {}, "dalle.text2im")));
  assert.deepEqual(images.promptSource(plain, image), { messageId: "m-t1", pointer: "sediment://file_1", content: { title: "🐱".repeat(200), prompt: long } });
  // The pointer nested under image_asset_pointer, its prompt in the nested metadata; async_task_title.
  const nested = chat(
    node("u1", null, said("m-u1", "用户的话")),
    node("t1", "u1", tool("m-t1", [{ content_type: "image_asset_pointer", image_asset_pointer: { asset_pointer: "sediment://file_1", metadata: { dalle: { prompt: "nested prompt" } } } }], { async_task_title: "异步标题" })),
  );
  assert.deepEqual(images.promptSource(nested, image).content, { title: "异步标题", prompt: "nested prompt" });
  // image_generation_call items in a message's JSON text (a file-service pointer): the user's text.
  const calls = chat(
    node("u1", null, said("m-u1", "海边的灯塔", { other: 1 })),
    node("a1", "u1", { id: "m-a1", author: { role: "assistant" }, content: { content_type: "text", parts: [JSON.stringify([{ type: "image_generation_call", id: "ig_1", status: "completed", result: "file-service://file-2" }])] } }),
  );
  assert.deepEqual(images.promptSource(calls, { id: "gen_2", pointer: "file-service://file-2" }), { messageId: "m-a1", pointer: "file-service://file-2", content: { title: "海边的灯塔", prompt: "海边的灯塔" } });
  // Matched by the item's id too (chr's id): a call whose result is not a file pointer shares nothing.
  const inline = chat(node("u1", null, said("m-u1", "猫")), node("a1", "u1", { id: "m-a1", author: { role: "assistant" }, content: { text: JSON.stringify({ type: "image_generation_call", id: "gen_1", result: "data:image/png;base64,AA" }) } }));
  assert.equal(images.promptSource(inline, image), null);

  // Nothing to share: not in the chat, a hidden or missing user message, one still coming in, a loop, a blank prompt, no message id, no mapping.
  const user = (metadata, text = "猫") => chat(node("u1", null, said("m-u1", text, metadata)), node("t1", "u1", tool("m-t1", [picturePart("sediment://file_1")])));
  assert.equal(images.promptSource(user({}), { id: "gen_9", pointer: "sediment://file_9" }), null);
  assert.equal(images.promptSource(user({ is_visually_hidden_from_conversation: true }), image), null);
  assert.equal(images.promptSource(user({}, "  "), image), null);
  assert.equal(images.promptSource(chat(node("t1", "gone", tool("m-t1", [picturePart("sediment://file_1")]))), image), null);
  assert.equal(images.promptSource(chat(node("a", "b", { id: "m-a", author: { role: "assistant" }, content: { parts: ["x"] } }), node("b", "a"), node("t1", "a", tool("m-t1", [picturePart("sediment://file_1")]))), image), null);
  assert.equal(images.promptSource(chat(node("u1", null, said("m-u1", "猫")), node("t1", "u1", tool("m-t1", [picturePart("sediment://file_1", { metadata: { generation: { height: 512 } } })]))), image), null);
  assert.equal(images.promptSource(chat(node("u1", null, said("m-u1", "猫")), node("a1", "u1", { id: "m-a1", author: { role: "assistant" }, content: { parts: [JSON.stringify({ type: "image_generation_call", status: "in_progress", result: "sediment://file_1" })] } })), image), null);
  assert.equal(images.promptSource(chat(node("u1", null, said("m-u1", "猫")), node("t1", "u1", { ...tool("", [picturePart("sediment://file_1")]), id: undefined })), image), null);
  assert.equal(images.promptSource(chat(node("u1", null, said("m-u1", "猫")), node("t1", "u1", tool("m-t1", [picturePart("sediment://file_1")], {}, "python"))), image), null);
  for (const empty of [null, {}, { mapping: "x" }, { mapping: { a: null, b: { message: "x" } } }]) assert.equal(images.promptSource(empty, image), null);
});

test("L9 opening the share dialog reads the image's chat once and writes nothing", async (t) => {
  session(t);
  const image = cloudImage("s1");
  let fail = true;
  const conversation = chat(node("u1", null, said("m-u1", "雪山日出")), node("t1", "u1", tool("m-t1", [picturePart("sediment://file_s1")])));
  const calls = shareBackend(t, { "GET /conversation/conv-s1": () => (fail ? [500, { detail: "boom" }] : [200, conversation]) });
  // A read that fails is asked again the next time; one that answered is not.
  await assert.rejects(images.readShareSource(image), /500/);
  assert.equal(shareOf(image)?.source, undefined);
  fail = false;
  const source = { messageId: "m-t1", pointer: "sediment://file_s1", content: { title: "雪山日出", prompt: "雪山日出" } };
  // Opened twice at once (React's dev remount): one read.
  assert.deepEqual(await Promise.all([images.readShareSource(image), images.readShareSource(image)]), [source, source]);
  assert.deepEqual(await images.readShareSource(image), source);
  assert.deepEqual(calls.map(({ method, path, body }) => [method, path, body]), [["GET", "/conversation/conv-s1", undefined], ["GET", "/conversation/conv-s1", undefined]]);
  // A chat with no prompt for it is remembered as none.
  const other = cloudImage("s2");
  shareBackend(t, { "GET /conversation/conv-s2": () => [200, { mapping: {} }] });
  assert.equal(await images.readShareSource(other), null);
  assert.equal(shareOf(other).source, null);
  assert.deepEqual([shareOf(other).link, shareOf(other).key, shareOf(other).post], [null, null, null]);
  // Only a ChatGPT image with its chat and file shares.
  assert.deepEqual([image, cloudImage("s3", { conversationId: null }), cloudImage("s4", { fileId: null })].map(images.shareable), [true, false, false]);
});

test("L9 仅图像 posts /share/post/link with the image's chat, file, size, thinking flag and title, once", async (t) => {
  session(t);
  const image = cloudImage("a", { title: "海边灯塔", width: 1536, height: 1024, thinking: true });
  const bare = cloudImage("b");
  let n = 0;
  const calls = shareBackend(t, {
    "POST /share/post/link": (body) => (body.attachments_to_create[0].file_id === "file_a" ? [200, { id: "cx_a", permalink: "https://chatgpt.com/s/cx_a" }] : ++n === 1 ? [500, { detail: "boom" }] : [200, { id: "cx_b" }]),
  });
  // Asked again while it is made (the dialog reopened meanwhile): the same POST.
  const link = { id: "cx_a", url: "https://chatgpt.com/s/cx_a" };
  assert.deepEqual(await Promise.all([images.shareImageLink(image), images.shareImageLink(image)]), [link, link]);
  // Made once: copying again or a destination reuses it.
  assert.deepEqual(await images.shareImageLink(image), { id: "cx_a", url: "https://chatgpt.com/s/cx_a" });
  // No size or title: left out; no permalink: /s/<id>; a failure makes nothing, the next click asks again.
  await assert.rejects(images.shareImageLink(bare), /500/);
  assert.equal(shareOf(bare)?.link ?? null, null);
  assert.deepEqual(await images.shareImageLink(bare), { id: "cx_b", url: "https://chatgpt.com/s/cx_b" });
  assert.deepEqual(calls, [
    { method: "POST", path: "/share/post/link", body: { attachments_to_create: [{ conversation_id: "conv-a", file_id: "file_a", generated_with_thinking_model: true, height: 1024, kind: "image_share", width: 1536 }], post_text: "海边灯塔" } },
    { method: "POST", path: "/share/post/link", body: { attachments_to_create: [{ conversation_id: "conv-b", file_id: "file_b", generated_with_thinking_model: false, kind: "image_share" }] } },
    { method: "POST", path: "/share/post/link", body: { attachments_to_create: [{ conversation_id: "conv-b", file_id: "file_b", generated_with_thinking_model: false, kind: "image_share" }] } },
  ]);
});

test("L9 提示及图像 posts once under one idempotency key, kept across retries; a saved edit PATCHes the post", async (t) => {
  session(t);
  const image = cloudImage("p");
  const source = { messageId: "m-p", pointer: "sediment://file_p", content: { title: "戴帽子的猫", prompt: "A cat wearing a hat" } };
  let posts = 0;
  const calls = shareBackend(t, {
    "POST /share/prompt-share": () => (++posts === 1 ? [502, { detail: "upstream" }] : [200, { post_id: "cx_p", prompt_share_id: "ps_1", title: "戴帽子的猫" }]),
    "PATCH /share/post/cx_p/prompt-share": (body) => [200, { title: `${body.title}（已审）`, prompt: body.prompt }],
  });
  await assert.rejects(images.sharePrompt(image, source), /502/);
  const key = shareOf(image).key;
  assert.match(key, /^[0-9a-f-]{36}$/);
  const made = { id: "cx_p", url: "https://chatgpt.com/s/cx_p", title: "戴帽子的猫" };
  assert.deepEqual(await Promise.all([images.sharePrompt(image, source), images.sharePrompt(image, source)]), [made, made]);
  assert.deepEqual(await images.sharePrompt(image, source), made);
  const body ={ idempotency_key: key, conversation_id: "conv-p", message_id: "m-p", output_asset_pointer: "sediment://file_p", post_text: "戴帽子的猫" };
  await images.savePromptEdit(image, source, { title: "新标题", prompt: "新提示" });
  assert.deepEqual(calls, [
    { method: "POST", path: "/share/prompt-share", body },
    { method: "POST", path: "/share/prompt-share", body },
    { method: "PATCH", path: "/share/post/cx_p/prompt-share", body: { title: "新标题", prompt: "新提示" } },
  ]);
  // What the PATCH answered is what shows, the post's title with it.
  assert.deepEqual([shareOf(image).edited, shareOf(image).post.title], [{ title: "新标题（已审）", prompt: "新提示" }, "新标题（已审）"]);

  // A POST that failed may yet have gone through: an edit first posts again under the same key, then PATCHes.
  const retried = cloudImage("q");
  let tries = 0;
  const again = shareBackend(t, {
    "POST /share/prompt-share": () => (++tries === 1 ? [500, { detail: "boom" }] : [200, { post_id: "cx_q" }]),
    "PATCH /share/post/cx_q/prompt-share": (body) => [200, body],
  });
  await assert.rejects(images.sharePrompt(retried, source), /500/);
  await images.savePromptEdit(retried, source, { title: "改", prompt: "提示" });
  assert.deepEqual(again.map(({ method, path }) => `${method} ${path}`), ["POST /share/prompt-share", "POST /share/prompt-share", "PATCH /share/post/cx_q/prompt-share"]);
  assert.equal(again[0].body.idempotency_key, again[1].body.idempotency_key);
  // No title in the answer: the post goes by the prompt's own.
  assert.deepEqual(shareOf(retried).post, { id: "cx_q", url: "https://chatgpt.com/s/cx_q", title: "改" });
});

test("L9 a refused prompt drops its key; its edit stays here and posts with a new key", async (t) => {
  session(t);
  const image = cloudImage("r");
  const source = { messageId: "m-r", pointer: "sediment://file_r", content: { title: "标题", prompt: "提示" } };
  let refuse = true;
  const calls = shareBackend(t, {
    "POST /share/prompt-share": () => (refuse ? [400, { detail: { code: "prompt_share_not_publishable", message: "Not publishable" } }] : [200, { post_id: "cx_r", title: "安全标题" }]),
  });
  const error = await images.sharePrompt(image, source).catch((caught) => caught);
  assert.equal(images.unpublishable(error), true);
  assert.equal(images.unpublishable(new Error("prompt_share_not_publishable")), false);
  assert.equal(shareOf(image).key, null);
  // Never posted: the edit is kept, nothing is sent.
  await images.savePromptEdit(image, source, { title: "安全标题", prompt: "安全的提示" });
  assert.equal(calls.length, 1);
  assert.deepEqual(shareOf(image).edited, { title: "安全标题", prompt: "安全的提示" });
  refuse = false;
  assert.deepEqual(await images.sharePrompt(image, source), { id: "cx_r", url: "https://chatgpt.com/s/cx_r", title: "安全标题" });
  assert.notEqual(calls[1].body.idempotency_key, calls[0].body.idempotency_key);
  assert.deepEqual(calls[1].body, { idempotency_key: calls[1].body.idempotency_key, conversation_id: "conv-r", message_id: "m-r", output_asset_pointer: "sediment://file_r", post_text: "标题", published_content: { title: "安全标题", prompt: "安全的提示" } });
});

test("L9 the destinations' share addresses, and what a prompt may post", () => {
  const url = "https://chatgpt.com/s/cx_1";
  assert.deepEqual(["x", "linkedin", "reddit"].map((to) => images.shareDestination(to, url, "猫 & 狗")), [
    "https://twitter.com/intent/tweet?url=https%3A%2F%2Fchatgpt.com%2Fs%2Fcx_1&text=%E7%8C%AB%20%26%20%E7%8B%97",
    "https://www.linkedin.com/shareArticle?url=https%3A%2F%2Fchatgpt.com%2Fs%2Fcx_1&text=%E7%8C%AB%20%26%20%E7%8B%97",
    "https://www.reddit.com/submit?url=https%3A%2F%2Fchatgpt.com%2Fs%2Fcx_1&title=%E7%8C%AB%20%26%20%E7%8B%97",
  ]);
  const valid = (title, prompt = "p") => images.promptValid({ title, prompt });
  assert.deepEqual([valid("标题"), valid(" "), valid("t", " \n"), valid("🐱".repeat(200)), valid("🐱".repeat(201)), valid(`  ${"a".repeat(200)}  `), valid("t", "a".repeat(100_001))], [true, false, false, true, false, true, false]);
});
