// 新建环境 / 编辑环境: Claude's live EpitaxyEnvironmentDialog (ca690a791 I) for a local environment,
// kept as a Codex project. The folder field, its rows, branch picker and worktree box are cd8823d73
// (K, q, J, Y, $e); the variables page is c3f9f1667 ae; names follow c579ebf88. Only the local kind
// exists so far, and Claude shows no session-type tabs when that is the only one.

import type { Project } from "@protocol/v2/Project";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { callExperimental, chooseProject, createProject, errorMessage, readDirectory, supports, updateProject } from "../lib/codex";
import { envError, environmentOf, formatEnv, localName, parseEnv, parseEnvKeeping, RESERVED_NAMES, sameName, sortBranches, withEnvironment, type Checkout } from "../lib/environments";
import { basename, homeRelative, parentDir } from "../lib/format";
import { setState, useStore } from "../lib/store";
import { MenuSearch, useRecentFolders } from "./Composer";
import { DeleteEnvironmentDialog, FolderDialog } from "./Dialogs";
import { Button, Checkbox, Dialog, Icon, MenuItem, MenuSep, Popover } from "./ui";

const close = () => setState({ dialog: null });

interface GitInfo {
  inRepo: boolean;
  root: string | null;
  head: string | null;
  defaultBranch: string | null;
  branches: string[];
}

/** Each folder's repository (the bridge's codexUi/git/branches), undefined until read. */
function useGit(paths: string[]): Record<string, GitInfo | undefined> {
  const [known, setKnown] = useState<Record<string, GitInfo>>({});
  const key = paths.join("\n");
  useEffect(() => {
    let live = true;
    for (const path of key ? key.split("\n") : []) {
      if (known[path]) continue;
      callExperimental<GitInfo>("codexUi/git/branches", { cwd: path })
        .catch((): GitInfo => ({ inRepo: false, root: null, head: null, defaultBranch: null, branches: [] }))
        .then((info) => live && setKnown((map) => ({ ...map, [path]: info })));
    }
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return known;
}

/** ca690a791 zt: what "no branch picked" means — worktrees start from the default, folders stay on HEAD. */
type None = { branch: string; mark: "current" | "default" } | { label: string };

interface BranchPick {
  value: string;
  pick: "starts-worktree" | "switches-folder";
  none: None;
  branches: string[];
  disabledReason?: string;
  onChange(branch: string): void;
}

function branchPick(git: GitInfo, value: string | undefined, worktree: boolean, onChange: (branch: string) => void, disabledReason?: string): BranchPick {
  const defaultBranch = git.defaultBranch ?? git.branches.find((branch) => branch === "main" || branch === "master");
  return {
    value: value ?? "",
    pick: worktree ? "starts-worktree" : "switches-folder",
    none: worktree && defaultBranch ? { branch: defaultBranch, mark: "default" } : git.head ? { branch: git.head, mark: "current" } : { label: "当前分支" },
    branches: sortBranches(git.branches, value),
    disabledReason,
    onChange,
  };
}

/** cd8823d73 Ye: the typed name first when it matches, the "none" row, then the matching branches. */
function branchRows(pick: BranchPick, query: string, mark: string) {
  const { none, value } = pick;
  const noneBranch = "branch" in none ? none.branch : undefined;
  const q = query.toLowerCase();
  const matches = (text: string) => text.toLowerCase().includes(q);
  const pickedCurrent = "branch" in none && none.mark === "current" && value === none.branch;
  const listed = pick.branches.filter((branch) => branch !== noneBranch || pickedCurrent);
  const exact = pick.branches.find((branch) => branch === query);
  const noneFirst = "branch" in none ? matches(none.branch) : query === "";
  const noneLast = !noneFirst && matches("branch" in none ? `${none.branch} ${mark}` : none.label);
  return [...(exact === undefined ? [] : [exact]), ...(noneFirst ? [""] : []), ...listed.filter((branch) => branch !== exact && matches(branch)), ...(noneLast ? [""] : [])].map((branch) => ({
    branch,
    checked: branch === value || (branch === "" && value === noneBranch && !pickedCurrent && exact !== noneBranch),
  }));
}

function BranchMenu({ label, pick }: { label: string; pick: BranchPick }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const enabled = pick.disabledReason === undefined;
  const mark = "branch" in pick.none ? (pick.none.mark === "current" ? "当前" : "默认") : "";
  const shown = pick.value || ("branch" in pick.none ? pick.none.branch : undefined);
  const rows = branchRows(pick, query.trim(), mark);
  const choose = (branch: string) => {
    setOpen(false);
    setQuery("");
    pick.onChange(branch);
  };
  const row = ({ branch, checked }: { branch: string; checked: boolean }) => (
    <MenuItem
      key={branch || "\n"}
      label={branch ? <span className="env-branch-name">{branch}</span> : "branch" in pick.none ? <span className="env-branch-name">{pick.none.branch}</span> : pick.none.label}
      value={branch === "" && mark ? mark : undefined}
      checked={checked}
      onClick={() => choose(branch)}
    />
  );
  const trigger = (
    <Button
      variant="ghost"
      size="xs"
      className="env-branch"
      disabled={!enabled}
      data-tip={pick.disabledReason}
      onClick={() => setOpen(!open)}
    >
      <span className="sr-only">{label} 的分支：</span>
      {shown === undefined ? <span className="env-branch-name">{"label" in pick.none && pick.none.label}</span>
        : pick.value && pick.pick === "switches-folder" ? <span className="env-branch-name">切换到 {shown}</span>
        : <span className="env-branch-text"><span className="env-branch-name">{shown}</span>{!pick.value && mark === "当前" && <span>{mark}</span>}</span>}
    </Button>
  );
  return (
    <Popover open={open} onClose={() => { setOpen(false); setQuery(""); }} placement="bottom-end" className="menu-env-branch" anchor={trigger}>
      <MenuSearch label="搜索分支…" value={query} onChange={setQuery} onSubmit={() => rows[0] && choose(rows[0].branch)} />
      {rows.length === 0 ? <div className="menu-none">没有匹配的分支</div>
        : query || rows.length === 1 ? rows.map(row)
        : pick.pick === "starts-worktree" ? <><div className="menu-section">工作树起始分支</div>{rows.map(row)}</>
        : <>{row(rows[0])}<MenuSep /><div className="menu-section">将此文件夹切换到</div>{rows.slice(1).map(row)}</>}
    </Popover>
  );
}

const WORKTREE_TIP = "Codex 会在此代码库的单独副本中进行更改，因此您的文件夹会保持原样。";

/** cd8823d73 Y + $e: icon, name, then branch, worktree box, note and the remove key. */
function FolderRow({ path, branch, worktree, note, onRemove }: {
  path: string;
  branch?: BranchPick;
  worktree?: { checked: boolean; disabledReason?: string; onChange(on: boolean): void };
  note?: ReactNode;
  onRemove(): void;
}) {
  const name = basename(path) || path;
  const quiet = !!(branch || worktree || note);
  return (
    <li className="env-place">
      <div className="env-place-line">
        <Icon name="Folder" size="sm" className="env-place-icon" />
        <span className="env-place-name" data-tip={homeRelative(path)}>{name}</span>
        <div className="env-place-end">
          {branch && <BranchMenu label={name} pick={branch} />}
          {worktree && (
            <span className="env-worktree" data-tip={worktree.disabledReason ?? WORKTREE_TIP}>
              <Checkbox checked={worktree.checked} disabled={worktree.disabledReason !== undefined} label="工作树" onChange={worktree.onChange} aria-label={`${name} 的工作树`} />
            </span>
          )}
          {note && <span className="env-place-note">{note}</span>}
          <span className="env-place-remove">
            <Button variant="ghost" size="xs" icon={<Icon name="X" size="sm" />} label={`移除 ${name}`} className={quiet ? "env-quiet" : ""} onClick={onRemove} />
          </span>
        </div>
      </div>
    </li>
  );
}

/** The 添加 select (cd8823d73 et): recent folders, then 选择… for the folder picker. */
function AddFolder({ taken, hasFolder, onAdd }: { taken: string[]; hasFolder: boolean; onAdd(path: string): void }) {
  const [open, setOpen] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const { recent } = useRecentFolders();
  const items = recent.filter((path) => !taken.some((other) => other.toLowerCase() === path.toLowerCase()));
  const names = new Map<string, number>();
  for (const path of recent) names.set(basename(path), (names.get(basename(path)) ?? 0) + 1);
  const trigger = (
    <button type="button" className="env-add" aria-label="添加" onClick={() => setOpen(!open)}>
      <Icon name="Add" size="sm" />
      添加
    </button>
  );
  return (
    <>
      <Popover open={open} onClose={() => setOpen(false)} placement="bottom-end" className="menu-env-add" anchor={trigger}>
        {items.length === 0 && <div className="menu-none">{hasFolder && recent.length > 0 ? "没有其他最近使用的文件夹" : "暂无最近使用的文件夹"}</div>}
        {items.map((path) => (
          <MenuItem key={path} label={basename(path)} title={path} hint={(names.get(basename(path)) ?? 0) > 1 ? homeRelative(parentDir(path)) : undefined} onClick={() => { setOpen(false); onAdd(path); }} />
        ))}
        <MenuSep />
        <MenuItem icon={<Icon name="Folder" size="sm" />} label="选择…" onClick={() => { setOpen(false); setBrowsing(true); }} />
      </Popover>
      {browsing && <FolderDialog initialPath={taken[0]} onClose={() => setBrowsing(false)} onChoose={onAdd} />}
    </>
  );
}

/** ca690a791 Ut: closing with changes asks first; Discard (danger) apart from Keep editing and the save. */
function ConfirmClose({ creating, canSave, onKeep, onDiscard, onSave }: { creating: boolean; canSave: boolean; onKeep(): void; onDiscard(): void; onSave(): void }) {
  if (!canSave) {
    return (
      <Dialog alert size="sm" title="放弃未保存的更改？" description="您的更改尚未保存，将会丢失。" onClose={onKeep} footer={
        <>
          <Button variant="secondary" data-autofocus onClick={onKeep}>继续编辑</Button>
          <Button variant="danger" onClick={onDiscard}>放弃</Button>
        </>
      } />
    );
  }
  return (
    <Dialog alert size="sm" title={creating ? "要创建此环境吗？" : "保存更改？"} onClose={onKeep} footer={
      <>
        <Button variant="danger" className="dialog-foot-start" onClick={onDiscard}>放弃</Button>
        <Button variant="secondary" data-autofocus onClick={onKeep}>继续编辑</Button>
        <Button variant="primary" onClick={onSave}>{creating ? "创建环境" : "保存"}</Button>
      </>
    } />
  );
}

/** Additional folders' settings, only for folders still listed and only what differs from the default. */
function folderSettingsFor(folders: string[], settings: Record<string, Checkout>): Record<string, Checkout> {
  return Object.fromEntries(folders.flatMap((path) => {
    const { worktree, branch } = settings[path] ?? {};
    return worktree || branch ? [[path, { ...(worktree && { worktree }), ...(branch && { branch }) }]] : [];
  }));
}

export function EnvironmentDialog({ cwd, project }: { cwd?: string; project?: Project }) {
  const projects = useStore((s) => s.projects);
  const stored = useMemo(() => environmentOf(project), [project]);
  const initial = useMemo(() => {
    const [first = cwd ?? null, ...rest] = project ? project.roots.map((root) => root.path) : [];
    return {
      name: project?.name ?? "",
      nameDirty: !!project,
      folder: first ?? null,
      additional: rest,
      settings: stored.settings,
      folderSettings: stored.folderSettings,
      envText: formatEnv(stored.env),
    };
  }, [cwd, project, stored]);
  const [form, setForm] = useState(initial);
  const [envDirty, setEnvDirty] = useState(false);
  const [page, setPage] = useState<"main" | "variables">("main");
  const [asking, setAsking] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const update = (patch: Partial<typeof form>) => setForm((current) => ({ ...current, ...patch }));

  const folders = form.folder ? [form.folder, ...form.additional] : [];
  const git = useGit(folders);
  // ca690a791 Wt: each folder's repository root, null outside one, undefined until read.
  const roots = folders.map((path) => (git[path] ? git[path]!.root : undefined));

  const taken = useMemo(() => [...projects.filter((other) => other.id !== project?.id).map((other) => other.name), ...RESERVED_NAMES], [projects, project]);
  const name = (form.nameDirty ? form.name : form.folder ? localName(form.folder, taken) : "").trim();
  const clash = name !== "" && !(project && sameName(project.name, name)) && taken.some((other) => sameName(other, name));
  const reserved = clash && RESERVED_NAMES.some((other) => sameName(other, name));
  const envProblem = envError(form.envText);
  const envTyping = envError(form.envText, { allowTrailingBareKey: true });
  const envCount = envProblem ? 0 : Object.keys(parseEnv(form.envText)).length;
  const valid = !!form.folder && name !== "" && !clash && !envProblem;
  const dirty = envDirty || JSON.stringify({ ...form, envText: "" }) !== JSON.stringify({ ...initial, envText: "" });

  // The first folder: worktree box unless outside a repository, branch picker once branches are known.
  const firstGit = form.folder ? git[form.folder] : undefined;
  const firstWorktree = form.settings.worktree === true;
  const firstNote = form.folder && roots[0] === null && !firstWorktree && !form.settings.branch ? "不是 Git 仓库" : undefined;
  const firstBranch = firstGit && !firstNote && firstGit.branches.length > 0
    ? branchPick(firstGit, form.settings.branch, firstWorktree, (branch) => update({ settings: { ...form.settings, branch: branch || undefined } }))
    : undefined;

  const additionalRow = (path: string, index: number) => {
    const at = index + 1;
    const root = roots[at];
    const sharedAt = typeof root === "string" ? roots.indexOf(root) : -1;
    const shared = sharedAt >= 0 && sharedAt < at ? folders[sharedAt] : undefined;
    const sharedWorktree = shared === undefined ? false : sharedAt === 0 ? firstWorktree : form.folderSettings[shared]?.worktree === true;
    const settings = form.folderSettings[path] ?? {};
    const inRepo = typeof root === "string" ? true : root === null ? false : undefined;
    const set = (patch: Checkout) => update({ folderSettings: { ...form.folderSettings, [path]: { ...settings, ...patch } } });
    const worktree = shared ? sharedWorktree : settings.worktree === true;
    const branchOff = !worktree && !shared && inRepo === true && !roots.slice(0, at).includes(undefined);
    const note = inRepo === false && !settings.worktree && !settings.branch ? "不是 Git 仓库" : shared && sharedWorktree ? <>与 <bdi>{basename(shared)}</bdi> 相同的工作树</> : undefined;
    const info = git[path];
    const branch = info && (worktree || branchOff) && inRepo !== false && !shared && info.branches.length > 0
      ? branchPick(info, branchOff ? undefined : settings.branch, worktree, (value) => set({ branch: value || undefined }), branchOff ? "开启工作树后即可选择分支。" : undefined)
      : undefined;
    return (
      <FolderRow
        key={path}
        path={path}
        branch={branch}
        note={note}
        worktree={note ? undefined : {
          checked: worktree,
          disabledReason: shared ? `此文件夹与 ${basename(shared)} 位于同一仓库中。` : undefined,
          onChange: (on) => set(on ? { worktree: true } : { worktree: false, branch: undefined }),
        }}
        onRemove={() => {
          const { [path]: _, ...rest } = form.folderSettings;
          update({ additional: form.additional.filter((other) => other !== path), folderSettings: rest });
        }}
      />
    );
  };

  const removeFirst = () => {
    const [next, ...rest] = form.additional;
    if (next === undefined) return update({ folder: null });
    const { [next]: moved, ...others } = form.folderSettings;
    update({ folder: next, additional: rest, folderSettings: others, settings: moved ?? {} });
  };

  const add = (path: string) => {
    if (folders.some((other) => other.toLowerCase() === path.toLowerCase())) return;
    if (!form.folder) update({ folder: path });
    else update({ additional: [...form.additional, path] });
  };

  const submit = async () => {
    if (!valid || pending.current || !form.folder) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      await Promise.all(folders.map((path) => readDirectory(path)));
      const env = envDirty ? parseEnvKeeping(form.envText, stored.env) : stored.env;
      const metadata = withEnvironment(project?.metadata, {
        version: 1,
        kind: "local",
        settings: { ...(form.settings.worktree && { worktree: true }), ...(form.settings.branch && { branch: form.settings.branch }) },
        folderSettings: folderSettingsFor(form.additional, form.folderSettings),
        env,
      });
      if (project) {
        await updateProject(project.id, name, folders, metadata);
      } else {
        const created = await createProject(name, folders, crypto.randomUUID(), metadata);
        if (!created) throw new Error("当前 Codex 版本不支持项目，请更新后重试。");
        chooseProject(created.id);
      }
      close();
    } catch (error) {
      setError(errorMessage(error));
      setAsking(false);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };

  const dismiss = () => {
    if (pending.current) return;
    if (page !== "main") setPage("main");
    else if (dirty) setAsking(true);
    else close();
  };

  const labelId = useId();
  // Back on the main page, focus returns to the row that opened the variables (ca690a791 Tr).
  const variablesRow = useRef<HTMLButtonElement>(null);
  const shownPage = useRef(page);
  useEffect(() => {
    if (shownPage.current !== page && page === "main") variablesRow.current?.focus();
    shownPage.current = page;
  }, [page]);
  const title = page === "main"
    ? (project ? "编辑环境" : "新建环境")
    : (
      <span className="env-subtitle">
        <Button variant="ghost" size="sm" icon={<Icon name="CaretLeft" size="sm" />} label="返回" tip="" onClick={() => setPage("main")} />
        环境变量
      </span>
    );

  return (
    <>
      <Dialog
        title={title}
        focusPanel
        onClose={dismiss}
        footer={page === "main" ? (
          <>
            {project && supports("project/delete") && (
              <Button variant="ghost" className="dialog-foot-delete" disabled={busy} onClick={() => setDeleting(true)}>删除环境</Button>
            )}
            <Button variant="secondary" disabled={busy} onClick={dismiss}>取消</Button>
            <Button variant="primary" type="submit" form="environment-form" disabled={!valid || busy}>
              {busy ? (project ? "正在保存…" : "正在创建…") : (project ? "保存" : "创建环境")}
            </Button>
          </>
        ) : (
          <Button variant="primary" onClick={() => setPage("main")}>完成</Button>
        )}
      >
        <form id="environment-form" className={page === "main" ? "env-form" : "env-hidden"} aria-busy={busy} inert={page !== "main"} onSubmit={(event) => {
          event.preventDefault();
          // The folder picker's path bar is a form portaled out of this one; React still bubbles its submit here.
          if (event.target === event.currentTarget) void submit();
        }}>
          <div className={`env-field${clash ? " env-invalid" : ""}`}>
            <div className="env-label-row">
              <label htmlFor={`${labelId}-name`} className="env-label">名称</label>
              {clash && <span role="alert" className="env-error">{reserved ? "此名称已被保留。" : "已有其他环境使用此名称。"}</span>}
            </div>
            <input
              id={`${labelId}-name`}
              className="input input-lg"
              value={form.nameDirty ? form.name : name}
              placeholder="我的应用"
              autoComplete="off"
              aria-invalid={clash || undefined}
              disabled={busy}
              onChange={(event) => update({ name: event.target.value, nameDirty: true })}
            />
          </div>
          <div className="env-field" role="group" aria-labelledby={`${labelId}-folders`}>
            <div className="env-label-row">
              <span id={`${labelId}-folders`} className="env-label">文件夹</span>
              <AddFolder taken={folders} hasFolder={!!form.folder} onAdd={add} />
            </div>
            {form.folder ? (
              <div className="env-places">
                <ul role="list">
                  <FolderRow
                    path={form.folder}
                    branch={firstBranch}
                    note={firstNote}
                    worktree={firstNote ? undefined : { checked: firstWorktree, onChange: (on) => update({ settings: { ...form.settings, worktree: on } }) }}
                    onRemove={removeFirst}
                  />
                  {form.additional.map(additionalRow)}
                </ul>
              </div>
            ) : (
              <div className="env-places-empty"><span>选择会话启动时所在的文件夹。</span></div>
            )}
            {form.additional.some((path, index) => {
              const root = roots[index + 1];
              const sharedAt = typeof root === "string" ? roots.indexOf(root) : -1;
              return !(sharedAt >= 0 && sharedAt <= index) && typeof root === "string" && form.folderSettings[path]?.worktree === true;
            }) && <p role="note" className="env-footnote">当附加文件夹使用工作树时，所有工作树都会在会话开始时创建。</p>}
          </div>
          <button type="button" ref={variablesRow} className="env-link-row" onClick={() => setPage("variables")}>
            <span className="env-link-text">
              <span className="env-link-title">环境变量</span>
              <span className={envProblem ? "env-link-summary env-error" : "env-link-summary"}>{envProblem ?? (envCount ? `${envCount} 个变量` : "此环境没有变量")}</span>
            </span>
            <Icon name="CaretRight" size="sm" className="env-link-caret" />
          </button>
          {error && <p className="error-text" role="alert">{error}</p>}
        </form>
        {page === "variables" && (
          <div className="env-form">
            <p className="env-footnote env-lead">已为在 {name || "此环境"} 中启动的会话设置。</p>
            <label className="env-field">
              <span className="env-label">环境变量</span>
              <textarea
                className="input env-vars"
                dir="ltr"
                rows={8}
                autoFocus
                spellCheck={false}
                autoComplete="off"
                value={form.envText}
                placeholder={"NODE_ENV=production\nGIT_AUTHOR_NAME=Your Name\n\n# Multiline values - wrap in quotes\nCONFIG=\"key1=val1\nkey2=val2\""}
                aria-invalid={!!envTyping || undefined}
                onChange={(event) => { update({ envText: event.target.value }); setEnvDirty(true); }}
              />
              <span className={envTyping ? "env-footnote env-error" : "env-footnote"}>{envTyping ?? "采用 .env 格式。这些值以明文保存在 Codex 项目中，并传递给在此环境中启动的 Codex 会话。"}</span>
            </label>
          </div>
        )}
      </Dialog>
      {asking && <ConfirmClose creating={!project} canSave={valid} onKeep={() => setAsking(false)} onDiscard={close} onSave={() => void submit()} />}
      {deleting && project && <DeleteEnvironmentDialog project={project} onClose={() => setDeleting(false)} onDeleted={close} />}
    </>
  );
}
