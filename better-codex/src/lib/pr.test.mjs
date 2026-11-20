// Run with `pnpm test` (Node >= 22.18 strips the TypeScript types of pr.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { autoMergeCommand, canMerge, monitorChange, composePrUrl, createdPrs, createPrAsk, ghProblem, ghProblemText, githubRemote, mergeBlock, mergeCommand, mergeMethod, parsePr, parsePrExtra, parsePrList, parsePrView, prExtraCommand, prIdentity, promptLabel, prRank, prViewCommand, readyCommand, withoutPrTags } from "./pr.ts";

test("the create-pr ask names the target and reads as /create-pr in the transcript", () => {
  const ask = createPrAsk({ repo: "openai/codex", branch: "feat/rail", cwd: "D:\\work\\codex", draft: false });
  assert.ok(ask.startsWith("<create-pr-command>\n## Overview\n\nCreate a pull request for the changes in this session, ready for review (not a draft)."));
  assert.ok(ask.endsWith("## Target\n\nRepository: openai/codex\nBranch: feat/rail\nWorking directory: D:\\work\\codex\n</create-pr-command>"));
  assert.equal(promptLabel(ask), "/create-pr");
  const draft = createPrAsk({ repo: "openai/codex", branch: "feat/rail", cwd: "/w", draft: true });
  assert.ok(draft.includes("as a draft.") && draft.includes("Open the PR as a draft with `gh pr create --draft`."));
  assert.equal(promptLabel(`  ${draft}\n`), "/create-pr --draft");
  assert.equal(promptLabel("Commit the working tree changes with a sensible message."), "Commit the working tree changes with a sensible message.");
  assert.equal(promptLabel("<create-pr-command>a<create-pr-command>b</create-pr-command>"), "<create-pr-command>a<create-pr-command>b</create-pr-command>");
});

test("<pr-created> tags give their links and drop out of the text", () => {
  const reply = "Opened it.\n<pr-created> https://github.com/openai/codex/pull/42 </pr-created>\nAnd <PR-CREATED>https://github.com/openai/codex/pull/7</PR-CREATED>";
  assert.deepEqual(createdPrs(reply), ["https://github.com/openai/codex/pull/42", "https://github.com/openai/codex/pull/7"]);
  assert.equal(withoutPrTags(reply), "Opened it.\nhttps://github.com/openai/codex/pull/42\nAnd https://github.com/openai/codex/pull/7");
  assert.deepEqual(createdPrs("no tags here"), []);
});

test("a PR link keys its attachment as Codex desktop does", () => {
  const pr = parsePr("https://GitHub.com/OpenAI/Codex/pull/123/files");
  assert.deepEqual(pr, { url: "https://github.com/OpenAI/Codex/pull/123", host: "github.com", owner: "OpenAI", repo: "Codex", number: 123 });
  assert.equal(prIdentity(pr), '["github.com","openai","codex",123]');
  assert.equal(parsePr("http://github.com/o/r/pull/1"), null);
  assert.equal(parsePr("https://gitlab.com/o/r/-/merge_requests/1"), null);
  assert.equal(parsePr("https://github.com/o/r/pull/12abc"), null);
});

test("GitHub remotes in each URL form, and their compare page", () => {
  for (const origin of ["https://github.com/openai/codex.git", "git@github.com:openai/codex.git", "ssh://git@github.com:22/openai/codex", "https://user:token@github.com/openai/codex/"]) {
    assert.deepEqual(githubRemote(origin), { host: "github.com", repo: "openai/codex" }, origin);
  }
  assert.deepEqual(githubRemote("git@github.mycorp.com:team/app.git"), { host: "github.mycorp.com", repo: "team/app" });
  assert.equal(githubRemote("https://gitlab.example.com/team/app.git"), null);
  assert.equal(githubRemote(null), null);
  assert.equal(composePrUrl({ host: "github.com", repo: "openai/codex" }, "feat/rail prs"), "https://github.com/openai/codex/compare/feat%2Frail%20prs?quick_pull=1");
});

test("gh pr view asks for a branch of the remote's repository, or a link alone", () => {
  const fields = "number,url,state,isDraft,title,reviewDecision,mergeable,mergeStateStatus,statusCheckRollup,headRefOid,headRefName,baseRefName,autoMergeRequest";
  assert.deepEqual(prViewCommand("feat/rail", "github.com/openai/codex"), ["gh", "pr", "view", "--json", fields, "--repo", "github.com/openai/codex", "--", "feat/rail"]);
  assert.deepEqual(prViewCommand("https://github.com/openai/codex/pull/7"), ["gh", "pr", "view", "--json", fields, "--", "https://github.com/openai/codex/pull/7"]);
  assert.deepEqual(prViewCommand("--web", "github.com/o/r").slice(-2), ["--", "--web"]);
});

test("gh's JSON gives the PR's state, its review or conflicts, and its title", () => {
  const view = (fields) => parsePrView(JSON.stringify({ url: "https://github.com/openai/codex/pull/7", title: "统一按钮圆角", state: "OPEN", isDraft: false, ...fields }));
  assert.deepEqual(
    { ...view({ headRefOid: "abc123", headRefName: "feat/x", baseRefName: "main", mergeStateStatus: "CLEAN", reviewDecision: "REVIEW_REQUIRED" }), ci: undefined },
    {
      url: "https://github.com/openai/codex/pull/7",
      title: "统一按钮圆角",
      state: "open",
      look: "open",
      ci: undefined,
      headSha: "abc123",
      headRef: "feat/x",
      baseRef: "main",
      mergeState: "CLEAN",
      conflicting: false,
      approved: false,
      review: "review_required",
      autoMerge: false,
    },
  );
  assert.equal(view({ autoMergeRequest: { enabledAt: "2026-10-28T00:00:00Z" } }).autoMerge, true);
  assert.equal(view({ isDraft: true, reviewDecision: "APPROVED" }).look, "draft");
  assert.equal(view({ state: "MERGED", isDraft: false }).state, "merged");
  assert.equal(view({ state: "CLOSED" }).look, "closed");
  assert.equal(view({ reviewDecision: "APPROVED" }).look, "approved");
  assert.equal(view({ reviewDecision: "CHANGES_REQUESTED", mergeable: "CONFLICTING" }).look, "changesRequested");
  assert.equal(view({ reviewDecision: "APPROVED", mergeStateStatus: "DIRTY" }).look, "conflicting");
  assert.equal(parsePrView("To get started with GitHub CLI, please run:  gh auth login"), null);
  assert.equal(parsePrView(JSON.stringify({ url: "http://github.com/o/r/pull/1", state: "OPEN" })), null);
  assert.equal(parsePrView(JSON.stringify({ url: "https://github.com/o/r/pull/1", state: "QUEUED" })), null);
});

test("CI counts each check's newest run and reads as Claude's row does", () => {
  const ci = (statusCheckRollup) => parsePrView(JSON.stringify({ url: "https://github.com/o/r/pull/1", state: "OPEN", statusCheckRollup })).ci;
  const run = (name, conclusion, startedAt = "2026-10-19T10:00:00Z", workflowName = "CI") => ({ __typename: "CheckRun", name, workflowName, status: conclusion ? "COMPLETED" : "IN_PROGRESS", conclusion, startedAt });
  const status = (context, state) => ({ __typename: "StatusContext", context, state, startedAt: "2026-10-19T10:00:00Z" });
  assert.deepEqual(ci(undefined), { status: "unavailable", total: 0, passed: 0, failed: 0, pending: 0, skipped: 0, failing: [] });
  // A re-run's newer pass stands for the older failure.
  assert.deepEqual(ci([run("test", "FAILURE"), run("test", "SUCCESS", "2026-10-19T11:00:00Z"), status("vercel", "SUCCESS")]), { status: "passed", total: 2, passed: 2, failed: 0, pending: 0, skipped: 0, failing: [] });
  assert.equal(ci([run("test", "SUCCESS"), run("lint", ""), status("deploy", "PENDING")]).status, "pending");
  assert.deepEqual(ci([run("test", "SUCCESS"), run("lint", "TIMED_OUT"), status("deploy", "ERROR"), run("build", "")]), { status: "failed", total: 4, passed: 1, failed: 2, pending: 1, skipped: 0, failing: ["CI / lint", "deploy"] });
  assert.equal(ci([run("test", "SKIPPED"), run("docs", "CANCELLED")]).status, "skipped");
  assert.deepEqual(ci([run("test", "SKIPPED"), run("docs", "CANCELLED")]), { status: "skipped", total: 2, passed: 0, failed: 0, pending: 0, skipped: 1, failing: [] });
  assert.equal(ci([run("test", "NEUTRAL"), run("lint", "SUCCESS")]).status, "passed");
  // The same check name in two workflows is two checks.
  assert.equal(ci([run("test", "FAILURE", undefined, "A"), run("test", "SUCCESS", "2026-10-19T11:00:00Z", "B")]).status, "failed");
});

test("merging asks GitHub to hold the checked head, by the repository's allowed way", () => {
  const url = "https://github.com/o/r/pull/7";
  assert.deepEqual(mergeCommand(url, "--squash", "abc"), ["gh", "pr", "merge", url, "--squash", "--match-head-commit", "abc"]);
  assert.equal(mergeMethod(JSON.stringify({ squashMergeAllowed: true, mergeCommitAllowed: true })), "--squash");
  assert.equal(mergeMethod(JSON.stringify({ squashMergeAllowed: false, mergeCommitAllowed: true })), "--merge");
  assert.equal(mergeMethod(JSON.stringify({ squashMergeAllowed: false, mergeCommitAllowed: false, rebaseMergeAllowed: true })), "--rebase");
  assert.deepEqual(autoMergeCommand(url, true, "--merge"), ["gh", "pr", "merge", url, "--auto", "--merge"]);
  assert.deepEqual(autoMergeCommand(url, false, "--merge"), ["gh", "pr", "merge", url, "--disable-auto"]);
  assert.deepEqual(readyCommand(url, true), ["gh", "pr", "ready", url, "--undo"]);
});

test("合并 shows for an approved, passing, mergeable PR and stops when it changed", () => {
  const pr = (fields) => ({ ...parsePrView(JSON.stringify({ url: "https://github.com/o/r/pull/7", state: "OPEN", reviewDecision: "APPROVED", mergeable: "MERGEABLE", headRefOid: "abc", baseRefName: "main", mergeStateStatus: "CLEAN", statusCheckRollup: [{ __typename: "CheckRun", name: "t", conclusion: "SUCCESS" }] })), ...fields });
  assert.equal(canMerge(pr({})), true);
  assert.equal(canMerge(pr({ autoMerge: true })), false);
  assert.equal(canMerge(pr({ queued: true })), false);
  assert.equal(canMerge(pr({ approved: false })), false);
  assert.equal(mergeBlock(pr({}), "abc"), null);
  assert.equal(mergeBlock(pr({ headSha: "def" }), "abc"), "拉取请求已变更。请在合并前查看变更内容。");
  assert.equal(mergeBlock(pr({ autoMerge: true }), "abc"), "已设置为就绪时合并。");
  assert.equal(mergeBlock(pr({ mergeState: "BLOCKED" }), "abc"), "GitHub 已阻止此次合并。查看该拉取请求还需满足的条件。");
  assert.equal(mergeBlock(pr({ mergeState: "BEHIND" }), "abc"), "此分支落后于 main。请先更新再合并。");
});

test("the GraphQL read gives the merge queue and the open review threads", () => {
  const link = parsePr("https://ghe.example.com/o/r/pull/7");
  const command = prExtraCommand(link);
  assert.deepEqual(command.slice(0, 5), ["gh", "api", "graphql", "--hostname", "ghe.example.com"]);
  assert.ok(command.includes("number=7") && command.includes("owner=o") && command.includes("repo=r"));
  const answer = { data: { repository: { pullRequest: { isInMergeQueue: true, reviewThreads: { nodes: [{ isResolved: true }, { isResolved: false }, { isResolved: false }] } } } } };
  assert.deepEqual(parsePrExtra(JSON.stringify(answer)), { queued: true, openThreads: 2, comments: [] });
  assert.equal(parsePrExtra("{}"), null);
  assert.equal(parsePrList(JSON.stringify([{ url: "https://github.com/o/r/pull/3", state: "MERGED", title: "旧" }, { bad: 1 }])).length, 1);
});

test("gh's output says what went wrong, and a branch without a PR is no problem", () => {
  assert.equal(ghProblem("no pull requests found for branch \"feat\""), null);
  assert.deepEqual(ghProblem("", true), { kind: "notInstalled" });
  assert.deepEqual(ghProblem("To get started with GitHub CLI, please run:  gh auth login"), { kind: "auth" });
  assert.deepEqual(ghProblem("GraphQL: Resource protected by organization SAML enforcement."), { kind: "sso" });
  assert.deepEqual(ghProblem("API rate limit exceeded for user"), { kind: "rateLimit" });
  assert.deepEqual(ghProblem("error connecting to api.github.com: dial tcp: lookup api.github.com"), { kind: "network" });
  assert.deepEqual(ghProblem("something odd\nmore"), { kind: "unknown", detail: "something odd" });
  assert.equal(ghProblemText({ kind: "auth" }), "请运行 gh auth login 进行身份验证。");
});

test("PR rows go by what needs the user most, the branch's open PR first", () => {
  const pr = (fields) => ({ ...parsePrView(JSON.stringify({ url: "https://github.com/o/r/pull/7", state: "OPEN" })), ...fields });
  assert.equal(prRank(pr({}), true), 0);
  assert.equal(prRank(pr({ state: "merged", look: "merged" }), true), 8);
  assert.equal(prRank(pr({ look: "changesRequested" }), false), 1);
  assert.equal(prRank(pr({ ci: { status: "failed" } }), false), 2);
  assert.equal(prRank(pr({ look: "draft", state: "draft" }), false), 5);
  assert.equal(prRank(undefined, false), 6);
});

test("the GraphQL read names others' review comments: each open thread's latest and commenting reviews", () => {
  const comment = (id, login) => ({ id, author: login === null ? null : { login } });
  const answer = { data: { viewer: { login: "me" }, repository: { pullRequest: { isInMergeQueue: false,
    reviewThreads: { nodes: [
      { isResolved: true, comments: { nodes: [comment("t1", "alice")] } },
      { isResolved: false, comments: { nodes: [comment("t2", "bob")] } },
      { isResolved: false, comments: { nodes: [comment("t3", "me")] } },
    ] },
    reviews: { nodes: [{ ...comment("r1", "carol"), state: "APPROVED" }, { ...comment("r2", "dave"), state: "CHANGES_REQUESTED" }, { ...comment("r3", null), state: "COMMENTED" }, { ...comment("r4", "me"), state: "COMMENTED" }] } } } } };
  assert.deepEqual(parsePrExtra(JSON.stringify(answer)), { queued: false, openThreads: 2, comments: [{ id: "t2", author: "bob" }, { id: "r2", author: "dave" }, { id: "r3", author: "ghost" }] });
});

test("auto-fix reports a failing head and a conflict once each, and new comments after the first read", () => {
  const status = (fields = {}) => ({ ...parsePrView(JSON.stringify({ url: "https://github.com/o/r/pull/7", title: "T", state: "OPEN", headRefOid: "abc", baseRefName: "main",
    statusCheckRollup: [{ __typename: "CheckRun", name: "test", workflowName: "CI", conclusion: "FAILURE" }, { __typename: "CheckRun", name: "lint", workflowName: "CI", conclusion: "SUCCESS" }] })), comments: [{ id: "c1", author: "alice" }], ...fields });
  const first = monitorChange({ fired: [], seen: null }, status());
  assert.deepEqual(first.parts, [{ kind: "ci", sha: "abc", failing: ["CI / test"], failed: 1, total: 2 }]);
  assert.deepEqual(first.fired, ["ci:abc"]);
  assert.deepEqual(first.seen, ["c1"], "comments already there are only noted");
  const again = monitorChange({ fired: first.fired, seen: first.seen }, status());
  assert.deepEqual(again.parts, []);
  const later = monitorChange({ fired: first.fired, seen: first.seen }, status({ headSha: "def", conflicting: true, comments: [{ id: "c1", author: "alice" }, { id: "c2", author: "bob" }, { id: "c3", author: "bob" }] }));
  assert.deepEqual(later.parts.map((part) => part.kind), ["ci", "conflict", "review"]);
  assert.deepEqual(later.parts[2], { kind: "review", authors: ["bob"], count: 2 });
  assert.deepEqual(later.fired, ["ci:abc", "ci:def", "conflict:def"]);
  const passing = monitorChange({ fired: [], seen: [] }, { ...status(), ci: { ...status().ci, status: "passed", failed: 0, failing: [] }, comments: undefined });
  assert.deepEqual(passing.parts, []);
  assert.deepEqual(passing.seen, [], "without the GraphQL read the seen comments stay");
  assert.equal(monitorChange({ fired: [], seen: [] }, status({ state: "merged" })).stop, true);
});
