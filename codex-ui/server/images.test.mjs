// The ChatGPT calls the 图像 page may make (server/cloud.mjs's 图像 block): all read only, the
// catalog's two in Chinese, and never a chat or its anti-abuse tokens; the library's own routes
// stay the bridge's. cloudFetch runs against a fake fetch: no network or login.
import assert from "node:assert/strict";
import { test } from "node:test";
import { cloudAllowed, cloudFetch } from "./cloud.mjs";

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
];

test("S1 the 图像 block lets the page's reads through and nothing else", () => {
  for (const path of ALLOWED) assert.ok(cloudAllowed("GET", path), `GET ${path} should pass`);
  for (const [method, path] of REFUSED) assert.equal(cloudAllowed(method, path), false, `${method} ${path} should be refused`);
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
