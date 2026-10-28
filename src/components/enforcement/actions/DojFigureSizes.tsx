/**
 * DOJ press releases by the size of their largest stated resolution figure: the share of releases that state a
 * figure, per calendar year, in five ordered size bands (a sequential ramp, small to large). Shares rather than counts
 * because the archive's coverage jumps between years; a year with a band not recorded is left out of the bars.
 */
import { ChartCard } from "@/components/kit/ChartCard";
import { StackedBarsOverTime } from "@/components/charts/d3/charts";
import { sequentialFill } from "@/components/charts/palette";
import type { DojOverview } from "@/lib/external/enforcementActions.functions";
import {
  DOJ_BANDS,
  DOJ_BAND_LABEL,
  dojSizeCallout,
  dojSizeYears,
  dojStackRows,
} from "../penaltyDistribution";
import { fmtInt } from "./format";

const FILLS = Object.fromEntries(
  DOJ_BANDS.map((b, i) => [b, sequentialFill(0.28 + (0.72 * i) / (DOJ_BANDS.length - 1))]),
);

export function DojFigureSizes({ overview }: { overview: DojOverview }) {
  const years = dojSizeYears(overview.byYear, new Date().getUTCFullYear());
  const shown = years.filter((y) => y.withFigure);
  const unknown = years.filter((y) => y.withFigure == null).map((y) => y.year);
  const callout = dojSizeCallout(years);
  const period = shown.length ? `${shown[0]!.year}–${shown.at(-1)!.year}` : undefined;
  const source = {
    source: {
      label: "U.S. Department of Justice, press releases",
      href: "https://www.justice.gov/news",
    },
    period,
    partial: shown.some((y) => y.partial)
      ? `${shown.find((y) => y.partial)!.year} is unfinished and drawn faded.`
      : undefined,
    about: (
      <>
        <p>
          Each bar is 100% of that year&rsquo;s releases that state a resolution figure (a dollar
          amount in a sentence with a settlement, penalty, restitution, forfeiture, disgorgement or
          judgment keyword), split by the largest such figure. Figures are what the release states,
          not verified payments, and one release can describe several defendants.
        </p>
        <p className="mt-1.5">
          Shares are used because the archive holds far fewer releases in some years than others, so
          raw counts would track coverage, not enforcement.
          {unknown.length
            ? ` Left out because a size band is not recorded: ${unknown.join(", ")}.`
            : ""}
        </p>
      </>
    ),
  };
  return (
    <ChartCard
      id="doj-figure-sizes"
      title={
        callout
          ? `${callout.sharePct.toFixed(0)}% of ${callout.year} releases with a figure stated $10M or more`
          : "DOJ releases by size of the stated figure"
      }
      subtitle="Share of press releases stating a resolution figure, by the largest figure · calendar years"
      source={source}
      state={shown.length ? "ready" : "empty"}
      emptyText="No year has every size band recorded."
      height={300}
      legend={undefined}
      data={{
        title: "DOJ press releases by largest stated figure",
        rows: shown,
        rowKey: (y) => y.year,
        columns: [
          { key: "year", label: "Year", value: (y) => y.year },
          { key: "releases", label: "Releases", value: (y) => y.releases },
          { key: "withFigure", label: "With a figure", value: (y) => y.withFigure },
          ...DOJ_BANDS.map((b) => ({
            key: b,
            label: `${DOJ_BAND_LABEL[b]} (releases)`,
            value: (y: (typeof shown)[number]) => y.counts[b],
          })),
          ...DOJ_BANDS.map((b) => ({
            key: `${b}-share`,
            label: `${DOJ_BAND_LABEL[b]} (%)`,
            value: (y: (typeof shown)[number]) => y.shares[b],
          })),
        ],
        source,
      }}
    >
      <div className="px-4 pb-3">
        <StackedBarsOverTime
          rows={dojStackRows(shown)}
          keys={DOJ_BANDS}
          labels={DOJ_BAND_LABEL}
          fills={FILLS}
          height={240}
          format={(v) => `${Math.round(v * 10) / 10}%`}
        />
        {callout ? (
          <p className="mt-1 text-meta text-muted-foreground">
            In {callout.year}, {fmtInt(callout.tenMillionPlus)} of the {fmtInt(callout.withFigure)}{" "}
            releases that stated a figure put it at $10M or more.
          </p>
        ) : null}
      </div>
    </ChartCard>
  );
}
