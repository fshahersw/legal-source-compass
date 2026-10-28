/**
 * The voice's presence: a small canvas orb that breathes with the agent's voice (its level drives the size and glow),
 * shows the user's microphone as a ring, and turns into a rotating arc while a task runs. Levels come from Web Audio
 * analysers on the two streams; nothing is recorded. Static with reduced motion.
 */
import { useEffect, useRef } from "react";
import { useCanvasTheme } from "@/components/stories/useCanvasTheme";
import type { VoiceState } from "./useVoice";

function analyser(ctx: AudioContext, stream: MediaStream | null): AnalyserNode | null {
  if (!stream || !stream.getAudioTracks().length) return null;
  const node = ctx.createAnalyser();
  node.fftSize = 512;
  node.smoothingTimeConstant = 0.7;
  ctx.createMediaStreamSource(stream).connect(node);
  return node;
}

function level(node: AnalyserNode | null, buf: Uint8Array<ArrayBuffer>): number {
  if (!node) return 0;
  node.getByteTimeDomainData(buf);
  let sum = 0;
  for (let i = 0; i < buf.length; i++) {
    const v = (buf[i]! - 128) / 128;
    sum += v * v;
  }
  return Math.min(1, Math.sqrt(sum / buf.length) * 3.2);
}

export function VoiceOrb({
  state,
  mic,
  voice,
  size = 40,
}: {
  state: VoiceState;
  mic: MediaStream | null;
  voice: MediaStream | null;
  size?: number;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const theme = useCanvasTheme();
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = size * dpr;
    cv.height = size * dpr;
    const g = cv.getContext("2d");
    if (!g) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    let ctx: AudioContext | null = null;
    let micNode: AnalyserNode | null = null;
    let voiceNode: AnalyserNode | null = null;
    try {
      if (mic || voice) {
        ctx = new AudioContext();
        micNode = analyser(ctx, mic);
        voiceNode = analyser(ctx, voice);
      }
    } catch {
      ctx = null;
    }
    const buf = new Uint8Array(new ArrayBuffer(512));
    let raf = 0;
    let smoothV = 0;
    let smoothM = 0;
    const accent = theme.slots[0] ?? "#2a78d6";
    const second = theme.slots[2] ?? "#1baf7a";
    const draw = (t: number) => {
      const s = stateRef.current;
      smoothV += (level(voiceNode, buf) - smoothV) * 0.35;
      smoothM += (level(micNode, buf) - smoothM) * 0.35;
      const c = size / 2;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, size, size);
      const off = s === "off" || s === "error";
      const breath = reduce || off ? 0 : Math.sin(t / 700) * 0.04;
      const r = size * (0.2 + breath + smoothV * 0.12);
      const outer = Math.min(c - 1, r * 1.7);
      const grad = g.createRadialGradient(c, c, 0, c, c, outer);
      grad.addColorStop(0, off ? theme.base : accent);
      grad.addColorStop(Math.min(0.95, r / outer), off ? theme.base : accent);
      grad.addColorStop(1, "rgba(0,0,0,0)");
      g.globalAlpha = off ? 0.5 : 0.95;
      g.fillStyle = grad;
      g.beginPath();
      g.arc(c, c, outer, 0, Math.PI * 2);
      g.fill();
      g.globalAlpha = 1;
      if (smoothM > 0.04 && !off) {
        g.strokeStyle = second;
        g.lineWidth = 2;
        g.beginPath();
        g.arc(c, c, size * 0.44 - 1, 0, Math.PI * 2);
        g.globalAlpha = Math.min(1, 0.3 + smoothM);
        g.stroke();
        g.globalAlpha = 1;
      }
      if (s === "working" || s === "thinking" || s === "connecting") {
        const a = reduce ? 0 : (t / 380) % (Math.PI * 2);
        g.strokeStyle = theme.ink;
        g.lineWidth = 1.6;
        g.beginPath();
        g.arc(c, c, size * 0.44 - 1, a, a + Math.PI * 0.6);
        g.stroke();
      }
      if (!reduce) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      void ctx?.close().catch(() => undefined);
    };
  }, [mic, voice, size, theme]);

  return (
    <canvas ref={ref} aria-hidden style={{ width: size, height: size }} className="shrink-0" />
  );
}
