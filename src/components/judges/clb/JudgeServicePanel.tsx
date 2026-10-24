import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { ChartFrame } from "@/components/charts/ChartFrame";
import { HowToRead } from "@/components/analysis/HowToRead";
import { Kpi, SourceLink } from "@/components/enforcement/parts";
import { CollapsibleSection } from "@/components/courts/clb/ClbParts";
import {
  CourtName,
  MiniTable,
  PanelError,
  PanelLoading,
  PanelShell,
} from "@/components/courts/clb/ClbRestParts";
import { fmtInt, NOT_RECORDED } from "@/components/courts/clb/clbFormat";
import { JUDGE_ID, type CrosswalkTier } from "@/lib/external/judgeCourtListener.functions";
import { cn } from "@/lib/utils";
import { fjcRecordQuery } from "@/components/judiciary/judiciaryQueries";
import { getClbJudgePeople } from "./judgePeople.functions";
import {
  courtPositions,
  daysBetween,
  firstConfirmation,
  lawDegree,
  otherPositions,
  serviceLanes,
  voteText,
  yearOfDate,
  type Education,
  type JudgePeople,
  type Position,
} from "./judgePeople";

const BULK = "https://www.courtlistener.com/help/api/bulk-data/";
const LINK_BASIS: Partial<Record<CrosswalkTier, string>> = {
  exact_id: "linked by federal judicial id",
  parent_profile_link: "linked through the FJC-backed directory record",
  exact_name_same_court: "linked by exact name at the same court",
  exact_name_same_state: "linked by exact name in the same state",
};
const dash = (s: string | null) => s ?? NOT_RECORDED;

/**
 * A judge's record in CourtListener's people database (dataset clb_judge_people): court positions with nomination,
 * hearing, confirmation, vote and service dates, education and ABA ratings, exactly as recorded and at the precision
 * recorded. Reached through the judge crosswalk like the page's other CourtListener panels; renders nothing when the
 * page is not linked to a CourtListener person or the person has no record.
 */
export function JudgeServicePanel({ judgeId }: { judgeId: string }) {
  const enabled = JUDGE_ID.test(judgeId);
  const q = useQuery({
    queryKey: ["clb-judge-people", judgeId],
    queryFn: () => getClbJudgePeople({ data: { id: judgeId } }),
    staleTime: 10 * 60 * 1000,
    enabled,
  });
  if (!enabled) return null;
  if (q.isLoading)
    return <PanelLoading label="Loading appointment and education record" height="h-36" />;
  if (q.isError)
    return (
      <PanelError
        text="The appointment and education record could not be loaded."
        onRetry={() => void q.refetch()}
      />
    );
  if (!q.data) return null;
  return <WithFjc judgeId={judgeId} j={q.data.data} tier={q.data.tier} />;
}

/** The FJC panel on the same page reads the same cached query; when it has a record, this panel's sections start closed. */
function WithFjc({ judgeId, j, tier }: { judgeId: string; j: JudgePeople; tier: CrosswalkTier }) {
  const fjc = useQuery(fjcRecordQuery(judgeId));
  return <Body j={j} tier={tier} hasFjc={!!fjc.data} />;
}

function Body({ j, tier, hasFjc }: { j: JudgePeople; tier: CrosswalkTier; hasFjc: boolean }) {
  const courts = courtPositions(j);
  const others = otherPositions(j);
  const law = lawDegree(j);
  const conf = firstConfirmation(j);
  const latestAba = j.aba.length ? j.aba[j.aba.length - 1]! : null;
  const abaRead = j.aba.find((a) => a.retrievedAt)?.retrievedAt?.slice(0, 10) ?? null;
  return (
    <PanelShell
      title="Appointment, service and education"
      subtitle={
        <>
          The source people database, Sept 30, 2026 export
          {j.aba.length
            ? `; ABA ratings read from the source on ${abaRead ?? NOT_RECORDED}`
            : ""}
          {LINK_BASIS[tier] ? ` · ${LINK_BASIS[tier]}` : ""}
          {hasFjc ? " · the FJC record above is the official source for federal service" : ""}
        </>
      }
      record={{ dataset: "clb_judge_people", id: String(j.personId) }}
      aside={
        <SourceLink href={`https://www.courtlistener.com/person/${j.personId}/`}>
          Source person page
        </SourceLink>
      }
    >
      <div className="grid grid-cols-2 gap-2 px-3 pb-2 md:grid-cols-4">
        <Kpi
          label="Court positions on record"
          value={fmtInt(courts.length)}
          note={others.length ? `${fmtInt(others.length)} other positions` : undefined}
        />
        <Kpi
          label="First recorded confirmation"
          value={conf?.dates.confirmation ?? NOT_RECORDED}
          note={conf?.court ?? undefined}
        />
        <Kpi
          label="Latest ABA rating"
          value={latestAba ? latestAba.rating : NOT_RECORDED}
          note={latestAba ? `rated ${latestAba.year ?? "year not recorded"}` : "no rating recorded"}
        />
        <Kpi
          label="Law degree"
          value={law ? (law.school ?? "School not recorded") : NOT_RECORDED}
          note={
            law ? [law.degreeDetail ?? law.degree, law.year].filter(Boolean).join(", ") : undefined
          }
        />
      </div>
      {courts.length ? (
        <div className="px-3 pb-3">
          <ServiceTimeline judge={j} positions={courts} />
        </div>
      ) : null}
      {courts.length ? (
        <CollapsibleSection
          title="Nomination, confirmation and service"
          summary={`${courts.length} court position${courts.length === 1 ? "" : "s"}`}
          defaultOpen={!hasFjc}
        >
          <MiniTable<Position>
            caption="Court positions, as recorded"
            rows={courts}
            rowKey={(p) => String(p.id)}
            limit={8}
            noun="positions"
            columns={[
              {
                key: "c",
                label: "Court and position",
                render: (p) => (
                  <>
                    {p.courtId && p.court ? (
                      <CourtName name={p.court} courtId={p.courtId} link={p.courtLink} />
                    ) : (
                      NOT_RECORDED
                    )}
                    <span className="block text-muted-foreground">{dash(p.title)}</span>
                  </>
                ),
              },
              {
                key: "s",
                label: "Selected",
                render: (p) => (
                  <>
                    {dash(p.howSelected)}
                    {p.appointer ? (
                      <span className="block text-muted-foreground">by {p.appointer.name}</span>
                    ) : null}
                  </>
                ),
              },
              {
                key: "n",
                label: "Nominated, hearing, confirmed",
                render: (p) => <NominationCell p={p} />,
              },
              { key: "v", label: "Vote", render: (p) => voteText(p.votes) ?? NOT_RECORDED },
              {
                key: "t",
                label: "Service",
                render: (p) => (
                  <>
                    {dash(p.dates.start)} – {p.dates.termination ?? "no end recorded"}
                    {p.dates.retirement ? (
                      <span className="block text-muted-foreground">
                        senior status {p.dates.retirement}
                      </span>
                    ) : null}
                    {p.terminationReason ? (
                      <span className="block text-muted-foreground">{p.terminationReason}</span>
                    ) : null}
                  </>
                ),
              },
            ]}
            note={
              <>
                Retention: the judicial people database records no retention events for any judge
                (0 rows in its export and its API on Oct 24, 2026), so re-elections and
                reappointments are not listed.
                {courts.some((p) => p.inferred)
                  ? " Positions marked by the source as having inferred values were partly filled from a source rather than entered by hand."
                  : ""}
              </>
            }
          />
        </CollapsibleSection>
      ) : null}
      {j.education.length ? (
        <CollapsibleSection
          title="Education"
          summary={`${j.education.length} degree${j.education.length === 1 ? "" : "s"} on record`}
          defaultOpen={!hasFjc}
        >
          <MiniTable<Education>
            caption="Degrees, as recorded"
            rows={j.education}
            rowKey={(e) => String(e.id)}
            columns={[
              { key: "d", label: "Degree", render: (e) => dash(e.degreeDetail ?? e.degree) },
              {
                key: "s",
                label: "School",
                render: (e) => (
                  <>
                    {dash(e.school)}
                    {e.schoolAliasOf ? (
                      <span className="block text-muted-foreground">
                        recorded as an alias of {e.schoolAliasOf}
                      </span>
                    ) : null}
                  </>
                ),
              },
              {
                key: "y",
                label: "Year",
                numeric: true,
                render: (e) => (e.year == null ? NOT_RECORDED : String(e.year)),
              },
            ]}
          />
        </CollapsibleSection>
      ) : null}
      <CollapsibleSection
        title="ABA ratings"
        summary={
          j.aba.length
            ? j.aba.map((a) => `${a.rating} (${a.year ?? "year not recorded"})`).join("; ")
            : "none recorded"
        }
        defaultOpen={j.aba.length > 0 && !hasFjc}
      >
        {j.aba.length ? (
          <MiniTable
            caption="American Bar Association ratings recorded by the source"
            rows={j.aba}
            rowKey={(a) => String(a.id)}
            columns={[
              {
                key: "y",
                label: "Year rated",
                render: (a) => (a.year == null ? NOT_RECORDED : String(a.year)),
              },
              { key: "r", label: "Rating", render: (a) => a.rating },
            ]}
            note={`Read from the ratings record${abaRead ? ` on ${abaRead}` : ""}. A rating is the ABA committee's; the source records the rating and year only.`}
          />
        ) : (
          <p className="text-xs text-muted-foreground">
            The source records no ABA rating for this person.
          </p>
        )}
      </CollapsibleSection>
      {j.lowerCourtAppeals && j.lowerCourtAppeals.assigned + j.lowerCourtAppeals.ordering > 0 ? (
        <CollapsibleSection
          title="Appeals from this judge's cases"
          summary={`${fmtInt(j.lowerCourtAppeals.assigned)} appeal${j.lowerCourtAppeals.assigned === 1 ? "" : "s"} name this judge as the lower-court judge`}
        >
          <LowerCourtAppealsBlock a={j.lowerCourtAppeals} />
        </CollapsibleSection>
      ) : null}
      {others.length ? (
        <CollapsibleSection
          title="Other positions on record"
          summary={`${others.length} position${others.length === 1 ? "" : "s"} outside a court`}
        >
          <MiniTable<Position>
            caption="Positions outside a court, as recorded"
            rows={others}
            rowKey={(p) => String(p.id)}
            limit={8}
            noun="positions"
            columns={[
              { key: "t", label: "Position", render: (p) => dash(p.title) },
              {
                key: "o",
                label: "Organization",
                render: (p) =>
                  [p.organization, p.location].filter(Boolean).join(", ") || NOT_RECORDED,
              },
              {
                key: "y",
                label: "Years",
                render: (p) => {
                  const a = yearOfDate(p.dates.start);
                  const b = yearOfDate(p.dates.termination);
                  return a != null && a === b
                    ? String(a)
                    : `${a ?? "start not recorded"} – ${b ?? "no end recorded"}`;
                },
              },
            ]}
          />
        </CollapsibleSection>
      ) : null}
      {j.positionsTotal > j.positions.length ? (
        <p className="px-3 pb-2 text-[11px] text-muted-foreground">
          {fmtInt(j.positionsTotal - j.positions.length)} further positions are in the full record.
        </p>
      ) : null}
      <div className="px-3 pb-3">
        <HowToRead
          measures={[
            {
              term: "Dates",
              means: "shown to the precision the source recorded: a year, a month or a day.",
              caveat: "A year-only start is drawn from the start of that year in the timeline.",
            },
            {
              term: "Nominated to confirmed",
              means: "days between the recorded nomination and confirmation dates.",
              caveat: "Shown only when both dates are recorded to the day.",
            },
            {
              term: "Selected",
              means:
                "how the source records the person was selected, and the appointing official it links.",
            },
            {
              term: "No end recorded",
              means: "the source records no end date for the position.",
              caveat: "It does not by itself mean the person still serves.",
            },
          ]}
        />
      </div>
    </PanelShell>
  );
}

function LowerCourtAppealsBlock({ a }: { a: NonNullable<JudgePeople["lowerCourtAppeals"]> }) {
  return (
    <div className="space-y-2 text-xs">
      <p className="leading-5">
        The source's appellate dockets carry an originating-court record for each appeal;{" "}
        {fmtInt(a.assigned)} of them name this judge (by case-law person id) as the judge the
        case was assigned to below
        {a.ordering ? `, and ${fmtInt(a.ordering)} as the ordering judge` : ""}. This covers the
        appeals in the source's collection, not every appeal.
      </p>
      {a.byNoticeYear.length ? (
        <MiniTable
          caption="Appeals by year of the notice of appeal, as recorded"
          rows={[...a.byNoticeYear].reverse()}
          rowKey={(r) => String(r.year)}
          limit={8}
          noun="years"
          columns={[
            { key: "y", label: "Notice of appeal filed", render: (r) => String(r.year) },
            { key: "n", label: "Appeals", numeric: true, render: (r) => fmtInt(r.n) },
          ]}
        />
      ) : null}
      {a.noNoticeDate || a.noticeAfterExport ? (
        <p className="text-[11px] text-muted-foreground">
          {a.noNoticeDate
            ? `${fmtInt(a.noNoticeDate)} without a recorded notice-of-appeal date`
            : ""}
          {a.noNoticeDate && a.noticeAfterExport ? "; " : ""}
          {a.noticeAfterExport
            ? `${fmtInt(a.noticeAfterExport)} with a recorded notice date after the Sept 30, 2026 export (not listed by year)`
            : ""}
          .
        </p>
      ) : null}
    </div>
  );
}

function NominationCell({ p }: { p: Position }) {
  const d = p.dates;
  const days = daysBetween(d.nominated, d.confirmation);
  const parts = [
    d.nominated ? `nominated ${d.nominated}` : null,
    d.recessAppointment ? `recess appointment ${d.recessAppointment}` : null,
    d.hearing ? `hearing ${d.hearing}` : null,
    d.committeeAction
      ? `committee ${d.committeeAction}${p.committeeAction ? ` (${p.committeeAction})` : ""}`
      : null,
    d.confirmation ? `confirmed ${d.confirmation}` : null,
    d.elected ? `elected ${d.elected}` : null,
  ].filter((x): x is string => !!x);
  if (!parts.length) return <>{NOT_RECORDED}</>;
  return (
    <>
      {parts.map((t) => (
        <span key={t} className="block">
          {t}
        </span>
      ))}
      {days != null ? (
        <span className="block text-muted-foreground">
          {fmtInt(days)} days nominated to confirmed
        </span>
      ) : null}
    </>
  );
}

function ServiceTimeline({
  judge,
  positions,
}: {
  judge: JudgePeople;
  positions: readonly Position[];
}) {
  const tl = useMemo(() => serviceLanes(positions, judge.died), [positions, judge.died]);
  const undated = positions.length - (tl?.lanes.length ?? 0);
  const span = tl ? Math.max(1, tl.hi - tl.lo + 1) : 1;
  const at = (y: number) => ((y - (tl?.lo ?? 0)) / span) * 100;
  const step = span > 40 ? 10 : span > 16 ? 5 : span > 6 ? 2 : 1;
  const ticks = tl
    ? Array.from(
        { length: Math.floor((tl.hi + 1 - tl.lo) / step) + 1 },
        (_, i) => tl.lo + i * step,
      ).filter((y) => y <= tl.hi + 1)
    : [];
  return (
    <ChartFrame
      title="Court positions on record, by year of start and end"
      unit="positions"
      period={tl ? `${tl.lo}–${tl.hi}` : undefined}
      headingLevel="h3"
      sources={[
        { label: "CourtListener people database (positions)", url: BULK },
        {
          label: "CourtListener person page",
          url: `https://www.courtlistener.com/person/${judge.personId}/`,
        },
      ]}
      status={
        tl
          ? { kind: "ready" }
          : { kind: "empty", reason: "No court position has a recorded start date." }
      }
      partialNotice={
        undated > 0
          ? `${undated} court position${undated === 1 ? " has" : "s have"} no recorded start date and ${undated === 1 ? "is" : "are"} not drawn.`
          : undefined
      }
      notes={[
        "Each bar runs from the recorded start year to the recorded end year.",
        "A hatched bar has no recorded end; it is drawn to 2026 (the export year), or to the recorded year of death.",
      ]}
      table={{
        caption: "Court positions by start and end",
        columns: [
          { label: "Court" },
          { label: "Position", align: "left" },
          { label: "Start", align: "left" },
          { label: "End", align: "left" },
        ],
        rows: positions.map((p) => ({
          key: String(p.id),
          cells: [
            p.court ?? NOT_RECORDED,
            p.title ?? NOT_RECORDED,
            p.dates.start ?? NOT_RECORDED,
            p.dates.termination ?? "No end recorded",
          ],
        })),
      }}
    >
      {tl ? (
        <div className="min-w-0 space-y-1.5 py-1" role="list" aria-label="Court positions by year">
          {tl.lanes.map((l) => (
            <div
              key={l.p.id}
              role="listitem"
              className="grid min-w-0 grid-cols-1 gap-x-3 gap-y-0.5 sm:grid-cols-[minmax(0,14rem)_1fr]"
            >
              <div
                className="min-w-0 truncate text-[11px]"
                title={`${l.p.court ?? ""} · ${l.p.title ?? ""}`}
              >
                <span className="font-medium">{l.p.court}</span>
                <span className="text-muted-foreground"> · {l.p.title ?? NOT_RECORDED}</span>
              </div>
              <div className="relative h-4 rounded-sm bg-muted/50">
                <span
                  tabIndex={0}
                  aria-label={`${l.p.court}, ${l.p.title ?? "position"}: ${l.p.dates.start} to ${l.p.dates.termination ?? "no end recorded"}`}
                  title={`${l.p.dates.start} – ${l.p.dates.termination ?? "no end recorded"}`}
                  className={cn(
                    "absolute inset-y-0.5 rounded-sm focus-visible:outline-2 focus-visible:outline-ring",
                    l.open
                      ? "bg-[repeating-linear-gradient(135deg,var(--chart-1)_0_4px,transparent_4px_7px)] ring-1 ring-inset ring-[var(--chart-1)]"
                      : "bg-[var(--chart-1)]",
                  )}
                  style={{
                    left: `${at(l.from)}%`,
                    width: `max(${at(l.to + 1) - at(l.from)}%, 3px)`,
                  }}
                />
              </div>
            </div>
          ))}
          <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,14rem)_1fr]" aria-hidden>
            <span className="hidden sm:block" />
            <div className="relative h-4 text-[10px] text-muted-foreground">
              {ticks.map((y) => (
                <span
                  key={y}
                  className="absolute -translate-x-1/2 tabular-nums"
                  style={{ left: `${at(y)}%` }}
                >
                  {y}
                </span>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </ChartFrame>
  );
}
