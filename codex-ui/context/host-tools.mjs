// codex_ui_desktop's host and folder tools, after Claude 4.4212's ccd_host (open_in_editor,
// reveal_path, request_keep_awake, get_storage_usage, clean_up_worktrees, discard_kept_worktree)
// and ccd_directory (request_directory, change_directory) (app.asar index.chunk-BReS2dO4 Eu / Es),
// for this computer and Codex UI's worktrees. Paths arrive resolved by the host (server/desktop-tools.mjs). No I/O.

import { change, declined, json, quote, read, tool, toolTable } from "./manage-tools.mjs";

const PATH = { type: "string", minLength: 1, maxLength: 4096 };

const SPEC = [
  tool("open_in_editor", "Open a file from this session's folder in the user's code editor (VS Code, Cursor, Windsurf or Zed, as installed), optionally at a line. Use it to hand work back: a change they'll want to inspect or finish by hand, or when they ask to open something. Files only (reveal_path shows a folder). If several editors are installed and none is named, the call fails and lists them: ask which, then pass it as editor. Asks the user first, except in full access.",
    { path: { ...PATH, description: "The file: absolute, or relative to the session's folder; it must be inside it." }, line: { type: "integer", minimum: 1, maximum: 10_000_000, description: "1-based line to reveal." }, editor: { type: "string", enum: ["vscode", "cursor", "windsurf", "zed"], description: "Only when the user named one, or after a call listed several." } }, ["path"], change,
    ["opened", "declined"], (args, r) => r.outcome === "opened" ? `Asked ${r.data?.editor ?? "the editor"} to open ${quote(args.path)}.` : declined),
  tool("reveal_path", "Show a file or folder from this session's folder in the system file manager (Finder, File Explorer), selected in its parent. Use when the user wants to get at a file outside this app. Asks the user first, except in full access.",
    { path: { ...PATH, description: "File or folder: absolute, or relative to the session's folder; it must be inside it." } }, ["path"], change,
    ["revealed", "declined"], (args, r) => r.outcome === "revealed" ? `Showed ${quote(args.path)} in the file manager.` : declined),
  tool("request_keep_awake", 'Keep the computer from idle sleep while work you must check on later runs (a long build, waiting on CI), or when the user asks. until "turn_end" holds while this turn runs (often already covered by the app\'s own setting); "session_idle" holds until the user turns it off in the session\'s menu or the session is archived. The first hold of a session asks the user. A closed lid still sleeps.',
    { until: { type: "string", enum: ["turn_end", "session_idle"] }, reason: { type: "string", minLength: 1, maxLength: 200, description: "One short sentence: what work needs the machine awake." } }, ["until", "reason"], change,
    ["held", "covered", "declined", "no_turn"],
    (args, r) => r.outcome === "held" ? (args.until === "turn_end" ? "The computer stays awake until this turn ends." : "The computer stays awake for this session until the user turns it off in the session's menu (保持计算机唤醒).") : r.outcome === "covered" ? "The app already keeps the computer awake while a turn runs; nothing more was needed." : r.outcome === "no_turn" ? "No turn is running in this session, so nothing was held." : declined),
  tool("get_storage_usage", "How much space Codex takes on this computer: conversations, session worktrees (with their owning session and uncommitted changes), scratch workspaces, attachments, and the disk's free space. Read-only.",
    {}, [], read, ["found"], json),
  tool("clean_up_worktrees", "Remove the worktrees of sessions inactive for older_than_days (default 30): sessions, conversations and committed branches stay. A worktree with uncommitted changes (or commits no branch holds) is kept unless include_uncommitted, whose changes are then lost. Running, pinned or on-screen sessions are skipped. One card lists everything first, in every permission mode.",
    { older_than_days: { type: "integer", minimum: 1, maximum: 365 }, include_uncommitted: { type: "boolean", description: "Also remove worktrees with uncommitted changes, losing them. Default false." } }, [], change,
    ["removed", "nothing", "declined"],
    (args, r) => r.outcome === "removed" ? `Removed ${r.data?.removed?.length ?? 0} worktree(s).${r.data?.skipped?.length ? ` Kept: ${JSON.stringify(r.data.skipped)}.` : ""}` : r.outcome === "nothing" ? "No worktree belongs to a session inactive that long; nothing was removed." : declined),
  tool("discard_kept_worktree", "Remove one session worktree that was kept because it holds uncommitted changes (a path from get_storage_usage), losing those changes. Only when the user asks; a card asks first in every permission mode.",
    { path: { ...PATH, description: "The worktree's path as get_storage_usage lists it." } }, ["path"], change,
    ["removed", "declined"], (args, r) => r.outcome === "removed" ? `Removed the worktree ${quote(args.path)}.` : declined),
  tool("request_directory", "Get write access to a folder outside this session's folder. With path, the user sees and approves that folder (not in full access); without it, a folder picker opens and their pick is the answer. In 自动 the folder becomes writable for this session; in read-only it can already be read; full access needs nothing.",
    { path: { ...PATH, description: "Absolute path of the folder (~ is the home folder). Omit to let the user pick one." } }, [], change,
    ["granted", "already", "read_only", "full_access", "cancelled", "declined"],
    (args, r) => ({ granted: `Folder access granted: ${r.data?.path}. Use this absolute path in commands and file edits.`, already: `${r.data?.path} is already writable in this session.`, read_only: `This session is read-only: it can read ${r.data?.path}, but writing there needs a higher permission mode the user picks.`, full_access: "This session runs in full access and can already work anywhere; nothing was needed.", cancelled: "The user closed the folder picker without choosing; nothing was granted.", declined }[r.outcome])),
  tool("change_directory", "Move this session to another project folder on this computer: from the next turn its commands, relative paths and project instructions run there. The user sees and approves the folder (not in full access). Not for a session working in its own worktree.",
    { path: { ...PATH, description: "Absolute path of the folder (~ is the home folder)." } }, ["path"], change,
    ["moving", "declined"], (args, r) => r.outcome === "moving" ? `This session moves to ${r.data?.path} once this call returns; use absolute paths for the rest of this turn.` : declined),
];

const HOST = toolTable(SPEC);
export const HOST_TOOL_NAMES = HOST.names;
export const HOST_TOOLS = HOST.tools;
/** Their path is a folder anywhere on this computer, not a file inside the session's folder. */
export const HOST_FOLDER_TOOLS = Object.freeze(["request_directory", "change_directory"]);
/** The ones whose call may wait on the user's card. */
export const HOST_ASKS = Object.freeze(["open_in_editor", "reveal_path", "request_keep_awake", "clean_up_worktrees", "discard_kept_worktree", "request_directory", "change_directory"]);
export const hostInput = HOST.input;
export const hostReceipt = HOST.receipt;
export const hostResult = HOST.result;
