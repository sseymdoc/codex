import { errorMessage, retryPendingMessage } from "../lib/codex";
import { setState, toast, useStore } from "../lib/store";
import { UserBubble } from "./items";
import { Button, Spinner } from "./ui";

/** Local feedback stays outside server turns, so it cannot be exported, rewound or forked. */
export function PendingMessage({ threadId }: { threadId: string | null }) {
  const key = threadId ?? "";
  const pending = useStore((s) => s.pendingMessages[key]);
  const ready = useStore((s) => s.conn.status === "ready");
  if (!pending) return null;
  return (
    <section className="pending-message" aria-label="待发送消息">
      <UserBubble item={pending.item} />
      {(!pending.accepted || pending.error) && (
        <div className="pending-message-status" role="status">
          {pending.error ? (
            <>
              <span>发送未完成：{pending.error}</span>
              <Button variant="ghost" disabled={!ready} onClick={() => void retryPendingMessage(threadId).catch((error) => toast("warning", "重试失败", errorMessage(error)))}>重试</Button>
              <Button variant="ghost" onClick={() => setState((s) => ({ pendingMessages: { ...s.pendingMessages, [key]: undefined } }))}>移除</Button>
            </>
          ) : (
            <><Spinner size={14} /><span>{threadId === null ? "正在建立会话…" : "正在发送…"}</span></>
          )}
        </div>
      )}
    </section>
  );
}
