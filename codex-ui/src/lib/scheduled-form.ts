// The 定时任务 form's logic (components/ScheduledForm.tsx; Claude c0fd2fda3 gn / dn over the ChatGPT
// app's local editor fields): a draft from a task or a seed, the task input it saves and an edit's
// changes, the first reason it cannot save (dn's order with the ChatGPT app's checks), the folder
// and session choices, and the schedule editor's steps. The RRULE text is the schedule; `mode` is
// only which editor shows it, and context/rrule.mjs maps between the two.

import type { Model } from "@protocol/v2/Model";
import type { Project } from "@protocol/v2/Project";
import { DEFAULT_SCHEDULE, rruleOf, rruleProblem, scheduleOf, type Weekday } from "../../context/rrule.mjs";
import { environmentOf } from "./environments.ts";
import { normalizePath, samePath, threadTitle } from "./format.ts";
import { spawnOf } from "./session.ts";
import type { Automation, AutomationInput } from "./automations";
import type { ScheduledSeed, ThreadState } from "./store";

/** 运行于: a new session each run (cron), a session made for the task, or a chosen one (heartbeats). */
export type Destination = "cron" | "dedicated" | "thread";
/** Where a cron task works; a project and a folder both save as its folder (cwds). */
export type Place = { kind: "project"; projectId: string; cwd: string } | { kind: "folder"; cwd: string } | { kind: "projectless" };
/** The schedule editor shown (the ChatGPT app's local modes; a monthly rule shows as custom there too). */
export type Mode = "hourly" | "daily" | "weekdays" | "weekly" | "custom";

export interface Draft {
  name: string;
  prompt: string;
  destination: Destination;
  targetThreadId: string | null;
  place: Place;
  worktree: boolean;
  model: string | null;
  effort: string | null;
  failedOnly: boolean;
  autoArchive: boolean;
  rrule: string;
  mode: Mode;
}

/** The server's prompt limit (and ChatGPT's instructionsCharacterLimit). */
const MAX_PROMPT = 100_000;

export const localProjects = (projects: readonly Project[]) => projects.filter((p) => environmentOf(p).kind === "local" && p.roots.length > 0);

const inside = (path: string, root: string) => {
  const a = normalizePath(path), b = normalizePath(root);
  return a === b || a.startsWith(`${b}/`);
};

/** A folder as a place: the project it is the first folder of, else the folder itself. */
export function placeFor(cwd: string, projects: readonly Project[]): Place {
  const project = localProjects(projects).find((p) => samePath(p.roots[0].path, cwd));
  return project ? { kind: "project", projectId: project.id, cwd } : { kind: "folder", cwd };
}

/** The folder menu: the local projects, then the recent folders in none of them (eight at most without a query). */
export function folderChoices(projects: readonly Project[], recent: readonly string[], query = ""): { projects: Extract<Place, { kind: "project" }>[]; folders: string[] } {
  const q = query.trim().toLowerCase();
  const hit = (...texts: string[]) => !q || texts.some((text) => text.toLowerCase().includes(q));
  const local = localProjects(projects);
  const folders = recent.filter((path) => !projects.some((p) => p.roots.some((root) => inside(path, root.path))) && hit(path));
  return {
    projects: local.filter((p) => hit(p.name, p.roots[0].path)).map((p) => ({ kind: "project" as const, projectId: p.id, cwd: p.roots[0].path })),
    folders: q ? folders : folders.slice(0, 8),
  };
}

/** 选择会话…: loaded root sessions, not archived, no sub-agent, none another active heartbeat already watches. */
export function sessionChoices(ids: readonly string[], threads: Readonly<Record<string, ThreadState>>, items: readonly Automation[], editing: string | null, archived: (id: string) => boolean, query = ""): { id: string; title: string }[] {
  const taken = new Set(items.filter((a) => a.kind === "heartbeat" && a.status === "ACTIVE" && a.id !== editing).map((a) => a.targetThreadId));
  const q = query.trim().toLowerCase();
  return ids.flatMap((id) => {
    const meta = threads[id]?.meta;
    if (!meta || meta.parentThreadId || spawnOf(meta) || taken.has(id) || archived(id)) return [];
    const title = threadTitle(meta);
    return !q || title.toLowerCase().includes(q) ? [{ id, title }] : [];
  });
}

/** The editor that shows a rule: its schedule's mode, a monthly one as custom. */
export function modeOf(rrule: string): Mode {
  const mode = scheduleOf(rrule).mode;
  return mode === "monthly" ? "custom" : mode;
}

/**
 * The form's first state: the task's, else the seed's (a suggestion, or a session's 添加定时任务…:
 * heartbeat on that session, or with targetThreadId null on a session made for it), else a daily
 * 09:00 cron task in `here` (the composer's folder).
 */
export function draftOf(task: Automation | null, seed: ScheduledSeed | null, here: Place, projects: readonly Project[]): Draft {
  const rrule = task?.rrule ?? seed?.rrule ?? rruleOf(DEFAULT_SCHEDULE);
  const target = (task ? task.targetThreadId : seed?.targetThreadId) ?? null;
  const kind = task?.kind ?? seed?.kind ?? "cron";
  return {
    name: task?.name ?? seed?.name ?? "",
    prompt: task?.prompt ?? seed?.prompt ?? "",
    destination: kind === "cron" ? "cron" : target || task ? "thread" : "dedicated",
    targetThreadId: target,
    place: task ? taskPlace(task, projects) : here,
    worktree: task?.executionEnvironment === "worktree",
    model: task?.model ?? null,
    effort: task?.reasoningEffort ?? null,
    failedOnly: task?.notificationPolicy === "failed_runs_only",
    autoArchive: task?.autoArchive ?? false,
    rrule,
    mode: modeOf(rrule),
  };
}

function taskPlace(task: Automation, projects: readonly Project[]): Place {
  // A project target read in from the ChatGPT app's file (codex-ui writes folders only).
  if (task.target?.type === "project") {
    const { projectId } = task.target;
    return { kind: "project", projectId, cwd: projects.find((p) => p.id === projectId)?.roots[0]?.path ?? task.cwds?.[0] ?? "" };
  }
  return task.cwds?.[0] ? placeFor(task.cwds[0], projects) : { kind: "projectless" };
}

/** What the draft saves (ChatGPT JHe/YHe's fields); 此任务的新会话 leaves the session to createHeartbeatSession. */
export function inputOf(d: Draft): AutomationInput {
  const common = { name: d.name.trim(), prompt: d.prompt, rrule: d.rrule.trim(), notificationPolicy: d.failedOnly ? ("failed_runs_only" as const) : null };
  if (d.destination !== "cron") return { kind: "heartbeat", ...common, ...(d.destination === "thread" && { targetThreadId: d.targetThreadId ?? "" }) };
  const cwds = d.place.kind === "projectless" ? [] : [d.place.cwd];
  // ponytail: the worktree switch does not check for a git repository; the run falls back to the folder.
  return { kind: "cron", ...common, model: d.model, reasoningEffort: d.effort, autoArchive: d.autoArchive, cwds, executionEnvironment: d.worktree && cwds.length ? "worktree" : "local" };
}

/** An edit's patch: the fields that changed (an untouched folder keeps a project target the file has). */
export function changesOf(before: AutomationInput, after: AutomationInput): AutomationInput {
  const old: Record<string, unknown> = before;
  return Object.fromEntries(Object.entries(after).filter(([key, value]) => key !== "kind" && JSON.stringify(value) !== JSON.stringify(old[key])));
}

/**
 * Why the draft cannot be saved yet, the first reason only, in Claude dn's order (name, prompt,
 * then the schedule, then nothing to save) with the ChatGPT app's checks between: the prompt's
 * length and the session to run in. `initial` is the edited task's first draft (null when new);
 * `folder` whether there is a folder to make 此任务的新会话 in. An edit checks its schedule only
 * once it changed, so a one-time task that ran still saves its other fields.
 */
export function problemOf(d: Draft, { initial, now, folder }: { initial: Draft | null; now: number; folder: boolean }): string | null {
  if (initial && !d.name.trim()) return "请输入名称。";
  if (!d.prompt.trim()) return "添加指令。";
  if (d.prompt.length > MAX_PROMPT) return "请使用不超过 100,000 个字符";
  if (d.destination === "thread" && !d.targetThreadId) return "请选择会话。";
  if (d.destination === "dedicated" && !folder) return "请先选择一个文件夹。";
  if (!initial || d.rrule !== initial.rrule) {
    // Empty text would save the server's default rule; the editor asks for one instead.
    const problem = d.rrule.trim() ? rruleProblem(d.rrule, now) : { message: "请输入有效的 RRULE" };
    if (problem) return d.mode === "custom" ? problem.message : "请输入有效的日程安排。";
  }
  if (initial && !Object.keys(changesOf(inputOf(initial), inputOf(d))).length) return "没有需要保存的更改。";
  return null;
}

// ---------------------------------------------------------------------------
// The schedule editor: each step rewrites the rule from its schedule (rruleOf).

/**
 * Another editor for the same rule: custom keeps the text, the others write their own rule from
 * what the old one had (its time and weekdays; an interval of one hour, or the interval it had).
 */
export function withMode(d: Draft, mode: Mode): Draft {
  if (mode === "custom") return { ...d, mode };
  const s = scheduleOf(d.rrule);
  const hourly = s.mode === "hourly";
  return { ...d, mode, rrule: rruleOf({ ...s, mode, intervalHours: hourly ? s.intervalHours : 1, intervalMinutes: hourly ? s.intervalMinutes : null }) };
}

/** 每隔 n 小时 / 分钟 (minutes are a heartbeat's). */
export function withInterval(d: Draft, every: number, unit: "hour" | "minute"): Draft {
  const s = scheduleOf(d.rrule);
  return { ...d, rrule: rruleOf({ ...s, mode: "hourly", intervalHours: unit === "hour" ? every : s.intervalHours, intervalMinutes: unit === "minute" ? every : null }) };
}

export function withTime(d: Draft, time: string): Draft {
  return d.mode === "hourly" || d.mode === "custom" ? d : { ...d, rrule: rruleOf({ ...scheduleOf(d.rrule), mode: d.mode, time }) };
}

/** A weekday on or off in the weekly editor; the last one stays. */
export function withDay(d: Draft, day: Weekday): Draft {
  const days = scheduleOf(d.rrule).weekdays;
  const next = days.includes(day) ? days.filter((other) => other !== day) : [...days, day];
  return next.length ? { ...d, rrule: rruleOf({ ...scheduleOf(d.rrule), mode: "weekly", weekdays: next }) } : d;
}

/** The interval and its unit as the hourly editor shows them. */
export function intervalOf(rrule: string): { every: number; unit: "hour" | "minute" } {
  const s = scheduleOf(rrule);
  return s.intervalMinutes == null ? { every: s.intervalHours, unit: "hour" } : { every: s.intervalMinutes, unit: "minute" };
}

/** The model menu's choice: an effort the new model does not offer goes back to the default. */
export function withModel(d: Draft, model: string | null, models: readonly Model[], fallback: string | null): Draft {
  return { ...d, model, effort: d.effort && effortsOf(models, model ?? fallback).includes(d.effort) ? d.effort : null };
}

/** The efforts a model offers (cronModel keeps only these). */
export function effortsOf(models: readonly Model[], model: string | null): string[] {
  return models.find((m) => m.id === model || m.model === model)?.supportedReasoningEfforts.map((o) => o.reasoningEffort) ?? [];
}
