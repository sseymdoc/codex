// ChatGPT Dots in the main column (lib/dots.ts): the account's dot with its name, 已暂停 and a
// pause / resume button, its recent tasks, and its Messages view with a composer that writes to
// the dot. With no dot yet, the Codex desktop app's introduction creates one. Behavior follows
// that app (native-room, message-row); strings are its zh-CN ones (orbit.* / restricted.aeon*).
// The room reads as a Claude transcript: your messages in the bubble on the right, the dot's as
// replies under its avatar and name, a group's later messages under the same heading.

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { connectionId, errorMessage } from "../lib/codex";
import {
  answerDotElicitation, answerDotOption, applyDotEvent, createDot, dotContentUrl, dotFile, dotsState, layoutRows, loadDot, loadDotActivity,
  loadDotMessages, loadDotReplies, loadDotTranscript, loadOlderDotMessages, markDotRead, noteDotTyping, openDotRoom, optionState,
  readDotElicitation, receiptOf, retryDotMessage, senderName, sendDotMessage, setDotPaused, setDotsLive, shownMessages, uploadDotFile, useDots,
  type DotAttachment, type DotElicitation, type DotMessage, type DotReceipt, type DotRoom, type DotTask, type DotTranscript,
} from "../lib/dots";
import { timeAgo } from "../lib/format";
import { toast, useStore } from "../lib/store";
import { CloudComposer } from "./CloudTask";
import { Markdown, PlainLinks } from "./content";
import { openLightbox } from "./Lightbox";
import { quietMenu, useLiftSlot } from "./Main";
import { Button, Dialog, Icon, ShimmerText, Spinner } from "./ui";

/** Polling while the pubsub socket is down, and as a backstop while it is up. */
const MESSAGES_MS = 5000;
const LIVE_MESSAGES_MS = 60_000;
const ACTIVITY_MS = 30_000;
/** How long a message with no reply yet reads as awaiting one (without the socket's typing). */
const AWAITING_MS = 120_000;
const MAX_FILES = 8;
const MAX_FILE_MB = 20;
const NEAR_TOP = 200;

const TASK_TEXT: Record<DotTask["status"], string> = { running: "进行中", succeeded: "已完成", failed: "失败", interrupted: "已中断" };
const CHANNELS: Record<string, string> = { imessage: "已通过 iMessage 发送", sms: "已通过短信发送", rcs: "已通过 RCS 发送", phone: "已通过短信发送" };
const CALL_OUTCOMES: Record<string, string> = { failed: "通话失败", interrupted: "通话已中断", not_connected: "通话未接通" };
const TRANSCRIPT_FEEDBACK: Record<Exclude<DotTranscript["state"], "ready">, string> = {
  empty: "未捕捉到语音", unavailable: "转录文本不可用", notReady: "转录文本尚未就绪", error: "无法加载转录文本",
};

/** The Codex desktop app's dot entry mark (app-primary `DAn`): two rings. */
export function DotMark({ className }: { className?: string }) {
  return (
    <svg className={className} width="1em" height="1em" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path stroke="currentColor" strokeWidth={1.33} d="M10.01 7.07a2.938 2.938 0 1 1 0 5.876 2.938 2.938 0 0 1 0-5.877Z" />
      <path stroke="currentColor" strokeWidth={1.33} d="M10.008 2.665a7.343 7.343 0 1 1 0 14.686 7.343 7.343 0 0 1 0-14.686Z" />
    </svg>
  );
}

/** A room member's round avatar: their picture, else the dot's mark (or a member's initial). */
export function DotAvatar({ url, name = "", dot = true, size = 20 }: { url?: string; name?: string; dot?: boolean; size?: number }) {
  const [broken, setBroken] = useState(false);
  const src = url && !broken ? dotContentUrl(url, "avatar") : "";
  return (
    <span className="dots-avatar" data-dot={dot || undefined} style={{ "--dots-avatar": `${size}px` } as CSSProperties} aria-hidden="true">
      {src ? <img src={src} alt="" onError={() => setBroken(true)} /> : dot ? <DotMark /> : [...name.trim()][0]?.toUpperCase() ?? "?"}
    </span>
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

/** The pubsub socket's events for this page (bridge /api/dots/events) while a room is open. */
function useDotEvents(roomId: string | null) {
  useEffect(() => {
    const id = connectionId();
    if (!roomId || !id) return;
    const source = new EventSource(`/api/dots/events?c=${encodeURIComponent(id)}`);
    source.addEventListener("dots", (event) => {
      try { applyDotEvent(JSON.parse((event as MessageEvent<string>).data)); } catch { /* A bad frame is dropped. */ }
    });
    source.addEventListener("live", (event) => {
      try { setDotsLive(JSON.parse((event as MessageEvent<string>).data).live === true); } catch { /* idem */ }
    });
    return () => {
      source.close();
      setDotsLive(false);
    };
  }, [roomId]);
}

const clock = (iso: string) => new Date(iso).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });

/** A time divider's words (roomUi.todayAtTime / yesterdayAtTime / dateAtTime). */
function when(iso: string): string {
  const at = new Date(iso);
  const day = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((day(new Date()) - day(at)) / 86_400_000);
  if (days === 0) return `今天 ${clock(iso)}`;
  if (days === 1) return `昨天 ${clock(iso)}`;
  const date = at.toLocaleDateString("zh-CN", { month: "long", day: "numeric", ...(at.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}) });
  return `${date} ${clock(iso)}`;
}

interface Upload {
  key: string;
  file: File;
  /** An image's local preview (object URL). */
  preview: string;
  attachment?: DotAttachment;
  failed?: boolean;
}

export function DotsView() {
  const dot = useDots((s) => s.dot);
  const dotError = useDots((s) => s.dotError);
  const messages = useDots((s) => s.messages);
  const messagesError = useDots((s) => s.messagesError);
  const activity = useDots((s) => s.activity);
  const live = useDots((s) => s.live);
  const room = useDots((s) => s.room);
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const slot = useLiftSlot();
  const [busy, setBusy] = useState(false);
  const [replyTo, setReplyTo] = useState<DotMessage | null>(null);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const title = dot?.name ?? "你的 Dot";
  const roomId = dot?.roomId ?? null;

  useEffect(() => void loadDot(), []);
  useEffect(() => {
    if (dot) void openDotRoom();
  }, [dot?.id, roomId]); // eslint-disable-line react-hooks/exhaustive-deps
  useDotEvents(roomId);
  usePoll(() => void loadDotMessages(), live ? LIVE_MESSAGES_MS : MESSAGES_MS, !!dot && messages !== null);
  usePoll(() => void loadDotActivity(), ACTIVITY_MS, !!dot);
  useEffect(() => markDotRead(), [messages]);
  useEffect(() => {
    document.title = `${title} - Codex`;
  }, [title]);
  // Previews belong to this page: let them go with it.
  const previews = useRef(uploads);
  previews.current = uploads;
  useEffect(() => () => previews.current.forEach((upload) => upload.preview && URL.revokeObjectURL(upload.preview)), []);

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

  const upload = (entry: Upload) => {
    uploadDotFile(entry.file).then(
      (attachment) => setUploads((current) => current.map((item) => (item.key === entry.key ? { ...item, attachment, failed: false } : item))),
      () => setUploads((current) => current.map((item) => (item.key === entry.key ? { ...item, failed: true } : item))),
    );
  };

  const addFiles = (files: File[]) => {
    if (uploads.length + files.length > MAX_FILES) return toast("warning", `最多可添加 ${MAX_FILES} 个附件`);
    const fits = files.filter((file) => file.size <= MAX_FILE_MB * 1024 * 1024);
    if (fits.length < files.length) toast("warning", `附件大小不得超过 ${MAX_FILE_MB} MB`);
    const added = fits.map((file): Upload => ({
      key: crypto.randomUUID(), file, preview: file.type.startsWith("image/") ? URL.createObjectURL(file) : "",
    }));
    setUploads((current) => [...current, ...added]);
    added.forEach(upload);
  };

  const removeUpload = (key: string) => setUploads((current) => current.filter((item) => {
    if (item.key === key && item.preview) URL.revokeObjectURL(item.preview);
    return item.key !== key;
  }));

  const uploading = uploads.some((item) => !item.attachment && !item.failed);
  const ready = uploads.flatMap((item) => (item.attachment ? [item.attachment] : []));

  // The message shows at once and carries its own delivery state: the composer clears right away.
  const send = async (text: string) => {
    if (uploading) return;
    void sendDotMessage({ text, files: ready, replyTo }).catch(() => {});
    uploads.forEach((item) => item.preview && URL.revokeObjectURL(item.preview));
    setUploads([]);
    setReplyTo(null);
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

  const top = (replyTo || uploads.length > 0) && (
    <>
      {replyTo && (
        <div className="dots-replying">
          <span className="dots-replying-text">
            <span className="dots-replying-label">正在回复 {senderName(replyTo, room)}</span>
            <span className="dots-replying-quote">{replyTo.text || "附件"}</span>
          </span>
          <Button variant="ghost" size="xs" icon={<Icon name="X" size="sm" />} label="取消回复" onClick={() => setReplyTo(null)} />
        </div>
      )}
      {uploads.length > 0 && (
        <div className="attachments dots-uploads">
          {uploads.map((item) => (
            <div key={item.key} className="attachment" data-file={!item.preview || undefined} data-tip={item.file.name}>
              {item.preview ? <img src={item.preview} alt={item.file.name} /> : <FileGlyph name={item.file.name} />}
              {!item.attachment && (
                <span className="dots-upload-state" role="status">
                  {item.failed ? (
                    <Button variant="secondary" size="xs" icon={<Icon name="ArrowClockwise" size="sm" />} label="重新上传" onClick={() => {
                      setUploads((current) => current.map((other) => (other.key === item.key ? { ...other, failed: false } : other)));
                      upload(item);
                    }} />
                  ) : <><Spinner size={16} /><span className="sr-only">正在上传</span></>}
                </span>
              )}
              <button type="button" className="attachment-remove" aria-label={`移除 ${item.file.name}`} data-tip={`移除 ${item.file.name}`} onClick={() => removeUpload(item.key)}>
                <Icon name="X" size="xs" />
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );

  return (
    <div className="main-col" onContextMenu={quietMenu}>
      {slot ? createPortal(bar, slot) : bar}
      <div className="session-row">
        <div className="session-chat">
          <div className="transcript-wrap">
            {dot === undefined ? (
              <div className="transcript" role="feed" aria-label="对话消息" aria-busy="true">
                {dotError ? <Notice title="未能加载您的 Dot" body={dotError} action="重试" onAction={() => void loadDot()} /> : <Loading label="正在加载你的 Dot" />}
              </div>
            ) : dot === null ? (
              <div className="transcript" role="feed" aria-label="对话消息">
                <DotIntro />
              </div>
            ) : messages === null ? (
              <div className="transcript" role="feed" aria-label="对话消息" aria-busy="true">
                {messagesError ? <Notice title="无法加载消息" body={messagesError} action="重试" onAction={() => void openDotRoom()} /> : <Loading label="正在加载消息" />}
              </div>
            ) : (
              <DotRoomView activity={activity} onReply={setReplyTo} />
            )}
          </div>
          {dot && (
            <div className="dock">
              <CloudComposer
                onSend={send}
                disabled={uploading}
                placeholder="发送消息"
                top={top || undefined}
                onFiles={addFiles}
                onType={noteDotTyping}
                canSendEmpty={ready.length > 0 && !uploading}
              />
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

/**
 * The room's transcript: older pages load as it scrolls to the top (the view keeps its place),
 * new messages follow while it sits at the bottom.
 */
function DotRoomView({ activity, onReply }: { activity: DotTask[] | null; onReply(message: DotMessage): void }) {
  const messages = useDots((s) => s.messages) ?? [];
  const pending = useDots((s) => s.pending);
  const room = useDots((s) => s.room);
  const unreadAfter = useDots((s) => s.unreadAfter);
  const olderCursor = useDots((s) => s.olderCursor);
  const loadingOlder = useDots((s) => s.loadingOlder);
  const olderError = useDots((s) => s.olderError);
  const typingUntil = useDots((s) => s.typingUntil);
  const live = useDots((s) => s.live);
  const dotName = useDots((s) => s.dot?.name ?? null);
  const shown = useMemo(() => shownMessages(messages, pending), [messages, pending]);
  const rows = useMemo(() => layoutRows(shown, { unreadAfter }), [shown, unreadAfter]);
  const receipt = receiptOf(shown, room);
  const scroller = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const restore = useRef<{ height: number; top: number; count: number } | null>(null);
  const [, tick] = useState(0);

  // The dot's typing shows until its heartbeat runs out.
  useEffect(() => {
    const left = typingUntil - Date.now();
    if (left <= 0) return;
    const timer = setTimeout(() => tick((n) => n + 1), left);
    return () => clearTimeout(timer);
  }, [typingUntil]);
  const last = shown.at(-1);
  const typing = typingUntil > Date.now();
  const awaiting = !typing && !live && last?.sender === "self" && !last.state && Date.now() - Date.parse(last.createdAt) < AWAITING_MS;

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const kept = restore.current;
    if (kept) {
      if (messages.length !== kept.count) el.scrollTop = kept.top + el.scrollHeight - kept.height;
      if (messages.length !== kept.count || !loadingOlder) restore.current = null;
      return;
    }
    if (pinned.current) el.scrollTop = el.scrollHeight;
  });

  // Images and opened replies grow the list without a render: stay on the bottom.
  useEffect(() => {
    const el = scroller.current;
    if (!el || !list.current) return;
    const observer = new ResizeObserver(() => {
      if (pinned.current && !restore.current) el.scrollTop = el.scrollHeight;
    });
    observer.observe(list.current);
    return () => observer.disconnect();
  }, []);

  const older = () => {
    const state = dotsState();
    if (!state.olderCursor || state.loadingOlder) return;
    const el = scroller.current;
    if (el) restore.current = { height: el.scrollHeight, top: el.scrollTop, count: state.messages?.length ?? 0 };
    void loadOlderDotMessages();
  };

  // Too little to scroll yet: keep paging in until there is.
  useEffect(() => {
    const el = scroller.current;
    if (el && olderCursor && !loadingOlder && !olderError && el.scrollHeight - el.clientHeight < NEAR_TOP) older();
  });

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight <= 40;
    if (el.scrollTop < NEAR_TOP && !pinned.current && !dotsState().olderError) older();
  };

  return (
    <div className="transcript" role="feed" aria-label="对话消息" ref={scroller} onScroll={onScroll}>
      <PlainLinks value>
        <div className="transcript-list dots-room" ref={list}>
          {olderCursor ? (
            <div className="older-row" role="status">
              {olderError ? (
                <>
                  <span className="older-failed">无法加载之前的消息</span>
                  <Button variant="ghost" size="xs" onClick={older}>重试</Button>
                </>
              ) : loadingOlder && <><Spinner size={16} /><span className="sr-only">正在加载之前的消息</span></>}
            </div>
          ) : (
            rows.length > 0 && <div className="divider-note dots-start">对话从这里开始</div>
          )}
          {!!activity?.length && <DotActivity tasks={activity} />}
          {rows.map((row) =>
            row.kind === "time" ? (
              <div key={row.key} className="divider-note dots-time">{when(row.at)}</div>
            ) : row.kind === "unread" ? (
              <div key={row.key} className="divider-note dots-unread" role="separator">新消息</div>
            ) : (
              <DotMessageRow
                key={row.key}
                message={row.message}
                first={row.first}
                replies={row.replies}
                room={room}
                dotName={dotName}
                receipt={receipt?.id === row.message.id ? receipt.receipt : null}
                messages={shown}
                onReply={onReply}
              />
            ),
          )}
          {(typing || awaiting) && (
            <section className="turn dots-turn" data-sender="dot">
              <div className="dots-sender">
                <DotAvatar url={room?.dotUserId ? room.members[room.dotUserId]?.avatarUrl : undefined} />
                <ShimmerText className="dots-typing">{typing ? `${dotName ?? "你的 Dot"} 正在输入…` : "正在思考"}</ShimmerText>
              </div>
            </section>
          )}
        </div>
      </PlainLinks>
    </div>
  );
}

function DotMessageRow({ message, first, replies, room, dotName, receipt, messages, onReply }: {
  message: DotMessage;
  first: boolean;
  replies: number;
  room: DotRoom | null;
  dotName: string | null;
  receipt: DotReceipt | null;
  messages: DotMessage[];
  onReply(message: DotMessage): void;
}) {
  const [open, setOpen] = useState(false);
  if (message.sender === "system") return <p className="dots-system" role="note">{message.text}</p>;
  const name = senderName(message, room, dotName);
  const actions = !message.state && !message.deleted && !message.id.startsWith("pending:") && (
    <div className={message.sender === "self" ? "row-actions" : "msg-actions"}>
      <Button variant="ghost" size="sm" icon={<Icon name="ChatSimple" size="sm" />} label="回复" onClick={() => onReply(message)} />
    </div>
  );
  const quote = message.replyTo && <DotQuote reply={message.replyTo} messages={messages} room={room} dotName={dotName} />;
  const files = message.attachments.filter((item) => item.kind === "file");
  const thread = replies > 0 && (
    <div className="dots-thread-toggle">
      <Button variant="ghost" size="xs" icon={<Icon name="ChatSimple" size="sm" />} onClick={() => {
        if (!open) void loadDotReplies(message.id).catch(() => toast("warning", "未能加载更早的回复"));
        setOpen(!open);
      }}>{open ? "关闭回复" : `${replies} 条回复`}</Button>
      {open && <DotReplies rootId={message.id} room={room} dotName={dotName} />}
    </div>
  );

  if (message.sender === "self") {
    return (
      <section className="turn dots-turn" data-sender="self" data-cont={!first || undefined} id={`dots-${message.id}`}>
        <div className="turn-prompt">
          <div className="user-row" data-state={message.state}>
            <h2 className="sr-only">你说：{message.text}</h2>
            {quote}
            {files.length > 0 && <div className="user-images dots-files">{files.map((file) => <DotFileView key={file.fileId} attachment={file} />)}</div>}
            {(message.text || message.deleted) && (
              <div className="dots-line">
                {actions}
                <div className="user-bubble" data-state={message.state}>
                  <div className="user-text">{message.deleted ? <em className="dots-deleted">消息已删除</em> : message.text}</div>
                </div>
              </div>
            )}
            {message.state === "sending" && <span className="dots-receipt" role="status"><ShimmerText variant="secondary">正在发送</ShimmerText></span>}
            {receipt && <ReceiptLine receipt={receipt} requestId={message.requestId} />}
          </div>
          {thread}
        </div>
      </section>
    );
  }

  const avatar = message.sender === "dot"
    ? <DotAvatar url={room?.members[message.senderId]?.avatarUrl ?? (room?.dotUserId ? room.members[room.dotUserId]?.avatarUrl : undefined)} />
    : <DotAvatar url={room?.members[message.senderId]?.avatarUrl} name={name} dot={false} />;
  const chosen = message.options ? optionState(message, messages) : undefined;
  return (
    <section className="turn dots-turn" data-sender={message.sender} data-cont={!first || undefined} id={`dots-${message.id}`}>
      {first && (
        <div className="dots-sender">
          {avatar}
          <span className="dots-sender-name">{name}</span>
          {message.createdAt && <time className="dots-sender-time" dateTime={message.createdAt}>{clock(message.createdAt)}</time>}
        </div>
      )}
      <div className="reply-row">
        <div className="agent-flow cloud-reply" data-cds="AssistantMessage" data-text-size="">
          {quote}
          {message.deleted ? (
            <p className="dots-deleted">消息已删除</p>
          ) : message.text && (
            <div className="agent-message">
              <Markdown text={message.text} voice breaks className="prose" />
            </div>
          )}
          {files.length > 0 && <div className="dots-files">{files.map((file) => <DotFileView key={file.fileId} attachment={file} />)}</div>}
          {message.attachments.filter((item) => item.kind === "call").map((call) => <DotCallCard key={call.callId || "call"} call={call} generating={message.generating} />)}
          {message.attachments.filter((item) => item.kind === "thread").map((task) => (
            <div key={task.threadId || "task"} className="dots-card dots-task-card">
              <Icon name="Tasks" size="sm" />
              <span className="dots-card-title">{task.title || "已创建的任务"}</span>
            </div>
          ))}
          {message.options && (
            <div className="dots-options" role="group" aria-label={message.text || "选项"}>
              {message.options.options.map((option, index) => (
                <Button
                  key={index}
                  variant="secondary"
                  size="sm"
                  active={chosen === index}
                  icon={chosen === index ? <Icon name="Check" size="sm" /> : undefined}
                  disabled={chosen !== undefined}
                  onClick={() => void answerDotOption(message, index).catch((error) => toast("warning", "无法发送此消息", errorMessage(error)))}
                >
                  {option}
                </Button>
              ))}
            </div>
          )}
          {message.elicitation && <DotElicitationCard messageId={message.id} />}
          {message.channel && <p className="dots-channel">{CHANNELS[message.channel] ?? `已通过 ${message.channel} 发送`}</p>}
        </div>
        {actions}
      </div>
      {thread}
    </section>
  );
}

function ReceiptLine({ receipt, requestId }: { receipt: DotReceipt; requestId: string }) {
  if (receipt.kind === "delivered") return <span className="dots-receipt">已送达</span>;
  if (receipt.kind === "read") return <span className="dots-receipt">已读 {clock(receipt.at)}</span>;
  return (
    <button type="button" className="dots-receipt" data-failed="" title={receipt.error} onClick={() => void retryDotMessage(requestId).catch(() => {})}>
      {receipt.kind === "failed" ? "发送失败。请点击重试" : "已保存在对话中，但是否送达尚未确认。点击重试发送"}
    </button>
  );
}

/**
 * The message a message answers: its author and words (from the list when it is there, the reply's
 * own copy else); a click goes to it when it is shown.
 */
function DotQuote({ reply, messages, room, dotName }: { reply: NonNullable<DotMessage["replyTo"]>; messages: DotMessage[]; room: DotRoom | null; dotName: string | null }) {
  const original = messages.find((message) => message.id === reply.id);
  const author = original ? senderName(original, room, dotName) : reply.author;
  const text = original ? (original.deleted ? "消息已删除" : original.text || (original.attachments.length ? "附件" : "")) : reply.text;
  const shown = !!original;
  const body = (
    <>
      {author && <span className="dots-quote-author">{author}</span>}
      <span className="dots-quote-text">{text || "转到原始消息"}</span>
    </>
  );
  return shown ? (
    <button type="button" className="dots-quote" title="转到原始消息" onClick={() => {
      const target = document.getElementById(`dots-${reply.id}`);
      target?.scrollIntoView({ block: "center", behavior: "smooth" });
    }}>{body}</button>
  ) : <div className="dots-quote">{body}</div>;
}

function DotReplies({ rootId, room, dotName }: { rootId: string; room: DotRoom | null; dotName: string | null }) {
  const replies = useDots((s) => s.replies[rootId]);
  if (!replies) return <div className="dots-thread" role="status"><Spinner size={14} /></div>;
  return (
    <div className="dots-thread">
      {replies.map((reply) => (
        <div key={reply.id} className="dots-thread-reply">
          <span className="dots-quote-author">{senderName(reply, room, dotName)}</span>
          {reply.deleted ? <em className="dots-deleted">消息已删除</em> : <Markdown text={reply.text} voice breaks className="prose" />}
        </div>
      ))}
    </div>
  );
}

const extension = (name: string) => {
  const dot = name.lastIndexOf(".");
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1, dot + 6) : "";
};

function FileGlyph({ name }: { name: string }) {
  return (
    <span className="dots-upload-file">
      <span className="sent-file-badge">{extension(name) || <Icon name="File" size="xs" />}</span>
      <span className="dots-upload-name">{name}</span>
    </span>
  );
}

const sizeText = (bytes: number | null) =>
  bytes === null ? "" : bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** A room file: an image shows (and opens in the lightbox), anything else downloads. */
function DotFileView({ attachment }: { attachment: DotAttachment }) {
  const [file, setFile] = useState<{ url: string; name: string; mime: string } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let current = true;
    dotFile(attachment.fileId).then((found) => current && setFile(found), () => current && setFailed(true));
    return () => {
      current = false;
    };
  }, [attachment.fileId]);
  const name = file?.name || attachment.name || "附件";
  const image = (file?.mime || attachment.mime).startsWith("image/");
  if (failed) return <span className="sent-file dots-file-gone">附件已不可用</span>;
  if (image) {
    return file ? (
      <img className="user-image zoomable" src={file.url} alt={name} onClick={(event) => openLightbox(file.url, event.currentTarget)} />
    ) : <span className="user-image" data-loading="" role="img" aria-label="图像附件" />;
  }
  return (
    <a className="sent-file" href={file?.url || undefined} download={name} aria-label={`下载 ${name}`}>
      <span className="sent-file-badge">{extension(name) || <Icon name="File" size="xs" />}</span>
      <span className="sent-file-name"><span>{name}</span></span>
      {attachment.size !== null && <span className="sent-file-size">{sizeText(attachment.size)}</span>}
    </a>
  );
}

const durationText = (ms: number | null) => {
  if (!ms) return "";
  const seconds = Math.round(ms / 1000);
  return seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
};

/** A call's record under its summary (orbit.voiceCall.history): length, outcome, the transcript. */
function DotCallCard({ call, generating }: { call: DotAttachment; generating: boolean }) {
  const [open, setOpen] = useState(false);
  const outcome = CALL_OUTCOMES[call.outcome] ?? "通话已结束";
  return (
    <div className="dots-card dots-call-card">
      <Icon name={call.callType === "juno" ? "Microphone" : "Speaker"} size="sm" />
      <span className="dots-card-title">{[durationText(call.durationMs), outcome].filter(Boolean).join(" · ")}</span>
      {generating ? (
        <ShimmerText variant="secondary" className="dots-card-note">正在生成通话摘要</ShimmerText>
      ) : call.callId && (
        <Button variant="ghost" size="xs" onClick={() => setOpen(true)}>显示转写文本</Button>
      )}
      {open && <TranscriptDialog callId={call.callId} onClose={() => setOpen(false)} />}
    </div>
  );
}

function TranscriptDialog({ callId, onClose }: { callId: string; onClose(): void }) {
  const [transcript, setTranscript] = useState<DotTranscript | null>(null);
  const room = useDots((s) => s.room);
  const load = () => {
    setTranscript(null);
    void loadDotTranscript(callId).then(setTranscript);
  };
  useEffect(load, [callId]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Dialog title="通话文字记录" size="lg" onClose={onClose}>
      {!transcript ? (
        <p className="dots-transcript-status" role="status"><Spinner size={14} /> 正在加载转录文本…</p>
      ) : transcript.state !== "ready" ? (
        <div className="dots-transcript-status" role="status">
          {TRANSCRIPT_FEEDBACK[transcript.state]}
          {transcript.state !== "unavailable" && <Button variant="secondary" size="sm" onClick={load}>重试</Button>}
        </div>
      ) : (
        <div className="dots-transcript">
          {transcript.messages.map((message) => (
            <p key={message.id} className="dots-transcript-line" data-sender={message.sender}>
              <span className="dots-quote-author">{senderName(message, room)}</span>
              {message.text}
            </p>
          ))}
        </div>
      )}
    </Dialog>
  );
}

/** Something the dot asks for in a form of its own (an MCP elicitation): answered here or not at all. */
function DotElicitationCard({ messageId }: { messageId: string }) {
  const [info, setInfo] = useState<DotElicitation | null>(null);
  const [failed, setFailed] = useState(false);
  const [values, setValues] = useState<Record<string, string | boolean>>({});
  const [result, setResult] = useState<"busy" | "accepted" | "declined" | "unconfirmed" | null>(null);
  useEffect(() => {
    readDotElicitation(messageId).then(setInfo, () => setFailed(true));
  }, [messageId]);
  if (failed) return <div className="dots-card"><span className="dots-card-note">无法确认此请求的状态</span></div>;
  if (!info) return <div className="dots-card" role="status"><Spinner size={14} /></div>;
  const answer = async (action: "accept" | "decline", event?: FormEvent) => {
    event?.preventDefault();
    setResult("busy");
    const content = action === "accept" && info.fields.length ? Object.fromEntries(info.fields.map((field) => {
      const raw = values[field.name] ?? (field.type === "boolean" ? false : "");
      return [field.name, field.type === "number" || field.type === "integer" ? Number(raw) : raw];
    })) : undefined;
    try {
      setResult((await answerDotElicitation(messageId, info.fingerprint, action, content)) ? (action === "accept" ? "accepted" : "declined") : "unconfirmed");
    } catch {
      setResult("unconfirmed");
    }
  };
  const open = info.open && !info.unsupported && (result === null || result === "busy");
  return (
    <form className="dots-card dots-elicitation" onSubmit={(event) => void answer("accept", event)}>
      {info.message && <p className="dots-elicitation-question">{info.message}</p>}
      {info.unsupported ? (
        <span className="dots-card-note">“消息”暂不支持此请求</span>
      ) : open && info.fields.map((field) => (
        <label key={field.name} className="dots-elicitation-field" data-check={field.type === "boolean" || undefined}>
          <span>{field.title}</span>
          {field.type === "boolean" ? (
            <input type="checkbox" checked={values[field.name] === true} onChange={(event) => setValues({ ...values, [field.name]: event.target.checked })} />
          ) : field.options ? (
            <select className="input" required={field.required} value={String(values[field.name] ?? "")} onChange={(event) => setValues({ ...values, [field.name]: event.target.value })}>
              <option value="" disabled>请选择</option>
              {field.options.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          ) : (
            <input className="input" type={field.type === "string" ? "text" : "number"} required={field.required} value={String(values[field.name] ?? "")}
              onChange={(event) => setValues({ ...values, [field.name]: event.target.value })} />
          )}
        </label>
      ))}
      {open ? (
        <div className="dots-elicitation-actions">
          <Button type="button" variant="secondary" size="sm" disabled={result === "busy"} onClick={() => void answer("decline")}>取消</Button>
          <Button type="submit" variant="primary" size="sm" disabled={result === "busy"}>允许</Button>
        </div>
      ) : result && result !== "busy" && (
        <span className="dots-card-note" role="status">{result === "accepted" ? "已允许" : result === "declined" ? "已取消" : "无法确认此请求的状态"}</span>
      )}
    </form>
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
