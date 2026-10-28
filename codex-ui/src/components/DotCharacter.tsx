// The dot's character editor in a Claude dialog. The character itself is the Codex desktop app's:
// its WASM engine runs in the app's own iframe (orbit-character …/frame.html, served from the
// installed app by server/orbit.mjs), driven by the messages that app sends it (presentation.mjs):
// `orbit-character` starts the editor with a saved appearance, `orbit-character-editor` asks for
// the catalog, makes a choice, randomizes, and takes the snapshot that saving uploads. Without the
// installed app only the nickname can change.

import { useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { errorMessage } from "../lib/codex";
import { saveAppearance, startingAppearance, validName } from "../lib/dot-profile";
import type { Dot } from "../lib/dots";
import { Button, Dialog, Icon, Segmented, Spinner, useReducedMotion } from "./ui";

/** The engine's categories (orbit-enums Category). */
const CATEGORIES = [
  { value: "0", label: "形状" },
  { value: "1", label: "颜色" },
  { value: "2", label: "眼睛" },
  { value: "3", label: "眼镜" },
  { value: "4", label: "配饰" },
  { value: "presets", label: "角色" },
] as const;
type Tab = (typeof CATEGORIES)[number]["value"];

interface Choice {
  id: string;
  title: string;
  selected: boolean;
  available: boolean;
  thumbnail?: string;
  color?: string;
  colors?: { id: string; title: string; color: string }[];
  colorOverride?: string;
}

interface Preview {
  state: Uint8Array;
  presets: { id: string; title: string; thumbnail?: string | null }[];
  catalog: Choice[][];
}

/** One character frame, spoken to as its owner. */
function useCharacterFrame(frame: RefObject<HTMLIFrameElement | null>, start: Uint8Array | null) {
  const owner = useRef(crypto.randomUUID());
  const pending = useRef(new Map<number, (reply: Record<string, unknown>) => void>());
  const next = useRef(1);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  const [preview, setPreview] = useState<Preview | null>(null);
  const reducedMotion = useReducedMotion();

  const post = (message: Record<string, unknown>) => frame.current?.contentWindow?.postMessage({ ...message, ownerId: owner.current }, location.origin);
  const request = (message: Record<string, unknown>) => new Promise<Record<string, unknown>>((resolve) => {
    const id = next.current++;
    pending.current.set(id, resolve);
    post({ type: "orbit-character-editor", id, ...message });
  });

  useEffect(() => {
    if (!start) return;
    const onMessage = (event: MessageEvent) => {
      const data = event.data as Record<string, unknown> | null;
      if (event.source !== frame.current?.contentWindow || event.origin !== location.origin || !data) return;
      if (data.type === "orbit-character") {
        if (data.status === "loaded") post({ type: "orbit-character", presentation: "editor", requestReady: true, active: true, reducedMotion, state: start });
        else if (data.status === "failed") setStatus("failed");
        else if (data.status === "ready" && data.ownerId === owner.current) {
          setStatus("ready");
          void request({ action: "catalog" }).then((reply) => reply.preview && setPreview(reply.preview as Preview));
        }
        return;
      }
      if (data.type !== "orbit-character-editor" || data.ownerId !== owner.current) return;
      if (data.preview) setPreview(data.preview as Preview);
      const resolve = pending.current.get(data.id as number);
      if (resolve) {
        pending.current.delete(data.id as number);
        resolve(data);
      }
    };
    window.addEventListener("message", onMessage);
    // A frame that never answers (the engine failed to start) is given up after 30 s.
    const timer = setTimeout(() => setStatus((current) => (current === "loading" ? "failed" : current)), 30_000);
    return () => {
      window.removeEventListener("message", onMessage);
      clearTimeout(timer);
      post({ type: "orbit-character-dispose" });
    };
  }, [start]); // eslint-disable-line react-hooks/exhaustive-deps

  return { status, preview, request };
}


/** A 64-bit seed for the curated randomizer. */
const seed = () => {
  const [high, low] = crypto.getRandomValues(new Uint32Array(2));
  return (BigInt(high) << 32n) | BigInt(low);
};

const sameBytes = (a: Uint8Array | null | undefined, b: Uint8Array | null | undefined) => !!a && !!b && a.length === b.length && a.every((byte, i) => byte === b[i]);

export function DotCharacterDialog({ dot, onClose }: { dot: Dot; onClose(): void }) {
  const [runtime, setRuntime] = useState<{ bundleId: string | null; frame: string | null } | null>(null);
  const [name, setName] = useState(dot.name ?? "");
  const [tab, setTab] = useState<Tab>("0");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const start = useRef(startingAppearance(dot)).current;
  const editable = !!runtime?.frame && !!runtime.bundleId;
  const { status, preview, request } = useCharacterFrame(frame, editable ? start : null);

  useEffect(() => {
    fetch("/api/dots/orbit").then((response) => (response.ok ? response.json() : null)).then(
      (info: { bundleId: string | null; frame: string | null } | null) => setRuntime(info ?? { bundleId: null, frame: null }),
      () => setRuntime({ bundleId: null, frame: null }),
    );
  }, []);

  // Thumbnails of the heroes are drawn on request, while their tab shows.
  useEffect(() => {
    if (tab !== "presets" || status !== "ready" || !preview) return;
    for (const preset of preview.presets) if (preset.thumbnail === undefined) void request({ action: "preset-thumbnail", value: preset.id, visible: true });
  }, [tab, status, preview?.presets.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const edit = async (message: Record<string, unknown>) => {
    setError(null);
    const reply = await request(message);
    if (reply.rejected) setError("无法保存你的更改。请重试。");
  };

  const valid = validName(name);
  const save = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      let character: { state: Uint8Array; png: Uint8Array } | undefined;
      if (status === "ready" && preview && !sameBytes(preview.state, start)) {
        const snapshot = await request({ action: "snapshot" });
        if (!(snapshot.state instanceof Uint8Array) || !(snapshot.png instanceof Uint8Array)) throw new Error("无法保存你的 dot 头像");
        character = { state: snapshot.state, png: snapshot.png };
      }
      await saveAppearance(dot, { name, character, bundleId: runtime?.bundleId ?? null });
      onClose();
    } catch (failure) {
      setError(errorMessage(failure));
      setBusy(false);
    }
  };

  const choices = tab !== "presets" ? preview?.catalog[Number(tab)] ?? [] : [];
  const selectedAccessories = preview?.catalog[4]?.filter((item) => item.selected && item.colors?.length) ?? [];

  return (
    <Dialog title="自定义你的 Dot" size="lg" onClose={onClose} footer={<>
      {error && <span className="dots-field-error dots-dialog-error" role="alert">{error}</span>}
      <Button variant="secondary" onClick={onClose}>取消</Button>
      <Button variant="primary" disabled={!valid || busy || (editable && status === "loading")} onClick={() => void save()}>{busy ? "正在保存…" : "保存"}</Button>
    </>}>
      <div className="dots-character">
        <div className="dots-character-stage">
          {runtime === null ? (
            <Spinner />
          ) : editable && status !== "failed" ? (
            <>
              <iframe ref={frame} className="dots-character-frame" src={runtime.frame ?? undefined} title="你的 Dot 的角色" data-ready={status === "ready" || undefined} />
              {status === "loading" && <span className="dots-character-loading"><Spinner /></span>}
            </>
          ) : (
            <div className="dots-character-missing">
              <span className="dots-avatar" data-dot="" style={{ "--dots-avatar": "96px" } as CSSProperties} aria-hidden="true"><Icon name="Placeholder" size="xl" /></span>
              <p>{status === "failed" ? "角色引擎未能启动。仍可修改昵称。" : "编辑角色需要本机安装的 Codex 桌面版。仍可修改昵称。"}</p>
            </div>
          )}
          {status === "ready" && (
            <Button variant="secondary" size="sm" icon={<Icon name="ArrowClockwise" size="sm" />} disabled={busy} onClick={() => void edit({ action: "randomize", seed: seed() })}>随机生成</Button>
          )}
        </div>
        <div className="dots-character-controls">
          <label className="dots-character-field">
            <span>昵称</span>
            <input className="input" data-autofocus="" maxLength={64} placeholder="你的 Dot" value={name} aria-invalid={!valid || undefined} onChange={(event) => setName(event.target.value)} />
            {!valid && <span className="dots-field-error" role="alert">昵称最多可包含 24 个字符，且不能包含反斜杠</span>}
          </label>
          {status === "ready" && preview && (
            <>
              <Segmented<Tab> value={tab} options={[...CATEGORIES]} onChange={setTab} label="外观" />
              <div className="dots-choices" role="listbox" aria-label={CATEGORIES.find((item) => item.value === tab)?.label} data-kind={tab === "1" ? "swatch" : tab === "0" || tab === "presets" ? "tile" : "chip"}>
                {tab === "presets" ? preview.presets.map((preset) => (
                  <button key={preset.id} type="button" role="option" aria-selected={false} className="dots-choice" title={preset.title} onClick={() => void edit({ action: "preset", value: preset.id })}>
                    {preset.thumbnail ? <img src={preset.thumbnail} alt="" /> : <Spinner size={14} />}
                    <span className="sr-only">{preset.title}</span>
                  </button>
                )) : choices.map((choice) => (
                  <button
                    key={choice.id}
                    type="button"
                    role="option"
                    aria-selected={choice.selected}
                    className="dots-choice"
                    title={choice.title}
                    disabled={!choice.available && !choice.selected}
                    onClick={() => void edit({ action: "select", category: Number(tab), value: choice.id })}
                  >
                    {choice.thumbnail ? <img src={choice.thumbnail} alt="" /> : choice.color ? <span className="dots-swatch" style={{ background: choice.color }} /> : <span>{choice.title}</span>}
                    {(choice.thumbnail || choice.color) && <span className="sr-only">{choice.title}</span>}
                  </button>
                ))}
              </div>
              {tab === "4" && selectedAccessories.map((accessory) => (
                <div key={accessory.id} className="dots-accessory-colors">
                  <span className="dots-muted">{accessory.title}</span>
                  {accessory.colors?.map((color) => (
                    <button key={color.id} type="button" className="dots-swatch-button" aria-pressed={accessory.colorOverride === color.id} title={color.title}
                      onClick={() => void edit({ action: "color", accessory: accessory.id, value: accessory.colorOverride === color.id ? "" : color.id })}>
                      <span className="dots-swatch" style={{ background: color.color }} />
                    </button>
                  ))}
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </Dialog>
  );
}
