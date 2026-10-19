// The rail's 上下文 breakdown (c2d611398 le): Codex's context parts as the bridge reads them from the
// thread's rollout (server/context-usage.mjs), laid out the way Claude lays out Claude Code's
// get_context_usage report. Categories keep Claude's names, which Claude shows untranslated.

import type { Tool } from "@protocol/Tool";

/** server/context-usage.mjs readContextUsage: tokens per part of the current window. */
export interface ContextParts {
  usedTokens: number;
  windowTokens: number | null;
  /** The model loads MCP tools by search: their definitions wait outside the window. */
  mcpDeferred: boolean;
  system: number;
  tools: number;
  skills: number;
  agents: number;
  memory: number;
  mcp: number;
  apps: number;
}

/** The thread's parts, or null before its first request has finished. */
export async function readContextParts(rollout: string): Promise<ContextParts | null> {
  const response = await fetch(`/api/context-usage?path=${encodeURIComponent(rollout)}`);
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  return response.json();
}

/**
 * Where Codex compacts on its own (openai_models.rs auto_compact_token_limit): at 90% of the
 * model's window, or at the configured limit when that is lower. The window Codex reports is the
 * usable 95% of it (effective_context_window_percent).
 */
export function autoCompactAt(window: number | null, configured?: number | null): number | null {
  // ponytail: assumes the default 95%; read the model's own percent if a catalog ever changes it.
  const own = window ? Math.floor((Math.round((window * 100) / 95) * 9) / 10) : null;
  if (!configured) return own;
  return own === null ? configured : Math.min(configured, own);
}

const bytes = (text: string) => new TextEncoder().encode(text).length;

/** One MCP tool's definition as Codex sends it, estimated like the rest (4 bytes a token). */
export function mcpToolTokens(server: string, tool: Tool): number {
  return Math.ceil(bytes(JSON.stringify({ name: `mcp__${server}__${tool.name}`, description: tool.description ?? "", parameters: tool.inputSchema })) / 4);
}

export interface Row {
  name: string;
  tokens: number;
}

export interface LegendRow extends Row {
  id: string;
  /** A meter series, a free-space tint or the muted swatch of a part outside the window. */
  color: string;
  deferred?: boolean;
}

export interface Segment extends Row {
  id: string;
  color: string;
}

export interface Breakdown {
  legend: LegendRow[];
  meter: Segment[];
  /** What the meter spans: the window, or more once the parts outgrow it. */
  total: number;
  lists: { key: "mcp" | "memory"; label: string; rows: Row[] }[];
}

/** c2d611398 ce: past six segments the smallest parts share one, Other. */
const SEGMENTS = 6;
const series = (index: number) => `var(--cds-chart-${index + 1})`;
const OTHER = "var(--cds-chart-reference)";
const MUTED = "var(--cds-chart-muted)";
const TINT = "var(--cds-chart-reference-tint)";

/**
 * The legend, meter and lists (c2d611398 le / de). Messages is the live total less the other
 * parts, so the meter agrees with the headline while a turn runs; the parts sort largest first,
 * then the auto-compact buffer, the free space and what waits outside the window.
 */
export function contextBreakdown(parts: ContextParts, used: number, window: number, compactAt: number | null, mcpTools: Row[]): Breakdown {
  const fixed: Row[] = [
    { name: "System prompt", tokens: parts.system },
    { name: "System tools", tokens: parts.tools },
    { name: "MCP tools", tokens: parts.mcp },
    { name: "Skills", tokens: parts.skills },
    { name: "Memory files", tokens: parts.agents + parts.memory },
    { name: "MCP server instructions", tokens: parts.apps },
  ];
  const overhead = fixed.reduce((sum, row) => sum + row.tokens, 0);
  const inside = [{ name: "Messages", tokens: Math.max(0, used - overhead) }, ...fixed].filter((row) => row.tokens > 0).sort((a, b) => b.tokens - a.tokens);
  // More than `used` only while a compaction has reset the count until the next request.
  const filled = Math.max(used, overhead);
  const buffer = compactAt !== null && compactAt < window ? window - compactAt : null;
  const free = Math.max(0, window - filled - (buffer ?? 0));
  const deferred = parts.mcpDeferred ? mcpTools.reduce((sum, row) => sum + row.tokens, 0) : 0;
  const lumped = inside.length + (buffer === null ? 0 : 1) > SEGMENTS;
  const colored = lumped ? SEGMENTS - 1 - (buffer === null ? 0 : 1) : inside.length;

  const legend: LegendRow[] = inside.map((row, index) => ({ ...row, id: `used-${index}`, color: index < colored ? series(index) : OTHER }));
  if (buffer !== null) legend.push({ id: "buffer", name: "Autocompact buffer", tokens: buffer, color: MUTED });
  legend.push({ id: "free", name: "Free space", tokens: free, color: TINT });
  if (deferred > 0) legend.push({ id: "deferred", name: "MCP tools (deferred)", tokens: deferred, color: MUTED, deferred: true });

  const meter: Segment[] = legend.slice(0, colored);
  if (lumped) meter.push({ id: "other", name: "Other", tokens: inside.slice(colored).reduce((sum, row) => sum + row.tokens, 0), color: OTHER });
  if (buffer !== null) meter.push({ id: "buffer", name: "Autocompact buffer", tokens: buffer, color: MUTED });

  const memory = [
    { name: "AGENTS.md", tokens: parts.agents },
    { name: "Codex 记忆", tokens: parts.memory },
  ].filter((row) => row.tokens > 0);
  const lists: Breakdown["lists"] = [];
  if (mcpTools.length > 0) lists.push({ key: "mcp", label: "MCP 工具", rows: mcpTools });
  if (memory.length > 0) lists.push({ key: "memory", label: "记忆文件", rows: memory });

  return { legend, meter, total: Math.max(window, filled + (buffer ?? 0) + free) || 1, lists };
}
