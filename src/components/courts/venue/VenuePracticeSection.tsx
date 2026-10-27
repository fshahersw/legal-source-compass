/**
 * MDL venue practice matrix: motion-practice deadlines and brief page limits in the local rules of the districts
 * holding the most pending MDL actions. Each value is read from the rule and kept only with a word-for-word quote;
 * the data table gives every quote with its page and a link to the rule document. Not legal advice.
 */
import { useQuery } from "@tanstack/react-query";
import { ChartCard } from "@/components/charts/recharts";
import { BenchMatrix } from "@/components/charts/editorial";
import {
  AiSummary,
  AskAiButton,
  DataDrawer,
  KpiCard,
  KpiGrid,
  Section,
  buildSectionContext,
} from "@/components/kit";
import { median } from "@/lib/courts/fcmsHistory";
import {
  PRACTICE_MEASURE,
  PRACTICE_MEASURES,
  practiceMatrix,
  type PracticeMeasure,
} from "@/lib/courts/venuePractice";
import { SOURCES, fmtDate, fmtInt, shortDistrict, venuePracticeQuery } from "./venueQueries";

const TITLE = "Local rules in MDL districts";
const RULES_SOURCE = {
  label: "District court local rules (each rule's document is linked in the data table)",
  url: "https://www.uscourts.gov/about-federal-courts/federal-courts-public/court-website-links",
};

export function VenuePracticeSection() {
  const q = useQuery(venuePracticeQuery);
  const d = q.data;
  const courts = d?.courts ?? [];
  const m = d
    ? practiceMatrix(
        d.rules,
        courts.map((c) => c.courtId),
      )
    : null;
  const val = (c: string, k: PracticeMeasure) => m?.cells[c]?.[k].value ?? null;
  const covered = courts.filter((c) =>
    PRACTICE_MEASURES.some((k) => val(c.courtId, k) !== null),
  ).length;
  const oppMedian = median(courts.map((c) => val(c.courtId, "opposition_days")));
  const several = courts.reduce(
    (a, c) => a + PRACTICE_MEASURES.filter((k) => m?.cells[c.courtId]?.[k].several).length,
    0,
  );
  const status = q.isPending
    ? ({ kind: "loading" } as const)
    : q.isError
      ? ({ kind: "error", onRetry: () => void q.refetch() } as const)
      : !covered
        ? ({
            kind: "empty",
            reason: "No comparable local-rule values are recorded for these districts.",
          } as const)
        : ({ kind: "ready" } as const);
  const row = (k: PracticeMeasure) => ({
    label: PRACTICE_MEASURE[k].label,
    note: PRACTICE_MEASURE[k].unit,
    values: courts.map((c) => val(c.courtId, k)),
    lead: "none" as const,
  });
  const context =
    m && covered
      ? buildSectionContext({
          id: "venue-practice",
          title: TITLE,
          scope: `Local rules of the ${courts.length} districts with the most pending MDL actions`,
          period: d?.jpmlAsOf ? `Rules as read; MDL ranking ${d.jpmlAsOf}` : undefined,
          source: "District court local rules",
          figures: [
            {
              label: "Median opposition deadline across these districts",
              value: oppMedian,
              unit: "days",
            },
            ...courts.flatMap((c) =>
              PRACTICE_MEASURES.map((k) => ({
                label: `${c.name}, ${PRACTICE_MEASURE[k].label.toLowerCase()}`,
                value: val(c.courtId, k),
                unit: PRACTICE_MEASURE[k].unit,
              })),
            ),
          ],
          maxFigures: 24,
        })
      : null;

  return (
    <Section
      id="venue-practice"
      title="Motion practice in MDL districts"
      description="Deadlines and page limits as the local rules state them, for the districts with the most pending MDL actions."
    >
      <KpiGrid columns={4} label="Local rule figures">
        <KpiCard
          as="li"
          label="Districts compared"
          value={d ? String(courts.length) : null}
          meta={d?.jpmlAsOf ? `Most pending MDL actions, JPML ${fmtDate(d.jpmlAsOf)}` : undefined}
          state={q.isPending ? "loading" : undefined}
        />
        <KpiCard
          as="li"
          label="With a comparable rule value"
          value={d ? String(covered) : null}
          meta="General civil motion practice only"
          state={q.isPending ? "loading" : undefined}
        />
        <KpiCard
          as="li"
          label="Median opposition deadline"
          value={oppMedian !== null ? fmtInt(oppMedian) : null}
          unit="days"
          meta="Districts with one stated value"
          state={q.isPending ? "loading" : undefined}
        />
        <KpiCard
          as="li"
          label="Cells with differing rules"
          value={m ? String(several) : null}
          meta="Several rules give different values; see the data"
          state={q.isPending ? "loading" : undefined}
        />
      </KpiGrid>
      <ChartCard
        variant="editorial"
        className="mt-4"
        title={TITLE}
        subtitle="Days and pages as each local rule states them · general civil motions · a dash means not recorded or several differing values"
        status={status}
        sources={[RULES_SOURCE, SOURCES.jpml]}
        about={
          <ul className="list-disc space-y-1 pl-4">
            <li>
              Values were read from each court&apos;s local rules and kept only where a
              word-for-word quote of the rule supports them.
            </li>
            <li>
              A cell is filled only from rules on general civil motion practice; criminal, habeas,
              Social Security, bankruptcy, summary-judgment statements and similar special rules
              never fill a cell.
            </li>
            <li>
              When several rules fit one cell with different values, the cell is left empty; every
              candidate rule is in the data table with its quote, page and link.
            </li>
            <li>
              A judge&apos;s standing order or an MDL case management order can change these limits.
              This is a reading of the rule text, not legal advice.
            </li>
          </ul>
        }
        actions={
          <AskAiButton sectionId="venue-practice" title={TITLE} context={context} size="icon" />
        }
        minHeight={240}
      >
        {m ? (
          <BenchMatrix
            columns={courts.map((c) => ({
              id: c.courtId,
              label: shortDistrict(c.name),
              sub: `${fmtInt(c.pendingActions)} MDL actions`,
            }))}
            groups={[
              { label: "Deadlines", rows: [row("opposition_days"), row("reply_days")] },
              { label: "Page limits", rows: [row("brief_pages"), row("reply_pages")] },
            ]}
            measureLabel="Rule"
            ariaLabel="Local rule deadlines and page limits in the districts with the most pending MDL actions"
          />
        ) : null}
      </ChartCard>
      <div className="mt-3 flex justify-end">
        <DataDrawer
          title="Local rules behind the matrix"
          description="Every rule that fits a cell, with the quoted text, page and rule document."
          rows={m?.matched ?? []}
          rowKey={(r) => r.id}
          searchable
          triggerLabel={`View ${m?.matched.length ?? 0} quoted rules`}
          columns={[
            {
              key: "court",
              label: "District",
              value: (r) => courts.find((c) => c.courtId === r.courtId)?.name ?? r.courtId,
            },
            { key: "measure", label: "Measure", value: (r) => PRACTICE_MEASURE[r.measure].label },
            { key: "value", label: "Value", align: "right", value: (r) => r.number },
            { key: "unit", label: "Unit", value: (r) => r.unit },
            { key: "applies", label: "Applies to", value: (r) => r.appliesTo },
            { key: "quote", label: "Rule text (quoted)", value: (r) => r.quote },
            { key: "page", label: "Page", align: "right", value: (r) => r.page },
            {
              key: "doc",
              label: "Rule document",
              value: (r) => r.docUrl ?? r.sourceUrl,
              render: (r) =>
                r.docUrl || r.sourceUrl ? (
                  <a
                    href={`${(r.docUrl ?? r.sourceUrl)!}${r.page && r.docUrl && /\.pdf$/i.test(r.docUrl) ? `#page=${r.page}` : ""}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary hover:underline"
                  >
                    {r.docTitle ?? r.doc}
                  </a>
                ) : (
                  (r.docTitle ?? r.doc)
                ),
            },
          ]}
          source={{ source: { label: RULES_SOURCE.label } }}
        />
      </div>
      <AiSummary context={context} className="mt-3" />
    </Section>
  );
}
