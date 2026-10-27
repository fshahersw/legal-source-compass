/**
 * MDL block: where the MDL's exposure is found by state. For an MDL whose title names a drug, Medicare Part D claims by
 * prescriber state (latest year, complete totals only) and the national claims per year; for the AFFF MDL (2873), the
 * share of tested public water systems that found PFAS, by state. Renders nothing when no published dataset covers the
 * MDL. Not mounted yet: see the de-exposure report.
 */
import { useQuery } from "@tanstack/react-query";
import { ChartCard } from "@/components/charts/ChartCard";
import {
  benchmark,
  periodTable,
  RankBars,
  rankTakeaway,
  TrendColumns,
  trendTakeaway,
} from "@/components/charts/recharts";
import { AiSummary, AskAiButton, buildSectionContext, Section } from "@/components/kit";
import type { MdlExposure } from "@/lib/external/exposureGeo.functions";
import { mdlExposureQuery } from "./exposureQueries";
import {
  claimsSeries,
  median,
  PARTD_SOURCE,
  pointFor,
  SDWIS_SOURCE,
  UCMR_SOURCE,
  type PartdExposure,
  type UcmrState,
} from "./exposureModel";
import { AboutList, fmtInt, fmtShare, orNR, PARTD_ABOUT, PFAS_ABOUT } from "./exposureParts";

export function MdlExposurePanel({ mdl }: { mdl: string }) {
  const q = useQuery(mdlExposureQuery(mdl));
  if (!q.data) return null;
  return <MdlExposureView data={q.data} />;
}

export function MdlExposureView({ data }: { data: MdlExposure }) {
  if (!data.partd && !data.pfas) return null;
  return (
    <Section
      id="mdl-exposure"
      title="Exposure by state"
      description="Where the products or contaminants this MDL concerns are found. Populations, not plaintiffs."
    >
      <div className="space-y-6">
        {data.partd ? <PartdByState mdl={data.mdl} records={data.partd} /> : null}
        {data.pfas ? <PfasByState states={data.pfas} /> : null}
      </div>
    </Section>
  );
}

/** States ranked by complete claims in the latest national year; exported for tests. */
export function partdStateRows(records: readonly PartdExposure[]) {
  const nation = records.find((r) => r.geo.level === "national") ?? null;
  const year = nation?.series.at(-1)?.year ?? null;
  const states = records.filter((r) => r.geo.level === "state");
  const rows = states.map((r) => {
    const p = year === null ? null : pointFor(r, year);
    return {
      id: r.geo.usps,
      label: r.geo.name,
      claims: p && !p.lowerBound ? p.claims : null,
      lowerBound: p?.lowerBound ?? false,
      rank: r.latestRank && r.latestRank.year === year ? r.latestRank : null,
    };
  });
  return { nation, year, rows };
}

function PartdByState({ mdl, records }: { mdl: string; records: readonly PartdExposure[] }) {
  const { nation, year, rows } = partdStateRows(records);
  if (!nation || year === null) return null;
  const years = nation.series.map((p) => p.year);
  const series = claimsSeries(nation, years);
  const values = rows.map((r) => r.claims).filter((v): v is number => v !== null);
  const mid = median(values);
  const latest = nation.series.at(-1) ?? null;
  const items = rows.map((r) => ({ id: r.id, label: r.label, value: r.claims }));
  const label = nation.label;
  const context = buildSectionContext({
    id: "mdl-exposure-partd",
    title: `Medicare Part D claims for MDL ${mdl} drugs by state`,
    scope: `${label}; by prescriber state`,
    period: String(year),
    source: PARTD_SOURCE.label,
    figures: [
      { label: "National claims", value: latest?.claims ?? null, unit: "claims" },
      { label: "Median state claims", value: mid, unit: "claims" },
      ...[...rows]
        .filter((r) => r.claims !== null)
        .sort((a, b) => b.claims! - a.claims!)
        .slice(0, 10)
        .map((r) => ({ label: r.label, value: r.claims, unit: "claims" })),
      ...series.map((s) => ({ label: "National claims", value: s.claims, period: s.year })),
    ],
    maxFigures: 30,
  });
  return (
    <div className="space-y-3" data-testid="mdl-exposure-partd">
      <ChartCard
        variant="editorial"
        title={
          rankTakeaway(items, (v) => `${fmtInt(v)} claims`) ??
          `Part D claims for ${label} by state, ${year}`
        }
        subtitle={`Medicare Part D claims · ${label} · by prescriber state · ${year}`}
        kpis={[
          { label: "National claims", value: orNR(latest?.claims, fmtInt), detail: String(year) },
          {
            label: "Median state",
            value: orNR(mid, fmtInt),
            detail: `${values.length} states with a complete figure`,
          },
        ]}
        sources={[PARTD_SOURCE]}
        period={String(year)}
        about={
          <AboutList
            items={[
              ...PARTD_ABOUT,
              `Drugs counted: ${nation.brandNames.length ? nation.brandNames.join(", ") : nation.genericNames.join(", ")}.`,
            ]}
          />
        }
        actions={<AskAiButton sectionId="mdl-exposure-partd" context={context} size="icon" />}
        table={{
          caption: `Part D claims for ${label} by state, ${year}`,
          columns: [
            { label: "State" },
            { label: "Claims", align: "right" },
            { label: "Share of national", align: "right" },
            { label: "Rank", align: "right" },
          ],
          rows: rows.map((r) => ({
            key: r.id,
            cells: [
              r.label,
              r.lowerBound ? "Lower bound (product hidden)" : orNR(r.claims, fmtInt),
              orNR(r.rank?.shareOfNational, fmtShare),
              r.rank ? `${r.rank.rank} of ${r.rank.of}` : "Not ranked",
            ],
          })),
        }}
      >
        <RankBars
          items={items}
          format={fmtInt}
          limit={15}
          references={benchmark("Median state", mid, fmtInt)}
          ariaLabel={`Part D claims for ${label} by state, ${year}`}
        />
      </ChartCard>
      <ChartCard
        title={
          trendTakeaway(
            `${label} Part D claims`,
            series.map((s) => ({ label: s.year, value: s.claims })),
            fmtInt,
          ) ?? `${label} Part D claims per year`
        }
        subtitle={`Claims per year · United States · ${years[0]}–${years.at(-1)}`}
        sources={[PARTD_SOURCE]}
        period={`${years[0]}–${years.at(-1)}`}
        about={<AboutList items={PARTD_ABOUT} />}
        table={periodTable(series, "year", [{ key: "claims", label: "Claims" }], fmtInt, {
          caption: `${label} Part D claims, United States`,
          xLabel: "Year",
        })}
      >
        <TrendColumns
          rows={series}
          xKey="year"
          series={[{ key: "claims", label: "Claims" }]}
          format={fmtInt}
          ariaLabel={`${label} Part D claims per year, United States`}
        />
      </ChartCard>
      <AiSummary context={context} />
    </div>
  );
}

function PfasByState({ states }: { states: readonly UcmrState[] }) {
  const nation = states.find((s) => s.agency === "US") ?? null;
  const rows = states
    .filter((s) => s.agency !== "US")
    .map((s) => ({
      id: s.agency,
      label: s.agencyName,
      share: s.systemsSampled ? s.systemsWithDetect / s.systemsSampled : null,
      s,
    }));
  if (!nation) return null;
  const nationalShare = nation.systemsSampled
    ? nation.systemsWithDetect / nation.systemsSampled
    : null;
  // States, DC and territories are compared; tribal systems (EPA regions, Navajo Nation) stay in the table only.
  const compared = rows.filter((r) => /^[A-Z]{2}$/.test(r.id) && r.id !== "NN");
  const shares = compared.map((r) => r.share).filter((v): v is number => v !== null);
  const mid = median(shares);
  const period =
    nation.firstSample && nation.lastSample
      ? `${nation.firstSample} to ${nation.lastSample}`
      : "UCMR 5";
  const items = compared.map((r) => ({
    id: r.id,
    label: r.label,
    value: r.share === null ? null : r.share * 100,
  }));
  const pct = (v: number) => `${v.toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
  const context = buildSectionContext({
    id: "mdl-exposure-pfas",
    title: "PFAS in public drinking water by state (UCMR 5)",
    scope: "Public water systems tested under UCMR 5; exposure geography for MDL 2873 (AFFF)",
    period,
    source: UCMR_SOURCE.label,
    figures: [
      { label: "Systems tested nationally", value: nation.systemsSampled },
      { label: "Systems with PFAS detected nationally", value: nation.systemsWithDetect },
      {
        label: "People served by systems with PFAS",
        value: nation.populationWithDetect.sum,
        unit: "people",
      },
      {
        label: "Median state share of systems with PFAS",
        value: mid === null ? null : fmtShare(mid),
      },
      ...[...rows]
        .filter((r) => r.share !== null)
        .sort((a, b) => b.share! - a.share!)
        .slice(0, 10)
        .map((r) => ({
          label: `${r.label}, share of systems with PFAS`,
          value: fmtShare(r.share!),
        })),
    ],
    maxFigures: 20,
  });
  return (
    <div className="space-y-3" data-testid="mdl-exposure-pfas">
      <ChartCard
        variant="editorial"
        title={rankTakeaway(items, pct) ?? "Share of tested water systems with PFAS, by state"}
        subtitle={`Share of tested public water systems with any of 29 PFAS detected · by state · ${period}`}
        kpis={[
          {
            label: "Systems with PFAS",
            value: `${fmtInt(nation.systemsWithDetect)} of ${fmtInt(nation.systemsSampled)}`,
            detail: nationalShare !== null ? fmtShare(nationalShare) : undefined,
          },
          {
            label: "PFOA or PFOS at or above 4 ng/L",
            value: fmtInt(nation.systemsAtOrAbove4),
            detail: "systems, single results",
          },
          {
            label: "People served by systems with PFAS",
            value: orNR(nation.populationWithDetect.sum, fmtInt),
          },
        ]}
        sources={[UCMR_SOURCE, SDWIS_SOURCE]}
        period={period}
        about={
          <AboutList
            items={[...PFAS_ABOUT, "Tribal systems are grouped by EPA region, as EPA codes them."]}
          />
        }
        actions={<AskAiButton sectionId="mdl-exposure-pfas" context={context} size="icon" />}
        table={{
          caption: "PFAS in public drinking water by state",
          columns: [
            { label: "State or agency" },
            { label: "Systems tested", align: "right" },
            { label: "With PFAS", align: "right" },
            { label: "Share", align: "right" },
            { label: "PFOA/PFOS ≥ 4 ng/L", align: "right" },
            { label: "People served (with PFAS)", align: "right" },
          ],
          rows: rows.map((r) => ({
            key: r.id,
            cells: [
              r.label,
              fmtInt(r.s.systemsSampled),
              fmtInt(r.s.systemsWithDetect),
              orNR(r.share, fmtShare),
              fmtInt(r.s.systemsAtOrAbove4),
              orNR(r.s.populationWithDetect.sum, fmtInt),
            ],
          })),
        }}
      >
        <RankBars
          items={items}
          format={pct}
          limit={15}
          references={benchmark("Median state", mid === null ? null : mid * 100, pct)}
          ariaLabel="Share of tested water systems with PFAS, by state"
        />
      </ChartCard>
      <AiSummary context={context} />
    </div>
  );
}
