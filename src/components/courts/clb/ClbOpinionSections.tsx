import { SourceLink } from "@/components/enforcement/parts";
import type { ClbCitations, ClbCitedCourt, ClbOpinions } from "@/lib/external/clbCourt.functions";
import {
  CITATION_LINK_DEFINITION,
  CITATION_NOT_QUALITY,
  ageBasisNote,
  ageYearsText,
  authorPctText,
  authorshipNote,
  citedCourtRows,
  fmtInt,
  fmtPct,
  noCourtsText,
  shareOf,
  shownCourtsNote,
  typeRows,
} from "./clbFormat";
import { Fact, RecordLink, ShareBars } from "./ClbParts";

const TH = "px-2 py-1 text-left font-medium first:pl-0 last:pr-0";
const TD = "px-2 py-1 first:pl-0 last:pr-0";
const NUM = "text-right font-mono tabular-nums";

/**
 * Opinion rows of one court (dataset clb_court_profiles, profile.opinions): the type mix, how many carry
 * a recorded author, per curiam and OCR counts, the authors of the most opinions and the parenthetical
 * descriptions that describe the court's opinions. Every share names its denominator.
 */
export function OpinionsOnFileBody({ o }: { o: ClbOpinions }) {
  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3 lg:grid-cols-6">
        <Fact
          label="Opinions on file"
          value={fmtInt(o.total)}
          note="documents; a decision can hold several"
        />
        <Fact
          label="With a recorded author"
          value={authorPctText(o)}
          note={`of ${fmtInt(o.total)} opinions`}
        />
        <Fact
          label="Per curiam"
          value={fmtInt(o.perCuriam)}
          note={`${fmtPct(shareOf(o.perCuriam, o.total))} of opinions`}
        />
        <Fact label="Text read by OCR" value={fmtPct(o.ocrPct)} note="of opinions" />
        <Fact label="With a joined-by list" value={fmtPct(o.withJoinedByPct)} note="of opinions" />
        <Fact
          label="Parenthetical descriptions"
          value={fmtInt(o.parentheticals?.n)}
          note={
            o.parentheticals
              ? `describing opinions in ${fmtInt(o.parentheticals.clusters)} clusters`
              : undefined
          }
        />
      </dl>
      <div className="grid gap-4 md:grid-cols-2">
        <ShareBars
          heading="Opinion types"
          rows={typeRows(o.types)}
          whole={o.total}
          note={`Share of all ${fmtInt(o.total)} opinions on file, as CourtListener labels the type. Each row counts opinion documents, not decisions: a lead opinion, concurrences and dissents can be separate documents of one decision.`}
        />
        <AuthorsList o={o} />
      </div>
      <p className="text-[11px] leading-4 text-muted-foreground">
        Per curiam is CourtListener's flag on the opinion. OCR means the text was read from page
        images, which can introduce errors. A parenthetical description is a short description of an
        opinion that CourtListener extracted from another opinion's text; counts are of
        descriptions, not of citing cases. This is the collection's opinion rows, not every opinion
        the court issued.
      </p>
    </div>
  );
}

function AuthorsList({ o }: { o: ClbOpinions }) {
  return (
    <div className="min-w-0">
      <h4 className="text-xs font-medium">Authors of the most opinions</h4>
      <p className="mb-1.5 text-[11px] leading-4 text-muted-foreground">
        {authorshipNote(o)} A name links to a judge record only where the stored record names
        exactly that CourtListener person id.
      </p>
      {o.topAuthors.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[17rem] text-xs">
            <caption className="sr-only">Authors of the most opinions</caption>
            <thead className="text-muted-foreground">
              <tr className="border-b border-border/60">
                <th scope="col" className={TH}>
                  Judge
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  Opinions authored
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  Share of all opinions
                </th>
              </tr>
            </thead>
            <tbody>
              {o.topAuthors.map((a) => (
                <tr key={a.personId} className="border-t border-border/50">
                  <td className={`${TD} break-words font-medium`}>
                    {a.record ? (
                      <RecordLink dataset="clb_judge_dockets" id={String(a.personId)}>
                        {a.name}
                      </RecordLink>
                    ) : (
                      <SourceLink href={`https://www.courtlistener.com/person/${a.personId}/`}>
                        {a.name}
                      </SourceLink>
                    )}
                  </td>
                  <td className={`${TD} ${NUM}`}>{fmtInt(a.opinions)}</td>
                  <td className={`${TD} ${NUM}`}>{fmtPct(shareOf(a.opinions, o.total))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          No author is listed for this court's opinions.
        </p>
      )}
    </div>
  );
}

/**
 * Citation links of one court (profile.citations): links made and received, the courts on each side,
 * the share of links to the court's own opinions and the age of what it cites. `citingRecord` is set only
 * after an exact id lookup found the court's citing-behaviour record.
 */
export function CitationsBody({
  c,
  courtId,
  citingRecord,
}: {
  c: ClbCitations;
  courtId: string;
  citingRecord: string | null;
}) {
  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3 lg:grid-cols-5">
        <Fact
          label="Citation links made"
          value={fmtInt(c.made)}
          note="from this court's opinions to opinions in a court"
        />
        <Fact
          label="Citation links received"
          value={fmtInt(c.received)}
          note="to this court's opinions, from any court including this one"
        />
        <Fact
          label="Links to its own opinions"
          value={fmtPct(c.selfCitationPct)}
          note={c.made != null ? `of ${fmtInt(c.made)} links made` : undefined}
        />
        <Fact
          label="Median age of cited opinions"
          value={ageYearsText(c.medianAgeYears)}
          note="over links made"
        />
        <Fact
          label="90th percentile age"
          value={ageYearsText(c.p90AgeYears)}
          note="over links made"
        />
      </dl>
      <p className="text-[11px] leading-4 text-muted-foreground">{ageBasisNote(c)}</p>
      <div className="grid gap-4 md:grid-cols-2">
        <CourtShares
          heading="Courts this court's opinions cite"
          rows={c.madeTo}
          whole={c.made}
          side="made"
        />
        <CourtShares
          heading="Courts whose opinions cite this court"
          rows={c.citedBy}
          whole={c.received}
          side="received"
        />
      </div>
      <p className="text-[11px] leading-4 text-muted-foreground">
        {CITATION_LINK_DEFINITION} Counts depend on the opinions the collection holds, so older and
        unpublished opinions are less complete. A court links to its page only where the stored link
        names exactly that court. {CITATION_NOT_QUALITY}
      </p>
      {citingRecord ? (
        <p className="text-xs">
          <RecordLink dataset="clb_court_flows" id={`citing:${courtId}`}>
            Open this court's citing-behaviour record
          </RecordLink>
          <span className="text-muted-foreground">
            {" "}
            · age percentiles, group shares and the courts it cites most
          </span>
        </p>
      ) : null}
    </div>
  );
}

/** One side of the citation links as bars of the stated whole, or a plain statement when it has no rows. */
function CourtShares({
  heading,
  rows,
  whole,
  side,
}: {
  heading: string;
  rows: readonly ClbCitedCourt[];
  whole: number | null;
  side: "made" | "received";
}) {
  if (!rows.length)
    return (
      <div className="min-w-0">
        <h4 className="text-xs font-medium">{heading}</h4>
        <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">{noCourtsText(whole)}</p>
      </div>
    );
  const shown = shownCourtsNote(rows, whole);
  const what =
    side === "made" ? `links made` : `links received, including this court's own opinions`;
  return (
    <ShareBars
      heading={heading}
      rows={citedCourtRows(rows)}
      whole={whole ?? undefined}
      note={
        whole != null
          ? `Share of the ${fmtInt(whole)} ${what}${shown ? `; ${shown}` : ""}.`
          : undefined
      }
    />
  );
}
