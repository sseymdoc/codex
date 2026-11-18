// 侧边聊天 (Claude 4.4212 ca2ef848d: /btw and Ctrl+; open it): a floating card at the window's
// bottom right for quick questions about the open session that stay out of it (codex.ts
// askSideChat). Clicking outside it or Esc closes it, its messages kept; 清除 starts over. A reply
// can go on in a new session, its question and answer in the new composer (the card closes).

import { useEffect, useRef, useState } from "react";
import { askSideChat, clearSideChat, toggleSideChat } from "../lib/codex";
import { useStore } from "../lib/store";
import { Markdown } from "./content";
import { shortcutLabel } from "./Palette";
import { askCodex } from "./ScheduledDetail";
import { Button, Icon, Spinner } from "./ui";

const branched = (question: string | undefined, answer: string) =>
  question === undefined ? answer : `继续一个题外问题。\n\n问：${question}\n\n答：“${answer}”\n\n`;

export function SideChat({ threadId }: { threadId: string }) {
  const chat = useStore((s) => s.sideChats[threadId]);
  const started = useStore((s) => (s.threads[threadId]?.turns.length ?? 0) > 0);
  const [text, setText] = useState("");
  const panel = useRef<HTMLElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const open = chat?.open === true;
  const close = () => toggleSideChat(threadId, false);

  // Open: the caret in the card; closed: back where it was, when nothing else took it.
  useEffect(() => {
    if (!open) return;
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    input.current?.focus();
    const outside = (event: MouseEvent | TouchEvent) => {
      if (!(event.target instanceof Node) || !panel.current?.contains(event.target)) close();
    };
    document.addEventListener("mousedown", outside);
    document.addEventListener("touchstart", outside);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("touchstart", outside);
      if (before?.isConnected && document.activeElement === document.body) before.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per opening
  }, [open, threadId]);

  const last = chat?.messages.at(-1);
  useEffect(() => {
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat?.messages.length, last?.text]);

  if (!open || !chat) return null;
  const busy = chat.status !== "idle";
  const send = () => {
    if (busy || !text.trim()) return;
    void askSideChat(threadId, text);
    setText("");
  };
  const keys = shortcutLabel("sideChat");
  return (
    <aside
      ref={panel}
      className="side-chat"
      aria-label="侧边聊天"
      onKeyDownCapture={(event) => {
        if (event.key !== "Escape" || event.nativeEvent.isComposing) return;
        event.stopPropagation();
        close();
      }}
    >
      <header className="side-chat-head">
        <span className="side-chat-title">侧边聊天</span>
        {keys && <span className="side-chat-keys">{keys}</span>}
        {chat.messages.length > 0 && (
          <Button
            variant="ghost"
            size="xs"
            icon={<Icon name="Trash" size="xs" />}
            label="清除侧边聊天"
           
            onClick={() => {
              clearSideChat(threadId);
              requestAnimationFrame(() => input.current?.focus());
            }}
          />
        )}
        <Button variant="ghost" size="xs" icon={<Icon name="X" size="xs" />} label="关闭侧边聊天" onClick={close} />
      </header>
      {chat.messages.length > 0 && (
        <div ref={list} className="side-chat-list scroll-fade-y" aria-live="polite">
          {chat.messages.map((message, i) =>
            message.role === "user" ? (
              <div key={i} className="side-chat-q">
                {message.text}
              </div>
            ) : (
              <div key={i} className="side-chat-a">
                {message.text ? <Markdown text={message.text} streaming={busy && i === chat.messages.length - 1} voice /> : <Spinner size={14} label="正在回答" />}
                {message.text && !(busy && i === chat.messages.length - 1) && (
                  <Button
                    variant="ghost"
                    size="xs"
                    icon={<Icon name="ChatAdd" size="xs" />}
                    label="在新会话中继续"
                   
                    onClick={() => {
                      const asked = chat.messages[i - 1];
                      close();
                      void askCodex(branched(asked?.role === "user" ? asked.text : undefined, message.text));
                    }}
                  />
                )}
              </div>
            ),
          )}
        </div>
      )}
      {chat.status === "starting" && <p className="side-chat-note">正在启动侧边聊天…</p>}
      {chat.error && (
        <p className="side-chat-error" role="alert">
          {chat.error}
        </p>
      )}
      <textarea
        ref={input}
        className="side-chat-input"
        rows={2}
        value={text}
        disabled={!started}
        aria-label="侧边聊天"
        placeholder={!started ? "发送第一条消息开始此会话后，即可使用侧边聊天。" : chat.messages.length ? "追问…" : "快速问一个问题…"}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            send();
          }
        }}
      />
    </aside>
  );
}
