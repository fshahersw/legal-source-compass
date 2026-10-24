import { Link } from "@tanstack/react-router";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartCard, ChartUnavailable } from "@/components/fda-analytics/FdaCharts";
import { FDA_COLORS } from "@/components/fda-analytics/chartView";
import type { MdlIntel } from "@/lib/external/mdlIntel.functions";
import { axis, compact, n, pct, signed, title } from "./intelFormat";

/** Where pending MDL work sits: district and judge concentration (HHI), docket age and 12-month growth leaders. */
export function Concentration({ data }: { data: MdlIntel }) {
  const c = data.concentration;
  const bands = data.hhiBands;
  const hhiBand = (v: number | null) =>
    v === null
      ? "Not recorded"
      : v > bands.high
        ? "highly concentrated"
        : v >= bands.moderate
          ? "moderately concentrated"
          : "unconcentrated";
  const districts = data.districts.slice(0, 12).map((d) => ({ ...d, name: d.label }));
  const judges = data.judges.slice(0, 12);
  const pendingMean = data.districts.length
    ? data.districts.reduce((a, d) => a + d.pending, 0) / data.districts.length
    : null;
  return (
    <section aria-labelledby="conc-h" className="space-y-3">
      <div>
        <h2 id="conc-h" className="text-sm font-semibold">
          Concentration, age and growth
        </h2>
        <p className="text-xs text-muted-foreground">
          JPML Distribution of Pending MDL Dockets by District, report date {data.asOf}. HHI = sum
          of squared percentage shares (0–10,000). Bands borrowed from the 2023 DOJ/FTC Merger
          Guidelines: above {n(bands.high)} highly concentrated, {n(bands.moderate)}–{n(bands.high)}{" "}
          moderately concentrated, below {n(bands.moderate)} unconcentrated.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat
          label="HHI · districts by pending actions"
          value={n(c.hhiDistrictPending)}
          note={hhiBand(c.hhiDistrictPending)}
        />
        <Stat
          label="HHI · judges by pending actions"
          value={n(c.hhiJudgePending)}
          note={hhiBand(c.hhiJudgePending)}
        />
        <Stat
          label="Top-5 districts' share of actions"
          value={pct(c.top5DistrictShare)}
          note={`${n(c.districts)} transferee districts`}
        />
        <Stat
          label="Judges with more than one MDL"
          value={n(c.multiMdlJudges)}
          note={`${n(c.judges)} transferee judges`}
        />
      </div>
      <div className="grid gap-3 xl:grid-cols-2">
        <ChartCard
          title="Pending actions by transferee district"
          subtitle={`Top 12 of ${n(c.districts)} districts · bar = actions (square-root scale) · mean ${pendingMean ? compact(pendingMean) : "—"} per district`}
        >
          {districts.length ? (
            <div className="h-80 px-2 py-2">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={districts}
                  layout="vertical"
                  margin={{ top: 4, right: 20, bottom: 0, left: 4 }}
                >
                  <CartesianGrid stroke="var(--border)" horizontal={false} />
                  <XAxis type="number" tick={axis} tickFormatter={compact} scale="sqrt" />
                  <YAxis type="category" dataKey="name" tick={axis} width={128} interval={0} />
                  <Tooltip
                    formatter={(v: number, _k, p) => [
                      `${n(v)} ${v === 1 ? "action" : "actions"} · ${n(p.payload.mdls)} ${p.payload.mdls === 1 ? "MDL" : "MDLs"} · ${pct(p.payload.sharePct)} of all`,
                      "Pending",
                    ]}
                  />
                  <Bar
                    dataKey="pending"
                    fill={FDA_COLORS[0]}
                    radius={[0, 3, 3, 0]}
                    isAnimationActive={false}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <ChartUnavailable />
          )}
        </ChartCard>
        <div className="overflow-hidden rounded-md border border-border bg-surface">
          <div className="border-b border-border/70 px-3 py-2">
            <h3 className="text-label font-semibold text-foreground">Transferee judges by pending actions</h3>
            <p className="text-xs text-muted-foreground">
              Share of all {n(data.kpis.pendingActions)} pending MDL actions
            </p>
          </div>
          <div className="max-w-full overflow-x-auto">
            <table className="w-full min-w-[420px] text-xs">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th scope="col" className="px-3 py-1.5 font-medium">
                    Judge
                  </th>
                  <th scope="col" className="px-2 py-1.5 font-medium">
                    District
                  </th>
                  <th scope="col" className="px-2 py-1.5 text-right font-medium">
                    MDLs
                  </th>
                  <th scope="col" className="px-2 py-1.5 text-right font-medium">
                    Pending
                  </th>
                  <th scope="col" className="px-3 py-1.5 font-medium">
                    Share
                  </th>
                </tr>
              </thead>
              <tbody>
                {judges.map((j) => (
                  <tr key={j.judge} className="border-t border-border/60 tabular-nums">
                    <th scope="row" className="px-3 py-1 text-left font-medium">
                      {j.judge}
                    </th>
                    <td className="px-2 py-1 text-muted-foreground">{j.districts.join(", ")}</td>
                    <td className="px-2 py-1 text-right">{n(j.mdls)}</td>
                    <td className="px-2 py-1 text-right">{n(j.pending)}</td>
                    <td className="px-3 py-1">
                      <span className="flex items-center gap-1.5">
                        <span
                          className="h-1.5 rounded-sm bg-primary/70"
                          style={{ width: `${Math.max(2, Math.min(100, j.sharePct * 2))}px` }}
                          aria-hidden="true"
                        />
                        {pct(j.sharePct)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <div className="grid items-start gap-3 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <ChartCard
          title="Age of pending MDLs"
          subtitle={`Years since JPML transfer · median ${n(data.kpis.medianAgeAll)} yrs (all) vs ${n(data.kpis.medianAgePl)} yrs (products liability)`}
          footnote={`Covers ${n(data.ageCoverage.withTransferDate)} of ${n(data.ageCoverage.listed)} MDLs on the 10/1/2026 docket-type report; the rest had no transfer date yet.`}
        >
          {data.ages.length ? (
            <div className="h-60 px-2 py-2">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.ages} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="bucket" tick={axis} interval={0} />
                  <YAxis
                    tick={axis}
                    width={28}
                    allowDecimals={false}
                    tickFormatter={(v: number) => n(v)}
                  />
                  <Tooltip formatter={(v: number) => `${n(v)} ${v === 1 ? "MDL" : "MDLs"}`} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar
                    dataKey="all"
                    name="All pending MDLs"
                    fill={FDA_COLORS[0]}
                    isAnimationActive={false}
                  />
                  <Bar
                    dataKey="pl"
                    name="Products liability"
                    fill={FDA_COLORS[2]}
                    isAnimationActive={false}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <ChartUnavailable />
          )}
        </ChartCard>
        <div className="overflow-hidden rounded-md border border-border bg-surface">
          <div className="border-b border-border/70 px-3 py-2">
            <h3 className="text-label font-semibold text-foreground">Growth leaders, last 12 months</h3>
            <p className="text-xs text-muted-foreground">
              Change in pending actions across JPML monthly reports (dataset mdl_analytics)
            </p>
          </div>
          <div className="max-w-full overflow-x-auto">
            <table className="w-full min-w-[480px] text-xs">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th scope="col" className="px-3 py-1.5 font-medium">
                    MDL
                  </th>
                  <th scope="col" className="px-2 py-1.5 font-medium">
                    Litigation
                  </th>
                  <th scope="col" className="px-2 py-1.5 text-right font-medium">
                    Pending
                  </th>
                  <th scope="col" className="px-2 py-1.5 text-right font-medium">
                    12-mo change
                  </th>
                  <th scope="col" className="px-3 py-1.5 text-right font-medium">
                    %
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.growthLeaders.map((g) => (
                  <tr key={g.mdl} className="border-t border-border/60 tabular-nums">
                    <td className="px-3 py-1">
                      <Link
                        to="/matters/lens/$mdl"
                        params={{ mdl: String(g.mdl) }}
                        className="text-primary underline-offset-2 hover:underline"
                      >
                        {g.mdl}
                      </Link>
                    </td>
                    <td className="max-w-[260px] truncate px-2 py-1" title={g.title ?? undefined}>
                      {g.title ? title(g.title) : "Not recorded"}
                    </td>
                    <td className="px-2 py-1 text-right">{n(g.pending)}</td>
                    <td className="px-2 py-1 text-right font-medium">{signed(g.change12m)}</td>
                    <td className="px-3 py-1 text-right">{pct(g.pct12m, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string | undefined }) {
  return (
    <div className="rounded-md border border-border bg-surface px-3 py-2">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="font-sans text-lg font-semibold tabular-nums">{value}</div>
      {note ? <div className="text-[11px] text-muted-foreground">{note}</div> : null}
    </div>
  );
}
