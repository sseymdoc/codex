import type { ManageReceipt } from "./manage-tools.mjs";
export declare const HOST_TOOL_NAMES: readonly ["open_in_editor", "reveal_path", "request_keep_awake", "get_storage_usage", "clean_up_worktrees", "discard_kept_worktree", "request_directory", "change_directory"];
export type HostToolName = typeof HOST_TOOL_NAMES[number];
export declare const HOST_TOOLS: { name: HostToolName; description: string; inputSchema: object; annotations: object }[];
export declare const HOST_FOLDER_TOOLS: readonly HostToolName[];
export declare const HOST_ASKS: readonly HostToolName[];
export declare function hostInput(name: string, value: Record<string, unknown>): Record<string, unknown>;
export declare function hostReceipt(name: string, value: any, request: unknown, invalid: () => never): ManageReceipt;
export declare function hostResult(name: string, args: Record<string, unknown>, receipt: ManageReceipt): { isError?: true; content: { type: "text"; text: string }[] };
