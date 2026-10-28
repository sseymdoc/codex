// Dynamic workflow runs (Claude's Workflow tool, c3fef5c6f): the transcript card with its agent
// grid (oS / Gx), the ended run's line (IC), and the run's detail in 后台任务 (PC: phases SS, agent
// table bS / xS). Flag-off layout: the panels redesign (CC) is not drawn.

import type { WorkflowAgent } from "@protocol/WorkflowAgent";
import type { WorkflowItem } from "@protocol/WorkflowItem";
import { useEffect, useState, type CSSProperties } from "react";
import { backgroundTasks, type BackgroundTask } from "../lib/background";
import { openBackgroundTask, useStopping } from "../lib/background-view";
import { modelLabel, stopBackgroundTask } from "../lib/codex";
import { formatTokens } from "../lib/format";
import { getState } from "../lib/store";
import { agentCells, compressedCells, EMPTY_COUNTS, elapsed, gridSummary, progress, pulseStyle, settledRun, summaryText, UNPHASED, type CellState, type Counts, type Phase, type PhaseStatus, type RunStatus } from "../lib/workflow";
import { checkRun } from "../lib/workflow-runs";
import { Button, Icon, ShimmerText, Spinner, useNow } from "./ui";

/** c3fef5c6f jx / Mx: a cell's tooltip. */
const CELL_LABELS: Record<CellState | "ghost", string> = {
  done: "已完成",
  running: "运行中",
  stalled: "已停滞",
  error: "失败",
  stopped: "已停止",
  pending: "排队中",
  ghost: "可能会出现更多智能体",
};

/** c3fef5c6f cS: a phase's status. */
const PHASE_LABELS: Record<PhaseStatus, string> = { pending: "待处理", running: "运行中", done: "已完成", error: "错误", notRun: "未运行" };

/** c3fef5c6f AC: the run's ended status. */
const RUN_LABELS: Record<RunStatus, string> = { running: "运行中", completed: "已完成", stopped: "已停止", failed: "失败" };

/** c3fef5c6f yS: an agent table with no agents. */
const NO_AGENTS: Record<RunStatus, string> = { running: "尚无智能体启动", completed: "此阶段未运行任何智能体", stopped: "已在任何智能体启动前停止", failed: "在任何智能体启动前失败" };

/** c3fef5c6f Cx / Dx / Ox / kx: cell size and how many fit a row or a wrapped grid. */
const CELL = 6;
const GAP = 2;
const PITCH = 8;
const ROW_CAP = 36;
const WRAP_CAP = 35;

/** c3fef5c6f Kx: {n} 个智能体 with the number in secondary ink (muted when ended). */
function AgentCount({ counts, muted = false }: { counts: Counts; muted?: boolean }) {
  return <span className="wf-nowrap"><span className={muted ? undefined : "wf-ink"}>{counts.total}</span> 个智能体</span>;
}

/** c3fef5c6f iS: a run or agent's live clock. */
function Clock({ startedAt }: { startedAt: number }) {
  const now = useNow(true);
  return <span className="tabular">{elapsed(Math.max(0, now - startedAt))}</span>;
}

/**
 * c3fef5c6f Gx (with zx cells and Wx's tooltips): one 6px cell per agent while they fit, else
 * cells shared out by state; `anticipate` adds the pulsing ghost of agents still to come.
 */
export function AgentGrid({ counts, wrap = false, maxRows = 4, cols, anticipate = false, agents }: { counts: Counts; wrap?: boolean; maxRows?: number; cols?: number; anticipate?: boolean; agents?: { label: string; state: CellState }[] }) {
  const cap = cols ? Infinity : wrap ? WRAP_CAP * maxRows : ROW_CAP;
  const own = agents && agents.length === counts.total && counts.total <= cap;
  const states = own ? agents.map((agent) => agent.state) : compressedCells(counts, cap);
  const summary = gridSummary(counts);
  const style: CSSProperties = cols
    ? { gridTemplateColumns: `repeat(${cols}, ${CELL}px)`, gap: GAP }
    : wrap
      ? { gridTemplateColumns: `repeat(auto-fill, ${CELL}px)`, gap: GAP, ...(Number.isFinite(maxRows) ? { maxHeight: maxRows * PITCH - GAP } : null) }
      : { gridTemplateColumns: `repeat(auto-fill, ${CELL}px)`, gap: GAP, maxHeight: CELL };
  const cells = [
    ...states.map((state, index) => (
      <span
        key={index}
        className={`wf-cell wf-cell--${state}`}
        style={state === "running" ? (pulseStyle(index) as CSSProperties) : undefined}
        data-tip={CELL_LABELS[state]}
        data-tip-detail={own ? agents[index].label : undefined}
      />
    )),
    anticipate && <span key="ghost" className="wf-cell wf-cell--ghost" data-tip={CELL_LABELS.ghost} />,
  ];
  return (
    <span role="img" aria-label={summary} className={`wf-grid${cols ? " wf-grid--fit" : ""}${!cols && !wrap ? " wf-grid--row" : ""}`} style={style} data-tip={summary} data-tip-group="150">
      {cells}
    </span>
  );
}

/** c3fef5c6f oS: the running run's card, opening its detail in 后台任务. */
function WorkflowCard({ run, title, preLaunch, onOpen }: { run: WorkflowItem; title: string; preLaunch: boolean; onOpen?: () => void }) {
  const now = useNow(true);
  const current = progress(run, { now, settled: false });
  const agents = current ? agentCells(current.phases.flatMap((phase) => phase.agents), { now }) : undefined;
  const counts = current?.counts ?? EMPTY_COUNTS;
  const label = preLaunch ? "正在启动工作流" : "工作流";
  const body = (
    <span className="wf-card-body">
      {title && <span className="wf-card-title">{title}</span>}
      <span className="wf-card-meta" data-untitled={!title || undefined}>
        <span className="wf-card-kind">{title ? label : <ShimmerText>{label}</ShimmerText>}</span>
        {counts.total > 0 && <AgentCount counts={counts} />}
        {run.startedAtMs > 0 && !preLaunch && <Clock startedAt={run.startedAtMs} />}
      </span>
      <span className="wf-card-grid">
        <AgentGrid counts={counts} wrap maxRows={8} anticipate agents={agents} />
      </span>
    </span>
  );
  if (!onOpen) return <div className="wf-card">{body}</div>;
  return (
    <button type="button" className="wf-card" data-openable="" aria-label={title ? `查看工作流：${title}` : "查看工作流"} onClick={onOpen}>
      {body}
      <Icon name="CaretRight" size="sm" className="wf-card-caret" />
    </button>
  );
}

/**
 * c3fef5c6f IC: a run while it waits to start or runs is the card; once over it is a line, 已运行工作流
 * {name} with 已停止 or 失败 whose tooltip says why. A declined run never started.
 */
export function WorkflowRow({ item, threadId }: { item: WorkflowItem; threadId: string | null }) {
  useEffect(() => { if (threadId) checkRun(threadId, item); }, [threadId, item]);
  const run = settledRun(item);
  const title = item.name;
  if (item.status === "pending" || run.run === "running") {
    const open = threadId && item.status !== "pending" ? () => openRun(threadId, item.runId) : undefined;
    return <WorkflowCard run={run} title={title} preLaunch={item.status === "pending"} onOpen={open} />;
  }
  const declined = item.status === "declined";
  const failed = run.run === "failed" && !declined;
  const stopped = run.run === "stopped";
  const why = failed || stopped ? summaryText(item.summary ?? (item.error ? `Workflow "${item.description}" failed: ${item.error}` : undefined), item.description) : undefined;
  return (
    <div className="wf-line" data-entry-id={item.id}>
      <span className="wf-line-verb" data-tone={failed ? "danger" : undefined}>{declined ? "运行工作流" : "已运行工作流"}</span>
      {title && <span className="wf-line-name">{title}</span>}
      {(failed || stopped || declined) && (
        <span className="wf-line-state" data-tone={failed ? "danger" : undefined} tabIndex={why ? 0 : undefined} data-tip={why} data-tip-multiline={why ? "" : undefined}>
          {declined ? "已拒绝" : stopped ? "已停止" : "失败"}
        </span>
      )}
    </div>
  );
}

/** Opens 后台任务 at the run (IC onOpen: openTasksPaneAtTask). */
function openRun(threadId: string, runId: string) {
  const { threads } = getState();
  const thread = threads[threadId];
  if (!thread) return;
  const tasks = backgroundTasks(thread, threads);
  const task = tasks.find((entry) => entry.kind === "workflow" && entry.runId === runId);
  if (task) openBackgroundTask(threadId, task, tasks);
}

/** c3fef5c6f Sx: the run's stop button; a double click stops once. */
function StopButton({ task }: { task: BackgroundTask }) {
  const busy = useStopping().has(task.key);
  return (
    <Button
      variant="secondary"
      size="sm"
      icon={busy ? <Spinner size={12} /> : <Icon name="Stop" />}
      label={busy ? "正在停止…" : "停止此工作流"}
      disabled={busy}
      onClick={(event) => event.detail <= 1 && void stopBackgroundTask(task)}
    />
  );
}

/** c3fef5c6f PC: a run in 后台任务, its status, usage and phases. */
export function WorkflowDetail({ task }: { task: BackgroundTask & { kind: "workflow" } }) {
  const running = task.status === "running";
  const now = useNow(running);
  const busy = useStopping().has(task.key);
  const run = task.run;
  const current = progress(run, { now: running ? now : undefined, settled: !running, taskStopped: task.status === "stopped" });
  const title = task.title;
  const duration = run.completedAtMs !== undefined ? run.completedAtMs - run.startedAtMs : undefined;
  const clock = running ? elapsed(Math.max(0, now - run.startedAtMs)) : duration ? elapsed(duration) : null;
  const why = task.status === "failed" || task.status === "stopped" ? summaryText(run.summary, run.description) : undefined;
  return (
    <div className="wf-detail" data-background-key={task.key}>
      <span className="wf-detail-head">
        <span className="wf-detail-top">
          <span className="wf-detail-title-row">
            <span className="wf-detail-title" data-running={running || undefined}>{running ? <ShimmerText>{title}</ShimmerText> : title}</span>
            {running ? <StopButton task={task} /> : clock && <span className="wf-detail-duration tabular">{clock}</span>}
          </span>
          <span className="wf-detail-meta">
            <span className="wf-detail-line">
              <span className={running ? "wf-ink" : undefined}>工作流</span>
              {running ? busy && <span>正在停止…</span> : <span data-tone={task.status === "failed" ? "danger" : undefined}>{RUN_LABELS[task.status]}</span>}
              {running && clock && <span className="tabular">{clock}</span>}
            </span>
            {(current && current.counts.total > 0) || run.totalTokens > 0 ? (
              <span className="wf-detail-line">
                {current && current.counts.total > 0 && <AgentCount counts={current.counts} muted={!running} />}
                {run.totalTokens > 0 && <span><span className={running ? "wf-ink" : undefined}>{formatTokens(run.totalTokens)}</span> 个 token</span>}
              </span>
            ) : null}
          </span>
        </span>
        {run.description && run.description !== title && <span className="wf-detail-desc">{run.description}</span>}
        {why && (
          <span className="wf-detail-note" data-tone={task.status === "failed" ? "danger" : undefined}>
            <span className="wf-detail-note-head">{task.status === "failed" ? "错误" : "已停止"}</span>
            <span className="wf-detail-note-text" role="region" aria-label={task.status === "failed" ? "错误" : "已停止"} tabIndex={0}>{why}</span>
          </span>
        )}
      </span>
      {current && current.phases.length > 0 && (
        <div className="wf-phases">
          <span className="wf-phases-heading" data-running={running || undefined}>阶段</span>
          <ul className="wf-phase-list" role="list">
            {current.phases.map((phase) => <PhaseRow key={phase.index} phase={phase} status={task.status} now={running ? now : undefined} />)}
          </ul>
        </div>
      )}
    </div>
  );
}

/** c3fef5c6f lS: a phase title's ink. */
function phaseTone(phase: Phase): string | undefined {
  if (phase.status === "error") return "danger";
  if (phase.status === "running" && phase.counts.stalled > 0) return "warning";
  return undefined;
}

/** c3fef5c6f SS: a phase, open while it runs, its cells 16 to a row and its agents under it. */
function PhaseRow({ phase, status, now }: { phase: Phase; status: RunStatus; now?: number }) {
  const running = status === "running";
  const [picked, setPicked] = useState<boolean | null>(null);
  const open = picked ?? (running && phase.counts.total > 0);
  const cells = agentCells(phase.agents, { now, taskStopped: status === "stopped" });
  const label = phase.status === "done" && phase.counts.stopped > 0 ? "已停止" : PHASE_LABELS[phase.status];
  const { done, total } = phase.counts;
  const aria = phase.index === UNPHASED
    ? `${phase.title}，${label}，${total} 个智能体中已完成 ${done} 个`
    : `阶段：${phase.title}，${label}${total > 0 ? `，${total} 个智能体中已完成 ${done} 个` : ""}`;
  const shimmer = running && phase.status === "running" && phase.counts.stalled === 0;
  const tone = running ? phase.status === "running" || phase.status === "error" ? phaseTone(phase) ?? "secondary" : open ? "primary" : phaseTone(phase) ?? "secondary" : "muted";
  return (
    <li className="wf-phase" data-open={open || undefined}>
      <button type="button" className="wf-phase-toggle" aria-expanded={open} aria-label={aria} onClick={() => setPicked(!open)}>
        <span className="wf-phase-head">
          <span className="wf-phase-title" data-tone={tone}>{shimmer ? <ShimmerText>{phase.title}</ShimmerText> : phase.title}</span>
          {total > 0 && <span className="wf-phase-count tabular">{done}/{total}</span>}
          <span className="wf-phase-caret"><Icon name="CaretRight" size="sm" style={{ rotate: open ? "90deg" : undefined }} /></span>
        </span>
        {total > 0 && (
          <span className="wf-phase-grid">
            <AgentGrid counts={phase.counts} wrap cols={16} anticipate={running && phase.status !== "done"} agents={cells} />
          </span>
        )}
      </button>
      {open && <AgentTable agents={phase.agents} cells={cells} status={status} now={now} />}
    </li>
  );
}

/** c3fef5c6f bS / xS: the phase's agents, each with its model, tokens and time (or its error). */
function AgentTable({ agents, cells, status, now }: { agents: WorkflowAgent[]; cells: { state: CellState }[]; status: RunStatus; now?: number }) {
  if (!agents.length) return <div className="wf-agents-empty">{NO_AGENTS[status]}</div>;
  const running = status === "running";
  return (
    <div className="wf-agents">
      <div className="wf-agents-grid">
        <span />
        <span className="wf-agents-th wf-col-agent">智能体</span>
        <span className="wf-agents-th">模型</span>
        <span className="wf-agents-th wf-col-tokens wf-end">Token</span>
        <span className="wf-agents-th wf-end">时间</span>
        <ul role="list" className="wf-contents">
          {agents.map((agent, index) => {
            const done = agent.state === "done";
            const model = agent.model ? modelLabel(agent.model) : "";
            const live = running && (agent.state === "progress" || agent.state === "start") && agent.startedAtMs !== undefined;
            return (
              <li key={agent.index} className="wf-contents" data-muted={done || !running || undefined}>
                <span className="wf-agent-check">{done && <Icon name="Check" size="xs" />}</span>
                <span className="wf-agent-label wf-col-agent" title={agent.label}>{agent.label}</span>
                {agent.error ? (
                  <span className="wf-agent-error">
                    <span tabIndex={0} aria-label={agent.error} data-tip={agent.error} data-tip-multiline="">错误</span>
                  </span>
                ) : (
                  <>
                    <span className="wf-agent-model" title={model || undefined}>{model}</span>
                    <span className="wf-col-tokens wf-end tabular">{agent.tokens ? formatTokens(agent.tokens) : null}</span>
                    <span className="wf-end tabular">
                      {live && now !== undefined ? elapsed(Math.max(0, now - agent.startedAtMs!)) : cells[index]?.state === "stopped" ? "已停止" : agent.durationMs === undefined ? null : elapsed(agent.durationMs)}
                    </span>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
