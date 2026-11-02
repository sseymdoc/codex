// The renderer's side of codex_ui_desktop's host and folder tools (context/host-tools.mjs), after
// Claude 4.4212's ccd_host and ccd_directory. Opening, revealing, keeping awake and folders ask
// first except in full access; removing worktrees asks in every mode. Paths arrive resolved and
// checked by server/desktop-tools.mjs (a kept worktree's by server/storage.mjs).

import { desktopError, type DesktopRequest, type DesktopResult } from "../../context/desktop-tools.mjs";
import { addWritableRoot, changeThreadFolder, effectiveSettings, ensureThreads, environmentKind, inWorktreeRoot, keepAwakeForTurn, onReceipt } from "../lib/codex";
import { installedEditors, openIn, revealFile } from "../lib/files";
import { inactiveWorktrees, readStorage, removeWorktrees } from "../lib/storage";
import { askSettingConsent, getState, setKeepAwake, type ThreadState } from "../lib/store";
import { sidebarTools } from "./Sidebar";

type Args = Record<string, unknown>;
type Check = () => ThreadState;

/** Sessions that allowed a keep-awake hold once already (Claude asks once per session). */
const awakeAllowed = new Set<string>();

async function ask(request: DesktopRequest, check: Check, signal: AbortSignal, title: string, rows: [string, string][], always = false): Promise<boolean> {
  if (!always && effectiveSettings(check()).permission === "full-access") return true;
  const allowed = await askSettingConsent(request.threadId, { id: request.id, label: "", from: "", to: "", title, action: "这台电脑", rows }, signal);
  check();
  return allowed;
}

export async function hostRequest(request: DesktopRequest, args: Args, check: Check, signal: AbortSignal): Promise<DesktopResult> {
  const { threadId, cwd } = request;
  const done = (outcome: string, data?: unknown) => ({ threadId, cwd, outcome, ...(data !== undefined && { data }) }) as DesktopResult;
  const path = args.path as string;
  switch (request.name) {
    case "open_in_editor": {
      const editors = await installedEditors();
      const wanted = args.editor as string | undefined;
      const editor = wanted ? editors.find((entry) => entry.id === wanted) : editors.length === 1 ? editors[0] : undefined;
      if (!editors.length) throw desktopError("NO_EDITOR", "No supported editor (VS Code, Cursor, Windsurf or Zed) is installed; tell the user the path instead.");
      if (!editor) throw desktopError("CHOOSE_EDITOR", wanted ? `${wanted} is not installed. Installed: ${editors.map((entry) => entry.id).join(", ")}.` : `The user has several editors installed: ${editors.map((entry) => `${entry.name} (${entry.id})`).join(", ")}. Ask which they'd like, then call again with editor.`);
      if (!(await ask(request, check, signal, `允许 Codex 在 ${editor.name} 中打开文件吗？`, [["文件", path]]))) return done("declined");
      if (!(await openIn(path, editor.id, args.line as number | undefined))) throw desktopError("OPEN_FAILED", `${editor.name} could not be asked to open the file; tell the user the path instead.`);
      return done("opened", { editor: editor.name });
    }
    case "reveal_path": {
      if (!(await ask(request, check, signal, "允许 Codex 在文件管理器中显示此项吗？", [["路径", path]]))) return done("declined");
      if (!(await revealFile(path))) throw desktopError("REVEAL_FAILED", "The file manager could not show it; it may have been moved or deleted.");
      return done("revealed");
    }
    case "request_keep_awake": {
      const until = args.until as "turn_end" | "session_idle";
      if (until === "turn_end") {
        const desktop = await window.codexDesktop?.getDesktopSettings?.().catch(() => null);
        if (desktop?.keepAwake) return done("covered");
        if (!check().turns.some((turn) => turn.status === "inProgress")) return done("no_turn");
      }
      if (!awakeAllowed.has(threadId) && !getState().keepAwake.has(threadId)) {
        if (!(await ask(request, check, signal, "允许 Codex 让电脑保持唤醒吗？", [["原因", args.reason as string], ["持续", until === "turn_end" ? "直到本轮结束" : "直到您在会话菜单中关闭"]]))) return done("declined");
        awakeAllowed.add(threadId);
      }
      if (until === "turn_end") return done(keepAwakeForTurn(threadId) ? "held" : "no_turn");
      setKeepAwake(threadId, true);
      return done("held");
    }
    case "get_storage_usage": {
      const usage = await readStorage(true);
      return done("found", { ...usage, worktrees: usage.worktrees.map((tree) => ({ path: tree.path, repository: tree.repository, session: tree.owner, uncommittedChanges: tree.changes, bytes: tree.bytes })) });
    }
    case "clean_up_worktrees":
    case "discard_kept_worktree": {
      const usage = await readStorage(true);
      const force = request.name === "discard_kept_worktree" || args.include_uncommitted === true;
      let trees;
      if (request.name === "discard_kept_worktree") {
        const tree = usage.worktrees.find((entry) => entry.path === path);
        if (!tree) throw desktopError("NOT_FOUND", "No session worktree at that path; get_storage_usage lists them.");
        trees = [tree];
      } else {
        await ensureThreads(usage.worktrees.flatMap((tree) => (tree.owner ? [tree.owner] : [])));
        trees = inactiveWorktrees(usage, (args.older_than_days as number | undefined) ?? 30, sidebarTools.pinned()).filter((tree) => force || tree.changes === 0);
        if (!trees.length) return done("nothing");
      }
      const lost = trees.filter((tree) => tree.changes !== 0).length;
      const rows: [string, string][] = [["工作树", trees.map((tree) => tree.path).join("\n")], ...(lost ? [["注意", `其中 ${lost} 个有未提交的更改，移除后无法恢复`] as [string, string]] : []), ["保留", "会话、对话与已提交的分支"]];
      if (!(await ask(request, check, signal, `允许 Codex 移除 ${trees.length} 个工作树吗？`, rows, true))) return done("declined");
      const result = await removeWorktrees(trees.map((tree) => tree.path), force);
      if (request.name === "discard_kept_worktree" && !result.removed.length) throw desktopError("REMOVE_FAILED", `Not removed: ${result.skipped[0]?.reason ?? "unknown"}.`);
      return done("removed", result);
    }
    case "request_directory": {
      const { permission } = effectiveSettings(check());
      if (permission === "full-access") return done("full_access");
      let folder = path;
      if (!folder) {
        folder = (await window.codexDesktop?.pickFolder?.(cwd)) ?? "";
        check();
        if (!folder) return done("cancelled");
      } else if (permission !== "read-only" && !(await ask(request, check, signal, "允许 Codex 写入此文件夹吗？", [["文件夹", folder]]))) return done("declined");
      const outcome = await addWritableRoot(threadId, folder);
      if (outcome === "custom") throw desktopError("CUSTOM_PROFILE", "This session uses a custom permission profile, so a folder can't be added from here; ask the user to change it in Settings.");
      return done(outcome === "full_access" ? "full_access" : outcome, { path: folder });
    }
    case "change_directory": {
      if (inWorktreeRoot(cwd)) throw desktopError("WORKTREE", "This session works in its own worktree, so its folder can't be moved. Use request_directory to work with that folder from here instead.");
      if (environmentKind(threadId) === "ssh") throw desktopError("REMOTE", "This session runs on a remote host, so its folder can't be moved from here.");
      if (!(await ask(request, check, signal, "允许 Codex 将此会话移到另一个文件夹吗？", [["当前", cwd], ["移到", path]]))) return done("declined");
      // The binding is to this folder: the move waits for this answer to reach the bridge.
      onReceipt(request.id, () => void changeThreadFolder(threadId, path));
      return done("moving", { path });
    }
  }
  throw desktopError("UNKNOWN_TOOL", "Unknown tool.");
}
