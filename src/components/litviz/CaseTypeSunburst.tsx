/**
 * Litigation: one fiscal year of federal civil filings broken down twice, case-type group → nature-of-suit code (FJC
 * IDB). Same five groups and colours as the case-mix chart above it; the rest are folded into "All other case types".
 * Choosing a group in the list (or pointing at the ring) shows its largest codes.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChartCard } from "@/components/charts/ChartCard";
import { Sunburst } from "@/components/charts/d3/charts";
import { seriesVar } from "@/components/charts/palette";
import { nationalQuery, nosQuery } from "@/components/courts/caseload/caseloadQueries";
import { formatCount } from "@/lib/analytics/trend";
import { cn } from "@/lib/utils";
import { caseTree } from "./caseTree";

const SOURCE = {
  label: "Federal Judicial Center, Integrated Database (civil cases)",
  url: "https://www.fjc.gov/research/idb/civil-cases-filed-terminated-and-pending-sy-1988-present",
};
const TITLE = "Case types within one year";
const pct = (v: number, total: number) => `${((v / total) * 100).toFixed(1)}%`;

export function CaseTypeSunburst() {
  const nos = useQuery(nosQuery);
  const national = useQuery(nationalQuery);
  const fy = national.data?.latestFy ?? null;
  const tree = nos.data
    ? caseTree(nos.data.rows, { top: 5, rootName: fy != null ? `FY${fy} filings` : "Filings" })
    : null;
  const [focus, setFocus] = useState<string | null>(null);
  const status =
    nos.isPending || national.isPending
      ? ({ kind: "loading" } as const)
      : nos.isError || national.isError
        ? ({
            kind: "error",
            message: "This chart could not be loaded.",
            onRetry: () => {
              void nos.refetch();
              void national.refetch();
            },
          } as const)
        : !tree
          ? ({ kind: "empty", reason: "Filings by case type are not recorded yet." } as const)
          : ({ kind: "ready" } as const);
  const lead = tree?.groups[0];
  const topCode = tree?.groups
    .filter((g) => g.slot !== 5)
    .flatMap((g) => g.codes)
    .sort((a, b) => b.filings - a.filings)[0];
  const active = tree?.groups.find((g) => g.name === focus) ?? null;

  return (
    <section id="litigation-case-types" aria-label={TITLE}>
      <ChartCard
        variant="editorial"
        title={
          tree && lead && topCode && fy != null
            ? `FY${fy}: ${lead.name} was the largest case type (${pct(lead.filings, tree.total)}); the single largest code was ${topCode.name}`
            : TITLE
        }
        subtitle={`Civil filings by case type (inner ring) and nature-of-suit code (outer ring)${fy != null ? ` · FY${fy}` : ""}`}
        status={status}
        sources={[SOURCE]}
        period={fy != null ? `FY${fy}` : undefined}
        about={
          <ul className="list-disc space-y-1 pl-4">
            <li>
              Each case counts once, under the nature-of-suit code it was filed with. Codes are
              grouped by this project into case types; the groups add up to the national total.
            </li>
            <li>
              The five largest case types match the chart above; the other groups sit in &ldquo;All
              other case types&rdquo;, where the outer ring shows each group instead of its codes.
            </li>
            <li>Codes with no filings in the year, and codes not mapped to a group, are left out.</li>
          </ul>
        }
        table={
          tree
            ? {
                caption: `Federal civil filings by case type and nature-of-suit code, FY${fy ?? ""}`,
                columns: [{ label: "Case type" }, { label: "Code" }, { label: "Filings" }],
                rows: tree.groups.flatMap((g) =>
                  g.codes.map((c) => ({
                    key: `${g.key}-${c.code}`,
                    cells: [g.name, c.code > 0 ? `${c.code} ${c.name}` : c.name, c.filings],
                  })),
                ),
              }
            : undefined
        }
        minHeight={360}
      >
        {tree ? (
          <div className="grid items-center gap-6 md:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
            <Sunburst
              root={tree.root}
              size={320}
              focus={focus}
              onFocusChange={setFocus}
              centerLabel={(v) => formatCount(v)}
            />
            <div className="min-w-0 space-y-3">
              <ul className="space-y-1" aria-label="Case types">
                {tree.groups.map((g) => (
                  <li key={g.key}>
                    <button
                      type="button"
                      onMouseEnter={() => setFocus(g.name)}
                      onMouseLeave={() => setFocus(null)}
                      onFocus={() => setFocus(g.name)}
                      onBlur={() => setFocus(null)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted/60",
                        focus === g.name && "bg-muted/60",
                      )}
                    >
                      <span
                        aria-hidden
                        className="size-2.5 shrink-0 rounded-full"
                        style={{ background: seriesVar(g.slot) }}
                      />
                      <span className="min-w-0 flex-1 truncate">{g.name}</span>
                      <span className="tabular-nums text-muted-foreground">
                        {formatCount(g.filings)}
                      </span>
                      <span className="w-12 text-right tabular-nums text-xs text-muted-foreground">
                        {pct(g.filings, tree.total)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <div className="min-h-[7.5rem] rounded-md border border-border/60 px-3 py-2">
                {active ? (
                  <>
                    <p className="text-xs font-medium text-muted-foreground">
                      Largest in {active.name}
                    </p>
                    <ol className="mt-1 space-y-0.5 text-sm">
                      {active.codes.slice(0, 4).map((c) => (
                        <li key={c.code} className="flex gap-2">
                          <span className="min-w-0 flex-1 truncate">
                            {c.code > 0 ? `${c.code} · ${c.name}` : c.name}
                          </span>
                          <span className="tabular-nums text-muted-foreground">
                            {formatCount(c.filings)}
                          </span>
                        </li>
                      ))}
                    </ol>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Point at a case type to see its largest codes.
                  </p>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </ChartCard>
    </section>
  );
}
