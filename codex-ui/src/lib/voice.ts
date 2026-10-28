// Voice mode over WebRTC (thread/realtime/*), the same flow as the TUI: the browser owns the
// microphone and speaker, app-server relays the SDP offer to the realtime service and drives
// the session over its own sideband connection, so no data channel or appendAudio is needed.

import type { ServerNotification } from "@protocol/ServerNotification";
import { cloudCall } from "./cloud";
import { callExperimental, connectionId, errorMessage, featureEnabled } from "./codex";
import { getState, setState, toast } from "./store";

/** A voice call with a ChatGPT dot runs in the voice state under this thread id. */
export const DOT_CALL = "dot-call";
/** The dot call on now: its dot and the call id its allocation named. */
let dotCall: { dotId: string; callId: string } | null = null;

let peer: RTCPeerConnection | null = null;
let mic: MediaStream | null = null;
let remote: MediaStream | null = null;
let speaker: HTMLAudioElement | null = null;

/** The feature is on and this browser can do WebRTC with a microphone. */
export function voiceAvailable(): boolean {
  return featureEnabled("realtime_conversation") && typeof RTCPeerConnection !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
}

/** Live streams for the composer's audio visualizer (AnalyserNode). */
export function voiceStreams(): { mic: MediaStream | null; remote: MediaStream | null } {
  return { mic, remote };
}

export async function startVoice(threadId: string): Promise<void> {
  if (getState().voice.status !== "idle") await stopVoice();
  setState({ voice: { status: "connecting", threadId } });
  try {
    mic = await navigator.mediaDevices.getUserMedia({ audio: true });
    peer = new RTCPeerConnection();
    for (const track of mic.getTracks()) peer.addTrack(track, mic);
    peer.ontrack = (event) => {
      remote = event.streams[0] ?? new MediaStream([event.track]);
      speaker ??= new Audio();
      speaker.srcObject = remote;
      void speaker.play().catch(() => {});
    };
    peer.onconnectionstatechange = () => {
      if (peer?.connectionState === "failed") fail("语音对话连接失败");
    };
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    await callExperimental("thread/realtime/start", {
      threadId,
      outputModality: "audio",
      transport: { type: "webrtc", sdp: offer.sdp },
      version: "v3",
    });
  } catch (error) {
    cleanup();
    setState({ voice: { status: "idle" } });
    toast("warning", "无法开启语音对话", errorMessage(error));
    throw error;
  }
}

export async function stopVoice(): Promise<void> {
  const current = getState().voice;
  cleanup();
  setState({ voice: { status: "idle" } });
  if (current.status === "idle") return;
  if (current.threadId === DOT_CALL) return hangUpDot();
  await callExperimental("thread/realtime/stop", { threadId: current.threadId }).catch(() => {});
}

/**
 * Calls a dot as the Codex desktop app does (orbit voice): the browser's WebRTC offer, with the
 * `oai-events` data channel, goes to the dot's voice/calls; the answer comes back as SDP text, the
 * call's id in its Location; then the call is attached to the dot's conversation.
 */
export async function startDotCall(dotId: string): Promise<void> {
  if (getState().voice.status !== "idle") await stopVoice();
  setState({ voice: { status: "connecting", threadId: DOT_CALL } });
  try {
    try {
      mic = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      throw new Error("请在浏览器或系统设置中允许访问麦克风，然后重试");
    }
    peer = new RTCPeerConnection();
    for (const track of mic.getTracks()) peer.addTrack(track, mic);
    peer.createDataChannel("oai-events");
    peer.ontrack = (event) => {
      remote = event.streams[0] ?? new MediaStream([event.track]);
      speaker ??= new Audio();
      speaker.srcObject = remote;
      void speaker.play().catch(() => {});
    };
    peer.onconnectionstatechange = () => {
      if (peer?.connectionState === "connected" && getState().voice.status === "connecting") setState({ voice: { status: "active", threadId: DOT_CALL } });
      if (peer?.connectionState === "failed") fail("通话连接失败");
    };
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    const answer = await cloudCall<{ text: string; location: string | null }>("POST", `/tbo/${encodeURIComponent(dotId)}/voice/calls`, { sdp: offer.sdp }, "ChatGPT");
    const callId = answer.location?.split("?")[0].split("/").at(-1) ?? "";
    if (!callId || !answer.text?.trim()) throw new Error("通话没有接通");
    dotCall = { dotId, callId };
    await peer.setRemoteDescription({ type: "answer", sdp: answer.text });
    await cloudCall("POST", `/tbo/${encodeURIComponent(dotId)}/voice/calls/${encodeURIComponent(callId)}/attach`, undefined, "ChatGPT");
  } catch (error) {
    cleanup();
    setState({ voice: { status: "idle" } });
    void hangUpDot();
    toast("warning", "无法开启语音聊天", errorMessage(error));
    throw error;
  }
}

/** Ends the dot's call on its side too, even as the page goes (a keepalive request). */
async function hangUpDot(): Promise<void> {
  const call = dotCall;
  const id = connectionId();
  dotCall = null;
  if (!call || !id) return;
  await fetch(`/api/cloud?c=${encodeURIComponent(id)}`, {
    method: "POST",
    keepalive: true,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method: "POST", path: `/tbo/${encodeURIComponent(call.dotId)}/voice/calls/${encodeURIComponent(call.callId)}/stop` }),
  }).catch(() => {});
}

/** Mutes or unmutes the microphone of the call on now; resolves to whether it is muted. */
export function setVoiceMuted(muted: boolean): boolean {
  for (const track of mic?.getAudioTracks() ?? []) track.enabled = !muted;
  return muted;
}

/** The connection dropped: release the devices without telling the (gone) server. */
export function resetVoice(): void {
  cleanup();
  if (getState().voice.status !== "idle") setState({ voice: { status: "idle" } });
}

function cleanup(): void {
  peer?.close();
  peer = null;
  for (const track of mic?.getTracks() ?? []) track.stop();
  mic = null;
  remote = null;
  if (speaker) speaker.srcObject = null;
}

function fail(message: string): void {
  toast("warning", "语音对话错误", message);
  void stopVoice();
}

export function onRealtimeNotification(notification: ServerNotification): void {
  const current = getState().voice;
  if (current.status === "idle") return;
  switch (notification.method) {
    case "thread/realtime/sdp":
      if (notification.params.threadId !== current.threadId) return;
      void peer?.setRemoteDescription({ type: "answer", sdp: notification.params.sdp }).catch((error) => fail(errorMessage(error)));
      return;
    case "thread/realtime/started":
      if (notification.params.threadId === current.threadId) setState({ voice: { status: "active", threadId: current.threadId } });
      return;
    case "thread/realtime/error":
      if (notification.params.threadId === current.threadId) toast("warning", "语音对话错误", notification.params.message);
      return;
    case "thread/realtime/closed":
      if (notification.params.threadId !== current.threadId) return;
      cleanup();
      setState({ voice: { status: "idle" } });
      return;
    default:
      return;
  }
}
