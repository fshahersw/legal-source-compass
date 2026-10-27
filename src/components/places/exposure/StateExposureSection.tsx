/**
 * "Exposure" section of a state page: where people who were prescribed MDL drugs, who have conditions those drugs
 * treat, or whose drinking water carries PFAS are found. Opens with up to four key figures, then one block per source
 * (Medicare Part D, CDC PLACES, EPA UCMR 5). Each block renders only when its dataset is published; with none published
 * the section renders nothing. Not mounted yet: see the de-exposure report for the mount point.
 */
import { useQuery } from "@tanstack/react-query";
import { KpiCard, KpiGrid, Section } from "@/components/kit";
import type { StateExposure } from "@/lib/external/exposureGeo.functions";
import { stateExposureQuery } from "./exposureQueries";
import {
  latestYear,
  linkedMeasures,
  measureDistribution,
  PARTD_SOURCE,
  PLACES_SOURCE,
  stateMdlRows,
  UCMR_SOURCE,
} from "./exposureModel";
import { fmtInt, fmtPct, fmtShare } from "./exposureParts";
import { PartdExposureBlock } from "./PartdExposureBlock";
import { PfasExposureBlock } from "./PfasExposureBlock";
import { PlacesExposureBlock } from "./PlacesExposureBlock";

export function StateExposureSection({ usps, stateName }: { usps: string; stateName: string }) {
  const q = useQuery(stateExposureQuery(usps));
  if (q.isError)
    return (
      <Section id="exposure" title="Exposure">
        <p role="alert" className="text-xs text-muted-foreground">
          Exposure figures could not load.{" "}
          <button type="button" className="underline" onClick={() => void q.refetch()}>
            Retry
          </button>
        </p>
      </Section>
    );
  if (!q.data) return null;
  return <StateExposureView data={q.data} stateName={stateName} />;
}

/** The section for loaded data; null when no exposure dataset is published. Exported for tests. */
export function StateExposureView({ data, stateName }: { data: StateExposure; stateName: string }) {
  const { partd, places, pfas } = data;
  if (!partd && !places && !pfas) return null;
  const kpis = stateKpis(data);
  return (
    <Section
      id="exposure"
      title="Exposure"
      description="Where people prescribed MDL drugs, people with linked conditions and PFAS-affected water systems are. These are populations, not plaintiffs."
    >
      {kpis.length ? (
        <KpiGrid columns={4} label={`Exposure figures, ${stateName}`} className="mb-4">
          {kpis.map((k) => (
            <KpiCard
              key={k.label}
              as="li"
              label={k.label}
              value={k.value}
              meta={k.meta}
              source={{ source: { label: k.source.label, href: k.source.url }, period: k.period }}
            />
          ))}
        </KpiGrid>
      ) : null}
      <div className="space-y-6">
        {partd && partd.state.length ? <PartdExposureBlock part={partd} stateName={stateName} /> : null}
        {places ? <PlacesExposureBlock part={places} stateName={stateName} /> : null}
        {pfas ? <PfasExposureBlock part={pfas} stateName={stateName} /> : null}
      </div>
    </Section>
  );
}

type Kpi = {
  label: string;
  value: string | null;
  meta: string;
  period: string;
  source: { label: string; url: string };
};

/** Up to four headline figures, each from a published value; a part without data adds none. */
export function stateKpis(data: StateExposure): Kpi[] {
  const out: Kpi[] = [];
  const { partd, places, pfas } = data;
  if (partd) {
    const year = latestYear(partd.national);
    const top = year === null ? null : stateMdlRows(partd.state, partd.national, year).find((r) => r.claims !== null);
    if (top && year !== null)
      out.push({
        label: "Most-prescribed MDL drug",
        value: `${fmtInt(top.claims!)} claims`,
        meta: `${top.label}${top.share !== null ? `, ${fmtShare(top.share)} of national` : ""}`,
        period: String(year),
        source: PARTD_SOURCE,
      });
  }
  if (places && places.counties.length) {
    const measures = linkedMeasures(places.counties);
    const m = measures.find((x) => x.id === "DIABETES") ?? measures[0];
    if (m) {
      const d = measureDistribution(places.counties, m.id);
      out.push({
        label: m.label,
        value: d.median === null ? null : fmtPct(d.median),
        meta: `median of ${d.recorded} counties`,
        period: m.year,
        source: PLACES_SOURCE,
      });
    }
  }
  if (pfas?.state) {
    const s = pfas.state;
    const period = s.firstSample && s.lastSample ? `${s.firstSample.slice(0, 4)}–${s.lastSample.slice(0, 4)}` : "UCMR 5";
    out.push({
      label: "Water systems with PFAS detected",
      value: `${fmtInt(s.systemsWithDetect)} of ${fmtInt(s.systemsSampled)}`,
      meta: "public water systems tested",
      period,
      source: UCMR_SOURCE,
    });
    out.push({
      label: "People served by those systems",
      value: s.populationWithDetect.sum === null ? null : fmtInt(s.populationWithDetect.sum),
      meta: "population served, SDWIS",
      period,
      source: UCMR_SOURCE,
    });
  }
  return out.slice(0, 4);
}
