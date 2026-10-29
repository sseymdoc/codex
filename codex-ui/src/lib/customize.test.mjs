// Run with `pnpm test` (Node >= 22.18 strips the TypeScript types of customize.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  customizeTarget,
  marketplaceActions,
  mcpEdits,
  mcpFormProblem,
  mcpFormToToml,
  mcpTomlToForm,
  newMcpServerKey,
  recommendedSkills,
  removableSkillDir,
  skillFrontmatter,
  emptyMcpForm,
} from "./customize.ts";

test("customizeTarget maps settings links to the section and view", () => {
  assert.deepEqual(customizeTarget("mcp"), { section: "connectors" });
  assert.deepEqual(customizeTarget("plugins", "setting-plugins-marketplaces"), { section: "plugins", view: "mine" });
  assert.deepEqual(customizeTarget("connectors", "setting-connectors-tabs"), { section: "connectors", view: "discover" });
  assert.deepEqual(customizeTarget("skills", "setting-skills-roots"), { section: "skills", view: "mine" });
  assert.deepEqual(customizeTarget("hooks"), { section: "hooks" });
});

test("newMcpServerKey follows the Codex app's Sa", () => {
  assert.equal(newMcpServerKey("My  Server!!", []), "my_server-");
  assert.equal(newMcpServerKey("  GitHub (work) ", []), "github_-work-");
  assert.equal(newMcpServerKey("!!!", []), "-");
  assert.equal(newMcpServerKey("   ", []), "custom-server");
  assert.equal(newMcpServerKey("Docs", ["docs", "docs-2"]), "docs-3");
});

test("mcpFormToToml writes only the transport's non-empty fields", () => {
  const stdio = { ...emptyMcpForm("stdio"), command: " npx ", args: "-y\n\n@scope/server ", env: "A=1\nB = two=2\n", envVars: "PATH\n", url: "https://ignored" };
  assert.deepEqual(mcpFormToToml(stdio), { command: "npx", args: ["-y", "@scope/server"], env: { A: "1", B: "two=2" }, env_vars: ["PATH"] });
  const http = { ...emptyMcpForm("http"), url: "https://mcp.example.com/mcp", headers: "X-Team: core\n", command: "ignored", args: "x" };
  assert.deepEqual(mcpFormToToml(http), { url: "https://mcp.example.com/mcp", http_headers: { "X-Team": "core" } });
  // A passthrough variable keeps its object form.
  const kept = mcpFormToToml({ ...emptyMcpForm("stdio"), command: "x", envVars: "TOKEN\nHOME" }, { env_vars: [{ name: "TOKEN", source: "remote" }] });
  assert.deepEqual(kept.env_vars, [{ name: "TOKEN", source: "remote" }, "HOME"]);
});

test("mcpTomlToForm round-trips", () => {
  const table = { command: "node", args: ["a b", "c"], env: { K: "v" }, env_vars: ["X"], cwd: "/w" };
  assert.deepEqual(mcpFormToToml(mcpTomlToForm(table), table), table);
  const http = { url: "https://h", bearer_token_env_var: "TOK", http_headers: { A: "b" }, env_http_headers: { C: "D" } };
  assert.deepEqual(mcpFormToToml(mcpTomlToForm(http), http), http);
});

test("mcpEdits replaces a new table and writes only the changes of an existing one", () => {
  const form = { ...emptyMcpForm("stdio"), command: "node", args: "server.js" };
  assert.deepEqual(mcpEdits("my.server", undefined, form), [{ keyPath: 'mcp_servers."my.server"', value: { command: "node", args: ["server.js"] }, mergeStrategy: "replace" }]);
  const old = { command: "node", args: ["server.js"], env: { A: "1", B: "2" }, enabled: false, disabled_tools: ["x"] };
  const edited = { ...mcpTomlToForm(old), args: "", env: "A=1\nB=3\nC=4", cwd: "/w" };
  assert.deepEqual(mcpEdits("s", old, edited), [
    { keyPath: 'mcp_servers."s".args', value: null, mergeStrategy: "replace" },
    { keyPath: 'mcp_servers."s".env."B"', value: "3", mergeStrategy: "replace" },
    { keyPath: 'mcp_servers."s".env."C"', value: "4", mergeStrategy: "replace" },
    { keyPath: 'mcp_servers."s".cwd', value: "/w", mergeStrategy: "replace" },
  ]);
  // A removed variable is deleted key by key; nothing changed writes nothing.
  assert.deepEqual(mcpEdits("s", old, { ...mcpTomlToForm(old), env: "A=1" }), [{ keyPath: 'mcp_servers."s".env."B"', value: null, mergeStrategy: "replace" }]);
  assert.deepEqual(mcpEdits("s", old, mcpTomlToForm(old)), []);
  // Values the form cannot show as they are (a blank argument, padded values) stay unless their field is edited.
  const odd = { command: "node", args: ["server.js", "--token", ""], env: { A: " padded ", B: "2" } };
  assert.deepEqual(mcpEdits("s", odd, mcpTomlToForm(odd)), []);
  assert.deepEqual(mcpEdits("s", odd, { ...mcpTomlToForm(odd), cwd: "/w" }), [{ keyPath: 'mcp_servers."s".cwd', value: "/w", mergeStrategy: "replace" }]);
  assert.deepEqual(mcpEdits("s", odd, { ...mcpTomlToForm(odd), env: "A=padded\nB=3" }), [{ keyPath: 'mcp_servers."s".env."B"', value: "3", mergeStrategy: "replace" }]);
});

test("mcpFormProblem needs a command or an http(s) URL", () => {
  assert.equal(mcpFormProblem(emptyMcpForm("stdio")), "请填写启动命令。");
  assert.equal(mcpFormProblem({ ...emptyMcpForm("stdio"), command: "x" }), null);
  assert.equal(mcpFormProblem({ ...emptyMcpForm("http"), url: "ftp://x" }), "URL 格式无效");
  assert.equal(mcpFormProblem({ ...emptyMcpForm("http"), url: "https://x/mcp" }), null);
});

test("skillFrontmatter reads name and description", () => {
  assert.deepEqual(skillFrontmatter('---\nname: pdf\ndescription: "Read PDFs"\nlicense: MIT\n---\n# PDF'), { name: "pdf", description: "Read PDFs" });
  assert.deepEqual(skillFrontmatter("# no header"), {});
});

test("removableSkillDir allows only the user's own folders under <codexHome>/skills", () => {
  const home = "C:\\Users\\me\\.codex";
  assert.equal(removableSkillDir("C:\\Users\\me\\.codex\\skills\\pdf\\SKILL.md", home), "C:\\Users\\me\\.codex\\skills\\pdf");
  assert.equal(removableSkillDir("\\\\?\\C:\\Users\\Me\\.codex\\skills\\pdf\\SKILL.md", home), "\\\\?\\C:\\Users\\Me\\.codex\\skills\\pdf");
  assert.equal(removableSkillDir("C:\\Users\\me\\.codex\\skills\\.system\\skill-creator\\SKILL.md", home), null);
  assert.equal(removableSkillDir("C:\\Users\\me\\.codex\\skills\\SKILL.md", home), null);
  assert.equal(removableSkillDir("C:\\Users\\me\\.agents\\skills\\pdf\\SKILL.md", home), null);
  assert.equal(removableSkillDir("/home/me/.codex/skills/pdf/SKILL.md", "/home/me/.codex"), "/home/me/.codex/skills/pdf");
  assert.equal(removableSkillDir("/x/skills/pdf/SKILL.md", null), null);
});

test("recommendedSkills skips unreadable entries, prefers curated, sorts by name", () => {
  const list = recommendedSkills([
    { id: "zeta", path: "/c/zeta", experimental: false, text: "---\nname: Zeta\ndescription: z\n---" },
    { id: "alpha", path: "/e/alpha", experimental: true, text: "---\nname: Alpha X\n---" },
    { id: "alpha", path: "/c/alpha", experimental: false, text: "---\nname: Alpha\n---" },
    { id: "broken", path: "/c/broken", experimental: false, text: null },
    { id: ".git", path: "/c/.git", experimental: false, text: "" },
  ]);
  assert.deepEqual(
    list.map((skill) => [skill.id, skill.name, skill.path, skill.experimental]),
    [
      ["alpha", "Alpha", "/c/alpha", false],
      ["zeta", "Zeta", "/c/zeta", false],
    ],
  );
});

test("marketplaceActions: Git markets upgrade, built-in ones neither upgrade nor go", () => {
  assert.deepEqual(marketplaceActions("openai-bundled", { source_type: "local", source: "/x" }), { upgrade: "内置市场会自动更新", remove: "无法移除内置市场" });
  assert.deepEqual(marketplaceActions("mine", { source_type: "git", source: "org/repo" }), { upgrade: null, remove: null });
  assert.deepEqual(marketplaceActions("folder", { source_type: "local", source: "/x" }), { upgrade: "只能升级 Git 市场", remove: null });
  assert.deepEqual(marketplaceActions("repo-scoped", undefined), { upgrade: "只能升级 Git 市场", remove: "此市场不在您的配置中" });
  // marketplace/remove refuses one a project or managed config names.
  assert.deepEqual(marketplaceActions("mine", { source_type: "git", source: "org/repo" }, "user"), { upgrade: null, remove: null });
  assert.deepEqual(marketplaceActions("company", { source_type: "git", source: "org/repo" }, "system"), { upgrade: null, remove: "此市场来自其他配置来源，请在那里移除" });
});
