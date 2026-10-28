export declare const WINDOW_TOOL_NAMES: readonly ["get_window_layout", "open_session_in", "close_split"];
export type WindowToolName = typeof WINDOW_TOOL_NAMES[number];
export declare const WINDOW_TOOLS: { name: WindowToolName; description: string; inputSchema: object; annotations: object }[];

export interface WindowArgs { session_id?: string; place?: "beside" | "here" }

export type WindowReceipt =
  | { threadId: string; cwd: string; columns: { sessionId: string; title: string; focused: boolean }[] }
  | { threadId: string; cwd: string; sessionId: string; place: "beside" | "here"; outcome: "opened" | "already" }
  | { threadId: string; cwd: string; outcome: "closed" | "no_split" };

export declare function windowInput(name: string, value: Record<string, unknown>): WindowArgs;
export declare function windowReceipt(name: string, value: any, request: { args: WindowArgs }, invalid: () => never): WindowReceipt;
export declare function windowResult(name: string, args: WindowArgs, receipt: any): { content: { type: "text"; text: string }[] };
