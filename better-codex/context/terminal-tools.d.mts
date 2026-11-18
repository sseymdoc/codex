export declare const TERMINAL_TOOL_NAMES: readonly ["list_terminal_tabs", "open_terminal_tab", "run_in_terminal", "read_terminal", "stop_terminal_tab"];
export type TerminalToolName = typeof TERMINAL_TOOL_NAMES[number];
export declare const TAB_ID: RegExp;
export declare const COMMAND_MAX: number;
export declare const WAIT_MAX: number;
export declare const LINES_DEFAULT: number;
export declare const LINES_MAX: number;
export declare const STATES: readonly ["running", "exited", "not_started"];
export declare const TERMINAL_TOOLS: { name: TerminalToolName; description: string; inputSchema: object; annotations: object }[];

export interface TerminalArgs {
  command?: string;
  tab_id?: string;
  title?: string;
  cwd?: string;
  wait_for_output_ms?: number;
  lines?: number;
  mode?: "interrupt" | "kill";
}

/** A tab as the tools report it; the label is untrusted. */
export interface TerminalTabInfo {
  tab_id: string;
  label: string;
  state: typeof STATES[number];
  folder: string;
  selected: boolean;
  /** Codex opened it, or ran a command in it. */
  codex: boolean;
}

export interface TerminalOutput {
  text: string;
  lines: number;
  truncated: boolean;
  screen: "normal" | "alternate";
  /** With a wait: whether output went quiet before it ended. */
  settled?: boolean;
}

export type TerminalReceipt =
  | { threadId: string; cwd: string; tabs: TerminalTabInfo[] }
  | { threadId: string; cwd: string; outcome: "opened" | "ran"; tab: TerminalTabInfo; output?: TerminalOutput }
  | { threadId: string; cwd: string; outcome: "declined" }
  | { threadId: string; cwd: string; tab: TerminalTabInfo; output: TerminalOutput }
  | { threadId: string; cwd: string; tab: TerminalTabInfo; outcome: "interrupted" | "killed" | "not_running" };

export declare function terminalInput(name: string, value: Record<string, unknown>): TerminalArgs;
export declare function terminalWait(name: string, args: TerminalArgs, timeouts: { timeoutMs: number; consentMs: number }): number;
export declare function terminalReceipt(name: string, value: any, request: { args: TerminalArgs }, invalid: () => never): TerminalReceipt;
export declare function terminalResult(name: string, args: TerminalArgs, receipt: any): { isError?: boolean; content: { type: "text"; text: string }[] };
