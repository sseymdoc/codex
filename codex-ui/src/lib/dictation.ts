// Dictation, as the Codex desktop composer does it (app-initial W3u / YLo): the browser records the
// microphone with MediaRecorder, and once the recording stops the clip goes through the bridge to
// ChatGPT's transcribe endpoint (codex.ts transcribe) and the text lands in the draft. Nothing
// shows while recording: the transcript comes back whole, as in Codex.

/** This browser can record the microphone. */
export function dictationSupported(): boolean {
  return typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
}

export interface Recording {
  /** Stops and hands back the clip. */
  stop(): Promise<Blob>;
  /** Stops and drops the clip. */
  cancel(): void;
}

/** Opens the microphone and records until stop() or cancel(). */
export async function record(): Promise<Recording> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const release = () => {
    for (const track of stream.getTracks()) track.stop();
  };
  try {
    const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((type) => MediaRecorder.isTypeSupported(type));
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data);
    };
    recorder.start(250);
    return {
      stop: () =>
        new Promise((resolve) => {
          recorder.onstop = () => {
            release();
            resolve(new Blob(chunks, { type: recorder.mimeType || mimeType || "audio/webm" }));
          };
          recorder.stop();
        }),
      cancel: () => {
        recorder.onstop = null;
        if (recorder.state !== "inactive") recorder.stop();
        release();
      },
    };
  } catch (error) {
    release();
    throw error;
  }
}

/** Codex's words for why the microphone would not open (zh-CN dictation.error.*). */
export function micError(error: unknown): string {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "请启用麦克风访问权限以使用听写功能";
  if (name === "NotFoundError") return "连接麦克风以使用听写功能";
  if (name === "NotReadableError") return "关闭其他正在使用麦克风的应用";
  return error instanceof Error ? error.message : String(error);
}
