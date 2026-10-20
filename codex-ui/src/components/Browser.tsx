// Browser pane backed by Codex UI's native Electron browser executor.
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { attachBrowserContext, browserRequest, browserUrl, useBrowser, type BrowserEvent, type BrowserServerConfig } from "../lib/browser";
import { innerClose, togglePane } from "../lib/panes";
import { toast } from "../lib/store";
import { PaneEmpty, PaneFrame } from "./Panes";
import { Button, Dialog, Icon, MenuItem, MenuSep, Popover, Spinner, Toggle } from "./ui";

export function BrowserPane({ view, cwd }: { view: string; cwd: string }) {
  const state = useBrowser(view, cwd);
  const tab = state?.tabs.find((tab) => tab.id === state.active);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [address, setAddress] = useState("");
  const [viewportMenu, setViewportMenu] = useState(false);
  const [customViewport, setCustomViewport] = useState(false);
  const [width, setWidth] = useState(375),
    [height, setHeight] = useState(812);
  const [servers, setServers] = useState(false),
    [settings, setSettings] = useState(false),
    [logs, setLogs] = useState(false);
  const [annotation, setAnnotation] = useState<{ image: string; url: string } | null>(null);
  const input = useRef<HTMLInputElement>(null),
    root = useRef<HTMLDivElement>(null);
  const composing = useRef(false),
    ended = useRef(-Infinity);
  const act = async <T,>(action: string, args: Record<string, unknown> = {}): Promise<T | undefined> => {
    setError("");
    try {
      return await browserRequest<T>(view, cwd, action, args);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setError(message);
      toast("danger", "浏览器操作失败", message);
    }
  };
  const edit = () => {
    setAddress(tab?.url === "about:blank" ? "" : (tab?.url ?? ""));
    setEditing(true);
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.select();
    });
  };
  const navigate = (event: FormEvent) => {
    event.preventDefault();
    if (composing.current || performance.now() - ended.current < 50) return;
    try {
      void act(tab ? "navigate" : "new", { url: browserUrl(address) });
      setEditing(false);
      input.current?.blur();
    } catch (error) {
      setError((error as Error).message);
    }
  };
  useEffect(() => {
    if (!editing) setAddress(tab?.url === "about:blank" ? "" : (tab?.url ?? ""));
  }, [tab?.url, editing]);
  useEffect(() => {
    const receive = (event: Event) => {
      const data = (event as CustomEvent<BrowserEvent>).detail;
      if (data.view !== view) return;
      if (data.notice) setError(data.notice);
      if (data.selection) {
        attachBrowserContext(
          view,
          `请查看此页面元素：${data.selection.url}\n\n${JSON.stringify(data.selection.element, null, 2)}`,
          data.selection.image,
        );
        toast("neutral", "已将元素与截图附加到输入框");
      }
      if (data.shortcut === "l" || data.shortcut === "f6") edit();
      if (data.shortcut === "t") void act(data.shift ? "reopen" : "new");
      if (data.shortcut === "w") void act("close", { tabId: tab?.id });
      if (data.shortcut === "b") togglePane("browser", view);
      if (data.shortcut && /^[1-9]$/.test(data.shortcut)) {
        const target = state?.tabs[Number(data.shortcut) - 1];
        if (target) void act("select", { tabId: target.id });
      }
      if (data.shortcut === "tab" && state?.tabs.length) {
        const index = state.tabs.findIndex((item) => item.id === state.active);
        const target = state.tabs[(index + (data.shift ? -1 : 1) + state.tabs.length) % state.tabs.length];
        void act("select", { tabId: target.id });
      }
    };
    window.addEventListener("codex-browser", receive);
    innerClose.set("browser", () => {
      if (!tab) return false;
      void act("close", { tabId: tab.id });
      return true;
    });
    return () => {
      window.removeEventListener("codex-browser", receive);
      innerClose.delete("browser");
    };
  }, [view, cwd, tab?.id, state]);
  const page = !!tab && tab.url !== "about:blank" && !tab.error;
  const hidden = !page || !!annotation || !state?.settings.enabled;
  useLayoutEffect(() => {
    let frame = 0,
      last = "";
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const rect = root.current?.getBoundingClientRect();
        if (!rect) return;
        const occluded = [...document.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"], .popover, .palette')].some(
          (el) => {
            if (!el.getClientRects().length) return false;
            const r = el.getBoundingClientRect();
            return r.left < rect.right && r.right > rect.left && r.top < rect.bottom && r.bottom > rect.top;
          },
        );
        const next = { rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, hidden: hidden || occluded };
        const key = JSON.stringify(next);
        if (key === last) return;
        last = key;
        void browserRequest(view, cwd, "bounds", next).catch(() => {});
      });
    };
    const resize = new ResizeObserver(update);
    if (root.current) resize.observe(root.current);
    const mutation = new MutationObserver(update);
    mutation.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "hidden", "aria-hidden"],
    });
    update();
    window.addEventListener("resize", update);
    document.addEventListener("scroll", update, true);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      mutation.disconnect();
      window.removeEventListener("resize", update);
      document.removeEventListener("scroll", update, true);
      void browserRequest(view, cwd, "hide").catch(() => {});
    };
  }, [view, cwd, hidden, tab?.id, logs]);
  const tabs = state?.tabs ?? [];
  const tabStrip = tabs.length ? (
    <div className="browser-tabs" role="tablist" aria-label="浏览器标签">
      {tabs.map((item) => (
        <div
          className="browser-tab"
          data-active={item.id === tab?.id || undefined}
          key={item.id}
          draggable
          onDragStart={(e) => e.dataTransfer.setData("text/plain", item.id)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void act("reorder", { tabId: e.dataTransfer.getData("text/plain"), before: item.id });
          }}
        >
          <button
            type="button"
            role="tab"
            aria-selected={item.id === tab?.id}
            title={item.title}
            onClick={() => void act("select", { tabId: item.id })}
          >
            {item.loading || item.busy ? <Spinner size={12} /> : <Icon name="Globe" size={13} />}
            <span>{item.title}</span>
          </button>
          <button
            type="button"
            className="browser-tab-close"
            aria-label={`关闭 ${item.title}`}
            onClick={() => void act("close", { tabId: item.id })}
          >
            <Icon name="X" size={12} />
          </button>
        </div>
      ))}
      <Button variant="ghost" icon={<Icon name="Add" size={16} />} label="新标签页" kbd="Ctrl+T" onClick={() => void act("new")} />
    </div>
  ) : undefined;
  return (
    <PaneFrame
      view={view}
      pane="browser"
      title={tabStrip}
      trailing={
        !tabs.length ? (
          <Button variant="ghost" icon={<Icon name="Add" size={16} />} label="新标签页" onClick={() => void act("new")} />
        ) : undefined
      }
      onKeyDown={(e) => {
        if (!(e.ctrlKey || e.metaKey) || e.nativeEvent.isComposing) return;
        if (e.key.toLowerCase() === "l") {
          e.preventDefault();
          edit();
        }
        if (e.key.toLowerCase() === "t") {
          e.preventDefault();
          void act(e.shiftKey ? "reopen" : "new");
        }
      }}
      menu={(close) => (
        <>
          <MenuItem
            icon={<Icon name="CommandLinePrompt" size={16} />}
            label="服务器与设置"
            onClick={() => {
              close();
              setServers(true);
            }}
          />
          <MenuItem
            label={logs ? "隐藏开发服务器日志" : "显示开发服务器日志"}
            onClick={() => {
              close();
              setLogs(!logs);
            }}
          />
          <MenuSep />
          <MenuItem
            label="复制网址"
            disabled={!page}
            onClick={() => {
              close();
              void act("copyUrl");
            }}
          />
          <MenuItem
            label="在系统浏览器中打开"
            disabled={!tab?.url.startsWith("http")}
            onClick={() => {
              close();
              void act("external");
            }}
          />
          <MenuItem
            label="打开 HTML 文件…"
            onClick={() => {
              close();
              void act("openFile");
            }}
          />
          <MenuItem
            label="保存截图"
            disabled={!page}
            onClick={() => {
              close();
              void act("saveScreenshot");
            }}
          />
          <MenuItem
            label="导出为 PDF…"
            disabled={!page}
            onClick={() => {
              close();
              void act("export");
            }}
          />
          <MenuSep />
          <MenuItem
            label="关闭其他标签页"
            disabled={tabs.length < 2}
            onClick={() => {
              close();
              void act("closeOthers");
            }}
          />
          <MenuItem
            label="重新打开关闭的标签页"
            kbd="Ctrl+Shift+T"
            onClick={() => {
              close();
              void act("reopen");
            }}
          />
          <MenuSep />
          <MenuItem
            label="浏览器设置…"
            onClick={() => {
              close();
              setSettings(true);
            }}
          />
        </>
      )}
    >
      <div className="browser-toolbar">
        <Button
          variant="ghost"
          icon={<Icon name="CaretLeft" size={16} />}
          label="后退"
          disabled={!tab?.canGoBack}
          onClick={() => void act("back")}
        />
        <Button
          variant="ghost"
          icon={<Icon name="CaretRight" size={16} />}
          label="前进"
          disabled={!tab?.canGoForward}
          onClick={() => void act("forward")}
        />
        <Button
          variant="ghost"
          icon={tab?.loading ? <Spinner size={14} /> : <Icon name="ArrowClockwise" size={15} />}
          label="重新加载"
          disabled={!tab}
          onClick={() => void act("reload")}
        />
        <form className="browser-address" data-editing={editing || undefined} onSubmit={navigate}>
          {editing || !page ? (
            <input
              ref={input}
              value={address}
              aria-label="页面网址"
              placeholder="输入网址"
              spellCheck={false}
              dir="ltr"
              onFocus={() => setEditing(true)}
              onChange={(e) => setAddress(e.target.value)}
              onCompositionStart={() => {
                composing.current = true;
              }}
              onCompositionEnd={() => {
                composing.current = false;
                ended.current = performance.now();
              }}
              onBlur={() => setEditing(false)}
              onKeyDown={(e) => {
                if (e.key === "Escape" && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  e.stopPropagation();
                  setEditing(false);
                  e.currentTarget.blur();
                }
              }}
            />
          ) : (
            <button type="button" aria-label={`页面网址：${tab?.url}`} onClick={edit} dir="ltr">
              {address}
            </button>
          )}
        </form>
        <Button
          variant="ghost"
          icon={<Icon name="Cursor" size={16} />}
          label={tab?.inspecting ? "退出元素选择" : "选择元素"}
          tip="将元素的 HTML、样式及截图附加到输入框"
          active={tab?.inspecting}
          disabled={!page}
          onClick={() => void act("inspect")}
        />
        <Button
          variant="ghost"
          icon={<Icon name="Edit" size={16} />}
          label="标注"
          disabled={!page}
          onClick={() => {
            void act<{ image: string }>("screenshot").then((result) => {
              if (result) setAnnotation({ image: result.image, url: tab!.url });
            });
          }}
        />
        <Popover
          open={viewportMenu}
          onClose={() => setViewportMenu(false)}
          placement="bottom-end"
          anchor={
            <Button
              variant="ghost"
              icon={<Icon name="Laptop" size={16} />}
              label="视口"
              active={!!tab?.viewport}
              disabled={!page}
              onClick={() => setViewportMenu(!viewportMenu)}
            />
          }
        >
          {(
            [
              ["desktop", "响应式"],
              ["mobile", "手机 · 375 × 812"],
              ["tablet", "平板 · 768 × 1024"],
            ] as const
          ).map(([preset, label]) => (
            <MenuItem
              key={preset}
              label={label}
              onClick={() => {
                setViewportMenu(false);
                void act("viewport", { preset });
              }}
            />
          ))}
          <MenuItem
            label="自定义…"
            onClick={() => {
              setViewportMenu(false);
              setWidth(tab?.viewport?.width ?? 375);
              setHeight(tab?.viewport?.height ?? 812);
              setCustomViewport(true);
            }}
          />
          <MenuSep />
          {(
            [
              ["system", "跟随系统"],
              ["light", "浅色"],
              ["dark", "深色"],
            ] as const
          ).map(([colorScheme, label]) => (
            <MenuItem
              key={colorScheme}
              label={label}
              checked={tab?.colorScheme === colorScheme}
              onClick={() => {
                setViewportMenu(false);
                void act("viewport", { colorScheme });
              }}
            />
          ))}
        </Popover>
      </div>
      {error && (
        <div className="browser-error" role="alert">
          <span>{error}</span>
          <button type="button" aria-label="关闭错误提示" onClick={() => setError("")}>
            <Icon name="X" size={14} />
          </button>
        </div>
      )}
      <div
        className="browser-page"
        ref={root}
        tabIndex={page ? 0 : -1}
        aria-label="浏览器页面，按 Enter 进入页面，F6 返回地址栏"
        onKeyDown={(e) => {
          if (page && e.key === "Enter") {
            e.preventDefault();
            void act("focus");
          }
        }}
      >
        {!state?.settings.enabled ? (
          <PaneEmpty
            icon={<Icon name="Globe" size={28} />}
            title="浏览器工具已关闭"
            body="开启后，Codex 可以在这里打开网页、运行开发服务器并验证更改。"
          >
            <Button onClick={() => void act("settings", { enabled: true })}>开启浏览器工具</Button>
          </PaneEmpty>
        ) : tab?.error ? (
          <PaneEmpty title="无法加载此页面" body={tab.error}>
            <Button onClick={() => void act("reload")}>重试</Button>
          </PaneEmpty>
        ) : !page ? (
          <PaneEmpty icon={<Icon name="Globe" size={28} />} title="浏览器" body="运行服务器来预览应用，或在地址栏输入网址。">
            <Button onClick={() => setServers(true)}>检测开发服务器</Button>
          </PaneEmpty>
        ) : null}
      </div>
      {logs && (
        <section className="browser-logs" aria-label="开发服务器日志">
          <div>
            <span>开发服务器日志</span>
            <Button variant="ghost" icon={<Icon name="X" size={14} />} label="关闭日志" onClick={() => setLogs(false)} />
          </div>
          <pre>{state?.servers.flatMap((server) => server.logs.map((line) => `[${server.name}] ${line}`)).join("\n") || "等待输出…"}</pre>
        </section>
      )}
      {servers && <BrowserServers view={view} cwd={cwd} onClose={() => setServers(false)} />}
      {settings && <BrowserSettings view={view} cwd={cwd} onClose={() => setSettings(false)} />}
      {customViewport && (
        <Dialog
          title="自定义视口"
          onClose={() => setCustomViewport(false)}
          footer={
            <>
              <Button onClick={() => setCustomViewport(false)}>取消</Button>
              <Button
                variant="primary"
                onClick={() => {
                  void act("viewport", { width, height });
                  setCustomViewport(false);
                }}
              >
                应用
              </Button>
            </>
          }
        >
          <div className="browser-fields">
            <label>
              宽度
              <input type="number" min={1} max={9999} value={width} onChange={(e) => setWidth(Number(e.target.value))} />
            </label>
            <span>×</span>
            <label>
              高度
              <input type="number" min={1} max={9999} value={height} onChange={(e) => setHeight(Number(e.target.value))} />
            </label>
          </div>
        </Dialog>
      )}
      {annotation && (
        <Annotate
          image={annotation.image}
          onClose={() => setAnnotation(null)}
          onAttach={(image) => {
            attachBrowserContext(view, `请查看页面标注：${annotation.url}`, image);
            setAnnotation(null);
          }}
        />
      )}
    </PaneFrame>
  );
}

export function BrowserSettings({ view, cwd, onClose }: { view: string; cwd: string; onClose(): void }) {
  const state = useBrowser(view, cwd);
  const change = (args: Record<string, unknown>) => {
    void browserRequest(view, cwd, "settings", args).catch((error) => toast("danger", "无法保存浏览器设置", error.message));
  };
  return (
    <Dialog title="浏览器设置" onClose={onClose} footer={<Button onClick={onClose}>完成</Button>}>
      <div className="browser-setting">
        <div>
          <strong>浏览器工具</strong>
          <p>Codex 可以启动开发服务器、浏览网页，并通过截图、快照和 DOM 检查来验证更改。</p>
        </div>
        <Toggle checked={state?.settings.enabled ?? true} onChange={(enabled) => change({ enabled })} label="浏览器工具" />
      </div>
      <div className="browser-setting">
        <div>
          <strong>在内置浏览器中打开链接</strong>
          <p>在 Codex 中点开的网页链接会出现在此会话的浏览器面板中。</p>
        </div>
        <Toggle
          checked={state?.settings.openLinks ?? false}
          label="在内置浏览器中打开链接"
          onChange={(openLinks) => change({ openLinks })}
        />
      </div>
      <div className="browser-setting">
        <div>
          <strong>保留 Cookie</strong>
          <p>共享会让所有会话使用同一份登录状态；按会话保存可隔离各会话的登录。更改模式会关闭当前标签。</p>
        </div>
        <select aria-label="保留 Cookie" value={state?.settings.storage ?? "none"} onChange={(e) => change({ storage: e.target.value })}>
          <option value="none">保留到退出</option>
          <option value="shared">共享</option>
          <option value="session">按会话保存</option>
        </select>
      </div>
      <div className="browser-setting">
        <div>
          <strong>已允许的网站</strong>
          <p>移除后，Codex 下次访问时会再次询问。</p>
        </div>
      </div>
      <ul className="browser-origins">
        {state?.settings.allowedOrigins.map((origin) => (
          <li key={origin}>
            <span>{origin}</span>
            <Button
              variant="ghost"
              icon={<Icon name="X" size={14} />}
              label={`移除 ${origin}`}
              onClick={() => change({ removeOrigin: origin })}
            />
          </li>
        ))}
      </ul>
      <div className="browser-setting">
        <span>清除浏览数据</span>
        <Button onClick={() => void browserRequest(view, cwd, "clearData").catch((error) => toast("danger", "清理失败", error.message))}>
          清除…
        </Button>
      </div>
    </Dialog>
  );
}

function BrowserServers({ view, cwd, onClose }: { view: string; cwd: string; onClose(): void }) {
  const state = useBrowser(view, cwd);
  const [config, setConfig] = useState<BrowserServerConfig[]>([]),
    [candidates, setCandidates] = useState<BrowserServerConfig[]>([]);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [autoVerify, setAutoVerify] = useState(false),
    [adding, setAdding] = useState(false);
  const [name, setName] = useState("dev"),
    [runner, setRunner] = useState("npm"),
    [script, setScript] = useState("dev"),
    [port, setPort] = useState(5173);
  const load = () =>
    browserRequest<{ configurations: BrowserServerConfig[]; autoVerify: boolean }>(view, cwd, "servers")
      .then((result) => {
        setConfig(result.configurations);
        setAutoVerify(result.autoVerify);
      })
      .catch((error) => setError(error.message));
  useEffect(() => {
    void load();
  }, [view, cwd]);
  const act = async (action: string, args: Record<string, unknown> = {}) => {
    setBusy(true);
    setError("");
    try {
      await browserRequest(view, cwd, action, args);
      await load();
      return true;
    } catch (error) {
      setError((error as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const add = (entry: BrowserServerConfig) =>
    void act("addServer", { entry }).then((saved) => {
      if (saved) {
        setCandidates([]);
        setAdding(false);
      }
    });
  return (
    <Dialog
      title="服务器与设置"
      onClose={onClose}
      size="lg"
      footer={
        <>
          <Button onClick={() => void act("stopAll")}>停止所有服务器</Button>
          <Button onClick={onClose}>完成</Button>
        </>
      }
    >
      {error && (
        <p className="browser-error" role="alert">
          {error}
        </p>
      )}
      <div className="browser-server-list">
        {config.map((entry) => {
          const running = state?.servers.find((server) => server.name === entry.name);
          return (
            <div className="browser-server" key={entry.name}>
              <div>
                <strong>{entry.name}</strong>
                <p>
                  {entry.runtimeExecutable} {entry.runtimeArgs.join(" ")} · {entry.port}
                </p>
                <small>
                  {running?.status === "running"
                    ? "运行中"
                    : running?.status === "starting"
                      ? "启动中…"
                      : running?.status === "failed"
                        ? "启动失败"
                        : "已停止"}
                </small>
              </div>
              <Button
                disabled={busy}
                onClick={() => void act(running?.status === "running" ? "stopServer" : "startServer", { name: entry.name })}
              >
                {running?.status === "running" ? "停止" : "运行"}
              </Button>
            </div>
          );
        })}
      </div>
      {!config.length && <p className="browser-muted">尚未配置开发服务器。</p>}
      <div className="browser-actions">
        <Button
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void browserRequest<{ candidates: BrowserServerConfig[] }>(view, cwd, "detectServers")
              .then((result) => setCandidates(result.candidates))
              .catch((error) => setError(error.message))
              .finally(() => setBusy(false));
          }}
        >
          检测开发服务器
        </Button>
        <Button onClick={() => setAdding(!adding)}>添加服务器</Button>
        {busy && <Spinner />}
      </div>
      {candidates.map((candidate) => (
        <div className="browser-server" key={candidate.name}>
          <span>{candidate.name}</span>
          <label>
            端口
            <input
              aria-label={`${candidate.name} 端口`}
              type="number"
              value={candidate.port}
              onChange={(e) =>
                setCandidates((items) => items.map((item) => (item === candidate ? { ...item, port: Number(e.target.value) } : item)))
              }
            />
          </label>
          <Button onClick={() => add(candidate)}>使用此配置</Button>
        </div>
      ))}
      {adding && (
        <form
          className="browser-server-form"
          onSubmit={(e) => {
            e.preventDefault();
            add({ name, runtimeExecutable: runner, runtimeArgs: ["run", script], port });
          }}
        >
          <label>
            名称
            <input required value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            包管理器
            <select value={runner} onChange={(e) => setRunner(e.target.value)}>
              {["npm", "pnpm", "yarn", "bun"].map((name) => (
                <option key={name}>{name}</option>
              ))}
            </select>
          </label>
          <label>
            脚本
            <input required value={script} onChange={(e) => setScript(e.target.value)} />
          </label>
          <label>
            端口
            <input type="number" min={1} max={65535} value={port} onChange={(e) => setPort(Number(e.target.value))} />
          </label>
          <Button type="submit" disabled={busy}>
            保存
          </Button>
        </form>
      )}
      <div className="browser-setting">
        <div>
          <strong>自动验证更改</strong>
          <p>让 Codex 在编辑后通过浏览器检查结果。新建或重新加载会话后生效。</p>
        </div>
        <Toggle
          checked={autoVerify}
          label="自动验证更改"
          onChange={(enabled) => {
            setAutoVerify(enabled);
            void act("autoVerify", { enabled });
          }}
        />
      </div>
    </Dialog>
  );
}

function Annotate({ image, onClose, onAttach }: { image: string; onClose(): void; onAttach(image: string): void }) {
  const canvas = useRef<HTMLCanvasElement>(null),
    drawing = useRef(false);
  const paint = () => {
    const node = canvas.current;
    if (!node) return;
    const picture = new Image();
    picture.onload = () => {
      node.width = picture.naturalWidth;
      node.height = picture.naturalHeight;
      node.getContext("2d")?.drawImage(picture, 0, 0);
    };
    picture.src = image;
  };
  useEffect(paint, [image]);
  return (
    <Dialog
      title="标注页面"
      onClose={onClose}
      size="3xl"
      footer={
        <>
          <Button onClick={paint}>清除标注</Button>
          <Button onClick={onClose}>取消</Button>
          <Button
            variant="primary"
            onClick={() => {
              const node = canvas.current;
              if (node) onAttach(node.toDataURL("image/png"));
            }}
          >
            附加到输入框
          </Button>
        </>
      }
    >
      <canvas
        ref={canvas}
        className="browser-annotation"
        aria-label="页面标注画布"
        onPointerDown={(e) => {
          const node = e.currentTarget,
            r = node.getBoundingClientRect(),
            ctx = node.getContext("2d");
          if (!ctx) return;
          node.setPointerCapture(e.pointerId);
          drawing.current = true;
          ctx.strokeStyle = "#e33b33";
          ctx.lineWidth = Math.max(3, (node.width / r.width) * 3);
          ctx.lineCap = "round";
          ctx.beginPath();
          ctx.moveTo(((e.clientX - r.left) * node.width) / r.width, ((e.clientY - r.top) * node.height) / r.height);
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const node = e.currentTarget,
            r = node.getBoundingClientRect(),
            ctx = node.getContext("2d");
          ctx?.lineTo(((e.clientX - r.left) * node.width) / r.width, ((e.clientY - r.top) * node.height) / r.height);
          ctx?.stroke();
        }}
        onPointerUp={() => {
          drawing.current = false;
        }}
        onPointerCancel={() => {
          drawing.current = false;
        }}
      />
    </Dialog>
  );
}
