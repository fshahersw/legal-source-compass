/**
 * Medicare Part D prescriptions in one state for the drugs named in MDL titles: which MDL drugs are prescribed most
 * (latest data year; a total missing a product CMS hid is shown as "at least") and how one MDL's claims moved over the
 * years. MDLs that name the same drugs share one bar. Renders nothing without data.
 */
import { useMemo, useState } from "react";
import { ChartCard } from "@/components/charts/ChartCard";
import { periodTable, RankBars, TrendColumns, trendTakeaway } from "@/components/charts/recharts";
import { AiSummary, AskAiButton, buildSectionContext } from "@/components/kit";
import type { PartdPart } from "@/lib/external/exposureGeo.functions";
import {
  boundedTakeaway,
  boundedText,
  claimsSeries,
  latestYear,
  PARTD_SOURCE,
  rankText,
  stateMdlRows,
  type StateMdlRow,
} from "./exposureModel";
import { NOT_RECORDED } from "@/components/charts/format";
import { AboutList, fmtInt, fmtShare, PARTD_ABOUT, Picker } from "./exposureParts";

const shareText = (r: StateMdlRow) =>
  r.share === null ? null : `${r.lowerBound ? "at least " : ""}${fmtShare(r.share)}`;

/** Tooltip and AI note for a bounded total. */
export function boundNote(r: StateMdlRow): string | null {
  if (!r.lowerBound) return null;
  const hidden = r.missingProducts.length ? ` (${r.missingProducts.join(", ")})` : "";
  return r.claimsMax !== null
    ? `At most ${fmtInt(r.claimsMax)}: CMS hid ${r.missingProducts.length} product${r.missingProducts.length === 1 ? "" : "s"} under 11 claims${hidden}`
    : `CMS hid a product under 11 claims${hidden}`;
}

export function PartdExposureBlock({ part, stateName }: { part: PartdPart; stateName: string }) {
  const year = latestYear(part.national);
  const rows = useMemo(
    () => (year === null ? [] : stateMdlRows(part.state, part.national, year)),
    [part, year],
  );
  const [pick, setPick] = useState<string | null>(null);
  const selectedRow = rows.find((r) => pick !== null && r.mdls.includes(pick)) ?? rows[0];
  const selected = part.state.find((e) => e.mdl === selectedRow?.mdls[0]);
  const years = useMemo(
    () =>
      [...new Set(part.national.flatMap((e) => e.series.map((p) => p.year)))].sort((a, b) => a - b),
    [part.national],
  );
  const series = selected ? claimsSeries(selected, years) : [];
  if (!part.state.length || year === null) return null;

  const barLabel = (r: StateMdlRow) => (r.lowerBound ? `${r.label} (at least)` : r.label);
  const items = rows.map((r) => ({ id: r.id, label: barLabel(r), value: r.claims }));
  const title = boundedTakeaway(rows, (v) => `${fmtInt(v)} claims`);
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
        note: r.lowerBound ? `at least; ${boundNote(r)}` : undefined,
      },
      { label: `${r.label} share of national claims`, value: shareText(r) },
      { label: `${r.label} rank among the 50 states and DC`, value: rankText(r.rank) },
    ]),
    maxFigures: 30,
  });
  const trendLabel = selectedRow?.label ?? selected?.label ?? "";
  const trendTitle = selected
    ? (trendTakeaway(
        `${trendLabel} Part D claims`,
        series.map((s) => ({ label: s.year, value: s.claims, partial: s.partial })),
        fmtInt,
      ) ?? `${trendLabel} Part D claims per year`)
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
              boundedText(r, fmtInt) ?? NOT_RECORDED,
              shareText(r) ?? NOT_RECORDED,
              rankText(r.rank) ?? "Not ranked",
            ],
          })),
        }}
        actions={<AskAiButton sectionId="exposure-partd" context={context} size="icon" />}
      >
        <RankBars
          items={items}
          format={fmtInt}
          limit={10}
          labelWidth={240}
          ariaLabel={`Part D claims by MDL drug, ${stateName}, ${year}`}
          note={(id) => {
            const r = rows.find((x) => x.id === id);
            if (!r) return null;
            const share = shareText(r);
            const text = [share ? `${share} of national claims` : null, boundNote(r)]
              .filter(Boolean)
              .join(". ");
            return text || null;
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
              ? "Years marked partial miss a product CMS hid (fewer than 11 claims each); the bar is a lower bound."
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
              options={rows.map((r) => ({ id: r.mdls[0]!, label: r.label }))}
              onChange={setPick}
            />
          }
          table={periodTable(series, "year", [{ key: "claims", label: "Claims" }], fmtInt, {
            caption: `${trendLabel} Part D claims, ${stateName}`,
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
            ariaLabel={`${trendLabel} Part D claims per year, ${stateName}`}
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
