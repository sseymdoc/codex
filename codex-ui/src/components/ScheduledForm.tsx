// The new / edit dialog for a local scheduled task: Claude 4.29's EpitaxyLocalRoutineFormDialog (c0243d234
// W in c9e1458cd nt; the form q and its instructions block ce, controls from c0fd2fda3, class names from
// c14edbe0a) holding the ChatGPT app's local editor (automation-dialog, automation-frequency-section,
// automation-notification-policy-dropdown): 运行于, the schedule with its custom builder and RRULE text,
// 通知, 归档成功运行记录 and the sandbox note. The logic is lib/scheduled-form.ts.
//
// Props:
// - `dialog`: the route's form dialog. `id` null makes a new task from `seed` (a suggestion's name,
//   prompt and rrule; `kind: "heartbeat"` with `targetThreadId` a session's id, or null for 此任务的新会话
//   (lib/automations.ts createHeartbeatSession)); otherwise it edits that task. `source` "cloud" is
//   the cloud phase's.
// - `onClose`: closes it, after a save too, with the task a save created (none after an edit). The
//   page opens what it created; the form holds no route of its own, so a session's menu can show it
//   from its own state as well.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { builderOf, builderRrule, describeRrule, jitterSpan, parseRrule, rruleProblem, scheduleOf, type Builder, type Weekday } from "../../context/rrule.mjs";
import { createAutomation, createHeartbeatSession, cronPermissions, updateAutomation, useAutomations, type Automation } from "../lib/automations";
import { PRESETS, effectiveSettings, errorMessage, isArchivedThread, modelLabel } from "../lib/codex";
import { environmentOf } from "../lib/environments";
import { basename, homeRelative, samePath, threadTitle } from "../lib/format";
import {
  changesOf, draftOf, effortsOf, folderChoices, inputOf, intervalOf, localProjects, placeFor, problemOf, sessionChoices,
  withDay, withDestination, withInterval, withMode, withModel, withTime, type Draft, type Mode, type Place,
} from "../lib/scheduled-form";
import { defaultName } from "../lib/scheduled-view";
import { getState, toast, useStore, type AppState, type ScheduledDialog, type ScheduledSeed } from "../lib/store";
import { EFFORT_LABELS, MenuSearch, useRecentFolders } from "./Composer";
import { FolderDialog } from "./Dialogs";
import { Button, Dialog, Icon, MenuItem, MenuSection, MenuSelect, MenuSep, Popover, Skeleton, Toggle } from "./ui";

export type ScheduledFormDialog = Extract<ScheduledDialog, { type: "form" }>;

export interface ScheduledFormProps {
  dialog: ScheduledFormDialog;
  onClose(created?: Automation): void;
}

/** sOxe0GRL7O as the page's banner says it (Scheduled.tsx KEEP_AWAKE). */
const KEEP_AWAKE = `本地定时任务仅在您的电脑处于唤醒状态且联网时运行，${typeof window !== "undefined" && window.codexDesktop ? "Codex 关闭期间不会运行。" : "且需要保持此页面打开。"}`;

const MODES: { value: Mode; label: string }[] = [
  { value: "hourly", label: "每小时" },
  { value: "daily", label: "每天" },
  { value: "weekdays", label: "每个工作日" },
  { value: "weekly", label: "每周" },
  { value: "custom", label: "自定义" },
];
const WEEK: [Weekday, string][] = [["MO", "周一"], ["TU", "周二"], ["WE", "周三"], ["TH", "周四"], ["FR", "周五"], ["SA", "周六"], ["SU", "周日"]];
const FREQUENCIES: { value: Builder["frequency"]; label: string; unit: string }[] = [
  { value: "hourly", label: "每小时", unit: "小时" },
  { value: "daily", label: "每天", unit: "天" },
  { value: "weekly", label: "每周", unit: "周" },
  { value: "monthly", label: "每月", unit: "个月" },
  { value: "yearly", label: "每年", unit: "年" },
];
const MONTHS = Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: `${i + 1} 月` }));
const NONE: Place = { kind: "projectless" };

/** A new cron task works in the composer's folder (none on an SSH or cloud environment). */
function here({ prefs, projects }: AppState): Place {
  const chosen = projects.find((p) => p.id === prefs.projectId);
  return prefs.cwd && environmentOf(chosen).kind === "local" ? placeFor(prefs.cwd, projects) : NONE;
}

export function ScheduledForm({ dialog, onClose }: ScheduledFormProps) {
  const task = useAutomations((s) => (dialog.id ? s.items?.find((a) => a.id === dialog.id) : undefined));
  const loading = useAutomations((s) => s.items === null);
  if (dialog.id && !task)
    return (
      <Dialog title="编辑定时任务" size="lg" onClose={() => onClose()}>
        {loading ? <Skeleton lines={4} /> : <p className="plugins-note">找不到此定时任务</p>}
      </Dialog>
    );
  return <Form key={task?.id ?? "new"} task={task ?? null} seed={dialog.seed} onClose={onClose} />;
}

function Form({ task, seed, onClose }: { task: Automation | null; seed: ScheduledSeed | null; onClose(created?: Automation): void }) {
  const models = useStore((s) => s.models);
  const hasFolder = useStore((s) => !!s.prefs.cwd);
  const [initial] = useState(() => draftOf(task, seed, here(getState()), getState().projects));
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  // Left mid-save (the palette still opens over a dialog): the save ends with its toast alone, opening nothing.
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => void (live.current = false);
  }, []);
  const editing = task !== null;
  const cron = draft.destination === "cron";
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const problem = problemOf(draft, { initial: editing ? initial : null, now: Date.now(), folder: hasFolder });
  const dirty = JSON.stringify(inputOf(draft)) !== JSON.stringify(inputOf(initial));
  // 放弃未保存的更改？ before a close would drop an edit (the X, Esc, a click outside, 取消); a save under
  // way holds the dialog, whose end opens what it made.
  const close = () => (busy ? undefined : dirty ? setConfirming(true) : onClose());

  const save = async () => {
    if (problem || busy) return;
    setBusy(true);
    try {
      const input = inputOf(draft);
      const item = task
        ? await updateAutomation(task.id, changesOf(inputOf(initial), input))
        : draft.destination === "dedicated"
          ? await createHeartbeatSession(input)
          : await createAutomation(input);
      toast("neutral", task ? `“${item.name}”已更新。` : `已创建“${item.name}”。`);
      if (live.current) onClose(task ? undefined : item);
    } catch (error) {
      toast("warning", task ? "无法更新定时任务。您可以重试。" : "创建定时任务失败。您可以重试。", errorMessage(error));
      setBusy(false);
    }
  };

  const fallback = effectiveSettings(null).model;
  const model = models.find((m) => m.id === draft.model || m.model === draft.model)?.id ?? draft.model ?? "";
  const modelOptions = [{ value: "", label: "默认" }, ...models.map((m) => ({ value: m.id, label: m.displayName }))];
  if (model && !models.some((m) => m.id === model)) modelOptions.push({ value: model, label: modelLabel(model) });
  const efforts = effortsOf(models, draft.model ?? fallback);
  // Claude has no effort picker (lKv8ex1Pyg 默认 is its model's): 默认强度 tells this pill from the model's.
  const effortOptions = [{ value: "", label: "默认强度" }, ...efforts.map((e) => ({ value: e, label: EFFORT_LABELS[e] ?? e }))];
  if (draft.effort && !efforts.includes(draft.effort)) effortOptions.push({ value: draft.effort, label: EFFORT_LABELS[draft.effort] ?? draft.effort });

  return (
    <>
      <Dialog
        title={editing ? "编辑定时任务" : "新建本地定时任务"}
        size="lg"
        onClose={close}
      >
        {/* q: the fields scroll over the actions, which stay in view however short the window. */}
        <form
          className="scheduled-form scroll-fade-y"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <p className="scheduled-banner">
            <Icon name="Info" size="sm" />
            <span>{KEEP_AWAKE}</span>
          </p>
          <label className="scheduled-form-field">
            <span className="scheduled-form-label">名称</span>
            <input className="input" maxLength={250} placeholder={defaultName("", draft.prompt) || "每日代码审查"} value={draft.name} onChange={(event) => set({ name: event.target.value })} />
          </label>
          <div className="scheduled-form-field scheduled-form-instructions">
            <span className="scheduled-form-label">指令</span>
            <div className="scheduled-form-box">
              <textarea
                className="scheduled-form-prompt"
                aria-label="指令"
                rows={5}
                placeholder="查看过去 24 小时内的提交。总结更改内容，指出任何有风险的模式或缺失的测试，并记录任何值得跟进的事项。"
                value={draft.prompt}
                onChange={(event) => set({ prompt: event.target.value })}
              />
              {cron && (
                <>
                  <div className="scheduled-form-tools">
                    <span className="scheduled-form-spacer" />
                    <MenuSelect label="模型" value={model} options={modelOptions} onChange={(value) => setDraft((d) => withModel(d, value || null, models, fallback))} />
                    {efforts.length > 0 && <MenuSelect label="强度" value={draft.effort ?? ""} options={effortOptions} onChange={(value) => set({ effort: value || null })} />}
                  </div>
                  <div className="scheduled-form-bar">
                    <FolderPicker place={draft.place} onPick={(place) => set({ place })} onBrowse={() => setBrowsing(true)} />
                    <span className="scheduled-form-spacer" />
                    {draft.place.kind !== "projectless" && (
                      <label className="scheduled-form-switch">
                        <span>工作树</span>
                        <Toggle label="工作树" checked={draft.worktree} onChange={(worktree) => set({ worktree })} />
                      </label>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
          <Row label="运行于">
            {/* An edit keeps the kind (the server refuses a change): a cron task's target is fixed, a heartbeat's session can change. */}
            {editing && cron ? (
              <span className="scheduled-form-value">每次运行时新建会话</span>
            ) : (
              <RunsIn draft={draft} editing={task?.id ?? null} onChange={(patch) => setDraft((d) => withDestination(d, patch))} />
            )}
          </Row>
          <div className="scheduled-form-field">
            <span className="scheduled-form-label">定时</span>
            <ScheduleEditor draft={draft} heartbeat={!cron} onChange={setDraft} />
          </div>
          <div className="scheduled-form-rows">
            <Row label="通知">
              <MenuSelect
                label="通知"
                value={draft.failedOnly ? "failed" : "all"}
                options={[
                  { value: "all", label: cron ? "所有运行" : "重要更新" },
                  { value: "failed", label: "仅限未成功运行" },
                ]}
                onChange={(value) => set({ failedOnly: value === "failed" })}
              />
            </Row>
            {cron && (
              <Row label="归档成功运行记录">
                <Toggle label="归档成功运行记录" checked={draft.autoArchive} onChange={(autoArchive) => set({ autoArchive })} />
              </Row>
            )}
          </div>
          {cron && (
            <p className="scheduled-banner">
              <Icon name="LockShield" size="sm" />
              <span>{sandboxNote(getState())}</span>
            </p>
          )}
          <button type="submit" hidden aria-hidden tabIndex={-1} disabled={busy} />
        </form>
        <div className="scheduled-form-foot">
          <Button variant="secondary" onClick={close}>
            取消
          </Button>
          <Button variant="primary" disabled={!!problem || busy} tip={problem ?? undefined} onClick={() => void save()}>
            {editing ? "保存" : "创建"}
          </Button>
        </div>
      </Dialog>
      {browsing && (
        <FolderDialog
          initialPath={draft.place.kind === "projectless" ? undefined : draft.place.cwd || undefined}
          title="为此定时任务选择文件夹"
          description=""
          onChoose={(path) => set({ place: placeFor(path, getState().projects) })}
          onClose={() => setBrowsing(false)}
        />
      )}
      {/* c13c65b88 t, as nt / yt in c9e1458cd show it (EnvironmentDialog's ConfirmClose): Keep editing first. */}
      {confirming && (
        <Dialog alert size="sm" title="放弃未保存的更改？" description="您的更改尚未保存，将会丢失。" onClose={() => setConfirming(false)} footer={
          <>
            <Button variant="secondary" data-autofocus onClick={() => setConfirming(false)}>继续编辑</Button>
            <Button variant="danger" onClick={() => onClose()}>放弃</Button>
          </>
        } />
      )}
    </>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="scheduled-form-row">
      <span className="scheduled-form-label">{label}</span>
      <span className="scheduled-form-row-end">{children}</span>
    </div>
  );
}

/**
 * ChatGPT's settings.automations.banner.* for the sandbox a run gets (cronPermissions over the
 * default settings), Codex for ChatGPT and 您 for 你, without the rules link. A run asks for no
 * approvals where the requirements allow that and no auto-review takes them.
 */
function sandboxNote(s: AppState): string {
  const { permission, approvalPolicy } = cronPermissions(effectiveSettings(null), s.requirements?.allowedApprovalPolicies);
  const sandbox = permission && PRESETS[permission].sandbox;
  if (sandbox === "read-only") return "定时任务会使用您的默认沙盒设置运行，该设置为只读。若工具调用需要修改文件、访问网络或操作电脑上的应用，将会失败。建议将沙盒设置更新为工作空间写入。";
  if (sandbox === "danger-full-access") return "定时任务会使用您的默认沙盒设置，目前设为完整访问权限。在后台以完整访问权限运行定时任务会带来更高风险，因为 Codex 可能会在不询问的情况下修改文件、运行命令并访问网络。建议将沙盒设置更新为工作空间写入权限。";
  return `定时任务会使用您配置的沙盒设置。无项目任务可以在其任务文件夹中写入文件，其网络访问权限会遵循您配置的设置。${approvalPolicy === "never" ? "这些任务无人值守运行，不会显示审批提示。" : "运行中需要审批时会照常请求审批。"}`;
}

/** The bar's folder pill (c0fd2fda3 Dt / bt): 项目, 最近, 不在项目中工作, then 选择其他文件夹… (the folder dialog, not the composer's folder). */
function FolderPicker({ place, onPick, onBrowse }: { place: Place; onPick(place: Place): void; onBrowse(): void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const projects = useStore((s) => s.projects);
  const { recent } = useRecentFolders();
  const choices = folderChoices(projects, recent, query);
  const all = folderChoices(projects, recent);
  const nameOf = (id: string, cwd: string) => projects.find((p) => p.id === id)?.name ?? basename(cwd);
  const label = place.kind === "projectless" ? "不在项目中工作" : place.kind === "project" ? nameOf(place.projectId, place.cwd) : basename(place.cwd);
  const shut = () => {
    setOpen(false);
    setQuery("");
  };
  const pick = (next: Place) => {
    shut();
    onPick(next);
  };
  const pill = (
    <Button variant="ghost" size="xs" ink2 className="place-pill" icon={<Icon name="Folder" />} title={place.kind === "projectless" ? undefined : homeRelative(place.cwd)} aria-label={`文件夹：${label}`} onClick={() => setOpen(!open)}>
      <span className="btn-label">{label}</span>
    </Button>
  );
  return (
    <Popover open={open} onClose={shut} className="scheduled-form-menu" anchor={pill}>
      {localProjects(projects).length + all.folders.length > 8 && <MenuSearch label="搜索文件夹…" value={query} onChange={setQuery} />}
      {choices.projects.length > 0 && <MenuSection title="项目" />}
      {choices.projects.map((p) => (
        <MenuItem key={p.projectId} label={nameOf(p.projectId, p.cwd)} title={p.cwd} checked={place.kind === "project" && place.projectId === p.projectId} onClick={() => pick(p)} />
      ))}
      {choices.folders.length > 0 && <MenuSection title="最近" />}
      {choices.folders.map((path) => (
        <MenuItem key={path} label={basename(path)} title={path} checked={place.kind === "folder" && samePath(place.cwd, path)} onClick={() => pick({ kind: "folder", cwd: path })} />
      ))}
      {query.trim() && !choices.projects.length && !choices.folders.length && <div className="menu-none">没有匹配的文件夹</div>}
      {(choices.projects.length > 0 || choices.folders.length > 0) && <MenuSep />}
      <MenuItem label="不在项目中工作" checked={place.kind === "projectless"} onClick={() => pick(NONE)} />
      <MenuSep />
      <MenuItem
        label="选择其他文件夹…"
        onClick={() => {
          shut();
          onBrowse();
        }}
      />
    </Popover>
  );
}

/**
 * 运行于 (ChatGPT's destination menu with its thread picker in it): 搜索会话 over 每次运行时新建会话 and
 * 此任务的新会话 (a new task's only), then the loaded sessions a heartbeat can watch
 * (lib/scheduled-form sessionChoices). An edited heartbeat picks among the sessions alone.
 * ponytail: one flat list, not ChatGPT's pinned / per-project groups.
 */
function RunsIn({ draft, editing, onChange }: { draft: Draft; editing: string | null; onChange(patch: Partial<Draft>): void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ids = useStore((s) => s.list.ids);
  const threads = useStore((s) => s.threads);
  const items = useAutomations((s) => s.items);
  const choices = sessionChoices(ids, threads, items ?? [], editing, isArchivedThread, query);
  const value = draft.destination === "thread" ? draft.targetThreadId : null;
  const session = value ? (threads[value] ? threadTitle(threads[value].meta) : "会话不可用") : "选择会话…";
  const title = draft.destination === "cron" ? "每次运行时新建会话" : draft.destination === "dedicated" ? "此任务的新会话" : session;
  const pick = (patch: Partial<Draft>) => {
    setOpen(false);
    setQuery("");
    onChange(patch);
  };
  return (
    <Popover
      open={open}
      onClose={() => pick({})}
      placement="bottom-end"
      className="scheduled-form-menu"
      anchor={
        <Button variant="ghost" className="menu-select" aria-label={`运行于：${title}`} onClick={() => setOpen(!open)}>
          <span className="menu-select-value">{title}</span>
          <Icon name="CaretDown" size="sm" className="caret" />
        </Button>
      }
    >
      <MenuSearch label="搜索会话" value={query} onChange={setQuery} onSubmit={() => choices[0] && pick({ destination: "thread", targetThreadId: choices[0].id })} />
      {!editing && !query.trim() && (
        <>
          <MenuItem label="每次运行时新建会话" checked={draft.destination === "cron"} onClick={() => pick({ destination: "cron" })} />
          <MenuItem label="此任务的新会话" checked={draft.destination === "dedicated"} onClick={() => pick({ destination: "dedicated" })} />
          <MenuSep />
        </>
      )}
      {!query.trim() && <MenuSection title="会话" />}
      {choices.length ? (
        choices.map((choice) => <MenuItem key={choice.id} label={choice.title} checked={choice.id === value} onClick={() => pick({ destination: "thread", targetThreadId: choice.id })} />)
      ) : (
        <div className="menu-none">未找到会话</div>
      )}
    </Popover>
  );
}

/**
 * 定时 (c0fd2fda3 Wt with the ChatGPT app's modes): the mode, then its fields. Each step writes the
 * rule again; in 自定义 the RRULE text is the rule, the builder over it greyed while it shows a rule
 * the builder cannot.
 */
function ScheduleEditor({ draft, heartbeat, onChange }: { draft: Draft; heartbeat: boolean; onChange(draft: Draft): void }) {
  const { every, unit } = intervalOf(draft.rrule);
  const { weekdays, time } = scheduleOf(draft.rrule);
  const rule = parseRrule(draft.rrule);
  return (
    <div className="scheduled-form-schedule">
      {/* Claude Wt's frequency buttons (c14edbe0a x / S / C / w), not a sliding segmented control. */}
      <span className="scheduled-form-days" role="group" aria-label="定时">
        {MODES.map((mode) => (
          <button key={mode.value} type="button" className="scheduled-form-day" aria-pressed={draft.mode === mode.value} onClick={() => onChange(withMode(draft, mode.value))}>
            {mode.label}
          </button>
        ))}
      </span>
      {draft.mode === "hourly" && (
        <div className="scheduled-form-line">
          <span>每隔</span>
          <NumberInput label="运行频率数值" value={every} min={1} max={999} onChange={(n) => onChange(withInterval(draft, n, unit))} />
          {/* Minutes are a heartbeat's (a cron task's rule that has them keeps showing them). */}
          {heartbeat || unit === "minute" ? (
            <MenuSelect
              label="运行频率单位"
              value={unit}
              options={[
                { value: "hour", label: "小时" },
                { value: "minute", label: "分钟" },
              ]}
              onChange={(next) => onChange(withInterval(draft, next === "minute" ? every * 60 : Math.max(1, Math.round(every / 60)), next))}
            />
          ) : (
            <span>小时</span>
          )}
        </div>
      )}
      {draft.mode === "weekly" && (
        <div className="scheduled-form-line">
          <span>每周</span>
          <Days days={weekdays} onToggle={(day) => onChange(withDay(draft, day))} />
        </div>
      )}
      {(draft.mode === "daily" || draft.mode === "weekdays" || draft.mode === "weekly") && (
        <div className="scheduled-form-line">
          <span>时间</span>
          <input type="time" step={60} className="input scheduled-time" aria-label="时间" value={time} onChange={(event) => event.target.value && onChange(withTime(draft, event.target.value))} />
        </div>
      )}
      {draft.mode === "custom" && <CustomSchedule draft={draft} onChange={onChange} />}
      {/* Wt's v.jitterHint, where a run is jittered (jitterSpan: not a one-time, monthly or yearly rule, nor minutes under an hour). */}
      {rule && jitterSpan(rule) > 0 && <p className="scheduled-form-hint">为保证服务器性能，定时任务会使用数分钟的随机延迟。</p>}
    </div>
  );
}

const FALLBACK_BUILDER: Builder = { frequency: "daily", interval: 1, weekdays: ["MO"], month: 1, monthDays: [1], time: "09:00", minute: 0 };

/** 自定义: the ChatGPT app's builder (重复, 每隔, 在第几分钟, 星期几, 在以下日期, 在, 时间) over the RRULE text. */
function CustomSchedule({ draft, onChange }: { draft: Draft; onChange(draft: Draft): void }) {
  const builder = builderOf(draft.rrule);
  const b = builder ?? FALLBACK_BUILDER;
  const put = (patch: Partial<Builder>) => onChange({ ...draft, rrule: builderRrule({ ...b, ...patch }) });
  const problem = draft.rrule.trim() ? rruleProblem(draft.rrule, Date.now()) : { message: "请输入有效的 RRULE" };
  const toggle = <T,>(list: readonly T[], item: T) => (list.includes(item) ? list.filter((other) => other !== item) : [...list, item]);
  const { frequency } = b;
  return (
    <>
      <fieldset className="scheduled-form-builder" disabled={!builder}>
        <span>重复</span>
        <span>
          <MenuSelect label="重复" value={frequency} options={FREQUENCIES} disabled={!builder} onChange={(next) => put({ frequency: next })} />
        </span>
        <span>每隔</span>
        <span className="scheduled-form-line">
          <NumberInput label="重复间隔" value={b.interval} min={1} max={999} onChange={(interval) => put({ interval })} />
          <span>{FREQUENCIES.find((f) => f.value === frequency)?.unit}</span>
        </span>
        {frequency === "hourly" && (
          <>
            <span>在第几分钟</span>
            <span>
              <NumberInput label="整点后的分钟数" value={b.minute} min={0} max={59} onChange={(minute) => put({ minute })} />
            </span>
          </>
        )}
        {frequency === "weekly" && (
          <>
            <span>星期几</span>
            <Days days={b.weekdays} onToggle={(day) => b.weekdays.length > 1 || !b.weekdays.includes(day) ? put({ weekdays: toggle(b.weekdays, day) }) : undefined} />
          </>
        )}
        {frequency === "yearly" && (
          <>
            <span>在</span>
            <span>
              <MenuSelect label="月份" value={String(b.month)} options={MONTHS} disabled={!builder} onChange={(month) => put({ month: Number(month) })} />
            </span>
          </>
        )}
        {(frequency === "monthly" || frequency === "yearly") && (
          <>
            <span>在以下日期</span>
            <span className="scheduled-form-days scheduled-form-monthdays" role="group" aria-label="每月日期">
              {Array.from({ length: 31 }, (_, i) => i + 1).map((day) => (
                <button
                  key={day}
                  type="button"
                  className="scheduled-form-day"
                  aria-pressed={b.monthDays.includes(day)}
                  onClick={() => (b.monthDays.length > 1 || !b.monthDays.includes(day) ? put({ monthDays: toggle(b.monthDays, day) }) : undefined)}
                >
                  {day}
                </button>
              ))}
            </span>
          </>
        )}
        {frequency !== "hourly" && (
          <>
            <span>时间</span>
            <span>
              <input type="time" step={60} className="input scheduled-time" aria-label="时间" value={b.time} onChange={(event) => event.target.value && put({ time: event.target.value })} />
            </span>
          </>
        )}
      </fieldset>
      <label className="scheduled-form-field scheduled-form-raw" title="使用 RRULE 定义自定义日程">
        <span className="scheduled-form-label">RRULE</span>
        <input
          className="input scheduled-form-rrule"
          dir="ltr"
          spellCheck={false}
          autoComplete="off"
          placeholder="RRULE:FREQ=MONTHLY;BYMONTHDAY=1;BYHOUR=9;BYMINUTE=0"
          aria-invalid={problem ? true : undefined}
          value={draft.rrule}
          onChange={(event) => onChange({ ...draft, rrule: event.target.value })}
        />
        <span className={problem ? "scheduled-form-error" : "scheduled-form-hint"}>{problem ? problem.message : describeRrule(draft.rrule)}</span>
      </label>
    </>
  );
}

/** The weekday toggles (Claude's frequency buttons c14edbe0a x / S / C / w, several on at once), Monday first. */
function Days({ days, onToggle }: { days: readonly Weekday[]; onToggle(day: Weekday): void }) {
  return (
    <span className="scheduled-form-days" role="group" aria-label="星期几">
      {WEEK.map(([day, label]) => (
        <button key={day} type="button" className="scheduled-form-day" aria-pressed={days.includes(day)} onClick={() => onToggle(day)}>
          {label}
        </button>
      ))}
    </span>
  );
}

/** A whole number in [min, max]: what is typed stays until it is one, and goes back to the value on blur. */
function NumberInput({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange(value: number): void }) {
  const [text, setText] = useState(String(value));
  const [shown, setShown] = useState(value);
  if (value !== shown) {
    setShown(value);
    setText(String(value));
  }
  return (
    <input
      type="number"
      className="input scheduled-form-number"
      aria-label={label}
      min={min}
      max={max}
      step={1}
      value={text}
      onChange={(event) => {
        setText(event.target.value);
        const n = Number(event.target.value);
        if (event.target.value.trim() && Number.isInteger(n) && n >= min && n <= max) onChange(n);
      }}
      onBlur={() => setText(String(value))}
    />
  );
}
