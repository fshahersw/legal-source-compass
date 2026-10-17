import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
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
import { FDA_COLORS } from "@/components/fda-analytics/chartView";
import {
  getCourtAnalytics,
  type CourtAnalytics,
  type NationalDistribution,
} from "@/lib/external/courtAnalytics.functions";

const FCMS_URL =
  "https://www.uscourts.gov/data-news/reports/statistical-reports/federal-court-management-statistics/federal-court-management-statistics-june-2026";
const axis = { fontSize: 11, fill: "var(--muted-foreground)" };
const last = (values: (number | null)[] | undefined) =>
  [...(values ?? [])].reverse().find((v): v is number => typeof v === "number") ?? null;
const prev = (values: (number | null)[] | undefined) => {
  const present = (values ?? []).filter((v): v is number => typeof v === "number");
  return present.length > 1 ? present[present.length - 2]! : null;
};
const fmt = (v: number | null, digits = 0) =>
  v === null
    ? "Not recorded"
    : v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });

export function CourtAnalyticsPanel({ courtId }: { courtId: string }) {
  const q = useQuery({
    queryKey: ["court-analytics", courtId],
    queryFn: () => getCourtAnalytics({ data: { id: courtId } }),
    staleTime: 10 * 60 * 1000,
  });
  if (q.isLoading)
    return (
      <div
        className="mb-5 h-56 animate-pulse rounded-lg border border-border bg-muted/40"
        aria-busy="true"
        aria-label="Loading caseload statistics"
      />
    );
  if (q.isError)
    return (
      <p
        role="alert"
        className="mb-5 rounded-lg border border-border px-4 py-3 text-xs text-muted-foreground"
      >
        Caseload statistics could not be loaded.
      </p>
    );
  if (!q.data) return null;
  return <Panel court={q.data.court} distributions={q.data.national?.distributions ?? {}} />;
}

function Panel({
  court,
  distributions,
}: {
  court: CourtAnalytics;
  distributions: NationalDistribution;
}) {
  const m = court.metrics;
  const filings = last(m["filings"]);
  const priorFilings = prev(m["filings"]);
  const yoy =
    filings !== null && priorFilings ? (100 * (filings - priorFilings)) / priorFilings : null;
  const trend = court.years.map((year, i) => ({
    year: String(year),
    Filings: m["filings"]?.[i] ?? null,
    Terminations: m["terminations"]?.[i] ?? null,
    Pending: m["pending"]?.[i] ?? null,
  }));
  const nos = [...court.nature_of_suit].sort((a, b) => b.filings - a.filings);
  const maxNos = Math.max(1, ...nos.map((x) => x.filings));
  return (
    <section
      className="mb-5 rounded-lg border border-border bg-surface"
      aria-label="Caseload statistics"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border/70 px-4 py-2.5">
        <h2 className="font-sans text-sm font-semibold">Caseload</h2>
        <p className="text-xs text-muted-foreground">
          12 months ending June 30, 2026 ·{" "}
          <a
            href={FCMS_URL}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2"
          >
            US Courts Federal Court Management Statistics
          </a>
        </p>
      </header>
      <div className="grid grid-cols-2 gap-px bg-border/60 sm:grid-cols-3 lg:grid-cols-6">
        <Stat
          label="Judgeships"
          value={fmt(last(m["judgeships"]))}
          note={`${fmt(last(m["vacant_judgeship_months"]), 1)} vacant judgeship months`}
        />
        <Stat
          label="Filings"
          value={fmt(filings)}
          note={yoy === null ? undefined : `${yoy > 0 ? "+" : ""}${yoy.toFixed(1)}% vs prior year`}
        />
        <Stat label="Pending cases" value={fmt(last(m["pending"]))} />
        <Stat
          label="Weighted filings per judgeship"
          value={fmt(last(m["per_judge_weighted_filings"]))}
          range={distributions["per_judge_weighted_filings"]}
          current={last(m["per_judge_weighted_filings"])}
        />
        <Stat
          label="Median months, civil filing to disposition"
          value={fmt(last(m["median_months_civil"]), 1)}
          range={distributions["median_months_civil"]}
          current={last(m["median_months_civil"])}
          note={rank(court, "median_months_civil")}
        />
        <Stat
          label="Median months, civil filing to trial"
          value={fmt(last(m["median_months_civil_to_trial"]), 1)}
          range={distributions["median_months_civil_to_trial"]}
          current={last(m["median_months_civil_to_trial"])}
          note={rank(court, "median_months_civil_to_trial")}
        />
      </div>
      <div className="grid gap-4 p-4 lg:grid-cols-2">
        <div className="min-w-0">
          <h3 className="mb-1 text-xs font-semibold text-muted-foreground">Six-year trend</h3>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trend} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis dataKey="year" tick={axis} />
                <YAxis
                  tick={axis}
                  width={48}
                  tickFormatter={(v: number) =>
                    new Intl.NumberFormat("en-US", { notation: "compact" }).format(v)
                  }
                />
                <Tooltip formatter={(v: number) => v.toLocaleString("en-US")} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line
                  dataKey="Filings"
                  stroke={FDA_COLORS[0]}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
                <Line
                  dataKey="Terminations"
                  stroke={FDA_COLORS[1]}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
                <Line
                  dataKey="Pending"
                  stroke={FDA_COLORS[2]}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {fmt(last(m["civil_over_3y_pct"]), 1)}% of pending civil cases are over three years old
            ({fmt(last(m["civil_over_3y_count"]))} cases). {fmt(last(m["per_judge_trials"]))} trials
            completed per judgeship.
          </p>
        </div>
        <div className="min-w-0">
          <h3 className="mb-1 text-xs font-semibold text-muted-foreground">
            Civil filings by nature of suit · {fmt(court.civil_total)} total
          </h3>
          <ol className="space-y-1 text-xs">
            {nos.map((x) => (
              <li
                key={x.category}
                className="grid grid-cols-[minmax(0,1fr)_64px_56px] items-center gap-2"
              >
                <div className="min-w-0">
                  <div className="truncate" title={x.category}>
                    {x.category}
                  </div>
                  <div className="h-1 rounded bg-muted">
                    <div
                      className="h-1 rounded bg-primary/70"
                      style={{ width: `${(100 * x.filings) / maxNos}%` }}
                    />
                  </div>
                </div>
                <span className="text-right tabular-nums">{fmt(x.filings)}</span>
                <span className="text-right tabular-nums text-muted-foreground">
                  {x.change_pct === null ? "—" : `${x.change_pct > 0 ? "+" : ""}${x.change_pct}%`}
                </span>
              </li>
            ))}
          </ol>
          <p className="mt-1 text-xs text-muted-foreground">
            Change is against the 12 months ending June 30, 2025.
          </p>
        </div>
      </div>
      {court.mdls.length ? (
        <div className="border-t border-border/70 px-4 py-3">
          <h3 className="mb-1.5 text-xs font-semibold text-muted-foreground">
            Pending MDLs in this court · {court.mdls.length} dockets ·{" "}
            {court.mdl_actions.toLocaleString("en-US")} actions · JPML {court.mdl_as_of}
          </h3>
          <ul className="divide-y divide-border/60 text-xs">
            {court.mdls.slice(0, 12).map((x) => (
              <li key={x.mdl} className="flex items-center gap-2 py-1.5">
                <Link
                  to="/records/$dataset/$id"
                  params={{ dataset: "mdl_analytics", id: String(x.mdl) }}
                  className="w-10 shrink-0 font-medium tabular-nums text-primary hover:underline"
                >
                  {x.mdl}
                </Link>
                <span className="min-w-0 flex-1 truncate" title={x.title}>
                  {x.title.replace(/^IN RE:\s*/i, "")}
                </span>
                <span className="hidden text-muted-foreground sm:inline">{x.judge}</span>
                <span className="w-16 text-right tabular-nums">
                  {x.pending.toLocaleString("en-US")}
                </span>
              </li>
            ))}
          </ul>
          {court.mdls.length > 12 ? (
            <Link
              to="/matters/analytics"
              className="mt-1 inline-block text-xs text-primary hover:underline"
            >
              All {court.mdls.length} MDLs in MDL analytics
            </Link>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function rank(court: CourtAnalytics, key: string) {
  const s = court.standing[key];
  return s?.us ? `Rank ${s.us} of 94 nationally` : undefined;
}

function Stat({
  label,
  value,
  note,
  range,
  current,
}: {
  label: string;
  value: string;
  note?: string | undefined;
  range?: { min: number; median: number; max: number } | undefined;
  current?: number | null;
}) {
  const pos =
    range && typeof current === "number" && range.max > range.min
      ? Math.min(100, Math.max(0, (100 * (current - range.min)) / (range.max - range.min)))
      : null;
  const mid =
    range && range.max > range.min
      ? (100 * (range.median - range.min)) / (range.max - range.min)
      : null;
  return (
    <div className="bg-surface px-4 py-3">
      <div className="text-xs leading-4 text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
      {pos !== null && mid !== null ? (
        <div
          className="relative mt-1.5 h-1 rounded bg-muted"
          title={`National range ${range!.min}–${range!.max}, median ${range!.median}`}
        >
          <span
            className="absolute -top-0.5 h-2 w-px bg-muted-foreground/60"
            style={{ left: `${mid}%` }}
          />
          <span
            className="absolute -top-1 size-2.5 -translate-x-1/2 rounded-full bg-primary"
            style={{ left: `${pos}%` }}
          />
        </div>
      ) : null}
      {note ? <div className="mt-1 text-xs text-muted-foreground">{note}</div> : null}
    </div>
  );
}
