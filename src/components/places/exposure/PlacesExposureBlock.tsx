/**
 * CDC PLACES county estimates in one state for the conditions linked to MDLs: which counties sit above or below the
 * state's typical county for the chosen condition. Renders nothing without data; says so when CDC published no county
 * estimates for the state.
 */
import { useMemo, useState } from "react";
import { ChartCard } from "@/components/charts/ChartCard";
import { DivergingDots } from "@/components/charts/d3/charts";
import { AiSummary, AskAiButton, buildSectionContext } from "@/components/kit";
import type { PlacesPart } from "@/lib/external/exposureGeo.functions";
import { derivedAdults, linkedMeasures, measureDistribution, PLACES_SOURCE } from "./exposureModel";
import { AboutList, fmtInt, fmtPct, orNR, Picker, PLACES_ABOUT } from "./exposureParts";

const SHOWN = 8;

export function PlacesExposureBlock({ part, stateName }: { part: PlacesPart; stateName: string }) {
  const measures = useMemo(() => linkedMeasures(part.counties), [part.counties]);
  const [pick, setPick] = useState<string | null>(null);
  const measure = measures.find((m) => m.id === pick) ?? measures[0] ?? null;
  const dist = useMemo(
    () => (measure ? measureDistribution(part.counties, measure.id) : null),
    [part.counties, measure],
  );
  if (!part.counties.length)
    return (
      <ChartCard
        title={`CDC published no county health estimates for ${stateName} in this release`}
        sources={[PLACES_SOURCE]}
        status={{
          kind: "empty",
          reason: "Not recorded for this state in the 2025 PLACES release.",
        }}
        about={<AboutList items={PLACES_ABOUT} />}
      />
    );
  if (!measure || !dist) return null;

  const recorded = dist.items
    .filter((i): i is typeof i & { value: number } => i.value !== null)
    .sort((a, b) => b.value - a.value);
  const picks =
    recorded.length <= SHOWN * 2
      ? recorded
      : [...recorded.slice(0, SHOWN), ...recorded.slice(-SHOWN)];
  const national = part.national?.measures.find((m) => m.id === measure.id)?.crude.v ?? null;
  const adults = derivedAdults(part.counties, measure.id);
  const top = recorded[0];
  const low = recorded.at(-1);
  const mdls = [...new Set(measure.links.flatMap((l) => l.mdls))];
  const title =
    top && low && dist.median !== null
      ? `${measure.label}: ${fmtPct(top.value)} in ${top.label} to ${fmtPct(low.value)} in ${low.label}; typical county ${fmtPct(dist.median)}`
      : `${measure.label} by county, ${stateName}`;
  const context = buildSectionContext({
    id: "exposure-places",
    title: `${measure.label} by county, ${stateName}`,
    scope: `${stateName} counties; linked to MDL ${mdls.join(", ")}`,
    period: measure.year,
    source: PLACES_SOURCE.label,
    figures: [
      { label: "Median county, crude prevalence", value: dist.median, unit: "%" },
      { label: "United States, crude prevalence", value: national, unit: "%" },
      {
        label: "Adults with the condition, derived (prevalence × adults)",
        value: adults,
        unit: "adults",
      },
      { label: "Counties with an estimate", value: dist.recorded },
      ...picks.map((p) => ({ label: p.label, value: p.value, unit: "%" })),
    ],
    maxFigures: 24,
  });

  return (
    <div className="space-y-3" data-testid="exposure-places">
      <ChartCard
        variant="editorial"
        title={title}
        subtitle={`Crude prevalence among adults · ${stateName} counties · ${measure.year}`}
        kpis={[
          {
            label: "Typical county",
            value: orNR(dist.median, fmtPct),
            detail: `median of ${dist.recorded} counties`,
          },
          { label: "United States", value: orNR(national, fmtPct) },
          {
            label: "Adults with the condition",
            value: orNR(adults, fmtInt),
            detail: "derived: prevalence × adults",
          },
        ]}
        sources={[
          PLACES_SOURCE,
          ...measure.links.map((l) => ({ label: l.sourceLabel, url: l.sourceUrl })),
        ]}
        period={measure.year}
        about={
          <AboutList
            items={[
              ...PLACES_ABOUT,
              ...measure.links.map(
                (l) => `MDL ${l.mdls.join(", ")}: ${l.relation}.${l.caveat ? ` ${l.caveat}` : ""}`,
              ),
              recorded.length > SHOWN * 2
                ? `The chart shows the ${SHOWN} highest and ${SHOWN} lowest counties; View data lists all.`
                : "The chart shows every county with an estimate.",
            ]}
          />
        }
        actions={
          <div className="flex items-end gap-2">
            <Picker
              id="exposure-places-measure"
              label="Condition"
              value={measure.id}
              options={measures.map((m) => ({ id: m.id, label: m.label }))}
              onChange={setPick}
            />
            <AskAiButton sectionId="exposure-places" context={context} size="icon" />
          </div>
        }
        table={{
          caption: `${measure.label}, ${stateName} counties, ${measure.year}`,
          columns: [
            { label: "County" },
            { label: "Crude prevalence", align: "right" },
            { label: "95% CI", align: "right" },
            { label: "Adults (18+)", align: "right" },
          ],
          rows: dist.items.map((i) => ({
            key: i.fips,
            cells: [
              i.label,
              orNR(i.value, fmtPct),
              i.lo !== null && i.hi !== null ? `${fmtPct(i.lo)}–${fmtPct(i.hi)}` : "Not recorded",
              orNR(i.adults, fmtInt),
            ],
          })),
        }}
      >
        {dist.median !== null ? (
          <DivergingDots
            items={picks.map((p) => ({ label: p.label, value: p.value }))}
            baseline={dist.median}
            baselineLabel="Median county"
            format={fmtPct}
            labelWidth={160}
          />
        ) : null}
      </ChartCard>
      <AiSummary
        context={context}
        actions={
          <AskAiButton
            sectionId="exposure-places"
            title={`${measure.label} by county`}
            context={context}
            questions={[
              "Which counties have the largest treated or affected population?",
              "How precise are these county estimates?",
            ]}
          />
        }
      />
    </div>
  );
}
