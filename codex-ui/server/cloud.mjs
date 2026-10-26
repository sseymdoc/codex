// Codex Cloud through the session's own ChatGPT login: the page names one of a fixed set of /wham
// calls (environments, GitHub repositories, tasks) and the bridge makes it with a token it never
// hands out. These are ChatGPT's private endpoints, the ones the Codex desktop app and the VS Code
// extension call; anything else is refused.

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
].map(([method, path]) => ({ method, path: new RegExp(`^${path}$`) }));

/** Whether the page may ask for this call. */
export function cloudAllowed(method, path) {
  return typeof method === "string" && typeof path === "string" && !path.includes("..") && ROUTES.some((route) => route.method === method && route.path.test(path));
}

/**
 * One allowed call under a token from `auth(refresh)`; a 401 retries once with a refreshed token.
 * Resolves to the upstream status and its JSON body (null when there is none).
 */
export async function cloudFetch({ base, auth, headers, method, path, body, signal }) {
  if (!cloudAllowed(method, path)) throw Object.assign(new Error("This Codex Cloud request is not allowed."), { code: "CLOUD_REFUSED" });
  for (const refresh of [false, true]) {
    const token = await auth(refresh);
    if (!token) throw Object.assign(new Error("Codex Cloud 需要使用 ChatGPT 账户登录 Codex。"), { code: "CHATGPT_REQUIRED" });
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { ...headers(token), Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(30_000)]),
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
