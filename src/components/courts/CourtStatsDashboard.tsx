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
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ArrowDown, ArrowUp, Flag, Info, Search } from "lucide-react";
import { ChartCard } from "@/components/fda-analytics/FdaCharts";
import { FDA_COLORS } from "@/components/fda-analytics/chartView";
import { HowToRead, type Measure } from "@/components/analysis/HowToRead";
import { KeyTakeaways } from "@/components/analysis/KeyTakeaways";
import { MoreToggle } from "@/components/enforcement/parts";
import { Input } from "@/components/ui/input";
import { getCourtStatsOverview } from "@/lib/external/courtStats.functions";
import { cn } from "@/lib/utils";
import {
  at,
  change,
  CIRCUIT_SHORT,
  compactNum,
  DASH_TITLE,
  dominanceNote,
  FLAG_RULES,
  fmtCell,
  isDash,
  flagDetail,
  fmtNum,
  fmtPct,
  heat,
  median,
  RULE_FALLBACK_SHORT,
  sortRows,
  type CircuitStats,
  type CourtStatsOverview,
  type DistrictRow,
  type FlagRule,
  type Series,
  type SortKey,
  axis,
  tooltipStyle,
} from "./courtStatsData";
import { Kpi, Notice, ScrollX, SectionTitle, Spark } from "./CourtStatsParts";
import { courtTakeaways } from "./courtTakeaways";

const COURT_MEASURES: Measure[] = [
  {
    term: "Fiscal year (FY)",
    means: "The 12-month period ending September 30, as the Judicial Business tables publish it.",
  },
  {
    term: "Product liability filings",
    means:
      "Civil cases commenced with a product-liability nature of suit (Table C-11), counted where they are filed, including cases filed directly in or transferred to an MDL court.",
    caveat:
      "Large swings follow MDL dockets, so a district's count reflects where dockets are assigned, not local claim rates.",
  },
  {
    term: "PL share of civil filings",
    means:
      "Product liability filings divided by all district civil filings in the same fiscal year (Tables C-11 and C).",
  },
  {
    term: "Top-5 share and HHI",
    means:
      "Share of product liability filings in the five districts with the most; HHI is the sum of squared district shares, 0 to 10,000, so higher means filings sit in fewer districts.",
  },
  {
    term: "Median months to disposition",
    means:
      "Table C-5. The pooled national figure is the median across all terminations; the median district is the middle of the 94 district medians.",
    caveat:
      "A single MDL docket can dominate the pooled figure in some years, so flags compare each district with the median of district values.",
  },
  {
    term: "Pending 3+ years",
    means:
      "Table C-6: the share of pending civil cases that are three years old or more, pooled nationally and as the median district share.",
    caveat: "Same pooled-versus-median-district caution as disposition time.",
  },
  {
    term: "Outlier flags",
    means:
      "Deterministic rules applied to published values; the rules are stated in each flag card.",
    caveat: "A flag is a lead to review, not a finding.",
  },
  {
    term: "Dash or Not recorded",
    means:
      "A cell printed as a dash in the source is shown as a dash; a value the source does not publish reads Not recorded.",
    caveat: "A dash can mean zero, not applicable or not computed; the page does not pick one.",
  },
];

export const courtStatsQuery = {
  queryKey: ["court-stats-overview"],
  queryFn: () => getCourtStatsOverview(),
  staleTime: 10 * 60 * 1000,
};

const fy = (y: number) => `FY${y}`;
const asNum = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const signedPct = (v: number | null) =>
  v === null ? null : `${v > 0 ? "+" : ""}${v.toFixed(1)}% vs prior FY`;

export function CourtStatsDashboard() {
  const q = useQuery(courtStatsQuery);
  if (q.isLoading) return <Skeleton />;
  if (q.isError)
    return (
      <Notice tone="error">
        Federal court statistics could not be loaded.{" "}
        {q.error instanceof Error ? q.error.message : ""}
      </Notice>
    );
  if (!q.data)
    return (
      <Notice>
        Federal court statistics have not been published yet, or the stored tables did not pass
        validation.
      </Notice>
    );
  return <Dashboard data={q.data} />;
}

function Dashboard({ data }: { data: CourtStatsOverview }) {
  const { years, national: nat } = data;
  const [yi, setYi] = useState(years.length - 1);
  const year = years[yi]!;
  const s = nat.series;
  const civil = at(s["civil_filed"], yi);
  const pl = at(s["pl_total"], yi);
  const flagged = useMemo(
    () =>
      data.districts.flatMap((d) => d.flags.filter((f) => f.year === year).map((f) => ({ d, f }))),
    [data.districts, year],
  );
  const failed = nat.checks.failed.length;
  const c5Note = dominanceNote(
    nat.concentration.c5[yi] ?? null,
    `${fy(year)} civil terminations measured in Table C-5`,
  );
  const c6Note = dominanceNote(
    nat.concentration.c6[yi] ?? null,
    `${fy(year)} civil cases pending three years or more (Table C-6)`,
  );
  const takeaways = courtTakeaways({
    yearLabel: fy(year),
    priorLabel: yi > 0 ? fy(years[yi - 1]!) : null,
    plFilings: pl,
    plFilingsPrior: yi > 0 ? at(s["pl_total"], yi - 1) : null,
    plSharePct: at(s["pl_share_pct"], yi),
    plShareSeries: s["pl_share_pct"] ?? [],
    top5SharePct: at(s["pl_top5_share_pct"], yi),
    hhi: at(s["pl_hhi"], yi),
    medianMonthsNational: at(s["median_total"], yi),
    medianMonthsDistrict: at(s["district_median_total"], yi),
    nationalSkewed: c5Note !== null,
    flagCount: flagged.length,
    flaggedDistricts: new Set(flagged.map((x) => x.d.id)).size,
  });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <p className="mr-auto max-w-3xl text-xs leading-relaxed text-muted-foreground">
          Official Judicial Business tables, 12-month periods ending September 30. Every value is
          copied as published; derived shares and rates use the same table year. The tables used are
          listed under Sources and method.{" "}
          {nat.checks.total !== null
            ? `${fmtNum(nat.checks.passed)} of ${fmtNum(nat.checks.total)} arithmetic checks passed${failed ? `; ${failed} published cells that do not reconcile are withheld` : ""}.`
            : null}
        </p>
        <label className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">Fiscal year</span>
          <select
            value={yi}
            onChange={(e) => setYi(Number(e.target.value))}
            className="h-8 rounded-md border border-border bg-surface px-2 text-xs"
          >
            {years.map((y, i) => (
              <option key={y} value={i}>
                {fy(y)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        <Kpi
          label={`District civil filings ${fy(year)}`}
          value={fmtNum(civil)}
          note={
            yi > 0
              ? (signedPct(change(civil, at(s["civil_filed"], yi - 1))) ?? undefined)
              : undefined
          }
        />
        <Kpi
          label="Product liability filings"
          value={fmtNum(pl)}
          note={
            yi > 0 ? (signedPct(change(pl, at(s["pl_total"], yi - 1))) ?? undefined) : undefined
          }
        />
        <Kpi label="PL share of civil filings" value={fmtPct(at(s["pl_share_pct"], yi))} />
        <Kpi
          label="Top 5 districts' PL share"
          value={fmtPct(at(s["pl_top5_share_pct"], yi))}
          note={`HHI ${fmtNum(at(s["pl_hhi"], yi))}`}
        />
        <Kpi
          label="Median months to disposition"
          value={fmtNum(at(s["median_total"], yi), 1)}
          note={`Pooled national · median district ${fmtNum(at(s["district_median_total"], yi), 1)}`}
          detail={c5Note ? "Skewed by one MDL docket" : undefined}
          title={c5Note ?? undefined}
        />
        <Kpi
          label="Appeals filed (circuits)"
          value={fmtNum(at(s["appeals_filed"], yi))}
          note={`${fmtNum(at(s["appeals_median_notice_to_final"], yi), 1)} months to merits decision`}
        />
      </div>

      <KeyTakeaways
        items={takeaways}
        scope={`${fy(year)} · national tables; the fiscal-year selector above changes these`}
      />
      <HowToRead measures={COURT_MEASURES} />

      <div className="grid gap-3 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <NosChart data={data} yi={yi} />
        <PharmaChart data={data} />
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <SmallTrend
          id="court-pl-share"
          title="Product liability share of civil filings"
          subtitle="Tables C-11 and C · line is the FY2014-FY2025 median"
          years={years}
          values={s["pl_share_pct"]}
          unit="%"
          yi={yi}
        />
        <SmallTrend
          id="court-top5"
          title="Top 5 districts' share of PL filings"
          subtitle="Concentration across 94 districts · Table C-11"
          years={years}
          values={s["pl_top5_share_pct"]}
          unit="%"
          yi={yi}
        />
        <SmallTrend
          id="court-disposition"
          title="Median months, filing to disposition"
          subtitle="Table C-5 · pooled national vs median district"
          years={years}
          values={s["median_total"]}
          label="National (all terminations)"
          second={{ values: s["district_median_total"], label: "Median district" }}
          unit=" months"
          digits={1}
          yi={yi}
          footnote={c5Note}
        />
        <SmallTrend
          title="Civil cases pending 3+ years"
          subtitle="Table C-6 · pooled national vs median district share"
          years={years}
          values={s["pending_over_3y_pct"]}
          label="National (all pending)"
          second={{ values: s["district_median_over_3y_pct"], label: "Median district" }}
          unit="%"
          digits={1}
          yi={yi}
          footnote={c6Note}
        />
      </div>

      <FlagsPanel data={data} year={year} flagged={flagged} />
      <DistrictTable data={data} yi={yi} />
      <HeatTable data={data} yi={yi} />
      <CircuitSection data={data} yi={yi} />
      <SourcesPanel data={data} year={year} />
    </div>
  );
}

// ---------------------------------------------------------------- national charts

const NOS_GROUPS: { id: string; label: string; parts: string[] }[] = [
  { id: "other", label: "Other PI incl. pharma (365, 367)", parts: ["other_pi_365_367"] },
  { id: "asbestos", label: "Asbestos (368)", parts: ["asbestos_368"] },
  { id: "motor", label: "Motor vehicle (355)", parts: ["motor_vehicle_355"] },
  { id: "air", label: "Airplane (315)", parts: ["airplane_315"] },
  { id: "property", label: "Property damage (385)", parts: ["property_damage_385"] },
  {
    id: "contract",
    label: "Contract, real property, marine (195, 245, 345)",
    parts: ["contract_195", "real_property_245", "marine_345"],
  },
];

function NosChart({ data, yi }: { data: CourtStatsOverview; yi: number }) {
  const parts = data.national.plParts;
  const rows = data.years.map((y, i) => {
    const row: Record<string, string | number | null> = { year: fy(y) };
    for (const g of NOS_GROUPS) {
      const values = g.parts.map((p) => at(parts[p], i));
      row[g.id] = values.every((v) => v !== null)
        ? values.reduce<number>((a, v) => a + (v ?? 0), 0)
        : null;
    }
    return row;
  });
  return (
    <ChartCard
      id="court-nos"
      title="National product liability filings by nature of suit"
      subtitle={`Table C-11, U.S. district courts, FY${data.years[0]}-FY${data.years.at(-1)} · selected ${fy(data.years[yi]!)}`}
      footnote="Large swings track MDL dockets: cases filed directly in, or transferred to, an MDL court count as filings there."
    >
      <div className="h-64 px-2 py-2">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--border)" vertical={false} strokeDasharray="3 3" />
            <XAxis
              dataKey="year"
              tick={axis}
              tickLine={false}
              axisLine={false}
              interval={0}
              tickFormatter={(v: string) => `'${v.slice(4)}`}
            />
            <YAxis
              tick={axis}
              tickFormatter={compactNum}
              width={44}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={(v, name: string) => [fmtNum(asNum(v)), name]}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} iconSize={9} />
            {NOS_GROUPS.map((g, i) => (
              <Bar
                key={g.id}
                dataKey={g.id}
                name={g.label}
                stackId="pl"
                fill={FDA_COLORS[i % FDA_COLORS.length]}
                isAnimationActive={false}
                maxBarSize={34}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

function PharmaChart({ data }: { data: CourtStatsOverview }) {
  const nos = data.national.nos;
  const rows = data.years.map((y, i) => ({
    year: fy(y),
    pharma: at(nos["pl_health_care_pharma_367"], i),
    other: at(nos["pl_other_365"], i),
    asbestos: at(nos["pl_asbestos_368"], i),
  }));
  return (
    <ChartCard
      title="Personal injury product liability, NOS 365 / 367 / 368"
      subtitle="Table C-2A national nature-of-suit detail (latest five-year edition covering each year)"
    >
      <div className="h-64 px-2 py-2">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 6, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--border)" vertical={false} strokeDasharray="3 3" />
            <XAxis
              dataKey="year"
              tick={axis}
              tickLine={false}
              axisLine={false}
              interval={1}
              tickFormatter={(v: string) => `'${v.slice(4)}`}
            />
            <YAxis
              tick={axis}
              tickFormatter={compactNum}
              width={44}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={(v, name: string) => [fmtNum(asNum(v)), name]}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} iconType="plainline" />
            <Line
              dataKey="pharma"
              name="Health care / pharmaceutical (367)"
              stroke={FDA_COLORS[2]}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
            <Line
              dataKey="other"
              name="Other PI product liability (365)"
              stroke={FDA_COLORS[0]}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
            <Line
              dataKey="asbestos"
              name="Asbestos (368)"
              stroke={FDA_COLORS[1]}
              strokeWidth={2}
              strokeDasharray="5 3"
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

function SmallTrend({
  title,
  subtitle,
  years,
  values,
  label,
  second,
  unit,
  digits = 1,
  yi,
  footnote,
  id,
}: {
  id?: string | undefined;
  title: string;
  subtitle: string;
  years: number[];
  values: Series | undefined;
  label?: string | undefined;
  second?: { values: Series | undefined; label: string } | undefined;
  unit: string;
  digits?: number;
  yi: number;
  footnote?: string | null | undefined;
}) {
  const rows = years.map((y, i) => ({
    year: fy(y),
    value: at(values, i),
    second: second ? at(second.values, i) : null,
  }));
  const mid = second ? null : median(values ?? []);
  return (
    <ChartCard
      id={id}
      title={title}
      subtitle={subtitle}
      footnote={footnote ? <span className="text-warning-foreground">{footnote}</span> : undefined}
    >
      <div className="h-36 px-2 py-1.5">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 6, right: 10, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--border)" vertical={false} strokeDasharray="3 3" />
            <XAxis
              dataKey="year"
              tick={axis}
              tickLine={false}
              axisLine={false}
              interval={2}
              tickFormatter={(v: string) => `'${v.slice(4)}`}
            />
            <YAxis
              tick={axis}
              width={36}
              tickLine={false}
              axisLine={false}
              domain={["auto", "auto"]}
              tickFormatter={compactNum}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={(v, name: string) => [
                `${fmtNum(asNum(v), digits)}${asNum(v) === null ? "" : unit}`,
                name,
              ]}
            />
            {second ? <Legend wrapperStyle={{ fontSize: 11 }} iconType="plainline" /> : null}
            {mid !== null ? (
              <ReferenceLine y={mid} stroke="var(--muted-foreground)" strokeDasharray="4 3" />
            ) : null}
            <ReferenceLine x={fy(years[yi]!)} stroke="var(--border)" />
            <Line
              dataKey="value"
              name={label ?? title}
              stroke={FDA_COLORS[0]}
              strokeWidth={2}
              dot={{ r: 2 }}
              isAnimationActive={false}
              connectNulls={false}
            />
            {second ? (
              <Line
                dataKey="second"
                name={second.label}
                stroke={FDA_COLORS[1]}
                strokeWidth={2}
                strokeDasharray="5 3"
                dot={false}
                isAnimationActive={false}
                connectNulls={false}
              />
            ) : null}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

// ---------------------------------------------------------------- flags

function FlagsPanel({
  data,
  year,
  flagged,
}: {
  data: CourtStatsOverview;
  year: number;
  flagged: { d: DistrictRow; f: CourtStatsOverview["districts"][number]["flags"][number] }[];
}) {
  const rules = data.national.rules;
  const short = (r: FlagRule) => data.national.rulesShort[r] ?? RULE_FALLBACK_SHORT[r];
  return (
    <section
      id="court-flags"
      className="scroll-mt-4 rounded-md border border-border bg-surface focus:outline-none"
      aria-label="Outlier flags"
    >
      <SectionTitle
        title={`Outlier flags, ${fy(year)}`}
        subtitle={`${flagged.length} flags across ${new Set(flagged.map((x) => x.d.id)).size} districts. Each flag is a deterministic rule on published values, a lead to review rather than a finding.`}
      >
        <Flag className="size-4 text-muted-foreground" aria-hidden />
      </SectionTitle>
      <div className="grid gap-px bg-border/60 sm:grid-cols-2 xl:grid-cols-3">
        {FLAG_RULES.map((rule) => {
          const items = flagged
            .filter((x) => x.f.rule === rule)
            .sort((a, b) => (b.f.value ?? 0) - (a.f.value ?? 0));
          return (
            <div key={rule} className="min-w-0 bg-surface px-3 py-2">
              <div className="flex items-baseline justify-between gap-2">
                <h4 className="text-[12.5px] font-semibold">{short(rule)}</h4>
                <span className="font-mono text-xs text-muted-foreground">{items.length}</span>
              </div>
              <p className="text-[11px] leading-snug text-muted-foreground">{rules[rule] ?? ""}</p>
              {items.length ? (
                <ul className="mt-1.5 space-y-1">
                  {items.slice(0, 6).map(({ d, f }) => (
                    <li key={d.id} className="text-[11.5px] leading-snug">
                      <Link
                        to="/courts/$id"
                        params={{ id: d.id }}
                        className="font-medium text-primary hover:underline"
                      >
                        {d.name}
                      </Link>{" "}
                      <span className="text-muted-foreground">{flagDetail(f)}</span>
                    </li>
                  ))}
                  {items.length > 6 ? (
                    <li className="text-[11px] text-muted-foreground">
                      +{items.length - 6} more in the district table (filter “Flagged”)
                    </li>
                  ) : null}
                </ul>
              ) : (
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  No district met this rule.
                </p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- district ranking table

const PAGE = 25;
/** Lower-priority ranking columns are hidden below ~1100px viewports so the key columns fit. */
const LOW = "hidden min-[1100px]:table-cell";

function DistrictTable({ data, yi }: { data: CourtStatsOverview; yi: number }) {
  const year = data.years[yi]!;
  const [query, setQuery] = useState("");
  const [circuit, setCircuit] = useState("");
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "pl", desc: true });
  const [shown, setShown] = useState(PAGE);
  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = data.districts.filter(
      (d) =>
        (!circuit || d.circuit === circuit) &&
        (!flaggedOnly || d.flags.some((f) => f.year === year)) &&
        (!needle || `${d.name} ${d.id}`.toLowerCase().includes(needle)),
    );
    return sortRows(filtered, sort.key, yi, year, sort.desc);
  }, [data.districts, query, circuit, flaggedOnly, sort, yi, year]);
  const mdlAsOf = data.districts.find((d) => d.mdl?.asOf)?.mdl?.asOf ?? null;
  const head = (key: SortKey, label: string, title?: string, left = false, extra = "") => (
    <th
      scope="col"
      className={cn("px-2 py-1.5 font-medium", left ? "text-left" : "text-right", extra)}
      title={title}
    >
      <button
        type="button"
        onClick={() =>
          setSort((s) => ({
            key,
            desc: s.key === key ? !s.desc : key !== "name" && key !== "median",
          }))
        }
        className={cn(
          "inline-flex items-center gap-0.5 hover:text-foreground",
          sort.key === key && "text-foreground",
        )}
        aria-label={`Sort by ${label}`}
      >
        {label}
        {sort.key === key ? (
          sort.desc ? (
            <ArrowDown className="size-3" aria-hidden />
          ) : (
            <ArrowUp className="size-3" aria-hidden />
          )
        ) : null}
      </button>
    </th>
  );
  return (
    <section className="rounded-md border border-border bg-surface" aria-label="District ranking">
      <SectionTitle
        title={`District ranking, ${fy(year)}`}
        subtitle={`${rows.length} of ${data.districts.length} districts · sparkline FY${data.years[0]}-FY${data.years.at(-1)} product liability filings`}
      >
        <label className="relative">
          <span className="sr-only">Search districts</span>
          <Search
            className="pointer-events-none absolute left-2 top-2 size-3.5 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setShown(PAGE);
            }}
            placeholder="District or court id"
            className="h-8 w-44 pl-7 text-xs"
          />
        </label>
        <select
          value={circuit}
          onChange={(e) => {
            setCircuit(e.target.value);
            setShown(PAGE);
          }}
          aria-label="Filter by circuit"
          className="h-8 rounded-md border border-border bg-surface px-2 text-xs"
        >
          <option value="">All circuits</option>
          {data.circuits.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          aria-pressed={flaggedOnly}
          onClick={() => setFlaggedOnly((v) => !v)}
          className={cn(
            "h-8 rounded-md border px-2.5 text-xs",
            flaggedOnly
              ? "border-primary bg-primary/10 text-primary"
              : "border-border hover:bg-muted",
          )}
        >
          Flagged
        </button>
      </SectionTitle>
      {rows.length ? (
        <ScrollX label="District ranking table">
          <table className="w-full min-w-[760px] text-xs">
            <thead className="border-b border-border/70 text-muted-foreground">
              <tr>
                {head("name", "District", undefined, true, "sticky left-0 z-10 bg-surface")}
                {head("pl", "PL filings", "Product liability cases commenced (Table C-11)")}
                <th scope="col" className="px-2 py-1.5 text-left font-medium">
                  Trend
                </th>
                {head(
                  "change",
                  "vs prior",
                  "Percent change from the prior fiscal year",
                  false,
                  LOW,
                )}
                {head(
                  "share",
                  "PL share",
                  "Product liability filings as a share of the district's civil filings",
                )}
                {head(
                  "natShare",
                  "Of national",
                  "Share of all federal product liability filings",
                  false,
                  LOW,
                )}
                {head(
                  "perJudgeship",
                  "PL / judgeship",
                  "Product liability filings per authorized judgeship (Table X-1A)",
                )}
                {head(
                  "mdl",
                  "PL MDL actions",
                  `Pending actions in products liability MDLs assigned to the district (JPML report${mdlAsOf ? `, ${mdlAsOf}` : ""}; a later date than the fiscal year)`,
                )}
                {head("civil", "Civil filings", "Civil cases commenced (Table C)", false, LOW)}
                {head(
                  "median",
                  "Median mo.",
                  "Median months from filing to disposition (Table C-5)",
                )}
                {head(
                  "over3",
                  "3+ yrs",
                  "Share of pending civil cases three years or older (Table C-6)",
                )}
                {head("flags", "Flags")}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, shown).map((d, n) => {
                const f = d.flags.filter((x) => x.year === year);
                const ch = yi > 0 ? change(at(d.pl, yi), at(d.pl, yi - 1)) : null;
                const medianDash = isDash(d.dash, "median", year);
                return (
                  <tr
                    key={d.id}
                    className="group border-b border-border/50 last:border-0 hover:bg-muted/40"
                  >
                    <td className="sticky left-0 z-10 max-w-[230px] bg-surface px-2 py-1 group-hover:bg-muted">
                      <span className="mr-1.5 inline-block w-5 text-right font-mono text-[11px] text-muted-foreground">
                        {n + 1}
                      </span>
                      <Link
                        to="/courts/$id"
                        params={{ id: d.id }}
                        className="font-medium text-primary hover:underline"
                      >
                        {d.name}
                      </Link>
                      <span className="ml-1 text-[11px] text-muted-foreground">
                        {d.circuit ? (CIRCUIT_SHORT[d.circuit] ?? "") : ""}
                      </span>
                    </td>
                    <td
                      className="px-2 py-1 text-right font-mono tabular-nums"
                      title={isDash(d.dash, "pl", year) ? DASH_TITLE : undefined}
                    >
                      {fmtCell(at(d.pl, yi), isDash(d.dash, "pl", year))}
                    </td>
                    <td className="px-2 py-1">
                      <Spark
                        values={d.pl}
                        highlight={yi}
                        label={`${d.name} product liability filings by fiscal year`}
                      />
                    </td>
                    <td
                      className={cn(
                        "px-2 py-1 text-right font-mono tabular-nums hidden min-[1100px]:table-cell",
                        ch !== null && ch >= 100
                          ? "text-warning-foreground"
                          : "text-muted-foreground",
                      )}
                    >
                      {ch === null ? "—" : `${ch > 0 ? "+" : ""}${ch.toFixed(0)}%`}
                    </td>
                    <td className="px-2 py-1 text-right font-mono tabular-nums">
                      {fmtPct(at(d.share, yi))}
                    </td>
                    <td className="px-2 py-1 text-right font-mono tabular-nums hidden min-[1100px]:table-cell">
                      {fmtPct(at(d.natShare, yi))}
                    </td>
                    <td className="px-2 py-1 text-right font-mono tabular-nums">
                      {fmtNum(at(d.plPerJudgeship, yi), 1)}
                    </td>
                    <td
                      className="px-2 py-1 text-right font-mono tabular-nums"
                      title={
                        d.mdl
                          ? `${fmtNum(d.mdl.plDockets)} products liability MDL dockets · ${fmtNum(d.mdl.plActions)} pending actions${d.mdl.asOf ? ` · JPML ${d.mdl.asOf}` : ""}`
                          : undefined
                      }
                    >
                      {d.mdl?.plActions ? (
                        fmtNum(d.mdl.plActions)
                      ) : (
                        <span className="text-muted-foreground">
                          {d.mdl ? "0" : "Not recorded"}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1 text-right font-mono tabular-nums hidden min-[1100px]:table-cell">
                      {fmtCell(at(d.civil, yi), isDash(d.dash, "civil", year))}
                    </td>
                    <td
                      className="px-2 py-1 text-right font-mono tabular-nums"
                      title={medianDash ? DASH_TITLE : undefined}
                    >
                      {fmtCell(at(d.median, yi), medianDash, 1)}
                    </td>
                    <td className="px-2 py-1 text-right font-mono tabular-nums">
                      {isDash(d.dash, "over3", year) && at(d.over3, yi) === null
                        ? "–"
                        : fmtPct(at(d.over3, yi))}
                    </td>
                    <td className="px-2 py-1 text-right">
                      {f.length ? (
                        <span
                          className="rounded border border-warning/40 bg-warning/15 px-1.5 py-px font-mono text-[11px] text-warning-foreground"
                          title={f
                            .map((x) => `${RULE_FALLBACK_SHORT[x.rule]}: ${flagDetail(x)}`)
                            .join("\n")}
                        >
                          {f.length}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </ScrollX>
      ) : (
        <p className="px-3 py-5 text-center text-xs text-muted-foreground">
          No districts match these filters.
        </p>
      )}
      {rows.length > PAGE ? (
        <div className="flex items-center gap-3 border-t border-border/70 px-3 py-1.5 text-xs text-muted-foreground">
          <span>
            Showing {Math.min(shown, rows.length)} of {rows.length}
          </span>
          <button
            type="button"
            onClick={() => setShown((v) => (v >= rows.length ? PAGE : rows.length))}
            className="rounded-md border border-border px-2 py-0.5 text-foreground hover:bg-muted"
          >
            {shown >= rows.length ? "Show fewer" : "Show all"}
          </button>
        </div>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------- heat table

type HeatMetric = "pl" | "share" | "median";
const HEAT: Record<
  HeatMetric,
  {
    label: string;
    digits: number;
    pick: (d: DistrictRow) => Series;
    note: string;
    dashKey: string | null;
  }
> = {
  pl: {
    label: "PL filings",
    dashKey: "pl",
    digits: 0,
    pick: (d) => d.pl,
    note: "Product liability filings (Table C-11)",
  },
  share: {
    label: "PL share %",
    dashKey: null,
    digits: 1,
    pick: (d) => d.share,
    note: "Product liability share of civil filings (Tables C-11, C)",
  },
  median: {
    label: "Median months",
    dashKey: "median",
    digits: 1,
    pick: (d) => d.median,
    note: "Median months filing to disposition (Table C-5)",
  },
};

function HeatTable({ data, yi }: { data: CourtStatsOverview; yi: number }) {
  const [metric, setMetric] = useState<HeatMetric>("pl");
  const [all, setAll] = useState(false);
  const m = HEAT[metric];
  const ranked = useMemo(
    () =>
      [...data.districts]
        .filter((d) => at(m.pick(d), yi) !== null)
        .sort((a, b) => (at(m.pick(b), yi) ?? 0) - (at(m.pick(a), yi) ?? 0)),
    [data.districts, m, yi],
  );
  const rows = all ? ranked : ranked.slice(0, 20);
  const mdlAsOf = data.districts.find((d) => d.mdl?.asOf)?.mdl?.asOf ?? null;
  return (
    <section
      className="rounded-md border border-border bg-surface"
      aria-label="District by fiscal year heat table"
    >
      <SectionTitle
        title="District × fiscal year"
        subtitle={`${m.note}. Districts ordered by ${fy(data.years[yi]!)}. Shading is relative to each district's own FY${data.years[0]}-FY${data.years.at(-1)} maximum; outlined cells carry a product liability surge or drop flag.`}
      >
        <div role="group" aria-label="Heat table metric" className="flex gap-1">
          {(Object.keys(HEAT) as HeatMetric[]).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={metric === k}
              onClick={() => setMetric(k)}
              className={cn(
                "h-7 rounded-md border px-2 text-[11px]",
                metric === k
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border hover:bg-muted",
              )}
            >
              {HEAT[k].label}
            </button>
          ))}
        </div>
      </SectionTitle>
      <ScrollX label="District by fiscal year table">
        <table className="w-full min-w-[860px] border-separate border-spacing-0 text-[11px]">
          <thead className="text-muted-foreground">
            <tr>
              <th
                scope="col"
                className="sticky left-0 z-10 bg-surface px-2 py-1 text-left font-medium"
              >
                District
              </th>
              <th
                scope="col"
                className="border-r border-border/70 px-1.5 py-1 text-right font-medium"
                title={`Pending actions in products liability MDLs assigned to the district (JPML report${mdlAsOf ? `, ${mdlAsOf}` : ""})`}
              >
                PL MDL
              </th>
              {data.years.map((y, i) => (
                <th
                  key={y}
                  scope="col"
                  className={cn("px-1 py-1 text-right font-medium", i === yi && "text-foreground")}
                >
                  {`'${String(y).slice(2)}`}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => {
              const values = m.pick(d);
              const rowMax = Math.max(0, ...values.filter((v): v is number => v !== null));
              return (
                <tr key={d.id}>
                  <th
                    scope="row"
                    className="sticky left-0 z-10 max-w-[180px] truncate bg-surface px-2 py-0.5 text-left font-normal"
                  >
                    <Link
                      to="/courts/$id"
                      params={{ id: d.id }}
                      className="text-primary hover:underline"
                    >
                      {d.name}
                    </Link>
                  </th>
                  <td
                    className="border-r border-border/70 px-1.5 py-0.5 text-right font-mono tabular-nums text-muted-foreground"
                    title={
                      d.mdl
                        ? `${fmtNum(d.mdl.plDockets)} products liability MDL dockets · ${fmtNum(d.mdl.plActions)} pending actions`
                        : "Not recorded"
                    }
                  >
                    {d.mdl?.plActions ? compactNum(d.mdl.plActions) : d.mdl ? "0" : "·"}
                  </td>
                  {values.map((v, i) => {
                    const y = data.years[i]!;
                    const flag =
                      metric !== "median" &&
                      d.flags.some(
                        (f) => f.year === y && (f.rule === "pl_surge" || f.rule === "pl_decline"),
                      );
                    const intensity = heat(v, rowMax);
                    const dashed = !!m.dashKey && v === null && isDash(d.dash, m.dashKey, y);
                    return (
                      <td
                        key={y}
                        className={cn(
                          "px-1 py-0.5 text-right font-mono tabular-nums",
                          flag && "outline outline-1 -outline-offset-1 outline-destructive",
                          i === yi && "font-semibold",
                        )}
                        style={{
                          background:
                            v === null
                              ? undefined
                              : `color-mix(in srgb, var(--primary) ${Math.round(intensity * 38)}%, transparent)`,
                        }}
                        title={`${d.name} ${fy(y)}: ${dashed ? DASH_TITLE : fmtNum(v, m.digits)}${flag ? " · flagged" : ""}`}
                      >
                        {v === null
                          ? dashed
                            ? "–"
                            : "·"
                          : m.digits
                            ? v.toFixed(m.digits)
                            : compactNum(v)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </ScrollX>
      <div className="flex items-center gap-3 border-t border-border/70 px-3 py-1.5 text-xs text-muted-foreground">
        <span>
          {rows.length} of {ranked.length} districts with a {fy(data.years[yi]!)} value · “–”
          printed as a dash in the source · “·” Not recorded · PL MDL is pending actions in products
          liability MDLs{mdlAsOf ? ` (JPML, ${mdlAsOf})` : ""}
        </span>
        {ranked.length > 20 ? (
          <button
            type="button"
            onClick={() => setAll((v) => !v)}
            className="rounded-md border border-border px-2 py-0.5 text-foreground hover:bg-muted"
          >
            {all ? "Top 20" : "Show all"}
          </button>
        ) : null}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- circuits

function CircuitSection({ data, yi }: { data: CourtStatsOverview; yi: number }) {
  const year = data.years[yi]!;
  const bars = data.circuits.map((c) => ({
    name: CIRCUIT_SHORT[c.id] ?? c.id,
    full: c.name,
    perJ: at(c.districtPerJudgeship, yi),
    median: at(c.medianNoticeToFinal, yi),
  }));
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <section
        className="rounded-md border border-border bg-surface lg:col-span-2"
        aria-label="Circuit comparison"
      >
        <SectionTitle
          title={`Circuit comparison, ${fy(year)}`}
          subtitle="Courts of appeals (Tables B, B-4, B-7) with the circuit's district courts rolled up (C, C-11)"
        />
        <ScrollX label="Circuit comparison table">
          <table className="w-full min-w-[720px] text-xs">
            <thead className="border-b border-border/70 text-muted-foreground">
              <tr>
                <th
                  scope="col"
                  className="sticky left-0 z-10 bg-surface px-2 py-1.5 text-left font-medium"
                >
                  Circuit
                </th>
                <th
                  scope="col"
                  className="px-2 py-1.5 text-right font-medium"
                  title="Appeals commenced (Table B)"
                >
                  Appeals filed
                </th>
                <th scope="col" className="px-2 py-1.5 text-left font-medium">
                  Trend
                </th>
                <th
                  scope="col"
                  className="px-2 py-1.5 text-right font-medium"
                  title="Median months from notice of appeal to final disposition, merits terminations (Table B-4)"
                >
                  Median mo.
                </th>
                <th
                  scope="col"
                  className="px-2 py-1.5 text-right font-medium"
                  title="Diversity personal injury / product liability appeals commenced (Table B-7)"
                >
                  Div. PI/PL appeals
                </th>
                <th
                  scope="col"
                  className="px-2 py-1.5 text-right font-medium"
                  title="District product liability filings in the circuit (Table C-11)"
                >
                  District PL
                </th>
                <th scope="col" className="px-2 py-1.5 text-right font-medium">
                  PL share
                </th>
                <th
                  scope="col"
                  className="px-2 py-1.5 text-right font-medium"
                  title="District PL filings per authorized district judgeship (Table X-1A; territorial courts excluded on both sides)"
                >
                  PL / judgeship
                </th>
              </tr>
            </thead>
            <tbody>
              {data.circuits.map((c: CircuitStats) => (
                <tr
                  key={c.id}
                  className="group border-b border-border/50 last:border-0 hover:bg-muted/40"
                >
                  <td className="sticky left-0 z-10 bg-surface px-2 py-1 group-hover:bg-muted">
                    <Link
                      to="/courts/$id"
                      params={{ id: c.id }}
                      className="font-medium text-primary hover:underline"
                    >
                      {c.name}
                    </Link>
                  </td>
                  <td className="px-2 py-1 text-right font-mono tabular-nums">
                    {fmtNum(at(c.appealsFiled, yi))}
                  </td>
                  <td className="px-2 py-1">
                    <Spark
                      values={c.appealsFiled}
                      highlight={yi}
                      color={FDA_COLORS[1]}
                      label={`${c.name} appeals filed by fiscal year`}
                    />
                  </td>
                  <td
                    className="px-2 py-1 text-right font-mono tabular-nums"
                    title={isDash(c.dash, "median_notice_to_final", year) ? DASH_TITLE : undefined}
                  >
                    {fmtCell(
                      at(c.medianNoticeToFinal, yi),
                      isDash(c.dash, "median_notice_to_final", year),
                      1,
                    )}
                  </td>
                  <td
                    className="px-2 py-1 text-right font-mono tabular-nums"
                    title={
                      isDash(c.dash, "diversity_pi_pl_appeals", year)
                        ? DASH_TITLE
                        : at(c.diversityPiPl, yi) === null
                          ? "Table B-7 is read from the Excel editions (FY2017 onward)"
                          : undefined
                    }
                  >
                    {fmtCell(
                      at(c.diversityPiPl, yi),
                      isDash(c.dash, "diversity_pi_pl_appeals", year),
                    )}
                  </td>
                  <td className="px-2 py-1 text-right font-mono tabular-nums">
                    {fmtNum(at(c.districtPl, yi))}
                  </td>
                  <td className="px-2 py-1 text-right font-mono tabular-nums">
                    {fmtPct(at(c.districtShare, yi))}
                  </td>
                  <td className="px-2 py-1 text-right font-mono tabular-nums">
                    {fmtNum(at(c.districtPerJudgeship, yi), 1)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollX>
      </section>
      <ChartCard
        title="Median months to merits decision, by circuit"
        subtitle={`Notice of appeal to final disposition, Table B-4, ${fy(year)} · line is the median circuit`}
      >
        <div className="h-72 px-2 py-2">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={bars}
              layout="vertical"
              margin={{ top: 4, right: 16, bottom: 0, left: 0 }}
            >
              <CartesianGrid stroke="var(--border)" horizontal={false} strokeDasharray="3 3" />
              <XAxis type="number" tick={axis} tickLine={false} axisLine={false} />
              <YAxis
                type="category"
                dataKey="name"
                tick={axis}
                width={36}
                interval={0}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                labelFormatter={(_, p) => String(p?.[0]?.payload?.full ?? "")}
                formatter={(v) => [`${fmtNum(asNum(v), 1)} months`, "Median"]}
              />
              {median(bars.map((b) => b.median)) !== null ? (
                <ReferenceLine
                  x={median(bars.map((b) => b.median))!}
                  stroke="var(--muted-foreground)"
                  strokeDasharray="4 3"
                />
              ) : null}
              <Bar
                dataKey="median"
                fill={FDA_COLORS[1]}
                maxBarSize={14}
                isAnimationActive={false}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>
      <ChartCard
        title="District product liability filings per judgeship, by circuit"
        subtitle={`Tables C-11 and X-1A, ${fy(year)} · line is the median circuit`}
      >
        <div className="h-72 px-2 py-2">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={bars}
              layout="vertical"
              margin={{ top: 4, right: 16, bottom: 0, left: 0 }}
            >
              <CartesianGrid stroke="var(--border)" horizontal={false} strokeDasharray="3 3" />
              <XAxis type="number" tick={axis} tickLine={false} axisLine={false} />
              <YAxis
                type="category"
                dataKey="name"
                tick={axis}
                width={36}
                interval={0}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                labelFormatter={(_, p) => String(p?.[0]?.payload?.full ?? "")}
                formatter={(v) => [fmtNum(asNum(v), 1), "PL filings per judgeship"]}
              />
              {median(bars.map((b) => b.perJ)) !== null ? (
                <ReferenceLine
                  x={median(bars.map((b) => b.perJ))!}
                  stroke="var(--muted-foreground)"
                  strokeDasharray="4 3"
                />
              ) : null}
              <Bar dataKey="perJ" fill={FDA_COLORS[0]} maxBarSize={14} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>
    </div>
  );
}

// ---------------------------------------------------------------- sources

const SOURCE_TABLES: [string, string][] = [
  ["C-11", "Product liability cases commenced, by nature of suit and district"],
  ["C", "Civil cases commenced, terminated and pending, by district"],
  ["C-3", "Civil cases commenced, by nature of suit and district"],
  ["C-5", "Median time intervals, filing to disposition, by district"],
  ["C-6", "Civil cases pending, by length of time pending"],
  ["X-1A", "Weighted and unweighted filings per authorized judgeship"],
  ["B", "Courts of appeals: appeals commenced, terminated and pending"],
  ["B-4", "Courts of appeals: median time intervals, merits terminations"],
  ["B-7", "Courts of appeals: civil and criminal appeals commenced, by nature of proceeding"],
];

const NOTE_LIMIT = 4;

function SourcesPanel({ data, year }: { data: CourtStatsOverview; year: number }) {
  const n = data.national;
  const [allNotes, setAllNotes] = useState(false);
  const src = (t: string) => n.sources[t]?.[String(year)];
  const c2a = Object.entries(n.sources["C-2A"] ?? {}).sort(([a], [b]) => a.localeCompare(b));
  const corr = n.mdlCorrelation;
  return (
    <section className="rounded-md border border-border bg-surface" aria-label="Sources and method">
      <SectionTitle
        title="Sources and method"
        subtitle={`Judicial Business of the United States Courts · retrieved ${n.retrievedAt ?? "Not recorded"}`}
      >
        <Info className="size-4 text-muted-foreground" aria-hidden />
      </SectionTitle>
      <div className="grid gap-4 px-3 py-2 text-xs lg:grid-cols-2">
        <div>
          <h4 className="mb-1 font-semibold">{fy(year)} tables</h4>
          <ul className="space-y-0.5">
            {SOURCE_TABLES.map(([t, label]) => {
              const s = src(t);
              return (
                <li key={t} className="flex gap-2">
                  <span className="w-10 shrink-0 font-mono text-muted-foreground">{t}</span>
                  {s ? (
                    <span className="min-w-0">
                      <a
                        href={s.page}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary hover:underline"
                      >
                        {label}
                      </a>
                      {s.url ? (
                        <a
                          href={s.url}
                          target="_blank"
                          rel="noreferrer"
                          className="ml-1.5 text-muted-foreground hover:underline"
                          aria-label={`Table ${t} ${fy(year)} data file (${(s.format ?? "file").toUpperCase()})`}
                        >
                          {(s.format ?? "file").toUpperCase()}
                        </a>
                      ) : null}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">
                      {label} · Not recorded for {fy(year)}
                    </span>
                  )}
                </li>
              );
            })}
            {c2a.length ? (
              <li className="flex gap-2">
                <span className="w-10 shrink-0 font-mono text-muted-foreground">C-2A</span>
                <span>
                  National nature of suit, five-year editions:{" "}
                  {c2a.map(([y, s], i) => (
                    <span key={y}>
                      {i ? ", " : ""}
                      <a
                        href={s.page}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary hover:underline"
                        aria-label={`Table C-2A, ${fy(Number(y))} edition`}
                      >
                        {fy(Number(y))}
                      </a>
                    </span>
                  ))}
                </span>
              </li>
            ) : null}
          </ul>
          {corr.rho !== null ? (
            <p className="mt-2 leading-relaxed text-muted-foreground">
              <span className="font-medium text-foreground">MDL association.</span> Spearman rank
              correlation across {fmtNum(corr.n)} districts: ρ = {corr.rho.toFixed(2)}. X: {corr.x}.
              Y: {corr.y}
              {corr.asOf ? ` (as of ${corr.asOf})` : ""}. It reflects where MDL dockets are
              assigned; it is an association, not a measure of forum preference.
            </p>
          ) : null}
        </div>
        <div>
          <h4 className="mb-1 font-semibold">
            Notes <span className="font-normal text-muted-foreground">({n.notes.length})</span>
          </h4>
          <ul
            id="court-notes"
            className="list-disc space-y-1 pl-4 leading-relaxed text-muted-foreground"
          >
            {(allNotes ? n.notes : n.notes.slice(0, NOTE_LIMIT)).map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
          <MoreToggle
            total={n.notes.length}
            limit={NOTE_LIMIT}
            expanded={allNotes}
            onToggle={() => setAllNotes((v) => !v)}
            controls="court-notes"
            noun="notes"
          />
          {n.checks.failed.length ? (
            <details className="mt-2">
              <summary className="cursor-pointer text-muted-foreground">
                Validation results not passed ({n.checks.failed.length})
              </summary>
              <ul className="mt-1 space-y-0.5 font-mono text-[11px] text-muted-foreground">
                {n.checks.failed.map((c) => (
                  <li key={c.check}>
                    {c.check}: {c.detail}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function Skeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading federal court statistics">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => (
          <div
            key={i}
            className="h-[66px] animate-pulse rounded-md border border-border bg-muted/50"
          />
        ))}
      </div>
      <div className="h-72 animate-pulse rounded-md border border-border bg-muted/50" />
      <div className="h-96 animate-pulse rounded-md border border-border bg-muted/50" />
    </div>
  );
}
