import { useInfiniteQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  getCourtRuleInsights,
  RULE_CATEGORIES,
  type RuleCategory,
  type RuleDocument,
  type RuleInsight,
} from "@/lib/external/courtRules.functions";
import { categoryTotals, oneLine, plural } from "./ruleFormat";

/** Practice points (deadlines, limits, filing and admission requirements) with the quoted rule words they rest on. */
export function RuleInsights({
  courtId,
  documents,
}: {
  courtId: string;
  documents: RuleDocument[];
}) {
  const [category, setCategory] = useState<RuleCategory | null>(null);
  const [doc, setDoc] = useState<string | null>(null);
  const withPoints = documents.filter((d) => d.insights > 0);
  const totals = categoryTotals(doc ? withPoints.filter((d) => d.id === doc) : withPoints);
  const docs = doc ? [doc] : withPoints.map((d) => d.id);
  const q = useInfiniteQuery({
    queryKey: ["court-rule-insights", courtId, category, docs.join(",")],
    // a short first page keeps the court page compact; later pages are larger
    queryFn: ({ pageParam }) =>
      getCourtRuleInsights({
        data: { docs, category, offset: pageParam, limit: pageParam === 0 ? 12 : 40 },
      }),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, p) => n + p.insights.length + p.dropped, 0);
      return last.total !== null && loaded < last.total && last.insights.length + last.dropped > 0
        ? loaded
        : undefined;
    },
    enabled: docs.length > 0,
    staleTime: 10 * 60 * 1000,
  });
  if (!withPoints.length)
    return (
      <p className="m-0 py-3 text-xs text-muted-foreground">
        No practice points were recorded for these rules.
      </p>
    );
  const items = q.data?.pages.flatMap((p) => p.insights) ?? [];
  const dropped = q.data?.pages.reduce((n, p) => n + p.dropped, 0) ?? 0;
  const total = q.data?.pages[0]?.total ?? null;
  const all = totals.reduce((n, t) => n + t.count, 0);
  return (
    <div className="space-y-2 pt-1">
      <div
        className="flex flex-wrap items-center gap-1.5"
        role="group"
        aria-label="Filter practice points by category"
      >
        <Chip
          active={category === null}
          onClick={() => setCategory(null)}
          label="All"
          count={all}
        />
        {totals.map((t) => (
          <Chip
            key={t.category}
            active={category === t.category}
            onClick={() => setCategory(t.category)}
            label={t.label}
            count={t.count}
          />
        ))}
        {withPoints.length > 1 ? (
          <label className="ml-auto flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span>Rules</span>
            <select
              value={doc ?? ""}
              onChange={(e) => {
                setDoc(e.target.value || null);
                setCategory(null);
              }}
              className="max-w-[16rem] rounded-md border border-input bg-background px-2 py-1 text-xs text-foreground"
            >
              <option value="">All documents</option>
              {withPoints.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      {q.isLoading ? (
        <div className="space-y-2" aria-busy="true" aria-label="Loading practice points">
          {[0, 1, 2].map((n) => (
            <div key={n} className="h-16 animate-pulse rounded-md bg-muted/50" />
          ))}
        </div>
      ) : q.isError ? (
        <p role="alert" className="m-0 flex items-center gap-2 py-2 text-xs text-muted-foreground">
          Practice points could not be loaded.
          <button type="button" onClick={() => void q.refetch()} className="text-primary underline">
            Retry
          </button>
        </p>
      ) : items.length === 0 ? (
        <p className="m-0 py-3 text-xs text-muted-foreground">
          No {category ? RULE_CATEGORIES[category].toLowerCase() : "practice"} points in{" "}
          {doc ? "this document" : "these rules"}.
        </p>
      ) : (
        <>
          <ul className="m-0 list-none divide-y divide-border/70 rounded-md border border-border/70 p-0">
            {items.map((i) => (
              <InsightRow key={i.id} i={i} />
            ))}
          </ul>
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <span>
              Showing {items.length.toLocaleString("en-US")}
              {total !== null ? ` of ${total.toLocaleString("en-US")}` : ""}
              {dropped ? ` · ${plural(dropped, "stored point")} could not be read` : ""}
            </span>
            {q.hasNextPage ? (
              <button
                type="button"
                onClick={() => void q.fetchNextPage()}
                disabled={q.isFetchingNextPage}
                className="rounded-md border border-border px-2.5 py-1 text-xs text-foreground hover:bg-muted disabled:opacity-60"
              >
                {q.isFetchingNextPage ? "Loading…" : "Show more"}
              </button>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

function Chip({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "rounded-full border px-2 py-0.5 text-[11px] transition-colors",
        active
          ? "border-primary/50 bg-primary/10 text-foreground"
          : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {label} <span className="font-mono">{count.toLocaleString("en-US")}</span>
    </button>
  );
}

function InsightRow({ i }: { i: RuleInsight }) {
  return (
    <li className="px-3 py-2.5">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="rounded border border-border px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {RULE_CATEGORIES[i.category]}
        </span>
        <p className="m-0 min-w-0 text-[13px] leading-snug">
          {i.appliesTo ? (
            <span className="text-muted-foreground">{oneLine(i.appliesTo)}: </span>
          ) : null}
          <span className="font-medium">{oneLine(i.value)}</span>
        </p>
      </div>
      <blockquote className="m-0 mt-1.5 border-l-2 border-border pl-3 text-xs leading-relaxed text-foreground/80">
        “{oneLine(i.quote)}”
      </blockquote>
      <p className="m-0 mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
        <span>
          {i.sectionLabel}
          {i.sectionTitle && i.sectionTitle !== i.sectionLabel
            ? `. ${oneLine(i.sectionTitle)}`
            : ""}
        </span>
        <span>{i.docTitle}</span>
        {i.page ? <span>Page {i.page}</span> : null}
        <a
          href={i.sourceUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline"
        >
          Official text <ExternalLink className="size-3" aria-hidden />
        </a>
      </p>
    </li>
  );
}
