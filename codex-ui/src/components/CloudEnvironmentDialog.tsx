// The cloud kind of 新建环境 / 编辑环境 (Claude ca690a791's cloud panel: 云环境, the repository and
// its branch, "变量、网络访问和设置脚本是 {env} 的一部分。编辑") and 添加云环境 / 编辑云环境 (Claude
// c73f2f585 and its message table c1d8251e4: 名称, then 网络访问 / 设置脚本 / 环境变量 rows that open
// their own pages). A Codex Cloud environment is also bound to one GitHub repository, picked when
// it is made; the network levels become Codex's agent_network_access (lib/cloud.ts).

import { useEffect, useId, useRef, useState } from "react";
import {
  CLOUD_HOME,
  cloudBranches,
  cloudRepositories,
  createCloudEnvironment,
  readCloudEnvironment,
  refreshCloudEnvironments,
  updateCloudEnvironment,
  useCloud,
  type CloudEnvironment,
  type CloudEnvironmentForm,
  type CloudRepository,
  type NetworkLevel,
} from "../lib/cloud";
import { errorMessage } from "../lib/codex";
import { envError, formatEnv, parseEnv, sameName } from "../lib/environments";
import { MenuSearch } from "./Composer";
import { Button, Checkbox, Dialog, Icon, MenuItem, MenuSep, Popover, Spinner } from "./ui";

/** Claude's levels in its order (c73f2f585 it / at), with Codex's meaning of each. */
const LEVELS: { level: NetworkLevel; title: string; description: string }[] = [
  { level: "none", title: "无", description: "会话无法访问任何外部主机。" },
  { level: "trusted", title: "受信任", description: "会话可访问常见的包管理器等常用依赖项。" },
  { level: "full", title: "完全访问", description: "会话可访问任何主机。" },
  { level: "custom", title: "自定义", description: "会话仅可访问您允许的域名。" },
];

const levelTitle = (level: NetworkLevel) => LEVELS.find((entry) => entry.level === level)!.title;

/** c73f2f585 R.customSummary / levelSummary. */
function networkSummary(form: Pick<CloudEnvironmentForm, "network" | "domains" | "packages">): string {
  if (form.network !== "custom") return levelTitle(form.network);
  return `自定义 · ${form.domains.length ? `${form.domains.length} 个域名` : "无域名"}${form.packages ? " · 已启用包管理器" : ""}`;
}

const lines = (text: string) => (text.trim() ? text.trim().split("\n").length : 0);
const domainsOf = (text: string) => text.split("\n").map((line) => line.trim()).filter(Boolean);

type Page = "main" | "network" | "setup" | "variables";
const PAGE_TITLE: Record<Exclude<Page, "main">, string> = { network: "网络访问", setup: "设置脚本", variables: "环境变量" };

const BLANK: CloudEnvironmentForm = { name: "", network: "trusted", domains: [], packages: false, setup: "", env: {} };

/** 添加云环境 (no `environmentId`) or 编辑云环境; `onSaved` gets the environment as listed. */
export function CloudEnvironmentDialog({ environmentId, onClose, onSaved }: { environmentId?: string; onClose(): void; onSaved?(environment: CloudEnvironment): void }) {
  const environments = useCloud((s) => s.environments);
  const [loaded, setLoaded] = useState<{ form: CloudEnvironmentForm; raw: Record<string, unknown> } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [repo, setRepo] = useState<CloudRepository | null>(null);
  const [network, setNetwork] = useState<NetworkLevel>(BLANK.network);
  const [domainsText, setDomainsText] = useState("");
  const [packages, setPackages] = useState(true);
  const [setup, setSetup] = useState("");
  const [envText, setEnvText] = useState("");
  const [page, setPage] = useState<Page>("main");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();

  useEffect(() => {
    if (!environmentId) return;
    let live = true;
    readCloudEnvironment(environmentId).then((read) => {
      if (!live) return;
      setLoaded(read);
      setName(read.form.name);
      setNetwork(read.form.network);
      setDomainsText(read.form.domains.join("\n"));
      setPackages(read.form.network === "custom" ? read.form.packages : true);
      setSetup(read.form.setup);
      setEnvText(formatEnv(read.form.env));
    }, (failure) => live && setLoadError(`无法加载此环境。${errorMessage(failure)}`));
    return () => { live = false; };
  }, [environmentId]);

  const domains = domainsOf(domainsText);
  const form: CloudEnvironmentForm = { name, network, domains: network === "custom" ? domains : [], packages: network === "custom" && packages, setup, env: parseEnv(envText) };
  const nameProblem = !name.trim() ? "请输入名称。"
    : environments?.some((env) => env.id !== environmentId && sameName(env.label, name)) ? "已存在同名环境。请选择其他名称。" : undefined;
  const networkProblem = network === "custom" && !domains.length && !packages ? "请输入至少一个域名，或选择其他访问级别。" : undefined;
  const envProblem = envError(envText);
  const valid = !nameProblem && !networkProblem && !envProblem && (environmentId ? !!loaded : !!repo);

  const submit = async () => {
    setTouched(true);
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (environmentId) {
        await updateCloudEnvironment(environmentId, form, loaded!.raw);
        onSaved?.({ ...(environments?.find((env) => env.id === environmentId) ?? { id: environmentId, repo: null, repoName: null, defaultBranch: null }), label: name.trim() });
      } else {
        onSaved?.(await createCloudEnvironment(form, repo!.id));
      }
      onClose();
    } catch (failure) {
      setError(`${environmentId ? "无法更新环境。" : "无法创建环境。"}您可以重试。${errorMessage(failure)}`);
    } finally {
      setBusy(false);
    }
  };

  const row = (target: Exclude<Page, "main">, summary: string, problem?: string) => (
    <button type="button" className="env-link-row" onClick={() => setPage(target)}>
      <span className="env-link-text">
        <span className="env-link-title">{PAGE_TITLE[target]}</span>
        <span className={problem ? "env-link-summary env-error" : "env-link-summary"}>{problem ?? summary}</span>
      </span>
      <Icon name="CaretRight" size="sm" className="env-link-caret" />
    </button>
  );

  const title = page === "main" ? (environmentId ? "编辑云环境" : "添加云环境") : (
    <span className="env-subtitle">
      <Button variant="ghost" size="sm" icon={<Icon name="CaretLeft" size="sm" />} label="返回" tip="" onClick={() => setPage("main")} />
      {PAGE_TITLE[page]}
    </span>
  );

  return (
    <Dialog
      title={title}
      onClose={() => (busy ? undefined : page === "main" ? onClose() : setPage("main"))}
      footer={page === "main" ? (
        <>
          <Button variant="secondary" disabled={busy} onClick={onClose}>取消</Button>
          <Button variant="primary" disabled={busy || (touched && !valid) || (!!environmentId && !loaded)} onClick={() => void submit()}>
            {busy ? (environmentId ? "正在保存…" : "正在创建…") : environmentId ? "保存更改" : "添加环境"}
          </Button>
        </>
      ) : (
        <Button variant="primary" onClick={() => setPage("main")}>完成</Button>
      )}
    >
      {environmentId && !loaded ? (
        <div className="env-form">{loadError ? <p className="error-text" role="alert">{loadError}</p> : <Spinner />}</div>
      ) : (
        <>
          <div className={page === "main" ? "env-form" : "env-hidden"} inert={page !== "main"}>
            <label className="env-field">
              <span className="env-label-row">
                <span className="env-label">名称</span>
                {touched && nameProblem && <span role="alert" className="env-error">{nameProblem}</span>}
              </span>
              <input id={`${id}-name`} className="input" data-autofocus value={name} placeholder="我的应用" autoComplete="off" aria-invalid={(touched && !!nameProblem) || undefined} disabled={busy} onChange={(event) => setName(event.target.value)} />
            </label>
            {!environmentId && (
              <div className="env-field">
                <span className="env-label-row">
                  <span className="env-label">代码仓库</span>
                  {touched && !repo && <span role="alert" className="env-error">请选择代码仓库。</span>}
                </span>
                <RepositorySelect value={repo} onChange={(picked) => { setRepo(picked); if (!name.trim()) setName(picked.name.split("/").pop() ?? picked.name); }} />
                <p className="env-footnote">创建后无法更改。任务会克隆此仓库并在其中工作。</p>
              </div>
            )}
            <div className="env-rows">
              {row("network", networkSummary(form), networkProblem)}
              {row("setup", lines(setup) ? `${lines(setup)} 行` : "未设置")}
              {row("variables", Object.keys(form.env).length ? `${Object.keys(form.env).length} 个变量` : "此环境没有变量", envProblem)}
            </div>
            {error && <p className="error-text" role="alert">{error}</p>}
          </div>
          {page === "network" && (
            <div className="env-form">
              <div className="env-levels" role="radiogroup" aria-label="网络访问">
                {LEVELS.map((entry) => (
                  <button key={entry.level} type="button" role="radio" aria-checked={network === entry.level} className="env-level" onClick={() => setNetwork(entry.level)}>
                    <span className="env-level-text">
                      <span>{entry.title}</span>
                      <span className="env-footnote">{entry.level === "custom" && packages ? "会话可访问包管理器和您允许的域名。" : entry.description}</span>
                    </span>
                    {network === entry.level && <Icon name="Check" size="sm" />}
                  </button>
                ))}
              </div>
              {network === "custom" && (
                <>
                  <label className="env-field">
                    <span className="env-label">允许的域名</span>
                    <textarea className="input env-vars" dir="ltr" rows={5} spellCheck={false} value={domainsText} placeholder={"example.com\n*.example.org"} aria-invalid={!!networkProblem || undefined} onChange={(event) => setDomainsText(event.target.value)} />
                    <span className={networkProblem ? "env-footnote env-error" : "env-footnote"}>{networkProblem ?? "每行一个域名。使用 *.example.com 以包含子域名。"}</span>
                  </label>
                  <Checkbox checked={packages} onChange={setPackages} label="同时包含常见包管理器的默认列表" />
                </>
              )}
              <p className="env-footnote">设置脚本运行期间始终可以访问网络；此处的级别从任务开始工作时生效。</p>
            </div>
          )}
          {page === "setup" && (
            <label className="env-form env-field">
              <textarea className="input env-vars" dir="ltr" rows={10} autoFocus spellCheck={false} aria-label="设置脚本" value={setup} placeholder={"npm ci\npip install -r requirements.txt"} onChange={(event) => setSetup(event.target.value)} />
              <span className="env-footnote">Bash。在新任务启动时、Codex 启动之前运行。结果会被缓存，以便后续任务快速启动。</span>
            </label>
          )}
          {page === "variables" && (
            <label className="env-form env-field">
              <textarea className="input env-vars" dir="ltr" rows={8} autoFocus spellCheck={false} autoComplete="off" aria-label="环境变量" value={envText} placeholder={"NODE_ENV=production\nAPI_BASE=https://example.com"} aria-invalid={!!envProblem || undefined} onChange={(event) => setEnvText(event.target.value)} />
              <span className={envProblem ? "env-footnote env-error" : "env-footnote"}>{envProblem ?? "每行一个 KEY=value，采用 .env 格式。使用此环境的任何人都能看到这些值，因此请勿添加密钥。"}</span>
            </label>
          )}
        </>
      )}
    </Dialog>
  );
}

/** The repository picker (ca690a791 Tt's list): 搜索仓库…, or the GitHub connection when ChatGPT has none. */
function RepositorySelect({ value, onChange }: { value: CloudRepository | null; onChange(repo: CloudRepository): void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<{ repositories: CloudRepository[]; needsConnect: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    let live = true;
    setError(null);
    const timer = setTimeout(() => {
      cloudRepositories(query).then((answer) => live && setFound(answer), (failure) => live && setError(errorMessage(failure)));
    }, query ? 250 : 0);
    return () => { live = false; clearTimeout(timer); };
  }, [open, query]);
  const trigger = (
    <button type="button" className="env-select" aria-label="代码仓库" onClick={() => setOpen(!open)}>
      <span className={value ? "env-select-value" : "env-select-value env-select-placeholder"}>{value ? value.name : "选择代码仓库"}</span>
      <Icon name="CaretDown" size="sm" />
    </button>
  );
  return (
    <Popover open={open} onClose={() => { setOpen(false); setQuery(""); }} className="menu-env-host" anchor={trigger}>
      <MenuSearch label="搜索仓库…" value={query} onChange={setQuery} onSubmit={() => found?.repositories[0] && (setOpen(false), onChange(found.repositories[0]))} />
      {error ? <div className="menu-none">{error}</div>
        : !found ? <div className="menu-none"><Spinner /></div>
        : found.needsConnect ? (
          <div className="menu-none">
            连接 GitHub 以为此环境选择代码仓库
            <br />
            <a href={CLOUD_HOME} target="_blank" rel="noopener noreferrer">连接到 GitHub</a>
          </div>
        )
        : !found.repositories.length ? <div className="menu-none">没有匹配的仓库</div>
        : found.repositories.map((repo) => (
          <MenuItem key={repo.id} label={repo.name} checked={repo.id === value?.id} onClick={() => { setOpen(false); setQuery(""); onChange(repo); }} />
        ))}
    </Popover>
  );
}

/**
 * The environment dialog's cloud panel: 云环境 (添加云环境… at the list's foot), its repository with
 * the branch tasks start from, and the line that sends variables, network and setup to the cloud
 * environment's own dialog.
 */
export function CloudPanel({ environmentId, branch, onChange }: { environmentId: string | null; branch: string; onChange(patch: { environmentId?: string | null; branch?: string }): void }) {
  const environments = useCloud((s) => s.environments);
  const loadError = useCloud((s) => s.environmentsError);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  useEffect(() => void refreshCloudEnvironments(), []);
  const picked = environments?.find((env) => env.id === environmentId);
  const [open, setOpen] = useState(false);
  const trigger = (
    <button type="button" className="env-select" aria-label="云环境" onClick={() => setOpen(!open)}>
      <span className={picked ? "env-select-value" : "env-select-value env-select-placeholder"}>{picked?.label ?? (environmentId && !environments ? "…" : "选择一个环境")}</span>
      <Icon name="CaretDown" size="sm" />
    </button>
  );
  return (
    <>
      <div className="env-field">
        <div className="env-label-row">
          <span className="env-label" data-tip="此环境中会话的运行位置">云环境</span>
        </div>
        <Popover open={open} onClose={() => setOpen(false)} className="menu-env-host" anchor={trigger}>
          {loadError && !environments ? (
            <div className="menu-none">无法加载您的云环境。<button type="button" className="env-inline-link" onClick={() => void refreshCloudEnvironments()}>重试</button></div>
          ) : !environments ? <div className="menu-none"><Spinner /></div>
          : !environments.length ? <div className="menu-none">未配置云环境</div>
          : environments.map((env) => (
            <MenuItem key={env.id} label={env.label} hint={env.repoName ?? undefined} checked={env.id === environmentId} onClick={() => { setOpen(false); if (env.id !== environmentId) onChange({ environmentId: env.id, branch: "" }); }} />
          ))}
          <MenuSep />
          <MenuItem icon={<Icon name="Add" size="sm" />} label="添加云环境…" onClick={() => { setOpen(false); setEditing("new"); }} />
        </Popover>
        {picked && (
          <p className="env-footnote">
            变量、网络访问和设置脚本是 {picked.label} 的一部分。<button type="button" className="env-inline-link" onClick={() => setEditing(picked.id)}>编辑</button>
          </p>
        )}
        {environmentId && environments && !picked && <p className="env-footnote env-error">此环境已不存在，可能已删除。</p>}
      </div>
      {picked?.repo && (
        <div className="env-field" role="group" aria-label="代码仓库">
          <div className="env-label-row"><span className="env-label">代码仓库</span></div>
          <div className="env-places">
            <ul role="list">
              <li className="env-place">
                <div className="env-place-line">
                  <Icon name="GitBranch" size="sm" className="env-place-icon" />
                  <span className="env-place-name" dir="ltr">{picked.repoName ?? picked.repo}</span>
                  <span className="env-place-end">
                    <CloudBranchMenu repo={picked.repo} defaultBranch={picked.defaultBranch} value={branch} onChange={(next) => onChange({ branch: next })} />
                  </span>
                </div>
              </li>
            </ul>
          </div>
        </div>
      )}
      {editing && (
        <CloudEnvironmentDialog
          environmentId={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={(env) => { if (editing === "new") onChange({ environmentId: env.id, branch: "" }); }}
        />
      )}
    </>
  );
}

/** The task branch: the repository's default unless another is picked (cd8823d73 Ye's rows, searched on GitHub). */
function CloudBranchMenu({ repo, defaultBranch, value, onChange }: { repo: string; defaultBranch: string | null; value: string; onChange(branch: string): void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [branches, setBranches] = useState<string[] | null>(null);
  const [failed, setFailed] = useState(false);
  const attempt = useRef(0);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!open) return;
    const id = ++attempt.current;
    setFailed(false);
    const timer = setTimeout(() => {
      cloudBranches(repo, query).then((list) => id === attempt.current && setBranches(list), () => id === attempt.current && setFailed(true));
    }, query ? 250 : 0);
    return () => clearTimeout(timer);
  }, [open, query, repo, retry]);
  const fallback = defaultBranch ?? "main";
  const choose = (branch: string) => {
    setOpen(false);
    setQuery("");
    onChange(branch === fallback ? "" : branch);
  };
  const q = query.trim().toLowerCase();
  const rows = [...(fallback.toLowerCase().includes(q) ? [fallback] : []), ...(branches ?? []).filter((branch) => branch !== fallback)];
  const trigger = (
    <Button variant="ghost" size="xs" className="env-branch" onClick={() => setOpen(!open)}>
      <span className="sr-only">分支：</span>
      <span className="env-branch-text"><span className="env-branch-name">{value || fallback}</span>{!value && <span>默认</span>}</span>
    </Button>
  );
  return (
    <Popover open={open} onClose={() => { setOpen(false); setQuery(""); }} placement="bottom-end" className="menu-env-branch" anchor={trigger}>
      <MenuSearch label="搜索分支…" value={query} onChange={setQuery} onSubmit={() => rows[0] && choose(rows[0])} />
      {failed ? <div className="menu-none">无法加载分支。<button type="button" className="env-inline-link" onClick={() => setRetry((n) => n + 1)}>重试</button></div>
        : branches === null && !rows.length ? <div className="menu-none">正在加载分支…</div>
        : !rows.length ? <div className="menu-none">没有匹配的分支</div>
        : rows.map((branch) => (
          <MenuItem key={branch} label={<span className="env-branch-name">{branch}</span>} value={branch === fallback ? "默认" : undefined} checked={(value || fallback) === branch} onClick={() => choose(branch)} />
        ))}
    </Popover>
  );
}
