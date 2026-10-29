// A scheduled task's page on the 定时任务 page (Claude cfc18e0f4 Xe EpitaxyLocalRoutineDetail under
// c9e1458cd's header; not-found and load-failed as c9e1458cd ds), holding the ChatGPT app's fields:
// where a run goes (运行于), its folder, model, notifications and auto-archive.
//
// Props (Scheduled.tsx renders it inside the page column, keyed by the task):
// - `task`: the route's { id, source }.
// The page leaves with patchScheduled({ task: null }) and opens the form with
// patchScheduled({ dialog: { type: "form", source, id, seed: null } }); Scheduled.tsx names the window
// and the titlebar's 定时任务 › name from the task's name.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { deleteAutomation, refreshAutomations, runNow, setAutomationStatus, useAutomations, type Automation } from "../lib/automations";
import { ensureThreads, errorMessage, fail, markRead, modelLabel, openThread, patchScheduled } from "../lib/codex";
import { homeRelative, threadTitle } from "../lib/format";
import { relativeTime } from "../lib/landing";
import { localCard, runRows, statusOf, type RunRow } from "../lib/scheduled-view";
import { getState, toast, useStore } from "../lib/store";
import { EFFORT_LABELS } from "./Composer";
import { Confirm } from "./Settings";
import { Button, Icon, Spinner, StatusDot, Toggle, useNow } from "./ui";

export interface ScheduledDetailProps {
  task: { id: string; source: "local" | "cloud" };
}

const back = () => patchScheduled({ task: null });

export function ScheduledDetail({ task }: ScheduledDetailProps) {
  // A cloud task's page comes with the cloud tasks; until then such a link finds nothing.
  return task.source === "local" ? <LocalDetail id={task.id} /> : <Missing />;
}

/** No such task, or (`failed`) the tasks did not load (ds). */
function Missing({ failed = false }: { failed?: boolean }) {
  return (
    <div className="plugins-empty" role={failed ? "alert" : undefined}>
      <Icon name="Warning" size={20} className="scheduled-warn" />
      <p className="plugins-empty-title">{failed ? "无法加载此定时任务" : "找不到此定时任务"}</p>
      <div className="scheduled-detail-actions">
        {failed && (
          <Button variant="secondary" size="sm" onClick={() => void refreshAutomations()}>
            重试
          </Button>
        )}
        <Button variant="secondary" size="sm" onClick={back}>
          所有定时任务
        </Button>
      </div>
    </div>
  );
}

/** A section (c9e1458cd Ze): its muted heading, an action at the end of it, the content. */
function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="scheduled-section">
      <div className="scheduled-section-head">
        <h3 className="scheduled-section-title">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

const CHIP = { active: "已启用", paused: "已暂停", completed: "已运行" };

function LocalDetail({ id }: { id: string }) {
  const item = useAutomations((s) => s.items?.find((a) => a.id === id));
  const loaded = useAutomations((s) => s.items !== null);
  const error = useAutomations((s) => s.error);
  const runs = useAutomations((s) => s.runs);
  const threads = useStore((s) => s.threads);
  const projects = useStore((s) => s.projects);
  // 暂停 / 启用 shows at once and goes back if the change fails.
  const [status, setStatus] = useState<Automation["status"] | null>(null);
  const [starting, setStarting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const now = useNow(true);
  // Gone after it was here (deleted on this page, another page, the other process): back to the list.
  const seen = useRef(false);
  useEffect(() => {
    if (item) seen.current = true;
    else if (seen.current) back();
  }, [item]);
  // A heartbeat names its session, which the sidebar may not have listed.
  const target = item?.kind === "heartbeat" ? item.targetThreadId : undefined;
  useEffect(() => {
    if (target && !getState().threads[target]) void ensureThreads([target]);
  }, [target]);

  if (!item)
    return loaded ? (
      <Missing />
    ) : error ? (
      <Missing failed />
    ) : (
      <div className="plugins-empty" aria-busy="true">
        <Spinner size={16} label="正在加载定时任务" />
      </div>
    );

  const shown: Automation = status ? { ...item, status } : item;
  const card = localCard(shown, runs, threads, projects);
  // A 启用 under way has no next run yet, which statusOf would read as a one-time task that ran.
  const state = status === "ACTIVE" ? { chip: "active" as const, note: null } : statusOf(shown, now);
  const cron = item.kind === "cron";
  const busy = starting || item.running;
  const session = target ? threads[target] : undefined;
  const folder = item.target?.type === "project" ? { label: card.place.label, path: card.cwd } : card.cwd ? { label: homeRelative(card.cwd), path: card.cwd } : null;
  // A long path gives way from its folders, its last name kept (c784da984's path label).
  const cut = folder ? Math.max(folder.label.lastIndexOf("/", folder.label.length - 2), folder.label.lastIndexOf("\\", folder.label.length - 2)) + 1 : 0;

  const run = () => {
    setStarting(true);
    runNow(id)
      .catch((cause) => toast("warning", `无法启动“${card.name}”。请重试。`, errorMessage(cause)))
      .finally(() => setStarting(false));
  };
  const toggle = (on: boolean) => {
    setStatus(on ? "ACTIVE" : "PAUSED");
    setAutomationStatus(id, on ? "ACTIVE" : "PAUSED")
      .catch(fail(on ? "无法启用计划。您可以重试。" : "无法暂停日程安排。您可以重试。"))
      .finally(() => setStatus(null));
  };

  return (
    <>
      <div className="scheduled-detail-head">
        <Button variant="ghost" icon={<Icon name="ArrowLeft" />} label="所有定时任务" onClick={back} />
        <h2 className="plugins-title scheduled-detail-title">{card.name}</h2>
        <div className="scheduled-detail-actions">
          <Button variant="ghost" icon={<Icon name="Edit" />} label="编辑" onClick={() => patchScheduled({ dialog: { type: "form", source: "local", id, seed: null } })} />
          <Button variant="ghost" icon={<Icon name="Trash" />} label="删除" onClick={() => setDeleting(true)} />
          <Button
            variant="primary"
            icon={busy ? <Spinner inherit /> : <Icon name="Play" />}
            disabled={busy || !item.prompt.trim()}
            aria-busy={busy || undefined}
            tip={item.prompt.trim() ? undefined : "找不到定时任务文件，或文件格式异常。"}
            onClick={run}
          >
            {busy ? "进行中" : "立即运行"}
          </Button>
        </div>
      </div>
      <div className="scheduled-detail">
        <div className="scheduled-detail-col">
          <Section title="状态">
            <div className="scheduled-status">
              {state.chip !== "completed" && <Toggle checked={shown.status === "ACTIVE"} label={shown.status === "ACTIVE" ? "暂停定时任务" : "启用定时任务"} onChange={toggle} />}
              <span className="badge" data-chip={state.chip}>
                {state.chip === "active" && <Icon name="CheckCircle" size={12} />}
                {CHIP[state.chip]}
              </span>
              {state.note && <span className="scheduled-detail-note">{state.note}</span>}
            </div>
          </Section>
          <Section title="运行于">
            {cron ? (
              <p className="scheduled-detail-text">每次运行时新建会话</p>
            ) : session ? (
              <button type="button" className="scheduled-chip" onClick={() => void openThread(session.meta.id)}>
                <Icon name="ChatSimple" size={12} />
                <span>{threadTitle(session.meta)}</span>
              </button>
            ) : (
              <p className="scheduled-detail-text">会话不可用</p>
            )}
          </Section>
          {cron && (
            <Section title="文件夹">
              {folder ? (
                <span className="scheduled-chip" data-tip={folder.path ?? undefined}>
                  <Icon name="Folder" size={12} />
                  <span className="scheduled-path-head">{folder.label.slice(0, cut)}</span>
                  <span className="scheduled-path-tail">
                    {folder.label.slice(cut)}
                    {item.executionEnvironment === "worktree" && " · 工作树"}
                  </span>
                </span>
              ) : (
                <p className="scheduled-detail-text">不在项目中工作</p>
              )}
            </Section>
          )}
          <Section title="重复">
            <p className="scheduled-detail-text">{card.scheduleText}</p>
          </Section>
          {cron && (
            <Section title="模型">
              <p className="scheduled-detail-text">
                {item.model ? modelLabel(item.model) : "默认"}
                {item.reasoningEffort && ` · ${EFFORT_LABELS[item.reasoningEffort] ?? item.reasoningEffort}`}
              </p>
            </Section>
          )}
          <Section title="通知">
            <p className="scheduled-detail-text">{item.notificationPolicy === "failed_runs_only" ? "仅限未成功运行" : cron ? "所有运行" : "重要更新"}</p>
          </Section>
          {cron && (
            <Section title="归档成功运行记录">
              <p className="scheduled-detail-text">{item.autoArchive ? "已开启" : "已关闭"}</p>
            </Section>
          )}
        </div>
        <div className="scheduled-detail-col">
          <Section title="指令">
            <Instructions prompt={item.prompt} />
          </Section>
          {/* ponytail: a heartbeat keeps no run records (ChatGPT's neither); its runs are its session's turns. */}
          {cron && <History rows={runRows(runs, id, threads)} now={now} />}
        </div>
      </div>
      {deleting && (
        <Confirm
          title="删除定时任务？"
          description={`删除“${card.name}”？这将永久删除定时任务，并停止日后的运行。`}
          confirm="删除"
          danger
          onClose={() => setDeleting(false)}
          onConfirm={() => deleteAutomation(id).catch(fail("无法删除定时任务。请重试。"))}
        />
      )}
    </>
  );
}

/** The instructions, folded to three lines past three lines or about 270 characters (Ke). */
function Instructions({ prompt }: { prompt: string }) {
  const [open, setOpen] = useState(false);
  if (!prompt.trim()) return <p className="scheduled-detail-note">找不到定时任务文件，或文件格式异常。</p>;
  const long = prompt.split("\n").length > 3 || prompt.length > 270;
  return (
    <>
      <div className="scheduled-text scheduled-prompt" data-folded={(long && !open) || undefined}>
        {prompt}
      </div>
      {long && (
        <Button variant="ghost" size="xs" className="scheduled-fold" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? "收起" : "显示全部"}
          <Icon name="CaretDown" size="sm" />
        </Button>
      )}
    </>
  );
}

const PAGE = 100;

/** 历史记录 (tt): a cron task's runs, a hundred at a time, each opening its session (H). */
function History({ rows, now }: { rows: RunRow[]; now: number }) {
  const [limit, setLimit] = useState(PAGE);
  const unread = rows.filter((row) => row.unread);
  const readAll = (
    <Button variant="ghost" size="xs" onClick={() => unread.forEach((row) => void markRead(row.threadId))}>
      全部标记为已读
    </Button>
  );
  return (
    <Section title="历史记录" action={unread.length > 0 && readAll}>
      {rows.length ? (
        <div className="scheduled-runs">
          {rows.slice(0, limit).map((row) => (
            <button key={row.threadId} type="button" className="scheduled-run" onClick={() => void openThread(row.threadId)}>
              <span className="scheduled-run-icon" data-state={row.state}>
                {row.state === "running" ? <Spinner /> : <Icon name={row.state === "failed" ? "XCircle" : "CheckCircle"} size={12} />}
              </span>
              <span className="scheduled-run-text">
                <span className="scheduled-run-line">
                  <span className="scheduled-run-time">{relativeTime(row.at / 1000, now)}</span>
                  {row.title && <span className="scheduled-run-title">{row.title}</span>}
                </span>
                {row.summary && <span className="scheduled-run-summary">{row.summary}</span>}
              </span>
              {row.state !== "done" ? (
                <span className="scheduled-run-state">{row.state === "failed" ? "失败" : "运行中"}</span>
              ) : (
                row.unread && (
                  <>
                    <StatusDot kind="unread" />
                    <span className="sr-only">未读的已完成运行</span>
                  </>
                )
              )}
              {row.archived && (
                <span className="scheduled-run-state" data-tip="运行记录已归档">
                  <Icon name="Archive" size={12} />
                  <span className="sr-only">运行记录已归档</span>
                </span>
              )}
            </button>
          ))}
          {rows.length > limit && (
            <Button variant="ghost" size="xs" className="scheduled-fold" onClick={() => setLimit(limit + PAGE)}>
              显示更多
            </Button>
          )}
        </div>
      ) : (
        <p className="scheduled-detail-note">暂无运行记录</p>
      )}
    </Section>
  );
}
