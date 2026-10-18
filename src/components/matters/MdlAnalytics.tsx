import { useMemo, useState } from "react";
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
import { ArrowDownRight, ArrowUpRight, Search } from "lucide-react";
import { ChartCard } from "@/components/fda-analytics/FdaCharts";
import { FDA_COLORS } from "@/components/fda-analytics/chartView";
import {
  getMdlAnalytics,
  type GroupStat,
  type MdlAnalytics as Data,
  type MdlRow,
} from "@/lib/external/mdlAnalytics.functions";

export const mdlAnalyticsQuery = {
  queryKey: ["mdl-analytics"],
  queryFn: () => getMdlAnalytics(),
  staleTime: 10 * 60 * 1000,
};

const n = (v: number | null | undefined) =>
  typeof v === "number" ? v.toLocaleString("en-US") : "Not recorded";
const compact = (v: number) =>
  new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(v);
const signed = (v: number | null) =>
  v === null ? "—" : v > 0 ? `+${v.toLocaleString("en-US")}` : v.toLocaleString("en-US");
const month = (iso: string) =>
  new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", {
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  });
const axis = { fontSize: 11, fill: "var(--muted-foreground)" };

export function MdlAnalytics() {
  const q = useQuery(mdlAnalyticsQuery);
  if (q.isLoading) return <Skeleton />;
  if (q.isError)
    return (
      <Notice tone="error">
        MDL analytics could not be loaded. {q.error instanceof Error ? q.error.message : ""}
      </Notice>
    );
  if (!q.data) return <Notice>MDL analytics have not been published yet.</Notice>;
  return <Dashboard data={q.data} />;
}

function Dashboard({ data }: { data: Data }) {
  const { overview: o } = data;
  const pending = useMemo(() => data.mdls.filter((m) => m.status === "pending"), [data.mdls]);
  const portfolio = o.portfolio.map((p) => ({
    date: month(p.date),
    "All MDLs": p.pending,
    "Mass tort": p.mass_tort_pending,
  }));
  const first = o.portfolio[0];
  const last = o.portfolio[o.portfolio.length - 1];
  const portfolioChange = first && last ? last.pending - first.pending : null;
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Computed from {o.reports} JPML monthly reports ({o.first_report} to {o.as_of}): Distribution
        of Pending MDL Dockets by Actions Pending, docket type and terminated-litigation reports.
        Counts are as printed by the Panel. Mass tort means products liability, common disaster and
        air disaster dockets. Centralization grant rates, hearing outcomes and transferee-court MDL
        pages are in{" "}
        <Link to="/matters/intel" className="text-primary hover:underline">
          MDL intelligence
        </Link>
        .
      </p>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Pending MDLs" value={n(o.pending_mdls)} />
        <Kpi label="Pending actions" value={n(o.pending_actions)} />
        <Kpi
          label="Mass-tort share of actions"
          value={`${((100 * o.mass_tort_actions) / Math.max(1, o.pending_actions)).toFixed(1)}%`}
          note={`${n(o.mass_tort_mdls)} dockets`}
        />
        <Kpi label="Top 10 dockets' share" value={`${o.top10_share_pct}%`} />
        <Kpi label="Median years since transfer" value={o.median_age_years?.toString() ?? "—"} />
        <Kpi
          label={`Change since ${month(o.first_report)}`}
          value={signed(portfolioChange)}
          note="includes dockets since terminated"
        />
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <ChartCard
          title="Pending actions over time"
          subtitle="Sum of actions now pending across listed MDLs, each monthly report"
        >
          <div className="h-64 px-2 py-2">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={portfolio} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis dataKey="date" tick={axis} interval="preserveStartEnd" minTickGap={24} />
                <YAxis tick={axis} tickFormatter={compact} width={48} />
                <Tooltip formatter={(v: number) => v.toLocaleString("en-US")} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line
                  dataKey="All MDLs"
                  stroke={FDA_COLORS[0]}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
                <Line
                  dataKey="Mass tort"
                  stroke={FDA_COLORS[2]}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
        <ChartCard
          title="Pending actions by litigation type"
          subtitle={`JPML docket type, ${o.as_of}`}
        >
          <div className="h-64 px-2 py-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={o.by_type.map((t) => ({ type: t.key, pending: t.pending, mdls: t.mdls }))}
                layout="vertical"
                margin={{ top: 4, right: 16, bottom: 0, left: 8 }}
              >
                <CartesianGrid stroke="var(--border)" horizontal={false} />
                <XAxis type="number" tick={axis} tickFormatter={compact} scale="sqrt" />
                <YAxis type="category" dataKey="type" tick={axis} width={150} interval={0} />
                <Tooltip
                  formatter={(v: number, _k, p) => [
                    `${v.toLocaleString("en-US")} actions · ${p.payload.mdls} dockets`,
                    "Pending",
                  ]}
                />
                <Bar
                  dataKey="pending"
                  fill={FDA_COLORS[1]}
                  radius={[0, 3, 3, 0]}
                  isAnimationActive={false}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
      </div>

      <MdlTable rows={pending} asOf={o.as_of} />

      <div className="grid gap-3 lg:grid-cols-2">
        <Movers title="Fastest growing (12 months)" rows={pending} direction="up" />
        <Movers title="Fastest shrinking (12 months)" rows={pending} direction="down" />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Leaders
          title="Transferee districts"
          subtitle="by pending actions"
          groups={o.by_district}
        />
        <Leaders title="Transferee judges" subtitle="by pending actions" groups={o.by_judge} />
      </div>

      <Terminated data={data} />
    </div>
  );
}

function Kpi({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-md border border-border bg-surface px-3 py-2.5">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-sans text-xl font-semibold tabular-nums">{value}</div>
      {note ? <div className="text-xs text-muted-foreground">{note}</div> : null}
    </div>
  );
}

function Spark({ series }: { series: MdlRow["series"] }) {
  if (series.length < 2) return <span className="text-xs text-muted-foreground">—</span>;
  const values = series.map((p) => p.pending);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const w = 72;
  const h = 20;
  const points = values
    .map((v, i) => `${(i / (values.length - 1)) * w},${h - ((v - min) / span) * (h - 2) - 1}`)
    .join(" ");
  const up = values[values.length - 1]! >= values[0]!;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden className="overflow-visible">
      <polyline
        points={points}
        fill="none"
        stroke={up ? FDA_COLORS[2] : FDA_COLORS[1]}
        strokeWidth={1.5}
      />
    </svg>
  );
}

type SortKey = "pending" | "change12m" | "new12m" | "resolved12m" | "ageYears" | "mdl";

function MdlTable({ rows, asOf }: { rows: MdlRow[]; asOf: string }) {
  const [query, setQuery] = useState("");
  const [massOnly, setMassOnly] = useState(true);
  const [type, setType] = useState("");
  const [sort, setSort] = useState<SortKey>("pending");
  const types = useMemo(
    () => [...new Set(rows.map((r) => r.type).filter((t): t is string => !!t))].sort(),
    [rows],
  );
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows
      .filter((r) => (!massOnly || r.massTort) && (!type || r.type === type))
      .filter(
        (r) =>
          !needle ||
          `${r.mdl} ${r.title} ${r.judge ?? ""} ${r.district ?? ""}`.toLowerCase().includes(needle),
      )
      .sort((a, b) => {
        if (sort === "mdl") return a.mdl - b.mdl;
        return (b[sort] ?? -Infinity) - (a[sort] ?? -Infinity);
      });
  }, [rows, query, massOnly, type, sort]);
  const header = (key: SortKey, label: string) => (
    <th scope="col" className="px-2 py-2 text-right font-medium">
      <button
        type="button"
        onClick={() => setSort(key)}
        className={`hover:text-foreground ${sort === key ? "text-foreground underline underline-offset-4" : ""}`}
      >
        {label}
      </button>
    </th>
  );
  return (
    <section className="rounded-md border border-border bg-surface" aria-label="Pending MDLs">
      <div className="flex flex-wrap items-center gap-2 border-b border-border/70 px-3 py-2">
        <h3 className="mr-auto font-sans text-sm font-semibold">
          Pending MDLs{" "}
          <span className="font-normal text-muted-foreground">
            · {shown.length} shown · {asOf}
          </span>
        </h3>
        <label className="relative">
          <Search
            className="pointer-events-none absolute left-2 top-2 size-3.5 text-muted-foreground"
            aria-hidden
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="MDL, litigation, judge, district"
            aria-label="Filter MDLs"
            className="h-8 w-60 rounded-md border border-border bg-background pl-7 pr-2 text-xs"
          />
        </label>
        <select
          value={type}
          onChange={(e) => setType(e.target.value)}
          aria-label="Litigation type"
          className="h-8 rounded-md border border-border bg-background px-2 text-xs"
        >
          <option value="">All types</option>
          {types.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            checked={massOnly}
            onChange={(e) => setMassOnly(e.target.checked)}
          />
          Mass tort only
        </label>
      </div>
      <div className="max-h-[560px] overflow-auto">
        <table className="w-full min-w-[980px] text-xs">
          <thead className="sticky top-0 z-10 bg-surface text-muted-foreground shadow-[inset_0_-1px_0_var(--border)]">
            <tr>
              <th scope="col" className="px-2 py-2 text-left font-medium">
                <button
                  type="button"
                  onClick={() => setSort("mdl")}
                  className="hover:text-foreground"
                >
                  MDL
                </button>
              </th>
              <th scope="col" className="px-2 py-2 text-left font-medium">
                Litigation
              </th>
              <th scope="col" className="px-2 py-2 text-left font-medium">
                Court · judge
              </th>
              {header("pending", "Pending")}
              {header("change12m", "12-mo change")}
              {header("new12m", "New 12 mo")}
              {header("resolved12m", "Resolved 12 mo")}
              {header("ageYears", "Years")}
              <th scope="col" className="px-2 py-2 text-left font-medium">
                Trend
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.mdl} className="border-t border-border/60 hover:bg-muted/40">
                <td className="px-2 py-1.5 tabular-nums">
                  <Link
                    to="/matters/lens/$mdl"
                    params={{ mdl: String(r.mdl) }}
                    className="font-medium text-primary hover:underline"
                    title="Open the case lens: court, judge, regulator, flags and peers"
                  >
                    {r.mdl}
                  </Link>
                </td>
                <td className="max-w-[360px] px-2 py-1.5">
                  <div className="truncate" title={r.title}>
                    {r.title.replace(/^IN RE:\s*/i, "")}
                  </div>
                  <div className="text-muted-foreground">{r.type ?? "Type not recorded"}</div>
                </td>
                <td className="px-2 py-1.5">
                  <div>{r.district ?? "—"}</div>
                  <div className="text-muted-foreground">{r.judge ?? "—"}</div>
                </td>
                <td className="px-2 py-1.5 text-right font-medium tabular-nums">{n(r.pending)}</td>
                <td
                  className={`px-2 py-1.5 text-right tabular-nums ${r.change12m && r.change12m > 0 ? "font-semibold text-foreground" : "text-muted-foreground"}`}
                >
                  {signed(r.change12m)}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums">
                  {r.new12m === null ? "—" : n(r.new12m)}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums">
                  {r.resolved12m === null ? "—" : n(r.resolved12m)}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums">{r.ageYears ?? "—"}</td>
                <td className="px-2 py-1.5">
                  <Spark series={r.series} />
                </td>
              </tr>
            ))}
            {!shown.length ? (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-muted-foreground">
                  No MDLs match these filters.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <p className="border-t border-border/60 px-3 py-1.5 text-xs text-muted-foreground">
        New = growth in total historical actions; resolved = new minus the change in pending. A dash
        means fewer than 12 months of reports list the docket.
      </p>
    </section>
  );
}

function Movers({
  title,
  rows,
  direction,
}: {
  title: string;
  rows: MdlRow[];
  direction: "up" | "down";
}) {
  const list = rows
    .filter((r) => r.change12m !== null && (direction === "up" ? r.change12m > 0 : r.change12m < 0))
    .sort((a, b) =>
      direction === "up" ? b.change12m! - a.change12m! : a.change12m! - b.change12m!,
    )
    .slice(0, 8);
  const Icon = direction === "up" ? ArrowUpRight : ArrowDownRight;
  return (
    <ChartCard title={title} subtitle="Change in actions pending">
      <ol className="divide-y divide-border/60 text-xs">
        {list.map((r) => (
          <li key={r.mdl} className="flex items-center gap-2 px-3 py-1.5">
            <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <span className="w-10 shrink-0 tabular-nums text-muted-foreground">{r.mdl}</span>
            <span className="min-w-0 flex-1 truncate" title={r.title}>
              {r.title.replace(/^IN RE:\s*/i, "")}
            </span>
            <span className="w-16 text-right font-medium tabular-nums">{signed(r.change12m)}</span>
            <span className="w-16 text-right tabular-nums text-muted-foreground">
              {n(r.pending)}
            </span>
          </li>
        ))}
        {!list.length ? (
          <li className="px-3 py-4 text-muted-foreground">None in this period.</li>
        ) : null}
      </ol>
    </ChartCard>
  );
}

function Leaders({
  title,
  subtitle,
  groups,
}: {
  title: string;
  subtitle: string;
  groups: GroupStat[];
}) {
  const max = Math.max(1, ...groups.map((g) => g.pending));
  return (
    <ChartCard title={title} subtitle={subtitle}>
      <ol className="max-h-80 divide-y divide-border/60 overflow-auto text-xs">
        {groups.slice(0, 15).map((g) => (
          <li key={g.key} className="px-3 py-1.5">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate font-medium" title={g.key}>
                {g.key}
              </span>
              <span className="text-muted-foreground">
                {g.mdls} MDL{g.mdls === 1 ? "" : "s"}
              </span>
              <span className="w-16 text-right tabular-nums">{n(g.pending)}</span>
            </div>
            <div className="mt-1 h-1 rounded bg-muted">
              <div
                className="h-1 rounded bg-primary/70"
                style={{ width: `${(100 * g.pending) / max}%` }}
              />
            </div>
            <div
              className="mt-0.5 truncate text-muted-foreground"
              title={`Largest: ${g.top.map((t) => t.title.replace(/^IN RE:\s*/i, "")).join("; ")}`}
            >
              Largest: {g.top[0]?.title.replace(/^IN RE:\s*/i, "") ?? "—"}
            </div>
          </li>
        ))}
      </ol>
    </ChartCard>
  );
}

function Terminated({ data }: { data: Data }) {
  const t = data.terminated;
  return (
    <section className="space-y-3" aria-label="Terminated MDLs">
      <div>
        <h2 className="font-sans text-base font-semibold">Terminated MDLs, 1968–2025</h2>
        <p className="text-xs text-muted-foreground">
          {n(t.rows)} district entries from the JPML report of litigations terminated through
          September 30, 2025 · {n(t.totals.actions)} actions terminated, {t.totals.remandPct ?? "—"}
          % remanded to transferor courts.
        </p>
      </div>
      <div className="grid gap-3 xl:grid-cols-2">
        <ChartCard
          title="Terminations by decade"
          subtitle="MDL entries terminated and actions resolved"
        >
          <div className="h-60 px-2 py-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={t.byDecade} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis dataKey="decade" tick={axis} />
                <YAxis yAxisId="m" tick={axis} width={36} />
                <YAxis
                  yAxisId="a"
                  orientation="right"
                  tick={axis}
                  tickFormatter={compact}
                  width={44}
                />
                <Tooltip formatter={(v: number) => v.toLocaleString("en-US")} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar
                  yAxisId="m"
                  dataKey="mdls"
                  name="MDL entries"
                  fill={FDA_COLORS[0]}
                  isAnimationActive={false}
                />
                <Bar
                  yAxisId="a"
                  dataKey="actions"
                  name="Actions"
                  fill={FDA_COLORS[3]}
                  isAnimationActive={false}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
        <ChartCard title="Largest terminated MDLs" subtitle="by actions closed plus remanded">
          <ol className="divide-y divide-border/60 text-xs">
            {t.largest.slice(0, 10).map((r) => (
              <li key={`${r.mdl}-${r.district}`} className="flex items-center gap-2 px-3 py-1.5">
                <span className="w-10 shrink-0 tabular-nums text-muted-foreground">{r.mdl}</span>
                <span className="min-w-0 flex-1 truncate" title={r.caption}>
                  {r.caption}
                </span>
                <span className="text-muted-foreground">{r.year}</span>
                <span className="w-20 text-right font-medium tabular-nums">{n(r.actions)}</span>
              </li>
            ))}
          </ol>
        </ChartCard>
      </div>
      <ChartCard
        title="Remand share by circuit"
        subtitle="Remanded actions as a share of terminated actions"
      >
        <div className="grid gap-x-6 px-3 py-2 text-xs sm:grid-cols-2 lg:grid-cols-3">
          {t.byCircuit.map((c) => (
            <div key={c.circuit} className="flex items-center gap-2 py-1">
              <span className="min-w-0 flex-1 truncate" title={c.circuit}>
                {c.circuit}
              </span>
              <span className="text-muted-foreground">{n(c.mdls)} MDLs</span>
              <span className="w-12 text-right tabular-nums">{c.remandPct ?? "—"}%</span>
            </div>
          ))}
        </div>
      </ChartCard>
    </section>
  );
}

function Skeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading MDL analytics">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => (
          <div
            key={i}
            className="h-[70px] animate-pulse rounded-md border border-border bg-muted/50"
          />
        ))}
      </div>
      <div className="h-72 animate-pulse rounded-md border border-border bg-muted/50" />
      <div className="h-96 animate-pulse rounded-md border border-border bg-muted/50" />
    </div>
  );
}

function Notice({ children, tone }: { children: React.ReactNode; tone?: "error" }) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`rounded-md border px-4 py-6 text-sm ${tone === "error" ? "border-destructive/40 text-destructive" : "border-border text-muted-foreground"}`}
    >
      {children}
    </div>
  );
}
