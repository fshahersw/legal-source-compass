/**
 * Medicare Part D prescriptions in one state for the drugs named in MDL titles: which MDL drugs are prescribed most
 * (latest data year, complete totals only) and how one MDL's claims moved over the years. Renders nothing without data.
 */
import { useMemo, useState } from "react";
import { ChartCard } from "@/components/charts/ChartCard";
import {
  periodTable,
  RankBars,
  rankTakeaway,
  TrendColumns,
  trendTakeaway,
} from "@/components/charts/recharts";
import { AiSummary, AskAiButton, buildSectionContext } from "@/components/kit";
import type { PartdPart } from "@/lib/external/exposureGeo.functions";
import { claimsSeries, latestYear, PARTD_SOURCE, stateMdlRows } from "./exposureModel";
import { AboutList, fmtInt, fmtShare, orNR, PARTD_ABOUT, Picker } from "./exposureParts";

export function PartdExposureBlock({ part, stateName }: { part: PartdPart; stateName: string }) {
  const year = latestYear(part.national);
  const rows = useMemo(
    () => (year === null ? [] : stateMdlRows(part.state, part.national, year)),
    [part, year],
  );
  const [pick, setPick] = useState<string | null>(null);
  const selected =
    part.state.find((e) => e.mdl === pick) ?? part.state.find((e) => e.mdl === rows[0]?.mdl);
  const years = useMemo(
    () =>
      [...new Set(part.national.flatMap((e) => e.series.map((p) => p.year)))].sort((a, b) => a - b),
    [part.national],
  );
  const series = selected ? claimsSeries(selected, years) : [];
  if (!part.state.length || year === null) return null;

  const items = rows.map((r) => ({ id: r.id, label: r.label, value: r.claims }));
  const title = rankTakeaway(
    items.map((i) => ({ label: i.label, value: i.value })),
    (v) => `${fmtInt(v)} claims`,
  );
  const context = buildSectionContext({
    id: "exposure-partd",
    title: `Medicare Part D claims for MDL drugs, ${stateName}`,
    scope: `${stateName}, by prescriber state; drugs named in products-liability MDL titles`,
    period: String(year),
    source: PARTD_SOURCE.label,
    figures: rows.slice(0, 10).flatMap((r) => [
      {
        label: `${r.label} claims`,
        value: r.claims,
        unit: "claims",
        note: r.lowerBound ? "lower bound, not ranked" : undefined,
      },
      {
        label: `${r.label} share of national claims`,
        value: r.share === null ? null : fmtShare(r.share),
      },
      {
        label: `${r.label} rank among states`,
        value: r.rank ? `${r.rank.rank} of ${r.rank.of}` : null,
      },
    ]),
    maxFigures: 30,
  });
  const trendTitle = selected
    ? (trendTakeaway(
        `${selected.label} Part D claims`,
        series.map((s) => ({ label: s.year, value: s.claims, partial: s.partial })),
        fmtInt,
      ) ?? `${selected.label} Part D claims per year`)
    : "Part D claims per year";

  return (
    <div className="space-y-3" data-testid="exposure-partd">
      <ChartCard
        variant="editorial"
        title={title ?? `Medicare Part D claims for MDL drugs, ${stateName}, ${year}`}
        subtitle={`Prescription fills · prescribers in ${stateName} · ${year}`}
        sources={[PARTD_SOURCE]}
        period={String(year)}
        about={<AboutList items={PARTD_ABOUT} />}
        table={{
          caption: `Part D claims by MDL drug, ${stateName}, ${year}`,
          columns: [
            { label: "MDL drug" },
            { label: "Claims", align: "right" },
            { label: "Share of national", align: "right" },
            { label: "Rank among states", align: "right" },
          ],
          rows: rows.map((r) => ({
            key: r.id,
            cells: [
              `${r.label} (${r.title})`,
              r.lowerBound ? `at least ${orNR(r.atLeast, fmtInt)}` : orNR(r.claims, fmtInt),
              orNR(r.share, fmtShare),
              r.rank ? `${r.rank.rank} of ${r.rank.of}` : "Not ranked",
            ],
          })),
        }}
        actions={<AskAiButton sectionId="exposure-partd" context={context} size="icon" />}
      >
        <RankBars
          items={items}
          format={fmtInt}
          limit={10}
          labelWidth={220}
          ariaLabel={`Part D claims by MDL drug, ${stateName}, ${year}`}
          note={(id) => {
            const r = rows.find((x) => x.id === id);
            return r?.share != null ? `${fmtShare(r.share)} of national claims` : null;
          }}
        />
      </ChartCard>
      {selected ? (
        <ChartCard
          title={trendTitle}
          subtitle={`Claims per year · prescribers in ${stateName} · ${years[0]}–${years.at(-1)}`}
          sources={[PARTD_SOURCE]}
          period={`${years[0]}–${years.at(-1)}`}
          partial={
            series.some((s) => s.partial)
              ? "Years marked partial miss a product CMS hid (fewer than 11 claims); the bar is a lower bound."
              : undefined
          }
          about={
            <AboutList
              items={[
                ...PARTD_ABOUT,
                `Drugs counted: ${selected.brandNames.length ? selected.brandNames.join(", ") : selected.genericNames.join(", ")}.`,
              ]}
            />
          }
          actions={
            <Picker
              id="exposure-partd-mdl"
              label="MDL"
              value={selected.mdl}
              options={rows.map((r) => ({ id: r.mdl, label: r.label }))}
              onChange={setPick}
            />
          }
          table={periodTable(series, "year", [{ key: "claims", label: "Claims" }], fmtInt, {
            caption: `${selected.label} Part D claims, ${stateName}`,
            xLabel: "Year",
            partialKey: "partial",
          })}
        >
          <TrendColumns
            rows={series}
            xKey="year"
            series={[{ key: "claims", label: "Claims" }]}
            format={fmtInt}
            partialKey="partial"
            ariaLabel={`${selected.label} Part D claims per year, ${stateName}`}
          />
        </ChartCard>
      ) : null}
      <AiSummary
        context={context}
        actions={
          <AskAiButton
            sectionId="exposure-partd"
            title="Part D claims for MDL drugs"
            context={context}
            questions={[
              "Which MDL drugs are prescribed most here compared with other states?",
              "What do these prescription counts leave out?",
            ]}
          />
        }
      />
    </div>
  );
}
