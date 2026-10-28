/**
 * The voice strip above the navigator's input: live captions of the last exchange, what the voice is doing, and the
 * personality it is using right now as chips. When it adapts on its own (you cut in, you keep it short) it says why.
 * Open the chips to set the style by hand or reset it; the style is remembered in this browser.
 */
import { useState } from "react";
import { RotateCcw, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { styleLabels, type VoiceStyle } from "@/lib/navigator/voiceStyle";
import type { Caption, VoiceState } from "./useVoice";

function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { id: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 shrink-0 text-[11px] text-muted-foreground">{label}</span>
      <div role="group" aria-label={label} className="flex rounded-md border border-border p-0.5">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            aria-pressed={value === o.id}
            onClick={() => onChange(o.id)}
            className={cn(
              "rounded px-1.5 py-0.5 text-[11px]",
              value === o.id
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function VoiceBar({
  state,
  error,
  captions,
  style,
  adapted,
  onStyle,
  onReset,
}: {
  state: VoiceState;
  error: string | null;
  captions: Caption[];
  style: VoiceStyle;
  adapted: string | null;
  onStyle: (s: VoiceStyle) => void;
  onReset: () => void;
}) {
  const [editing, setEditing] = useState(false);
  if (state === "error")
    return (
      <div
        role="alert"
        className="border-t border-border bg-destructive/5 px-3 py-2 text-[12px] text-destructive"
      >
        {error ?? "Voice could not start."}
      </div>
    );
  const lastYou = [...captions].reverse().find((c) => c.who === "you");
  const lastAgent = [...captions].reverse().find((c) => c.who === "agent");
  return (
    <div className="space-y-1.5 border-t border-border bg-muted/40 px-3 py-2" aria-live="polite">
      {lastYou || lastAgent ? (
        <div className="space-y-0.5 text-[12px] leading-4">
          {lastYou ? (
            <p className="line-clamp-2">
              <span className="font-semibold text-muted-foreground">You: </span>
              {lastYou.text}
            </p>
          ) : null}
          {lastAgent ? (
            <p className="line-clamp-3">
              <span className="font-semibold text-primary">Agent: </span>
              {lastAgent.text}
            </p>
          ) : null}
        </div>
      ) : (
        <p className="text-[12px] text-muted-foreground">
          {state === "connecting"
            ? "Connecting…"
            : "Go ahead and talk. Ask it to find, compare or open something, or tell it how you want it to talk."}
        </p>
      )}
      {adapted ? (
        <p className="text-[11px] italic text-muted-foreground">Adapted: {adapted}</p>
      ) : null}
      <div className="flex flex-wrap items-center gap-1">
        {styleLabels(style).map((l) => (
          <span
            key={l}
            className="rounded-full bg-background px-2 py-0.5 text-[10.5px] text-muted-foreground ring-1 ring-border"
          >
            {l}
          </span>
        ))}
        <button
          type="button"
          onClick={() => setEditing((e) => !e)}
          aria-expanded={editing}
          aria-label="Adjust how the agent talks"
          title="Adjust how the agent talks"
          className="ml-auto inline-flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
        >
          <SlidersHorizontal className="size-3.5" aria-hidden />
        </button>
        <button
          type="button"
          onClick={onReset}
          aria-label="Reset the style"
          title="Reset the style"
          className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
        >
          <RotateCcw className="size-3.5" aria-hidden />
        </button>
      </div>
      {editing ? (
        <div className="space-y-1.5 rounded-md border border-border bg-background p-2">
          <Choice
            label="Length"
            value={style.verbosity}
            options={[
              { id: "brief", label: "Brief" },
              { id: "normal", label: "Normal" },
              { id: "detailed", label: "Detailed" },
            ]}
            onChange={(verbosity) => onStyle({ ...style, verbosity })}
          />
          <Choice
            label="Tone"
            value={style.formality}
            options={[
              { id: "casual", label: "Casual" },
              { id: "neutral", label: "Neutral" },
              { id: "formal", label: "Formal" },
            ]}
            onChange={(formality) => onStyle({ ...style, formality })}
          />
          <Choice
            label="Pace"
            value={style.pace}
            options={[
              { id: "slower", label: "Slower" },
              { id: "normal", label: "Normal" },
              { id: "faster", label: "Faster" },
            ]}
            onChange={(pace) => onStyle({ ...style, pace })}
          />
          <Choice
            label="Terms"
            value={style.explainTerms ? "explain" : "skip"}
            options={[
              { id: "explain", label: "Explain" },
              { id: "skip", label: "Skip" },
            ]}
            onChange={(v) => onStyle({ ...style, explainTerms: v === "explain" })}
          />
          <Choice
            label="Humor"
            value={style.humor}
            options={[
              { id: "off", label: "Off" },
              { id: "light", label: "Light" },
            ]}
            onChange={(humor) => onStyle({ ...style, humor })}
          />
        </div>
      ) : null}
    </div>
  );
}
