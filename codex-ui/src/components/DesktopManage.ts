// The renderer's side of codex_ui_desktop's management tools (context/manage-tools.mjs), after
// Claude 4.4212's ccd_session_mgmt, ccd_sidebar, ccd_view and ccd_connectors: what each does with
// Codex UI's own actions, and when it asks the user first (a card like set_setting's).
// Asking: reading never asks; changing another session asks unless this one runs in full access,
// except stopping, restoring or detaching one this session started; deleting and raising a
// permission mode always ask.

import type { Thread } from "@protocol/v2/Thread";
import { desktopError, type DesktopRequest, type DesktopResult } from "../../context/desktop-tools.mjs";
import {
  activeTurn,
  archiveThread,
  call,
  createSection,
  deleteSection,
  deleteThread,
  effectiveSettings,
  ensureThreads,
  exportThread,
  fastAvailable,
  interrupt,
  isArchivedThread,
  listConnectors,
  markRead,
  markUnread,
  moveToSection,
  refreshMcp,
  refreshRateLimits,
  reloadMcpServers,
  searchThreadContent,
  searchThreads,
  setConnectorEnabled,
  setListFilter,
  setOverride,
  unarchiveThread,
  updateSection,
} from "../lib/codex";
import { autoCompactAt } from "../lib/context";
import { threadMarkdown, threadTitle } from "../lib/format";
import { detachLink } from "../lib/linked";
import { closePane, layoutOf } from "../lib/panes";
import { taskText } from "../lib/redact";
import { askSettingConsent, getState, isShown, isUnread, markCompleted, setSessionView, type PermissionPreset, type ThreadState } from "../lib/store";
import { sidebarTools } from "./Sidebar";

type Args = Record<string, unknown>;
type Check = () => ThreadState;

const PERMISSIONS: PermissionPreset[] = ["read-only", "auto", "full-access"];
const titleOf = (meta: Thread) => taskText(threadTitle(meta)).slice(0, 200);
const iso = (seconds: number | null | undefined) => (seconds ? new Date(seconds * 1000).toISOString() : undefined);
const running = (thread: ThreadState) => !!activeTurn(thread) || thread.meta.status.type === "active";

/** "self" or a listed session (sub-agents are never one), loaded if the list has not paged it in. */
async function sessionOf(threadId: string, id: string, self = true): Promise<ThreadState> {
  const target = id === "self" ? threadId : id;
  if (target === threadId && !self) throw desktopError("INVALID_TARGET", "Not for this session; pass another session's id.");
  if (!getState().threads[target]) await ensureThreads([target]);
  const thread = getState().threads[target];
  if (!thread || thread.meta.parentThreadId) throw desktopError("SESSION_NOT_FOUND", `No session with id ${id}; use an id from list_sessions.`);
  return thread;
}

const startedBy = (threadId: string, id: string) => getState().links[id]?.parentId === threadId;

/** A card the user allows or declines; full access skips it unless `always`. */
async function ask(request: DesktopRequest, check: Check, signal: AbortSignal, title: string, rows: [string, string][], always = false): Promise<boolean> {
  if (!always && effectiveSettings(check()).permission === "full-access") return true;
  const allowed = await askSettingConsent(request.threadId, { id: request.id, label: "", from: "", to: "", title, action: "管理会话", rows }, signal);
  check();
  return allowed;
}

function row(threadId: string, thread: ThreadState) {
  const { meta } = thread;
  const link = getState().links[meta.id];
  return {
    sessionId: meta.id,
    title: titleOf(meta),
    cwd: thread.settings?.cwd ?? meta.cwd,
    archived: isArchivedThread(meta.id),
    running: running(thread),
    waiting: sidebarTools.waiting(meta.id),
    unread: isUnread(thread),
    pinned: sidebarTools.pinned().includes(meta.id),
    group: meta.section ? { id: meta.section.id, name: taskText(meta.section.name) } : null,
    createdAt: iso(meta.createdAt),
    lastActivityAt: iso(meta.recencyAt ?? meta.updatedAt),
    ...(link?.parentId === threadId && { name: link.name, permissionMode: effectiveSettings(thread).permission }),
  };
}

function contextOf(thread: ThreadState) {
  const usage = thread.tokenUsage;
  if (!usage) return { available: false };
  const window = usage.modelContextWindow ?? null;
  const configured = getState().config?.model_auto_compact_token_limit;
  return { available: true, used: usage.last.totalTokens, window, autoCompactAt: autoCompactAt(window, configured ? Number(configured) : null) };
}

/** One management tool's call, as a receipt for manageReceipt. */
export async function manageRequest(request: DesktopRequest, args: Args, check: Check, signal: AbortSignal): Promise<DesktopResult> {
  const { threadId, cwd } = request;
  const done = (outcome: string, data?: unknown) => ({ threadId, cwd, outcome, ...(data !== undefined && { data }) }) as DesktopResult;
  const s = getState();
  const str = (key: string) => args[key] as string;
  switch (request.name) {
    // --- ccd_view
    case "close_pane": {
      const pane = str("pane") as Parameters<typeof closePane>[0];
      if (!isShown(s, threadId)) return done("not_shown");
      if (!layoutOf(threadId).open.includes(pane)) return done("not_open");
      closePane(pane, threadId);
      return done("closed");
    }
    case "set_transcript_view": {
      const target = await sessionOf(threadId, str("session_id"));
      const id = target.meta.id;
      if (id !== threadId && !startedBy(threadId, id)) throw desktopError("INVALID_TARGET", "Only this session's view, or that of a session it started; the user switches any other from that session's own menu.");
      const view = str("view") as "normal" | "thinking" | "verbose";
      if ((target.view ?? s.defaultView) === view) return done("unchanged");
      setSessionView(id, view);
      return done("switched");
    }
    // --- ccd_sidebar
    case "list_groups": {
      const counts = new Map<string, number>();
      for (const thread of Object.values(s.threads)) if (thread.meta.section && !thread.meta.parentThreadId) counts.set(thread.meta.section.id, (counts.get(thread.meta.section.id) ?? 0) + 1);
      return done("listed", s.sections.map((section, order) => ({ id: section.id, name: taskText(section.name), session_count: counts.get(section.id) ?? 0, order })));
    }
    case "create_group": {
      const section = await createSection(str("name"), null);
      return done("created", { id: section.id });
    }
    case "rename_group":
    case "delete_group": {
      const section = s.sections.find((x) => x.id === str("group_id"));
      if (!section) throw desktopError("GROUP_NOT_FOUND", "No group has that id. Call list_groups for the current ids.");
      if (request.name === "rename_group") {
        if (section.name === str("name")) return done("unchanged");
        if (!(await ask(request, check, signal, "允许 Codex 重命名侧边栏分组吗？", [["分组", taskText(section.name)], ["新名称", str("name")]]))) return done("declined");
        await updateSection(section.id, str("name"), section.appearance?.color ?? null);
        return done("renamed");
      }
      if (!(await ask(request, check, signal, "允许 Codex 删除侧边栏分组吗？", [["分组", taskText(section.name)], ["其中的会话", "移回未分组，不会删除"]]))) return done("declined");
      await deleteSection(section.id);
      return done("deleted");
    }
    case "move_sessions": {
      const groupId = args.group_id as string | null;
      const section = groupId === null ? null : s.sections.find((x) => x.id === groupId);
      if (section === undefined) throw desktopError("GROUP_NOT_FOUND", "No group has that id. Call list_groups for the current ids.");
      const targets = await Promise.all((args.session_ids as string[]).map((id) => sessionOf(threadId, id)));
      const others = targets.filter((thread) => thread.meta.id !== threadId);
      if (others.length && !(await ask(request, check, signal, "允许 Codex 更改其他会话在侧边栏中的位置吗？", [["会话", others.map((t) => titleOf(t.meta)).join("、")], ["移至", section ? taskText(section.name) : "未分组"]]))) return done("declined");
      for (const thread of targets) {
        if (section && sidebarTools.pinned().includes(thread.meta.id)) sidebarTools.setPinned([thread.meta.id], false);
        await moveToSection(thread.meta.id, section?.id ?? null);
      }
      if (section && sidebarTools.groupBy() !== "custom") sidebarTools.setGroupBy("custom");
      return done("moved", { moved: targets.length });
    }
    case "set_pinned":
    case "set_unread":
    case "mark_completed": {
      const target = await sessionOf(threadId, str("session_id"));
      const id = target.meta.id;
      const other = id !== threadId;
      if (request.name === "mark_completed") {
        const stamp = sidebarTools.ackStamp(id);
        if (!stamp || s.completedAcks[id] === stamp) return done("nothing");
        if (other && !(await ask(request, check, signal, "允许 Codex 将其他会话标记为已完成吗？", [["会话", titleOf(target.meta)]]))) return done("declined");
        markCompleted(id, stamp);
        return done("marked");
      }
      const on = request.name === "set_pinned" ? (args.pinned as boolean) : (args.unread as boolean);
      const now = request.name === "set_pinned" ? sidebarTools.pinned().includes(id) : isUnread(target);
      if (now === on) return done("unchanged");
      const what = request.name === "set_pinned" ? (on ? "置顶" : "取消置顶") : on ? "标记为未读" : "标记为已读";
      if (other && !(await ask(request, check, signal, `允许 Codex ${what}其他会话吗？`, [["会话", titleOf(target.meta)]]))) return done("declined");
      if (request.name === "set_pinned") sidebarTools.setPinned([id], on);
      else await (on ? markUnread(id) : markRead(id));
      return done("changed");
    }
    case "set_view": {
      if (args.group_by) sidebarTools.setGroupBy(args.group_by as "date" | "project" | "custom" | "none");
      if (args.status || args.sort_by) setListFilter({ ...(args.status ? { status: args.status as "active" | "archived" | "all" } : {}), ...(args.sort_by ? { sort: args.sort_by as "recency" | "alpha" | "created" } : {}) });
      const list = getState().list;
      return done("changed", { group_by: sidebarTools.groupBy(), status: list.status, sort_by: list.sort });
    }
    // --- ccd_session_mgmt
    case "list_sessions": {
      const limit = (args.limit as number | undefined) ?? 50;
      const found = await searchThreads(str("query") ?? "", args.archived === true, Math.min(200, limit + 1));
      const threads = getState().threads;
      const family = args.family_only === true ? new Set([...Object.entries(getState().links).filter(([, link]) => link.parentId === threadId).map(([id]) => id), getState().links[threadId]?.parentId]) : null;
      const rows = found.filter((meta) => meta.id !== threadId && !meta.parentThreadId && threads[meta.id] && (!family || family.has(meta.id))).slice(0, limit).map((meta) => row(threadId, threads[meta.id]));
      return done("listed", rows);
    }
    case "get_session": {
      const target = await sessionOf(threadId, str("session_id"));
      const settings = effectiveSettings(target);
      const own = target.meta.id === threadId || startedBy(threadId, target.meta.id);
      return done("found", { ...row(threadId, target), model: settings.model, effort: settings.effort, ...(own && { permissionMode: settings.permission }), fastMode: settings.serviceTier === "priority" ? "on" : "off", context: contextOf(target) });
    }
    case "search_session_transcripts": {
      const hits = await searchThreadContent(str("query"), args.archived === true);
      return done("found", hits.filter(({ thread }) => thread.id !== threadId && !thread.parentThreadId).map(({ thread, snippet }) => ({ sessionId: thread.id, title: titleOf(thread), snippet: snippet ? taskText(snippet).slice(0, 400) : null })));
    }
    case "list_events": {
      const target = await sessionOf(threadId, str("session_id"), false);
      const page = await call("thread/turns/list", { threadId: target.meta.id, cursor: str("before") ?? null, limit: (args.limit as number | undefined) ?? 10, sortDirection: "desc", itemsView: "full" });
      let text = threadMarkdown(titleOf(target.meta), page.data.slice().reverse());
      // The newest 64 KiB: the start goes.
      if (text.length > 65536) text = `…${text.slice(-65536)}`;
      return done("read", { sessionId: target.meta.id, title: titleOf(target.meta), text: taskText(text), ...(page.nextCursor && { cursor: page.nextCursor }) });
    }
    case "archive_session": {
      const target = await sessionOf(threadId, str("session_id"));
      const id = target.meta.id;
      if (isArchivedThread(id)) throw desktopError("ALREADY", "That session is already archived.");
      if (id !== threadId && running(target)) throw desktopError("BUSY", "That session is still working; nothing was archived. Wait or ask the user.");
      if (sidebarTools.pinned().includes(id)) throw desktopError("PINNED", "That session is pinned, so it was not archived. Ask the user; they can unpin it or archive it from the sidebar.");
      if (id !== threadId && isShown(s, id)) throw desktopError("ON_SCREEN", "That session is open on the user's screen, so it was not archived. Ask the user.");
      if (!(await ask(request, check, signal, id === threadId ? "允许 Codex 归档此会话吗？" : "允许 Codex 归档另一个会话吗？", [["会话", titleOf(target.meta)]]))) return done("declined");
      await archiveThread(id);
      return done("archived");
    }
    case "unarchive_session":
    case "stop_session": {
      const target = await sessionOf(threadId, str("session_id"), false);
      const id = target.meta.id;
      const mine = startedBy(threadId, id);
      if (request.name === "unarchive_session") {
        if (!isArchivedThread(id)) return done("already");
        if (!mine && !(await ask(request, check, signal, "允许 Codex 取消归档另一个会话吗？", [["会话", titleOf(target.meta)]]))) return done("declined");
        await unarchiveThread(id);
        return done("restored");
      }
      if (!activeTurn(target)) return done("idle");
      if (!mine && !(await ask(request, check, signal, "允许 Codex 停止另一个会话的当前回合吗？", [["会话", titleOf(target.meta)]]))) return done("declined");
      await interrupt(id);
      return done("stopped");
    }
    case "delete_session": {
      const ids = (args.session_ids as string[]).map((id) => (id === "self" ? threadId : id));
      if (ids.includes(threadId)) throw desktopError("INVALID_TARGET", "Never this session.");
      await ensureThreads(ids.filter((id) => !getState().threads[id]));
      const threads = getState().threads;
      const skipped: { sessionId: string; reason: string }[] = [];
      const doomed = ids.filter((id) => {
        const thread = threads[id];
        const reason = !thread || thread.meta.parentThreadId ? "not found" : running(thread) ? "working" : sidebarTools.pinned().includes(id) ? "pinned" : isShown(getState(), id) ? "open on screen" : null;
        if (reason) skipped.push({ sessionId: id, reason });
        return !reason;
      });
      if (!doomed.length) return done("deleted", { deleted: [], skipped });
      if (!(await ask(request, check, signal, `允许 Codex 永久删除 ${doomed.length} 个会话吗？`, [["会话", doomed.map((id) => titleOf(threads[id].meta)).join("、")], ["注意", "删除后无法恢复"]], true))) return done("declined");
      const deleted: string[] = [];
      for (const id of doomed) {
        try {
          await deleteThread(id);
          deleted.push(id);
        } catch (error) {
          skipped.push({ sessionId: id, reason: error instanceof Error ? error.message.slice(0, 200) : "failed" });
        }
      }
      return done("deleted", { deleted, skipped });
    }
    case "set_session_model":
    case "set_session_effort": {
      const target = await sessionOf(threadId, str("session_id"), false);
      const id = target.meta.id;
      const settings = effectiveSettings(target), mine = effectiveSettings(check());
      if (request.name === "set_session_model") {
        const wanted = str("model");
        const model = s.models.find((m) => m.id === wanted || m.model === wanted);
        if (!model) throw desktopError("UNKNOWN_MODEL", `No model ${wanted}. The app offers: ${s.models.map((m) => m.id).join(", ")}.`);
        if (settings.model === model.id) return done("unchanged");
        if (!(startedBy(threadId, id) && model.id === mine.model) && !(await ask(request, check, signal, "允许 Codex 更改另一个会话的模型吗？", [["会话", titleOf(target.meta)], ["模型", `${settings.model ?? "默认"} → ${model.displayName}`]]))) return done("declined");
        await setOverride(id, { model: model.id });
        return done("changed", { model: model.id });
      }
      const effort = str("effort").toLowerCase();
      const levels = s.models.find((m) => m.id === settings.model)?.supportedReasoningEfforts.map((option) => option.reasoningEffort) ?? [];
      if (levels.length && !levels.includes(effort as never)) throw desktopError("UNKNOWN_EFFORT", `That session's model takes: ${levels.join(", ")}.`);
      if (settings.effort === effort) return done("unchanged");
      const rank = (level: string | null) => (level ? levels.indexOf(level as never) : -1);
      if (!(startedBy(threadId, id) && rank(effort) <= rank(mine.effort)) && !(await ask(request, check, signal, "允许 Codex 更改另一个会话的推理强度吗？", [["会话", titleOf(target.meta)], ["推理强度", `${settings.effort ?? "默认"} → ${effort}`]]))) return done("declined");
      await setOverride(id, { effort });
      return done("changed");
    }
    case "set_session_permission_mode": {
      const target = await sessionOf(threadId, str("session_id"));
      const id = target.meta.id;
      const mode = str("mode") as PermissionPreset;
      if (mode === "full-access" && !s.allowFullAccess) throw desktopError("UNAVAILABLE", "Full access is turned off in Settings → Codex (允许绕过权限模式); only the user can turn it on.");
      const now = effectiveSettings(target).permission;
      if (now === mode) return done("unchanged");
      const raise = now === null || PERMISSIONS.indexOf(mode) > PERMISSIONS.indexOf(now);
      const own = id === threadId || startedBy(threadId, id);
      if ((raise || !own) && !(await ask(request, check, signal, "允许 Codex 更改会话的权限模式吗？", [["会话", titleOf(target.meta)], ["权限模式", `${now ?? "自定义"} → ${mode}`]], raise))) return done("declined");
      await setOverride(id, { permission: mode });
      return done("changed");
    }
    case "set_session_fast_mode": {
      const target = await sessionOf(threadId, str("session_id"));
      const settings = effectiveSettings(target);
      const on = args.enabled as boolean;
      if (on && !fastAvailable(settings.model)) throw desktopError("UNAVAILABLE", "That session's model does not offer fast mode.");
      if ((settings.serviceTier === "priority") === on) return done("unchanged");
      if (on && !(await ask(request, check, signal, "允许 Codex 开启快速模式吗？", [["会话", titleOf(target.meta)], ["说明", "快速模式按更高费率计费，并写入 config.toml"]]))) return done("declined");
      await setOverride(target.meta.id, { serviceTier: on ? "priority" : "default" });
      return done("changed");
    }
    case "detach_session": {
      const target = await sessionOf(threadId, str("session_id"));
      const id = target.meta.id;
      const parent = getState().links[id]?.parentId;
      if (!parent || (id !== threadId && parent !== threadId)) throw desktopError("INVALID_TARGET", "Only a session this session started, or this one when another session started it.");
      detachLink(id);
      sidebarTools.detach(id);
      return done("detached");
    }
    case "get_usage": {
      const target = await sessionOf(threadId, str("session_id"));
      await refreshRateLimits();
      const limits = getState().rateLimits;
      const plan = limits ? [limits.rateLimits, ...Object.values(limits.rateLimitsByLimitId ?? {})].filter((x, i, all) => x && all.indexOf(x) === i).map((x) => ({ name: x!.limitName ?? x!.limitId ?? "codex", primary: x!.primary, secondary: x!.secondary })) : "not available (an API key or another provider)";
      return done("found", { plan, context: contextOf(target) });
    }
    case "export_transcript": {
      const target = await sessionOf(threadId, str("session_id"));
      await exportThread(target.meta.id);
      return done("exported", { title: titleOf(target.meta) });
    }
    // --- ccd_connectors
    case "session_connectors_status": {
      await refreshMcp(threadId).catch(() => {});
      const runtime = check().mcp;
      const servers = (getState().mcp ?? []).map((server) => ({ name: server.name, state: runtime[server.name]?.status ?? "unknown", tools: Object.keys(server.tools ?? {}).length, signIn: server.authStatus === "notLoggedIn" }));
      const connectors = (await listConnectors(threadId)).map((c) => ({ id: c.id, name: taskText(c.name), enabled: c.enabled, accessible: c.callable }));
      return done("listed", { servers, connectors });
    }
    case "set_session_connector_enabled": {
      const connectors = getState().connectors ?? (await listConnectors(threadId));
      const connector = connectors.find((c) => c.id === str("connector_id"));
      if (!connector) throw desktopError("NOT_FOUND", "No connector has that id; session_connectors_status lists them.");
      const on = args.enabled as boolean;
      if (connector.enabled === on) return done("unchanged");
      if (!(await ask(request, check, signal, `允许 Codex ${on ? "开启" : "关闭"}连接器吗？`, [["连接器", taskText(connector.name)], ["说明", "也会成为新会话的默认设置"]]))) return done("declined");
      await setConnectorEnabled(connector.id, on);
      return done("changed");
    }
    case "reconnect_session_connector": {
      const server = (getState().mcp ?? []).find((x) => x.name === str("server"));
      if (!server) throw desktopError("NOT_FOUND", "No MCP server by that name; session_connectors_status lists them.");
      if (server.authStatus === "notLoggedIn") throw desktopError("NEEDS_SIGN_IN", `${server.name} needs the user to sign in: ask them to choose 验证身份 on it in the session rail's 连接器 card.`);
      await reloadMcpServers();
      return done("reconnecting");
    }
  }
  throw desktopError("UNKNOWN_TOOL", "Unknown tool.");
}
