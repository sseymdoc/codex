// HTTP/SSE adapter for the in-process orchestrator; runtime state belongs to the service.
import { createHmac, randomBytes } from "node:crypto";
import { createReadStream, readFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { createAutomations } from "./automations.mjs";
import { ccSwitchQuota } from "./ccswitch.mjs";
import { cloudService } from "./cloud.mjs";
import { handleFiles } from "./files.mjs";
import { ITEM, MAX_PREVIEW_BYTES, MAX_UPLOAD_BYTES } from "./library.mjs";
import { createOrbitFiles } from "./orbit.mjs";
import { ROLLOUT_FILE, readContextUsage } from "./context-usage.mjs";
import { LOOPBACK_HOST, sameSecret } from "./orchestrator.mjs";

const MAX_BODY_BYTES = 64 * 1024 * 1024;
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const MAX_DOT_FILE_BYTES = 20 * 1024 * 1024;
const INLINE_IMAGES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const LIBRARY_CONTENT = "/api/library/content/";
// `note`: a note's old version, read as a preview by that version's file id (library.mjs resolveContent).
const LIBRARY_KINDS = new Set(["content", "download", "thumbnail", "html", "note"]);
// A library SVG keeps its type too (an <img> decodes no other): sandboxed and nosniff, even opened on its own it runs nothing.
const LIBRARY_INLINE = new Set([...INLINE_IMAGES, "image/svg+xml", "application/pdf"]);
// A library HTML preview draws itself and nothing from elsewhere: no scripts, outside images (a beacon), forms or base.
const HTML_CSP = "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'";
/** A file name's first 255 characters, never half a surrogate pair (encodeURIComponent throws on one). */
const clipName = (name) => Array.from(name).slice(0, 255).join("");

export function parseArgs(argv, env = process.env) {
  const options = {
    codex: env.CODEX_BIN || undefined,
    codexArgs: [],
    token: env.CODEX_UI_TOKEN || undefined,
    cwd: env.INIT_CWD || process.cwd(),
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      const next = argv[++i];
      if (next === undefined) throw new Error(`${arg} needs a value`);
      return next;
    };
    if (arg === "--codex") options.codex = value();
    else if (arg === "-c" || arg === "--config") options.codexArgs.push("-c", value());
    else if (arg === "--cwd") options.cwd = path.resolve(value());
    else if (arg === "--port") options.port = Number(value());
    else if (arg === "--no-open") options.open = false;
    else if (arg === "-h" || arg === "--help") options.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

export function createBridge(orchestrator, { token, orbit = createOrbitFiles(), automations = createAutomations() } = {}) {
  const secret = token || randomBytes(24).toString("hex");
  // Every page's /api/events sink (not a dot's durable host): scheduled task changes go to all of them.
  const pages = new Set();
  // The scheduled task verbs (server/automations.mjs), each a JSON body in and out. Ids stay out of the
  // path: a task id is a slug, and could read `claim`.
  const SCHEDULED = {
    create: (body) => ({ item: automations.create(body.input) }),
    update: (body) => ({ item: automations.update(body.id, body.patch) }),
    delete: (body) => ({ deleted: automations.remove(body.id) }),
    "set-status": (body) => ({ item: automations.update(body.id, { status: body.status ?? null }) }),
    claim: (body) => automations.claim({ held: body.held }),
    "run-now": (body) => ({ claim: automations.runNow(body.id) }),
    report: (body) => automations.report(body.token, body.outcome, body),
    runs: (body) => ({ run: automations.runEvent(body) }),
    "runs/read-all": (body) => ({ count: automations.readAll(body.readAt) }),
    thread: (body) => automations.threadEvent(body.threadId, body.event),
  };
  function handle(req, res, next) {
    const url = new URL(req.url ?? "/", "http://localhost");
    const host = LOOPBACK_HOST.exec(req.headers.host ?? "");
    if (!host) return deny(res, 403, "Codex UI only answers on loopback hosts.");
    // Cookies ignore ports, so scope the name to ours.
    const cookieName = `codex_ui_${host[2] ?? "80"}`;

    if (url.pathname === "/api/browser-mcp" || url.pathname === "/api/desktop-mcp") {
      const desktop = url.pathname === "/api/desktop-mcp";
      const id = url.searchParams.get("c");
      const bearer = /^Bearer (.+)$/i.exec(req.headers.authorization ?? "")?.[1] ?? "";
      if (!fromOwnOrigin(req) || !(desktop ? orchestrator.authorizeDesktop(id, bearer) : orchestrator.authorizeBrowser(id, bearer))) return deny(res, 401, "Host MCP is unauthorized.");
      if (req.method === "DELETE") return desktop && !orchestrator.closeDesktopSession(id, bearer, req.headers["mcp-session-id"]) ? deny(res, 404, "MCP session expired.") : void res.writeHead(204).end();
      if (req.method !== "POST") return void res.writeHead(405, { Allow: "POST, DELETE" }).end();
      return void handleBrowserMcp(req, res, id, bearer, desktop);
    }

    const presented = url.searchParams.get("token");
    if (presented !== null && req.method === "GET" && !url.pathname.startsWith("/api/")) {
      if (!sameSecret(presented, secret)) return deny(res, 401, "Invalid token.");
      url.searchParams.delete("token");
      res.writeHead(302, {
        "Set-Cookie": `${cookieName}=${secret}; HttpOnly; SameSite=Strict; Path=/`,
        Location: url.pathname + url.search,
        "Cache-Control": "no-store",
      });
      return res.end();
    }

    if (!url.pathname.startsWith("/api/")) return next ? next() : deny(res, 404, "Not found.");
    if (!fromOwnOrigin(req)) return deny(res, 403, "Cross-origin requests are not allowed.");
    if (!sameSecret(readCookie(req.headers.cookie, cookieName) ?? "", secret)) {
      return deny(res, 401, "Open the tokenized URL printed by the server.");
    }
    if (orchestrator.closed) return deny(res, 503, "Codex UI is closing.");
    if (url.pathname === "/api/title") {
      if (req.method !== "POST") return void res.writeHead(405, { Allow: "POST" }).end();
      return void title(req, res);
    }
    if (url.pathname === "/api/automations" || url.pathname.startsWith("/api/automations/")) return void scheduled(req, res, url);
    if (url.pathname === "/api/events" && req.method === "GET") return openEvents(req, res, url.searchParams.get("durable"));
    if (url.pathname === "/api/account/profile" && req.method === "GET") return void answer(res, url.searchParams.get("c"), orchestrator.accountProfile);
    if (url.pathname === "/api/dots/available" && req.method === "GET") return void answer(res, url.searchParams.get("c"), orchestrator.dotsAvailable);
    if (url.pathname === "/api/cloud" && req.method === "POST") return void cloud(req, res, url.searchParams.get("c"));
    if (url.pathname === "/api/dots/events" && req.method === "GET") return dotsEvents(req, res, url.searchParams.get("c"));
    // The local computer a dot can work on (desktop only): its state, and on / off.
    if (url.pathname === "/api/executor" && req.method === "GET") return void answer(res, url.searchParams.get("c"), orchestrator.executorState);
    if (url.pathname === "/api/executor" && req.method === "POST") {
      const on = url.searchParams.get("enabled");
      if (on !== "1" && on !== "0") return deny(res, 400, "Say enabled=1 or enabled=0.");
      return void answer(res, url.searchParams.get("c"), (id) => orchestrator.setExecutor(id, on === "1"));
    }
    if (url.pathname === "/api/cloud/stream" && req.method === "GET") return void cloudStream(res, url.searchParams);
    if (url.pathname === "/api/dots/upload" && req.method === "POST") return void dotsUpload(req, res, url.searchParams);
    if (url.pathname === "/api/dots/content" && req.method === "GET") return void dotsContent(res, url.searchParams);
    // The library (server/library.mjs): whether this login has it, a file's bytes, an upload, a file saved for a chat.
    if (url.pathname === "/api/library/available" && req.method === "GET") return void answer(res, url.searchParams.get("c"), orchestrator.libraryAvailable);
    if (url.pathname.startsWith(LIBRARY_CONTENT) && (req.method === "GET" || req.method === "HEAD")) return void libraryContent(req, res, url).catch(() => res.destroy());
    if (url.pathname === "/api/library/upload" && req.method === "POST") return void libraryUpload(req, res, url.searchParams);
    if (url.pathname === "/api/library/attach" && req.method === "POST") return void libraryAttach(req, res, url.searchParams.get("c"));
    if (url.pathname === "/api/library/attach" && req.method === "DELETE") return void libraryDetach(res, url.searchParams);
    // The dot character runtime, read from the installed Codex app (server/orbit.mjs).
    if (url.pathname === "/api/dots/orbit" && req.method === "GET") {
      return void orbit.info().then((body) => res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }).end(JSON.stringify(body)));
    }
    if (url.pathname.startsWith("/api/dots/orbit/files/") && req.method === "GET") {
      return void orbit.serve(res, url.pathname.slice("/api/dots/orbit/files/".length)).then((served) => served || deny(res, 404, "Not found."), () => deny(res, 500, "Unreadable."));
    }
    if (url.pathname === "/api/send" && req.method === "POST") return forward(req, res, url.searchParams.get("c"));
    if (url.pathname === "/api/desktop-result" && req.method === "POST") return void desktopResult(req, res, url.searchParams.get("c"));
    if (url.pathname === "/api/transcribe" && req.method === "POST") return void transcribe(req, res, url.searchParams.get("c"));
    if ((url.pathname === "/api/opencodex/quotas" || url.pathname === "/api/ccswitch/quota") && req.method === "GET") {
      return void (url.pathname === "/api/ccswitch/quota" ? ccSwitchQuota() : opencodexQuotas()).then((body) =>
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }).end(JSON.stringify(body)),
      );
    }
    if (url.pathname.startsWith("/api/files/")) return handleFiles(req, res, url) === false ? deny(res, 404, "Not found.") : undefined;
    if (url.pathname === "/api/context-usage" && req.method === "GET") {
      // The thread's rollout (Thread.path), and only a rollout: this reads no other file.
      const file = url.searchParams.get("path") ?? "";
      if (!path.isAbsolute(file) || !ROLLOUT_FILE.test(path.basename(file))) return deny(res, 400, "Not a Codex rollout.");
      return void readContextUsage(file).then(
        (body) => res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }).end(JSON.stringify(body)),
        () => deny(res, 404, "Rollout not found."),
      );
    }
    // /api/pdf/<name>?path=…: the viewer titles the document with the URL's last segment.
    if (url.pathname.startsWith("/api/pdf/") && (req.method === "GET" || req.method === "HEAD")) return void sendPdf(req, res, url.searchParams.get("path") ?? "");
    return deny(res, 404, "Not found.");
  }

  async function title(req, res) {
    if (!(req.headers["content-type"] ?? "").startsWith("application/json")) return deny(res, 415, "Not JSON.");
    let body;
    try { body = JSON.parse((await readBody(req, 32 * 1024)).toString("utf8")); }
    catch { return deny(res, 400, "Invalid title request."); }
    if (!body || typeof body.description !== "string" || !body.description.trim() || body.description.length > 4000
      || (body.model !== undefined && (typeof body.model !== "string" || !body.model.trim() || body.model.length > 200))) return deny(res, 400, "Invalid title request.");
    const abort = new AbortController();
    res.on("close", () => { if (!res.writableEnded) abort.abort(); });
    try {
      const title = await orchestrator.title(body.description, body.model, abort.signal);
      if (!res.destroyed) res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }).end(JSON.stringify({ title }));
    } catch (error) {
      if (!res.destroyed) deny(res, error.code === "UNAVAILABLE" ? 503 : 502, error.code === "UNAVAILABLE" ? error.message : "Title generation failed.");
    }
  }

  /** The page's app-server connection, or (`durable`: the page's own connection id) a dot's durable host. */
  function openEvents(req, res, durable) {
    if (durable !== null && !orchestrator.hasConnection(durable)) return deny(res, 410, "Connection closed.");
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    const write = (chunk) => {
      if (!res.writableEnded) res.write(chunk);
    };
    const emit = (event, data) => write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    const finish = () => {
      if (!res.writableEnded) res.end();
    };

    const sink = { event: emit, message: (line) => write(`data: ${line}\n\n`), end: finish };
    const id = durable === null ? orchestrator.connect(req.headers.host, sink) : orchestrator.connectDurable(durable, sink);
    if (!id) return;
    if (durable === null) pages.add(sink);
    const ping = setInterval(() => write(": ping\n\n"), 15_000);
    res.on("close", () => {
      clearInterval(ping);
      pages.delete(sink);
      orchestrator.disconnect(id);
    });
  }

  /**
   * Scheduled tasks for a page's own connection: GET the list, POST a verb. A change goes to every page
   * here as codexUi/automations/changed; pages of the other bridge process (desktop and browser mode share
   * the folder) find the stamp moved at their next claim.
   */
  async function scheduled(req, res, url) {
    const id = url.searchParams.get("c");
    // hasConnection admits a dot's durable host too, which is no page.
    if (String(id).startsWith("durable:") || !orchestrator.hasConnection(id)) return deny(res, 410, "Connection closed.");
    const verb = url.pathname.slice("/api/automations/".length);
    let run = () => automations.list();
    if (url.pathname !== "/api/automations") {
      if (!Object.hasOwn(SCHEDULED, verb)) return deny(res, 404, "Not found.");
      if (req.method !== "POST") return void res.writeHead(405, { Allow: "POST" }).end();
      if (!(req.headers["content-type"] ?? "").startsWith("application/json")) return deny(res, 415, "Not JSON.");
      let body;
      try { body = JSON.parse((await readBody(req, 512 * 1024)).toString("utf8")); }
      catch { return deny(res, 400, "Invalid scheduled task request."); }
      if (!body || typeof body !== "object" || Array.isArray(body)) return deny(res, 400, "Invalid scheduled task request.");
      run = () => SCHEDULED[verb](body);
    } else if (req.method !== "GET") return void res.writeHead(405, { Allow: "GET" }).end();
    const before = automations.stamp();
    try {
      const result = JSON.stringify(run());
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }).end(result);
    } catch (error) { deny(res, error.code === "INVALID" ? 400 : error.code === "NOT_FOUND" ? 404 : 500, error.message); }
    // Only a change moves the stamp: a claim that took nothing, or an event for no run, tells nobody. A verb
    // that failed partway after a change still tells.
    const stamp = automations.stamp();
    if (stamp === before) return;
    const line = JSON.stringify({ method: "codexUi/automations/changed", params: { stamp } });
    for (const page of pages) page.message(line);
  }

  function forward(req, res, id) {
    if (!orchestrator.hasConnection(id)) return deny(res, 410, "Connection closed.");
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size <= MAX_BODY_BYTES) return void chunks.push(chunk);
      deny(res, 413, "Message too large.");
      req.destroy();
    });
    req.on("end", () => {
      if (res.writableEnded) return;
      const messages = [];
      for (const line of Buffer.concat(chunks).toString("utf8").split("\n")) {
        if (!line.trim()) continue;
        try {
          messages.push(JSON.parse(line));
        } catch {
          return deny(res, 400, "Body must be newline-delimited JSON.");
        }
      }
      try { orchestrator.send(id, messages); }
      catch (error) { return serviceError(res, error); }
      res.writeHead(204).end();
    });
  }

  /** A read for this connection's page (`run(id, signal)`), answered as JSON. */
  async function answer(res, id, run) {
    if (!orchestrator.hasConnection(id)) return deny(res, 410, "Connection closed.");
    const abort = new AbortController();
    res.on("close", () => abort.abort());
    try {
      const result = await run(id, abort.signal);
      if (!res.destroyed) res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }).end(JSON.stringify(result));
    } catch (error) { if (!res.destroyed) serviceError(res, error); }
  }

  /** Codex Cloud: `{method, path, body}` in, `{status, body}` out; the token stays in the service. */
  async function cloud(req, res, id) {
    if (!orchestrator.hasConnection(id)) return deny(res, 410, "Connection closed.");
    if (!(req.headers["content-type"] ?? "").startsWith("application/json")) return deny(res, 415, "Not JSON.");
    let request;
    try { request = JSON.parse((await readBody(req, 1024 * 1024)).toString("utf8")); }
    catch { return deny(res, 400, "Invalid Codex Cloud request."); }
    const abort = new AbortController();
    res.on("close", () => abort.abort());
    try {
      const result = await orchestrator.cloud(id, request ?? {}, abort.signal);
      if (!res.destroyed) res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }).end(JSON.stringify(result));
    } catch (error) {
      if (res.destroyed) return;
      if (error.code === "CLOUD_REFUSED") return deny(res, 403, error.message);
      if (error.code === "CHATGPT_REQUIRED") return deny(res, 401, error.message);
      deny(res, 502, `无法连接 ${cloudService(request?.path)}（${error.message}）`);
    }
  }

  /** Dots' messaging events for this page, as SSE (`dots` events, `live` on and off). */
  function dotsEvents(req, res, id) {
    if (!orchestrator.hasConnection(id)) return deny(res, 410, "Connection closed.");
    res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    const abort = new AbortController();
    const write = (chunk) => { if (!res.writableEnded) res.write(chunk); };
    try { orchestrator.dotsEvents(id, (event, data) => write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`), abort.signal); }
    catch { return void res.end(); }
    const ping = setInterval(() => write(": ping\n\n"), 15_000);
    res.on("close", () => {
      clearInterval(ping);
      abort.abort();
    });
  }

  /** A ChatGPT event stream the page may follow (a dot's activity), passed on as it comes. */
  async function cloudStream(res, params) {
    const id = params.get("c");
    if (!orchestrator.hasConnection(id)) return deny(res, 410, "Connection closed.");
    const abort = new AbortController();
    res.on("close", () => abort.abort());
    let upstream;
    try { upstream = await orchestrator.cloudStream(id, params.get("path") ?? "", abort.signal); }
    catch (error) { return res.destroyed ? undefined : deny(res, error.code === "CLOUD_REFUSED" ? 403 : error.code === "CHATGPT_REQUIRED" ? 401 : 502, error.message); }
    if (!upstream.ok || !upstream.body || !(upstream.headers.get("content-type") ?? "").includes("text/event-stream")) {
      await upstream.body?.cancel();
      return deny(res, upstream.status >= 400 ? upstream.status : 502, "Not a stream.");
    }
    res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    Readable.fromWeb(upstream.body).on("error", () => res.destroy()).pipe(res);
  }

  /** A file for a dot room: the raw bytes in, `{status, body}` out (as /api/cloud answers). */
  async function dotsUpload(req, res, params) {
    const id = params.get("c");
    if (!orchestrator.hasConnection(id)) return deny(res, 410, "Connection closed.");
    const path = params.get("path") ?? "";
    const name = clipName(params.get("name") ?? "") || "file";
    const type = /^[\w.+-]+\/[\w.+-]+$/.test(params.get("type") ?? "") ? params.get("type") : "application/octet-stream";
    // A declared size over the cap is turned away before reading (the rest of it is discarded).
    if (Number(req.headers["content-length"]) > MAX_DOT_FILE_BYTES) return deny(res, 413, "附件大小不得超过 20 MB");
    const bytes = await readBody(req, MAX_DOT_FILE_BYTES).catch(() => null);
    if (!bytes) return deny(res, 413, "附件大小不得超过 20 MB");
    // A character snapshot is a PNG of at most 4 MB, with its manifest beside it.
    const snapshot = path === "/cloud-aeons/avatar-snapshots";
    if (snapshot && (type !== "image/png" || bytes.length > 4 * 1024 * 1024 || !bytes.subarray(0, 8).equals(PNG))) return deny(res, 415, "Not a character snapshot.");
    let fields = {};
    try { fields = JSON.parse(params.get("fields") || "{}"); } catch { return deny(res, 400, "Invalid fields."); }
    if (!fields || typeof fields !== "object" || Array.isArray(fields) || Object.values(fields).some((value) => typeof value !== "string" || value.length > 64 * 1024)) return deny(res, 400, "Invalid fields.");
    const abort = new AbortController();
    res.on("close", () => { if (!res.writableEnded) abort.abort(); });
    try {
      const result = await orchestrator.dotsUpload(id, { path, name, type, bytes, fields }, abort.signal);
      if (!res.destroyed) res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }).end(JSON.stringify(result));
    } catch (error) {
      if (res.destroyed) return;
      if (error.code === "CLOUD_REFUSED") return deny(res, 403, error.message);
      if (error.code === "CHATGPT_REQUIRED") return deny(res, 401, error.message);
      deny(res, 502, `无法上传（${error.message}）`);
    }
  }

  /**
   * A dot room's file or avatar, streamed. Upstream bytes never run here: only raster images show
   * inline, everything else downloads, and the answer is sandboxed either way.
   */
  async function dotsContent(res, params) {
    const id = params.get("c");
    if (!orchestrator.hasConnection(id)) return deny(res, 410, "Connection closed.");
    let upstream;
    try { upstream = await orchestrator.dotsContent(id, params.get("url") ?? ""); }
    catch (error) { return deny(res, error.code === "CLOUD_REFUSED" ? 403 : 502, error.message); }
    if (!upstream.ok || !upstream.body) {
      await upstream.body?.cancel();
      return deny(res, upstream.status >= 400 ? upstream.status : 502, "File unavailable.");
    }
    const type = (upstream.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    const image = INLINE_IMAGES.has(type);
    const name = clipName(params.get("name") ?? "") || "attachment";
    res.writeHead(200, {
      "Content-Type": image ? type : "application/octet-stream",
      ...(upstream.headers.get("content-length") ? { "Content-Length": upstream.headers.get("content-length") } : {}),
      "Content-Disposition": `${image ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Content-Security-Policy": "sandbox; default-src 'none'",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=3600",
    });
    Readable.fromWeb(upstream.body).on("error", () => res.destroy()).pipe(res);
  }

  /**
   * A library file's bytes, streamed: /api/library/content/<name>?c&id&fileId&kind (the PDF viewer
   * titles the document with the last segment). Upstream bytes never run here: images (SVG too) and
   * PDFs keep their type, an HTML preview is sandboxed HTML that loads nothing, the rest
   * downloads. Previews stop at 40 MiB; nothing but a thumbnail is cached, so a saved note or a
   * restored version reads anew. One byte range passes through (206 and its Content-Range).
   */
  async function libraryContent(req, res, url) {
    const params = url.searchParams;
    const id = params.get("c");
    if (!orchestrator.hasConnection(id)) return deny(res, 410, "Connection closed.");
    const kind = params.get("kind") ?? "content";
    if (!LIBRARY_KINDS.has(kind)) return deny(res, 400, "Unknown kind.");
    let name;
    try { name = clipName(decodeURIComponent(url.pathname.slice(LIBRARY_CONTENT.length))) || "file"; }
    catch { return deny(res, 400, "Invalid name."); }
    const range = req.headers.range;
    if (range !== undefined && !/^bytes=(?:\d+-\d*|-\d+)$/.test(range)) return deny(res, 416, "One byte range only.");
    const abort = new AbortController();
    res.on("close", () => { if (!res.writableEnded) abort.abort(); });
    let upstream;
    try { upstream = await orchestrator.libraryContent(id, { id: params.get("id"), fileId: params.get("fileId"), kind, range }, abort.signal); }
    catch (error) { return res.destroyed ? undefined : deny(res, libraryStatus(error), error.message); }
    if (!upstream.ok || !upstream.body) {
      await upstream.body?.cancel();
      return deny(res, upstream.status >= 400 ? upstream.status : 502, "File unavailable.");
    }
    // fetch hands over a coded body decoded, so its length then says nothing.
    const length = upstream.headers.get("content-encoding") ? null : upstream.headers.get("content-length");
    const capped = kind !== "download" && kind !== "thumbnail";
    if (capped && Number(length) > MAX_PREVIEW_BYTES) {
      await upstream.body.cancel();
      return deny(res, 413, "文件过大，无法预览");
    }
    const declared = (upstream.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    const type = kind === "html" ? "text/html; charset=utf-8" : LIBRARY_INLINE.has(declared) ? declared : "application/octet-stream";
    const partial = upstream.status === 206 ? upstream.headers.get("content-range") : null;
    res.writeHead(partial ? 206 : 200, {
      "Content-Type": type,
      ...(length ? { "Content-Length": length } : {}),
      ...(partial ? { "Content-Range": partial } : {}),
      ...(partial || upstream.headers.get("accept-ranges") === "bytes" ? { "Accept-Ranges": "bytes" } : {}),
      "Content-Disposition": `${kind !== "download" && type !== "application/octet-stream" ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(name)}`,
      ...(type === "application/pdf" ? {} : { "Content-Security-Policy": kind === "html" ? HTML_CSP : "sandbox; default-src 'none'" }),
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Cache-Control": kind === "thumbnail" ? "private, max-age=3600" : "no-store",
    });
    if (req.method === "HEAD") {
      await upstream.body.cancel();
      return void res.end();
    }
    const body = Readable.fromWeb(upstream.body).on("error", () => res.destroy());
    let sent = 0;
    if (capped) body.on("data", (chunk) => { if ((sent += chunk.length) > MAX_PREVIEW_BYTES) { body.destroy(); res.destroy(); } });
    body.pipe(res);
  }

  /**
   * A file for the library: the raw bytes in (?c&name&type&size&directoryId), its stages out as
   * NDJSON (`{stage}` lines, then `{done, libraryFileId}` or `{error, code, retryable, uncertain?}`);
   * server/library.mjs makes the upload.
   */
  async function libraryUpload(req, res, params) {
    const id = params.get("c");
    if (!orchestrator.hasConnection(id)) return deny(res, 410, "Connection closed.");
    const name = clipName((params.get("name") ?? "").trim());
    const type = /^[\w.+-]+\/[\w.+-]+$/.test(params.get("type") ?? "") ? params.get("type") : "";
    const directoryId = params.get("directoryId") || null;
    // A declared size over the cap is turned away before reading; one that grows past it stops there.
    const declared = Number(req.headers["content-length"] ?? params.get("size") ?? NaN);
    if (declared > MAX_UPLOAD_BYTES) return deny(res, 413, "此文件过大，无法上传。请尝试上传较小的文件");
    if (!name) return deny(res, 400, "Name the file.");
    if (name.startsWith(".")) return deny(res, 400, "文件名不能以“.”开头");
    if (declared === 0) return deny(res, 400, "无法上传空文件");
    if (directoryId !== null && !ITEM.test(directoryId)) return deny(res, 400, "Invalid folder.");
    const abort = new AbortController();
    res.on("close", () => { if (!res.writableEnded) abort.abort(); });
    res.writeHead(200, { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" });
    const emit = (line) => { if (!res.writableEnded) res.write(`${JSON.stringify(line)}\n`); };
    try { emit(await orchestrator.libraryUpload(id, { body: req, name, type, directoryId }, emit, abort.signal)); }
    // The upload judges its own failures; this is the connection gone before it began, which 重试 may pass.
    catch (error) { emit({ error: error.message, code: error.code ?? null, retryable: true }); }
    res.end();
  }

  /** A library file saved for a chat: `{id, fileId, name, size}` in, `{path, label}` out; the page never names a URL or a path. */
  async function libraryAttach(req, res, id) {
    if (!orchestrator.hasConnection(id)) return deny(res, 410, "Connection closed.");
    if (!(req.headers["content-type"] ?? "").startsWith("application/json")) return deny(res, 415, "Not JSON.");
    let body;
    try { body = JSON.parse((await readBody(req, 32 * 1024)).toString("utf8")); }
    catch { return deny(res, 400, "Invalid attachment request."); }
    const optional = (value) => value == null || typeof value === "string";
    if (!body || typeof body.name !== "string" || !optional(body.id) || !optional(body.fileId) || !(body.size === null || typeof body.size === "number")) return deny(res, 400, "Invalid attachment request.");
    const abort = new AbortController();
    res.on("close", () => { if (!res.writableEnded) abort.abort(); });
    try {
      const result = await orchestrator.libraryAttach(id, { id: body.id ?? undefined, fileId: body.fileId ?? undefined, name: body.name, size: body.size }, abort.signal);
      if (!res.destroyed) res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }).end(JSON.stringify(result));
    } catch (error) { if (!res.destroyed) deny(res, libraryStatus(error), error.message); }
  }

  /** A saved attachment dropped (?c&path): only a folder this process made under CODEX_HOME/attachments. */
  async function libraryDetach(res, params) {
    if (!orchestrator.hasConnection(params.get("c"))) return deny(res, 410, "Connection closed.");
    try {
      return (await orchestrator.libraryDetach(params.get("c"), params.get("path"))) ? void res.writeHead(204).end() : deny(res, 404, "Not an attachment.");
    } catch (error) { deny(res, libraryStatus(error), error.message); }
  }

  async function transcribe(req, res, id) {
    if (!orchestrator.hasConnection(id)) return deny(res, 410, "Connection closed.");
    const type = req.headers["content-type"] ?? "";
    if (!type.startsWith("audio/")) return deny(res, 415, "Not audio.");
    const audio = await readBody(req, MAX_AUDIO_BYTES).catch(() => null);
    if (!audio) return deny(res, 413, "录音太长，请分段听写。");
    try {
      const result = await orchestrator.transcribe(id, audio, type);
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }).end(JSON.stringify(result));
    } catch (error) { serviceError(res, error); }
  }

  async function desktopResult(req, res, id) {
    if (!orchestrator.hasConnection(id)) return deny(res, 410, "Connection closed.");
    let receipt;
    try { receipt = JSON.parse((await readBody(req, 256 * 1024)).toString("utf8")); }
    catch { return deny(res, 400, "Invalid desktop receipt."); }
    if (!receipt || typeof receipt.id !== "string") return deny(res, 400, "Invalid desktop receipt.");
    return orchestrator.desktopResult(id, receipt) ? res.writeHead(204).end() : deny(res, 410, "Display request expired.");
  }

  async function handleBrowserMcp(req, res, id, bearer, desktop = false) {
    let message;
    try { message = JSON.parse((await readBody(req, 2 * 1024 * 1024)).toString("utf8")); }
    catch { return deny(res, 400, "Invalid browser MCP message."); }
    if (!message || typeof message !== "object" || Array.isArray(message) || typeof message.method !== "string" || (message.params !== undefined && (!message.params || typeof message.params !== "object" || Array.isArray(message.params)))) return deny(res, 400, "Invalid browser MCP message.");
    const abort = new AbortController();
    res.on("close", () => { if (!res.writableEnded) abort.abort(); });
    try {
      const session = desktop ? orchestrator.desktopSession(id, bearer, req.headers["mcp-session-id"], message.method === "initialize") : undefined;
      if (desktop && !session) return deny(res, 404, "MCP session expired.");
      if (session) res.setHeader("Mcp-Session-Id", session);
      const response = await (desktop ? orchestrator.desktopMessage(id, bearer, message, abort.signal, session) : orchestrator.browserMessage(id, bearer, message, abort.signal));
      if (!res.destroyed) response === null ? res.writeHead(202).end() : res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" }).end(JSON.stringify(response));
    } catch {
      if (!res.destroyed) deny(res, 500, "Browser MCP failed.");
    }
  }

  return { token: secret, handle };
}

// opencodex (a local provider proxy for Codex) reports each provider's quota at GET
// /api/provider-quotas. Its runtime record holds a per-process secret; a capability signed with it
// admits one allowlisted read, unlike the admin token, which could change the proxy's config. No
// proxy, a stale record or any failure reads as no reports.
async function opencodexQuotas() {
  const home = process.env.OPENCODEX_HOME?.trim().replace(/^~(?=[\\/])/, homedir()) || path.join(homedir(), ".opencodex");
  try {
    const { pid, port, attestationSecret } = JSON.parse(readFileSync(path.join(home, "runtime-port.json"), "utf8"));
    const sign = (...lines) => createHmac("sha256", attestationSecret).update(lines.join("\n")).digest("base64url");
    const route = "/api/provider-quotas";
    const nonce = randomBytes(32).toString("base64url");
    const expiresAt = Date.now() + 10_000;
    const response = await fetch(`http://127.0.0.1:${port}${route}`, {
      headers: {
        "x-opencodex-local-expected-pid": String(pid),
        "x-opencodex-local-expires-at": String(expiresAt),
        "x-opencodex-local-nonce": nonce,
        "x-opencodex-local-capability": sign("opencodex-local-management-read-v1", nonce, "GET", route, pid, port, expiresAt),
      },
      signal: AbortSignal.timeout(15_000),
    });
    // opencodex signs the nonce back; an answer from whatever else now holds a stale port is dropped.
    if (!response.ok || response.headers.get("x-opencodex-attestation-proof") !== sign("opencodex-local-management-v1", nonce, pid, port)) {
      return { reports: [] };
    }
    const { reports } = await response.json();
    return { reports: reports.map(({ provider, label, quota, updatedAt }) => ({ provider, label, quota, updatedAt })) };
  } catch {
    return { reports: [] };
  }
}

function readBody(req, max) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size <= max) return void chunks.push(chunk);
      req.destroy();
      reject(new Error("too large"));
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function fromOwnOrigin(req) {
  const origin = req.headers.origin;
  if (origin !== undefined) return origin === `http://${req.headers.host}`;
  const site = req.headers["sec-fetch-site"];
  return site === undefined || site === "same-origin" || site === "none";
}

function readCookie(header, name) {
  for (const part of (header ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return undefined;
}

/**
 * The files pane's PDF preview: the raw bytes of one absolute `.pdf` path, for an iframe (the
 * page reads any file through fs/readFile already; this serves only PDFs, as PDFs). HEAD gives
 * the size, so the pane can turn a file past Claude's 30 MB cap away unread.
 */
async function sendPdf(req, res, file) {
  if (!path.isAbsolute(file) || path.extname(file).toLowerCase() !== ".pdf") return deny(res, 400, "Not a PDF.");
  let info;
  try { info = await stat(file); }
  catch { return deny(res, 404, "File not found."); }
  if (!info.isFile()) return deny(res, 404, "File not found.");
  res.writeHead(200, {
    "Content-Type": "application/pdf",
    "Content-Length": info.size,
    "Content-Disposition": "inline",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  if (req.method === "HEAD") return void res.end();
  createReadStream(file).on("error", () => res.destroy()).pipe(res);
}

function deny(res, status, message) {
  if (res.headersSent) return void res.end();
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" }).end(message);
}

/** A library failure's status: refused, no ChatGPT login, the page gone, else the one it names (else 502). */
function libraryStatus(error) {
  if (error.code === "CLOUD_REFUSED") return 403;
  if (error.code === "CHATGPT_REQUIRED") return 401;
  if (error.code === "CONNECTION_CLOSED") return 410;
  return Number.isInteger(error.status) && error.status >= 400 && error.status <= 599 ? error.status : 502;
}

function serviceError(res, error) {
  const status = error.code === "CONNECTION_CLOSED" ? 410 : error.code === "CHATGPT_REQUIRED" ? 403 : error.code === "UNAVAILABLE" ? 404 : 502;
  deny(res, status, error.message);
}
