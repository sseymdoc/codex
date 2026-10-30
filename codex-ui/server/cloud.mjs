// Codex Cloud and ChatGPT Dots through the session's own ChatGPT login: the page names one of a
// fixed set of calls (/wham environments, GitHub repositories, tasks; a dot's /tbo profile and
// its messaging room) and the bridge makes it with a token it never hands out. These are
// ChatGPT's private endpoints, the ones the Codex desktop app and the VS Code extension call;
// anything else is refused.

const ID = "[A-Za-z0-9_-]+";
const QUERY = "(?:\\?[A-Za-z0-9_=&%.,:+-]*)?";
const ROOM = `/messaging/rooms/${ID}`;
// [method, path, timeout, kind]: the page's /api/cloud makes JSON calls and `text` ones (a text
// answer, its headers beside it); the others are the bridge's own (`internal`) or go through its
// upload (`multipart`) or stream (`stream`, no timeout) endpoint.
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
  ["PATCH", `/tbo/${ID}`],
  // Deleting a dot archives its conversations and clears its memory; the desktop app takes a 503 as begun.
  ["DELETE", `/tbo/${ID}`, 60_000],
  ["POST", "/tbo/deletion-recovery", 60_000],
  ["GET", `/tbo/by-thread/${ID}`],
  ["POST", `/tbo/${ID}/(?:messaging-room|runtime/pause|runtime/resume)`],
  ["GET", `/tbo/${ID}/activity${QUERY}`],
  // The dot's work: its threads, and its activity as a live stream (through /api/cloud/stream).
  ["GET", `/tbo/${ID}/activity/stream`, 0, "stream"],
  ["GET", `/tbo/${ID}/root-thread`],
  ["GET", `/tbo/${ID}/threads${QUERY}`],
  ["GET", `/tbo/${ID}/threads/${ID}`],
  // The profile panel: schedules, a safety pause's review, the cloud computer, channels, meetings.
  ["GET", `/tbo/${ID}/(?:automations|misalignment-review|environment/status|channels/email|channels/email/options|channels/slack)${QUERY}`],
  ["POST", `/tbo/${ID}/environment/recreate${QUERY}`, 120_000],
  ["POST", `/tbo/${ID}/meeting-sessions`],
  ["POST", `/tbo/${ID}/channels/email/claim`],
  ["PUT", `/tbo/${ID}/channels/email`],
  ["DELETE", `/tbo/${ID}/channels/email`],
  ["DELETE", `/tbo/${ID}/channels/slack/${ID}${QUERY}`],
  ["GET", `/aeon-messaging/phone${QUERY}`],
  ["DELETE", `/aeon-messaging/phone${QUERY}`],
  ["POST", "/aeon-messaging/(?:phone|phone/verify|texting/activate)"],
  // Character avatars: a snapshot's upload (through /api/dots/upload) and a file pointer's download URL.
  ["POST", "/cloud-aeons/avatar-snapshots", 60_000, "multipart"],
  ["GET", `/files/download/${ID}`],
  ["GET", `/tbo/${ID}/voice/calls/${ID}/transcript`],
  // A voice call: the SDP offer goes up as JSON, the answer comes back as text (`text`: the page
  // gets it with the call's Location and root thread), then the call is attached or stopped.
  ["POST", `/tbo/${ID}/voice/calls`, 60_000, "text"],
  ["POST", `/tbo/${ID}/voice/calls/${ID}/(?:attach|stop)`],
  // The computers a dot can work on, and this one attached to it or not (server/executor.mjs
  // registers it, a bridge-internal call).
  ["GET", `/tbo/${ID}/computers${QUERY}`],
  ["POST", `/tbo/${ID}/computers/${ID}/(?:connect|connect-and-replace|disconnect)${QUERY}`],
  ["POST", "/flora/cca/executor", 30_000, "internal"],
  ["GET", ROOM],
  ["GET", `${ROOM}/messages${QUERY}`],
  ["POST", `${ROOM}/messages`, 60_000],
  ["POST", `${ROOM}/(?:read|responding_heartbeat|aeon/prepare)`],
  ["POST", `${ROOM}/files`, 120_000, "multipart"],
  ["GET", `${ROOM}/files/${ID}`],
  ["GET", `${ROOM}/messages/${ID}/elicitation${QUERY}`],
  ["POST", `${ROOM}/messages/${ID}/elicitation/response`, 60_000],
  // ChatGPT's scheduled tasks (定时任务) of the user's own, as the Codex desktop app 26.1023 calls
  // them (app-initial cDt/NDt/ADt/PDt, run-results-state, detail-panel, share-dialog,
  // shared-task-dialog, recommendations; ids are Automation_<hex>). Never a run's chat
  // (/f/conversation, /sentinel/*, /automation/…/run, nor any /conversation: a run opens in
  // ChatGPT itself), the table query nor a team's calls (the list takes its own parameters only, no
  // owner=group:…). The form's models are the app-server's catalog, not ChatGPT's /models.
  ["GET", "/automations(?:\\?(?:filter|cursor|limit)=[A-Za-z0-9_%.,+-]*(?:&(?:filter|cursor|limit)=[A-Za-z0-9_%.,+-]*)*)?"],
  ["GET", `/automation/${ID}`],
  ["POST", "/automations/(?:save|set_status|remove)"],
  ["GET", `/automation/${ID}/(?:runs|latest_backing_run)${QUERY}`],
  ["POST", `/automation/${ID}/runs/${ID}/read`],
  ["GET", `/automations/schedule_policy${QUERY}`],
  ["POST", "/share/automation"],
  ["GET", `/share/automation/${ID}/current`],
  ["POST", `/share/automation/${ID}/refresh`],
  ["DELETE", `/share/automation/${ID}`],
  ["GET", `/share/post/${ID}/automation`],
  // Suggestions answer for a surface, named as the desktop app's scheduled page names it.
  ["GET", "/suggested_automations", 30_000, "json", { "X-OpenAI-Task-Suggestions-Surface": "scheduled_page" }],
  ["GET", "/celsius/ws/user", 30_000, "internal"],
].map(([method, path, timeout = 30_000, kind = "json", headers = {}]) => ({ method, path: new RegExp(`^${path}$`), timeout, kind, headers }));

const route = (method, path) => typeof method === "string" && typeof path === "string" && !path.includes("..")
  ? ROUTES.find((route) => route.method === method && route.path.test(path)) : undefined;

/** Whether this call goes through as `kind` (the page's /api/cloud: `json`, which takes `text` too). */
export function cloudAllowed(method, path, kind = "json") {
  const found = route(method, path)?.kind;
  return found === kind || (kind === "json" && found === "text");
}

/** A dot room's prepared thread route (a signed token the next send carries back). */
const THREAD_ROUTE = /^[A-Za-z0-9._~+/=-]{1,1024}$/;

/**
 * One allowed call under a token from `auth(refresh)`; a 401 retries once with a refreshed token.
 * Resolves to the upstream status and its JSON body (null when there is none), and the thread
 * route the answer carries. `form` ({fields, file: {bytes, name, type}}) makes it a multipart
 * upload, built anew for each attempt.
 */
export async function cloudFetch({ base, auth, headers, method, path, body, form, threadRoute, idempotencyKey, kind = form ? "multipart" : "json", signal, fetch: send = fetch }) {
  const allowed = route(method, path);
  if (!allowed || !cloudAllowed(method, path, kind)) throw Object.assign(new Error("This Codex Cloud request is not allowed."), { code: "CLOUD_REFUSED" });
  const extra = {
    ...allowed.headers,
    ...(typeof threadRoute === "string" && THREAD_ROUTE.test(threadRoute) ? { "x-openai-thread-route": threadRoute } : {}),
    // A meeting invite carries its own key, so a retry is the same invite.
    ...(typeof idempotencyKey === "string" && /^[\w-]{1,64}$/.test(idempotencyKey) ? { "Idempotency-Key": idempotencyKey } : {}),
  };
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
    if (allowed.kind === "text" && response.ok) json = { text, location: response.headers.get("location"), rootThreadId: response.headers.get("openai-root-thread-id") };
    else try { json = text ? JSON.parse(text) : null; } catch { json = { detail: text.slice(0, 500) }; }
    const route = response.headers.get("x-openai-thread-route");
    return { status: response.status, body: json, ...(route && THREAD_ROUTE.test(route) ? { threadRoute: route } : {}) };
  }
}
