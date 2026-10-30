// The ChatGPT calls the page may make (server/cloud.mjs), for scheduled tasks: the routes it lets
// through and the ones it never does, and how they go out (through the host's ChatGPT transport,
// without the Codex SKU, a fixed header only where the desktop app sends one). A fake app-server
// hands out the login and a local server stands in for ChatGPT; no network or real login.
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { cloudAllowed } from "./cloud.mjs";
import { createOrchestrator } from "./orchestrator.mjs";

const TOKEN = ["e30", Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "acct-1" } })).toString("base64url"), "sig"].join(".");
const fakeCodex = path.join(mkdtempSync(path.join(tmpdir(), "codex-ui-cloud-")), "fake-codex.mjs");
writeFileSync(fakeCodex, `import { createInterface } from "node:readline";
createInterface({ input: process.stdin }).on("line", (line) => {
  const { id, method } = JSON.parse(line);
  process.stdout.write(JSON.stringify({ id, result: method === "getAuthStatus" ? { authMethod: "chatgpt", authToken: ${JSON.stringify(TOKEN)} } : {} }) + "\\n");
});
`);

// What the 定时任务 page calls (src/lib/cloud-automations.ts).
const ALLOWED = [
  ["GET", "/automations?filter=scheduled&limit=25"],
  ["GET", "/automations?cursor=c%3D%3D&limit=100"],
  ["GET", "/automation/Automation_0123456789abcdef0123456789abcdef"],
  ["POST", "/automations/save"],
  ["POST", "/automations/set_status"],
  ["POST", "/automations/remove"],
  ["GET", "/automation/a1/runs?limit=25&include_chat_ref=true"],
  ["GET", "/automation/a1/runs?cursor=r_9&limit=25&include_chat_ref=true"],
  ["POST", "/automation/a1/runs/run-1/read"],
  ["GET", "/automation/a1/latest_backing_run?include_snapshot=true"],
  ["GET", "/automations/schedule_policy"],
  ["POST", "/share/automation"],
  ["GET", "/share/automation/a1/current"],
  ["POST", "/share/automation/a1/refresh"],
  ["DELETE", "/share/automation/a1"],
  ["GET", "/share/post/post_1/automation"],
  ["GET", "/suggested_automations"],
];

// A personal run's chat (and its anti-abuse tokens), the team-only calls and a team's list, the
// table query, the shared-task prompt, conversations and ChatGPT's chat models stay out, as do other
// methods and paths around the allowed ones.
const REFUSED = [
  ["GET", "/automations?owner=group:team_1"],
  ["GET", "/automations?owner=group%3Ateam_1&limit=100"],
  ["GET", "/automations?filter=scheduled&owner=group:t"],
  ["GET", "/automations?limit=100&owner=me"],
  ["GET", "/models?iim=false&include_icons=false&is_gizmo=false"],
  // The library branch (claude/codex-ui-library) lets this one through for a file's 关联聊天: its
  // merge decides between the two. Scheduled tasks never read a conversation.
  ["GET", "/conversation/c1"],
  ["POST", "/f/conversation"],
  ["POST", "/f/conversation/prepare"],
  ["POST", "/sentinel/chat-requirements/prepare"],
  ["POST", "/sentinel/chat-requirements/finalize"],
  ["POST", "/automation/a1/run"],
  ["POST", "/automations/query"],
  ["POST", "/automations/generate_creation_prompt"],
  ["GET", "/automation/a1/execution_threads?limit=25"],
  ["GET", "/automation/a1/webhook_batch_state"],
  ["POST", "/automation/a1/webhook_batch/run_now"],
  ["GET", "/automation/a1/runs/latest"],
  ["GET", "/accounts/acct-1/teams?offset=0&limit=50"],
  ["GET", "/accounts/acct-1/teams/team-1"],
  ["POST", "/conversation"],
  ["POST", "/conversation/c1"],
  ["POST", "/settings/announcement_viewed?announcement_id=x"],
  ["GET", "/automations/save"],
  ["DELETE", "/automations/remove"],
  ["POST", "/suggested_automations"],
  ["GET", "/suggested_automations?surface=x"],
  ["GET", "/automation/../tbo/primary"],
  ["GET", "/automation/a1/runs/../../tbo"],
  ["GET", "/share/post/a/b/automation"],
];

test("scheduled tasks: the page's calls pass, a run's chat, team calls and the rest do not", () => {
  for (const [method, path] of ALLOWED) assert.ok(cloudAllowed(method, path), `${method} ${path} should pass`);
  for (const [method, path] of REFUSED) assert.equal(cloudAllowed(method, path), false, `${method} ${path} should be refused`);
});

test("scheduled tasks go out through the host's transport without the Codex SKU, the suggestions with their surface", async () => {
  const seen = [];
  const backend = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    seen.push({ method: req.method, url: req.url, headers: req.headers, body });
    res.writeHead(200, { "Content-Type": "application/json" }).end(req.url.endsWith("/suggested_automations") ? "[]" : "{}");
  });
  await new Promise((resolve) => backend.listen(0, "127.0.0.1", resolve));
  const previous = process.env.CODEX_API_BASE_URL;
  process.env.CODEX_API_BASE_URL = `http://127.0.0.1:${backend.address().port}/backend-api`;
  const sent = [];
  const orchestrator = createOrchestrator({ codex: fakeCodex, log: { error() {} }, chatgptFetch: (url, init) => (sent.push(new URL(url).pathname), fetch(url, init)) });
  try {
    const id = orchestrator.connect("127.0.0.1", { event() {}, message() {}, end() {} });
    for (const [method, path] of ALLOWED) {
      // The page cannot name a header: only the route's own go out.
      const answer = await orchestrator.cloud(id, { method, path, body: method === "POST" ? { x: 1 } : undefined, headers: { "X-OpenAI-Task-Suggestions-Surface": "other", "OAI-Product-Sku": "CODEX" } });
      assert.equal(answer.status, 200, `${method} ${path}`);
    }
    for (const [method, path] of REFUSED) await assert.rejects(orchestrator.cloud(id, { method, path }), { code: "CLOUD_REFUSED" });
  } finally {
    orchestrator.close();
    backend.close();
    if (previous === undefined) delete process.env.CODEX_API_BASE_URL;
    else process.env.CODEX_API_BASE_URL = previous;
  }
  assert.deepEqual(seen.map(({ method, url }) => `${method} ${url}`), ALLOWED.map(([method, path]) => `${method} /backend-api${path}`));
  assert.deepEqual(sent, ALLOWED.map(([, path]) => `/backend-api${path.split("?")[0]}`));
  for (const { url, headers, method, body } of seen) {
    assert.equal(headers["oai-product-sku"], undefined, url);
    assert.equal(headers.authorization, `Bearer ${TOKEN}`);
    assert.equal(headers["chatgpt-account-id"], "acct-1");
    assert.equal(headers["x-openai-task-suggestions-surface"], url === "/backend-api/suggested_automations" ? "scheduled_page" : undefined, url);
    if (method === "POST") assert.deepEqual(JSON.parse(body), { x: 1 });
  }
});
