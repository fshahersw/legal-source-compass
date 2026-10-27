/**
 * EPA UCMR 5 PFAS occurrence in one state's public water systems (exposure geography for the AFFF MDL 2873): how many
 * systems found PFAS, how many people they serve, and which PFAS were found most often. Renders nothing without data.
 */
import { ChartCard } from "@/components/charts/ChartCard";
import { RankBars } from "@/components/charts/recharts";
import {
  AiSummary,
  AskAiButton,
  buildSectionContext,
  DataDrawer,
  type DataColumn,
} from "@/components/kit";
import type { PfasPart } from "@/lib/external/exposureGeo.functions";
import { SDWIS_SOURCE, UCMR_SOURCE, type UcmrSystem } from "./exposureModel";
import {
  AboutList,
  fmtInt,
  fmtShare,
  orNR,
  PFAS_ABOUT,
  ucmrPartial,
  ucmrPeriod,
} from "./exposureParts";

const SYSTEM_COLUMNS: readonly DataColumn<UcmrSystem>[] = [
  { key: "name", label: "Water system", value: (s) => s.name },
  { key: "pwsid", label: "PWSID", value: (s) => s.pwsid },
  { key: "pop", label: "Population served", align: "right", value: (s) => s.populationServed },
  { key: "n", label: "PFAS detected", align: "right", value: (s) => s.analytesDetected },
  { key: "pfoa", label: "PFOA, highest (ng/L)", align: "right", value: (s) => s.pfoaMax },
  { key: "pfos", label: "PFOS, highest (ng/L)", align: "right", value: (s) => s.pfosMax },
];

export function PfasExposureBlock({ part, stateName }: { part: PfasPart; stateName: string }) {
  const s = part.state;
  if (!s) return null;
  const period = ucmrPeriod(s);
  const share = s.systemsSampled ? s.systemsWithDetect / s.systemsSampled : null;
  // States are compared on large systems: all were tested, while small ones were only sampled.
  const large = (u: typeof s | null) =>
    u && u.largeSampled && u.largeWithDetect !== null ? u.largeWithDetect / u.largeSampled : null;
  const largeShare = large(s);
  const nationalLarge = large(part.national);
  const items = s.byAnalyte.map((a) => ({ id: a.analyte, label: a.analyte, value: a.systems }));
  const top = s.byAnalyte[0];
  const title =
    share !== null
      ? `${fmtInt(s.systemsWithDetect)} of ${fmtInt(s.systemsSampled)} water systems in ${stateName} found PFAS (${fmtShare(share)})${top ? `; ${top.analyte} most often` : ""}`
      : `PFAS in ${stateName} drinking water`;
  const context = buildSectionContext({
    id: "exposure-pfas",
    title: `PFAS in public drinking water, ${stateName}`,
    scope: `${stateName} public water systems tested under UCMR 5; exposure geography for MDL 2873 (AFFF)`,
    period,
    source: UCMR_SOURCE.label,
    figures: [
      { label: "Water systems tested", value: s.systemsSampled },
      { label: "Systems with any PFAS detected", value: s.systemsWithDetect },
      {
        label: "Share of systems with PFAS detected",
        value: share === null ? null : fmtShare(share),
      },
      {
        label: "Share of large systems (all tested) with PFAS detected",
        value: largeShare === null ? null : fmtShare(largeShare),
      },
      {
        label: "Share of large systems with PFAS nationally",
        value: nationalLarge === null ? null : fmtShare(nationalLarge),
      },
      {
        label: "Systems with a PFOA or PFOS result at or above 4.0 ng/L",
        value: s.systemsAtOrAbove4,
      },
      {
        label: "People served by community water systems with PFAS detected",
        value: s.populationWithDetectCws.sum,
        unit: "people",
      },
      ...s.byAnalyte
        .slice(0, 8)
        .map((a) => ({ label: `Systems detecting ${a.analyte}`, value: a.systems })),
    ],
    maxFigures: 16,
  });
  return (
    <div className="space-y-3" data-testid="exposure-pfas">
      <ChartCard
        variant="editorial"
        title={title}
        subtitle={`Public water systems with each PFAS detected · ${stateName} · ${period}`}
        kpis={[
          {
            label: "Systems with PFAS",
            value: `${fmtInt(s.systemsWithDetect)} of ${fmtInt(s.systemsSampled)}`,
            detail: share !== null ? `${fmtShare(share)} of all tested` : undefined,
          },
          {
            label: "Large systems with PFAS",
            value: orNR(largeShare, fmtShare),
            detail: nationalLarge !== null ? `${fmtShare(nationalLarge)} nationally` : undefined,
          },
          {
            label: "PFOA or PFOS at or above 4 ng/L",
            value: fmtInt(s.systemsAtOrAbove4),
            detail: "systems, single results",
          },
          {
            label: "People served by community systems with PFAS",
            value: orNR(s.populationWithDetectCws.sum, fmtInt),
            detail: s.populationWithDetectCws.withoutPopulation
              ? `${fmtInt(s.populationWithDetectCws.withoutPopulation)} systems without a population figure`
              : "SDWIS, by water-system ID",
          },
        ]}
        sources={[UCMR_SOURCE, SDWIS_SOURCE]}
        period={period}
        partial={ucmrPartial(s)}
        about={<AboutList items={PFAS_ABOUT} />}
        actions={<AskAiButton sectionId="exposure-pfas" context={context} size="icon" />}
        table={{
          caption: `Water systems detecting each PFAS, ${stateName}`,
          columns: [{ label: "PFAS" }, { label: "Systems with a detection", align: "right" }],
          rows: s.byAnalyte.map((a) => ({ key: a.analyte, cells: [a.analyte, fmtInt(a.systems)] })),
        }}
        footer={
          part.systems.length ? (
            <DataDrawer
              title={`Water systems with PFAS detected, ${stateName}`}
              description={
                part.systemsTruncated
                  ? `The ${part.systems.length} systems with the most PFAS detected; the full list is in the dataset.`
                  : undefined
              }
              columns={SYSTEM_COLUMNS}
              rows={part.systems}
              rowKey={(r) => r.pwsid}
              source={{
                source: [
                  { label: UCMR_SOURCE.label, href: UCMR_SOURCE.url },
                  { label: SDWIS_SOURCE.label, href: SDWIS_SOURCE.url },
                ],
              }}
              triggerLabel={`See ${part.systems.length} water systems`}
              searchable
            />
          ) : null
        }
      >
        <RankBars
          items={items}
          format={(v) => `${fmtInt(v)} systems`}
          limit={10}
          labelWidth={140}
          ariaLabel={`Water systems detecting each PFAS, ${stateName}`}
        />
      </ChartCard>
      <AiSummary
        context={context}
        actions={
          <AskAiButton
            sectionId="exposure-pfas"
            title="PFAS in drinking water"
            context={context}
            questions={[
              "How does this state compare with the national share of systems with PFAS?",
              "What can and cannot be said about the source of this PFAS?",
            ]}
          />
        }
      />
    </div>
  );
}
