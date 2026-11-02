import { randomUUID } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { DESKTOP_TOOLS, SESSION_TOOLS, desktopError, validateDesktopInput, validateDesktopResult } from "../context/desktop-tools.mjs";
import { sessionResult } from "../context/sessions.mjs";
import { wrapUpResult } from "../context/turn.mjs";
import { TERMINAL_TOOL_NAMES, terminalResult, terminalWait } from "../context/terminal-tools.mjs";
import { PR_TOOL_NAMES, prResult } from "../context/pr-tools.mjs";
import { WORKTREE_TOOL_NAMES, WORKTREE_WAIT_MS, worktreeResult } from "../context/worktree-tools.mjs";
import { SETTINGS_TOOL_NAMES, settingsResult } from "../context/settings-tools.mjs";
import { WINDOW_TOOL_NAMES, windowResult } from "../context/window-tools.mjs";
import { AUTOMATION_TOOL_NAMES, automationResult, automationTask } from "../context/automation-tools.mjs";
import { MANAGE_ASKS, MANAGE_TOOL_NAMES, manageResult } from "../context/manage-tools.mjs";
import { HOST_ASKS, HOST_FOLDER_TOOLS, HOST_TOOL_NAMES, hostResult } from "../context/host-tools.mjs";
import { VISUALIZE_TOOL_NAMES, visualizeResult } from "../context/visualize-tools.mjs";
import { homedir } from "node:os";

/** Claude 4.29 wrap_up's answer: its sentence, or its refusal as an error. */
function wrappedUp(args, receipt) {
  const result = wrapUpResult(args, receipt);
  return "error" in result ? { isError: true, content: [{ type: "text", text: result.error }] } : { content: [{ type: "text", text: result.text }] };
}

/**
 * A terminal tab's or a scheduled task's folder: absolute, or relative to the chat's; it must exist.
 * A URL, device path or network share (\\host\share, //host/share) is refused before any probe,
 * which would otherwise reach the host with the user's Windows network authentication.
 */
export async function desktopDirectory(cwd, input) {
  if (/^(?:[a-z][a-z\d+.-]*:\/\/|[\\/]{2})/i.test(input)) throw desktopError("INVALID_PATH", "cwd must be a folder on this computer.");
  const folder = path.resolve(cwd, input);
  let found;
  try { found = await stat(folder); } catch { throw desktopError("INVALID_PATH", `No such folder: ${folder}`); }
  if (!found.isDirectory()) throw desktopError("INVALID_PATH", `Not a folder: ${folder}`);
  return folder;
}

export async function desktopFilePath(cwd, input, folders = false) {
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
  const found = await stat(file);
  if (!found.isFile() && !(folders && found.isDirectory())) throw desktopError("INVALID_PATH", folders ? "The target is not a file or folder." : "The target is not a file.");
  // In cwd's own spelling: realpath also resolves the symlinks above it (macOS /tmp → /private/tmp).
  return path.join(path.resolve(cwd), path.relative(root, file));
}

/** Claude 3.6556 set_session_title's results; a rename carries what the transcript row and its undo need. */
function renamed({ threadId, title, previousTitle, previousTitleSource, outcome }, { session_id }) {
  const quote = text => `“${text}”`;
  const which = session_id ? "that session" : "this session";
  if (outcome === "unchanged") return { content: [{ type: "text", text: `${session_id ? "That" : "This"} session is already named ${quote(title)}.` }] };
  if (outcome === "declined") return { isError: true, content: [{ type: "text", text: `The user declined renaming ${which}. Nothing was changed.` }] };
  return {
    content: [{ type: "text", text: `Renamed ${which} to ${quote(title)}${previousTitle === undefined ? "" : ` (was ${quote(previousTitle)})`}.` }],
    // The transcript row's undo is for this chat's own title.
    ...(session_id ? {} : { _meta: { codexUiSessionRenamed: { threadId, title, ...(previousTitle !== undefined && { previousTitle, ...(previousTitleSource !== undefined && { previousTitleSource }) }) } } }),
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
    // A scheduled-task list, view or local delete never asks; it may still wait on a ChatGPT read.
    const reading = AUTOMATION_TOOL_NAMES.includes(name) && (args.mode === "list" || (name === "automation_update" && (args.mode === "view" || args.mode === "delete" || args.mode === "runs")));
    const consent = name === "set_session_title" || name === "enter_plan_mode" || name === "set_setting" || MANAGE_ASKS.includes(name) || HOST_ASKS.includes(name) || (AUTOMATION_TOOL_NAMES.includes(name) && !reading);
    const offer = name === "start_session" && args.initiation === "offer";
    const wait = consent ? consentMs : offer ? offerMs : reading || SESSION_TOOLS.includes(name) || PR_TOOL_NAMES.includes(name) || MANAGE_TOOL_NAMES.includes(name) || HOST_TOOL_NAMES.includes(name) ? startMs : WORKTREE_TOOL_NAMES.includes(name) ? Math.max(startMs, WORKTREE_WAIT_MS) : TERMINAL_TOOL_NAMES.includes(name) ? terminalWait(name, args, { timeoutMs, consentMs }) : timeoutMs;
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
          : name === "set_setting" ? "The setting change was not approved in time; nothing was changed."
          : reading && args.mode !== "delete" ? "The interface did not answer in time; nothing was changed. Try again once."
          : AUTOMATION_TOOL_NAMES.includes(name) ? "The interface did not confirm in time; whether the scheduled task was changed is unknown. Check with mode \"list\" before trying again."
          : name === "run_in_terminal" ? "The command was not approved, or its output not read, in time; whether it was typed is unknown. Check with list_terminal_tabs and read_terminal before trying again."
          : offer ? "The user did not answer the card in time; nothing was started. Do the task in this session as usual."
          : MANAGE_TOOL_NAMES.includes(name) || HOST_TOOL_NAMES.includes(name) ? "The interface did not answer in time; whether anything changed is unknown. Check (list_sessions, list_groups, get_session, get_storage_usage) before trying again."
            : SESSION_TOOLS.includes(name) || PR_TOOL_NAMES.includes(name) || WORKTREE_TOOL_NAMES.includes(name) ? "The interface did not confirm in time; whether anything was started or changed is unknown. Do not retry automatically."
              : "The interface did not confirm within five seconds; the display outcome is unknown.";
      const entry = { payload, finish, sent: false, timer: setTimeout(() => finish(fail("UI_TIMEOUT", timeout)), wait) };
      pending.set(id, entry);
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) return abort();
      void (tails.get(threadId) ?? Promise.resolve()).then(async () => {
        if (!pending.has(id)) return;
        try {
          current(threadId, payload.cwd);
          // A folder tool's path is any folder on this computer; a kept worktree's is checked by the storage service.
          if (args.path !== undefined && HOST_FOLDER_TOOLS.includes(name)) payload.args = { ...args, path: await desktopDirectory(payload.cwd, args.path.replace(/^~(?=$|[\\/])/, homedir())) };
          else if (args.path !== undefined && name !== "discard_kept_worktree") payload.args = { ...args, path: await desktopFilePath(payload.cwd, args.path, name === "reveal_path") };
          if (args.cwd !== undefined && TERMINAL_TOOL_NAMES.includes(name)) payload.args = { ...args, cwd: await desktopDirectory(payload.cwd, args.cwd) };
          if (args.cwds !== undefined && name === "automation_update") payload.args = { ...args, cwds: await Promise.all(args.cwds.map(folder => desktopDirectory(payload.cwd, folder))) };
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
      // A scheduled-task refusal names the task it was about (the transcript row's name, kept out of the text).
      if (receipt.error) throw Object.assign(fail(typeof receipt.error.code === "string" ? receipt.error.code.slice(0, 80) : "UI_ERROR", typeof receipt.error.message === "string" ? receipt.error.message.slice(0, 2000) : "Display failed."),
        AUTOMATION_TOOL_NAMES.includes(entry.payload.name) && { task: automationTask(receipt.error.task) });
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
    // Session, terminal, pull request and scheduled-task tools and wrap_up refuse in plain words, as Claude's do; display tools keep their coded errors.
    const errorReply = error => reply({ isError: true, content: [{ type: "text", text: SESSION_TOOLS.includes(params.name) || TERMINAL_TOOL_NAMES.includes(params.name) || PR_TOOL_NAMES.includes(params.name) || WORKTREE_TOOL_NAMES.includes(params.name) || SETTINGS_TOOL_NAMES.includes(params.name) || WINDOW_TOOL_NAMES.includes(params.name) || AUTOMATION_TOOL_NAMES.includes(params.name) || MANAGE_TOOL_NAMES.includes(params.name) || HOST_TOOL_NAMES.includes(params.name) || VISUALIZE_TOOL_NAMES.includes(params.name) || params.name === "wrap_up" ? error.message : JSON.stringify({ code: error.code ?? "DISPLAY_FAILED", message: error.message }) }], ...(error.task && { _meta: { codexUiAutomationTask: error.task } }) });
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
        // The page only says whether inline visuals are on; the widget's code stays in the call's arguments.
        const result = await request(threadId, params.name, params.name === "show_widget" ? { title: args.title } : args, signal ? AbortSignal.any([signal, abort.signal]) : abort.signal);
        return reply(params.name === "set_session_title" ? renamed(result, args) : VISUALIZE_TOOL_NAMES.includes(params.name) ? visualizeResult(params.name, args, result) : MANAGE_TOOL_NAMES.includes(params.name) ? manageResult(params.name, args, result) : HOST_TOOL_NAMES.includes(params.name) ? hostResult(params.name, args, result) : params.name === "mark_chapter" ? chaptered(result, args) : params.name === "enter_plan_mode" ? plannedFor(result) : params.name === "wrap_up" ? wrappedUp(args, result) : TERMINAL_TOOL_NAMES.includes(params.name) ? terminalResult(params.name, args, result) : PR_TOOL_NAMES.includes(params.name) ? prResult(params.name, args, result) : WORKTREE_TOOL_NAMES.includes(params.name) ? worktreeResult(params.name, args, result) : SETTINGS_TOOL_NAMES.includes(params.name) ? settingsResult(params.name, args, result) : WINDOW_TOOL_NAMES.includes(params.name) ? windowResult(params.name, args, result) : AUTOMATION_TOOL_NAMES.includes(params.name) ? automationResult(params.name, args, result) : SESSION_TOOLS.includes(params.name) ? sessionResult(params.name, result) : { content: [{ type: "text", text: JSON.stringify(result) }] });
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
