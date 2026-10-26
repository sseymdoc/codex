// ChatGPT Dots in the main column (lib/dots.ts): the account's dot with its name, 已暂停 and a
// pause / resume button, its recent tasks, and its Messages view with a composer that writes to
// the dot. With no dot yet, the Codex desktop app's introduction creates one. Strings are that
// app's zh-CN ones (orbit.* / restricted.aeon.*).

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { errorMessage } from "../lib/codex";
import { createDot, loadDot, loadDotActivity, loadDotMessages, markDotRead, sendDotMessage, setDotPaused, useDots, type DotMessage, type DotTask } from "../lib/dots";
import { timeAgo } from "../lib/format";
import { toast, useStore } from "../lib/store";
import { CloudComposer } from "./CloudTask";
import { Markdown, PlainLinks } from "./content";
import { quietMenu, useLiftSlot } from "./Main";
import { Button, Icon, Spinner } from "./ui";

const MESSAGES_MS = 5000;
const ACTIVITY_MS = 30_000;
/** How long a message with no reply yet reads as awaiting one. */
const AWAITING_MS = 120_000;

const TASK_TEXT: Record<DotTask["status"], string> = { running: "进行中", succeeded: "已完成", failed: "失败", interrupted: "已中断" };

/** The Codex desktop app's dot entry mark (app-primary `DAn`): two rings. */
export function DotMark({ className }: { className?: string }) {
  return (
    <svg className={className} width="1em" height="1em" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path stroke="currentColor" strokeWidth={1.33} d="M10.01 7.07a2.938 2.938 0 1 1 0 5.876 2.938 2.938 0 0 1 0-5.877Z" />
      <path stroke="currentColor" strokeWidth={1.33} d="M10.008 2.665a7.343 7.343 0 1 1 0 14.686 7.343 7.343 0 0 1 0-14.686Z" />
    </svg>
  );
}

/** `run` now and every `ms` while `on` and the window shows. */
function usePoll(run: () => void, ms: number, on: boolean) {
  useEffect(() => {
    if (!on) return;
    run();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") run();
    }, ms);
    return () => clearInterval(timer);
  }, [on, ms]); // eslint-disable-line react-hooks/exhaustive-deps
}

export function DotsView() {
  const dot = useDots((s) => s.dot);
  const dotError = useDots((s) => s.dotError);
  const messages = useDots((s) => s.messages);
  const messagesError = useDots((s) => s.messagesError);
  const activity = useDots((s) => s.activity);
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const slot = useLiftSlot();
  const [busy, setBusy] = useState(false);
  const title = dot?.name ?? "你的 Dot";
  const last = messages?.at(-1);
  const awaiting = last?.role === "user" && Date.now() - Date.parse(last.createdAt) < AWAITING_MS;

  useEffect(() => void loadDot(), []);
  usePoll(() => void loadDotMessages(), MESSAGES_MS, !!dot);
  usePoll(() => void loadDotActivity(), ACTIVITY_MS, !!dot);
  useEffect(() => markDotRead(), [messages]);
  useEffect(() => {
    document.title = `${title} - Codex`;
  }, [title]);

  const togglePause = async () => {
    if (!dot) return;
    setBusy(true);
    try {
      await setDotPaused(!dot.paused);
    } catch (error) {
      toast("warning", dot.paused ? "无法继续运行你的 Dot" : "无法暂停你的 Dot", errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const bar = (
    <header className="chat-header" data-tip-group="" data-density="compact" data-collapsed={(!sidebarOpen && !slot) || undefined}>
      <h1 className="draft-title cloud-title">
        <DotMark className="dots-title-mark" />
        <span className="cloud-title-text">{title}</span>
        {dot?.paused && <span className="dots-paused">已暂停</span>}
      </h1>
      <span className="spacer" />
      {dot && (
        <div className="header-actions" data-tip-group="">
          <Button
            variant="ghost"
            icon={<Icon name={dot.paused ? "Play" : "Pause"} />}
            label={busy ? (dot.paused ? "正在继续运行…" : "正在暂停…") : dot.paused ? "继续运行你的 Dot" : "暂停你的 Dot"}
            disabled={busy}
            onClick={() => void togglePause()}
          />
        </div>
      )}
    </header>
  );

  return (
    <div className="main-col" onContextMenu={quietMenu}>
      {slot ? createPortal(bar, slot) : bar}
      <div className="session-row">
        <div className="session-chat">
          <div className="transcript-wrap">
            <div className="transcript" role="feed" aria-label="对话消息" aria-busy={dot === undefined || (!!dot && messages === null)}>
              {dot === undefined ? (
                dotError ? <Notice title="未能加载您的 Dot" body={dotError} action="重试" onAction={() => void loadDot()} /> : <Loading label="正在加载你的 Dot" />
              ) : dot === null ? (
                <DotIntro />
              ) : (
                <PlainLinks value>
                  {messages === null ? (
                    messagesError ? <Notice title="无法加载消息" body={messagesError} action="重试" onAction={() => void loadDotMessages()} /> : <Loading label="正在加载消息" />
                  ) : (
                    <div className="transcript-list">
                      {!!activity?.length && <DotActivity tasks={activity} />}
                      {messages.map((message) => <DotMessageRow key={message.id} message={message} />)}
                      {awaiting && (
                        <p className="cloud-status" role="status">
                          <Spinner size={14} />
                          正在等待回复…
                        </p>
                      )}
                    </div>
                  )}
                </PlainLinks>
              )}
            </div>
          </div>
          {dot && (
            <div className="dock">
              <CloudComposer onSend={sendDotMessage} disabled={false} placeholder="发送消息" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Loading({ label }: { label: string }) {
  return <div className="transcript-loading" role="status"><Spinner /><span className="sr-only">{label}</span></div>;
}

function Notice({ title, body, action, onAction }: { title: string; body: string; action: string; onAction(): void }) {
  return (
    <div className="transcript-empty" role="alert">
      <div className="transcript-empty-text">
        <p className="transcript-empty-title">{title}</p>
        <p className="transcript-empty-body">{body}</p>
      </div>
      <div className="transcript-empty-actions">
        <Button variant="primary" onClick={onAction}>{action}</Button>
      </div>
    </div>
  );
}

/** The desktop app's introduction (restricted.orbitIntroduction), then its creating step. */
function DotIntro() {
  const creating = useDots((s) => s.creating);
  const createError = useDots((s) => s.createError);
  return (
    <div className="transcript-empty dots-intro" role={createError ? "alert" : undefined}>
      <DotMark className="dots-intro-mark" />
      <div className="transcript-empty-text">
        <p className="transcript-empty-title">{creating ? "正在为您创建 Dot" : createError ? "无法完成 Dot 设置" : "创建你的 Dot"}</p>
        <p className="transcript-empty-body">{createError ?? "Dot 是本领出众、始终在线的智能体"}</p>
      </div>
      <div className="transcript-empty-actions">
        {creating ? <Spinner /> : <Button variant="primary" onClick={() => void createDot()}>{createError ? "重试" : "继续"}</Button>}
      </div>
    </div>
  );
}

/** The dot's latest work threads (side-panel activity): read only, the work runs in ChatGPT's cloud. */
function DotActivity({ tasks }: { tasks: DotTask[] }) {
  return (
    <section className="dots-activity" aria-label="最近任务">
      <h2 className="dots-activity-head">最近任务</h2>
      <ul className="dots-tasks">
        {tasks.map((task) => (
          <li key={task.id} className="dots-task" data-status={task.status}>
            <span className="dots-task-mark" aria-hidden="true">{task.status === "running" ? <Spinner size={14} /> : (task.emoji ?? <Icon name={task.status === "succeeded" ? "Check" : "Warning"} size="sm" />)}</span>
            <span className="dots-task-title">{task.title}</span>
            <span className="dots-task-meta">{[TASK_TEXT[task.status], timeAgo(task.updatedAt)].filter(Boolean).join(" · ")}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function DotMessageRow({ message }: { message: DotMessage }) {
  if (message.role === "system") return <p className="cloud-status">{message.text}</p>;
  if (message.role === "user") {
    return (
      <section className="turn">
        <div className="turn-prompt">
          <div className="user-row">
            <h2 className="sr-only">您说：{message.text}</h2>
            <div className="user-bubble"><div className="user-text">{message.text}</div></div>
          </div>
        </div>
      </section>
    );
  }
  return (
    <section className="turn">
      <div className="reply-row">
        <div className="agent-flow cloud-reply" data-cds="AssistantMessage" data-text-size="">
          <div className="agent-message">
            <Markdown text={message.text} voice breaks className="prose" />
          </div>
        </div>
      </div>
    </section>
  );
}
