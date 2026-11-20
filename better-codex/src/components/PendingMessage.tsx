import { errorMessage, retryPendingMessage } from "../lib/codex";
import { continuesText } from "../lib/questions";
import { setState, toast, useStore } from "../lib/store";
import { UserBubble } from "./items";
import { Button, ShimmerText } from "./ui";
import { WorkingMark } from "./WorkingMark";

/**
 * Local feedback stays outside server turns, so it cannot be exported, rewound or forked. While it
 * waits the working line under it says so (cc43287c9 aE2 firstMessageStandIn: 正在启动会话); the
 * draft page has none, so it draws that line itself until the session opens.
 */
export function PendingMessage({ threadId }: { threadId: string | null }) {
  const key = threadId ?? "";
  const pending = useStore((s) => s.pendingMessages[key]);
  const ready = useStore((s) => s.conn.status === "ready");
  if (!pending) return null;
  // The plan card's 接受 and the plan-mode resume carry on a turn without a message of yours.
  const [part, ...rest] = pending.item.content;
  if (!pending.error && !rest.length && part?.type === "text" && continuesText(part.text.trim())) return null;
  return (
    <section className="pending-message" aria-label="待发送消息">
      <UserBubble item={pending.item} />
      {pending.error ? (
        <div className="pending-message-status" role="status">
          <span>发送未完成：{pending.error}</span>
          <Button variant="ghost" disabled={!ready} onClick={() => void retryPendingMessage(threadId).catch((error) => toast("warning", "重试失败", errorMessage(error)))}>重试</Button>
          <Button variant="ghost" onClick={() => setState((s) => ({ pendingMessages: { ...s.pendingMessages, [key]: undefined } }))}>移除</Button>
        </div>
      ) : (
        threadId === null && (
          <div className="working-line" data-text-size="">
            <div className="working-row" data-state="busy">
              <span className="working-mark-slot">
                <WorkingMark />
              </span>
              <span className="working-text">
                <span className="working-label">
                  <ShimmerText variant="secondary">正在启动会话</ShimmerText>
                </span>
              </span>
              <span className="sr-only" role="status">
                正在启动会话…
              </span>
            </div>
          </div>
        )
      )}
    </section>
  );
}
