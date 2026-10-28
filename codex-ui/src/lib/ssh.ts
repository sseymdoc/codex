// SSH connections for SSH environments (Claude keeps them in its user settings; codex-ui in this
// browser profile). A session in one runs its tools on the host through `codex exec-server` over
// ssh's stdio, registered with the gated environment/addStdio.
import { useSyncExternalStore } from "react";
import { readJson, writeJson } from "./side-sessions.ts";

export interface SshConnection {
  id: string;
  /** A friendly name; the host stands in when empty. */
  name: string;
  /** user@hostname, or a host from ~/.ssh/config. */
  host: string;
  port?: number;
  /** A private key; ssh's own configuration or agent when absent. */
  identityFile?: string;
}

const KEY = "codex-ui:ssh-connections";
const listeners = new Set<() => void>();
let cache: SshConnection[] | null = null;

function read(): SshConnection[] {
  const value = readJson(KEY);
  return Array.isArray(value) ? value.filter((c): c is SshConnection => typeof c?.id === "string" && typeof c?.host === "string") : [];
}

export function sshConnections(): SshConnection[] {
  return (cache ??= read());
}

function write(next: SshConnection[]) {
  cache = next;
  writeJson(KEY, next);
  for (const listener of listeners) listener();
}

export function saveSshConnection(connection: SshConnection): void {
  const list = sshConnections();
  write(list.some((c) => c.id === connection.id) ? list.map((c) => (c.id === connection.id ? connection : c)) : [...list, connection]);
}

export function deleteSshConnection(id: string): void {
  write(sshConnections().filter((c) => c.id !== id));
}

export function useSshConnections(): SshConnection[] {
  return useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, sshConnections);
}

export const sshLabel = (connection: SshConnection) => connection.name.trim() || connection.host;

// cf6ae6197 Xc with shared-28's patterns (Mm host, al user).
const HOST = /^[a-zA-Z0-9.:_][a-zA-Z0-9.:_-]*$/;
const USER = /^[a-zA-Z0-9._][a-zA-Z0-9._\\-]*(?<!\\)$/;

/** Why the host can't be used, or undefined. */
export function hostError(raw: string): string | undefined {
  const host = raw.trim();
  if (!host) return "请输入 SSH 主机。";
  if (/^ssh\s/i.test(host) || /\s/.test(host)) return "此处只需输入 user@hostname。端口或密钥等选项请在下方字段或 ~/.ssh/config 中填写。";
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(host)) return "请删除 ssh:// 前缀并输入 user@hostname。";
  const at = host.indexOf("@");
  const user = at === -1 ? undefined : host.slice(0, at);
  if (!HOST.test(at === -1 ? host : host.slice(at + 1))) return "这不是有效的主机名或地址。请使用字母、数字、“.”、“-”、“_”或“:”，且不要以“-”开头。";
  if (user !== undefined && !USER.test(user)) return "@ 之前的部分不是有效的用户名。请使用字母、数字、“.”、“-”、“_”或“\\”，且不要以“-”开头。";
}

export function portError(raw: string): string | undefined {
  const port = raw.trim();
  if (!port) return;
  const value = /^\d+$/.test(port) ? Number(port) : NaN;
  if (!Number.isInteger(value) || value < 1 || value > 65535) return "端口必须是 1 到 65535 之间的数字。";
}

export const sshEnvironmentId = (connection: SshConnection) => `codexui-ssh-${connection.id}`;

/**
 * ssh, never asking (the protocol owns its stdin: keys or the agent only), accepting a first-seen
 * host key, then a login shell on the host that starts the exec-server on its stdio.
 */
export function sshCommand(connection: SshConnection): { program: string; args: string[] } {
  return {
    program: "ssh",
    args: [
      "-o", "BatchMode=yes",
      "-o", "StrictHostKeyChecking=accept-new",
      ...(connection.port ? ["-p", String(connection.port)] : []),
      ...(connection.identityFile ? ["-i", connection.identityFile] : []),
      "--",
      connection.host.trim(),
      "sh -lc 'exec codex exec-server --listen stdio'",
    ],
  };
}
