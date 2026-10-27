/**
 * MDL block: where the MDL's exposure is found by state. For an MDL whose title names a drug, Medicare Part D claims by
 * prescriber state (latest year; a total missing a product CMS hid is shown as "at least") and the national claims per
 * year; for the AFFF MDL (2873), the share of tested large public water systems that found PFAS, by state. Renders
 * nothing when no published dataset covers the MDL. Mounted in the MDL command page's JPML section (JpmlSection),
 * after the JPML actions series, where the former case lens (/matters/lens/$mdl, now a redirect) showed it.
 */
import { useQuery } from "@tanstack/react-query";
import { ChartCard } from "@/components/charts/ChartCard";
import { NOT_RECORDED } from "@/components/charts/format";
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
  boundedTakeaway,
  boundedText,
  claimsSeries,
  COMPARED_STATES,
  median,
  PARTD_SOURCE,
  pointFor,
  rankText,
  SDWIS_SOURCE,
  UCMR_SOURCE,
  type PartdExposure,
  type PartdRank,
  type UcmrState,
} from "./exposureModel";
import {
  AboutList,
  fmtInt,
  fmtShare,
  orNR,
  PARTD_ABOUT,
  PFAS_ABOUT,
  ucmrPartial,
  ucmrPeriod,
} from "./exposureParts";

export function MdlExposurePanel({ mdl }: { mdl: string }) {
  const q = useQuery(mdlExposureQuery(mdl));
  if (q.isError)
    return (
      <Section id="mdl-exposure" title="Exposure by state">
        <p role="alert" className="text-xs text-muted-foreground">
          Exposure figures could not load.{" "}
          <button type="button" className="underline" onClick={() => void q.refetch()}>
            Retry
          </button>
        </p>
      </Section>
    );
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

export type PartdStateRow = {
  id: string;
  label: string;
  claims: number | null;
  claimsMax: number | null;
  lowerBound: boolean;
  missingProducts: string[];
  rank: PartdRank | null;
  /** One of the 50 states or DC (territories are listed, not compared). */
  compared: boolean;
};

/** States in the latest national year, with their published intervals and ranks; exported for tests. */
export function partdStateRows(records: readonly PartdExposure[]) {
  const nation = records.find((r) => r.geo.level === "national") ?? null;
  const year = nation?.series.at(-1)?.year ?? null;
  const rows: PartdStateRow[] = records
    .filter((r) => r.geo.level === "state")
    .map((r) => {
      const p = year === null ? null : pointFor(r, year);
      return {
        id: r.geo.usps,
        label: r.geo.name,
        claims: p?.claims ?? null,
        claimsMax: p ? p.claimsMax : null,
        lowerBound: p?.lowerBound ?? false,
        missingProducts: p?.missingProducts ?? [],
        rank: r.latestRank && r.latestRank.year === year ? r.latestRank : null,
        compared: COMPARED_STATES.has(r.geo.usps),
      };
    })
    .sort((a, b) => (b.claims ?? -1) - (a.claims ?? -1) || a.label.localeCompare(b.label));
  const dist =
    nation?.stateDistribution && nation.stateDistribution.year === year
      ? nation.stateDistribution
      : null;
  return { nation, year, rows, dist };
}

/** "12,345" or "12,345–12,355" for the median state's interval. */
export function medianText(lo: number | null, hi: number | null): string | null {
  if (lo === null) return null;
  return hi === null || hi === lo ? fmtInt(lo) : `${fmtInt(lo)}–${fmtInt(hi)}`;
}

function PartdByState({ mdl, records }: { mdl: string; records: readonly PartdExposure[] }) {
  const { nation, year, rows, dist } = partdStateRows(records);
  if (!nation || year === null) return null;
  const years = nation.series.map((p) => p.year);
  const series = claimsSeries(nation, years);
  const latest = nation.series.at(-1) ?? null;
  const compared = rows.filter((r) => r.compared);
  const items = compared.map((r) => ({
    id: r.id,
    label: r.lowerBound ? `${r.label} (at least)` : r.label,
    value: r.claims,
  }));
  const mid = dist ? medianText(dist.medianLo, dist.medianHi) : null;
  const label = nation.label;
  const shareText = (r: PartdStateRow) =>
    r.rank?.shareOfNational == null
      ? NOT_RECORDED
      : `${r.rank.shareIsLowerBound ? "at least " : ""}${fmtShare(r.rank.shareOfNational)}`;
  const context = buildSectionContext({
    id: "mdl-exposure-partd",
    title: `Medicare Part D claims for MDL ${mdl} drugs by state`,
    scope: `${label}; by prescriber state; 50 states and DC compared`,
    period: String(year),
    source: PARTD_SOURCE.label,
    figures: [
      { label: "National claims", value: latest?.claims ?? null, unit: "claims" },
      {
        label: "Median state claims",
        value: mid,
        unit: "claims",
        note:
          dist && dist.medianHi !== dist.medianLo
            ? "range: CMS hides products under 11 claims"
            : undefined,
      },
      ...compared
        .filter((r) => r.claims !== null)
        .slice(0, 10)
        .map((r) => ({
          label: r.label,
          value: r.claims,
          unit: "claims",
          note: r.lowerBound ? "at least" : undefined,
        })),
      ...series.map((s) => ({ label: "National claims", value: s.claims, period: s.year })),
    ],
    maxFigures: 30,
  });
  return (
    <div className="space-y-3" data-testid="mdl-exposure-partd">
      <ChartCard
        variant="editorial"
        title={
          boundedTakeaway(compared, (v) => `${fmtInt(v)} claims`) ??
          `Part D claims for ${label} by state, ${year}`
        }
        subtitle={`Medicare Part D claims · ${label} · by prescriber state · ${year}`}
        kpis={[
          { label: "National claims", value: orNR(latest?.claims, fmtInt), detail: String(year) },
          {
            label: "Median state",
            value: mid ?? NOT_RECORDED,
            detail: dist
              ? `of ${dist.states} (50 states and DC)${dist.medianHi !== dist.medianLo ? "; a range where CMS hid products" : ""}`
              : undefined,
          },
        ]}
        sources={[PARTD_SOURCE]}
        period={String(year)}
        about={
          <AboutList
            items={[
              ...PARTD_ABOUT,
              "Territories are listed in View data but not ranked or counted in the median.",
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
              boundedText(r, fmtInt) ?? NOT_RECORDED,
              shareText(r),
              r.compared ? (rankText(r.rank) ?? "Not ranked") : "Territory, not ranked",
            ],
          })),
        }}
      >
        <RankBars
          items={items}
          format={fmtInt}
          limit={15}
          references={benchmark("Median state", dist?.medianLo ?? null, fmtInt)}
          ariaLabel={`Part D claims for ${label} by state, ${year}`}
          note={(id) => {
            const r = rows.find((x) => x.id === id);
            if (!r?.lowerBound || r.claimsMax === null) return null;
            return `At most ${fmtInt(r.claimsMax)}: CMS hid ${r.missingProducts.join(", ") || "a product"} (under 11 claims)`;
          }}
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

/** PFAS rows: every agency for the table; the 50 states and DC compared on large systems; exported for tests. */
export function pfasStateRows(states: readonly UcmrState[]) {
  const nation = states.find((s) => s.agency === "US") ?? null;
  const rows = states
    .filter((s) => s.agency !== "US")
    .map((s) => ({
      id: s.agency,
      label: s.agencyName,
      share: s.systemsSampled ? s.systemsWithDetect / s.systemsSampled : null,
      largeShare:
        s.largeSampled && s.largeWithDetect !== null ? s.largeWithDetect / s.largeSampled : null,
      compared: COMPARED_STATES.has(s.agency),
      s,
    }));
  const compared = rows.filter((r) => r.compared);
  const largeShares = compared.map((r) => r.largeShare).filter((v): v is number => v !== null);
  return { nation, rows, compared, median: median(largeShares), medianOf: largeShares.length };
}

function PfasByState({ states }: { states: readonly UcmrState[] }) {
  const { nation, rows, compared, median: mid, medianOf } = pfasStateRows(states);
  if (!nation) return null;
  const nationalShare = nation.systemsSampled
    ? nation.systemsWithDetect / nation.systemsSampled
    : null;
  const nationalLarge =
    nation.largeSampled && nation.largeWithDetect !== null
      ? nation.largeWithDetect / nation.largeSampled
      : null;
  const period = ucmrPeriod(nation);
  const items = compared.map((r) => ({
    id: r.id,
    label: r.label,
    value: r.largeShare === null ? null : r.largeShare * 100,
  }));
  const pct = (v: number) => `${v.toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
  const context = buildSectionContext({
    id: "mdl-exposure-pfas",
    title: "PFAS in public drinking water by state (UCMR 5)",
    scope:
      "Public water systems tested under UCMR 5; states compared on large systems (more than 10,000 people, all tested); exposure geography for MDL 2873 (AFFF)",
    period,
    source: UCMR_SOURCE.label,
    figures: [
      { label: "Systems tested nationally", value: nation.systemsSampled },
      { label: "Systems with PFAS detected nationally", value: nation.systemsWithDetect },
      {
        label: "Share of large systems with PFAS nationally",
        value: nationalLarge === null ? null : fmtShare(nationalLarge),
      },
      {
        label: "People served by community systems with PFAS",
        value: nation.populationWithDetectCws.sum,
        unit: "people",
      },
      {
        label: "Median state share of large systems with PFAS",
        value: mid === null ? null : fmtShare(mid),
        note: `${medianOf} of the 50 states and DC`,
      },
      ...[...compared]
        .filter((r) => r.largeShare !== null)
        .sort((a, b) => b.largeShare! - a.largeShare!)
        .slice(0, 10)
        .map((r) => ({
          label: `${r.label}, share of large systems with PFAS`,
          value: fmtShare(r.largeShare!),
        })),
    ],
    maxFigures: 20,
  });
  return (
    <div className="space-y-3" data-testid="mdl-exposure-pfas">
      <ChartCard
        variant="editorial"
        title={
          rankTakeaway(items, pct) ?? "Share of tested large water systems with PFAS, by state"
        }
        subtitle={`Share of large public water systems (more than 10,000 people) with any of 29 PFAS detected · 50 states and DC · ${period}`}
        kpis={[
          {
            label: "Systems with PFAS",
            value: `${fmtInt(nation.systemsWithDetect)} of ${fmtInt(nation.systemsSampled)}`,
            detail: nationalShare !== null ? `${fmtShare(nationalShare)}, all tested` : undefined,
          },
          {
            label: "Large systems with PFAS",
            value: orNR(nationalLarge, fmtShare),
            detail:
              nation.largeSampled !== null && nation.largeWithDetect !== null
                ? `${fmtInt(nation.largeWithDetect)} of ${fmtInt(nation.largeSampled)}`
                : undefined,
          },
          {
            label: "PFOA or PFOS at or above 4 ng/L",
            value: fmtInt(nation.systemsAtOrAbove4),
            detail: "systems, single results",
          },
          {
            label: "People served by community systems with PFAS",
            value: orNR(nation.populationWithDetectCws.sum, fmtInt),
          },
        ]}
        sources={[UCMR_SOURCE, SDWIS_SOURCE]}
        period={period}
        partial={ucmrPartial(nation)}
        about={
          <AboutList
            items={[
              ...PFAS_ABOUT,
              "Territories and tribal systems (grouped by EPA region, as EPA codes them) are listed in View data but not counted in the median state.",
            ]}
          />
        }
        actions={<AskAiButton sectionId="mdl-exposure-pfas" context={context} size="icon" />}
        table={{
          caption: "PFAS in public drinking water by state",
          columns: [
            { label: "State or agency" },
            { label: "Systems tested", align: "right" },
            { label: "With PFAS", align: "right" },
            { label: "Share, all tested", align: "right" },
            { label: "Share, large systems", align: "right" },
            { label: "PFOA/PFOS ≥ 4 ng/L", align: "right" },
            { label: "People served (community systems with PFAS)", align: "right" },
          ],
          rows: rows.map((r) => ({
            key: r.id,
            cells: [
              r.compared ? r.label : `${r.label} (not compared)`,
              fmtInt(r.s.systemsSampled),
              fmtInt(r.s.systemsWithDetect),
              orNR(r.share, fmtShare),
              orNR(r.largeShare, fmtShare),
              fmtInt(r.s.systemsAtOrAbove4),
              orNR(r.s.populationWithDetectCws.sum, fmtInt),
            ],
          })),
        }}
      >
        <RankBars
          items={items}
          format={pct}
          limit={15}
          references={benchmark("Median state", mid === null ? null : mid * 100, pct)}
          ariaLabel="Share of tested large water systems with PFAS, by state"
          note={(id) => {
            const r = rows.find((x) => x.id === id);
            return r && r.s.largeSampled !== null && r.s.largeWithDetect !== null
              ? `${fmtInt(r.s.largeWithDetect)} of ${fmtInt(r.s.largeSampled)} large systems`
              : null;
          }}
        />
      </ChartCard>
      <AiSummary context={context} />
    </div>
  );
}
