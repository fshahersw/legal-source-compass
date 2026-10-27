import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { HowToRead } from "@/components/analysis/HowToRead";
import { Kpi, SourceLink } from "@/components/enforcement/parts";
import { CollapsibleSection } from "@/components/courts/clb/ClbParts";
import {
  MiniTable,
  PanelError,
  PanelLoading,
  PanelShell,
  PersonName,
} from "@/components/courts/clb/ClbRestParts";
import { fmtInt, NOT_RECORDED } from "@/components/courts/clb/clbFormat";
import { JUDGE_ID } from "@/lib/external/judgeCourtListener.functions";
import { JudgeDisclosureItemsCard } from "../JudgeTrendCards";
import {
  getClbJudgeDisclosures,
  SECTIONS,
  type Agreement,
  type DisclosureYear,
  type Gift,
  type JudgeDisclosures,
  type Reimbursement,
  type ReportRow,
} from "@/lib/external/clbJudgeDisclosures.functions";

const REDACTED = "Redacted in the report";
const asFiled = (s: string | null) => s ?? NOT_RECORDED;

/** A line the filer partly redacted: the marker first, then the text the source read around the redaction (muted, as it
 * is often unreadable scan noise). Fields with no remaining text show only the marker or nothing. */
function Redacted({ text, marker }: { text: string | null; marker: boolean }) {
  if (!text)
    return marker ? <span className="italic text-muted-foreground">{REDACTED}</span> : null;
  return (
    <span>
      {marker ? <span className="block italic text-muted-foreground">{REDACTED}</span> : null}
      <span
        className="block text-muted-foreground"
        title="Text the source extracted around the redaction; it may be unreadable"
      >
        {text}
      </span>
    </span>
  );
}

/** The item's year, with a tag when its report's file name could not be read (no surname check made). */
function ItemYear({ year, attribution }: { year: number | null; attribution: string }) {
  return (
    <span>
      {year == null ? NOT_RECORDED : String(year)}
      {attribution === "not_checked" ? (
        <span
          className="ml-1 whitespace-nowrap rounded border border-border px-1 text-[10px] text-muted-foreground"
          title="The report's original file name could not be read, so the surname check could not be made. Listed on the source's own link of the report to this person."
        >
          attribution not checked
        </span>
      ) : null}
    </span>
  );
}

/**
 * A judge's financial disclosure reports in CourtListener (dataset clb_judge_disclosures), reached through the judge
 * crosswalk. Renders nothing when the page is not linked to exactly one CourtListener person or that person has no report.
 */
export function JudgeDisclosuresPanel({ judgeId }: { judgeId: string }) {
  const enabled = JUDGE_ID.test(judgeId);
  const q = useQuery({
    queryKey: ["clb-judge-disclosures", judgeId],
    queryFn: () => getClbJudgeDisclosures({ data: { id: judgeId } }),
    staleTime: 10 * 60 * 1000,
    enabled,
  });
  if (!enabled) return null;
  if (q.isLoading)
    return <PanelLoading label="Loading financial disclosure reports" height="h-28" />;
  if (q.isError)
    return (
      <PanelError
        text="Financial disclosure reports could not be loaded."
        onRetry={() => void q.refetch()}
      />
    );
  if (!q.data) return null;
  return <Body d={q.data} />;
}

function Body({ d }: { d: JudgeDisclosures }) {
  const conflict = d.attribution.status === "conflict";
  const span =
    d.firstYear && d.lastYear
      ? d.firstYear === d.lastYear
        ? String(d.firstYear)
        : `${d.firstYear}–${d.lastYear}`
      : null;
  const sum = (w: { gifts: number; reimbursements: number; agreements: number }) =>
    w.gifts + w.reimbursements + w.agreements;
  const withheld = sum(d.itemsWithheld);
  const byReason = d.itemsWithheldByReason;
  const listedInConflict = conflict && d.reportList.some((r) => r.conflictHold === false);
  const listedCount = d.gifts.length + d.reimbursements.length + d.agreements.length;
  return (
    <PanelShell
      title="Financial disclosure reports"
      subtitle={
        <>
          As filed and extracted by the source ·{" "}
          {d.reports === 1 ? "1 report" : `${fmtInt(d.reports)} reports`}
          {span ? `, ${span}` : ""}
        </>
      }
      record={{ dataset: "clb_judge_disclosures", id: String(d.personId) }}
      aside={
        <SourceLink href={`https://www.courtlistener.com/person/${d.personId}/`}>
          Source person page
        </SourceLink>
      }
    >
      {conflict ? (
        <p
          role="note"
          className="mx-3 mb-2 flex gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs leading-5"
        >
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning-foreground" aria-hidden />
          <span>
            The source attributes to this person reports filed under more than one circuit code (
            {d.attribution.circuits.map((c) => `${c.code}: ${c.reports}`).join(", ")}) and more than
            one district.{" "}
            {listedInConflict
              ? "Gifts, reimbursements and agreements are listed only from the reports coded for the district of this judge's recorded court; the other reports may belong to another judge and are not listed."
              : "They may belong to more than one judge, so no gifts, reimbursements or agreements are listed here."}{" "}
            The counts below include every attributed report.
          </span>
        </p>
      ) : null}
      {d.lastYear !== null && d.lastYear <= 2020 ? (
        <p role="note" className="mx-3 mb-2 text-xs leading-5 text-muted-foreground">
          <span className="font-medium text-foreground">
            No reports after {d.lastYear} in this corpus.
          </span>{" "}
          Disclosure coverage ends in 2020, so current holdings are not shown and an empty list is
          not a finding of no conflict.
        </p>
      ) : null}
      <div className="grid grid-cols-2 gap-2 px-3 pb-2 md:grid-cols-5">
        <Kpi
          label="Reports on file"
          value={fmtInt(d.reports)}
          note={d.amended ? `${fmtInt(d.amended)} amended` : undefined}
        />
        <Kpi
          label="Investments listed"
          value={fmtInt(d.itemsTotal.investments)}
          note="all reports, counted only"
        />
        <Kpi label="Gifts listed" value={fmtInt(d.itemsTotal.gifts)} />
        <Kpi label="Reimbursements listed" value={fmtInt(d.itemsTotal.reimbursements)} />
        <Kpi label="Agreements listed" value={fmtInt(d.itemsTotal.agreements)} />
      </div>
      {d.years.length ? (
        <CollapsibleSection
          title="By report year"
          summary={`${d.years.length} year${d.years.length === 1 ? "" : "s"}`}
          defaultOpen={!conflict}
        >
          {!conflict && d.years.length > 1 ? (
            <div className="mb-3 max-w-xl">
              <JudgeDisclosureItemsCard personId={d.personId} years={d.years} />
            </div>
          ) : null}
          <MiniTable<DisclosureYear>
            caption="Reports and listed items by report year"
            rows={[...d.years].reverse()}
            rowKey={(y) => String(y.year)}
            limit={8}
            noun="years"
            columns={[
              { key: "y", label: "Year", render: (y) => String(y.year) },
              {
                key: "r",
                label: "Reports",
                numeric: true,
                render: (y) => fmtInt(y.reports) + (y.amended ? ` (${y.amended} am.)` : ""),
              },
              ...SECTIONS.slice(0, 5).map(([k, label]) => ({
                key: k,
                label,
                numeric: true,
                render: (y: DisclosureYear) => fmtInt(y.items[k]),
              })),
            ]}
            note={`Debts ${fmtInt(d.itemsTotal.debts)}, non-investment income ${fmtInt(d.itemsTotal.non_investment_income)} and spousal income ${fmtInt(d.itemsTotal.spousal_income)} lines are counted across all reports, not listed.`}
          />
        </CollapsibleSection>
      ) : null}
      {listedCount ? (
        <CollapsibleSection
          title="Gifts, reimbursements and agreements as filed"
          summary={`${fmtInt(listedCount)} items listed`}
        >
          <div className="space-y-4">
            <MiniTable<Gift>
              caption="Gifts"
              rows={d.gifts}
              rowKey={(g, i) => `${i}-${g.reportId}-${g.source}-${g.description}`}
              columns={[
                {
                  key: "y",
                  label: "Year",
                  render: (g) => <ItemYear year={g.year} attribution={g.attribution} />,
                },
                {
                  key: "s",
                  label: "Source",
                  render: (g) =>
                    g.redacted ? <Redacted text={g.source} marker /> : asFiled(g.source),
                },
                {
                  key: "d",
                  label: "Description",
                  render: (g) =>
                    g.redacted ? (
                      <Redacted text={g.description} marker={false} />
                    ) : (
                      asFiled(g.description)
                    ),
                },
                {
                  key: "v",
                  label: "Value as filed",
                  render: (g) =>
                    g.redacted ? (
                      <Redacted text={g.valueAsFiled} marker={false} />
                    ) : (
                      asFiled(g.valueAsFiled)
                    ),
                },
              ]}
            />
            <MiniTable<Reimbursement>
              caption="Reimbursements"
              rows={d.reimbursements}
              rowKey={(r, i) => `${i}-${r.reportId}-${r.source}-${r.datesAsFiled}`}
              noun="reimbursements"
              columns={[
                {
                  key: "y",
                  label: "Year",
                  render: (r) => <ItemYear year={r.year} attribution={r.attribution} />,
                },
                {
                  key: "s",
                  label: "Source",
                  render: (r) =>
                    r.redacted ? <Redacted text={r.source} marker /> : asFiled(r.source),
                },
                {
                  key: "p",
                  label: "Purpose",
                  render: (r) =>
                    r.redacted ? <Redacted text={r.purpose} marker={false} /> : asFiled(r.purpose),
                },
                {
                  key: "l",
                  label: "Location",
                  render: (r) =>
                    r.redacted ? (
                      <Redacted text={r.location} marker={false} />
                    ) : (
                      asFiled(r.location)
                    ),
                },
                {
                  key: "i",
                  label: "Paid or provided",
                  render: (r) =>
                    r.redacted ? (
                      <Redacted text={r.itemsPaid} marker={false} />
                    ) : (
                      asFiled(r.itemsPaid)
                    ),
                },
              ]}
            />
            <MiniTable<Agreement>
              caption="Agreements"
              rows={d.agreements}
              rowKey={(a, i) => `${i}-${a.reportId}-${a.dateAsFiled}`}
              columns={[
                {
                  key: "y",
                  label: "Year",
                  render: (a) => <ItemYear year={a.year} attribution={a.attribution} />,
                },
                {
                  key: "d",
                  label: "Date as filed",
                  render: (a) =>
                    a.redacted ? <Redacted text={a.dateAsFiled} marker /> : asFiled(a.dateAsFiled),
                },
                {
                  key: "t",
                  label: "Parties and terms",
                  render: (a) =>
                    a.redacted ? (
                      <Redacted text={a.partiesAndTerms} marker={false} />
                    ) : (
                      asFiled(a.partiesAndTerms)
                    ),
                },
              ]}
            />
            <p className="text-[11px] leading-4 text-muted-foreground">
              Text is the source's extraction from scanned forms and can contain reading errors;
              values are the report's own codes or words. A redacted line shows the text the source
              read around the redaction, which can be unreadable.
              {byReason && sum(byReason.otherSurname)
                ? ` ${fmtInt(sum(byReason.otherSurname))} items from reports whose file name carries another surname are not listed.`
                : ""}
              {byReason && sum(byReason.attributionConflict)
                ? ` ${fmtInt(sum(byReason.attributionConflict))} items from reports that may belong to another judge are not listed.`
                : ""}
              {!byReason && withheld
                ? ` ${fmtInt(withheld)} items from reports whose file name does not carry this surname are not listed.`
                : ""}
            </p>
          </div>
        </CollapsibleSection>
      ) : null}
      <CollapsibleSection
        title="Reports"
        summary={`${fmtInt(d.reportList.filter((r) => r.pdf).length)} with the copy linked`}
      >
        <MiniTable<ReportRow>
          caption="Each report attributes to this person"
          rows={d.reportList}
          rowKey={(r) => String(r.id)}
          limit={6}
          noun="reports"
          columns={[
            {
              key: "y",
              label: "Year",
              render: (r) =>
                (r.year == null ? NOT_RECORDED : String(r.year)) + (r.amended ? " (amended)" : ""),
            },
            { key: "p", label: "Pages", numeric: true, render: (r) => fmtInt(r.pages) },
            { key: "c", label: "Filer code in file name", render: (r) => r.filerCode ?? "—" },
            {
              key: "f",
              label: "File-name check",
              render: (r) =>
                r.fileCheck === "match"
                  ? "Carries this surname"
                  : r.fileCheck === "mismatch"
                    ? "Carries another name"
                    : "Not readable",
            },
            {
              key: "l",
              label: "Report",
              render: (r) => (r.pdf ? <SourceLink href={r.pdf}>PDF</SourceLink> : "—"),
            },
          ]}
        />
      </CollapsibleSection>
      <div className="px-3 pb-3">
        <HowToRead
          measures={[
            {
              term: "Report",
              means: "A financial disclosure report the source holds and links to this person.",
              caveat: "Report years 1987–2022 in this snapshot; not every report a judge filed.",
            },
            {
              term: "Listed items",
              means: "Rows in each section of the report, one per item, whatever its value.",
            },
            {
              term: "File-name check",
              means:
                "The report's original file name must carry this person's surname (exact letters, no similarity scoring) before its items are listed.",
              caveat:
                "When the reports name more than one district, only reports coded for the district of the judge's recorded court are listed; if that cannot be settled, none are. Items of a report whose file name cannot be read are listed and tagged 'attribution not checked'.",
            },
          ]}
        />
        {d.statsRecord ? (
          <p className="mt-2 text-[11px] text-muted-foreground">
            Docket and opinion activity:{" "}
            <PersonName name={d.name} personId={d.personId} statsRecord={d.statsRecord} />
          </p>
        ) : null}
      </div>
    </PanelShell>
  );
}
