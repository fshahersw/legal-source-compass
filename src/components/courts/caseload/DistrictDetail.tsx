import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, X } from "lucide-react";
import { int, signedPct } from "@/components/analysis/analysisFormat";
import { Kpi, Panel, StateNote } from "@/components/enforcement/parts";
import { STATES } from "@/lib/corpus/geo";
import type {
  DistrictDetail,
  DistrictRow,
  NationalCaseload,
  StateRow,
} from "@/lib/external/courtCaseload.functions";
import { MedianChart, VolumeChart } from "./CaseloadCharts";
import { MixPanels, RankChips, RetryNote } from "./CaseloadParts";
import {
  days,
  daysDelta,
  firstMedianYear,
  fyLabel,
  NOT_RECORDED,
  partialText,
  pct,
  priorYear,
  shortCourtName,
  signedPctOf,
  yearOf,
} from "./caseloadFormat";
import { districtDetailQuery, statesQuery } from "./caseloadQueries";
import { useJumpWhenShown } from "./useJumpWhenShown";

const stateName = new Map(STATES.map((s) => [s.usps, s.name]));

const SELECT_HINT =
  "Select a district in the table to see its filings, time to termination, case mix and ranks.";

export function DistrictDetailPanel({
  courtId,
  districts,
  national,
  through,
  onClear,
}: {
  courtId: string | undefined;
  districts: readonly DistrictRow[];
  national: NationalCaseload | null;
  through: string | null;
  onClear: () => void;
}) {
  const query = useQuery({ ...districtDetailQuery(courtId ?? ""), enabled: Boolean(courtId) });
  const states = useQuery({ ...statesQuery, enabled: Boolean(courtId) });
  const row = courtId ? (districts.find((d) => d.id === courtId) ?? null) : null;
  useJumpWhenShown(courtId, !query.isLoading, "caseload-district");

  if (!courtId)
    return (
      <Panel id="caseload-district" title="District drill-down">
        <StateNote>{SELECT_HINT}</StateNote>
      </Panel>
    );
  const clear = (
    <button
      type="button"
      onClick={onClear}
      className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 text-xs hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
    >
      <X className="size-3" aria-hidden />
      Close
    </button>
  );
  if (query.isLoading)
    return (
      <Panel
        id="caseload-district"
        title={row ? shortCourtName(row.name) : "District drill-down"}
        actions={clear}
      >
        <div
          className="space-y-2 p-3"
          aria-busy="true"
          aria-label="Loading the district drill-down"
        >
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {Array.from({ length: 8 }, (_, i) => (
              <div
                key={i}
                className="h-16 animate-pulse rounded-md border border-border bg-muted/50"
              />
            ))}
          </div>
          <div className="h-60 animate-pulse rounded-md border border-border bg-muted/50" />
        </div>
      </Panel>
    );
  if (query.isError)
    return (
      <Panel
        id="caseload-district"
        title={row ? shortCourtName(row.name) : "District drill-down"}
        actions={clear}
      >
        <RetryNote onRetry={() => void query.refetch()}>
          The drill-down for this district could not be loaded.
        </RetryNote>
      </Panel>
    );
  const d = query.data;
  if (!d)
    return (
      <Panel id="caseload-district" title="District drill-down" actions={clear}>
        <StateNote>
          No district with the id &ldquo;{courtId}&rdquo; is in the FJC caseload. {SELECT_HINT}
        </StateNote>
      </Panel>
    );
  const stateRow = d.state ? (states.data?.rows.find((s) => s.code === d.state) ?? null) : null;
  return (
    <Detail d={d} row={row} national={national} through={through} clear={clear} state={stateRow} />
  );
}

function Detail({
  d,
  row,
  national,
  through,
  clear,
  state,
}: {
  d: DistrictDetail;
  row: DistrictRow | null;
  national: NationalCaseload | null;
  through: string | null;
  clear: ReactNode;
  state: StateRow | null;
}) {
  const subject = shortCourtName(d.name);
  const fy = fyLabel(d.latestFy);
  const y = yearOf(d.years, d.latestFy);
  const prior = priorYear(d.years, d.latestFy);
  const priorLabel = prior ? fyLabel(prior.fy) : null;
  const firstMedian = firstMedianYear(d.years);
  const partial = d.years.find((v) => v.partial) ?? null;
  const vs = (
    published: number | null | undefined,
    a: number | null | undefined,
    b: number | null | undefined,
  ) => {
    if (!priorLabel) return undefined;
    const text = published != null ? signedPct(published) : signedPctOf(a, b);
    return text === NOT_RECORDED ? undefined : `${text} vs ${priorLabel}`;
  };
  const stateLabel = d.state ? (stateName.get(d.state) ?? d.state) : null;
  const medianNote = [
    d.change?.medianDaysDelta != null && priorLabel
      ? `${daysDelta(d.change.medianDaysDelta)} vs ${priorLabel}`
      : null,
    y?.p25Days != null && y.p75Days != null
      ? `middle half ${int(y.p25Days)} to ${int(y.p75Days)} days`
      : null,
  ]
    .filter(Boolean)
    .join("; ");
  return (
    <Panel
      id="caseload-district"
      title={d.name}
      subtitle={[
        row?.circuit ?? null,
        stateLabel,
        `FJC IDB civil cases ${fyLabel(d.years[0]?.fy ?? d.latestFy)} to ${fyLabel(d.years.at(-1)?.fy ?? d.latestFy, Boolean(partial))}`,
      ]
        .filter(Boolean)
        .join(" · ")}
      actions={
        <>
          {row?.hasCourtPage ? (
            <Link
              to="/courts/$id"
              params={{ id: d.id }}
              className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 text-xs hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
            >
              Court page
              <ChevronRight className="size-3" aria-hidden />
            </Link>
          ) : null}
          {clear}
        </>
      }
    >
      <div className="space-y-3 p-3">
        {state ? (
          <p className="text-xs text-muted-foreground">
            {stateLabel} has {state.districts == null ? NOT_RECORDED : int(state.districts)} federal
            district {state.districts === 1 ? "court" : "courts"}: {fy} filed{" "}
            {state.filings == null ? NOT_RECORDED : int(state.filings)}, terminated{" "}
            {state.terminations == null ? NOT_RECORDED : int(state.terminations)}, median{" "}
            {days(state.medianDays)} across the state&apos;s cases.{" "}
            {d.state && stateName.has(d.state) ? (
              <Link
                to="/places/$state"
                params={{ state: d.state }}
                className="text-primary hover:underline"
              >
                {stateLabel} place page
              </Link>
            ) : null}
          </p>
        ) : null}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Kpi
            label={`Filed, ${fy}`}
            value={y?.filings == null ? NOT_RECORDED : int(y.filings)}
            note={vs(d.change?.filingsPct, y?.filings, prior?.filings)}
          />
          <Kpi
            label={`Terminated, ${fy}`}
            value={y?.terminations == null ? NOT_RECORDED : int(y.terminations)}
            note={vs(null, y?.terminations, prior?.terminations)}
          />
          <Kpi
            label={`Pending on Sep 30, ${d.latestFy}`}
            value={y?.pendingEnd == null ? NOT_RECORDED : int(y.pendingEnd)}
            note={vs(d.change?.pendingPct, y?.pendingEnd, prior?.pendingEnd)}
          />
          <Kpi
            label={`Median days to termination, ${fy}`}
            value={y?.medianDays == null ? NOT_RECORDED : int(y.medianDays)}
            note={medianNote || undefined}
          />
          <Kpi
            label="Class action"
            value={pct(y?.classActionPct)}
            note={`Share of ${fy} filings alleging a class action`}
          />
          <Kpi
            label="Pro se plaintiff"
            value={pct(y?.proSePct)}
            note={`Share of ${fy} filings with a recorded pro se status`}
          />
          <Kpi
            label="Product liability and health-care injury"
            value={pct(y?.productPct)}
            note={`Share of ${fy} filings`}
          />
          <Kpi
            label="Trial judgment"
            value={pct(y?.trialPct)}
            note={`Share of ${fy} terminations (jury, directed verdict, court trial)`}
          />
        </div>
        <div>
          <h4 className="mb-1 text-xs font-semibold">
            Rank among {d.ranks[0] ? int(d.ranks[0].of) : "the"} districts, {fy}
          </h4>
          <RankChips ranks={d.ranks} fy={d.latestFy} />
          <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
            1st is the highest value, and tied districts share the lowest number; hover a chip for
            what the top rank means.{" "}
            {partial
              ? `${fyLabel(partial.fy)} is a ${partialText(through)} and is never ranked.`
              : ""}
          </p>
        </div>
      </div>
      <div className="grid gap-3 border-t border-border/60 p-3 lg:grid-cols-2">
        <Panel
          title="Filed, terminated and pending"
          subtitle="Civil cases per fiscal year; pending is the count on September 30"
          footnote={
            <>
              Each fiscal year runs October 1 to September 30 and is named for the year it ends.
              {partial ? (
                <>
                  {" "}
                  {fyLabel(partial.fy)}* is a {partialText(through)}: shown dashed, not a full year,
                  and not comparable with the complete years.
                </>
              ) : null}
            </>
          }
        >
          <VolumeChart years={d.years} subject={subject} through={through} />
        </Panel>
        <Panel
          title="Time to termination"
          subtitle="Median days from filing to termination, with the middle half of cases"
          footnote={
            <>
              Cases terminated in each year.{" "}
              {firstMedian != null
                ? `Median days are Not recorded before ${fyLabel(firstMedian)} in this dataset. `
                : "Median days are Not recorded for any year. "}
              {partial
                ? `${fyLabel(partial.fy)}* covers only the cases terminated so far this year. `
                : ""}
              The band is drawn only where the 25th percentile, median and 75th percentile are all
              recorded and in order.
            </>
          }
        >
          <MedianChart
            years={d.years}
            nationalYears={national?.years}
            subject={subject}
            through={through}
          />
        </Panel>
      </div>
      <div className="border-t border-border/60 p-3">
        <MixPanels window={d.window} showGroups showTopNos subject={subject} />
      </div>
      <p className="border-t border-border/60 px-3 py-1.5 text-[11px] leading-4 text-muted-foreground">
        Source: Federal Judicial Center Integrated Database, civil cases filed, terminated and
        pending, statistical years 1988 to present. Counts are the FJC&apos;s; the AO&apos;s
        published tables remain the reference for official totals.
      </p>
    </Panel>
  );
}
