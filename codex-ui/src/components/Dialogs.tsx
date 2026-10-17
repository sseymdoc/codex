// Modal dialogs driven by `state.dialog`: review target, rename, delete, folder picker,
// and creating or editing a sidebar section.

import type { FsReadDirectoryEntry } from "@protocol/v2/FsReadDirectoryEntry";
import type { ReviewTarget } from "@protocol/v2/ReviewTarget";
import { ArrowUp, Folder, GitCommitHorizontal, GitCompare, PencilLine, ScanSearch } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  createSection,
  deleteThread,
  errorMessage,
  moveToSection,
  readDirectory,
  refreshConfig,
  renameThread,
  startReview,
  updateSection,
} from "../lib/codex";
import { joinPath, parentDir, threadTitle } from "../lib/format";
import { getState, setState, toast, useStore } from "../lib/store";
import { SECTION_COLORS, sectionColor } from "./Sidebar";
import { Button, Dialog, Spinner } from "./ui";

const close = () => setState({ dialog: null });

function ReviewDialog({ threadId }: { threadId: string | null }) {
  const branch = useStore((s) => (threadId ? s.threads[threadId]?.meta.gitInfo?.branch : null));
  const [kind, setKind] = useState<ReviewTarget["type"]>("uncommittedChanges");
  const [base, setBase] = useState("main");
  const [sha, setSha] = useState("");
  const [instructions, setInstructions] = useState("");
  const [busy, setBusy] = useState(false);

  const target: ReviewTarget | null =
    kind === "uncommittedChanges"
      ? { type: kind }
      : kind === "baseBranch"
        ? base.trim() ? { type: kind, branch: base.trim() } : null
        : kind === "commit"
          ? sha.trim() ? { type: kind, sha: sha.trim(), title: null } : null
          : instructions.trim() ? { type: "custom", instructions: instructions.trim() } : null;

  const submit = async () => {
    if (!target) return;
    setBusy(true);
    try {
      await startReview(threadId, target);
      close();
    } catch (error) {
      toast("error", "无法开始审查", errorMessage(error));
      setBusy(false);
    }
  };

  const option = (value: ReviewTarget["type"], icon: ReactNode, label: string, hint: string, extra?: ReactNode) => (
    <label className={`choice-card ${kind === value ? "selected" : ""}`}>
      <input type="radio" name="review-target" checked={kind === value} onChange={() => setKind(value)} />
      <span className="choice-icon">{icon}</span>
      <span className="choice-text">
        <span className="choice-label">{label}</span>
        <span className="choice-hint">{hint}</span>
        {kind === value && extra}
      </span>
    </label>
  );

  return (
    <Dialog
      title="审查代码"
      description="Codex 会以审查者的视角检查改动，并列出问题与建议。"
      onClose={close}
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            取消
          </Button>
          <Button variant="primary" disabled={!target || busy} onClick={() => void submit()}>
            {busy ? "正在开始…" : "开始审查"}
          </Button>
        </>
      }
    >
      <div className="choice-list">
        {option("uncommittedChanges", <ScanSearch size={15} />, "未提交的改动", "暂存区、工作区和未跟踪的文件")}
        {option(
          "baseBranch",
          <GitCompare size={15} />,
          "与基础分支比较",
          branch ? `当前分支 ${branch} 相对于基础分支的全部改动` : "当前分支相对于基础分支的全部改动",
          <input className="input" value={base} onChange={(e) => setBase(e.target.value)} placeholder="基础分支，例如 main" />,
        )}
        {option(
          "commit",
          <GitCommitHorizontal size={15} />,
          "某个提交",
          "审查单个提交引入的改动",
          <input className="input mono" value={sha} onChange={(e) => setSha(e.target.value)} placeholder="提交 SHA" />,
        )}
        {option(
          "custom",
          <PencilLine size={15} />,
          "自定义",
          "用你自己的话描述要审查什么",
          <textarea className="input" rows={3} value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="例如：检查 src/auth 下的改动是否有安全问题" />,
        )}
      </div>
    </Dialog>
  );
}

function RenameDialog({ threadId }: { threadId: string }) {
  const meta = useStore((s) => s.threads[threadId]?.meta);
  const [name, setName] = useState(meta ? threadTitle(meta) : "");
  const submit = () => {
    const value = name.trim();
    if (!value) return;
    renameThread(threadId, value).catch((error) => toast("error", "重命名失败", errorMessage(error)));
    close();
  };
  return (
    <Dialog
      title="重命名会话"
      onClose={close}
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            取消
          </Button>
          <Button variant="primary" disabled={!name.trim()} onClick={submit}>
            保存
          </Button>
        </>
      }
    >
      <input
        className="input"
        data-autofocus
        value={name}
        maxLength={200}
        onChange={(event) => setName(event.target.value)}
        onFocus={(event) => event.target.select()}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.nativeEvent.isComposing) submit();
        }}
      />
    </Dialog>
  );
}

function DeleteDialog({ threadId }: { threadId: string }) {
  const meta = useStore((s) => s.threads[threadId]?.meta);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      title="删除会话？"
      description={<>「{meta ? threadTitle(meta) : threadId}」及其全部记录将被永久删除，无法恢复。</>}
      onClose={close}
      footer={
        <>
          <Button variant="ghost" data-autofocus onClick={close}>
            取消
          </Button>
          <Button
            variant="danger"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              deleteThread(threadId)
                .then(() => toast("success", "会话已删除"))
                .catch((error) => toast("error", "删除失败", errorMessage(error)))
                .finally(close);
            }}
          >
            删除
          </Button>
        </>
      }
    />
  );
}

function FolderDialog() {
  const start = useStore((s) => s.prefs.cwd || s.server.cwd);
  const [path, setPath] = useState(start);
  const [draft, setDraft] = useState(start);
  const [entries, setEntries] = useState<FsReadDirectoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((target: string) => {
    setEntries(null);
    setError(null);
    readDirectory(target)
      .then((list) => {
        setPath(target);
        setDraft(target);
        setEntries(list.filter((e) => e.isDirectory && !e.fileName.startsWith(".")).sort((a, b) => a.fileName.localeCompare(b.fileName)));
      })
      .catch((err) => {
        setError(errorMessage(err));
        setEntries([]);
      });
  }, []);

  useEffect(() => load(start), [load, start]);

  const choose = () => {
    setState((s) => ({ prefs: { ...s.prefs, cwd: path } }));
    void refreshConfig();
    close();
  };

  return (
    <Dialog
      title="选择工作区"
      description="新会话将在这个文件夹中运行，Codex 只能在其中读写文件（取决于权限模式）。"
      onClose={close}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            取消
          </Button>
          <Button variant="primary" disabled={!!error || entries === null} onClick={choose}>
            使用此文件夹
          </Button>
        </>
      }
    >
      <form
        className="path-bar"
        onSubmit={(event) => {
          event.preventDefault();
          if (draft.trim()) load(draft.trim());
        }}
      >
        <Button variant="ghost" size="sm" icon={<ArrowUp size={14} />} aria-label="上一级" title="上一级" onClick={() => load(parentDir(path))} />
        <input className="input mono" value={draft} onChange={(event) => setDraft(event.target.value)} aria-label="文件夹路径" />
        <Button variant="secondary" size="sm" type="submit">
          前往
        </Button>
      </form>
      <div className="folder-list">
        {entries === null && (
          <div className="side-empty">
            <Spinner />
          </div>
        )}
        {error && <div className="error-text">{error}</div>}
        {entries?.length === 0 && !error && <div className="side-empty">没有子文件夹</div>}
        {entries?.map((entry) => (
          <button key={entry.fileName} type="button" className="folder-item" onClick={() => load(joinPath(path, entry.fileName))}>
            <Folder size={14} />
            <span>{entry.fileName}</span>
          </button>
        ))}
      </div>
    </Dialog>
  );
}

const COLOR_NAMES = ["蓝色", "橙色", "绿色", "黄色", "粉色", "深绿", "紫色", "红色"];

function SectionDialog({ sectionId, threadId }: { sectionId: string | null; threadId?: string }) {
  const existing = useStore((s) => s.sections.find((section) => section.id === sectionId));
  const [name, setName] = useState(existing?.name ?? "");
  const [color, setColor] = useState<string | null>(existing ? (existing.appearance?.color ?? null) : SECTION_COLORS[0]);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const value = name.trim();
    if (!value || busy) return;
    setBusy(true);
    try {
      if (existing) {
        await updateSection(existing.id, value, color);
      } else {
        const section = await createSection(value, color);
        if (threadId) await moveToSection(threadId, section.id);
      }
      close();
    } catch (error) {
      toast("error", existing ? "保存分组失败" : "新建分组失败", errorMessage(error));
      setBusy(false);
    }
  };
  return (
    <Dialog
      title={existing ? "编辑分组" : "新建分组"}
      description={existing ? undefined : "分组保存在 Codex 的会话数据里，其他 Codex 客户端也能看到。"}
      onClose={close}
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            取消
          </Button>
          <Button variant="primary" disabled={!name.trim() || busy} onClick={() => void submit()}>
            {existing ? "保存" : "新建"}
          </Button>
        </>
      }
    >
      <input
        className="input"
        data-autofocus
        value={name}
        maxLength={80}
        placeholder="分组名称"
        aria-label="分组名称"
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.nativeEvent.isComposing) void submit();
        }}
      />
      <div className="swatches" role="radiogroup" aria-label="颜色">
        {SECTION_COLORS.map((id, index) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={color === id}
            aria-label={COLOR_NAMES[index]}
            title={COLOR_NAMES[index]}
            className="swatch"
            style={{ background: sectionColor(id) }}
            onClick={() => setColor(id)}
          />
        ))}
        <button type="button" role="radio" aria-checked={color === null} aria-label="无颜色" title="无颜色" className="swatch swatch-none" onClick={() => setColor(null)} />
      </div>
    </Dialog>
  );
}

export function Dialogs() {
  const dialog = useStore((s) => s.dialog);
  if (!dialog) return null;
  switch (dialog.type) {
    case "review":
      return <ReviewDialog threadId={dialog.threadId} />;
    case "rename":
      return getState().threads[dialog.threadId] ? <RenameDialog threadId={dialog.threadId} /> : null;
    case "delete":
      return <DeleteDialog threadId={dialog.threadId} />;
    case "folder":
      return <FolderDialog />;
    case "section":
      return <SectionDialog sectionId={dialog.sectionId} threadId={dialog.threadId} />;
  }
}
