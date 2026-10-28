// Pull requests as Claude's PR bar sees them: the create-pr ask a local session is sent (c7d4a4512
// fn, shown as /create-pr: mn), the <pr-created> tag it answers with (hn / bn), a GitHub remote
// and its compare page (shared-52 Qs / Ps), the key Codex desktop gives a pull_request
// attachment (webview bb), so both apps keep one attachment per PR, and a PR's state, title and
// CI as gh reads them (Claude's main process asks GitHub's REST API with gh's token).

const COMMAND = "create-pr-command";
const DRAFT = "`gh pr create --draft`";
const CREATED = /<pr-created>\s*(https?:\/\/\S+?)\s*<\/pr-created>/gi;

/**
 * What Claude's Create PR / Create draft PR sends a local session (fn with un), word for word.
 * Codex does not know the base branch, so the target names none and gh infers it.
 */
export function createPrAsk({ repo, branch, cwd, draft }: { repo: string; branch: string; cwd: string; draft: boolean }): string {
  const open = draft
    ? `Open the PR as a draft with ${DRAFT}. The user chose “Create draft PR” for this request, so keep \`--draft\` even if you would otherwise open it ready for review.`
    : "Open the PR with `gh pr create`. Do not pass `--draft`: the user chose “Create PR”, not “Create draft PR”, for this request, and that explicit choice overrides any saved memory, standing instruction, or earlier plan to open it as a draft.";
  return [
    `<${COMMAND}>`,
    "## Overview",
    "",
    `Create a pull request for the changes in this session, ${draft ? "as a draft" : "ready for review (not a draft)"}.`,
    "",
    "## Steps",
    "",
    "1. Check for uncommitted changes. If any exist, stage and commit them with a message that describes what changed and why.",
    "2. Push the branch to the remote.",
    `3. ${open} When the target below names a base branch and that branch exists on origin (\`git ls-remote --heads origin <base>\`), pass it with \`--base\`; otherwise leave \`--base\` off and let gh infer it. Write a title that summarizes the change and a body that covers what changed, why, and anything a reviewer should know. If the repo has a PR template, follow it.`,
    "4. Report the PR URL when done. Wrap the URL in a `<pr-created>` tag on its own line so the UI can render a live status card, like this: `<pr-created>https://github.com/owner/repo/pull/123</pr-created>`",
    "",
    "If a PR already exists for this branch, push any new commits and report the existing URL wrapped in the same `<pr-created>` tag instead of creating a duplicate, and leave that PR's draft or ready state as it is.",
    "",
    "## Target",
    "",
    `Repository: ${repo}`,
    `Branch: ${branch}`,
    `Working directory: ${cwd}`,
    `</${COMMAND}>`,
  ].join("\n");
}

/** A sent create-pr ask reads as the command it stands for (mn); any other prompt as itself. */
export function promptLabel(text: string): string {
  const open = `<${COMMAND}>`;
  const close = `</${COMMAND}>`;
  const trimmed = text.trim();
  const inner = trimmed.slice(open.length, -close.length);
  if (!trimmed.startsWith(open) || !trimmed.endsWith(close) || inner.includes(open) || inner.includes(close)) return text;
  return trimmed.includes(DRAFT) ? "/create-pr --draft" : "/create-pr";
}

/** The agent's text with each <pr-created> tag down to its link (bn). */
export const withoutPrTags = (text: string): string => text.replace(CREATED, "$1");

/** The links the agent reported in <pr-created> tags. */
export const createdPrs = (text: string): string[] => [...text.matchAll(CREATED)].map((match) => match[1]);

export interface PullRequestLink {
  /** As Codex desktop stores it (webview mb). */
  url: string;
  host: string;
  owner: string;
  repo: string;
  number: number;
}

/** A GitHub pull request link (c7d4a4512 yn), https only. */
export function parsePr(url: string): PullRequestLink | null {
  const match = /^https:\/\/([^/\s?#]+)\/([^/\s?#]+)\/([^/\s?#]+)\/pull\/(\d+)(?![\w])/.exec(url);
  if (!match) return null;
  const [, rawHost, owner, repo, number] = match;
  const host = rawHost.toLowerCase().replace(/\.+$/, "");
  return { url: `https://${host}/${owner}/${repo}/pull/${number}`, host, owner, repo, number: Number(number) };
}

/** A pull_request attachment's identityKey, as Codex desktop writes it (webview bb). */
export const prIdentity = (pr: PullRequestLink): string => JSON.stringify([pr.host, pr.owner.toLowerCase(), pr.repo.toLowerCase(), pr.number]);

/** A PR's state as Claude's rows name it (shared-18 Vs); a queued one is open in a merge queue (`queued`). */
export type PrState = "open" | "draft" | "merged" | "closed";
/** The branch's own PR as Claude's row draws it (shared-18 IT): an open one by its queue, its review or its conflicts. */
export type PrLook = PrState | "approved" | "changesRequested" | "conflicting" | "queued";
/** CI as Claude's PR row reads it (c96d752d0 mB). */
export type CiStatus = "failed" | "passed" | "pending" | "skipped" | "unavailable";

/** Its checks counted (c5da7eb42 Wd): cancelled ones count in the total only. */
export interface Ci {
  status: CiStatus;
  total: number;
  passed: number;
  failed: number;
  pending: number;
  /** Skipped and neutral ones. */
  skipped: number;
}

export interface PrStatus {
  url: string;
  title: string;
  state: PrState;
  look: PrLook;
  ci: Ci;
  /** The head commit 合并 holds GitHub to (--match-head-commit). */
  headSha: string | null;
  baseRef: string | null;
  /** GitHub's mergeStateStatus: BLOCKED, BEHIND, CLEAN … */
  mergeState: string | null;
  conflicting: boolean;
  approved: boolean;
  autoMerge: boolean;
  /** In a merge queue; from the GraphQL read (prExtraCommand), so unknown until it answers. */
  queued?: boolean;
  /** Review threads still open, from the same read. */
  openThreads?: number;
}

/** What a PR row reads: gh pr view's JSON, the fields Codex desktop's main process asks gh for, and what merging needs. */
const VIEW_FIELDS = "number,url,state,isDraft,title,reviewDecision,mergeable,mergeStateStatus,statusCheckRollup,headRefOid,baseRefName,autoMergeRequest";

/**
 * gh pr view for a PR link, or for a branch of `repo` (host/owner/name): the open PR on that
 * head branch, else its newest. Given --repo and a selector gh reads no git config, so the
 * checkout's own config runs nothing; the selector comes after --, never read as a flag.
 */
export const prViewCommand = (selector: string, repo?: string): string[] => ["gh", "pr", "view", "--json", VIEW_FIELDS, ...(repo ? ["--repo", repo] : []), "--", selector];

interface GhCheck {
  __typename?: string;
  name?: string;
  workflowName?: string;
  event?: string;
  context?: string;
  conclusion?: string;
  state?: string;
  startedAt?: string;
}

/** A check run's conclusion (main-process xEa) or a commit status's state (SEa) as a bucket. */
function bucket(check: GhCheck): "pass" | "fail" | "pending" | "skip" | "other" {
  const value = (check.__typename === "StatusContext" ? check.state : check.conclusion)?.toUpperCase() ?? "";
  if (value === "SUCCESS") return "pass";
  if (["FAILURE", "ERROR", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE"].includes(value)) return "fail";
  if (check.__typename === "StatusContext") return "pending";
  return value === "SKIPPED" || value === "NEUTRAL" ? "skip" : value === "CANCELLED" ? "other" : "pending";
}

/** The rollup's checks, a re-run's older runs dropped as gh pr checks drops them, counted and read as Claude's mB reads its counts. */
function ciOf(rollup: unknown): Ci {
  const latest = new Map<string, GhCheck>();
  for (const check of Array.isArray(rollup) ? (rollup as GhCheck[]) : []) {
    if (!check || typeof check !== "object") continue;
    const key = check.__typename === "StatusContext" ? `status\0${check.context}` : `run\0${check.workflowName ?? ""}\0${check.name}\0${check.event ?? ""}`;
    const seen = latest.get(key);
    if (!seen || (check.startedAt ?? "") > (seen.startedAt ?? "")) latest.set(key, check);
  }
  const counts = { total: latest.size, passed: 0, failed: 0, pending: 0, skipped: 0 };
  for (const check of latest.values()) {
    const kind = bucket(check);
    if (kind === "pass") counts.passed += 1;
    else if (kind === "fail") counts.failed += 1;
    else if (kind === "pending") counts.pending += 1;
    else if (kind === "skip") counts.skipped += 1;
  }
  const { total, passed, failed, pending } = counts;
  const status: CiStatus = total === 0 ? "unavailable" : failed > 0 ? "failed" : pending > 0 ? "pending" : passed > 0 ? "passed" : "skipped";
  return { status, ...counts };
}

/** gh pr view's JSON as the row reads it, or null for anything else. */
export function parsePrView(json: string): PrStatus | null {
  let pr: {
    url?: unknown;
    title?: unknown;
    state?: unknown;
    isDraft?: unknown;
    reviewDecision?: unknown;
    mergeable?: unknown;
    mergeStateStatus?: unknown;
    statusCheckRollup?: unknown;
    headRefOid?: unknown;
    baseRefName?: unknown;
    autoMergeRequest?: unknown;
  };
  try {
    pr = JSON.parse(json);
  } catch {
    return null;
  }
  const link = typeof pr?.url === "string" ? parsePr(pr.url) : null;
  const state: PrState | null = pr?.state === "MERGED" ? "merged" : pr?.state === "CLOSED" ? "closed" : pr?.state === "OPEN" ? (pr.isDraft === true ? "draft" : "open") : null;
  if (!link || !state) return null;
  const conflicting = pr.mergeable === "CONFLICTING" || pr.mergeStateStatus === "DIRTY";
  const look: PrLook =
    state !== "open" ? state : pr.reviewDecision === "CHANGES_REQUESTED" ? "changesRequested" : conflicting ? "conflicting" : pr.reviewDecision === "APPROVED" ? "approved" : "open";
  const text = (value: unknown) => (typeof value === "string" && value ? value : null);
  return {
    url: link.url,
    title: typeof pr.title === "string" ? pr.title : "",
    state,
    look,
    ci: ciOf(pr.statusCheckRollup),
    headSha: text(pr.headRefOid),
    baseRef: text(pr.baseRefName),
    mergeState: text(pr.mergeStateStatus),
    conflicting,
    approved: pr.reviewDecision === "APPROVED",
    autoMerge: !!pr.autoMergeRequest,
  };
}

const EXTRA = "query($owner:String!,$repo:String!,$number:Int!){repository(owner:$owner,name:$repo){pullRequest(number:$number){isInMergeQueue reviewThreads(first:100){nodes{isResolved}}}}}";

/** What gh pr view leaves out (cb1afaa4b review threads, ca6174065 isInMergeQueue): one GraphQL read. */
export const prExtraCommand = (pr: PullRequestLink): string[] => [
  "gh",
  "api",
  "graphql",
  "--hostname",
  pr.host,
  "-f",
  `query=${EXTRA}`,
  "-F",
  `owner=${pr.owner}`,
  "-F",
  `repo=${pr.repo}`,
  "-F",
  `number=${pr.number}`,
];

export function parsePrExtra(json: string): { queued: boolean; openThreads: number } | null {
  try {
    const pr = JSON.parse(json)?.data?.repository?.pullRequest;
    if (!pr) return null;
    const threads: unknown[] = Array.isArray(pr.reviewThreads?.nodes) ? pr.reviewThreads.nodes : [];
    return { queued: pr.isInMergeQueue === true, openThreads: threads.filter((thread) => !(thread as { isResolved?: boolean })?.isResolved).length };
  } catch {
    return null;
  }
}

/** The branch's other PRs, open or not (ca6174065 history: 较早的拉取请求). */
export const prHistoryCommand = (repo: string, branch: string): string[] => ["gh", "pr", "list", "--repo", repo, "--head", branch, "--state", "all", "--limit", "20", "--json", "number,url,state,isDraft,title"];

export function parsePrList(json: string): PrStatus[] {
  try {
    const list = JSON.parse(json);
    return Array.isArray(list) ? list.flatMap((item) => parsePrView(JSON.stringify(item)) ?? []) : [];
  } catch {
    return [];
  }
}

/** The way a merge goes: squash where the repository allows it (auto-merge uses it too, cf6ae6197), else a merge commit, else a rebase. */
export const mergeMethodCommand = (repo: string): string[] => ["gh", "repo", "view", repo, "--json", "squashMergeAllowed,mergeCommitAllowed,rebaseMergeAllowed"];

export function mergeMethod(json: string): "--squash" | "--merge" | "--rebase" {
  try {
    const allowed = JSON.parse(json);
    return allowed?.squashMergeAllowed !== false ? "--squash" : allowed?.mergeCommitAllowed !== false ? "--merge" : "--rebase";
  } catch {
    return "--squash";
  }
}

/** 确认合并 (ca6174065 ia): only the head it was checked at. */
export const mergeCommand = (url: string, method: string, sha: string): string[] => ["gh", "pr", "merge", url, method, "--match-head-commit", sha];
/** 就绪时自动合并 on or off. */
export const autoMergeCommand = (url: string, on: boolean, method: string): string[] => (on ? ["gh", "pr", "merge", url, "--auto", method] : ["gh", "pr", "merge", url, "--disable-auto"]);
/** 标记为就绪, or 转为草稿 (undo). */
export const readyCommand = (url: string, undo: boolean): string[] => ["gh", "pr", "ready", url, ...(undo ? ["--undo"] : [])];

/** Where 合并 shows (ca6174065 kr "merge"): open, approved, checks passed, mergeable, not set to merge on its own and not queued. */
export const canMerge = (pr: PrStatus): boolean =>
  pr.state === "open" && pr.approved && !pr.conflicting && pr.ci.status === "passed" && !pr.autoMerge && !pr.queued;

/**
 * Why a merge the user asked for stops after the PR is read again (ca6174065 ra): it changed (no
 * longer mergeable or a new head), it is set to merge on its own, GitHub blocks it or it is behind
 * its base; null when it can go.
 */
export function mergeBlock(pr: PrStatus, shownSha: string | null): string | null {
  if (pr.autoMerge) return "已设置为就绪时合并。";
  if (!canMerge(pr) || (shownSha !== null && pr.headSha !== shownSha) || !pr.headSha) return "拉取请求已变更。请在合并前查看变更内容。";
  if (pr.mergeState === "BLOCKED") return "GitHub 已阻止此次合并。查看该拉取请求还需满足的条件。";
  if (pr.mergeState === "BEHIND") return pr.baseRef ? `此分支落后于 ${pr.baseRef}。请先更新再合并。` : "此分支落后于其基础分支。请在合并前更新。";
  return null;
}

/** What went wrong with gh (ca6174065 Go / Xr), read from what it printed. */
export type GhProblem = { kind: "notInstalled" | "auth" | "sso" | "rateLimit" | "network" } | { kind: "unknown"; detail: string };

/** Nothing went wrong but there is nothing to read: a branch without a PR. */
const NOTHING = /no (?:pull requests|open pull requests) found/i;

export function ghProblem(stderr: string, missing = false): GhProblem | null {
  if (missing) return { kind: "notInstalled" };
  if (NOTHING.test(stderr)) return null;
  if (/gh auth login|not logged in|authentication required|HTTP 401|bad credentials/i.test(stderr)) return { kind: "auth" };
  if (/SAML|single sign-on|SSO/i.test(stderr)) return { kind: "sso" };
  if (/rate limit/i.test(stderr)) return { kind: "rateLimit" };
  if (/could not resolve host|connection (?:refused|reset|timed out)|network is unreachable|dial tcp|i\/o timeout|TLS handshake/i.test(stderr)) return { kind: "network" };
  const detail = stderr.trim().split("\n")[0] ?? "";
  return detail ? { kind: "unknown", detail } : null;
}

/** A gh problem as the row's warning says it (ca6174065 Xr, c10b46121 SSO). */
export function ghProblemText(problem: GhProblem): string {
  switch (problem.kind) {
    case "notInstalled":
      return "未安装 GitHub CLI（gh）。";
    case "auth":
      return "请运行 gh auth login 进行身份验证。";
    case "sso":
      return "需要 GitHub SSO 授权";
    case "rateLimit":
      return "已达到 GitHub 速率限制，正在自动重试。";
    case "network":
      return "无法连接到 GitHub，请检查您的网络连接。";
    case "unknown":
      return problem.detail;
  }
}

/** The order PR rows go in (ca6174065 Ai / Oi): the branch's open PR, then by what needs the user most. */
export function prRank(pr: PrStatus | undefined, primary: boolean): number {
  const live = pr && pr.look !== "queued" && pr.state !== "merged" && pr.state !== "closed";
  if (primary && (live || !pr)) return 0;
  if (!pr) return 6;
  if (pr.look !== "changesRequested" && live && pr.ci.status === "failed") return 2;
  return { changesRequested: 1, conflicting: 3, open: 4, approved: 4, draft: 5, queued: 7, merged: 8, closed: 9 }[pr.look];
}

/**
 * The GitHub repository an origin URL points at (shared-52 Qs: scp-like, ssh or http(s)), or
 * null for another forge: Claude's PR bar is GitHub's.
 * ponytail: GitHub by the host's name; Claude also knows configured GitHub Enterprise hosts.
 */
export function githubRemote(origin: string | null | undefined): { host: string; repo: string } | null {
  const match = /^(?:[a-z][\w+.-]*:\/\/)?(?:[^@/\s]+@)?([^/:\s]+)(?::\d+)?[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/i.exec(origin?.trim() ?? "");
  return match && /github/i.test(match[1]) ? { host: match[1].toLowerCase(), repo: match[2] } : null;
}

/**
 * Manually create PR (OL compose, shared-52 Ps): GitHub's compare page for the branch. A local
 * session leaves the base out (DL), so GitHub compares against the default branch.
 */
export const composePrUrl = (remote: { host: string; repo: string }, branch: string): string =>
  `https://${remote.host}/${remote.repo}/compare/${encodeURIComponent(branch)}?quick_pull=1`;
