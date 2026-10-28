export declare const PR_TOOL_NAMES: readonly ["get_pr_status", "bind_pr", "unbind_pr", "set_auto_merge", "set_pr_monitor"];
export type PrToolName = typeof PR_TOOL_NAMES[number];
export declare const PR_MAX: number;
export declare const PR_TOOLS: { name: PrToolName; description: string; inputSchema: object; annotations: object }[];

export interface PrArgs { pr?: string; enabled?: boolean }

/** A pull request as the tools report it; its title and check names are untrusted. */
export interface PrInfo {
  url: string;
  number: number;
  title: string;
  state: "open" | "draft" | "merged" | "closed";
  review_decision: "approved" | "changes_requested" | "review_required" | null;
  checks: { status: "failed" | "passed" | "pending" | "skipped" | "unavailable"; total: number; passed: number; failed: number; pending: number; skipped: number; failing: string[] };
  conflicts: boolean;
  merge_state: string | null;
  unresolved_threads: number | null;
  auto_merge: boolean;
  auto_fix: boolean;
  head_sha: string | null;
  head_branch: string | null;
  base_branch: string | null;
}

export type PrReceipt =
  | { threadId: string; cwd: string; pullRequests: PrInfo[]; problem?: string }
  | { threadId: string; cwd: string; outcome: "bound" | "already"; pullRequest: PrInfo }
  | { threadId: string; cwd: string; outcome: "unbound" | "not_bound" | "on" | "off" | "unchanged"; url: string };

export declare function prInput(name: string, value: Record<string, unknown>): PrArgs;
export declare function prReceipt(name: string, value: any, request: { args: PrArgs }, invalid: () => never): PrReceipt;
export declare function prResult(name: string, args: PrArgs, receipt: any): { content: { type: "text"; text: string }[] };
