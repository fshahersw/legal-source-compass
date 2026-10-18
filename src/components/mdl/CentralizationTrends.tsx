import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartCard, ChartUnavailable } from "@/components/fda-analytics/FdaCharts";
import { FDA_COLORS } from "@/components/fda-analytics/chartView";
import type { MdlIntel } from "@/lib/external/mdlIntel.functions";
import { cn } from "@/lib/utils";
import { axis, compact, mean, n, pct } from "./intelFormat";

const RANGES = [
  { key: "all", label: "1973–2025", from: 1973 },
  { key: "20", label: "Since 2006", from: 2006 },
  { key: "10", label: "Last 10 yrs", from: 2016 },
] as const;
const TYPE_COLORS = [
  FDA_COLORS[0],
  FDA_COLORS[1],
  FDA_COLORS[2],
  FDA_COLORS[3],
  FDA_COLORS[4],
  FDA_COLORS[5],
];

/** Calendar-year JPML activity: motions, grant share, termination categories, hearing matters, pending by type. */
export function CentralizationTrends({ data }: { data: MdlIntel }) {
  const [range, setRange] = useState<(typeof RANGES)[number]["key"]>("20");
  const from = RANGES.find((r) => r.key === range)!.from;
  const rows = useMemo(() => data.stats.filter((s) => s.year >= from), [data.stats, from]);
  const latestEdition = data.editions.at(-1);
  const rates = rows.map((r) => r.rateAll).filter((v): v is number => v !== null);
  const avgRate = mean(rates);
  const flagged = new Set(
    data.stats.filter((s) => s.categoriesConsistent === false).map((s) => s.year),
  );
  const notes = new Map(data.inconsistencies.map((i) => [i.year, i.note] as const));
  const motions = rows.map((r) => ({
    year: r.year,
    Filed: r.motionsFiled,
    Granted: r.motionsGranted,
    "Denied, moot or withdrawn": r.deniedMootWithdrawn,
    "Grant share": r.rateAll,
  }));
  const categories = rows
    .filter((r) => r.categories)
    .map((r) => ({
      year: r.year,
      Denied: r.categories!.denied,
      Moot: r.categories!.moot,
      Withdrawn: r.categories!.withdrawn,
      "Closed / stricken": r.categories!.closed + r.categories!.stricken,
      flagged: r.categoriesConsistent === false,
    }));
  const hearings = rows
    .filter((r) => r.hearingSet !== null)
    .map((r) => ({ year: r.year, Set: r.hearingSet, Decided: r.hearingDecided }));
  const tags = rows.map((r) => ({
    year: r.year,
    "Tag-along transfers": r.tagAlongs,
    Remands: r.remands,
  }));
  const typeNames = useMemo(() => {
    const totals = new Map<string, number>();
    for (const t of data.types)
      for (const [k, v] of Object.entries(t.types)) totals.set(k, (totals.get(k) ?? 0) + v);
    return [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  }, [data.types]);
  const top = typeNames.slice(0, 5);
  const typeRows = data.types.map((t) => {
    const row: Record<string, number | string | null> = { year: t.year, flag: t.flag };
    let other = 0;
    for (const [k, v] of Object.entries(t.types)) {
      if (top.includes(k)) row[k] = v;
      else other += v;
    }
    row["Other types"] = other;
    return row;
  });
  const sourceNote = latestEdition ? (
    <>
      Source:{" "}
      <a
        className="underline underline-offset-2"
        href={latestEdition.url}
        target="_blank"
        rel="noreferrer"
      >
        JPML Calendar Year Statistics, CY {latestEdition.edition} edition
      </a>
      ; every earlier edition ({data.editions.length} total) cross-checked for revisions.
    </>
  ) : null;

  return (
    <section aria-labelledby="trends-h" className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="trends-h" className="text-sm font-semibold">
            Centralization trends
          </h2>
          <p className="text-xs text-muted-foreground">
            Motions for centralization under 28 U.S.C. § 1407 by calendar year, as printed by the
            Panel.
          </p>
        </div>
        <div
          role="group"
          aria-label="Year range"
          className="flex rounded-md border border-border bg-surface p-0.5"
        >
          {RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              aria-pressed={range === r.key}
              onClick={() => setRange(r.key)}
              className={cn(
                "rounded px-2 py-1 text-xs focus-visible:outline-2 focus-visible:outline-ring",
                range === r.key
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted",
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>
      <div className="grid items-start gap-3 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <ChartCard
          title="Motions filed, granted and not granted"
          subtitle={`Bars: counts per year · line: grant share of terminated motions (right axis); dashed = ${pct(avgRate)} mean over the range`}
          footnote={sourceNote}
        >
          <div className="h-72 px-2 py-2">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={motions} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis dataKey="year" tick={axis} minTickGap={16} />
                <YAxis yAxisId="c" tick={axis} width={36} />
                <YAxis
                  yAxisId="r"
                  orientation="right"
                  tick={axis}
                  width={36}
                  domain={[0, 100]}
                  tickFormatter={(v: number) => `${v}%`}
                />
                <Tooltip
                  formatter={(v: number, k: string) => (k === "Grant share" ? pct(v) : n(v))}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar yAxisId="c" dataKey="Filed" fill={FDA_COLORS[0]} isAnimationActive={false} />
                <Bar yAxisId="c" dataKey="Granted" fill={FDA_COLORS[1]} isAnimationActive={false} />
                <Bar
                  yAxisId="c"
                  dataKey="Denied, moot or withdrawn"
                  fill={FDA_COLORS[2]}
                  isAnimationActive={false}
                />
                <Line
                  yAxisId="r"
                  dataKey="Grant share"
                  stroke={FDA_COLORS[4]}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
                {avgRate !== null ? (
                  <ReferenceLine
                    yAxisId="r"
                    y={avgRate}
                    stroke={FDA_COLORS[4]}
                    strokeDasharray="4 3"
                  />
                ) : null}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
        <ChartCard
          title="How unsuccessful motions ended"
          subtitle="Termination category of motions not granted, stacked per year"
          footnote={
            <>
              Category split from chart labels (editions 2012–2025) or text tables (2006–2014
              editions).{" "}
              {[...flagged].filter((y) => y >= from).length ? (
                <span>
                  Years where the category total differs from the summary table:{" "}
                  {[...flagged]
                    .filter((y) => y >= from)
                    .sort()
                    .join(", ")}{" "}
                  — both shown as printed.
                </span>
              ) : null}
            </>
          }
        >
          {categories.length ? (
            <div className="h-72 px-2 py-2">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={categories} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="year" tick={axis} minTickGap={16} />
                  <YAxis tick={axis} width={30} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar
                    dataKey="Denied"
                    stackId="c"
                    fill={FDA_COLORS[2]}
                    isAnimationActive={false}
                  />
                  <Bar dataKey="Moot" stackId="c" fill={FDA_COLORS[4]} isAnimationActive={false} />
                  <Bar
                    dataKey="Withdrawn"
                    stackId="c"
                    fill={FDA_COLORS[3]}
                    isAnimationActive={false}
                  />
                  <Bar
                    dataKey="Closed / stricken"
                    stackId="c"
                    fill={FDA_COLORS[5]}
                    isAnimationActive={false}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <ChartUnavailable reason="No termination-category figures are printed for this range." />
          )}
        </ChartCard>
      </div>
      <div className="grid gap-3 lg:grid-cols-3">
        <ChartCard
          title="Hearing matters set and decided"
          subtitle="All matters on Panel hearing calendars, per year"
        >
          {hearings.length ? (
            <div className="h-56 px-2 py-2">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={hearings} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="year" tick={axis} minTickGap={12} />
                  <YAxis tick={axis} width={32} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="Set" fill={FDA_COLORS[0]} isAnimationActive={false} />
                  <Bar dataKey="Decided" fill={FDA_COLORS[1]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <ChartUnavailable reason="Hearing-matter counts are printed from 2000 onward." />
          )}
        </ChartCard>
        <ChartCard
          title="Tag-along transfers and remands"
          subtitle="Actions moved into existing MDLs vs §1407 remands"
        >
          <div className="h-56 px-2 py-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={tags} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis dataKey="year" tick={axis} minTickGap={12} />
                <YAxis tick={axis} width={40} tickFormatter={compact} />
                <Tooltip formatter={(v: number) => n(v)} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="Tag-along transfers" fill={FDA_COLORS[3]} isAnimationActive={false} />
                <Bar dataKey="Remands" fill={FDA_COLORS[2]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
        <ChartCard
          title="Pending MDLs by type at year end"
          subtitle="December 31 distribution from each year's edition"
          footnote={
            data.types.some((t) => t.flag)
              ? `Flag: ${data.types
                  .filter((t) => t.flag)
                  .map((t) => `${t.year} — ${t.flag}`)
                  .join("; ")}.`
              : undefined
          }
        >
          {typeRows.length ? (
            <div className="h-56 px-2 py-2">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={typeRows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="year" tick={axis} minTickGap={8} />
                  <YAxis tick={axis} width={32} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  {[...top, "Other types"].map((k, i) => (
                    <Bar
                      key={k}
                      dataKey={k}
                      stackId="t"
                      fill={TYPE_COLORS[i % TYPE_COLORS.length]}
                      isAnimationActive={false}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <ChartUnavailable reason="Type distributions are printed from the 2012 edition onward." />
          )}
        </ChartCard>
      </div>
      <YearTable rows={rows} notes={notes} unparsed={data.unparsedEditions} />
    </section>
  );
}

function YearTable({
  rows,
  notes,
  unparsed,
}: {
  rows: MdlIntel["stats"];
  notes: Map<number, string>;
  unparsed: number[];
}) {
  const [open, setOpen] = useState(false);
  const shown = open ? [...rows].reverse() : [...rows].reverse().slice(0, 8);
  return (
    <div className="overflow-hidden rounded-md border border-border bg-surface">
      <div className="max-w-full overflow-x-auto">
        <table className="w-full min-w-[720px] text-xs">
          <caption className="sr-only">JPML calendar-year activity</caption>
          <thead className="bg-muted/50 text-left text-muted-foreground">
            <tr>
              {[
                "Year",
                "Hearings",
                "Filed",
                "Granted",
                "Actions in granted",
                "Not granted",
                "Grant share",
                "Merits grant share",
                "Tag-alongs",
                "Remands",
                "Notes",
              ].map((h) => (
                <th key={h} scope="col" className="px-2 py-1.5 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.year} className="border-t border-border/60 tabular-nums">
                <th scope="row" className="px-2 py-1 text-left font-medium">
                  {r.year}
                </th>
                <td className="px-2 py-1">{r.hearings}</td>
                <td className="px-2 py-1">{n(r.motionsFiled)}</td>
                <td className="px-2 py-1">{n(r.motionsGranted)}</td>
                <td className="px-2 py-1">{n(r.actionsInGranted)}</td>
                <td className="px-2 py-1">{n(r.deniedMootWithdrawn)}</td>
                <td className="px-2 py-1">{pct(r.rateAll)}</td>
                <td className="px-2 py-1">{pct(r.rateMerits)}</td>
                <td className="px-2 py-1">{n(r.tagAlongs)}</td>
                <td className="px-2 py-1">{n(r.remands)}</td>
                <td className="px-2 py-1 text-muted-foreground">
                  {[
                    notes.get(r.year) ?? null,
                    r.revised.length
                      ? `revised: ${r.revised.join(", ").replaceAll("_", " ")}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full border-t border-border/70 px-3 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring"
      >
        {open ? "Show recent years only" : `Show all ${rows.length} years in range`}
      </button>
      <p className="border-t border-border/60 px-3 py-1.5 text-[11px] text-muted-foreground">
        Grant share = granted ÷ (granted + denied, moot or withdrawn). Merits grant share = granted
        ÷ (granted + denied). “Revised” lists fields an earlier edition printed differently.
        {unparsed.length
          ? ` Editions ${unparsed.join(", ")} print the summary table as an image or chart, so revisions they may contain are not listed.`
          : ""}
      </p>
    </div>
  );
}
