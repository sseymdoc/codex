// A dot's profile in the session rail's place (the Codex desktop app's side panel, drawn with the
// rail's Claude cards): who it is and whether it runs, how to reach it (texting, email, Slack), a
// meeting invite, desktop notifications, its cloud computer, its recent work and its schedules.
// Its menus rename, restyle (DotCharacter.tsx), add another dot or delete it. Strings are the
// desktop app's zh-CN ones (restricted.aeon.* / orbit.*).

import { useEffect, useRef, useState, type FormEvent, type ReactNode, type RefObject } from "react";
import { errorMessage } from "../lib/codex";
import {
  claimEmail, deleteDot, emailOptions, inviteToMeeting, loadProfile, meetingUrl, profileOf, rebootDot, removeEmail, removePhone, renameDot,
  setPaused, startPhone, statusLine, useDotProfile, validName, verifyPhone,
} from "../lib/dot-profile";
import { openDotTask } from "../lib/dot-work";
import { createDot, type Dot, type DotTask } from "../lib/dots";
import { timeAgo } from "../lib/format";
import { readPref, toast, writePref } from "../lib/store";
import { DotAvatar } from "./Dots";
import { DotCharacterDialog } from "./DotCharacter";
import { Button, Dialog, Icon, MenuItem, MenuSep, Popover, Spinner, Toggle } from "./ui";

const TASK_TEXT: Record<DotTask["status"], string> = { running: "处理中", succeeded: "已完成", failed: "需要关注", interrupted: "已停止" };
const COMPUTER_TEXT: Record<string, string> = { running: "已连接", ready: "已连接", connected: "已连接", starting: "正在建立连接…", offline: "离线", stopped: "已断开连接" };

/** Desktop notifications for a dot's new messages (only where the desktop shell can send them). */
export const dotsNotify = () => readPref("codex-ui:dots-notify", ["on", "off"] as const, "off") === "on";

function Card({ title, summary, children }: { title: string; summary?: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <section className="rail-card dots-card-section">
      <h3 className="rail-card-top">
        <button type="button" className="rail-card-head" aria-expanded={open} onClick={() => setOpen(!open)}>
          <span>{title}</span>
          <Icon name="CaretRight" size="xs" className="rail-card-caret" />
          {summary !== undefined && summary !== null && <span className="rail-card-summary" aria-hidden={open || undefined}>{summary}</span>}
        </button>
      </h3>
      {open && <div className="rail-card-body">{children}</div>}
    </section>
  );
}

type DialogKind = "rename" | "character" | "delete" | "email" | "phone" | "reboot";

export function DotProfilePanel({ dot, activity, overlay, toggleRef, onDismiss }: {
  dot: Dot;
  activity: DotTask[] | null;
  overlay?: "pointer" | "keyboard";
  toggleRef?: RefObject<HTMLElement | null>;
  onDismiss?(refocus: boolean): void;
}) {
  const panel = useRef<HTMLElement>(null);
  const profile = useDotProfile((s) => s.profiles[dot.id]) ?? profileOf(dot.id);
  const pausedAt = useDotProfile((s) => s.pausedAt[dot.id]);
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  const [menu, setMenu] = useState<"status" | "more" | "email" | null>(null);
  const [busy, setBusy] = useState(false);
  const [meeting, setMeeting] = useState<{ url: string; key: string } | null>(null);
  const [notify, setNotify] = useState(dotsNotify);
  const name = dot.name ?? "你的 Dot";

  useEffect(() => void loadProfile(dot), [dot.id, dot.paused]); // eslint-disable-line react-hooks/exhaustive-deps

  // A floating panel goes on Esc or a press outside it and its toggle, as the session rail does.
  useEffect(() => {
    if (!overlay || !onDismiss) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || document.querySelector(".popover, .dialog")) return;
      event.preventDefault();
      onDismiss(!!panel.current?.contains(document.activeElement));
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Element;
      if (panel.current?.contains(target) || toggleRef?.current?.contains(target) || target.closest?.(".popover, .dialog, .dialog-backdrop")) return;
      onDismiss(false);
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onPointer, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onPointer, true);
    };
  }, [overlay, onDismiss, toggleRef]);

  const run = async (work: () => Promise<unknown>, failure?: string) => {
    setBusy(true);
    try {
      await work();
    } catch (error) {
      toast("warning", failure ?? errorMessage(error), failure ? errorMessage(error) : undefined);
    } finally {
      setBusy(false);
    }
  };

  const copy = (text: string, done: string) => void navigator.clipboard.writeText(text).then(() => toast("neutral", done), () => {});
  const schedules = profile.automations;
  const computer = profile.computer;

  const cards = (
    <div className="rail-scroll scroll-fade-y">
      <Card title="个人资料">
        <div className="dots-identity">
          <button type="button" className="dots-identity-avatar" aria-label="更改你的 Dot 外观" data-tip="更改你的 Dot 外观" onClick={() => setDialog("character")}>
            <DotAvatar url={dot.avatar.url} color={dot.color} size={56} />
            <span className="dots-identity-edit" aria-hidden="true"><Icon name="Edit" size="xs" /></span>
          </button>
          <div className="dots-identity-text">
            <span className="dots-identity-name">{name}</span>
            <Popover
              open={menu === "status"}
              onClose={() => setMenu(null)}
              anchor={
                <button type="button" className="dots-identity-status" data-paused={dot.paused || undefined} disabled={busy} aria-expanded={menu === "status"} onClick={() => setMenu(menu === "status" ? null : "status")}>
                  {busy ? <Spinner size={12} /> : <span className="dots-status-dot" aria-hidden="true" />}
                  {statusLine(dot, pausedAt, null)}
                  <Icon name="CaretDown" size="xs" />
                </button>
              }
            >
              <MenuItem
                icon={<Icon name={dot.paused ? "Play" : "Pause"} />}
                label={dot.paused ? `继续运行 ${name}` : `暂停 ${name}`}
                onClick={() => {
                  setMenu(null);
                  void run(() => setPaused(dot, !dot.paused));
                }}
              />
            </Popover>
            <span className="dots-identity-note">你的私人 Dot</span>
          </div>
          <Popover
            open={menu === "more"}
            onClose={() => setMenu(null)}
            placement="bottom-end"
            anchor={<Button variant="ghost" size="sm" icon={<Icon name="DotsHorizontal" size="sm" />} label={`${name} 的更多选项`} aria-expanded={menu === "more"} onClick={() => setMenu(menu === "more" ? null : "more")} />}
          >
            <MenuItem label="重命名" onClick={() => { setMenu(null); setDialog("rename"); }} />
            <MenuItem label="更改你的 Dot 外观" onClick={() => { setMenu(null); setDialog("character"); }} />
            <MenuItem label="重启" onClick={() => { setMenu(null); setDialog("reboot"); }} />
            <MenuItem label="创建一个 Dot" onClick={() => { setMenu(null); void run(createDot, "无法完成 Dot 设置"); }} />
            <MenuSep />
            <MenuItem label={`删除 ${name}`} danger onClick={() => { setMenu(null); setDialog("delete"); }} />
          </Popover>
        </div>
      </Card>

      <Card title="联系方式">
        <div className="rail-row">
          <span className="rail-icon"><Icon name="ChatSimple" size="sm" /></span>
          {profile.phone === undefined ? (
            <span className="rail-label dots-muted">正在加载…</span>
          ) : profile.phoneError ? (
            <button type="button" className="rail-label dots-row-action" onClick={() => void loadProfile(dot)}>无法加载短信设置。请重试</button>
          ) : profile.phone?.number ? (
            <>
              <span className="rail-label">{profile.phone.dotNumber ? `短信：${profile.phone.dotNumber}` : `短信：${profile.phone.number}`}</span>
              {profile.phone.dotNumber && <Button variant="ghost" size="xs" icon={<Icon name="Copy" size="xs" />} label="复制号码" onClick={() => copy(profile.phone?.dotNumber ?? "", "号码已复制")} />}
              <Button variant="ghost" size="xs" icon={<Icon name="X" size="xs" />} label="移除短信功能" disabled={busy} onClick={() => void run(() => removePhone(dot))} />
            </>
          ) : (
            <button type="button" className="rail-label dots-row-action" disabled={profile.phone?.canSetup === false} onClick={() => setDialog("phone")}>设置短信功能</button>
          )}
        </div>
        <div className="rail-row">
          <span className="rail-icon"><Icon name="Note" size="sm" /></span>
          {profile.email === undefined ? (
            <span className="rail-label dots-muted">电子邮箱加载中…</span>
          ) : profile.emailError ? (
            <span className="rail-label dots-muted">电子邮箱不可用</span>
          ) : profile.email?.linked ? (
            <>
              <span className="rail-label" title={profile.email.address}>{profile.email.address}</span>
              <Popover
                open={menu === "email"}
                onClose={() => setMenu(null)}
                placement="bottom-end"
                anchor={<Button variant="ghost" size="xs" icon={<Icon name="DotsHorizontal" size="xs" />} label="电子邮箱选项" onClick={() => setMenu(menu === "email" ? null : "email")} />}
              >
                <MenuItem label="复制邮箱地址" onClick={() => { setMenu(null); copy(profile.email?.address ?? "", "邮箱地址已复制"); }} />
                <MenuItem label="移除" danger onClick={() => { setMenu(null); void run(() => removeEmail(dot.id)); }} />
              </Popover>
            </>
          ) : (
            <button type="button" className="rail-label dots-row-action" onClick={() => setDialog("email")}>添加电子邮箱地址</button>
          )}
        </div>
      </Card>

      <Card title="会议">
        {meeting ? (
          <form className="dots-meeting" onSubmit={(event: FormEvent) => {
            event.preventDefault();
            const url = meetingUrl(meeting.url);
            if (!url) return toast("warning", "请输入 Google Meet 链接，例如 https://meet.google.com/abc-defg-hij");
            void run(async () => {
              await inviteToMeeting(dot, url, meeting.key);
              setMeeting(null);
              toast("neutral", "已接受邀请");
            });
          }}>
            <input className="input" autoFocus required maxLength={2048} aria-label="Google Meet 网址" placeholder="https://meet.google.com/voe-cyip-xen" value={meeting.url}
              onChange={(event) => setMeeting({ ...meeting, url: event.target.value })} />
            <div className="dots-row-actions">
              <Button type="button" variant="ghost" size="sm" onClick={() => setMeeting(null)}>取消</Button>
              <Button type="submit" variant="primary" size="sm" disabled={busy}>发送邀请</Button>
            </div>
          </form>
        ) : (
          <button type="button" className="rail-row" onClick={() => setMeeting({ url: "", key: crypto.randomUUID() })}>
            <span className="rail-icon"><Icon name="Add" size="sm" /></span>
            <span className="rail-label">邀请加入 Google Meet</span>
          </button>
        )}
      </Card>

      {window.codexDesktop && (
        <Card title="桌面通知">
          <label className="rail-row">
            <span className="rail-icon"><Icon name="Info" size="sm" /></span>
            <span className="rail-label">{name} 有新消息时通知我</span>
            <Toggle checked={notify} label="桌面通知" onChange={(on) => {
              writePref("codex-ui:dots-notify", on ? "on" : "off");
              setNotify(on);
            }} />
          </label>
        </Card>
      )}

      <Card title="云电脑" summary={computer ? COMPUTER_TEXT[computer.status] ?? "连接状态不可用" : undefined}>
        <div className="rail-row">
          <span className="rail-icon"><Icon name="Computer" size="sm" /></span>
          <span className="rail-label">{computer === undefined ? "正在加载桌面连接状态" : computer ? COMPUTER_TEXT[computer.status] ?? "连接状态不可用" : "计算机不可用"}</span>
          <Button variant="ghost" size="xs" onClick={() => setDialog("reboot")}>重启</Button>
        </div>
      </Card>

      <Card title="近期活动">
        {activity === null ? (
          <div className="rail-row"><Spinner size={12} /><span className="rail-label dots-muted">正在加载活动</span></div>
        ) : activity.length === 0 ? (
          <div className="rail-row"><span className="rail-label dots-muted">最近无活动</span></div>
        ) : activity.map((task) => (
          <button key={task.id} type="button" className="rail-row dots-activity-row" data-status={task.status} aria-label={`${task.title}，${TASK_TEXT[task.status]}`} onClick={() => openDotTask(task.id)}>
            <span className="rail-icon">{task.status === "running" ? <Spinner size={12} /> : task.emoji ?? <Icon name={task.status === "succeeded" ? "Check" : "Warning"} size="sm" />}</span>
            <span className="rail-label">{task.title}</span>
            <span className="rail-meta">{task.status === "running" ? "正在处理" : timeAgo(task.updatedAt)}</span>
          </button>
        ))}
      </Card>

      <Card title="已安排" summary={schedules?.length ? `已安排 ${schedules.length} 项` : undefined}>
        {schedules === undefined ? (
          <div className="rail-row"><Spinner size={12} /><span className="rail-label dots-muted">正在加载已安排的任务</span></div>
        ) : !schedules?.length ? (
          <div className="rail-row"><span className="rail-label dots-muted">暂无提醒</span></div>
        ) : schedules.map((item) => (
          <div key={item.id} className="rail-row">
            <span className="rail-icon"><Icon name="Checklist" size="sm" /></span>
            <span className="rail-label">{item.title}</span>
            {item.next && <span className="rail-meta">{new Date(item.next).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>}
          </div>
        ))}
      </Card>
    </div>
  );

  return (
    <aside ref={panel} className="rail dots-profile" data-overlay={overlay ? "" : undefined} aria-label="你的 dot 的个人资料" tabIndex={-1}>
      {overlay ? <div className="rail-surface">{cards}</div> : cards}
      {dialog === "rename" && <RenameDialog dot={dot} onClose={() => setDialog(null)} />}
      {dialog === "character" && <DotCharacterDialog dot={dot} onClose={() => setDialog(null)} />}
      {dialog === "delete" && <DeleteDialog dot={dot} onClose={() => setDialog(null)} />}
      {dialog === "email" && <EmailDialog dot={dot} onClose={() => setDialog(null)} />}
      {dialog === "phone" && <PhoneDialog dot={dot} onClose={() => setDialog(null)} />}
      {dialog === "reboot" && <RebootDialog dot={dot} onClose={() => setDialog(null)} />}
    </aside>
  );
}

function RenameDialog({ dot, onClose }: { dot: Dot; onClose(): void }) {
  const [name, setName] = useState(dot.name ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const valid = validName(name);
  const save = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    try {
      await renameDot(dot, name);
      onClose();
    } catch (failure) {
      setError(errorMessage(failure));
      setBusy(false);
    }
  };
  return (
    <Dialog title="重命名你的 Dot" description="名称应简短且易于识别" size="sm" onClose={onClose} footer={<>
      <Button variant="secondary" onClick={onClose}>取消</Button>
      <Button variant="primary" disabled={!valid || busy} onClick={() => void save()}>保存</Button>
    </>}>
      <form onSubmit={(event) => void save(event)}>
        <input className="input" data-autofocus="" aria-label="你的 Dot 的名称" placeholder="添加名称…" value={name} aria-invalid={!valid || !!error || undefined}
          onChange={(event) => { setName(event.target.value); setError(null); }} />
        {(!valid || error) && <p className="dots-field-error" role="alert">{error ?? "昵称最多可包含 24 个字符，且不能包含反斜杠"}</p>}
      </form>
    </Dialog>
  );
}

function DeleteDialog({ dot, onClose }: { dot: Dot; onClose(): void }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <Dialog
      alert
      size="sm"
      title={dot.name ? `是否删除“${dot.name}”？` : "是否删除你的 Dot？"}
      description={failed ? "无法删除你的 Dot" : "此操作将归档你与此 dot 的对话，清除其记忆和已安排的任务；其创建的聊天记录会保留。此操作无法撤销。"}
      onClose={onClose}
      footer={<>
        <Button variant="secondary" data-autofocus="" onClick={onClose}>取消</Button>
        <Button variant="danger" disabled={busy} onClick={() => {
          setBusy(true);
          deleteDot(dot).then(onClose, () => {
            setFailed(true);
            setBusy(false);
          });
        }}>{failed ? "重试" : "删除"}</Button>
      </>}
    />
  );
}

function EmailDialog({ dot, onClose }: { dot: Dot; onClose(): void }) {
  const [options, setOptions] = useState<{ domain: string; suggestion: string } | null | "error">(null);
  const [local, setLocal] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    emailOptions(dot.id).then((found) => {
      setOptions(found);
      setLocal(found.suggestion);
    }, () => setOptions("error"));
  }, [dot.id]);
  const valid = /^[a-z0-9-]+(?:\.[a-z0-9-]+)*$/.test(local) && local.length <= 30;
  const claim = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!valid || busy || !options || options === "error") return;
    setBusy(true);
    try {
      await claimEmail(dot.id, local, options.domain);
      onClose();
    } catch (failure) {
      setError(errorMessage(failure));
      setBusy(false);
    }
  };
  return (
    <Dialog title="申领一个电子邮箱地址" description="申领一个电子邮箱地址，即可给你的 Dot 发邮件" size="sm" onClose={onClose} footer={<>
      <Button variant="secondary" onClick={onClose}>取消</Button>
      <Button variant="primary" disabled={!valid || busy || !options || options === "error"} onClick={() => void claim()}>认领电子邮箱地址</Button>
    </>}>
      {options === null ? <p className="dots-muted" role="status"><Spinner size={12} /> 电子邮箱设置加载中…</p> : options === "error" ? (
        <p className="dots-field-error" role="alert">电子邮箱设置未成功。请重试</p>
      ) : (
        <form className="dots-email-form" onSubmit={(event) => void claim(event)}>
          <div className="dots-email-field">
            <input className="input" data-autofocus="" aria-label="用户名" placeholder="用户名" value={local} aria-invalid={!!error || (!!local && !valid) || undefined}
              onChange={(event) => { setLocal(event.target.value.toLowerCase()); setError(null); }} />
            {options.domain && <span className="dots-email-domain">@{options.domain}</span>}
          </div>
          <p className={error || (local && !valid) ? "dots-field-error" : "dots-muted"} role={error ? "alert" : undefined}>
            {error ?? (local && !valid ? "请使用 1–30 个字符，仅限小写字母 (a–z)、数字、连字符或点号。不能以点号开头或结尾，也不能连续使用两个点号" : "此电子邮箱地址固定不变，无法修改")}
          </p>
        </form>
      )}
    </Dialog>
  );
}

function PhoneDialog({ dot, onClose }: { dot: Dot; onClose(): void }) {
  const [number, setNumber] = useState("");
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const step = async (event?: FormEvent) => {
    event?.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (!challenge) setChallenge(await startPhone(number.trim()));
      else {
        await verifyPhone(dot, challenge, code.trim());
        onClose();
        return;
      }
    } catch (failure) {
      setError(errorMessage(failure));
    }
    setBusy(false);
  };
  return (
    <Dialog
      title={challenge ? "输入验证码" : "你的电话号码是多少？"}
      description={challenge ? `请输入我们通过短信发送至 ${number} 的验证码。` : `输入你的电话号码，即可开始给 ${dot.name ?? "你的 Dot"} 发短信`}
      size="sm"
      onClose={onClose}
      footer={<>
        {challenge ? <Button variant="secondary" onClick={() => { setChallenge(null); setCode(""); }}>返回</Button> : <Button variant="secondary" onClick={onClose}>取消</Button>}
        <Button variant="primary" disabled={busy || !(challenge ? code.trim() : number.trim())} onClick={() => void step()}>{challenge ? "验证电话号码" : "发送验证短信"}</Button>
      </>}
    >
      <form className="dots-phone-form" onSubmit={(event) => void step(event)}>
        {challenge ? (
          <input key="code" className="input" data-autofocus="" inputMode="numeric" autoComplete="one-time-code" aria-label="验证码" placeholder="验证码" value={code} onChange={(event) => setCode(event.target.value)} />
        ) : (
          <input key="number" className="input" data-autofocus="" type="tel" autoComplete="tel" aria-label="电话号码" placeholder="+1 (555) 555-5555" value={number} onChange={(event) => setNumber(event.target.value)} />
        )}
        {error && <p className="dots-field-error" role="alert">{error}</p>}
        {!challenge && <p className="dots-muted dots-fine-print">如果继续，即表示你同意通过此号码与 OpenAI 进行自动化及 AI 驱动的语音通话和短信交流。你的短信将通过第三方服务提供商传送。可能会产生短信和数据流量费用。如需退订，请发送内容为 STOP 的短信。</p>}
      </form>
    </Dialog>
  );
}

function RebootDialog({ dot, onClose }: { dot: Dot; onClose(): void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog alert size="sm" title="要重启你的 dot 吗？" description="如果你的 dot 似乎卡住了，重启可能会有帮助。正在进行的工作可能会中断，但你的对话、记忆和已安排的任务都会保留。" onClose={onClose} footer={<>
      <Button variant="secondary" data-autofocus="" onClick={onClose}>取消</Button>
      <Button variant="primary" disabled={busy} onClick={() => {
        setBusy(true);
        rebootDot(dot).then(() => {
          toast("neutral", "已提交重启请求");
          onClose();
        }, (error) => {
          toast("warning", errorMessage(error));
          setBusy(false);
        });
      }}>重启</Button>
    </>} />
  );
}
