import { useEffect, useId, useRef, useState } from "react";
import {
  createDictationSession,
  dictationConstructor,
  type DictationStatus,
  type RecognitionHost,
} from "./dictationSession";
export function ConversationDictation({
  onTranscript,
  disabled = false,
}: {
  onTranscript: (text: string) => void;
  disabled?: boolean;
}) {
  const descriptionId = useId();
  const [supported, setSupported] = useState<boolean | null>(null);
  const [status, setStatus] = useState<DictationStatus>({ state: "idle", message: "" });
  const session = useRef<ReturnType<typeof createDictationSession> | null>(null);
  const current = useRef({ onTranscript, disabled });
  current.current = { onTranscript, disabled };

  useEffect(() => {
    const Constructor = dictationConstructor(window as unknown as RecognitionHost);
    setSupported(Boolean(Constructor));
    if (!Constructor) return;
    let mounted = true;
    const controller = createDictationSession(
      () => new Constructor(),
      (text) => {
        if (mounted && !current.current.disabled) current.current.onTranscript(text);
      },
      (next) => {
        if (mounted) setStatus(next);
      },
    );
    session.current = controller;
    return () => {
      mounted = false;
      controller.abort();
      session.current = null;
    };
  }, []);

  useEffect(() => {
    if (disabled) session.current?.abort();
  }, [disabled]);

  const active = ["starting", "listening", "stopping"].includes(status.state);
  return (
    <div className="space-y-2">
      <button
        type="button"
        className="min-h-11 rounded-lg border border-input px-3 py-2 text-sm disabled:opacity-50"
        disabled={disabled || supported !== true || status.state === "stopping"}
        aria-pressed={active}
        aria-describedby={descriptionId}
        onClick={() => (active ? session.current?.stop() : session.current?.start())}
      >
        {active ? "Stop dictation" : "Dictate a draft"}
      </button>
      <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
        {supported === false
          ? "Browser dictation is unavailable."
          : supported === null
            ? "Checking browser dictation support."
            : status.message || "Dictation starts only when you select the button."}
      </p>
      <p id={descriptionId} className="text-xs text-muted-foreground">
        Your browser or its speech provider may process your voice. Dictation adds text to the
        editable draft and never sends it automatically. Typing and your device's keyboard dictation
        also work.
      </p>
    </div>
  );
}
