/**
 * /safety/signals "Emerging (no MDL linked)": products, vehicles and JPML matters whose published safety and court
 * records are rising while no MDL is linked to them by an exact key. Opens with the answer (identity, 5 KPIs), then
 * three charts that each answer one question (who scores highest, how far above expected, how close to the Panel),
 * then the full table behind "View data". A row opens RadarCandidateSheet.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Radar } from "lucide-react";
import { ChartCard } from "@/components/charts/ChartCard";
import { DivergingDots } from "@/components/charts/d3/charts";
import { Swimlanes } from "@/components/charts/Swimlanes";
import {
  AiSummary,
  AskAiButton,
  DataDrawer,
  EmptyState,
  InfoPopover,
  KpiCard,
  KpiCardSkeleton,
  KpiGrid,
  Section,
  StatusPill,
  type DataColumn,
} from "@/components/kit";
import { radarQuery } from "./radarQueries";
import { RadarAbout, RadarCandidateSheet } from "./RadarCandidateSheet";
import { RadarScoreLegend, RadarScoreStack, familyPoints } from "./RadarScoreStack";
import {
  FAMILY_LABEL,
  KIND_LABEL,
  RADAR_SOURCES,
  STATUS_LABEL,
  closedMdlNote,
  emerging,
  kindBreakdown,
  fmtCount,
  fmtRatio,
  laneInputs,
  overviewContext,
  radarKpis,
  ratioDots,
  reportsOf,
  type RadarRow,
} from "./radarModel";

const n = (v: number) => v.toLocaleString("en-US");
const FAERS = { label: RADAR_SOURCES[0].label, href: RADAR_SOURCES[0].url };
const JPML = { label: RADAR_SOURCES[2].label, href: RADAR_SOURCES[2].url };
const NHTSA = { label: RADAR_SOURCES[1].label, href: RADAR_SOURCES[1].url };
/** FAERS and NHTSA have their own windows: a figure that mixes drugs and vehicles cites both, each with its period. */
const bothPeriods = (faers: string | undefined, nhtsa: string | undefined) =>
  `FAERS ${faers ?? "window not recorded"}; NHTSA ${nhtsa ?? "window not recorded"}`;

const COLUMNS: DataColumn<RadarRow>[] = [
  { key: "rank", label: "Rank", align: "right", value: (r) => r.rank ?? null },
  { key: "label", label: "Unit", value: (r) => r.label },
  { key: "kind", label: "Kind", value: (r) => KIND_LABEL[r.kind] },
  { key: "status", label: "MDL status", value: (r) => STATUS_LABEL[r.status] },
  {
    key: "families",
    label: "Families",
    value: (r) => r.families.map((f) => FAMILY_LABEL[f]).join(", ") || "None",
  },
  { key: "points", label: "Points", align: "right", value: (r) => r.points },
  ...(["A", "B", "C", "D"] as const).map((f): DataColumn<RadarRow> => ({
    key: `p${f}`,
    label: `${FAMILY_LABEL[f]} pts`,
    align: "right",
    value: (r) => familyPoints(r.components)[f],
  })),
  {
    key: "observed",
    label: "Last 12 months",
    align: "right",
    value: (r) => reportsOf(r)?.observed ?? null,
  },
  {
    key: "expected",
    label: "Expected",
    align: "right",
    value: (r) => reportsOf(r)?.expected ?? null,
  },
  { key: "ratio", label: "Rate ratio", align: "right", value: (r) => reportsOf(r)?.ratio ?? null },
  {
    key: "low",
    label: "95% lower bound",
    align: "right",
    value: (r) => reportsOf(r)?.ci_low ?? null,
  },
  {
    key: "mdls",
    label: "Linked MDLs",
    value: (r) =>
      r.mdls
        .map((m) => m.mdl)
        .filter((v, i, a) => a.indexOf(v) === i)
        .join(", ") || null,
  },
  { key: "flags", label: "Flags", value: (r) => r.flags.map((f) => f.label).join("; ") || null },
];

export function EmergingTortRadar({
  unit,
  onUnit,
  onShowMdl,
}: {
  unit: string | null;
  onUnit: (id: string | null) => void;
  /** Opens the "In an MDL" mode (offered while the radar is not published). */
  onShowMdl?: (() => void) | undefined;
}) {
  const q = useQuery(radarQuery);
  const [kind, setKind] = useState<"drug" | "vehicle">("drug");
  const data = q.data;
  const rows = useMemo(() => data?.rows ?? [], [data]);
  const summary = data?.summary ?? null;
  const list = useMemo(() => emerging(rows), [rows]);
  const kpis = useMemo(() => radarKpis(rows, summary), [rows, summary]);
  const top = list.slice(0, 15);
  const dots = useMemo(() => ratioDots(rows, kind), [rows, kind]);
  const lanes = useMemo(
    () => (summary ? laneInputs(summary.jpml_lanes, summary.as_of) : null),
    [summary],
  );
  const context = useMemo(
    () => (data?.published ? overviewContext(kpis, list, summary) : null),
    [data, kpis, list, summary],
  );

  if (q.isPending)
    return (
      <div className="space-y-3" aria-busy="true" aria-label="Loading the emerging-tort radar">
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: 5 }, (_, i) => (
            <KpiCardSkeleton key={i} />
          ))}
        </div>
      </div>
    );
  if (q.isError)
    return (
      <EmptyState
        tone="error"
        title="The radar could not be loaded"
        description="Try again in a moment."
        action={
          <button type="button" className="text-meta underline" onClick={() => void q.refetch()}>
            Retry
          </button>
        }
      />
    );
  if (!data?.published)
    return (
      <EmptyState
        icon={Radar}
        title="The emerging-tort radar is not published yet"
        description="It will rank products and vehicles whose FDA adverse-event reports or NHTSA complaints are rising while no MDL is linked to them, with every part of the score shown. The In an MDL tab lists products already in an MDL."
        action={
          onShowMdl ? (
            <button type="button" className="text-meta underline" onClick={onShowMdl}>
              Open products in an MDL
            </button>
          ) : undefined
        }
      />
    );

  const nat = summary?.national;
  const cov = summary?.coverage ?? {};
  const asOf = summary?.as_of;
  const leader = top[0];
  const fams = (r: RadarRow) => r.families.map((f) => FAMILY_LABEL[f].toLowerCase()).join(", ");
  const dotLead = dots.rows[0];
  const lead = dotLead ? reportsOf(dotLead) : null;
  const baselineText = dots.baseline != null ? fmtRatio(dots.baseline) : "Not recorded";
  const faersWindow = summary?.windows["faers"];
  const nhtsaWindow = summary?.windows["nhtsa"];

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <p className="text-body">
          Products, vehicles and JPML matters with rising published counts and{" "}
          <strong>no open MDL linked</strong>
          {kpis.closedMdlRanked
            ? ` (${n(kpis.closedMdlRanked)} are linked only to an MDL that has closed and are marked "Earlier MDL closed")`
            : ""}
          .{asOf ? <span className="text-muted-foreground"> As of {asOf}.</span> : null}
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusPill tone="neutral" icon={false}>
            Drugs: {fmtCount(cov["faers_products_with_series"] as number | undefined)} of{" "}
            {fmtCount(cov["faers_products_indexed"] as number | undefined)} products have monthly
            series
          </StatusPill>
          <StatusPill tone="neutral" icon={false}>
            Devices: recalls only until MAUDE series load
          </StatusPill>
          <StatusPill tone="neutral" icon={false}>
            Vehicles: {fmtCount(cov["nhtsa_units_rated"] as number | undefined)}{" "}
            make-model-component units
          </StatusPill>
          <InfoPopover label="About this score" title="About this score" showLabel>
            <RadarAbout summary={summary} />
          </InfoPopover>
        </div>
      </div>

      <KpiGrid columns={5} label="Emerging-tort radar figures">
        <KpiCard
          as="li"
          label="Candidates scoring in 3+ families"
          value={n(kpis.threePlusFamilies)}
          meta={kindBreakdown(kpis.threePlusByKind)}
          source={{ source: [FAERS, NHTSA], period: bothPeriods(faersWindow, nhtsaWindow) }}
        />
        <KpiCard
          as="li"
          label="Pending motions with no MDL"
          value={n(kpis.pendingMotions)}
          meta="Products-liability motions before the JPML"
          source={{ source: JPML, asOf }}
        />
        <KpiCard
          as="li"
          label="Centralizations denied"
          value={n(kpis.denied36)}
          meta="Products-liability motions, last 36 months"
          source={{ source: JPML, asOf }}
        />
        <KpiCard
          as="li"
          label="Rising, no open MDL linked"
          value={n(kpis.risingNoMdl)}
          meta={`${kindBreakdown(kpis.risingByKind)} · 95% lower bound above 1.5× expected`}
          source={{ source: [FAERS, NHTSA], period: bothPeriods(faersWindow, nhtsaWindow) }}
        />
        <KpiCard
          as="li"
          label="Open NHTSA investigations"
          value={n(kpis.openInvestigations)}
          meta={`Distinct investigations, on ${n(kpis.investigatedUnits)} vehicle units with no open MDL linked`}
          source={{ source: NHTSA, asOf }}
        />
      </KpiGrid>

      <Section
        id="radar-scores"
        title="Highest scores"
        description="Points by family for the top 15. Select a name to open its evidence."
        actions={<AskAiButton sectionId="radar-scores" context={context} size="sm" />}
      >
        <ChartCard
          variant="editorial"
          title={
            leader
              ? `${leader.label} leads with ${leader.points} points from ${fams(leader) || "no family"}`
              : "Radar scores"
          }
          subtitle={`Points per family · top 15 with no open MDL linked (a closed MDL is marked) · ${bothPeriods(faersWindow, nhtsaWindow)}`}
          status={top.length ? { kind: "ready" } : { kind: "empty", reason: "No unit scored." }}
          sources={[...RADAR_SOURCES]}
          asOf={asOf}
          about={<RadarAbout summary={summary} />}
          table={{
            caption: "Radar points by family, top 15",
            columns: [
              { label: "Unit" },
              { label: "Kind" },
              { label: "MDL status" },
              { label: "Reports" },
              { label: "Severity" },
              { label: "Regulator" },
              { label: "Litigation" },
              { label: "Total" },
            ],
            rows: top.map((r) => {
              const p = familyPoints(r.components);
              return {
                key: r.unit_id,
                cells: [
                  r.label,
                  KIND_LABEL[r.kind],
                  closedMdlNote(r) ?? STATUS_LABEL[r.status],
                  p.A,
                  p.B,
                  p.C,
                  p.D,
                  r.points,
                ],
              };
            }),
          }}
        >
          <RadarScoreStack
            rows={top.map((r) => ({ ...r, note: closedMdlNote(r) }))}
            onOpen={onUnit}
            ariaLabel="Radar points by family, top 15 units"
            labelWidth={320}
          />
          <RadarScoreLegend className="mt-2" />
        </ChartCard>
      </Section>

      <Section
        id="radar-ratio"
        title="Rise against expected"
        description="Last 12 months against the prior period, after the national change."
      >
        <ChartCard
          variant="editorial"
          title={
            dotLead && lead?.ratio != null
              ? `${dotLead.label}: ${fmtRatio(lead.ratio)}× expected; the median rated ${kind === "drug" ? "drug" : "vehicle unit"} is ${baselineText}×`
              : "Rate ratio against expected"
          }
          subtitle={`Observed ÷ expected ${kind === "drug" ? "FAERS reports" : "NHTSA complaints"} · top 12 by 95% lower bound · ${kind === "drug" ? faersWindow : nhtsaWindow}`}
          status={
            dots.items.length
              ? { kind: "ready" }
              : { kind: "empty", reason: "No rated unit of this kind." }
          }
          sources={[kind === "drug" ? RADAR_SOURCES[0] : RADAR_SOURCES[1]]}
          asOf={asOf}
          actions={
            <div role="radiogroup" aria-label="Kind" className="flex gap-1">
              {(["drug", "vehicle"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={kind === k}
                  onClick={() => setKind(k)}
                  className={
                    kind === k
                      ? "rounded bg-primary px-2 py-0.5 text-meta font-semibold text-primary-foreground"
                      : "rounded px-2 py-0.5 text-meta text-muted-foreground hover:bg-muted"
                  }
                >
                  {k === "drug" ? "Drugs" : "Vehicles"}
                </button>
              ))}
            </div>
          }
          about={
            <ul className="list-disc space-y-1 pl-4">
              <li>
                Expected = the prior period scaled to 12 months and by the national change (FAERS
                factor {nat?.faers?.factor ?? "not recorded"}, NHTSA factor{" "}
                {nat?.nhtsa?.factor ?? "not recorded"}), so 1.0 is the national pace.
              </li>
              <li>
                The line is the median of the {n(dots.compared)} rated units of this kind (at least
                50 reports in the last 12 months).
              </li>
              <li>Rows are ordered by the exact Poisson 95% lower bound, not by the raw ratio.</li>
            </ul>
          }
          table={{
            caption: "Rate ratio against expected",
            columns: [
              { label: "Unit" },
              { label: "Observed" },
              { label: "Expected" },
              { label: "Ratio" },
              { label: "95% lower" },
              { label: "95% upper" },
            ],
            rows: dots.rows.map((r) => {
              const a = reportsOf(r)!;
              return {
                key: r.unit_id,
                cells: [
                  r.label,
                  a.observed ?? "Not recorded",
                  a.expected ?? "Not recorded",
                  a.ratio ?? "Not recorded",
                  a.ci_low ?? "Not recorded",
                  a.ci_high ?? "Not recorded",
                ],
              };
            }),
          }}
          minHeight={320}
        >
          {dots.baseline != null ? (
            <DivergingDots
              items={dots.items}
              baseline={dots.baseline}
              baselineLabel={`Median rated ${kind === "drug" ? "drug" : "unit"}`}
              format={(v) => `${v.toFixed(2)}×`}
              labelWidth={220}
            />
          ) : null}
        </ChartCard>
      </Section>

      <Section
        id="radar-panel"
        title="Path to the Panel"
        description="Recalls, hearings and orders for products-liability motions to create an MDL."
      >
        <ChartCard
          variant="editorial"
          title={
            kpis.pendingMotions
              ? `${n(kpis.pendingMotions)} products-liability motion${kpis.pendingMotions === 1 ? "" : "s"} with no MDL await the Panel; ${n(kpis.denied36)} were denied in 36 months`
              : "Motions to create an MDL"
          }
          subtitle="JPML hearing sessions and orders · recalls from reviewed links only · last 36 months"
          status={
            lanes?.lanes.length
              ? { kind: "ready" }
              : { kind: "empty", reason: "No motion recorded in the window." }
          }
          sources={[RADAR_SOURCES[2]]}
          asOf={asOf}
          about={
            <p>
              Recalls appear only where a reviewed link ties them to the matter (recall and caption
              name the same product). Centralized lanes are shown for recent orders and backtests;
              they are in an MDL.
            </p>
          }
          table={
            summary
              ? {
                  caption: "Products-liability motions to create an MDL",
                  columns: [
                    { label: "MDL" },
                    { label: "Caption" },
                    { label: "Status" },
                    { label: "Session" },
                    { label: "Events" },
                  ],
                  rows: summary.jpml_lanes.map((l) => ({
                    key: String(l.mdl),
                    cells: [
                      l.mdl,
                      l.title,
                      l.status,
                      l.session,
                      l.events.map((e) => `${e.date} ${e.label}`).join("; "),
                    ],
                  })),
                }
              : undefined
          }
        >
          {lanes ? (
            <Swimlanes
              groups={lanes.groups}
              lanes={lanes.lanes}
              domain={lanes.domain}
              ariaLabel="Recalls, JPML hearing sessions and orders for products-liability motions"
            />
          ) : null}
        </ChartCard>
      </Section>

      <AiSummary context={context} title="What the radar shows" />

      <div className="flex flex-wrap items-center gap-3">
        <DataDrawer
          title="Emerging-tort radar: every unit"
          description="Every scored unit, including those in an MDL (excluded from the ranking). Search by name, kind, status or flag."
          columns={COLUMNS}
          rows={rows}
          rowKey={(r) => r.unit_id}
          searchable
          triggerLabel={`View data (${n(rows.length)} units)`}
          source={{
            source: [FAERS, NHTSA, JPML],
            period: bothPeriods(faersWindow, nhtsaWindow),
            asOf,
          }}
        />
        <p className="text-meta text-muted-foreground">
          {n(kpis.excluded)} units are in an MDL and left out of the ranking
          {data.dropped
            ? `; ${n(data.dropped)} stored rows did not reconcile and are not shown`
            : ""}
          .
        </p>
      </div>

      <RadarCandidateSheet id={unit} summary={summary} onClose={() => onUnit(null)} />
    </div>
  );
}
