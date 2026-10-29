// Run with `pnpm test`. images.ts with "./codex" as a stub (no app-server): each test sets what
// the session calls and the fs/* RPCs answer, and every call is logged. The 图像 page's sends go
// through local sessions only, so a fetch to anything but an allowed /api/cloud route fails.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { transformSync } from "esbuild";
import { cloudAllowed } from "../../server/cloud.mjs";

globalThis.__imagesCodexStub = {};
const STUB = `data:text/javascript,${encodeURIComponent(
  "const s = globalThis.__imagesCodexStub; export const call = (...a) => s.call(...a), listSkills = (...a) => s.listSkills(...a), openThread = (...a) => s.openThread(...a), readDirectory = (...a) => s.readDirectory(...a), sendMessage = (...a) => s.sendMessage(...a), startThread = (...a) => s.startThread(...a), errorMessage = (e) => (e instanceof Error ? e.message : String(e));",
)}`;
registerHooks({
  resolve: (specifier, context, next) => {
    if (specifier === "./codex" && /\/images\.ts$/.test(context.parentURL ?? "")) return { url: STUB, shortCircuit: true };
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

test("L3 comments read as percentages with one decimal at most, clamped and numbered, with nothing else", () => {
  assert.equal(
    images.commentPrompt([{ x: 0.1234, y: 0.45, text: "加一顶帽子" }, { x: -0.2, y: 1.7, text: "背景更亮" }, { x: 0.33333, y: 0.0005, text: "去掉文字" }]),
    "图像 1：\n1.（x：12.3%，y：45%）加一顶帽子\n2.（x：0%，y：100%）背景更亮\n3.（x：33.3%，y：0.1%）去掉文字",
  );
  assert.doesNotMatch(images.commentPrompt([{ x: 0.5, y: 0.5, text: "a" }]), /补充说明/);
  assert.equal(images.commentPrompt([]), "");
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
