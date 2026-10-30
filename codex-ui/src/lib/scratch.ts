// Scratch workspaces (server/scratch.mjs), as Claude Desktop's: a session started on 本电脑 with no
// folder works in a fresh one under <CODEX_HOME>/codex-ui/scratch-workspaces. The sweep (Claude's
// startScratchWorkspaceSweep: two minutes in, then every six hours) removes the old ones no session
// works in, archived ones included, whatever their provider or source.
import type { ThreadListResponse } from "@protocol/v2/ThreadListResponse";
import type { ThreadSourceKind } from "@protocol/v2/ThreadSourceKind";
import { call, connectionId, whenReadsSettled } from "./codex";
import { joinPath, normalizePath, samePath } from "./format";

const SOURCES: ThreadSourceKind[] = ["cli", "vscode", "exec", "appServer", "subAgent", "subAgentReview", "subAgentCompact", "subAgentThreadSpawn", "subAgentOther", "unknown"];

/** Whether `path` is a scratch workspace: the sidebar and the 环境 card say 无文件夹 / 不在项目中工作, recent folders leave it out. */
export function inScratch(path: string | null | undefined, codexHome: string | null | undefined): boolean {
  return !!path && !!codexHome && normalizePath(path).startsWith(`${normalizePath(joinPath(joinPath(codexHome, "codex-ui"), "scratch-workspaces"))}/`);
}

async function api<T>(path: string, method: "GET" | "POST", query = ""): Promise<T> {
  const id = connectionId();
  if (!id) throw new Error("未连接到 app-server");
  const response = await fetch(`${path}?c=${encodeURIComponent(id)}${query}`, { method });
  if (!response.ok) throw new Error((await response.text()) || `临时工作区请求失败（${response.status}）`);
  return (await response.json()) as T;
}

/** A new scratch workspace for the next session. */
export async function mintScratch(): Promise<string> {
  return (await api<{ cwd: string }>("/api/scratch", "POST")).cwd;
}

/** Removes the stale scratch workspaces no session (Codex's thread/list, by cwd) works in. */
export async function sweepScratch(): Promise<void> {
  const { paths } = await api<{ paths: string[] }>("/api/scratch", "GET");
  if (!paths.length) return;
  const held: string[] = [];
  for (const archived of [false, true]) {
    let cursor: string | null = null;
    do {
      const page: ThreadListResponse = await call("thread/list", { cwd: paths, archived, modelProviders: [], sourceKinds: SOURCES, cursor, limit: 100 });
      held.push(...page.data.map((thread) => thread.cwd));
      cursor = page.nextCursor ?? null;
    } while (cursor);
  }
  for (const path of paths) {
    if (!held.some((cwd) => samePath(cwd, path))) await api("/api/scratch/remove", "POST", `&path=${encodeURIComponent(path)}`);
  }
}

let started = false;
/** Sweeps from now on; App calls it once the connection is ready. */
export function startScratchSweep(): void {
  if (started) return;
  started = true;
  const sweep = () => void whenReadsSettled().then(sweepScratch).catch(() => {});
  setTimeout(() => {
    sweep();
    setInterval(sweep, 6 * 3_600_000);
  }, 120_000);
}
