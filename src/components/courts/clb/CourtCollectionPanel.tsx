import { useId, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { HowToRead } from "@/components/analysis/HowToRead";
import { Kpi, SourceLink } from "@/components/enforcement/parts";
import {
  COURT_ID,
  getClbCourtCollection,
  type ClbBench,
  type ClbClusters,
  type ClbCourtCollection,
  type ClbCourtProfile,
  type ClbDockets,
  type ClbDuration,
  type ClbJudge,
  type ClbOral,
} from "@/lib/external/clbCourt.functions";
import {
  ClusterYearChart,
  CoverageChart,
  DocketYearChart,
  OralYearChart,
  VoteChart,
} from "./ClbCharts";
import {
  benchPhrases,
  citationsSummary,
  clusterRange,
  docketRange,
  docketYearRows,
  durationBar,
  fmtDec,
  fmtInt,
  fmtPct,
  lastVoteYear,
  nosCoverage,
  opinionsSummary,
  shareOf,
  sourceMixLabel,
  transcriptShare,
  voteDecades,
} from "./clbFormat";
import {
  ChartFrame,
  CollapsibleSection,
  Fact,
  RecordLink,
  ShareBars,
  type BarRow,
} from "./ClbParts";
import { CitationsBody, OpinionsOnFileBody } from "./ClbOpinionSections";

const STALE = 10 * 60 * 1000;
const PERSON_ID = /^\/records\/cl_people\/(cl:people:\d+)$/;

const clbCollectionQuery = (courtId: string) => ({
  queryKey: ["clb-court-collection", courtId],
  queryFn: () => getClbCourtCollection({ data: { id: courtId } }),
  staleTime: STALE,
});

/**
 * CourtListener's collection statistics for one court (dataset clb_court_profiles). Counts describe
 * rows in CourtListener's collection, not complete court totals. Sections the record does not carry
 * are not rendered; a court with no dockets, opinion clusters, oral arguments, opinion rows or
 * citation links shows nothing.
 */
export function CourtCollectionPanel({ courtId }: { courtId: string }) {
  const enabled = COURT_ID.test(courtId);
  const q = useQuery({ ...clbCollectionQuery(courtId), enabled });
  if (!enabled) return null;
  if (q.isLoading)
    return (
      <div
        className="mb-5 h-56 animate-pulse rounded-lg border border-border bg-muted/40"
        aria-busy="true"
        aria-label="Loading collection statistics"
      />
    );
  if (q.isError)
    return (
      <p
        role="alert"
        className="mb-5 flex flex-wrap items-center gap-2 rounded-lg border border-border px-4 py-3 text-xs text-muted-foreground"
      >
        Source collection statistics could not be loaded.
        <button
          type="button"
          onClick={() => void q.refetch()}
          className="rounded text-primary underline focus-visible:outline-2 focus-visible:outline-ring"
        >
          Retry
        </button>
      </p>
    );
  if (!q.data) return null;
  return <Body c={q.data} />;
}

type SectionSpec = { key: string; title: string; summary: string; body: ReactNode };

function Body({ c }: { c: ClbCourtCollection }) {
  const uid = useId();
  const p = c.profile;
  const d = p.dockets;
  const k = p.clusters;
  const o = p.oral;
  if (!d && !k && !o && !p.opinions && !p.citations) return null;
  const snapshot = c.method?.snapshot ?? null;
  const sections = buildSections(p, snapshot, c.citingRecord);
  return (
    <section
      className="mb-5 min-w-0 rounded-lg border border-border bg-surface"
      aria-labelledby={`${uid}-title`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2 px-3 py-2">
        <div className="min-w-0">
          <h2 id={`${uid}-title`} className="text-sm font-semibold">
            Source collection
          </h2>
          <p className="text-xs text-muted-foreground">
            {p.name}
            {snapshot ? ` · snapshot ${snapshot}` : ""} · bulk data from Free Law Project
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <Link
            to="/records/$dataset/$id"
            params={{ dataset: "clb_court_profiles", id: p.courtId }}
            className="rounded-md border border-border px-2.5 py-1 hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
          >
            Full record
          </Link>
          {c.courtPageUrl ? (
            <SourceLink href={c.courtPageUrl}>Source court page</SourceLink>
          ) : null}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 px-3 pb-2 md:grid-cols-4">
        <Kpi
          label="Dockets in the collection"
          value={d ? fmtInt(d.total) : "None"}
          note={d ? docketNote(d, p.opinionSourceDockets) : "No docket rows in the collection"}
        />
        <Kpi
          label="Opinion clusters"
          value={k ? fmtInt(k.total) : "None"}
          note={k ? clusterNote(k) : "No opinion clusters in the collection"}
        />
        <Kpi
          label="Oral argument recordings"
          value={o ? fmtInt(o.total) : "None"}
          note={
            o
              ? `${fmtPct(transcriptShare(o))} with a transcript`
              : "No recordings in the collection"
          }
        />
        <Kpi
          label="RECAP share of dockets"
          value={d ? fmtPct(d.recapPct) : "No dockets"}
          note={d ? `${fmtInt(d.recap)} of ${fmtInt(d.total)} dockets` : undefined}
        />
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 pb-2 text-[11px]">
        <span className="inline-flex items-center rounded border border-border bg-muted px-1.5 py-px font-medium">
          Collection, not complete court totals
        </span>
        {p.opinionSourceDockets ? (
          <span className="text-muted-foreground">
            Docket rows here were created from opinions, so the docket count is not a count of cases
            filed.
          </span>
        ) : null}
      </div>
      {sections.map((s, i) => (
        <CollapsibleSection key={s.key} title={s.title} summary={s.summary} defaultOpen={i === 0}>
          {s.body}
        </CollapsibleSection>
      ))}
      {c.method && (c.method.definitions.length || c.method.caveats.length) ? (
        <div className="border-t border-border/70 p-3">
          <HowToRead
            title="How to read these figures"
            measures={c.method.definitions.map((x) => ({ term: x.term, means: x.text }))}
            notes={
              c.method.caveats.length ? (
                <ul className="list-disc space-y-0.5 pl-4">
                  {c.method.caveats.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              ) : undefined
            }
          />
        </div>
      ) : null}
    </section>
  );
}

function docketNote(d: ClbDockets, opinionSource: boolean): string {
  if (opinionSource) return "Created from opinions; not a count of cases filed";
  const range = docketRange(d);
  return range
    ? `Filed ${range} · ${fmtInt(d.dated)} with a filing date`
    : "No filing dates recorded";
}

function clusterNote(k: ClbClusters): string {
  const range = clusterRange(k);
  return `${range ? `${range} · ` : ""}${fmtPct(k.citedPct)} cited at least once`;
}

function buildSections(
  p: ClbCourtProfile,
  snapshot: string | null,
  citingRecord: string | null,
): SectionSpec[] {
  const out: SectionSpec[] = [];
  const d = p.dockets;
  const k = p.clusters;
  const o = p.oral;
  if (d && d.byYear.length)
    out.push({
      key: "dockets",
      title: "Dockets by filing year",
      summary: `${docketRange(d) ?? ""} · ${fmtInt(d.dated)} with a filing date · ${fmtInt(d.noFiledDate)} without`,
      body: (
        <DocketsBody d={d} asOf={snapshot ?? d.lastFiled} opinionSource={p.opinionSourceDockets} />
      ),
    });
  if (p.coverage && p.coverage.byFy.length) {
    const cov = p.coverage;
    const first = cov.byFy[0]!.fy;
    const last = cov.byFy[cov.byFy.length - 1]!.fy;
    out.push({
      key: "coverage",
      title: "Coverage against FJC civil filings",
      summary: `FY${first}–FY${last} · ratio FY${cov.latestCompleteFy ?? last} ${fmtDec(cov.latestRatio, 2)}× · median of the last 10 FY ${fmtDec(cov.medianRatioLast10Fy, 2)}×`,
      body: <CoverageBody p={p} />,
    });
  }
  if (d && (d.nosGroups.length || d.topNos.length || d.topCauses.length))
    out.push({
      key: "casemix",
      title: "Case mix",
      summary: `${fmtInt(d.nosRecorded)} dockets with a nature-of-suit entry (${fmtPct(nosCoverage(d).sharePct)} of dockets)`,
      body: <CaseMixBody d={d} />,
    });
  if (d && (d.durationCivil || d.durationAll)) {
    const lead = d.durationCivil ?? d.durationAll!;
    out.push({
      key: "duration",
      title: "Time to termination",
      summary: `median ${fmtInt(lead.median)} days, ${d.durationCivil ? "civil-numbered" : "all"} dockets (n = ${fmtInt(lead.n)})`,
      body: <DurationBody d={d} />,
    });
  }
  if (d && (d.judgesAssigned.length || d.judgesReferred.length || d.appealFrom.length || p.bench))
    out.push({
      key: "people",
      title: "Judges and appeals",
      summary: [
        d.judgesAssigned.length ? `${d.judgesAssigned.length} assigned judges` : null,
        d.judgesReferred.length ? `${d.judgesReferred.length} referred judges` : null,
        d.appealFrom.length ? `${d.appealFrom.length} courts of origin` : null,
        p.bench ? `${fmtInt(p.bench.positions)} positions on record` : null,
      ]
        .filter(Boolean)
        .join(" · "),
      body: <PeopleBody d={d} bench={p.bench} courtId={p.courtId} />,
    });
  else if (!d && p.bench)
    out.push({
      key: "people",
      title: "Judges and appeals",
      summary: `${fmtInt(p.bench.positions)} positions on record`,
      body: <PeopleBody d={null} bench={p.bench} courtId={p.courtId} />,
    });
  if (k)
    out.push({
      key: "opinions",
      title: "Opinions",
      summary: `${fmtInt(k.total)} clusters · ${clusterRange(k) ?? "no filing dates"} · ${fmtPct(k.citedPct)} cited at least once`,
      body: <OpinionsBody k={k} courtId={p.courtId} />,
    });
  if (p.opinions)
    out.push({
      key: "opinions-on-file",
      title: "Opinions on file",
      summary: opinionsSummary(p.opinions),
      body: <OpinionsOnFileBody o={p.opinions} />,
    });
  if (p.citations)
    out.push({
      key: "citations",
      title: "Citations",
      summary: citationsSummary(p.citations),
      body: <CitationsBody c={p.citations} courtId={p.courtId} citingRecord={citingRecord} />,
    });
  if (o)
    out.push({
      key: "oral",
      title: "Oral arguments",
      summary: `${fmtInt(o.total)} recordings${o.medianMinutes != null ? ` · median ${fmtDec(o.medianMinutes, 1)} min` : ""} · ${fmtPct(transcriptShare(o))} with a transcript`,
      body: <OralBody o={o} />,
    });
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Dockets
// ---------------------------------------------------------------------------------------------------

function DocketsBody({
  d,
  asOf,
  opinionSource,
}: {
  d: ClbDockets;
  asOf: string | null;
  opinionSource: boolean;
}) {
  const { rows, split, partialYear } = docketYearRows(d.byYear, asOf);
  const sources: BarRow[] = d.sources.map((s) => ({
    key: String(s.mask),
    label: sourceMixLabel(s),
    count: s.count,
    sharePct: s.sharePct,
    title: `Source bit mask ${s.mask}: ${sourceMixLabel(s)}`,
  }));
  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 md:grid-cols-4">
        <Fact
          label="With a termination date"
          value={fmtInt(d.terminated)}
          note={`${fmtPct(d.terminatedPct)} of dockets with a filing date`}
        />
        <Fact label="No filing date" value={fmtInt(d.noFiledDate)} note="counted, not plotted" />
        <Fact
          label="Filing date out of range"
          value={fmtInt(d.implausibleFiled)}
          note="before 1700 or after the snapshot; counted, not plotted"
        />
        <Fact
          label="Filing dates on record"
          value={docketRange(d) ?? "Not recorded"}
          note={d.lastFiled ? `latest ${d.lastFiled}` : undefined}
        />
      </dl>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <ChartFrame
          caption="Dockets in the collection by year of filing date"
          label={`Bar chart of dockets by filing year, ${rows[0]?.yr} to ${rows[rows.length - 1]?.yr}`}
          height="h-52"
          footnote={
            <>
              {split
                ? "Civil- and criminal-numbered use the case type in the docket number; other covers miscellaneous, magistrate, appeal and unrecorded types. "
                : "No civil- or criminal-numbered dockets are recorded here, so all dockets are one series. "}
              {partialYear != null && asOf ? `* ${partialYear} runs through ${asOf}. ` : ""}
              {opinionSource
                ? "Docket rows were created from opinions: bars follow opinions, not cases filed."
                : ""}
            </>
          }
        >
          <DocketYearChart rows={rows} split={split} />
        </ChartFrame>
        <ShareBars
          heading="Where the docket rows come from"
          rows={sources}
          note={`Share of all ${fmtInt(d.total)} dockets; the ${Math.min(8, sources.length)} largest source combinations. RECAP is PACER material someone fetched or shared.`}
          noun="sources"
        />
      </div>
    </div>
  );
}

function CoverageBody({ p }: { p: ClbCourtProfile }) {
  const cov = p.coverage!;
  return (
    <div className="space-y-2">
      <ChartFrame
        caption="Source civil-numbered dockets and federal civil filings, by fiscal year"
        label={`Line chart of civil-numbered dockets against federal civil filings, FY${cov.byFy[0]?.fy} to FY${cov.byFy[cov.byFy.length - 1]?.fy}, with their ratio`}
        height="h-56"
      >
        <CoverageChart years={cov.byFy} />
      </ChartFrame>
      <p className="text-[11px] leading-4 text-muted-foreground">
        Ratio = civil-numbered dockets (docket number contains -cv-) filed in the fiscal year
        divided by Federal Judicial Center Integrated Database civil filings for this district. It
        is a collection-overlap indicator, not an error rate and not a measure of completeness: the
        two counts follow different rules, so a ratio above or below 1.0 shows only that they
        differ. Fiscal years run October 1 to September 30.
      </p>
    </div>
  );
}

function CaseMixBody({ d }: { d: ClbDockets }) {
  const cov = nosCoverage(d);
  const toRows = (rows: ClbDockets["topNos"]): BarRow[] =>
    rows.map((r) => ({ key: r.value, label: r.label, count: r.count, sharePct: r.sharePct }));
  return (
    <div className="space-y-2">
      <p className="text-[11px] leading-4 text-muted-foreground">
        {cov.recorded != null
          ? `${fmtInt(cov.recorded)} of ${fmtInt(cov.total)} dockets (${fmtPct(cov.sharePct)}) carry a nature-of-suit entry. Nature-of-suit shares below are of those ${fmtInt(cov.recorded)}.`
          : `Nature-of-suit coverage is not recorded.`}
      </p>
      <div className="grid gap-4 md:grid-cols-3">
        <ShareBars
          heading="Nature of suit, by group"
          rows={toRows(d.nosGroups)}
          note="Federal civil nature-of-suit entries that carry a numeric code, grouped by the project's grouping of those codes."
          noun="groups"
        />
        <ShareBars
          heading="Most common nature-of-suit entries"
          rows={toRows(d.topNos)}
          note="Entries as recorded on the docket."
          noun="entries"
        />
        <ShareBars
          heading="Most common causes of action"
          rows={toRows(d.topCauses)}
          note={
            d.withCause != null
              ? `Share of the ${fmtInt(d.withCause)} dockets with a cause entry.`
              : undefined
          }
          noun="causes"
        />
      </div>
    </div>
  );
}

function DurationRow({ label, dur }: { label: string; dur: ClbDuration }) {
  const bar = durationBar(dur);
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h4 className="text-xs font-medium">{label}</h4>
        <span className="text-[11px] text-muted-foreground">n = {fmtInt(dur.n)} dockets</span>
      </div>
      {bar ? (
        <div className="relative my-2 h-2 rounded-sm bg-muted" aria-hidden>
          <div
            className="absolute inset-y-0 rounded-sm bg-primary/35"
            style={{ left: `${bar.boxLeft}%`, width: `${bar.boxWidth}%` }}
          />
          <div
            className="absolute -inset-y-0.5 w-0.5 rounded-sm bg-primary"
            style={{ left: `${bar.medianAt}%` }}
          />
        </div>
      ) : null}
      <dl className="grid grid-cols-4 gap-2">
        <Fact label="25th percentile" value={`${fmtInt(dur.p25)} days`} />
        <Fact label="Median" value={`${fmtInt(dur.median)} days`} />
        <Fact label="75th percentile" value={`${fmtInt(dur.p75)} days`} />
        <Fact label="90th percentile" value={`${fmtInt(dur.p90)} days`} />
      </dl>
    </div>
  );
}

function DurationBody({ d }: { d: ClbDockets }) {
  return (
    <div className="space-y-3">
      <div className="grid gap-4 md:grid-cols-2">
        {d.durationCivil ? (
          <DurationRow label="Civil-numbered dockets" dur={d.durationCivil} />
        ) : null}
        {d.durationAll ? <DurationRow label="All dockets" dur={d.durationAll} /> : null}
      </div>
      <p className="text-[11px] leading-4 text-muted-foreground">
        Days from filing to termination, for dockets that have both dates and a termination on or
        after filing; shown only from 30 dockets. The bar runs from 0 to the 90th percentile, with
        the box covering the 25th to 75th percentile and the line at the median. RECAP dockets are a
        convenience sample, so these describe the dockets in the collection, not the court's whole
        caseload.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------------------------------

function JudgeName({ j }: { j: ClbJudge }) {
  const m = j.record ? PERSON_ID.exec(j.record) : null;
  if (m?.[1])
    return (
      <RecordLink dataset="cl_people" id={m[1]}>
        {j.name}
      </RecordLink>
    );
  return (
    <SourceLink href={`https://www.courtlistener.com/person/${j.personId}/`}>{j.name}</SourceLink>
  );
}

function yearsOf(a: string | null, b: string | null): string {
  const x = a?.slice(0, 4);
  const y = b?.slice(0, 4);
  if (!x || !y) return "Not recorded";
  return x === y ? x : `${x}–${y}`;
}

const TH = "px-2 py-1 text-left font-medium first:pl-0 last:pr-0";
const TD = "px-2 py-1 first:pl-0 last:pr-0";
const NUM = "text-right font-mono tabular-nums";

function JudgeTable({
  caption,
  countLabel,
  judges,
  assigned,
}: {
  caption: string;
  countLabel: string;
  judges: readonly ClbJudge[];
  assigned: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[28rem] text-xs">
        <caption className="sr-only">{caption}</caption>
        <thead className="text-muted-foreground">
          <tr className="border-b border-border/60">
            <th scope="col" className={TH}>
              Judge
            </th>
            <th scope="col" className={`${TH} text-right`}>
              {countLabel}
            </th>
            {assigned ? (
              <th scope="col" className={`${TH} text-right`}>
                With a termination date
              </th>
            ) : null}
            {assigned ? (
              <th scope="col" className={TH}>
                Docket filing years
              </th>
            ) : null}
            <th scope="col" className={TH}>
              Docket statistics
            </th>
          </tr>
        </thead>
        <tbody>
          {judges.map((j) => (
            <tr key={j.personId} className="border-t border-border/50">
              <td className={`${TD} font-medium`}>
                <JudgeName j={j} />
              </td>
              <td className={`${TD} ${NUM}`}>{fmtInt(j.dockets)}</td>
              {assigned ? <td className={`${TD} ${NUM}`}>{fmtInt(j.terminated)}</td> : null}
              {assigned ? (
                <td className={`${TD} font-mono tabular-nums`}>
                  {yearsOf(j.firstFiled, j.lastFiled)}
                </td>
              ) : null}
              <td className={TD}>
                {j.statsRecord ? (
                  <RecordLink dataset="clb_judge_dockets" id={String(j.personId)}>
                    Judge record
                  </RecordLink>
                ) : (
                  <span
                    className="text-muted-foreground"
                    title="No docket-statistics record was found for this person id"
                  >
                    —
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PeopleBody({
  d,
  bench,
  courtId,
}: {
  d: ClbDockets | null;
  bench: ClbBench | null;
  courtId: string;
}) {
  return (
    <div className="space-y-4">
      {d && d.judgesAssigned.length ? (
        <div className="min-w-0">
          <h4 className="text-xs font-medium">Judges assigned the most dockets</h4>
          <p className="mb-1 text-[11px] leading-4 text-muted-foreground">
            Top {d.judgesAssigned.length} by assigned dockets in the collection
            {d.withAssignedJudge != null
              ? `; ${fmtInt(d.withAssignedJudge)} dockets (${fmtPct(d.withAssignedPct)} of ${fmtInt(d.total)}) have an assigned judge`
              : ""}
            . Dockets are reassigned, so a docket's filing year can precede a judge's service, and
            counts are not a judge's complete caseload.
          </p>
          <JudgeTable
            caption="Judges assigned the most dockets"
            countLabel="Assigned dockets"
            judges={d.judgesAssigned}
            assigned
          />
        </div>
      ) : null}
      {d && d.judgesReferred.length ? (
        <div className="min-w-0">
          <h4 className="text-xs font-medium">Judges referred the most dockets</h4>
          <p className="mb-1 text-[11px] leading-4 text-muted-foreground">
            Magistrate judge referrals; top {d.judgesReferred.length} by referred dockets.
          </p>
          <JudgeTable
            caption="Judges referred the most dockets"
            countLabel="Referred dockets"
            judges={d.judgesReferred}
            assigned={false}
          />
        </div>
      ) : null}
      {d && d.appealFrom.length ? (
        <div className="min-w-0">
          <h4 className="text-xs font-medium">Courts of origin</h4>
          <p className="mb-1 text-[11px] leading-4 text-muted-foreground">
            Lower courts the dockets came from
            {d.withAppealFrom != null
              ? `; shares are of the ${fmtInt(d.withAppealFrom)} dockets with an origin recorded`
              : ""}
            . A court links to its page only when the stored link names exactly that court.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[22rem] text-xs">
              <caption className="sr-only">Courts of origin</caption>
              <thead className="text-muted-foreground">
                <tr className="border-b border-border/60">
                  <th scope="col" className={TH}>
                    Court
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    Dockets
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    Share with an origin recorded
                  </th>
                </tr>
              </thead>
              <tbody>
                {d.appealFrom.map((a) => (
                  <tr key={a.courtId} className="border-t border-border/50">
                    <td className={`${TD} break-words`}>
                      {a.link ? (
                        <Link
                          to="/courts/$id"
                          params={{ id: a.courtId }}
                          className="text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                        >
                          {a.name}
                        </Link>
                      ) : (
                        a.name
                      )}
                    </td>
                    <td className={`${TD} ${NUM}`}>{fmtInt(a.dockets)}</td>
                    <td className={`${TD} ${NUM}`}>{fmtPct(a.sharePct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
      {bench ? (
        <div className="min-w-0 text-xs leading-5">
          <h4 className="font-medium">Judicial positions</h4>
          <p>{benchPhrases(bench).join(" · ")}. Positions on record, not a census.</p>
          <p>
            <RecordLink dataset="clb_court_benches" id={courtId}>
              Open the positions record
            </RecordLink>
          </p>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------
// Opinions
// ---------------------------------------------------------------------------------------------------

function OpinionsBody({ k, courtId }: { k: ClbClusters; courtId: string }) {
  const decades = voteDecades(k.scotusByYear);
  const lastVote = lastVoteYear(k.scotusByYear);
  const precedential: BarRow[] = k.precedential.map((r) => ({
    key: r.value,
    label: r.label,
    count: r.count,
    sharePct: r.sharePct,
  }));
  const reporters: BarRow[] = k.reporters.map((r) => ({
    key: r.value,
    label: r.label,
    count: r.count,
    sharePct: r.sharePct,
  }));
  const med = (v: number | null) =>
    v == null ? fmtInt(v) : fmtDec(v, Number.isInteger(v) ? 0 : 1);
  return (
    <div className="space-y-4">
      {k.byYear.length ? (
        <ChartFrame
          caption="Opinion clusters by year of filing date"
          label={`Bar chart of opinion clusters by year, ${k.byYear[0]?.yr} to ${k.byYear[k.byYear.length - 1]?.yr}`}
          height="h-44"
          footnote={`${fmtInt(k.dated)} of ${fmtInt(k.total)} clusters have a usable filing date. A cluster groups the opinions of one decision (majority, concurrence, dissent).`}
        >
          <ClusterYearChart years={k.byYear} />
        </ChartFrame>
      ) : null}
      <div className="min-w-0">
        <h4 className="text-xs font-medium">Times cited in the citation network</h4>
        <dl className="mt-1 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3 lg:grid-cols-5">
          <Fact
            label="Clusters cited at least once"
            value={fmtInt(k.cited)}
            note={`${fmtPct(k.citedPct)} of ${fmtInt(k.total)} clusters`}
          />
          <Fact label="Total times cited" value={fmtInt(k.citeTotal)} />
          <Fact label="Median, among cited" value={med(k.citeMedianAmongCited)} />
          <Fact label="90th percentile, among cited" value={med(k.citeP90AmongCited)} />
          <Fact label="Most cited cluster" value={fmtInt(k.citeMax)} />
        </dl>
        <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
          Times cited counts the opinions in the citation network that cite a cluster.
 It depends on what the collection holds, newer opinions have had less time to be cited,
 and it says nothing about whether the opinion is still good law.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <ShareBars
          heading="Precedential status"
          rows={precedential}
          note={`As CourtListener records it; share of all ${fmtInt(k.total)} clusters.`}
        />
        <ShareBars
          heading="Reporter citations on file"
          rows={reporters}
          note={`Share of reporter citations on file (a cluster can carry several); ${fmtInt(k.withReporterCite)} clusters (${fmtPct(k.withReporterCitePct)}) have at least one.`}
          noun="reporters"
        />
      </div>
      {k.topCited.length ? (
        <div className="min-w-0">
          <h4 className="text-xs font-medium">Most cited opinion clusters</h4>
          <ol className="mt-1 divide-y divide-border/50 text-xs">
            {k.topCited.map((t, i) => (
              <li
                key={t.clusterId}
                className="grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-baseline gap-x-2 py-1"
              >
                <span className="font-mono text-muted-foreground tabular-nums">{i + 1}</span>
                <span className="min-w-0 break-words">
                  {t.url ? (
                    <SourceLink href={t.url}>{t.caseName ?? "Case name not recorded"}</SourceLink>
                  ) : (
                    (t.caseName ?? "Case name not recorded")
                  )}
                  {t.dateFiled ? (
                    <span className="text-muted-foreground"> · {t.dateFiled}</span>
                  ) : null}
                </span>
                <span className="font-mono tabular-nums text-muted-foreground">
                  {fmtInt(t.timesCited)} cites
                </span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
      {courtId === "scotus" && decades.length ? (
        <ChartFrame
          caption="Supreme Court vote splits by decade"
          label={`Stacked bar chart of unanimous, 5–4 and other vote splits by decade, ${decades[0]?.label} to ${decades[decades.length - 1]?.label}`}
          height="h-48"
          footnote={`Decisions with a recorded vote split only: ${fmtInt(k.withScdb)} of ${fmtInt(k.total)} clusters carry a Supreme Court Database link${lastVote != null ? `, and the linked years end in ${lastVote}` : ""}. Other splits are any recorded vote that is neither unanimous nor 5–4.`}
        >
          <VoteChart rows={decades} />
        </ChartFrame>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------
// Oral arguments
// ---------------------------------------------------------------------------------------------------

function OralBody({ o }: { o: ClbOral }) {
  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3 lg:grid-cols-6">
        <Fact label="Recordings" value={fmtInt(o.total)} />
        <Fact label="Dockets with a recording" value={fmtInt(o.dockets)} />
        <Fact
          label="Median length"
          value={o.medianMinutes != null ? `${fmtDec(o.medianMinutes, 1)} min` : "Not recorded"}
          note="recordings with a length"
        />
        <Fact
          label="Total recorded"
          value={o.totalHours != null ? `${fmtInt(Math.round(o.totalHours))} h` : "Not recorded"}
        />
        <Fact
          label="With a transcript"
          value={fmtInt(o.withTranscript)}
          note={`${fmtPct(shareOf(o.withTranscript, o.total))} of recordings`}
        />
        <Fact
          label="Added to CourtListener"
          value={yearsOf(o.firstCreated, o.lastCreated)}
          note="first to latest"
        />
      </dl>
      {o.byYear.length ? (
        <ChartFrame
          caption="Recordings by the year they were added to CourtListener"
          label={`Bar chart of oral argument recordings by year added, ${o.byYear[0]?.yr} to ${o.byYear[o.byYear.length - 1]?.yr}`}
          height="h-40"
          footnote="Years are when each recording was created in CourtListener, not the argument dates; a bulk load can put many recordings in one year."
        >
          <OralYearChart years={o.byYear} />
        </ChartFrame>
      ) : null}
    </div>
  );
}
