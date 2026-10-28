// codex_ui_desktop's worktree tools: bringing a worktree session up to date with the branch it was
// cut from, and the worktree a session that defers it makes before its first change. Schemas,
// argument and receipt checks, result text. No I/O.

export const WORKTREE_TOOL_NAMES = Object.freeze(["sync_with_base_branch", "enter_worktree"]);
/** A fetch and a merge can take a while. */
export const WORKTREE_WAIT_MS = 300_000;

export const WORKTREE_TOOLS = [
  { name: "sync_with_base_branch", description: "Bring this session's git worktree up to date with the branch it was cut from: fetch that branch (when it has a remote) and merge it into HEAD. base names another branch to merge, such as the pull request's base. Refused while there are uncommitted changes (commit first; never discard the user's work to sync). On conflicts the merge stays under way and the conflicted files are listed: resolve them, git add and git commit, or git merge --abort. Only for sessions in a worktree Codex UI made.",
    inputSchema: { type: "object", additionalProperties: false, properties: { base: { type: "string", maxLength: 250, description: "Optional branch to merge instead of the recorded base branch." } } },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true } },
  { name: "enter_worktree", description: "For a session that defers its worktree (this turn's context says so): create the session's git worktree from the current checkout's HEAD before your first change to any file. Codex UI moves the session there once the call returns, and the move takes effect from the next turn, so end this turn right after it with one short sentence and no further tool calls; the app then continues the task in the worktree. Uncommitted changes in the user's checkout do not come along.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
];

const refuse = (message) => { throw Object.assign(new Error(message), { code: "INVALID_INPUT" }); };
const BRANCH = /^(?!-)[^\s\0~^:?*[\\]{1,250}$/;

export function worktreeInput(name, value) {
  if (!WORKTREE_TOOL_NAMES.includes(name)) refuse("Unknown worktree tool.");
  const allowed = name === "sync_with_base_branch" ? ["base"] : [];
  const extra = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extra.length) refuse(`Unknown ${name} arguments: ${extra.join(", ")}.`);
  if (value.base === undefined) return {};
  const base = typeof value.base === "string" ? value.base.trim() : "";
  if (!BRANCH.test(base) || base.includes("..")) refuse("base must be a branch name.");
  return { base };
}

const short = (entry, max) => typeof entry === "string" && entry.length > 0 && entry.length <= max;

export function worktreeReceipt(name, value, request, invalid) {
  if (name === "enter_worktree") {
    if (Object.keys(value).some((key) => !["threadId", "cwd", "outcome", "worktree", "base"].includes(key)) || !["entered", "already", "not_deferred"].includes(value.outcome)) invalid();
    if (value.outcome === "entered" ? !short(value.worktree, 4096) || (value.base !== null && !short(value.base, 250)) : value.worktree !== undefined || value.base !== undefined) invalid();
    return value;
  }
  if (Object.keys(value).some((key) => !["threadId", "cwd", "outcome", "target", "fetched", "head", "files", "count"].includes(key))) invalid();
  if (!["up_to_date", "merged", "conflicts", "dirty", "merging"].includes(value.outcome)) invalid();
  if (value.target !== undefined && !short(value.target, 300)) invalid();
  if (value.fetched !== undefined && value.fetched !== null && typeof value.fetched !== "boolean") invalid();
  if (value.head !== undefined && !/^[0-9a-f]{40,64}$/.test(value.head)) invalid();
  if (value.files !== undefined && (!Array.isArray(value.files) || value.files.length > 1000 || !value.files.every((file) => short(file, 4096)))) invalid();
  if (value.count !== undefined && (!Number.isSafeInteger(value.count) || value.count < 0)) invalid();
  return value;
}

const listed = (files) => `${files.slice(0, 50).join(", ")}${files.length > 50 ? ` and ${files.length - 50} more` : ""}`;

export function worktreeResult(name, args, receipt) {
  const text = (body, meta) => ({ content: [{ type: "text", text: body }], ...(meta && { _meta: meta }) });
  if (name === "enter_worktree") {
    if (receipt.outcome === "already") return text("This session already works in its own worktree (or is moving there); carry on.");
    if (receipt.outcome === "not_deferred") return text("This session does not defer its worktree; work where you are.");
    return text(`Created a git worktree at ${receipt.worktree} from the checkout's HEAD${receipt.base ? ` (base branch ${receipt.base})` : ""}. Codex UI moves this session there once this turn ends: end this turn now with one short sentence and no further tool calls, and change nothing in this turn. Uncommitted changes in the user's checkout are not in the worktree.`, { codexUiWorktree: "entered" });
  }
  const fetchNote = receipt.fetched === false ? " (fetching it failed, so the local copy was used)" : "";
  switch (receipt.outcome) {
    case "up_to_date": return text(`Already up to date with ${receipt.target}${fetchNote}; nothing was merged.`);
    case "merged": return text(`Merged ${receipt.target}${fetchNote} into this worktree; HEAD is now ${receipt.head}.`);
    case "conflicts": return text(`Merging ${receipt.target}${fetchNote} stopped on conflicts in: ${listed(receipt.files)}. The merge is still under way: resolve the conflict markers, git add those files and git commit, or run git merge --abort to back out.`);
    case "dirty": return text(`Not synced: ${receipt.count} uncommitted change${receipt.count === 1 ? "" : "s"} in this worktree. Commit your work first; never discard the user's changes to sync.`);
    default: return text(`A merge is already under way${receipt.files?.length ? ` (conflicts in: ${listed(receipt.files)})` : ""}. Resolve and commit it, or git merge --abort, before syncing again.`);
  }
}
