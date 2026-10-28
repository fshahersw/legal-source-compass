import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Gavel } from "lucide-react";
import { signedPct } from "@/components/analysis/analysisFormat";
import { MoreToggle, SourceLink } from "@/components/enforcement/parts";
import { FDA_COLORS } from "@/components/fda-analytics/chartView";
import { MiniLine } from "@/components/states/consumer/MiniLine";
import {
  Note,
  PanelSection,
  PanelState,
  ResponsiveTable,
  RetryButton,
  Stat,
  StatGrid,
  TakeawayList,
} from "@/components/states/consumer/parts";
import { ShareBars } from "@/components/states/consumer/ShareBars";
import {
  getStateCourtData,
  type BenchCourt,
  type CourtSection,
  type LargeCourt,
  type StateCourtData,
} from "@/lib/external/stateCourtData.functions";
import {
  COLLECTION_CAVEAT,
  NOT_RECORDED,
  civilChange,
  civilPoints,
  countText,
  courtTakeaways,
  courtsPlural,
  daysText,
  docketSplit,
  lastTwo,
  percentText,
  snapshotThrough,
  yearsText,
} from "./courtDataView";
import { SplitBar } from "./SplitBar";

const SECTION_LABEL: Record<CourtSection, string> = {
  civil: "federal civil caseload",
  dockets: "the CourtListener collection",
  courts: "largest courts",
  benches: "benches",
  sources: "edition details",
};

/** Federal civil caseload, CourtListener's docket collection and bench positions for a state, each labelled by its dataset. */
export function StateCourtDataPanel({
  usps,
  withCivil = true,
}: {
  usps: string;
  /** false where the page already charts the federal civil caseload. */
  withCivil?: boolean;
}) {
  const fn = useServerFn(getStateCourtData);
  const q = useQuery({
    queryKey: ["state-court-data", usps],
    queryFn: () => fn({ data: { usps } }),
    staleTime: 10 * 60 * 1000,
  });
  return (
    <section
      className="resource-panel @container"
      aria-label="Court data: caseload, dockets and benches"
    >
      <div className="research-band">
        <h2 className="flex items-center gap-2 text-heading font-semibold text-foreground">
          <Gavel className="size-4" aria-hidden />
          Court data
        </h2>
      </div>
      {q.isPending ? (
        <p role="status" aria-busy="true" className="px-3 py-6 text-xs text-muted-foreground">
          Loading…
        </p>
      ) : q.error ? (
        <PanelState tone="error" action={<RetryButton onClick={() => void q.refetch()} />}>
          Court data could not load.
        </PanelState>
      ) : (
        <Body data={q.data} onRetry={() => void q.refetch()} withCivil={withCivil} />
      )}
    </section>
  );
}

function Body({
  data,
  onRetry,
  withCivil,
}: {
  data: StateCourtData;
  onRetry: () => void;
  withCivil: boolean;
}) {
  const { courtListener: cl, benches } = data;
  const civil = withCivil ? data.civil : null;
  if (!civil && !cl && !benches)
    return data.unavailable.length ? (
      <PanelState tone="error" action={<RetryButton onClick={onRetry} />}>
        Court data could not load.
      </PanelState>
    ) : (
      <PanelState>
        No federal caseload, docket or bench records are published for this state yet.
      </PanelState>
    );
  const two = civil ? lastTwo(civil) : null;
  const filings = civil ? civilChange(civil, "filings") : null;
  const terminations = civil ? civilChange(civil, "terminations") : null;
  const takeaways = courtTakeaways(withCivil ? data : { ...data, civil: null });
  const fyScope = two ? `FY${two.last.fy} · FJC` : null;
  // A dataset with no row for this state is said so once; one that failed to load is named in the note above.
  const absent = [
    withCivil && !civil && !data.unavailable.includes("civil") ? "federal civil caseload" : null,
    !cl && !data.unavailable.includes("dockets") ? "CourtListener docket collection" : null,
    !benches && !data.unavailable.includes("benches") ? "bench positions" : null,
  ].filter((s): s is string => s != null);
  return (
    <>
      {data.unavailable.length ? (
        <PanelState action={<RetryButton onClick={onRetry} />}>
          Not loaded: {data.unavailable.map((s) => SECTION_LABEL[s]).join(", ")}. The rest is shown.
        </PanelState>
      ) : null}
      {civil && two ? (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-x-2 px-3 py-1.5 text-[11px]">
            <span className="font-medium">
              Federal civil caseload, FY{two.last.fy}
              <span className="font-normal text-muted-foreground">
                {" "}
                · {courtsPlural(civil.districts.length || 1)}
              </span>
            </span>
            {civil.sourceUrl ? (
              <SourceLink href={civil.sourceUrl}>Federal caseload data</SourceLink>
            ) : (
              <span className="text-muted-foreground">Federal caseload data</span>
            )}
          </div>
          <StatGrid label={`Federal civil caseload, FY${two.last.fy}`} wide={4}>
            <Stat
              label="Civil cases filed"
              value={countText(two.last.filings)}
              note={
                filings
                  ? `${signedPct(filings.pct)} against FY${filings.previousFy} (computed from the two counts)`
                  : undefined
              }
            />
            <Stat
              label="Cases terminated"
              value={countText(two.last.terminations)}
              note={
                terminations
                  ? `${signedPct(terminations.pct)} against FY${terminations.previousFy}`
                  : undefined
              }
            />
            <Stat
              label="Pending at September 30"
              value={countText(two.last.pending)}
              note="Open at the end of the fiscal year"
            />
            <Stat
              label="Median days to termination"
              value={daysText(two.last.medianDays)}
              note="Filing to termination, cases terminated in the year"
            />
          </StatGrid>
        </>
      ) : null}
      {cl ? (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-x-2 px-3 py-1.5 text-[11px]">
            <span className="font-medium">
              Source collection
              <span className="font-normal text-muted-foreground">
                {data.sources.courtListener.snapshot
                  ? ` · snapshot ${data.sources.courtListener.snapshot}`
                  : ""}
              </span>
            </span>
            <span className="text-muted-foreground">{COLLECTION_CAVEAT}</span>
          </div>
          <StatGrid label="Dockets and opinions in the collection" wide={4}>
            <Stat
              label="Dockets in the collection"
              value={countText(cl.dockets)}
              note={cl.courts != null ? `Across ${countText(cl.courts)} courts` : undefined}
            />
            <Stat
              label="Opinion clusters"
              value={countText(cl.clusters)}
              note="Decisions in the collection"
            />
            <Stat
              label="Civil-numbered dockets"
              value={countText(cl.civilDockets)}
              note="Docket number contains -cv-"
            />
            <Stat
              label="Dockets from RECAP"
              value={percentText(cl.recapPct)}
              note="Fetched or shared from PACER"
            />
          </StatGrid>
        </>
      ) : null}
      {absent.length ? (
        <PanelState>Not published for this state: {absent.join(", ")}.</PanelState>
      ) : null}
      <TakeawayList items={takeaways} scope={fyScope ?? undefined} />
      {civil ? (
        <PanelSection
          id="courts-civil"
          title="Federal civil caseload by fiscal year"
          hint={`FY${civil.series[0]!.fy}–FY${civil.latestFy}`}
        >
          <Civil data={data} />
        </PanelSection>
      ) : null}
      {cl ? (
        <PanelSection id="courts-dockets" title="Dockets in the collection" hint="collection">
          <Dockets data={data} />
        </PanelSection>
      ) : null}
      {data.courts.length ? (
        <PanelSection
          id="courts-courts"
          title="Largest courts in the collection"
          hint={`${data.courts.length} by dockets`}
        >
          <Courts data={data} />
        </PanelSection>
      ) : null}
      {benches ? (
        <PanelSection
          id="courts-benches"
          title="Benches: positions on record"
          hint={`${countText(benches.positions)} positions`}
        >
          <Benches data={data} />
        </PanelSection>
      ) : null}
      <PanelSection id="courts-method" title="Sources and how to read">
        <Method data={data} />
      </PanelSection>
    </>
  );
}

function Civil({ data }: { data: StateCourtData }) {
  const civil = data.civil;
  if (!civil) return <Note>Federal civil caseload is {NOT_RECORDED} for this state.</Note>;
  const last = civil.series[civil.series.length - 1]!;
  const partial = civil.partialYear;
  const mix = civil.mix;
  const through = snapshotThrough(data.sources.fjc.snapshot);
  return (
    <>
      <div className="grid gap-x-4 gap-y-3 @xl:grid-cols-2 @3xl:grid-cols-3">
        <MiniLine
          title="Filed (solid) and terminated (dashed)"
          valueLabel={`FY${last.fy}: ${countText(last.filings)} filed`}
          data={civilPoints(civil.series, "filings", "terminations")}
          name="Filed"
          name2="Terminated"
          format={(n) => n.toLocaleString("en-US")}
          color={FDA_COLORS[1]}
          color2={FDA_COLORS[2]}
        />
        <MiniLine
          title="Pending at September 30"
          valueLabel={`FY${last.fy}: ${countText(last.pending)}`}
          data={civilPoints(civil.series, "pending")}
          name="Pending"
          format={(n) => n.toLocaleString("en-US")}
          color={FDA_COLORS[3]}
        />
        <MiniLine
          title="Median days to termination"
          valueLabel={`FY${last.fy}: ${daysText(last.medianDays)}`}
          data={civilPoints(civil.series, "medianDays")}
          name="Median days"
          format={(n) => `${Math.round(n).toLocaleString("en-US")} days`}
          axisFormat={(n) => Math.round(n).toLocaleString("en-US")}
          color={FDA_COLORS[4]}
        />
      </div>
      <Note>
        Federal district courts in the state, civil cases only, by the federal fiscal year (October
        1 to September 30, labelled by the year it ends). A case counts in the state where it was
        filed.
        {partial
          ? ` FY${partial.fy} is partial in this snapshot${
              through ? ` (filing dates through ${through})` : ""
            }: ${countText(partial.filings)} filed and ${countText(partial.terminations)} terminated so far; it is not charted, ranked or compared.`
          : ""}
      </Note>
      {mix ? (
        <div className="space-y-1">
          <h4 className="text-xs font-semibold">
            Case types, filings FY{mix.fyFrom}–FY{mix.fyTo}
            <span className="ml-1 font-normal text-muted-foreground">share of filings</span>
          </h4>
          <ShareBars
            items={mix.groups.slice(0, 6).map((g) => ({ label: g.label, sharePct: g.sharePct }))}
            color={FDA_COLORS[3]}
          />
          <Note>
            Groups are this project&apos;s grouping of the FJC&apos;s nature-of-suit codes, not FJC
            categories; the six largest of {mix.groups.length} are shown. FY{last.fy}: class actions{" "}
            {percentText(civil.shares.classActionPct)}, pro se plaintiffs{" "}
            {percentText(civil.shares.proSePct)}, product liability{" "}
            {percentText(civil.shares.productPct)} of filings (cases where the field is recorded).
          </Note>
        </div>
      ) : null}
    </>
  );
}

function Dockets({ data }: { data: StateCourtData }) {
  const cl = data.courtListener;
  if (!cl)
    return (
      <Note>CourtListener&apos;s collection has no record for this state ({NOT_RECORDED}).</Note>
    );
  const split = docketSplit(cl);
  return (
    <>
      {split.length ? (
        <SplitBar
          title="Dockets by court group"
          segments={split.map((s) => ({ label: s.label, value: s.dockets, sharePct: s.sharePct }))}
        />
      ) : null}
      <Note>
        Courts are placed in a state by the project&apos;s court spine; multi-state courts and the
        U.S. Supreme Court are not assigned to a state. Counts are dockets and opinion clusters in
        CourtListener&apos;s collection, {COLLECTION_CAVEAT}.
      </Note>
      {data.sources.courtListener.caveats.length ? (
        <ul className="list-disc space-y-0.5 pl-4 text-[10.5px] leading-snug text-muted-foreground">
          {data.sources.courtListener.caveats.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

function CourtName({ id, name, linked }: { id: string; name: string; linked: boolean }) {
  return linked ? (
    <Link
      to="/courts/$id"
      params={{ id }}
      className="text-primary underline decoration-border underline-offset-2 hover:decoration-current"
    >
      {name}
    </Link>
  ) : (
    <span>{name}</span>
  );
}

function Courts({ data }: { data: StateCourtData }) {
  const [all, setAll] = useState(false);
  const limit = 6;
  if (!data.courts.length)
    return <Note>No court rows are available for this state ({NOT_RECORDED}).</Note>;
  const rows: LargeCourt[] = all ? data.courts : data.courts.slice(0, limit);
  return (
    <>
      <div id="courts-largest-list">
        <ResponsiveTable
          caption="Largest courts by dockets in the collection"
          rows={rows}
          rowKey={(c) => c.courtId}
          columns={[
            {
              id: "court",
              header: "Court",
              role: "title",
              cell: (c) => <CourtName id={c.courtId} name={c.name} linked={c.linked} />,
            },
            {
              id: "dockets",
              header: "Dockets",
              align: "right",
              role: "value",
              cell: (c) => countText(c.dockets),
            },
            {
              id: "level",
              header: "Level",
              role: "detail",
              cell: (c) => <span className="font-sans">{c.level ?? NOT_RECORDED}</span>,
            },
            {
              id: "clusters",
              header: "Opinion clusters",
              align: "right",
              role: "detail",
              cell: (c) => countText(c.clusters),
            },
            {
              id: "recap",
              header: "RECAP",
              align: "right",
              role: "detail",
              cell: (c) => percentText(c.recapPct),
            },
            {
              id: "median",
              header: "Median civil days",
              align: "right",
              role: "detail",
              cell: (c) =>
                c.medianCivilDays == null ? NOT_RECORDED : countText(c.medianCivilDays),
            },
          ]}
        />
      </div>
      <MoreToggle
        total={data.courts.length}
        limit={limit}
        expanded={all}
        onToggle={() => setAll((v) => !v)}
        controls="courts-largest-list"
        noun="courts"
      />
      <Note>
        Ranked by dockets in CourtListener&apos;s collection, {COLLECTION_CAVEAT}; a court&apos;s
        docket count is not its caseload. Median civil days is shown only when at least 30 civil
        dockets have both dates. A court links to its page only where the court record has that
        exact CourtListener id.
      </Note>
    </>
  );
}

function womenText(c: BenchCourt): string {
  return percentText(c.womenPct);
}

function Benches({ data }: { data: StateCourtData }) {
  const [all, setAll] = useState(false);
  const limit = 5;
  const b = data.benches;
  if (!b)
    return (
      <Note>
        No judicial positions are on record for this state&apos;s courts ({NOT_RECORDED}).
      </Note>
    );
  const rows = all ? b.rows : b.rows.slice(0, limit);
  return (
    <>
      <StatGrid label="Judicial positions on record">
        <Stat label="Courts with positions" value={countText(b.courts)} />
        <Stat
          label="Positions on record"
          value={countText(b.positions)}
          note="Positions, not people: one person can hold several"
        />
        <Stat
          label="No end recorded"
          value={countText(b.noEndRecorded)}
          note="Start date, no recorded end, person not recorded as deceased"
        />
      </StatGrid>
      <div id="courts-benches-list">
        <ResponsiveTable
          caption="Courts with the most judicial positions on record"
          rows={rows}
          rowKey={(c) => c.courtId}
          columns={[
            {
              id: "court",
              header: "Court",
              role: "title",
              cell: (c) => <CourtName id={c.courtId} name={c.name} linked={c.linked} />,
            },
            {
              id: "positions",
              header: "Positions",
              align: "right",
              role: "value",
              cell: (c) => countText(c.positions),
            },
            {
              id: "noEnd",
              header: "No end recorded",
              align: "right",
              role: "detail",
              cell: (c) => countText(c.noEndRecorded),
            },
            {
              id: "women",
              header: "Women",
              align: "right",
              role: "detail",
              cell: womenText,
            },
            {
              id: "years",
              header: "Median years served",
              align: "right",
              role: "detail",
              cell: (c) => yearsText(c.medianYearsServed),
            },
          ]}
        />
      </div>
      <MoreToggle
        total={b.rows.length}
        limit={limit}
        expanded={all}
        onToggle={() => setAll((v) => !v)}
        controls="courts-benches-list"
        noun="benches"
      />
      <Note>
        Positions on record in CourtListener&apos;s people records, not a census of sitting judges,
        and state-court coverage is incomplete. Women is the share of those with a recorded gender,
        so a small bench can swing widely. Median years served counts only positions that have
        ended. The {b.rows.length} benches listed are the largest of {countText(b.courts)}.
      </Note>
    </>
  );
}

function Method({ data }: { data: StateCourtData }) {
  const { fjc, courtListener } = data.sources;
  const civil = data.civil;
  const cl = data.courtListener;
  return (
    <>
      <dl className="space-y-1.5 text-[11px] leading-snug">
        <div>
          <dt className="font-medium">Federal civil caseload</dt>
          <dd className="text-muted-foreground">
            FJC Integrated Database, civil cases filed, terminated and pending in the state&apos;s
            federal district courts{fjc.snapshot ? ` (${fjc.snapshot})` : ""}. The Administrative
            Office&apos;s published tables remain the reference for official counts. Pending is the
            number open on September 30.
          </dd>
        </div>
        <div>
          <dt className="font-medium">Source collection</dt>
          <dd className="text-muted-foreground">
            Dockets and opinion clusters in Free Law Project&apos;s bulk data
            {courtListener.snapshot ? ` (snapshot ${courtListener.snapshot})` : ""}:{" "}
            {COLLECTION_CAVEAT}. RECAP dockets exist when someone fetched or shared them.
          </dd>
        </div>
        <div>
          <dt className="font-medium">Not recorded</dt>
          <dd className="text-muted-foreground">
            The source has no value, or too few cases to publish one; nothing is filled in.
          </dd>
        </div>
      </dl>
      <Note>
        {civil?.sourceUrl ? (
          <>
            <SourceLink href={civil.sourceUrl}>Federal caseload data civil cases</SourceLink>
          </>
        ) : null}
        {cl?.sourceUrl ? (
          <>
            {civil?.sourceUrl ? " · " : ""}
            <SourceLink href={cl.sourceUrl}>Source dockets file</SourceLink>
          </>
        ) : null}
      </Note>
      {fjc.terms ? <Note>{fjc.terms}</Note> : null}
      {courtListener.terms ? <Note>{courtListener.terms}</Note> : null}
    </>
  );
}
