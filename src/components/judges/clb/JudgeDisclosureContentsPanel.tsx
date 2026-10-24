import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { ChartFrame } from "@/components/charts/ChartFrame";
import { Heatmap } from "@/components/charts/Heatmap";
import { metricFormatter } from "@/components/charts/format";
import { HowToRead } from "@/components/analysis/HowToRead";
import { CollapsibleSection } from "@/components/courts/clb/ClbParts";
import {
  MiniTable,
  PanelError,
  PanelLoading,
  PanelShell,
} from "@/components/courts/clb/ClbRestParts";
import { fmtInt, NOT_RECORDED } from "@/components/courts/clb/clbFormat";
import { SourceLink } from "@/components/enforcement/parts";
import { JUDGE_ID } from "@/lib/external/judgeCourtListener.functions";
import { getClbDisclosureItems } from "./judgePeople.functions";
import {
  codeRange,
  SECTION_KEYS,
  SECTION_LABEL,
  usedCodes,
  type DebtItem,
  type DisclosureItems,
  type IncomeItem,
  type ItemsYear,
  type OutsidePosition,
} from "./judgePeople";

const FD_URL =
  "https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/financial-disclosure-investments-2026-09-30.csv.bz2";
const REDACTED = "Redacted in the report";
const yearText = (y: number | null) => (y == null ? NOT_RECORDED : String(y));
const asFiled = (s: string | null) => s ?? NOT_RECORDED;

/**
 * What a judge's financial disclosure reports in CourtListener contain, by report year (dataset
 * clb_judge_disclosure_items): investment lines by the printed gross value code, report types, debts by value code, and
 * outside positions, non-investment income, spousal income and debts as filed. Codes stay codes (each is a range on the
 * form); nothing is summed or converted. Renders nothing when the page is not linked or the person has no report.
 */
export function JudgeDisclosureContentsPanel({ judgeId }: { judgeId: string }) {
  const enabled = JUDGE_ID.test(judgeId);
  const q = useQuery({
    queryKey: ["clb-disclosure-items", judgeId],
    queryFn: () => getClbDisclosureItems({ data: { id: judgeId } }),
    staleTime: 10 * 60 * 1000,
    enabled,
  });
  if (!enabled) return null;
  if (q.isLoading) return <PanelLoading label="Loading disclosure report contents" height="h-32" />;
  if (q.isError)
    return (
      <PanelError
        text="Disclosure report contents could not be loaded."
        onRetry={() => void q.refetch()}
      />
    );
  if (!q.data) return null;
  return <Body d={q.data.data} />;
}

function Body({ d }: { d: DisclosureItems }) {
  const span =
    d.years.length > 0
      ? d.years[0]!.year === d.years[d.years.length - 1]!.year
        ? String(d.years[0]!.year)
        : `${d.years[0]!.year}–${d.years[d.years.length - 1]!.year}`
      : null;
  return (
    <PanelShell
      title="What the disclosure reports contain"
      subtitle={
        <>
          As filed and extracted by CourtListener · {fmtInt(d.reports)} report
          {d.reports === 1 ? "" : "s"}
          {span ? `, ${span}` : ""} · value ranges shown as the printed form codes
        </>
      }
      record={{ dataset: "clb_judge_disclosure_items", id: String(d.personId) }}
      aside={
        <SourceLink href="https://www.courtlistener.com/financial-disclosures/">
          Source financial disclosures
        </SourceLink>
      }
    >
      {d.years.some((y) => y.items.investments > 0) ? (
        <div className="px-3 pb-3">
          <ValueMatrix d={d} />
        </div>
      ) : (
        <p className="px-3 pb-3 text-xs text-muted-foreground">
          No investment line is recorded on this person's reports.
        </p>
      )}
      <CollapsibleSection
        title="Reports and sections by year"
        summary={`${d.years.length} report year${d.years.length === 1 ? "" : "s"}`}
      >
        <MiniTable<ItemsYear>
          caption="Report types and line items per section, by report year"
          rows={[...d.years].reverse()}
          rowKey={(y) => String(y.year)}
          limit={8}
          noun="years"
          columns={[
            { key: "y", label: "Year", render: (y) => String(y.year) },
            {
              key: "t",
              label: "Report types",
              render: (y) =>
                y.reportTypes.map((t) => `${t.label}${t.n > 1 ? ` ×${t.n}` : ""}`).join(", ") ||
                NOT_RECORDED,
            },
            ...SECTION_KEYS.filter((k) => d.totals[k] > 0).map((k) => ({
              key: k,
              label: SECTION_LABEL[k],
              numeric: true,
              render: (y: ItemsYear) => fmtInt(y.items[k]),
            })),
            {
              key: "x",
              label: "Transactions",
              numeric: true,
              render: (y) => fmtInt(y.transactions),
            },
          ]}
          note="Counts include every report CourtListener attributes to this person. Transactions are investment lines that record a purchase, sale or other transaction in the year."
        />
      </CollapsibleSection>
      {d.conflict ? (
        <p
          role="note"
          className="mx-3 my-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs leading-5"
        >
          Source attributes to this person reports filed under more than one circuit code.
 They may belong to more than one judge, so no items are listed; the counts above include
 every attributed report.
        </p>
      ) : (
        <ListedItems d={d} />
      )}
      <div className="px-3 pb-3 pt-2">
        <HowToRead
          measures={[
            {
              term: "Value code",
              means:
                "the letter code printed on the report for a value range; for example J is 1 - 15,000 dollars and K is 15,001 - 50,000 dollars (the form's ranges, from CourtListener's legend).",
              caveat:
                "A code is a range, not an amount. Codes are counted, never added up or averaged.",
            },
            {
              term: "No code",
              means:
                "the investment line carries no gross value code (for example a line that records only a transaction).",
            },
            {
              term: "Failed extraction",
              means:
                "CourtListener could not read the code from the scanned report (stored as -1).",
            },
            {
              term: "Listed items",
              means:
                "shown only from reports whose original file name carries this person's surname.",
              caveat:
                "Text is as CourtListener extracted it from scanned forms and can contain reading errors.",
            },
          ]}
        />
      </div>
    </PanelShell>
  );
}

function ValueMatrix({ d }: { d: DisclosureItems }) {
  const years = useMemo(() => d.years.filter((y) => y.items.investments > 0), [d.years]);
  const codes = useMemo(() => usedCodes(years, (y) => y.grossValue), [years]);
  const lookup = useMemo(() => {
    const m = new Map<string, number>();
    for (const y of years) for (const c of y.grossValue) m.set(`${y.year}|${c.code}`, c.n);
    return m;
  }, [years]);
  const fmt = metricFormatter("count");
  return (
    <ChartFrame
      title="Investment lines on this judge's reports, by printed gross value code and report year"
      unit="investment lines"
      period={years.length ? `${years[0]!.year}–${years[years.length - 1]!.year}` : undefined}
      headingLevel="h3"
      sources={[
        {
          label: "CourtListener bulk data: financial-disclosure investments (Sept 30, 2026)",
          url: FD_URL,
        },
      ]}
      status={
        codes.length
          ? { kind: "ready" }
          : { kind: "empty", reason: "No investment line carries a code." }
      }
      notes={[
        "Each cell counts the investment lines of that year's reports carrying that printed gross value code (the value at the end of the reporting period).",
        "Columns run from the lowest range (J) to the highest (P4); codes that never occur are left out.",
      ]}
      table={{
        caption: "Investment lines by gross value code and report year",
        columns: [
          { label: "Year" },
          ...codes.map((c) => ({ label: c, align: "right" as const })),
          { label: "All lines", align: "right" },
        ],
        rows: years.map((y) => ({
          key: String(y.year),
          cells: [
            String(y.year),
            ...codes.map((c) => fmtInt(lookup.get(`${y.year}|${c}`) ?? 0)),
            fmtInt(y.items.investments),
          ],
        })),
      }}
      footnotes={[
        ...gapYears(years.map((y) => y.year)),
        `Codes: ${codes.map((c) => `${c} = ${codeRange(c)}${["none", "-1", "other"].includes(c) ? "" : " dollars"}`).join("; ")}.`,
      ]}
    >
      <Heatmap
        rows={years.map((y) => ({ id: String(y.year), label: String(y.year) }))}
        columns={codes.map((c) => ({ id: c, label: c }))}
        value={(r, c) => lookup.get(`${r}|${c}`) ?? 0}
        formatter={fmt}
        ariaLabel="Investment lines by printed gross value code and report year"
        cellLabels
        cellNote={(_r, c) =>
          `${c} = ${codeRange(c)}${c === "none" || c === "-1" || c === "other" ? "" : " dollars"}`
        }
      />
    </ChartFrame>
  );
}

/** Years inside the shown span that have no investment line on any report, named so a missing row is not read as zero. */
function gapYears(years: readonly number[]): string[] {
  if (years.length < 2) return [];
  const have = new Set(years);
  const gaps: number[] = [];
  for (let y = years[0]!; y <= years[years.length - 1]!; y++) if (!have.has(y)) gaps.push(y);
  return gaps.length
    ? [
        `No investment line is recorded for ${gaps.join(", ")}; ${gaps.length === 1 ? "that year is" : "those years are"} not shown.`,
      ]
    : [];
}

function ListedItems({ d }: { d: DisclosureItems }) {
  const l = d.listed;
  const any =
    l.outsidePositions.length +
    l.nonInvestmentIncome.length +
    l.spousalIncome.length +
    l.debts.length;
  if (!any) return null;
  const capNote = (shown: number, total: number) =>
    total > shown
      ? `The ${fmtInt(shown)} most recent of ${fmtInt(total)} are listed; the full record has the count.`
      : undefined;
  return (
    <CollapsibleSection
      title="Outside positions, income and debts as filed"
      summary={`${fmtInt(any)} items listed`}
    >
      <div className="space-y-4">
        <MiniTable<OutsidePosition>
          caption="Outside positions"
          rows={l.outsidePositions}
          rowKey={(r) => r.key}
          noun="positions"
          columns={[
            { key: "y", label: "Year", render: (r) => yearText(r.year) },
            {
              key: "p",
              label: "Position",
              render: (r) => (r.redacted ? REDACTED : asFiled(r.position)),
            },
            {
              key: "o",
              label: "Organization",
              render: (r) => (r.redacted ? "" : asFiled(r.organization)),
            },
          ]}
          note={capNote(l.outsidePositions.length, d.listedTotal.outsidePositions)}
        />
        <MiniTable<IncomeItem>
          caption="Non-investment income"
          rows={l.nonInvestmentIncome}
          rowKey={(r) => r.key}
          noun="entries"
          columns={[
            { key: "y", label: "Year", render: (r) => yearText(r.year) },
            {
              key: "s",
              label: "Source and type, as filed",
              render: (r) => (r.redacted ? REDACTED : asFiled(r.source)),
            },
            {
              key: "a",
              label: "Amount, as filed",
              render: (r) => (r.redacted ? "" : asFiled(r.amount)),
            },
          ]}
          note={capNote(l.nonInvestmentIncome.length, d.listedTotal.nonInvestmentIncome)}
        />
        <MiniTable<IncomeItem>
          caption="Spousal income (source and type, as filed)"
          rows={l.spousalIncome}
          rowKey={(r) => r.key}
          noun="entries"
          columns={[
            { key: "y", label: "Year", render: (r) => yearText(r.year) },
            {
              key: "s",
              label: "Source and type, as filed",
              render: (r) => (r.redacted ? REDACTED : asFiled(r.source)),
            },
          ]}
          note={capNote(l.spousalIncome.length, d.listedTotal.spousalIncome)}
        />
        <MiniTable<DebtItem>
          caption="Debts"
          rows={l.debts}
          rowKey={(r) => r.key}
          noun="debts"
          columns={[
            { key: "y", label: "Year", render: (r) => yearText(r.year) },
            {
              key: "c",
              label: "Creditor, as filed",
              render: (r) => (r.redacted ? REDACTED : asFiled(r.creditor)),
            },
            {
              key: "d",
              label: "Description, as filed",
              render: (r) => (r.redacted ? "" : asFiled(r.description)),
            },
            {
              key: "v",
              label: "Value code",
              render: (r) => (r.code ? `${r.code} (${codeRange(r.code)})` : NOT_RECORDED),
            },
          ]}
          note={capNote(l.debts.length, d.listedTotal.debts)}
        />
      </div>
    </CollapsibleSection>
  );
}
