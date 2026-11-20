// /status (c4de0b325 aF / xF, the composer's popover cc970fefe nA): the session's facts in three
// groups, 会话 / 环境 / 账户, with 复制会话信息 and 复制会话 ID. Rows Codex has nothing for (output
// style, trust, organization) are left out.

import { VERSION } from "../lib/codex";
import { environmentOf } from "../lib/environments";
import { timeAgo } from "../lib/format";
import { useStore, type ThreadState } from "../lib/store";
import { CopyKey } from "./items";

type Row = { label: string; value: string; copy?: string };

/** xF's MCP line: what is connected, needs signing in, connects, failed or is off (none: 无). */
function mcpSummary(servers: { runtimeStatus: string | null }[] | null): string {
  if (!servers?.length) return "无";
  const count = (status: string) => servers.filter((server) => server.runtimeStatus === status).length;
  const parts = [
    [count("connected"), (n: number) => `已连接 ${n} 个`],
    [count("authenticationRequired"), (n: number) => `${n} 项需要登录`],
    [count("starting") + count("notStarted"), (n: number) => `${n} 个正在连接`],
    [count("failed"), (n: number) => `${n} 个失败`],
    [count("disabled") + count("cancelled"), (n: number) => `${n} 个已关闭`],
  ] as const;
  return parts.flatMap(([n, text]) => (n ? [text(n)] : [])).join("，") || "无";
}

export function SessionInfo({ thread, model, effort, fast, mode, cwd }: { thread: ThreadState; model: string; effort: string; fast: boolean; mode: string; cwd: string }) {
  const server = useStore((s) => s.server);
  const account = useStore((s) => s.account?.account);
  const mcp = useStore((s) => s.mcp);
  const requirements = useStore((s) => s.requirements);
  const project = useStore((s) => s.projects.find((p) => p.id === thread.meta.projectId) ?? null);
  const ssh = environmentOf(project).ssh;
  const sandbox = thread.settings?.sandbox;
  const when = timeAgo(thread.meta.createdAt);
  const groups: [string, Row[]][] = [
    [
      "会话",
      [
        { label: "Codex", value: server.version ?? "—" },
        ...(window.codexDesktop ? [{ label: "桌面应用", value: [VERSION, navigator.platform].filter(Boolean).join(" · ") }] : []),
        { label: "模型", value: fast ? `${model} · ${effort} · 快速` : `${model} · ${effort}` },
        { label: "权限", value: mode },
        { label: "开始时间", value: thread.meta.forkedFromId ? `已分叉 · ${when}` : `您 · ${when}` },
        { label: "会话 ID", value: thread.meta.id, copy: thread.meta.id },
      ],
    ],
    [
      "环境",
      [
        ...(ssh ? [{ label: "主机", value: `SSH · ${ssh.connectionId}` }] : []),
        { label: "文件夹", value: cwd },
        { label: "MCP 服务器", value: mcpSummary(mcp) },
        ...(sandbox ? [{ label: "沙盒", value: sandbox.type === "dangerFullAccess" ? "关闭" : "开启" }] : []),
        ...(requirements ? [{ label: "托管设置", value: "已生效" }] : []),
      ],
    ],
    ...(account ? ([["账户", [{ label: "已登录为", value: account.type === "chatgpt" ? (account.email ?? "ChatGPT") : "API Key" }]]] as [string, Row[]][]) : []),
  ];
  const text = () =>
    [`Codex 会话信息（${new Date().toLocaleString("zh-CN")}）`, ...groups.flatMap(([title, rows]) => ["", title, ...rows.map((row) => `  ${row.label}: ${row.value}`)])].join("\n");
  return (
    <div className="session-info" data-tip-group="">
      <div className="session-info-head">
        <span>会话信息</span>
        <CopyKey text={text} label="复制会话信息" compact always />
      </div>
      {groups.map(([title, rows]) => (
        <section key={title} className="session-info-group" aria-label={title}>
          <div className="session-info-title">{title}</div>
          <dl className="session-info-rows">
            {rows.map((row) => (
              <div key={row.label} className="session-info-row">
                <dt>{row.label}</dt>
                <dd>
                  <span>{row.value}</span>
                  {row.copy && <CopyKey text={() => row.copy!} label="复制会话 ID" compact always />}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}
