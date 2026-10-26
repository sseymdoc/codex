// A Codex Cloud task in the main column: its prompts and replies as the transcript draws a
// session's (user bubble, prose reply, file diff cards), the reply's state, and a composer that
// sends follow-ups. The header opens the task on chatgpt.com, applies its diff to a local folder
// (`codex apply`), cancels a running turn and archives the task.

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import {
  applyCloudDiff,
  archiveCloudTask,
  cancelCloudTask,
  cloudTaskUrl,
  followUpCloudTask,
  markCloudTaskRead,
  readCloudTask,
  runningStatus,
  useCloud,
  type CloudTurn,
} from "../lib/cloud";
import { errorMessage, newChat } from "../lib/codex";
import { filesStats, splitUnifiedDiff } from "../lib/diff";
import { toast, useStore } from "../lib/store";
import { FileDiffCard, Markdown, PlainLinks } from "./content";
import { FolderDialog } from "./Dialogs";
import { quietMenu, useLiftSlot } from "./Main";
import { Button, Icon, Spinner } from "./ui";

const POLL_MS = 5000;

const STATUS_TEXT: Record<CloudTurn["status"], string> = { pending: "排队中…", in_progress: "正在运行…", completed: "已完成", cancelled: "已取消", failed: "失败" };

export function CloudTaskView({ id }: { id: string }) {
  const detail = useCloud((s) => s.details[id]);
  const loadError = useCloud((s) => s.detailErrors[id]);
  const summary = useCloud((s) => s.tasks?.find((task) => task.id === id));
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const slot = useLiftSlot();
  const [applying, setApplying] = useState(false);
  const [busy, setBusy] = useState(false);
  const status = detail?.task.status ?? summary?.status ?? "pending";
  const running = runningStatus(status);
  const title = detail?.task.title ?? summary?.title ?? "云端任务";
  const diff = detail?.turns.findLast((turn) => turn.role === "assistant" && turn.diff)?.diff ?? null;

  useEffect(() => void readCloudTask(id), [id]);
  // A reply that lands while the task is open is read here (the list may not hold it yet on open).
  useEffect(() => {
    if (summary?.unread) markCloudTaskRead(id);
  }, [id, summary?.unread]);
  // The extension polls a running task; a finished one is read once.
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => void readCloudTask(id), POLL_MS);
    return () => clearInterval(timer);
  }, [id, running]);

  useEffect(() => {
    document.title = `${title} - Codex`;
  }, [title]);

  const act = (run: () => Promise<unknown>, failed: string) => async () => {
    setBusy(true);
    try {
      await run();
    } catch (error) {
      toast("warning", failed, errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const bar = (
    <header className="chat-header" data-tip-group="" data-density="compact" data-collapsed={(!sidebarOpen && !slot) || undefined}>
      <h1 className="draft-title cloud-title">
        <Icon name="Cloud" size="sm" />
        <span className="cloud-title-text">{title}</span>
      </h1>
      <span className="spacer" />
      <div className="header-actions" data-tip-group="">
        {running && <Button variant="ghost" icon={<Icon name="StopCircle" />} label="取消任务" disabled={busy || detail?.turns.at(-1)?.cancelling} onClick={act(() => cancelCloudTask(id), "无法取消任务")} />}
        <Button variant="ghost" icon={<Icon name="Download" />} label="应用到本地" tip={diff ? "应用到本地" : "此任务还没有更改"} disabled={!diff || busy} onClick={() => setApplying(true)} />
        <Button variant="ghost" icon={<Icon name="ArrowOutSquare" />} label="在网页中打开" onClick={() => window.open(cloudTaskUrl(id), "_blank", "noopener")} />
        <Button variant="ghost" icon={<Icon name="Archive" />} label="归档" disabled={busy} onClick={act(async () => { await archiveCloudTask(id); newChat(); }, "无法归档任务")} />
      </div>
    </header>
  );

  return (
    <div className="main-col" onContextMenu={quietMenu}>
      {slot ? createPortal(bar, slot) : bar}
      <div className="session-row">
        <div className="session-chat">
          <div className="transcript-wrap">
            <div className="transcript" role="feed" aria-label="对话消息" aria-busy={running}>
              {!detail ? (
                loadError ? (
                  <div className="transcript-empty" role="alert">
                    <div className="transcript-empty-text">
                      <p className="transcript-empty-title">无法加载此任务</p>
                      <p className="transcript-empty-body">{loadError}</p>
                    </div>
                    <div className="transcript-empty-actions">
                      <Button variant="primary" onClick={() => void readCloudTask(id)}>重试</Button>
                    </div>
                  </div>
                ) : (
                  <div className="transcript-loading" role="status"><Spinner /><span className="sr-only">正在加载任务</span></div>
                )
              ) : (
                // The task's files live in its cloud checkout: their names do not open local files.
                <PlainLinks value>
                  <div className="transcript-list">
                    {detail.turns.map((turn) => (turn.role === "user" ? <CloudPrompt key={turn.id} turn={turn} /> : <CloudReply key={turn.id} turn={turn} />))}
                  </div>
                </PlainLinks>
              )}
            </div>
          </div>
          <div className="dock">
            <CloudComposer onSend={(text) => followUpCloudTask(id, text)} disabled={!detail || running} placeholder={!detail || running ? "任务运行时无法追问" : "追问此任务"} />
          </div>
        </div>
      </div>
      {applying && diff && (
        <FolderDialog
          title="应用到本地"
          description="将此任务的更改应用到所选的 Git 仓库文件夹；与本地文件冲突时不会做任何更改。"
          onClose={() => setApplying(false)}
          onChoose={(path) => {
            setApplying(false);
            applyCloudDiff(path, diff).then(() => toast("neutral", "已应用更改", path), (error) => toast("warning", "无法应用更改", errorMessage(error)));
          }}
        />
      )}
    </div>
  );
}

function CloudPrompt({ turn }: { turn: CloudTurn }) {
  return (
    <section className="turn">
      <div className="turn-prompt">
        <div className="user-row">
          <h2 className="sr-only">您说：{turn.text}</h2>
          <div className="user-bubble"><div className="user-text">{turn.text}</div></div>
        </div>
      </div>
    </section>
  );
}

function CloudReply({ turn }: { turn: CloudTurn }) {
  const files = useMemo(() => (turn.diff ? splitUnifiedDiff(turn.diff) : []), [turn.diff]);
  const stats = filesStats(files);
  const running = runningStatus(turn.status);
  return (
    <section className="turn">
      <div className="reply-row">
        <div className="agent-flow cloud-reply" data-cds="AssistantMessage" data-text-size="">
          {turn.text && (
            <div className="agent-message">
              <Markdown text={turn.text} voice breaks className="prose" />
            </div>
          )}
          {files.length > 0 && (
            <div className="cloud-diff">
              <p className="cloud-diff-head">
                <span>{files.length} 个文件已更改</span>
                <span className="diff-stat">
                  <span className="plus">+{stats.added}</span>
                  <span className="minus">−{stats.removed}</span>
                </span>
              </p>
              {files.map((file) => <FileDiffCard key={`${file.path}:${file.movePath ?? ""}`} file={file} />)}
            </div>
          )}
          {(running || turn.status !== "completed") && (
            <p className={turn.status === "failed" ? "cloud-status error-text" : "cloud-status"} role="status">
              {running && <Spinner size={14} />}
              {turn.cancelling ? "正在取消…" : STATUS_TEXT[turn.status]}
              {turn.error && `：${turn.error}`}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

/** Follow-ups: text only, as Codex Cloud (and a dot) takes them; Enter sends, Shift+Enter breaks the line. */
export function CloudComposer({ onSend, disabled, placeholder }: { onSend(text: string): Promise<unknown>; disabled: boolean; placeholder: string }) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const composing = useRef(false);
  const send = async () => {
    const body = text.trim();
    if (!body || sending || disabled) return;
    setSending(true);
    try {
      await onSend(body);
      setText("");
    } catch (error) {
      toast("warning", "发送失败", errorMessage(error));
    } finally {
      setSending(false);
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  };
  const hasInput = !!text.trim();
  return (
    <fieldset className="composer-wrap" data-form="reply">
      <div className="composer">
        <div className="composer-body">
          <div className="composer-editor">
            <textarea
              className="composer-input"
              value={text}
              rows={1}
              autoFocus
              aria-label="提示词"
              onChange={(event) => setText(event.target.value)}
              onKeyDown={onKeyDown}
              onCompositionStart={() => (composing.current = true)}
              onCompositionEnd={() => (composing.current = false)}
            />
            {!text && <span className="composer-placeholder" aria-hidden="true">{placeholder}</span>}
          </div>
          <span className="composer-trailing">
            <span className="send-slot">
              <Button
                data-on={hasInput || undefined}
                inert={!hasInput}
                aria-hidden={!hasInput || undefined}
                aria-busy={sending || undefined}
                variant="ghost"
                icon={sending ? <Spinner size={16} inherit /> : <Icon name="ArrowReturn" />}
                label={sending ? "正在发送" : "发送"}
                disabled={sending || disabled}
                onClick={() => void send()}
              />
            </span>
          </span>
        </div>
      </div>
    </fieldset>
  );
}
