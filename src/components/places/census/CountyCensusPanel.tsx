import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { LoadingBlock, Panel, SourceLink, StateNote } from "@/components/enforcement/parts";
import { getCountyCensus, type AreaCensus } from "@/lib/external/census.functions";
import { formatCensus, NOT_RECORDED } from "@/lib/external/censusModel";
import { CensusSources, CompositionBars, KeyTile, MeasureTable, SectorBars } from "./CensusParts";
import { TrendChart } from "./CensusCharts";
import { trendHow } from "./censusHow";
import {
  chartRows,
  COMPOSITION_MEASURES,
  KEY_MEASURES,
  keyFigures,
  measureRows,
  pepRows,
  TREND_MEASURES,
  type Comparator,
} from "./censusView";

const PART_LABEL = {
  acs5: "ACS 5-year",
  acs1: "ACS 1-year",
  pep: "Population Estimates",
  cbp: "County Business Patterns",
} as const;

/**
 * Census figures for one county: headline figures with trends beside the state and the nation, population, race and
 * Hispanic origin, employment by industry, and every measure in one table. Only the same release is ever compared;
 * a figure the Bureau did not publish for the county is "Not recorded", and a geography that no longer exists in the
 * newest release (Connecticut's counties, replaced by planning regions) says so.
 */
export function CountyCensusPanel({
  fips,
  countyName,
  stateName,
  usps,
}: {
  fips: string;
  countyName: string;
  stateName: string;
  usps: string;
}) {
  const fn = useServerFn(getCountyCensus);
  const q = useQuery({
    queryKey: ["county-census", fips],
    queryFn: () => fn({ data: { fips } }),
    staleTime: 10 * 60_000,
  });
  if (q.isPending) return <LoadingBlock label="Loading Census figures" />;
  if (q.error)
    return (
      <StateNote
        tone="error"
        action={
          <button type="button" className="underline" onClick={() => void q.refetch()}>
            Retry
          </button>
        }
      >
        Census figures could not load.
      </StateNote>
    );
  return (
    <Body
      data={q.data}
      countyName={countyName}
      stateName={stateName}
      usps={usps}
      onRetry={() => void q.refetch()}
    />
  );
}

function Body({
  data,
  countyName: fallbackName,
  stateName,
  usps,
  onRetry,
}: {
  data: AreaCensus;
  countyName: string;
  stateName: string;
  usps: string;
  onRetry: () => void;
}) {
  const area = data.area;
  // the Census Bureau's own name ("Orleans Parish"), not the map's name with "County" appended
  const countyName = area?.name.replace(/,\s*[^,]+$/, "") || fallbackName;
  const defs = useMemo(
    () =>
      new Map((data.us?.measures ?? data.state?.measures ?? []).map((m) => [m.key, m] as const)),
    [data],
  );
  const defList = useMemo(() => [...defs.values()], [defs]);
  const comparators: Comparator[] = [
    { id: "state", label: stateName, geo: data.state },
    { id: "us", label: "United States", geo: data.us },
  ];
  const stateLatest = data.state?.latestYear ?? null;
  const retired = area && stateLatest != null && area.latestYear < stateLatest;
  return (
    <div className="space-y-3" data-testid="county-census">
      {data.unavailable.length ? (
        <StateNote
          action={
            <button type="button" className="underline" onClick={onRetry}>
              Retry
            </button>
          }
        >
          Not loaded: {data.unavailable.map((p) => PART_LABEL[p]).join(", ")}. The rest is shown.
        </StateNote>
      ) : null}
      {!area && !data.pep && !data.cbp && !data.unavailable.length ? (
        <StateNote>No Census figures are published for {countyName}.</StateNote>
      ) : null}
      {retired ? (
        <StateNote>
          {usps === "CT" && area.latestYear < 2022
            ? `Connecticut's counties were replaced by planning regions in the 2018 to 2022 release, so this county has figures only through the ${area.period} release. Planning regions have their own county codes and figures.`
            : `The Census Bureau last published this geography in the ${area.period} release; later releases use a different set of areas.`}
        </StateNote>
      ) : null}
      {area ? (
        <>
          <Panel
            title={`Headline figures, ${countyName}`}
            subtitle={`American Community Survey 5-year estimates, ${area.period}; beside ${stateName} and the United States`}
          >
            <ul className="m-0 grid list-none grid-cols-1 gap-2 p-3 sm:grid-cols-2 xl:grid-cols-3">
              {keyFigures(area, defs, [...KEY_MEASURES], comparators).map((f) => (
                <KeyTile
                  key={f.def.key}
                  fig={f}
                  areaLatestYear={area.latestYear}
                  rankScope={`counties in ${stateName}`}
                />
              ))}
            </ul>
            <p className="m-0 border-t border-border/60 px-3 py-1.5 text-[11px] leading-4 text-muted-foreground">
              A county is compared only with the same release of its state and the nation. The
              verdict uses the combined margin of error, which is conservative for a county inside
              its state.{" "}
              {area.rank["poverty_rate"]
                ? `Ranks are among the ${area.rank["poverty_rate"].of} counties of ${stateName} with a value.`
                : ""}
            </p>
          </Panel>
          <Population data={data} countyName={countyName} stateName={stateName} />
          <div className="grid gap-3 lg:grid-cols-2">
            {TREND_MEASURES.map((key) => {
              const def = defs.get(key);
              if (!def) return null;
              const series = [
                { id: "area", label: countyName, geo: area },
                ...(data.state ? [{ id: "state", label: stateName, geo: data.state }] : []),
                ...(data.us ? [{ id: "us", label: "United States", geo: data.us }] : []),
              ];
              return (
                <TrendChart
                  key={key}
                  title={def.label}
                  unit={def.unit}
                  format={def.format}
                  series={series}
                  rows={chartRows(series, key)}
                  period={`five-year releases ${area.years[0]}–${area.latestYear}`}
                  source={{
                    label: `Census Bureau, ACS 5-year, table ${def.table}`,
                    href: "https://www.census.gov/data/developers/data-sets/acs-5year.html",
                  }}
                  how={trendHow(def, "acs5")}
                />
              );
            })}
          </div>
          <Panel
            title="Race and Hispanic origin"
            subtitle={`Share of residents as the Census Bureau tabulates them (table B03002), ${area.period}; compared with ${stateName}`}
            footnote={
              <>
                Hispanic or Latino origin is counted of any race; the other groups are not Hispanic.
                Source:{" "}
                <SourceLink href="https://www.census.gov/topics/population/race.html">
                  Census Bureau, race and ethnicity
                </SourceLink>
                .
              </>
            }
          >
            <CompositionBars
              area={area}
              comparator={data.state}
              comparatorLabel={usps}
              defs={defs}
              keys={COMPOSITION_MEASURES}
            />
          </Panel>
        </>
      ) : null}
      {data.cbp ? (
        <Panel
          title={`Employment by industry, ${countyName}`}
          subtitle={`County Business Patterns ${data.cbp.latestYear}: employees in establishments with paid employees, by NAICS sector`}
          footnote={
            <>
              Source:{" "}
              <SourceLink href="https://www.census.gov/programs-surveys/cbp.html">
                Census Bureau, County Business Patterns
              </SourceLink>
              . Counts carry noise infusion; a sector the Bureau withholds (flag D or S) is shown as
              withheld, not zero.
            </>
          }
        >
          <SectorBars cbp={data.cbp} year={data.cbp.latestYear} />
        </Panel>
      ) : null}
      {area ? (
        <Panel
          title={`All measures, ${countyName}`}
          subtitle={`${area.period}; beside ${stateName} and the United States`}
          footnote={<CensusSources area={area} defs={defList} />}
        >
          <MeasureTable
            rows={measureRows(area, defList, comparators)}
            comparators={comparators}
            rankLabel={`Rank in ${usps}`}
            areaLabel={countyName}
          />
        </Panel>
      ) : null}
    </div>
  );
}

function Population({
  data,
  countyName,
  stateName,
}: {
  data: AreaCensus;
  countyName: string;
  stateName: string;
}) {
  const pep = data.pep;
  if (!pep) return null;
  const last = pep.latest;
  const share =
    last && data.statePep?.latest && data.statePep.latest.year === last.year
      ? (last.value / data.statePep.latest.value) * 100
      : null;
  const years = [...Object.keys(pep.v2019), ...Object.keys(pep.v2025)].map(Number);
  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,17rem)_minmax(0,1fr)]">
      <Panel
        title="Population"
        subtitle={last ? `Resident population, ${last.date}` : "Resident population"}
      >
        <div className="space-y-1 p-3">
          <div className="font-mono text-2xl font-semibold tabular-nums">
            {last ? formatCensus(last.value, "int") : NOT_RECORDED}
          </div>
          {share != null ? (
            <div className="text-xs text-muted-foreground">
              {share.toFixed(1)}% of {stateName} (computed from the two published estimates)
            </div>
          ) : null}
        </div>
      </Panel>
      <TrendChart
        band={false}
        title={`Resident population, ${countyName}`}
        unit="residents on July 1"
        format="int"
        series={[
          { id: "v2019", label: "Vintage 2019 (April 2010 base)" },
          { id: "v2025", label: "Vintage 2025 (April 2020 base)" },
        ]}
        rows={pepRows(pep)}
        period={
          years.length
            ? `July 1 estimates ${Math.min(...years)}–${Math.max(...years)}`
            : "July 1 estimates"
        }
        source={{
          label: "Census Bureau Population Estimates Program",
          href: "https://www.census.gov/programs-surveys/popest.html",
        }}
        how={[
          {
            term: "Two vintages",
            means:
              "The 2010 to 2019 and 2020 to 2025 estimates rest on different census bases, so they are separate lines with a gap.",
            caveat: "A step between 2019 and 2020 is partly a change of base.",
          },
        ]}
        height={190}
      />
    </div>
  );
}
