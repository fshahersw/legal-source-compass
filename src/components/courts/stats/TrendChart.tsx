import { useId, useMemo, useState, type ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { FDA_COLORS } from "@/components/fda-analytics/chartView";
import { numTick } from "@/components/enforcement/listDisplay";
import { axisTick, tooltipStyle } from "@/components/enforcement/parts";
import { ChartLegend } from "@/components/courts/caseload/CaseloadCharts";
import type { UstUnit } from "@/lib/external/uscourtsTables.functions";
import { cn } from "@/lib/utils";
import {
  chartRows,
  latest,
  periodEndText,
  periodHeader,
  periodShort,
  valueText,
  type PeriodMode,
  type TrendSeries,
} from "./trendsModel";

const NATIONAL_COLOR = "var(--muted-foreground)";
const LINE_COLORS = [
  FDA_COLORS[0]!,
  FDA_COLORS[2]!,
  FDA_COLORS[1]!,
  FDA_COLORS[3]!,
  FDA_COLORS[4]!,
];

export type SourceRef = { label: string; href: string | null };

export type TrendChartProps = {
  /** What is counted, as a heading: "Civil cases filed, terminated and pending". */
  title: string;
  /** Unit sentence under the title: "Cases, 12-month periods". */
  unitText: string;
  /** "S.D.N.Y." in the accessible description. */
  subject: string;
  unit: UstUnit;
  decimals: number | null;
  series: readonly TrendSeries[];
  mode: PeriodMode;
  /** Length of each plotted period: 12 (default), 3 for a quarter, 0 for a count of cases as of a date. */
  months?: number;
  /** The table behind the chart, with a link to its latest period page. */
  sources: readonly SourceRef[];
  /** "How to read this": rates versus counts, overlapping windows, breaks in the series. */
  howToRead?: ReactNode;
  /** Break notes inside the plotted window. */
  breaks?: readonly { end: string; kind: string; detail: string }[];
  /** Footnotes the publisher attached to this court's row or to a plotted column heading, with the period ends they apply to. */
  footnotes?: readonly { text: string; ends: string[]; column: string | null }[];
  /** The table's own footnote lines for the latest plotted period. */
  tableNotes?: readonly string[];
  /** Publication of each period end ("JB", "STFJ · PDF"); shown in the data table, and PDF-read periods are counted under the chart. */
  periodSources?: Readonly<Record<string, string>>;
  className?: string;
};

function colorFor(s: TrendSeries, index: number) {
  return s.dashed ? NATIONAL_COLOR : LINE_COLORS[index % LINE_COLORS.length]!;
}

const BREAK_NAMES: Record<string, string> = {
  heading: "column headings reworded",
  columns: "columns added or removed",
  title: "table title reworded",
  notes: "footnote wording",
};

/** Where the published table changed its columns, headings, title or footnote wording: one line, details on demand. */
function SeriesNotes({
  breaks,
}: {
  breaks: readonly { end: string; kind: string; detail: string }[];
}) {
  const kinds = [...new Set(breaks.map((b) => b.kind))].map((k) => BREAK_NAMES[k] ?? k);
  return (
    <details className="mt-1 text-muted-foreground">
      <summary className="cursor-pointer hover:underline">
        <span className="font-medium text-foreground">Series notes:</span> the published table
        changed at {breaks.length} {breaks.length === 1 ? "period" : "periods"} ({kinds.join(", ")})
      </summary>
      <ul className="mt-0.5 list-none space-y-0.5">
        {breaks.map((b) => (
          <li key={`${b.end}${b.kind}`}>
            <span className="font-mono text-foreground">{b.end}</span> {b.detail}
          </li>
        ))}
      </ul>
    </details>
  );
}

/** One line chart of published statistics, with legend, latest values, an accessible data table and its sources. */
export function TrendChart(props: TrendChartProps) {
  const {
    title,
    unitText,
    subject,
    unit,
    decimals,
    series,
    mode,
    months = 12,
    sources,
    howToRead,
    breaks,
    footnotes,
    tableNotes,
    periodSources,
    className,
  } = props;
  const rows = useMemo(() => chartRows(series, mode), [series, mode]);
  const pdfEnds = rows.filter((r) => periodSources?.[r.end]?.endsWith("PDF")).map((r) => r.end);
  const [showData, setShowData] = useState(false);
  const tableId = useId();
  const plotted = series.filter((s) => s.points.some((p) => p.value != null));
  const first = rows[0]?.end;
  const last = rows.at(-1)?.end;
  const latestLine = plotted
    .map((s) => {
      const p = latest(s.points);
      return p ? { s, p } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x != null);
  const sparse = rows.length <= 12;
  return (
    <figure
      className={cn("min-w-0 rounded-md border border-border bg-surface", className)}
      aria-label={title}
    >
      <figcaption className="border-b border-border/60 px-3 py-2">
        <h4 className="text-xs font-semibold leading-4">{title}</h4>
        <p className="text-[11px] leading-4 text-muted-foreground">
          {unitText}
          {first && last
            ? ` · ${months === 0 ? "as of" : "periods ending"} ${first} to ${last}`
            : ""}
        </p>
      </figcaption>
      {plotted.length === 0 ? (
        <p className="px-3 py-6 text-xs text-muted-foreground" role="status">
          Not recorded: the source tables hold no value for this measure.
        </p>
      ) : (
        <>
          <ChartLegend
            items={plotted.map((s) => ({
              label: s.label,
              color: colorFor(s, series.indexOf(s)),
              dashed: s.dashed ?? false,
            }))}
          />
          <div
            className="h-48 p-2"
            role="img"
            aria-label={`Lines of ${title.toLowerCase()} for ${subject}, ${rows.length} periods from ${first ?? ""} to ${last ?? ""}. A gap means the value is not recorded.`}
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={rows} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                <XAxis
                  dataKey="label"
                  tick={axisTick}
                  interval="preserveStartEnd"
                  minTickGap={18}
                />
                <YAxis
                  tick={axisTick}
                  tickFormatter={unit === "percent" ? (v: number) => `${v}%` : numTick}
                  width={unit === "percent" ? 54 : 46}
                  domain={[0, "auto"]}
                />
                <Tooltip
                  content={(p) => {
                    const row = (p.payload?.[0]?.payload ?? null) as (typeof rows)[number] | null;
                    if (!p.active || !row) return null;
                    return (
                      <div
                        className="rounded-md border border-border bg-surface text-foreground shadow-sm"
                        style={tooltipStyle}
                      >
                        <p className="font-medium">{periodEndText(String(row.end), months)}</p>
                        {plotted.map((s, i) => (
                          <p key={s.id} className="flex items-center gap-1.5">
                            <span
                              aria-hidden
                              className="size-2 rounded-sm"
                              style={{ background: colorFor(s, i) }}
                            />
                            <span className="text-muted-foreground">{s.label}</span>
                            <span className="ml-auto pl-3 font-mono">
                              {valueText(
                                row[s.id] as number | null,
                                unit,
                                decimals,
                                row[`${s.id}__dash`] === true,
                              )}
                            </span>
                          </p>
                        ))}
                      </div>
                    );
                  }}
                />
                {plotted.map((s, i) => (
                  <Line
                    key={s.id}
                    dataKey={s.id}
                    name={s.label}
                    stroke={colorFor(s, i)}
                    strokeWidth={s.dashed ? 1.5 : 2}
                    strokeDasharray={s.dashed ? "4 3" : undefined}
                    dot={sparse ? { r: 2 } : false}
                    activeDot={{ r: 3 }}
                    isAnimationActive={false}
                    connectNulls={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
          {latestLine.length ? (
            <ul className="flex flex-wrap gap-x-4 gap-y-0.5 border-t border-border/60 px-3 py-1.5 text-[11px]">
              {latestLine.map(({ s, p }) => (
                <li key={s.id} className="text-muted-foreground">
                  {s.label}:{" "}
                  <span className="font-mono text-foreground">
                    {valueText(p.value, unit, decimals)}
                  </span>{" "}
                  <span>({periodShort(p.end, months)})</span>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}
      <div className="border-t border-border/60 px-3 py-1.5 text-[11px] leading-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {plotted.length ? (
            <button
              type="button"
              aria-expanded={showData}
              aria-controls={tableId}
              onClick={() => setShowData((v) => !v)}
              className="rounded text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
            >
              {showData ? "Hide data" : "Show data"}
            </button>
          ) : null}
          <span className="text-muted-foreground">Source:</span>
          {sources.map((s) =>
            s.href ? (
              <a
                key={s.label}
                href={s.href}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-0.5 text-primary hover:underline"
              >
                {s.label}
                <ExternalLink className="size-3" aria-hidden />
              </a>
            ) : (
              <span key={s.label}>{s.label}</span>
            ),
          )}
        </div>
        {pdfEnds.length ? (
          <p className="mt-1 text-muted-foreground">
            {pdfEnds.length} {pdfEnds.length === 1 ? "period" : "periods"} ({pdfEnds[0]}
            {pdfEnds.length > 1 ? ` to ${pdfEnds.at(-1)}` : ""}) read from the published PDF; their
            footnotes are not transcribed.
          </p>
        ) : null}
        {howToRead ? <p className="mt-1 text-muted-foreground">{howToRead}</p> : null}
        {breaks?.length ? <SeriesNotes breaks={breaks} /> : null}
        {footnotes?.length ? (
          <ul className="mt-1 space-y-0.5 text-muted-foreground">
            {footnotes.map((n) => (
              <li key={`${n.column ?? ""}${n.text}`}>
                <span className="font-medium text-foreground">
                  {n.column
                    ? `Footnote on the column "${n.column}"`
                    : "Footnote on this court's row"}
                </span>{" "}
                (
                {n.ends.length === 1
                  ? n.ends[0]
                  : `${n.ends[0]} to ${n.ends.at(-1)}, ${n.ends.length} periods`}
                ): {n.text}
              </li>
            ))}
          </ul>
        ) : null}
        {tableNotes?.length ? (
          <details className="mt-1 text-muted-foreground">
            <summary className="cursor-pointer text-foreground hover:underline">
              Table notes as published
            </summary>
            <ul className="mt-0.5 list-none space-y-0.5">
              {tableNotes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </details>
        ) : null}
        {showData ? (
          <div
            id={tableId}
            className="mt-1.5 max-h-56 overflow-auto rounded border border-border"
            tabIndex={0}
            role="region"
            aria-label={`${title}: data table`}
          >
            <table className="w-full min-w-max border-collapse text-[11px]">
              <thead className="sticky top-0 bg-muted text-left">
                <tr>
                  <th scope="col" className="px-2 py-1 font-medium">
                    {periodHeader(months)}
                  </th>
                  {plotted.map((s) => (
                    <th key={s.id} scope="col" className="px-2 py-1 text-right font-medium">
                      {s.label}
                    </th>
                  ))}
                  {periodSources ? (
                    <th scope="col" className="px-2 py-1 font-medium">
                      Publication
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {[...rows].reverse().map((r) => (
                  <tr key={r.end} className="border-t border-border/60">
                    <th scope="row" className="px-2 py-0.5 text-left font-normal">
                      {r.end}
                    </th>
                    {plotted.map((s) => (
                      <td key={s.id} className="px-2 py-0.5 text-right font-mono">
                        {valueText(
                          r[s.id] as number | null,
                          unit,
                          decimals,
                          r[`${s.id}__dash`] === true,
                        )}
                      </td>
                    ))}
                    {periodSources ? (
                      <td className="px-2 py-0.5 text-muted-foreground">
                        {periodSources[r.end] ?? ""}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </figure>
  );
}
