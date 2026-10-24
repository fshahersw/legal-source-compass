/**
 * Chart kit gallery (/prototypes/charts): every primitive of the chart layer on live data, with its loading, empty,
 * error and partial states, so page builders can see what each one looks like before using it. Figures come from the
 * published federal court statistics (Judicial Business tables) and the analytics trend blocks; benchmark bands and
 * medians are computed from those published values. The state examples carry no data.
 */
import { useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { courtStatsQuery } from "@/components/courts/CourtStatsDashboard";
import { at, fmtNum, type CourtStatsOverview } from "@/components/courts/courtStatsData";
import { ChartCard } from "../ChartCard";
import { Sparkline } from "../Sparkline";
import {
  BlockCard,
  BulletBand,
  RankBars,
  SmallMultiplesGrid,
  TimelineStrip,
  TrendLines,
  benchmark,
  benchmarkTakeaway,
  medianOf,
  periodTable,
  rankRows,
  trendTakeaway,
} from "../recharts";

const COURT_SOURCES = [
  {
    label: "Judicial Business of the United States Courts",
    url: "https://www.uscourts.gov/statistics-reports/analysis-reports/judicial-business-united-states-courts",
  },
];

function Section({
  id,
  title,
  note,
  children,
}: {
  id: string;
  title: string;
  note: string;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-4 space-y-3">
      <div>
        <h2 id={`${id}-h`} className="text-base font-semibold leading-6">
          {title}
        </h2>
        <p className="max-w-3xl text-xs leading-5 text-muted-foreground">{note}</p>
      </div>
      {children}
    </section>
  );
}

export function ChartGallery() {
  const q = useQuery(courtStatsQuery);
  return (
    <div className="space-y-8">
      <p className="rounded-md border border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
        Chart kit reference. Each chart uses published data; the state examples (loading, empty,
        error) carry none. See docs/chart-kit.md for when to pick each form.
      </p>

      <Section
        id="cards"
        title="ChartCard and states"
        note="The kit card chrome (takeaway title, measure subtitle, View data drawer with CSV, source footer with the Partial pill and the About popover) with the chart layer inside; an optional key-figure strip above the chart. Loading keeps the chart's height; error offers a retry; empty states the reason."
      >
        <div className="grid gap-3 md:grid-cols-3">
          <ChartCard
            title="Loading state"
            subtitle="Skeleton sized like the chart"
            status={{ kind: "loading" }}
            minHeight={140}
          />
          <ChartCard
            title="Error state"
            subtitle="Other charts on the page are unaffected"
            status={{ kind: "error", onRetry: () => void q.refetch() }}
          />
          <ChartCard
            title="Empty state"
            subtitle="The reason is stated, never a zero chart"
            status={{
              kind: "empty",
              reason: "The published table holds no value for this measure.",
            }}
          />
        </div>
      </Section>

      <Section
        id="trends"
        title="Lines and columns over time, with partial periods"
        note="TrendLines and TrendColumns through BlockCard: last value labelled at the line end or on the last column, partial periods dashed or hatched and left out of the takeaway, reporting-change markers labelled."
      >
        <div className="grid gap-3 lg:grid-cols-2">
          <BlockCard id="federal-civil" />
          <BlockCard id="nhtsa-recalls" form="line" />
          <BlockCard id="cpsc-recalls" />
          <BlockCard id="fda-recalls" />
        </div>
      </Section>

      {q.isLoading ? (
        <ChartCard title="Court statistics" status={{ kind: "loading" }} />
      ) : q.isError || !q.data ? (
        <ChartCard
          title="Court statistics"
          status={{ kind: "error", onRetry: () => void q.refetch() }}
        />
      ) : (
        <CourtExamples data={q.data} />
      )}
    </div>
  );
}

function CourtExamples({ data }: { data: CourtStatsOverview }) {
  const yi = data.years.length - 1;
  const year = `FY${data.years[yi]}`;
  const focusId = "ilnd";
  const focus = data.districts.find((d) => d.id === focusId) ?? data.districts[0];
  const fmtMonths = (v: number) => `${fmtNum(v, 1)} months`;
  const median = data.districts.map((d) => ({ id: d.id, label: d.name, value: at(d.median, yi) }));
  const mid = medianOf(median.map((m) => m.value));
  const ranked = rankRows(median, { focusId: focus?.id ?? null });
  const focusRow = ranked.rows.find((r) => r.focus);

  const band = (pick: (d: CourtStatsOverview["districts"][number]) => number | null) => {
    const vals = data.districts.map(pick).filter((v): v is number => v !== null);
    return {
      min: vals.length ? Math.min(...vals) : null,
      median: medianOf(vals),
      max: vals.length ? Math.max(...vals) : null,
      n: vals.length,
    };
  };
  const perJ = band((d) => at(d.civilPerJudgeship, yi));
  const months = band((d) => at(d.median, yi));
  const over3 = band((d) => at(d.over3, yi));

  const top = useMemo(
    () =>
      [...data.districts].sort((a, b) => (at(b.pl, yi) ?? -1) - (at(a.pl, yi) ?? -1)).slice(0, 6),
    [data.districts, yi],
  );
  const smRows = data.years.map((y, i) => {
    const row: Record<string, unknown> = { year: `FY${y}` };
    for (const d of top) row[d.id] = at(d.pl, i);
    row["median"] = medianOf(data.districts.map((d) => at(d.pl, i)));
    return row;
  });
  const civil = data.national.series["civil_filed"];
  const civilPoints = data.years.map((y, i) => ({ label: `FY${y}`, value: at(civil, i) }));
  const nationalRows = data.years.map((y, i) => ({
    year: `FY${y}`,
    national: at(data.national.series["median_total"], i),
    district: at(data.national.series["district_median_total"], i),
  }));

  return (
    <>
      <Section
        id="rank"
        title="Ranked bars with a focus item and a benchmark"
        note="RankBars: sorted, values at the bar ends, the focus item in the accent and the rest muted, the median as a labelled line, the focus row kept when it ranks below the cut."
      >
        <ChartCard
          title={
            focusRow && mid !== null
              ? `${focusRow.label} ranks ${focusRow.rank} of ${ranked.total} on time to disposition; median district ${fmtMonths(mid)}`
              : "Median months to disposition, by district"
          }
          subtitle={`Median months from filing to disposition, civil cases · Table C-5 · ${year} · top 12 of ${ranked.total}`}
          sources={COURT_SOURCES}
          table={{
            caption: `Median months to disposition by district, ${year}`,
            columns: [
              { label: "District" },
              { label: "Rank", align: "right" },
              { label: "Months", align: "right" },
            ],
            rows: ranked.rows.map((r) => ({
              key: r.id,
              cells: [r.label, String(r.rank), fmtNum(r.value, 1)],
            })),
          }}
        >
          <RankBars
            items={median}
            format={(v) => fmtNum(v, 1)}
            focusId={focus?.id ?? null}
            references={benchmark("Median district", mid, (v) => fmtNum(v, 1))}
            limit={12}
            showRank
            ariaLabel={`Median months to disposition by district, ${year}`}
          />
        </ChartCard>
      </Section>

      <Section
        id="bullet"
        title="Bullet chart against a national band"
        note="BulletBand: the focus value over the min–max band of all districts with the median tick; every number is written, nothing is read off the marks."
      >
        <ChartCard
          title={
            benchmarkTakeaway(
              `${focus?.name ?? "District"}, ${year}`,
              focus ? at(focus.median, yi) : null,
              months.median,
              "the median district",
              fmtMonths,
            ) ?? "District against all districts"
          }
          subtitle={`Three workload measures against all ${perJ.n} districts · Tables C, C-5, C-6, X-1A · ${year}`}
          sources={COURT_SOURCES}
        >
          <BulletBand
            focusLabel={focus?.name ?? "District"}
            benchmarkLabel="All districts"
            ariaLabel={`${focus?.name ?? "District"} against all districts`}
            format={(v) => fmtNum(v)}
            rows={[
              {
                id: "perj",
                label: "Civil filings per judgeship",
                value: focus ? at(focus.civilPerJudgeship, yi) : null,
                ...perJ,
              },
              {
                id: "months",
                label: "Median months to disposition",
                value: focus ? at(focus.median, yi) : null,
                ...months,
                format: (v) => fmtNum(v, 1),
              },
              {
                id: "over3",
                label: "Civil cases pending 3+ years",
                value: focus ? at(focus.over3, yi) : null,
                ...over3,
              },
            ]}
          />
        </ChartCard>
      </Section>

      <Section
        id="multiples"
        title="Small multiples on a shared axis"
        note="SmallMultiplesGrid: one panel per entity, one hue, a shared value axis so panels compare by height, the median district as a context line in every panel."
      >
        <ChartCard
          title={`The six busiest product liability districts in ${year}, against the median district`}
          subtitle={`Product liability filings per fiscal year · Table C-11 · FY${data.years[0]}–FY${data.years.at(-1)}`}
          sources={COURT_SOURCES}
          table={periodTable(
            smRows,
            "year",
            [
              ...top.map((d) => ({ key: d.id, label: d.name })),
              { key: "median", label: "Median district" },
            ],
            (v) => fmtNum(v),
            { caption: "Product liability filings, six districts", xLabel: "Fiscal year" },
          )}
        >
          <SmallMultiplesGrid
            rows={smRows}
            xKey="year"
            panels={top.map((d) => ({ key: d.id, label: d.name }))}
            context={{ key: "median", label: "Median district" }}
            focusKey={focus?.id ?? null}
            format={(v) => fmtNum(v)}
            ariaLabel="Product liability filings by district"
          />
        </ChartCard>
      </Section>

      <Section
        id="lines"
        title="Two series against each other"
        note="TrendLines: legend above, direct end labels with the last value, context series dashed, nice ticks."
      >
        <ChartCard
          title={
            trendTakeaway(
              "The pooled national median",
              nationalRows.map((r) => ({ label: r.year, value: r.national })),
              fmtMonths,
            ) ?? "Median months to disposition"
          }
          subtitle="Months from filing to disposition, civil cases, pooled national vs median district · Table C-5"
          sources={COURT_SOURCES}
          table={periodTable(
            nationalRows,
            "year",
            [
              { key: "national", label: "National" },
              { key: "district", label: "Median district" },
            ],
            (v) => fmtNum(v, 1),
            { caption: "Median months to disposition", xLabel: "Fiscal year" },
          )}
        >
          <TrendLines
            rows={nationalRows}
            xKey="year"
            series={[
              { key: "national", label: "National median", short: "National" },
              {
                key: "district",
                label: "Median district",
                short: "Median district",
                context: true,
              },
            ]}
            format={(v) => fmtNum(v, 1)}
            xTick={(v) => `’${v.slice(4)}`}
            zero={false}
            ariaLabel="Median months to disposition, national and median district"
          />
        </ChartCard>
      </Section>

      <Section
        id="compact"
        title="Compact history: timeline strip and sparkline"
        note="TimelineStrip replaces a bare count with its history (latest complete period in the accent); the SVG Sparkline is at least 120 × 32 with start and end values."
      >
        <div className="grid gap-3 md:grid-cols-2">
          <ChartCard
            title={
              trendTakeaway("District civil filings", civilPoints, (v) => fmtNum(v)) ??
              "District civil filings"
            }
            subtitle={`Civil cases filed in U.S. district courts · Table C · FY${data.years[0]}–FY${data.years.at(-1)}`}
            sources={COURT_SOURCES}
          >
            <TimelineStrip
              points={civilPoints}
              format={(v) => fmtNum(v)}
              what="District civil filings per fiscal year"
            />
          </ChartCard>
          <ChartCard
            title="Product liability filings, national"
            subtitle={`Sparkline with start and end values · Table C-11 · FY${data.years[0]}–FY${data.years.at(-1)}`}
            sources={COURT_SOURCES}
          >
            <Sparkline
              series={{
                id: "pl",
                label: "Product liability filings",
                points: data.years.map((y, i) => ({
                  key: String(y),
                  value: at(data.national.series["pl_total"], i),
                })),
              }}
              keys={data.years.map(String)}
              width={200}
              height={36}
              zero
              format={(v) => fmtNum(v)}
              showStart
            />
          </ChartCard>
        </div>
      </Section>
    </>
  );
}
