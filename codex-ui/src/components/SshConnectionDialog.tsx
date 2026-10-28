// 添加 / 编辑 SSH 连接 (Claude cf6ae6197 fl): a name, the host, its port and key, a connection test
// and, for a saved one, 删除连接. The test registers the host with the backend under a scratch id
// and asks it for the host's shell (environment/info), which starts `codex exec-server` there.

import { useState } from "react";
import { callExperimental, ensureSshEnvironment, errorMessage, sshSupported } from "../lib/codex";
import { deleteSshConnection, hostError, portError, saveSshConnection, sshCommand, sshConnections, sshLabel, type SshConnection } from "../lib/ssh";
import { Button, Dialog, Spinner } from "./ui";

type Test = { state: "idle" } | { state: "testing" } | { state: "ok" } | { state: "failed"; error: string };

export function SshConnectionDialog({ connection, onClose, onSaved, onDeleted }: {
  connection?: SshConnection;
  onClose(): void;
  onSaved(connection: SshConnection): void;
  onDeleted?(): void;
}) {
  const [name, setName] = useState(connection?.name ?? "");
  const [host, setHost] = useState(connection?.host ?? "");
  const [port, setPort] = useState(connection?.port ? String(connection.port) : "");
  const [key, setKey] = useState(connection?.identityFile ?? "");
  const [touched, setTouched] = useState(false);
  const [test, setTest] = useState<Test>({ state: "idle" });
  const [deleting, setDeleting] = useState(false);

  const draft: SshConnection = {
    id: connection?.id ?? crypto.randomUUID(),
    name: name.trim(),
    host: host.trim(),
    ...(port.trim() && { port: Number(port.trim()) }),
    ...(key.trim() && { identityFile: key.trim() }),
  };
  const hostProblem = hostError(host);
  const portProblem = portError(port);
  const twin = sshConnections().find((other) => other.id !== connection?.id && other.host.trim().toLowerCase() === draft.host.toLowerCase() && (other.port ?? 22) === (draft.port ?? 22));
  const valid = !hostProblem && !portProblem;

  const runTest = async () => {
    setTest({ state: "testing" });
    try {
      const environmentId = "codexui-ssh-test";
      await callExperimental("environment/addStdio", { environmentId, ...sshCommand(draft) });
      await callExperimental("environment/info", { environmentId });
      setTest({ state: "ok" });
    } catch (error) {
      setTest({ state: "failed", error: errorMessage(error) });
    }
  };

  const save = () => {
    setTouched(true);
    if (!valid) return;
    saveSshConnection(draft);
    // A host already registered with the backend picks up the new port or key.
    if (connection && sshSupported()) void ensureSshEnvironment(draft, true).catch(() => {});
    onSaved(draft);
  };

  const field = (label: string, input: React.ReactNode, note?: string, error?: string) => (
    <label className="env-field">
      <span className="env-label-row"><span className="env-label">{label}</span></span>
      {input}
      {(error ?? note) && <span className={error ? "env-footnote env-error" : "env-footnote"}>{error ?? note}</span>}
    </label>
  );

  return (
    <>
      <Dialog
        title={connection ? "编辑 SSH 连接" : "添加 SSH 连接"}
        description="连接到远程计算机以运行 Codex。"
        onClose={onClose}
        footer={
          <>
            {connection && <Button variant="ghost" className="dialog-foot-delete" onClick={() => setDeleting(true)}>删除连接</Button>}
            <Button variant="secondary" onClick={onClose}>取消</Button>
            <Button variant="primary" disabled={touched && !valid} onClick={save}>{connection ? "保存" : "添加"}</Button>
          </>
        }
      >
        <div className="env-form">
          {field("名称", <input className="input" value={name} placeholder={draft.host || undefined} autoComplete="off" onChange={(event) => setName(event.target.value)} />, "此 SSH 连接的易记名称。")}
          {field(
            "SSH 主机",
            <input className="input" data-autofocus value={host} placeholder="user@myserver.com" autoComplete="off" spellCheck={false} aria-invalid={(touched && !!hostProblem) || undefined} onChange={(event) => setHost(event.target.value)} onBlur={() => host && setTouched(true)} />,
            twin ? `您已有此主机的 SSH 连接：${sshLabel(twin)}。` : "user@myserver.com 或 ~/.ssh/config 中的主机。",
            touched ? hostProblem : undefined,
          )}
          {field(
            "SSH 端口",
            <input className="input" value={port} inputMode="numeric" placeholder="默认（22）或您的 SSH 配置" autoComplete="off" aria-invalid={!!portProblem || undefined} onChange={(event) => setPort(event.target.value)} />,
            "留空则使用默认值（22）或您的 SSH 配置。",
            portProblem,
          )}
          {field(
            "SSH 密钥（可选）",
            <input className="input" value={key} placeholder="您的 SSH 配置或 SSH 代理" autoComplete="off" spellCheck={false} onChange={(event) => setKey(event.target.value)} />,
            "私钥的路径。留空则使用您的 SSH 配置或代理。",
          )}
          <div className="ssh-test">
            <Button variant="secondary" size="sm" disabled={!valid || test.state === "testing" || !sshSupported()} onClick={() => void runTest()}>
              {test.state === "testing" && <Spinner inherit />}测试连接
            </Button>
            <span role="status" className={test.state === "failed" ? "env-footnote env-error" : "env-footnote"}>
              {test.state === "ok" ? "已连接。此主机已可使用。" : test.state === "failed" ? `连接失败：${test.error}` : !sshSupported() ? "需要开启实验型后端。" : ""}
            </span>
          </div>
        </div>
      </Dialog>
      {deleting && connection && (
        <Dialog alert size="sm" title="删除 SSH 连接？" description={<>“{sshLabel(connection)}”将被永久删除。此操作无法撤销。</>} onClose={() => setDeleting(false)} footer={
          <>
            <Button variant="secondary" onClick={() => setDeleting(false)}>取消</Button>
            <Button variant="danger" data-autofocus onClick={() => { deleteSshConnection(connection.id); setDeleting(false); onDeleted?.(); onClose(); }}>删除连接</Button>
          </>
        } />
      )}
    </>
  );
}
