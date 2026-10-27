/**
 * Product profile: litigation-stimulated reporting. Reports in the 12 months before and after each linked MDL was
 * centralized (JPML transfer date), the monthly trend with the transfer marked, and the share of FAERS reports a lawyer
 * submitted, so a reader can tell an organic safety signal from reporting the litigation itself prompted.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ChartCard,
  DumbbellRange,
  TrendColumns,
  TrendLines,
  periodTable,
} from "@/components/charts/recharts";
import {
  AiSummary,
  AskAiButton,
  KpiCard,
  KpiGrid,
  Section,
  buildSectionContext,
} from "@/components/kit";
import {
  lawyerShares,
  monthOf,
  monthlyPoints,
  transferWindow,
} from "@/lib/safety/reportingContext";
import { reportingContextQuery } from "../sectionQueries";
import {
  formatMonth,
  mainSeries,
  seriesLabel,
  sourceLabel,
  type SafetySubjectProfile,
} from "./productModel";

const fmt = (v: number) => v.toLocaleString("en-US");
const pctText = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;
const ID = "reporting-context";
const JPML = {
  label: "JPML pending MDL report (transfer dates)",
  url: "https://www.jpml.uscourts.gov/pending-mdls-0",
};

export function ReportingContext({ p }: { p: SafetySubjectProfile }) {
  const mdls = p.mdls.map((m) => m.mdl);
  const main = mainSeries(p.series);
  const q = useQuery({
    ...reportingContextQuery(mdls.length ? mdls : [0]),
    enabled: mdls.length > 0 && !!main,
  });
  const d = q.data;
  const windows = useMemo(
    () =>
      main && d
        ? d.transfers
            .map((t) => transferWindow(main, t))
            .sort((a, b) => (a.transferMonth ?? "").localeCompare(b.transferMonth ?? ""))
        : [],
    [main, d],
  );
  const lawyer = useMemo(() => {
    const own = d?.lawyer.filter((l) => l.years.some((y) => y.lawyer !== null)) ?? [];
    return own[0] ?? null;
  }, [d]);
  const shares = lawyerShares(lawyer).filter((s) => Number(s.year) >= 2010);
  if (!mdls.length || !main || !d) return null;
  const dated = windows.filter((w) => w.transferMonth);
  if (!dated.length && !shares.length) return null;
  const first = dated[0];
  const fromMonth = first?.transferMonth
    ? monthOf(
        Number(first.transferMonth.slice(0, 4)) * 12 +
          Number(first.transferMonth.slice(5, 7)) -
          1 -
          36,
      )
    : null;
  const points = monthlyPoints(main, fromMonth);
  const transfer = d.transfers.find((t) => t.mdl === first?.mdl);
  const latestComplete = [...shares].reverse().find((s) => !s.partial && s.share !== null);
  const latestPartial =
    shares.at(-1)?.partial && shares.at(-1)?.share != null ? shares.at(-1) : undefined;
  const unit = seriesLabel(main.series).toLowerCase();
  const context = buildSectionContext({
    id: ID,
    title: `${p.subject.label}: reporting before and after MDL centralization`,
    period: `${formatMonth(main.coverage_from)} – ${formatMonth(main.coverage_to)}`,
    source: `${sourceLabel(main.source_id)}; ${JPML.label}`,
    figures: [
      ...dated.flatMap((w) => [
        { label: `MDL ${w.mdl} transfer month`, value: w.transferMonth },
        {
          label: `MDL ${w.mdl}: ${unit}, 12 months before transfer`,
          value: w.before,
          note: w.beforePartial ? "partial window" : undefined,
        },
        {
          label: `MDL ${w.mdl}: ${unit}, transfer month and 11 after`,
          value: w.after,
          note: w.afterPartial ? "partial window" : undefined,
        },
        { label: `MDL ${w.mdl}: change`, value: w.change, unit: "%", decimals: 1 },
      ]),
      ...(transfer
        ? [{ label: `MDL ${transfer.mdl} actions pending`, value: transfer.pending }]
        : []),
      ...shares.slice(-5).map((s) => ({
        label: "Share of FAERS reports submitted by a lawyer",
        value: s.share,
        unit: "%",
        period: s.year,
        decimals: 1,
        note: s.partial ? "partial year" : undefined,
      })),
    ],
    maxFigures: 20,
  });
  const about = (
    <ul className="list-disc space-y-1 pl-4">
      <li>
        Reports are counts of reports received, not cases or incidence; one event can be reported
        more than once.
      </li>
      <li>
        Before: the 12 months before the transfer month. After: the transfer month and the 11 months
        after it. A window that runs outside the series is partial and not compared.
      </li>
      <li>
        Transfer dates come from the JPML pending-MDL report; terminated MDLs carry no transfer date
        here (Not recorded).
      </li>
      {lawyer ? (
        <li>
          Lawyer share: FAERS reporter type, from the MDL product series for MDL {lawyer.mdl}
          {lawyer.product ? ` (${lawyer.product})` : ""}, whose openFDA search can differ from this
          page&apos;s.
        </li>
      ) : null}
    </ul>
  );
  return (
    <Section
      id={ID}
      title="Reporting and litigation"
      description="Did reports rise before the MDL formed, or after?"
      actions={<AskAiButton sectionId={ID} context={context} size="icon" />}
    >
      <KpiGrid columns={4} label="Reporting and litigation figures">
        <KpiCard
          as="li"
          label="MDL transfer"
          value={first?.transferMonth ? formatMonth(first.transferMonth) : null}
          meta={first ? `MDL ${first.mdl}` : undefined}
        />
        <KpiCard
          as="li"
          label="Actions pending"
          value={transfer?.pending == null ? null : fmt(transfer.pending)}
          meta={transfer?.total != null ? `${fmt(transfer.total)} total` : undefined}
        />
        <KpiCard
          as="li"
          label="12 months after vs before"
          value={first?.change == null ? null : pctText(first.change)}
          deltaNote={
            first && first.change == null ? "A window is partial, so not compared" : undefined
          }
          meta={
            first
              ? `${first.before == null ? "Not recorded" : fmt(first.before)} → ${first.after == null ? "Not recorded" : fmt(first.after)} ${unit}`
              : undefined
          }
        />
        <KpiCard
          as="li"
          label="Reports filed by lawyers"
          value={latestComplete?.share == null ? null : `${latestComplete.share.toFixed(1)}%`}
          meta={
            latestComplete
              ? `${latestComplete.year}${latestPartial ? ` · ${latestPartial.year} so far: ${latestPartial.share!.toFixed(1)}%` : ""}`
              : undefined
          }
          source={{
            source: [
              { label: sourceLabel(main.source_id), href: main.query_url },
              { label: JPML.label, href: JPML.url },
            ],
          }}
        />
      </KpiGrid>
      <div className="mt-4 grid gap-4 lg:grid-cols-[3fr_2fr]">
        <ChartCard
          variant="editorial"
          title={
            first?.transferMonth
              ? `${seriesLabel(main.series)} around the MDL ${first.mdl} transfer (${formatMonth(first.transferMonth)})`
              : `${seriesLabel(main.series)} per month`
          }
          subtitle={`${seriesLabel(main.series)} per month received · ${points.length ? `${formatMonth(points[0]!.month)} – ${formatMonth(points.at(-1)!.month)}` : ""}`}
          status={
            points.length >= 2 ? { kind: "ready" } : { kind: "empty", reason: "Not recorded." }
          }
          sources={[{ label: `${sourceLabel(main.source_id)} query`, url: main.query_url }, JPML]}
          about={about}
          table={periodTable(
            points,
            "month",
            [{ key: "reports", label: seriesLabel(main.series) }],
            fmt,
            {
              caption: `${seriesLabel(main.series)} per month`,
              xLabel: "Month",
            },
          )}
        >
          <TrendLines
            rows={points}
            xKey="month"
            series={[{ key: "reports", label: seriesLabel(main.series) }]}
            format={fmt}
            markers={dated
              .filter((w) => points.some((x) => x.month === w.transferMonth))
              .map((w) => ({ x: w.transferMonth!, label: `MDL ${w.mdl}` }))}
            dots={false}
            ariaLabel={`${seriesLabel(main.series)} per month around the MDL transfer`}
          />
        </ChartCard>
        <div className="space-y-4">
          {dated.length ? (
            <ChartCard
              title="12 months before and after transfer"
              subtitle={`${seriesLabel(main.series)} · per MDL`}
              sources={[JPML]}
              about={about}
              table={{
                caption: "Reports before and after MDL transfer",
                columns: [
                  { label: "MDL" },
                  { label: "Transfer" },
                  { label: "Before", align: "right" },
                  { label: "After", align: "right" },
                  { label: "Change", align: "right" },
                ],
                rows: dated.map((w) => ({
                  key: String(w.mdl),
                  cells: [
                    `MDL ${w.mdl}`,
                    w.transferMonth ?? "Not recorded",
                    w.before == null
                      ? "Not recorded"
                      : `${fmt(w.before)}${w.beforePartial ? " (partial)" : ""}`,
                    w.after == null
                      ? "Not recorded"
                      : `${fmt(w.after)}${w.afterPartial ? " (partial)" : ""}`,
                    w.change == null ? "Not compared" : pctText(w.change),
                  ],
                })),
              }}
            >
              <DumbbellRange
                rows={dated.map((w) => ({
                  id: String(w.mdl),
                  label: `MDL ${w.mdl}`,
                  a: w.before,
                  b: w.after,
                  note:
                    w.beforePartial || w.afterPartial
                      ? "partial window, not compared"
                      : w.change != null
                        ? pctText(w.change)
                        : undefined,
                }))}
                aLabel="12 months before"
                bLabel="Transfer month + 11"
                format={fmt}
                labelWidth={90}
                ariaLabel="Reports before and after MDL transfer"
              />
            </ChartCard>
          ) : null}
          {shares.length >= 2 && lawyer ? (
            <ChartCard
              title="Share of FAERS reports submitted by a lawyer"
              subtitle={`Percent of reports per year · MDL ${lawyer.mdl} product series`}
              sources={
                lawyer.sourceUrl
                  ? [{ label: "openFDA FAERS query (MDL product series)", url: lawyer.sourceUrl }]
                  : []
              }
              partial={
                shares.at(-1)?.partial ? `${shares.at(-1)!.year} is not complete.` : undefined
              }
              about={about}
              table={periodTable(
                shares,
                "year",
                [{ key: "share", label: "Lawyer share (%)" }],
                (v) => `${v.toFixed(1)}%`,
                {
                  caption: "Lawyer-submitted share of FAERS reports",
                  xLabel: "Year",
                  partialKey: "partial",
                },
              )}
            >
              <TrendColumns
                rows={shares}
                xKey="year"
                series={[{ key: "share", label: "Lawyer share" }]}
                format={(v) => `${v.toFixed(1)}%`}
                partialKey="partial"
                ariaLabel="Lawyer-submitted share of FAERS reports per year"
              />
            </ChartCard>
          ) : null}
        </div>
      </div>
      <AiSummary context={context} className="mt-3" />
    </Section>
  );
}
