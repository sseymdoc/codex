export declare const WORKTREE_TOOL_NAMES: readonly ["sync_with_base_branch", "enter_worktree"];
export type WorktreeToolName = typeof WORKTREE_TOOL_NAMES[number];
export declare const WORKTREE_WAIT_MS: number;
export declare const WORKTREE_TOOLS: { name: WorktreeToolName; description: string; inputSchema: object; annotations: object }[];

export interface WorktreeArgs { base?: string }

export type WorktreeReceipt =
  | { threadId: string; cwd: string; outcome: "entered"; worktree: string; base: string | null }
  | { threadId: string; cwd: string; outcome: "already" | "not_deferred" }
  | { threadId: string; cwd: string; outcome: "up_to_date" | "merged" | "conflicts" | "dirty" | "merging"; target?: string; fetched?: boolean | null; head?: string; files?: string[]; count?: number };

export declare function worktreeInput(name: string, value: Record<string, unknown>): WorktreeArgs;
export declare function worktreeReceipt(name: string, value: any, request: { args: WorktreeArgs }, invalid: () => never): WorktreeReceipt;
export declare function worktreeResult(name: string, args: WorktreeArgs, receipt: any): { content: { type: "text"; text: string }[]; _meta?: Record<string, unknown> };
