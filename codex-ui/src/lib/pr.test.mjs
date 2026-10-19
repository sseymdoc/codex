// Run with `pnpm test` (Node >= 22.18 strips the TypeScript types of pr.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { composePrUrl, createPrAsk, createdPrs, githubRemote, parsePr, parsePrView, prIdentity, prViewCommand, promptLabel, withoutPrTags } from "./pr.ts";

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
  const fields = "number,url,state,isDraft,title,reviewDecision,mergeable,mergeStateStatus,statusCheckRollup";
  assert.deepEqual(prViewCommand("feat/rail", "github.com/openai/codex"), ["gh", "pr", "view", "--json", fields, "--repo", "github.com/openai/codex", "--", "feat/rail"]);
  assert.deepEqual(prViewCommand("https://github.com/openai/codex/pull/7"), ["gh", "pr", "view", "--json", fields, "--", "https://github.com/openai/codex/pull/7"]);
  assert.deepEqual(prViewCommand("--web", "github.com/o/r").slice(-2), ["--", "--web"]);
});

test("gh's JSON gives the PR's state, its review or conflicts, and its title", () => {
  const view = (fields) => parsePrView(JSON.stringify({ url: "https://github.com/openai/codex/pull/7", title: "统一按钮圆角", state: "OPEN", isDraft: false, ...fields }));
  assert.deepEqual(
    { ...view({}), ci: undefined },
    { url: "https://github.com/openai/codex/pull/7", title: "统一按钮圆角", state: "open", look: "open", ci: undefined },
  );
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
  assert.deepEqual(ci(undefined), { status: "unavailable", total: 0, passed: 0, failed: 0, pending: 0 });
  // A re-run's newer pass stands for the older failure.
  assert.deepEqual(ci([run("test", "FAILURE"), run("test", "SUCCESS", "2026-10-19T11:00:00Z"), status("vercel", "SUCCESS")]), { status: "passed", total: 2, passed: 2, failed: 0, pending: 0 });
  assert.equal(ci([run("test", "SUCCESS"), run("lint", ""), status("deploy", "PENDING")]).status, "pending");
  assert.deepEqual(ci([run("test", "SUCCESS"), run("lint", "TIMED_OUT"), status("deploy", "ERROR"), run("build", "")]), { status: "failed", total: 4, passed: 1, failed: 2, pending: 1 });
  assert.equal(ci([run("test", "SKIPPED"), run("docs", "CANCELLED")]).status, "skipped");
  assert.equal(ci([run("test", "NEUTRAL"), run("lint", "SUCCESS")]).status, "passed");
  // The same check name in two workflows is two checks.
  assert.equal(ci([run("test", "FAILURE", undefined, "A"), run("test", "SUCCESS", "2026-10-19T11:00:00Z", "B")]).status, "failed");
});
