// The new-session (draft) page's start card in Claude's own markup (Claude Desktop 3.1623.4 ion-dist
// cc43287c9 with the session-presets flag on, as the user's Claude runs it): BG / FG the column
// that centres it above the docked composer, Uae the card, X5 / v5 / y5 its rows, Aae the next
// steps. The class strings are Claude's, so are their rules (scripts/claude-css.mjs →
// styles/claude.generated.css). Codex runs here only, so an environment is a folder; with no
// worktrees, pull requests or suggested tasks the next steps are the sessions waiting on the user
// and 继续未提交的工作.

import { useEffect, useId, useLayoutEffect, useRef, useState, type FocusEvent, type MouseEvent, type ReactNode, type Ref } from "react";
import type { ServerRequest } from "@protocol/ServerRequest";
import { chooseProject, folderStatus, isArchivedThread, openThread, projectFor, requestThreadId, type FolderStatus } from "../lib/codex";
import { homeRelative, localEnvironments, samePath } from "../lib/format";
import { continues, dismiss, seat, type Dismissals } from "../lib/landing";
import { waitingQuestions } from "../lib/questions";
import { useStore, writePref, type ThreadState } from "../lib/store";
import { EnvironmentMenu, chooseFolder, setComposerDraft, useRecentFolders } from "./Composer";
import { Button, Icon, Popover, type IconName } from "./ui";

/** Dismissed next steps (cc43287c9 Wie startCardDismissals). */
const DISMISSED_KEY = "codex-ui:start-card";

type Ask = "question" | "permission" | "error";
// P5: 已提出问题 / 需要权限 / 遇到错误.
const ASKS: Record<Ask, string> = { question: "已提出问题", permission: "需要权限", error: "遇到错误" };

type SessionStep = { kind: "session"; id: string; title: string; ask: Ask; at: number };
type Step = SessionStep | { kind: "continue"; folder: string; branch: string; files: number };

// O5 / z5: the step's key (codex-ui's own spelling, which stored dismissals use), and the stamp a
// dismissal is held against.
const stepKey = (step: Step) => (step.kind === "session" ? `session:${step.id}` : `continue:${step.folder}\u0000${step.branch}`);
const stepStamp = (step: Step) => String(step.kind === "session" ? step.at : step.files);

function readDismissed(): Dismissals {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? "null");
    return value && typeof value === "object" ? (value as Dismissals) : {};
  } catch {
    return {};
  }
}

const focusComposer = () => requestAnimationFrame(() => document.querySelector<HTMLElement>(".composer-input")?.focus());

/**
 * Sessions waiting on the user, newest first (cc43287c9 mae: an approval needs permission, the rest
 * asked a question, mid-turn ones too), then the newest one in this folder that stopped on an error.
 * Untitled sessions stay out.
 */
function blockedSessions(ids: Iterable<string>, threads: Record<string, ThreadState>, requests: ServerRequest[], settled: ReadonlySet<string>, cwd: string): SessionStep[] {
  const asks = new Map<string, Ask>();
  for (const request of requests) {
    const id = requestThreadId(request);
    const ask = request.method === "item/tool/requestUserInput" || request.method === "mcpServer/elicitation/request" ? "question" : "permission";
    if (id && asks.get(id) !== "permission") asks.set(id, ask);
  }
  const waiting: SessionStep[] = [];
  let failed: SessionStep | null = null;
  for (const id of ids) {
    const meta = threads[id]?.meta;
    const title = meta?.name?.trim() || meta?.preview?.trim().split("\n")[0] || "";
    if (!meta || !title) continue;
    const { status } = meta;
    const at = meta.recencyAt ?? meta.updatedAt;
    const flagged = status.type === "active" && status.activeFlags.length > 0 ? (status.activeFlags.includes("waitingOnApproval") ? "permission" : "question") : null;
    const ask = asks.get(id) ?? flagged ?? (waitingQuestions(threads[id], settled).length ? "question" : null);
    if (ask) waiting.push({ kind: "session", id, title, ask, at });
    else if (status.type === "systemError" && samePath(meta.cwd, cwd) && (!failed || at > failed.at)) failed = { kind: "session", id, title, ask: "error", at };
  }
  waiting.sort((a, b) => b.at - a.at);
  return failed ? [...waiting, failed] : waiting;
}

// cc43287c9 h5 (a row), g5 (its muted parts, secondary while the row is hot), zie / Bie (the detail),
// Vie (the room a dismiss X takes), Hie (where the X sits), G5 (a card), jG (setup rows that drop out).
const ROW = "flex h-8 w-full min-w-0 items-center gap-2 rounded-lg px-2 text-start text-body leading-5";
const DIM = "text-muted-as-secondary group-hover/row:text-secondary group-has-[:focus-visible]/row:text-secondary group-has-[[aria-expanded=true]]/row:text-secondary";
const DETAIL = "min-w-0 max-w-max grow basis-24 truncate";
const ROOM = "hidden shrink-0 items-center group-hover/row:flex group-has-[:focus-visible]/row:flex group-has-[[aria-expanded=true]]/row:flex touch:flex";
const END = "pointer-events-none absolute inset-y-0 end-1 flex items-center opacity-0 group-hover/row:opacity-100 group-has-[:focus-visible]/row:opacity-100 group-has-[[aria-expanded=true]]/row:opacity-100 touch:opacity-100";
const CARD = "flex w-80 max-w-full shrink-0 flex-col rounded-xl shadow-card-ring bg-[var(--epitaxy-transcript-surface,var(--cds-surface-1))]";
const SETUP_HIDDEN = "[[data-start-card-setup-hidden]_&]:hidden";

/** _5 / LF: a row's tooltip above it, flush with its start, up to 480 wide; a path breaks after separators. */
type Tip = { text: string; detail?: string; path?: boolean };
const tipProps = (tip?: Tip) =>
  tip && {
    "data-tip": tip.text,
    "data-tip-detail": tip.detail,
    "data-tip-align": "start",
    "data-tip-wide": "",
    "data-tip-path": tip.path ? "" : undefined,
  };

/**
 * A start-card row (cc43287c9 v5): 32 tall, the title then a muted detail that wraps out of sight
 * when there is no room, a caret on a menu row, and on hover, focus or an open menu an X for a row
 * that can be dismissed, the text giving it a control's width.
 */
function StartRow({
  icon,
  title,
  detail,
  tip,
  menu,
  testId,
  rowRef,
  onPress,
  dismiss,
}: {
  icon?: IconName;
  title: ReactNode;
  detail?: string;
  tip?: Tip;
  menu?: boolean;
  testId: string;
  rowRef?: Ref<HTMLButtonElement>;
  onPress(): void;
  dismiss?: { label: string; onPress(event: MouseEvent<HTMLButtonElement>): void };
}) {
  const id = useId();
  return (
    <div className="group/row relative">
      <button
        ref={rowRef}
        type="button"
        data-testid={testId}
        aria-haspopup={menu === undefined ? undefined : "menu"}
        aria-expanded={menu}
        aria-describedby={tip ? id : undefined}
        {...tipProps(tip)}
        onClick={(event) => {
          event.stopPropagation();
          onPress();
        }}
        className={`${ROW} outline-none group-hover/row:bg-fill-ghost-hover group-has-[:focus-visible]/row:bg-fill-ghost-hover group-has-[[aria-expanded=true]]/row:bg-fill-ghost-hover focus-visible:shadow-focus focus-visible:outline-hidden`}
      >
        {icon && <Icon name={icon} size="sm" className="shrink-0 text-secondary-control" />}
        <span className="flex min-w-0 flex-1 items-center gap-1">
          <span className="flex h-5 min-w-0 items-baseline gap-x-2 overflow-hidden whitespace-nowrap flex-wrap">
            <span className="min-w-0 max-w-full truncate text-secondary-control">{title}</span>
            {detail !== undefined && <span className={`${DETAIL} ${DIM}`}>{detail}</span>}
          </span>
          {menu !== undefined && <Icon name="CaretDown" size="xs" className={`shrink-0 ${DIM}`} />}
        </span>
        {dismiss && (
          <span aria-hidden="true" className={`${ROOM} -ms-2`}>
            <span className="w-control" />
          </span>
        )}
      </button>
      {tip && (
        <span id={id} hidden>
          {tip.text}
        </span>
      )}
      {dismiss && (
        <span className={END}>
          <Button
            variant="ghost"
            icon={<Icon name="X" />}
            label={dismiss.label}
            tip="关闭"
            className="pointer-events-auto"
            onClick={(event) => {
              event.stopPropagation();
              dismiss.onPress(event);
            }}
          />
        </span>
      )}
    </div>
  );
}

/** cc43287c9 y5: the environment in use, a check at its end. */
function CurrentRow({ icon, title, tip, testId }: { icon: IconName; title: string; tip: Tip; testId: string }) {
  return (
    <div data-testid={testId} className={ROW} {...tipProps(tip)}>
      <Icon name={icon} size="sm" className="shrink-0 text-secondary-control" />
      <span className="min-w-0 flex-1 truncate text-secondary-control">{title}</span>
      <span className="sr-only">{tip.text}</span>
      <Icon name="Check" size="sm" className="shrink-0 text-primary" />
    </div>
  );
}

/**
 * cc43287c9 wae: while the pointer is over the next steps or a key is in them, the rows they show
 * stay put (new ones wait, finished ones still go), until it leaves.
 */
function useHeld(keys: string[], pinned: boolean) {
  const [held, setHeld] = useState<{ keys: Set<string>; pointer: boolean; focus: boolean } | null>(null);
  if (held && !held.pointer && !held.focus && !pinned) setHeld(null);
  const hold = (part: { pointer?: boolean; focus?: boolean }) => setHeld((now) => ({ ...(now ?? { keys: new Set(keys), pointer: false, focus: false }), ...part }));
  const drop = (part: { pointer?: boolean; focus?: boolean }) => setHeld((now) => now && { ...now, ...part });
  return {
    held: held?.keys ?? null,
    groupProps: {
      onPointerEnter: () => hold({ pointer: true }),
      onPointerLeave: () => drop({ pointer: false }),
      onFocus: () => hold({ focus: true }),
      onBlur: (event: FocusEvent<HTMLElement>) => {
        if (!event.currentTarget.contains(event.relatedTarget)) drop({ focus: false });
      },
    },
  };
}

export function StartCard() {
  const threads = useStore((s) => s.threads);
  const requests = useStore((s) => s.requests);
  const settledQuestions = useStore((s) => s.settledQuestions);
  const landing = useStore((s) => s.landing);
  const listed = useStore((s) => s.list.ids);
  const ready = useStore((s) => s.conn.status === "ready");
  const projects = useStore((s) => s.projects);
  const projectId = useStore((s) => s.prefs.projectId);
  const recent = useRecentFolders();
  const { cwd } = recent;
  const [status, setStatus] = useState<FolderStatus | null>(null);
  const [read, setRead] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(readDismissed);
  // Steps taken on this visit stay gone until the next 新建 (cc43287c9 markUsed, per opening).
  const [used, setUsed] = useState<string[]>([]);
  const [menu, setMenu] = useState<"env" | "rest" | null>(null);
  // Tae: the next steps show once everything they come from has been read, then stay for this visit.
  const shown = useRef(false);
  const choose = useRef<HTMLButtonElement>(null);
  const setupList = useRef<HTMLUListElement>(null);
  const lastClick = useRef<{ at: number; key?: string }>({ at: -Infinity });

  useEffect(() => {
    let live = true;
    setStatus(null);
    setRead(null);
    const refresh = () => {
      if (!cwd || !ready) return;
      void folderStatus(cwd, true).then((next) => {
        if (!live) return;
        setStatus(next);
        setRead(cwd);
      });
    };
    refresh();
    window.addEventListener("focus", refresh);
    return () => {
      live = false;
      window.removeEventListener("focus", refresh);
    };
  }, [cwd, ready]);

  const envs = landing === null ? [] : localEnvironments(projects, recent.recent, cwd, projectId ?? projectFor(cwd)?.id ?? null);
  const sessions = landing === null ? [] : blockedSessions(new Set([...landing, ...listed.filter((id) => !isArchivedThread(id))]), threads, requests, settledQuestions, cwd);
  const families: Step[][] = [sessions, status && continues(status) ? [{ kind: "continue", folder: cwd, branch: status.branch, files: status.files }] : []];
  const live = families.map((steps) => steps.filter((step) => !used.includes(stepKey(step)) && dismissed[stepKey(step)] !== stepStamp(step)));
  const { held, groupProps } = useHeld(live.flat().map(stepKey), menu === "rest");
  const seats = seat(held ? live.map((steps) => steps.filter((step) => held.has(stepKey(step)))) : live);
  const settled = landing !== null && (!cwd || !ready || read === cwd);
  if (seats.length && settled) shown.current = true;
  const showSteps = seats.length > 0 && shown.current;

  if (landing === null) return null;

  // Aae: a pointer dismissal hands focus to the prompt; a key one keeps it in the card, on the last
  // row left or else 选择环境 (YN).
  const forget = (steps: Step[], event: MouseEvent<HTMLButtonElement>) => {
    const keyboard = event.currentTarget.matches(":focus-visible");
    const next = steps.reduce((map, step) => dismiss(map, stepKey(step), stepStamp(step)), dismissed);
    setDismissed(next);
    writePref(DISMISSED_KEY, JSON.stringify(next));
    setMenu(null);
    if (!keyboard) return focusComposer();
    requestAnimationFrame(() => {
      const rows = [...(setupList.current?.children ?? [])].map((li) => li.querySelector("button"));
      (rows.findLast((button) => button !== null) ?? choose.current)?.focus();
    });
  };
  // Aae le: a click that lands within 500ms of one on a row that has since gone goes nowhere, so a
  // double click does not press the row that slid into its place.
  const guardClick = (event: MouseEvent<HTMLUListElement>) => {
    if (event.detail === 0) return;
    const now = performance.now();
    const before = lastClick.current;
    if (now - before.at < 500 && ![...event.currentTarget.children].some((li) => li.getAttribute("data-row-key") === before.key)) {
      event.stopPropagation();
      return;
    }
    lastClick.current = { at: now, key: (event.target as Element).closest("li")?.dataset.rowKey };
  };

  const stepRow = (step: Step, listed = false) =>
    step.kind === "session" ? (
      <StartRow
        testId="start-card-waiting-session"
        // F5 waiting-session: "<status>Blocked</status> {title}", the title alone in the rest list.
        title={
          listed ? (
            step.title
          ) : (
            <>
              <span className="text-warning">已阻塞</span> {step.title}
            </>
          )
        }
        detail={ASKS[step.ask]}
        tip={{ text: step.title, detail: ASKS[step.ask] }}
        onPress={() => {
          setMenu(null);
          void openThread(step.id);
        }}
        dismiss={listed ? undefined : { label: `关闭“${step.title}”`, onPress: (event) => forget([step], event) }}
      />
    ) : (
      <StartRow
        testId="start-card-continue-branch"
        title="继续未提交的工作"
        detail={`${step.files} 个文件`}
        tip={{ text: `${step.branch} 上的 ${step.files} 个未提交文件` }}
        onPress={() => {
          setUsed((keys) => [...keys, stepKey(step)]);
          setComposerDraft(`继续 ${step.branch} 上正在进行的工作：查看未提交的更改，告诉我它们处于什么状态，并完成已开始的部分。`);
        }}
        dismiss={{ label: "忽略未提交的工作", onPress: (event) => forget([step], event) }}
      />
    );

  return (
    <div data-testid="epitaxy-start-card" className="flex w-full min-w-0 flex-col items-center gap-3 p-px">
      {ready && envs.length > 0 && (
        <ul role="list" aria-label="最近使用的环境" data-testid="start-card-environments" className={CARD} data-tip-group="">
          {envs.map((env) => {
            const tip: Tip = { text: homeRelative(env.path), path: true };
            return (
              // X5
              <li key={env.key} aria-current={env.active ? "true" : undefined} className="px-1 pt-0.5 first:pt-1">
                {env.active ? (
                  <CurrentRow testId="start-card-environment" icon="Laptop" title={env.name} tip={tip} />
                ) : (
                  <StartRow
                    testId="start-card-environment"
                    icon="Laptop"
                    title={env.name}
                    tip={tip}
                    onPress={() => {
                      if (env.projectId) chooseProject(env.projectId);
                      else chooseFolder(env.path);
                      focusComposer();
                    }}
                  />
                )}
              </li>
            );
          })}
          <li className="pt-1">
            <div aria-hidden="true" className="border-t" style={{ marginInline: "var(--cds-ring-inner)" }} />
            <div className="p-1">
              <Popover
                open={menu === "env"}
                onClose={() => setMenu(null)}
                className="menu-env"
                density="compact"
                anchor={<StartRow rowRef={choose} testId="start-card-choose" title="选择环境" menu={menu === "env"} onPress={() => setMenu(menu === "env" ? null : "env")} />}
              >
                <EnvironmentMenu onClose={() => setMenu(null)} />
              </Popover>
            </div>
          </li>
        </ul>
      )}
      {showSteps && (
        <ul role="list" aria-label="后续步骤" data-testid="start-card-setup" data-start-card-setup="" className={`${CARD} gap-0.5 p-1 ${SETUP_HIDDEN}`} data-tip-group="" onClickCapture={guardClick} {...groupProps} ref={setupList}>
          {seats.map((entry) =>
            "row" in entry ? (
              <li key={stepKey(entry.row)} data-row-key={stepKey(entry.row)}>
                {stepRow(entry.row)}
              </li>
            ) : (
              <li key="blocked-sessions" data-row-key="blocked-sessions">
                <Popover
                  open={menu === "rest"}
                  onClose={() => setMenu(null)}
                  className="start-pop"
                  anchor={
                    <StartRow
                      testId="start-card-blocked-sessions"
                      // Sae blocked-sessions.
                      title={entry.whole ? `Codex 在 ${entry.rest.length} 个会话中受阻` : `Codex 在另外 ${entry.rest.length} 个会话中已受阻`}
                      menu={menu === "rest"}
                      onPress={() => setMenu(menu === "rest" ? null : "rest")}
                      dismiss={{ label: `忽略 ${entry.rest.length} 个受阻会话`, onPress: (event) => forget(entry.rest, event) }}
                    />
                  }
                >
                  <ul role="list" className="flex flex-col gap-0.5 p-1" data-tip-group="">
                    {entry.rest.map((step) => (
                      <li key={stepKey(step)} data-row-key={stepKey(step)}>
                        {stepRow(step, true)}
                      </li>
                    ))}
                  </ul>
                </Popover>
              </li>
            ),
          )}
        </ul>
      )}
    </div>
  );
}

/**
 * cc43287c9 BG / FG: the card's column fills the scroll area, 24 clear at the bottom. A spacer above
 * it grows up to the gap that centres the card on the room from the area's top down to 2.75rem above
 * the prompt's bottom; when the next steps do not fit even then, they drop out
 * ([data-start-card-setup-hidden]) until there is room again. The column takes the chat column's
 * gutters (shared-6 cg: 32, 16 in a narrow tile), the card centred between them.
 */
export function StartColumn({ hidden, children }: { hidden: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const shell = ref.current;
    const scroller = shell?.parentElement;
    const [spacer, slot] = shell ? ([...shell.children] as HTMLElement[]) : [];
    if (!shell || !scroller || !spacer || !slot) return;
    let setup = 0;
    const measure = () => {
      const prompt = shell.closest(".main-col")?.querySelector(".composer");
      const rows = [...slot.querySelectorAll<HTMLElement>("[data-start-card-setup]")];
      const showing = rows.some((row) => row.offsetHeight > 0);
      // IG: a setup row's share is the distance from the bottom of whatever is above it.
      if (!rows.length) setup = 0;
      else if (showing) setup = rows.reduce((sum, row) => sum + (row.previousElementSibling ? row.getBoundingClientRect().bottom - row.previousElementSibling.getBoundingClientRect().bottom : row.offsetHeight), 0);
      const room = scroller.getBoundingClientRect();
      const lift = 2.75 * parseFloat(getComputedStyle(document.documentElement).fontSize);
      const rest = prompt ? prompt.getBoundingClientRect().bottom - lift - room.top : room.height;
      const environments = slot.getBoundingClientRect().height - (showing ? setup : 0);
      // NG.
      const top = Math.max(0, (rest - environments - setup) / 2);
      const fits = top + environments + setup + parseFloat(getComputedStyle(shell).paddingBottom) + Number(shell.hasAttribute("data-start-card-setup-hidden")) <= room.height;
      spacer.style.maxHeight = `${top}px`;
      shell.toggleAttribute("data-start-card-setup-hidden", !fits);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    observer.observe(slot);
    measure();
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={ref} className="flex min-h-full w-full flex-col pb-6" style={{ paddingInline: "var(--chat-gutter)", display: hidden ? "none" : undefined }}>
      <div aria-hidden="true" className="max-h-0 grow basis-0" />
      <div className="flex w-full flex-col">{children}</div>
    </div>
  );
}
