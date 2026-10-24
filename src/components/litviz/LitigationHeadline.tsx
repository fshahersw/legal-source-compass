/**
 * The Litigation overview's lead charts, from the JPML monthly pending-MDL reports: how the five largest pending MDLs
 * changed since a report date the reader chooses, and the MDLs whose pending actions rose or fell most in 12 months.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChartCard } from "@/components/charts/ChartCard";
import { DivergingDots, IndexChart } from "@/components/charts/d3/charts";
import type { Series } from "@/components/charts/d3/maths";
import { mdlAnalyticsQuery } from "@/components/matters/MdlAnalytics";
import { mdlName } from "@/lib/insights/generators/mdl";
import type { MdlAnalytics, MdlRow } from "@/lib/external/mdlAnalytics.functions";

const SOURCES = [
  { label: "JPML pending MDL reports", url: "https://www.jpml.uscourts.gov/pending-mdl-reports-archive" },
];
const int = (v: number) => v.toLocaleString("en-US");
const signed = (v: number) => (v > 0 ? `+${int(v)}` : int(v));
const monthLabel = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

/** "MDL 2740 Taxotere": number plus the first words of the short title, so end labels stay readable. */
export function shortMdl(m: Pick<MdlRow, "mdl" | "title">, max = 22): string {
  const full = mdlName(m.mdl, m.title);
  const inner = /\((.*)\)$/.exec(full)?.[1] ?? "";
  const words = inner.replace(/\s*\(.*$/, "").trim();
  const cut = words.length > max ? `${words.slice(0, max - 1).trimEnd()}…` : words;
  return cut ? `MDL ${m.mdl} ${cut}` : `MDL ${m.mdl}`;
}

/** Top `n` pending MDLs by actions pending, each as a series over every report date (absent months stay null). */
export function largestMdlSeries(data: MdlAnalytics, n = 5): { series: Series[]; picked: MdlRow[] } {
  const dates = data.overview.portfolio.map((p) => p.date);
  const picked = data.mdls
    .filter((m) => m.status === "pending" && m.series.length >= 2)
    .sort((a, b) => b.pending - a.pending)
    .slice(0, n);
  const series = picked.map((m) => {
    const at = new Map(m.series.map((p) => [p.date, p.pending]));
    return {
      id: String(m.mdl),
      label: shortMdl(m),
      points: dates.map((date) => ({ date, value: at.get(date) ?? null })),
    };
  });
  return { series, picked };
}

/** The `n` largest 12-month rises and `n` largest falls in pending actions (MDLs with a recorded change only). */
export function twelveMonthMovers(data: MdlAnalytics, n = 5): MdlRow[] {
  const withChange = data.mdls.filter((m) => m.status === "pending" && m.change12m != null);
  const ups = withChange.filter((m) => m.change12m! > 0).sort((a, b) => b.change12m! - a.change12m!).slice(0, n);
  const downs = withChange.filter((m) => m.change12m! < 0).sort((a, b) => a.change12m! - b.change12m!).slice(0, n);
  return [...ups, ...downs.reverse()];
}

export function LitigationHeadline() {
  const q = useQuery(mdlAnalyticsQuery);
  const data = q.data ?? null;
  const largest = useMemo(() => (data ? largestMdlSeries(data) : null), [data]);
  const movers = useMemo(() => (data ? twelveMonthMovers(data) : []), [data]);
  const status = q.isLoading
    ? ({ kind: "loading" } as const)
    : q.isError
      ? ({ kind: "error", message: "The JPML report figures could not be loaded.", onRetry: () => void q.refetch() } as const)
      : !data
        ? ({ kind: "empty", reason: "The JPML report figures have not been published yet." } as const)
        : ({ kind: "ready" } as const);
  const o = data?.overview;
  const period = o ? `${monthLabel(o.first_report)} – ${monthLabel(o.as_of)}` : undefined;
  const lead = largest?.picked[0];

  return (
    <div className="grid gap-4 xl:grid-cols-2" data-testid="litigation-headline">
      <ChartCard
        variant="editorial"
        title={
          lead && o
            ? `${shortMdl(lead, 40)} is the largest pending MDL, with ${int(lead.pending)} actions`
            : "Largest pending MDLs over time"
        }
        subtitle="Actions pending in the five largest MDLs · change since the report you choose"
        status={status.kind === "ready" && !largest?.series.length ? { kind: "empty", reason: "No pending MDL has two or more monthly reports." } : status}
        sources={SOURCES}
        period={period}
        asOf={o ? monthLabel(o.as_of) : undefined}
        about={
          <p>
            Each line is one MDL&apos;s actions pending as printed in the Panel&apos;s monthly report, shown as the percentage
            change from the report you pick with the slider (or by pointing at the chart). Months where an MDL is not
            listed are gaps, not zeros.
          </p>
        }
        table={
          largest
            ? {
                caption: "Actions pending in the five largest pending MDLs, latest report",
                columns: [{ label: "MDL" }, { label: "Pending now" }, { label: "Change, 12 months" }],
                rows: largest.picked.map((m) => ({
                  key: String(m.mdl),
                  cells: [mdlName(m.mdl, m.title), m.pending, m.change12m == null ? "Not recorded" : m.change12m],
                })),
              }
            : undefined
        }
        minHeight={320}
      >
        {largest?.series.length ? <IndexChart series={largest.series} formatDate={monthLabel} labelWidth={190} /> : null}
      </ChartCard>
      <ChartCard
        variant="editorial"
        title={
          movers.length && o
            ? `${shortMdl(movers[0]!, 40)} grew most in 12 months (${signed(movers[0]!.change12m!)} actions)`
            : "Biggest 12-month changes in pending actions"
        }
        subtitle="Change in actions pending over the last 12 monthly reports · largest rises and falls"
        status={status.kind === "ready" && !movers.length ? { kind: "empty", reason: "No 12-month change is recorded." } : status}
        sources={SOURCES}
        period={period}
        asOf={o ? monthLabel(o.as_of) : undefined}
        about={
          <p>
            A fall means actions were closed, remanded or transferred out; the report does not say which. MDLs that left
            the report entirely are not shown here.
          </p>
        }
        table={{
          caption: "Change in actions pending over 12 months",
          columns: [{ label: "MDL" }, { label: "Change, 12 months" }, { label: "Pending now" }],
          rows: movers.map((m) => ({
            key: String(m.mdl),
            cells: [mdlName(m.mdl, m.title), m.change12m!, m.pending],
          })),
        }}
        minHeight={320}
      >
        {movers.length ? (
          <DivergingDots
            items={movers.map((m) => ({ label: shortMdl(m), value: m.change12m }))}
            baseline={0}
            baselineLabel="No change"
            format={signed}
          />
        ) : null}
      </ChartCard>
    </div>
  );
}
