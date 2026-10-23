/**
 * Trend cards of one MDL, shared by the case lens (/matters/lens/$mdl) and the matter page (/matters/$id). Each card
 * is the Analytics hub's card (see components/trends/ProfileTrend): what is counted, unit, period, source link, a "Show
 * data" table and a "How to read this" note. Counts are the Panel's, the Federal Judicial Center's and the matter
 * registry's own, never estimated.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ProfileTrend, StaticTrend, TrendGrid } from "@/components/trends/ProfileTrend";
import { staticDef } from "@/components/trends/trendDefs";
import { getMdlHierarchy } from "@/lib/external/mdlNetwork.functions";
import { buildMdlMonthlyPending } from "@/lib/trends/mdl";
import { PROFILE_KINDS } from "@/lib/trends/profile";

/** The Panel's monthly reports for an MDL, from a series the page already holds. */
export function MdlMonthlyPendingCard({
  mdl,
  series,
}: {
  mdl: number;
  series: readonly { date: string; pending: number; total: number }[];
}) {
  const kind = PROFILE_KINDS["mdl-monthly-pending"];
  const def = useMemo(
    () =>
      staticDef({
        id: `mdl-monthly-pending-${mdl}`,
        title: kind.title(String(mdl)),
        measure: kind.measure,
        detail: kind.detail,
      }),
    [mdl, kind],
  );
  const block = useMemo(() => {
    if (series.length < 2) return null;
    const last = series[series.length - 1]!;
    return buildMdlMonthlyPending({
      mdl,
      reports: series.map((p) => ({
        month: p.date.slice(0, 7),
        pending: p.pending,
        total: p.total,
      })),
      lastReportDate: /^\d{4}-\d{2}-\d{2}$/.test(last.date) ? last.date : null,
    });
  }, [mdl, series]);
  return (
    <StaticTrend
      def={def}
      block={block}
      emptyReason="Fewer than two monthly reports are recorded for this MDL."
    />
  );
}

/** The cards that count cases by year: the Federal Judicial Center's file, then the matter registry's member dockets. */
export function MdlCaseYears({ mdl }: { mdl: number }) {
  // Same query as the "Member actions and where they started" section, so it is read once.
  const h = useQuery({
    queryKey: ["mdl-hierarchy", mdl],
    queryFn: () => getMdlHierarchy({ data: { mdl } }),
    staleTime: 10 * 60 * 1000,
  });
  const inRegistry = h.data != null;
  const hasOrigin = (h.data?.origin?.byYear.length ?? 0) > 0;
  return (
    <TrendGrid>
      <ProfileTrend kind="mdl-fjc-years" id={mdl} />
      {inRegistry && (h.data?.membersByYear.length ?? 0) > 0 ? (
        <ProfileTrend kind="mdl-members-years" id={mdl} />
      ) : null}
      {inRegistry && hasOrigin ? <ProfileTrend kind="mdl-transferred-years" id={mdl} /> : null}
    </TrendGrid>
  );
}
