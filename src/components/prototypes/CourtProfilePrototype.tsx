import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowDownRight, ArrowUpRight, ExternalLink, Minus } from "lucide-react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type NatureOfSuit = {
  category: string;
  filings: number;
  prior: number | null;
  change_pct: number | null;
};
type CourtMdl = {
  mdl: number;
  title: string;
  pending: number;
  total: number;
  judge: string | null;
  type: string | null;
};
type CourtAnalytics = {
  court_id: string;
  name: string;
  years: number[];
  metrics: Record<string, (number | null)[]>;
  standing: Record<string, { us: number | null; circuit: number | null }>;
  percentile: Record<string, number>;
  nature_of_suit: NatureOfSuit[];
  criminal: Record<string, number>;
  civil_total: number | null;
  mdls: CourtMdl[];
  mdl_actions: number;
  mdl_as_of: string;
};
type CourtJudge = {
  nid: string;
  name: string;
  status: string;
  president: string;
  party: string;
  commission: string | null;
  mdls: number;
  mdlActions: number;
  profileId: string | null;
};
type NationalDistribution = Record<string, { min: number; median: number; max: number }>;
type Props = {
  title: string;
  system: string;
  state: string | null;
  court: CourtAnalytics;
  judges: CourtJudge[];
  distributions: NationalDistribution;
  sourceUrl: string;
};

const nf0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nfCompact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

function num(v: number | null | undefined, digits: 0 | 1 = 0): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "Not recorded";
  return (digits === 0 ? nf0 : nf1).format(v);
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? "th");
}

const isPiPl = (category: string) => /personal injury|product liability/i.test(category);

const VITALS: { key: string; label: string; digits: 0 | 1; suffix?: string | undefined }[] = [
  { key: "per_judge_weighted_filings", label: "Weighted filings per judgeship", digits: 0 },
  { key: "per_judge_total", label: "Filings per judgeship", digits: 0 },
  { key: "per_judge_pending", label: "Pending cases per judgeship", digits: 0 },
  { key: "median_months_civil", label: "Median months, civil filing to disposition", digits: 1 },
  { key: "per_judge_trials", label: "Trials completed per judgeship", digits: 1 },
  { key: "civil_over_3y_pct", label: "Civil cases pending over 3 years", digits: 1, suffix: "%" },
];

const tooltipStyle = {
  backgroundColor: "var(--card)",
  border: "1px solid var(--border)",
  fontSize: 12,
  color: "var(--foreground)",
};

function EmptyNote({ label = "Not recorded" }: { label?: string }) {
  return <p className="px-4 py-8 text-sm text-muted-foreground">{label}</p>;
}

function Change({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-muted-foreground">Not recorded</span>;
  const Icon = pct > 0.05 ? ArrowUpRight : pct < -0.05 ? ArrowDownRight : Minus;
  return (
    <span className="inline-flex items-center gap-1 tabular-nums text-foreground">
      <Icon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
      {pct > 0 ? "+" : ""}
      {pct.toFixed(1)}%
    </span>
  );
}

function RangeMarker({
  value,
  min,
  median,
  max,
  digits,
  label,
}: {
  value: number;
  min: number;
  median: number;
  max: number;
  digits: 0 | 1;
  label: string;
}) {
  const span = max - min;
  if (!(span > 0))
    return <p className="text-xs text-muted-foreground">National range not recorded</p>;
  const clamp = (x: number) => Math.min(100, Math.max(0, x));
  const pos = clamp(((value - min) / span) * 100);
  const med = clamp(((median - min) / span) * 100);
  return (
    <div>
      <div
        className="relative h-3"
        role="img"
        aria-label={`${label}: ${num(value, digits)} sits within a national range of ${num(min, digits)} to ${num(max, digits)}, median ${num(median, digits)}`}
      >
        <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-muted" />
        <div
          className="absolute top-1/2 h-2.5 w-px -translate-y-1/2 bg-muted-foreground"
          style={{ left: `${med}%` }}
        />
        <div
          className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary ring-2 ring-background"
          style={{ left: `${pos}%` }}
        />
      </div>
      <div className="mt-0.5 flex justify-between text-xs tabular-nums text-muted-foreground">
        <span>{num(min, digits)}</span>
        <span>median {num(median, digits)}</span>
        <span>{num(max, digits)}</span>
      </div>
    </div>
  );
}

function VitalCard({
  label,
  digits,
  suffix,
  value,
  dist,
  pct,
  standing,
}: {
  label: string;
  digits: 0 | 1;
  suffix?: string | undefined;
  value: number | null;
  dist: { min: number; median: number; max: number } | undefined;
  pct: number | undefined;
  standing: { us: number | null; circuit: number | null } | undefined;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-card">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums text-foreground">
        {value === null ? "Not recorded" : `${num(value, digits)}${suffix ?? ""}`}
      </p>
      <div className="mt-2">
        {value !== null && dist ? (
          <RangeMarker
            value={value}
            min={dist.min}
            median={dist.median}
            max={dist.max}
            digits={digits}
            label={label}
          />
        ) : (
          <p className="text-xs text-muted-foreground">National range not recorded</p>
        )}
      </div>
      <div className="mt-2 flex items-center justify-between border-t border-border pt-2 text-xs text-muted-foreground">
        <span className="tabular-nums">
          {standing?.us != null ? `Rank ${standing.us} of 94` : "Not recorded"}
          {standing?.circuit != null ? ` · circuit ${standing.circuit}` : ""}
        </span>
        <span className="tabular-nums">
          {pct != null ? `${ordinal(Math.round(pct))} percentile` : ""}
        </span>
      </div>
    </div>
  );
}

export function CourtProfilePrototype(props: Props) {
  const { title, system, state, court, judges, distributions, sourceUrl } = props;
  const [trendMode, setTrendMode] = useState<"totals" | "judge">("totals");

  const lastIdx = court.years.length - 1;
  const latestYear = lastIdx >= 0 ? court.years[lastIdx] : null;
  const latest = (key: string): number | null => {
    const arr = court.metrics[key];
    if (!arr || lastIdx < 0) return null;
    return arr[lastIdx] ?? null;
  };

  const trendData = useMemo(
    () =>
      court.years.map((y, i) => ({
        year: `FY ${String(y).slice(2)}`,
        filings: court.metrics["filings"]?.[i] ?? null,
        terminations: court.metrics["terminations"]?.[i] ?? null,
        pending: court.metrics["pending"]?.[i] ?? null,
        pjFilings: court.metrics["per_judge_total"]?.[i] ?? null,
        pjTerminations: court.metrics["per_judge_terminations"]?.[i] ?? null,
        pjPending: court.metrics["per_judge_pending"]?.[i] ?? null,
        pjWeighted: court.metrics["per_judge_weighted_filings"]?.[i] ?? null,
      })),
    [court],
  );

  const nos = useMemo(
    () => [...(court.nature_of_suit ?? [])].sort((a, b) => b.filings - a.filings),
    [court.nature_of_suit],
  );

  const pi = useMemo(() => {
    const rows = nos.filter((r) => isPiPl(r.category));
    const filings = rows.reduce((s, r) => s + r.filings, 0);
    let prior = 0;
    let priorKnown = false;
    for (const r of rows) {
      if (r.prior !== null) {
        prior += r.prior;
        priorKnown = true;
      }
    }
    const base = court.civil_total ?? (nos.length ? nos.reduce((s, r) => s + r.filings, 0) : null);
    const share = base && base > 0 ? (filings / base) * 100 : null;
    const change = priorKnown && prior > 0 ? ((filings - prior) / prior) * 100 : null;
    return { rows: rows.length, filings, share, change };
  }, [nos, court.civil_total]);

  const criminalEntries = useMemo(
    () => Object.entries(court.criminal ?? {}).sort((a, b) => b[1] - a[1]),
    [court.criminal],
  );

  const quickStats: { label: string; value: string }[] = [
    { label: latestYear ? `Filings, FY ${latestYear}` : "Filings", value: num(latest("filings")) },
    { label: "Terminations", value: num(latest("terminations")) },
    { label: "Pending", value: num(latest("pending")) },
    { label: "Authorized judgeships", value: num(latest("judgeships")) },
    { label: "Vacant judgeship-months", value: num(latest("vacant_judgeship_months")) },
  ];

  const thBase = "py-2 pr-4 text-left text-xs font-medium text-muted-foreground";
  const thNum = "py-2 pl-4 text-right text-xs font-medium text-muted-foreground";
  const tdBase = "py-2 pr-4 text-sm text-foreground";
  const tdNum = "py-2 pl-4 text-right text-sm tabular-nums text-foreground";

  return (
    <div className="min-h-screen bg-background font-sans text-foreground">
      <div className="mx-auto max-w-[1360px] space-y-8 p-6">
        <header className="border-b border-border pb-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {system}
                {state ? ` · ${state}` : ""} · {court.court_id.toUpperCase()}
              </p>
              <h1 className="mt-1 font-display text-2xl font-semibold text-foreground">
                {court.name}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {title}
                {latestYear ? ` · data through FY ${latestYear}, fiscal years ending June 30` : ""}
              </p>
            </div>
            <a
              href={sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Source: Federal Judicial Caseload Statistics
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </a>
          </div>
          <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-3">
            {quickStats.map((s) => (
              <div key={s.label}>
                <dt className="text-xs text-muted-foreground">{s.label}</dt>
                <dd className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">
                  {s.value}
                </dd>
              </div>
            ))}
          </dl>
        </header>

        <section aria-label="Caseload vital signs">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {VITALS.map((v) => (
              <VitalCard
                key={v.key}
                label={v.label}
                digits={v.digits}
                suffix={v.suffix}
                value={latest(v.key)}
                dist={distributions[v.key]}
                pct={court.percentile[v.key]}
                standing={court.standing[v.key]}
              />
            ))}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Marker shows this court&rsquo;s position within the national district range
            (min&ndash;median&ndash;max). Percentiles are direction-adjusted: higher indicates a
            lighter or faster-moving docket.
          </p>
        </section>

        <section
          aria-label="Caseload trend"
          className="rounded-lg border border-border bg-card p-4 shadow-card"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-foreground">Caseload trend</h2>
              <p className="text-xs text-muted-foreground">
                {court.years.length
                  ? `FY ${court.years[0]}\u2013FY ${latestYear} · fiscal years ending June 30`
                  : "Not recorded"}
              </p>
            </div>
            <div
              className="inline-flex rounded-md border border-border bg-muted p-0.5"
              role="group"
              aria-label="Trend basis"
            >
              {(
                [
                  ["totals", "Court totals"],
                  ["judge", "Per judgeship"],
                ] as const
              ).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={trendMode === mode}
                  onClick={() => setTrendMode(mode)}
                  className={`rounded px-3 py-1 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    trendMode === mode
                      ? "bg-background text-foreground shadow-card"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-4 h-64">
            {trendData.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke="var(--border)" vertical={false} />
                  <XAxis
                    dataKey="year"
                    tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                    tickLine={false}
                    axisLine={{ stroke: "var(--border)" }}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v: number) => nfCompact.format(v)}
                    width={48}
                  />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    labelStyle={{ color: "var(--foreground)", fontWeight: 600 }}
                    formatter={(v) =>
                      v === null || v === undefined ? "Not recorded" : nf0.format(Number(v))
                    }
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {trendMode === "totals" && (
                    <Line
                      type="monotone"
                      dataKey="filings"
                      name="Filings"
                      stroke="var(--primary)"
                      strokeWidth={2}
                      dot={false}
                      connectNulls
                      isAnimationActive={false}
                    />
                  )}
                  {trendMode === "totals" && (
                    <Line
                      type="monotone"
                      dataKey="terminations"
                      name="Terminations"
                      stroke="var(--success)"
                      strokeWidth={2}
                      dot={false}
                      connectNulls
                      isAnimationActive={false}
                    />
                  )}
                  {trendMode === "totals" && (
                    <Line
                      type="monotone"
                      dataKey="pending"
                      name="Pending"
                      stroke="var(--warning)"
                      strokeWidth={2}
                      strokeDasharray="4 3"
                      dot={false}
                      connectNulls
                      isAnimationActive={false}
                    />
                  )}
                  {trendMode !== "totals" && (
                    <Line
                      type="monotone"
                      dataKey="pjWeighted"
                      name="Weighted filings"
                      stroke="var(--primary)"
                      strokeWidth={2.5}
                      dot={false}
                      connectNulls
                      isAnimationActive={false}
                    />
                  )}
                  {trendMode !== "totals" && (
                    <Line
                      type="monotone"
                      dataKey="pjFilings"
                      name="Filings"
                      stroke="var(--accent)"
                      strokeWidth={2}
                      dot={false}
                      connectNulls
                      isAnimationActive={false}
                    />
                  )}
                  {trendMode !== "totals" && (
                    <Line
                      type="monotone"
                      dataKey="pjTerminations"
                      name="Terminations"
                      stroke="var(--success)"
                      strokeWidth={2}
                      dot={false}
                      connectNulls
                      isAnimationActive={false}
                    />
                  )}
                  {trendMode !== "totals" && (
                    <Line
                      type="monotone"
                      dataKey="pjPending"
                      name="Pending"
                      stroke="var(--warning)"
                      strokeWidth={2}
                      strokeDasharray="4 3"
                      dot={false}
                      connectNulls
                      isAnimationActive={false}
                    />
                  )}
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <EmptyNote />
            )}
          </div>
        </section>

        <section aria-label="Docket composition">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="rounded-lg border border-border bg-card shadow-card lg:col-span-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-4 py-3">
                <h2 className="text-base font-semibold text-foreground">
                  Civil filings by nature of suit
                </h2>
                <p className="text-xs tabular-nums text-muted-foreground">
                  {latestYear ? `FY ${latestYear} vs prior fiscal year` : "Not recorded"}
                </p>
              </div>
              {pi.rows > 0 && (
                <div className="flex flex-wrap gap-x-10 gap-y-2 border-b border-border bg-primary/5 px-4 py-3">
                  <div>
                    <p className="text-xs text-muted-foreground">
                      Personal injury &amp; product liability filings
                    </p>
                    <p className="text-sm font-semibold tabular-nums text-foreground">
                      {nf0.format(pi.filings)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Share of civil docket</p>
                    <p className="text-sm font-semibold tabular-nums text-foreground">
                      {pi.share === null ? "Not recorded" : `${pi.share.toFixed(1)}%`}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Change vs prior year</p>
                    <p className="text-sm font-semibold text-foreground">
                      <Change pct={pi.change} />
                    </p>
                  </div>
                </div>
              )}
              {nos.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-border-strong">
                        <th scope="col" className={`${thBase} pl-4`}>
                          Nature of suit
                        </th>
                        <th scope="col" className={thNum}>
                          Filings
                        </th>
                        <th scope="col" className={thNum}>
                          Prior year
                        </th>
                        <th scope="col" className={`${thNum} pr-4`}>
                          Change
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {nos.map((r) => {
                        const piRow = isPiPl(r.category);
                        return (
                          <tr
                            key={r.category}
                            className={`border-b border-border last:border-0 ${piRow ? "bg-primary/5" : ""}`}
                          >
                            <th scope="row" className={`${tdBase} pl-4 text-left font-normal`}>
                              {r.category}
                              {piRow && (
                                <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">
                                  PI/PL
                                </span>
                              )}
                            </th>
                            <td className={tdNum}>{nf0.format(r.filings)}</td>
                            <td
                              className={`${tdNum} ${r.prior === null ? "text-muted-foreground" : ""}`}
                            >
                              {r.prior === null ? "Not recorded" : nf0.format(r.prior)}
                            </td>
                            <td className={`${tdNum} pr-4`}>
                              <Change pct={r.change_pct} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyNote />
              )}
            </div>

            <aside
              aria-label="Criminal docket composition"
              className="rounded-lg border border-border bg-card shadow-card"
            >
              <div className="border-b border-border px-4 py-3">
                <h2 className="text-base font-semibold text-foreground">Criminal docket</h2>
                <p className="text-xs tabular-nums text-muted-foreground">
                  Filings by offense category{latestYear ? `, FY ${latestYear}` : ""}
                </p>
              </div>
              {criminalEntries.length ? (
                <ul className="divide-y divide-border px-4">
                  {criminalEntries.map(([k, v]) => (
                    <li key={k} className="flex items-center justify-between gap-4 py-2">
                      <span className="text-sm text-foreground">{k}</span>
                      <span className="text-sm font-medium tabular-nums text-foreground">
                        {nf0.format(v)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyNote />
              )}
              <div className="border-t border-border px-4 py-3">
                <p className="text-xs text-muted-foreground">Total civil filings</p>
                <p className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">
                  {num(court.civil_total)}
                </p>
              </div>
            </aside>
          </div>
        </section>

        <section
          aria-label="Pending multidistrict litigation"
          className="rounded-lg border border-border bg-card shadow-card"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-4 py-3">
            <div>
              <h2 className="text-base font-semibold text-foreground">Pending MDLs</h2>
              <p className="text-xs text-muted-foreground">
                Multidistrict litigation centralized before this court
              </p>
            </div>
            <p className="text-xs tabular-nums text-muted-foreground">
              {nf0.format(court.mdl_actions)} pending actions · as of{" "}
              {court.mdl_as_of || "Not recorded"}
            </p>
          </div>
          {court.mdls.length ? (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border-strong">
                    <th scope="col" className={`${thBase} pl-4`}>
                      MDL
                    </th>
                    <th scope="col" className={thBase}>
                      Title
                    </th>
                    <th scope="col" className={thBase}>
                      Type
                    </th>
                    <th scope="col" className={thBase}>
                      Presiding judge
                    </th>
                    <th scope="col" className={`${thNum} pr-4`}>
                      Pending / total actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {court.mdls.map((m) => {
                    const ratio = m.total > 0 ? Math.min(100, (m.pending / m.total) * 100) : 0;
                    return (
                      <tr
                        key={m.mdl}
                        className="border-b border-border last:border-0 hover:bg-muted/50"
                      >
                        <td className={`${tdBase} pl-4 whitespace-nowrap`}>
                          <Link
                            to="/records/$dataset/$id"
                            params={{ dataset: "mdl_analytics", id: String(m.mdl) }}
                            className="font-medium tabular-nums text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            MDL No. {m.mdl}
                          </Link>
                        </td>
                        <td className={`${tdBase} w-full max-w-0`}>
                          <span className="block truncate" title={m.title}>
                            {m.title}
                          </span>
                        </td>
                        <td
                          className={`${tdBase} whitespace-nowrap ${m.type === null ? "text-muted-foreground" : ""}`}
                        >
                          {m.type ?? "Not recorded"}
                        </td>
                        <td
                          className={`${tdBase} whitespace-nowrap ${m.judge === null ? "text-muted-foreground" : ""}`}
                        >
                          {m.judge ?? "Not recorded"}
                        </td>
                        <td className={`${tdNum} pr-4`}>
                          <span className="inline-flex items-center gap-2">
                            <span
                              className="h-1.5 w-16 rounded-full bg-muted"
                              role="img"
                              aria-label={`${nf0.format(m.pending)} of ${nf0.format(m.total)} actions pending`}
                            >
                              <span
                                className="block h-full rounded-full bg-primary"
                                style={{ width: `${ratio}%` }}
                              />
                            </span>
                            {nf0.format(m.pending)} / {nf0.format(m.total)}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyNote />
          )}
        </section>

        <section
          aria-label="Sitting judges"
          className="rounded-lg border border-border bg-card shadow-card"
        >
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-base font-semibold text-foreground">Judges</h2>
            <p className="text-xs text-muted-foreground">Article III judges serving this court</p>
          </div>
          {judges.length ? (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border-strong">
                    <th scope="col" className={`${thBase} pl-4`}>
                      Judge
                    </th>
                    <th scope="col" className={thBase}>
                      Status
                    </th>
                    <th scope="col" className={thBase}>
                      Appointed by
                    </th>
                    <th scope="col" className={thBase}>
                      Commissioned
                    </th>
                    <th scope="col" className={thNum}>
                      MDLs
                    </th>
                    <th scope="col" className={`${thNum} pr-4`}>
                      MDL actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {judges.map((j) => (
                    <tr
                      key={j.nid}
                      className="border-b border-border last:border-0 hover:bg-muted/50"
                    >
                      <th scope="row" className={`${tdBase} pl-4 text-left whitespace-nowrap`}>
                        {j.profileId ? (
                          <Link
                            to="/judges/$id"
                            params={{ id: j.profileId }}
                            className="font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            {j.name}
                          </Link>
                        ) : (
                          <span className="font-medium">{j.name}</span>
                        )}
                      </th>
                      <td className={`${tdBase} whitespace-nowrap`}>
                        <span
                          className={`inline-flex rounded-md border border-border px-1.5 py-0.5 text-xs font-medium ${
                            /active/i.test(j.status)
                              ? "bg-primary/10 text-primary"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {j.status}
                        </span>
                      </td>
                      <td className={`${tdBase} whitespace-nowrap`}>
                        {j.president} <span className="text-muted-foreground">({j.party})</span>
                      </td>
                      <td
                        className={`${tdBase} whitespace-nowrap tabular-nums ${j.commission === null ? "text-muted-foreground" : ""}`}
                      >
                        {j.commission ?? "Not recorded"}
                      </td>
                      <td className={tdNum}>{nf0.format(j.mdls)}</td>
                      <td className={`${tdNum} pr-4`}>{nf0.format(j.mdlActions)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyNote />
          )}
        </section>
      </div>
    </div>
  );
}
