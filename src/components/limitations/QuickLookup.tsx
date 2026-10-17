import { useMemo } from "react";
import { ArrowRight, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StateMark } from "@/components/corpus/EntityArtwork";
import { STATES } from "@/lib/corpus/geo";
import {
  CLAIM_LABELS,
  CLAIM_TYPES,
  type ClaimType,
  type LimitationRule,
  type LimitationsSnapshot,
} from "@/lib/limitations/types";
import { cn } from "@/lib/utils";
import { CLAIM_STATUS_LABELS, claimMatrix } from "./stateStatutes";
import { nationalSpread } from "./quickLookup";

const select =
  "h-10 w-full rounded-md border border-input bg-surface px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring";

/**
 * The short path: pick a state and a claim, read the recorded general period and its citation, and see how
 * the period compares across jurisdictions. Date calculation, accrual and tolling stay in the guided review.
 */
export function QuickLookup({
  snapshot,
  state,
  claim,
  variantName,
  onChange,
  onCalculate,
  onOpenSources,
}: {
  snapshot: LimitationsSnapshot;
  state: string;
  claim: ClaimType | undefined;
  variantName: (rule: LimitationRule) => string;
  onChange: (state: string, claim: ClaimType | undefined) => void;
  onCalculate: () => void;
  onOpenSources: () => void;
}) {
  const stateName = STATES.find((s) => s.usps === state)?.name ?? "";
  const matrix = useMemo(
    () => (state ? claimMatrix(snapshot, state, variantName) : []),
    [snapshot, state, variantName],
  );
  const row = claim ? matrix.find((r) => r.claimType === claim) : undefined;
  const spread = useMemo(
    () => (claim ? nationalSpread(snapshot, claim, variantName) : null),
    [snapshot, claim, variantName],
  );

  return (
    <section className="space-y-3" aria-label="Quick limitations lookup">
      <div className="grid gap-3 rounded-lg border border-border bg-surface p-3 sm:grid-cols-[auto_minmax(0,1fr)_minmax(0,1.3fr)] sm:items-end">
        {state ? (
          <StateMark state={state} className="hidden size-14 sm:inline-flex" />
        ) : (
          <span className="hidden size-14 sm:block" aria-hidden="true" />
        )}
        <label className="block text-xs font-medium">
          State
          <select
            className={cn(select, "mt-1")}
            value={state}
            onChange={(e) => onChange(e.target.value, claim)}
          >
            <option value="">Choose a state…</option>
            {STATES.map((s) => (
              <option key={s.usps} value={s.usps}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs font-medium">
          Claim
          <select
            className={cn(select, "mt-1")}
            value={claim ?? ""}
            onChange={(e) =>
              onChange(state, (e.target.value || undefined) as ClaimType | undefined)
            }
          >
            <option value="">Choose a claim…</option>
            {CLAIM_TYPES.map((c) => (
              <option key={c} value={c}>
                {CLAIM_LABELS[c]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {!state || !claim ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          Pick a state and a claim to see the recorded general limitations period and its statute.
        </p>
      ) : (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="rounded-lg border border-border bg-surface p-4">
            <p className="text-xs text-muted-foreground">
              {stateName} · {CLAIM_LABELS[claim]}
            </p>
            {row && row.citation ? (
              <>
                <p className="mt-1 text-3xl font-semibold tracking-tight">{row.period}</p>
                <p className="mt-1 text-sm">
                  <span className="font-medium">{row.citation}</span>
                  <span className="text-muted-foreground"> · general period</span>
                </p>
                <p className="mt-2 text-xs">
                  <span
                    className={cn(
                      "rounded border px-1.5 py-px",
                      row.status === "baseline"
                        ? "border-success/40 bg-success/10"
                        : row.status === "flagged"
                          ? "border-warning/40 bg-warning/15"
                          : "border-border bg-muted",
                    )}
                  >
                    {CLAIM_STATUS_LABELS[row.status]}
                  </span>
                  {row.grade ? (
                    <span className="ml-2 text-muted-foreground">{row.grade}</span>
                  ) : null}
                </p>
                {row.variants.length ? (
                  <div className="mt-3 text-xs">
                    <p className="font-medium">Narrower rules recorded for this claim</p>
                    <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                      {row.variants.slice(0, 5).map((v) => (
                        <li key={v.ruleId}>{v.name}</li>
                      ))}
                      {row.variants.length > 5 ? <li>and {row.variants.length - 5} more</li> : null}
                    </ul>
                  </div>
                ) : null}
                {row.flags.length ? (
                  <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
                    {row.flags.slice(0, 3).map((f) => (
                      <li key={f}>· {f}</li>
                    ))}
                  </ul>
                ) : null}
                <p className="mt-3 text-xs text-muted-foreground">
                  This is the recorded general period only. Accrual, discovery, tolling, repose and
                  notice requirements can move the actual deadline.
                </p>
              </>
            ) : (
              <p className="mt-2 text-sm">
                No general period is recorded for this claim in {stateName}.
                {row?.reason ? (
                  <span className="block text-xs text-muted-foreground">{row.reason}</span>
                ) : null}
              </p>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              <Button size="sm" onClick={onCalculate}>
                Calculate a deadline
                <ArrowRight className="ml-1 size-3.5" aria-hidden="true" />
              </Button>
              <Button size="sm" variant="outline" onClick={onOpenSources}>
                <BookOpen className="mr-1 size-3.5" aria-hidden="true" />
                Statutes &amp; sources
              </Button>
            </div>
          </div>
          {spread && spread.buckets.length ? (
            <aside
              className="rounded-lg border border-border bg-surface p-3"
              aria-label="Period across jurisdictions"
            >
              <h3 className="text-[12px] font-semibold">Across all jurisdictions</h3>
              <p className="text-[11px] text-muted-foreground">
                General period for {CLAIM_LABELS[claim].toLowerCase()} in {spread.recorded} of{" "}
                {spread.total} jurisdictions with a recorded rule.
              </p>
              <ul className="mt-2 space-y-1.5">
                {spread.buckets.map((b) => {
                  const current = b.states.includes(state);
                  return (
                    <li key={b.period} className="text-[11px]">
                      <span className="flex justify-between gap-2">
                        <span className={cn(current && "font-semibold text-primary")}>
                          {b.period}
                          {current ? ` · ${stateName}` : ""}
                        </span>
                        <span className="font-mono text-muted-foreground">{b.states.length}</span>
                      </span>
                      <span className="mt-0.5 block h-1.5 rounded-full bg-muted">
                        <span
                          className={cn(
                            "block h-full rounded-full",
                            current ? "bg-primary" : "bg-muted-foreground/50",
                          )}
                          style={{ width: `${(b.states.length / spread.max) * 100}%` }}
                        />
                      </span>
                      <span className="mt-0.5 flex flex-wrap gap-1">
                        {b.states.map((s) => (
                          <button
                            key={s}
                            type="button"
                            onClick={() => onChange(s, claim)}
                            className={cn(
                              "rounded px-1 font-mono text-[10px] hover:bg-muted",
                              s === state ? "bg-primary/15 text-primary" : "text-muted-foreground",
                            )}
                            aria-label={`Show ${STATES.find((x) => x.usps === s)?.name ?? s}`}
                          >
                            {s}
                          </button>
                        ))}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </aside>
          ) : null}
        </div>
      )}
    </section>
  );
}
