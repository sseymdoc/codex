// Voice mode over WebRTC (thread/realtime/*), the same flow as the TUI: the browser owns the
// microphone and speaker, app-server relays the SDP offer to the realtime service and drives
// the session over its own sideband connection, so no data channel or appendAudio is needed.

import type { RealtimeVoice } from "@protocol/RealtimeVoice";
import type { RealtimeVoicesList } from "@protocol/RealtimeVoicesList";
import type { ServerNotification } from "@protocol/ServerNotification";
import { callExperimental, errorMessage, featureEnabled, optional } from "./codex";
import { getState, setState, toast } from "./store";

let peer: RTCPeerConnection | null = null;
let mic: MediaStream | null = null;
let remote: MediaStream | null = null;
let speaker: HTMLAudioElement | null = null;

/** The feature is on and this browser can do WebRTC with a microphone. */
export function voiceAvailable(): boolean {
  return featureEnabled("realtime_conversation") && typeof RTCPeerConnection !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
}

export async function listVoices(): Promise<RealtimeVoicesList | null> {
  const response = await optional<{ voices: RealtimeVoicesList }>("thread/realtime/listVoices", {}).catch(() => null);
  return response?.voices ?? null;
}

/** Live streams for the composer's audio visualizer (AnalyserNode). */
export function voiceStreams(): { mic: MediaStream | null; remote: MediaStream | null } {
  return { mic, remote };
}

export async function startVoice(threadId: string, voice?: RealtimeVoice): Promise<void> {
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
      if (peer?.connectionState === "failed") fail("语音连接失败");
    };
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    await callExperimental("thread/realtime/start", {
      threadId,
      outputModality: "audio",
      transport: { type: "webrtc", sdp: offer.sdp },
      version: "v3",
      ...(voice ? { voice } : {}),
    });
  } catch (error) {
    cleanup();
    setState({ voice: { status: "idle" } });
    toast("error", "无法开始语音模式", errorMessage(error));
    throw error;
  }
}

export async function stopVoice(): Promise<void> {
  const current = getState().voice;
  cleanup();
  setState({ voice: { status: "idle" } });
  if (current.status !== "idle") await callExperimental("thread/realtime/stop", { threadId: current.threadId }).catch(() => {});
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
  toast("error", "语音模式出错", message);
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
      if (notification.params.threadId === current.threadId) toast("error", "语音模式出错", notification.params.message);
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
