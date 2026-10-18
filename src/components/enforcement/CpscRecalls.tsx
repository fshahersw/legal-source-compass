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
import { Flag } from "lucide-react";
import { FDA_COLORS } from "@/components/fda-analytics/chartView";
import { getCpscAnalytics, type CpscAnalytics } from "@/lib/external/enforcement.functions";
import { cn } from "@/lib/utils";
import {
  count,
  countryShare,
  hazardCube,
  latestCompleteYear,
  pct,
  RISING_RULE,
  risingHazards,
} from "./enforcementView";
import {
  axisTick,
  FlagChip,
  Kpi,
  LoadingBlock,
  Panel,
  Segmented,
  SourceLink,
  StateNote,
  tooltipStyle,
} from "./parts";

export const cpscAnalyticsQuery = {
  queryKey: ["cpsc-recall-analytics"],
  queryFn: () => getCpscAnalytics(),
  staleTime: 10 * 60 * 1000,
};
const RECALL_DATASET = "agency_safety_cpsc_recalls_api";
const SHARE_COLORS = [FDA_COLORS[0], FDA_COLORS[2], FDA_COLORS[1], FDA_COLORS[3], FDA_COLORS[4]];

export function CpscRecalls() {
  const q = useQuery(cpscAnalyticsQuery);
  if (q.isLoading) return <LoadingBlock label="Loading CPSC recall analytics" />;
  if (q.isError)
    return (
      <StateNote
        tone="error"
        action={
          <button type="button" onClick={() => void q.refetch()} className="underline">
            Retry
          </button>
        }
      >
        CPSC recall analytics could not be loaded.
      </StateNote>
    );
  if (!q.data || !q.data.years.length)
    return <StateNote>CPSC recall analytics have not been published yet.</StateNote>;
  return <CpscBody data={q.data} />;
}

function CpscBody({ data }: { data: CpscAnalytics }) {
  const latest = latestCompleteYear(data.asOf, data.years.at(-1)?.year ?? 2025);
  const firstYear = data.years[0]?.year ?? 1973;
  const [fromId, setFromId] = useState<"2000" | "2010" | "all">("2000");
  const [hazard, setHazard] = useState("");
  const from = fromId === "all" ? firstYear : Number(fromId);
  const years = data.years.filter((y) => y.year >= from && y.year <= latest);
  const partial = data.years.filter((y) => y.year > latest);
  const label = (k: string) => data.hazardLabels[k] ?? k;
  const latestYear = data.years.find((y) => y.year === latest);
  const prior = [1, 2, 3].map((d) => data.years.find((y) => y.year === latest - d)?.recalls ?? 0);
  const priorMean = prior.reduce((a, b) => a + b, 0) / 3;
  const total = years.reduce((a, y) => a + y.recalls, 0);
  const deaths = years.reduce((a, y) => a + y.deathMentions, 0);
  const injuries = years.reduce((a, y) => a + y.injuryMentions, 0);
  const standard = years.reduce((a, y) => a + y.standardViolation, 0);
  const rising = useMemo(() => risingHazards(data.hazards, latest), [data.hazards, latest]);
  const countries = data.topCountries.slice(0, 5);

  const hazardRows = data.hazards
    .map((h) => {
      const by = new Map(h.years.map((y) => [y.year, y]));
      const series = years.map((y) => ({ year: y.year, recalls: by.get(y.year)?.recalls ?? 0 }));
      return {
        ...h,
        series,
        windowTotal: series.reduce((a, s) => a + s.recalls, 0),
        windowDeaths: years.reduce((a, y) => a + (by.get(y.year)?.deathMentions ?? 0), 0),
      };
    })
    .sort((a, b) => b.windowTotal - a.windowTotal);
  const hazardMax = Math.max(1, ...hazardRows.flatMap((h) => h.series.map((s) => s.recalls)));

  const shareRows = years.map((y) => {
    const denominator = hazard ? (y.hazards[hazard] ?? 0) : y.recalls;
    const source = hazard ? (y.hazardCountry[hazard] ?? {}) : y.countries;
    const row: Record<string, number | string | null> = {
      year: String(y.year),
      coverage: y.recalls ? Math.round((y.withCountry / y.recalls) * 1000) / 10 : null,
    };
    for (const c of countries)
      row[c] = denominator ? Math.round(((source[c] ?? 0) / denominator) * 1000) / 10 : null;
    return row;
  });

  const cubeFrom = latest - 4;
  const cube = hazardCube(data.years, cubeFrom, latest);
  const cubeCols = [...countries, "Other countries", "Not recorded"];
  const cubeMax = Math.max(1, ...[...cube.values()].flatMap((m) => [...m.values()]));
  const mentionRows = years.map((y) => ({
    year: String(y.year),
    death: y.deathMentions,
    injury: y.injuryMentions,
  }));
  const chinaShare = latestYear ? countryShare(latestYear, "China") : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">CPSC consumer product recalls</h2>
          <p className="text-xs text-muted-foreground">
            {count(data.recalls)} recalls from the official CPSC Recall API ({data.firstDate} to{" "}
            {data.asOf}; retrieved {data.retrieved}). Hazard categories are keyword-classified from
            the hazard statement and title; a recall can fall in several.
          </p>
        </div>
        <Segmented
          label="Year window"
          value={fromId}
          options={[
            { id: "2000", label: `2000–${latest}` },
            { id: "2010", label: `2010–${latest}` },
            { id: "all", label: `${firstYear}–${latest}` },
          ]}
          onChange={setFromId}
        />
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi label="Recalls" value={count(total)} note={`${from}–${latest}`} />
        <Kpi
          label={`Recalls in ${latest}`}
          value={count(latestYear?.recalls ?? 0)}
          note={`prior 3-year mean ${priorMean.toFixed(0)}`}
        />
        <Kpi
          label={`Made in China · ${latest}`}
          value={pct(chinaShare)}
          note="of recalls with a recorded country"
        />
        <Kpi
          label="Injury text mentions a death"
          value={count(deaths)}
          note={total ? `${pct(deaths / total, 1)} of recalls` : undefined}
          tone="destructive"
        />
        <Kpi
          label="Injury text mentions injuries"
          value={count(injuries)}
          note={total ? `${pct(injuries / total, 0)} of recalls` : undefined}
        />
        <Kpi
          label="Cites a standard violation"
          value={count(standard)}
          note={total ? `${pct(standard / total, 0)} of recalls` : undefined}
        />
      </div>
      {partial.length ? (
        <p className="text-[11px] text-muted-foreground">
          {partial
            .map((p) => `${p.year}: ${count(p.recalls)} recalls through ${data.asOf}`)
            .join("; ")}{" "}
          — partial year, excluded from trends and flags.
          {latestYear?.unitsParsed
            ? ` In ${latest}, ${count(latestYear.unitsParsed)} of ${count(latestYear.recalls)} recalls state a single parseable unit count, totalling ${count(latestYear.unitsSum)} units.`
            : ""}
        </p>
      ) : null}

      <Panel
        title="Recalls by hazard over time"
        subtitle={`Recalls per year, ${from}–${latest}; same y-scale across panels. Select a hazard to filter the country charts.`}
        footnote={
          <>
            Classification: deterministic keyword rules over hazard text and title (hover a panel
            for its rule). Source: <SourceLink href={data.apiDoc}>CPSC Recall API</SourceLink>
          </>
        }
      >
        <ul className="grid grid-cols-2 gap-px bg-border/60 sm:grid-cols-3 lg:grid-cols-5">
          {hazardRows.map((h) => (
            <li key={h.key} className="bg-surface">
              <button
                type="button"
                aria-pressed={hazard === h.key}
                onClick={() => setHazard(hazard === h.key ? "" : h.key)}
                title={`Rule: ${h.rule}`}
                className={cn(
                  "w-full px-2.5 pb-1 pt-2 text-left hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-ring",
                  hazard === h.key && "bg-primary/5 ring-1 ring-inset ring-primary/40",
                )}
              >
                <span className="flex items-baseline justify-between gap-1">
                  <span className="truncate text-[11.5px] font-semibold">{h.label}</span>
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {count(h.windowTotal)}
                  </span>
                </span>
                <span className="block text-[10.5px] text-muted-foreground">
                  {count(h.windowDeaths)} with a death mention
                  {rising.some((r) => r.key === h.key) ? (
                    <>
                      {" "}
                      <FlagChip title={RISING_RULE}>Rising</FlagChip>
                    </>
                  ) : null}
                </span>
                <span className="mt-1 block h-11" aria-hidden>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={h.series} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                      <YAxis hide domain={[0, hazardMax]} />
                      <Tooltip
                        contentStyle={tooltipStyle}
                        labelFormatter={(_, p) => String(p?.[0]?.payload?.year ?? "")}
                        formatter={(v) => [Number(v).toLocaleString("en-US"), "recalls"]}
                      />
                      <Bar
                        dataKey="recalls"
                        fill={hazard === h.key ? FDA_COLORS[2] : FDA_COLORS[1]}
                        isAnimationActive={false}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Panel>

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel
          title={`Manufacturer-country share${hazard ? ` · ${label(hazard)}` : ""}`}
          subtitle={`% of ${hazard ? "the hazard's" : "all"} recalls per year that list each manufacturing country; dashed line = % of recalls with any country recorded`}
          footnote="A recall can list several countries. Country qualifiers in parentheses are dropped; nothing else is normalised."
        >
          <div className="h-64 px-1 pb-1 pt-2">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={shareRows} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
                <XAxis
                  dataKey="year"
                  tick={axisTick}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={16}
                />
                <YAxis
                  width={38}
                  tick={axisTick}
                  tickLine={false}
                  axisLine={false}
                  domain={[0, 100]}
                  tickFormatter={(v: number) => `${v}%`}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={(v, n) => [v == null ? "—" : `${v}%`, n]}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} iconSize={8} />
                {countries.map((c, i) => (
                  <Line
                    key={c}
                    dataKey={c}
                    stroke={SHARE_COLORS[i % SHARE_COLORS.length]}
                    strokeWidth={c === "China" ? 2.2 : 1.5}
                    dot={false}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                ))}
                <Line
                  dataKey="coverage"
                  name="Country recorded"
                  stroke="var(--muted-foreground)"
                  strokeDasharray="4 3"
                  strokeWidth={1}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel
          title="Injury and death mentions"
          subtitle={`Recalls per year whose injury statement mentions a death, or an injury, ${from}–${latest}`}
          footnote="Text mentions after removing explicitly negated phrases (e.g. “no reports of injury or death”). Some statements cite background statistics; a mention is not a verified count of deaths caused by the product."
        >
          <div className="h-64 px-1 pb-1 pt-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={mentionRows} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
                <XAxis
                  dataKey="year"
                  tick={axisTick}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={16}
                />
                <YAxis
                  width={36}
                  tick={axisTick}
                  tickLine={false}
                  axisLine={false}
                  allowDecimals={false}
                />
                <Tooltip contentStyle={tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 11 }} iconSize={8} />
                <Bar
                  dataKey="injury"
                  name="Mentions injuries"
                  fill={FDA_COLORS[5]}
                  isAnimationActive={false}
                />
                <Bar
                  dataKey="death"
                  name="Mentions a death"
                  fill="var(--destructive)"
                  isAnimationActive={false}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      <Panel
        title={`Hazard × manufacturing country · ${cubeFrom}–${latest}`}
        subtitle="Recalls per hazard category and listed country; a recall listing several countries counts once in each"
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-xs">
            <thead className="text-[11px] text-muted-foreground">
              <tr className="border-b border-border">
                <th scope="col" className="px-2 py-1.5 text-left font-medium">
                  Hazard
                </th>
                {cubeCols.map((c) => (
                  <th key={c} scope="col" className="px-2 py-1.5 text-right font-medium">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {hazardRows
                .filter((h) => cube.has(h.key))
                .map((h) => (
                  <tr
                    key={h.key}
                    className={cn("border-b border-border/50", hazard === h.key && "bg-primary/5")}
                  >
                    <th scope="row" className="px-2 py-1 text-left font-medium">
                      {h.label}
                    </th>
                    {cubeCols.map((c) => {
                      const v = cube.get(h.key)?.get(c) ?? 0;
                      return (
                        <td
                          key={c}
                          className="px-2 py-1 text-right font-mono"
                          style={{
                            background: v
                              ? `color-mix(in srgb, var(--primary) ${Math.round(6 + 40 * Math.sqrt(v / cubeMax))}%, transparent)`
                              : undefined,
                          }}
                        >
                          {v ? count(v) : "—"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="grid gap-3 xl:grid-cols-[20rem_minmax(0,1fr)]">
        <Panel
          title="Flags"
          subtitle="Deterministic rules"
          footnote="A flag is a lead to review, not a finding."
        >
          <div className="space-y-3 p-3 text-xs">
            <div>
              <p className="flex items-center gap-1 font-medium">
                <Flag className="size-3.5 text-warning" aria-hidden /> Rising hazards · {latest}
              </p>
              <p className="text-[11px] text-muted-foreground">{RISING_RULE}</p>
              {rising.length ? (
                <ul className="mt-1 space-y-0.5">
                  {rising.map((r) => (
                    <li key={r.key} className="flex justify-between gap-2">
                      <button
                        type="button"
                        className="text-left text-primary hover:underline"
                        onClick={() => setHazard(r.key)}
                      >
                        {r.label}
                      </button>
                      <span className="shrink-0 font-mono text-muted-foreground">
                        {r.latest} vs {r.baseline.toFixed(1)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-muted-foreground">No hazard meets the rule.</p>
              )}
            </div>
            <div>
              <p className="flex items-center gap-1 font-medium">
                <Flag className="size-3.5 text-warning" aria-hidden /> Firm clusters
              </p>
              <p className="text-[11px] text-muted-foreground">
                At least {data.firmMin} recalls dated after {data.firmWindowStart ?? "—"} (24 months
                before the latest recall) naming the same exact recorded manufacturer, importer or
                distributor.
              </p>
              {data.firmClusters.length ? (
                <ul className="mt-1 max-h-72 space-y-1 overflow-auto pr-1">
                  {data.firmClusters.map((f) => (
                    <li key={f.id}>
                      <Link
                        to="/records/$dataset/$id"
                        params={{ dataset: "regulatory_cpsc_aggregates", id: f.id }}
                        className="font-medium text-primary hover:underline"
                      >
                        {f.name}
                      </Link>
                      <span className="block text-[10.5px] text-muted-foreground">
                        {f.recent24m} in 24 months · {f.recalls} total
                        {f.deathMentions
                          ? ` · ${f.deathMentions} death mention${f.deathMentions === 1 ? "" : "s"}`
                          : ""}{" "}
                        · {f.topHazards.map(label).slice(0, 2).join(", ")}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-muted-foreground">No firm meets the rule.</p>
              )}
            </div>
          </div>
        </Panel>
        <Panel
          title="Latest recalls whose injury statement mentions a death"
          subtitle={`${count(data.deathRecalls.length)} most recent, newest first`}
          footnote="Titles open the stored record; recall numbers open the CPSC notice."
        >
          {data.deathRecalls.length ? (
            <div className="max-h-[30rem] overflow-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-surface text-[11px] text-muted-foreground">
                  <tr className="border-b border-border">
                    <th scope="col" className="px-2 py-1.5 text-left font-medium">
                      Date
                    </th>
                    <th scope="col" className="px-2 py-1.5 text-left font-medium">
                      Recall
                    </th>
                    <th
                      scope="col"
                      className="hidden px-2 py-1.5 text-left font-medium md:table-cell"
                    >
                      Injury statement (as published)
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.deathRecalls.map((r) => (
                    <tr key={r.id} className="border-b border-border/50 align-top">
                      <td className="whitespace-nowrap px-2 py-1.5 font-mono text-[11px]">
                        {r.date ?? "—"}
                      </td>
                      <td className="max-w-80 px-2 py-1.5">
                        <Link
                          to="/records/$dataset/$id"
                          params={{ dataset: RECALL_DATASET, id: r.id }}
                          className="font-medium text-primary hover:underline"
                        >
                          {r.title}
                        </Link>
                        <span className="block text-[10.5px] text-muted-foreground">
                          {r.url ? (
                            <SourceLink href={r.url}>Recall {r.recallNumber}</SourceLink>
                          ) : (
                            `Recall ${r.recallNumber}`
                          )}
                          {r.firms.length ? ` · ${r.firms.join("; ")}` : ""}
                        </span>
                      </td>
                      <td className="hidden max-w-96 px-2 py-1.5 text-muted-foreground md:table-cell">
                        <span className="line-clamp-3">{r.injuries || "Not recorded"}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <StateNote>No recall has an injury statement mentioning a death.</StateNote>
          )}
        </Panel>
      </div>

      <Panel
        title="Most frequent recalling firms (all years)"
        subtitle="Exact recorded manufacturer, importer or distributor names; spelling variants of the same company are listed separately; role counts can exceed recalls when a firm holds several roles in one recall"
      >
        <div className="max-h-80 overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-surface text-[11px] text-muted-foreground">
              <tr className="border-b border-border">
                <th scope="col" className="px-2 py-1.5 text-left font-medium">
                  Firm (as recorded)
                </th>
                <th scope="col" className="px-2 py-1.5 text-right font-medium">
                  Recalls
                </th>
                <th scope="col" className="hidden px-2 py-1.5 text-left font-medium sm:table-cell">
                  Roles
                </th>
                <th scope="col" className="px-2 py-1.5 text-left font-medium">
                  Latest
                </th>
              </tr>
            </thead>
            <tbody>
              {data.topFirms.map((f) => (
                <tr key={f.id} className="border-b border-border/50">
                  <td className="max-w-80 px-2 py-1">
                    <Link
                      to="/records/$dataset/$id"
                      params={{ dataset: "regulatory_cpsc_aggregates", id: f.id }}
                      className="text-primary hover:underline"
                    >
                      {f.name}
                    </Link>
                  </td>
                  <td className="px-2 py-1 text-right font-mono">{count(f.recalls)}</td>
                  <td className="hidden px-2 py-1 text-muted-foreground sm:table-cell">
                    {Object.entries(f.roles)
                      .map(([role, n]) => `${role} ${n}`)
                      .join(" · ")}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1 font-mono text-[11px]">
                    {f.lastDate ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
