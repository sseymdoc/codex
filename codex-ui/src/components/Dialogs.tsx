// Modal dialogs driven by `state.dialog`: review target, rename, delete, folder picker,
// creating, editing or deleting a sidebar section, rewinding to a message, and feedback. Cancel is
// a secondary button (ConfirmationDialog footer: secondary + primary / danger, gap 8); confirmations
// and the small forms are sm (400) without a close button, and a delete starts on its 删除 button
// (shared-frame M_ initialFocus "confirm").

import type { FsReadDirectoryEntry } from "@protocol/v2/FsReadDirectoryEntry";
import type { Project } from "@protocol/v2/Project";
import type { ReviewTarget } from "@protocol/v2/ReviewTarget";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  activeTurn,
  changeThreadFolder,
  createSection,
  deleteProject,
  deleteSection,
  deleteThread,
  errorMessage,
  fail,
  isArchivedThread,
  moveToSection,
  readDirectory,
  renameThread,
  restoreCode,
  rewindThread,
  startReview,
  threadCwd,
  updateSection,
  uploadFeedback,
} from "../lib/codex";
import { basename, joinPath, parentDir, threadTitle } from "../lib/format";
import { rewindPreview, type RewindPreview } from "../lib/rewind";
import { dismissToast, getState, setState, toast, useStore } from "../lib/store";
import { chooseFolder, setComposerDraft } from "./Composer";
import { EnvironmentDialog } from "./EnvironmentDialog";
import { Confirm } from "./Settings";
import { SECTION_COLORS, sectionColor } from "./Sidebar";
import { DiffStat } from "./items";
import { Button, Dialog, Icon, MenuSelect, Spinner, Toggle } from "./ui";

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
      toast("warning", "无法开始审查", errorMessage(error));
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
      title="审查代码更改"
      description="Codex 会以审查者的视角检查更改，并列出问题与建议。"
      onClose={close}
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            取消
          </Button>
          <Button variant="primary" disabled={!target || busy} onClick={() => void submit()}>
            {busy ? "正在开始…" : "开始审查"}
          </Button>
        </>
      }
    >
      <div className="choice-list">
        {option("uncommittedChanges", <Icon name="ChangesPlusMinus" size={15} />, "未提交的更改", "暂存区、工作区和未跟踪的文件")}
        {option(
          "baseBranch",
          <Icon name="GitDiff" size={15} />,
          "与基础分支比较",
          branch ? `当前分支 ${branch} 相对于基础分支的全部更改` : "当前分支相对于基础分支的全部更改",
          <input className="input" value={base} onChange={(e) => setBase(e.target.value)} placeholder="基础分支，例如 main" />,
        )}
        {option(
          "commit",
          <Icon name="GitCommit" size={15} />,
          "某个提交",
          "审查单个提交引入的更改",
          <input className="input mono" value={sha} onChange={(e) => setSha(e.target.value)} placeholder="提交 SHA" />,
        )}
        {option(
          "custom",
          <Icon name="Edit" size={15} />,
          "自定义",
          "用您自己的话描述要审查什么",
          <textarea className="input" rows={3} value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="例如：检查 src/auth 下的更改是否有安全问题" />,
        )}
      </div>
    </Dialog>
  );
}

/** shared-16 Od: a blank name does nothing, an unchanged one just closes; the name is selected on first focus. */
function RenameDialog({ threadId }: { threadId: string }) {
  const meta = useStore((s) => s.threads[threadId]?.meta);
  const [initial] = useState(() => (meta ? threadTitle(meta) : ""));
  const [name, setName] = useState(initial);
  const selected = useRef(false);
  const submit = () => {
    const value = name.trim();
    if (!value) return;
    if (value !== initial) renameThread(threadId, value).catch((error) => toast("warning", "重命名失败。您可以重试。", errorMessage(error)));
    close();
  };
  return (
    <Dialog
      title="重命名会话"
      size="sm"
      closeButton={false}
      onClose={close}
      footer={
        <>
          <Button variant="secondary" onClick={close}>
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
        aria-label="重命名会话"
        onChange={(event) => setName(event.target.value)}
        onFocus={(event) => {
          if (selected.current) return;
          selected.current = true;
          event.target.select();
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.nativeEvent.isComposing) submit();
        }}
      />
    </Dialog>
  );
}

/** shared-19 KY: the dialog closes at once and the delete runs behind it; only a failure says so. */
function DeleteDialog({ threadId }: { threadId: string }) {
  const meta = useStore((s) => s.threads[threadId]?.meta);
  return (
    <Confirm
      danger
      focusConfirm
      title="删除会话？"
      description={<>“{meta ? threadTitle(meta) : threadId}”将被永久删除。此操作无法撤销。</>}
      confirm="删除"
      onClose={close}
      onConfirm={async () => void deleteThread(threadId).catch(fail("无法删除此会话。请重试。"))}
    />
  );
}

/**
 * 删除环境？ (c2d49627e): project/delete leaves the folders. With sessions from the environment the
 * user keeps them or deletes them too (Cancel first, ghost); without, a plain confirmation.
 */
export function DeleteEnvironmentDialog({ project, onClose, onDeleted }: { project: Project; onClose(): void; onDeleted(): void }) {
  const threads = useStore((s) => s.threads);
  const sessions = useMemo(() => Object.values(threads).filter((t) => t.meta.projectId === project.id && !t.meta.parentThreadId && !isArchivedThread(t.meta.id)), [threads, project.id]);
  const [busy, setBusy] = useState(false);
  const remove = (withSessions: boolean) => {
    setBusy(true);
    Promise.all(withSessions ? sessions.map((t) => deleteThread(t.meta.id)) : [])
      .then(() => deleteProject(project.id))
      .then(onDeleted, (error) => {
        toast("warning", "无法删除此环境。请重试。", errorMessage(error));
        onClose();
      });
  };
  const count = sessions.length;
  if (!count) {
    return (
      <Dialog alert size="sm" title="删除环境？" description={<>“{project.name}”将从 Codex 中移除。从该环境启动的会话将保留。</>} onClose={onClose} footer={
        <>
          <Button variant="secondary" onClick={onClose}>取消</Button>
          <Button variant="danger" data-autofocus disabled={busy} onClick={() => remove(false)}>删除环境</Button>
        </>
      } />
    );
  }
  const running = sessions.filter((t) => activeTurn(t)).length;
  const runningNote = !running ? "" : running >= count ? (count === 1 ? "该会话仍在运行。" : count === 2 ? "这两个会话都仍在运行。" : "这些会话都仍在运行。") : running === 1 ? "其中有一个仍在运行。" : `其中有 ${running} 个仍在运行。`;
  return (
    <Dialog
      title="删除环境？"
      closeButton={false}
      description={<>“{project.name}”将从 Codex 中移除。您可以保留从该环境启动的 {count} 个会话，或将其一并删除。{runningNote && ` ${runningNote}`}</>}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" className="dialog-foot-start" data-autofocus disabled={busy} onClick={onClose}>取消</Button>
          <Button variant="secondary" disabled={busy} onClick={() => remove(false)}>删除环境</Button>
          <Button variant="danger" disabled={busy} onClick={() => remove(true)}>同时删除 {count} 个会话</Button>
        </>
      }
    />
  );
}

type RewindMode = "both" | "conversation" | "code";
const RESTORE_MODES: { value: RewindMode; label: string }[] = [
  { value: "both", label: "代码与对话" },
  { value: "conversation", label: "仅限对话" },
  { value: "code", label: "仅代码" },
];

/**
 * Rewind to here (cc43287c9 Xye): with files to restore, or with no Undo rewind (a backend
 * without thread/revert/switch, where the cut cannot be taken back), the dialog asks first;
 * otherwise it just rewinds, saying 正在回退… past 400ms.
 */
export function rewindHere(threadId: string, turnId: string, text: string): void {
  const thread = getState().threads[threadId];
  if (!thread) return;
  const from = thread.turns.findIndex((turn) => turn.id === turnId);
  const preview = from === -1 ? null : rewindPreview(thread.turns.slice(from), threadCwd(thread));
  if (preview || getState().server.info?.codexUiRevertSwitch !== true) setState({ dialog: { type: "rewind", threadId, turnId, text, preview } });
  else void runRewind(threadId, turnId, text, "conversation");
}

/** Yye then the conversation rewind: the code first, so a failed restore leaves the history alone. */
async function runRewind(threadId: string, turnId: string, text: string, mode: RewindMode): Promise<void> {
  if (mode !== "conversation") {
    let skipped: number;
    try {
      skipped = await restoreCode(threadId, turnId);
    } catch {
      toast("warning", "无法从此处还原代码。请重试。");
      return;
    }
    if (skipped) toast("warning", `已恢复代码，但跳过了 ${skipped} 个无法安全写入的文件。跳过的文件未作改动。`);
    else if (mode === "code") toast("neutral", "代码已恢复");
  }
  if (mode === "code") return;
  const slow = setTimeout(() => toast("neutral", "正在回退…"), 400);
  try {
    await rewindThread(threadId, turnId);
    setComposerDraft(text);
  } catch (error) {
    toast("warning", "无法回退到此消息。", errorMessage(error));
  } finally {
    clearTimeout(slow);
    const shown = getState().toasts.find((t) => t.title === "正在回退…");
    if (shown) dismissToast(shown.id);
  }
}

/**
 * cc43287c9 x_e: the message in a quote box; with files to restore, 恢复 (代码与对话 / 仅限对话 /
 * 仅代码) and what it touches; Cancel first; it cannot be dismissed while rewinding.
 */
function RewindDialog({ threadId, turnId, text, preview }: { threadId: string; turnId: string; text: string; preview: RewindPreview | null }) {
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<RewindMode>("both");
  const undoable = useStore((s) => s.server.info?.codexUiRevertSwitch === true);
  return (
    <Dialog
      title="回退到此消息？"
      size="sm"
      closeButton={false}
      onClose={() => !busy && close()}
      footer={
        <>
          <Button variant="secondary" data-autofocus disabled={busy} onClick={close}>
            取消
          </Button>
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void runRewind(threadId, turnId, text, preview ? mode : "conversation").finally(close);
            }}
          >
            {busy ? "正在回退…" : "回溯"}
          </Button>
        </>
      }
    >
      <div className="dialog-stack">
        <div className="rewind-quote">
          <span className="sr-only">您</span>
          <p>{text.trim().slice(0, 600)}</p>
        </div>
        {preview && (
          <>
            <label className="rewind-restore">
              恢复
              <MenuSelect<RewindMode> field label="恢复" value={mode} options={RESTORE_MODES} disabled={busy} onChange={(next) => setMode(next)} />
            </label>
            <div className="rewind-files" aria-live="polite" data-hidden={mode === "conversation" || undefined}>
              <span>
                {preview.files.length} 个文件
                {(preview.insertions > 0 || preview.deletions > 0) && (
                  <>
                    {" · "}
                    <DiffStat added={preview.insertions} removed={preview.deletions} enter={false} />
                  </>
                )}
              </span>
              <span className="rewind-files-note">通过 shell 命令所做的更改不会还原。提交会保持不变。</span>
            </div>
          </>
        )}
      </div>
      {/* Codex only: without thread/revert/switch the cut history cannot be brought back. */}
      {!undoable && <p className="dialog-note">此操作无法撤销。</p>}
    </Dialog>
  );
}

/**
 * The folder picker; `read` lists another machine's folders instead (an SSH host's, ca720915e
 * 选择远程文件夹), with its own title.
 */
export function FolderDialog({ initialPath, onChoose = chooseFolder, onClose = close, read = readDirectory, title = "为本地会话选择文件夹", description = "新会话将在此文件夹中运行，Codex 只能在其中读写文件（取决于权限模式）。" }: {
  initialPath?: string;
  onChoose?(path: string): void;
  onClose?(): void;
  read?(path: string): Promise<FsReadDirectoryEntry[]>;
  title?: string;
  description?: string;
}) {
  const cwd = useStore((s) => s.prefs.cwd || s.server.cwd);
  const start = initialPath ?? cwd;
  const [path, setPath] = useState(start);
  const [draft, setDraft] = useState(start);
  const [entries, setEntries] = useState<FsReadDirectoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);

  const load = useCallback((target: string) => {
    const id = ++request.current;
    setDraft(target);
    setEntries(null);
    setError(null);
    read(target)
      .then((list) => {
        if (id !== request.current) return;
        setPath(target);
        setEntries(list.filter((e) => e.isDirectory && !e.fileName.startsWith(".")).sort((a, b) => a.fileName.localeCompare(b.fileName)));
      })
      .catch((err) => {
        if (id !== request.current) return;
        setError(errorMessage(err));
        setEntries([]);
      });
  }, [read]);

  useEffect(() => {
    load(start);
    return () => { request.current++; };
  }, [load, start]);

  const choose = () => {
    onChoose(path);
    onClose();
  };

  return (
    <Dialog
      title={title}
      description={description || undefined}
      onClose={onClose}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" disabled={!!error || entries === null || draft.trim() !== path} onClick={choose}>
            选择文件夹
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
        <Button variant="ghost" icon={<Icon name="ArrowReturn" size={16} />} label="返回上一级" onClick={() => load(parentDir(path))} />
        <input className="input mono" value={draft} onChange={(event) => setDraft(event.target.value)} aria-label="文件夹路径" />
        <Button variant="secondary" type="submit">
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
        {entries?.length === 0 && !error && <div className="side-empty">无子目录</div>}
        {entries?.map((entry) => (
          <button key={entry.fileName} type="button" className="folder-item" onClick={() => load(joinPath(path, entry.fileName))}>
            <Icon name="Folder" size="sm" />
            <span>{entry.fileName}</span>
          </button>
        ))}
      </div>
    </Dialog>
  );
}

const COLOR_NAMES = ["蓝色", "橙色", "绿色", "黄色", "粉色", "深绿色", "紫色", "红色"];

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
      toast("warning", existing ? "保存分组失败" : "创建分组失败", errorMessage(error));
      setBusy(false);
    }
  };
  // shared-20 bx「New group」; the colours are Codex's (threadSection appearance), editing is Codex's too.
  return (
    <Dialog
      title={existing ? "编辑分组" : "新建分组"}
      size="sm"
      closeButton={false}
      onClose={close}
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            取消
          </Button>
          <Button variant="primary" disabled={!name.trim() || busy} onClick={() => void submit()}>
            {existing ? "保存" : "创建分组"}
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
            data-tip={COLOR_NAMES[index]}
            className="swatch"
            style={{ background: sectionColor(id) }}
            onClick={() => setColor(id)}
          />
        ))}
        <button type="button" role="radio" aria-checked={color === null} aria-label="无颜色" data-tip="无颜色" className="swatch swatch-none" onClick={() => setColor(null)} />
      </div>
    </Dialog>
  );
}

/** shared-20 4866「Delete group?」(shared-18 vE): counts the sessions filed in it; it closes, then deletes. */
function DeleteSectionDialog({ sectionId }: { sectionId: string }) {
  const name = useStore((s) => s.sections.find((section) => section.id === sectionId)?.name ?? "");
  const count = useStore((s) => Object.values(s.threads).filter((thread) => thread.meta.section?.id === sectionId).length);
  return (
    <Confirm
      danger
      focusConfirm
      title="删除分组？"
      description={<>将移除“{name}”。{count === 0 ? "其中没有任何内容。" : `其中的 ${count} 项将不再分组。`}</>}
      confirm="删除"
      onClose={close}
      onConfirm={async () => void deleteSection(sectionId).catch(fail("删除分组失败"))}
    />
  );
}

type FeedbackCategory = "bug" | "bad_result" | "good_result" | "safety_check" | "other";

// The TUI's categories (tui/src/bottom_pane/feedback_view.rs).
const FEEDBACK: { value: FeedbackCategory; label: string; hint: string }[] = [
  { value: "bug", label: "Bug", hint: "崩溃、报错、卡住，或界面、行为异常" },
  { value: "bad_result", label: "结果不好", hint: "输出偏题、错误、不完整或没有帮助" },
  { value: "good_result", label: "结果很好", hint: "有帮助、正确、质量高，值得表扬" },
  { value: "safety_check", label: "安全检查", hint: "正常使用被安全检查或拒绝拦下" },
  { value: "other", label: "其他", hint: "慢、功能建议、体验反馈，或其他任何事" },
];

/** U13: feedback goes to OpenAI; with logs it also carries this session's file, and says so. */
function FeedbackDialog({ threadId, turnId, good }: { threadId: string; turnId: string | null; good: boolean | null }) {
  const path = useStore((s) => s.threads[threadId]?.meta.path ?? null);
  const [category, setCategory] = useState<FeedbackCategory>(good === true ? "good_result" : good === false ? "bad_result" : "bug");
  const [reason, setReason] = useState("");
  const [logs, setLogs] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await uploadFeedback({
        threadId,
        turnId,
        good: category === "good_result" ? true : category === "bad_result" ? false : null,
        category: category === "good_result" || category === "bad_result" ? undefined : category,
        reason,
        includeLogs: logs,
      });
      toast("neutral", logs ? "反馈和日志已上传" : "反馈已发送", `会话 ID：${threadId}`);
      close();
    } catch (error) {
      toast("warning", "发送反馈失败", errorMessage(error));
      setBusy(false);
    }
  };
  return (
    <Dialog
      title="发送反馈"
      description="您的反馈将发送给 OpenAI，用于改进 Codex。"
      onClose={close}
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            取消
          </Button>
          <Button variant="primary" disabled={busy} onClick={() => void submit()}>
            {busy ? "正在发送…" : "发送"}
          </Button>
        </>
      }
    >
      <div className="dialog-stack">
        <div className="choice-list" role="radiogroup" aria-label="反馈类型">
          {FEEDBACK.map((option) => (
            <label key={option.value} className={`choice-card ${category === option.value ? "selected" : ""}`}>
              <input type="radio" name="feedback-category" checked={category === option.value} onChange={() => setCategory(option.value)} />
              <span className="choice-text">
                <span className="choice-label">{option.label}</span>
                <span className="choice-hint">{option.hint}</span>
              </span>
            </label>
          ))}
        </div>
        <textarea className="input" rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="补充说明（可选）" aria-label="补充说明" />
        <div className="feedback-logs">
          <div className="settings-row-text">
            <div className="settings-row-label">包含日志</div>
            <div className="settings-row-desc">
              将 Codex 日志、诊断报告{path ? `和此会话的记录文件（${basename(path)}）` : ""}一起上传到 OpenAI，其中可能包含代码、命令及其输出。
            </div>
          </div>
          <Toggle checked={logs} label="包含日志" onChange={setLogs} />
        </div>
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
    case "folder": {
      // 更改文件夹… (c6314ba87 Z: browseFolder titled 更改工作目录).
      const { threadId } = dialog;
      const thread = threadId ? getState().threads[threadId] : undefined;
      if (!threadId) return <FolderDialog />;
      return thread ? <FolderDialog key={threadId} title="更改工作目录" description="" initialPath={threadCwd(thread)} onChoose={(path) => void changeThreadFolder(threadId, path)} /> : null;
    }
    case "createProject":
      return <EnvironmentDialog key="create" cwd={dialog.cwd} threadId={dialog.threadId} />;
    case "editProject": {
      const project = getState().projects.find((project) => project.id === dialog.projectId);
      return project ? <EnvironmentDialog key={project.id} project={project} /> : null;
    }
    case "section":
      return <SectionDialog sectionId={dialog.sectionId} threadId={dialog.threadId} />;
    case "deleteSection":
      return <DeleteSectionDialog sectionId={dialog.sectionId} />;
    case "rewind":
      return <RewindDialog threadId={dialog.threadId} turnId={dialog.turnId} text={dialog.text} preview={dialog.preview} />;
    case "feedback":
      return <FeedbackDialog key={`${dialog.threadId}:${dialog.turnId}:${dialog.good}`} threadId={dialog.threadId} turnId={dialog.turnId} good={dialog.good} />;
  }
}
