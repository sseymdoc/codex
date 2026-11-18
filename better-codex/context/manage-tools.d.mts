export declare const MANAGE_TOOL_NAMES: readonly ["close_pane", "set_transcript_view", "list_groups", "create_group", "rename_group", "delete_group", "move_sessions", "set_pinned", "set_unread", "mark_completed", "set_view", "list_sessions", "get_session", "search_session_transcripts", "list_events", "archive_session", "unarchive_session", "stop_session", "delete_session", "set_session_model", "set_session_effort", "set_session_permission_mode", "set_session_fast_mode", "detach_session", "get_usage", "export_transcript", "session_connectors_status", "set_session_connector_enabled", "reconnect_session_connector"];
export type ManageToolName = typeof MANAGE_TOOL_NAMES[number];
export declare const MANAGE_ASKS: readonly ManageToolName[];
export declare const MANAGE_TOOLS: { name: ManageToolName; description: string; inputSchema: object; annotations: object }[];
/** A management call's receipt: one of the tool's outcomes and what its text needs. */
export interface ManageReceipt { threadId: string; cwd: string; outcome: string; data?: unknown }

export interface ToolSpec { name: string; description: string; properties: Record<string, object>; required: string[]; annotations: object; outcomes: string[]; text(args: Record<string, unknown>, receipt: ManageReceipt): string }
export declare const ID: object;
export declare const SESSION: object;
export declare const read: object;
export declare const change: object;
export declare function tool(name: string, description: string, properties: Record<string, object>, required: string[], annotations: object, outcomes: string[], text: ToolSpec["text"]): ToolSpec;
export declare function json(args: Record<string, unknown>, receipt: ManageReceipt): string;
export declare function quote(text: string): string;
export declare const declined: string;
export declare function toolTable(spec: ToolSpec[]): {
  names: readonly string[];
  tools: { name: string; description: string; inputSchema: object; annotations: object }[];
  input(name: string, value: Record<string, unknown>): Record<string, unknown>;
  receipt(name: string, value: any, request: unknown, invalid: () => never): ManageReceipt;
  result(name: string, args: Record<string, unknown>, receipt: ManageReceipt): { isError?: true; content: { type: "text"; text: string }[] };
};
export declare function manageInput(name: string, value: Record<string, unknown>): Record<string, unknown>;
export declare function manageReceipt(name: string, value: any, request: unknown, invalid: () => never): ManageReceipt;
export declare function manageResult(name: string, args: Record<string, unknown>, receipt: ManageReceipt): { isError?: true; content: { type: "text"; text: string }[] };
