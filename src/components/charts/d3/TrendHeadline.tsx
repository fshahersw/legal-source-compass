/**
 * A section's lead pair of charts built from Analytics trend blocks: (1) every series rebased to a period the reader
 * chooses, so series of very different sizes compare on one scale; (2) each series' latest complete period against
 * the one before, as dots either side of "no change". Titles are computed from the plotted values.
 */
import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { ChartCard } from "@/components/charts/ChartCard";
import { analyticsBlockQuery } from "@/components/analytics/hub/blockQuery";
import { formatValue, type TrendBlockData } from "@/lib/analytics/trend";
import { DivergingDots, IndexChart } from "./charts";
import { rebase } from "./maths";
import { alignTrends } from "./trendAlign";

export type TrendHeadlineItem = { id: string; label: string };

const pctText = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(Math.abs(v) < 10 ? 1 : 0)}%`;
const KIND_LABEL = { year: "calendar year", fy: "fiscal year", month: "month", congress: "Congress" } as const;

export function TrendHeadline({
  items,
  subject,
  unitNote,
}: {
  items: readonly TrendHeadlineItem[];
  /** What the series count, in a few words ("enforcement activity", "recalls"). */
  subject: string;
  /** Short reminder that the series count different things, shown in the About popover. */
  unitNote: string;
}) {
  const results = useQueries({ queries: items.map((i) => analyticsBlockQuery(i.id)) });
  const loading = results.some((r) => r.isPending);
  const failed = results.filter((r) => r.isError).length;
  const blocks = useMemo(
    () =>
      results.flatMap((r, i) =>
        r.data?.status === "ok" ? [{ id: items[i]!.id, label: items[i]!.label, block: r.data.data }] : [],
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [results.map((r) => r.dataUpdatedAt).join(","), items],
  );
  const aligned = useMemo(() => alignTrends(blocks), [blocks]);
  const fmtX = (x: string) => (aligned?.xKind === "fy" ? `FY${x}` : x);
  const byId = new Map<string, TrendBlockData>(blocks.map((b) => [b.id, b.block]));
  const sources = blocks.map((b) => ({ label: b.block.source.label, url: b.block.source.url }));
  const uniqueSources = sources.filter((s, i) => sources.findIndex((t) => t.url === s.url) === i);

  // (1) change since the default comparison period
  const dates = aligned?.series[0]?.points.map((p) => p.date) ?? [];
  const start = dates[aligned?.commonStart ?? 0];
  const lastDate = dates[dates.length - 1];
  const fromStart = aligned && start ? rebase(aligned.series, start) : [];
  const ranked = fromStart
    .map((s) => ({ s, end: [...s.points].reverse().find((p) => p.value != null) }))
    .filter((r) => r.end)
    .sort((a, b) => Math.abs(b.end!.value!) - Math.abs(a.end!.value!));
  const lead = ranked[0];

  // (2) latest complete period against the previous one
  const changes = blocks
    .map((b) => ({ b, c: b.block.latest?.change ?? null, latest: b.block.latest }))
    .filter((r) => r.c && r.c.percent != null)
    .sort((a, b) => b.c!.percent! - a.c!.percent!);
  const biggest = [...changes].sort((a, b) => Math.abs(b.c!.percent!) - Math.abs(a.c!.percent!))[0];

  const status = loading
    ? ({ kind: "loading" } as const)
    : !blocks.length
      ? failed
        ? ({ kind: "error", message: "These trend figures could not be loaded.", onRetry: () => results.forEach((r) => void r.refetch()) } as const)
        : ({ kind: "empty", reason: "None of these series has been published yet." } as const)
      : ({ kind: "ready" } as const);
  const notice =
    failed || aligned?.leftOut.length ? (
      <span>
        {failed ? `${failed} of ${items.length} series could not be loaded. ` : ""}
        {aligned?.leftOut.length
          ? `${aligned.leftOut.map((id) => items.find((i) => i.id === id)?.label ?? id).join(", ")} counted by a different kind of year and not drawn here.`
          : ""}
      </span>
    ) : undefined;

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]" data-testid="trend-headline">
      <ChartCard
        variant="editorial"
        title={
          lead && start
            ? `Since ${fmtX(start)}, ${lead.s.label} changed most: ${pctText(lead.end!.value! * 100)}`
            : `How ${subject} changed over time`
        }
        subtitle={`Each series as a % change from the ${aligned ? KIND_LABEL[aligned.xKind] : "period"} you choose`}
        status={status.kind === "ready" && !aligned ? { kind: "empty", reason: "Fewer than three periods are shared by two or more series." } : status}
        notice={notice}
        sources={uniqueSources}
        period={start && lastDate ? `${fmtX(dates[0]!)}–${fmtX(lastDate)}` : undefined}
        about={
          <>
            <p>{unitNote}</p>
            <p className="mt-2">
              Lines start at 0% at the period you choose, so large and small series compare on one scale. Periods a
              source does not record are gaps.
              {aligned?.cutAt.length
                ? ` ${aligned.cutAt.map((c) => `${c.label} starts at ${c.x} (${c.marker.toLowerCase()})`).join("; ")}.`
                : ""}
              {aligned?.partialDropped.length
                ? ` Unfinished periods (${aligned.partialDropped.join(", ")}) are left out.`
                : ""}
            </p>
          </>
        }
        table={
          aligned
            ? {
                caption: `${subject}, by ${KIND_LABEL[aligned.xKind]}`,
                columns: [{ label: "Period" }, ...aligned.series.map((s) => ({ label: s.label }))],
                rows: dates.map((d, i) => ({
                  key: d,
                  cells: [fmtX(d), ...aligned.series.map((s) => s.points[i]?.value ?? "Not recorded")],
                })),
              }
            : undefined
        }
        minHeight={340}
      >
        {aligned ? (
          <IndexChart
            series={aligned.series}
            initialIndex={aligned.commonStart}
            labelWidth={180}
            formatDate={fmtX}
          />
        ) : null}
      </ChartCard>
      <ChartCard
        variant="editorial"
        title={
          biggest
            ? `${biggest.b.label} ${biggest.c!.percent! >= 0 ? "rose" : "fell"} most in ${biggest.latest!.period}: ${pctText(biggest.c!.percent!)}`
            : "Latest period against the one before"
        }
        subtitle="Latest complete period against the one before it"
        status={status.kind === "ready" && !changes.length ? { kind: "empty", reason: "No series has two complete periods to compare." } : status}
        sources={uniqueSources}
        about={<p>Each dot compares a series&apos; latest complete period with the period before it, as the source counts them.</p>}
        table={{
          caption: "Latest complete period against the one before",
          columns: [{ label: "Series" }, { label: "Latest period" }, { label: "Value" }, { label: "Before" }, { label: "Change" }],
          rows: changes.map(({ b, c, latest }) => ({
            key: b.id,
            cells: [
              b.label,
              latest!.period,
              formatValue(latest!.value, b.block.format),
              `${formatValue(c!.previousValue, b.block.format)} (${c!.comparedWith})`,
              pctText(c!.percent!),
            ],
          })),
        }}
        minHeight={340}
      >
        {changes.length ? (
          <DivergingDots
            items={changes.map(({ b, latest }) => ({
              label: b.label,
              value: byId.get(b.id)?.latest?.change?.percent ?? null,
            }))}
            baseline={0}
            baselineLabel="No change"
            showBaselineValue={false}
            format={pctText}
            labelWidth={170}
          />
        ) : null}
      </ChartCard>
    </div>
  );
}
