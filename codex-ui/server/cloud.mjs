// Codex Cloud and ChatGPT Dots through the session's own ChatGPT login: the page names one of a
// fixed set of calls (/wham environments, GitHub repositories, tasks; a dot's /tbo profile and
// its messaging room) and the bridge makes it with a token it never hands out. These are
// ChatGPT's private endpoints, the ones the Codex desktop app and the VS Code extension call;
// anything else is refused.

const ID = "[A-Za-z0-9_-]+";
const QUERY = "(?:\\?[A-Za-z0-9_=&%.,:+-]*)?";
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
  ["GET", `/messaging/rooms/${ID}/messages${QUERY}`],
  ["POST", `/messaging/rooms/${ID}/(?:messages|read)`],
].map(([method, path, timeout = 30_000]) => ({ method, path: new RegExp(`^${path}$`), timeout }));

const route = (method, path) => typeof method === "string" && typeof path === "string" && !path.includes("..")
  ? ROUTES.find((route) => route.method === method && route.path.test(path)) : undefined;

/** Whether the page may ask for this call. */
export function cloudAllowed(method, path) {
  return !!route(method, path);
}

/**
 * One allowed call under a token from `auth(refresh)`; a 401 retries once with a refreshed token.
 * Resolves to the upstream status and its JSON body (null when there is none).
 */
export async function cloudFetch({ base, auth, headers, method, path, body, signal, fetch: send = fetch }) {
  const allowed = route(method, path);
  if (!allowed) throw Object.assign(new Error("This Codex Cloud request is not allowed."), { code: "CLOUD_REFUSED" });
  for (const refresh of [false, true]) {
    const token = await auth(refresh);
    if (!token) throw Object.assign(new Error("Codex Cloud 需要使用 ChatGPT 账户登录 Codex。"), { code: "CHATGPT_REQUIRED" });
    const response = await send(`${base}${path}`, {
      method,
      headers: { ...headers(token), Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
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
    return { status: response.status, body: json };
  }
}
