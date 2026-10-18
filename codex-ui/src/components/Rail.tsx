// Session rail (aside 会话详情 "Session details"; Claude Desktop 2.42304.0.0 c73f45bc3 Xv /
// c227f4d5e / shared-18): folding cards in a user order. Order and defaults from c73f45bc3:
// environment, goal, settings, context, usage, connectors, progress, changes (the
// `pullRequests` card, titled "Changes"), background tasks. Environment cannot be hidden and
// progress comes and goes with the plan; context, usage, connectors and background tasks start
// folded. Folds are remembered per session (at most 100), hidden cards and the order globally.
// A head click folds the card, Alt+click folds or opens them all, a right-click opens 显示 /
// 恢复默认, and the grip at the head's end drags the card (arrow keys move it).

import {
  Brain,
  Cable,
  Check,
  ChevronRight,
  Cpu,
  Diff,
  Folder,
  FolderGit2,
  Gauge,
  GitBranch,
  GitPullRequest,
  GripVertical,
  Laptop,
  ListChecks,
  MousePointer2,
  Pause,
  Play,
  Plug,
  ShieldCheck,
  Square,
  SquareTerminal,
  X,
} from "lucide-react";
import { useEffect, useId, useReducer, useRef, useState, type DragEvent, type MouseEvent, type ReactNode } from "react";
import {
  PRESETS,
  cleanBackground,
  clearGoal,
  effectiveSettings,
  errorMessage,
  listConnectors,
  modelLabel,
  projectFor,
  refreshAttachments,
  refreshBackground,
  setGoalStatus,
  setRemoteControl,
  terminateBackground,
} from "../lib/codex";
import { filesStats, turnFiles } from "../lib/diff";
import { basename, formatDuration, formatTokens, limitName, parentDir } from "../lib/format";
import { mcpReady, pullRequests, setState, toast, useStore, writePref, type ThreadState } from "../lib/store";
import { EFFORT_LABELS } from "./Composer";
import { GOAL_LABELS } from "./Main";
import { Button, MenuItem, MenuSection, MenuSep, Popover, StatusDot, Toggle } from "./ui";

type CardId = "environment" | "goal" | "settings" | "context" | "usage" | "connectors" | "progress" | "changes" | "background";

const ORDER: CardId[] = ["environment", "goal", "settings", "context", "usage", "connectors", "progress", "changes", "background"];
const TITLES: Record<CardId, string> = {
  environment: "环境",
  goal: "目标",
  settings: "设置",
  context: "上下文",
  usage: "用量",
  connectors: "连接器",
  progress: "进度",
  changes: "更改",
  background: "后台任务",
};
const FOLDED = new Set<CardId>(["context", "usage", "connectors", "background"]);
/** Not in the 显示 menu: environment always shows, progress follows the plan. */
const LOCKED = new Set<CardId>(["environment", "progress"]);

const FOLDS_KEY = "codex-ui:rail-folds";
const LAYOUT_KEY = "codex-ui:rail-layout";
const MAX_SESSIONS = 100;

const fail = (title: string) => (error: unknown) => toast("error", title, errorMessage(error));

function readJson(key: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
    return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const known = (value: unknown): CardId[] => (Array.isArray(value) ? value.filter((id): id is CardId => ORDER.includes(id)) : []);

function readLayout(): { hidden: CardId[]; order: CardId[] } {
  const raw = readJson(LAYOUT_KEY);
  const order = known(raw.order);
  for (const id of ORDER) if (!order.includes(id)) order.splice(Math.min(ORDER.indexOf(id), order.length), 0, id);
  return { hidden: known(raw.hidden).filter((id) => !LOCKED.has(id)), order };
}

// Module state, read once: the rail re-renders through `bump` after each change.
let folds = readJson(FOLDS_KEY) as Record<string, Partial<Record<CardId, boolean>>>;
let layout = readLayout();

function saveFolds(threadId: string, patch: Partial<Record<CardId, boolean>>) {
  const { [threadId]: current, ...rest } = folds;
  // Re-inserted last, so the oldest sessions fall off first.
  folds = { ...rest, [threadId]: { ...current, ...patch } };
  const ids = Object.keys(folds);
  for (const id of ids.slice(0, Math.max(0, ids.length - MAX_SESSIONS))) delete folds[id];
  writePref(FOLDS_KEY, JSON.stringify(folds));
}

function saveLayout(next: typeof layout) {
  layout = next;
  writePref(LAYOUT_KEY, JSON.stringify(layout));
}

const isDefaultLayout = () => layout.hidden.length === 0 && layout.order.every((id, index) => id === ORDER[index]);

/** Moves `id` before or after `target` in the saved order. */
function moveCard(id: CardId, target: CardId, side: "before" | "after") {
  if (id === target) return;
  const order = layout.order.filter((other) => other !== id);
  order.splice(order.indexOf(target) + (side === "after" ? 1 : 0), 0, id);
  saveLayout({ ...layout, order });
}

// ---------------------------------------------------------------------------
// Pieces

function Row({ icon, children, end, tip }: { icon: ReactNode; children: ReactNode; end?: ReactNode; tip?: string }) {
  return (
    <div className="rail-row" data-tip={tip}>
      {icon}
      <span className="rail-row-text">{children}</span>
      {end != null && <span className="rail-row-end">{end}</span>}
    </div>
  );
}

const Muted = ({ children }: { children: ReactNode }) => <span className="muted"> · {children}</span>;

function Meter({ percent }: { percent: number }) {
  return (
    <span className="rail-meter" aria-hidden="true">
      <i style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
    </span>
  );
}

const Stat = ({ added, removed }: { added: number; removed: number }) => (
  <span className="tabular">
    <span className="plus">+{added}</span> <span className="minus">−{removed}</span>
  </span>
);

interface CardProps {
  id: CardId;
  summary?: ReactNode;
  open: boolean;
  menuOpen: boolean;
  drop: "before" | "after" | null;
  dragging: boolean;
  onToggle(open: boolean, all: boolean): void;
  onMenu(event: MouseEvent): void;
  onGripStart(event: DragEvent): void;
  onGripEnd(): void;
  onGripKey(step: -1 | 1): void;
  onDragOver(event: DragEvent): void;
  onDrop(event: DragEvent): void;
  children: ReactNode;
}

function Card({ id, summary, open, menuOpen, drop, dragging, onToggle, onMenu, onGripStart, onGripEnd, onGripKey, onDragOver, onDrop, children }: CardProps) {
  const head = useId();
  const title = TITLES[id];
  return (
    <section className="rail-card" aria-labelledby={head} data-drop={drop ?? undefined} data-dragging={dragging || undefined} onDragOver={onDragOver} onDrop={onDrop}>
      <div className="rail-head" data-menu-open={menuOpen || undefined} onContextMenu={onMenu}>
        <h3 className="rail-h3" id={head}>
          <button type="button" className="rail-trigger" aria-expanded={open} onClick={(event) => onToggle(!open, event.altKey)}>
            <span>{title}</span>
            <span className="rail-caret">
              <ChevronRight size={12} />
            </span>
            {!open && summary != null && <span className="rail-summary">{summary}</span>}
          </button>
        </h3>
        <button
          type="button"
          className="rail-grip"
          draggable
          data-grip={id}
          aria-label={`调整「${title}」的顺序`}
          onDragStart={onGripStart}
          onDragEnd={onGripEnd}
          onKeyDown={(event) => {
            if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
            event.preventDefault();
            onGripKey(event.key === "ArrowUp" ? -1 : 1);
          }}
        >
          <span>
            <GripVertical size={12} />
          </span>
        </button>
      </div>
      {open && <div className="rail-body">{children}</div>}
    </section>
  );
}

/** Flat todo list: the rail between knobs fills as steps complete (W19, census rail-grow / knob-in). */
function Progress({ steps }: { steps: { step: string; status: "pending" | "inProgress" | "completed" }[] }) {
  const seen = useRef(steps.length);
  const before = seen.current;
  useEffect(() => {
    seen.current = steps.length;
  });
  return (
    <ol className="todo-list" data-building={steps.every((s) => s.status === "pending") || undefined}>
      {steps.map((step, index) => {
        const enter = index >= before || undefined;
        return (
          <li key={index} className="todo-row">
            <span className="todo-railbox" aria-hidden="true">
              <i className="todo-rail" data-walked={step.status === "completed" || undefined} data-enter={enter} />
              {step.status === "completed" ? (
                <span className="todo-done">
                  <Check size={12} />
                </span>
              ) : (
                <i className="todo-knob" data-enter={enter} />
              )}
            </span>
            <span className="todo-text" data-status={step.status} data-enter={enter}>
              {step.step}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

const REMOTE_NOTES: Record<string, string> = {
  connecting: "正在连接…",
  connected: "已通过远程控制连接",
  errored: "未能连接",
};

function prLabel(url: string): string {
  const match = /github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/.exec(url);
  return match ? `${match[1]}#${match[2]}` : url.replace(/^https:\/\//, "");
}

// ---------------------------------------------------------------------------
// The rail

export function SessionRail({ thread }: { thread: ThreadState }) {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const [menu, setMenu] = useState<{ x: number; y: number; card: CardId } | null>(null);
  const [drag, setDrag] = useState<CardId | null>(null);
  const [drop, setDrop] = useState<{ id: CardId; side: "before" | "after" } | null>(null);
  const [remoteBusy, setRemoteBusy] = useState(false);
  const server = useStore((s) => s.server);
  const limits = useStore((s) => s.rateLimits?.rateLimits);
  const remote = useStore((s) => s.remoteControl);
  const remoteAllowed = useStore((s) => s.requirements?.allowRemoteControl !== false);
  const connectors = useStore((s) => s.connectors);
  const profiles = useStore((s) => s.permissionProfiles);
  useStore((s) => s.models);
  useStore((s) => s.projects);

  const { meta, goal, tokenUsage: usage } = thread;
  const id = meta.id;

  useEffect(() => {
    void refreshAttachments(id);
    void refreshBackground(id);
  }, [id]);

  const isOpen = (card: CardId) => folds[id]?.[card] ?? !FOLDED.has(card);
  const connectorsOpen = isOpen("connectors");
  useEffect(() => {
    if (connectorsOpen && connectors === null) void listConnectors(id);
  }, [connectorsOpen, connectors, id]);

  const cwd = thread.settings?.cwd ?? meta.cwd;
  const effective = effectiveSettings(thread);
  // No preset: a custom permissions profile is in force (its id is its name); null for both
  // means approval and sandbox match no preset.
  const profile = effective.permissionProfile ? (profiles.find((p) => p.id === effective.permissionProfile) ?? { id: effective.permissionProfile, description: null }) : null;
  const permission = effective.permission ? PRESETS[effective.permission].label : (profile?.id ?? "自定义");
  const project = projectFor(cwd);
  const sandbox = thread.settings?.sandbox;
  const extraRoots = sandbox?.type === "workspaceWrite" ? sandbox.writableRoots.filter((root) => root !== cwd) : [];

  // Context: the last request's window, split into cached input, new input, output and reasoning
  // (inputTokens includes the cached part, outputTokens the reasoning).
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
  const windows = [limits?.primary, limits?.secondary].filter((w): w is NonNullable<typeof w> => !!w);
  const maxUsed = windows.length ? Math.round(Math.max(...windows.map((w) => w.usedPercent))) : 0;
  const changed = thread.turns.map((turn) => turnFiles(turn, cwd)).findLast((list) => list.length > 0) ?? [];
  const stats = changed.length ? filesStats(changed) : null;
  const prs = pullRequests(thread);
  const mcpNames = Object.keys(thread.mcp).sort();
  const enabledConnectors = connectors?.filter((c) => c.enabled) ?? [];
  const live = mcpReady(thread) + enabledConnectors.length;

  const cards: Partial<Record<CardId, { summary?: ReactNode; body: ReactNode }>> = {
    environment: {
      summary: `本机 · ${basename(cwd)}`,
      body: (
        <>
          <Row icon={<Laptop size={14} />} tip="会话运行位置">
            本机{server.info?.platformOs && <Muted>{server.info.platformOs}</Muted>}
          </Row>
          <Row icon={<Folder size={14} />} tip={cwd}>
            {basename(cwd)}
            <Muted>{parentDir(cwd)}</Muted>
          </Row>
          {extraRoots.map((root) => (
            <Row key={root} icon={<Folder size={14} />} tip={root}>
              {basename(root)}
              <Muted>可写</Muted>
            </Row>
          ))}
          {meta.gitInfo?.branch && (
            <Row icon={<GitBranch size={14} />}>{meta.gitInfo.branch}</Row>
          )}
          {project && (
            <Row icon={<FolderGit2 size={14} />}>
              {project.name}
              <Muted>项目</Muted>
            </Row>
          )}
          {remote && remoteAllowed && (
            <>
              <Row
                icon={<MousePointer2 size={14} />}
                end={
                  <Toggle
                    checked={remote.status !== "disabled"}
                    disabled={remoteBusy}
                    label="远程控制"
                    onChange={(on) => {
                      setRemoteBusy(true);
                      setRemoteControl(on)
                        .catch(fail("远程控制切换失败"))
                        .finally(() => setRemoteBusy(false));
                    }}
                  />
                }
              >
                远程控制
              </Row>
              <div className="rail-note">
                {REMOTE_NOTES[remote.status] ? `${REMOTE_NOTES[remote.status]}；` : ""}仅此窗口打开期间有效
              </div>
            </>
          )}
        </>
      ),
    },
    settings: {
      summary: modelLabel(effective.model),
      body: (
        <>
          <Row icon={<Cpu size={14} />} end={modelLabel(effective.model)}>
            模型
          </Row>
          <Row icon={<Gauge size={14} />} end={EFFORT_LABELS[effective.effort ?? ""] ?? effective.effort ?? "默认"}>
            努力程度
          </Row>
          <Row icon={<ShieldCheck size={14} />} end={permission} tip={profile?.description ?? undefined}>
            权限
          </Row>
          <Row icon={<ListChecks size={14} />} end={effective.planMode ? "开" : "关"}>
            计划模式
          </Row>
        </>
      ),
    },
    context: {
      summary: usage ? (
        <>
          <span>已用 {pct}%</span>
          <Meter percent={pct} />
        </>
      ) : undefined,
      body: usage ? (
        <>
          <div className="ctx-headline">
            <span>上下文窗口</span>
            <span>
              {formatTokens(used)} / {formatTokens(ctxWindow)}（{pct}%）
            </span>
          </div>
          <div className="ctx-bar" aria-hidden="true">
            {parts.map(([name, n, color]) => (
              <i key={name} style={{ width: `${ctxWindow ? (n / ctxWindow) * 100 : 0}%`, background: color }} />
            ))}
          </div>
          {parts.map(([name, n, color]) => (
            <div key={name} className="ctx-row">
              <i style={{ background: color }} />
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
          <div className="ctx-row ctx-sep">
            <i style={{ background: "transparent" }} />
            <span>会话累计</span>
            <span>{formatTokens(usage.total.totalTokens)}</span>
            <span />
          </div>
        </>
      ) : (
        <div className="rail-note">发送一条消息后显示上下文用量。</div>
      ),
    },
    connectors: {
      summary: `${live} 个已连接`,
      body: (
        <>
          {mcpNames.map((name) => {
            const runtime = thread.mcp[name];
            return (
              <Row
                key={name}
                icon={<Plug size={14} />}
                tip={runtime.error ?? undefined}
                end={
                  runtime.status === "ready" ? (
                    <StatusDot kind="ready" />
                  ) : runtime.status === "starting" ? (
                    "启动中"
                  ) : runtime.status === "failed" ? (
                    <span className="rail-danger">失败</span>
                  ) : (
                    "已取消"
                  )
                }
              >
                {name}
                <Muted>MCP</Muted>
              </Row>
            );
          })}
          {enabledConnectors.map((connector) => (
            <Row key={connector.id} icon={<Cable size={14} />} end={connector.callable ? <StatusDot kind="ready" /> : "不可用"}>
              {connector.name}
            </Row>
          ))}
          {connectors === null && mcpNames.length === 0 && <div className="rail-note">正在读取…</div>}
          {connectors !== null && mcpNames.length + enabledConnectors.length === 0 && <div className="rail-note">这个会话没有连接器</div>}
          <button type="button" className="rail-link" onClick={() => setState({ settings: "connectors" })}>
            管理连接器
          </button>
        </>
      ),
    },
    changes: {
      summary: stats ? <Stat {...stats} /> : prs.length ? `${prs.length} 个 PR` : "无",
      body: (
        <>
          {stats ? (
            <Row
              icon={<Diff size={14} />}
              end={
                <Button variant="secondary" size="xs" onClick={() => setState({ dialog: { type: "review", threadId: id } })}>
                  审查
                </Button>
              }
            >
              <button type="button" className="rail-link-inline" onClick={() => setState({ panel: "diff" })}>
                <Stat {...stats} />
              </button>
              <Muted>{changed.length} 个文件</Muted>
            </Row>
          ) : (
            prs.length === 0 && <div className="rail-note">这个会话还没有改动文件</div>
          )}
          {prs.map((url) => (
            <a key={url} className="rail-row rail-row-link" href={url} target="_blank" rel="noopener noreferrer" data-tip={url}>
              <GitPullRequest size={14} />
              <span className="rail-row-text">{prLabel(url)}</span>
            </a>
          ))}
        </>
      ),
    },
  };

  if (goal) {
    cards.goal = {
      summary: GOAL_LABELS[goal.status],
      body: (
        <>
          <div className="rail-objective">{goal.objective}</div>
          <Row
            icon={<StatusDot kind={goal.status === "active" ? "running" : goal.status === "complete" ? "ready" : "idle"} />}
            end={goal.timeUsedSeconds ? formatDuration(goal.timeUsedSeconds * 1000) : undefined}
          >
            {GOAL_LABELS[goal.status]}
          </Row>
          <Row icon={<Brain size={14} />} end={goal.tokenBudget ? <Meter percent={(goal.tokensUsed / goal.tokenBudget) * 100} /> : undefined}>
            {formatTokens(goal.tokensUsed)} tokens
            {goal.tokenBudget ? <Muted>预算 {formatTokens(goal.tokenBudget)}</Muted> : null}
          </Row>
          <div className="rail-row">
            {goal.status === "active" ? (
              <Button variant="secondary" size="xs" icon={<Pause size={14} />} onClick={() => setGoalStatus(id, "paused").catch(fail("暂停失败"))}>
                暂停
              </Button>
            ) : (
              goal.status !== "complete" && (
                <Button variant="secondary" size="xs" icon={<Play size={14} />} onClick={() => setGoalStatus(id, "active").catch(fail("继续失败"))}>
                  继续
                </Button>
              )
            )}
            <Button variant="ghost" size="xs" ink2 icon={<X size={14} />} onClick={() => clearGoal(id).catch(fail("清除失败"))}>
              清除
            </Button>
          </div>
        </>
      ),
    };
  }

  if (windows.length) {
    cards.usage = {
      summary: (
        <>
          <span>{maxUsed}%</span>
          <Meter percent={maxUsed} />
        </>
      ),
      body: (
        <>
          {windows.map((w) => (
            <Row
              key={w.windowDurationMins ?? 0}
              icon={<Meter percent={w.usedPercent} />}
              end={`${Math.round(w.usedPercent)}%`}
            >
              {limitName(w)}
              {w.resetsAt ? (
                <Muted>
                  {new Date(w.resetsAt * 1000).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} 重置
                </Muted>
              ) : null}
            </Row>
          ))}
          <button type="button" className="rail-link" onClick={() => setState({ settings: "account" })}>
            在设置中查看用量
          </button>
        </>
      ),
    };
  }

  if (plan) {
    const done = plan.steps.filter((step) => step.status === "completed").length;
    cards.progress = { summary: `${done}/${plan.steps.length}`, body: <Progress steps={plan.steps} /> };
  }

  if (thread.background.length) {
    cards.background = {
      summary: `${thread.background.length} 个运行中`,
      body: (
        <>
          {thread.background.map((task) => (
            <Row
              key={task.processId}
              icon={<SquareTerminal size={14} />}
              tip={`${task.command}\n${task.cwd}`}
              end={
                <Button
                  variant="ghost"
                  size="xs"
                  muted
                  icon={<Square size={12} />}
                  label="停止"
                  onClick={() => terminateBackground(id, task.processId).catch(fail("停止失败"))}
                />
              }
            >
              <code className="rail-code">{task.command}</code>
              {task.cpuPercent !== null && <Muted>CPU {Math.round(task.cpuPercent)}%</Muted>}
            </Row>
          ))}
          <button type="button" className="rail-link" onClick={() => cleanBackground(id).catch(fail("停止失败"))}>
            全部停止
          </button>
        </>
      ),
    };
  }

  const visible = layout.order.filter((card) => cards[card] && !layout.hidden.includes(card));

  const setFold = (card: CardId, open: boolean, all: boolean) => {
    saveFolds(id, all ? Object.fromEntries(visible.map((c) => [c, open])) : { [card]: open });
    bump();
  };
  const step = (card: CardId, by: -1 | 1) => {
    const at = visible.indexOf(card);
    const target = visible[at + by];
    if (!target) return;
    moveCard(card, target, by < 0 ? "before" : "after");
    bump();
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`.rail [data-grip="${card}"]`)?.focus());
  };
  const endDrag = () => {
    setDrag(null);
    setDrop(null);
  };

  return (
    <aside className="rail" aria-label="会话详情">
      <div className="rail-scroll scroll-fade-y">
        <div className="rail-cards">
          {visible.map((card) => (
            <Card
              key={card}
              id={card}
              summary={cards[card]?.summary}
              open={isOpen(card)}
              menuOpen={menu?.card === card}
              drop={drop?.id === card ? drop.side : null}
              dragging={drag === card}
              onToggle={(open, all) => setFold(card, open, all)}
              onMenu={(event) => {
                event.preventDefault();
                setMenu({ x: event.clientX, y: event.clientY, card });
              }}
              onGripStart={(event) => {
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", card);
                const section = event.currentTarget.closest("section");
                if (section) event.dataTransfer.setDragImage(section, 24, 13);
                setDrag(card);
              }}
              onGripEnd={endDrag}
              onGripKey={(by) => step(card, by)}
              onDragOver={(event) => {
                if (!drag || drag === card) return;
                event.preventDefault();
                const rect = event.currentTarget.getBoundingClientRect();
                const side = event.clientY < rect.top + rect.height / 2 ? "before" : "after";
                if (drop?.id !== card || drop.side !== side) setDrop({ id: card, side });
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (drag && drop) moveCard(drag, drop.id, drop.side);
                endDrag();
                bump();
              }}
            >
              {cards[card]?.body}
            </Card>
          ))}
        </div>
      </div>
      <Popover
        open={!!menu}
        onClose={() => setMenu(null)}
        anchor={<span className="rail-menu-anchor" style={{ left: menu?.x ?? 0, top: menu?.y ?? 0 }} />}
      >
        <MenuSection title="显示" />
        {ORDER.filter((card) => !LOCKED.has(card)).map((card) => (
          <MenuItem
            key={card}
            label={TITLES[card]}
            toggle
            checked={!layout.hidden.includes(card)}
            onClick={() => {
              const hidden = layout.hidden.includes(card) ? layout.hidden.filter((c) => c !== card) : [...layout.hidden, card];
              saveLayout({ ...layout, hidden });
              setMenu(null);
              bump();
            }}
          />
        ))}
        <MenuSep />
        <MenuItem
          label="恢复默认"
          disabled={isDefaultLayout()}
          onClick={() => {
            saveLayout({ hidden: [], order: [...ORDER] });
            setMenu(null);
            bump();
          }}
        />
      </Popover>
    </aside>
  );
}
