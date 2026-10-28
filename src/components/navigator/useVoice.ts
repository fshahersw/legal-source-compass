/**
 * Voice for the navigator: a realtime speech session over WebRTC. The microphone goes up a media track and the voice
 * comes back on another; a data channel carries events. The voice model talks with the user in an adaptive style and
 * hands site work to the navigator through its tools (run_task, stop_task, read_screen, open_page, set_style). While
 * a task runs it says, in a few words, which page is opening. The style profile adapts from what the user says
 * (set_style) and from how they behave (cutting in, very short turns), and is remembered in this browser.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { PAGE_GUIDES } from "@/lib/navigator/pageGuides";
import {
  DEFAULT_VOICE_STYLE,
  adaptFromBehaviour,
  applyStyleChange,
  parseVoiceStyle,
  speakable,
  voiceInstructions,
  voiceSiteGuide,
  type VoiceStyle,
} from "@/lib/navigator/voiceStyle";
import { describePage, execute } from "./executor";
import type { NavMessage } from "./useNavigator";

export type VoiceState =
  "off" | "connecting" | "listening" | "thinking" | "speaking" | "working" | "error";
export type Caption = { who: "you" | "agent"; text: string; at: number };

const STYLE_KEY = "navigator:voice-style:v1";
const IDLE_LIMIT_MS = 10 * 60 * 1000;

function loadStyle(): VoiceStyle {
  try {
    return parseVoiceStyle(JSON.parse(localStorage.getItem(STYLE_KEY) ?? "null"));
  } catch {
    return { ...DEFAULT_VOICE_STYLE };
  }
}
function saveStyle(s: VoiceStyle) {
  try {
    localStorage.setItem(STYLE_KEY, JSON.stringify(s));
  } catch {
    // storage unavailable: the style lasts for this session only
  }
}

type Deps = {
  runTask: (task: string) => Promise<NavMessage | null>;
  stopTask: () => void;
  busy: boolean;
  panel: React.RefObject<HTMLElement | null>;
};

export function useVoice({ runTask, stopTask, busy, panel }: Deps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [state, setState] = useState<VoiceState>("off");
  const [error, setError] = useState<string | null>(null);
  const [style, setStyleState] = useState<VoiceStyle>(() =>
    typeof window === "undefined" ? { ...DEFAULT_VOICE_STYLE } : loadStyle(),
  );
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [adapted, setAdapted] = useState<string | null>(null);
  const [streams, setStreams] = useState<{ mic: MediaStream | null; voice: MediaStream | null }>({
    mic: null,
    voice: null,
  });

  const pc = useRef<RTCPeerConnection | null>(null);
  const dc = useRef<RTCDataChannel | null>(null);
  const mic = useRef<MediaStream | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const styleRef = useRef(style);
  styleRef.current = style;
  const speaking = useRef(false);
  const working = useRef(false);
  const interrupts = useRef<boolean[]>([]);
  const userWords = useRef<number[]>([]);
  const interruptedThis = useRef(false);
  const lastActivity = useRef(Date.now());
  const lastNarration = useRef(0);
  const handled = useRef(new Set<string>());

  const send = useCallback((event: unknown) => {
    const ch = dc.current;
    if (ch && ch.readyState === "open") ch.send(JSON.stringify(event));
  }, []);

  const pushCaption = useCallback((who: Caption["who"], text: string) => {
    const t = text.trim();
    if (!t) return;
    setCaptions((all) => [...all, { who, text: t, at: Date.now() }].slice(-12));
  }, []);

  const applyStyle = useCallback(
    (next: VoiceStyle, reason: string | null) => {
      setStyleState(next);
      styleRef.current = next;
      saveStyle(next);
      if (reason) setAdapted(reason);
      send({
        type: "session.update",
        session: {
          type: "realtime",
          instructions: voiceInstructions(next, voiceSiteGuide(PAGE_GUIDES)),
        },
      });
    },
    [send],
  );

  const stop = useCallback(() => {
    send({ type: "response.cancel" });
    dc.current?.close();
    pc.current?.getSenders().forEach((s) => s.track?.stop());
    pc.current?.close();
    mic.current?.getTracks().forEach((t) => t.stop());
    if (audio.current) audio.current.srcObject = null;
    dc.current = null;
    pc.current = null;
    mic.current = null;
    speaking.current = false;
    setStreams({ mic: null, voice: null });
    setState("off");
  }, [send]);

  /** Return a tool result to the voice model and let it respond. */
  const reply = useCallback(
    (callId: string, output: unknown) => {
      send({
        type: "conversation.item.create",
        item: { type: "function_call_output", call_id: callId, output: JSON.stringify(output) },
      });
      send({ type: "response.create" });
    },
    [send],
  );

  const onFunctionCall = useCallback(
    async (callId: string, name: string, argsText: string) => {
      if (handled.current.has(callId)) return;
      handled.current.add(callId);
      let args: Record<string, unknown> = {};
      try {
        args = argsText ? (JSON.parse(argsText) as Record<string, unknown>) : {};
      } catch {
        args = {};
      }
      const ctx = {
        router,
        queryClient,
        panel: panel.current,
        signal: new AbortController().signal,
      };
      if (name === "run_task") {
        const task = String(args["task"] ?? "").slice(0, 2000);
        if (!task) return reply(callId, { error: "No task given." });
        if (busy)
          return reply(callId, {
            error: "A task is already running. Ask the user whether to stop it first.",
          });
        working.current = true;
        setState("working");
        const result = await runTask(task);
        working.current = false;
        setState(speaking.current ? "speaking" : "listening");
        if (!result) return reply(callId, { error: "The task could not start." });
        return reply(callId, {
          status: result.status,
          answer: speakable(result.content),
          pages_visited: result.trail,
          note: "The full answer with links is in the panel.",
        });
      }
      if (name === "stop_task") {
        stopTask();
        return reply(callId, { stopped: true });
      }
      if (name === "read_screen")
        return reply(callId, {
          page: describePage({ rowsEach: 6, textChars: 1500 }).slice(0, 6000),
        });
      if (name === "open_page") {
        const out = await execute(
          { id: callId, name: "go_to", input: { path: args["path"] } },
          ctx,
        );
        return reply(
          callId,
          out.isError
            ? { error: out.content }
            : { opened: out.path, page: out.content.slice(0, 3000) },
        );
      }
      if (name === "set_style") {
        const next = applyStyleChange(styleRef.current, args);
        applyStyle(next, null);
        return reply(callId, { style: next });
      }
      return reply(callId, { error: `Unknown tool ${name}.` });
    },
    [applyStyle, busy, panel, queryClient, reply, router, runTask, stopTask],
  );

  const onEvent = useCallback(
    (raw: string) => {
      let e: Record<string, unknown>;
      try {
        e = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        return;
      }
      lastActivity.current = Date.now();
      switch (e["type"]) {
        case "session.created":
        case "session.updated":
          setState((s) => (s === "connecting" ? "listening" : s));
          break;
        case "input_audio_buffer.speech_started":
          if (speaking.current) interruptedThis.current = true;
          setState(working.current ? "working" : "listening");
          break;
        case "input_audio_buffer.speech_stopped":
          if (!working.current) setState("thinking");
          break;
        case "conversation.item.input_audio_transcription.completed": {
          const t = String(e["transcript"] ?? "");
          pushCaption("you", t);
          userWords.current = [...userWords.current, t.split(/\s+/).filter(Boolean).length].slice(
            -4,
          );
          break;
        }
        case "output_audio_buffer.started":
          speaking.current = true;
          setState("speaking");
          break;
        case "output_audio_buffer.stopped":
        case "output_audio_buffer.cleared":
          speaking.current = false;
          setState(working.current ? "working" : "listening");
          break;
        case "response.output_audio_transcript.done":
          pushCaption("agent", String(e["transcript"] ?? ""));
          break;
        case "response.done": {
          const resp = (e["response"] ?? {}) as {
            output?: { type?: string; call_id?: string; name?: string; arguments?: string }[];
            metadata?: { kind?: string };
          };
          // behaviour signals (not for narration-only responses)
          if (resp.metadata?.kind !== "narration") {
            interrupts.current = [...interrupts.current, interruptedThis.current].slice(-4);
            interruptedThis.current = false;
            const adapt = adaptFromBehaviour(styleRef.current, {
              interruptedLast4: interrupts.current.filter(Boolean).length,
              userWordsLast4: userWords.current,
            });
            if (adapt) {
              interrupts.current = [];
              applyStyle(adapt.style, adapt.reason);
            }
          }
          for (const item of resp.output ?? [])
            if (item.type === "function_call" && item.call_id && item.name)
              void onFunctionCall(item.call_id, item.name, item.arguments ?? "");
          break;
        }
        case "error": {
          const err = (e["error"] ?? {}) as { message?: string };
          console.warn("voice", err.message);
          break;
        }
      }
    },
    [applyStyle, onFunctionCall, pushCaption],
  );

  const start = useCallback(async () => {
    if (pc.current) return;
    setError(null);
    setAdapted(null);
    setState("connecting");
    try {
      const connection = new RTCPeerConnection();
      pc.current = connection;
      if (!audio.current) {
        audio.current = document.createElement("audio");
        audio.current.autoplay = true;
      }
      connection.ontrack = (ev) => {
        const stream = ev.streams[0] ?? new MediaStream([ev.track]);
        audio.current!.srcObject = stream;
        void audio.current!.play().catch(() => undefined);
        setStreams((s) => ({ ...s, voice: stream }));
      };
      const ms = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      mic.current = ms;
      setStreams((s) => ({ ...s, mic: ms }));
      for (const track of ms.getAudioTracks()) connection.addTrack(track, ms);
      const channel = connection.createDataChannel("oai-events");
      dc.current = channel;
      channel.addEventListener("message", (m) => onEvent(String(m.data)));
      channel.addEventListener("close", () => {
        if (pc.current === connection) stop();
      });
      const offer = await connection.createOffer();
      await connection.setLocalDescription(offer);
      // send the offer with its candidates (bounded wait; the service also accepts an offer gathered early)
      if (connection.iceGatheringState !== "complete")
        await new Promise<void>((resolve) => {
          const done = () => {
            if (connection.iceGatheringState !== "complete") return;
            connection.removeEventListener("icegatheringstatechange", done);
            resolve();
          };
          connection.addEventListener("icegatheringstatechange", done);
          setTimeout(() => {
            connection.removeEventListener("icegatheringstatechange", done);
            resolve();
          }, 1500);
        });
      const localSdp = connection.localDescription?.sdp ?? offer.sdp ?? "";
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      const res = await fetch("/api/navigator-voice", {
        method: "POST",
        headers: {
          "content-type": "application/sdp",
          "x-voice-style": encodeURIComponent(JSON.stringify(styleRef.current)),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: localSdp,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Voice could not start.");
      }
      await connection.setRemoteDescription({ type: "answer", sdp: await res.text() });
      lastActivity.current = Date.now();
    } catch (err) {
      const message =
        err instanceof DOMException && err.name === "NotAllowedError"
          ? "Microphone access was blocked. Allow it in the browser to talk."
          : err instanceof Error
            ? err.message
            : "Voice could not start.";
      stop();
      setError(message);
      setState("error");
    }
  }, [onEvent, stop]);

  // narrate page changes while a task runs (a few words, out of band so they do not enter the conversation)
  const narrate = useCallback(
    (label: string) => {
      if (!pc.current || !working.current || speaking.current) return;
      const now = Date.now();
      if (now - lastNarration.current < 6000) return;
      lastNarration.current = now;
      send({
        type: "response.create",
        response: {
          conversation: "none",
          metadata: { kind: "narration" },
          output_modalities: ["audio"],
          instructions: `In at most eight words and in your current tone, tell the user you are ${label.toLowerCase()}. No figures, no preamble.`,
        },
      });
    },
    [send],
  );

  // hang up after a long silence
  useEffect(() => {
    if (state === "off" || state === "error") return;
    const t = setInterval(() => {
      if (!working.current && Date.now() - lastActivity.current > IDLE_LIMIT_MS) stop();
    }, 30000);
    return () => clearInterval(t);
  }, [state, stop]);

  useEffect(() => () => stop(), [stop]);

  const resetStyle = useCallback(() => {
    applyStyle({ ...DEFAULT_VOICE_STYLE }, "Style reset to the defaults.");
  }, [applyStyle]);

  const setStyle = useCallback((next: VoiceStyle) => applyStyle(next, null), [applyStyle]);

  return {
    state,
    error,
    style,
    captions,
    adapted,
    streams,
    start,
    stop,
    narrate,
    resetStyle,
    setStyle,
  };
}
