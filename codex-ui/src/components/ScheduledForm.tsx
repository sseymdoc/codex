// The new / edit dialog for a scheduled task (Claude c0243d234 EpitaxyLocalRoutineFormDialog in
// c9e1458cd nt, class names from c14edbe0a; the fields of the ChatGPT app's local editor).
//
// Props:
// - `dialog`: the route's form dialog. `id` null makes a new task from `seed` (a suggestion's name,
//   prompt and rrule; `kind: "heartbeat"` with `targetThreadId` a session's id, or null for 此任务的新会话
//   (lib/automations.ts createHeartbeatSession)); otherwise it edits that task. `source` "cloud" is
//   the cloud phase's.
// - `onClose`: closes it, after a save too. The page passes patchScheduled({ dialog: null }); the form
//   holds no route of its own, so a session's menu can show it from its own state as well.
//
// First version: 名称, 指令 and the schedule's time of day (the rest of the rule kept as it is), a new
// cron task working in the composer's folder.

import { useState } from "react";
import { DEFAULT_SCHEDULE, describeRrule, rruleOf, rruleProblem, scheduleOf } from "../../context/rrule.mjs";
import { createAutomation, createHeartbeatSession, updateAutomation, useAutomations } from "../lib/automations";
import { errorMessage } from "../lib/codex";
import { homeRelative } from "../lib/format";
import { defaultName } from "../lib/scheduled-view";
import { getState, toast, type ScheduledDialog } from "../lib/store";
import { Button, Dialog } from "./ui";

export type ScheduledFormDialog = Extract<ScheduledDialog, { type: "form" }>;

export interface ScheduledFormProps {
  dialog: ScheduledFormDialog;
  onClose(): void;
}

const TIMED = ["daily", "weekdays", "weekly", "monthly"];

export function ScheduledForm({ dialog, onClose }: ScheduledFormProps) {
  const task = useAutomations((s) => (dialog.id ? s.items?.find((a) => a.id === dialog.id) : undefined));
  const seed = dialog.seed ?? {};
  const editing = dialog.id !== null;
  const heartbeat = (task?.kind ?? seed.kind) === "heartbeat";
  const [name, setName] = useState(task?.name ?? seed.name ?? "");
  const [prompt, setPrompt] = useState(task?.prompt ?? seed.prompt ?? "");
  const [rrule, setRrule] = useState(task?.rrule ?? seed.rrule ?? rruleOf(DEFAULT_SCHEDULE));
  const [busy, setBusy] = useState(false);
  const cwd = getState().prefs.cwd;
  const schedule = scheduleOf(rrule);
  const problem =
    editing && !task ? "找不到此定时任务" : editing && !name.trim() ? "请输入名称。" : !prompt.trim() ? "添加指令。" : rruleProblem(rrule, Date.now()) ? "请输入有效的日程安排。" : null;
  const save = async () => {
    if (problem || busy) return;
    setBusy(true);
    const shown = defaultName(name, prompt);
    try {
      if (task) await updateAutomation(task.id, { name, prompt, rrule });
      else if (heartbeat && seed.targetThreadId) await createAutomation({ kind: "heartbeat", name, prompt, rrule, targetThreadId: seed.targetThreadId });
      else if (heartbeat) await createHeartbeatSession({ name, prompt, rrule });
      else await createAutomation({ kind: "cron", name, prompt, rrule, cwds: cwd ? [cwd] : [], executionEnvironment: "local" });
      toast("neutral", task ? `“${shown}”已更新。` : `已创建“${shown}”。`);
      onClose();
    } catch (error) {
      toast("warning", task ? "无法更新定时任务。您可以重试。" : "创建定时任务失败。您可以重试。", errorMessage(error));
      setBusy(false);
    }
  };
  return (
    <Dialog
      title={editing ? "编辑定时任务" : "新建本地定时任务"}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" disabled={!!problem || busy} tip={problem ?? undefined} onClick={() => void save()}>
            {editing ? "保存" : "创建"}
          </Button>
        </>
      }
    >
      <form
        className="plugins-form"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <label className="plugins-field">
          <span>名称</span>
          <input className="input" placeholder="每日代码审查" value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label className="plugins-field">
          <span>指令</span>
          <textarea
            className="input"
            rows={5}
            placeholder="查看过去 24 小时内的提交。总结更改内容，指出任何有风险的模式或缺失的测试，并记录任何值得跟进的事项。"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
          />
        </label>
        <div className="plugins-field">
          <span>定时</span>
          <span className="plugins-note">{describeRrule(rrule)}</span>
          {TIMED.includes(schedule.mode) && (
            <input type="time" step={60} className="input scheduled-time" aria-label="时间" value={schedule.time} onChange={(event) => event.target.value && setRrule(rruleOf({ ...schedule, time: event.target.value }))} />
          )}
        </div>
        {!editing && !heartbeat && (
          <div className="plugins-field">
            <span>文件夹</span>
            <span className="plugins-note">{cwd ? homeRelative(cwd) : "不在项目中工作"}</span>
          </div>
        )}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
