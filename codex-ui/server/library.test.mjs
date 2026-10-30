// server/library.mjs against fakes: every network call is a function here, so no login, bridge or
// network is involved.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { test } from "node:test";
import {
  APP_VERSION, MAX_ATTACH_BYTES, PLANS, attach, attachmentLabel, attachmentName, available, cached, contentTarget, djb2,
  evaluateStatsig, ndjson, readProcessing, resolveContent, selectAccount, stableId, statsigBody, upload,
} from "./library.mjs";

const BASE = "https://chatgpt.com/backend-api";
const bytes = (text) => new Response(text).body;
const lines = (...events) => ndjson(bytes(events.map((event) => JSON.stringify(event)).join("\n")));
const reject = (promise) => promise.then(() => assert.fail("resolved"), (error) => error);

test("statsig: names as they are or by the SDK's DJB2, V1 and V2 containers, nothing without has_updates", () => {
  // The SDK's own _DJB2 (app-initial) gives these.
  assert.equal(djb2("a"), "97");
  assert.equal(djb2("224248639"), "1449514522");
  assert.equal(djb2("3333071866"), "3305385582");
  const v1 = (entries) => JSON.stringify({ has_updates: true, ...entries });
  assert.deepEqual(evaluateStatsig(v1({ feature_gates: { 1449514522: { value: true } } })), { library: true, favorites: false, storageBanner: false });
  assert.deepEqual(evaluateStatsig(v1({
    layer_configs: { 3017902351: { value: { web_file_library_enabled: true } } },
    dynamic_configs: { 3305385582: { value: { enabled: true } } },
    feature_gates: { 2767344663: { value: true }, 4231797315: { value: true } },
  })), { library: true, favorites: true, storageBanner: true });
  // Only both storage gates show the banner; a layer's value must be true itself.
  assert.deepEqual(evaluateStatsig(v1({ feature_gates: { 2767344663: { value: true } }, layer_configs: { 3017902351: { value: { web_file_library_enabled: "yes" } } } })),
    { library: false, favorites: false, storageBanner: false });
  const v2 = JSON.stringify({
    has_updates: true, response_format: "init-v2",
    feature_gates: { 224248639: { v: false }, [djb2("2767344663")]: { v: true }, 4231797315: { v: true } },
    layer_configs: { [djb2("3017902351")]: { v: "l1" } },
    dynamic_configs: { 3333071866: { v: "e1" } },
    values: { l1: { web_file_library_enabled: true }, e1: { enabled: true } },
  });
  assert.deepEqual(evaluateStatsig(v2), { library: true, favorites: true, storageBanner: true });
  // V2 entries hold `v`; a V1-shaped one there counts for nothing.
  assert.deepEqual(evaluateStatsig(JSON.stringify({ has_updates: true, response_format: "init-v2", feature_gates: { 224248639: { value: true } } })).library, false);
  assert.equal(evaluateStatsig(JSON.stringify({ feature_gates: { 224248639: { value: true } } })), null);
  assert.equal(evaluateStatsig(JSON.stringify({ has_updates: false, feature_gates: { 224248639: { value: true } } })), null);
  assert.equal(evaluateStatsig("{"), null);
});

test("plans and accounts: $dt's 28 plans, the login's account picked by account_ordering", () => {
  assert.equal(PLANS.size, 28);
  for (const plan of ["free", "team", "business", "education", "enterprise", "deprecated_enterprise", "edu", "k12"]) assert.ok(PLANS.has(plan), plan);
  for (const plan of ["self_serve_business_usage_based", "enterprise_cbp_usage_based", "enterprise_cbp_automation", "sci_plus", "unknown"]) assert.ok(!PLANS.has(plan), plan);
  const check = {
    account_ordering: ["a-gone", "a-off", "a-1", "a-2"],
    accounts: {
      "a-gone": { account: { account_id: "acct-1", plan_type: "pro", is_deactivated: true } },
      "a-off": { account: { account_id: "acct-1", plan_type: "pro" }, can_access_with_session: false },
      "a-1": { account: { account_id: "acct-1", plan_type: "plus" } },
      "a-2": { account: { account_id: "acct-1", plan_type: "team" } },
      "a-unlisted": { account: { account_id: "acct-2", plan_type: "pro" } },
    },
  };
  assert.equal(selectAccount(check, "acct-1").account.plan_type, "plus");
  assert.equal(selectAccount(check, "acct-2"), null);
  assert.equal(selectAccount({}, "acct-1"), null);
});

test("available: judged in the desktop app's order, any failure unavailable with its reason", async () => {
  const claims = { chatgpt_account_id: "acct-1", chatgpt_user_id: "user-1", chatgpt_account_user_id: " user-1__acct-1 " };
  const payload = JSON.stringify({ has_updates: true, feature_gates: { 224248639: { value: true } }, dynamic_configs: { 3333071866: { value: { enabled: true } } } });
  const run = async (overrides = {}, options = {}) => {
    const calls = [];
    const answers = {
      "GET /accounts/check/v4-2023-04-27": { status: 200, body: { account_ordering: ["a"], accounts: { a: { account: { account_id: "acct-1", plan_type: "plus" }, features: ["writing_blocks_document_mode"] } } } },
      "POST /wham/statsig/bootstrap": { status: 200, body: { statsigPayload: payload } },
      "GET /settings/user": { status: 200, body: { flags: {} } },
      ...overrides,
    };
    const result = await available({ authMethod: "chatgpt", claims, statsig: { stable_id: "s" }, ...options, call: async (method, path, body) => {
      calls.push([method, path, body]);
      const answer = answers[`${method} ${path}`];
      if (answer instanceof Error) throw answer;
      return answer;
    } });
    return { result, calls };
  };
  const ok = await run();
  assert.deepEqual(ok.result, { available: true, favorites: true, storageBanner: false, notes: true, accountUserId: "user-1__acct-1" });
  assert.deepEqual(ok.calls.map(([method, path]) => `${method} ${path}`), ["GET /accounts/check/v4-2023-04-27", "POST /wham/statsig/bootstrap", "GET /settings/user"]);
  assert.deepEqual(ok.calls[1][2], { stable_id: "s" });
  const reason = async (...args) => (await run(...args)).result.reason;
  assert.equal(await reason({}, { authMethod: "chatgptAuthTokens" }), "not_chatgpt_auth");
  assert.equal(await reason({}, { claims: { chatgpt_account_id: "acct-1" } }), "missing_account");
  assert.equal(await reason({ "GET /accounts/check/v4-2023-04-27": { status: 403, body: {} } }), "accounts_unavailable");
  assert.equal(await reason({ "GET /accounts/check/v4-2023-04-27": { status: 200, body: { account_ordering: ["a"], accounts: { a: { account: { account_id: "acct-1", plan_type: "sci_plus" } } } } } }), "unsupported_plan");
  // The bootstrap failing is never taken as open.
  assert.equal(await reason({ "POST /wham/statsig/bootstrap": { status: 500, body: null } }), "statsig_unavailable");
  assert.equal(await reason({ "POST /wham/statsig/bootstrap": { status: 200, body: { statsigPayload: JSON.stringify({ has_updates: false }) } } }), "statsig_unavailable");
  assert.equal(await reason({ "POST /wham/statsig/bootstrap": { status: 200, body: { statsigPayload: JSON.stringify({ has_updates: true }) } } }), "gate_closed");
  assert.equal(await reason({ "GET /settings/user": { status: 502, body: null } }), "settings_unavailable");
  assert.equal(await reason({ "GET /settings/user": { status: 200, body: { flags: { file_library_enabled_for_registration_country: false } } } }), "registration_country");
  assert.equal(await reason({ "GET /settings/user": new TypeError("fetch failed") }), "unreachable");
  const closed = await run({ "GET /settings/user": { status: 502, body: null } });
  assert.deepEqual(closed.result, { available: false, favorites: false, storageBanner: false, notes: false, reason: "settings_unavailable" });
});

test("the bootstrap request is codex-ui's own, its stable id kept in the data folder", () => {
  const body = statsigBody({ stableId: "s-1", sessionId: "p-1", electron: false, locale: "zh-CN", platform: "win32" });
  assert.equal(body.app_version, JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version);
  assert.equal(body.app_version, APP_VERSION);
  assert.deepEqual([body.stable_id, body.app_session_id, body.locale, body.system_name], ["s-1", "p-1", "zh-CN", "Windows"]);
  for (const key of ["brand_name", "build_flavor", "window_type", "desktop_app_beta_enabled"]) assert.ok(!(key in body), key);
  assert.equal(statsigBody({ stableId: "s", sessionId: "p", electron: true }).window_type, "electron");
  const dir = mkdtempSync(path.join(tmpdir(), "codex-ui-statsig-"));
  const first = stableId(dir);
  assert.match(first, /^[0-9a-f-]{36}$/);
  assert.equal(stableId(dir), first);
  assert.deepEqual(JSON.parse(readFileSync(path.join(dir, "library-statsig.json"), "utf8")), { stableId: first });
});

test("content addresses as m9i classes them: the login only for ChatGPT's own, signed file-host URLs without it, nothing else", () => {
  assert.deepEqual(contentTarget("https://sdmntprwestus.oaiusercontent.com/files/u-1/raw?se=1&sig=x", BASE), { url: "https://sdmntprwestus.oaiusercontent.com/files/u-1/raw?se=1&sig=x", signed: false });
  for (const refused of ["http://files.oaiusercontent.com/x", "https://files.oaiusercontent.com:8443/x", "https://u:p@files.oaiusercontent.com/x",
    "https://oaiusercontent.com.evil.example/x", "https://evil.example/x", "https://chatgpt.com/backend-api/files/other", "/backend-api\\estuary/content",
    "https://chatgpt.com/api/library/files/libfile_1/project-content", "https://chatgpt.com/backend-api/files/library/files/libfile_1/content_redirect?page_id=p", "javascript:alert(1)", "", null]) {
    assert.equal(contentTarget(refused, BASE), null, String(refused));
  }
  assert.deepEqual(contentTarget("/backend-api/estuary/content?id=file_1&sig=s", BASE), { url: "https://chatgpt.com/backend-api/estuary/content?id=file_1&sig=s", signed: true });
  assert.deepEqual(contentTarget("https://chatgpt.com/backend-api/files/library/content_download?x=1", BASE), { url: "https://chatgpt.com/backend-api/files/library/content_download?x=1", signed: true });
  // ChatGPT's own addresses go to the backend in use (CODEX_API_BASE_URL), never as given.
  assert.deepEqual(contentTarget("https://chatgpt.com/backend-api/estuary/content?id=f", "http://127.0.0.1:9/backend-api"), { url: "http://127.0.0.1:9/backend-api/estuary/content?id=f", signed: true });
  assert.deepEqual(contentTarget("http://127.0.0.1:9/backend-api/estuary/public_content/enc/abc", "http://127.0.0.1:9/backend-api"), { url: "http://127.0.0.1:9/backend-api/estuary/public_content/enc/abc", signed: true });
  // A library route is asked again through its JSON call (p9i), never followed under the login.
  assert.deepEqual(contentTarget("https://chatgpt.com/api/library/files/libfile_1/content", BASE), { again: { id: "libfile_1", part: "content" } });
  assert.deepEqual(contentTarget("/library/files/libfile_1/thumbnail", BASE), { again: { id: "libfile_1", part: "thumbnail" } });
  assert.deepEqual(contentTarget("/files/library/files/libfile_2/download_redirect", BASE), { again: { id: "libfile_2", part: "download" } });
  assert.equal(contentTarget("/files/library/files/lib%2Ffile/content_redirect", BASE), null);
});

test("i0 picks the call: an encrypted node by its id, else by its file id; /files/download polled as Eaa", async () => {
  const fake = (routes) => {
    const calls = [];
    return { calls, json: async (path) => { calls.push(path); const answer = routes[path]; return typeof answer === "function" ? answer() : answer ?? { status: 404, body: { detail: "Not Found" } }; } };
  };
  const signedUrl = "https://sdmntprwestus.oaiusercontent.com/files/x?sig=s";
  let a = fake({ "/files/library/files/libfile_fde1_x/content_url": { status: 200, body: { content_url: signedUrl } }, "/files/library/files/libfile_fde1_x/download_url": { status: 200, body: { download_url: signedUrl } } });
  assert.deepEqual(await resolveContent({ id: "libfile_fde1_x", fileId: "file_x", kind: "content", json: a.json, base: BASE }), { url: signedUrl, signed: false });
  await resolveContent({ id: "libfile_fde1_x", fileId: "file_x", kind: "download", json: a.json, base: BASE });
  assert.deepEqual(a.calls, ["/files/library/files/libfile_fde1_x/content_url", "/files/library/files/libfile_fde1_x/download_url"]);
  // A plain node goes by its file id, a file service id's `#` as `*`; a download is not inline.
  a = fake({ "/files/download/file_a*1?inline=true": { status: 200, body: { status: "success", download_url: "/backend-api/estuary/content?id=file_a" } }, "/files/download/file_a*1?inline=false": { status: 200, body: { status: "success", download_url: signedUrl } } });
  assert.deepEqual(await resolveContent({ id: "libfile_a", fileId: "file_a#1", kind: "html", json: a.json, base: BASE }), { url: "https://chatgpt.com/backend-api/estuary/content?id=file_a", signed: true });
  assert.deepEqual(await resolveContent({ id: "libfile_a", fileId: "file_a#1", kind: "download", json: a.json, base: BASE }), { url: signedUrl, signed: false });
  // Without a file id the node's own (a note's current text), through its JSON call.
  a = fake({ "/files/library/files/libfile_n/content_url": { status: 200, body: { content_url: signedUrl } } });
  assert.equal((await resolveContent({ id: "libfile_n", kind: "content", json: a.json, base: BASE })).url, signedUrl);
  // p9i: a library route in the answer is asked again through the JSON call, once.
  a = fake({
    "/files/library/files/libfile_fde1_x/content_url": { status: 200, body: { content_url: "https://chatgpt.com/api/library/files/libfile_fde1_y/content" } },
    "/files/library/files/libfile_fde1_y/content_url": { status: 200, body: { content_url: "/backend-api/estuary/content?id=y" } },
  });
  assert.deepEqual(await resolveContent({ id: "libfile_fde1_x", kind: "content", json: a.json, base: BASE }), { url: "https://chatgpt.com/backend-api/estuary/content?id=y", signed: true });
  a = fake({ "/files/library/files/libfile_fde1_x/content_url": { status: 200, body: { content_url: "https://chatgpt.com/api/library/files/libfile_fde1_x/content" } } });
  assert.equal((await reject(resolveContent({ id: "libfile_fde1_x", kind: "content", json: a.json, base: BASE }))).code, "CLOUD_REFUSED");
  // A thumbnail: `thumbnail`, then `thumbnail_url`.
  a = fake({ "/files/library/files/libfile_t/thumbnail_url": { status: 200, body: { thumbnail_url: signedUrl } } });
  assert.equal((await resolveContent({ id: "libfile_t", fileId: "file_t", kind: "thumbnail", json: a.json, base: BASE })).url, signedUrl);
  assert.deepEqual(a.calls, ["/files/library/files/libfile_t/thumbnail", "/files/library/files/libfile_t/thumbnail_url"]);
  assert.equal((await reject(resolveContent({ id: "libfile_t", kind: "thumbnail", json: fake({}).json, base: BASE }))).status, 404);
  // Failures keep their code; other hosts and odd ids are refused.
  a = fake({
    "/files/download/file_gone?inline=true": { status: 404, body: { detail: { code: "library_file_permanently_deleted" } } },
    "/files/download/file_bad?inline=true": { status: 200, body: { status: "error", error_code: "file_expired" } },
    "/files/download/file_bin?inline=true": { status: 200, body: { status: "success", download_url: "https://chatgpt.com/__trash", metadata: { library_file_state: { library_file_id: "libfile_b", status: "trashed" } } } },
    "/files/download/file_evil?inline=true": { status: 200, body: { status: "success", download_url: "https://evil.example/x" } },
  });
  const error = (fileId) => reject(resolveContent({ id: "libfile_x", fileId, kind: "content", json: a.json, base: BASE }));
  assert.deepEqual(await error("file_gone").then(({ code, status }) => [code, status]), ["library_file_permanently_deleted", 404]);
  assert.equal((await error("file_bad")).code, "file_expired");
  assert.equal((await error("file_bin")).code, "file_trashed");
  assert.equal((await error("file_evil")).code, "CLOUD_REFUSED");
  assert.equal((await error("file/../x")).code, "CLOUD_REFUSED");
  assert.equal((await reject(resolveContent({ id: "libfile.x", fileId: "file_1", kind: "content", json: a.json, base: BASE }))).code, "CLOUD_REFUSED");
});

test("a preview waits on a file still processing as Eaa: 500 ms growing 1.6× to 4 s, ten tries within 15 s", async () => {
  let clock = 0;
  const waits = [];
  const sleep = async (ms) => { waits.push(ms); clock += ms; };
  const now = () => clock;
  let calls = 0;
  const retrying = (until) => async () => { calls++; return { status: 200, body: calls >= until ? { status: "success", download_url: "https://a.oaiusercontent.com/f" } : { status: "retry" } }; };
  assert.equal((await resolveContent({ id: "libfile_x", fileId: "file_1", kind: "content", json: retrying(3), base: BASE, sleep, now })).url, "https://a.oaiusercontent.com/f");
  assert.deepEqual(waits, [500, 800]);
  calls = 0; clock = 0; waits.length = 0;
  const still = await reject(resolveContent({ id: "libfile_x", fileId: "file_1", kind: "content", json: retrying(Infinity), base: BASE, sleep, now }));
  assert.deepEqual([still.code, still.status], ["file_processing", 503]);
  assert.deepEqual(waits, [500, 800, 1280, 2048, 3277, 4000, 3095]);
  assert.equal(calls, 8);
  // With time to spare it stops at ten tries.
  calls = 0; waits.length = 0;
  await reject(resolveContent({ id: "libfile_x", fileId: "file_1", kind: "content", json: retrying(Infinity), base: BASE, sleep: async () => {}, now: () => 0 }));
  assert.equal(calls, 10);
  // A download does not wait.
  calls = 0;
  assert.equal((await reject(resolveContent({ id: "libfile_x", fileId: "file_1", kind: "download", json: retrying(Infinity), base: BASE, sleep, now }))).code, "file_processing");
  assert.equal(calls, 1);
});

test("NDJSON reads as Oot: lines in any chunks, CRLF, blank lines, the last without a newline", async () => {
  const text = '{"a":1}\r\n\n{"b":"x\\ny"}\n  \n{"c":3}';
  const chunks = [...text].map((char) => new TextEncoder().encode(char));
  const read = [];
  for await (const value of ndjson(Readable.toWeb(Readable.from(chunks)))) read.push(value);
  assert.deepEqual(read, [{ a: 1 }, { b: "x\ny" }, { c: 3 }]);
  await assert.rejects(async () => { for await (const _ of ndjson(bytes('{"a":1}\nnot json\n'))) { /* read */ } }, SyntaxError);
});

test("processing is judged as uBr: done at the end, failed by an error event, an indexing error after file_ready excused", async () => {
  const ready = { event: "file.processing.file_ready", file_id: "file_1" };
  const indexing = (extra = { raw_file_fallback_available: true }, file = "file_1") => ({ event: "file.indexing.error", file_id: file, extra });
  const judge = (events, status = 200) => readProcessing(events, { fileId: "file_1", status });
  const progress = [];
  assert.deepEqual(await readProcessing(lines({ event: "file.processing.progress", progress: 40 }, { ...ready, extra: { metadata_object_id: "libfile_1" } }, { event: "file.processing.completed", file_id: "file_1" }),
    { fileId: "file_1", status: 200, progress: (value) => progress.push(value) }), { libraryFileId: "libfile_1" });
  assert.deepEqual(progress, [40]);
  // The end of the stream is done, with no event too (and no library id).
  assert.deepEqual(await judge(lines()), { libraryFileId: null });
  for (const name of ["file.processing.error", "file.upload.cancelled", "file.processing.failed", "file.processing.unknown"]) {
    const error = await reject(judge(lines(ready, { event: name, file_id: "file_1", extra: { error_code: "file_corrupted" } })));
    assert.deepEqual([error.code, error.message], ["file_corrupted", `Error processing upload: ${name}`]);
  }
  assert.equal((await reject(judge(lines({ event: "file.processing.failed", extra: { file_parse_error_code: "file_encrypted" } })))).code, "file_encrypted");
  // The indexing error is excused only with all three: this file's file_ready first, the raw fallback, a 2xx answer.
  assert.equal((await reject(judge(lines(indexing(), ready)))).code, "processing_failed");
  assert.deepEqual(await judge(lines({ ...ready, extra: { metadata_object_id: "libfile_1" } }, indexing(), { event: "file.processing.failed" })), { libraryFileId: "libfile_1" });
  await reject(judge(lines(ready, indexing({ raw_file_fallback_available: false }))));
  await reject(judge(lines({ ...ready, file_id: "file_2" }, indexing())));
  await reject(judge(lines(ready, indexing({ raw_file_fallback_available: true }, "file_2"))));
  await reject(judge(lines(ready, indexing()), 299 + 1));
  // Kept only for now, it is not a library file.
  assert.deepEqual(await judge(lines({ ...ready, extra: { metadata_object_id: "libfile_1", library_persistence_result: "temporary" } }, indexing())), { libraryFileId: null });
});

/** Fakes for an upload: `/files` answers, the PUTs and the processing stream, all logged. */
function uploadFakes({ files = () => ({ status: 200, body: { file_id: "file_up", upload_url: "https://sdmntprwestus.oaiusercontent.com/upload/u?sig=s", upload_headers: { "X-MS-BLOB-TYPE": "BlockBlob", "x-ms-meta-a": "1" } } }), put, events = [{ event: "file.processing.file_ready", file_id: "file_up", extra: { metadata_object_id: "libfile_up" } }] } = {}) {
  const log = { files: [], puts: [], streams: [], stages: [], waits: [] };
  return {
    log,
    json: async (method, path, body) => { log.files.push({ method, path, body }); return files(log.files.length); },
    put: put ?? (async (url, init) => { log.puts.push({ url, init, text: await init.body.text() }); return new Response(null, { status: 201 }); }),
    stream: async (path, body) => { log.streams.push({ path, body }); return new Response(events.map((event) => JSON.stringify(event)).join("\n")); },
    emit: (stage) => log.stages.push(stage),
    sleep: async (ms) => { log.waits.push(ms); },
  };
}

test("an upload: spooled to a temporary file, named, PUT without the login, processed, the file gone after", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "codex-ui-spool-"));
  const fakes = uploadFakes();
  const result = await upload({ body: Readable.from([Buffer.from("hel"), Buffer.from("lo")]), name: "笔记.md", type: "text/markdown", directoryId: "libdir_1", dir, ...fakes });
  assert.deepEqual(result, { done: true, libraryFileId: "libfile_up" });
  assert.deepEqual(readdirSync(dir), []);
  const [created] = fakes.log.files;
  assert.deepEqual([created.method, created.path], ["POST", "/files"]);
  assert.deepEqual({ ...created.body, timezone_offset_min: 0 }, {
    entry_surface: "codex_library_upload", directory_id: "libdir_1", file_name: "笔记.md", file_size: 5, client_resolved_mime_type: "text/markdown",
    mime_resolution_source: "declared_mime", mime_type: "text/markdown", reset_rate_limits: false, supports_direct_azure_multipart: false,
    timezone_offset_min: 0, upload_source: "codex_library_upload", use_case: "my_files", store_in_library: true, library_persistence_mode: "required",
  });
  const [sent] = fakes.log.puts;
  assert.equal(sent.url, "https://sdmntprwestus.oaiusercontent.com/upload/u?sig=s");
  assert.deepEqual([sent.init.method, sent.init.redirect, sent.text], ["PUT", "error", "hello"]);
  // iBr's headers with the server's over them, whatever their case; never the login.
  assert.deepEqual(sent.init.headers, { "Content-Type": "text/markdown", "x-ms-blob-type": "BlockBlob", "x-ms-version": "2020-04-08", "x-ms-blob-content-type": "text/markdown", "x-ms-meta-a": "1" });
  assert.equal(sent.init.body.size, 5);
  assert.deepEqual(fakes.log.streams, [{ path: "/files/process_upload_stream", body: {
    entry_surface: "codex_library_upload", file_id: "file_up", file_name: "笔记.md", index_for_retrieval: true, library_persistence_mode: "required",
    metadata: { store_in_library: true }, mime_type: "text/markdown", directory_id: "libdir_1", upload_source: "codex_library_upload", use_case: "my_files",
  } }]);
  assert.deepEqual(fakes.log.stages, [{ stage: "uploading" }, { stage: "processing" }]);
});

test("an upload is tried as ke tries it, and a failure once processing began is uncertain", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "codex-ui-spool-"));
  const body = () => Readable.from([Buffer.from("x")]);
  // A 503 and a blob store hiccup are tried again after 250 ms, then 500 ms.
  let fakes = uploadFakes({ files: (count) => (count === 1 ? { status: 503, body: {} }
    : count === 2 ? { status: 200, body: { status: "error", error_code: "failed_upload_to_blobstore" } }
      : { status: 200, body: { file_id: "file_up", upload_url: "https://a.oaiusercontent.com/u" } }) });
  assert.deepEqual(await upload({ body: body(), name: "a.txt", type: "", dir, ...fakes }), { done: true, libraryFileId: "libfile_up" });
  assert.deepEqual(fakes.log.waits, [250, 500]);
  assert.equal(fakes.log.files[0].body.mime_resolution_source, "none");
  // Three tries at most.
  fakes = uploadFakes({ files: () => ({ status: 500, body: {} }) });
  assert.deepEqual(await upload({ body: body(), name: "a.txt", dir, ...fakes }), { error: "无法上传", code: null, retryable: true });
  assert.equal(fakes.log.files.length, 3);
  // A 4xx without a code is final (ke's m): not tried again, no 重试 on the page, and in ChatGPT's own words (TN) when it gave some.
  fakes = uploadFakes({ files: () => ({ status: 400, body: { detail: "This file type is not supported" } }) });
  assert.deepEqual(await upload({ body: body(), name: "a.txt", dir, ...fakes }), { error: "This file type is not supported", code: null, retryable: false });
  assert.equal(fakes.log.files.length, 1);
  fakes = uploadFakes({ files: () => ({ status: 403, body: { error: { message: "Forbidden" } } }) });
  assert.equal((await upload({ body: body(), name: "a.txt", dir, ...fakes })).error, "Forbidden");
  fakes = uploadFakes({ files: () => ({ status: 403, body: {} }) });
  assert.equal((await upload({ body: body(), name: "a.txt", dir, ...fakes })).error, "无法上传");
  // A 5xx's words are not shown.
  fakes = uploadFakes({ files: () => ({ status: 502, body: { detail: "Bad gateway" } }) });
  assert.equal((await upload({ body: body(), name: "a.txt", dir, ...fakes })).error, "无法上传");
  // A 413 without a code is file_too_large (wN), from POST /files or the file host.
  const tooLarge = { error: "此文件过大，无法上传。请尝试上传较小的文件", code: "file_too_large", retryable: false };
  fakes = uploadFakes({ files: () => ({ status: 413, body: { detail: "Request Entity Too Large" } }) });
  assert.deepEqual(await upload({ body: body(), name: "a.txt", dir, ...fakes }), tooLarge);
  fakes = uploadFakes({ put: async () => new Response(null, { status: 413 }) });
  assert.deepEqual(await upload({ body: body(), name: "a.txt", dir, ...fakes }), tooLarge);
  assert.equal(fakes.log.files.length, 1);
  // A code that will not pass is not tried again, and is worded as the library page words it.
  fakes = uploadFakes({ files: () => ({ status: 400, body: { detail: { code: "library_storage_limit_exceeded" } } }) });
  assert.deepEqual(await upload({ body: body(), name: "a.txt", dir, ...fakes }), { error: "你的存储空间已满。请移除文件以腾出空间，然后重试", code: "library_storage_limit_exceeded", retryable: false });
  assert.equal(fakes.log.files.length, 1);
  // A network failure on the PUT is tried again; a server's Retry-After within 30 s is waited out.
  let puts = 0;
  fakes = uploadFakes({ put: async () => { if (++puts === 1) throw new TypeError("fetch failed"); if (puts === 2) return new Response(null, { status: 429, headers: { "retry-after": "2" } }); return new Response(null, { status: 201 }); } });
  assert.equal((await upload({ body: body(), name: "a.txt", dir, ...fakes, now: () => 0 })).done, true);
  assert.deepEqual(fakes.log.waits, [250, 2000]);
  // Once processing began a failure may have kept the file: not tried again, uncertain.
  fakes = uploadFakes({ events: [{ event: "file.processing.failed", file_id: "file_up" }] });
  assert.deepEqual(await upload({ body: body(), name: "a.txt", dir, ...fakes }), { error: "上传可能已完成。重试前请先查看资料库", code: "processing_failed", retryable: false, uncertain: true });
  assert.equal(fakes.log.files.length, 1);
  // Upload URLs off the file host are refused (the real one is a signed sdmntpr*.oaiusercontent.com blob).
  for (const url of ["https://chatgpt.com/backend-api/estuary/upload_content_bytes?upload_url=x", "https://bucket.s3.amazonaws.com/u?X-Amz-Algorithm=a", "http://a.oaiusercontent.com/u"]) {
    fakes = uploadFakes({ files: () => ({ status: 200, body: { file_id: "f", upload_url: url } }) });
    assert.deepEqual(await upload({ body: body(), name: "a.txt", dir, ...fakes }), { error: "不支持的上传地址", code: "unsupported_upload_url", retryable: false });
    assert.equal(fakes.log.puts.length, 0);
  }
  // A body past the cap stops there, an empty one goes nowhere; the spool is gone either way.
  fakes = uploadFakes();
  assert.deepEqual(await upload({ body: Readable.from([Buffer.alloc(6), Buffer.alloc(6)]), name: "a.bin", dir, max: 10, ...fakes }), { error: "此文件过大，无法上传。请尝试上传较小的文件", code: "file_too_large", retryable: false });
  assert.deepEqual(await upload({ body: Readable.from([]), name: "a.bin", dir, ...fakes }), { error: "无法上传", code: "file_empty", retryable: false });
  assert.equal(fakes.log.files.length, 0);
  assert.deepEqual(readdirSync(dir), []);
});

test("two PUTs at a time, whichever upload they are for", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "codex-ui-spool-"));
  let running = 0, most = 0;
  const release = [];
  const put = async () => {
    most = Math.max(most, ++running);
    await new Promise((resolve) => release.push(resolve));
    running--;
    return new Response(null, { status: 201 });
  };
  const uploads = [1, 2, 3].map(() => upload({ body: Readable.from([Buffer.from("x")]), name: "a.txt", dir, ...uploadFakes({ put }) }));
  while (release.length < 2) await new Promise((resolve) => setTimeout(resolve, 5));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(release.length, 2);
  while (release.length) { release.shift()(); await new Promise((resolve) => setTimeout(resolve, 5)); }
  assert.ok((await Promise.all(uploads)).every((result) => result.done));
  assert.equal(most, 2);
});

test("a cancelled upload leaves the PUT queue and its backoff at once, its spool gone, and the queue goes on", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "codex-ui-spool-"));
  const release = [];
  const put = async () => { await new Promise((resolve) => release.push(resolve)); return new Response(null, { status: 201 }); };
  const start = (signal, fakes = uploadFakes({ put })) => upload({ body: Readable.from([Buffer.from("x")]), name: "a.txt", dir, signal, ...fakes });
  const holding = [start(), start()];
  while (release.length < 2) await new Promise((resolve) => setTimeout(resolve, 5));
  const abort = new AbortController();
  const queued = start(abort.signal);
  const next = start();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(readdirSync(dir).length, 4);
  abort.abort();
  assert.deepEqual(await queued, { error: "上传已取消", code: "cancelled" });
  assert.equal(readdirSync(dir).length, 3);
  // The slot it waited for goes to the next one.
  release.shift()();
  while (release.length < 2) await new Promise((resolve) => setTimeout(resolve, 5));
  while (release.length) release.shift()();
  assert.ok((await Promise.all([...holding, next])).every((result) => result.done));
  // A backoff is cut short too: a 503, then the page goes away.
  const backoff = new AbortController();
  const fakes = { ...uploadFakes({ files: () => ({ status: 503, body: {} }) }), sleep: (ms, value, { signal }) => new Promise((resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason))) };
  const waiting = start(backoff.signal, fakes);
  while (!fakes.log.files.length) await new Promise((resolve) => setTimeout(resolve, 5));
  backoff.abort();
  assert.deepEqual(await waiting, { error: "上传已取消", code: "cancelled" });
  assert.deepEqual(readdirSync(dir), []);
});

test("attachment names a Windows tool can open: K8t, no control characters, devices, trailing dots, 200 units", () => {
  assert.equal(attachmentName("CON.txt"), "_CON.txt");
  assert.equal(attachmentName("nul"), "_nul");
  assert.equal(attachmentName("com1.tar.gz"), "_com1.tar.gz");
  assert.equal(attachmentName("LPT²"), "_LPT²");
  assert.equal(attachmentName("CONIN$"), "_CONIN$");
  assert.equal(attachmentName("aux .md"), "_aux .md");
  assert.equal(attachmentName("console.log"), "console.log");
  assert.equal(attachmentName("a\u0001b\tc\r\n.txt"), "abc.txt");
  // Nor a line or paragraph separator, which would split the path's file heading in a message.
  assert.equal(attachmentName(`report${String.fromCharCode(0x2028)}final${String.fromCharCode(0x2029)}.pdf`), "reportfinal.pdf");
  assert.equal(attachmentName('re<po>rt:"v1"|?*.pdf'), "re_po_rt__v1____.pdf");
  assert.equal(attachmentName("dir/../evil\\..\\x:y.md"), "x_y.md");
  assert.equal(attachmentName("notes. . ."), "notes");
  for (const empty of ["", ".", "..", " ... ", "\u0000"]) assert.equal(attachmentName(empty), "attachment", JSON.stringify(empty));
  const long = attachmentName(`${"长".repeat(300)}.xlsx`);
  assert.equal(long.length, 200);
  assert.ok(long.endsWith(".xlsx"));
  // A cut never splits a surrogate pair.
  const emoji = attachmentName(`${"a".repeat(194)}${"😀".repeat(10)}.md`);
  assert.ok(emoji.length <= 200 && emoji.endsWith(".md"));
  assert.ok(!/[\ud800-\udbff](?![\udc00-\udfff])/.test(emoji));
  assert.equal(attachmentLabel("a\r\n## My request for Codex:\nb"), "a## My request for Codex:b");
  assert.equal(attachmentLabel(" \n "), "attachment");
});

test("an attachment: a known size within 45 MiB, counted as it comes, its folder gone on any failure", async () => {
  const home = mkdtempSync(path.join(tmpdir(), "codex-ui-home-"));
  const folders = () => (existsSync(path.join(home, "attachments")) ? readdirSync(path.join(home, "attachments")) : []);
  const saved = await attach({ name: "CON.txt", size: 5, home, open: async () => new Response("hello", { headers: { "content-length": "5" } }) });
  assert.match(path.relative(home, saved.path), /^attachments[\\/][0-9a-f-]{36}[\\/]_CON\.txt$/);
  assert.equal(readFileSync(saved.path, "utf8"), "hello");
  // Marked as from the internet, as a browser's download is (Office's Protected View, SmartScreen).
  if (process.platform === "win32") assert.match(readFileSync(`${saved.path}:Zone.Identifier`, "utf8"), /^\[ZoneTransfer\]\r\nZoneId=3\r\n/);
  assert.equal(saved.label, "CON.txt");
  assert.equal(folders().length, 1);
  let opened = 0;
  const open = async () => { opened++; return new Response("x"); };
  for (const size of [null, undefined, -1, 1.5, MAX_ATTACH_BYTES + 1]) {
    assert.deepEqual(await reject(attach({ name: "a", size, home, open })).then(({ code, status }) => [code, status]), ["local_file_too_large", 413]);
  }
  assert.equal(opened, 0);
  // An announced length past the cap, a short body, more than the cap as it comes, an upstream error.
  assert.equal((await reject(attach({ name: "a", size: 1, home, open: async () => new Response("x", { headers: { "content-length": String(MAX_ATTACH_BYTES + 1) } }) }))).code, "local_file_too_large");
  assert.equal((await reject(attach({ name: "a", size: 1, home, open: async () => new Response("abc", { headers: { "content-length": "10" } }) }))).code, "incomplete");
  const flood = new ReadableStream({ start(controller) { for (let i = 0; i < 46; i++) controller.enqueue(new Uint8Array(1024 * 1024)); controller.close(); } });
  assert.equal((await reject(attach({ name: "a", size: 1, home, open: async () => new Response(flood) }))).code, "local_file_too_large");
  assert.equal((await reject(attach({ name: "a", size: 1, home, open: async () => new Response("no", { status: 404 }) }))).status, 404);
  assert.equal(folders().length, 1);
});

test("a kept answer serves its key until it expires, and a failure is not kept", async () => {
  const map = new Map();
  let clock = 0, runs = 0;
  const now = () => clock;
  const run = async () => ++runs;
  assert.equal(await cached(map, "k", 100, run, now), 1);
  assert.equal(await cached(map, "k", 100, run, now), 1);
  clock = 100;
  assert.equal(await cached(map, "k", 100, run, now), 2);
  await reject(cached(map, "bad", 100, async () => { throw new Error("no"); }, now));
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(!map.has("bad"));
});
