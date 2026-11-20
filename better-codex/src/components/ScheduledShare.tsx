// Sharing a cloud scheduled task and importing one someone shared, over the 定时任务 page
// (Scheduled.tsx renders them from the route's dialog). Both follow the Codex desktop app 26.1023:
// share-dialog (分享任务: the task's card, its link with 删除分享链接, 复制链接 making the link or
// refreshing it, then copying it) and shared-task-dialog (a share link's task: the owner's own opens
// with its sharing, one that cannot be scheduled says so, the rest fills the cloud form to schedule
// as one's own; the form stands in for the desktop app's preview).

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cloudDraftOf, createShare, readCloudAutomation, readSharedPost, refreshShare, removeShare, shareCurrent, sharePostId, useCloudAutomations, type CloudShare } from "../lib/cloud-automations";
import { errorMessage, patchScheduled } from "../lib/codex";
import { defaultName } from "../lib/scheduled-view";
import { toast } from "../lib/store";
import { Confirm } from "./Settings";
import { Button, Dialog, Icon, Skeleton } from "./ui";

/** 分享任务 for the cloud task `id`: its current link read on opening (undefined while it is read). */
export function ShareDialog({ id, onClose }: { id: string; onClose(): void }) {
  const item = useCloudAutomations((s) => s.items?.find((a) => a.id === id));
  const [share, setShare] = useState<CloudShare | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [more, setMore] = useState(false);
  const load = () => {
    setFailed(false);
    shareCurrent(id).then(setShare, () => setFailed(true));
  };
  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Opened before the list has it (an imported share of one's own task): read it.
  useEffect(() => {
    if (!item) void readCloudAutomation(id).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  // 复制链接: a new link without one, else the link refreshed to the task as it is now, then copied.
  const copy = async () => {
    setBusy(true);
    let next: CloudShare;
    try {
      next = share ? await refreshShare(id) : await createShare(id);
      setShare(next);
    } catch (error) {
      toast("danger", "共享任务时出错", errorMessage(error));
      return setBusy(false);
    }
    setBusy(false);
    await navigator.clipboard.writeText(next.permalink).then(() => setCopied(true), (error) => toast("warning", "复制失败", errorMessage(error)));
  };
  const remove = () =>
    removeShare(id).then(
      () => {
        toast("neutral", "已停止共享任务");
        onClose();
      },
      (error) => toast("danger", "删除分享时出错", errorMessage(error)),
    );

  const prompt = item?.prompt.trim() ?? "";
  // 查看更多 once the two folded lines cut the prompt short, as the desktop app measures the clamp.
  const promptText = useRef<HTMLParagraphElement>(null);
  const [long, setLong] = useState(false);
  useLayoutEffect(() => {
    const node = promptText.current;
    if (!node || more) return;
    const check = () => setLong(node.scrollHeight > node.clientHeight + 1);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(node);
    return () => observer.disconnect();
  }, [prompt, more]);
  const loading = share === undefined && !failed;
  return (
    <>
      <Dialog
        title="分享任务"
        description="共享后所做的更改不会同步到已共享的内容中。自定义指令和记忆也不会被共享。"
        onClose={onClose}
        footer={
          <Button variant="primary" className="scheduled-share-copy" disabled={loading || busy} aria-busy={loading || busy || undefined} icon={copied ? <Icon name="Check" /> : undefined} onClick={failed ? load : () => void copy()}>
            {failed ? "重试" : copied ? "已复制" : "复制链接"}
          </Button>
        }
      >
        <div className="scheduled-share-card">
          {item ? (
            <>
              <h3 className="scheduled-share-title">{item.title || defaultName("", item.prompt)}</h3>
              <p className="scheduled-share-type">{item.timingMode === "condition_watch" ? "监控" : "定时任务"}</p>
              <p ref={promptText} className="scheduled-share-prompt scheduled-text" data-folded={!more || undefined}>
                {prompt}
              </p>
              {long && (
                <button type="button" className="scheduled-share-more" aria-expanded={more} onClick={() => setMore(!more)}>
                  {more ? "收起" : "查看更多"}
                </button>
              )}
            </>
          ) : (
            <Skeleton lines={3} />
          )}
          {share && (
            <div className="scheduled-share-link">
              <span className="truncate" data-tip={share.permalink}>
                {share.permalink.replace(/^https?:\/\//, "")}
              </span>
              <Button variant="ghost" size="sm" icon={<Icon name="Trash" />} label="删除分享链接" disabled={busy} onClick={() => setRemoving(true)} />
            </div>
          )}
        </div>
        {failed && (
          <p role="alert" className="scheduled-detail-note">
            无法加载当前的分享设置
          </p>
        )}
      </Dialog>
      {removing && (
        <Confirm
          title="删除分享链接？"
          description="拥有此链接的用户将无法查看或安排此任务。之前保存的副本不会被删除。"
          confirm="删除分享链接"
          danger
          onClose={() => setRemoving(false)}
          onConfirm={remove}
        />
      )}
    </>
  );
}

/**
 * 从分享链接导入…: a share link or its post id, read (GET /share/post/{id}/automation). The owner's
 * own task opens with its sharing; one that cannot be scheduled stays here saying so; the rest opens
 * the cloud form filled in from it, to schedule as one's own.
 */
export function ImportDialog({ onClose }: { onClose(): void }) {
  const [text, setText] = useState("");
  const [state, setState] = useState<"idle" | "loading" | "failed" | "unsupported" | "invalid">("idle");
  // Closed while it reads: what it read opens nothing.
  const open = useRef(true);
  useEffect(() => {
    open.current = true;
    return () => {
      open.current = false;
    };
  }, []);
  const submit = async () => {
    const postId = sharePostId(text);
    if (!postId) return setState("invalid");
    setState("loading");
    try {
      const shared = await readSharedPost(postId);
      if (!open.current) return;
      if (shared.isOwner && shared.sourceId) patchScheduled({ task: { id: shared.sourceId, source: "cloud" }, dialog: { type: "share", id: shared.sourceId } });
      else if (!shared.importable) setState("unsupported");
      else patchScheduled({ dialog: { type: "form", source: "cloud", id: null, seed: { cloud: cloudDraftOf(shared) } } });
    } catch {
      if (open.current) setState("failed");
    }
  };
  const note = { idle: null, loading: "正在加载共享任务…", failed: "无法加载此共享任务", unsupported: "此任务可以查看，但无法安排", invalid: "请输入有效的分享链接或 ID。" }[state];
  return (
    <Dialog
      title="从分享链接导入"
      size="sm"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" disabled={!text.trim() || state === "loading"} aria-busy={state === "loading" || undefined} onClick={() => void submit()}>
            {state === "failed" ? "重试" : "继续"}
          </Button>
        </>
      }
    >
      <div className="scheduled-import">
        <input
          className="input"
          data-autofocus
          value={text}
          placeholder="粘贴分享链接或 ID"
          aria-label="分享链接或 ID"
          aria-invalid={state === "invalid" || undefined}
          onChange={(event) => {
            setText(event.target.value);
            if (state !== "loading") setState("idle");
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing && text.trim() && state !== "loading") void submit();
          }}
        />
        {note && (
          <p className="scheduled-detail-note" role={state === "loading" ? "status" : "alert"}>
            {note}
          </p>
        )}
      </div>
    </Dialog>
  );
}
