import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { FDA_COLORS } from "@/components/fda-analytics/chartView";
import { getCourtStatsDistrict } from "@/lib/external/courtStats.functions";
import {
  at,
  change,
  compactNum,
  DASH_TITLE,
  dominanceNote,
  flagDetail,
  fmtCell,
  fmtNum,
  isDash,
  fmtPct,
  RULE_FALLBACK_SHORT,
  type DistrictPanel,
  axis,
  tooltipStyle,
} from "./courtStatsData";
import { Kpi } from "./CourtStatsParts";

const fy = (y: number) => `FY${y}`;
const asNum = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const DISTRICT_ID = /^[a-z]{2,4}d$/;

/**
 * Compact FY2014-FY2025 caseload history for a federal district court profile (datasets
 * court_stats_district_nos and court_stats_district_times). Renders nothing for courts that are
 * not federal districts.
 */
export function CaseloadHistoryPanel({ courtId }: { courtId: string }) {
  const enabled = DISTRICT_ID.test(courtId);
  const q = useQuery({
    queryKey: ["court-stats-district", courtId],
    queryFn: () => getCourtStatsDistrict({ data: { id: courtId } }),
    staleTime: 10 * 60 * 1000,
    enabled,
  });
  if (!enabled) return null;
  if (q.isLoading)
    return (
      <div
        className="mb-5 h-48 animate-pulse rounded-lg border border-border bg-muted/40"
        aria-busy="true"
        aria-label="Loading caseload history"
      />
    );
  if (q.isError)
    return (
      <p
        role="alert"
        className="mb-5 rounded-lg border border-border px-4 py-3 text-xs text-muted-foreground"
      >
        Caseload history could not be loaded.
      </p>
    );
  if (!q.data) return null;
  return <Panel d={q.data} />;
}

function Panel({ d }: { d: DistrictPanel }) {
  const n = d.years.length;
  const i = n - 1;
  const latest = d.years[i]!;
  const t = d.times;
  const plChange = change(at(d.pl, i), at(d.pl, i - 1));
  const filings = d.years.map((y, k) => ({
    year: `'${String(y).slice(2)}`,
    full: fy(y),
    pl: at(d.pl, k),
    other: (() => {
      const c = at(d.civil, k);
      const p = at(d.pl, k);
      return c !== null && p !== null ? c - p : null;
    })(),
  }));
  const times = d.years.map((y, k) => ({
    year: `'${String(y).slice(2)}`,
    full: fy(y),
    district: at(t?.median, k),
    benchmark: at(t?.districtMedian, k),
    national: at(t?.nationalMedian, k),
  }));
  const medianDash = isDash(t?.dash, "median_total", latest);
  const c5Note = dominanceNote(
    t?.concentration.c5[i] ?? null,
    `${fy(latest)} civil terminations measured in Table C-5`,
  );
  const c6Note = dominanceNote(
    t?.concentration.c6[i] ?? null,
    `${fy(latest)} civil cases pending three years or more (Table C-6)`,
  );
  const flags = [...d.flags, ...(t?.flags ?? [])].sort((a, b) => b.year - a.year);
  return (
    <section
      className="mb-5 rounded-lg border border-border bg-surface"
      aria-labelledby="caseload-history-title"
    >
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border/70 px-3 py-2">
        <div className="min-w-0">
          <h2 id="caseload-history-title" className="text-sm font-semibold">
            Caseload history
          </h2>
          <p className="text-xs text-muted-foreground">
            {fy(d.years[0]!)}-{fy(latest)} · Judicial Business tables C-11, C, C-5, C-6 and X-1A
            (12-month periods ending September 30)
          </p>
        </div>
        <Link
          to="/courts/analytics"
          className="rounded-md border border-border px-2.5 py-1 text-xs hover:bg-muted"
        >
          Compare all districts
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-2 px-3 pt-3 md:grid-cols-4">
        <Kpi
          label={`Product liability filings ${fy(latest)}`}
          value={fmtNum(at(d.pl, i))}
          note={
            d.ranks.pl !== null
              ? `Rank ${d.ranks.pl} of ${fmtNum(d.ranks.of)}${plChange !== null ? ` · ${plChange > 0 ? "+" : ""}${plChange.toFixed(0)}% vs prior FY` : ""}`
              : undefined
          }
        />
        <Kpi
          label="PL share of civil filings"
          value={fmtPct(at(d.share, i))}
          note={`${fmtPct(at(d.natShare, i))} of national PL filings`}
        />
        <Kpi
          label="Median months to disposition"
          value={fmtCell(at(t?.median, i), medianDash, 1)}
          note={`Median district ${fmtNum(at(t?.districtMedian, i), 1)} · national ${fmtNum(at(t?.nationalMedian, i), 1)}`}
          detail={c5Note ? "National figure skewed by one MDL" : undefined}
          title={c5Note ?? (medianDash ? DASH_TITLE : undefined)}
        />
        <Kpi
          label="Civil pending 3+ years"
          value={fmtPct(at(t?.over3Pct, i))}
          note={`Median district ${fmtPct(at(t?.districtMedianOver3Pct, i))} · national ${fmtPct(at(t?.nationalOver3Pct, i))}`}
          detail={c6Note ? "National figure skewed by one MDL" : undefined}
          title={c6Note ?? undefined}
        />
      </div>
      <div className="grid gap-3 px-3 py-3 lg:grid-cols-2">
        <figure className="min-w-0">
          <figcaption className="text-xs font-medium">
            Civil filings: product liability and all other
          </figcaption>
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={filings} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="var(--border)" vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="year" tick={axis} tickLine={false} axisLine={false} />
                <YAxis
                  tick={axis}
                  tickFormatter={compactNum}
                  width={40}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  labelFormatter={(_, p) => String(p?.[0]?.payload?.full ?? "")}
                  formatter={(v, name: string) => [fmtNum(asNum(v)), name]}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} iconSize={9} />
                <Bar
                  dataKey="pl"
                  name="Product liability (C-11)"
                  stackId="civil"
                  fill={FDA_COLORS[2]}
                  isAnimationActive={false}
                  maxBarSize={26}
                />
                <Bar
                  dataKey="other"
                  name="Other civil (C less C-11)"
                  stackId="civil"
                  fill={FDA_COLORS[5]}
                  isAnimationActive={false}
                  maxBarSize={26}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </figure>
        <figure className="min-w-0">
          <figcaption className="text-xs font-medium">
            Median months, filing to disposition (C-5)
          </figcaption>
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={times} margin={{ top: 6, right: 10, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="var(--border)" vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="year" tick={axis} tickLine={false} axisLine={false} />
                <YAxis tick={axis} width={32} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={tooltipStyle}
                  labelFormatter={(_, p) => String(p?.[0]?.payload?.full ?? "")}
                  formatter={(v, name: string) => [`${fmtNum(asNum(v), 1)} months`, name]}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} iconType="plainline" />
                <Line
                  dataKey="district"
                  name="This district"
                  stroke={FDA_COLORS[0]}
                  strokeWidth={2}
                  dot={{ r: 2 }}
                  connectNulls={false}
                  isAnimationActive={false}
                />
                <Line
                  dataKey="benchmark"
                  name="Median district"
                  stroke={FDA_COLORS[1]}
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                />
                <Line
                  dataKey="national"
                  name="National (all terminations)"
                  stroke={FDA_COLORS[3]}
                  strokeWidth={1.5}
                  strokeDasharray="5 3"
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          {c5Note || c6Note ? (
            <p className="mt-1 text-[11px] leading-snug text-warning-foreground">
              {[c5Note, c6Note].filter(Boolean).join(" ")} Flags compare this district with the
              median district instead.
            </p>
          ) : null}
        </figure>
      </div>
      <div className="border-t border-border/70 px-3 py-2 text-xs">
        {flags.length ? (
          <>
            <h3 className="mb-1 font-medium">Outlier flags (deterministic rules)</h3>
            <ul className="space-y-0.5">
              {flags.slice(0, 6).map((f) => (
                <li key={`${f.year}:${f.rule}`} className="flex gap-2">
                  <span className="w-14 shrink-0 font-mono text-muted-foreground">
                    {fy(f.year)}
                  </span>
                  <span>
                    <span className="font-medium">{RULE_FALLBACK_SHORT[f.rule]}</span>{" "}
                    <span className="text-muted-foreground">{flagDetail(f)}</span>
                  </span>
                </li>
              ))}
            </ul>
            {flags.length > 6 ? (
              <p className="mt-1 text-muted-foreground">
                {flags.length - 6} earlier flags are listed on the federal court analytics page.
              </p>
            ) : null}
          </>
        ) : (
          <p className="text-muted-foreground">
            No outlier rule fired for this district in {fy(d.years[0]!)}-{fy(latest)}.
          </p>
        )}
        {d.componentsWithheldYears.length ? (
          <p className="mt-1 text-muted-foreground">
            Product liability components withheld for {d.componentsWithheldYears.map(fy).join(", ")}
            : the published row does not reconcile.
          </p>
        ) : null}
        {d.mdl && d.mdl.plActions !== null ? (
          <p className="mt-1 text-muted-foreground">
            Context: {fmtNum(d.mdl.plDockets)} pending products liability MDL dockets with{" "}
            {fmtNum(d.mdl.plActions)} pending actions are assigned here (JPML
            {d.mdl.asOf ? `, ${d.mdl.asOf}` : ""}). Cases filed directly in, or transferred by the
            JPML to, a transferee court count as that court's civil filings.
          </p>
        ) : null}
      </div>
    </section>
  );
}
