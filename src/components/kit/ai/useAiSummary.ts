/**
 * The state machine behind AiSummary: idle -> loading -> ready | thin | error | rate_limited | unconfigured, with the
 * browser cache in front (keyed by the hash of the context) and one shared request per context, so two cards asking for
 * the same figures cost one call. A result for an older context is dropped, never shown.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { contextKey, summarizable, type SectionContext } from "@/lib/assistant/sectionContext";
import { summarizeSection } from "@/lib/assistant/summarize.functions";
import type { SummaryResult } from "@/lib/assistant/summaryTypes";
import { summaryCache } from "./summaryCache";

export type SummaryState =
  | { kind: "idle" }
  | { kind: "loading" }
  | {
      kind: "ready";
      bullets: string[];
      omitted: number;
      cached: boolean;
      generatedAt: string;
    }
  | { kind: "thin"; message: string }
  | { kind: "error"; message: string }
  | { kind: "rate_limited"; message: string; retryAfterSec: number | null }
  | { kind: "unconfigured"; message: string };

const pending = new Map<string, Promise<SummaryResult>>();

function request(key: string, context: SectionContext): Promise<SummaryResult> {
  const existing = pending.get(key);
  if (existing) return existing;
  const run = summarizeSection({ data: context })
    .catch((): SummaryResult => ({
      status: "unavailable",
      reason: "error",
      message: "The summary could not be reached. Check the connection and try again.",
    }))
    .finally(() => pending.delete(key));
  pending.set(key, run);
  return run;
}

export function toState(result: SummaryResult): SummaryState {
  if (result.status === "ok")
    return {
      kind: "ready",
      bullets: result.bullets,
      omitted: result.omitted,
      cached: result.cached,
      generatedAt: result.generatedAt,
    };
  if (result.status === "thin") return { kind: "thin", message: result.message };
  if (result.reason === "not_configured") return { kind: "unconfigured", message: result.message };
  if (result.reason === "rate_limited")
    return {
      kind: "rate_limited",
      message: result.message,
      retryAfterSec: result.retryAfterSec ?? null,
    };
  return { kind: "error", message: result.message };
}

function initial(key: string | null): SummaryState {
  const hit = key ? summaryCache.get(key) : null;
  return hit ? { kind: "ready", ...hit, cached: true } : { kind: "idle" };
}

export function useAiSummary(context: SectionContext | null) {
  const key = context && summarizable(context) ? contextKey(context) : null;
  const [state, setState] = useState<SummaryState>(() => initial(key));
  const latest = useRef(0);

  useEffect(() => {
    latest.current += 1;
    setState(initial(key));
  }, [key]);

  const summarize = useCallback(async () => {
    if (!context || !key) return;
    const hit = summaryCache.get(key);
    if (hit) {
      setState({ kind: "ready", ...hit, cached: true });
      return;
    }
    const mine = ++latest.current;
    setState({ kind: "loading" });
    const result = await request(key, context);
    if (mine !== latest.current) return;
    if (result.status === "ok")
      summaryCache.set(key, {
        bullets: result.bullets,
        omitted: result.omitted,
        generatedAt: result.generatedAt,
      });
    setState(toState(result));
  }, [context, key]);

  return { state, summarize, key };
}
