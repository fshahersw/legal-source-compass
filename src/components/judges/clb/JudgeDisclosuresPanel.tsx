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
  const withheld =
    d.itemsWithheld.gifts + d.itemsWithheld.reimbursements + d.itemsWithheld.agreements;
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
            the source attributes to this person reports filed under more than one circuit code (
            {d.attribution.circuits.map((c) => `${c.code}: ${c.reports}`).join(", ")}). They may
            belong to more than one judge, so no gifts, reimbursements or agreements are listed
            here; the counts below include every attributed report.
          </span>
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
      {!conflict && (d.gifts.length || d.reimbursements.length || d.agreements.length) ? (
        <CollapsibleSection
          title="Gifts, reimbursements and agreements as filed"
          summary={`${fmtInt(d.gifts.length + d.reimbursements.length + d.agreements.length)} items listed`}
        >
          <div className="space-y-4">
            <MiniTable<Gift>
              caption="Gifts"
              rows={d.gifts}
              rowKey={(g) => `${g.reportId}-${g.source}-${g.description}-${g.valueAsFiled}`}
              columns={[
                {
                  key: "y",
                  label: "Year",
                  render: (g) => (g.year == null ? NOT_RECORDED : String(g.year)),
                },
                {
                  key: "s",
                  label: "Source",
                  render: (g) => (g.redacted ? REDACTED : asFiled(g.source)),
                },
                {
                  key: "d",
                  label: "Description",
                  render: (g) => (g.redacted ? "" : asFiled(g.description)),
                },
                {
                  key: "v",
                  label: "Value as filed",
                  render: (g) => (g.redacted ? "" : asFiled(g.valueAsFiled)),
                },
              ]}
            />
            <MiniTable<Reimbursement>
              caption="Reimbursements"
              rows={d.reimbursements}
              rowKey={(r) =>
                `${r.reportId}-${r.source}-${r.datesAsFiled}-${r.location}-${r.purpose}`
              }
              noun="reimbursements"
              columns={[
                {
                  key: "y",
                  label: "Year",
                  render: (r) => (r.year == null ? NOT_RECORDED : String(r.year)),
                },
                {
                  key: "s",
                  label: "Source",
                  render: (r) => (r.redacted ? REDACTED : asFiled(r.source)),
                },
                {
                  key: "p",
                  label: "Purpose",
                  render: (r) => (r.redacted ? "" : asFiled(r.purpose)),
                },
                {
                  key: "l",
                  label: "Location",
                  render: (r) => (r.redacted ? "" : asFiled(r.location)),
                },
                {
                  key: "i",
                  label: "Paid or provided",
                  render: (r) => (r.redacted ? "" : asFiled(r.itemsPaid)),
                },
              ]}
            />
            <MiniTable<Agreement>
              caption="Agreements"
              rows={d.agreements}
              rowKey={(a) => `${a.reportId}-${a.dateAsFiled}-${a.partiesAndTerms}`}
              columns={[
                {
                  key: "y",
                  label: "Year",
                  render: (a) => (a.year == null ? NOT_RECORDED : String(a.year)),
                },
                {
                  key: "d",
                  label: "Date as filed",
                  render: (a) => (a.redacted ? REDACTED : asFiled(a.dateAsFiled)),
                },
                {
                  key: "t",
                  label: "Parties and terms",
                  render: (a) => (a.redacted ? "" : asFiled(a.partiesAndTerms)),
                },
              ]}
            />
            <p className="text-[11px] leading-4 text-muted-foreground">
              Text is the source's extraction from scanned forms and can contain reading errors;
              values are the report's own codes or words.
              {withheld
                ? ` ${fmtInt(withheld)} items from reports whose file name does not carry this surname, or could not be read, are not listed.`
                : ""}
              {d.itemsTotal.reimbursements >
              d.reimbursements.length + d.itemsWithheld.reimbursements
                ? ` Only the ${fmtInt(d.reimbursements.length)} most recent reimbursements are listed.`
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
                "A person whose reports carry two numbered circuits may combine two judges; their items are not listed.",
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
