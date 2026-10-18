// Transcript (claude.ai audit W6, W14): turns, the working line while a turn runs,
// message actions, scroll pinning, jump-to-latest and the document rail.

import type { ThreadItem } from "@protocol/v2/ThreadItem";
import { ArrowDown, Check, Circle, CircleDot, GitFork, ListTodo, RefreshCw, TriangleAlert } from "lucide-react";
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { errorMessage, forkThread, loadTurns, requestThreadId, rewindAndSend, sendMessage, setOverride } from "../lib/codex";
import { filesStats, turnFiles } from "../lib/diff";
import { timeAgo } from "../lib/format";
import { bucket, clockText, nextView, thinkingLabel, thinkingPhase, tokenText } from "../lib/session";
import { getState, setState, toast, updateThread, useStore, type ThreadState, type TurnState } from "../lib/store";
import {
  AgentMessage,
  CommandRow,
  ExplorationGroup,
  FileChangeCard,
  GenericRow,
  McpCallRow,
  Reasoning,
  UserBubble,
  ViewContext,
  WebSearchRow,
  isExploration,
} from "./items";
import { Button, CopyButton, Skeleton, Spark } from "./ui";

function useNow(active: boolean, every = 1000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(timer);
  }, [active, every]);
  return now;
}

type Block =
  | { kind: "item"; item: ThreadItem }
  | { kind: "explore"; items: Extract<ThreadItem, { type: "commandExecution" }>[] };

/** Fold runs of read/list/search commands into one exploration row. */
function toBlocks(items: ThreadItem[]): Block[] {
  const blocks: Block[] = [];
  for (const item of items) {
    if (item.type === "userMessage") continue;
    const last = blocks.at(-1);
    if (isExploration(item)) {
      if (last?.kind === "explore") last.items.push(item);
      else blocks.push({ kind: "explore", items: [item] });
    } else {
      blocks.push({ kind: "item", item });
    }
  }
  return blocks;
}

function PlanTodo({ plan }: { plan: NonNullable<TurnState["plan"]> }) {
  const done = plan.steps.filter((step) => step.status === "completed").length;
  return (
    <div className="todo-card">
      <div className="change-head">
        <span className="row-icon">
          <ListTodo size={16} />
        </span>
        <span>任务计划</span>
        <span className="muted tabular">
          {done}/{plan.steps.length}
        </span>
      </div>
      {plan.explanation && <div className="todo-explain">{plan.explanation}</div>}
      <ol className="todo-list">
        {plan.steps.map((step, index) => (
          <li key={index} className={`todo-${step.status}`}>
            {step.status === "completed" ? <Check size={14} /> : step.status === "inProgress" ? <CircleDot size={14} /> : <Circle size={14} />}
            <span>{step.step}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

const fail = (title: string) => (error: unknown) => toast("error", title, errorMessage(error));

const TOOL_TYPES = new Set(["commandExecution", "fileChange", "mcpToolCall", "webSearch", "dynamicToolCall", "collabAgentToolCall", "imageGeneration"]);

/**
 * code-working-line (default design): the spark, then clock · tokens · label. The label
 * follows the turn: waiting for the model, thinking (by elapsed time, held for at least
 * 2s, then "已思考 Ns" for 2s), running tools, retrying or stopping. It pulses after 3s.
 */
function WorkingLine({ turn, timing, waiting }: { turn: TurnState; timing: ThreadState["timing"]; waiting: boolean }) {
  const now = useNow(true, 250);
  const started = (turn.startedAt ?? Math.floor(now / 1000)) * 1000;
  const seconds = Math.max(0, (now - started) / 1000);
  const step = bucket(seconds);
  const items = turn.items.filter((item) => item.type !== "userMessage");
  const last = items.at(-1);
  const reasoning = [...items].reverse().find((item) => item.type === "reasoning");
  const span = reasoning ? timing[reasoning.id] : undefined;
  // A reasoning item that is no longer last has ended even if its completion was missed.
  const thinking = span ? thinkingPhase(now, span[0], span[1] ?? (reasoning === last ? null : span[0])) : null;

  // Characters / 4, like the reference's estimate: replies and reasoning streamed so far.
  const chars = items.reduce(
    (sum, item) =>
      sum + (item.type === "agentMessage" ? item.text.length : item.type === "reasoning" ? [...item.summary, ...item.content].join("").length : 0),
    0,
  );
  const tokens = Math.round(chars / 4);

  let label: string | null = null;
  let pulse = true;
  let warn = false;
  let lead = false;
  if (waiting) {
    label = "需要你的输入";
    warn = true;
    pulse = false;
  } else if (turn.stopping) {
    label = "正在停止…";
  } else if (turn.retrying) {
    label = `正在重试 · ${turn.retrying}`;
    pulse = false;
    lead = true;
  } else if (last?.type === "contextCompaction") {
    label = "正在压缩上下文…";
    pulse = false;
    lead = true;
  } else if (thinking?.kind === "active") {
    label = thinkingLabel(seconds);
  } else if (thinking?.kind === "done") {
    label = `已思考 ${thinking.seconds} 秒`;
    pulse = false;
  } else if (!last) {
    label = "等待 Codex…";
  } else if (TOOL_TYPES.has(last.type) && "status" in last && last.status === "inProgress") {
    label = "正在运行工具…";
  }

  const clock = step >= 2 ? clockText(seconds) : null;
  const count = step >= 2 && tokens > 0 ? tokenText(tokens) : null;
  const parts: ReactNode[] = [];
  const labelNode = label && (
    <span key={label} className={`label ${pulse ? "thinking-pulse" : ""}`} data-warn={warn || undefined}>
      {label}
    </span>
  );
  if (lead && labelNode) parts.push(labelNode);
  if (clock) parts.push(<span key="clock">{clock}</span>);
  if (count && !lead) parts.push(<span key="tokens">{count}</span>);
  if (!lead && labelNode) parts.push(labelNode);
  return (
    <div className="working-line" data-turn-working="true" role="status" aria-label={label ?? "工作中"}>
      <span className="working-spark">
        <Spark size={18} />
      </span>
      <span className="working-text">
        {parts.map((part, index) => (
          <span key={index} style={{ display: "contents" }}>
            {index > 0 && <span className="dot">·</span>}
            {part}
          </span>
        ))}
      </span>
    </div>
  );
}

const TurnView = memo(function TurnView({
  turn,
  threadId,
  cwd,
  timing,
  pendingItems,
  isLast,
  waiting,
  idle,
}: {
  turn: TurnState;
  threadId: string;
  cwd: string;
  timing: ThreadState["timing"];
  pendingItems: Set<string>;
  isLast: boolean;
  /** A server request for this thread is waiting on the user. */
  waiting: boolean;
  /** No turn is running, so history can be rewound from here. */
  idle: boolean;
}) {
  const live = turn.status === "inProgress";
  const users = turn.items.filter((item) => item.type === "userMessage");
  // Items a finished turn left mid-flight (interrupt, failure) render as stopped, not spinning.
  const items = useMemo(
    () =>
      live
        ? turn.items
        : turn.items.map((item) =>
            "status" in item && item.status === "inProgress"
              ? ({ ...item, status: item.type === "commandExecution" || item.type === "fileChange" ? "declined" : "failed" } as ThreadItem)
              : item,
          ),
    [live, turn.items],
  );
  const blocks = useMemo(() => toBlocks(items), [items]);
  const lastItem = turn.items.at(-1);
  const finalText = [...turn.items].reverse().find((item) => item.type === "agentMessage")?.text;
  const changed = useMemo(() => (live ? [] : turnFiles(turn, cwd)), [live, turn, cwd]);
  const stats = changed.length ? filesStats(changed) : null;
  const files = changed.length;
  const proposedPlan = isLast && !live && turn.items.some((item) => item.type === "plan");
  const prompt = users[0]?.type === "userMessage" ? users[0] : undefined;

  const render = (block: Block, index: number): ReactNode => {
    if (block.kind === "explore") return <ExplorationGroup key={block.items[0].id} items={block.items} cwd={cwd} />;
    const { item } = block;
    const itemLive = live && item === lastItem;
    switch (item.type) {
      case "agentMessage":
        return <AgentMessage key={item.id} item={item} streaming={itemLive} />;
      case "reasoning":
        return <Reasoning key={item.id} item={item} live={itemLive} />;
      case "commandExecution":
        return <CommandRow key={item.id} item={item} pending={pendingItems.has(item.id)} cwd={cwd} />;
      case "fileChange":
        return <FileChangeCard key={item.id} item={item} pending={pendingItems.has(item.id)} cwd={cwd} />;
      case "mcpToolCall":
        return <McpCallRow key={item.id} item={item} />;
      case "webSearch":
        return <WebSearchRow key={item.id} item={item} />;
      default:
        return <GenericRow key={item.id ?? index} item={item} live={itemLive} />;
    }
  };

  return (
    <section className="turn" data-live={live || undefined}>
      {users.map(
        (item) =>
          item.type === "userMessage" && (
            <UserBubble
              key={item.id}
              item={item}
              onEdit={
                idle && item === prompt
                  ? (text) => rewindAndSend(threadId, turn.id, [...item.content.filter((part) => part.type !== "text"), { type: "text", text, text_elements: [] }])
                  : undefined
              }
            />
          ),
      )}
      <div className="agent-flow" data-cds="AssistantMessage">
        {blocks.map(render)}
        {turn.plan && <PlanTodo plan={turn.plan} />}
        {turn.status === "failed" && turn.error && (
          <div className="banner banner-error">
            <TriangleAlert size={16} />
            <div>
              <div>{turn.error.message}</div>
              {turn.error.additionalDetails && <div className="small muted">{turn.error.additionalDetails}</div>}
            </div>
          </div>
        )}
        {turn.status === "interrupted" && <div className="divider-note">已中断</div>}
        {proposedPlan && (
          <div className="plan-actions">
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                setOverride(threadId, { planMode: false });
                sendMessage(threadId, [{ type: "text", text: "按照这个计划开始实施。", text_elements: [] }]).catch(fail("发送失败"));
              }}
            >
              按此计划实施
            </Button>
            <span className="muted small">将切换回默认模式并开始执行</span>
          </div>
        )}
        {live && <WorkingLine turn={turn} timing={timing} waiting={waiting} />}
      </div>
      {!live && (
        <div className="turn-foot">
          <span className="turn-actions">
            {finalText && <CopyButton text={finalText} label="复制" />}
            {isLast && idle && prompt && (
              <Button
                variant="ghost"
                size="xs"
                muted
                icon={<RefreshCw size={16} />}
                label="重试"
                tip="重试：回退这一轮并重新发送同样的消息（不会撤销已修改的文件）"
                onClick={() => rewindAndSend(threadId, turn.id, prompt.content).catch(fail("重试失败"))}
              />
            )}
            <Button variant="ghost" size="xs" muted icon={<GitFork size={16} />} label="从这里创建分支会话" onClick={() => forkThread(threadId, turn.id).catch(fail("分支失败"))} />
          </span>
          {stats && files > 0 && (
            <Button variant="ghost" size="xs" ink2 className="changes" tip="查看改动" onClick={() => setState({ panel: "diff" })}>
              {files} 个文件
              <span className="plus">+{stats.added}</span>
              <span className="minus">−{stats.removed}</span>
            </Button>
          )}
          {turn.completedAt ? <span className="time">{timeAgo(turn.completedAt)}</span> : null}
        </div>
      )}
    </section>
  );
});

interface Heading {
  el: HTMLElement;
  level: number;
  title: string;
}

/**
 * Epitaxy document rail: one tick per heading in the replies, indented by depth.
 * Read ticks dim, the section in view turns accent. CSS hides it without gutter room.
 */
function DocumentRail({ scroller, version }: { scroller: RefObject<HTMLDivElement | null>; version: unknown }) {
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [current, setCurrent] = useState(-1);

  useEffect(() => {
    const found = [...(scroller.current?.querySelectorAll<HTMLElement>(".agent-message :is(h1, h2, h3)") ?? [])];
    const top = Math.min(...found.map((el) => Number(el.tagName[1])));
    setHeadings((previous) =>
      previous.length === found.length && previous.every((h, i) => h.el === found[i])
        ? previous
        : found.map((el) => ({ el, level: Math.min(2, Number(el.tagName[1]) - top), title: el.textContent ?? "" })),
    );
  }, [scroller, version]);

  useEffect(() => {
    const root = scroller.current;
    if (!root || headings.length < 3) return;
    const onScroll = () => {
      const line = root.getBoundingClientRect().top + root.clientHeight * 0.3;
      let index = -1;
      headings.forEach((heading, i) => {
        if (heading.el.getBoundingClientRect().top <= line) index = i;
      });
      setCurrent(index);
    };
    onScroll();
    root.addEventListener("scroll", onScroll, { passive: true });
    return () => root.removeEventListener("scroll", onScroll);
  }, [scroller, headings]);

  if (headings.length < 3) return null;
  return (
    <ul className="doc-rail" aria-label="回复目录">
      {headings.map((heading, index) => (
        <li
          key={index}
          data-level={heading.level || undefined}
          data-read={index < current || undefined}
          data-current={index === current || undefined}
          data-tip={heading.title}
          onClick={() => heading.el.scrollIntoView({ behavior: "smooth", block: "start" })}
        >
          <span />
        </li>
      ))}
    </ul>
  );
}

export function Transcript({ thread }: { thread: ThreadState }) {
  const requests = useStore((s) => s.requests);
  const defaultView = useStore((s) => s.defaultView);
  const view = thread.view ?? defaultView;
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const lastUserScroll = useRef(0);
  const restore = useRef<number | null>(null);
  const [showJump, setShowJump] = useState(false);

  const pendingItems = useMemo(() => {
    const ids = new Set<string>();
    for (const request of requests) {
      const params = request.params as { itemId?: string };
      if (requestThreadId(request) === thread.meta.id && params.itemId) ids.add(params.itemId);
    }
    return ids;
  }, [requests, thread.meta.id]);
  const waiting = requests.some((request) => requestThreadId(request) === thread.meta.id);
  const idle = thread.loaded && !thread.turns.some((turn) => turn.status === "inProgress");

  // Ctrl+O cycles normal -> thinking -> verbose for this session.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey || event.key.toLowerCase() !== "o") return;
      event.preventDefault();
      const id = thread.meta.id;
      const current = getState().threads[id]?.view ?? getState().defaultView;
      updateThread(id, (t) => ({ ...t, view: nextView(current) }));
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [thread.meta.id]);

  // Re-pin to the newest content when switching threads or when a new turn starts.
  const lastTurnId = thread.turns.at(-1)?.id;
  useLayoutEffect(() => {
    pinned.current = true;
  }, [thread.meta.id, lastTurnId]);

  // Follow streaming output only while pinned and not within 150ms of a user scroll.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (restore.current !== null) {
      el.scrollTop = el.scrollHeight - restore.current;
      restore.current = null;
      return;
    }
    if (pinned.current && performance.now() - lastUserScroll.current > 150) el.scrollTop = el.scrollHeight;
  });

  // The dock growing (an approval, a longer draft) shrinks the transcript: stay on the bottom.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      if (pinned.current) el.scrollTop = el.scrollHeight;
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    pinned.current = distance <= 40;
    setShowJump(distance > 120);
  };
  const markUserScroll = () => {
    lastUserScroll.current = performance.now();
  };

  const loadOlder = () => {
    const el = scroller.current;
    if (el) restore.current = el.scrollHeight - el.scrollTop;
    loadTurns(thread.meta.id, true).catch(fail("加载更早的消息失败"));
  };

  return (
    <ViewContext value={view}>
      <div className="transcript-wrap">
        <div className="transcript scroll-fade-y" ref={scroller} onScroll={onScroll} onWheel={markUserScroll} onTouchMove={markUserScroll}>
          <div className="transcript-list">
            {thread.olderCursor && (
              <div className="load-older">
                <Button variant="ghost" size="sm" ink2 onClick={loadOlder} disabled={thread.loading}>
                  加载更早的消息
                </Button>
              </div>
            )}
            {!thread.loaded && thread.loading && (
              <div className="transcript-loading">
                <Skeleton lines={2} />
                <Skeleton lines={4} />
              </div>
            )}
            {thread.turns.map((turn, index) => (
              <TurnView
                key={turn.id}
                turn={turn}
                threadId={thread.meta.id}
                cwd={thread.settings?.cwd ?? thread.meta.cwd}
                timing={thread.timing}
                pendingItems={pendingItems}
                isLast={index === thread.turns.length - 1}
                waiting={waiting && index === thread.turns.length - 1}
                idle={idle}
              />
            ))}
          </div>
        </div>
        <div className="transcript-fade" aria-hidden="true" />
        <DocumentRail scroller={scroller} version={thread.turns} />
        {showJump && (
          <button
            type="button"
            className="jump-latest"
            aria-label="回到底部"
            data-tip="回到底部"
            onClick={() => {
              pinned.current = true;
              scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
            }}
          >
            <ArrowDown size={20} />
          </button>
        )}
      </div>
    </ViewContext>
  );
}
