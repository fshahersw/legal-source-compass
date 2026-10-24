import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import type { DistrictRow, JudgePoint } from "@/lib/external/judgeCross.functions";
import { ChartUnavailable } from "@/components/fda-analytics/FdaCharts";
import { cn } from "@/lib/utils";
import {
  circuitLabel,
  concentrationCurve,
  districtFlag,
  fmtInt,
  judgeFlag,
  OTHER_PARTY_COLOR,
  PARTY_COLOR,
  partySegments,
  TENURE_COLORS,
  TENURE_ORDER,
} from "./judgeCrossView";

const axis = { fontSize: 11, fill: "var(--muted-foreground)" };
const compact = (v: number) =>
  new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(v);
const PARTIES = ["Democratic", "Republican", "Other"] as const;

type ScatterDatum = JudgePoint & { x: number; y: number; z: number };

function ScatterTip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload?: ScatterDatum }[];
}) {
  const p = active ? payload?.[0]?.payload : undefined;
  if (!p) return null;
  return (
    <div className="max-w-64 rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs shadow-sm">
      <div className="font-semibold">{p.name}</div>
      <div className="text-muted-foreground">
        {p.status} · {p.party ?? "Party not recorded"} · {p.years?.toFixed(1) ?? "—"} yrs since
        commission
      </div>
      <div className="mt-1 tabular-nums">
        {fmtInt(p.pendingActions)} pending actions in {p.pendingMdls} MDL
        {p.pendingMdls === 1 ? "" : "s"}
      </div>
      <div className="tabular-nums text-muted-foreground">
        {p.historicalMdls} terminated MDLs matched · {fmtInt(p.totalActions)} actions handled
      </div>
      {p.topMdl ? <div className="mt-1 line-clamp-2 text-muted-foreground">{p.topMdl}</div> : null}
    </div>
  );
}

/** Years since first commission (x) against actions now pending (y, log scale); size = MDLs handled. */
export function ExperienceScatter({ points }: { points: JudgePoint[] }) {
  const [colorBy, setColorBy] = useState<"none" | "party">("none");
  const pending = points.filter((p) => p.pendingMdls > 0);
  const plotted = pending.filter((p) => p.pendingActions > 0 && p.years !== null);
  const omitted = pending.length - plotted.length;
  if (!plotted.length)
    return <ChartUnavailable reason="No judge with pending MDL actions matches these filters." />;
  const datum = (p: JudgePoint) => ({
    ...p,
    x: p.years ?? 0,
    y: p.pendingActions,
    z: p.pendingMdls + p.historicalMdls,
  });
  // Neutral by default; appointing party is an optional colour mode.
  const series =
    colorBy === "party"
      ? PARTIES.map((party) => ({
          key: party as string,
          label: party === "Other" ? "Other / not recorded" : `${party} appointee`,
          color: party === "Other" ? OTHER_PARTY_COLOR : PARTY_COLOR[party]!,
          data: plotted
            .filter((p) => (party === "Other" ? !PARTY_COLOR[p.party ?? ""] : p.party === party))
            .map(datum),
        })).filter((s) => s.data.length)
      : [
          {
            key: "all",
            label: "Transferee judge",
            color: "var(--primary)",
            data: plotted.map(datum),
          },
        ];
  const flagged = plotted.filter(judgeFlag);
  const maxYears = Math.max(5, ...plotted.map((p) => p.years ?? 0));
  const xMax = Math.ceil(maxYears / 5) * 5;
  const xTicks = Array.from({ length: xMax / 5 + 1 }, (_, i) => i * 5);
  const maxActions = Math.max(10, ...plotted.map((p) => p.pendingActions));
  const yTicks = [1, 10, 100, 1000, 10000, 100000].filter(
    (t, i, all) => i === 0 || all[i - 1]! < maxActions,
  );
  return (
    <div className="px-2 pb-2 pt-1">
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 8, right: 12, bottom: 18, left: 0 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
            <XAxis
              type="number"
              dataKey="x"
              name="Years since first commission"
              tick={axis}
              tickLine={false}
              domain={[0, xMax]}
              ticks={xTicks}
              label={{
                value: "Years since first Article III commission",
                position: "insideBottom",
                offset: -10,
                fontSize: 11,
                fill: "var(--muted-foreground)",
              }}
            />
            <YAxis
              type="number"
              dataKey="y"
              scale="log"
              domain={[1, yTicks.at(-1) ?? 100000]}
              ticks={yTicks}
              allowDataOverflow
              tick={axis}
              tickLine={false}
              width={44}
              tickFormatter={compact}
              name="Pending actions"
            />
            <ZAxis type="number" dataKey="z" range={[30, 260]} name="MDLs handled" />
            <Tooltip content={<ScatterTip />} cursor={{ strokeDasharray: "3 3" }} />
            {series.map((s) => (
              <Scatter
                key={s.key}
                name={s.label}
                data={s.data}
                fill={s.color}
                fillOpacity={0.6}
                isAnimationActive={false}
              />
            ))}
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[11px] text-muted-foreground">
        <span
          className="inline-flex rounded-md border border-border p-0.5"
          role="group"
          aria-label="Dot colour"
        >
          {(["none", "party"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={colorBy === m}
              onClick={() => setColorBy(m)}
              className={cn(
                "rounded px-1.5 py-px focus-visible:outline-2 focus-visible:outline-ring",
                colorBy === m ? "bg-muted font-medium text-foreground" : "hover:bg-muted/50",
              )}
            >
              {m === "none" ? "Single colour" : "Colour by appointing party"}
            </button>
          ))}
        </span>
        {series.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1">
            <span className="size-2 rounded-full" style={{ background: s.color }} aria-hidden />
            {s.label} ({s.data.length.toLocaleString("en-US")})
          </span>
        ))}
        <span>Vertical: actions now pending (log scale)</span>
        <span>Dot size = pending + terminated MDLs matched</span>
        {omitted ? (
          <span>{omitted} judges with 0 pending actions or no commission date not plotted</span>
        ) : null}
      </div>
      {flagged.length ? (
        <p className="px-1 pt-1 text-[11px]">
          <span className="font-medium text-foreground">
            Concentration ≥5% (judge holds at least 5% of all pending MDL actions):{" "}
          </span>
          <span className="text-muted-foreground">{flagged.map((p) => p.name).join("; ")}</span>
        </p>
      ) : null}
    </div>
  );
}

/** Cumulative share of pending MDL actions held by the top-k transferee judges. */
export function ConcentrationCurve({ points }: { points: JudgePoint[] }) {
  const curve = useMemo(() => concentrationCurve(points), [points]);
  if (curve.length < 2)
    return <ChartUnavailable reason="Fewer than two judges with pending actions." />;
  const at = (k: number) => curve[Math.min(k, curve.length) - 1]?.share ?? null;
  return (
    <div className="px-2 pb-2 pt-1">
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={curve} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
            <XAxis dataKey="rank" tick={axis} tickLine={false} axisLine={false} minTickGap={16} />
            <YAxis
              tick={axis}
              tickLine={false}
              axisLine={false}
              width={40}
              domain={[0, 100]}
              tickFormatter={(v: number) => `${v}%`}
            />
            <ReferenceLine y={50} stroke="var(--muted-foreground)" strokeDasharray="2 4" />
            <Tooltip
              contentStyle={{ fontSize: 11 }}
              labelFormatter={(v) => `Top ${v} judges`}
              formatter={(v, _n, item) => [
                `${v}% (adds ${(item?.payload as { name?: string })?.name ?? ""})`,
                "Cumulative share",
              ]}
            />
            <Line
              type="stepAfter"
              dataKey="share"
              stroke="var(--primary)"
              dot={false}
              strokeWidth={2}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 px-1 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <span className="h-0.5 w-3 rounded-full bg-primary" aria-hidden />
          Cumulative share of pending actions
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="w-3 border-t border-dashed border-muted-foreground" aria-hidden />
          50% of pending actions
        </span>
        <span>Horizontal: judges ranked by pending actions (1 = most)</span>
      </div>
      <p className="px-1 text-[11px] text-muted-foreground">
        Top 1: {at(1)}% · top 5: {at(5)}% · top 10: {at(10)}% of pending actions across{" "}
        {curve.length.toLocaleString("en-US")} judges.
      </p>
    </div>
  );
}

export type DistributionMetric = "party" | "tenure";

/** Display name for a stacked series key; party keys name the appointees, tenure keys pass through. */
const seriesLabel = (k: string) =>
  k === "Other"
    ? "Other / not recorded"
    : k === "Democratic" || k === "Republican"
      ? `${k} appointees`
      : k;

/** Colour key for the bench tiles, which draw party segments without axes. */
function PartyKey() {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
      {PARTIES.map((p) => (
        <span key={p} className="inline-flex items-center gap-1">
          <span
            className="size-2 rounded-sm"
            style={{ background: p === "Other" ? OTHER_PARTY_COLOR : PARTY_COLOR[p] }}
            aria-hidden
          />
          {seriesLabel(p)}
        </span>
      ))}
      <span>Bar length = judges, scaled to the largest bench shown; senior row drawn lighter</span>
    </div>
  );
}

/** Appointing-party mix of active judges, or tenure mix of all sitting judges, by district. */
export function DistrictDistribution({
  rows,
  metric,
  setMetric,
}: {
  rows: DistrictRow[];
  metric: DistributionMetric;
  setMetric: (m: DistributionMetric) => void;
}) {
  const [all, setAll] = useState(false);
  const sorted = [...rows].sort((a, b) => b.sitting - a.sitting || a.name.localeCompare(b.name));
  const shown = all ? sorted : sorted.slice(0, 20);
  if (!shown.length) return <ChartUnavailable reason="No district matches this filter." />;
  const data = shown.map((d) => {
    const label = d.name.replace(" District of ", " ").replace("District of ", "");
    if (metric === "party") {
      const seg = partySegments(d.partyActive);
      return { label, ...seg, median: d.medianYearsActive };
    }
    return {
      label,
      ...Object.fromEntries(TENURE_ORDER.map((t) => [t, d.tenure[t] ?? 0])),
      median: d.medianYearsAll,
    };
  });
  const keys: readonly string[] = metric === "party" ? PARTIES : TENURE_ORDER;
  const colors =
    metric === "party"
      ? [PARTY_COLOR["Democratic"]!, PARTY_COLOR["Republican"]!, OTHER_PARTY_COLOR]
      : TENURE_COLORS;
  return (
    <div className="px-2 pb-2 pt-1">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2 px-1">
        <div
          className="inline-flex rounded-md border border-border p-0.5 text-[11px]"
          role="group"
          aria-label="Distribution metric"
        >
          {(["party", "tenure"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={metric === m}
              onClick={() => setMetric(m)}
              className={cn(
                "rounded px-2 py-0.5 focus-visible:outline-2 focus-visible:outline-ring",
                metric === m
                  ? "bg-muted font-medium text-foreground"
                  : "text-muted-foreground hover:bg-muted/50",
              )}
            >
              {m === "party" ? "Appointing party (active)" : "Years of service (all sitting)"}
            </button>
          ))}
        </div>
        {sorted.length > 20 ? (
          <button
            type="button"
            className="text-[11px] text-primary hover:underline"
            onClick={() => setAll((v) => !v)}
          >
            {all ? "Show 20 largest benches" : `Show all ${sorted.length} districts`}
          </button>
        ) : null}
      </div>
      <div style={{ height: data.length * 19 + 36 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            layout="vertical"
            margin={{ top: 4, right: 12, bottom: 4, left: 4 }}
            barCategoryGap={3}
          >
            <CartesianGrid horizontal={false} stroke="var(--border)" strokeDasharray="3 3" />
            <XAxis
              type="number"
              tick={axis}
              tickLine={false}
              axisLine={false}
              allowDecimals={false}
            />
            <YAxis
              type="category"
              dataKey="label"
              tick={{ ...axis, fontSize: 10.5 }}
              tickLine={false}
              axisLine={false}
              width={150}
              interval={0}
            />
            <Tooltip
              contentStyle={{ fontSize: 11 }}
              cursor={{ fill: "var(--muted)" }}
              formatter={(v, name) => [
                `${Number(v).toLocaleString("en-US")} judge${Number(v) === 1 ? "" : "s"}`,
                name,
              ]}
            />
            {keys.map((k, i) => (
              <Bar
                key={k}
                dataKey={k}
                name={seriesLabel(k)}
                stackId="a"
                fill={colors[i]}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 px-1 text-[11px] text-muted-foreground">
        {keys.map((k, i) => (
          <span key={k} className="inline-flex items-center gap-1">
            <span className="size-2 rounded-sm" style={{ background: colors[i] }} aria-hidden />
            {seriesLabel(k)}
          </span>
        ))}
        <span>
          Bar length = number of {metric === "party" ? "active" : "sitting"} judges in the district
        </span>
      </div>
    </div>
  );
}

function Segment({
  value,
  total,
  color,
  label,
}: {
  value: number;
  total: number;
  color: string;
  label: string;
}) {
  if (!value || !total) return null;
  return <span title={`${label}: ${value}`} style={{ flex: value, background: color }} />;
}

/** One compact tile per district: active/senior bench by appointing party, tenure, MDL load. */
export function BenchSmallMultiples({ rows }: { rows: DistrictRow[] }) {
  const [all, setAll] = useState(false);
  const sorted = [...rows].sort(
    (a, b) => b.pendingActions - a.pendingActions || b.sitting - a.sitting,
  );
  const shown = all ? sorted : sorted.slice(0, 24);
  if (!shown.length) return <ChartUnavailable reason="No district matches this filter." />;
  const maxBench = Math.max(1, ...shown.map((d) => d.sitting));
  return (
    <div className="p-3">
      <PartyKey />
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {shown.map((d) => {
          const active = partySegments(d.partyActive);
          const everyone = partySegments(d.partyAll);
          const senior = {
            Democratic: Math.max(0, everyone.Democratic - active.Democratic),
            Republican: Math.max(0, everyone.Republican - active.Republican),
            Other: Math.max(0, everyone.Other - active.Other),
          };
          const flag = districtFlag(d);
          return (
            <li
              key={d.courtId}
              className="min-w-0 rounded-md border border-border bg-surface px-2.5 py-2"
            >
              <div className="flex items-baseline justify-between gap-2">
                <Link
                  to="/courts/$id"
                  params={{ id: d.courtId }}
                  className="truncate text-[12.5px] font-semibold hover:underline"
                  title={d.name}
                >
                  {d.name.replace("District of ", "D. ").replace(" District of ", " D. ")}
                </Link>
                <span className="shrink-0 text-[10.5px] text-muted-foreground">
                  {circuitLabel(d.circuit)}
                </span>
              </div>
              <div className="mt-1.5 space-y-1 text-[10.5px] text-muted-foreground">
                <div className="flex items-center gap-1.5">
                  <span className="w-11 shrink-0">Active</span>
                  <span
                    className="flex h-2 overflow-hidden rounded-sm bg-muted"
                    style={{ width: `${(d.active / maxBench) * 100}%`, minWidth: d.active ? 4 : 0 }}
                  >
                    <Segment
                      value={active.Democratic}
                      total={d.active}
                      color={PARTY_COLOR["Democratic"]!}
                      label="Democratic appointees"
                    />
                    <Segment
                      value={active.Republican}
                      total={d.active}
                      color={PARTY_COLOR["Republican"]!}
                      label="Republican appointees"
                    />
                    <Segment
                      value={active.Other}
                      total={d.active}
                      color={OTHER_PARTY_COLOR}
                      label="Other / not recorded"
                    />
                  </span>
                  <span className="tabular-nums text-foreground">{d.active}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-11 shrink-0">Senior</span>
                  <span
                    className="flex h-2 overflow-hidden rounded-sm bg-muted opacity-70"
                    style={{ width: `${(d.senior / maxBench) * 100}%`, minWidth: d.senior ? 4 : 0 }}
                  >
                    <Segment
                      value={senior.Democratic}
                      total={d.senior}
                      color={PARTY_COLOR["Democratic"]!}
                      label="Democratic appointees"
                    />
                    <Segment
                      value={senior.Republican}
                      total={d.senior}
                      color={PARTY_COLOR["Republican"]!}
                      label="Republican appointees"
                    />
                    <Segment
                      value={senior.Other}
                      total={d.senior}
                      color={OTHER_PARTY_COLOR}
                      label="Other / not recorded"
                    />
                  </span>
                  <span className="tabular-nums text-foreground">{d.senior}</span>
                </div>
              </div>
              <dl className="mt-1.5 grid grid-cols-4 gap-1 text-[10.5px]">
                <div>
                  <dt className="text-muted-foreground">Median yrs</dt>
                  <dd className="font-mono tabular-nums">
                    {d.medianYearsActive?.toFixed(1) ?? "—"}
                  </dd>
                </div>
                <div title="Authorized judgeships, US Courts FCMS (June 2026). Fractional values are shared judgeships. federal active counts use a different as-of date.">
                  <dt className="text-muted-foreground">Judgeships</dt>
                  <dd className="font-mono tabular-nums">
                    {d.judgeships !== null ? String(d.judgeships) : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">MDLs</dt>
                  <dd className="font-mono tabular-nums">{d.pendingMdls}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Actions</dt>
                  <dd className="font-mono tabular-nums">{compact(d.pendingActions)}</dd>
                </div>
              </dl>
              {flag ? (
                <p className="mt-1 rounded border border-warning/40 bg-warning/10 px-1.5 py-0.5 text-[10.5px] text-warning-foreground">
                  MDL hub: {d.sharePct?.toFixed(1)}% of all pending MDL actions
                </p>
              ) : null}
              {d.topJudge && d.pendingMdls ? (
                <p
                  className="mt-1 truncate text-[10.5px] text-muted-foreground"
                  title={`${d.topJudge}: ${d.topJudgeSharePct}% of the district's pending MDL actions; HHI by judge ${fmtInt(d.hhiByJudge)}`}
                >
                  Largest: {d.topJudge} ({d.topJudgeSharePct}%)
                  {d.mdlJudges > 1 ? ` · ${d.mdlJudges} MDL judges` : ""}
                </p>
              ) : (
                <p className="mt-1 text-[10.5px] text-muted-foreground">No pending MDLs</p>
              )}
            </li>
          );
        })}
      </ul>
      {sorted.length > 24 ? (
        <button
          type="button"
          className="mt-2 text-[11px] text-primary hover:underline"
          onClick={() => setAll((v) => !v)}
        >
          {all
            ? "Show 24 districts with the most pending actions"
            : `Show all ${sorted.length} districts`}
        </button>
      ) : null}
    </div>
  );
}
