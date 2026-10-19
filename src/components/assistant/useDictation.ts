import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

type Recognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult:
    | ((e: {
        resultIndex: number;
        results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
      }) => void)
    | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
};
type RecognitionCtor = new () => Recognition;

/**
 * Voice input. Uses the browser's own speech recognition where it exists (text appears as you speak); otherwise records audio
 * and has the server transcribe it when you stop.
 */
export function useDictation(onText: (text: string, final: boolean) => void) {
  const [listening, setListening] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognition = useRef<Recognition | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const callback = useRef(onText);
  callback.current = onText;

  const ctor: RecognitionCtor | null =
    typeof window === "undefined"
      ? null
      : ((((window as unknown as Record<string, unknown>)["SpeechRecognition"] ??
          (window as unknown as Record<string, unknown>)["webkitSpeechRecognition"]) as
          RecognitionCtor | undefined) ?? null);
  const supported =
    !!ctor ||
    (typeof navigator !== "undefined" &&
      !!navigator.mediaDevices?.getUserMedia &&
      typeof MediaRecorder !== "undefined");

  useEffect(
    () => () => {
      recognition.current?.abort();
      recorder.current?.stream.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  const transcribe = useCallback(async (blob: Blob) => {
    setWorking(true);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      const res = await fetch("/api/assistant-transcribe", {
        method: "POST",
        headers: {
          "content-type": blob.type || "audio/webm",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: blob,
      });
      const body = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
      if (!res.ok) throw new Error(body.error ?? "Dictation failed.");
      if (body.text) callback.current(body.text, true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Dictation failed.");
    } finally {
      setWorking(false);
    }
  }, []);

  const start = useCallback(async () => {
    setError(null);
    if (ctor) {
      const r = new ctor();
      r.continuous = true;
      r.interimResults = true;
      r.lang = navigator.language || "en-US";
      let finalText = "";
      r.onresult = (e) => {
        let interim = "";
        for (let i = e.resultIndex; i < e.results.length; i += 1) {
          const result = e.results[i]!;
          if (result.isFinal) finalText += result[0].transcript;
          else interim += result[0].transcript;
        }
        callback.current((finalText + interim).trim(), false);
      };
      r.onerror = (e) =>
        setError(
          e.error === "not-allowed" ? "Microphone access was blocked." : "Dictation stopped.",
        );
      r.onend = () => {
        setListening(false);
        if (finalText.trim()) callback.current(finalText.trim(), true);
      };
      recognition.current = r;
      r.start();
      setListening(true);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunks.current = [];
      rec.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        setListening(false);
        void transcribe(new Blob(chunks.current, { type: rec.mimeType || "audio/webm" }));
      };
      recorder.current = rec;
      rec.start();
      setListening(true);
    } catch {
      setError("Microphone access was blocked.");
    }
  }, [ctor, transcribe]);

  const stop = useCallback(() => {
    recognition.current?.stop();
    if (recorder.current && recorder.current.state !== "inactive") recorder.current.stop();
  }, []);

  return { supported, listening, working, error, start, stop };
}
