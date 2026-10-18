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
import { HowToRead, type Measure } from "@/components/analysis/HowToRead";
import { KeyTakeaways } from "@/components/analysis/KeyTakeaways";
import { UsMap } from "@/components/corpus/UsMap";
import { FDA_COLORS } from "@/components/fda-analytics/chartView";
import { useCorpus } from "@/lib/corpus/store";
import {
  getEpaCases,
  getEpaEnforcement,
  getEpaStateDetail,
  type EpaDefendantGroup,
  type EpaEnforcement as EpaData,
  type EpaProfile,
  type EpaStatute,
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
import { epaTakeaways } from "./enforcementTakeaways";
import {
  bySurgeDesc,
  capped,
  joinCapped,
  numTick,
  surgeRatioLabel,
  usdMillionsTick,
} from "./listDisplay";
import {
  axisTick,
  FlagChip,
  Kpi,
  LoadingBlock,
  MoreToggle,
  Panel,
  Segmented,
  SortHeader,
  SourceLink,
  StateNote,
  tooltipStyle,
} from "./parts";

const SURGE_LIMIT = 8;
const STATUTE_LIMIT = 8;
const CASE_NUMBER_LIMIT = 3;
const CASE_DEFENDANT_LIMIT = 2;

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
  penalty: "million USD federal penalties settled",
  cases: "cases opened",
  perMillion: "FY2025 cases opened per million residents",
};
const PAGE = 25;
const CASE_DATASET = "regulatory_epa_cases";
const BASIS =
  "Counts use the fiscal year a case was opened; dollars use the fiscal year each settlement was entered.";
const EPA_MEASURES: Measure[] = [
  {
    term: "Cases opened",
    means:
      "EPA-lead civil judicial and administrative formal cases in ICIS-FE&C, counted in the fiscal year opened.",
    caveat:
      "A multi-state case counts in each state where one of its facilities is, so state totals are not additive.",
  },
  {
    term: "Penalties settled",
    means:
      "Federal penalties on settlements, counted in the fiscal year each settlement was entered.",
    caveat:
      "Settlements without an entered date appear only in all-years totals, and a year in progress is excluded from windows.",
  },
  {
    term: "SEP and cost recovery",
    means:
      "Supplemental environmental projects and recovered response costs (mostly CERCLA), settled in the window.",
  },
  {
    term: "Case surge",
    means: SURGE_RULE,
    caveat: "A lead to review, not a finding.",
  },
  {
    term: "Per-capita outlier",
    means: PER_CAPITA_RULE,
    caveat: "Small states can sit above the fence on few cases.",
  },
  {
    term: "Defendant rows",
    means:
      "One row per exact set of defendants named together on a case, so each case counts once.",
    caveat: "Spelling variants of one company stay separate.",
  },
];

function TrendChart({ profile, from, to }: { profile: EpaProfile; from: number; to: number }) {
  const rows = denseYears(profile.years, from, to).map((y) => ({
    fy: `FY${String(y.fy).slice(2)}`,
    judicial: y.judicial,
    administrative: y.administrative,
    penalty: Math.round(y.fedPenalty / 1e5) / 10,
  }));
  const med = median(rows.map((r) => r.judicial + r.administrative));
  if (!rows.some((r) => r.judicial + r.administrative > 0 || r.penalty > 0))
    return (
      <StateNote>No cases or settlements are recorded for this selection and window.</StateNote>
    );
  return (
    <div>
      <p className="px-3 pt-2 text-[11px] text-muted-foreground">
        Median cases opened per FY in the window:{" "}
        <span className="font-mono text-foreground">
          {med == null ? "—" : med.toLocaleString("en-US")}
        </span>{" "}
        (dashed line)
      </p>
      <div className="h-60 px-1 pb-1 pt-1">
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
              tickFormatter={numTick}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              width={52}
              tick={axisTick}
              tickLine={false}
              axisLine={false}
              tickFormatter={usdMillionsTick}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={(v, name) =>
                name === "Federal penalties settled ($M)"
                  ? [`$${Number(v).toLocaleString("en-US")}M`, name]
                  : [Number(v).toLocaleString("en-US"), name]
              }
            />
            <Legend wrapperStyle={{ fontSize: 11 }} iconSize={8} />
            <Bar
              yAxisId="left"
              dataKey="administrative"
              name="Administrative opened"
              stackId="c"
              fill={FDA_COLORS[5]}
              isAnimationActive={false}
            />
            <Bar
              yAxisId="left"
              dataKey="judicial"
              name="Judicial opened"
              stackId="c"
              fill={FDA_COLORS[0]}
              isAnimationActive={false}
            />
            <Line
              yAxisId="right"
              dataKey="penalty"
              name="Federal penalties settled ($M)"
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
              />
            ) : null}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function StatuteMultiples({
  statutes,
  from,
  to,
  active,
  onPick,
}: {
  statutes: EpaStatute[];
  from: number;
  to: number;
  active: string;
  onPick: (code: string) => void;
}) {
  const [all, setAll] = useState(false);
  const ranked = statutes
    .filter((s) => s.code)
    .map((s) => {
      const byFy = new Map(s.years.map((y) => [y.fy, y]));
      const years = [];
      for (let fy = from; fy <= to; fy += 1)
        years.push({
          fy,
          cases: byFy.get(fy)?.cases ?? 0,
          fedPenalty: byFy.get(fy)?.fedPenalty ?? 0,
        });
      return {
        code: s.code!,
        name: s.name,
        years,
        cases: years.reduce((a, y) => a + y.cases, 0),
        penalty: years.reduce((a, y) => a + y.fedPenalty, 0),
      };
    })
    .filter((s) => s.cases > 0 || s.penalty > 0)
    .sort((a, b) => b.cases - a.cases);
  // Keep the selected statute visible even when it ranks below the default cut.
  const { shown } = capped(ranked, STATUTE_LIMIT, all);
  const rows =
    active && !shown.some((s) => s.code === active)
      ? [...shown, ...ranked.filter((s) => s.code === active)]
      : shown;
  if (!rows.length) return <StateNote>No statute series is recorded for this selection.</StateNote>;
  const max = Math.max(1, ...rows.flatMap((s) => s.years.map((y) => y.cases)));
  // Counted against what is drawn, so an appended selected statute is not reported as hidden.
  const hidden = ranked.length - rows.length;
  return (
    <div>
      <ul
        id="epa-statute-multiples"
        className="grid grid-cols-2 gap-px bg-border/60 sm:grid-cols-4"
      >
        {rows.map((s) => (
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
                <span className="font-mono text-[11px] text-muted-foreground">
                  {count(s.cases)}
                </span>
              </span>
              <span className="block text-[10.5px] text-muted-foreground">
                {usd(s.penalty)} settled
              </span>
              <span className="mt-1 block h-12" aria-hidden>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={s.years} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                    <YAxis hide domain={[0, max]} />
                    <Tooltip
                      contentStyle={tooltipStyle}
                      labelFormatter={(_, p) => `FY${String(p?.[0]?.payload?.fy ?? "")}`}
                      formatter={(v) => [Number(v).toLocaleString("en-US"), "cases opened"]}
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
      {ranked.length > STATUTE_LIMIT ? (
        <p className="flex flex-wrap items-center gap-2 px-3 py-1.5 text-[11px] text-muted-foreground">
          {all
            ? `All ${count(ranked.length)} statutes with cases or penalties in the window.`
            : `Top ${STATUTE_LIMIT} of ${count(ranked.length)} statutes by cases opened${
                rows.length > shown.length ? ", plus the selected statute" : ""
              }.`}
          <MoreToggle
            total={ranked.length}
            limit={all ? STATUTE_LIMIT : rows.length}
            expanded={all}
            onToggle={() => setAll((v) => !v)}
            controls="epa-statute-multiples"
            noun={hidden === 1 ? "statute" : "statutes"}
          />
        </p>
      ) : null}
    </div>
  );
}

function DefendantTable({ rows, scope }: { rows: EpaDefendantGroup[]; scope: string }) {
  const [shown, setShown] = useState(15);
  if (!rows.length)
    return (
      <StateNote>
        No defendants with a settled federal penalty in {scope} for this window.
      </StateNote>
    );
  return (
    <div>
      <div className="max-h-[26rem] overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-surface text-[11px] text-muted-foreground">
            <tr className="border-b border-border">
              <th scope="col" className="px-2 py-1.5 text-left font-medium">
                Defendants named together (exact recorded names)
              </th>
              <th scope="col" className="px-2 py-1.5 text-right font-medium">
                Cases
              </th>
              <th scope="col" className="px-2 py-1.5 text-right font-medium">
                Penalties settled
              </th>
              <th scope="col" className="hidden px-2 py-1.5 text-left font-medium md:table-cell">
                Settled · statutes · states
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, shown).map((d) => (
              <tr
                key={d.nationalCase ?? d.defendants.join("|")}
                className="border-b border-border/50 align-top"
              >
                <td className="max-w-72 px-2 py-1.5">
                  <span className="font-medium">{d.defendants.slice(0, 4).join("; ")}</span>
                  {d.defendants.length > 4 ? (
                    <span className="text-muted-foreground"> +{d.defendants.length - 4} more</span>
                  ) : null}
                  <span className="block text-[10.5px] text-muted-foreground">
                    {d.nationalCase
                      ? `National case recorded as several regional records (lead ${d.nationalCase}); shares summed`
                      : joinCapped(
                          d.caseNumbers,
                          CASE_NUMBER_LIMIT,
                          ", ",
                          Math.max(d.cases, d.caseNumbers.length),
                        )}
                  </span>
                </td>
                <td className="px-2 py-1.5 text-right font-mono">{count(d.cases)}</td>
                <td className="px-2 py-1.5 text-right font-mono" title={usdFull(d.fedPenalty)}>
                  {usd(d.fedPenalty)}
                </td>
                <td className="hidden px-2 py-1.5 text-muted-foreground md:table-cell">
                  {d.firstSettlementFy
                    ? `FY${d.firstSettlementFy}${d.lastSettlementFy !== d.firstSettlementFy ? `–${d.lastSettlementFy}` : ""}`
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
  const [sort, setSort] = useState<"fedPenalty" | "settled">("fedPenalty");
  const [shown, setShown] = useState(PAGE);
  const rows = useMemo(() => {
    const filtered = (q.data ?? []).filter(
      (r) =>
        (r.settlementFy ?? r.fy) >= minFy &&
        (!state || r.states.includes(state)) &&
        (!statute || r.statute === statute),
    );
    return filtered.sort((a, b) =>
      sort === "settled"
        ? (b.settled ?? "").localeCompare(a.settled ?? "") || b.fedPenalty - a.fedPenalty
        : b.fedPenalty - a.fedPenalty,
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
              <th scope="col" className="px-2 py-1.5 text-right font-medium">
                Opened
              </th>
              <SortHeader
                label="Settled"
                active={sort === "settled"}
                desc
                onClick={() => setSort("settled")}
              />
              <th scope="col" className="hidden px-2 py-1.5 text-left font-medium sm:table-cell">
                Type · statute · states
              </th>
              <SortHeader
                label="Federal penalty"
                active={sort === "fedPenalty"}
                desc
                onClick={() => setSort("fedPenalty")}
              />
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
                    {r.defendants.length
                      ? ` · ${joinCapped(r.defendants, CASE_DEFENDANT_LIMIT, "; ")}`
                      : ""}
                  </span>
                  {r.nationalCase ? (
                    <span className="mt-0.5 block text-[10.5px] text-warning-foreground">
                      One of {r.nationalCase.records.length} regional records of national case{" "}
                      {r.nationalCase.lead}; combined {usd(r.nationalCase.combined, 2)}
                    </span>
                  ) : null}
                </td>
                <td className="px-2 py-1.5 text-right font-mono">FY{r.fy}</td>
                <td className="whitespace-nowrap px-2 py-1.5 text-right font-mono text-[11px]">
                  {r.settled ?? "—"}
                </td>
                <td className="hidden px-2 py-1.5 sm:table-cell">
                  {r.typeCode === "JDC" ? "Judicial" : r.typeCode === "AFR" ? "Admin." : "—"} ·{" "}
                  {r.statute ?? "Not recorded"} · {r.states.join(", ") || "Not recorded"}
                </td>
                <td className="px-2 py-1.5 text-right font-mono" title={usdFull(r.fedPenalty)}>
                  {usd(r.fedPenalty, 2)}
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
            {head("cases", "Opened")}
            {head("judicial", "Judicial")}
            {head("fedPenalty", "Penalties settled")}
            <th scope="col" className="hidden px-2 py-1.5 text-right font-medium lg:table-cell">
              <span title="Supplemental environmental projects, settled">SEP</span>
            </th>
            {head("perMillion", "Opened / M (FY25)")}
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
                  <FlagChip title={SURGE_RULE}>Surge {surgeRatioLabel(r.surge.ratio)}</FlagChip>
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
  const tableRows = rows.filter((r) => r.kind === "state" || r.kind === "territory");
  const otherCodes = data.profiles.filter((p) => p.kind === "other" || p.kind === "unrecorded");
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
  const groups = selected
    ? defWindow === "recent"
      ? (detail.data?.topDefendantGroupsRecent ?? [])
      : (detail.data?.topDefendantGroups ?? [])
    : defWindow === "recent"
      ? national.topDefendantGroupsRecent
      : national.topDefendantGroups;
  const statutes = selected ? (detail.data?.statutes ?? []) : national.statutes;
  const [allSurges, setAllSurges] = useState(false);
  const surges = rows.filter((r) => r.surge).sort((a, b) => bySurgeDesc(a.surge!, b.surge!));
  const surgeList = capped(surges, SURGE_LIMIT, allSurges);
  const outliers = rows
    .filter((r) => r.perCapitaOutlier)
    .sort((a, b) => b.perMillion! - a.perMillion!);
  const topCase = selected ? detail.data?.topCases[0] : national.topCases[0];
  const scopeName = selected ? selected.name : "all states";
  const minCaseFy = Math.max(win.from, 2017);
  const detailPending = !!selected && detail.isLoading;
  const topState = selected
    ? null
    : (rows
        .filter((r) => r.kind === "state")
        .sort((a, b) => b.sums.fedPenalty - a.sums.fedPenalty || a.name.localeCompare(b.name))
        .map((r) => ({ name: r.name, fedPenalty: r.sums.fedPenalty }))[0] ?? null);
  const takeaways = epaTakeaways({
    windowLabel: win.label,
    scopeName: selected ? selected.name : "the United States",
    cases: sums.cases,
    judicial: sums.judicial,
    administrative: sums.administrative,
    fedPenalty: sums.fedPenalty,
    penaltySettlements: sums.penaltySettlements,
    topState: topState && topState.fedPenalty > 0 ? topState : null,
    latestFy: latest,
    surges: surges.map((r) => ({
      name: r.name,
      latest: r.surge!.latest,
      baseline: r.surge!.baseline,
    })),
    outliers: outliers.map((r) => ({ name: r.name, perMillion: r.perMillion! })),
    topCase: topCase
      ? {
          name: topCase.name,
          fedPenalty: topCase.fedPenalty,
          sharePct: profile.totals.fedPenalty
            ? (100 * topCase.fedPenalty) / profile.totals.fedPenalty
            : null,
        }
      : null,
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">
            EPA civil enforcement · {selected ? selected.name : "United States"}
          </h2>
          <p className="text-xs text-muted-foreground">
            EPA-lead civil judicial and administrative formal cases from ICIS-FE&C (file dated{" "}
            {data.fileDate ?? "not recorded"}, retrieved {data.retrieved ?? "not recorded"}).{" "}
            {BASIS}
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
        <Kpi label="Cases opened" value={count(sums.cases)} note={win.label} />
        <Kpi
          label="Judicial opened"
          value={count(sums.judicial)}
          note={
            sums.cases ? `${((sums.judicial / sums.cases) * 100).toFixed(1)}% of opened` : undefined
          }
        />
        <Kpi
          label="Admin. opened"
          value={count(sums.administrative)}
          note="Administrative formal"
        />
        <Kpi
          label="Penalties settled"
          value={usd(sums.fedPenalty)}
          note={`${count(sums.penaltySettlements)} settlements with a penalty`}
        />
        <Kpi label="SEP settled" value={usd(sums.sep)} note="Supplemental env. projects" />
        <Kpi label="Cost recovery" value={usd(sums.costRecovery)} note="Settled, mostly CERCLA" />
      </div>
      <p className="text-[11px] text-muted-foreground">
        {partial.length
          ? `FY${partial.map((p) => p.fy).join(", FY")} is in progress (${count(partial.reduce((a, p) => a + p.cases, 0))} cases opened so far) and is excluded from windows. `
          : ""}
        {selected && selected.totals.multistateCases
          ? `${count(selected.totals.multistateCases)} of ${selected.name}'s cases also involve facilities in another state. `
          : ""}
        {national.totals.unattributedFedPenalty
          ? `${usd(national.totals.unattributedFedPenalty)} of federal penalties sit in settlements without an entered date and appear only in all-years totals.`
          : ""}
      </p>

      <KeyTakeaways
        items={takeaways}
        scope={`${win.label} · ${selected ? selected.name : "United States"} · flag lines always compare all states`}
      />
      <HowToRead measures={EPA_MEASURES} />

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <Panel
          title={`Map · ${METRIC_LABEL[metric]}`}
          subtitle={
            metric === "perMillion"
              ? "Cases opened in FY2025 ÷ Census Vintage 2025 July 1, 2025 population × 1,000,000"
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
              Source: <SourceLink href={data.source}>ECHO case downloads</SourceLink>
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
                heading="EPA enforcement by state"
                hint="Select a state to filter every panel; select it again to clear."
                stateAction="Filter to"
                formatValue={(v) =>
                  v.toLocaleString("en-US", { maximumFractionDigits: metric === "cases" ? 0 : 1 })
                }
                legendNote="Shading scales with the selected ECHO metric for states; territories and unrecorded codes are listed in the table."
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
          id="epa-flags"
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
                <>
                  <ul
                    id="epa-surge-states"
                    className={cn("mt-1 space-y-0.5", allSurges && "max-h-64 overflow-auto pr-1")}
                    aria-label={`${count(surges.length)} ${surges.length === 1 ? "state meets" : "states meet"} the surge rule`}
                  >
                    {surgeList.shown.map((r) => (
                      <li key={r.code} className="flex justify-between gap-2">
                        <button
                          type="button"
                          className="text-left text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                          onClick={() => onState(r.code)}
                        >
                          {r.name}
                        </button>
                        <span
                          className="shrink-0 font-mono text-muted-foreground"
                          title={`FY${latest} cases opened vs mean of the five prior FYs`}
                        >
                          {count(r.surge!.latest)} vs {r.surge!.baseline.toFixed(1)}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <MoreToggle
                    total={surges.length}
                    limit={SURGE_LIMIT}
                    expanded={allSurges}
                    onToggle={() => setAllSurges((v) => !v)}
                    controls="epa-surge-states"
                    noun={surgeList.hidden === 1 ? "state" : "states"}
                  />
                </>
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
                  Largest case · {selected ? selected.name : "United States"}, all years
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {topCase.name} ({topCase.records.join(" + ")}; settled {topCase.settled ?? "—"}) —{" "}
                  {usd(topCase.fedPenalty, 2)}
                  {topCase.records.length > 1
                    ? ` across ${topCase.records.length} regional records that split one national penalty`
                    : ""}
                  {profile.totals.fedPenalty
                    ? `, ${((topCase.fedPenalty / profile.totals.fedPenalty) * 100).toFixed(0)}% of all settled federal penalties recorded for ${selected ? selected.name : "the U.S."}.`
                    : "."}
                </p>
              </div>
            ) : null}
          </div>
        </Panel>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel
          id="epa-trend"
          title={`Cases opened and penalties settled · ${selected ? selected.name : "United States"}`}
          subtitle={`${win.label}. Bars: cases by FY opened. Line: federal penalties by settlement FY.`}
        >
          <TrendChart profile={profile} from={win.from} to={win.to} />
        </Panel>
        <Panel
          title={`Trend by primary statute · ${selected ? selected.name : "United States"}`}
          subtitle={`${win.label}. Bars: cases opened per FY; figure: federal penalties settled in the window. Primary statute = law section ranked 1.`}
          footnote="Select a statute to filter the case table."
        >
          {detailPending ? (
            <div className="m-3 h-40 animate-pulse rounded bg-muted/50" aria-busy="true" />
          ) : selected && detail.isError ? (
            <StateNote tone="error">State statute series could not be loaded.</StateNote>
          ) : (
            <StatuteMultiples
              statutes={statutes}
              from={win.from}
              to={win.to}
              active={statute}
              onPick={setStatute}
            />
          )}
        </Panel>
      </div>

      <Panel
        id="epa-states"
        title="States ranked"
        subtitle={`${win.label}; select a row to filter. Opened = cases by FY opened; penalties = settled in the window.`}
        footnote={
          <>
            State totals are not additive: {count(national.totals.multistateCases)} cases involve
            facilities in more than one state.{" "}
            {otherCodes.length
              ? `Not listed: ${otherCodes
                  .map(
                    (p) =>
                      `${p.kind === "unrecorded" ? "no facility state" : p.code} (${count(p.totals.cases)})`,
                  )
                  .join(
                    ", ",
                  )} — non-U.S. or unrecognised facility codes, kept as recorded in the dataset.`
              : ""}
          </>
        }
      >
        <StateTable rows={tableRows} selected={state} onState={onState} />
      </Panel>

      <div className="grid gap-3 xl:grid-cols-2">
        <Panel
          title={`Top defendants by penalties settled · ${scopeName}`}
          subtitle="One row per exact set of defendants named together on a case, so each case counts once and rows are additive. Spelling variants stay separate."
          actions={
            <Segmented
              label="Defendant window"
              value={defWindow}
              options={[
                { id: "recent", label: "Settled FY2017+" },
                { id: "all", label: "All years" },
              ]}
              onChange={setDefWindow}
            />
          }
          footnote={
            national.lookalikes
              ? `${count(national.nationalGroups.length)} national cases recorded as several regional records sharing one penalty are shown as one row. ${count(national.lookalikes.groups)} other look-alike groups (same penalty, settlement dates and defendants, no lead marker) are kept as separate records.`
              : undefined
          }
        >
          {detailPending ? (
            <div className="m-3 h-40 animate-pulse rounded bg-muted/50" aria-busy="true" />
          ) : selected && detail.isError ? (
            <StateNote tone="error">State detail could not be loaded.</StateNote>
          ) : (
            <DefendantTable rows={groups} scope={scopeName} />
          )}
        </Panel>
        <Panel
          title={`Largest cases · ${scopeName}${statute ? ` · ${statute}` : ""}`}
          subtitle={`Published records: federal penalty ≥ $100,000, latest settlement in FY${minCaseFy} or later (opened FY if none)`}
          footnote="Case names link to the stored record; case numbers open the EPA ECHO case report. Penalty = case total across settlements."
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
