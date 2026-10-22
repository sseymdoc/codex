// Browser pane backed by Codex UI's native Electron browser executor.
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { attachBrowserContext, browserRequest, browserUrl, useBrowser, type BrowserEvent, type BrowserServerConfig } from "../lib/browser";
import { innerClose, togglePane } from "../lib/panes";
import { toast } from "../lib/store";
import { PaneEmpty, PaneFrame } from "./Panes";
import { Button, Dialog, Icon, MenuItem, MenuSection, MenuSelect, MenuSep, Popover, Spinner, Submenu, Toggle } from "./ui";

/** c224804cc Y: the URL as the field shows it, without http(s):// and the slash after a bare host. */
function shortUrl(url: string) {
  const rest = url.replace(/^https?:\/\//, "");
  if (rest === url) return url;
  const host = /^([^/?#]+)\/$/.exec(rest)?.[1];
  const name = host?.slice(host.lastIndexOf("@") + 1) ?? "";
  return host !== undefined && (name.includes(".") || /^localhost(:\d+)?$/i.test(name) || name.startsWith("[") || /^[^:]+:\d+$/.test(name)) ? host : rest;
}

/** cf550b864 de: the host part (primary ink) and the rest (muted) of a shown URL, when it has one. */
function splitHost(shown: string) {
  if (!shown || /^[/\\~.]|\s/.test(shown)) return null;
  try {
    const url = new URL(`http://${shown}`);
    if (!(url.hostname.includes(".") || url.port || url.hostname === "localhost") || !shown.toLowerCase().startsWith(url.host)) return null;
    return { host: shown.slice(0, url.host.length), suffix: shown.slice(url.host.length) };
  } catch {
    return null;
  }
}

const VIEWPORTS = [
  { preset: "mobile", label: "移动端", width: 375, height: 812 },
  { preset: "tablet", label: "平板电脑", width: 768, height: 1024 },
] as const;
const STORAGE = {
  none: { label: "直到退出", hint: "应用退出时将清除 Cookie" },
  shared: { label: "已共享", hint: "所有会话共享 Cookie" },
  session: { label: "每次会话", hint: "每个会话保留各自的 Cookie" },
} as const;
export const AUTO_OPEN_HINT = "Codex 编写的 HTML、图片和视频会在内置浏览器中打开。";

export function BrowserPane({ view, cwd }: { view: string; cwd: string }) {
  const state = useBrowser(view, cwd);
  const tab = state?.tabs.find((tab) => tab.id === state.active);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [address, setAddress] = useState("");
  const [customViewport, setCustomViewport] = useState(false);
  const [width, setWidth] = useState(375),
    [height, setHeight] = useState(812);
  // The servers dialog, opened on its add form from 添加服务器.
  const [servers, setServers] = useState<boolean | "add">(false),
    [serverMenu, setServerMenu] = useState(false),
    [configs, setConfigs] = useState<BrowserServerConfig[] | null>(null),
    [launchFile, setLaunchFile] = useState(".claude/launch.json"),
    [pending, setPending] = useState<string>(),
    [settings, setSettings] = useState(false),
    [clearing, setClearing] = useState(false),
    [logs, setLogs] = useState(false),
    [autoVerify, setAutoVerify] = useState(false);
  const [annotation, setAnnotation] = useState<{ image: string; url: string } | null>(null);
  const input = useRef<HTMLInputElement>(null),
    root = useRef<HTMLDivElement>(null);
  const composing = useRef(false),
    ended = useRef(-Infinity),
    selected = useRef(false);
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
  const url = tab?.url === "about:blank" ? "" : (tab?.url ?? "");
  const shown = shortUrl(url);
  const host = splitHost(shown);
  // Focus starts editing (the field's onFocus); a second Ctrl+L selects the whole URL again.
  const edit = () => {
    input.current?.focus();
    input.current?.select();
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
    if (!editing) setAddress(url);
  }, [url, editing]);
  // The configured servers and 自动验证更改 live in launch.json: read it again as the server menu
  // opens, the start page comes back and the servers dialog (which edits it) closes.
  const loadServers = () =>
    void browserRequest<{ configurations: BrowserServerConfig[]; autoVerify: boolean; file: string }>(view, cwd, "servers")
      .then((result) => {
        setConfigs(result.configurations);
        setAutoVerify(result.autoVerify);
        setLaunchFile(result.file);
      })
      .catch(() => setConfigs([]));
  const page = !!tab && tab.url !== "about:blank" && !tab.error;
  useEffect(() => {
    if (!servers && !page) loadServers();
  }, [view, cwd, servers, page]);
  // cf580efe9 ki: the configured servers with their processes, then processes no entry names.
  const processes = state?.servers ?? [];
  const rows: ServerRow[] = [
    ...(configs ?? []).map((entry) => ({ name: entry.name, port: entry.port, server: processes.find((server) => server.name === entry.name) })),
    ...processes.filter((server) => !configs?.some((entry) => entry.name === server.name)).map((server) => ({ name: server.name, port: server.port, server })),
  ].map(({ name, port, server }) => ({
    name,
    port: server?.port || port,
    live: server?.status === "running" || server?.status === "starting",
    starting: server?.status === "starting",
  }));
  const toggleServer = (row: ServerRow) => {
    setPending(row.name);
    void act(row.live ? "stopServer" : "startServer", { name: row.name }).finally(() => setPending(undefined));
  };
  // cf580efe9 fa's 打开: the tab already on the server, or a new one.
  const openServer = (row: ServerRow) => {
    const open = state?.tabs.find((item) => [`http://127.0.0.1:${row.port}`, `http://localhost:${row.port}`].some((origin) => item.url.startsWith(origin)));
    void act(open ? "select" : "new", open ? { tabId: open.id } : { url: `http://127.0.0.1:${row.port}` });
  };
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
  // With no tab open Claude's strip still shows one, an unclosable 新建标签页 (cf580efe9 Da).
  const tabStrip = (
    <div className="browser-tabs" role="tablist" aria-label="浏览器标签页">
      {!tabs.length && (
        <div className="browser-tab" data-active>
          <button type="button" role="tab" aria-selected onClick={edit}>
            <Icon name="Globe" size={13} />
            <span>新建标签页</span>
          </button>
        </div>
      )}
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
      <Button variant="ghost" icon={<Icon name="Add" size={16} />} label="新建标签页" kbd="Ctrl+T" onClick={() => void act("new")} />
    </div>
  );
  return (
    <PaneFrame
      view={view}
      pane="browser"
      title={tabStrip}
      trailing={
        // cf580efe9 pi / ci: 服务器 (a row runs or stops its server, its key says which), 停止所有服务器
        // straight under them, then 添加服务器.
        <Popover
          open={serverMenu}
          onClose={() => setServerMenu(false)}
          placement="bottom-end"
          anchor={
            <Button
              variant="ghost"
              icon={<Icon name="Cache" size={18} />}
              label="开发服务器"
              tipSide="bottom"
              onClick={() => {
                if (!serverMenu) loadServers();
                setServerMenu(!serverMenu);
              }}
            />
          }
        >
          {rows.length > 0 && (
            <>
              <MenuSection title="服务器" />
              {rows.map((row) => (
                <MenuItem
                  key={row.name}
                  icon={row.starting ? <Spinner size={12} label="正在启动" /> : undefined}
                  label={
                    <>
                      <span aria-hidden="true">{row.name}</span>
                      <span className="sr-only">{row.starting ? row.name : `${row.name}, ${row.live ? "运行中" : "已停止"}`}</span>
                    </>
                  }
                  trailing={
                    <span className={`btn btn-sm btn-icon ${row.live ? "btn-danger" : "btn-secondary"} browser-server-key`} aria-hidden="true">
                      <Icon name={row.live ? "Stop" : "Play"} />
                    </span>
                  }
                  onClick={() => {
                    setServerMenu(false);
                    toggleServer(row);
                  }}
                />
              ))}
              {rows.length > 1 && rows.some((row) => row.live) && (
                <MenuItem
                  label="停止所有服务器"
                  danger
                  onClick={() => {
                    setServerMenu(false);
                    void act("stopAll");
                  }}
                />
              )}
              <MenuSep />
            </>
          )}
          {/* ponytail: Claude sends the chat a prompt to set one up (cf580efe9 nt); this opens the servers dialog's add form. */}
          <MenuItem
            label="添加服务器"
            onClick={() => {
              setServerMenu(false);
              setServers("add");
            }}
          />
        </Popover>
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
      // Claude's sections (c224804cc ae, as cf580efe9 ki fills them), then Codex's own.
      menu={(close) => {
        const pick = (run: () => void) => () => {
          close();
          run();
        };
        const size = tab?.viewport;
        const preset = size && VIEWPORTS.find((item) => item.width === size.width && item.height === size.height);
        const storage = state?.settings.storage ?? "none";
        return (
          <>
            <MenuItem label="在默认浏览器中打开" disabled={!tab?.url.startsWith("http")} onClick={pick(() => void act("external"))} />
            <MenuItem label="复制 URL" disabled={!page} onClick={pick(() => void act("copyUrl"))} />
            <MenuItem label="保存截图" disabled={!page} onClick={pick(() => void act("saveScreenshot"))} />
            <MenuItem
              label="显示标注工具"
              disabled={!page}
              onClick={pick(() =>
                void act<{ image: string }>("screenshot").then((result) => {
                  if (result) setAnnotation({ image: result.image, url: tab!.url });
                }),
              )}
            />
            <MenuItem label="打开 HTML 文件…" onClick={pick(() => void act("openFile"))} />
            <MenuSep />
            {page ? (
              <Submenu label="视口" value={!size ? "自适应" : (preset?.label ?? `${size.width} × ${size.height}`)}>
                <MenuItem label="自适应" checked={!size} onClick={pick(() => void act("viewport", { preset: "desktop" }))} />
                {VIEWPORTS.map((item) => (
                  <MenuItem
                    key={item.preset}
                    label={item.label}
                    value={`${item.width} × ${item.height}`}
                    checked={item === preset}
                    onClick={pick(() => void act("viewport", { preset: item.preset }))}
                  />
                ))}
                {size && !preset && <MenuItem label="自定义" value={`${size.width} × ${size.height}`} checked onClick={close} />}
                <MenuItem
                  label="自定义…"
                  onClick={pick(() => {
                    setWidth(size?.width ?? 375);
                    setHeight(size?.height ?? 812);
                    setCustomViewport(true);
                  })}
                />
              </Submenu>
            ) : (
              <MenuItem label="视口" value="自适应" chevron disabled onClick={close} />
            )}
            <MenuItem label={logs ? "隐藏开发服务器日志" : "显示开发服务器日志"} onClick={pick(() => setLogs(!logs))} />
            <MenuSep />
            <MenuItem
              label="在内置浏览器中打开链接"
              checked={state?.settings.openLinks ?? false}
              toggle
              onClick={() => void act("settings", { openLinks: !state?.settings.openLinks })}
            />
            <MenuItem
              label="自动打开 Codex 写入的文件"
              checked={state?.settings.autoOpenFiles ?? true}
              toggle
              onClick={() => void act("settings", { autoOpenFiles: !(state?.settings.autoOpenFiles ?? true) })}
            />
            <MenuItem
              label="自动验证更改"
              checked={autoVerify}
              toggle
              onClick={() => {
                setAutoVerify(!autoVerify);
                void act("autoVerify", { enabled: !autoVerify });
              }}
            />
            <MenuItem label="管理允许的网站…" onClick={pick(() => setSettings(true))} />
            <MenuSep />
            <MenuSection title="Cookie" />
            <Submenu label="保留 Cookie" value={STORAGE[storage].label}>
              {(Object.keys(STORAGE) as (keyof typeof STORAGE)[]).map((mode) => (
                <MenuItem
                  key={mode}
                  label={STORAGE[mode].label}
                  hint={STORAGE[mode].hint}
                  checked={storage === mode}
                  onClick={pick(() => void act("settings", { storage: mode }))}
                />
              ))}
            </Submenu>
            <MenuItem label="清除浏览数据" danger onClick={pick(() => setClearing(true))} />
            <MenuSep />
            <MenuItem label="导出为 PDF（.pdf）" disabled={!page} onClick={pick(() => void act("export"))} />
            <MenuItem label="关闭其他标签页" disabled={tabs.length < 2} onClick={pick(() => void act("closeOthers"))} />
            <MenuItem label="重新打开关闭的标签页" kbd="Ctrl+Shift+T" onClick={pick(() => void act("reopen"))} />
            <MenuItem label="浏览器设置…" onClick={pick(() => setSettings(true))} />
          </>
        );
      }}
    >
      <div className="browser-toolbar" data-tip-group="">
        <div className="browser-tool-group" role="group" aria-label="导航">
          <Button variant="ghost" icon={<Icon name="ArrowLeft" size={16} />} label="返回" disabled={!tab?.canGoBack} onClick={() => void act("back")} />
          <Button
            variant="ghost"
            className="browser-roomy"
            icon={<Icon name="ArrowRight" size={16} />}
            label="前进"
            disabled={!tab?.canGoForward}
            onClick={() => void act("forward")}
          />
          <Button
            variant="ghost"
            icon={tab?.loading ? <Spinner size={14} /> : <Icon name="ArrowClockwise" size={16} />}
            label="重新加载"
            disabled={!tab}
            onClick={() => void act("reload")}
          />
        </div>
        <form className="browser-address" onSubmit={navigate}>
          <input
            ref={input}
            value={editing ? address : url}
            data-covered={(!editing && !!shown) || undefined}
            aria-label="页面 URL"
            spellCheck={false}
            autoComplete="off"
            dir="ltr"
            onFocus={(e) => {
              setAddress(url);
              setEditing(true);
              e.currentTarget.select();
              e.currentTarget.scrollLeft = 0;
              selected.current = true;
            }}
            // The click that focused the field leaves the selection alone.
            onMouseUp={(e) => {
              if (selected.current) e.preventDefault();
              selected.current = false;
            }}
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
          {!(editing ? address : url) && (
            <span className="browser-address-cover browser-address-hint" aria-hidden="true">
              输入 URL
            </span>
          )}
          {!editing && shown && (
            <span className="browser-address-cover" aria-hidden="true" dir="ltr">
              <span>
                {host ? host.host : shown}
                {host?.suffix && <span className="browser-address-path">{host.suffix}</span>}
              </span>
            </span>
          )}
        </form>
        <div className="browser-tool-group" role="group" aria-label="页面工具">
          {/* cf580efe9 sl / ul: the detail names what the attachment carries (no selector here). The
              title stays 选择元素: Claude's "or annotate" draws in select mode, which this one does not. */}
          <Button
            variant="ghost"
            className={tab?.inspecting ? undefined : "browser-roomy"}
            icon={<Icon name="Cursor" size={16} />}
            label={tab?.inspecting ? "退出选择模式" : "选择元素"}
            data-tip-detail={tab?.inspecting ? undefined : "向 Codex 发送屏幕截图以及该元素的 HTML、样式和任何 React 组件详情。"}
            active={tab?.inspecting}
            disabled={!page}
            onClick={() => void act("inspect")}
          />
        </div>
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
        ) : page || configs === null ? null : configs.length ? (
          <ServerStart rows={rows} pending={pending} launchFile={launchFile} onToggle={toggleServer} onOpen={openServer} />
        ) : (
          // cf580efe9 Rr: the start page, in Claude's wording (cf550b864 b / x) with Codex in it.
          <PaneEmpty
            icon={<Icon name="Globe" size="xl" />}
            title={state.toolsEnabled ? "与 Codex 一起浏览" : "浏览网页"}
            body={state.toolsEnabled ? "输入 URL 或让 Codex 打开网站。Codex 可以阅读、点击和输入。" : "输入 URL 以打开网站。"}
          >
            <span>改为预览您的应用？</span>
            <Button variant="ghost" size="xs" onMouseDown={(e) => e.preventDefault()} onClick={() => setServers(true)}>
              检测开发服务器
            </Button>
          </PaneEmpty>
        )}
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
      {servers && <BrowserServers view={view} cwd={cwd} adding={servers === "add"} onClose={() => setServers(false)} />}
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
              <input className="input" type="number" min={1} max={9999} value={width} onChange={(e) => setWidth(Number(e.target.value))} />
            </label>
            <span>×</span>
            <label>
              高度
              <input className="input" type="number" min={1} max={9999} value={height} onChange={(e) => setHeight(Number(e.target.value))} />
            </label>
          </div>
        </Dialog>
      )}
      {clearing && <ClearData view={view} cwd={cwd} onClose={() => setClearing(false)} />}
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

interface ServerRow {
  name: string;
  port: number;
  live: boolean;
  starting: boolean;
}

/**
 * The start page once launch.json names servers (cf580efe9 fa / da): a bordered list of five
 * (查看全部 shows the rest) whose keys run or stop a server, a live row opens it; a spinner while
 * one starts. ponytail: Claude holds the spinner 1.5s after the server is up, while its tab
 * opens; Codex opens the tab as the start request returns.
 */
function ServerStart({
  rows,
  pending,
  launchFile,
  onToggle,
  onOpen,
}: {
  rows: ServerRow[];
  pending?: string;
  launchFile: string;
  onToggle(row: ServerRow): void;
  onOpen(row: ServerRow): void;
}) {
  const [all, setAll] = useState(false);
  const list = useRef<HTMLUListElement>(null),
    refocus = useRef(false);
  // A hidden row that is live or waited on shows them all.
  const expanded = all || rows.some((row, index) => index >= 5 && (row.live || row.name === pending));
  useEffect(() => {
    if (expanded && refocus.current) (list.current?.children[5] as HTMLElement | undefined)?.focus();
    refocus.current = false;
  }, [expanded]);
  const starting = rows.some((row) => row.starting || (row.name === pending && !row.live));
  return (
    <div className="browser-start">
      <div>
        <div className="browser-start-main">
          <div>
            {starting ? (
              <div className="browser-start-busy">
                <Spinner size={20} label="正在启动服务器" />
              </div>
            ) : (
              <>
                <ul className="browser-start-list" ref={list}>
                  {(expanded ? rows : rows.slice(0, 5)).map((row) => {
                    const busy = row.name === pending;
                    const content = (
                      <>
                        <Icon name="Cache" size="sm" />
                        <span className="browser-start-name">{row.name}</span>
                        {row.port > 0 && <span className="browser-start-port">:{row.port}</span>}
                      </>
                    );
                    return (
                      <li key={row.name} tabIndex={-1} aria-busy={busy || undefined} data-open={row.live || undefined}>
                        {row.live ? (
                          <button type="button" aria-label={`打开 ${row.name}`} onClick={() => onOpen(row)}>
                            {content}
                          </button>
                        ) : (
                          content
                        )}
                        <Button
                          size="sm"
                          variant={row.live ? "danger" : "secondary"}
                          icon={busy ? <Spinner size={12} inherit /> : <Icon name={row.live ? "Stop" : "Play"} />}
                          label={`${row.live ? "停止" : "运行"} ${row.name}`}
                          aria-busy={busy || undefined}
                          disabled={!!pending && !busy}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => !busy && onToggle(row)}
                        />
                      </li>
                    );
                  })}
                </ul>
                {!expanded && rows.length > 5 && (
                  <Button
                    variant="ghost"
                    size="xs"
                    className="browser-start-more"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={(e) => {
                      refocus.current = e.currentTarget === document.activeElement;
                      setAll(true);
                    }}
                  >
                    查看全部
                  </Button>
                )}
              </>
            )}
          </div>
        </div>
        {!starting && (
          <div className="browser-start-notes">
            <p>{rows.some((row) => row.live) ? "打开服务器以预览您的应用，或输入 URL。" : "运行服务器以预览您的应用，或输入 URL。"}</p>
            <p>在 {launchFile} 中编辑此列表。</p>
          </div>
        )}
      </div>
    </div>
  );
}

/** Claude's 清除浏览数据？ confirm (c224804cc W); the desktop then skips its own native prompt. */
function ClearData({ view, cwd, onClose }: { view: string; cwd: string; onClose(): void }) {
  const state = useBrowser(view, cwd);
  return (
    <Dialog
      alert
      title="清除浏览数据？"
      description={
        state?.settings.storage === "shared"
          ? "此操作将删除浏览器为每个会话保存的 Cookie、登录信息和站点数据。您需要重新登录这些站点。"
          : "此操作将删除为此会话的浏览器保存的 Cookie、登录信息和网站数据。您需要重新登录各个网站。"
      }
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>取消</Button>
          <Button
            variant="danger"
            onClick={() => {
              onClose();
              void browserRequest(view, cwd, "clearData", { confirmed: true })
                .then(() => toast("neutral", "已清除浏览数据"))
                .catch((error) => toast("danger", "无法清除浏览数据。", error.message));
            }}
          >
            清除数据
          </Button>
        </>
      }
    />
  );
}

export function BrowserSettings({ view, cwd, onClose }: { view: string; cwd: string; onClose(): void }) {
  const [origin, setOrigin] = useState("");
  const [clearing, setClearing] = useState(false);
  const state = useBrowser(view, cwd);
  const change = (args: Record<string, unknown>) => {
    void browserRequest(view, cwd, "settings", args).catch((error) => toast("danger", "无法保存浏览器设置", error.message));
  };
  return (
    <Dialog title="浏览器设置" onClose={onClose} footer={<Button onClick={onClose}>完成</Button>}>
      <div className="browser-setting">
        <div>
          <strong>浏览器工具</strong>
          <p>Codex 可以启动开发服务器、浏览网页，并通过截图、快照和 DOM 检查来验证更改。模型操作需启用实验型后端并重启应用。</p>
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
      {/* c71860c77 vr's row (3r6quQWFdB, NShGei0Ifc without the PDFs the pane does not open). */}
      <div className="browser-setting">
        <div>
          <strong>自动打开 Codex 写入的文件</strong>
          <p>{AUTO_OPEN_HINT}</p>
        </div>
        <Toggle
          checked={state?.settings.autoOpenFiles ?? true}
          label="自动打开 Codex 写入的文件"
          onChange={(autoOpenFiles) => change({ autoOpenFiles })}
        />
      </div>
      <div className="browser-setting">
        <div>
          <strong>保留 Cookie</strong>
          <p>共享会让所有会话使用同一份登录状态；按会话保存可隔离各会话的登录。更改模式会关闭当前标签。</p>
        </div>
        <MenuSelect
          label="保留 Cookie"
          value={state?.settings.storage ?? "none"}
          options={(Object.keys(STORAGE) as (keyof typeof STORAGE)[]).map((mode) => ({ value: mode, ...STORAGE[mode] }))}
          onChange={(storage) => change({ storage })}
        />
      </div>
      <div className="browser-setting">
        <div>
          <strong>已允许的网站</strong>
          <p>Codex 可在这些网站使用浏览器工具，无需重复询问。移除后下次会再次询问。本机开发预览无需站点授权。</p>
        </div>
      </div>
      <form className="browser-fields" onSubmit={(event) => {
        event.preventDefault();
        void browserRequest(view, cwd, "settings", { addOrigin: origin }).then(() => setOrigin(""))
          .catch((error) => toast("danger", "无法添加网站", error.message));
      }}>
        <label>网站地址<input className="input" required value={origin} placeholder="https://example.com" onChange={(event) => setOrigin(event.target.value)} /></label>
        <Button type="submit">添加</Button>
        <Button disabled={!state?.settings.allowedOrigins.length} onClick={() => change({ clearOrigins: true })}>全部移除</Button>
      </form>
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
        <Button onClick={() => setClearing(true)}>清除…</Button>
      </div>
      {clearing && <ClearData view={view} cwd={cwd} onClose={() => setClearing(false)} />}
    </Dialog>
  );
}

function BrowserServers({ view, cwd, adding: addFirst, onClose }: { view: string; cwd: string; adding: boolean; onClose(): void }) {
  const state = useBrowser(view, cwd);
  const [config, setConfig] = useState<BrowserServerConfig[]>([]),
    [candidates, setCandidates] = useState<BrowserServerConfig[]>([]);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [autoVerify, setAutoVerify] = useState(false),
    [adding, setAdding] = useState(addFirst);
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
      {!config.length && <p className="browser-muted">未配置开发服务器</p>}
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
              className="input"
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
            <input className="input" required value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            包管理器
            <MenuSelect field label="包管理器" value={runner} options={["npm", "pnpm", "yarn", "bun"].map((name) => ({ value: name, label: name }))} onChange={setRunner} />
          </label>
          <label>
            脚本
            <input className="input" required value={script} onChange={(e) => setScript(e.target.value)} />
          </label>
          <label>
            端口
            <input className="input" type="number" min={1} max={65535} value={port} onChange={(e) => setPort(Number(e.target.value))} />
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
