// Claude 4.29's next-step box under the latest turn (live c9bd7af9c NN / AN / mN, ccc416cfd Pe for
// its buttons, c59c32499 Od for the dismiss key) and the receipt of a box a later message answered
// (c4de0b325 A8 over cb6930dae kl). What shows is wrap-up.ts's; the words are Claude's zh-Hans ones.

import { useRef, useSyncExternalStore } from "react";
import { displayText, replyText } from "../../context/turn.mjs";
import { fail, sendMessage } from "../lib/codex";
import { getState, toast, useStore } from "../lib/store";
import { dismissWrapUp, dismissalsVersion, nextStep, subscribeDismissals, type BoxChip, type NextStep, type WrapReceipt } from "../lib/wrap-up";
import { setComposerDraft } from "./Composer";
import { nextActions, runNextAction } from "./Rail";
import { useOfferKeys } from "./SessionCards";
import { archiveSession } from "./Sidebar";
import { Button, Icon } from "./ui";

const APP_LABELS = { commit: "提交更改", create_pr: "创建 PR", archive: "归档会话" } as const;
const PREFILL_BLOCKED = "请先发送或清除您的草稿，然后再次点击该标签以加载其提示词。";

/** The latest turn's box as it shows now, or null (wrap-up.ts nextStep). */
export function useNextStep(threadId: string): NextStep | null {
  useSyncExternalStore(subscribeDismissals, dismissalsVersion);
  const thread = useStore((s) => s.threads[threadId]);
  const proposals = useStore((s) => s.proposals[threadId]);
  return thread ? nextStep(thread.turns.at(-1), threadId, proposals, nextActions(thread)) : null;
}

const chipLabel = (chip: BoxChip) => (chip.kind === "app" ? APP_LABELS[chip.action] : displayText(chip.reply.label));

/**
 * A button's work (ccc416cfd Ue): a reply goes to this session as your message, its message where
 * the model wrote one; Ctrl/Cmd+click loads it into an empty composer instead. 提交更改 and 创建 PR
 * run as the changes row runs them, 归档会话 archives the session.
 */
function runChip(threadId: string, chip: BoxChip, prefill: boolean): void {
  const thread = getState().threads[threadId];
  if (!thread) return;
  if (chip.kind === "app") return chip.action === "archive" ? archiveSession(threadId) : runNextAction(thread, chip.action);
  const text = replyText(chip.reply);
  if (prefill) {
    if (document.querySelector<HTMLTextAreaElement>(".composer-input")?.value.trim()) return void toast("warning", PREFILL_BLOCKED);
    return setComposerDraft(text);
  }
  void sendMessage(threadId, [{ type: "text", text, text_elements: [] }]).catch(fail("发送失败"));
}

/**
 * The box (mN): the recap in secondary ink, the question in primary, the answers as buttons, the
 * recommendation primary; Ctrl/Cmd+Enter takes a recommended reply (Jl), and × 关闭 dismisses a
 * box that is not blocked, on the first line of text.
 */
export function NextStepBox({ threadId, step }: { threadId: string; step: NextStep }) {
  const root = useRef<HTMLDivElement>(null);
  const first = step.chips[0];
  const takesKeys = step.primary && first?.kind === "reply";
  useOfferKeys(root, takesKeys, () => first && runChip(threadId, first, false));
  const dismiss = step.blocked ? null : (
    <span className="turn-next-dismiss" data-turn-dismiss="">
      <Button variant="ghost" size="sm" icon={<Icon name="X" size="sm" />} label="关闭" onClick={() => dismissWrapUp(threadId, step.callId, step.asks)} />
    </span>
  );
  return (
    <div className="turn-next" ref={root} data-text-size="">
      {step.recap && (
        <div className="turn-next-line">
          <p dir="auto" className="turn-next-recap">{step.recap}</p>
          {dismiss}
        </div>
      )}
      {step.question && (
        <div className="turn-next-line">
          <p dir="auto" className="turn-next-ask">{step.question}</p>
          {!step.recap && dismiss}
        </div>
      )}
      {step.chips.length > 0 && (
        <div role="group" aria-label="建议的后续操作" className="turn-next-chips">
          {step.chips.map((chip, index) => {
            const label = chipLabel(chip);
            return (
              <Button
                key={chip.kind === "app" ? chip.action : `reply:${chip.reply.label}`}
                variant={index === 0 && step.primary ? "primary" : "secondary"}
                className={label.length > 16 ? "turn-next-chip" : undefined}
                kbd={index === 0 && takesKeys ? "Ctrl+Enter" : undefined}
                tip={label.length > 16 ? label : undefined}
                onClick={(event) => runChip(threadId, chip, event.ctrlKey || event.metaKey)}
              >
                <span className="turn-next-chip-label">{label}</span>
              </Button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * A box a later message answered, above that message (A8 over cb6930dae kl): its recap gap-sm over
 * the question and the answer it matched, those two gap-0.5 apart.
 */
export function WrapUpReceipt({ receipt }: { receipt: WrapReceipt }) {
  return (
    <div className="user-row" data-reply="">
      <div className="question-receipt wrap-receipt">
        <div>
          {receipt.recap && (
            <div dir="auto" className="wrap-receipt-recap">
              {receipt.recap}
            </div>
          )}
          <div className="wrap-receipt-pair">
            <div className="question-receipt-q">{receipt.question}</div>
            {receipt.answer && (
              <div className="question-receipt-a" aria-label="您的回答">
                {receipt.answer}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
