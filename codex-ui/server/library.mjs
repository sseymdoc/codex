// The ChatGPT library (chatgpt.com's /files/library), as the Codex desktop app (26.1023) reads
// and writes it: whether this login has it, where a file's bytes are, an upload's three steps and
// a file saved where a chat can read it. The orchestrator hands in its calls under the session's
// login (`json`, `put`, `stream`, `open`), so the token, upload URLs and signed addresses stay in
// the bridge and these stay testable without one.
import { randomUUID } from "node:crypto";
import { createWriteStream, mkdirSync, openAsBlob, readFileSync, writeFileSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { release, tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { setTimeout as delay } from "node:timers/promises";
import { LIBID } from "./cloud.mjs";

/** The upload cap (Codex's hBr), a chat attachment's (local-file-selection `b`) and a preview's (library-cloud-file-preview `aa`). */
export const MAX_UPLOAD_BYTES = 536870912;
export const MAX_ATTACH_BYTES = 47185920;
export const MAX_PREVIEW_BYTES = 41943040;

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** codex-ui's own version, as the page has it (__APP_VERSION__ is package.json's). */
export const APP_VERSION = (() => {
  try { return JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version ?? ""; } catch { return ""; }
})();

const failure = (code, message, status) => Object.assign(new Error(message), { code: code ?? null, status: status ?? null, library: true });
const refused = () => Object.assign(new Error("This file is not allowed."), { code: "CLOUD_REFUSED" });

// ---------------------------------------------------------------------------
// Whether this login has it

/** The plans the desktop app lets into the library: $dt's 28 raw plan_type values. */
export const PLANS = new Set(["free", "go", "plus", "pro", "promax", "prolite", "free_workspace", "team",
  "self_serve_business_prolite", "sci", "rosalind_academic", "business", "enterprise_cbp_trial", "enterprise_cbp_view_only",
  "finserv", "law", "ent26", "education", "edu_plus", "edu_pro", "quorum", "enterprise", "hc", "hc_consumption",
  "deprecated_enterprise", "edu", "deprecated_edu", "k12"]);

/** The login's own entry in /accounts/check, picked as the desktop app picks it (initialize-app-host-services `oT`). */
export function selectAccount(check, accountId) {
  return (Array.isArray(check?.account_ordering) ? check.account_ordering : [])
    .map((id) => check.accounts?.[id])
    .find((entry) => entry?.account?.account_id === accountId && entry.can_access_with_session !== false && !entry.account.is_deactivated) ?? null;
}

/** Statsig's name hash (_DJB2): an entry is found by its name or by this. */
export function djb2(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  return String(hash >>> 0);
}

/**
 * The library's switches in a statsig bootstrap (`statsigPayload`), read as the SDK reads them: a
 * V2 (`init-v2`) or V1 container, names as they are or hashed, and nothing without `has_updates`
 * (null). The library is gate 224248639 or layer 3017902351's web_file_library_enabled (TL),
 * favorites experiment 3333071866 (U4), the storage banner gates 2767344663 and 4231797315 (qa).
 */
export function evaluateStatsig(payload) {
  let values;
  try { values = JSON.parse(payload); } catch { return null; }
  if (values?.has_updates !== true) return null;
  const v2 = values.response_format === "init-v2";
  const lookup = (table, name) => values[table]?.[name] ?? values[table]?.[djb2(name)] ?? null;
  const gate = (name) => { const entry = lookup("feature_gates", name); return (v2 ? entry?.v : entry?.value) === true; };
  const config = (table, name) => { const entry = lookup(table, name); return (entry && (v2 ? values.values?.[entry.v] : entry.value)) ?? {}; };
  return {
    library: gate("224248639") || config("layer_configs", "3017902351").web_file_library_enabled === true,
    favorites: config("dynamic_configs", "3333071866").enabled === true,
    storageBanner: gate("2767344663") && gate("4231797315"),
  };
}

const SYSTEMS = { win32: "Windows", darwin: "macOS", linux: "Linux" };

/**
 * The bootstrap's request, filled in truthfully as codex-ui and never as the desktop app: no
 * brand_name or build_flavor, window_type only in the desktop shell. The server takes it; were it
 * refused, the library would stay hidden with its reason, never dressed up.
 */
export function statsigBody({ stableId, sessionId, electron, appVersion = APP_VERSION, locale = Intl.DateTimeFormat().resolvedOptions().locale, platform = process.platform }) {
  return {
    app_session_id: sessionId,
    app_version: appVersion,
    locale,
    stable_id: stableId,
    system_name: SYSTEMS[platform] ?? platform,
    system_version: release(),
    ...(electron ? { window_type: "electron" } : {}),
  };
}

/** Statsig's stable id for this installation, kept in `dir`'s library-statsig.json (0o600) as the executor keeps its own. */
export function stableId(dir) {
  const file = path.join(dir, "library-statsig.json");
  try {
    const saved = JSON.parse(readFileSync(file, "utf8")).stableId;
    if (typeof saved === "string" && UUID.test(saved)) return saved;
  } catch { /* first run */ }
  const id = randomUUID();
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, `${JSON.stringify({ stableId: id })}\n`, { mode: 0o600 });
  } catch { /* this run's only */ }
  return id;
}

/**
 * Whether this login has the library, judged in the desktop app's order (Xdt, then TL): a login
 * that is exactly "chatgpt", with its account and user; its account's plan in $dt; the statsig
 * gate; the registration country (/settings/user). Any failure reads as unavailable, with its
 * `reason`. Favorites, the storage banner and notes come with it. `call(method, path, body)` makes
 * one call ({status, body}); `statsig` is the bootstrap's request. The login's account user id comes too.
 */
export async function available({ authMethod, claims, call, statsig }) {
  const no = (reason) => ({ available: false, favorites: false, storageBanner: false, notes: false, reason });
  if (authMethod !== "chatgpt") return no("not_chatgpt_auth");
  if (!claims?.chatgpt_account_id || !claims.chatgpt_user_id) return no("missing_account");
  try {
    const accounts = await call("GET", "/accounts/check/v4-2023-04-27");
    if (accounts.status !== 200) return no("accounts_unavailable");
    const entry = selectAccount(accounts.body, claims.chatgpt_account_id);
    if (!entry) return no("missing_account");
    if (!PLANS.has(entry.account.plan_type)) return no("unsupported_plan");
    const bootstrap = await call("POST", "/wham/statsig/bootstrap", statsig);
    const gates = bootstrap.status === 200 && typeof bootstrap.body?.statsigPayload === "string" ? evaluateStatsig(bootstrap.body.statsigPayload) : null;
    if (!gates) return no("statsig_unavailable");
    if (!gates.library) return no("gate_closed");
    const settings = await call("GET", "/settings/user");
    if (settings.status !== 200) return no("settings_unavailable");
    if (settings.body?.flags?.file_library_enabled_for_registration_country === false) return no("registration_country");
    // The notes item needs writing_blocks_document_mode (slate-create-menu `nr`), in this entry's features.
    const features = [entry.features, entry.account.features].find(Array.isArray) ?? [];
    // The login's account user id (the desktop app's accountUserId): a file version by anyone else reads 协作者.
    const user = typeof claims.chatgpt_account_user_id === "string" ? claims.chatgpt_account_user_id.trim() : "";
    return { available: true, favorites: gates.favorites, storageBanner: gates.storageBanner, notes: features.includes("writing_blocks_document_mode"), ...(user ? { accountUserId: user } : {}) };
  } catch {
    return no("unreachable");
  }
}

/** `run()`'s promise, kept `ttl` ms under `key`; a failure is not kept. */
export function cached(map, key, ttl, run, now = Date.now) {
  const at = now();
  const hit = map.get(key);
  if (hit && hit.expires > at) return hit.value;
  for (const [stale, entry] of map) if (entry.expires <= at) map.delete(stale);
  const value = Promise.resolve().then(run);
  map.set(key, { value, expires: at + ttl });
  value.catch(() => { if (map.get(key)?.value === value) map.delete(key); });
  return value;
}

// ---------------------------------------------------------------------------
// Where a file's bytes are

/** A library id (a node's, a folder's, a file's), as cloud.mjs routes it. */
export const ITEM = new RegExp(`^${LIBID}$`);
const LIBFILE = /^libfile[-_][A-Za-z0-9_-]+$/;
const FDE = /^libfile_fde\d+_/u;
const URL_CALLS = { content: "content_url", download: "download_url", thumbnail: "thumbnail_url" };

const codeOf = (body) => [body?.error_code, body?.code, body?.detail?.code, body?.detail?.error_code, body?.error?.code, body?.detail]
  .find((value) => typeof value === "string" && /^[a-z0-9_]{1,64}$/.test(value)) ?? null;

/** What ChatGPT said in a failure, read as TN reads it: `error` or its message, else `detail`, its message, msgs or description. */
function saidIn(body) {
  const said = (value) => (typeof value === "string" ? value
    : Array.isArray(value) ? value.map((entry) => entry?.msg).filter((msg) => typeof msg === "string").join("\n")
      : [value?.message, value?.description].find((text) => typeof text === "string") ?? "");
  return (said(body?.error) || said(body?.detail)).trim() || null;
}

const unavailable = (status, body) => failure(codeOf(body) ?? "file_unavailable",
  codeOf(body) === "library_file_permanently_deleted" ? "此文件已被永久删除" : status === 403 || status === 404 ? "无法打开此文件" : `ChatGPT 返回错误（${status}）`, status);

/**
 * A content address as m9i classes it. ChatGPT's library route for a file (the web one, or the
 * API's *_redirect) comes back as `again`: asked anew through its JSON *_url call (p9i), never
 * followed under the login. The backend's estuary and content_download go under the login
 * (`signed`), at `base`; a file host's signed URL (https, *.oaiusercontent.com, no port or user)
 * without it. Anything else is null: refused, as is any https host elsewhere.
 */
export function contentTarget(raw, base) {
  if (typeof raw !== "string" || !raw.trim() || raw.includes("\\")) return null;
  let url;
  try { url = new URL(raw.trim(), "https://chatgpt.com"); } catch { return null; }
  if (url.username || url.password) return null;
  const backend = new URL(base);
  const chatgpt = url.protocol === "https:" && !url.port && url.hostname === "chatgpt.com";
  if (chatgpt || url.origin === backend.origin) {
    const prefix = chatgpt ? "/backend-api" : backend.pathname.replace(/\/+$/, "");
    const prefixed = url.pathname.startsWith(`${prefix}/`);
    const rest = prefixed ? url.pathname.slice(prefix.length) : url.pathname;
    const route = (chatgpt && /^\/(?:api\/)?library\/files\/([^/]+)\/(content|download|thumbnail)$/u.exec(url.pathname))
      || /^\/files\/library\/files\/([^/]+)\/(content|download|thumbnail)_redirect$/u.exec(rest);
    if (route) {
      if (url.searchParams.has("page_id") || url.searchParams.has("file_id")) return null;
      let id;
      try { id = decodeURIComponent(route[1]); } catch { return null; }
      return ITEM.test(id) ? { again: { id, part: route[2] } } : null;
    }
    // content_url, download_url and /files/download answer with estuary; thumbnail_url with estuary or a signed sdmntpr*.oaiusercontent.com URL.
    if (prefixed && /^\/(?:estuary\/(?:content\/?|public_content\/enc\/[^/]+)|files\/library\/content_download\/?)$/u.test(rest)) {
      return { url: `${backend.origin}${backend.pathname.replace(/\/+$/, "")}${rest}${url.search}`, signed: true };
    }
    return null;
  }
  return url.protocol === "https:" && !url.port && /(^|\.)oaiusercontent\.com$/i.test(url.hostname) ? { url: url.href, signed: false } : null;
}

/** `raw` as contentTarget has it, a library route asked once more of its JSON call. */
async function target(raw, base, json) {
  const found = contentTarget(raw, base);
  if (!found) throw refused();
  if (!found.again) return found;
  const call = URL_CALLS[found.again.part];
  const { status, body } = await json(`/files/library/files/${found.again.id}/${call}`);
  if (status !== 200) throw unavailable(status, body);
  const next = contentTarget(body?.[call], base);
  if (!next || next.again) throw refused();
  return next;
}

/**
 * Where a library file's bytes are (`kind`: content, html, download or thumbnail), found as the
 * desktop app finds them. A thumbnail is asked of the file (`thumbnail`, then `thumbnail_url`).
 * Anything else goes by the node's own id when it is encrypted (fde), else by its file id (a
 * version's, for an old version), as i0: a library file id through its content_url / download_url
 * call, a file service id through /files/download, which a preview polls while the file is still
 * processing (Eaa: ten tries in 15 s, 500 ms growing 1.6× to 4 s). Without a file id the node's
 * own id is used (a note's current text). `json(path)` makes one GET ({status, body}). Resolves to
 * `{url, signed}` (contentTarget).
 */
export async function resolveContent({ id, fileId, kind, json, base, sleep = delay, now = Date.now }) {
  const file = typeof fileId === "string" ? fileId.replaceAll("#", "*") : undefined;
  if ((id != null && !ITEM.test(id)) || (file != null && !ITEM.test(file))) throw refused();
  if (kind === "thumbnail") {
    if (!LIBFILE.test(id ?? "")) throw refused();
    for (const call of ["thumbnail", "thumbnail_url"]) {
      const { status, body } = await json(`/files/library/files/${id}/${call}`);
      if (status === 200 && typeof body?.thumbnail_url === "string" && body.thumbnail_url.trim()) return target(body.thumbnail_url, base, json);
    }
    throw failure("thumbnail_unavailable", "没有缩略图", 404);
  }
  const inline = kind !== "download";
  const chosen = id != null && FDE.test(id) ? id : file ?? id;
  if (chosen == null) throw refused();
  if (LIBFILE.test(chosen)) {
    const call = inline ? "content_url" : "download_url";
    const { status, body } = await json(`/files/library/files/${chosen}/${call}`);
    if (status !== 200) throw unavailable(status, body);
    return target(body?.[call], base, json);
  }
  const deadline = now() + 15_000;
  let answer;
  for (let attempt = 0, wait = 500; ; attempt++) {
    answer = await json(`/files/download/${chosen}?inline=${inline}`);
    if (answer.status !== 200) throw unavailable(answer.status, answer.body);
    const left = deadline - now();
    if (!inline || answer.body?.status !== "retry" || attempt === 9 || left <= 0) break;
    await sleep(Math.min(wait, left));
    wait = Math.min(Math.ceil(wait * 1.6), 4000);
  }
  const { body } = answer;
  if (body?.status === "retry") throw failure("file_processing", "此文件仍在处理中，请稍后重试", 503);
  if (body?.status === "error") throw unavailable(404, body);
  if (body?.metadata?.library_file_state?.status === "trashed") throw failure("file_trashed", "此文件在回收站中", 410);
  return target(body?.download_url, base, json);
}

// ---------------------------------------------------------------------------
// Uploads

const NO_RETRY = new Set(["ace_pod_expired", "file_corrupted", "file_empty", "file_encrypted", "file_expired", "file_not_found",
  "file_rejected", "file_too_large", "file_zero_bytes", "library_storage_limit_exceeded", "over_user_quota", "permission_error",
  "too_many_tokens", "unhandled_mime_type"]);
const RETRY_CODES = new Set(["failed_upload_to_blobstore", "request_transport_error", "throttled"]);
const FAILED = new Set(["error", "cancelled", "failed", "unknown"]);
// Codex leaves the processing stream unbounded; the bridge gives it this long.
const PROCESS_TIMEOUT = 10 * 60_000;

/** NDJSON from a response body, as Codex reads it (Oot): a JSON value a line, blank lines skipped, the last without its newline. */
export async function* ndjson(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      for (let end; (end = buffer.indexOf("\n")) >= 0; buffer = buffer.slice(end + 1)) {
        const line = buffer.slice(0, end).replace(/\r$/, "");
        if (line.trim()) yield JSON.parse(line);
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) yield JSON.parse(buffer);
  } finally {
    reader.cancel().catch(() => {});
  }
}

/**
 * An upload's processing stream judged as Codex judges it (uBr, dBr, fBr). An event whose name
 * ends in error, cancelled, failed or unknown fails it, but for an indexing error on this very file
 * after its file_ready, with the raw file kept as a fallback, on a 2xx answer: that ends it, done.
 * Otherwise the end of the stream is done, with an event or not (`libraryFileId` may stay null).
 */
export async function readProcessing(events, { fileId, status, progress = () => {} }) {
  const result = { libraryFileId: null };
  let ready, persistence;
  for await (const data of events) {
    const name = typeof data?.event === "string" ? data.event : null;
    const extra = data?.extra && typeof data.extra === "object" ? data.extra : {};
    const id = typeof data?.file_id === "string" ? data.file_id : undefined;
    if (typeof data?.progress === "number") progress(data.progress);
    if (name === "file.processing.file_ready") ready = id;
    const fallback = name === "file.indexing.error" && id === fileId && ready === fileId
      && extra.raw_file_fallback_available === true && status >= 200 && status < 300;
    if (name && FAILED.has(name.split(".").at(-1)) && !fallback) {
      throw failure([extra.error_code, extra.file_parse_error_code].find((code) => typeof code === "string") ?? "processing_failed", `Error processing upload: ${name}`);
    }
    if (typeof extra.metadata_object_id === "string") result.libraryFileId = extra.metadata_object_id;
    if (typeof extra.library_persistence_result === "string") persistence = extra.library_persistence_result;
    if (fallback) {
      // Kept only for now: not a library file.
      if (persistence === "temporary") result.libraryFileId = null;
      return result;
    }
  }
  return result;
}

/** Once `stream` has let go of its file: on Windows a file still opening or open comes back, or keeps its folder. */
const released = (stream) => (!stream || stream.closed ? Promise.resolve() : new Promise((resolve) => stream.once("close", resolve)));

/** A Retry-After's moment, if the answer gave one. */
function retryAt(headers, now) {
  const value = headers?.get?.("retry-after");
  if (!value) return null;
  const at = /^\d+$/.test(value) ? now() + Number(value) * 1000 : Date.parse(value);
  return Number.isFinite(at) ? at : null;
}

/** A pipeline step that counts what passes (`counted.bytes`) and fails with `error()` past `max`. */
function counter(max, error) {
  const counted = { bytes: 0 };
  counted.step = async function* (chunks) {
    for await (const chunk of chunks) {
      if ((counted.bytes += chunk.length) > max) throw error();
      yield chunk;
    }
  };
  return counted;
}

// Two PUTs at a time from the bridge, whichever page they are for (Codex lets five through, Lzr).
// A cancelled upload leaves the queue at once, so its spool goes too.
let putting = 0;
const waiting = [];
async function slot(signal) {
  while (putting >= 2) {
    signal?.throwIfAborted();
    await new Promise((resolve, reject) => {
      const stop = () => { waiting.splice(waiting.indexOf(wake), 1); reject(signal.reason); };
      const wake = () => { signal?.removeEventListener("abort", stop); resolve(); };
      waiting.push(wake);
      signal?.addEventListener("abort", stop, { once: true });
    });
  }
  putting++;
}
function freeSlot() {
  putting--;
  waiting.shift()?.();
}

/**
 * ke's `m`: trying again may pass. Not once processing began, nor for a code that never passes;
 * only on a network error or a status that may (none, 408, 429, 5xx), so a 4xx without a code is final.
 */
function retryable(error, processing) {
  const status = error.library ? error.status : null;
  return !processing && !NO_RETRY.has(error.library ? (error.code ?? "") : "") && (status == null || status === 408 || status === 429 || status >= 500);
}

/** The bridge's own refusals: no 重试 passes them either. */
const REFUSED = new Set(["unsupported_upload_url", "CLOUD_REFUSED", "CHATGPT_REQUIRED"]);

/**
 * An upload's last line: what failed, as the library page words it (`ke`), and whether it offers
 * 重试. A 413 without a code of its own is file_too_large (wN); under 500, ChatGPT's own words
 * (`said`, TN's) come before 无法上传.
 */
function failed(error, uncertain) {
  const code = error.library ? error.code ?? (error.status === 413 ? "file_too_large" : null)
    : error.code === "CLOUD_REFUSED" || error.code === "CHATGPT_REQUIRED" ? error.code : null;
  const message = code === "library_storage_limit_exceeded" || code === "over_user_quota" ? "你的存储空间已满。请移除文件以腾出空间，然后重试"
    : code === "file_too_large" ? "此文件过大，无法上传。请尝试上传较小的文件"
      : uncertain ? "上传可能已完成。重试前请先查看资料库"
        : code === "unsupported_upload_url" || code === "CHATGPT_REQUIRED" ? error.message
          : ((error.status == null || error.status < 500) && error.said) || "无法上传";
  return { error: message, code, retryable: retryable(error, uncertain) && !REFUSED.has(code ?? ""), ...(uncertain ? { uncertain: true } : {}) };
}

/**
 * An upload into the library, all three steps here so the upload URL, its headers and the token
 * never reach the page. The body is spooled to a temporary file first (at most `max` bytes, gone
 * at the end); POST /files names it as the library page's upload does (Zzr), asking for one plain
 * PUT (no Azure multipart, as the desktop app's Pages upload asks); the bytes go to the file host
 * without the login, two PUTs at a time; the processing stream says when it is in. Tried as `ke`
 * tries: three times, on network errors, 408, 429, 5xx and the blob store's passing codes, after
 * 250 ms × 2ⁿ or the server's Retry-After within 30 s; a failure once processing began is
 * `uncertain` (the file may be in) and not tried again. `emit` hears `{stage}`; resolves to
 * `{done, libraryFileId}` or `{error, code, retryable, uncertain?}`.
 */
export async function upload({ body, name, type, directoryId, json, put, stream, emit = () => {}, signal, max = MAX_UPLOAD_BYTES, dir = tmpdir(), sleep = delay, now = Date.now }) {
  const file = path.join(dir, `codex-ui-upload-${randomUUID()}`);
  let processing = false, spool;
  try {
    const spooled = counter(max, () => failure("file_too_large", "too large"));
    spool = createWriteStream(file, { flags: "wx", mode: 0o600 });
    await pipeline(body, spooled.step, spool, ...(signal ? [{ signal }] : []));
    if (!spooled.bytes) throw failure("file_empty", "empty");
    for (let attempt = 0; ; attempt++) {
      try {
        emit({ stage: "uploading" });
        const created = await json("POST", "/files", {
          entry_surface: "codex_library_upload",
          directory_id: directoryId ?? null,
          file_name: name,
          file_size: spooled.bytes,
          // The type the page declares: codex-ui has no extension table of its own (PRr / mime lookup).
          client_resolved_mime_type: type || undefined,
          mime_resolution_source: type ? "declared_mime" : "none",
          ...(type ? { mime_type: type } : {}),
          reset_rate_limits: false,
          supports_direct_azure_multipart: false,
          timezone_offset_min: new Date().getTimezoneOffset(),
          upload_source: "codex_library_upload",
          use_case: "my_files",
          store_in_library: true,
          library_persistence_mode: "required",
        });
        const { file_id: fileId, upload_url: uploadUrl, upload_headers: uploadHeaders } = created.body ?? {};
        if (created.status < 200 || created.status > 299 || created.body?.status === "error") {
          throw Object.assign(failure(codeOf(created.body), "POST /files failed", created.status >= 300 ? created.status : null), { said: saidIn(created.body) });
        }
        if (typeof fileId !== "string" || typeof uploadUrl !== "string") throw failure(null, "POST /files gave no upload URL");
        // The upload URL is a signed Azure blob on sdmntpr*.oaiusercontent.com (seen 2026-10-29, no upload_headers); anything else is refused.
        const destination = contentTarget(uploadUrl, "https://chatgpt.com/backend-api");
        if (destination?.signed !== false) throw failure("unsupported_upload_url", "不支持的上传地址");
        // As iBr puts to Azure, the server's headers over these (any case).
        const headers = { "Content-Type": type || "application/octet-stream", "x-ms-blob-type": "BlockBlob", "x-ms-version": "2020-04-08", ...(type ? { "x-ms-blob-content-type": type } : {}) };
        for (const [key, value] of Object.entries(uploadHeaders ?? {})) {
          if (typeof value === "string") headers[Object.keys(headers).find((header) => header.toLowerCase() === key.toLowerCase()) ?? key] = value;
        }
        await slot(signal);
        let sent;
        try { sent = await put(destination.url, { method: "PUT", headers, body: await openAsBlob(file, { type }), redirect: "error", signal }); }
        finally { freeSlot(); }
        await sent.body?.cancel();
        if (!sent.ok) throw Object.assign(failure(null, `PUT failed (${sent.status})`, sent.status), { retryAt: retryAt(sent.headers, now) });
        processing = true;
        emit({ stage: "processing" });
        const answer = await stream("/files/process_upload_stream", {
          entry_surface: "codex_library_upload",
          file_id: fileId,
          file_name: name,
          index_for_retrieval: true,
          library_persistence_mode: "required",
          metadata: { store_in_library: true },
          mime_type: type || null,
          ...(directoryId ? { directory_id: directoryId } : {}),
          upload_source: "codex_library_upload",
          use_case: "my_files",
        }, AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(PROCESS_TIMEOUT)]));
        if (!answer.ok || !answer.body) {
          await answer.body?.cancel();
          throw failure(null, `Processing failed (${answer.status})`, answer.status);
        }
        const { libraryFileId } = await readProcessing(ndjson(answer.body), { fileId, status: answer.status, progress: (progress) => emit({ stage: "processing", progress }) });
        return { done: true, libraryFileId };
      } catch (error) {
        if (signal?.aborted) throw error;
        const network = !error.library && !error.code;
        const status = error.library ? error.status : null;
        const code = error.library ? error.code : null;
        const later = (error.retryAt ?? 0) - now();
        if (retryable(error, processing) && (network || RETRY_CODES.has(code ?? "") || status === 408 || status === 429 || status >= 500) && attempt < 2 && later <= 30_000) {
          await sleep(Math.max(250 * 2 ** attempt, later), undefined, { signal });
          continue;
        }
        throw error;
      }
    }
  } catch (error) {
    return signal?.aborted ? { error: "上传已取消", code: "cancelled" } : failed(error, processing);
  } finally {
    await released(spool);
    await rm(file, { force: true });
  }
}

// ---------------------------------------------------------------------------
// A file for a chat

const RESERVED = /^(?:con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³]|conin\$|conout\$)$/iu;

/**
 * A file name the model's tools can open on Windows too: Codex's K8t (the base name, `\ / :` as
 * `_`, `.` and `..` as attachment), then no control characters, `<>:"/\|?*` as `_`, no trailing
 * dots or spaces, a device name (CON, COM1, …) prefixed with `_`, and at most 200 UTF-16 units,
 * the extension kept.
 */
export function attachmentName(raw) {
  let name = String(raw ?? "").trim().split(/[\\/]/).pop().replace(/[\\/:]/g, "_");
  name = name.replace(/\p{Cc}/gu, "").replace(/[<>:"/\\|?*]/g, "_").replace(/[. ]+$/, "");
  if (RESERVED.test(name.split(".")[0].trimEnd())) name = `_${name}`;
  if (name.length > 200) {
    const dot = name.lastIndexOf(".");
    const extension = dot > 0 && name.length - dot <= 32 ? name.slice(dot) : "";
    let end = 200 - extension.length;
    // Never half a surrogate pair.
    if (/[\udc00-\udfff]/.test(name[end] ?? "")) end--;
    name = name.slice(0, end).replace(/[. ]+$/, "") + extension;
  }
  return !name || name === "." || name === ".." ? "attachment" : name;
}

/** The name as a chat message shows it: one line, no control characters to break the message's blocks. */
export const attachmentLabel = (raw) => String(raw ?? "").replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, "").trim() || "attachment";

/**
 * A library file saved where a chat can read it, `<home>/attachments/<uuid>/<name>`, as Codex
 * saves its attachments (t5t), for a known size of at most 45 MiB. The bytes are counted as they
 * come; a failure, an early end or a length other than the one announced removes the folder.
 * On Windows the copy carries the internet's mark (Zone.Identifier, ZoneId 3), as a browser's
 * download does: the file may be anyone's (a share), so Office opens it in Protected View, with
 * macros blocked, and SmartScreen asks before it runs (where the volume keeps such streams).
 * `open()` resolves to the file's response. Resolves to `{path, label}`.
 */
export async function attach({ open, name, size, home, signal }) {
  const tooLarge = () => failure("local_file_too_large", "此文件太大，无法作为附件添加到本地聊天", 413);
  if (!Number.isSafeInteger(size) || size < 0 || size > MAX_ATTACH_BYTES) throw tooLarge();
  const dir = path.join(home, "attachments", randomUUID());
  await mkdir(dir, { recursive: true });
  let sink;
  try {
    const response = await open();
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw failure("file_unavailable", "无法下载此文件", response.status >= 400 ? response.status : 502);
    }
    // A coded body's length is not the bytes fetch hands over.
    const header = response.headers.get("content-encoding") ? null : response.headers.get("content-length");
    const length = header === null ? null : Number(header);
    if (length > MAX_ATTACH_BYTES) {
      await response.body.cancel();
      throw tooLarge();
    }
    const file = path.join(dir, attachmentName(name));
    const received = counter(MAX_ATTACH_BYTES, tooLarge);
    sink = createWriteStream(file, { flags: "wx" });
    await pipeline(Readable.fromWeb(response.body), received.step, sink, ...(signal ? [{ signal }] : []));
    if (length !== null && received.bytes !== length) throw failure("incomplete", "下载不完整", 502);
    if (process.platform === "win32") await writeFile(`${file}:Zone.Identifier`, "[ZoneTransfer]\r\nZoneId=3\r\nHostUrl=https://chatgpt.com/\r\n").catch(() => {});
    return { path: file, label: attachmentLabel(name) };
  } catch (error) {
    await released(sink);
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
}
