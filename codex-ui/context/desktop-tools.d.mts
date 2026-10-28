export type DesktopPane = "files" | "diff" | "terminal" | "plan" | "background" | "browser";
export type DesktopTool = "get_ui_state" | "show_pane" | "set_session_title" | "enter_plan_mode" | "start_session" | "dismiss_task" | "send_message";
export type Initiation = "user_asked" | "own_initiative" | "offer";
export interface StartArgs { initiation?: Initiation; proposal_id?: string; title?: string; prompt?: string; context?: "fresh" | "fork"; background?: string; wake_when_done?: boolean; name?: string; use_worktree?: boolean; model?: string; effort?: string; permission_mode?: "read-only" | "auto" | "full-access"; target?: "local" | "cloud"; environment?: string; cwd?: string }
export interface DesktopArgs extends StartArgs { pane?: DesktopPane; offset?: number; targetId?: string; path?: string; line?: number; task_id?: string; to?: string; message?: string }
export interface DesktopRequest { id: string; threadId: string; cwd: string; name: DesktopTool; args: DesktopArgs; deadline: number; browserEnabled: boolean }
export interface DesktopTarget { id: string; label: string }
export interface DesktopPaneState { pane: DesktopPane; available: boolean; open: boolean; expanded: boolean }
export interface DesktopState { threadId: string; cwd: string; currentView: boolean; panes: DesktopPaneState[]; pane?: DesktopPane; targets?: DesktopTarget[]; offset?: number; nextOffset?: number | null; total?: number }
export interface DesktopShown { threadId: string; cwd: string; pane: DesktopPane; applied: true; displayed: boolean }
export interface DesktopRenamed { threadId: string; cwd: string; title: string; previousTitle?: string; previousTitleSource?: "auto" | "user" | "tool"; outcome: "renamed" | "unchanged" | "declined" }
export interface DesktopPlanMode { threadId: string; cwd: string; outcome: "entered" | "already" | "declined" | "unavailable" }
export interface SessionTask { taskId: string; title?: string }
/** start_session's receipt (sessions.mjs START): one outcome and what its text names. */
export interface DesktopStarted {
  threadId: string; cwd: string;
  outcome: "proposed" | "started" | "cloud" | "offer_accepted" | "offer_started" | "kept" | "typed_past" | "unstarted" | "abandoned" | "no_card";
  taskId?: string; title?: string; sessionId?: string; name?: string; worktree?: "own" | "shared" | "none" | "fork"; ignored?: string[];
  displaced?: SessionTask[]; waiting?: SessionTask[]; cloud?: boolean; reason?: "nobody" | "muted" | "always_here";
}
export interface DesktopDismissed { threadId: string; cwd: string; taskId: string; outcome: "dismissed" | "already_started" | "already_dismissed" | "expired" | "spawn_in_flight" | "not_found" }
/** send_message's receipt: the session it went to and whether it was busy then. */
export interface DesktopSent { threadId: string; cwd: string; outcome: "sent"; sessionId: string; title: string; busy: boolean }
export type DesktopResult = DesktopState | DesktopShown | DesktopRenamed | DesktopPlanMode | DesktopStarted | DesktopDismissed | DesktopSent;
export interface DesktopReceipt { id: string; result?: DesktopResult; error?: { code: string; message: string } }
export const DESKTOP_PANES: readonly DesktopPane[];
export const SESSION_TOOLS: readonly DesktopTool[];
export const DESKTOP_TOOLS: readonly { name: string; description: string; inputSchema: object; annotations: object }[];
export function desktopError(code: string, message: string): Error & { code: string };
export function validateDesktopInput(name: string, value: unknown): DesktopArgs;
export function validateDesktopResult(name: string, value: unknown, request: DesktopRequest): DesktopResult;
