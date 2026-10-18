import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ChartCard } from "@/components/fda-analytics/FdaCharts";
import type { JudgeCrossAnalytics as Data } from "@/lib/external/judgeCross.functions";
import { judgeCrossQuery } from "./judgeCrossQuery";
import {
  BenchSmallMultiples,
  ConcentrationCurve,
  DistrictDistribution,
  ExperienceScatter,
} from "./JudgeCrossCharts";
import { DisclosureReview } from "./DisclosureReview";
import { JudgeRanking } from "./JudgeRanking";
import {
  circuitLabel,
  EMPTY_FILTER,
  filterDistricts,
  filterJudges,
  fmtInt,
  fmtPct,
  type JudgeFilter,
} from "./judgeCrossView";

const FJC =
  "https://www.fjc.gov/history/judges/biographical-directory-article-iii-federal-judges-export";
const JPML = "https://www.jpml.uscourts.gov/pending-mdl-reports-archive";
const JPML_TERM =
  "https://www.jpml.uscourts.gov/sites/jpml/files/JPML_Fiscal_Year_2025_Terminated_Litigations_Report_0.pdf";

function Kpi({ label, value, note }: { label: string; value: string; note?: string | undefined }) {
  return (
    <div className="rounded-md border border-border bg-surface px-3 py-2.5">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-sans text-xl font-semibold tabular-nums">{value}</div>
      {note ? <div className="text-xs text-muted-foreground">{note}</div> : null}
    </div>
  );
}

function SelectFilter({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
}) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 rounded-md border border-border bg-surface px-2 text-xs text-foreground focus-visible:outline-2 focus-visible:outline-ring"
      >
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}

export function JudgeCrossAnalytics() {
  const q = useQuery(judgeCrossQuery);
  if (q.isLoading)
    return (
      <div className="space-y-3" aria-busy="true" aria-label="Loading judge analytics">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }, (_, i) => (
            <div
              key={i}
              className="h-[74px] animate-pulse rounded-md border border-border bg-muted/40"
            />
          ))}
        </div>
        <div className="h-80 animate-pulse rounded-md border border-border bg-muted/40" />
      </div>
    );
  if (q.isError)
    return (
      <p
        role="alert"
        className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
      >
        Judge analytics could not be loaded:{" "}
        {q.error instanceof Error ? q.error.message : "unknown error"}
      </p>
    );
  if (!q.data)
    return (
      <p className="rounded-md border border-border bg-surface px-3 py-6 text-center text-sm text-muted-foreground">
        The judge cross-analysis datasets have not been published yet.
      </p>
    );
  return <Dashboard data={q.data} />;
}

function Dashboard({ data }: { data: Data }) {
  const { profiles: p, national: n, disclosures: d } = data;
  const [filter, setFilter] = useState<JudgeFilter>(EMPTY_FILTER);
  const set = (k: keyof JudgeFilter) => (v: string) => setFilter((f) => ({ ...f, [k]: v }));
  const judges = useMemo(() => filterJudges(p.points, filter), [p.points, filter]);
  const pendingJudges = judges.filter((j) => j.pendingMdls > 0);
  const districts = useMemo(
    () => filterDistricts(n?.rows ?? [], filter.circuit),
    [n, filter.circuit],
  );
  const circuits = useMemo(
    () =>
      [...new Set(p.points.map((x) => x.circuit).filter((c): c is number => c !== null))].sort(
        (a, b) => a - b,
      ),
    [p.points],
  );
  const filtered = JSON.stringify(filter) !== JSON.stringify(EMPTY_FILTER);
  const hist = p.history;
  const histMatched =
    (hist.status["matched_strict"] ?? 0) + (hist.status["matched_first_initial"] ?? 0);
  const histTotal =
    histMatched +
    (hist.status["no_candidate"] ?? 0) +
    (hist.status["ambiguous"] ?? 0) +
    (hist.status["unparsed_name"] ?? 0);
  const demActive = n?.partyActive["Democratic"] ?? 0;
  const repActive = n?.partyActive["Republican"] ?? 0;
  const partial = !n || !d.summary;

  return (
    <div className="space-y-4">
      <p className="text-xs leading-relaxed text-muted-foreground">
        Sitting Article III judges from the{" "}
        <a href={FJC} target="_blank" rel="noreferrer" className="underline underline-offset-2">
          FJC Biographical Directory
        </a>{" "}
        joined to JPML pending MDL reports (as of {p.asOf}) and the{" "}
        <a
          href={JPML_TERM}
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-2"
        >
          JPML terminated-MDL report through FY2025
        </a>
        . Appointing president and party are as recorded by the FJC for the judge’s current court.
        Years are measured from the first Article III commission.
      </p>
      {partial ? (
        <p
          role="status"
          className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning-foreground"
        >
          Partial data: {!n ? "the district bench summary is missing" : ""}
          {!n && !d.summary ? " and " : ""}
          {!d.summary ? "the disclosure review summary is missing" : ""}. Sections that depend on it
          are hidden.
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi
          label="Judges with pending MDLs"
          value={fmtInt(p.judgesWithPending)}
          note={`${fmtInt(p.judgesMultiPending)} with 2 or more`}
        />
        <Kpi
          label="Pending MDLs / actions"
          value={`${fmtInt(p.pendingMdls)} / ${new Intl.NumberFormat("en-US", { notation: "compact" }).format(p.pendingActions)}`}
          note={`JPML report ${p.asOf}`}
        />
        <Kpi
          label="Top 10 judges' share"
          value={fmtPct(p.top10SharePct)}
          note={`HHI by judge ${fmtInt(p.hhiByJudge)}`}
        />
        <Kpi
          label="Median yrs, MDL judges"
          value={p.medianYearsPendingJudges?.toFixed(1) ?? "Not recorded"}
          note={`all active district: ${n?.medianYearsActive?.toFixed(1) ?? "—"}`}
        />
        <Kpi
          label="Active district bench"
          value={n ? fmtInt(n.active) : "—"}
          note={n ? `D ${demActive} · R ${repActive} · ${fmtInt(n.senior)} senior` : undefined}
        />
        <Kpi
          label="Disclosure name matches"
          value={fmtInt(d.matches.length)}
          note={`${fmtInt(d.coverage.length)} judges checked · requires review`}
        />
      </div>

      <div
        className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface px-3 py-2"
        role="search"
        aria-label="Filter judges and districts"
      >
        <div className="relative min-w-[180px] flex-1">
          <Search
            className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={filter.q}
            onChange={(e) => set("q")(e.target.value)}
            placeholder="Judge, court id, state or MDL"
            className="h-8 pl-7 text-xs"
            aria-label="Search judges"
          />
        </div>
        <SelectFilter
          label="Party"
          value={filter.party}
          onChange={set("party")}
          options={[
            ["", "All"],
            ["Democratic", "Democratic"],
            ["Republican", "Republican"],
            ["Other", "Other / not recorded"],
          ]}
        />
        <SelectFilter
          label="Status"
          value={filter.status}
          onChange={set("status")}
          options={[
            ["", "All"],
            ["Active", "Active or chief"],
            ["Senior", "Senior"],
          ]}
        />
        <SelectFilter
          label="Circuit"
          value={filter.circuit}
          onChange={set("circuit")}
          options={[
            ["", "All"],
            ...circuits.map((c): [string, string] => [String(c), circuitLabel(c)]),
          ]}
        />
        {filtered ? (
          <button
            type="button"
            onClick={() => setFilter(EMPTY_FILTER)}
            className="text-xs text-primary hover:underline"
          >
            Clear
          </button>
        ) : null}
        <span className="ml-auto text-[11px] text-muted-foreground">
          {fmtInt(judges.length)} judges · {fmtInt(districts.length)} districts
        </span>
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <ChartCard
          title="Experience vs current MDL load"
          subtitle="Each dot is a transferee judge with a pending MDL: years since first commission against actions now pending (log scale)"
          footnote={`Source: FJC export; JPML pending MDL report ${p.asOf}. Party = appointing president's party as recorded by FJC.`}
        >
          <ExperienceScatter points={judges} />
        </ChartCard>
        <ChartCard
          title="MDL assignment concentration"
          subtitle="Cumulative share of all pending MDL actions held by the top-k transferee judges"
          footnote={`HHI across judges ${fmtInt(p.hhiByJudge)}; across districts ${fmtInt(n?.hhiByDistrict)} (0–10,000). Top 5 districts hold ${fmtPct(n?.top5DistrictSharePct)}.`}
        >
          <ConcentrationCurve points={pendingJudges} />
        </ChartCard>
      </div>

      <ChartCard
        title="Top MDL judges"
        subtitle="Sitting judges with pending or terminated MDLs; click a column to sort. Flag: holds ≥5% of all pending MDL actions."
        footnote={
          <>
            Actions handled = JPML total actions of current pending MDLs + actions transferred or
            filed in terminated MDLs matched to the judge. Terminated MDLs matched for{" "}
            {fmtInt(histMatched)} of {fmtInt(histTotal)} transferee-judge entries (court + surname +
            initials, unique in FJC); {fmtInt(p.unassignedPending.length)} pending MDLs have no
            matched judge profile.
          </>
        }
      >
        <JudgeRanking points={judges} />
      </ChartCard>

      {n ? (
        <>
          <ChartCard
            title="Bench composition by district"
            subtitle={`Active and senior district judges by appointing party, median years of active judges, pending MDL load${filter.circuit ? ` · ${circuitLabel(Number(filter.circuit))}` : ""}`}
            footnote="Flag: MDL hub when the district holds ≥5% of all pending MDL actions. Largest = transferee judge with the most pending actions in the district (hover for HHI by judge). Source: FJC export (current service), JPML pending report."
          >
            <BenchSmallMultiples rows={districts} />
          </ChartCard>
          <ChartCard
            title="Appointing party and tenure by district"
            subtitle="Stacked counts of sitting judges per district, largest benches first"
            footnote={`National active bench: ${demActive} Democratic-appointed, ${repActive} Republican-appointed; median ${n.medianYearsActive?.toFixed(1) ?? "—"} years since first commission. Source: FJC export.`}
          >
            <DistrictDistribution rows={districts} />
          </ChartCard>
        </>
      ) : null}

      <DisclosureReview summary={d.summary} coverage={d.coverage} matches={d.matches} />

      <section
        className="rounded-md border border-border bg-surface px-3 py-2 text-[11px] leading-relaxed text-muted-foreground"
        aria-label="Method and sources"
      >
        <h3 className="mb-1 font-sans text-xs font-semibold text-foreground">Method and sources</h3>
        <ul className="list-disc space-y-0.5 pl-4">
          <li>
            Pending MDLs per judge come from the judge-profile join (JPML transferee judge as
            printed, matched on court and name); MDL figures are as printed in the{" "}
            <a
              href={JPML}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2"
            >
              JPML pending reports
            </a>
            .
          </li>
          <li>
            Terminated MDLs are parsed from the JPML report ({fmtInt(hist.rows)} rows across{" "}
            {hist.districts.length} district headings; printed and parsed counts are compared per
            district) and matched to an FJC judge only when exactly one judge of that court with
            that surname has consistent initials and was commissioned by the termination year.
          </li>
          <li>
            Bench counts are not divided by authorized judgeships: the FJC export and the US Courts
            judgeship table have different as-of dates, so a vacancy rate would mix periods.
          </li>
          <li>
            Each MDL number links to its{" "}
            <Link to="/matters/analytics" className="underline underline-offset-2">
              MDL analytics
            </Link>{" "}
            case lens.
          </li>
        </ul>
      </section>
    </div>
  );
}
