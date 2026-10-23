import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  LoadingBlock,
  Panel,
  Segmented,
  SourceLink,
  StateNote,
} from "@/components/enforcement/parts";
import { getStateCensus, type AreaCensus } from "@/lib/external/census.functions";
import { formatCensus, NOT_RECORDED, type CensusMeasureDef } from "@/lib/external/censusModel";
import { cbpTotals } from "./cbpView";
import { CensusSources, CompositionBars, KeyTile, MeasureTable, SectorBars } from "./CensusParts";
import { TrendChart } from "./CensusCharts";
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
import { trendHow } from "./censusHow";

const PEP_URL = "https://www.census.gov/programs-surveys/popest.html";
const CBP_URL = "https://www.census.gov/programs-surveys/cbp.html";
const PART_LABEL = {
  acs5: "ACS 5-year",
  acs1: "ACS 1-year",
  pep: "Population Estimates",
  cbp: "County Business Patterns",
} as const;

/**
 * Demographics and economy for a state: population with its trend, headline Census figures beside the national value,
 * trend charts, race and Hispanic origin, employment by industry, and every measure in one table. Every number carries
 * its release, margin of error or flag, and source; a figure the Census Bureau did not publish is "Not recorded".
 */
export function StateCensusSection({ usps, stateName }: { usps: string; stateName: string }) {
  const fn = useServerFn(getStateCensus);
  const q = useQuery({
    queryKey: ["state-census", usps],
    queryFn: () => fn({ data: { usps } }),
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
  return <Body data={q.data} usps={usps} stateName={stateName} onRetry={() => void q.refetch()} />;
}

function Body({
  data,
  usps,
  stateName,
  onRetry,
}: {
  data: AreaCensus;
  usps: string;
  stateName: string;
  onRetry: () => void;
}) {
  const [survey, setSurvey] = useState<"acs5" | "acs1">("acs5");
  const area = survey === "acs5" ? data.area : data.area1;
  const us = survey === "acs5" ? data.us : data.us1;
  const defs = useMemo(
    () => new Map((data.us?.measures ?? data.area?.measures ?? []).map((m) => [m.key, m] as const)),
    [data],
  );
  const defList = useMemo(() => [...defs.values()], [defs]);
  const comparators: Comparator[] = [{ id: "us", label: "United States", geo: us }];
  const empty = !data.area && !data.area1 && !data.pep && !data.cbp;
  return (
    <div className="space-y-3" data-testid="state-census">
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
      {empty && !data.unavailable.length ? (
        <StateNote>No Census figures are published for {stateName} yet.</StateNote>
      ) : null}
      <Population data={data} stateName={stateName} />
      {area ? (
        <>
          <Panel
            title={`Headline figures, ${stateName}`}
            subtitle={`${survey === "acs5" ? "American Community Survey 5-year estimates" : "American Community Survey 1-year estimates"}, ${area.period}; beside the United States`}
            actions={
              data.area1 ? (
                <Segmented
                  label="Survey"
                  value={survey}
                  options={[
                    { id: "acs5", label: `5-year ${data.area?.period ?? ""}`.trim() },
                    { id: "acs1", label: `1-year ${data.area1.period}` },
                  ]}
                  onChange={setSurvey}
                />
              ) : null
            }
          >
            <ul className="m-0 grid list-none grid-cols-1 gap-2 p-3 sm:grid-cols-2 xl:grid-cols-3">
              {keyFigures(area, defs, [...KEY_MEASURES], comparators).map((f) => (
                <KeyTile key={f.def.key} fig={f} areaLatestYear={area.latestYear} />
              ))}
            </ul>
            <p className="m-0 border-t border-border/60 px-3 py-1.5 text-[11px] leading-4 text-muted-foreground">
              {survey === "acs5"
                ? "Five-year estimates pool five years of survey responses and cover every area. One-year estimates are more current but cover areas with 65,000 or more residents."
                : "One-year estimates are more current than five-year estimates; there is no 2020 release."}{" "}
              Ranks are among the 50 states and DC.
            </p>
          </Panel>
          <div className="grid gap-3 lg:grid-cols-2">
            {TREND_MEASURES.map((key) => {
              const def = defs.get(key);
              if (!def) return null;
              return (
                <TrendChart
                  key={`${survey}-${key}`}
                  title={def.label}
                  unit={def.unit}
                  format={def.format}
                  series={[
                    { id: "area", label: stateName },
                    ...(us ? [{ id: "us", label: "United States" }] : []),
                  ]}
                  rows={chartRows(
                    [
                      { id: "area", label: stateName, geo: area },
                      ...(us ? [{ id: "us", label: "United States", geo: us }] : []),
                    ],
                    key,
                  )}
                  period={`${survey === "acs5" ? "five-year releases" : "one-year estimates"} ${area.years[0]}–${area.latestYear}`}
                  source={{
                    label: `Census Bureau, ACS ${survey === "acs5" ? "5-year" : "1-year"}, table ${def.table}`,
                    href:
                      survey === "acs5"
                        ? "https://www.census.gov/data/developers/data-sets/acs-5year.html"
                        : "https://www.census.gov/data/developers/data-sets/acs-1year.html",
                  }}
                  how={trendHow(def, survey)}
                />
              );
            })}
          </div>
          <Panel
            title="Race and Hispanic origin"
            subtitle={`Share of residents as the Census Bureau tabulates them (table B03002), ${area.period}; one bar per group, groups add to 100 percent`}
            footnote={
              <>
                Hispanic or Latino origin is counted of any race; the other groups are not Hispanic.
                Estimates of these groups are controlled to the Bureau's population estimates, so
                they carry no margin of error. Source:{" "}
                <SourceLink href="https://www.census.gov/topics/population/race.html">
                  Census Bureau, race and ethnicity
                </SourceLink>
                .
              </>
            }
          >
            <CompositionBars
              area={area}
              comparator={us}
              comparatorLabel="U.S."
              defs={defs}
              keys={COMPOSITION_MEASURES}
            />
          </Panel>
        </>
      ) : data.area || data.area1 ? (
        <StateNote>
          No {survey === "acs5" ? "5-year" : "1-year"} figures are published for {stateName}.
        </StateNote>
      ) : null}
      <Industry data={data} stateName={stateName} />
      {area ? (
        <Panel
          title={`All measures, ${stateName}`}
          subtitle={`${area.period}; compared with the United States`}
          footnote={<CensusSources area={area} defs={defList} />}
        >
          <MeasureTable
            rows={measureRows(area, defList, comparators)}
            comparators={comparators}
            rankLabel="Rank, 50 states + DC"
            areaLabel={stateName}
          />
        </Panel>
      ) : null}
      <span className="sr-only">{usps}</span>
    </div>
  );
}

function Population({ data, stateName }: { data: AreaCensus; stateName: string }) {
  const pep = data.pep;
  if (!pep) return null;
  const v25 = pep.v2025;
  const base = pep.base2020;
  const last = pep.latest;
  const growth = last && base && base > 0 ? ((last.value - base) / base) * 100 : null;
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
          {last?.rank && last.of ? (
            <div className="text-xs text-muted-foreground">
              #{last.rank} of {last.of} states and DC
            </div>
          ) : null}
          {growth != null ? (
            <div className="text-xs">
              <span className="font-mono tabular-nums">
                {growth >= 0 ? "+" : "−"}
                {Math.abs(growth).toFixed(1)}%
              </span>
              <span className="text-muted-foreground">
                {" "}
                since the April 2020 estimates base ({formatCensus(base, "int")}); computed from the
                two published estimates
              </span>
            </div>
          ) : null}
          {data.usPep?.latest ? (
            <div className="text-xs text-muted-foreground">
              United States: {formatCensus(data.usPep.latest.value, "int")}
            </div>
          ) : null}
        </div>
      </Panel>
      <TrendChart
        band={false}
        title={`Resident population, ${stateName}`}
        unit="residents on July 1"
        format="int"
        series={[
          { id: "v2019", label: "Vintage 2019 (April 2010 base)" },
          { id: "v2025", label: "Vintage 2025 (April 2020 base)" },
        ]}
        rows={pepRows(pep)}
        period={`July 1 estimates ${Math.min(...Object.keys(pep.v2019).map(Number), ...Object.keys(v25).map(Number))}–${Math.max(...Object.keys(v25).map(Number))}`}
        source={{ label: "Census Bureau Population Estimates Program", href: PEP_URL }}
        how={[
          {
            term: "Two vintages",
            means:
              "The 2010 to 2019 estimates and the 2020 to 2025 estimates are built on different census bases (the 2010 and 2020 censuses).",
            caveat:
              "They are drawn as separate lines with a gap; a step between 2019 and 2020 is partly a change of base, not growth.",
          },
          {
            term: "Population Estimates",
            means:
              "Annual estimates of the resident population on July 1, produced from the last census and administrative records.",
            caveat: "Not a count; later vintages revise earlier years.",
          },
        ]}
        height={190}
      />
    </div>
  );
}

function Industry({ data, stateName }: { data: AreaCensus; stateName: string }) {
  const cbp = data.cbp;
  if (!cbp) return null;
  const totals = cbpTotals(cbp);
  const latest = totals.at(-1);
  return (
    <Panel
      title={`Employment by industry, ${stateName}`}
      subtitle={`County Business Patterns ${cbp.latestYear}: employees in establishments with paid employees, by NAICS sector; share of all-sector employment`}
      footnote={
        <>
          Source: <SourceLink href={CBP_URL}>Census Bureau, County Business Patterns</SourceLink>,
          NAICS 2017 sectors. Counts carry the Bureau's noise infusion. A sector the Bureau
          withholds (flag D or S) is shown as withheld. Excludes self-employed people, most
          agricultural production and government employees.
        </>
      }
    >
      <div className="grid gap-x-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,16rem)]">
        <SectorBars cbp={cbp} year={cbp.latestYear} />
        <div className="border-t border-border/60 p-3 text-xs lg:border-l lg:border-t-0">
          <div className="mb-1 text-[11px] font-medium text-muted-foreground">
            All sectors by year
          </div>
          <table className="w-full">
            <thead className="text-left text-[11px] text-muted-foreground">
              <tr>
                <th scope="col" className="py-0.5 font-medium">
                  Year
                </th>
                <th scope="col" className="py-0.5 text-right font-medium">
                  Establishments
                </th>
                <th scope="col" className="py-0.5 text-right font-medium">
                  Employees
                </th>
              </tr>
            </thead>
            <tbody>
              {totals.map((t) => (
                <tr key={t.year} className="border-t border-border/50">
                  <th scope="row" className="py-0.5 text-left font-normal tabular-nums">
                    {t.year}
                  </th>
                  <td className="py-0.5 text-right font-mono tabular-nums">
                    {formatCensus(t.establishments, "int")}
                  </td>
                  <td className="py-0.5 text-right font-mono tabular-nums">
                    {formatCensus(t.employees, "int")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {latest ? (
            <div className="mt-1 text-[11px] text-muted-foreground">
              Annual payroll {cbp.latestYear}: $
              {formatCensus(latest.payroll != null ? latest.payroll * 1000 : null, "int")}
            </div>
          ) : null}
        </div>
      </div>
    </Panel>
  );
}

export type { CensusMeasureDef };
