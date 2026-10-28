/**
 * Chart-kit visuals for the FDA dashboard: the findings card with its AI summary, the KPI strip, trend cards (count
 * with its rolling average and a marked peak), ranked category bars with full labels and shares, the recall class mix,
 * the change-against-prior-window chart and the tiles that lead to the other FDA datasets.
 */
import { useMemo, type ReactNode } from "react";
import { ArrowRight, Info, Lightbulb } from "lucide-react";
import { ChartCard, type ChartSource, type TableSpec } from "@/components/charts/ChartCard";
import { LineTrend } from "@/components/charts/LineTrend";
import { Sparkline } from "@/components/charts/Sparkline";
import { metricFormatter } from "@/components/charts/format";
import { sequentialFill, seriesVar } from "@/components/charts/palette";
import type { TrendSeriesInput } from "@/components/charts/series";
import { BarList } from "@/components/kit/BarList";
import { Card, CardFooter } from "@/components/kit/Card";
import { InfoPopover } from "@/components/kit/InfoPopover";
import { KpiCard, KpiGrid, KpiStrip, type KpiCardProps } from "@/components/kit/KpiCard";
import { AiSummary, buildSectionContext, type FigureInput } from "@/components/kit/ai";
import type {
  FdaAnalyticsDataset,
  FdaAnalyticsFacet,
  FdaDateRange,
  FdaGranularity,
} from "@/lib/fda-analytics/types";
import { granularityLabel } from "./analyticsView";
import {
  averageLabel,
  averageWindow,
  classMix,
  count,
  dayText,
  fdaMovers as moversOf,
  fdaPeriodAxis,
  fdaTrend,
  hasCodedCategories,
  peakOf,
  percentText,
  periodText,
  rankedCategories,
  RECALL_CLASS_MEANING,
  shortCount,
  rollingMean,
  signedPercent,
  trendLines,
  type FdaClassMix,
  type FdaFinding,
  type FdaMover,
} from "./insights";

const COUNT = metricFormatter("count");

export type DatasetRef = { dataset: FdaAnalyticsDataset; label: string; range: FdaDateRange };

function SourceButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
      aria-label={`Source and coverage for ${label}`}
      title="Source and coverage"
      onClick={onClick}
    >
      <Info className="size-4" aria-hidden />
    </button>
  );
}

function sourcesOf(datasets: readonly FdaAnalyticsDataset[]): ChartSource[] {
  const seen = new Set<string>();
  return datasets.flatMap((dataset) => {
    if (seen.has(dataset.documentationUrl)) return [];
    seen.add(dataset.documentationUrl);
    return [{ label: `openFDA · ${dataset.label}`, url: dataset.documentationUrl }];
  });
}

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
const rangeText = (range: FdaDateRange) => `${dayText(range.from)} – ${dayText(range.to)}`;
const days = (range: FdaDateRange) =>
  Math.round((Date.parse(range.to) - Date.parse(range.from)) / 86400000) + 1;

function About({ datasets }: { datasets: readonly FdaAnalyticsDataset[] }) {
  return (
    <div className="space-y-2">
      {datasets.map((dataset) => (
        <div key={dataset.id} className="space-y-1">
          <p className="font-medium">{dataset.label}</p>
          {dataset.series ? (
            <p>
              Dated by: {dataset.series.dateMeaning}. Counts are complete through{" "}
              {dataset.series.completeThrough
                ? dayText(dataset.series.completeThrough)
                : "a date that is not recorded"}
              ; later days can still change as FDA adds reports.
            </p>
          ) : null}
          <p>{dataset.qualification}</p>
        </div>
      ))}
      <p>Source records and reports, not unique patients, injuries or causal findings.</p>
    </div>
  );
}

/** "What stands out" with the AI summary of the same figures. */
export function FindingsCard({
  findings,
  figures,
  scope,
  period,
}: {
  findings: readonly FdaFinding[];
  figures: readonly FigureInput[];
  scope: string;
  period: string;
}) {
  const context = useMemo(
    () =>
      figures.length
        ? buildSectionContext({
            title: `FDA ${scope}: what stands out`,
            scope: "openFDA aggregate counts in the selected window",
            period,
            source: "openFDA",
            figures,
          })
        : null,
    [figures, scope, period],
  );
  if (!findings.length) return null;
  return (
    <Card as="section" aria-label="What stands out" className="overflow-hidden">
      <div className="px-4 pt-3.5">
        <h2 className="flex items-center gap-1.5 text-label font-semibold text-foreground">
          <Lightbulb className="size-4 text-brand" aria-hidden />
          What stands out
        </h2>
        <ul className="mt-2 grid list-none gap-x-6 gap-y-1.5 p-0 lg:grid-cols-2">
          {findings.map((finding) => (
            <li key={finding.id} className="flex gap-2 text-body leading-6 text-foreground/90">
              <span className="mt-2.5 size-1.5 shrink-0 rounded-full bg-brand" aria-hidden />
              <span>{finding.text}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="px-4 pb-3 pt-3">
        <AiSummary context={context} />
      </div>
      <CardFooter>
        <span className="text-meta text-muted-foreground">
          Computed from the snapshot for {period}. Each dataset uses its own latest complete date.
        </span>
      </CardFooter>
    </Card>
  );
}

/** Headline counts with change against the prior window and the shape of the window. */
export function FdaKpis({
  items,
  interval,
  onSource,
}: {
  items: readonly DatasetRef[];
  interval: FdaGranularity;
  onSource: (dataset: FdaAnalyticsDataset) => void;
}) {
  const cells = items.map(({ dataset, label, range }) =>
    kpiCell(dataset, label, range, interval, onSource),
  );
  return (
    <KpiStrip
      label="FDA headline counts"
      items={cells}
      cellBasis={
        cells.length === 5
          ? "basis-[calc(50%-1px)] md:basis-[calc(33.333%-1px)] xl:basis-[calc(20%-1px)]"
          : cells.length === 6 || cells.length === 3
            ? "basis-[calc(50%-1px)] md:basis-[calc(33.333%-1px)]"
            : "basis-[calc(50%-1px)] md:basis-[calc(25%-1px)]"
      }
    />
  );
}

function kpiCell(
  dataset: FdaAnalyticsDataset,
  label: string,
  range: FdaDateRange,
  interval: FdaGranularity,
  onSource: (dataset: FdaAnalyticsDataset) => void,
): KpiCardProps & { key: string } {
  const trend = fdaTrend(dataset, range, interval === "day" ? "week" : interval);
  const keys = trend.data.map((datum) => datum.key);
  const total = trend.points.every((point) => point.value !== null)
    ? trend.points.reduce((sum, point) => sum + (point.value ?? 0), 0)
    : null;
  const previous = comparison(dataset, range);
  return {
    key: dataset.id,
    label,
    value: total === null ? null : count(total),
    meta: `${days(range)} days to ${dayText(range.to)}`,
    delta:
      previous.percent !== null
        ? {
            value: previous.percent,
            text: signedPercent(previous.percent),
            detail: `vs ${count(previous.prior)} prior`,
          }
        : null,
    deltaNote: previous.percent === null ? previous.note : undefined,
    trend:
      keys.length > 2
        ? (slot) => (
            <Sparkline
              series={{ id: dataset.id, label, points: trend.data }}
              keys={keys}
              width={slot === "side" ? 120 : 200}
              height={32}
              zero
            />
          )
        : undefined,
    trendPlacement: "below",
    action: <SourceButton label={label} onClick={() => onSource(dataset)} />,
  };
}

function comparison(dataset: FdaAnalyticsDataset, range: FdaDateRange) {
  const mover = moversOf([{ dataset, label: dataset.label, range }])[0];
  if (!mover || !mover.comparable)
    return {
      percent: null,
      prior: null,
      note: mover?.current === null ? "Coverage incomplete" : "Prior window not captured",
    };
  if (mover.percent === null)
    return { percent: null, prior: mover.previous, note: `Prior window: ${count(mover.previous)}` };
  return { percent: mover.percent, prior: mover.previous, note: "" };
}

/** Count per period with the rolling average and the peak marked; several datasets share one axis when given. */
export function TrendCard({
  items,
  interval,
  title,
  onSource,
  height = 220,
  id,
}: {
  items: readonly DatasetRef[];
  interval: FdaGranularity;
  title?: string | undefined;
  onSource: (dataset?: FdaAnalyticsDataset) => void;
  height?: number | undefined;
  id?: string | undefined;
}) {
  const trends = items.map((item) => ({
    ...item,
    trend: fdaTrend(item.dataset, item.range, interval),
  }));
  const keys = [
    ...new Set(trends.flatMap(({ trend }) => trend.data.map((datum) => datum.key))),
  ].sort();
  const axis = fdaPeriodAxis(keys, interval);
  const single = trends.length === 1 ? trends[0]! : null;
  const window = averageWindow(interval);
  // several noisy series read better as their rolling averages; the raw counts stay in the table
  const smoothed = !single && window > 0;
  const lines: TrendSeriesInput[] = single
    ? trendLines(single.trend, interval, single.label)
    : trends.map(({ dataset, label, trend }) => ({
        id: dataset.id,
        label,
        points: smoothed ? rollingMean(trend.data, window) : trend.data,
      }));
  const hasAverage = lines.some((line) => line.id === "average");
  const peak = single ? peakOf(single.trend.data) : null;
  const units = [...new Set(items.map((item) => item.dataset.countUnit))];
  const datasets = items.map((item) => item.dataset);
  const totals = trends.map(({ trend }) =>
    trend.points.every((point) => point.value !== null)
      ? trend.points.reduce((sum, point) => sum + (point.value ?? 0), 0)
      : null,
  );
  const ranked = trends
    .map((item, index) => ({ label: item.label, total: totals[index] ?? null, range: item.range }))
    .filter(
      (item): item is { label: string; total: number; range: FdaDateRange } => item.total !== null,
    )
    .sort((a, b) => b.total - a.total);
  const computedTitle = single
    ? totals[0] !== null
      ? `${single.label}: ${count(totals[0])} in ${days(single.range)} days${peak ? `, peak ${count(peak.value)} in the ${interval === "day" ? "day" : interval} of ${dayText(peak.key)}` : ""}`
      : single.label
    : ranked.length > 1
      ? `${ranked[0]!.label} lead with ${count(ranked[0]!.total)} in ${days(ranked[0]!.range)} days; ${ranked
          .slice(1)
          .map((item) => `${item.label.toLowerCase()} ${count(item.total)}`)
          .join(", ")}`
      : (title ?? "Counts by period");
  const empty = !lines.some((line) => line.points.some((point) => point.value !== null));
  const average =
    single && hasAverage ? rollingMean(single.trend.data, interval === "day" ? 7 : 4) : null;
  const table: TableSpec = {
    caption: `${computedTitle}. ${units.join("; ")}, ${granularityLabel(interval)}.`,
    columns: [
      { label: "Period" },
      ...trends.map(({ label }) => ({ label, align: "right" as const })),
      ...(average ? [{ label: averageLabel(interval), align: "right" as const }] : []),
    ],
    rows: keys.map((key, index) => {
      const partial = trends.some(
        ({ trend }) => trend.data.find((datum) => datum.key === key)?.partial,
      );
      return {
        key,
        muted: partial,
        cells: [
          `${periodText(key, interval)}${partial ? " (partial)" : ""}`,
          ...trends.map(({ trend }) =>
            count(trend.data.find((datum) => datum.key === key)?.value ?? null),
          ),
          ...(average ? [count(average[index]?.value ?? null)] : []),
        ],
      };
    }),
  };
  return (
    <ChartCard
      id={id}
      title={computedTitle}
      subtitle={`${units.length === 1 ? units[0] : "Source records"} · ${smoothed ? `${averageLabel(interval)} of ${granularityLabel(interval)} counts` : granularityLabel(interval)}${single ? ` · ${rangeText(single.range)}` : " · each source to its latest complete date"}`}
      status={
        empty
          ? { kind: "empty", reason: "No verified series is available for this window." }
          : undefined
      }
      table={empty ? undefined : table}
      sources={sourcesOf(datasets)}
      period={single ? rangeText(single.range) : undefined}
      partial={
        trends.some(({ trend }) => trend.data.some((datum) => datum.partial))
          ? "The first or last period is only partly inside the window or past the latest complete date; it is drawn dashed."
          : undefined
      }
      about={<About datasets={datasets} />}
      actions={<SourceButton label={computedTitle} onClick={() => onSource(single?.dataset)} />}
      minHeight={height}
    >
      {units.length > 1 ? (
        <p className="py-8 text-center text-meta text-muted-foreground">
          These datasets count different things and cannot share an axis.
        </p>
      ) : (
        <LineTrend
          series={lines}
          axis={axis}
          formatter={COUNT}
          unit={units[0]}
          ariaLabel={`${computedTitle}. ${granularityLabel(interval)} counts.`}
          height={height}
          highlight={hasAverage ? "average" : null}
          colorSlot={hasAverage ? (id) => (id === "average" ? 0 : 1) : undefined}
          annotations={peak ? [{ key: peak.key, label: `Peak ${count(peak.value)}` }] : []}
          directLabels={single ? !hasAverage : undefined}
          area={single ? !hasAverage : false}
        />
      )}
      {!single && units.length === 1 ? (
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-muted-foreground">
          {lines.map((line, index) => (
            <span key={line.id} className="inline-flex items-center gap-1.5">
              <span
                className="h-0.5 w-4 rounded"
                style={{ background: seriesVar(index) }}
                aria-hidden
              />
              {line.label}
            </span>
          ))}
        </p>
      ) : null}
      {hasAverage ? (
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded bg-[var(--chart-muted-mark)]" aria-hidden />
            {granularityLabel(interval)} count
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded bg-[var(--chart-1)]" aria-hidden />
            {averageLabel(interval)}
          </span>
        </p>
      ) : null}
    </ChartCard>
  );
}

/** Ranked categories with full labels, counts and shares of the matching records. */
export function CategoryCard({
  dataset,
  facet,
  range,
  title,
  onSource,
  limit = 8,
}: {
  dataset: FdaAnalyticsDataset;
  facet: FdaAnalyticsFacet;
  range?: FdaDateRange | undefined;
  title: string;
  onSource: () => void;
  limit?: number | undefined;
}) {
  const ranked = rankedCategories(facet, range);
  const scope =
    facet.scope.kind === "window"
      ? rangeText({ from: facet.scope.from, to: facet.scope.to })
      : facet.scope.kind === "inventory"
        ? "Current inventory"
        : "All records";
  const top = ranked.available ? ranked.items[0] : undefined;
  const heading =
    ranked.available && top
      ? `${title}: ${clip(top.label, 40)} leads with ${count(top.count)}${top.share !== null ? ` (${percentText(top.share)})` : ""}`
      : title;
  const table: TableSpec | undefined = ranked.available
    ? {
        caption: `${title}, ${scope}. ${facet.countUnit}.`,
        columns: [
          { label: "Category" },
          { label: "Records", align: "right" },
          { label: "Share of matching records", align: "right" },
        ],
        rows: ranked.items.map((item) => ({
          key: item.key,
          cells: [item.label, count(item.count), percentText(item.share)],
        })),
      }
    : undefined;
  const notes = [
    facet.multiValued
      ? "One record can fall in several categories, so shares can add up to more than 100%."
      : null,
    facet.truncated || !facet.exhaustive
      ? `Only the most frequent categories were captured; ${count(facet.denominator)} records match in all.`
      : null,
    hasCodedCategories(facet)
      ? "Code meanings follow the openFDA field reference; the FDA code is kept in brackets."
      : null,
  ].filter((note): note is string => !!note);
  return (
    <ChartCard
      title={heading}
      subtitle={`${facet.countUnit} · ${scope}`}
      status={ranked.available ? undefined : { kind: "empty", reason: ranked.reason }}
      table={table}
      sources={sourcesOf([dataset])}
      period={scope}
      about={
        <div className="space-y-2">
          {notes.map((note) => (
            <p key={note}>{note}</p>
          ))}
          <p>{facet.qualification}</p>
        </div>
      }
      footnotes={facet.multiValued ? ["A record can name several categories."] : undefined}
      actions={<SourceButton label={title} onClick={onSource} />}
      minHeight={160}
    >
      {ranked.available ? (
        <BarList
          ariaLabel={`${title}, ${scope}`}
          labelWidth="46%"
          items={ranked.items.slice(0, limit).map((item) => ({
            id: item.key,
            label: item.label,
            value: item.count,
            display: shortCount(item.count),
            note: item.share !== null ? percentText(item.share) : undefined,
          }))}
        />
      ) : null}
    </ChartCard>
  );
}

const CLASS_FILL: Record<string, string> = {
  "Class I": sequentialFill(1),
  "Class II": sequentialFill(0.55),
  "Class III": sequentialFill(0.22),
};

/** Each product family's recalls split by FDA class, most serious first, as one 100% bar per family. */
export function ClassMixCard({
  items,
  onSource,
}: {
  items: readonly DatasetRef[];
  onSource: () => void;
}) {
  const mixes = items
    .map(({ dataset, range, label }) => ({ label, mix: classMix(dataset, range) }))
    .filter((item): item is { label: string; mix: FdaClassMix } => !!item.mix);
  const classes = [...new Set(mixes.flatMap(({ mix }) => mix.parts.map((part) => part.key)))];
  const worst = [...mixes]
    .map((item) => ({ ...item, one: item.mix.parts.find((part) => part.key === "Class I") }))
    .filter((item) => item.one)
    .sort((a, b) => b.one!.share - a.one!.share)[0];
  const title = worst
    ? `${percentText(worst.one!.share)} of ${worst.label.toLowerCase()} were Class I, the most serious`
    : "Recall reports by FDA class";
  const table: TableSpec = {
    caption: "Recall enforcement reports by FDA class in each family's selected window.",
    columns: [
      { label: "Family" },
      { label: "Window" },
      ...classes.map((key) => ({ label: key, align: "right" as const })),
      { label: "Reports", align: "right" },
    ],
    rows: mixes.map(({ label, mix }) => ({
      key: mix.dataset.id,
      cells: [
        label,
        rangeText(mix.range),
        ...classes.map((key) => {
          const part = mix.parts.find((item) => item.key === key);
          return part ? `${count(part.count)} (${percentText(part.share)})` : "0";
        }),
        count(mix.total),
      ],
    })),
  };
  return (
    <ChartCard
      title={title}
      subtitle="Enforcement report records by recall class · each family's selected window"
      status={
        mixes.length
          ? undefined
          : { kind: "empty", reason: "No class capture matches this exact window." }
      }
      table={mixes.length ? table : undefined}
      sources={sourcesOf(mixes.map(({ mix }) => mix.dataset))}
      about={
        <dl className="space-y-1.5">
          {Object.entries(RECALL_CLASS_MEANING).map(([key, meaning]) => (
            <div key={key}>
              <dt className="font-medium">{key}</dt>
              <dd className="m-0">{meaning}</dd>
            </div>
          ))}
        </dl>
      }
      actions={<SourceButton label="Recall classes" onClick={onSource} />}
      minHeight={160}
    >
      <div className="space-y-3.5">
        {mixes.map(({ label, mix }) => (
          <div key={mix.dataset.id}>
            <div className="mb-1 flex items-baseline justify-between gap-2 text-[12px]">
              <span className="font-medium text-foreground">{label}</span>
              <span className="tabular-nums text-muted-foreground">{count(mix.total)} reports</span>
            </div>
            <div
              className="flex h-3.5 w-full gap-[2px] overflow-hidden rounded-[3px]"
              role="img"
              aria-label={`${label}: ${mix.parts.map((part) => `${part.label} ${count(part.count)} (${percentText(part.share)})`).join(", ")}`}
            >
              {mix.parts.map((part) => (
                <span
                  key={part.key}
                  className="h-full first:rounded-l-[3px] last:rounded-r-[3px]"
                  style={{
                    width: `${Math.max(part.share, 0.6)}%`,
                    background: CLASS_FILL[part.key] ?? "var(--chart-base)",
                  }}
                  title={`${part.label}: ${count(part.count)} (${percentText(part.share)})`}
                />
              ))}
            </div>
            <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-meta tabular-nums text-muted-foreground">
              {mix.parts.map((part) => (
                <span key={part.key} className="inline-flex items-center gap-1">
                  <span
                    className="size-2 rounded-[2px]"
                    style={{ background: CLASS_FILL[part.key] ?? "var(--chart-base)" }}
                    aria-hidden
                  />
                  {part.label.replace("Not Yet Classified", "Not yet classified")}{" "}
                  {count(part.count)}{" "}
                  <span className="text-foreground/70">({percentText(part.share)})</span>
                </span>
              ))}
            </p>
          </div>
        ))}
        <div className="flex items-center gap-1.5 text-meta text-muted-foreground">
          <InfoPopover label="What the recall classes mean" title="FDA recall classes">
            <dl className="space-y-1.5">
              {Object.entries(RECALL_CLASS_MEANING).map(([key, meaning]) => (
                <div key={key}>
                  <dt className="font-medium">{key}</dt>
                  <dd className="m-0">{meaning}</dd>
                </div>
              ))}
            </dl>
          </InfoPopover>
          Class I is the most serious: a reasonable chance of serious harm or death.
        </div>
      </div>
    </ChartCard>
  );
}

/** Each dataset's selected window against the equal window before it. */
export function MoversCard({
  movers,
  onSource,
}: {
  movers: readonly FdaMover[];
  onSource: () => void;
}) {
  const ranked = [...movers].sort((a, b) => {
    if (a.percent === null) return 1;
    if (b.percent === null) return -1;
    return b.percent - a.percent;
  });
  const top = ranked.find((mover) => mover.percent !== null);
  const bottom = [...ranked].reverse().find((mover) => mover.percent !== null);
  const title =
    top && bottom && top !== bottom
      ? `${top.label} changed most upward (${signedPercent(top.percent)}); ${bottom.label} ${bottom.percent! < 0 ? "fell most" : "rose least"} (${signedPercent(bottom.percent)})`
      : "Change against the prior window";
  const table: TableSpec = {
    caption: "Selected window against the equal window just before it.",
    columns: [
      { label: "Dataset" },
      { label: "Window" },
      { label: "Count", align: "right" },
      { label: "Prior window", align: "right" },
      { label: "Change", align: "right" },
    ],
    rows: ranked.map((mover) => ({
      key: mover.id,
      muted: mover.percent === null,
      cells: [
        mover.label,
        rangeText(mover.range),
        count(mover.current),
        count(mover.previous),
        signedPercent(mover.percent) ?? "Not recorded",
      ],
    })),
  };
  return (
    <ChartCard
      title={title}
      subtitle="Percent change · selected window vs the same number of days before it"
      table={table}
      about={
        <p>
          Each dataset is compared over windows ending at its own latest complete date. A change is
          left out when either window is not fully captured or the prior count is zero.
        </p>
      }
      actions={<SourceButton label="Change against the prior window" onClick={onSource} />}
      minHeight={160}
    >
      <BarList
        ariaLabel="Percent change against the prior window"
        diverging
        labelWidth="42%"
        items={ranked.map((mover) => ({
          id: mover.id,
          label: mover.label,
          value: mover.percent === null ? null : Math.round(mover.percent * 10) / 10,
          display: signedPercent(mover.percent) ?? "Not recorded",
          note:
            mover.percent === null
              ? undefined
              : `${shortCount(mover.current)} vs ${shortCount(mover.previous)}`,
        }))}
      />
    </ChartCard>
  );
}

/** Tiles leading to datasets that have their own tab. */
export function DatasetTiles({
  items,
  interval,
  onOpen,
  heading,
}: {
  items: readonly (DatasetRef & { tab: string; tabLabel: string })[];
  interval: FdaGranularity;
  onOpen: (tab: string) => void;
  heading: ReactNode;
}) {
  if (!items.length) return null;
  return (
    <section aria-label="More FDA datasets" className="space-y-2">
      <h2 className="px-1 text-label font-semibold text-foreground">{heading}</h2>
      <KpiGrid columns={items.length >= 5 ? 5 : 4}>
        {items.map(({ dataset, label, range, tab, tabLabel }) => {
          const cell = kpiCell(dataset, label, range, interval, () => onOpen(tab));
          const { key: _key, ...props } = cell;
          return (
            <KpiCard
              key={dataset.id}
              as="li"
              size="sm"
              {...props}
              action={
                <button
                  type="button"
                  onClick={() => onOpen(tab)}
                  className="inline-flex min-h-8 items-center gap-1 rounded-md px-1.5 text-meta font-medium text-primary hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
                  aria-label={`Open the ${tabLabel} tab`}
                >
                  {tabLabel}
                  <ArrowRight className="size-3" aria-hidden />
                </button>
              }
            />
          );
        })}
      </KpiGrid>
    </section>
  );
}
