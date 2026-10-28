import { useSyncExternalStore } from "react";
import { readJson, record, writeJson } from "./store.ts";

/**
 * Ultracode (c2319015e Wa): a per-session switch beside the effort level that keeps the session
 * orchestrating with dynamic workflows. The draft's pick (key "") moves to the session it starts.
 * Kept on this machine so a reload does not tell the model it went off.
 */
const KEY = "codex-ui:ultracode";
/** 设置 → 会话 → 动态工作流程 (cd19fedd2 dynamicWorkflows): offers the workflow tool. */
const WORKFLOWS_KEY = "codex-ui:dynamic-workflows";

let sessions = record(readJson(KEY)) as Record<string, true>;
let workflows = readJson(WORKFLOWS_KEY) !== false;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const emit = () => listeners.forEach((listener) => listener());

export function ultracodeOn(threadId: string | null): boolean {
  return sessions[threadId ?? ""] === true;
}

export function setUltracode(threadId: string | null, on: boolean): void {
  const key = threadId ?? "";
  if (ultracodeOn(threadId) === on) return;
  const next = { ...sessions };
  if (on) next[key] = true;
  else delete next[key];
  sessions = next;
  writeJson(KEY, sessions);
  emit();
}

/** The draft's Ultracode goes with the session it starts. */
export function adoptDraftUltracode(threadId: string): void {
  if (!ultracodeOn(null)) return;
  setUltracode(threadId, true);
  setUltracode(null, false);
}

export function useUltracode(threadId: string | null): boolean {
  return useSyncExternalStore(subscribe, () => ultracodeOn(threadId));
}

export function workflowsEnabled(): boolean {
  return workflows;
}

export function setWorkflowsEnabled(on: boolean): void {
  workflows = on;
  writeJson(WORKFLOWS_KEY, on);
  emit();
}

export function useWorkflowsEnabled(): boolean {
  return useSyncExternalStore(subscribe, () => workflows);
}

/**
 * claude.exe Cc: "ultracode" as a word of a typed message, not a slash command, not inside quotes,
 * backticks, parentheses or a <tag>, not glued to / \ - and not asked about ("ultracode?") or part
 * of a name ("ultracode.js").
 */
export function hasUltracodeKeyword(text: string): boolean {
  if (text.trimStart().startsWith("/")) return false;
  const enclosed = enclosedRanges(text);
  for (const match of text.matchAll(/ultracode/gi)) {
    const start = match.index;
    const end = start + match[0].length;
    const before = text[start - 1] ?? "";
    const after = text[end] ?? "";
    if (/[\w/\\-]/.test(before) || /[\w/\\?-]/.test(after)) continue;
    if (after === "." && /[A-Za-z0-9]/.test(text[end + 1] ?? "")) continue;
    if (enclosed.some(([from, to]) => start >= from && end <= to)) continue;
    return true;
  }
  return false;
}

/** Spans inside "…", `…`, (…) and <tag>…</tag>. */
function enclosedRanges(text: string): [number, number][] {
  const ranges: [number, number][] = [];
  const pairs: [RegExp][] = [[/"[^"\n]*"/g], [/`[^`]*`/g], [/\([^()]*\)/g], [/<([A-Za-z][\w-]*)[^>]*>[\s\S]*?<\/\1>/g]];
  for (const [pattern] of pairs) for (const match of text.matchAll(pattern)) ranges.push([match.index, match.index + match[0].length]);
  return ranges;
}
