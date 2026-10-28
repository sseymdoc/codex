import type { ServerRequest } from "@protocol/ServerRequest";
import type { WorkflowItem } from "@protocol/WorkflowItem";
import { callExperimental } from "./codex.ts";
import { getState, readJson, updateItem, updateThread, writeJson } from "./store.ts";
import { settleAgents, workflowRuns } from "./workflow.ts";

/** Runs whose liveness this page already asked about. */
const checked = new Set<string>();

/** A new connection may be to a restarted server: ask about running runs again. */
export function recheckRuns(): void {
  checked.clear();
}

/**
 * A run that reads running in history may have died with the server that ran it (a restart, a
 * reload of the bridge's app-server): ask `thread/workflows/list` once, and end the run here when
 * it is gone (c62da1b56 Y: stopped). An awaiting-approval run is not registered yet, so it is left.
 */
export function checkRun(threadId: string, item: WorkflowItem): void {
  if (item.status !== "running" || checked.has(item.runId)) return;
  checked.add(item.runId);
  const supported = getState().server.info?.codexUiWorkflows === true;
  const live = supported
    ? callExperimental<{ running: string[] }>("thread/workflows/list", { threadId }).then((response) => response.running.includes(item.runId), () => false)
    : Promise.resolve(false);
  void live.then((running) => { if (!running) endRun(threadId, item.runId); });
}

/** The backend asks for a run through request_user_input with these (core/src/workflow/handler.rs). */
export const WORKFLOW_APPROVAL_PREFIX = "codex_ui_workflow_approval:";
export const WORKFLOW_ONCE = "Run workflow";
export const WORKFLOW_SESSION = "Allow for this session";
export const WORKFLOW_DECLINE = "Decline";

export function isWorkflowApproval(request: ServerRequest): request is Extract<ServerRequest, { method: "item/tool/requestUserInput" }> {
  return request.method === "item/tool/requestUserInput" && request.params.questions.length === 1 && request.params.questions[0].id.startsWith(WORKFLOW_APPROVAL_PREFIX);
}

/** 始终允许 for a saved workflow, by name, on this machine (Claude's Workflow(<name>) allow rule). */
const ALLOW_KEY = "codex-ui:workflow-allow";
export function workflowAlwaysAllowed(name: string): boolean {
  const names = readJson(ALLOW_KEY);
  return Array.isArray(names) && names.includes(name);
}
export function allowWorkflowAlways(name: string): void {
  const names = readJson(ALLOW_KEY);
  writeJson(ALLOW_KEY, [...new Set([...(Array.isArray(names) ? names : []), name])]);
}

/** Ends every run still reading running in a thread the server shut down (reverted, archived). */
export function endRunningRuns(threadId: string): void {
  for (const run of workflowRuns(getState().threads[threadId]?.turns ?? [])) if (run.status === "running") endRun(threadId, run.runId);
}

/** Marks a run that is no longer running on this server as stopped, its unfinished agents settled. */
export function endRun(threadId: string, runId: string): void {
  updateThread(threadId, (thread) => ({
    ...thread,
    turns: thread.turns.map((turn) => {
      const item = turn.items.find((entry) => entry.type === "workflow" && entry.runId === runId && entry.status === "running");
      return item ? updateItem(turn, item.id, (entry) => entry.type === "workflow" ? { ...entry, status: "stopped", agents: settleAgents(entry.agents, "stopped"), summary: entry.summary ?? entry.description } : entry) : turn;
    }),
  }));
}
