/**
 * The Litigation overview's lead chart, from the JPML monthly pending-MDL reports: how the five largest pending MDLs
 * changed since a report date the reader chooses. The 12-month rises and falls moved to MdlMomentumScatter, which
 * places every listed MDL instead of ten.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChartCard } from "@/components/charts/ChartCard";
import { IndexChart } from "@/components/charts/d3/charts";
import type { Series } from "@/components/charts/d3/maths";
import { mdlAnalyticsQuery } from "@/components/matters/MdlAnalytics";
import { mdlName } from "@/lib/insights/generators/mdl";
import type { MdlAnalytics, MdlRow } from "@/lib/external/mdlAnalytics.functions";
import { hasPending } from "@/lib/external/mdlSeries";

const SOURCES = [
  {
    label: "JPML pending MDL reports",
    url: "https://www.jpml.uscourts.gov/pending-mdl-reports-archive",
  },
];
const int = (v: number) => v.toLocaleString("en-US");
const monthLabel = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

/** "MDL 2740 Taxotere": number plus the first words of the short title, so end labels stay readable. */
export function shortMdl(m: Pick<MdlRow, "mdl" | "title">, max = 22): string {
  const full = mdlName(m.mdl, m.title);
  const inner = /\((.*)\)$/.exec(full)?.[1] ?? "";
  const words = inner.replace(/\s*\(.*$/, "").trim();
  const cut = words.length > max ? `${words.slice(0, max - 1).trimEnd()}…` : words;
  return cut ? `MDL ${m.mdl} ${cut}` : `MDL ${m.mdl}`;
}

/** "Depo-Provera (3140)": the product or subject first, so a narrow label keeps the part readers scan for. */
export function productLabel(m: Pick<MdlRow, "mdl" | "title">, max = 16): string {
  const inner = /\((.*)\)$/.exec(mdlName(m.mdl, m.title))?.[1] ?? "";
  const words = inner
    .replace(/\s*\(.*$/, "")
    .replace(/,?\s*(Inc|LLC|Corp|Co)\.?.*$/i, "")
    .trim();
  const cut = words.length > max ? `${words.slice(0, max - 1).trimEnd()}…` : words;
  return cut ? `${cut} (${m.mdl})` : `MDL ${m.mdl}`;
}

/** Top `n` pending MDLs by actions pending, each as a series over every report date (absent months stay null). */
export function largestMdlSeries(
  data: MdlAnalytics,
  n = 5,
): { series: Series[]; picked: (MdlRow & { pending: number })[] } {
  const dates = data.overview.portfolio.map((p) => p.date);
  const picked = data.mdls
    .filter((m) => m.status === "pending" && m.series.length >= 2)
    .filter(hasPending)
    .sort((a, b) => b.pending - a.pending)
    .slice(0, n);
  const series = picked.map((m) => {
    const at = new Map(m.series.map((p) => [p.date, p.pending]));
    return {
      id: String(m.mdl),
      label: productLabel(m, 12),
      points: dates.map((date) => ({ date, value: at.get(date) ?? null })),
    };
  });
  return { series, picked };
}

export function LitigationHeadline() {
  const q = useQuery(mdlAnalyticsQuery);
  const data = q.data ?? null;
  const largest = useMemo(() => (data ? largestMdlSeries(data) : null), [data]);
  const status = q.isLoading
    ? ({ kind: "loading" } as const)
    : q.isError
      ? ({
          kind: "error",
          message: "The JPML report figures could not be loaded.",
          onRetry: () => void q.refetch(),
        } as const)
      : !data
        ? ({
            kind: "empty",
            reason: "The JPML report figures have not been published yet.",
          } as const)
        : ({ kind: "ready" } as const);
  const o = data?.overview;
  const period = o ? `${monthLabel(o.first_report)} – ${monthLabel(o.as_of)}` : undefined;
  const lead = largest?.picked[0];

  return (
    <div className="min-w-0" data-testid="litigation-headline">
      <ChartCard
        variant="editorial"
        title={
          lead && o
            ? `${productLabel(lead, 36)} is the largest pending MDL, with ${int(lead.pending)} actions`
            : "Largest pending MDLs over time"
        }
        subtitle="Actions pending in the five largest MDLs · change since the report you choose"
        status={
          status.kind === "ready" && !largest?.series.length
            ? { kind: "empty", reason: "No pending MDL has two or more monthly reports." }
            : status
        }
        sources={SOURCES}
        period={period}
        asOf={o ? monthLabel(o.as_of) : undefined}
        about={
          <p>
            Each line is one MDL&apos;s actions pending as printed in the Panel&apos;s monthly
            report, shown as the percentage change from the report you pick with the slider (or by
            pointing at the chart). Months where an MDL is not listed are gaps, not zeros.
          </p>
        }
        table={
          largest
            ? {
                caption: "Actions pending in the five largest pending MDLs, latest report",
                columns: [
                  { label: "MDL" },
                  { label: "Pending now" },
                  { label: "Change, 12 months" },
                ],
                rows: largest.picked.map((m) => ({
                  key: String(m.mdl),
                  cells: [
                    mdlName(m.mdl, m.title),
                    m.pending,
                    m.change12m == null ? "Not recorded" : m.change12m,
                  ],
                })),
              }
            : undefined
        }
        minHeight={320}
      >
        {largest?.series.length ? (
          <IndexChart series={largest.series} formatDate={monthLabel} labelWidth={170} />
        ) : null}
      </ChartCard>
    </div>
  );
}
