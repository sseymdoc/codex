import type { Thread } from "../../codex-rs/app-server-protocol/schema/typescript/v2/Thread.ts";

import type { CodexUiContext } from "../../codex-rs/app-server-protocol/schema/typescript/CodexUiContext.ts";
export type HostContext = CodexUiContext;
export function hostContext(cwd: string, planCard: boolean, capabilities?: { toolsEnabled?: boolean; autoVerify?: boolean; desktopContext?: boolean; desktopTools?: boolean; hostContextV2?: boolean; hostContextMaxBytes?: number; workflows?: { enabled: boolean; ultracode: boolean } }): HostContext;
/** One turn's opt-in when its message carries the "ultracode" keyword. */
export const WORKFLOW_KEYWORD: string;
/** Host text past this needs a backend that holds more (initialize codexUiHostContextMaxBytes). */
export const LEGACY_HOST_TEXT_BYTES: number;

export interface GitSnapshot {
  cwd: string;
  capturedAt: string;
  state: "repository" | "not-repository" | "unavailable";
  info: Thread["gitInfo"];
  base: string | null;
  files: number | null;
}

export function planningConfig(planCard: boolean, developerInstructions?: string | null): {
  "tools.update_plan.enabled": boolean;
  developer_instructions?: string;
};

export const BROWSER_VERIFICATION_GUIDANCE: string;

export function appendDeveloperInstructions<T extends Record<string, unknown>>(config: T, instruction: string): Omit<T, "developer_instructions"> & {
  developer_instructions: string;
};

export function gitContext(snapshot: GitSnapshot): {
  "codex-ui.git": { kind: "untrusted"; value: string };
  "codex-ui.git-guidance": { kind: "application"; value: string };
};
