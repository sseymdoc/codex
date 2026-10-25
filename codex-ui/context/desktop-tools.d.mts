export type DesktopPane = "files" | "diff" | "terminal" | "plan" | "background" | "browser";
export type DesktopTool = "get_ui_state" | "show_pane";
export interface DesktopArgs { pane?: DesktopPane; offset?: number; targetId?: string; path?: string; line?: number }
export interface DesktopRequest { id: string; threadId: string; cwd: string; name: DesktopTool; args: DesktopArgs; deadline: number; browserEnabled: boolean }
export interface DesktopTarget { id: string; label: string }
export interface DesktopPaneState { pane: DesktopPane; available: boolean; open: boolean; expanded: boolean }
export interface DesktopState { threadId: string; cwd: string; currentView: boolean; panes: DesktopPaneState[]; pane?: DesktopPane; targets?: DesktopTarget[]; offset?: number; nextOffset?: number | null; total?: number }
export interface DesktopShown { threadId: string; cwd: string; pane: DesktopPane; applied: true; displayed: boolean }
export interface DesktopReceipt { id: string; result?: DesktopState | DesktopShown; error?: { code: string; message: string } }
export const DESKTOP_PANES: readonly DesktopPane[];
export const DESKTOP_TOOLS: readonly { name: string; description: string; inputSchema: object; annotations: object }[];
export function desktopError(code: string, message: string): Error & { code: string };
export function validateDesktopInput(name: string, value: unknown): DesktopArgs;
export function validateDesktopResult(name: string, value: unknown, request: DesktopRequest): DesktopState | DesktopShown;
