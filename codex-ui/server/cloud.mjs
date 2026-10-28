// Codex Cloud and ChatGPT Dots through the session's own ChatGPT login: the page names one of a
// fixed set of calls (/wham environments, GitHub repositories, tasks; a dot's /tbo profile and
// its messaging room) and the bridge makes it with a token it never hands out. These are
// ChatGPT's private endpoints, the ones the Codex desktop app and the VS Code extension call;
// anything else is refused.

const ID = "[A-Za-z0-9_-]+";
const QUERY = "(?:\\?[A-Za-z0-9_=&%.,:+-]*)?";
const ROOM = `/messaging/rooms/${ID}`;
// [method, path, timeout, kind]: a kind other than JSON is the bridge's own (`internal`) or goes
// through its upload endpoint (`multipart`), never through the page's /api/cloud.
const ROUTES = [
  ["GET", `/wham/environments${QUERY}`],
  ["POST", "/wham/environments"],
  ["GET", `/wham/environments/${ID}/with-creator-and-machine`],
  ["PATCH", `/wham/environments/${ID}`],
  ["GET", `/wham/github/(?:list-repositories|repositories/search/all-installations|branches/${ID}/search)${QUERY}`],
  ["GET", `/wham/tasks/list${QUERY}`],
  ["GET", `/wham/tasks/${ID}(?:/turns)?`],
  ["POST", "/wham/tasks"],
  ["POST", `/wham/tasks/${ID}/(?:cancel|archive|mark_read)`],
  // Dots (orbit / tbo), as the Codex desktop app's dot page makes them; `/tbo/primary` is an ID.
  ["GET", "/accounts/check/v4-2023-04-27"],
  ["GET", `/tbo${QUERY}`],
  // Creating a dot sets up its cloud computer: the desktop app waits up to 540 s.
  ["POST", "/tbo", 540_000],
  ["GET", `/tbo/${ID}`],
  ["POST", `/tbo/${ID}/(?:messaging-room|runtime/pause|runtime/resume)`],
  ["GET", `/tbo/${ID}/activity${QUERY}`],
  ["GET", `/tbo/${ID}/voice/calls/${ID}/transcript`],
  ["GET", ROOM],
  ["GET", `${ROOM}/messages${QUERY}`],
  ["POST", `${ROOM}/messages`, 60_000],
  ["POST", `${ROOM}/(?:read|responding_heartbeat|aeon/prepare)`],
  ["POST", `${ROOM}/files`, 120_000, "multipart"],
  ["GET", `${ROOM}/files/${ID}`],
  ["GET", `${ROOM}/messages/${ID}/elicitation${QUERY}`],
  ["POST", `${ROOM}/messages/${ID}/elicitation/response`, 60_000],
  ["GET", "/celsius/ws/user", 30_000, "internal"],
].map(([method, path, timeout = 30_000, kind = "json"]) => ({ method, path: new RegExp(`^${path}$`), timeout, kind }));

const route = (method, path) => typeof method === "string" && typeof path === "string" && !path.includes("..")
  ? ROUTES.find((route) => route.method === method && route.path.test(path)) : undefined;

/** Whether this call goes through as `kind` (the page's /api/cloud asks for JSON calls only). */
export function cloudAllowed(method, path, kind = "json") {
  return route(method, path)?.kind === kind;
}

/** A dot room's prepared thread route (a signed token the next send carries back). */
const THREAD_ROUTE = /^[A-Za-z0-9._~+/=-]{1,1024}$/;

/**
 * One allowed call under a token from `auth(refresh)`; a 401 retries once with a refreshed token.
 * Resolves to the upstream status and its JSON body (null when there is none), and the thread
 * route the answer carries. `form` ({fields, file: {bytes, name, type}}) makes it a multipart
 * upload, built anew for each attempt.
 */
export async function cloudFetch({ base, auth, headers, method, path, body, form, threadRoute, kind = form ? "multipart" : "json", signal, fetch: send = fetch }) {
  const allowed = route(method, path);
  if (allowed?.kind !== kind) throw Object.assign(new Error("This Codex Cloud request is not allowed."), { code: "CLOUD_REFUSED" });
  const extra = typeof threadRoute === "string" && THREAD_ROUTE.test(threadRoute) ? { "x-openai-thread-route": threadRoute } : {};
  for (const refresh of [false, true]) {
    const token = await auth(refresh);
    if (!token) throw Object.assign(new Error("Codex Cloud 需要使用 ChatGPT 账户登录 Codex。"), { code: "CHATGPT_REQUIRED" });
    let payload;
    if (form) {
      payload = new FormData();
      for (const [name, value] of Object.entries(form.fields ?? {})) payload.append(name, value);
      payload.append("file", new Blob([form.file.bytes], { type: form.file.type }), form.file.name);
    } else if (body !== undefined) payload = JSON.stringify(body);
    const response = await send(`${base}${path}`, {
      method,
      headers: { ...headers(token), ...extra, Accept: "application/json", ...(body === undefined || form ? {} : { "Content-Type": "application/json" }) },
      body: payload,
      redirect: "error",
      signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(allowed.timeout)]),
    });
    if (response.status === 401 && !refresh) {
      await response.body?.cancel();
      continue;
    }
    const text = await response.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = { detail: text.slice(0, 500) }; }
    const route = response.headers.get("x-openai-thread-route");
    return { status: response.status, body: json, ...(route && THREAD_ROUTE.test(route) ? { threadRoute: route } : {}) };
  }
}
