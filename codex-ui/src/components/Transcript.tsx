// Conversation transcript: turns, timeline items, live status, scroll pinning and
// the Epitaxy document rail for long replies.

import type { ThreadItem } from "@protocol/v2/ThreadItem";
import { ArrowDown, Check, Circle, CircleDot, FileDiff, GitFork, ListTodo, RefreshCw, RotateCw, TriangleAlert } from "lucide-react";
import { Fragment, memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { errorMessage, forkThread, loadTurns, requestThreadId, rewindAndSend, sendMessage, setOverride } from "../lib/codex";
import { diffStats, formatDuration } from "../lib/format";
import { setState, toast, useStore, type ThreadState, type TurnState } from "../lib/store";
import {
  AgentMessage,
  CommandRow,
  ExplorationGroup,
  FileChangeCard,
  GenericRow,
  McpCallRow,
  Reasoning,
  UserBubble,
  WebSearchRow,
  isExploration,
} from "./items";
import { CopyButton, QuietDots, Skeleton, Spinner, StatusDot } from "./ui";

function useNow(active: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
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
          <ListTodo size={14} />
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
  const now = useNow(live);
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
  const lastLive = live && lastItem && (lastItem.type === "reasoning" || ("status" in lastItem && lastItem.status === "inProgress") || lastItem.type === "agentMessage");
  const finalText = [...turn.items].reverse().find((item) => item.type === "agentMessage")?.text;
  const stats = turn.diff ? diffStats(turn.diff) : null;
  const files = turn.diff ? (turn.diff.match(/^diff --git /gm) ?? []).length : 0;
  const elapsed = turn.startedAt ? now - turn.startedAt * 1000 : 0;
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
        return <Reasoning key={item.id} item={item} live={itemLive} timing={timing[item.id]} />;
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
      <div className="agent-flow">
        {blocks.map(render)}
        {turn.plan && <PlanTodo plan={turn.plan} />}
        {live && waiting && (
          <div className="live-status">
            <StatusDot kind="clay" />
            <span>等待你的确认</span>
          </div>
        )}
        {live && !waiting && !lastLive && (
          <div className="live-status">
            <QuietDots />
            <span className="shimmer">{turn.retrying ? `正在重试：${turn.retrying}` : "处理中"}</span>
            <span className="muted tabular">{formatDuration(Math.max(0, elapsed))}</span>
          </div>
        )}
        {live && lastLive && turn.retrying && (
          <div className="live-status">
            <RotateCw size={13} /> <span>正在重试：{turn.retrying}</span>
          </div>
        )}
        {turn.status === "failed" && turn.error && (
          <div className="banner banner-error">
            <TriangleAlert size={15} />
            <div>
              <div>{turn.error.message}</div>
              {turn.error.additionalDetails && <div className="small muted">{turn.error.additionalDetails}</div>}
            </div>
          </div>
        )}
        {turn.status === "interrupted" && <div className="divider-note">已中断</div>}
        {proposedPlan && (
          <div className="plan-actions">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => {
                setOverride(threadId, { planMode: false });
                sendMessage(threadId, [{ type: "text", text: "按照这个计划开始实施。", text_elements: [] }]).catch(fail("发送失败"));
              }}
            >
              <span className="btn-label">按此计划实施</span>
            </button>
            <span className="muted small">将切换回默认模式并开始执行</span>
          </div>
        )}
      </div>
      {!live && (
        <div className="turn-foot">
          {turn.durationMs !== null && <span className="tabular">用时 {formatDuration(turn.durationMs)}</span>}
          {stats && files > 0 && (
            <button type="button" className="chip-btn" onClick={() => setState({ panel: "diff" })}>
              <FileDiff size={13} /> {files} 个文件
              <span className="plus">+{stats.added}</span>
              <span className="minus">-{stats.removed}</span>
            </button>
          )}
          <span className="turn-foot-actions">
            {finalText && <CopyButton text={finalText} label="复制回复" />}
            {isLast && idle && prompt && (
              <button
                type="button"
                className="icon-btn icon-btn-sm"
                title="重新生成：回退这一轮并重新发送同样的消息（不会撤销已修改的文件）"
                aria-label="重新生成"
                onClick={() => rewindAndSend(threadId, turn.id, prompt.content).catch(fail("重新生成失败"))}
              >
                <RefreshCw size={14} />
              </button>
            )}
            <button
              type="button"
              className="icon-btn icon-btn-sm"
              title="从这里创建分支会话"
              aria-label="从这里创建分支会话"
              onClick={() => forkThread(threadId, turn.id).catch(fail("分支失败"))}
            >
              <GitFork size={14} />
            </button>
          </span>
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
          title={heading.title}
          onClick={() => heading.el.scrollIntoView({ behavior: "smooth", block: "start" })}
        >
          <span />
        </li>
      ))}
    </ul>
  );
}

/** `onReading` reports whether the user has scrolled away from the latest output. */
export function Transcript({ thread, onReading }: { thread: ThreadState; onReading?: (reading: boolean) => void }) {
  const requests = useStore((s) => s.requests);
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const reading = useRef(false);
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

  // Re-pin to the newest content when switching threads or when a new turn starts.
  const lastTurnId = thread.turns.at(-1)?.id;
  useLayoutEffect(() => {
    pinned.current = true;
  }, [thread.meta.id, lastTurnId]);

  // Follow streaming output (and dock growth) only while pinned and the user is not mid-scroll.
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

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    pinned.current = distance <= 40;
    setShowJump(distance > 120);
    const away = distance > 320;
    if (away !== reading.current) {
      reading.current = away;
      onReading?.(away);
    }
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
    <div className="transcript-wrap">
      <div className="transcript scroll-fade" ref={scroller} onScroll={onScroll} onWheel={markUserScroll} onTouchMove={markUserScroll}>
        <div className="transcript-inner">
          {thread.olderCursor && (
            <div className="load-older">
              <button type="button" className="chip-btn" onClick={loadOlder} disabled={thread.loading}>
                {thread.loading ? <Spinner size={12} /> : null} 加载更早的消息
              </button>
            </div>
          )}
          {!thread.loaded && thread.loading && (
            <div className="transcript-loading">
              <Skeleton lines={2} />
              <Skeleton lines={4} />
            </div>
          )}
          {thread.turns.map((turn, index) => (
            <Fragment key={turn.id}>
              <TurnView
                turn={turn}
                threadId={thread.meta.id}
                cwd={thread.settings?.cwd ?? thread.meta.cwd}
                timing={thread.timing}
                pendingItems={pendingItems}
                isLast={index === thread.turns.length - 1}
                waiting={waiting && index === thread.turns.length - 1}
                idle={idle}
              />
            </Fragment>
          ))}
        </div>
      </div>
      <DocumentRail scroller={scroller} version={thread.turns} />
      {showJump && (
        <button
          type="button"
          className="jump-latest"
          aria-label="跳到最新"
          title="跳到最新"
          onClick={() => {
            pinned.current = true;
            scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
          }}
        >
          <ArrowDown size={16} />
        </button>
      )}
    </div>
  );
}
