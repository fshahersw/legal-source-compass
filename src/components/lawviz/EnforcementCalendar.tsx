/**
 * Enforcement calendar: daily counts of Federal Register documents, recalls, SEC releases, FTC early-termination
 * notices and Justice Department press releases, one small calendar per series for the chosen agency and year, plus a
 * years × months overview (the kit's Heatmap with calendarMatrix). Inside a series' coverage a day with no record is 0;
 * outside it the day is hatched as not recorded. Data: lawviz_calendar_v1 (precomputed daily counts).
 */
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { ChartCanvas, type TipSpec } from "@/components/charts/canvas";
import { ChartFrame, type ChartStatus, type TableSpec } from "@/components/charts/ChartFrame";
import { metricFormatter } from "@/components/charts/format";
import { Heatmap, calendarMatrix } from "@/components/charts/Heatmap";
import { Segmented } from "@/components/enforcement/parts";
import {
  AGENCIES,
  MONTHS,
  WEEKDAYS,
  breakLabels,
  classOf,
  countBreaks,
  longDay,
  monthPoints,
  yearGrid,
  yearsOf,
  type AgencyId,
  type CalendarData,
  type Series,
} from "@/lib/lawviz/calendar";
import { getEnforcementCalendar } from "@/lib/lawviz/lawviz.functions";
import { HatchSwatch, Notice, RampLegend } from "./parts";
import { builtLabel, fmtDate, fmtInt } from "./format";
import { RAMP, ZERO_FILL, rampStep } from "./ramp";

const control =
  "h-8 rounded-md border border-input bg-background px-2 text-xs focus-visible:outline-2 focus-visible:outline-ring";
const count = metricFormatter("count");
type CalendarOk = Extract<CalendarData, { status: "ok" }>;

function DayGrid({
  year,
  series,
  days,
}: {
  year: number;
  series: Series;
  days: Record<string, number> | undefined;
}) {
  const grid = useMemo(() => yearGrid(year, series, days), [year, series, days]);
  const breaks = useMemo(() => countBreaks(grid.map((c) => c.value ?? 0)), [grid]);
  const [active, setActive] = useState<number | null>(null);
  const weeks = Math.max(...grid.map((c) => c.week)) + 1;
  const describe = (i: number) => {
    const c = grid[i]!;
    return `${longDay(c.date)}: ${c.value === null ? "not recorded" : `${fmtInt(c.value)} ${series.unit}`}.`;
  };
  const fill = (v: number | null, hatch: string) =>
    v === null
      ? `url(#${hatch})`
      : v === 0
        ? ZERO_FILL
        : RAMP[rampStep(classOf(v, breaks), breaks.length)];
  const hatchId = `h-${series.id}-${year}`;
  return (
    <div className="space-y-1">
      <ChartCanvas
        height={7 * 13 + 16}
        ariaLabel={`${series.label}, ${year}, one cell per day.`}
        count={grid.length}
        active={active}
        onActive={setActive}
        describe={describe}
      >
        {(w) => {
          const left = 28;
          const cell = Math.max(6, Math.min(13, Math.floor((w - left - 2) / weeks)));
          const top = 14;
          const monthStarts = MONTHS.map((m, i) => {
            const first = grid.find((c) => c.date.slice(5, 7) === String(i + 1).padStart(2, "0"));
            return { m, x: left + (first?.week ?? 0) * cell };
          });
          const marks = (
            <g>
              <defs>
                <pattern
                  id={hatchId}
                  width="4"
                  height="4"
                  patternUnits="userSpaceOnUse"
                  patternTransform="rotate(45)"
                >
                  <rect width="4" height="4" fill="var(--muted)" />
                  <line
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="4"
                    stroke="var(--chart-axis)"
                    strokeOpacity={0.45}
                  />
                </pattern>
              </defs>
              {monthStarts.map((m) => (
                <text key={m.m} x={m.x} y={10} fontSize={9.5} fill="var(--chart-axis)">
                  {m.m}
                </text>
              ))}
              {WEEKDAYS.map((d, i) =>
                i % 2 === 0 ? (
                  <text
                    key={d}
                    x={0}
                    y={top + i * cell + cell / 2}
                    dy="0.32em"
                    fontSize={9.5}
                    fill="var(--chart-axis)"
                  >
                    {d}
                  </text>
                ) : null,
              )}
              {grid.map((c, i) => (
                <rect
                  key={c.date}
                  x={left + c.week * cell + 0.5}
                  y={top + c.weekday * cell + 0.5}
                  width={cell - 1.5}
                  height={cell - 1.5}
                  rx={1.5}
                  fill={fill(c.value, hatchId)}
                  stroke={active === i ? "var(--chart-ink)" : "none"}
                  strokeWidth={1.5}
                  onPointerEnter={() => setActive(i)}
                  onPointerLeave={() => setActive(null)}
                />
              ))}
            </g>
          );
          const a = active !== null ? grid[active] : undefined;
          const tooltip: TipSpec | null = a
            ? {
                x: left + a.week * cell + cell / 2,
                y: top + a.weekday * cell + cell,
                content: {
                  title: longDay(a.date),
                  subtitle: series.label,
                  rows: [
                    {
                      key: "v",
                      label: a.value === null ? "" : series.unit,
                      value:
                        a.value === null ? "Not recorded" : a.value === 0 ? "0" : fmtInt(a.value),
                    },
                  ],
                  footer:
                    a.value === null
                      ? series.first
                        ? `Outside this collection's coverage (${fmtDate(series.first)} – ${fmtDate(series.last)})`
                        : "This collection has no dated records"
                      : a.value === 0
                        ? "No record in this collection is dated this day"
                        : undefined,
                },
              }
            : null;
          return { marks, tooltip };
        }}
      </ChartCanvas>
      {breaks.length ? (
        <RampLegend
          title={`${series.unit[0]!.toUpperCase()}${series.unit.slice(1)} per day`}
          labels={breakLabels(breaks)}
          steps={breaks.map((_, i) => rampStep(i, breaks.length))}
          zeroLabel="0"
        />
      ) : null}
    </div>
  );
}

export function EnforcementCalendar() {
  const fn = useServerFn(getEnforcementCalendar);
  const [agency, setAgency] = useState<AgencyId>("all");
  const [year, setYear] = useState<number>(() => new Date().getUTCFullYear());
  const [overviewSeries, setOverviewSeries] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ["lawviz-calendar", agency, year],
    queryFn: () => fn({ data: { agency, year } }),
    staleTime: 30 * 60_000,
    placeholderData: keepPreviousData,
  });
  const got: CalendarData | undefined = q.data;
  const data: CalendarOk | null = got && got.status === "ok" ? (got as CalendarOk) : null;
  const years = useMemo(() => (data ? yearsOf(data.series) : []), [data]);
  const overview = data?.series.find((s) => s.id === overviewSeries) ?? data?.series[0] ?? null;
  const status: ChartStatus = q.isLoading
    ? { kind: "loading" }
    : q.error
      ? { kind: "error", onRetry: () => void q.refetch() }
      : !q.data || q.data.status === "unavailable"
        ? {
            kind: "empty",
            reason:
              "The enforcement calendar is not available yet: its daily counts are computed in the database and have not been published.",
          }
        : q.data.status !== "ok" || !data?.series.length
          ? { kind: "empty", reason: "No dated records are collected for this agency." }
          : { kind: "ready" };
  const table: TableSpec | undefined = data
    ? {
        caption: `Records per month, ${year}`,
        columns: [
          { label: "Series", align: "left" },
          ...MONTHS.map((m) => ({ label: m })),
          { label: "Year" },
        ],
        rows: data.series.map((s) => {
          const grid = yearGrid(year, s, data.days[s.id]);
          const byMonth = MONTHS.map((_, i) => {
            const cells = grid.filter((c) => Number(c.date.slice(5, 7)) === i + 1);
            return cells.every((c) => c.value === null)
              ? null
              : cells.reduce((a, c) => a + (c.value ?? 0), 0);
          });
          const all = grid.every((c) => c.value === null)
            ? null
            : grid.reduce((a, c) => a + (c.value ?? 0), 0);
          return { key: s.id, cells: [s.label, ...byMonth.map((v) => fmtInt(v)), fmtInt(all)] };
        }),
      }
    : undefined;
  const sources = data
    ? [...new Map(data.series.map((s) => [s.sourceUrl ?? s.sourceLabel, s] as const)).values()]
        .filter((s) => s.sourceUrl)
        .map((s) => ({ label: s.sourceLabel, url: s.sourceUrl! }))
    : [{ label: "Federal Register", url: "https://www.federalregister.gov/" }];
  const undated = data?.series.filter((s) => s.undated > 0) ?? [];
  const points = overview ? monthPoints(overview, data?.months[overview.id]) : [];
  const matrix = calendarMatrix(points.map((p) => ({ key: p.key, value: p.value })));
  const partial = new Set(points.filter((p) => p.partial).map((p) => p.key));
  return (
    <section aria-labelledby="enforcement-calendar-title" className="space-y-2">
      <h2 id="enforcement-calendar-title" className="eyebrow">
        Enforcement calendar
      </h2>
      <div
        className="flex flex-wrap items-end gap-3"
        role="group"
        aria-label="Filter the enforcement calendar"
      >
        <div className="flex flex-col gap-0.5 text-[11px] text-muted-foreground">
          Agency
          <Segmented
            label="Agency"
            value={agency}
            options={AGENCIES.map((a) => ({ id: a.id, label: a.label }))}
            onChange={(a) => {
              setAgency(a);
              setOverviewSeries(null);
            }}
          />
        </div>
        <label className="flex flex-col gap-0.5 text-[11px] text-muted-foreground">
          Year
          <select
            className={control}
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            disabled={!years.length}
          >
            {(years.length ? years : [year]).map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
      </div>
      <ChartFrame
        title={`Daily events, ${year}`}
        unit="records per day"
        period={String(year)}
        sources={sources}
        status={status}
        table={table}
        minHeight={240}
        asOf={builtLabel(q.data?.builtAt ?? null)}
        partialNotice={
          [
            data?.dropped
              ? `${fmtInt(data.dropped)} stored rows could not be read and are left out.`
              : null,
            undated.length
              ? `Not dated, so not drawn: ${undated.map((s) => `${fmtInt(s.undated)} ${s.unit} (${s.label})`).join("; ")}.`
              : null,
          ]
            .filter(Boolean)
            .join(" ") || undefined
        }
        notes={[
          "One cell per day, weeks in columns (Monday at the top). Each series has its own colour classes, taken from that year's non-zero days, so compare series by their counts, not their shades.",
          "Inside a collection's coverage (its first to its last dated record) a day without a record is 0; outside it the day is hatched as not recorded. FDA entries are dated by the weekly Enforcement Report; Federal Register documents by publication day.",
          "A record is counted once on its own date: a Federal Register document listing two agencies counts in both agencies' series.",
        ]}
      >
        {data ? (
          <div className="space-y-4 pb-2">
            {data.series.map((s) => {
              const n = Object.entries(data.days[s.id] ?? {}).reduce(
                (a, [d, v]) => (d.startsWith(String(year)) ? a + v : a),
                0,
              );
              return (
                <div key={s.id} className="space-y-1">
                  <p className="m-0 flex flex-wrap items-baseline justify-between gap-x-3 text-[12px]">
                    <span className="font-medium">{s.label}</span>
                    <span className="text-[11px] text-muted-foreground">
                      {s.first ? (
                        <>
                          {fmtInt(n)} {s.unit} in {year} · coverage {fmtDate(s.first)} –{" "}
                          {fmtDate(s.last)}
                        </>
                      ) : (
                        "No dated records collected"
                      )}
                    </span>
                  </p>
                  <DayGrid year={year} series={s} days={data.days[s.id]} />
                </div>
              );
            })}
            <p className="m-0 flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <HatchSwatch /> Not recorded: outside the collection's coverage.
            </p>
          </div>
        ) : null}
      </ChartFrame>
      {data && overview ? (
        <ChartFrame
          title={`Monthly totals: ${overview.label}`}
          unit={overview.unit}
          period={
            overview.first
              ? `${overview.first.slice(0, 4)}–${overview.last!.slice(0, 4)}`
              : undefined
          }
          sources={
            overview.sourceUrl ? [{ label: overview.sourceLabel, url: overview.sourceUrl }] : []
          }
          status={
            points.length
              ? { kind: "ready" }
              : { kind: "empty", reason: "This collection has no dated records." }
          }
          table={{
            caption: `${overview.label}: ${overview.unit} per month`,
            columns: [{ label: "Month", align: "left" }, { label: overview.unit }],
            rows: [...points].reverse().map((p) => ({
              key: p.key,
              muted: p.partial,
              cells: [`${p.key}${p.partial ? " (partial month)" : ""}`, fmtInt(p.value)],
            })),
          }}
          actions={
            data.series.length > 1 ? (
              <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                Series
                <select
                  className={control}
                  value={overview.id}
                  onChange={(e) => setOverviewSeries(e.target.value)}
                >
                  {data.series.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : undefined
          }
          notes={[
            "Rows are years, columns months. Months inside the coverage with no record are 0; hatched months are outside it.",
          ]}
          footnotes={
            partial.size
              ? ["The first and last months of the coverage may be partial; their cells say so."]
              : undefined
          }
        >
          <div className="pb-2">
            <Heatmap
              rows={matrix.rows}
              columns={matrix.columns}
              value={(r, c) => matrix.lookup.get(`${r}-${c}`) ?? null}
              formatter={count}
              ariaLabel={`${overview.label}, ${overview.unit} per month, years by months.`}
              cellHeight={14}
              cellNote={(r, c) =>
                partial.has(`${r}-${c}`)
                  ? "Partial month (coverage starts or ends in it)"
                  : undefined
              }
            />
          </div>
        </ChartFrame>
      ) : null}
      {q.data && q.data.status === "ok" && !data?.series.some((s) => s.first) ? (
        <Notice>None of this agency's collections has a dated record yet.</Notice>
      ) : null}
    </section>
  );
}
