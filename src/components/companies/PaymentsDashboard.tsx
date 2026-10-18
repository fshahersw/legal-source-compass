/** /companies/payments: CMS Open Payments manufacturer ranking, nature mix, state map and MAUDE comparison. */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownWideNarrow, Info, Search } from "lucide-react";
import { ChartCard, ChartUnavailable } from "@/components/fda-analytics/FdaCharts";
import { StateFlag } from "@/components/corpus/EntityArtwork";
import { UsMap } from "@/components/corpus/UsMap";
import { Input } from "@/components/ui/input";
import { useCorpus } from "@/lib/corpus/store";
import { stateByUsps } from "@/lib/corpus/geo";
import { cn } from "@/lib/utils";
import {
  getPaymentsDashboard,
  median,
  pearson,
  PAYMENT_YEARS,
  type ManufacturerSummary,
  type PaymentsDashboard as Dashboard,
  type StatePayments,
} from "@/lib/external/openPayments.functions";
import {
  ManufacturerPaymentsView,
  manufacturerPaymentsQuery,
  OpenPaymentsPanel,
} from "./OpenPaymentsPanel";
import {
  fullUsd,
  int,
  PaymentsScatter,
  pct,
  ShareBars,
  SparkBars,
  usd,
  YearBars,
  type ScatterPoint,
} from "./PaymentsCharts";
import { kpiTooltip, paymentsNoMatchText } from "./companyViewNotes";

export const paymentsDashboardQuery = {
  queryKey: ["open-payments-dashboard"],
  queryFn: () => getPaymentsDashboard(),
  staleTime: 10 * 60 * 1000,
};

export type PaymentsSearch = {
  year?: string | undefined;
  metric?: "general" | "research" | undefined;
  q?: string | undefined;
  m?: string | undefined;
  sort?: "value" | "change" | "device" | undefined;
  st?: string | undefined;
  /** Company-name lookup rendered with OpenPaymentsPanel (same exact-name rule as company pages). */
  name?: string | undefined;
};
type Period = number | "all";
type Metric = "general" | "research";

const LATEST: number = PAYMENT_YEARS[PAYMENT_YEARS.length - 1] ?? 2025;
const PAGE = 25;
const SURGE_RULE =
  "Surge: latest-year general payments at least 2× the entity's own 2019–2024 median and at least $1M. Drop: at most half that median, with a median of at least $1M.";
const STATE_RULE =
  "Flagged when the state's value is more than 2 standard deviations from the 50-state + DC mean (|z| > 2).";
const MIN_COVERAGE = 0.8;
const MIN_REPORTS = 50;
const SCATTER_RULE = `r and outlier flags use only manufacturers whose MAUDE name coverage is at least ${MIN_COVERAGE * 100}% with at least ${MIN_REPORTS} attributed reports in the period (dark points); grey points fail that test and are shown for reference only. Pearson r is on log10 values; red points have a standardized residual beyond ±2 from the log–log least-squares line of the dark points.`;
const ASSOCIATION_NOTE =
  "Association only: payments and report volume both grow with company size and product volume, so the chart supports no causal reading.";
const ARCHIVE_NOTE = "Archived CMS detail file (final 2025 refresh)";
const VINTAGE_NOTE =
  "Population for 2017–2019 is Census Vintage 2020 and for 2020 on Vintage 2025 (as joined in state_metrics_profiles), so per-resident values change basis at 2020.";

function periodValue(
  m: { years: { year: number; general: number | null; research: number | null }[] },
  totals: Record<Metric, number> | null,
  period: Period,
  metric: Metric,
) {
  if (period === "all")
    return totals ? totals[metric] : m.years.reduce((a, y) => a + (y[metric] ?? 0), 0);
  return m.years.find((y) => y.year === period)?.[metric] ?? 0;
}

export function trendFlag(m: ManufacturerSummary): "surge" | "drop" | null {
  const base = median(
    m.years.filter((y) => y.year >= 2019 && y.year < LATEST).map((y) => y.general ?? 0),
  );
  const latest = m.years.find((y) => y.year === LATEST)?.general ?? null;
  if (base == null || latest == null) return null;
  if (latest >= 1e6 && latest >= 2 * base) return "surge";
  if (base >= 1e6 && latest <= 0.5 * base) return "drop";
  return null;
}

function yoy(m: ManufacturerSummary) {
  const a = m.years.find((y) => y.year === LATEST)?.general;
  const b = m.years.find((y) => y.year === LATEST - 1)?.general;
  return a != null && b ? a / b - 1 : null;
}

function Kpi({ label, value, note }: { label: string; value: string; note?: string | undefined }) {
  return (
    <div
      className="min-w-0 rounded-md border border-border bg-surface px-3 py-2"
      title={kpiTooltip({ label, value, note })}
    >
      <p className="line-clamp-2 break-words text-[11px] leading-4 text-muted-foreground">
        {label}
      </p>
      <p className="font-mono text-lg font-semibold leading-tight">{value}</p>
      {note ? (
        <p className="line-clamp-2 break-words text-[11px] leading-4 text-muted-foreground">
          {note}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Empty state shared by every view built from the filtered manufacturer ranking. Only the copy
 * with `announce` is a live region, so screen readers hear the sentence once per change, not
 * once per card.
 */
function NoMatch({
  query,
  deviceOnly,
  onClear,
  announce = false,
  className,
}: {
  query: string;
  deviceOnly: boolean;
  onClear: () => void;
  announce?: boolean;
  className?: string | undefined;
}) {
  return (
    <p
      role={announce ? "status" : undefined}
      className={cn("px-3 py-6 text-center text-sm text-muted-foreground", className)}
    >
      {paymentsNoMatchText(query, deviceOnly)}{" "}
      <button type="button" className="text-primary underline" onClick={onClear}>
        Clear filters
      </button>
    </p>
  );
}

function Toggle<T extends string | number>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-md border px-2 py-0.5 text-xs",
            value === o.value
              ? "border-primary bg-primary/10 text-primary"
              : "border-border hover:bg-muted",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function stateValues(d: Dashboard, year: number, metric: Metric) {
  const rows = d.states
    .filter((s) => stateByUsps.has(s.state))
    .map((s) => {
      const y = s.years.find((v) => v.year === year);
      const amount = y?.[metric] ?? null;
      const pop = d.population?.[s.state]?.[String(year)] ?? null;
      return {
        state: s,
        amount,
        pop,
        value: amount == null ? null : d.population ? (pop ? amount / pop : null) : amount,
      };
    });
  const vals = rows.flatMap((r) => (r.value == null ? [] : [r.value]));
  const mean = vals.reduce((a, b) => a + b, 0) / (vals.length || 1);
  const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / (vals.length || 1));
  return rows
    .map((r) => ({ ...r, z: r.value == null || !sd ? null : (r.value - mean) / sd }))
    .sort((a, b) => (b.value ?? -1) - (a.value ?? -1));
}

function scatterPoints(d: Dashboard, period: Period) {
  const byId = new Map(d.manufacturers.map((m) => [m.entityId, m]));
  const raw: ScatterPoint[] = [];
  let excluded = 0;
  for (const a of d.adverse.filter((x) => x.kind === "open_payments")) {
    const m = byId.get(a.entityId);
    if (!a.matched || !m) continue;
    const payments =
      period === "all" ? m.totals.general : (m.years.find((y) => y.year === period)?.general ?? 0);
    const year = period === "all" ? null : a.years.find((y) => y.year === period);
    const reports = period === "all" ? (a.total ?? 0) : (year?.reports ?? 0);
    const coverage = period === "all" ? a.coverage : (year?.coverage ?? null);
    const eligible = coverage != null && coverage >= MIN_COVERAGE && reports >= MIN_REPORTS;
    if (payments > 0 && reports > 0)
      raw.push({
        id: m.entityId,
        name: m.name,
        payments,
        reports,
        coverage,
        eligible,
        flagged: false,
      });
    else excluded++;
  }
  // r and residual flags are computed on eligible points only; coverage cannot be judged otherwise.
  const used = raw.filter((p) => p.eligible);
  const xs = used.map((p) => Math.log10(p.payments));
  const ys = used.map((p) => Math.log10(p.reports));
  const r = pearson(xs, ys);
  if (used.length >= 3) {
    const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
    const my = ys.reduce((a, b) => a + b, 0) / ys.length;
    const sxx = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
    const slope = sxx ? xs.reduce((a, x, i) => a + (x - mx) * (ys[i]! - my), 0) / sxx : 0;
    const resid = ys.map((y, i) => y - (my + slope * (xs[i]! - mx)));
    const sd = Math.sqrt(resid.reduce((a, e) => a + e * e, 0) / Math.max(1, resid.length - 2));
    used.forEach((p, i) => (p.flagged = sd > 0 && Math.abs(resid[i]! / sd) > 2));
  }
  return { points: raw, r, n: used.length, excluded };
}

function StateDetail({ s, metric, year }: { s: StatePayments; metric: Metric; year: number }) {
  const rows = s.years.map((y) => ({
    year: y.year,
    general: y.general,
    research: y.research,
    archive: y.source === "archive",
  }));
  const nature = s.natureByYear[String(year)] ?? [];
  const total = nature.reduce((a, n) => a + n.amount, 0);
  const current = s.years.find((y) => y.year === year);
  return (
    <div className="space-y-2 border-t border-border/70 px-3 py-2">
      <p className="flex flex-wrap items-center gap-1.5 text-xs font-semibold">
        <StateFlag state={s.state} className="h-3" /> {s.name}
        <span className="font-normal text-muted-foreground">
          {current?.physicians != null || current?.teachingHospitals != null
            ? `· ${int(current?.physicians)} physicians and ${int(current?.teachingHospitals)} teaching hospitals received general payments in ${year}`
            : `· recipient counts are not recorded for ${year} (archived detail file)`}
        </span>
      </p>
      <YearBars rows={rows} show={metric} height={150} />
      <p className="px-3 text-[11px] font-medium">Nature of general payments, {year}</p>
      <ShareBars
        rows={nature.map((n) => ({ key: n.label, label: n.label, amount: n.amount }))}
        total={total}
        limit={5}
      />
    </div>
  );
}

export function PaymentsDashboard({
  search,
  onSearch,
}: {
  search: PaymentsSearch;
  onSearch: (patch: Partial<PaymentsSearch>) => void;
}) {
  const q = useQuery(paymentsDashboardQuery);
  const corpus = useCorpus();
  const [shown, setShown] = useState(PAGE);
  const [deviceOnly, setDeviceOnly] = useState(false);
  const period: Period =
    search.year &&
    /^\d{4}$/.test(search.year) &&
    PAYMENT_YEARS.includes(Number(search.year) as (typeof PAYMENT_YEARS)[number])
      ? Number(search.year)
      : "all";
  const metric: Metric = search.metric === "research" ? "research" : "general";
  const sort = search.sort ?? "value";
  const query = (search.q ?? "").trim().toLowerCase();
  const d = q.data;
  const adverseById = useMemo(
    () =>
      new Map(
        (d?.adverse ?? []).filter((a) => a.kind === "open_payments").map((a) => [a.entityId, a]),
      ),
    [d],
  );

  const national = d?.national ?? null;
  const nationalValue = (m: Metric, p: Period) =>
    national
      ? p === "all"
        ? national.years.reduce((a, y) => a + (y[m] ?? 0), 0)
        : (national.years.find((y) => y.year === p)?.[m] ?? null)
      : null;

  const ranked = useMemo(() => {
    if (!d) return [];
    const rows = d.manufacturers
      .filter((m) => !query || [m.name, ...m.altNames].some((n) => n.toLowerCase().includes(query)))
      .filter((m) => !deviceOnly || (m.deviceShare ?? 0) >= 0.1)
      .map((m) => ({
        m,
        value: periodValue(m, m.totals, period, metric),
        change: yoy(m),
        flag: trendFlag(m),
        maude: adverseById.get(m.entityId) ?? null,
      }));
    const key = (r: (typeof rows)[number]) =>
      sort === "change"
        ? (r.change ?? -Infinity)
        : sort === "device"
          ? (r.m.deviceShare ?? -1)
          : r.value;
    return rows.sort((a, b) => key(b) - key(a) || a.m.rank - b.m.rank);
  }, [d, query, deviceOnly, period, metric, sort, adverseById]);

  const selected =
    search.m && d ? (d.manufacturers.find((m) => m.entityId === search.m) ?? null) : null;
  const detail = useQuery({
    ...manufacturerPaymentsQuery(selected?.name ?? "", selected?.entityId),
    enabled: !!selected,
  });

  if (q.isLoading)
    return (
      <div className="space-y-2" aria-busy="true" aria-label="Loading Open Payments">
        <div className="h-16 animate-pulse rounded-md border border-border bg-muted/50" />
        <div className="h-72 animate-pulse rounded-md border border-border bg-muted/50" />
      </div>
    );
  if (q.isError)
    return (
      <p
        role="alert"
        className="rounded-md border border-border px-4 py-4 text-sm text-destructive"
      >
        Open Payments data could not be loaded. Try again shortly.
      </p>
    );
  if (!d || !d.manufacturers.length)
    return (
      <p className="rounded-md border border-border px-4 py-4 text-sm text-muted-foreground">
        Open Payments datasets have not been published yet.
      </p>
    );

  const mapYear = period === "all" ? LATEST : period;
  const states = stateValues(d, mapYear, metric);
  const stateSel = search.st ? (d.states.find((s) => s.state === search.st) ?? null) : null;
  const fipsValues = new Map<string, number>();
  for (const r of states) {
    const fips = stateByUsps.get(r.state.state)?.fips;
    // Rounded for the map readout: cents per resident, whole dollars for raw totals.
    if (fips && r.value != null)
      fipsValues.set(fips, d.population ? Math.round(r.value * 100) / 100 : Math.round(r.value));
  }
  const perCapita = !!d.population;
  const natTotal = nationalValue(metric, period);
  const natPrior = period === "all" ? null : nationalValue(metric, period - 1);
  const top10 = [...d.manufacturers]
    .map((m) => periodValue(m, m.totals, period, metric))
    .sort((a, b) => b - a)
    .slice(0, 10)
    .reduce((a, b) => a + b, 0);
  const entities = period === "all" ? null : (national?.reportingEntities[String(period)] ?? null);
  const opAdverse = d.adverse.filter((a) => a.kind === "open_payments");
  const matched = opAdverse.filter((a) => a.matched).length;
  const natureRows = national
    ? period === "all"
      ? national.nature
      : (national.natureByYear[String(period)] ?? [])
    : [];
  const natureTotal = natureRows.reduce((a, n) => a + n.amount, 0);
  const scatter = scatterPoints(d, period);
  const periodLabel = period === "all" ? "2017–2025" : String(period);
  const archived = period === 2017 || period === 2018;
  const metricLabel = metric === "general" ? "General payments" : "Research payments";
  const multiples = ranked.length ? [...ranked].sort((a, b) => b.value - a.value).slice(0, 12) : [];
  const filtered = !!query || deviceOnly;
  const clearFilters = () => {
    setDeviceOnly(false);
    setShown(PAGE);
    onSearch({ q: undefined });
  };
  const noMatch = (announce = false) => (
    <NoMatch
      query={search.q ?? ""}
      deviceOnly={deviceOnly}
      onClear={clearFilters}
      announce={announce}
    />
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Toggle<Metric>
          label="Payment type"
          value={metric}
          onChange={(v) => onSearch({ metric: v === "general" ? undefined : v })}
          options={[
            { value: "general", label: "General" },
            { value: "research", label: "Research" },
          ]}
        />
        <span className="h-5 w-px bg-border" aria-hidden="true" />
        <Toggle<string>
          label="Program year"
          value={period === "all" ? "all" : String(period)}
          onChange={(v) => onSearch({ year: v === "all" ? undefined : v })}
          options={[
            { value: "all", label: "2017–2025" },
            ...PAYMENT_YEARS.map((y) => ({ value: String(y), label: String(y) })),
          ]}
        />
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        <Kpi
          label={`${metric === "general" ? "General" : "Research"} · ${periodLabel}`}
          value={usd(natTotal)}
          note={archived ? ARCHIVE_NOTE : "National, all companies"}
        />
        <Kpi
          label={`${metric === "general" ? "Research" : "General"} · ${periodLabel}`}
          value={usd(nationalValue(metric === "general" ? "research" : "general", period))}
          note={archived ? ARCHIVE_NOTE : "National, all companies"}
        />
        <Kpi
          label="Change vs prior year"
          value={
            natTotal != null && natPrior
              ? `${natTotal >= natPrior ? "+" : ""}${pct(natTotal / natPrior - 1, 1)}`
              : "—"
          }
          note={
            period === "all" || period === 2017
              ? "Pick a year from 2018 on"
              : `${period - 1} → ${period}${period <= 2019 ? " · archive-based base year" : ""}`
          }
        />
        <Kpi
          label="Top-10 share"
          value={natTotal ? pct(top10 / natTotal, 1) : "Not recorded"}
          note={`of national ${metric}, ${periodLabel}`}
        />
        <Kpi
          label="Companies paying"
          value={entities == null ? "—" : int(entities)}
          note={entities == null ? "CMS count, 2019–2025 only" : "CMS summary dashboard"}
        />
        <Kpi
          label="MAUDE name matches"
          value={`${matched} of ${opAdverse.length}`}
          note="device-linked entities"
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <ChartCard
          title="National payments by program year"
          subtitle="All reporting entities, general and research dollars; dashed line is the median year"
          footnote="CMS Summary Dashboard (2019–2025); 2017–2018 (lighter) summed from CMS archived detail files."
        >
          {national ? (
            <YearBars
              rows={national.years.map((y) => ({
                year: y.year,
                general: y.general,
                research: y.research,
                archive: y.source === "archive",
              }))}
            />
          ) : (
            <ChartUnavailable />
          )}
        </ChartCard>
        <ChartCard
          title={`Nature of general payments, ${periodLabel}`}
          subtitle={
            selected
              ? `National mix; tick marks show ${selected.name} (2017–2025)`
              : "National mix of general-payment dollars"
          }
          footnote={
            archived
              ? `${ARCHIVE_NOTE}: sums of the ${period} General Payment file by nature of payment.`
              : period === "all"
                ? "CMS reporting-entity × nature summaries (2019–2025; codes matched to CMS labels by exact dollar and record agreement) plus archived detail files (2017–2018)."
                : "CMS reporting-entity × nature summaries; nature codes matched to CMS labels by exact dollar and record agreement."
          }
        >
          <ShareBars
            rows={natureRows.map((n) => {
              const own = selected?.nature.find((x) => x.label === n.label);
              const ownTotal = selected ? selected.nature.reduce((a, x) => a + x.amount, 0) : 0;
              return {
                key: n.label,
                label: n.label,
                amount: n.amount,
                compare: selected ? (own && ownTotal ? own.amount / ownTotal : 0) : null,
              };
            })}
            total={natureTotal}
            compareLabel={selected?.name}
            limit={9}
          />
        </ChartCard>
      </div>

      <section
        className="rounded-md border border-border bg-surface"
        aria-label="Manufacturer ranking"
      >
        <div className="flex flex-wrap items-end justify-between gap-2 border-b border-border/70 px-3 py-2">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold">
              Top 300 reporting entities · {metricLabel.toLowerCase()}, {periodLabel}
            </h3>
            <p className="text-xs text-muted-foreground">
              Each CMS reporting-entity ID is one company as reported; affiliates are not combined.
              Bars: general payments 2017–2025.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1 text-xs">
              <input
                type="checkbox"
                checked={deviceOnly}
                onChange={(e) => {
                  setDeviceOnly(e.target.checked);
                  setShown(PAGE);
                }}
              />
              Device-linked only
            </label>
            <label className="flex items-center gap-1 text-xs text-muted-foreground">
              <ArrowDownWideNarrow className="size-3.5" aria-hidden="true" />
              <span className="sr-only">Sort by</span>
              <select
                value={sort}
                onChange={(e) =>
                  onSearch({
                    sort:
                      e.target.value === "value"
                        ? undefined
                        : (e.target.value as PaymentsSearch["sort"]),
                  })
                }
                className="rounded-md border border-border bg-surface px-1.5 py-0.5 text-xs text-foreground"
              >
                <option value="value">Amount</option>
                <option value="change">{`Change ${LATEST - 1}→${LATEST}`}</option>
                <option value="device">Device share</option>
              </select>
            </label>
            <label className="relative w-48">
              <span className="sr-only">Search reporting entities</span>
              <Search
                className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                value={search.q ?? ""}
                onChange={(e) => {
                  onSearch({ q: e.target.value || undefined });
                  setShown(PAGE);
                }}
                placeholder="Search manufacturer…"
                className="h-7 pl-7 text-xs"
              />
            </label>
          </div>
        </div>
        {ranked.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-xs">
              <thead className="text-left text-[11px] text-muted-foreground">
                <tr className="border-b border-border/70">
                  <th className="px-3 py-1.5 font-medium">#</th>
                  <th className="px-2 py-1.5 font-medium">Reporting entity</th>
                  <th className="px-2 py-1.5 text-right font-medium">{periodLabel}</th>
                  <th className="px-2 py-1.5 text-right font-medium">Share</th>
                  <th className="px-2 py-1.5 font-medium">2017–25</th>
                  <th className="px-2 py-1.5 text-right font-medium">{`${LATEST - 1}→${String(LATEST).slice(2)}`}</th>
                  <th className="hidden px-2 py-1.5 text-right font-medium xl:table-cell">
                    Device
                  </th>
                  <th
                    className="px-2 py-1.5 text-right font-medium"
                    title="Attributed MAUDE reports 2017–2025 (a lower bound) and name coverage"
                  >
                    MAUDE 2017–25 · cov.
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {ranked.slice(0, shown).map(({ m, value, change, flag, maude }, i) => (
                  <tr
                    key={m.entityId}
                    className={cn(
                      "cursor-pointer hover:bg-muted/40",
                      search.m === m.entityId && "bg-primary/5",
                    )}
                    onClick={() =>
                      onSearch({ m: search.m === m.entityId ? undefined : m.entityId })
                    }
                  >
                    <td className="px-3 py-1.5 font-mono text-muted-foreground">{i + 1}</td>
                    <td className="max-w-0 px-2 py-1.5">
                      <button
                        type="button"
                        className="block w-full text-left font-medium leading-4 text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                        aria-pressed={search.m === m.entityId}
                        title={m.name}
                      >
                        <span className="line-clamp-2 break-words">{m.name}</span>
                      </button>
                      <span
                        className="block truncate text-[11px] text-muted-foreground"
                        title={
                          [m.hqState, m.country].filter(Boolean).join(", ") || "HQ not recorded"
                        }
                      >
                        {[m.hqState, m.country].filter(Boolean).join(", ") || "HQ not recorded"}
                        {flag ? (
                          <span
                            className={cn(
                              "ml-1.5 rounded border px-1 font-medium",
                              flag === "surge"
                                ? "border-warning/40 bg-warning/15 text-warning-foreground"
                                : "border-border bg-muted",
                            )}
                            title={SURGE_RULE}
                          >
                            {flag === "surge" ? "Surge" : "Drop"}
                          </span>
                        ) : null}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono" title={fullUsd(value)}>
                      {usd(value)}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono text-muted-foreground">
                      {natTotal ? pct(value / natTotal, 1) : "—"}
                    </td>
                    <td className="px-2 py-1.5">
                      <SparkBars
                        values={m.years.map((y) => y.general)}
                        label={`General payments 2017 to 2025 for ${m.name}`}
                      />
                    </td>
                    <td
                      className={cn(
                        "px-2 py-1.5 text-right font-mono",
                        change != null && change > 0 ? "text-foreground" : "text-muted-foreground",
                      )}
                    >
                      {change == null ? "—" : `${change >= 0 ? "+" : ""}${pct(change)}`}
                    </td>
                    <td className="hidden px-2 py-1.5 text-right font-mono text-muted-foreground xl:table-cell">
                      {pct(m.deviceShare)}
                    </td>
                    <td
                      className="px-2 py-1.5 text-right font-mono text-muted-foreground"
                      title={
                        maude?.matched
                          ? `Lower bound: exact-name match, requires review. Coverage = attributed reports / same-name reports, 2017–2025${maude.coverage == null ? "" : ` (${pct(maude.coverage, 1)})`}.`
                          : maude
                            ? "Searched, no exact-name match"
                            : "Not searched (device share under 10%)"
                      }
                    >
                      {maude?.matched ? (
                        <>
                          ≥{int(maude.total)}
                          <span className="block text-[10px]">
                            {maude.coverage == null
                              ? "coverage n/a"
                              : `${pct(maude.coverage)} cov.`}
                          </span>
                        </>
                      ) : maude ? (
                        "no match"
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex items-center gap-3 border-t border-border/70 px-3 py-1.5 text-[11px] text-muted-foreground">
              <span>
                Showing {Math.min(shown, ranked.length)} of {ranked.length}
              </span>
              {shown < ranked.length ? (
                <button
                  type="button"
                  onClick={() => setShown((n) => n + 50)}
                  className="rounded-md border border-border px-2 py-0.5 text-foreground hover:bg-muted"
                >
                  Show more
                </button>
              ) : null}
              <span className="ml-auto truncate" title={SURGE_RULE}>
                {SURGE_RULE}
              </span>
            </div>
          </div>
        ) : (
          noMatch(true)
        )}
      </section>

      {selected ? (
        <section
          className="rounded-md border border-primary/30 bg-surface p-3"
          aria-label={`${selected.name} detail`}
        >
          {detail.isLoading ? (
            <div className="h-40 animate-pulse rounded-md bg-muted/50" aria-busy="true" />
          ) : detail.isError ? (
            <p role="alert" className="text-sm text-destructive">
              This manufacturer's detail could not be loaded.
            </p>
          ) : detail.data?.matches[0] ? (
            <ManufacturerPaymentsView
              payments={detail.data.matches[0].payments}
              adverse={detail.data.matches[0].adverse}
            />
          ) : (
            <p className="text-sm text-muted-foreground">Detail not recorded.</p>
          )}
        </section>
      ) : null}

      <section
        className="rounded-md border border-border bg-surface p-3"
        aria-label="Company lookup"
      >
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const value = new FormData(e.currentTarget).get("company");
            onSearch({
              name: typeof value === "string" && value.trim() ? value.trim() : undefined,
            });
          }}
        >
          <label htmlFor="op-company" className="text-xs font-medium">
            Look up a company by name
          </label>
          <Input
            id="op-company"
            name="company"
            defaultValue={search.name ?? ""}
            placeholder="e.g. Stryker Corp, Medtronic plc"
            className="h-7 w-60 text-xs"
          />
          <button
            type="submit"
            className="rounded-md border border-border px-2 py-0.5 text-xs hover:bg-muted"
          >
            Look up
          </button>
          {search.name ? (
            <button
              type="button"
              onClick={() => onSearch({ name: undefined })}
              className="text-xs text-muted-foreground underline"
            >
              Clear
            </button>
          ) : null}
          <span className="text-[11px] text-muted-foreground">
            Exact-name rule: case and punctuation ignored; legal form (Inc., plc…) must agree.
          </span>
        </form>
        {search.name ? (
          <div className="mt-3">
            <OpenPaymentsPanel name={search.name} />
          </div>
        ) : null}
      </section>

      <ChartCard
        title={`${
          !filtered
            ? `Largest ${multiples.length || 12}`
            : multiples.length
              ? `Largest ${multiples.length} matching the filters`
              : "Largest matching entities"
        } · ${metricLabel.toLowerCase()} by year`}
        subtitle="Small multiples, each on its own scale; lighter bars are archived years 2017–2018"
        footnote="Order follows the amount for the selected period and filters."
      >
        {multiples.length ? (
          <div className="grid grid-cols-2 gap-px bg-border/60 sm:grid-cols-3 xl:grid-cols-4">
            {multiples.map(({ m, value }) => (
              <button
                key={m.entityId}
                type="button"
                onClick={() => onSearch({ m: m.entityId })}
                className="min-w-0 bg-surface px-2 py-1.5 text-left hover:bg-muted/40"
              >
                <span
                  className="line-clamp-2 break-words text-[11px] font-medium leading-4"
                  title={m.name}
                >
                  {m.name}
                </span>
                <span className="block font-mono text-[11px] text-muted-foreground">
                  {usd(value)} · {periodLabel}
                </span>
                <SparkBars
                  values={m.years.map((y) => y[metric])}
                  className="mt-0.5 h-7 w-full"
                  label={`${metricLabel} by year for ${m.name}`}
                />
              </button>
            ))}
          </div>
        ) : (
          noMatch()
        )}
      </ChartCard>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <ChartCard
          title={`${metricLabel} by recipient state, ${mapYear}${perCapita ? " · per resident" : ""}`}
          subtitle={
            perCapita
              ? "Dollars per resident: CMS state total ÷ Census July 1 population of the same year"
              : "Raw dollars: population data (state_metrics_profiles) is not available, so values are not per capita"
          }
          footnote={`${period === "all" ? `Map shows ${LATEST}; pick a year to change it. ` : ""}CMS state-level summaries (2019–2025) or archived detail files (2017–2018), covered recipients only.${perCapita && mapYear <= 2019 ? ` ${VINTAGE_NOTE}` : ""}`}
        >
          <div className="p-2">
            {corpus.geo ? (
              <UsMap
                geo={corpus.geo}
                values={fipsValues}
                valueLabel={perCapita ? "per resident" : "in payments"}
                heading={`Payments to covered recipients by state, ${mapYear}`}
                hint="Select a state to show its payments by year and nature of payment below the map; select it again to close."
                stateAction="Show"
                formatValue={perCapita ? (v) => `$${v.toFixed(2)}` : (v) => usd(v)}
                legendNote={
                  perCapita
                    ? "Shading scales with CMS dollars per resident; it does not measure misconduct or influence."
                    : "Shading scales with CMS reported dollars; it does not measure misconduct or influence."
                }
                selectedState={search.st}
                onState={(f) => {
                  const s = [...stateByUsps.values()].find((x) => x.fips === f);
                  onSearch({ st: s && s.usps !== search.st ? s.usps : undefined });
                }}
              />
            ) : corpus.status === "error" ? (
              <ChartUnavailable reason="The map geometry could not be loaded." />
            ) : (
              <div className="h-52 animate-pulse rounded bg-muted/50" />
            )}
          </div>
          {stateSel ? <StateDetail s={stateSel} metric={metric} year={mapYear} /> : null}
        </ChartCard>
        <ChartCard
          title={`State ranking, ${mapYear}`}
          subtitle={perCapita ? "Dollars per resident" : "Raw dollars"}
          footnote={perCapita && mapYear <= 2019 ? `${STATE_RULE} ${VINTAGE_NOTE}` : STATE_RULE}
        >
          <ol className="divide-y divide-border/50 text-xs">
            {states.slice(0, 14).map((r, i) => (
              <li key={r.state.state}>
                <button
                  type="button"
                  onClick={() =>
                    onSearch({ st: search.st === r.state.state ? undefined : r.state.state })
                  }
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-1 text-left hover:bg-muted/40",
                    search.st === r.state.state && "bg-primary/5",
                  )}
                >
                  <span className="w-5 font-mono text-muted-foreground">{i + 1}</span>
                  <StateFlag state={r.state.state} className="h-3" />
                  <span className="min-w-0 flex-1 truncate" title={r.state.name}>
                    {r.state.name}
                  </span>
                  {r.z != null && Math.abs(r.z) > 2 ? (
                    <span
                      className="rounded border border-warning/40 bg-warning/15 px-1 text-[10px] font-medium text-warning-foreground"
                      title={STATE_RULE}
                    >
                      z {r.z.toFixed(1)}
                    </span>
                  ) : null}
                  <span className="font-mono">
                    {r.value == null
                      ? "Not recorded"
                      : perCapita
                        ? `$${r.value.toFixed(2)}`
                        : usd(r.value)}
                  </span>
                </button>
              </li>
            ))}
          </ol>
          <p className="border-t border-border/60 px-3 py-1 text-[11px] text-muted-foreground">
            Median{" "}
            {perCapita
              ? `$${(median(states.flatMap((r) => (r.value == null ? [] : [r.value]))) ?? 0).toFixed(2)} per resident`
              : usd(median(states.flatMap((r) => (r.value == null ? [] : [r.value]))))}{" "}
            across the 50 states and DC
            {states.filter((r) => r.value != null).length < 51
              ? ` (${states.filter((r) => r.value != null).length} with values)`
              : ""}
          </p>
        </ChartCard>
      </div>

      <ChartCard
        title={`General payments vs MAUDE device reports, ${periodLabel}`}
        subtitle={
          scatter.r == null
            ? `Each dot is a device-linked manufacturer · r not computed: fewer than three meet the coverage test (n = ${scatter.n})`
            : `Each dot is a device-linked manufacturer · r = ${scatter.r.toFixed(2)} on n = ${scatter.n} with ≥ ${MIN_COVERAGE * 100}% name coverage (log10 scale) · association only`
        }
        footnote={`${ASSOCIATION_NOTE} ${SCATTER_RULE} ${scatter.excluded ? `${scatter.excluded} matched entities with zero payments or reports in this period are not plotted. ` : ""}MAUDE counts use the same-name rule (legal forms must agree; plants and divisions not merged), so they are lower bounds that require review, and they measure reporting volume, not proven device failures.`}
      >
        {scatter.points.length < 1 ? (
          <ChartUnavailable reason="No manufacturer has both payments and exact-name MAUDE matches for this period." />
        ) : (
          <PaymentsScatter
            points={scatter.points}
            onPick={(id) => onSearch({ m: id })}
            minCoverage={MIN_COVERAGE * 100}
            minReports={MIN_REPORTS}
          />
        )}
      </ChartCard>

      <details className="rounded-md border border-border bg-surface px-3 py-2 text-xs">
        <summary className="flex cursor-pointer items-center gap-1.5 font-medium">
          <Info className="size-3.5" aria-hidden="true" />
          Method and sources
        </summary>
        <ul className="mt-2 space-y-1 text-muted-foreground">
          {Object.entries(d.method).map(([k, v]) => (
            <li key={k}>
              <span className="font-medium capitalize text-foreground">{k}.</span> {v}
            </li>
          ))}
          <li>
            <span className="font-medium text-foreground">Archived years.</span> 2017 totals here
            ($2.96B general, $5.95B research) exceed the{" "}
            <a
              className="text-primary hover:underline"
              href="https://www.cms.gov/openpayments/downloads/2017-fact-sheet.pdf"
              target="_blank"
              rel="noreferrer"
            >
              CMS Program Year 2017 fact sheet
            </a>{" "}
            ($2.82B general, $4.66B research, published June 29, 2018). CMS describes the archived
            file as holding “the most recent attested-to data for Program Year 2017 as of May 30,
            2024”, including records first published in later cycles because they were not eligible
            for publication earlier (change type ADD) and records changed after publication. The
            difference is observed, not decomposed further here.
          </li>
          <li>
            <span className="font-medium text-foreground">Population.</span>{" "}
            {d.populationSource ?? "Not available; state values are raw dollars."}
          </li>
          <li>
            <span className="font-medium text-foreground">Sources.</span>{" "}
            <a
              className="text-primary hover:underline"
              href="https://openpaymentsdata.cms.gov/"
              target="_blank"
              rel="noreferrer"
            >
              CMS Open Payments
            </a>{" "}
            summary datasets and detail files;{" "}
            <a
              className="text-primary hover:underline"
              href="https://openpaymentsdata.cms.gov/datasets/archived"
              target="_blank"
              rel="noreferrer"
            >
              archived datasets
            </a>
            ;{" "}
            <a
              className="text-primary hover:underline"
              href="https://open.fda.gov/apis/device/event/"
              target="_blank"
              rel="noreferrer"
            >
              openFDA device adverse events
            </a>
            .{d.generatedAt ? ` Built ${d.generatedAt.slice(0, 10)}.` : ""}
          </li>
        </ul>
      </details>
    </div>
  );
}
