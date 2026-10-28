import type { WorkflowAgent } from "@protocol/WorkflowAgent";
import type { WorkflowItem } from "@protocol/WorkflowItem";
import type { WorkflowStatus } from "@protocol/WorkflowStatus";

/** c62da1b56 le: an agent with no progress for this long reads stalled. */
export const STALL_MS = 90_000;
/** c62da1b56 S: the group holding agents that named no phase. */
export const UNPHASED = 2 ** 53 - 1;

/** A cell's state (c62da1b56 x); `ghost` is the anticipating cell only. */
export type CellState = "done" | "running" | "stalled" | "error" | "stopped" | "pending";
export interface Counts { done: number; running: number; stalled: number; error: number; stopped: number; pending: number; total: number }
export type PhaseStatus = "pending" | "running" | "done" | "error" | "notRun";
export interface Phase { index: number; title: string; agents: WorkflowAgent[]; counts: Counts; status: PhaseStatus; totalTokens: number; maxDurationMs?: number }
export interface Progress { counts: Counts; phases: Phase[]; totalTokens: number }
export interface CellOptions { now?: number; stallMs?: number; taskStopped?: boolean }

/** The task side of a run (Claude's task status): live runs are running; a declined run never ran. */
export type RunStatus = "running" | "completed" | "failed" | "stopped";

export const EMPTY_COUNTS: Counts = { done: 0, running: 0, stalled: 0, error: 0, stopped: 0, pending: 0, total: 0 };

/** c62da1b56 de: started once it reports progress or has a start time. */
function started(agent: WorkflowAgent): boolean {
  return agent.state === "progress" || (agent.state === "start" && agent.startedAtMs !== undefined);
}

/** c62da1b56 x. */
export function cellState(agent: WorkflowAgent, options?: CellOptions): CellState {
  if (agent.state === "done") return "done";
  if (options?.taskStopped) return agent.error ? "error" : "stopped";
  if (agent.state === "error") return "error";
  if (started(agent)) {
    const now = options?.now;
    const stallMs = options?.stallMs ?? STALL_MS;
    return now !== undefined && agent.lastProgressAtMs !== undefined && now - agent.lastProgressAtMs > stallMs ? "stalled" : "running";
  }
  return "pending";
}

/** c62da1b56 fe: a stalled agent counts as running too. */
function tally(counts: Counts, agent: WorkflowAgent, options?: CellOptions) {
  counts.total += 1;
  const state = cellState(agent, options);
  if (state === "stalled") {
    counts.running += 1;
    counts.stalled += 1;
  } else counts[state] += 1;
}

/** c62da1b56 pe: per-agent cells in display order. */
export function agentCells(agents: WorkflowAgent[], options?: CellOptions): { label: string; state: CellState }[] {
  return agents.map((agent) => ({ label: agent.label, state: cellState(agent, options) }));
}

/** c62da1b56 me. */
function phaseStatus(counts: Counts, settled: boolean): PhaseStatus {
  if (counts.error > 0) return "error";
  if (counts.running > 0) return settled ? "done" : "running";
  if (counts.total === 0 || counts.pending === counts.total) return settled ? "notRun" : "pending";
  return counts.done === counts.total || settled ? "done" : "running";
}

/**
 * c62da1b56 he: phases from the run's groups and its agents, each agent under its phase (or the
 * unphased group, named 智能体 / 其他智能体 as c3fef5c6f PC names it).
 */
export function progress(item: Pick<WorkflowItem, "phases" | "agents">, options?: CellOptions & { settled?: boolean }): Progress | undefined {
  if (!item.phases.length && !item.agents.length) return undefined;
  const settled = options?.settled ?? false;
  const phases: Phase[] = [];
  const byIndex = new Map<number, Phase>();
  const group = (index: number, title?: string) => {
    let phase = byIndex.get(index);
    if (phase) {
      if (title && phase.title.startsWith("Phase ")) phase.title = title;
    } else {
      phase = { index, title: title ?? `Phase ${index + 1}`, agents: [], counts: { ...EMPTY_COUNTS }, status: "pending", totalTokens: 0, maxDurationMs: undefined };
      byIndex.set(index, phase);
      phases.push(phase);
    }
    return phase;
  };
  for (const phase of item.phases) group(phase.index, phase.title);
  const counts = { ...EMPTY_COUNTS };
  let totalTokens = 0;
  for (const agent of item.agents) {
    const phase = agent.phaseIndex === undefined ? group(UNPHASED) : group(agent.phaseIndex, agent.phaseTitle);
    phase.agents.push(agent);
    tally(phase.counts, agent, options);
    tally(counts, agent, options);
    if (agent.tokens) {
      phase.totalTokens += agent.tokens;
      totalTokens += agent.tokens;
    }
    if (agent.durationMs !== undefined) phase.maxDurationMs = Math.max(phase.maxDurationMs ?? 0, agent.durationMs);
  }
  const unphased = byIndex.get(UNPHASED);
  if (unphased) unphased.title = phases.length > 1 ? "其他智能体" : "智能体";
  for (const phase of phases) phase.status = phaseStatus(phase.counts, settled);
  phases.sort((a, b) => a.index - b.index);
  return { counts, phases, totalTokens };
}

/** c62da1b56 Tt: agents still going when a run ended read as failed (no error when stopped). */
export function settleAgents(agents: WorkflowAgent[], status: RunStatus): WorkflowAgent[] {
  let changed = false;
  const next = agents.map((agent) => {
    if (!(started(agent) || (agent.state === "start" && (agent.tokens ?? 0) > 0))) return agent;
    changed = true;
    return { ...agent, state: "error" as const, error: agent.error ?? (status === "stopped" ? undefined : "Workflow ended before completion") };
  });
  return changed ? next : agents;
}

/**
 * A run as a task: pending approval is pre-launch (running), declined never ran (failed). A run
 * this server no longer runs (`live` false) ended with it (c62da1b56 Y: stopped).
 */
export function runStatus(status: WorkflowStatus, live = true): RunStatus {
  switch (status) {
    case "pending":
    case "running":
      return live ? "running" : "stopped";
    case "completed":
      return "completed";
    case "stopped":
      return "stopped";
    default:
      return "failed";
  }
}

/** The run with its task status applied, as the panel and card read it. */
export function settledRun(item: WorkflowItem, live = true): WorkflowItem & { run: RunStatus } {
  const run = runStatus(item.status, live);
  if (run === "running" || !(item.status === "pending" || item.status === "running")) return { ...item, run };
  return { ...item, run, agents: settleAgents(item.agents, run) };
}

/** c62da1b56 Se: a summary's own words, without the "Dynamic workflow "…" completed:" lead-in. */
export function summaryText(summary: string | undefined, description: string): string | undefined {
  if (!summary || summary === description) return undefined;
  const match = summary.match(/^(?:Dynamic w|W)orkflow ".*" (?:completed|failed|stopped|was killed)(?::\s*(.+))?\.?\s*$/s);
  const text = match ? match[1]?.trim() : summary;
  return text ? text[0].toUpperCase() + text.slice(1) : undefined;
}

/** c3fef5c6f Nx: cells per state when there are more agents than cells, each present state kept. */
function share(counts: Counts, cap: number): Omit<Counts, "stalled" | "total"> {
  if (counts.total <= cap) return { done: counts.done, running: counts.running, error: counts.error, stopped: counts.stopped, pending: counts.pending };
  const order = ["done", "running", "error", "stopped", "pending"] as const;
  const out = { done: 0, running: 0, error: 0, stopped: 0, pending: 0 };
  let used = 0;
  for (const state of order) {
    if (counts[state] > 0 && used < cap) {
      out[state] = 1;
      used += 1;
    }
  }
  const rest = cap - used;
  if (rest > 0) {
    const exact = order.map((state) => (counts[state] / counts.total) * rest);
    const floors = exact.map(Math.floor);
    let sum = floors.reduce((a, b) => a + b, 0);
    const byFraction = exact.map((value, i) => ({ i, frac: value - floors[i] })).sort((a, b) => b.frac - a.frac);
    for (let k = 0; k < byFraction.length && sum < rest; k++) {
      floors[byFraction[k].i] += 1;
      sum += 1;
    }
    order.forEach((state, i) => { out[state] += floors[i]; });
  }
  return out;
}

/** c3fef5c6f Px: the cell states, stalled drawn only when every agent has its own cell. */
export function compressedCells(counts: Counts, cap: number): CellState[] {
  const n = share(counts, cap);
  const stalled = counts.total <= cap ? Math.min(counts.stalled, n.running) : 0;
  const runs: [CellState, number][] = [["done", n.done], ["running", n.running - stalled], ["stalled", stalled], ["error", n.error], ["stopped", n.stopped], ["pending", n.pending]];
  return runs.flatMap(([state, count]) => Array.from({ length: count }, () => state));
}

/** c3fef5c6f Fx: the grid's accessible summary (2ZhM3AN1KC / ANPBErKpM2 / puP9QWxX+t). */
export function gridSummary(counts: Counts): string {
  if (counts.total === 0) return "正在等待智能体启动";
  if (counts.stopped > 0) return `${counts.total} 个智能体中已完成 ${counts.done} 个，已停止 ${counts.stopped} 个，失败 ${counts.error} 个`;
  return `${counts.total} 个智能体中已完成 ${counts.done} 个，运行中 ${counts.running - counts.stalled} 个，已停滞 ${counts.stalled} 个，失败 ${counts.error} 个`;
}

/** c3fef5c6f Rx: running cells pulse out of step, by golden-ratio phase. */
export function pulseStyle(index: number): { "--epitaxy-pulse-dur": string; "--epitaxy-pulse-delay": string } {
  const phase = (index * 0.61803398875) % 1;
  const duration = 2.4 + ((index * 0.7548776662) % 1) * 1.4;
  return { "--epitaxy-pulse-dur": `${duration.toFixed(2)}s`, "--epitaxy-pulse-delay": `${(-phase * duration).toFixed(2)}s` };
}

const UNITS: ["day" | "hour" | "minute" | "second", number][] = [["day", 86_400], ["hour", 3600], ["minute", 60], ["second", 1]];

/**
 * c3fef5c6f Qx (zh-CN, shared-frame nW with padTrailingUnits): the largest unit above 0 and the two
 * after it, the trailing ones two digits (12秒, 3分钟 05秒, 1小时 02分钟 03秒).
 */
export function elapsed(ms: number): string {
  let left = Number.isFinite(ms) ? Math.max(0, Math.round(ms / 1000)) : 0;
  const parts = UNITS.map(([unit, size]) => {
    const count = Math.floor(left / size);
    left -= count * size;
    return [unit, count] as const;
  });
  const first = parts.findIndex(([, count]) => count > 0);
  return (first === -1 ? parts.slice(-1) : parts.slice(first, first + 3))
    .map(([unit, count], index) => new Intl.NumberFormat("zh-CN", { style: "unit", unit, unitDisplay: "narrow", minimumIntegerDigits: index > 0 ? 2 : 1 }).format(count))
    .join(" ");
}

/** The workflow run items of a thread's turns, latest snapshot each. */
export function workflowRuns(turns: { items: { type: string }[] }[]): WorkflowItem[] {
  const runs = new Map<string, WorkflowItem>();
  for (const turn of turns)
    for (const item of turn.items)
      if (item.type === "workflow") {
        const run = item as unknown as WorkflowItem;
        runs.set(run.runId, run);
      }
  return [...runs.values()];
}
