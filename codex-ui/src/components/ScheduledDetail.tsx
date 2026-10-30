// A scheduled task's page on the 定时任务 page (Claude cfc18e0f4 Xe EpitaxyLocalRoutineDetail under
// c9e1458cd's header; not-found and load-failed as c9e1458cd ds), holding the ChatGPT app's fields:
// for a local task where a run goes (运行于), its folder, model, notifications and auto-archive; for
// a cloud one its time zone, schedule and end, conversation, model, latest update and runs (each a
// ChatGPT conversation, opened in the browser), and sharing.
//
// Props (Scheduled.tsx renders it inside the page column, keyed by the task):
// - `task`: the route's { id, source }.
// The page leaves with patchScheduled({ task: null }) and opens the form with
// patchScheduled({ dialog: { type: "form", source, id, seed: null } }) (and a cloud task's sharing
// with { type: "share", id }); Scheduled.tsx names the window and the titlebar's 定时任务 › name from
// the task's name.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { deleteAutomation, refreshAutomations, runNow, setAutomationStatus, useAutomations, type Automation } from "../lib/automations";
import {
  cloudRuns,
  latestBackingRun,
  openCloudRun,
  readCloudAutomation,
  removeCloudAutomation,
  runCloudNow,
  scheduleParts,
  setCloudStatus,
  useCloudAutomations,
  watchCloudRuns,
  type CloudRun,
  type CloudRunsPage,
  type CloudUpdate,
} from "../lib/cloud-automations";
import { ensureThreads, errorMessage, fail, markRead, modelLabel, openThread, patchScheduled } from "../lib/codex";
import { homeRelative, threadTitle } from "../lib/format";
import { relativeTime } from "../lib/landing";
import { EXPIRED, cloudCard, dayTime, localCard, runRows, statusOf, zoneLabel, type RunRow } from "../lib/scheduled-view";
import { getState, toast, useStore } from "../lib/store";
import { Markdown } from "./content";
import { EFFORT_LABELS } from "./Composer";
import { Confirm } from "./Settings";
import { Button, Icon, Spinner, StatusDot, Toggle, useNow, type IconName } from "./ui";

export interface ScheduledDetailProps {
  task: { id: string; source: "local" | "cloud" };
}

const back = () => patchScheduled({ task: null });

export function ScheduledDetail({ task }: ScheduledDetailProps) {
  return task.source === "local" ? <LocalDetail id={task.id} /> : <CloudDetail id={task.id} />;
}

/** No such task, or (`failed`) the tasks did not load (ds); `retry` reads again. */
function Missing({ failed = false, retry = () => void refreshAutomations() }: { failed?: boolean; retry?: () => void }) {
  return (
    <div className="plugins-empty" role={failed ? "alert" : undefined}>
      <Icon name="Warning" size={20} className="scheduled-warn" />
      <p className="plugins-empty-title">{failed ? "无法加载此定时任务" : "找不到此定时任务"}</p>
      <div className="scheduled-detail-actions">
        {failed && (
          <Button variant="secondary" size="sm" onClick={retry}>
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

/** A cloud run's row (automations.runs.status): its words and glyph (a spinner while it runs). */
const CLOUD_RUN: Record<CloudRun["status"], { label: string; icon?: IconName }> = {
  in_progress: { label: "正在运行" },
  failed: { label: "运行失败", icon: "XCircle" },
  no_update: { label: "本次运行无更新", icon: "Placeholder" },
  completed: { label: "运行已完成", icon: "CheckCircle" },
};

const dateText = (date: string) => new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeZone: "UTC" }).format(Date.parse(`${date}T00:00:00Z`));

/**
 * A cloud task's page: read anew on opening (gone: 找不到此定时任务, or back to the list once it was
 * here), its runs kept fresh while it shows (lib/cloud-automations watchCloudRuns). Pausing and
 * deleting show at once; running it and opening a run go to ChatGPT in the browser.
 */
function CloudDetail({ id }: { id: string }) {
  const item = useCloudAutomations((s) => s.items?.find((a) => a.id === id));
  const access = useCloudAutomations((s) => s.access);
  const page = useCloudAutomations((s) => s.runs[id]);
  const live = access === "ok" || access === "error";
  // Reading the task on opening: under way, failed, or done (a null answer: no such task).
  const [read, setRead] = useState<"reading" | "failed" | "done">("reading");
  const [deleting, setDeleting] = useState(false);
  const now = useNow(true);
  const load = () => {
    setRead("reading");
    readCloudAutomation(id).then(() => setRead("done"), () => setRead("failed"));
  };
  useEffect(() => {
    if (live) load();
  }, [live]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => (live ? watchCloudRuns(id) : undefined), [id, live]);
  // Gone after it was here (deleted on this page, elsewhere, or the server has it no more): back to the list.
  const seen = useRef(false);
  useEffect(() => {
    if (item) seen.current = true;
    else if (seen.current) back();
  }, [item]);

  if (!item)
    return (live && read === "reading") || access === "unknown" ? (
      <div className="plugins-empty" aria-busy="true">
        <Spinner size={16} label="正在加载定时任务" />
      </div>
    ) : live && read === "failed" ? (
      <Missing failed retry={load} />
    ) : (
      <Missing />
    );

  const card = cloudCard(item, page?.items, now);
  const { until } = scheduleParts(item.schedule, item.timezone);
  const note = card.status === "paused" ? null
    : card.status === "completed" ? (card.oneTime ? "此一次性任务已运行。如需再次运行，请设置新的计划。" : null)
    : item.nextRunAt !== null ? `${card.oneTime ? "运行时间：" : "下次运行："}${dayTime(item.nextRunAt, now, true)}` : null;
  const toggle = (on: boolean) => void setCloudStatus(id, on).catch(fail(on ? "无法启用计划。您可以重试。" : "无法暂停日程安排。您可以重试。"));
  const head = page?.items[0];

  return (
    <>
      <div className="scheduled-detail-head">
        <Button variant="ghost" icon={<Icon name="ArrowLeft" />} label="所有定时任务" onClick={back} />
        <h2 className="plugins-title scheduled-detail-title">{card.name}</h2>
        <div className="scheduled-detail-actions">
          {card.canShare && <Button variant="ghost" icon={<Icon name="Link" />} label="分享" onClick={() => patchScheduled({ dialog: { type: "share", id } })} />}
          {card.canEdit && <Button variant="ghost" icon={<Icon name="Edit" />} label="编辑" onClick={() => patchScheduled({ dialog: { type: "form", source: "cloud", id, seed: null } })} />}
          {card.canDelete && <Button variant="ghost" icon={<Icon name="Trash" />} label="删除" onClick={() => setDeleting(true)} />}
          <Button
            variant="primary"
            icon={<Icon name="Play" />}
            disabled={!card.canRunNow}
            tip={item.triggered ? "事件触发的定时任务不支持手动运行" : "在 ChatGPT 中打开"}
            onClick={() => runCloudNow(id)}
          >
            立即运行
          </Button>
        </div>
      </div>
      <div className="scheduled-detail">
        <div className="scheduled-detail-col">
          <Section title="状态">
            <div className="scheduled-status">
              {card.canPause && (
                <span data-tip={card.expired ? EXPIRED : undefined}>
                  <Toggle checked={card.status === "active"} disabled={card.expired} label={card.status === "active" ? "暂停定时任务" : "启用定时任务"} onChange={toggle} />
                </span>
              )}
              <span className="badge" data-chip={card.status}>
                {card.status === "active" && <Icon name="CheckCircle" size={12} />}
                {CHIP[card.status]}
              </span>
              {note && <span className="scheduled-detail-note">{note}</span>}
            </div>
          </Section>
          <Section title="时区">
            <p className="scheduled-detail-text">
              {item.timezone}（{zoneLabel(item.timezone)}）
            </p>
          </Section>
          <Section title="重复">
            <p className="scheduled-detail-text">
              {card.scheduleText}
              {until && `，重复结束于 ${dateText(until)}`}
            </p>
          </Section>
          <Section title="运行于">
            <p className="scheduled-detail-text">{item.threadMode === "new_chat" ? "每次运行都开启新会话" : "每次运行都使用同一个会话"}</p>
          </Section>
          <Section title="模型">
            <p className="scheduled-detail-text">
              {item.model ? modelLabel(item.model) : "默认"}
              {item.effort && ` · ${EFFORT_LABELS[item.effort] ?? item.effort}`}
            </p>
          </Section>
        </div>
        <div className="scheduled-detail-col">
          <Section title="指令">
            <Instructions prompt={item.prompt} />
          </Section>
          <LatestUpdate id={id} live={live} head={head ? `${head.id}:${head.status}` : ""} now={now} />
          <CloudHistory id={id} runs={page} now={now} />
        </div>
      </div>
      {deleting && (
        <Confirm
          title="删除定时任务？"
          description={`删除“${card.name}”？这将永久删除定时任务，并停止日后的运行。`}
          confirm="删除"
          danger
          onClose={() => setDeleting(false)}
          onConfirm={() => removeCloudAutomation(id).catch(fail("无法删除定时任务。请重试。"))}
        />
      )}
    </>
  );
}

/** A note and its 重试 (the cloud's reads that failed). */
function Retry({ text, onRetry }: { text: string; onRetry(): void }) {
  return (
    <div className="scheduled-retry" role="alert">
      <span className="scheduled-detail-note">{text}</span>
      <Button variant="ghost" size="xs" onClick={onRetry}>
        重试
      </Button>
    </div>
  );
}

/**
 * 最新动态 (detail-panel K / be): the latest run's snapshot in Markdown under its flags (上次运行未成功,
 * 此任务需要您处理), read again when the newest run (`head`) changes; what it showed stays while it does.
 */
function LatestUpdate({ id, live, head, now }: { id: string; live: boolean; head: string; now: number }) {
  const [update, setUpdate] = useState<CloudUpdate | "loading" | "failed">("loading");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!live) return;
    let current = true;
    latestBackingRun(id).then(
      (next) => current && setUpdate(next),
      () => current && setUpdate((shown) => (typeof shown === "object" ? shown : "failed")),
    );
    return () => {
      current = false;
    };
  }, [id, live, head, attempt]);
  const at = typeof update === "object" && update.at !== null ? relativeTime(update.at / 1000, now) : null;
  return (
    <Section title="最新动态" action={at && <span className="scheduled-detail-note">{at}</span>}>
      {update === "loading" ? (
        <p className="scheduled-detail-note">正在加载最新更新</p>
      ) : update === "failed" ? (
        <Retry
          text="无法加载最新更新"
          onRetry={() => {
            setUpdate("loading");
            setAttempt((n) => n + 1);
          }}
        />
      ) : (
        <>
          {(update.failed || update.requiresAction) && (
            <div className="scheduled-status">
              {update.failed && (
                <span className="badge" data-chip="failed">
                  <Icon name="Warning" size={12} />
                  上次运行未成功
                </span>
              )}
              {update.requiresAction && (
                <span className="badge" data-chip="attention">
                  <Icon name="Hand" size={12} />
                  此任务需要您处理
                </span>
              )}
            </div>
          )}
          {update.markdown.trim() ? (
            <div className="scheduled-update">
              <Markdown text={update.markdown} className="prose" />
            </div>
          ) : (
            <p className="scheduled-detail-note">暂无可用更新</p>
          )}
        </>
      )}
    </Section>
  );
}

/**
 * A cloud task's 历史记录 (run-results-state): its runs newest first, 25 at a time with 加载更多; a
 * row marks the run read and opens its ChatGPT conversation.
 */
function CloudHistory({ id, runs, now }: { id: string; runs: CloudRunsPage | undefined; now: number }) {
  const [loading, setLoading] = useState(false);
  const open = (run: CloudRun) => {
    if (!openCloudRun(id, run)) toast("neutral", "本次运行没有可用的会话");
  };
  return (
    <Section title="历史记录">
      {!runs ? (
        <p className="scheduled-detail-note">正在加载运行记录</p>
      ) : runs.error && !runs.items.length ? (
        <Retry text="无法加载任务结果" onRetry={() => void cloudRuns(id)} />
      ) : runs.items.length ? (
        <div className="scheduled-runs">
          {runs.items.map((run) => (
            <button key={run.id} type="button" className="scheduled-run" data-tip={run.chatId ? "在 ChatGPT 中打开" : undefined} onClick={() => open(run)}>
              <span className="scheduled-run-icon" data-state={run.status === "failed" ? "failed" : run.status === "in_progress" ? "running" : "done"}>
                {run.status === "in_progress" ? <Spinner /> : <Icon name={CLOUD_RUN[run.status].icon ?? "CheckCircle"} size={12} />}
              </span>
              <span className="scheduled-run-text">
                <span className="scheduled-run-line">
                  {run.startedAt !== null && <span className="scheduled-run-time">{relativeTime(run.startedAt / 1000, now)}</span>}
                  <span className="scheduled-run-title">{CLOUD_RUN[run.status].label}</span>
                </span>
                {run.summary && <span className="scheduled-run-summary">{run.summary}</span>}
              </span>
              {run.unread && (
                <>
                  <StatusDot kind="unread" />
                  <span className="sr-only">未读</span>
                </>
              )}
            </button>
          ))}
          {runs.cursor && (
            <Button
              variant="ghost"
              size="xs"
              className="scheduled-fold"
              disabled={loading}
              onClick={() => {
                setLoading(true);
                void cloudRuns(id, true).finally(() => setLoading(false));
              }}
            >
              加载更多
            </Button>
          )}
        </div>
      ) : (
        <p className="scheduled-detail-note">暂无运行记录</p>
      )}
    </Section>
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
