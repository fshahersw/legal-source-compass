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
  anchorNote,
  practiceMatrix,
  practiceRows,
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
  const rows = m ? practiceRows(m) : [];
  const covered = courts.filter((c, i) => rows.some((r) => r.values[i] !== null)).length;
  // Deadlines are pooled only when they count from the same start point; service is the most common one.
  const fromService = courts.flatMap((c) => {
    const cell = m?.cells[c.courtId]?.opposition_days;
    return cell?.value != null && cell.anchor === "after_service" ? [cell.value] : [];
  });
  const oppMedian = median(fromService);
  const splitCells = courts.reduce(
    (a, c) => a + PRACTICE_MEASURES.filter((k) => m?.cells[c.courtId]?.[k].split).length,
    0,
  );
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
  const benchRow = (r: (typeof rows)[number]) => ({
    label: PRACTICE_MEASURE[r.measure].label,
    note: r.anchor ? anchorNote(r.measure, r.anchor) : PRACTICE_MEASURE[r.measure].unit,
    values: r.values,
    lead: "none" as const,
  });
  const deadlineRows = rows.filter((r) => r.anchor !== null).map(benchRow);
  const pageRows = rows.filter((r) => r.anchor === null).map(benchRow);
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
              label: `Median opposition deadline among the ${fromService.length} districts that count it from service of the motion`,
              value: oppMedian,
              unit: "days after service",
            },
            {
              label: "Cells where the district splits the rule by motion type",
              value: splitCells,
            },
            ...courts.flatMap((c) =>
              PRACTICE_MEASURES.map((k) => {
                const cell = m.cells[c.courtId]![k];
                return {
                  label: `${c.name}, ${PRACTICE_MEASURE[k].label.toLowerCase()}`,
                  value:
                    cell.value !== null
                      ? cell.value
                      : cell.split
                        ? "differs by motion type"
                        : cell.several
                          ? "several differing rules"
                          : null,
                  unit:
                    cell.value !== null
                      ? cell.anchor
                        ? anchorNote(k, cell.anchor)
                        : PRACTICE_MEASURE[k].unit
                      : undefined,
                };
              }),
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
          unit="days after service"
          meta={
            d
              ? `${fromService.length} of ${courts.length} districts count from service; other start points are not pooled`
              : undefined
          }
          state={q.isPending ? "loading" : undefined}
        />
        <KpiCard
          as="li"
          label="Cells with differing rules"
          value={m ? String(several) : null}
          meta={`Several rules differ, or the rule is split by motion type (${splitCells})`}
          state={q.isPending ? "loading" : undefined}
        />
      </KpiGrid>
      <ChartCard
        variant="editorial"
        className="mt-4"
        title={TITLE}
        subtitle="Days and pages as each local rule states them · deadlines compared only within the same start point · a dash means not recorded, several differing values or a rule split by motion type"
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
              A deadline is compared only with deadlines counted from the same start point (service
              of the motion, its filing, a due date, or before the motion day). The median counts
              only districts that run the deadline from service.
            </li>
            <li>
              Limits stated as a preference (&ldquo;prefers&rdquo;, &ldquo;should&rdquo;) are left
              out. Clauses that only list exceptions (&ldquo;other than summary judgment&rdquo;) do
              not exclude a general rule.
            </li>
            <li>
              When several rules fit one cell with different values, or the district states the
              rule separately for each motion type (for example dispositive and nondispositive
              motions), the cell is left empty; every rule is in the data table with its quote,
              page and link.
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
              { label: "Deadlines", rows: deadlineRows },
              { label: "Page limits", rows: pageRows },
            ]}
            measureLabel="Rule"
            ariaLabel="Local rule deadlines and page limits in the districts with the most pending MDL actions"
          />
        ) : null}
      </ChartCard>
      <div className="mt-3 flex justify-end">
        <DataDrawer
          title="Local rules behind the matrix"
          description="Every rule that fits a cell or splits it by motion type, with the quoted text, page and rule document."
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
            { key: "reads", label: "Reads as", value: (r) => r.reading },
            { key: "value", label: "Value", align: "right", value: (r) => r.number },
            { key: "unit", label: "Unit", value: (r) => r.unit },
            {
              key: "branch",
              label: "Motion type",
              value: (r) => r.branch ?? "General rule",
            },
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
