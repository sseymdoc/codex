// Run with `pnpm test` (Node >= 22.18 strips the TypeScript types of pr.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { composePrUrl, createPrAsk, createdPrs, githubRemote, parsePr, prIdentity, promptLabel, withoutPrTags } from "./pr.ts";

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
