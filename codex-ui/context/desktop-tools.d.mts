export type DesktopPane = "files" | "diff" | "terminal" | "plan" | "background" | "browser";
export type DesktopTool = "get_ui_state" | "show_pane" | "set_session_title" | "enter_plan_mode";
export interface DesktopArgs { pane?: DesktopPane; offset?: number; targetId?: string; path?: string; line?: number; title?: string }
export interface DesktopRequest { id: string; threadId: string; cwd: string; name: DesktopTool; args: DesktopArgs; deadline: number; browserEnabled: boolean }
export interface DesktopTarget { id: string; label: string }
export interface DesktopPaneState { pane: DesktopPane; available: boolean; open: boolean; expanded: boolean }
export interface DesktopState { threadId: string; cwd: string; currentView: boolean; panes: DesktopPaneState[]; pane?: DesktopPane; targets?: DesktopTarget[]; offset?: number; nextOffset?: number | null; total?: number }
export interface DesktopShown { threadId: string; cwd: string; pane: DesktopPane; applied: true; displayed: boolean }
export interface DesktopRenamed { threadId: string; cwd: string; title: string; previousTitle?: string; previousTitleSource?: "auto" | "user" | "tool"; outcome: "renamed" | "unchanged" | "declined" }
export interface DesktopPlanMode { threadId: string; cwd: string; outcome: "entered" | "already" | "declined" | "unavailable" }
export type DesktopResult = DesktopState | DesktopShown | DesktopRenamed | DesktopPlanMode;
export interface DesktopReceipt { id: string; result?: DesktopResult; error?: { code: string; message: string } }
export const DESKTOP_PANES: readonly DesktopPane[];
export const DESKTOP_TOOLS: readonly { name: string; description: string; inputSchema: object; annotations: object }[];
export function desktopError(code: string, message: string): Error & { code: string };
export function validateDesktopInput(name: string, value: unknown): DesktopArgs;
export function validateDesktopResult(name: string, value: unknown, request: DesktopRequest): DesktopResult;
