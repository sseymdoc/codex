import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createExecutor, registryUrl, rendezvous } from "./executor.mjs";

const until = async (check, ms = 10_000) => {
  for (const end = Date.now() + ms; !check(); await new Promise((resolve) => setTimeout(resolve, 20))) {
    if (Date.now() > end) throw new Error("timed out");
  }
};

test("exec-server's rendezvous log lines tell whether the relay is up", () => {
  const ok = 'INFO codex_exec_server::remote: Noise executor connected to rendezvous noise_event="rendezvous_connection" noise_outcome="ok" request_id="req_1" connection_attempt=1';
  assert.equal(rendezvous(ok), true);
  // The stderr formatter colours field names on a terminal.
  assert.equal(rendezvous("\x1b[3mnoise_event\x1b[0m\x1b[2m=\x1b[0m\"rendezvous_connection\" \x1b[3mnoise_outcome\x1b[0m\x1b[2m=\x1b[0m\"disconnected\""), false);
  assert.equal(rendezvous('noise_event="rendezvous_connection" noise_outcome="error" noise_reason="websocket_error"'), false);
  assert.equal(rendezvous('noise_event="registration" noise_outcome="ok"'), null);
  assert.equal(rendezvous('noise_event="rendezvous_connection" noise_outcome="retry"'), null);
});

test("exec-server dials ChatGPT's registry, or a loopback one only", () => {
  const previous = process.env.CODEX_TPP_LOCAL_EXECUTOR_REMOTE_URL;
  try {
    delete process.env.CODEX_TPP_LOCAL_EXECUTOR_REMOTE_URL;
    assert.equal(registryUrl(), "https://codex-cloud-environments.chatgpt.com/api");
    for (const [raw, expected] of [
      ["http://127.0.0.1:5400/api/", "http://127.0.0.1:5400/api"],
      ["http://example.com/api", null],
      ["https://evil.example/api", null],
      ["https://user:pw@codex-cloud-environments.chatgpt.com/api", null],
    ]) {
      process.env.CODEX_TPP_LOCAL_EXECUTOR_REMOTE_URL = raw;
      assert.equal(registryUrl(), expected, raw);
    }
  } finally {
    if (previous === undefined) delete process.env.CODEX_TPP_LOCAL_EXECUTOR_REMOTE_URL;
    else process.env.CODEX_TPP_LOCAL_EXECUTOR_REMOTE_URL = previous;
  }
});

test("the local computer: off until turned on, registered, restarted after a crash, reported once up, stopped when off", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "codex-ui-executor-"));
  // Stands in for `codex exec-server`: the first run dies at once, the next reaches rendezvous
  // and stays until its stdin closes; each run leaves its arguments behind.
  const stub = path.join(dir, "exec-server.mjs");
  writeFileSync(stub, `import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
const runs = ${JSON.stringify(path.join(dir, "runs.jsonl"))};
let count = 0;
try { count = readFileSync(runs, "utf8").split("\\n").filter(Boolean).length; } catch {}
appendFileSync(runs, JSON.stringify({ argv: process.argv.slice(2), exit: process.env.CODEX_EXEC_SERVER_EXIT_ON_STDIN_CLOSE, pid: process.pid }) + "\\n");
if (count === 0) process.exit(3);
process.stderr.write('INFO codex_exec_server::remote: connected noise_event="rendezvous_connection" noise_outcome="ok"\\n');
process.stdin.resume();
process.stdin.on("end", () => process.exit(0));
`);
  const registered = [];
  const reports = [];
  const options = {
    dir,
    launch: () => ({ command: process.execPath, args: [stub], env: process.env, codexHome: path.join(dir, "home") }),
    register: async (body) => { registered.push(body); return `env_${registered.length}`; },
    reportReady: async (environmentId, roots, reported) => { reports.push({ environmentId, roots }); reported.add("th_root"); },
  };
  const previous = process.env.CODEX_TPP_LOCAL_EXECUTOR_REMOTE_URL;
  process.env.CODEX_TPP_LOCAL_EXECUTOR_REMOTE_URL = "http://127.0.0.1:9/api";
  const executor = createExecutor(options);
  try {
    executor.wake();
    assert.deepEqual(executor.state(), { available: true, enabled: false, environmentId: null, ready: false, error: null });
    assert.equal(existsSync(path.join(dir, "runs.jsonl")), false);

    await executor.setEnabled(true);
    await until(() => executor.state().ready);
    const runs = readFileSync(path.join(dir, "runs.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(runs.length, 2);
    assert.deepEqual(runs[1].argv, ["-c", 'forced_login_method="chatgpt"', "exec-server", "--remote", "http://127.0.0.1:9/api", "--environment-id", "env_2"]);
    assert.equal(runs[1].exit, "true");
    // Each start registers again, under the one installation id.
    assert.equal(registered.length, 2);
    assert.equal(registered[0].installation_id, registered[1].installation_id);
    assert.deepEqual(registered[1].selected_capability_roots, [{ id: "codex-home-skills", path: path.join(dir, "home", "skills") }]);
    await until(() => reports.length === 1);
    assert.deepEqual(reports[0].environmentId, "env_2");
    const saved = JSON.parse(readFileSync(path.join(dir, "local-executor.json"), "utf8"));
    assert.deepEqual(saved, { installationId: registered[0].installation_id, enabled: true });

    // On again (a dot just attached it): the threads hear of it now.
    await executor.setEnabled(true);
    assert.equal(reports.length, 2);

    await executor.setEnabled(false);
    assert.deepEqual(executor.state(), { available: true, enabled: false, environmentId: null, ready: false, error: null });
    await until(() => { try { process.kill(runs[1].pid, 0); return false; } catch { return true; } });

    // The choice and the installation id outlive codex-ui.
    const again = createExecutor(options);
    assert.equal(again.state().enabled, false);
    again.close();
  } finally {
    executor.close();
    if (previous === undefined) delete process.env.CODEX_TPP_LOCAL_EXECUTOR_REMOTE_URL;
    else process.env.CODEX_TPP_LOCAL_EXECUTOR_REMOTE_URL = previous;
  }
});
