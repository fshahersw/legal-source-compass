import { useEffect, useRef, useState } from "react";
import {
  createReadAloudSession,
  type ReadAloudHost,
  type ReadAloudStatus,
} from "./readAloudSession";

export function ConversationReadAloud({
  text,
  disabled = false,
}: {
  text: string;
  disabled?: boolean;
}) {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [status, setStatus] = useState<ReadAloudStatus>({ speaking: false, message: "" });
  const session = useRef<ReturnType<typeof createReadAloudSession>>(null);
  useEffect(() => {
    let mounted = true;
    const controller = createReadAloudSession(window as unknown as ReadAloudHost, (next) => {
      if (mounted) setStatus(next);
    });
    session.current = controller;
    setSupported(Boolean(controller));
    return () => {
      mounted = false;
      controller?.stop();
      session.current = null;
    };
  }, []);
  useEffect(() => {
    session.current?.stop();
  }, [text, disabled]);

  return (
    <div className="space-y-1">
      <button
        type="button"
        className="min-h-11 rounded-lg border border-input px-3 py-2 text-sm disabled:opacity-50"
        disabled={disabled || supported !== true || !text.trim()}
        aria-pressed={status.speaking}
        onClick={() => (status.speaking ? session.current?.stop() : session.current?.speak(text))}
      >
        {status.speaking ? "Stop playback" : "Read question aloud"}
      </button>
      <p role="status" aria-live="polite" className="text-xs text-muted-foreground">
        {supported === false ? "Browser question playback is unavailable." : status.message}
      </p>
      <p className="text-xs text-muted-foreground">
        Playback uses your browser’s speech service and starts only when you select the button.
      </p>
    </div>
  );
}
