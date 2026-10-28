// A dot's work in the main column (lib/dot-work.ts): its root thread, or the task it is looking
// at, drawn as a Claude transcript from the dot's durable host. The root thread and task threads
// take messages and can be stopped; a sub-agent's record is read only, as Codex's agent records are.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { errorMessage } from "../lib/codex";
import { closeDotTask, loadOlderDotTurns, openDotThread, sendToDotThread, stopDotThread, useDotWork } from "../lib/dot-work";
import type { Dot } from "../lib/dots";
import type { ShellTask } from "../lib/background";
import { toast, useStore, type TurnState } from "../lib/store";
import { CloudComposer } from "./CloudTask";
import { Button, Icon, ShimmerText, Spinner } from "./ui";
import { TurnView } from "./Transcript";

const NO_IDS = new Set<string>();
const NO_NOTICES: never[] = [];
const NO_SHELLS: ShellTask[] = [];

export function DotWorkView({ dot }: { dot: Dot }) {
  const taskId = useDotWork((s) => s.taskId);
  const threadId = taskId ?? dot.rootThreadId;
  const thread = useStore((s) => (threadId ? s.durableThreads[threadId] : undefined));
  const failure = useDotWork((s) => (threadId ? s.failures[threadId] : ""));
  const task = useDotWork((s) => (taskId ? s.tasks[taskId] : undefined));
  const [stopping, setStopping] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const restore = useRef<{ height: number; top: number; count: number } | null>(null);
  const interactive = !taskId || task?.interactive === true;
  const turns: TurnState[] = thread?.turns ?? [];
  const running = turns.some((turn) => turn.status === "inProgress");

  useEffect(() => {
    if (threadId) void openDotThread(threadId);
  }, [threadId]);

  // A new turn (yours, or the dot's) brings the view back to the bottom.
  const lastTurn = turns.at(-1)?.id;
  useLayoutEffect(() => {
    pinned.current = true;
  }, [threadId, lastTurn]);

  // Older turns paged in above keep what was on screen in place; otherwise follow the bottom.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const kept = restore.current;
    if (kept) {
      if (turns.length !== kept.count) {
        el.scrollTop = kept.top + el.scrollHeight - kept.height;
        restore.current = null;
      }
      return;
    }
    if (pinned.current) el.scrollTop = el.scrollHeight;
  });

  const stop = async () => {
    if (!threadId) return;
    setStopping(true);
    try {
      await stopDotThread(threadId);
    } catch (error) {
      toast("warning", "无法停止此任务", errorMessage(error));
    } finally {
      setStopping(false);
    }
  };

  return (
    <>
      <div className="transcript-wrap">
        <div
          ref={scroller}
          className="transcript"
          role="feed"
          aria-label={taskId ? "任务对话" : "Dot 的工作"}
          aria-busy={!thread?.loaded}
          onScroll={(event) => {
            const el = event.currentTarget;
            pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight <= 40;
            if (el.scrollTop < 200 && threadId && thread?.olderCursor && !thread.loading) {
              restore.current = { height: el.scrollHeight, top: el.scrollTop, count: turns.length };
              void loadOlderDotTurns(threadId);
            }
          }}
        >
          {taskId && (
            <div className="dots-task-bar">
              <Button variant="ghost" size="sm" icon={<Icon name="ArrowLeft" size="sm" />} onClick={closeDotTask}>关闭任务</Button>
              <span className="dots-task-bar-title">{task?.title ?? "任务"}</span>
              {!interactive && <span className="dots-paused">只读</span>}
            </div>
          )}
          {!threadId ? (
            <div className="transcript-empty"><div className="transcript-empty-text"><p className="transcript-empty-title">你的 Dot 还没有开始工作</p></div></div>
          ) : failure ? (
            <div className="transcript-empty" role="alert">
              <div className="transcript-empty-text">
                <p className="transcript-empty-title">{taskId ? "未成功打开任务" : "无法加载消息"}</p>
                <p className="transcript-empty-body">{failure}</p>
              </div>
              <div className="transcript-empty-actions"><Button variant="primary" onClick={() => void openDotThread(threadId)}>重试</Button></div>
            </div>
          ) : !thread?.loaded ? (
            <div className="transcript-loading" role="status"><Spinner /><span className="sr-only">正在加载</span></div>
          ) : (
            <div className="transcript-list">
              {thread.olderCursor && (
                <div className="older-row" role="status">
                  {thread.olderError ? <Button variant="ghost" size="xs" onClick={() => void loadOlderDotTurns(threadId)}>重试</Button> : thread.loading && <Spinner size={16} />}
                </div>
              )}
              {turns.map((turn) => (
                <TurnView
                  key={turn.id}
                  turn={turn}
                  threadId={threadId}
                  cwd=""
                  timing={thread.timing}
                  pendingItems={NO_IDS}
                  idle={!running}
                  model=""
                  fresh={NO_IDS}
                  notices={NO_NOTICES}
                  progress={thread.progress ?? {}}
                  forkBase={undefined}
                  catching={false}
                  answered=""
                  shells={NO_SHELLS}
                  readOnly
                />
              ))}
              {running && <p className="cloud-status" role="status"><ShimmerText>正在处理</ShimmerText></p>}
            </div>
          )}
        </div>
      </div>
      {threadId && interactive && (
        <div className="dock">
          {running && (
            <div className="dots-work-stop">
              <Button variant="secondary" size="sm" icon={<Icon name="StopCircle" size="sm" />} disabled={stopping} onClick={() => void stop()}>停止任务</Button>
            </div>
          )}
          <CloudComposer onSend={(text) => sendToDotThread(threadId, text)} disabled={!thread?.loaded} placeholder="发送消息" />
        </div>
      )}
    </>
  );
}
