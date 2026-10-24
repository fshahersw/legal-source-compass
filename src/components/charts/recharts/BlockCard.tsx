/**
 * A chart card for one analytics trend block (`getAnalyticsBlock` ids from src/lib/analytics/registry.ts: "federal-civil",
 * "cpsc-recalls", "doj-press" …): fetched on its own, with loading, error (retry), empty and partial states, a takeaway
 * title computed from the primary series, the latest value and change as a KPI, partial periods dashed or hatched,
 * the block's reporting-change markers labelled, notes in the About popover and the table view.
 */
import { useQuery } from "@tanstack/react-query";
import { analyticsBlockQuery } from "@/components/analytics/hub/blockQuery";
import { blockDef } from "@/lib/analytics/registry";
import { ChartCard } from "../ChartCard";
import { blockChart } from "./blocks";
import { TrendColumns, TrendLines } from "./charts";

export function BlockCard({
  id,
  subject,
  form = "auto",
  height = 220,
  className,
  headingLevel = "h3",
}: {
  id: string;
  /** Subject of the takeaway sentence (default: the primary series' label). */
  subject?: string | undefined;
  /** Force lines or columns (default: what the block asks for). */
  form?: "auto" | "line" | "bar";
  height?: number;
  className?: string | undefined;
  headingLevel?: "h2" | "h3" | "h4";
}) {
  const def = blockDef(id);
  const q = useQuery(analyticsBlockQuery(id));
  const title = def?.title ?? id;
  if (q.isLoading)
    return (
      <ChartCard
        title={title}
        status={{ kind: "loading" }}
        minHeight={height}
        className={className}
        headingLevel={headingLevel}
      />
    );
  if (q.isError || !q.data)
    return (
      <ChartCard
        title={title}
        status={{ kind: "error", onRetry: () => void q.refetch() }}
        className={className}
        headingLevel={headingLevel}
      />
    );
  if (q.data.status === "empty")
    return (
      <ChartCard
        title={title}
        status={{ kind: "empty", reason: q.data.reason }}
        className={className}
        headingLevel={headingLevel}
      />
    );
  const data = q.data.data;
  const c = blockChart(data, def ?? { title, measure: data.unit }, subject);
  const bars = form === "bar" || (form === "auto" && data.chart === "bar");
  return (
    <ChartCard
      title={c.title}
      subtitle={c.subtitle}
      kpis={
        c.latest
          ? [
              {
                label: c.latest.label,
                value: c.latest.value,
                detail: c.latest.change ?? undefined,
              },
            ]
          : undefined
      }
      table={c.table}
      sources={[c.source]}
      period={data.period}
      asOf={data.asOf ?? undefined}
      partial={
        c.hasPartial
          ? "* The last period was still in progress when the data was taken; it is drawn dashed or hatched and never compared."
          : undefined
      }
      about={
        data.notes.length ? (
          <ul>
            {data.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        ) : undefined
      }
      className={className}
      headingLevel={headingLevel}
    >
      {bars ? (
        <TrendColumns
          rows={c.rows}
          xKey={c.xKey}
          series={c.series}
          stacked={data.stacked}
          format={c.format}
          tick={c.tick}
          xTick={c.xTick}
          tooltipTitle={c.tooltipTitle}
          partialKey={c.partialKey}
          height={height}
          ariaLabel={`${title}, ${data.period}`}
        />
      ) : (
        <TrendLines
          rows={c.rows}
          xKey={c.xKey}
          series={c.series}
          format={c.format}
          tick={c.tick}
          xTick={c.xTick}
          tooltipTitle={c.tooltipTitle}
          partialKey={c.partialKey}
          markers={data.markers.map((m) => ({ x: m.x, label: m.label }))}
          height={height}
          ariaLabel={`${title}, ${data.period}`}
        />
      )}
    </ChartCard>
  );
}
