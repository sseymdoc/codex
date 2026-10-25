import { randomUUID } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { DESKTOP_TOOLS, desktopError, validateDesktopInput, validateDesktopResult } from "../context/desktop-tools.mjs";

export async function desktopFilePath(cwd, input) {
  if (/^(?:[a-z][a-z\d+.-]*:\/\/|\\\\[?.]\\)/i.test(input) || (process.platform === "win32" && input.replace(/^[a-z]:/i, "").includes(":"))) throw desktopError("INVALID_PATH", "Only file paths are supported.");
  const contain = (root, file) => {
    const relative = path.relative(root, file);
    if (path.isAbsolute(relative) || relative === ".." || relative.startsWith(".." + path.sep)) throw desktopError("PATH_OUTSIDE_CWD", "New files must stay inside this chat's working directory.");
  };
  const resolved = path.resolve(cwd, input);
  // Reject out-of-scope paths before any probe, including Windows network authentication.
  contain(path.resolve(cwd), resolved);
  const root = await realpath(cwd), file = await realpath(resolved);
  contain(root, file);
  if (!(await stat(file)).isFile()) throw desktopError("INVALID_PATH", "The target is not a file.");
  return file;
}

/** A disposable connection owns its UI requests. Nothing is replayed into a new connection. */
export function createDesktopTools({ enabled, context, emit, timeoutMs = 5000 }) {
  const pending = new Map(), tails = new Map(), calls = new Map(), sessions = new Set();
  let closed = false;
  const fail = (code, message) => desktopError(code, message);
  const current = (threadId, cwd) => {
    const state = context(threadId);
    if (closed || !enabled() || !state?.enabled || typeof state.cwd !== "string" || (cwd !== undefined && state.cwd !== cwd)) throw fail("UNAVAILABLE", "No authorized local desktop binding for this chat.");
    return state;
  };
  function request(threadId, name, args, signal) {
    const state = current(threadId), id = randomUUID();
    const payload = { id, threadId, cwd: state.cwd, name, args, deadline: Date.now() + timeoutMs, browserEnabled: state.browserEnabled === true };
    const result = new Promise((resolve, reject) => {
      const finish = (error, value) => {
        const entry = pending.get(id);
        if (!entry) return;
        pending.delete(id);
        clearTimeout(entry.timer);
        signal?.removeEventListener("abort", abort);
        if (error && entry.sent) emit("desktop-cancel", { id });
        error ? reject(error) : resolve(value);
      };
      const abort = () => finish(fail("CANCELLED", "Display cancelled; an already applied layout is not rolled back."));
      const entry = { payload, finish, sent: false, timer: setTimeout(() => finish(fail("UI_TIMEOUT", "The interface did not confirm within five seconds; the display outcome is unknown.")), timeoutMs) };
      pending.set(id, entry);
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) return abort();
      void (tails.get(threadId) ?? Promise.resolve()).then(async () => {
        if (!pending.has(id)) return;
        try {
          current(threadId, payload.cwd);
          if (args.path !== undefined) payload.args = { ...args, path: await desktopFilePath(payload.cwd, args.path) };
          if (!pending.has(id)) return;
          current(threadId, payload.cwd);
          entry.sent = true;
          emit("desktop-request", payload);
        } catch (error) { finish(error); }
      });
    });
    const tail = result.catch(() => {});
    tails.set(threadId, tail);
    void tail.then(() => { if (tails.get(threadId) === tail) tails.delete(threadId); });
    return result;
  }
  function respond(receipt) {
    const entry = receipt && pending.get(receipt.id);
    if (!entry) return false;
    try {
      current(entry.payload.threadId, entry.payload.cwd);
      if (receipt.error) throw fail(typeof receipt.error.code === "string" ? receipt.error.code.slice(0, 80) : "UI_ERROR", typeof receipt.error.message === "string" ? receipt.error.message.slice(0, 512) : "Display failed.");
      entry.finish(null, validateDesktopResult(entry.payload.name, receipt.result, entry.payload));
    } catch (error) { entry.finish(error); }
    return true;
  }
  function openSession() {
    if (closed) return undefined;
    const id = randomUUID(); sessions.add(id); return id;
  }
  function closeSession(id) {
    if (!sessions.delete(id)) return false;
    for (const [key, call] of calls) if (call.sessionId === id) { call.abort.abort(); calls.delete(key); }
    return true;
  }
  async function message(message, signal, sessionId) {
    if (!sessions.has(sessionId)) throw fail("SESSION_EXPIRED", "Desktop MCP session expired.");
    const { id, method, params = {} } = message;
    if (method === "notifications/cancelled") {
      calls.get(JSON.stringify([sessionId, params.requestId]))?.abort.abort();
      return null;
    }
    if (id === undefined) return null;
    const reply = result => ({ jsonrpc: "2.0", id, result });
    if (method === "initialize") return reply({ protocolVersion: params.protocolVersion ?? "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "Codex UI Desktop", version: "1" } });
    if (method === "ping") return reply({});
    if (method === "tools/list") return reply({ tools: !closed && enabled() ? DESKTOP_TOOLS : [] });
    if (method !== "tools/call") return { jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } };
    const errorReply = error => reply({ isError: true, content: [{ type: "text", text: JSON.stringify({ code: error.code ?? "DISPLAY_FAILED", message: error.message }) }] });
    try {
      if (typeof params._meta?.codexUiDesktopCwd !== "string") throw fail("UNAVAILABLE", "A native desktop sampling context is required.");
      current(params._meta?.threadId, params._meta.codexUiDesktopCwd);
    } catch (error) { return errorReply(error); }
    const callKey = JSON.stringify([sessionId, id]);
    const key = JSON.stringify(params), previous = calls.get(callKey);
    if (previous) return previous.key === key ? previous.promise.then(response => ({ ...response, id })) : reply({ isError: true, content: [{ type: "text", text: JSON.stringify({ code: "DUPLICATE_ID", message: "Native call id reused with different arguments." }) }] });
    const abort = new AbortController();
    const promise = (async () => {
      try {
        const threadId = params._meta?.threadId;
        current(threadId);
        const args = validateDesktopInput(params.name, params.arguments ?? {});
        const result = await request(threadId, params.name, args, signal ? AbortSignal.any([signal, abort.signal]) : abort.signal);
        return reply({ content: [{ type: "text", text: JSON.stringify(result) }] });
      } catch (error) {
        return errorReply(error);
      }
    })();
    const call = { key, abort, promise, sessionId, done: false };
    calls.set(callKey, call);
    void promise.then(() => {
      call.done = true;
      for (const [oldId, old] of calls) { if (calls.size <= 64) break; if (old.done) calls.delete(oldId); }
    });
    return promise;
  }
  function invalidate(threadId) {
    for (const entry of pending.values()) if (entry.payload.threadId === threadId) entry.finish(fail("UNAVAILABLE", "The chat or its working directory changed."));
  }
  function close() {
    closed = true;
    for (const entry of pending.values()) entry.finish(fail("UI_DISCONNECTED", "The interface disconnected; the display outcome is unknown."));
    calls.clear();
    sessions.clear();
  }
  return { message, respond, invalidate, close, openSession, closeSession, hasSession: id => sessions.has(id) };
}
