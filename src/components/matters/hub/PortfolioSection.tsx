/**
 * The Seeger Weiss hub's command center: how big the portfolio is and its share of national pending actions, which
 * matters grew fastest over the last 12 JPML reports, and where the matter registry's coverage is partial. Every
 * figure comes from the same hub rows, PDF counts and JPML series the page loads; nothing is typed in.
 */
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  AnnotatedTrend,
  ChartCard,
  DumbbellRange,
  RankBars,
  benchmark,
  medianOf,
  rankTakeaway,
  type ChartStatus,
  type TableSpec,
} from "@/components/charts/recharts";
import { metricFormatter } from "@/components/charts/format";
import {
  AiSummary,
  AskAiButton,
  KpiCard,
  KpiGrid,
  Section,
  buildSectionContext,
} from "@/components/kit";
import type { HubRow, MdlVelocityPayload } from "@/lib/matters/types";
import {
  JPML_SOURCE,
  count,
  matterHubPdfQuery,
  mdlVelocityQuery,
  monthLabel,
  pct,
} from "./hubQueries";
import {
  coverageRows,
  coverageTakeaway,
  pdfTotals,
  portfolioGrowth,
  portfolioKpis,
  portfolioShareTakeaway,
} from "./portfolio";

const REGISTRY_SOURCE = { label: "Seeger Weiss matter registry (sw_matters_v1)" };
const PDF_SOURCE = { label: "Verified PDF registry (matter header counts)" };
const COUNT = metricFormatter("count");
const COVERAGE_BELOW = 10;

export function PortfolioSection({ rows, rowsReady }: { rows: HubRow[]; rowsReady: boolean }) {
  const velocity = useQuery(mdlVelocityQuery);
  const pdf = useQuery(matterHubPdfQuery);
  const model = velocity.data?.published ? velocity.data : null;

  const kpis = useMemo(() => portfolioKpis(rows, model), [rows, model]);
  const growth = useMemo(() => portfolioGrowth(rows, model), [rows, model]);
  const coverage = useMemo(() => coverageRows(rows), [rows]);
  const pdfSum = useMemo(() => pdfTotals(pdf.data), [pdf.data]);
  const latest = model?.latestMonth ?? null;
  const period =
    model && model.months.length
      ? `${monthLabel(model.months[0]!.month)} to ${monthLabel(model.months.at(-1)!.month)}`
      : undefined;
  const reportDate = kpis.reportDate;
  const under = coverage.rows.filter((r) => r.value < COVERAGE_BELOW).length;

  const velocityStatus = velocity.isPending
    ? ({ kind: "loading" } as const)
    : velocity.isError
      ? ({
          kind: "error",
          message: "The JPML report series could not be read.",
          onRetry: () => void velocity.refetch(),
        } as const)
      : !model
        ? ({ kind: "empty", reason: "The JPML report series is not published." } as const)
        : ({ kind: "ready" } as const);
  const velocityKpiState = velocity.isPending ? "loading" : velocity.isError ? "error" : "ready";

  /* ---------------------------------------------------------------- AI context (figures shown only) */
  const context =
    rowsReady && model
      ? buildSectionContext({
          id: "portfolio",
          title: "Seeger Weiss portfolio",
          scope: `${kpis.matters} priority matters on the hub`,
          period: reportDate ? `JPML report of ${reportDate}` : undefined,
          source: JPML_SOURCE.label,
          figures: [
            { label: "Matters on the hub", value: kpis.matters },
            { label: "Matters pending in the JPML report", value: kpis.pendingMatters },
            {
              label: "Actions pending in hub matters",
              value: kpis.pendingActions,
              unit: "actions",
            },
            { label: "Actions pending in all MDLs", value: kpis.national, unit: "actions" },
            {
              label: "Hub share of national pending actions",
              value: kpis.sharePct,
              unit: "%",
              decimals: 1,
            },
            {
              label: "Actions added to hub matters, last 12 reports",
              value: growth.added12m,
              unit: "actions",
              note: `${growth.ranked.length} matters with a full window`,
            },
            ...growth.ranked.slice(0, 5).map((g) => ({
              label: `Actions added, last 12 reports: ${g.name} (MDL ${g.mdl})`,
              value: g.added12m,
              unit: "actions",
            })),
            {
              label: `Matters where the registry holds under ${COVERAGE_BELOW}% of JPML actions`,
              value: `${under} of ${coverage.rows.length}`,
            },
            ...(pdfSum
              ? [
                  { label: "Verified PDF records across hub matters", value: pdfSum.total },
                  { label: "Open (linkable) PDF records", value: pdfSum.open },
                ]
              : []),
          ],
        })
      : null;

  return (
    <Section
      id="portfolio"
      title="Portfolio"
      description="Size, growth and registry coverage of the priority matters, from the JPML monthly reports."
    >
      <KpiGrid columns={3} label="Portfolio figures">
        <KpiCard
          as="li"
          label="Matters on the hub"
          value={rowsReady ? count(kpis.matters) : undefined}
          state={rowsReady ? "ready" : "loading"}
          meta={`${count(kpis.pendingMatters)} pending in the JPML report`}
          source={{
            source: { label: "MDL records and the matter registry" },
            asOf: reportDate ?? undefined,
          }}
        />
        <KpiCard
          as="li"
          label="Actions pending in hub matters"
          value={kpis.pendingActions !== null ? count(kpis.pendingActions) : null}
          unit="actions"
          state={!rowsReady || velocity.isPending ? "loading" : "ready"}
          meta={
            reportDate
              ? `${kpis.counted} matters, JPML report of ${reportDate}`
              : "JPML report date not recorded"
          }
          source={{
            source: { label: JPML_SOURCE.label, href: model?.reportUrl ?? JPML_SOURCE.url },
            about: kpis.otherDates.length ? (
              <p>
                Left out: {kpis.otherDates.map((o) => `MDL ${o.mdl}`).join(", ")}, whose counts are
                not dated by this report (closed matters carry the fiscal-year terminated report).
              </p>
            ) : undefined,
          }}
        />
        <KpiCard
          as="li"
          label="Share of national pending actions"
          value={kpis.sharePct !== null ? pct(kpis.sharePct) : null}
          state={velocityKpiState}
          meta={
            kpis.national !== null
              ? `of ${count(kpis.national)} actions in ${count(kpis.nationalMdls ?? 0)} MDLs`
              : undefined
          }
          source={{
            source: { label: JPML_SOURCE.label, href: model?.reportUrl ?? JPML_SOURCE.url },
            asOf: reportDate ?? undefined,
          }}
        />
        <KpiCard
          as="li"
          label="Actions added, last 12 reports"
          value={growth.added12m !== null ? count(growth.added12m) : null}
          unit="actions"
          state={velocityKpiState}
          meta={`${growth.ranked.length} matters with a full 12-month window`}
          source={{
            source: { label: JPML_SOURCE.label, href: JPML_SOURCE.url },
            period: latest ? `12 months to ${monthLabel(latest)}` : undefined,
            about: (
              <p>
                The change in each MDL&apos;s cumulative JPML action total between the latest report
                and the report 12 months earlier. Actions are not plaintiffs.
                {growth.notRecorded.length
                  ? ` Not counted (newer than 12 months or re-counted): ${growth.notRecorded.map((g) => `MDL ${g.mdl}`).join(", ")}.`
                  : ""}
              </p>
            ),
          }}
        />
        <KpiCard
          as="li"
          label={`Registry coverage under ${COVERAGE_BELOW}%`}
          value={rowsReady ? `${under} of ${coverage.rows.length}` : undefined}
          state={rowsReady ? "ready" : "loading"}
          meta="matters, member-like dockets against JPML actions"
          source={{ source: REGISTRY_SOURCE }}
        />
        <KpiCard
          as="li"
          label="Verified PDF records"
          value={pdfSum ? count(pdfSum.total) : null}
          state={pdf.isPending ? "loading" : pdf.isError ? "error" : "ready"}
          errorText="The PDF counts could not be read just now."
          onRetry={() => void pdf.refetch()}
          meta={
            pdfSum
              ? `${count(pdfSum.open)} open, ${count(pdfSum.held)} held, ${pdfSum.matters} matters`
              : undefined
          }
          partial={
            pdfSum && pdfSum.notConnected
              ? `${pdfSum.notConnected} matters could not be read and are left out.`
              : undefined
          }
          loadingLabel="Counting verified PDF records"
          source={{
            source: PDF_SOURCE,
            about: (
              <p>
                The sum of the per-matter counts each matter page header shows. Identical bytes can
                have more than one source record; held records have no confirmed status and no link.
              </p>
            ),
          }}
        />
      </KpiGrid>
      <AiSummary
        context={context}
        className="mt-3"
        actions={
          <AskAiButton
            sectionId="portfolio"
            title="Seeger Weiss portfolio"
            context={context}
            questions={[
              "Which matters are growing fastest, and is any of them slowing down?",
              "Where is our registry coverage thinnest against the JPML counts?",
            ]}
          />
        }
      />

      <div className="mt-6 grid gap-4 xl:grid-cols-2">
        <ShareChart model={model} status={velocityStatus} period={period} />
        <GrowthChart growth={growth} latest={latest} status={velocityStatus} />
      </div>
      <div className="mt-4">
        <CoverageChart coverage={coverage} ready={rowsReady} />
      </div>
    </Section>
  );
}

/* ---------------------------------------------------------------- share of national */

type Status = ChartStatus;
type Velocity = Extract<MdlVelocityPayload, { published: true }>;

function ShareChart({
  model,
  status,
  period,
}: {
  model: Velocity | null;
  status: Status;
  period: string | undefined;
}) {
  const months = model?.months ?? [];
  const axis = useMemo(
    () => ({
      keys: months.map((m) => m.month),
      label: monthLabel,
      tick: (k: string) => monthLabel(k).replace(/ (\d{2})(\d{2})$/, " ’$2"),
    }),
    [months],
  );
  const series = useMemo(
    () => [
      {
        id: "national",
        label: "All MDLs",
        points: months.map((m) => ({ key: m.month, value: m.national, n: m.nationalMdls })),
      },
      {
        id: "portfolio",
        label: "Hub matters",
        points: months.map((m) => ({ key: m.month, value: m.portfolio, n: m.portfolioMdls })),
      },
    ],
    [months],
  );
  const table: TableSpec | undefined = months.length
    ? {
        caption: "Actions pending per JPML monthly report: all MDLs and hub matters",
        columns: [
          { label: "Report" },
          { label: "All MDLs, pending actions" },
          { label: "MDLs listed" },
          { label: "Hub matters, pending actions" },
          { label: "Hub matters listed" },
          { label: "Hub share" },
        ],
        rows: months.map((m) => ({
          key: m.month,
          cells: [
            m.reportDate,
            m.national,
            m.nationalMdls,
            m.portfolio,
            m.portfolioMdls,
            m.national > 0 ? pct((m.portfolio / m.national) * 100) : "Not recorded",
          ],
        })),
      }
    : undefined;
  const last = months.at(-1);
  const context = last
    ? buildSectionContext({
        id: "portfolio-share",
        title: "Hub matters' share of national pending actions",
        period,
        source: JPML_SOURCE.label,
        figures: months.slice(-6).flatMap((m) => [
          {
            label: "Actions pending, all MDLs",
            value: m.national,
            unit: "actions",
            period: monthLabel(m.month),
          },
          {
            label: "Actions pending, hub matters",
            value: m.portfolio,
            unit: "actions",
            period: monthLabel(m.month),
          },
        ]),
      })
    : null;
  return (
    <ChartCard
      variant="editorial"
      title={
        portfolioShareTakeaway(months, monthLabel) ?? "Actions pending: hub matters and all MDLs"
      }
      subtitle={`Actions pending · per JPML monthly report · all MDLs and the hub's matters${period ? ` · ${period}` : ""}`}
      status={status}
      sources={[{ label: JPML_SOURCE.label, url: model?.reportUrl ?? JPML_SOURCE.url }]}
      period={period}
      table={table}
      actions={<AskAiButton sectionId="portfolio-share" context={context} size="icon" />}
      about={
        <ul className="list-disc space-y-1 pl-4">
          <li>Each point sums the actions pending in every MDL the Panel listed in that report.</li>
          <li>
            Most of the fall between October 2024 and April 2025 is MDL 2885 (3M Combat Arms
            earplugs, a hub matter) closing out its pending actions in the reports.
          </li>
          <li>Actions are cases on the MDL docket, not plaintiffs.</li>
        </ul>
      }
      minHeight={300}
    >
      {months.length ? (
        <AnnotatedTrend
          series={series}
          axis={axis}
          formatter={COUNT}
          callouts={["peak"]}
          ariaLabel="Actions pending in all MDLs and in the hub's matters, per JPML monthly report"
        />
      ) : null}
    </ChartCard>
  );
}

/* ---------------------------------------------------------------- growth */

function GrowthChart({
  growth,
  latest,
  status,
}: {
  growth: ReturnType<typeof portfolioGrowth>;
  latest: string | null;
  status: Status;
}) {
  const top = growth.ranked.slice(0, 10);
  const lead = rankTakeaway(
    growth.ranked.map((g) => ({ label: g.name, value: g.added12m })),
    count,
    { verb: "added" },
  );
  const title =
    lead && latest
      ? `${lead} actions in the 12 months to ${monthLabel(latest)}`
      : "Actions added per matter";
  const table: TableSpec | undefined =
    growth.ranked.length || growth.notRecorded.length
      ? {
          caption: "Actions added to each hub matter, last 12 and 3 JPML reports",
          columns: [
            { label: "MDL" },
            { label: "Matter" },
            { label: "Added, 12 months" },
            { label: "Added, 3 months" },
            { label: "3 months × 4" },
            { label: "Pending" },
          ],
          rows: [...growth.ranked, ...growth.notRecorded].map((g) => ({
            key: g.mdl,
            cells: [
              g.mdl,
              g.name,
              g.added12m ?? "Not recorded",
              g.added3m ?? "Not recorded",
              g.pace3m ?? "Not recorded",
              g.pending ?? "Not recorded",
            ],
            muted: g.added12m === null,
          })),
        }
      : undefined;
  const context = top.length
    ? buildSectionContext({
        id: "portfolio-growth",
        title: "Actions added per hub matter",
        period: latest ? `12 months to ${monthLabel(latest)}` : undefined,
        source: JPML_SOURCE.label,
        figures: top.flatMap((g) => [
          {
            label: `${g.name} (MDL ${g.mdl}), added in 12 months`,
            value: g.added12m,
            unit: "actions",
          },
          {
            label: `${g.name} (MDL ${g.mdl}), added in 3 months`,
            value: g.added3m,
            unit: "actions",
          },
        ]),
      })
    : null;
  return (
    <ChartCard
      variant="editorial"
      title={title}
      subtitle="Actions added (change in the JPML cumulative total) · last 12 reports against the last 3 × 4 · top 10 hub matters"
      status={
        status.kind === "ready" && !top.length
          ? { kind: "empty", reason: "No hub matter has a full 12-month window." }
          : status
      }
      sources={[{ label: JPML_SOURCE.label, url: JPML_SOURCE.url }]}
      period={latest ? `12 months to ${monthLabel(latest)}` : undefined}
      table={table}
      actions={<AskAiButton sectionId="portfolio-growth" context={context} size="icon" />}
      about={
        <ul className="list-disc space-y-1 pl-4">
          <li>
            Added = the latest report&apos;s cumulative total minus the total in the report 12 (or
            3) months earlier. The second dot is the 3-month figure times four, so a dot to the
            right of the first means the matter is speeding up.
          </li>
          <li>
            A matter newer than 12 months, or whose total fell (the Panel re-counted), is Not
            recorded and listed in View data.
          </li>
        </ul>
      }
      minHeight={300}
    >
      {top.length ? (
        <DumbbellRange
          rows={top.map((g) => ({ id: g.mdl, label: g.name, a: g.added12m, b: g.pace3m }))}
          aLabel="Added, last 12 months"
          bLabel="Last 3 months × 4"
          format={count}
          tickFormat={COUNT.tick}
          gapLabel="Pace change"
          ariaLabel="Actions added to the top 10 hub matters over the last 12 months against the last 3 months times four"
        />
      ) : null}
    </ChartCard>
  );
}

/* ---------------------------------------------------------------- registry coverage */

function CoverageChart({
  coverage,
  ready,
}: {
  coverage: ReturnType<typeof coverageRows>;
  ready: boolean;
}) {
  const items = coverage.rows.map((r) => ({ id: r.id, label: r.label, value: r.value }));
  const byId = new Map(coverage.rows.map((r) => [r.id, r]));
  const median = medianOf(items.map((i) => i.value));
  const table: TableSpec | undefined = ready
    ? {
        caption: "Registry member-like dockets against JPML total actions, per hub matter",
        columns: [
          { label: "MDL" },
          { label: "Matter" },
          { label: "Registry dockets" },
          { label: "JPML total actions" },
          { label: "Published" },
          { label: "JPML as of" },
        ],
        rows: [
          ...coverage.rows.map((r) => ({
            key: r.id,
            cells: [
              r.id,
              r.label,
              r.dockets,
              r.actions,
              `${count(r.dockets)} of ${count(r.actions)}`,
              r.asOf ?? "Not recorded",
            ],
          })),
          ...coverage.notRecorded.map((r) => ({
            key: r.mdl,
            cells: [
              r.mdl,
              r.shortName,
              r.registryDockets ?? "Not recorded",
              r.totalActions ?? "Not recorded",
              "Not recorded",
              r.asOf ?? "Not recorded",
            ],
            muted: true,
          })),
        ],
      }
    : undefined;
  const context = coverage.rows.length
    ? buildSectionContext({
        id: "portfolio-coverage",
        title: "Registry coverage against JPML actions",
        source: `${REGISTRY_SOURCE.label}; ${JPML_SOURCE.label}`,
        figures: coverage.rows.slice(0, 10).map((r) => ({
          label: `${r.label}: registry dockets of JPML actions`,
          value: `${count(r.dockets)} of ${count(r.actions)}`,
        })),
      })
    : null;
  return (
    <ChartCard
      title={
        coverageTakeaway(coverage.rows, COVERAGE_BELOW) ?? "Registry coverage against JPML actions"
      }
      subtitle="Member-like dockets in the matter registry as a share of the JPML cumulative action total · lowest first"
      status={
        !ready
          ? { kind: "loading" }
          : items.length
            ? { kind: "ready" }
            : { kind: "empty", reason: "No matter has both a registry count and a JPML total." }
      }
      sources={[{ label: JPML_SOURCE.label, url: JPML_SOURCE.url }]}
      table={table}
      actions={<AskAiButton sectionId="portfolio-coverage" context={context} size="icon" />}
      about={
        <ul className="list-disc space-y-1 pl-4">
          <li>
            Registry dockets are member-like dockets the Seeger Weiss matter registry recorded with
            relationship evidence. They are not a census of the MDL.
          </li>
          <li>
            The share can pass 100%: the registry also lists transferor and associated dockets that
            the JPML does not count as actions. It is shown as published, never capped.
          </li>
          <li>
            Where the registry is thin, use the JPML figures for size and growth, not registry
            counts.
          </li>
        </ul>
      }
    >
      {items.length ? (
        <RankBars
          items={items}
          ascending
          limit={12}
          format={pct}
          references={benchmark("Median matter", median, pct)}
          note={(id) => {
            const r = byId.get(id);
            return r ? `${count(r.dockets)} of ${count(r.actions)} published` : null;
          }}
          ariaLabel="Registry dockets as a share of JPML actions, lowest first"
        />
      ) : null}
    </ChartCard>
  );
}
