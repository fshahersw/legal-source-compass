/**
 * AiSummary: a quiet strip with a short "What this shows" (3 or 4 sentences, about 90 words at most) written from the
 * section's figures, on demand ("Summarize") and cached. It shows what the server returned after its own number check:
 * a sentence that stated a figure the section does not hold was dropped, and the strip says "Some details omitted".
 *
 *   const context = useMemo(() => buildSectionContext({ title, period, source, figures }), [...]);
 *   <AiSummary context={context} />                      // context null while the figures load; the strip waits
 *
 * `AiSummaryView` is the presentational half (every state from props), used by the gallery and the tests.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, CircleAlert, Copy, Loader2, TextAlignStart } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { summarizable, type SectionContext } from "@/lib/assistant/sectionContext";
import { cn } from "@/lib/utils";
import { AI_LABEL, AI_THIN, AI_UNCONFIGURED, copyText } from "./labels";
import { useAiStatus } from "./useAiStatus";
import { useAiSummary, type SummaryState } from "./useAiSummary";

export type AiSummaryViewState =
  | SummaryState
  /** The section's figures are still loading. */
  | { kind: "waiting" }
  /** The section has too few recorded figures to summarize. */
  | { kind: "empty" };

export type AiSummaryViewProps = {
  state: AiSummaryViewState;
  /** Heading (default "What this shows"). */
  title?: string | undefined;
  /** Section title, source and period, appended to a copied summary so it carries its provenance. */
  provenance?: string | undefined;
  onSummarize?: (() => void) | undefined;
  /** Extra controls at the end of the header row, normally the section's AskAiButton. */
  actions?: ReactNode | undefined;
  className?: string | undefined;
};

async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-label={done ? "Summary copied" : "Copy summary"}
      onClick={async () => {
        if (await writeClipboard(text)) {
          setDone(true);
          window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => setDone(false), 1800);
        } else toast.error("Could not copy. Select the text and copy it instead.");
      }}
    >
      {done ? <Check aria-hidden /> : <Copy aria-hidden />}
      {done ? "Copied" : "Copy"}
    </Button>
  );
}

function Lines() {
  // three skeleton lines: the height the ready state takes, so loading does not jump
  return (
    <div className="space-y-2" aria-hidden>
      {["w-11/12", "w-4/5", "w-2/3"].map((w) => (
        <div key={w} className={cn("h-3.5 animate-pulse rounded bg-muted", w)} />
      ))}
    </div>
  );
}

export function AiSummaryView({
  state,
  title = "What this shows",
  provenance,
  onSummarize,
  actions,
  className,
}: AiSummaryViewProps) {
  const busy = state.kind === "loading";
  // The header row is the same height in every state that has not produced text yet (waiting, idle, not configured,
  // too few figures), so the strip never shifts the page while the figures load or the status is checked.
  const right =
    state.kind === "ready" ? (
      <CopyButton text={copyText(state.bullets, provenance)} />
    ) : state.kind === "idle" || state.kind === "waiting" ? (
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={state.kind === "waiting"}
        title={state.kind === "waiting" ? "Available once the figures have loaded" : undefined}
        onClick={onSummarize}
      >
        Summarize
      </Button>
    ) : state.kind === "error" || state.kind === "rate_limited" ? (
      <Button type="button" variant="outline" size="sm" onClick={onSummarize}>
        Try again
      </Button>
    ) : state.kind === "empty" ? (
      <span className="min-w-0 text-meta text-muted-foreground" title={AI_THIN}>
        Not enough figures
        <span className="sr-only">. {AI_THIN}</span>
      </span>
    ) : state.kind === "unconfigured" ? (
      <span className="min-w-0 text-meta text-muted-foreground" title={state.message}>
        AI not configured
        <span className="sr-only">. {state.message}</span>
      </span>
    ) : null;
  return (
    <section
      aria-label={`AI summary: ${title}`}
      data-state={state.kind}
      className={cn(
        "min-w-0 rounded-xl border border-border bg-card shadow-xs px-4 py-3 text-card-foreground shadow-xs",
        className,
      )}
    >
      <div className="flex min-h-8 flex-wrap items-center gap-x-2 gap-y-1">
        <TextAlignStart className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <h3 className="m-0 min-w-0 flex-1 truncate text-label text-foreground">{title}</h3>
        {right}
        {actions}
      </div>
      <div aria-live="polite" aria-busy={busy} className="min-w-0">
        {state.kind === "loading" ? (
          <div className="mt-2.5">
            <p className="m-0 mb-2 flex items-center gap-1.5 text-meta text-muted-foreground">
              <Loader2 className="size-3 animate-spin" aria-hidden /> Summarizing the figures
            </p>
            <Lines />
          </div>
        ) : state.kind === "ready" ? (
          <>
            <ul className="m-0 mt-2 list-disc space-y-1.5 pl-5 text-[13px] leading-5 text-foreground marker:text-muted-foreground">
              {state.bullets.map((b, i) => (
                <li key={i}>{b}</li>
              ))}
            </ul>
            <p className="m-0 mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-meta text-muted-foreground">
              <span>{AI_LABEL}</span>
              {state.cached ? <span>Saved result.</span> : null}
              {state.omitted > 0 ? (
                <span title="A sentence that stated a figure not found in this section's figures was left out.">
                  Some details omitted.
                </span>
              ) : null}
            </p>
          </>
        ) : state.kind === "error" || state.kind === "rate_limited" ? (
          <p
            role="alert"
            className="m-0 mt-2 flex items-start gap-1.5 text-[13px] leading-5 text-muted-foreground"
          >
            <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            {state.message}
          </p>
        ) : state.kind === "thin" ? (
          <p className="m-0 mt-2 text-[13px] leading-5 text-muted-foreground">{state.message}</p>
        ) : null}
      </div>
    </section>
  );
}

export type AiSummaryProps = {
  /** From buildSectionContext. null while the section's figures are loading. */
  context: SectionContext | null;
  /** Heading (default "What this shows"). */
  title?: string | undefined;
  /** Extra controls at the end of the header row, normally the section's AskAiButton. */
  actions?: ReactNode | undefined;
  className?: string | undefined;
};

export function AiSummary({ context, title, actions, className }: AiSummaryProps) {
  const status = useAiStatus();
  const { state, summarize } = useAiSummary(context);
  const provenance = context
    ? [context.title, context.source ? `Source: ${context.source}` : null, context.period ?? null]
        .filter(Boolean)
        .join(". ")
    : undefined;
  const view: AiSummaryViewState = !context
    ? { kind: "waiting" }
    : !summarizable(context)
      ? { kind: "empty" }
      : status === "unconfigured" && state.kind !== "ready"
        ? { kind: "unconfigured", message: AI_UNCONFIGURED }
        : state;
  return (
    <AiSummaryView
      state={view}
      title={title}
      provenance={provenance}
      onSummarize={() => void summarize()}
      actions={actions}
      className={className}
    />
  );
}
