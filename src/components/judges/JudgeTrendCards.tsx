/**
 * Trend cards on a judge page: CourtListener's counts by year (assigned dockets, authored opinions, recorded panels) and
 * the items on the financial disclosure reports it holds. They are the Analytics hub's card; see components/trends.
 */
import { useMemo } from "react";
import { StaticTrend } from "@/components/trends/ProfileTrend";
import { staticDef } from "@/components/trends/trendDefs";
import {
  buildClYears,
  buildDisclosureItems,
  type DisclosureYearCounts,
  type YearN,
} from "@/lib/trends/judge";

const DETAIL = { to: "/judges/analytics", label: "Judge analytics" } as const;

const CARDS = {
  dockets: {
    title: "Dockets assigned to this judge in CourtListener's collection, by year filed",
    measure: "assigned dockets",
    unit: "dockets",
    seriesLabel: "Assigned dockets",
    counts:
      "Counts dockets CourtListener lists as assigned to this person, by the year each was filed.",
    totalLabel: "assigned dockets",
    empty:
      "CourtListener's collection holds no assigned docket with a filing year for this person.",
  },
  opinions: {
    title: "Opinions this judge authored in CourtListener's collection, by year filed",
    measure: "authored opinions",
    unit: "opinions",
    seriesLabel: "Authored opinions",
    counts:
      "Counts opinions CourtListener credits to this person as author, by the year each was filed.",
    totalLabel: "authored opinions",
    empty:
      "CourtListener's collection holds no authored opinion with a filing year for this person.",
  },
  panels: {
    title: "Opinion clusters listing this judge on the panel, by year filed",
    measure: "recorded panels",
    unit: "clusters",
    seriesLabel: "Recorded panels",
    counts:
      "Counts opinion clusters whose recorded panel lists this person. Most clusters list no panel, so this is not a count of cases heard.",
    totalLabel: "recorded panels",
    empty: "No recorded panel with a filing year lists this person.",
  },
} as const;

export type ClYearKind = keyof typeof CARDS;

/** One of the by-year cards, from the counts the page already holds. */
export function JudgeClYearCard({
  kind,
  personId,
  rows,
  total,
}: {
  kind: ClYearKind;
  personId: number;
  rows: readonly YearN[];
  total: number | null;
}) {
  const c = CARDS[kind];
  const def = useMemo(
    () =>
      staticDef({
        id: `judge-${kind}-years-${personId}`,
        title: c.title,
        measure: c.measure,
        detail: DETAIL,
        group: "judiciary",
      }),
    [kind, personId, c],
  );
  const block = useMemo(
    () =>
      buildClYears({
        id: def.id,
        rows,
        unit: c.unit,
        seriesLabel: c.seriesLabel,
        total,
        totalLabel: c.totalLabel,
        counts: c.counts,
        personId,
      }),
    [def.id, rows, c, total, personId],
  );
  return <StaticTrend def={def} block={block} emptyReason={c.empty} />;
}

/** Items listed on the financial disclosure reports, by report year. */
export function JudgeDisclosureItemsCard({
  personId,
  years,
}: {
  personId: number;
  years: readonly DisclosureYearCounts[];
}) {
  const def = useMemo(
    () =>
      staticDef({
        id: `judge-disclosure-items-${personId}`,
        title: "Items listed on this judge's financial disclosure reports, by report year",
        measure: "items on disclosure reports",
        detail: DETAIL,
        group: "judiciary",
      }),
    [personId],
  );
  const block = useMemo(() => buildDisclosureItems({ personId, years }), [personId, years]);
  return (
    <StaticTrend
      def={def}
      block={block}
      emptyReason="Fewer than two report years are on file, so there is no trend to draw."
    />
  );
}
