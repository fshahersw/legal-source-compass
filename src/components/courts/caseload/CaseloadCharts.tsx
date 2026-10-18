import { useId, type ReactNode } from "react";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { FDA_COLORS } from "@/components/fda-analytics/chartView";
import { numTick } from "@/components/enforcement/listDisplay";
import { axisTick, tooltipStyle } from "@/components/enforcement/parts";
import type { CaseloadYear } from "@/lib/external/courtCaseload.functions";
import { int } from "@/components/analysis/analysisFormat";
import { days, fyLabel, medianRows, NOT_RECORDED, partialText, volumeRows } from "./caseloadFormat";

const COLOR = {
  filed: FDA_COLORS[0],
  terminated: FDA_COLORS[2],
  pending: FDA_COLORS[1],
  median: FDA_COLORS[1],
  national: FDA_COLORS[5],
};

type TipLine = { name: string; color: string; text: string };

/** Tooltip built from the row's own values, so a dashed partial-year series never appears twice. */
function RowTip<R>({
  active,
  payload,
  tip,
}: {
  active?: boolean | undefined;
  payload?: ReadonlyArray<{ payload?: unknown }> | undefined;
  tip: (row: R) => { title: string; lines: TipLine[] } | null;
}) {
  const row = payload?.[0]?.payload as R | undefined;
  if (!active || !row) return null;
  const built = tip(row);
  if (!built) return null;
  return (
    <div
      className="rounded-md border border-border bg-surface text-foreground shadow-sm"
      style={tooltipStyle}
    >
      <p className="font-medium">{built.title}</p>
      {built.lines.map((l) => (
        <p key={l.name} className="flex items-center gap-1.5">
          <span aria-hidden className="size-2 rounded-sm" style={{ background: l.color }} />
          <span className="text-muted-foreground">{l.name}</span>
          <span className="ml-auto pl-3 font-mono">{l.text}</span>
        </p>
      ))}
    </div>
  );
}

export function ChartLegend({
  items,
  note,
}: {
  items: { label: string; color: string; dashed?: boolean; band?: boolean }[];
  note?: ReactNode;
}) {
  return (
    <ul className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 pt-2 text-[11px]">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5">
          {i.band ? (
            <span
              aria-hidden
              className="inline-block h-2.5 w-4 rounded-sm"
              style={{ background: i.color, opacity: 0.25 }}
            />
          ) : (
            <span
              aria-hidden
              className="inline-block h-0 w-4 border-t-2"
              style={{ borderColor: i.color, borderTopStyle: i.dashed ? "dashed" : "solid" }}
            />
          )}
          <span className="text-muted-foreground">{i.label}</span>
        </li>
      ))}
      {note ? <li className="text-muted-foreground">{note}</li> : null}
    </ul>
  );
}

function hatchDefs(id: string) {
  return (
    <defs>
      <pattern
        id={id}
        width="6"
        height="6"
        patternUnits="userSpaceOnUse"
        patternTransform="rotate(45)"
      >
        <rect width="6" height="6" fill="var(--muted)" fillOpacity={0.5} />
        <line x1="0" y1="0" x2="0" y2="6" stroke="var(--muted-foreground)" strokeWidth="1" />
      </pattern>
    </defs>
  );
}

const MARGIN = { top: 8, right: 12, left: 4, bottom: 0 };

/** Filed, terminated and pending at the year end, one line each; the fiscal year in progress is a dashed hop with a hatched band. */
export function VolumeChart({
  years,
  subject,
  showPending = true,
  through = null,
}: {
  years: readonly CaseloadYear[];
  /** "N.D. California" in the accessible description. */
  subject: string;
  showPending?: boolean;
  /** ISO date the partial fiscal year runs through, when recorded. */
  through?: string | null;
}) {
  const hatch = `hatch-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const rows = volumeRows(years);
  const partial = years.find((y) => y.partial);
  const last = [...years].reverse().find((y) => !y.partial);
  return (
    <div>
      <ChartLegend
        items={[
          { label: "Filed", color: COLOR.filed! },
          { label: "Terminated", color: COLOR.terminated! },
          ...(showPending ? [{ label: "Pending at year end", color: COLOR.pending! }] : []),
        ]}
        note={
          partial ? (
            <>
              Dashed and hatched: {fyLabel(partial.fy)} so far ({partialText(through)})
            </>
          ) : null
        }
      />
      <div
        className="h-60 p-2"
        role="img"
        aria-label={`Lines of civil cases filed, terminated${showPending ? " and pending at year end" : ""} per fiscal year for ${subject}, ${years[0] ? `FY${years[0].fy}` : ""} to ${years.at(-1) ? `FY${years.at(-1)!.fy}` : ""}${partial ? `; FY${partial.fy} is a partial year` : ""}`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={MARGIN}>
            {hatchDefs(hatch)}
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
            <XAxis dataKey="label" tick={axisTick} interval="preserveStartEnd" minTickGap={16} />
            <YAxis tick={axisTick} tickFormatter={numTick} width={48} />
            {partial && last ? (
              <ReferenceArea
                x1={String(last.fy)}
                x2={`${partial.fy}*`}
                fill={`url(#${hatch})`}
                stroke="none"
                ifOverflow="visible"
              />
            ) : null}
            <Tooltip
              content={(p) => (
                <RowTip
                  active={p.active}
                  payload={p.payload}
                  tip={(row: (typeof rows)[number]) => {
                    const y = years.find((v) => v.fy === row.fy);
                    if (!y) return null;
                    return {
                      title: y.partial
                        ? `${fyLabel(y.fy)} (${partialText(through)})`
                        : fyLabel(y.fy),
                      lines: [
                        {
                          name: "Filed",
                          color: COLOR.filed!,
                          text: y.filings == null ? NOT_RECORDED : int(y.filings),
                        },
                        {
                          name: "Terminated",
                          color: COLOR.terminated!,
                          text: y.terminations == null ? NOT_RECORDED : int(y.terminations),
                        },
                        ...(showPending
                          ? [
                              {
                                name: "Pending",
                                color: COLOR.pending!,
                                text: y.pendingEnd == null ? NOT_RECORDED : int(y.pendingEnd),
                              },
                            ]
                          : []),
                      ],
                    };
                  }}
                />
              )}
            />
            {(
              [
                ["filings", COLOR.filed],
                ["terminations", COLOR.terminated],
                ...(showPending ? [["pending", COLOR.pending]] : []),
              ] as [string, string][]
            ).map(([key, stroke]) => (
              <Line
                key={key}
                dataKey={key}
                stroke={stroke}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
                connectNulls={false}
              />
            ))}
            {(
              [
                ["filingsPartial", COLOR.filed],
                ["terminationsPartial", COLOR.terminated],
                ...(showPending ? [["pendingPartial", COLOR.pending]] : []),
              ] as [string, string][]
            ).map(([key, stroke]) => (
              <Line
                key={key}
                dataKey={key}
                stroke={stroke}
                strokeWidth={2}
                strokeDasharray="4 3"
                dot={false}
                activeDot={false}
                isAnimationActive={false}
                connectNulls={false}
                legendType="none"
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** Median days to termination with the middle-half (p25 to p75) band where the three values are recorded and ordered. */
export function MedianChart({
  years,
  nationalYears,
  subject,
  through = null,
}: {
  years: readonly CaseloadYear[];
  nationalYears?: readonly CaseloadYear[] | undefined;
  subject: string;
  through?: string | null;
}) {
  const hatch = `hatch-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const rows = medianRows(years, nationalYears ?? []);
  const partial = years.find((y) => y.partial);
  const last = [...years].reverse().find((y) => !y.partial);
  const anyBand = rows.some((r) => r.band);
  const anyNational = rows.some((r) => r.national != null);
  return (
    <div>
      <ChartLegend
        items={[
          { label: "Median", color: COLOR.median! },
          ...(anyBand
            ? [
                {
                  label: "Middle half of cases (25th to 75th percentile)",
                  color: COLOR.median!,
                  band: true,
                },
              ]
            : []),
          ...(anyNational
            ? [{ label: "National median", color: COLOR.national!, dashed: true }]
            : []),
        ]}
        note={
          partial ? (
            <>
              Dashed and hatched: {fyLabel(partial.fy)} so far ({partialText(through)}); cases
              terminated to date
            </>
          ) : null
        }
      />
      <div
        className="h-60 p-2"
        role="img"
        aria-label={`Line of median days from filing to termination per fiscal year for ${subject}${anyBand ? ", with the 25th to 75th percentile band" : ""}${anyNational ? " and the national median" : ""}`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={MARGIN}>
            {hatchDefs(hatch)}
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
            <XAxis dataKey="label" tick={axisTick} interval="preserveStartEnd" minTickGap={16} />
            <YAxis tick={axisTick} tickFormatter={numTick} width={48} domain={[0, "auto"]} />
            {partial && last ? (
              <ReferenceArea
                x1={String(last.fy)}
                x2={`${partial.fy}*`}
                fill={`url(#${hatch})`}
                stroke="none"
                ifOverflow="visible"
              />
            ) : null}
            <Tooltip
              content={(p) => (
                <RowTip
                  active={p.active}
                  payload={p.payload}
                  tip={(row: (typeof rows)[number]) => ({
                    title: row.partial
                      ? `${fyLabel(row.fy)} (${partialText(through)})`
                      : fyLabel(row.fy),
                    lines: [
                      {
                        name: "Median",
                        color: COLOR.median!,
                        text: days(years.find((y) => y.fy === row.fy)?.medianDays ?? null),
                      },
                      {
                        name: "25th percentile",
                        color: COLOR.median!,
                        text: row.p25 == null ? NOT_RECORDED : days(row.p25),
                      },
                      {
                        name: "75th percentile",
                        color: COLOR.median!,
                        text: row.p75 == null ? NOT_RECORDED : days(row.p75),
                      },
                      ...(anyNational
                        ? [
                            {
                              name: "National median",
                              color: COLOR.national!,
                              text: row.national == null ? NOT_RECORDED : days(row.national),
                            },
                          ]
                        : []),
                    ],
                  })}
                />
              )}
            />
            {anyBand ? (
              <Area
                dataKey="band"
                stroke="none"
                fill={COLOR.median}
                fillOpacity={0.16}
                isAnimationActive={false}
                connectNulls={false}
                legendType="none"
                activeDot={false}
              />
            ) : null}
            {anyNational ? (
              <Line
                dataKey="national"
                stroke={COLOR.national}
                strokeWidth={1.5}
                strokeDasharray="2 3"
                dot={false}
                activeDot={false}
                isAnimationActive={false}
                connectNulls={false}
              />
            ) : null}
            <Line
              dataKey="median"
              stroke={COLOR.median}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
              connectNulls={false}
            />
            <Line
              dataKey="medianPartial"
              stroke={COLOR.median}
              strokeWidth={2}
              strokeDasharray="4 3"
              dot={false}
              activeDot={false}
              isAnimationActive={false}
              connectNulls={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** Cases per fiscal year as bars; a fiscal year in progress is drawn at half strength and starred. */
export function CountBars({
  data,
  noun,
  subject,
}: {
  data: readonly { fy: number; value: number; partial: boolean }[];
  noun: string;
  subject: string;
}) {
  const rows = data.map((d) => ({ ...d, label: d.partial ? `${d.fy}*` : String(d.fy) }));
  return (
    <div
      className="h-48 p-2"
      role="img"
      aria-label={`Bars of ${noun} per fiscal year for ${subject}`}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={MARGIN}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
          <XAxis dataKey="label" tick={axisTick} interval="preserveStartEnd" minTickGap={12} />
          <YAxis tick={axisTick} tickFormatter={numTick} width={44} allowDecimals={false} />
          <Tooltip
            contentStyle={tooltipStyle}
            formatter={(v) => [int(Number(v)), noun]}
            labelFormatter={(l) =>
              String(l).endsWith("*") ? `FY${String(l)} (partial year)` : `FY${String(l)}`
            }
          />
          <Bar dataKey="value" name={noun} fill={COLOR.filed} isAnimationActive={false}>
            {rows.map((r) => (
              <Cell key={r.fy} fillOpacity={r.partial ? 0.5 : 1} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
