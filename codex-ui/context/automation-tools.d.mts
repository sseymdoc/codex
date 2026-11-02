export declare const AUTOMATION_TOOL_NAMES: readonly ["automation_update", "cloud_task_update"];
export type AutomationToolName = typeof AUTOMATION_TOOL_NAMES[number];
export declare const AUTOMATION_MODES: readonly ["list", "view", "create", "update", "delete", "suggested_create", "suggested_update", "run", "runs"];
export declare const CLOUD_TASK_MODES: readonly ["list", "create", "update", "pause", "resume", "delete"];
export declare const CRON_FIELDS: readonly ("cwds" | "executionEnvironment" | "model" | "reasoningEffort" | "autoArchive")[];
export declare const LIST_MAX: number;
export declare const AUTOMATION_TOOLS: { name: AutomationToolName; description: string; inputSchema: object; annotations: object }[];

/** automation_update's arguments once checked (cwds resolved by the host to existing absolute folders). */
export interface AutomationArgs {
  mode: typeof AUTOMATION_MODES[number];
  id?: string;
  kind?: "heartbeat" | "cron";
  name?: string;
  prompt?: string;
  rrule?: string;
  status?: "ACTIVE" | "PAUSED";
  notificationPolicy?: "failed_runs_only" | null;
  targetThreadId?: string;
  cwds?: string[];
  executionEnvironment?: "local" | "worktree";
  model?: string;
  reasoningEffort?: string;
  autoArchive?: boolean;
}

export interface CloudTaskArgs {
  mode: typeof CLOUD_TASK_MODES[number];
  id?: string;
  title?: string;
  prompt?: string;
  rrule?: string;
  fireAt?: string;
  timezone?: string;
}

/** A local task as the tool reports it. Times are ISO. */
export interface LocalTask {
  id: string; kind?: "heartbeat" | "cron"; name?: string; prompt?: string; status?: "ACTIVE" | "PAUSED"; schedule?: string; rrule?: string;
  nextRunAt?: string | null; lastRunAt?: string | null; notificationPolicy?: "failed_runs_only" | null; targetThreadId?: string;
  cwds?: string[]; executionEnvironment?: "local" | "worktree"; model?: string | null; reasoningEffort?: string | null; autoArchive?: boolean;
}
export interface CloudTask { id: string; title?: string; prompt?: string; schedule?: string; until?: string; timezone?: string; status?: "active" | "paused" | "completed"; nextRunAt?: string | null }

export type AutomationReceipt =
  | { threadId: string; cwd: string; outcome: "listed"; tasks: (LocalTask | CloudTask)[] }
  | { threadId: string; cwd: string; outcome: "viewed" | "created" | "updated" | "deleted" | "paused" | "resumed" | "started"; task: LocalTask | CloudTask }
  | { threadId: string; cwd: string; outcome: "runs"; task: LocalTask; runs: { sessionId: string; status: string; title: string | null; startedAt: string; updatedAt: string; read: boolean; summary: string | null }[] }
  | { threadId: string; cwd: string; outcome: "declined"; task: Partial<LocalTask | CloudTask> };

export declare function automationInput(name: string, value: Record<string, unknown>): AutomationArgs | CloudTaskArgs;
export declare function kindFields(kind: "heartbeat" | "cron", args: AutomationArgs): void;
export declare function automationAsks(args: AutomationArgs, origin: string): boolean;
export declare function automationReceipt(name: string, value: any, request: { args: any }, invalid: () => never): AutomationReceipt;
export declare function automationResult(name: string, args: any, receipt: any): { isError?: boolean; content: { type: "text"; text: string }[]; _meta?: { codexUiAutomationTask: { id?: string; name?: string } } };
/** The task a call was about, as its transcript row names it (a cloud task's title as its name). */
export interface AutomationTask { id?: string; name: string }
export declare function automationTask(value: unknown): AutomationTask | undefined;
export declare function resultTask(result: { _meta?: unknown } | null | undefined): AutomationTask | undefined;
