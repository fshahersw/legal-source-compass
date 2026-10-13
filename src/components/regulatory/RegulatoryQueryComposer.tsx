import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, RotateCcw } from "lucide-react";
import {
  getRegulatoryQueryCapability,
  interpretRegulatoryQuery,
} from "@/lib/regulatory/regulatory-query.functions";
import type { RegulatoryQuery } from "@/lib/regulatory/types";
import { actionClass, fieldClass, panelClass, Qualifications } from "./RegulatoryPrimitives";
import { queryLabels } from "./monitoringView";

type Turn = { role: "user" | "assistant"; content: string };
type Interpretation = Awaited<ReturnType<typeof interpretRegulatoryQuery>>;

export function RegulatoryQueryComposer({
  query,
  onApply,
}: {
  query: RegulatoryQuery;
  onApply: (next: RegulatoryQuery) => void;
}) {
  const [draft, setDraft] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [proposal, setProposal] = useState<Interpretation | null>(null);
  const retryContext = useRef<Interpretation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const serial = useRef(0);
  const binding = JSON.stringify(query);
  const currentBinding = useRef(binding);
  currentBinding.current = binding;
  const capability = useQuery({
    queryKey: ["regulatory-query-capability"],
    queryFn: () => getRegulatoryQueryCapability(),
    staleTime: 60000,
  });
  useEffect(() => {
    serial.current++;
    setProposal(null);
    retryContext.current = null;
    setBusy(false);
  }, [binding]);
  useEffect(
    () => () => {
      serial.current++;
    },
    [],
  );

  async function interpret() {
    if (!draft.trim() || busy || !capability.data?.available) return;
    const current = [...turns, { role: "user" as const, content: draft.trim() }];
    const requestTurns = current.filter((turn) => turn.content.length <= 2000).slice(-9);
    while (requestTurns.reduce((sum, turn) => sum + turn.content.length, 0) > 16000)
      requestTurns.shift();
    const previousContext = retryContext.current;
    const proposedQuery = previousContext?.query ?? query;
    const ticket = ++serial.current;
    setTurns(current);
    setDraft("");
    setBusy(true);
    setError("");
    setProposal(null);
    try {
      const result = await interpretRegulatoryQuery({
        data: {
          turns: requestTurns,
          currentQuery: proposedQuery,
          pendingQuestions: previousContext?.pendingQuestions ?? [],
        },
      });
      if (ticket !== serial.current || currentBinding.current !== binding) return;
      setProposal(result);
      if (result.query) retryContext.current = result;
      setTurns([
        ...current,
        {
          role: "assistant",
          content: [result.summary, result.question].filter(Boolean).join("\n\n"),
        },
      ]);
    } catch {
      if (ticket === serial.current)
        setError(
          "The question could not be interpreted. Your question remains in the conversation; use the filters or try again.",
        );
    } finally {
      if (ticket === serial.current) setBusy(false);
    }
  }

  return (
    <section className={`${panelClass} px-3 py-2`} aria-label="Ask a regulatory research question">
      <h2 className="sr-only">Research question</h2>
      {turns.length > 0 && (
        <div className="flex justify-end">
          <button
            type="button"
            className="flex min-h-9 items-center gap-1 text-xs text-muted-foreground underline"
            onClick={() => {
              serial.current++;
              setTurns([]);
              setProposal(null);
              retryContext.current = null;
              setBusy(false);
              setError("");
            }}
          >
            <RotateCcw className="size-3" aria-hidden />
            Clear conversation
          </button>
        </div>
      )}
      {turns.length > 0 && (
        <div
          role="log"
          aria-label="Query conversation"
          aria-live="polite"
          aria-relevant="additions text"
          className="mt-2 max-h-56 space-y-2 overflow-y-auto border-l-2 border-border pl-3"
        >
          {turns.map((turn, i) => (
            <div key={i}>
              <p className="text-xs font-medium text-muted-foreground">
                {turn.role === "user" ? "You" : "Query assistant"}
              </p>
              <p className="whitespace-pre-wrap break-words text-sm leading-5">{turn.content}</p>
            </div>
          ))}
        </div>
      )}
      <form
        className="flex items-start gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void interpret();
        }}
      >
        <label className="min-w-0 flex-1">
          <span className="sr-only">Your public-source question</span>
          <textarea
            rows={1}
            maxLength={2000}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className={`${fieldClass} resize-y`}
            placeholder="Ask about a product, company or source change…"
            disabled={busy}
          />
        </label>
        <button
          type="submit"
          className={`${actionClass} shrink-0`}
          disabled={busy || !draft.trim() || !capability.data?.available}
        >
          {busy ? "Interpreting…" : "Interpret"}
          <ArrowRight className="size-3.5" aria-hidden />
        </button>
      </form>
      <div className="mt-1 flex flex-wrap items-start gap-x-3 text-xs leading-5 text-muted-foreground">
        <p>Public research only. Sent to the server; an AI provider may process questions.</p>
        <details>
          <summary className="cursor-pointer text-primary underline">How questions work</summary>
          <p>
            Conversation stays in this tab. Replies include recent context. Review recognized
            filters and explicitly apply them to change results.
          </p>
          <p>{capability.data?.message ?? "Checking question interpretation…"}</p>
        </details>
      </div>
      {(capability.isError || capability.data?.available === false) && (
        <p role="status" className="mt-1 text-xs text-muted-foreground">
          Question interpretation is unavailable. Structured filters remain available.
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      )}
      {proposal && (
        <div className="mt-3 border-t border-border pt-3">
          {proposal.query && (
            <div className="mb-2 flex flex-wrap gap-1.5" aria-label="Recognized filters">
              {queryLabels(proposal.query).map((label) => (
                <span
                  key={label}
                  className="rounded-md border border-border bg-muted/40 px-2 py-1 text-xs"
                >
                  {label}
                </span>
              ))}
            </div>
          )}
          <Qualifications items={proposal.limitations} />
          {proposal.status === "ready" && proposal.query && (
            <button
              type="button"
              className={`${actionClass} mt-2`}
              onClick={() => onApply(proposal.query!)}
            >
              Apply these filters
            </button>
          )}
          {proposal.status === "clarification" && (
            <p className="mt-2 text-xs font-medium">
              Answer the clarification above; the current results have not changed.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
