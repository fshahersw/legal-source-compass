/**
 * Law & government › Rulemaking lead section: what FDA, NHTSA, CPSC, EPA and FTC have open for comment now (and when
 * each period closes), how many final and proposed rules each publishes a year, and how much of their Unified Agenda
 * schedule is past its projected month. Model and rules: src/lib/law/rulemakingTracker.ts.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DatasetSwitch } from "@/components/apiLaw/DatasetSwitch";
import { ChartCard } from "@/components/charts/ChartCard";
import { StackedBarsOverTime } from "@/components/charts/d3/charts";
import { TrendColumns, periodTable, trendTakeaway } from "@/components/charts/recharts";
import {
  AiSummary,
  AskAiButton,
  DataDrawer,
  KpiCard,
  KpiGrid,
  Section,
  buildSectionContext,
} from "@/components/kit";
import {
  DOC_TYPE_LABEL,
  WINDOW_LABEL,
  agencySummaries,
  agendaSummaries,
  editionLabel,
  windowRows,
  type Deadline,
} from "@/lib/law/rulemakingTracker";
import { RuleLifecyclePace } from "./RuleLifecyclePace";
import { rulemakingTrackerQuery } from "./rulemakingQueries";

const REGS = { label: "Regulations.gov (GSA), documents API v4", url: "https://www.regulations.gov/" };
const FR = {
  label: "Federal Register API, agency facets",
  url: "https://www.federalregister.gov/developers/documentation/api/v1",
};
const AGENDA = {
  label: "Unified Agenda of Regulatory and Deregulatory Actions (reginfo.gov)",
  url: "https://www.reginfo.gov/public/do/eAgendaMain",
};
const fmt = (v: number) => v.toLocaleString("en-US");
const ID = "mass-tort-rulemaking";
const TITLE = "Mass-tort agency rulemaking";

export function MassTortRulemaking() {
  const q = useQuery(rulemakingTrackerQuery);
  const [agency, setAgency] = useState("FDA");
  const d = q.data;
  const codes = d ? d.agencies.map((a) => a.code) : [];
  const summaries = d ? agencySummaries(d.deadlines, codes) : [];
  const dated = d ? d.deadlines.filter((r) => r.window !== "open_ended") : [];
  const within30 = dated.filter((r) => r.window === "30").length;
  const proposedOpen = dated.filter((r) => r.type === "proposed_rule").length;
  const openEnded = d ? d.deadlines.length - dated.length : 0;
  const agenda = d ? agendaSummaries(d.agenda, codes, d.today) : [];
  const agendaDated = agenda.reduce((a, r) => a + r.dated, 0);
  const agendaPassed = agenda.reduce((a, r) => a + r.passed, 0);
  const edition = editionLabel(d?.agendaEdition ?? null);
  const fr = d?.fr ?? [];
  const frAsOf = fr.find((f) => f.asOf)?.asOf ?? null;
  const partialYear = fr[0]?.years.find((y) => y.partial)?.year ?? null;
  const proposedThisYear = partialYear
    ? fr.reduce<number | null>((a, f) => {
        const v = f.years.find((y) => y.year === partialYear)?.proposed;
        return v == null || a == null ? null : a + v;
      }, 0)
    : null;
  const finalThisYear = partialYear
    ? fr.reduce<number | null>((a, f) => {
        const v = f.years.find((y) => y.year === partialYear)?.rules;
        return v == null || a == null ? null : a + v;
      }, 0)
    : null;

  const status = q.isPending
    ? ({ kind: "loading" } as const)
    : q.isError
      ? ({ kind: "error", message: "This chart could not be loaded.", onRetry: () => void q.refetch() } as const)
      : ({ kind: "ready" } as const);
  const top = [...summaries].sort((a, b) => b.within30 - a.within30)[0];

  const context = d
    ? buildSectionContext({
        id: ID,
        title: TITLE,
        scope: "FDA, NHTSA, CPSC, EPA and FTC",
        period: `Comment periods open on ${d.today}; Federal Register counts ${fr[0]?.years[0]?.year ?? ""}–${partialYear ?? ""} (${partialYear ?? ""} partial, through ${frAsOf ?? "Not recorded"}); Unified Agenda ${edition ?? "edition not recorded"}`,
        source: [REGS.label, FR.label, AGENDA.label].join("; "),
        figures: [
          { label: "Open comment periods, five agencies", value: dated.length, unit: "documents" },
          { label: "Closing within 30 days", value: within30, unit: "documents" },
          { label: "Open periods with no fixed close date", value: openEnded, unit: "documents" },
          ...summaries.flatMap((s) => [
            { label: `${s.agency} open comment periods`, value: s.open, unit: "documents" },
            { label: `${s.agency} closing within 30 days`, value: s.within30, unit: "documents" },
          ]),
          {
            label: `Final rules published ${partialYear ?? ""} (partial year)`,
            value: finalThisYear,
            unit: "documents",
          },
          {
            label: `Proposed rules published ${partialYear ?? ""} (partial year)`,
            value: proposedThisYear,
            unit: "documents",
          },
          {
            label: "Dated agenda items past their projected month",
            value: agendaPassed,
            unit: `of ${fmt(agendaDated)} dated items`,
          },
        ],
        maxFigures: 20,
      })
    : null;

  const sel = fr.find((f) => f.agency === agency) ?? fr[0];
  const selRows = sel ? sel.years : [];
  const selTitle = sel
    ? (trendTakeaway(
        `${sel.agency} final rules`,
        selRows.map((y) => ({ label: y.year, value: y.rules, partial: y.partial })),
        fmt,
      ) ?? `${sel.agency} final and proposed rules per year`)
    : "Final and proposed rules per year";

  return (
    <Section
      id={ID}
      title={TITLE}
      description="Open comment periods and rule pace at the five agencies whose rules shape product cases."
      actions={
        <AskAiButton
          sectionId={ID}
          title={TITLE}
          context={context}
          questions={[
            "Which open comment periods matter most for drug and device cases?",
            "Which agency has the most comment periods closing this month?",
            "What does a stale agenda schedule tell us about upcoming rules?",
          ]}
        />
      }
    >
      <KpiGrid columns={5} label="Mass-tort rulemaking figures">
        <KpiCard
          as="li"
          label="Open comment periods"
          state={q.isPending ? "loading" : q.isError ? "error" : "ready"}
          value={d ? fmt(dated.length) : null}
          meta={d ? `FDA, NHTSA, CPSC, EPA, FTC · ${d.today}` : undefined}
          footnote={openEnded ? `${fmt(openEnded)} more have no fixed close date` : undefined}
          source={{ source: REGS, asOf: d?.today }}
        />
        <KpiCard
          as="li"
          label="Closing within 30 days"
          state={q.isPending ? "loading" : q.isError ? "error" : "ready"}
          value={d ? fmt(within30) : null}
          meta={top && top.within30 ? `Most at ${top.agency} (${fmt(top.within30)})` : undefined}
          source={{ source: REGS, asOf: d?.today }}
        />
        <KpiCard
          as="li"
          label="Proposed rules open for comment"
          state={q.isPending ? "loading" : q.isError ? "error" : "ready"}
          value={d ? fmt(proposedOpen) : null}
          meta="Five agencies"
          source={{ source: REGS, asOf: d?.today }}
        />
        <KpiCard
          as="li"
          label={`Proposed rules published${partialYear ? ` in ${partialYear}` : ""}`}
          state={q.isPending ? "loading" : q.isError ? "error" : "ready"}
          value={proposedThisYear == null ? null : fmt(proposedThisYear)}
          meta={finalThisYear == null ? undefined : `${fmt(finalThisYear)} final rules`}
          partial={frAsOf ? `Partial year, through ${frAsOf}` : undefined}
          source={{ source: FR, period: partialYear ?? undefined, asOf: frAsOf ?? undefined }}
        />
        <KpiCard
          as="li"
          label="Agenda items past projected month"
          state={q.isPending ? "loading" : q.isError ? "error" : "ready"}
          value={d ? fmt(agendaPassed) : null}
          meta={d ? `of ${fmt(agendaDated)} dated · ${edition ?? "edition not recorded"} edition` : undefined}
          source={{
            source: AGENDA,
            period: edition ? `${edition} edition` : undefined,
            about: "Prerule, proposed and final rule stages. The projected month is as printed in the only edition held; agencies revise it in each new edition.",
          }}
        />
      </KpiGrid>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <ChartCard
          variant="editorial"
          title={
            d
              ? `${fmt(within30)} of ${fmt(dated.length)} open comment periods close within 30 days`
              : "Comment periods closing in the next 90 days"
          }
          subtitle="Documents whose comment period closes in each window, by agency (Eastern time)"
          status={d && !dated.length ? { kind: "empty", reason: "No comment period is open." } : status}
          sources={[REGS]}
          asOf={d?.today}
          about={
            <ul className="list-disc space-y-1 pl-4">
              <li>Rules, proposed rules and notices posted on Regulations.gov whose comment end date is today or later.</li>
              <li>
                End dates more than two years ahead are placeholders some agencies print for open-ended dockets (for
                example 2050-02-21); they are counted as “no fixed close date”, not as open periods.
              </li>
              <li>Comment counts are shown only where they have been read.</li>
            </ul>
          }
          table={
            d
              ? {
                  caption: `Open comment periods by agency, ${d.today}`,
                  columns: [
                    { label: "Agency" },
                    { label: WINDOW_LABEL["30"] },
                    { label: WINDOW_LABEL["60"] },
                    { label: WINDOW_LABEL["90"] },
                    { label: WINDOW_LABEL.later },
                    { label: WINDOW_LABEL.open_ended },
                    { label: "Next close" },
                  ],
                  rows: summaries.map((s) => {
                    const mine = d.deadlines.filter((r) => r.agency === s.agency);
                    const n = (w: Deadline["window"]) => mine.filter((r) => r.window === w).length;
                    return {
                      key: s.agency,
                      cells: [s.agency, n("30"), n("60"), n("90"), n("later"), n("open_ended"), s.nextClose ?? "Not recorded"],
                    };
                  }),
                }
              : undefined
          }
          actions={d ? <DeadlineDrawer rows={d.deadlines} today={d.today} /> : undefined}
        >
          {d && dated.length ? (
            <StackedBarsOverTime rows={windowRows(d.deadlines, codes)} keys={codes} format={fmt} height={240} />
          ) : null}
        </ChartCard>

        <ChartCard
          variant="editorial"
          title={selTitle}
          subtitle={`Final and proposed rules published in the Federal Register per year${partialYear ? ` · ${partialYear} partial` : ""}`}
          status={status}
          sources={[FR]}
          period={selRows.length ? `${selRows[0]!.year}–${selRows.at(-1)!.year}` : undefined}
          asOf={frAsOf ?? undefined}
          partial={partialYear && frAsOf ? `${partialYear} counts run through ${frAsOf}.` : undefined}
          about={
            <p>
              Counts by publication year from the Federal Register API agency facets (document types Rule and Proposed
              Rule). A year the source does not list shows as Not recorded.
            </p>
          }
          table={
            sel
              ? periodTable(
                  selRows,
                  "year",
                  [
                    { key: "rules", label: "Final rules" },
                    { key: "proposed", label: "Proposed rules" },
                  ],
                  fmt,
                  { caption: `${sel.agency} rules per year`, xLabel: "Year", partialKey: "partial" },
                )
              : undefined
          }
        >
          {d ? (
            <>
              <DatasetSwitch
                label="Agency"
                options={codes.map((c) => ({ value: c, label: c }))}
                value={sel?.agency ?? "FDA"}
                onChange={setAgency}
              />
              <TrendColumns
                rows={selRows}
                xKey="year"
                series={[
                  { key: "rules", label: "Final rules" },
                  { key: "proposed", label: "Proposed rules" },
                ]}
                format={fmt}
                partialKey="partial"
                height={210}
                ariaLabel={`${sel?.agency ?? ""} final and proposed rules per year`}
              />
            </>
          ) : null}
        </ChartCard>

        <ChartCard
          variant="editorial"
          className="xl:col-span-2"
          title={
            d && agendaDated
              ? `${fmt(agendaPassed)} of ${fmt(agendaDated)} dated agenda items are past the month the ${edition ?? ""} edition projected`
              : "Unified Agenda items against their projected month"
          }
          subtitle={`Prerule, proposed and final rule stage items, by agency · ${edition ?? "edition not recorded"} edition, the only one held`}
          status={d && !agenda.some((a) => a.active) ? { kind: "empty", reason: "No agenda item is recorded for these agencies." } : status}
          sources={[AGENDA]}
          period={edition ? `${edition} edition` : undefined}
          about={
            <ul className="list-disc space-y-1 pl-4">
              <li>
                Each item&apos;s next action carries a projected month as printed in the {edition ?? "held"} edition. An item
                is past its projected month when that month is before the current month.
              </li>
              <li>
                Only one edition is held, so this shows how far that schedule has slipped, not the agencies&apos; current
                plans. Long-term and completed actions are left out.
              </li>
            </ul>
          }
          table={
            d
              ? {
                  caption: `Unified Agenda items by agency, ${edition ?? ""} edition`,
                  columns: [
                    { label: "Agency" },
                    { label: "Active items" },
                    { label: "Past projected month" },
                    { label: "Projected month ahead" },
                    { label: "No projected month" },
                  ],
                  rows: agenda.map((a) => ({
                    key: a.agency,
                    cells: [a.agency, a.active, a.passed, a.ahead, a.undated],
                  })),
                }
              : undefined
          }
        >
          {d ? (
            <StackedBarsOverTime
              rows={agenda.map((a) => ({
                period: a.agency,
                values: { passed: a.passed, ahead: a.ahead, undated: a.undated },
              }))}
              keys={["passed", "ahead", "undated"]}
              labels={{
                passed: "Past projected month",
                ahead: "Projected month ahead",
                undated: "No projected month",
              }}
              format={fmt}
              height={220}
            />
          ) : null}
        </ChartCard>
      </div>
      <RuleLifecyclePace />
      <AiSummary context={context} className="mt-4" />
    </Section>
  );
}

function DeadlineDrawer({ rows, today }: { rows: Deadline[]; today: string }) {
  return (
    <DataDrawer
      title="Open comment periods"
      description={`FDA, NHTSA, CPSC, EPA and FTC documents on Regulations.gov whose comment period ends ${today} or later, soonest first.`}
      triggerLabel={`View data (${rows.length.toLocaleString("en-US")})`}
      filename="open-comment-periods"
      rows={rows}
      rowKey={(r) => r.id}
      searchable
      searchLabel="Filter by title, agency or docket"
      source={{ source: REGS, asOf: today }}
      columns={[
        { key: "agency", label: "Agency", value: (r) => r.agency },
        { key: "type", label: "Type", value: (r) => DOC_TYPE_LABEL[r.type] },
        {
          key: "title",
          label: "Document",
          value: (r) => r.title,
          render: (r) =>
            r.url ? (
              <a href={r.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                {r.title}
              </a>
            ) : (
              r.title
            ),
        },
        { key: "docket", label: "Docket", value: (r) => r.docket },
        {
          key: "end",
          label: "Comments close",
          value: (r) => (r.window === "open_ended" ? `${r.commentEnd} (no fixed close date)` : r.commentEnd),
        },
        { key: "days", label: "Days left", align: "right", value: (r) => r.daysLeft },
        { key: "comments", label: "Comments posted", align: "right", value: (r) => r.comments },
      ]}
    />
  );
}
