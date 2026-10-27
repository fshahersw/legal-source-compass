/**
 * County block: the CDC PLACES estimates for MDL-linked conditions in one county, each against the spread of the
 * state's counties (smallest, median, largest) and the national value. Renders nothing when the dataset is not
 * published or CDC published no estimate for the county. Not mounted yet: see the de-exposure report.
 */
import { useQuery } from "@tanstack/react-query";
import { ChartCard } from "@/components/charts/ChartCard";
import { BulletBand } from "@/components/charts/recharts";
import { AiSummary, AskAiButton, buildSectionContext, Section } from "@/components/kit";
import type { CountyExposure } from "@/lib/external/exposureGeo.functions";
import { countyExposureQuery } from "./exposureQueries";
import { measureDistribution, PLACES_SOURCE } from "./exposureModel";
import { AboutList, fmtPct, orNR, PLACES_ABOUT } from "./exposureParts";

export function CountyExposurePanel({ fips }: { fips: string }) {
  const q = useQuery(countyExposureQuery(fips));
  if (!q.data) return null;
  return <CountyExposureView data={q.data} />;
}

/** Rows for the county's linked measures; exported for tests. */
export function countyRows(data: CountyExposure) {
  const county = data.county;
  if (!county) return [];
  return county.measures
    .filter((m) => m.links.length)
    .map((m) => {
      const d = measureDistribution(data.peers, m.id);
      const values = d.items.map((i) => i.value).filter((v): v is number => v !== null);
      const national = data.national?.measures.find((x) => x.id === m.id)?.crude.v ?? null;
      return {
        id: m.id,
        label: m.label,
        value: m.crude.v,
        lo: m.crude.lo,
        hi: m.crude.hi,
        min: values.length ? Math.min(...values) : null,
        median: d.median,
        max: values.length ? Math.max(...values) : null,
        national,
        year: m.year,
        mdls: [...new Set(m.links.flatMap((l) => l.mdls))],
        relations: m.links.map((l) => `MDL ${l.mdls.join(", ")}: ${l.relation}.`),
        sources: m.links.map((l) => ({ label: l.sourceLabel, url: l.sourceUrl })),
      };
    });
}

export function CountyExposureView({ data }: { data: CountyExposure }) {
  const county = data.county;
  const rows = countyRows(data);
  if (!county || !rows.length) return null;
  const name = `${county.county ?? county.fips}, ${county.stateName}`;
  const above = rows.filter((r) => r.value !== null && r.median !== null && r.value > r.median).length;
  const compared = rows.filter((r) => r.value !== null && r.median !== null).length;
  const year = rows[0]?.year ?? "";
  const context = buildSectionContext({
    id: "county-exposure",
    title: `MDL-linked conditions, ${name}`,
    scope: `${name} against ${county.stateName}'s counties`,
    period: year,
    source: PLACES_SOURCE.label,
    figures: rows.flatMap((r) => [
      { label: `${r.label}, ${county.county ?? "county"}`, value: r.value, unit: "%" },
      { label: `${r.label}, median ${county.stateName} county`, value: r.median, unit: "%" },
      { label: `${r.label}, United States`, value: r.national, unit: "%" },
    ]),
    maxFigures: 24,
  });
  const sources = [PLACES_SOURCE, ...rows.flatMap((r) => r.sources)].filter(
    (s, i, all) => all.findIndex((x) => x.url === s.url) === i,
  );
  return (
    <Section
      id="county-exposure"
      title="Linked health conditions"
      description="Adults with conditions tied to MDL drugs or injuries. A population, not plaintiffs."
    >
      <ChartCard
        variant="editorial"
        title={
          compared
            ? `${county.county ?? "This county"} is above the typical ${county.stateName} county on ${above} of ${compared} linked conditions`
            : `Linked conditions, ${name}`
        }
        subtitle={`Crude prevalence among adults · ${name} against ${county.stateName}'s counties · ${year}`}
        sources={sources}
        period={year}
        about={<AboutList items={[...PLACES_ABOUT, ...rows.flatMap((r) => r.relations)]} />}
        actions={<AskAiButton sectionId="county-exposure" context={context} size="icon" />}
        table={{
          caption: `MDL-linked conditions, ${name}, ${year}`,
          columns: [
            { label: "Condition" },
            { label: "County", align: "right" },
            { label: "95% CI", align: "right" },
            { label: "State median county", align: "right" },
            { label: "United States", align: "right" },
            { label: "Linked MDL", align: "right" },
          ],
          rows: rows.map((r) => ({
            key: r.id,
            cells: [
              r.label,
              orNR(r.value, fmtPct),
              r.lo !== null && r.hi !== null ? `${fmtPct(r.lo)}–${fmtPct(r.hi)}` : "Not recorded",
              orNR(r.median, fmtPct),
              orNR(r.national, fmtPct),
              r.mdls.join(", "),
            ],
          })),
        }}
      >
        <BulletBand
          rows={rows.map((r) => ({
            id: r.id,
            label: r.label,
            value: r.value,
            min: r.min,
            median: r.median,
            max: r.max,
            note: r.national !== null ? `US ${fmtPct(r.national)}` : undefined,
          }))}
          format={fmtPct}
          focusLabel={county.county ?? "County"}
          benchmarkLabel={`${county.stateName} counties`}
          ariaLabel={`MDL-linked conditions in ${name} against ${county.stateName}'s counties`}
        />
      </ChartCard>
      <AiSummary context={context} className="mt-3" />
    </Section>
  );
}
