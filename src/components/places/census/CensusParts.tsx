import { Fragment, type ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import { SourceLink } from "@/components/enforcement/parts";
import {
  acsApiUrl,
  formatCensus,
  NOT_RECORDED,
  type CbpGeo,
  type CensusGeo,
  type CensusMeasureDef,
} from "@/lib/external/censusModel";
import { cn } from "@/lib/utils";
import { sectorRows, FLAG_MEANING } from "./cbpView";
import { Spark } from "./CensusCharts";
import { MEASURE_GROUPS, type Comparator, type KeyFigure, type MeasureRow } from "./censusView";

/** One headline figure: value with its margin of error, rank, trend, and how it compares with each comparator. */
export function KeyTile({
  fig,
  areaLatestYear,
  rankScope = "states and DC",
}: {
  fig: KeyFigure;
  areaLatestYear: number;
  /** What the rank counts: "states and DC" on a state page, "counties in Wyoming" on a county page. */
  rankScope?: string;
}) {
  const { def, latest } = fig;
  return (
    <li
      className="min-w-0 rounded-md border border-border bg-surface px-3 py-2"
      data-testid="census-key-figure"
    >
      <div className="text-[11.5px] leading-4 text-muted-foreground">{def.label}</div>
      <div className="mt-0.5 flex items-end justify-between gap-2">
        <div className="min-w-0">
          <span className="font-mono text-lg font-semibold tabular-nums">{fig.valueText}</span>
          {fig.moeText ? (
            <span className="ml-1.5 text-[11px] text-muted-foreground">{fig.moeText}</span>
          ) : null}
        </div>
        <Spark points={fig.trend} label={`${def.label} across releases`} />
      </div>
      <div className="text-[11px] leading-4 text-muted-foreground">
        {latest
          ? latest.year === areaLatestYear
            ? `${areaLatestYear - 4}–${areaLatestYear}`
            : `${latest.year} release (latest published)`
          : NOT_RECORDED}
        {fig.rank ? ` · #${fig.rank.rank} of ${fig.rank.of} ${rankScope}` : ""}
      </div>
      {fig.comparisons.map((c) => (
        <div key={c.id} className="mt-1 text-[11px] leading-4">
          <span className="text-muted-foreground">{c.label}: </span>
          <span className="font-mono tabular-nums">
            {formatCensus(c.latest?.value, def.format)}
          </span>
          <span className="text-muted-foreground"> · {c.verdict}</span>
        </div>
      ))}
    </li>
  );
}

/** Ranked horizontal bars for the population's composition (shares of the total, area against a comparator). */
export function CompositionBars({
  area,
  comparator,
  comparatorLabel,
  defs,
  keys,
}: {
  area: CensusGeo;
  comparator: CensusGeo | null;
  comparatorLabel: string;
  defs: Map<string, CensusMeasureDef>;
  keys: readonly string[];
}) {
  const rows = keys
    .flatMap((k) => {
      const def = defs.get(k);
      const l = area.latest[k];
      // A share the Bureau did not publish is not drawn (never as a zero-width bar).
      return def && l && l.value != null
        ? [{ def, value: l.value, other: comparator?.latest[k] ?? null }]
        : [];
    })
    .sort((a, b) => b.value - a.value);
  if (!rows.length)
    return <p className="px-3 py-6 text-center text-xs text-muted-foreground">{NOT_RECORDED}</p>;
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <ul
      className="m-0 list-none space-y-1.5 p-3"
      aria-label="Race and Hispanic origin, share of residents"
    >
      {rows.map(({ def, value, other }) => (
        <li
          key={def.key}
          className="grid grid-cols-[minmax(0,13rem)_minmax(0,1fr)_auto] items-center gap-2 text-xs"
        >
          <span className="truncate" title={def.label}>
            {def.label
              .replace(", not Hispanic or Latino", " (not Hispanic)")
              .replace(" (of any race)", "")}
          </span>
          <span className="h-2.5 rounded-sm bg-muted" aria-hidden>
            <span
              className="block h-full rounded-sm bg-primary"
              style={{ width: `${Math.max(1, (value / max) * 100)}%` }}
            />
          </span>
          <span className="whitespace-nowrap font-mono tabular-nums">
            {formatCensus(value, "pct")}
            <span className="text-[11px] text-muted-foreground">
              {" "}
              · {comparatorLabel} {formatCensus(other?.value, "pct")}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Employment by NAICS sector (County Business Patterns), withheld figures shown as withheld, never as zero. */
export function SectorBars({ cbp, year }: { cbp: CbpGeo; year: number }) {
  const rows = sectorRows(cbp, year);
  if (!rows.length)
    return <p className="px-3 py-6 text-center text-xs text-muted-foreground">{NOT_RECORDED}</p>;
  const max = Math.max(...rows.map((r) => r.employees ?? 0), 1);
  return (
    <ul className="m-0 list-none space-y-1 p-3" aria-label={`Employees by sector, ${year}`}>
      {rows.map((r) => (
        <li
          key={r.sector}
          className="grid grid-cols-[minmax(0,15rem)_minmax(0,1fr)_auto] items-center gap-2 text-xs"
        >
          <span className="truncate" title={r.label}>
            {r.label}
          </span>
          <span className="h-2.5 rounded-sm bg-muted" aria-hidden>
            {r.employees != null ? (
              <span
                className="block h-full rounded-sm bg-primary"
                style={{ width: `${Math.max(1, (r.employees / max) * 100)}%` }}
              />
            ) : null}
          </span>
          <span className="whitespace-nowrap font-mono tabular-nums">
            {r.employees != null ? (
              formatCensus(r.employees, "int")
            ) : (
              <span title={r.withheld ? (FLAG_MEANING[r.withheld] ?? r.withheld) : undefined}>
                Withheld{r.withheld ? ` (${r.withheld})` : ""}
              </span>
            )}
            {r.share != null ? (
              <span className="text-[11px] text-muted-foreground"> · {r.share.toFixed(1)}%</span>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

function diffCell(row: MeasureRow, id: string) {
  const c = row.comparisons.find((x) => x.id === id);
  if (!c) return null;
  return (
    <td key={id} className="px-2 py-1 align-top">
      <div className="font-mono tabular-nums">{formatCensus(c.latest?.value, row.def.format)}</div>
      <div className="text-[10.5px] leading-3.5 text-muted-foreground">{c.verdict}</div>
    </td>
  );
}

/**
 * Every measure in a table: value with margin of error, comparator values with a plain verdict, rank, and the change
 * between the first and latest release (with a significance statement only between non-overlapping releases).
 */
export function MeasureTable({
  rows,
  comparators,
  rankLabel,
  areaLabel,
}: {
  rows: MeasureRow[];
  comparators: Comparator[];
  rankLabel: string;
  areaLabel: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[40rem] text-xs" data-testid="census-measure-table">
        <caption className="sr-only">Census measures for {areaLabel}, with comparisons</caption>
        <thead className="bg-muted/50 text-left text-[11px] text-muted-foreground">
          <tr>
            <th scope="col" className="px-2 py-1.5 font-medium">
              Measure
            </th>
            <th scope="col" className="px-2 py-1.5 font-medium">
              {areaLabel}
            </th>
            {comparators.map((c) => (
              <th key={c.id} scope="col" className="px-2 py-1.5 font-medium">
                {c.label}
              </th>
            ))}
            <th scope="col" className="px-2 py-1.5 font-medium">
              {rankLabel}
            </th>
            <th scope="col" className="px-2 py-1.5 font-medium">
              Change, first to latest release
            </th>
          </tr>
        </thead>
        <tbody>
          {MEASURE_GROUPS.map((group) => {
            const inGroup = rows.filter((r) => r.def.group === group);
            if (!inGroup.length) return null;
            return (
              <Fragment key={group}>
                <tr className="border-t border-border bg-muted/30">
                  <th
                    scope="colgroup"
                    colSpan={4 + comparators.length}
                    className="px-2 py-1 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
                  >
                    {group}
                  </th>
                </tr>
                {inGroup.map((row) => (
                  <tr key={row.def.key} className="border-t border-border/60">
                    <th scope="row" className="px-2 py-1 text-left align-top font-normal">
                      <div>{row.def.label}</div>
                      <div className="text-[10.5px] text-muted-foreground">{row.def.unit}</div>
                    </th>
                    <td className="px-2 py-1 align-top">
                      <div className="font-mono tabular-nums">{row.valueText}</div>
                      <div className="text-[10.5px] leading-3.5 text-muted-foreground">
                        {row.moeText}
                        {row.year ? `${row.moeText ? " · " : ""}${row.year} release` : ""}
                      </div>
                    </td>
                    {comparators.map((c) => diffCell(row, c.id) ?? <td key={c.id} />)}
                    <td className="px-2 py-1 align-top font-mono tabular-nums text-muted-foreground">
                      {row.rank ? `#${row.rank.rank} of ${row.rank.of}` : "Not ranked"}
                    </td>
                    <td className="px-2 py-1 align-top">
                      {row.change ? (
                        <>
                          <div className="font-mono tabular-nums">{row.change.text}</div>
                          <div className="text-[10.5px] leading-3.5 text-muted-foreground">
                            {row.change.note}
                          </div>
                        </>
                      ) : (
                        <span className="text-muted-foreground">{NOT_RECORDED}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Where the figures come from: survey, period, tables, the exact API request for the area, and the method. */
export function CensusSources({
  area,
  defs,
  extra,
}: {
  area: CensusGeo;
  defs: CensusMeasureDef[];
  extra?: ReactNode;
}) {
  const cells = [
    ...new Set(
      defs.flatMap((d) => [
        ...d.cells,
        ...d.cellsSubtracted,
        ...(d.denominatorCell ? [d.denominatorCell] : []),
      ]),
    ),
  ];
  const tables = [...new Set(defs.map((d) => d.table))].sort();
  // the API takes at most 50 variables a request: show the first batch as the reproducible example
  const sample = acsApiUrl(area.survey, area.latestYear, area.geoid, cells.slice(0, 24));
  const doc =
    area.survey === "acs5"
      ? "https://www.census.gov/data/developers/data-sets/acs-5year.html"
      : "https://www.census.gov/data/developers/data-sets/acs-1year.html";
  return (
    <div className="space-y-1 text-[11px] leading-4 text-muted-foreground">
      <p className="m-0">
        Source: U.S. Census Bureau,{" "}
        <SourceLink href={doc}>
          American Community Survey {area.survey === "acs5" ? "5-year" : "1-year"} estimates
        </SourceLink>
        , {area.period}; tables {tables.join(", ")}. Margins of error are at the 90 percent
        confidence level. Percentages are computed from the published counts with the Bureau's
        published formulas (
        <SourceLink href="https://www.census.gov/programs-surveys/acs/guidance/handbooks/general.html">
          ACS handbook
        </SourceLink>
        ); a figure the Bureau did not publish for an area is shown as {NOT_RECORDED}, never as
        zero. Dollar figures are in each release's own last-year dollars.
      </p>
      {sample ? (
        <p className={cn("m-0 break-all")}>
          Example request for this area (no key shown):{" "}
          <a
            href={sample}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-start gap-0.5 font-mono text-[10.5px] text-primary hover:underline"
          >
            {sample}
            <ExternalLink className="mt-0.5 size-3 shrink-0" aria-hidden />
          </a>
        </p>
      ) : null}
      {extra}
    </div>
  );
}
