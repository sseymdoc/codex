// JSON-RPC client for `codex app-server`, carried over the local bridge:
// server -> browser frames stream from GET /api/events (SSE), browser -> server
// messages are POSTed as newline-delimited JSON in send order.

import type { ClientRequest } from "@protocol/ClientRequest";
import type { RequestId } from "@protocol/RequestId";
import type { ServerNotification } from "@protocol/ServerNotification";
import type { ServerRequest } from "@protocol/ServerRequest";

export type Method = ClientRequest["method"];
export type ParamsOf<M extends Method> = Extract<ClientRequest, { method: M }>["params"];

export class RpcError extends Error {
  constructor(
    message: string,
    readonly code: number,
    readonly data?: unknown,
  ) {
    super(message);
  }
}

/** Why a connection ended: bridge unreachable or stream ended, app-server quit, bridge could not start codex, or missing token. */
export type ConnKind = "network" | "exited" | "fatal" | "unauthorized";

export interface Hello {
  connectionId: string;
  cwd: string;
  command: string;
}

export interface RpcHandlers {
  open(hello: Hello): void;
  close(reason: string, detail: string | undefined, kind: ConnKind): void;
  notification(notification: ServerNotification): void;
  request(request: ServerRequest): void;
}

interface Pending {
  resolve(value: unknown): void;
  reject(error: Error): void;
}

export class Rpc {
  private abort?: AbortController;
  private connectionId?: string;
  private nextId = 1;
  private pending = new Map<RequestId, Pending>();
  private outbox: string[] = [];
  private flushing = false;

  constructor(private readonly handlers: RpcHandlers) {}

  async connect(): Promise<void> {
    this.abort?.abort();
    const abort = new AbortController();
    this.abort = abort;
    this.connectionId = undefined;
    let response: Response;
    try {
      response = await fetch("/api/events", { signal: abort.signal, headers: { accept: "text/event-stream" } });
    } catch {
      return this.fail(abort, "network", "无法连接到 Codex UI 服务，请确认它仍在运行。");
    }
    if (response.status === 401) {
      return this.fail(abort, "unauthorized", "未授权：请使用启动终端里打印的带 token 的链接打开页面。");
    }
    if (!response.ok || !response.body) return this.fail(abort, "network", `连接失败（HTTP ${response.status}）。`);

    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    for (;;) {
      const chunk = await reader.read().catch(() => ({ done: true, value: undefined }));
      if (chunk.done) break;
      buffer += chunk.value;
      let end: number;
      while ((end = buffer.indexOf("\n\n")) !== -1) {
        this.frame(abort, buffer.slice(0, end));
        buffer = buffer.slice(end + 2);
      }
    }
    this.fail(abort, "network", "与 app-server 的连接已断开。");
  }

  disconnect(): void {
    this.abort?.abort();
  }

  request<R>(method: Method, params: unknown): Promise<R> {
    const id = this.nextId++;
    return new Promise<R>((resolve, reject) => {
      if (!this.connectionId) return reject(new RpcError("未连接到 app-server", -32000));
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      this.post({ id, method, params });
    });
  }

  notify(method: string, params?: unknown): void {
    this.post(params === undefined ? { method } : { method, params });
  }

  respond(id: RequestId, result: unknown): void {
    this.post({ id, result });
  }

  respondError(id: RequestId, message: string, code = -32000): void {
    this.post({ id, error: { code, message } });
  }

  private frame(abort: AbortController, frame: string): void {
    if (abort !== this.abort) return;
    let event = "message";
    let data = "";
    for (const line of frame.split("\n")) {
      if (line.startsWith("event: ")) event = line.slice(7);
      else if (line.startsWith("data: ")) data += line.slice(6);
    }
    if (!data) return;
    let payload;
    try {
      payload = JSON.parse(data);
    } catch {
      // One corrupt frame must not end the read loop.
      console.warn("codex-ui: skipped a malformed frame", data.slice(0, 200));
      return;
    }
    if (event === "hello") {
      this.connectionId = payload.connectionId;
      this.handlers.open(payload as Hello);
    } else if (event === "fatal") {
      this.fail(abort, "fatal", payload.message);
    } else if (event === "exit") {
      const tail = (payload.stderr as string[] | undefined)?.join("\n");
      this.fail(abort, "exited", `app-server 已退出（${payload.code ?? payload.signal}）。`, tail);
    } else {
      this.dispatch(payload);
    }
  }

  private dispatch(message: Record<string, unknown>): void {
    const id = message.id as RequestId | undefined;
    if (id !== undefined && id !== null && !("method" in message)) {
      const pending = this.pending.get(id);
      if (!pending) return;
      this.pending.delete(id);
      const error = message.error as { code: number; message: string; data?: unknown } | undefined;
      if (error) pending.reject(new RpcError(error.message, error.code, error.data));
      else pending.resolve(message.result);
    } else if (id !== undefined && id !== null) {
      this.handlers.request(message as unknown as ServerRequest);
    } else {
      this.handlers.notification(message as unknown as ServerNotification);
    }
  }

  private post(message: object): void {
    this.outbox.push(JSON.stringify(message));
    void this.flush();
  }

  // One POST in flight at a time keeps messages in send order.
  private async flush(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    while (this.outbox.length && this.connectionId) {
      const body = `${this.outbox.splice(0).join("\n")}\n`;
      try {
        const response = await fetch(`/api/send?c=${encodeURIComponent(this.connectionId)}`, {
          method: "POST",
          headers: { "content-type": "application/x-ndjson" },
          body,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
      } catch {
        if (this.abort) this.fail(this.abort, "network", "向 app-server 发送消息失败。");
        break;
      }
    }
    this.flushing = false;
  }

  private fail(abort: AbortController, kind: ConnKind, reason: string, detail?: string): void {
    if (abort !== this.abort) return;
    abort.abort();
    this.abort = undefined;
    this.connectionId = undefined;
    this.outbox = [];
    for (const pending of this.pending.values()) pending.reject(new RpcError(reason, -32001));
    this.pending.clear();
    this.handlers.close(reason, detail, kind);
  }
}
