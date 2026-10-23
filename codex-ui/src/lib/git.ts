import type { CommandExecParams } from "@protocol/v2/CommandExecParams";
import type { CommandExecResponse } from "@protocol/v2/CommandExecResponse";
import type { GitSnapshot } from "../../context/index.mjs";

export { gitContext } from "../../context/index.mjs";
export type { GitSnapshot } from "../../context/index.mjs";

/** Repository data can contain credentials; only keep a remote suitable for display. */
function remoteUrl(value: string): string | null {
  const scp = /^(?:[^@/:]+@)?([\w.-]+):([^\s]+)$/.exec(value);
  if (scp && !value.includes("://") && !/^[a-z]:/i.test(value)) return `ssh://${scp[1]}/${scp[2]}`;
  try {
    const url = new URL(value);
    if (!["https:", "http:", "ssh:", "git:"].includes(url.protocol)) return null;
    url.username = url.password = url.search = url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

/** Claude's GitStatusService queries the working folder, independently of session metadata. */
export async function readGitSnapshot(cwd: string, exec: (params: CommandExecParams) => Promise<CommandExecResponse | null>): Promise<GitSnapshot> {
  const git = (...args: string[]) => exec({
    command: ["git", "-c", "core.fsmonitor=false", "--no-optional-locks", ...args],
    cwd, env: { LC_ALL: "C", GIT_TERMINAL_PROMPT: "0" }, timeoutMs: 2000, outputBytesCap: 65536,
    sandboxPolicy: { type: "readOnly", networkAccess: false },
  }).catch(() => null);
  const [status, origin, base] = await Promise.all([
    git("status", "--porcelain=v2", "--branch", "-z"),
    git("remote", "get-url", "origin"),
    git("symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"),
  ]);
  const snapshot: GitSnapshot = { cwd, capturedAt: new Date().toISOString(), state: "unavailable", info: null, base: null, files: null };
  if (status?.exitCode !== 0) {
    if (status?.stderr?.includes("not a git repository")) snapshot.state = "not-repository";
    return snapshot;
  }
  const records = status.stdout.split("\0");
  let sha: string | null = null;
  let branch: string | null = null;
  let found = false;
  let files = 0;
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    if (record.startsWith("# branch.oid ")) sha = /^[a-f0-9]{40,64}$/.test(record.slice(13)) ? record.slice(13) : null;
    else if (record.startsWith("# branch.head ")) { found = true; branch = record.slice(14) === "(detached)" ? null : record.slice(14); }
    else if (/^[12u?] /.test(record)) { files++; if (record.startsWith("2 ")) i++; }
  }
  if (!found) return snapshot;
  return {
    ...snapshot, state: "repository", info: { sha, branch, originUrl: origin?.exitCode === 0 ? remoteUrl(origin.stdout.trim()) : null },
    base: base?.exitCode === 0 ? base.stdout.trim().replace(/^origin\//, "") || null : null,
    files: status.stdout.endsWith("\0") ? files : null,
  };
}
