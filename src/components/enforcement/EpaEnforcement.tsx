import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
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
import { Flag, MapPin, X } from "lucide-react";
import { UsMap } from "@/components/corpus/UsMap";
import { FDA_COLORS } from "@/components/fda-analytics/chartView";
import { useCorpus } from "@/lib/corpus/store";
import {
  getEpaCases,
  getEpaEnforcement,
  getEpaStateDetail,
  type EpaDefendant,
  type EpaEnforcement as EpaData,
  type EpaProfile,
} from "@/lib/external/enforcement.functions";
import { cn } from "@/lib/utils";
import {
  count,
  denseYears,
  fyWindows,
  latestCompleteFy,
  median,
  PER_CAPITA_RULE,
  sortRows,
  stateRows,
  sumYears,
  SURGE_RULE,
  usd,
  usdFull,
  type SortKey,
} from "./enforcementView";
import {
  axisTick,
  FlagChip,
  Kpi,
  LoadingBlock,
  Panel,
  Segmented,
  SortHeader,
  SourceLink,
  StateNote,
  tooltipStyle,
} from "./parts";

export const epaEnforcementQuery = {
  queryKey: ["epa-enforcement"],
  queryFn: () => getEpaEnforcement(),
  staleTime: 10 * 60 * 1000,
};
const epaCasesQuery = {
  queryKey: ["epa-enforcement-cases"],
  queryFn: () => getEpaCases(),
  staleTime: 10 * 60 * 1000,
};

type Metric = "penalty" | "cases" | "perMillion";
const METRIC_LABEL: Record<Metric, string> = {
  penalty: "million USD federal penalties",
  cases: "cases",
  perMillion: "FY2025 cases per million residents",
};
const PAGE = 25;
const CASE_DATASET = "regulatory_epa_cases";

function TrendChart({ profile, from, to }: { profile: EpaProfile; from: number; to: number }) {
  const rows = denseYears(profile.years, from, to).map((y) => ({
    fy: `FY${String(y.fy).slice(2)}`,
    judicial: y.judicial,
    administrative: y.administrative,
    penalty: Math.round(y.fedPenalty / 1e5) / 10,
  }));
  const med = median(rows.map((r) => r.judicial + r.administrative));
  if (!rows.some((r) => r.judicial + r.administrative > 0))
    return <StateNote>No cases are recorded for this selection and window.</StateNote>;
  return (
    <div className="h-64 px-1 pb-1 pt-2">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 6, right: 4, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
          <XAxis dataKey="fy" tick={axisTick} tickLine={false} axisLine={false} minTickGap={8} />
          <YAxis
            yAxisId="left"
            width={40}
            tick={axisTick}
            tickLine={false}
            axisLine={false}
            allowDecimals={false}
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            width={44}
            tick={axisTick}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => `$${v}M`}
          />
          <Tooltip
            contentStyle={tooltipStyle}
            formatter={(v, name) =>
              name === "Federal penalties ($M)"
                ? [`$${Number(v).toLocaleString("en-US")}M`, name]
                : [Number(v).toLocaleString("en-US"), name]
            }
          />
          <Legend wrapperStyle={{ fontSize: 11 }} iconSize={8} />
          <Bar
            yAxisId="left"
            dataKey="administrative"
            name="Administrative formal"
            stackId="c"
            fill={FDA_COLORS[5]}
            isAnimationActive={false}
          />
          <Bar
            yAxisId="left"
            dataKey="judicial"
            name="Civil judicial"
            stackId="c"
            fill={FDA_COLORS[0]}
            isAnimationActive={false}
          />
          <Line
            yAxisId="right"
            dataKey="penalty"
            name="Federal penalties ($M)"
            stroke={FDA_COLORS[2]}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
          {med != null ? (
            <ReferenceLine
              yAxisId="left"
              y={med}
              stroke="var(--muted-foreground)"
              strokeDasharray="4 3"
              label={{
                value: `median ${med}`,
                fontSize: 10,
                fill: "var(--muted-foreground)",
                position: "insideTopLeft",
              }}
            />
          ) : null}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function StatuteMultiples({
  national,
  from,
  to,
  active,
  onPick,
}: {
  national: EpaProfile;
  from: number;
  to: number;
  active: string;
  onPick: (code: string) => void;
}) {
  const statutes = national.statutes
    .filter((s) => s.code)
    .map((s) => {
      const years = denseYears(
        s.years.map((y) => ({
          fy: y.fy,
          cases: y.cases,
          judicial: 0,
          administrative: 0,
          penaltyCases: 0,
          fedPenalty: y.fedPenalty,
          sep: 0,
          costRecovery: 0,
        })),
        from,
        to,
      );
      return {
        code: s.code!,
        name: s.name,
        years,
        cases: years.reduce((a, y) => a + y.cases, 0),
        penalty: years.reduce((a, y) => a + y.fedPenalty, 0),
      };
    })
    .filter((s) => s.cases > 0)
    .sort((a, b) => b.cases - a.cases)
    .slice(0, 8);
  const max = Math.max(1, ...statutes.flatMap((s) => s.years.map((y) => y.cases)));
  return (
    <ul className="grid grid-cols-2 gap-px bg-border/60 sm:grid-cols-4">
      {statutes.map((s) => (
        <li key={s.code} className="bg-surface">
          <button
            type="button"
            aria-pressed={active === s.code}
            onClick={() => onPick(active === s.code ? "" : s.code)}
            title={s.name}
            className={cn(
              "w-full px-2.5 pb-1 pt-2 text-left hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-ring",
              active === s.code && "bg-primary/5 ring-1 ring-inset ring-primary/40",
            )}
          >
            <span className="flex items-baseline justify-between gap-1">
              <span className="text-xs font-semibold">{s.code}</span>
              <span className="font-mono text-[11px] text-muted-foreground">{count(s.cases)}</span>
            </span>
            <span className="block truncate text-[10.5px] text-muted-foreground">
              {usd(s.penalty)}
            </span>
            <span className="mt-1 block h-12" aria-hidden>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={s.years} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                  <YAxis hide domain={[0, max]} />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    labelFormatter={(_, p) => `FY${String(p?.[0]?.payload?.fy ?? "")}`}
                    formatter={(v) => [Number(v).toLocaleString("en-US"), "cases"]}
                  />
                  <Bar
                    dataKey="cases"
                    fill={active === s.code ? FDA_COLORS[2] : FDA_COLORS[1]}
                    isAnimationActive={false}
                  />
                </BarChart>
              </ResponsiveContainer>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function DefendantTable({ rows, scope }: { rows: EpaDefendant[]; scope: string }) {
  const [shown, setShown] = useState(15);
  if (!rows.length)
    return <StateNote>No defendants with a recorded federal penalty in {scope}.</StateNote>;
  return (
    <div>
      <div className="max-h-[26rem] overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-surface text-[11px] text-muted-foreground">
            <tr className="border-b border-border">
              <th scope="col" className="px-2 py-1.5 text-left font-medium">
                Defendant (exact recorded name)
              </th>
              <th scope="col" className="px-2 py-1.5 text-right font-medium">
                Cases
              </th>
              <th scope="col" className="px-2 py-1.5 text-right font-medium">
                Judicial
              </th>
              <th scope="col" className="px-2 py-1.5 text-right font-medium">
                Federal penalties
              </th>
              <th scope="col" className="hidden px-2 py-1.5 text-left font-medium md:table-cell">
                FY span · statutes · states
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, shown).map((d) => (
              <tr key={d.name} className="border-b border-border/50 align-top">
                <td className="max-w-64 px-2 py-1.5">
                  <span className="font-medium">{d.name}</span>
                  {d.multiDefendantCases ? (
                    <span className="block text-[10.5px] text-muted-foreground">
                      {d.multiDefendantCases} multi-defendant case
                      {d.multiDefendantCases === 1 ? "" : "s"} (full case penalty counted)
                    </span>
                  ) : null}
                </td>
                <td className="px-2 py-1.5 text-right font-mono">{count(d.cases)}</td>
                <td className="px-2 py-1.5 text-right font-mono">{count(d.judicial)}</td>
                <td className="px-2 py-1.5 text-right font-mono" title={usdFull(d.fedPenalty)}>
                  {usd(d.fedPenalty)}
                </td>
                <td className="hidden px-2 py-1.5 text-muted-foreground md:table-cell">
                  {d.firstFy
                    ? `FY${d.firstFy}${d.lastFy !== d.firstFy ? `–${d.lastFy}` : ""}`
                    : "—"}
                  {" · "}
                  {d.statutes.join(", ") || "—"}
                  {" · "}
                  {d.states.join(", ") || "Not recorded"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {shown < rows.length ? (
        <button
          type="button"
          onClick={() => setShown((n) => n + 25)}
          className="m-2 rounded-md border border-border px-2.5 py-1 text-xs hover:bg-muted"
        >
          Show more ({rows.length - shown} more)
        </button>
      ) : null}
    </div>
  );
}

function CasesTable({
  state,
  statute,
  minFy,
  clear,
}: {
  state: string | undefined;
  statute: string;
  minFy: number;
  clear: () => void;
}) {
  const q = useQuery(epaCasesQuery);
  const [sort, setSort] = useState<"fedPenalty" | "fy">("fedPenalty");
  const [shown, setShown] = useState(PAGE);
  const rows = useMemo(() => {
    const filtered = (q.data ?? []).filter(
      (r) =>
        r.fy >= minFy &&
        (!state || r.states.includes(state)) &&
        (!statute || r.statute === statute),
    );
    return filtered.sort((a, b) =>
      sort === "fy" ? b.fy - a.fy || b.fedPenalty - a.fedPenalty : b.fedPenalty - a.fedPenalty,
    );
  }, [q.data, state, statute, sort, minFy]);
  if (q.isLoading)
    return <div className="m-3 h-40 animate-pulse rounded bg-muted/50" aria-busy="true" />;
  if (q.isError) return <StateNote tone="error">Case records could not be loaded.</StateNote>;
  if (!rows.length)
    return (
      <StateNote
        action={
          state || statute ? (
            <button type="button" onClick={clear} className="text-primary underline">
              Clear filters
            </button>
          ) : null
        }
      >
        No published case meets the threshold for this selection.
      </StateNote>
    );
  return (
    <div>
      <div className="max-h-[28rem] overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-surface text-[11px] text-muted-foreground">
            <tr className="border-b border-border">
              <th scope="col" className="px-2 py-1.5 text-left font-medium">
                Case
              </th>
              <SortHeader label="FY" active={sort === "fy"} desc onClick={() => setSort("fy")} />
              <th scope="col" className="px-2 py-1.5 text-left font-medium">
                Type · statute
              </th>
              <th scope="col" className="hidden px-2 py-1.5 text-left font-medium sm:table-cell">
                States
              </th>
              <SortHeader
                label="Federal penalty"
                active={sort === "fedPenalty"}
                desc
                onClick={() => setSort("fedPenalty")}
              />
              <th scope="col" className="hidden px-2 py-1.5 text-right font-medium md:table-cell">
                SEP
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, shown).map((r) => (
              <tr key={r.id} className="border-b border-border/50 align-top">
                <td className="max-w-80 px-2 py-1.5">
                  <Link
                    to="/records/$dataset/$id"
                    params={{ dataset: CASE_DATASET, id: r.id }}
                    className="font-medium text-primary hover:underline"
                  >
                    {r.name}
                  </Link>
                  <span className="block text-[10.5px] text-muted-foreground">
                    <SourceLink href={r.url}>{r.caseNumber}</SourceLink>
                    {r.dojDocket ? ` · DOJ ${r.dojDocket}` : ""}
                    {r.defendants.length ? ` · ${r.defendants.slice(0, 2).join("; ")}` : ""}
                  </span>
                </td>
                <td className="px-2 py-1.5 text-right font-mono">{r.fy}</td>
                <td className="px-2 py-1.5">
                  {r.typeCode === "JDC" ? "Judicial" : r.typeCode === "AFR" ? "Admin." : "—"} ·{" "}
                  {r.statute ?? "Not recorded"}
                </td>
                <td className="hidden px-2 py-1.5 sm:table-cell">
                  {r.states.join(", ") || "Not recorded"}
                </td>
                <td className="px-2 py-1.5 text-right font-mono" title={usdFull(r.fedPenalty)}>
                  {usd(r.fedPenalty, 2)}
                </td>
                <td className="hidden px-2 py-1.5 text-right font-mono md:table-cell">
                  {r.sep ? usd(r.sep) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-3 px-3 py-2 text-xs text-muted-foreground">
        Showing {Math.min(shown, rows.length)} of {rows.length.toLocaleString("en-US")}
        {shown < rows.length ? (
          <button
            type="button"
            onClick={() => setShown((n) => n + PAGE * 2)}
            className="rounded-md border border-border px-2.5 py-1 text-foreground hover:bg-muted"
          >
            Show more
          </button>
        ) : null}
      </div>
    </div>
  );
}

function StateTable({
  rows,
  selected,
  onState,
}: {
  rows: ReturnType<typeof stateRows>;
  selected: string | undefined;
  onState: (code: string | undefined) => void;
}) {
  const [key, setKey] = useState<SortKey>("fedPenalty");
  const [desc, setDesc] = useState(true);
  const sorted = sortRows(rows, key, desc);
  const head = (k: SortKey, label: string, align: "left" | "right" = "right") => (
    <SortHeader
      label={label}
      align={align}
      active={key === k}
      desc={desc}
      onClick={() => {
        if (key === k) setDesc((d) => !d);
        else {
          setKey(k);
          setDesc(k !== "name");
        }
      }}
    />
  );
  return (
    <div className="max-h-[30rem] overflow-auto">
      <table className="w-full text-xs">
        <thead className="sticky top-0 z-10 bg-surface text-[11px] text-muted-foreground">
          <tr className="border-b border-border">
            {head("name", "State", "left")}
            {head("cases", "Cases")}
            {head("judicial", "Judicial")}
            {head("fedPenalty", "Federal penalties")}
            <th scope="col" className="hidden px-2 py-1.5 text-right font-medium lg:table-cell">
              <span title="Supplemental environmental projects">SEP</span>
            </th>
            {head("perMillion", "Cases / M (FY25)")}
            <th scope="col" className="px-2 py-1.5 text-left font-medium">
              Flags
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr
              key={r.code}
              className={cn(
                "border-b border-border/50",
                selected === r.code ? "bg-primary/5" : "hover:bg-muted/40",
              )}
            >
              <td className="px-2 py-1">
                <button
                  type="button"
                  onClick={() => onState(selected === r.code ? undefined : r.code)}
                  aria-pressed={selected === r.code}
                  className="text-left font-medium hover:text-primary focus-visible:outline-2 focus-visible:outline-ring"
                >
                  {r.name}
                </button>
              </td>
              <td className="px-2 py-1 text-right font-mono">{count(r.sums.cases)}</td>
              <td className="px-2 py-1 text-right font-mono">{count(r.sums.judicial)}</td>
              <td className="px-2 py-1 text-right font-mono" title={usdFull(r.sums.fedPenalty)}>
                {usd(r.sums.fedPenalty)}
              </td>
              <td className="hidden px-2 py-1 text-right font-mono lg:table-cell">
                {usd(r.sums.sep)}
              </td>
              <td className="px-2 py-1 text-right font-mono">
                {r.perMillion == null ? "—" : r.perMillion.toFixed(1)}
              </td>
              <td className="space-x-1 px-2 py-1">
                {r.surge ? (
                  <FlagChip title={SURGE_RULE}>Surge {r.surge.ratio.toFixed(1)}×</FlagChip>
                ) : null}
                {r.perCapitaOutlier ? (
                  <FlagChip title={PER_CAPITA_RULE}>Per-capita high</FlagChip>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function EpaEnforcement({
  state,
  onState,
}: {
  state: string | undefined;
  onState: (code: string | undefined) => void;
}) {
  const q = useQuery(epaEnforcementQuery);
  if (q.isLoading) return <LoadingBlock label="Loading EPA enforcement" />;
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
        EPA enforcement data could not be loaded.
      </StateNote>
    );
  if (!q.data?.national)
    return <StateNote>EPA enforcement data has not been published yet.</StateNote>;
  return <EpaBody data={q.data} national={q.data.national} state={state} onState={onState} />;
}

function EpaBody({
  data,
  national,
  state,
  onState,
}: {
  data: EpaData;
  national: EpaProfile;
  state: string | undefined;
  onState: (code: string | undefined) => void;
}) {
  const corpus = useCorpus();
  const firstFy = national.years[0]?.fy ?? 1990;
  const latest = latestCompleteFy(data.fileDate, national.years.at(-1)?.fy ?? 2025);
  const windows = fyWindows(latest, Math.max(firstFy, 1990));
  const [windowId, setWindowId] = useState("10y");
  const [metric, setMetric] = useState<Metric>("penalty");
  const [statute, setStatute] = useState("");
  const [defWindow, setDefWindow] = useState<"all" | "recent">("recent");
  const win = windows.find((w) => w.id === windowId) ?? windows[0]!;
  const selected = data.profiles.find((p) => p.code === state);
  const profile = selected ?? national;
  const sums = sumYears(profile.years, win.from, win.to);
  const partial = profile.years.filter((y) => y.fy > latest);
  const rows = useMemo(() => stateRows(data.profiles, win, latest), [data.profiles, win, latest]);
  const mapRows = rows.filter((r) => r.kind === "state" && r.fips);
  const values = new Map(
    mapRows.map((r) => [
      r.fips!,
      metric === "penalty"
        ? Math.round(r.sums.fedPenalty / 1e5) / 10
        : metric === "cases"
          ? r.sums.cases
          : Math.round((r.perMillion ?? 0) * 10) / 10,
    ]),
  );
  const detail = useQuery({
    queryKey: ["epa-state-detail", state],
    queryFn: () => getEpaStateDetail({ data: { code: state! } }),
    enabled: !!selected,
    staleTime: 10 * 60 * 1000,
  });
  const defendants = selected
    ? defWindow === "recent"
      ? (detail.data?.topDefendantsRecent ?? [])
      : (detail.data?.topDefendants ?? [])
    : defWindow === "recent"
      ? national.topDefendantsRecent
      : national.topDefendants;
  const surges = rows.filter((r) => r.surge).sort((a, b) => b.surge!.ratio - a.surge!.ratio);
  const outliers = rows
    .filter((r) => r.perCapitaOutlier)
    .sort((a, b) => b.perMillion! - a.perMillion!);
  const topCase = selected ? detail.data?.topCases[0] : national.topCases[0];
  const scopeName = selected ? selected.name : "all states";
  const minCaseFy = Math.max(win.from, 2017);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">
            EPA civil enforcement · {selected ? selected.name : "United States"}
          </h2>
          <p className="text-xs text-muted-foreground">
            EPA-lead civil judicial and administrative formal cases from ICIS-FE&C (file dated{" "}
            {data.fileDate ?? "not recorded"}, retrieved {data.retrieved ?? "not recorded"}). Counts
            by case fiscal year; dollars are case totals across all settlements.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {selected ? (
            <button
              type="button"
              onClick={() => onState(undefined)}
              className="inline-flex items-center gap-1 rounded-md border border-primary/50 bg-primary/10 px-2 py-0.5 text-[11px] text-primary"
            >
              {selected.name}
              <X className="size-3" aria-label="Clear state" />
            </button>
          ) : null}
          <Segmented
            label="Fiscal-year window"
            value={windowId}
            options={windows.map((w) => ({ id: w.id, label: w.label }))}
            onChange={setWindowId}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi label="Cases" value={count(sums.cases)} note={win.label} />
        <Kpi
          label="Civil judicial"
          value={count(sums.judicial)}
          note={
            sums.cases ? `${((sums.judicial / sums.cases) * 100).toFixed(1)}% of cases` : undefined
          }
        />
        <Kpi label="Admin. formal" value={count(sums.administrative)} />
        <Kpi
          label="Federal penalties"
          value={usd(sums.fedPenalty)}
          note={`${count(sums.penaltyCases)} cases with a penalty`}
        />
        <Kpi label="SEP value" value={usd(sums.sep)} note="Supplemental env. projects" />
        <Kpi label="Cost recovery" value={usd(sums.costRecovery)} note="Federal, mostly CERCLA" />
      </div>
      {partial.length ? (
        <p className="text-[11px] text-muted-foreground">
          FY{partial.map((p) => p.fy).join(", FY")} is in progress (
          {count(partial.reduce((a, p) => a + p.cases, 0))} cases so far) and is excluded from
          windows.
          {selected && selected.totals.multistateCases
            ? ` ${count(selected.totals.multistateCases)} of ${selected.name}'s cases also involve facilities in another state.`
            : ""}
        </p>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <Panel
          title={`Map · ${METRIC_LABEL[metric]}`}
          subtitle={
            metric === "perMillion"
              ? "FY2025 cases ÷ Census Vintage 2025 July 1, 2025 population × 1,000,000"
              : `${win.label}; a case counts in every state where one of its facilities is located`
          }
          actions={
            <Segmented
              label="Map metric"
              value={metric}
              options={[
                { id: "penalty", label: "Penalties" },
                { id: "cases", label: "Cases" },
                { id: "perMillion", label: "Per million" },
              ]}
              onChange={setMetric}
            />
          }
          footnote={
            <>
              Select a state to filter every panel. Source:{" "}
              <SourceLink href={data.source}>ECHO case downloads</SourceLink>
              {data.populationSource ? (
                <>
                  {" "}
                  · <SourceLink href={data.populationSource}>Census NST-EST2025</SourceLink>
                </>
              ) : null}
            </>
          }
        >
          <div className="p-2">
            {corpus.geo ? (
              <UsMap
                geo={corpus.geo}
                values={values}
                valueLabel={METRIC_LABEL[metric]}
                selectedState={state}
                onState={(fips) => {
                  const hit = mapRows.find((r) => r.fips === fips);
                  if (hit) onState(state === hit.code ? undefined : hit.code);
                }}
              />
            ) : (
              <div className="flex min-h-56 flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
                <MapPin className="size-6 opacity-50" aria-hidden />
                {corpus.error
                  ? "The map is unavailable; use the state table below."
                  : "Preparing the map…"}
              </div>
            )}
          </div>
        </Panel>
        <Panel
          title="Flags"
          subtitle="Deterministic rules over the published counts"
          footnote="A flag is a lead to review, not a finding."
        >
          <div className="space-y-3 p-3 text-xs">
            <div>
              <p className="flex items-center gap-1 font-medium">
                <Flag className="size-3.5 text-warning" aria-hidden /> Case surge · FY{latest}
              </p>
              <p className="text-[11px] text-muted-foreground">{SURGE_RULE}</p>
              {surges.length ? (
                <ul className="mt-1 space-y-0.5">
                  {surges.slice(0, 8).map((r) => (
                    <li key={r.code} className="flex justify-between gap-2">
                      <button
                        type="button"
                        className="text-primary hover:underline"
                        onClick={() => onState(r.code)}
                      >
                        {r.name}
                      </button>
                      <span className="font-mono text-muted-foreground">
                        {r.surge!.latest} vs {r.surge!.baseline.toFixed(1)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-muted-foreground">No state meets the rule.</p>
              )}
            </div>
            <div>
              <p className="flex items-center gap-1 font-medium">
                <Flag className="size-3.5 text-warning" aria-hidden /> Per-capita outliers · FY2025
              </p>
              <p className="text-[11px] text-muted-foreground">{PER_CAPITA_RULE}</p>
              {outliers.length ? (
                <ul className="mt-1 space-y-0.5">
                  {outliers.map((r) => (
                    <li key={r.code} className="flex justify-between gap-2">
                      <button
                        type="button"
                        className="text-primary hover:underline"
                        onClick={() => onState(r.code)}
                      >
                        {r.name}
                      </button>
                      <span className="font-mono text-muted-foreground">
                        {r.perMillion!.toFixed(1)} / M
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-muted-foreground">No state exceeds the fence.</p>
              )}
            </div>
            {topCase ? (
              <div>
                <p className="font-medium">
                  Largest single case · {selected ? selected.name : "all years"}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {topCase.name} ({topCase.caseNumber}, FY{topCase.fy ?? "—"}) —{" "}
                  {usd(topCase.fedPenalty, 2)}
                  {profile.totals.fedPenalty
                    ? `, ${((topCase.fedPenalty / profile.totals.fedPenalty) * 100).toFixed(0)}% of all recorded federal penalties for ${selected ? selected.name : "the U.S."}.`
                    : "."}
                </p>
              </div>
            ) : null}
          </div>
        </Panel>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel
          title={`Cases and penalties by fiscal year · ${selected ? selected.name : "United States"}`}
          subtitle={`${win.label}; dashed line is the median annual case count in the window`}
        >
          <TrendChart profile={profile} from={win.from} to={win.to} />
        </Panel>
        <Panel
          title="Trend by primary statute · United States"
          subtitle={`Cases per FY and federal penalties, ${win.label}; primary statute = law section ranked 1 on the case`}
          footnote="Select a statute to filter the case table."
        >
          <StatuteMultiples
            national={national}
            from={win.from}
            to={win.to}
            active={statute}
            onPick={setStatute}
          />
        </Panel>
      </div>

      {selected ? (
        <Panel
          title={`Statute mix · ${selected.name}`}
          subtitle="All recorded fiscal years, by primary statute"
        >
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-[11px] text-muted-foreground">
                <tr className="border-b border-border">
                  <th scope="col" className="px-2 py-1.5 text-left font-medium">
                    Statute
                  </th>
                  <th scope="col" className="px-2 py-1.5 text-right font-medium">
                    Cases
                  </th>
                  <th scope="col" className="px-2 py-1.5 text-right font-medium">
                    Judicial
                  </th>
                  <th scope="col" className="px-2 py-1.5 text-right font-medium">
                    Federal penalties
                  </th>
                </tr>
              </thead>
              <tbody>
                {selected.statutes.map((s) => (
                  <tr key={s.code ?? "none"} className="border-b border-border/50">
                    <td className="px-2 py-1">
                      <span className="font-medium">{s.code ?? "Not recorded"}</span>{" "}
                      <span className="text-muted-foreground">{s.code ? s.name : ""}</span>
                    </td>
                    <td className="px-2 py-1 text-right font-mono">{count(s.cases)}</td>
                    <td className="px-2 py-1 text-right font-mono">{count(s.judicial)}</td>
                    <td className="px-2 py-1 text-right font-mono">{usd(s.fedPenalty)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      ) : null}

      <Panel
        title="States ranked"
        subtitle={`${win.label}; select a row to filter. Flags use the rules stated in the Flags panel.`}
        footnote={`State totals are not additive: ${count(national.totals.multistateCases)} cases involve facilities in more than one state. Territories and unrecognised facility state codes are listed as recorded.`}
      >
        <StateTable rows={rows} selected={state} onState={onState} />
      </Panel>

      <div className="grid gap-3 xl:grid-cols-2">
        <Panel
          title={`Top defendants by federal penalty · ${scopeName}`}
          subtitle="Grouped by exact recorded defendant name (whitespace trimmed only); a multi-defendant case counts its full penalty for each named defendant"
          actions={
            <Segmented
              label="Defendant window"
              value={defWindow}
              options={[
                { id: "recent", label: "FY2017+" },
                { id: "all", label: "All years" },
              ]}
              onChange={setDefWindow}
            />
          }
        >
          {selected && detail.isLoading ? (
            <div className="m-3 h-40 animate-pulse rounded bg-muted/50" aria-busy="true" />
          ) : selected && detail.isError ? (
            <StateNote tone="error">State detail could not be loaded.</StateNote>
          ) : (
            <DefendantTable rows={defendants} scope={scopeName} />
          )}
        </Panel>
        <Panel
          title={`Largest cases · ${scopeName}${statute ? ` · ${statute}` : ""}`}
          subtitle={`Published case records: case FY${minCaseFy}+ with a federal penalty of at least $100,000`}
          footnote="Case names link to the stored record; case numbers open the EPA ECHO case report."
        >
          <CasesTable
            state={selected?.code}
            statute={statute}
            minFy={minCaseFy}
            clear={() => {
              setStatute("");
              onState(undefined);
            }}
          />
        </Panel>
      </div>
    </div>
  );
}
