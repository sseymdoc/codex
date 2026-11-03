// 设置 › 这台电脑 › 存储 (Claude 4.4212 c71860c77-D27cqSW_: Storage, Code storage by kind, 清理不活跃的会话):
// what Codex keeps on this computer, by kind, and removing the worktrees of sessions nobody has
// used for a while. Codex has no Cowork, runtime or app caches to count; deleting sessions from
// here is left out (the sidebar deletes them, one by one or selected).

import { useEffect, useState } from "react";
import { ensureThreads, errorMessage } from "../lib/codex";
import { fileSize } from "../lib/files";
import { inactiveWorktrees, readStorage, removeWorktrees, type StorageUsage, type StoredWorktree } from "../lib/storage";
import { toast } from "../lib/store";
import { Row, Section } from "./Settings";
import { sidebarTools } from "./Sidebar";
import { Button, Checkbox, Dialog, MenuSelect, Spinner } from "./ui";

const sum = (values: (number | null)[]) => values.reduce<number>((total, value) => total + (value ?? 0), 0);
const sized = (bytes: number | null) => (bytes === null ? "至少几 MB（未测完）" : fileSize(bytes));
const DAYS = ["7", "14", "30", "90"] as const;

export function StorageTab() {
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const load = (refresh: boolean) => {
    setLoading(true);
    setError(null);
    readStorage(refresh)
      .then((value) => {
        setUsage(value);
        setChecked(Date.now());
      }, (failure) => setError(errorMessage(failure)))
      .finally(() => setLoading(false));
  };
  useEffect(() => load(false), []);
  return (
    <Section
      id="setting-storage-storage"
      title="存储"
      description="Codex 在这台电脑上使用的空间。"
      action={
        <Button variant="secondary" size="sm" disabled={loading} onClick={() => load(true)}>
          {loading ? "正在刷新…" : "刷新"}
        </Button>
      }
    >
      {error && <p className="settings-error" role="alert">无法计算存储空间。请重试。{error ? `（${error}）` : ""}</p>}
      {!usage && !error && <Spinner size={16} />}
      {usage && (
        <>
          <Row id="setting-storage-conversations" label="对话记录" description="这台电脑上 Codex 会话的对话（含已归档）。">
            <span className="settings-value">{sized(usage.sessions === null || usage.archivedSessions === null ? null : sum([usage.sessions, usage.archivedSessions]))}</span>
          </Row>
          <Row id="setting-storage-worktrees" label="工作树" description={`${usage.worktrees.length} 个会话工作树，位于 ${usage.worktreeRoot}`}>
            <span className="settings-value">{sized(usage.worktrees.some((tree) => tree.bytes === null) ? null : sum(usage.worktrees.map((tree) => tree.bytes)))}</span>
          </Row>
          <Row id="setting-storage-scratch" label="临时文件" description="没有选文件夹的会话所用的临时工作区。">
            <span className="settings-value">{sized(usage.scratchWorkspaces)}</span>
          </Row>
          <Row id="setting-storage-attachments" label="附件" description="随消息发送的文件副本。">
            <span className="settings-value">{sized(usage.attachments)}</span>
          </Row>
          {usage.free !== null && (
            <Row id="setting-storage-free" label="磁盘可用空间">
              <span className="settings-value">{fileSize(usage.free)}</span>
            </Row>
          )}
          <Row id="setting-storage-clean" label="释放空间" description={checked ? `检查时间：${new Date(checked).toLocaleTimeString("zh-CN", { hour: "numeric", minute: "2-digit" })}。` : undefined}>
            <Button variant="secondary" size="sm" onClick={() => setCleaning(true)}>
              清理不活跃的会话…
            </Button>
          </Row>
        </>
      )}
      {cleaning && usage && (
        <CleanDialog
          usage={usage}
          onClose={() => setCleaning(false)}
          onDone={() => {
            setCleaning(false);
            load(true);
          }}
        />
      )}
    </Section>
  );
}

/** 清理不活跃的会话: their worktrees go; the sessions, conversations and committed branches stay. */
function CleanDialog({ usage, onClose, onDone }: { usage: StorageUsage; onClose(): void; onDone(): void }) {
  const [days, setDays] = useState<(typeof DAYS)[number]>("30");
  const [ready, setReady] = useState(false);
  const [dirtyToo, setDirtyToo] = useState(false);
  const [understood, setUnderstood] = useState(false);
  const [busy, setBusy] = useState(false);
  // The owners must be known to tell whether they are inactive.
  useEffect(() => {
    const owners = usage.worktrees.flatMap((tree) => (tree.owner ? [tree.owner] : []));
    void ensureThreads(owners).finally(() => setReady(true));
  }, [usage]);
  const candidates = ready ? inactiveWorktrees(usage, Number(days), sidebarTools.pinned()) : [];
  const clean = candidates.filter((tree) => tree.changes === 0);
  const dirty = candidates.filter((tree) => tree.changes !== 0);
  const chosen: StoredWorktree[] = dirtyToo ? candidates : clean;
  const bytes = (trees: StoredWorktree[]) => fileSize(sum(trees.map((tree) => tree.bytes)));
  const remove = async () => {
    setBusy(true);
    try {
      const { removed, skipped } = await removeWorktrees(chosen.map((tree) => tree.path), dirtyToo);
      if (removed.length) toast("neutral", `已从 ${removed.length} 个会话移除工作树。`);
      if (skipped.length) toast("warning", `来自 ${skipped.length} 个会话的工作树无法移除。`, skipped.map((entry) => entry.reason).join("；"));
      onDone();
    } catch (failure) {
      toast("warning", "清理未完成。请重试。", errorMessage(failure));
      setBusy(false);
    }
  };
  return (
    <Dialog
      title="清理不活跃的会话"
      description="会话及其对话会保留。已提交的工作会保留在其分支上。"
      size="sm"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button variant={dirtyToo ? "danger" : "primary"} disabled={busy || !chosen.length || (dirtyToo && !understood)} onClick={() => void remove()}>
            {busy ? "正在移除…" : `移除 ${chosen.length} 个工作树`}
          </Button>
        </>
      }
    >
      <div className="storage-clean">
        <MenuSelect<(typeof DAYS)[number]> label="不活跃时长至少" field value={days} options={DAYS.map((value) => ({ value, label: `${value} 天` }))} onChange={setDays} />
        {!ready ? (
          <p className="settings-section-desc">正在检查不活跃的会话…</p>
        ) : candidates.length ? (
          <p className="settings-section-desc">
            {clean.length} 个来自不活跃会话的工作树 · {bytes(clean)}
          </p>
        ) : (
          <p className="settings-section-desc">没有已不活跃 {days} 天的 Code 会话的工作树。</p>
        )}
        {dirty.length > 0 && (
          <Checkbox
            checked={dirtyToo}
            onChange={(value) => {
              setDirtyToo(value);
              setUnderstood(false);
            }}
            label={`同时移除 ${dirty.length} 个有未提交更改或未入分支提交的工作树（${bytes(dirty)}）；这些更改将丢失`}
          />
        )}
        {dirtyToo && <Checkbox checked={understood} onChange={setUnderstood} label="我了解未提交的更改无法恢复" />}
      </div>
    </Dialog>
  );
}
