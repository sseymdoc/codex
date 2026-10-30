// The ChatGPT calls the 图像 page may make (server/cloud.mjs's 图像 block): all read only, the
// catalog's two in Chinese, and never a chat or its anti-abuse tokens; the library's own routes
// stay the bridge's. cloudFetch runs against a fake fetch, imagesAvailable against a fake `call`:
// no network or login.
import assert from "node:assert/strict";
import { test } from "node:test";
import { cloudAllowed, cloudFetch } from "./cloud.mjs";
import { imagesAvailable } from "./images.mjs";
import { available, djb2, evaluateStatsig } from "./library.mjs";

// What src/lib/images.ts asks for, as it builds the queries.
const ALLOWED = [
  "/images/init",
  "/images/styles?include_image_suggestions=true",
  "/my/recent/image_gen?limit=25",
  "/my/recent/image_gen?limit=20&after=c%3D2%2F3%2Bx",
  "/my/recent/uploaded_images?limit=25&images_app_only=true",
  "/files/library/reference-images?limit=50",
  "/files/library/reference-images?cursor=n_1%3D&limit=50",
];

// A send's chat and its tokens, writes, other methods and paths around the allowed ones.
const REFUSED = [
  ["POST", "/f/conversation"],
  ["POST", "/f/conversation/prepare"],
  ["POST", "/sentinel/chat-requirements/prepare"],
  ["POST", "/sentinel/chat-requirements/finalize"],
  ["POST", "/image-gen/markup-preview"],
  ["POST", "/images/init"],
  ["PUT", "/images/styles"],
  ["DELETE", "/my/recent/image_gen?limit=25"],
  ["POST", "/my/recent/uploaded_images"],
  ["POST", "/files/library/reference-images"],
  ["PATCH", "/files/library/reference-images/ref_1"],
  ["DELETE", "/files/library/reference-images/ref_1"],
  ["GET", "/files/library/reference-images/ref_1"],
  ["GET", "/images/init/../../tbo"],
  ["GET", "/my/recent/../../tbo/primary"],
  ["GET", "/my/recent/conversations?limit=25"],
  ["GET", "/my/recent/image_gen?limit=25#x"],
  ["GET", "/my/recent/image_gen?q=a/b"],
  ["GET", "/images/prompt/slug"],
  ["GET", "/images/styles/x"],
  // Around the share calls: other methods, a whole chat's share or a post itself, a query, a chat's writes.
  ["GET", "/share/post/link"],
  ["PUT", "/share/post/link"],
  ["POST", "/share/post/link?x=1"],
  ["POST", "/share/post"],
  ["GET", "/share/prompt-share"],
  ["PATCH", "/share/prompt-share"],
  ["DELETE", "/share/post/cx_1/prompt-share"],
  ["POST", "/share/post/cx_1/prompt-share"],
  ["PATCH", "/share/post/cx_1"],
  ["PATCH", "/share/post/../tbo/prompt-share"],
  ["PATCH", "/share/post/cx.1/prompt-share"],
  ["PATCH", "/share/post/cx_1/prompt-share?x=1"],
  ["POST", "/share/c-1"],
  ["GET", "/conversation/c-1?history_off=true"],
  ["GET", "/conversation/c-1/messages"],
  ["POST", "/conversation/c-1"],
  ["PATCH", "/conversation/c-1"],
  ["DELETE", "/conversation/c-1"],
];

// Sharing an image (the user's click only) and the chat its prompt is read from: chat and post ids as ChatGPT names them.
const SHARE = [
  ["GET", "/conversation/68f1c2a0-1b2c-8003-9d4e-0123456789ab"],
  ["POST", "/share/post/link"],
  ["POST", "/share/prompt-share"],
  ["PATCH", "/share/post/cx_68f1c2a01b2c8003/prompt-share"],
  ["PATCH", "/share/post/p-1_A/prompt-share"],
];

test("S1 the 图像 block lets the page's reads and its share calls through and nothing else", () => {
  for (const path of ALLOWED) assert.ok(cloudAllowed("GET", path), `GET ${path} should pass`);
  for (const [method, path] of SHARE) assert.ok(cloudAllowed(method, path), `${method} ${path} should pass`);
  for (const [method, path] of REFUSED) assert.equal(cloudAllowed(method, path), false, `${method} ${path} should be refused`);
  // The page's own: the bridge's internal kind does not take them.
  for (const [method, path] of SHARE) assert.equal(cloudAllowed(method, path, "internal"), false, `${method} ${path} is the page's`);
});

test("S1 a share call goes out with its JSON body and no language header", async () => {
  const sent = [];
  const fetch = async (url, init) => {
    sent.push({ url, method: init.method, headers: init.headers, body: init.body });
    return new Response(JSON.stringify({ id: "cx_1" }), { status: 200 });
  };
  const body = { attachments_to_create: [{ conversation_id: "c-1", file_id: "file_1", kind: "image_share" }], post_text: "猫" };
  const answer = await cloudFetch({ base: "https://chatgpt.com/backend-api", auth: async () => "tok", headers: () => ({}), method: "POST", path: "/share/post/link", body, fetch });
  assert.deepEqual(answer, { status: 200, body: { id: "cx_1" } });
  assert.deepEqual(sent.map(({ url, method }) => [url, method]), [["https://chatgpt.com/backend-api/share/post/link", "POST"]]);
  assert.equal(sent[0].headers["Content-Type"], "application/json");
  assert.equal(sent[0].headers["OAI-Language"], undefined);
  assert.deepEqual(JSON.parse(sent[0].body), body);
});

test("S1 the catalog's reads go out in Chinese, the others without it; the page cannot name a header", async () => {
  const sent = [];
  const fetch = async (url, init) => {
    sent.push({ url, headers: init.headers });
    return new Response("{}", { status: 200 });
  };
  for (const path of ALLOWED) {
    const answer = await cloudFetch({ base: "https://chatgpt.com/backend-api", auth: async () => "tok", headers: () => ({ Authorization: "Bearer tok" }), method: "GET", path, fetch });
    assert.equal(answer.status, 200, path);
  }
  assert.deepEqual(sent.map(({ url }) => url), ALLOWED.map((path) => `https://chatgpt.com/backend-api${path}`));
  for (const { url, headers } of sent) {
    assert.equal(headers["OAI-Language"], /\/images\/(?:init|styles)/.test(url) ? "zh-CN" : undefined, url);
    assert.equal(headers.Authorization, "Bearer tok");
  }
  for (const [method, path] of REFUSED) {
    await assert.rejects(cloudFetch({ base: "https://chatgpt.com/backend-api", auth: async () => "tok", headers: () => ({}), method, path, fetch }), { code: "CLOUD_REFUSED" }, `${method} ${path}`);
  }
  assert.equal(sent.length, ALLOWED.length, "a refused call never goes out");
});

test("S2 the library's bridge-only routes keep their kind: the page cannot call them", () => {
  const internal = [
    ["GET", "/settings/user"],
    ["POST", "/wham/statsig/bootstrap"],
    ["POST", "/files"],
    ["GET", "/files/library/files/libfile_1/content_url"],
    ["GET", "/files/download/file_1?inline=true"],
    ["GET", "/files/download/file_1~file_2?download_intent=false"],
    ["GET", "/accounts/acct-1/settings"],
  ];
  for (const [method, path] of internal) {
    assert.equal(cloudAllowed(method, path), false, `the page's ${method} ${path} should be refused`);
    assert.equal(cloudAllowed(method, path, "internal"), true, `the bridge's ${method} ${path} should pass`);
  }
  // A file's bytes reach the 图像 page through the library's address only (/api/library/content):
  // the page's own /files/download stays Dots' plain one, and a joined id is the note history's alone.
  assert.equal(cloudAllowed("GET", "/files/download/file_1"), true);
  assert.equal(cloudAllowed("GET", "/files/download/file_1~file_2"), false);
  assert.equal(cloudAllowed("GET", "/files/download/file_1~file_2?inline=true", "internal"), false);
  assert.equal(cloudAllowed("GET", "/my/recent/image_gen?limit=25", "internal"), false);
});

/** A V1 bootstrap payload: gates, layers and dynamic configs by name. */
const payload = ({ gates = {}, layers = {}, configs = {} } = {}) => {
  const table = (entries) => Object.fromEntries(Object.entries(entries).map(([name, value]) => [name, { value }]));
  return JSON.stringify({ has_updates: true, feature_gates: table(gates), layer_configs: table(layers), dynamic_configs: table(configs) });
};

/**
 * imagesAvailable for the token's account acct-1 (`account` over a personal plus one, listed after
 * another account), against `answers` over a ChatGPT that grants nothing; every call is logged and
 * checked against the bridge's routes.
 */
async function judge({ account = {}, statsig = payload(), answers = {}, authMethod = "chatgpt" } = {}) {
  const calls = [];
  const routes = {
    "GET /accounts/check/v4-2023-04-27": { status: 200, body: { account_ordering: ["other", "own"], accounts: {
      other: { account: { account_id: "acct-2", plan_type: "free", structure: "personal" } },
      own: { account: { account_id: "acct-1", plan_type: "plus", structure: "personal", ...account } },
    } } },
    "POST /wham/statsig/bootstrap": statsig === null ? { status: 500, body: null } : { status: 200, body: { statsigPayload: statsig } },
    "GET /accounts/acct-1/settings": { status: 200, body: { permissions: [] } },
    "GET /settings/user": { status: 200, body: { flags: {}, settings: {} } },
    ...answers,
  };
  const result = await imagesAvailable({ authMethod, claims: { chatgpt_account_id: "acct-1", chatgpt_user_id: "user-1" }, statsig: { stable_id: "s" }, call: async (method, path, body) => {
    assert.ok(cloudAllowed(method, path, "internal") || cloudAllowed(method, path), `the bridge refuses ${method} ${path}`);
    calls.push(`${method} ${path}`);
    if (method === "POST") assert.deepEqual(body, { stable_id: "s" });
    const answer = routes[`${method} ${path}`];
    if (answer instanceof Error) throw answer;
    return answer;
  } });
  return { result, calls };
}

const HOLDOUT = { status: 200, body: { flags: { image_gen_holdout_active: true }, settings: {} } };
const DESKTOP_CHAT = "chatgpt.workspace.feature.desktop-app-chat.access";
const IMAGE_GEN = "chatgpt.workspace.feature.image-gen.access";

test("S3 imagesAvailable: only a plan not let in, a workspace's missing permission or a free holdout hides the page", async () => {
  const shown = async (options) => (await judge(options)).result.available;
  // The token's own account (plus) is judged, not the free one listed first; nothing else is asked.
  let { result, calls } = await judge({ answers: { "GET /settings/user": HOLDOUT } });
  assert.equal(result.available, true);
  assert.deepEqual(calls, ["GET /accounts/check/v4-2023-04-27", "POST /wham/statsig/bootstrap"]);
  // A free plan in its holdout without image generation switched on hides it; switched on, it shows.
  ({ result } = await judge({ account: { plan_type: "free" }, answers: { "GET /settings/user": HOLDOUT } }));
  assert.deepEqual([result.available, result.reason], [false, "image_gen_holdout"]);
  assert.equal(await shown({ account: { plan_type: "free" }, answers: { "GET /settings/user": { status: 200, body: { flags: { image_gen_holdout_active: true }, settings: { image_gen_enabled: true } } } } }), true);
  // The holdout reads no statsig: a bootstrap not read still hides it, the preview on.
  ({ result, calls } = await judge({ statsig: null, account: { plan_type: "free" }, answers: { "GET /settings/user": HOLDOUT } }));
  assert.deepEqual([result.available, result.reason, result.preview], [false, "image_gen_holdout", true]);
  ({ result, calls } = await judge({ statsig: null, account: { plan_type: "free" } }));
  assert.deepEqual([result.available, result.reason, calls.includes("GET /settings/user")], [true, "statsig_unavailable", true]);
  // A plan outside the desktop app's ($dt; enterprise_cbp_usage_based is in Jlt, not there) is hidden before the bootstrap.
  for (const plan of ["enterprise_cbp_usage_based", "self_serve_business_usage_based"]) {
    ({ result, calls } = await judge({ account: { plan_type: plan, structure: "workspace" } }));
    assert.deepEqual([result.available, result.reason, calls], [false, "unsupported_plan", ["GET /accounts/check/v4-2023-04-27"]], plan);
  }
  // /settings/user out of reach (the browser's 403, a network failure): shown, with the reason.
  for (const failed of [{ status: 403, body: { detail: "Just a moment..." } }, new TypeError("fetch failed")]) {
    ({ result } = await judge({ account: { plan_type: "free" }, answers: { "GET /settings/user": failed } }));
    assert.deepEqual([result.available, result.reason], [true, "settings_unavailable"]);
  }

  // 770071981 (desktop chat): an enterprise-like plan without the permission; a team plan is not asked.
  const desktop = payload({ gates: { 770071981: true } });
  ({ result, calls } = await judge({ statsig: desktop, account: { plan_type: "enterprise", structure: "workspace" } }));
  assert.deepEqual([result.available, result.reason], [false, "desktop_chat_access"]);
  assert.ok(calls.includes("GET /accounts/acct-1/settings"));
  assert.equal(await shown({ statsig: desktop, account: { plan_type: "enterprise", structure: "workspace" }, answers: { "GET /accounts/acct-1/settings": { status: 200, body: { permissions: [DESKTOP_CHAT] } } } }), true);
  ({ calls } = await judge({ statsig: desktop, account: { plan_type: "team", structure: "workspace" } }));
  assert.ok(!calls.includes("GET /accounts/acct-1/settings"));
  // 1355972088 (image generation): any workspace without the permission; a personal account is not asked.
  const imageGen = payload({ gates: { 1355972088: true } });
  ({ result } = await judge({ statsig: imageGen, account: { plan_type: "team", structure: "workspace" }, answers: { "GET /accounts/acct-1/settings": { status: 200, body: { permissions: [DESKTOP_CHAT] } } } }));
  assert.deepEqual([result.available, result.reason], [false, "image_gen_access"]);
  assert.equal(await shown({ statsig: imageGen, account: { plan_type: "team", structure: "workspace" }, answers: { "GET /accounts/acct-1/settings": { status: 200, body: { permissions: [IMAGE_GEN] } } } }), true);
  ({ calls } = await judge({ statsig: imageGen }));
  assert.ok(!calls.includes("GET /accounts/acct-1/settings"));
  // A permission counts only on a 200: a 404 or a failure leaves the page shown, the settings asked once.
  for (const failed of [{ status: 404, body: { detail: "Not Found" } }, new TypeError("fetch failed")]) {
    ({ result, calls } = await judge({ statsig: payload({ gates: { 770071981: true, 1355972088: true } }), account: { plan_type: "enterprise", structure: "workspace" }, answers: { "GET /accounts/acct-1/settings": failed } }));
    assert.deepEqual([result.available, result.reason], [true, "workspace_settings_unavailable"]);
    assert.equal(calls.filter((call) => call === "GET /accounts/acct-1/settings").length, 1);
  }

  // Not the token's account, no account, another login or nothing read: shown with the defaults and the reason
  // (a bootstrap not read still knows the account, a personal one: its links are public).
  const missing = { status: 200, body: { account_ordering: ["other"], accounts: { other: { account: { account_id: "acct-2", plan_type: "free" } } } } };
  for (const [options, reason] of [
    [{ answers: { "GET /accounts/check/v4-2023-04-27": missing } }, "missing_account"],
    [{ answers: { "GET /accounts/check/v4-2023-04-27": { status: 403, body: {} } } }, "accounts_unavailable"],
    [{ authMethod: "apikey" }, "not_chatgpt_auth"],
    [{ statsig: null }, "statsig_unavailable"],
    [{ statsig: JSON.stringify({ has_updates: false }) }, "statsig_unavailable"],
  ]) {
    ({ result } = await judge(options));
    assert.deepEqual(result, { available: true, preview: true, autoSendWithAttachments: false, sectionOrder: [], promptShare: false, promptShareLabel: "prompt_with_image", savedReferences: false, shareAudience: reason === "statsig_unavailable" ? "public" : "unknown", reason }, reason);
  }
});

test("S3 the page's switches: read as the SDK reads them, off when the bootstrap says nothing", async () => {
  // The bootstrap read, nothing in it: no preview (the desktop app's fallback), nothing else either.
  let { result } = await judge();
  assert.deepEqual(result, { available: true, preview: false, autoSendWithAttachments: false, sectionOrder: [], promptShare: false, promptShareLabel: "prompt_with_image", savedReferences: false, shareAudience: "public" });
  ({ result } = await judge({
    statsig: payload({
      gates: { 2496586795: true, 3734976009: true },
      layers: { 2724553558: { enabled: true }, 3360722522: { auto_send_with_attachments: true }, 250422953: { imagegen_prompt_share_tabs_enabled: true, imagegen_prompt_share_label: "image_with_prompt" } },
      configs: { 3939855767: { section_order: ["trending", "Templates", "动漫"] } },
    }),
    answers: { "GET /settings/user": { status: 200, body: { settings: { sunshine: true } } } },
  }));
  assert.deepEqual(result, { available: true, preview: true, autoSendWithAttachments: true, sectionOrder: ["trending", "Templates", "动漫"], promptShare: true, promptShareLabel: "image_with_prompt", savedReferences: true, shareAudience: "public" });
  // A parameter of another type is its fallback; a section order that is not all strings is none.
  ({ result } = await judge({ statsig: payload({ layers: { 2724553558: { enabled: "yes" }, 250422953: { imagegen_prompt_share_tabs_enabled: true, imagegen_prompt_share_label: 1 } }, configs: { 3939855767: { section_order: ["a", 2] } }, gates: { 2496586795: true } }) }));
  assert.deepEqual([result.preview, result.promptShare, result.promptShareLabel, result.sectionOrder], [false, true, "prompt_with_image", []]);
  // 1939400492 holds the prompt share back.
  ({ result } = await judge({ statsig: payload({ gates: { 2496586795: true, 1939400492: true }, layers: { 250422953: { imagegen_prompt_share_tabs_enabled: true } } }) }));
  assert.equal(result.promptShare, false);
  // V2 containers and hashed names, as the library reads them.
  ({ result } = await judge({ statsig: JSON.stringify({ has_updates: true, response_format: "init-v2", feature_gates: {}, layer_configs: { [djb2("2724553558")]: { v: "p" } }, values: { p: { enabled: true } } }) }));
  assert.equal(result.preview, true);
  // Who a share link reaches (the share dialog's V), by the account's structure; the bootstrap does not matter.
  for (const [structure, audience] of [["personal", "public"], ["workspace", "workspace"], [undefined, "unknown"], ["constructor", "unknown"]]) {
    ({ result } = await judge({ statsig: null, account: { structure, plan_type: structure === "workspace" ? "team" : "plus" } }));
    assert.equal(result.shareAudience, audience, String(structure));
  }
});

test("S3 saved references (QKa): the visor gate or layer, then the account's memory and its sunshine or m3m setting", async () => {
  const visor = (gates = {}) => payload({ gates, layers: { 2023018368: { visor_enabled: true } } });
  const user = (body) => ({ "GET /settings/user": { status: 200, body } });
  const saved = async (options) => (await judge(options)).result.savedReferences;
  assert.equal(await saved({ statsig: visor(), answers: user({ settings: { sunshine: true } }) }), true);
  assert.equal(await saved({ statsig: payload({ gates: { 3734976009: true } }), answers: user({ settings: { sunshine: true } }) }), true);
  // Neither gate nor layer: /settings/user is not asked at all.
  const { result, calls } = await judge({ answers: user({ settings: { sunshine: true } }) });
  assert.deepEqual([result.savedReferences, calls.includes("GET /settings/user")], [false, false]);
  assert.equal(await saved({ statsig: visor(), answers: user({ settings: { sunshine: "true" } }) }), false);
  // Off a personal account, memory switched off in the workspace's beta settings takes them away.
  assert.equal(await saved({ statsig: visor(), account: { structure: "workspace", plan_type: "team" }, answers: user({ settings: { sunshine: true }, beta_settings: { memory: false } }) }), false);
  assert.equal(await saved({ statsig: visor(), account: { structure: "workspace", plan_type: "team" }, answers: user({ settings: { sunshine: true }, beta_settings: {} }) }), true);
  assert.equal(await saved({ statsig: visor(), answers: user({ settings: { sunshine: true }, beta_settings: { memory: false } }) }), true);
  // 1862054621: m3m decides when it is set, sunshine when not.
  assert.equal(await saved({ statsig: visor({ 1862054621: true }), answers: user({ settings: { sunshine: true, m3m: false } }) }), false);
  assert.equal(await saved({ statsig: visor({ 1862054621: true }), answers: user({ settings: { sunshine: false, m3m: true } }) }), true);
  assert.equal(await saved({ statsig: visor({ 1862054621: true }), answers: user({ settings: { sunshine: true } }) }), true);
  assert.equal(await saved({ statsig: visor(), answers: user({ settings: { sunshine: false, m3m: true } }) }), false);
  // Settings out of reach: no saved references, the page shown.
  const failed = await judge({ statsig: visor(), answers: { "GET /settings/user": { status: 403, body: {} } } });
  assert.deepEqual([failed.result.available, failed.result.savedReferences, failed.result.reason], [true, false, "settings_unavailable"]);
});

test("S4 evaluateStatsig's gate and config leave the library's switches and its availability as they were", async () => {
  const text = payload({
    gates: { 224248639: true, 2767344663: true, 4231797315: true, 770071981: true },
    configs: { 3333071866: { enabled: true }, 3939855767: { section_order: ["trending"] } },
    layers: { 2724553558: { enabled: true } },
  });
  const values = evaluateStatsig(text);
  assert.deepEqual(Object.keys(values), ["library", "favorites", "storageBanner", "gate", "config"]);
  assert.deepEqual([values.library, values.favorites, values.storageBanner], [true, true, true]);
  assert.deepEqual([values.gate("770071981"), values.gate("1355972088"), values.config("layer_configs", "2724553558"), values.config("dynamic_configs", "nope")], [true, false, { enabled: true }, {}]);
  assert.equal(evaluateStatsig(JSON.stringify({ has_updates: false })), null);
  assert.equal(evaluateStatsig("{"), null);
  // The library's own answer carries none of them.
  const answer = await available({
    authMethod: "chatgpt",
    claims: { chatgpt_account_id: "acct-1", chatgpt_user_id: "user-1" },
    statsig: {},
    call: async (method, path) => ({
      "GET /accounts/check/v4-2023-04-27": { status: 200, body: { account_ordering: ["a"], accounts: { a: { account: { account_id: "acct-1", plan_type: "plus" } } } } },
      "POST /wham/statsig/bootstrap": { status: 200, body: { statsigPayload: text } },
      "GET /settings/user": { status: 200, body: { flags: {} } },
    })[`${method} ${path}`],
  });
  assert.deepEqual(answer, { available: true, favorites: true, storageBanner: true, notes: false, userId: "user-1" });
});
