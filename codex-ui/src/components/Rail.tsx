// Session rail (aside "会话详情", claude.ai audit W13): folding cards for the environment,
// goal, settings, context window, plan progress, rate limits, MCP connectors and changes.
// Each card remembers whether it is open; folded cards show a summary on the right.

import type { ListMcpServerStatusResponse } from "@protocol/v2/ListMcpServerStatusResponse";
import {
  Brain,
  Check,
  ChevronRight,
  Circle,
  CircleDot,
  Cpu,
  Eye,
  FileDiff,
  Folder,
  GitBranch,
  Laptop,
  ListChecks,
  Pause,
  Play,
  Plug,
  ShieldCheck,
  X,
} from "lucide-react";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { PRESETS, clearGoal, effectiveSettings, errorMessage, listMcpServers, modelLabel, setGoalStatus } from "../lib/codex";
import { filesStats, turnFiles } from "../lib/diff";
import { basename, formatDuration, formatTokens, limitName, parentDir } from "../lib/format";
import { setState, toast, useStore, type ThreadState } from "../lib/store";
import { EFFORT_LABELS } from "./Composer";
import { GOAL_LABELS, VIEW_LABELS } from "./Main";
import { Button, StatusDot } from "./ui";

const OPEN_KEY = "codex-ui:rail-open";
const DEFAULT_OPEN: Record<string, boolean> = {
  environment: true,
  goal: true,
  settings: false,
  context: true,
  progress: true,
  usage: false,
  connectors: false,
  changes: true,
};

function readOpen(): Record<string, boolean> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(OPEN_KEY) ?? "{}");
    return { ...DEFAULT_OPEN, ...(value && typeof value === "object" ? (value as Record<string, boolean>) : {}) };
  } catch {
    return { ...DEFAULT_OPEN };
  }
}

const fail = (title: string) => (error: unknown) => toast("error", title, errorMessage(error));

function RailCard({
  title,
  summary,
  open,
  onToggle,
  children,
}: {
  title: string;
  summary?: ReactNode;
  open: boolean;
  onToggle(): void;
  children: ReactNode;
}) {
  return (
    <section className="rail-card">
      <div className="rail-head">
        <button type="button" className="rail-trigger" aria-expanded={open} onClick={onToggle}>
          <span>{title}</span>
          <span className="rail-caret">
            <ChevronRight size={12} />
          </span>
          {!open && summary != null && <span className="rail-summary">{summary}</span>}
        </button>
      </div>
      {open && <div className="rail-body">{children}</div>}
    </section>
  );
}

function Row({ icon, label, detail, end }: { icon: ReactNode; label: ReactNode; detail?: ReactNode; end?: ReactNode }) {
  return (
    <div className="rail-row">
      {icon}
      <span className="rail-row-text">
        <b>{label}</b>
        {detail && <span className="muted"> · {detail}</span>}
      </span>
      {end && <span className="rail-row-end">{end}</span>}
    </div>
  );
}

function Meter({ percent }: { percent: number }) {
  return (
    <span className="meter">
      <i style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
    </span>
  );
}

let mcpCache: ListMcpServerStatusResponse["data"] | null = null;

export function SessionRail({ thread }: { thread: ThreadState }) {
  const server = useStore((s) => s.server);
  const limits = useStore((s) => s.rateLimits?.rateLimits);
  const defaultView = useStore((s) => s.defaultView);
  useStore((s) => s.models);
  const [open, setOpen] = useState(readOpen);
  const [mcp, setMcp] = useState(mcpCache);
  const flip = (id: string) =>
    setOpen((current) => {
      const next = { ...current, [id]: !current[id] };
      try {
        localStorage.setItem(OPEN_KEY, JSON.stringify(next));
      } catch {
        // Private mode: cards just reopen in their default state.
      }
      return next;
    });
  const card = (id: string) => ({ open: !!open[id], onToggle: () => flip(id) });

  useEffect(() => {
    if (mcpCache) return;
    listMcpServers()
      .then((data) => {
        mcpCache = data;
        setMcp(data);
      })
      .catch(() => setMcp([]));
  }, []);

  const { meta, goal, tokenUsage: usage } = thread;
  const cwd = thread.settings?.cwd ?? meta.cwd;
  const effective = effectiveSettings(thread);
  const platform = server.info ? `${server.info.platformOs}` : null;
  const branch = meta.gitInfo?.branch;

  // Context: the last request's window, split into cached input, new input, output and reasoning.
  const ctxWindow = usage?.modelContextWindow ?? 0;
  const used = usage?.last.totalTokens ?? 0;
  const pct = ctxWindow ? Math.min(100, Math.round((used / ctxWindow) * 100)) : 0;
  const parts: [string, number, string][] = usage
    ? [
        ["缓存的输入", usage.last.cachedInputTokens, "var(--cds-chart-1)"],
        ["新的输入", Math.max(0, usage.last.inputTokens - usage.last.cachedInputTokens), "var(--cds-chart-2)"],
        ["输出", Math.max(0, usage.last.outputTokens - usage.last.reasoningOutputTokens), "var(--cds-chart-3)"],
        ["推理", usage.last.reasoningOutputTokens, "var(--cds-alpha-4)"],
      ]
    : [];
  const share = (n: number) => (ctxWindow ? `${((n / ctxWindow) * 100).toFixed(1)}%` : "—");

  const plan = thread.turns.findLast((turn) => turn.plan)?.plan;
  const planDone = plan?.steps.filter((step) => step.status === "completed").length ?? 0;
  const windows = [limits?.primary, limits?.secondary].filter((w): w is NonNullable<typeof w> => !!w);
  const changed = thread.turns.map((turn) => turnFiles(turn, cwd)).findLast((list) => list.length > 0) ?? [];
  const stats = changed.length ? filesStats(changed) : null;
  const files = changed.length;
  const statText = stats ? (
    <span className="tabular">
      <span className="plus">+{stats.added}</span> <span className="minus">−{stats.removed}</span>
    </span>
  ) : null;
  const connected = mcp?.filter((s) => s.runtimeStatus === "connected").length ?? 0;

  return (
    <aside className="rail scroll-fade-y" aria-label="会话详情">
      <div className="rail-cards">
        <RailCard title="环境" summary={basename(cwd)} {...card("environment")}>
          <Row icon={<Laptop size={14} />} label="本机" detail={platform} />
          <Row icon={<Folder size={14} />} label={basename(cwd)} detail={parentDir(cwd)} />
          {branch && <Row icon={<GitBranch size={14} />} label={branch} detail={meta.gitInfo?.sha?.slice(0, 7)} />}
        </RailCard>

        {goal && (
          <RailCard title="目标" summary={GOAL_LABELS[goal.status]} {...card("goal")}>
            <div className="rail-objective">{goal.objective}</div>
            <Row
              icon={<StatusDot kind={goal.status === "active" ? "running" : goal.status === "complete" ? "ready" : "idle"} />}
              label={GOAL_LABELS[goal.status]}
              end={goal.timeUsedSeconds ? formatDuration(goal.timeUsedSeconds * 1000) : undefined}
            />
            <Row
              icon={<Brain size={14} />}
              label={`${formatTokens(goal.tokensUsed)} tokens`}
              detail={goal.tokenBudget ? `预算 ${formatTokens(goal.tokenBudget)}` : undefined}
              end={goal.tokenBudget ? <Meter percent={(goal.tokensUsed / goal.tokenBudget) * 100} /> : undefined}
            />
            <div className="rail-row">
              {goal.status === "active" ? (
                <Button variant="secondary" size="xs" icon={<Pause size={14} />} onClick={() => setGoalStatus(meta.id, "paused").catch(fail("暂停失败"))}>
                  暂停
                </Button>
              ) : (
                goal.status !== "complete" && (
                  <Button variant="secondary" size="xs" icon={<Play size={14} />} onClick={() => setGoalStatus(meta.id, "active").catch(fail("继续失败"))}>
                    继续
                  </Button>
                )
              )}
              <Button variant="ghost" size="xs" ink2 icon={<X size={14} />} onClick={() => clearGoal(meta.id).catch(fail("清除失败"))}>
                清除
              </Button>
            </div>
          </RailCard>
        )}

        <RailCard title="设置" summary={modelLabel(effective.model)} {...card("settings")}>
          <Row icon={<Cpu size={14} />} label={modelLabel(effective.model)} detail={EFFORT_LABELS[effective.effort ?? ""] ?? effective.effort} />
          <Row
            icon={<ShieldCheck size={14} />}
            label={effective.permission ? PRESETS[effective.permission].label : "默认权限"}
            detail={effective.permission ? PRESETS[effective.permission].description : undefined}
          />
          <Row icon={<ListChecks size={14} />} label="计划模式" end={effective.planMode ? "开" : "关"} />
          <Row icon={<Eye size={14} />} label="对话视图" end={`${VIEW_LABELS[thread.view ?? defaultView]} · Ctrl+O`} />
        </RailCard>

        <RailCard
          title="上下文"
          summary={
            usage ? (
              <>
                <span>{pct}%</span>
                <Meter percent={pct} />
              </>
            ) : (
              "—"
            )
          }
          {...card("context")}
        >
          {usage ? (
            <>
              <div className="ctx-headline">
                <span>已使用 {pct}%</span>
                <span>
                  {formatTokens(used)} / {formatTokens(ctxWindow)}
                </span>
              </div>
              <div className="ctx-bar" aria-hidden="true">
                {parts.map(([name, n, color]) => (
                  <i key={name} style={{ width: `${ctxWindow ? (n / ctxWindow) * 100 : 0}%`, background: color }} />
                ))}
              </div>
              {parts.map(([name, n, color]) => (
                <div key={name} className="ctx-row">
                  <i style={{ background: color } as CSSProperties} />
                  <span>{name}</span>
                  <span>{formatTokens(n)}</span>
                  <span>{share(n)}</span>
                </div>
              ))}
              <div className="ctx-row">
                <i style={{ background: "var(--cds-alpha-1)" }} />
                <span>可用空间</span>
                <span>{formatTokens(Math.max(0, ctxWindow - used))}</span>
                <span>{share(Math.max(0, ctxWindow - used))}</span>
              </div>
              <div className="ctx-row">
                <i style={{ background: "transparent" }} />
                <span>会话累计</span>
                <span>{formatTokens(usage.total.totalTokens)}</span>
                <span>—</span>
              </div>
            </>
          ) : (
            <div className="rail-row muted">发送第一条消息后显示</div>
          )}
        </RailCard>

        {plan && (
          <RailCard title="进度" summary={`${planDone}/${plan.steps.length}`} {...card("progress")}>
            <ol className="progress-list">
              {plan.steps.map((step, index) => (
                <li key={index} data-status={step.status}>
                  {step.status === "completed" ? <Check size={14} /> : step.status === "inProgress" ? <CircleDot size={14} /> : <Circle size={14} />}
                  <span>{step.step}</span>
                </li>
              ))}
            </ol>
          </RailCard>
        )}

        {windows.length > 0 && (
          <RailCard title="用量" summary={`${Math.round(Math.max(...windows.map((w) => w.usedPercent)))}%`} {...card("usage")}>
            {windows.map((w) => (
              <Row
                key={w.windowDurationMins ?? 0}
                icon={<Meter percent={w.usedPercent} />}
                label={limitName(w)}
                detail={w.resetsAt ? `${new Date(w.resetsAt * 1000).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} 重置` : undefined}
                end={`${Math.round(w.usedPercent)}%`}
              />
            ))}
          </RailCard>
        )}

        <RailCard title="连接器" summary={mcp === null ? "—" : `已连接 ${connected} 个`} {...card("connectors")}>
          {mcp?.length === 0 && <div className="rail-row muted">没有配置 MCP 服务器</div>}
          {mcp?.map((s) => (
            <Row
              key={s.name}
              icon={<Plug size={14} />}
              label={s.name}
              detail={`${Object.keys(s.tools).length} 个工具`}
              end={<StatusDot kind={s.runtimeStatus === "connected" ? "ready" : s.runtimeStatus === "failed" ? "error" : "idle"} />}
            />
          ))}
          <div className="rail-row">
            <Button variant="ghost" size="xs" ink2 onClick={() => setState({ settings: "mcp" })}>
              管理连接器
            </Button>
          </div>
        </RailCard>

        <RailCard title="更改" summary={statText ?? "无"} {...card("changes")}>
          {stats ? (
            <Row
              icon={<FileDiff size={14} />}
              label={`${files} 个文件`}
              detail={statText}
              end={
                <>
                  <Button variant="ghost" size="xs" ink2 onClick={() => setState({ panel: "diff" })}>
                    查看
                  </Button>
                  <Button variant="secondary" size="xs" onClick={() => setState({ dialog: { type: "review", threadId: meta.id } })}>
                    审查
                  </Button>
                </>
              }
            />
          ) : (
            <div className="rail-row muted">这个会话还没有改动文件</div>
          )}
        </RailCard>
      </div>
    </aside>
  );
}
