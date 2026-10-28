import { randomUUID } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { DESKTOP_TOOLS, SESSION_TOOLS, desktopError, validateDesktopInput, validateDesktopResult } from "../context/desktop-tools.mjs";
import { sessionResult } from "../context/sessions.mjs";
import { wrapUpResult } from "../context/turn.mjs";

/** Claude 4.29 wrap_up's answer: its sentence, or its refusal as an error. */
function wrappedUp(args, receipt) {
  const result = wrapUpResult(args, receipt);
  return "error" in result ? { isError: true, content: [{ type: "text", text: result.error }] } : { content: [{ type: "text", text: result.text }] };
}

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

/** Claude 3.6556 set_session_title's results; a rename carries what the transcript row and its undo need. */
function renamed({ threadId, title, previousTitle, previousTitleSource, outcome }) {
  const quote = text => `“${text}”`;
  if (outcome === "unchanged") return { content: [{ type: "text", text: `This session is already named ${quote(title)}.` }] };
  if (outcome === "declined") return { isError: true, content: [{ type: "text", text: "The user declined renaming this session. Nothing was changed." }] };
  return {
    content: [{ type: "text", text: `Renamed this session to ${quote(title)}${previousTitle === undefined ? "" : ` (was ${quote(previousTitle)})`}.` }],
    _meta: { codexUiSessionRenamed: { threadId, title, ...(previousTitle !== undefined && { previousTitle, ...(previousTitleSource !== undefined && { previousTitleSource }) }) } },
  };
}

/** mark_chapter's result: the heading is the call itself, which the transcript reads; the first message gets none. */
function chaptered({ outcome }, { title }) {
  if (outcome === "first_message") return { isError: true, content: [{ type: "text", text: "The session start is already the first chapter. Mark a chapter when the work later shifts to a new phase." }] };
  return { content: [{ type: "text", text: `Marked a new chapter: \u201c${title}\u201d.` }] };
}

/** Claude Code EnterPlanMode's results; entered carries the mark the transcript and the plan-mode resume read. */
function plannedFor({ outcome }) {
  if (outcome === "already") return { content: [{ type: "text", text: "This chat is already in plan mode." }] };
  if (outcome === "unavailable") return { isError: true, content: [{ type: "text", text: "Plan mode isn’t available for this session." }] };
  if (outcome === "declined") return { isError: true, content: [{ type: "text", text: "User declined to enter plan mode. Continue without plan mode." }] };
  return {
    content: [{ type: "text", text: "Entered plan mode. You should now focus on exploring the codebase and designing an implementation approach. Plan mode applies from your next turn: end this turn now with one short sentence and no further tool calls. Codex UI then continues the task in plan mode, where you explore, design the approach and propose the plan for the user's approval." }],
    _meta: { codexUiPlanMode: "entered" },
  };
}

/**
 * A disposable connection owns its UI requests. Nothing is replayed into a new connection.
 * Display calls get five seconds; a rename or entering plan mode may wait on the user's consent, a
 * session start on its worktree and first message, an offer on its card (under Codex's day-long timeout).
 */
export function createDesktopTools({ enabled, context, emit, timeoutMs = 5000, consentMs = 600_000, startMs = 120_000, offerMs = 86_390_000 }) {
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
    const consent = name === "set_session_title" || name === "enter_plan_mode";
    const offer = name === "start_session" && args.initiation === "offer";
    const wait = consent ? consentMs : offer ? offerMs : SESSION_TOOLS.includes(name) ? startMs : timeoutMs;
    const payload = { id, threadId, cwd: state.cwd, name, args, deadline: Date.now() + wait, browserEnabled: state.browserEnabled === true };
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
      const timeout = name === "set_session_title" ? "The rename was not approved in time; the title was left unchanged."
        : name === "enter_plan_mode" ? "Entering plan mode was not approved in time; this chat stays in its current mode."
          : offer ? "The user did not answer the card in time; nothing was started. Do the task in this session as usual."
            : SESSION_TOOLS.includes(name) ? "The interface did not confirm in time; whether anything was started or changed is unknown. Do not retry automatically."
              : "The interface did not confirm within five seconds; the display outcome is unknown.";
      const entry = { payload, finish, sent: false, timer: setTimeout(() => finish(fail("UI_TIMEOUT", timeout)), wait) };
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
      // Session refusals are Claude's sentences, some past 512 characters.
      if (receipt.error) throw fail(typeof receipt.error.code === "string" ? receipt.error.code.slice(0, 80) : "UI_ERROR", typeof receipt.error.message === "string" ? receipt.error.message.slice(0, 2000) : "Display failed.");
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
    // Session tools and wrap_up refuse in plain words, as Claude's do; display tools keep their coded errors.
    const errorReply = error => reply({ isError: true, content: [{ type: "text", text: SESSION_TOOLS.includes(params.name) || params.name === "wrap_up" ? error.message : JSON.stringify({ code: error.code ?? "DISPLAY_FAILED", message: error.message }) }] });
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
        return reply(params.name === "set_session_title" ? renamed(result) : params.name === "mark_chapter" ? chaptered(result, args) : params.name === "enter_plan_mode" ? plannedFor(result) : params.name === "wrap_up" ? wrappedUp(args, result) : SESSION_TOOLS.includes(params.name) ? sessionResult(params.name, result) : { content: [{ type: "text", text: JSON.stringify(result) }] });
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
