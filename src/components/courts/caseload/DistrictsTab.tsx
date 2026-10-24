import { useMemo, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { int } from "@/components/analysis/analysisFormat";
import { KeyTakeaways } from "@/components/analysis/KeyTakeaways";
import { HowToRead } from "@/components/analysis/HowToRead";
import { Kpi, LoadingBlock, Panel, StateNote } from "@/components/enforcement/parts";
import type { NationalCaseload } from "@/lib/external/courtCaseload.functions";
import { DistrictDetailPanel } from "./DistrictDetail";
import {
  circuitShort,
  fyLabel,
  NOT_RECORDED,
  partialText,
  pct,
  priorYear,
  shortCourtName,
  signedPctOf,
  yearOf,
} from "./caseloadFormat";
import { districtsQuery, methodQuery, nationalQuery } from "./caseloadQueries";
import { patchSearch, type CaseloadSearch } from "./caseloadSearch";
import {
  circuitOptions,
  DISTRICT_DEFAULT_SORT,
  DISTRICT_SORT_KEYS,
  encodeSort,
  filterDistricts,
  nextSort,
  parseSort,
  sortDistricts,
  stateOptions,
  type DistrictSortKey,
} from "./caseloadTables";
import { caseloadTakeaways } from "./caseloadTakeaways";
import {
  FilterSelect,
  ListCoverage,
  ResetButton,
  RetryNote,
  SearchBox,
  SortTh,
  TableScroll,
} from "./CaseloadParts";

export type TabProps = {
  search: CaseloadSearch;
  onSearch: (patch: Partial<CaseloadSearch>) => void;
};

export function DistrictsTab({ search, onSearch }: TabProps) {
  const districts = useQuery(districtsQuery);
  const national = useQuery(nationalQuery);
  const method = useQuery(methodQuery);
  const through = method.data?.through ?? null;

  if (districts.isLoading) return <LoadingBlock label="Loading district caseloads" />;
  if (districts.isError)
    return (
      <RetryNote onRetry={() => void districts.refetch()}>
        The district caseload table could not be loaded.
      </RetryNote>
    );
  const list = districts.data;
  if (!list?.rows.length)
    return <StateNote>The district caseload has not been published yet.</StateNote>;

  const nat = national.data ?? null;
  const cur = nat ? yearOf(nat.years, nat.latestFy) : null;
  const prior = nat ? priorYear(nat.years, nat.latestFy) : null;
  const fy = nat?.latestFy ?? method.data?.latestCompleteFy ?? null;
  // Without the national series the district-only takeaways still stand; the national ones are left out.
  const takeaways =
    fy != null
      ? caseloadTakeaways({ fy, national: cur, nationalPrior: prior, districts: list.rows })
      : [];

  return (
    <div className="space-y-3">
      <NationalKpis query={national} through={through} />
      <KeyTakeaways
        items={takeaways}
        scope={fy != null ? `${fyLabel(fy)} · FJC IDB` : undefined}
        note="Computed from the national series and the district table below. FJC IDB counts: filings can differ from the AO's published filings (see Method and checks)."
      />
      <DistrictsTable
        search={search}
        onSearch={onSearch}
        rows={list.rows}
        total={list.total}
        dropped={list.dropped}
        fy={fy}
      />
      <DistrictDetailPanel
        courtId={search.court}
        districts={list.rows}
        national={nat}
        through={through}
        onClear={() => onSearch({ court: undefined })}
      />
      <HowToRead
        title="How to read the district figures"
        measures={[
          {
            term: "Filed, terminated, pending",
            means:
              "Civil cases the district reported to the Administrative Office in the fiscal year (October 1 to September 30, named for the year it ends). Pending is filed minus terminated through the year end.",
            caveat:
              "Terminations match the AO's published totals exactly; filings can differ by a few percent, most in FY2014 to FY2016 for S.D. W.Va. (see Method and checks).",
          },
          {
            term: "Median days",
            means:
              "Median of termination date minus filing date over the cases terminated in the year, so a year with many quick dismissals or a mass-tort clean-up can swing it.",
            caveat: "Not recorded before FY2001 in this dataset.",
          },
          {
            term: "Class action, pro se, product",
            means:
              "Class action and product liability (with health-care and pharma injury) are shares of the year's filings; pro se plaintiff is the share of filings that record a pro se status.",
            caveat:
              "A share is over the cases where the field is recorded, never over a guessed total.",
          },
          {
            term: "Trial",
            means:
              "Terminations by jury verdict, directed verdict or court trial, as a share of all terminations.",
          },
          {
            term: "Ranks",
            means:
              "Competition ranks among the districts for the latest complete year, 1 = highest; tied districts share the lowest number.",
            caveat: "The fiscal year in progress is never ranked.",
          },
        ]}
      />
    </div>
  );
}

function NationalKpis({
  query,
  through,
}: {
  query: UseQueryResult<NationalCaseload | null>;
  through: string | null;
}) {
  const wrap = (children: ReactNode) => (
    <section
      id="caseload-kpis"
      aria-label="National totals"
      className="scroll-mt-4 focus:outline-none"
    >
      {children}
    </section>
  );
  if (query.isLoading)
    return wrap(
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5" aria-busy="true">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="h-16 animate-pulse rounded-md border border-border bg-muted/50" />
        ))}
      </div>,
    );
  if (query.isError)
    return wrap(
      <RetryNote onRetry={() => void query.refetch()}>
        National totals could not be loaded; the district table below does not depend on them.
      </RetryNote>,
    );
  const nat = query.data;
  if (!nat) return wrap(<StateNote>National totals are {NOT_RECORDED}.</StateNote>);
  const cur = yearOf(nat.years, nat.latestFy);
  const prior = priorYear(nat.years, nat.latestFy);
  const partial = nat.years.find((y) => y.partial) ?? null;
  const fy = fyLabel(nat.latestFy);
  const vs = (a: number | null | undefined, b: number | null | undefined) =>
    prior && b != null ? `${signedPctOf(a, b)} vs ${fyLabel(prior.fy)}` : undefined;
  return wrap(
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
      <Kpi
        label={`Civil cases filed, ${fy}`}
        value={cur?.filings == null ? NOT_RECORDED : int(cur.filings)}
        note={`${vs(cur?.filings, prior?.filings) ?? "United States"}; all district courts`}
      />
      <Kpi
        label={`Terminated, ${fy}`}
        value={cur?.terminations == null ? NOT_RECORDED : int(cur.terminations)}
        note={vs(cur?.terminations, prior?.terminations)}
      />
      <Kpi
        label={`Pending on Sep 30, ${nat.latestFy}`}
        value={cur?.pendingEnd == null ? NOT_RECORDED : int(cur.pendingEnd)}
        note={vs(cur?.pendingEnd, prior?.pendingEnd)}
      />
      <Kpi
        label={`Median days to termination, ${fy}`}
        value={cur?.medianDays == null ? NOT_RECORDED : int(cur.medianDays)}
        note={
          cur?.p25Days != null && cur.p75Days != null
            ? `Middle half of cases: ${int(cur.p25Days)} to ${int(cur.p75Days)} days`
            : "Cases terminated in the year"
        }
      />
      <Kpi
        label={partial ? `${fyLabel(partial.fy)} so far, filed` : "Fiscal year in progress"}
        value={partial?.filings == null ? NOT_RECORDED : int(partial.filings)}
        note={
          partial
            ? `${partialText(through)}; never compared or ranked`
            : "No partial year in this snapshot"
        }
      />
    </div>,
  );
}

function DistrictsTable({
  search,
  onSearch,
  rows,
  total,
  dropped,
  fy,
}: TabProps & {
  rows: ReturnType<typeof filterDistricts>;
  total: number | null;
  dropped: number;
  fy: number | null;
}) {
  const spec = parseSort(search.sort, DISTRICT_SORT_KEYS, DISTRICT_DEFAULT_SORT);
  const circuits = useMemo(() => circuitOptions(rows), [rows]);
  const states = useMemo(() => stateOptions(rows), [rows]);
  const shown = useMemo(
    () =>
      sortDistricts(
        filterDistricts(rows, { q: search.q, circuit: search.circuit, state: search.state }),
        spec,
      ),
    [rows, search.q, search.circuit, search.state, spec],
  );
  const filtered = Boolean(search.q || search.circuit || search.state);
  const sortBy = (key: DistrictSortKey) => {
    const next = nextSort(spec, key, !["name", "state", "circuit"].includes(key));
    onSearch({ sort: encodeSort(next, DISTRICT_DEFAULT_SORT) });
  };
  const head = (
    key: DistrictSortKey,
    label: string,
    title: string,
    align: "left" | "right" = "right",
  ) => (
    <SortTh
      label={label}
      title={title}
      align={align}
      active={spec.key === key}
      desc={spec.desc}
      onSort={() => sortBy(key)}
    />
  );
  const year = fy == null ? "latest year" : fyLabel(fy);
  return (
    <Panel
      id="caseload-districts"
      title="Federal district courts"
      subtitle={`${year} civil caseload (October 1 to September 30). Select a court to open its drill-down below.`}
      actions={
        <span className="text-[11px] text-muted-foreground" role="status">
          Showing {int(shown.length)} of {int(rows.length)} districts
        </span>
      }
      footnote={
        <>
          Federal caseload data counts; the AO&apos;s published tables remain the reference for
 official totals (terminations match them exactly, filings can differ). Median days is over
 cases terminated in the year. Class action, pro se plaintiff and product liability are
 shares of the year&apos;s filings (pro se: filings with a recorded status); trial is the
 share of terminations by trial judgment. The fiscal year in progress is not shown here and
 never ranked.
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-3 py-2">
        <SearchBox
          value={search.q}
          onChange={(q) => onSearch({ q })}
          label="Search districts"
          placeholder="Search court, state or circuit"
        />
        <FilterSelect
          label="Circuit"
          value={search.circuit}
          onChange={(circuit) => onSearch({ circuit })}
          options={circuits}
          allLabel="All circuits"
        />
        <FilterSelect
          label="State"
          value={search.state}
          onChange={(state) => onSearch({ state })}
          options={states.map((s) => ({ id: s, label: s }))}
          allLabel="All states"
        />
        {filtered ? (
          <ResetButton
            onClick={() => onSearch({ q: undefined, circuit: undefined, state: undefined })}
          />
        ) : null}
      </div>
      {shown.length ? (
        <TableScroll label="Federal district courts, civil caseload">
          <table className="w-full min-w-[46rem] text-xs">
            <caption className="sr-only">
              Federal district courts with {year} civil filings, terminations, pending cases and
              shares
            </caption>
            <thead className="text-left text-[11px] text-muted-foreground">
              <tr>
                {head("name", "Court", "District court", "left")}
                {head("state", "St.", "State or territory", "left")}
                {head("circuit", "Cir.", "Circuit", "left")}
                {head("filings", "Filed", `Civil cases filed in ${year}`)}
                {head("terminations", "Terminated", `Civil cases terminated in ${year}`)}
                {head("pending", "Pending", "Pending on September 30 of the year")}
                {head(
                  "medianDays",
                  "Median days",
                  "Median days from filing to termination, cases terminated in the year",
                )}
                {head(
                  "classActionPct",
                  "Class %",
                  "Share of the year's filings alleging a class action",
                )}
                {head(
                  "proSePct",
                  "Pro se %",
                  "Share of filings with a recorded pro se status that have a pro se plaintiff",
                )}
                {head(
                  "productPct",
                  "Product %",
                  "Share of the year's filings in product liability and health-care/pharma injury",
                )}
                {head("trialPct", "Trial %", "Share of the year's terminations by trial judgment")}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {shown.map((d) => {
                const selected = search.court === d.id;
                return (
                  <tr key={d.id} className={selected ? "bg-muted/60" : undefined}>
                    <td className="max-w-52 truncate px-1.5 py-1" title={d.name}>
                      <Link
                        to="/courts/caseload"
                        search={patchSearch(search, { court: d.id })}
                        resetScroll={false}
                        aria-current={selected ? "true" : undefined}
                        className={`hover:underline ${selected ? "font-semibold text-foreground" : "text-primary"}`}
                      >
                        {shortCourtName(d.name)}
                      </Link>
                    </td>
                    <td className="px-1.5 py-1">{d.state ?? NOT_RECORDED}</td>
                    <td className="whitespace-nowrap px-1.5 py-1" title={d.circuit ?? NOT_RECORDED}>
                      {circuitShort(d.circuit)}
                    </td>
                    <Num v={d.filings} />
                    <Num v={d.terminations} />
                    <Num v={d.pending} />
                    <Num v={d.medianDays} />
                    <Pct v={d.classActionPct} />
                    <Pct v={d.proSePct} />
                    <Pct v={d.productPct} />
                    <Pct v={d.trialPct} />
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableScroll>
      ) : (
        <StateNote
          action={
            <ResetButton
              onClick={() => onSearch({ q: undefined, circuit: undefined, state: undefined })}
            />
          }
        >
          No district matches these filters.
        </StateNote>
      )}
      <ListCoverage loaded={rows.length} total={total} dropped={dropped} noun="districts" />
    </Panel>
  );
}

function Num({ v }: { v: number | null }) {
  return (
    <td className="px-1.5 py-1 text-right font-mono">
      {v == null ? <span className="font-sans text-muted-foreground">{NOT_RECORDED}</span> : int(v)}
    </td>
  );
}

function Pct({ v }: { v: number | null }) {
  return (
    <td className="px-1.5 py-1 text-right font-mono">
      {v == null ? <span className="font-sans text-muted-foreground">{NOT_RECORDED}</span> : pct(v)}
    </td>
  );
}
