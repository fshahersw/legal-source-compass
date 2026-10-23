/**
 * Trend cards of one MDL, shared by the case lens (/matters/lens/$mdl) and the matter page (/matters/$id). Each card
 * is the Analytics hub's card (see components/trends/ProfileTrend): what is counted, unit, period, source link, a "Show
 * data" table and a "How to read this" note. Counts are the Panel's, the Federal Judicial Center's and the matter
 * registry's own, never estimated.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { TrendCardView, type CardState } from "@/components/analytics/hub/TrendCard";
import { ProfileTrend, StaticTrend, TrendGrid } from "@/components/trends/ProfileTrend";
import { staticDef } from "@/components/trends/trendDefs";
import { getCourtStatsDistrict } from "@/lib/external/courtStats.functions";
import { getMdlHierarchy } from "@/lib/external/mdlNetwork.functions";
import { buildCourtPlYears } from "@/lib/trends/court";
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

/** Adverse-event report cards for the product of an MDL: one per openFDA system that holds a series for it. */
export function MdlAdverseCards({ mdl, systems }: { mdl: number; systems: readonly string[] }) {
  const faers = systems.includes("FAERS");
  const maude = systems.includes("MAUDE");
  if (!faers && !maude) return null;
  return (
    <TrendGrid columns={2}>
      {faers ? <ProfileTrend kind="mdl-faers-years" id={mdl} /> : null}
      {maude ? <ProfileTrend kind="mdl-maude-years" id={mdl} /> : null}
    </TrendGrid>
  );
}

/** Products-liability cases filed in the transferee court by fiscal year, from the Judicial Business tables. */
export function MdlCourtPlCard({ courtId }: { courtId: string }) {
  const q = useQuery({
    queryKey: ["court-stats-district", courtId],
    queryFn: () => getCourtStatsDistrict({ data: { id: courtId } }),
    staleTime: 10 * 60 * 1000,
  });
  const def = useMemo(
    () =>
      staticDef({
        id: `court-pl-years-${courtId}`,
        title: "Products-liability cases filed in the transferee court, by fiscal year",
        measure: "products-liability cases filed in the court",
        detail: { to: `/courts/${courtId}`, label: "Court page" },
      }),
    [courtId],
  );
  const state: CardState = (() => {
    if (q.isPending) return { kind: "loading" };
    if (q.isError) return { kind: "error", onRetry: () => void q.refetch() };
    const p = q.data;
    const block = p
      ? buildCourtPlYears({
          courtId,
          courtName: p.name,
          years: p.years,
          pl: p.pl,
          civil: p.civil,
          nationalShare: p.natShare,
          rank: { pl: p.ranks.pl, of: p.ranks.of },
        })
      : null;
    return block
      ? { kind: "ok", block }
      : {
          kind: "empty",
          reason: "The Judicial Business tables hold no products-liability count for this court.",
        };
  })();
  return <TrendCardView def={def} state={state} />;
}

/** The cards that count cases by year: the Federal Judicial Center's file, then the matter registry's member dockets. */
export function MdlCaseYears({ mdl, courtId = null }: { mdl: number; courtId?: string | null }) {
  // Same query as the "Member actions and where they started" section, so it is read once.
  const h = useQuery({
    queryKey: ["mdl-hierarchy", mdl],
    queryFn: () => getMdlHierarchy({ data: { mdl } }),
    staleTime: 10 * 60 * 1000,
  });
  const inRegistry = h.data != null;
  const hasOrigin = (h.data?.origin?.byYear.length ?? 0) > 0;
  const hasMembers = inRegistry && (h.data?.membersByYear.length ?? 0) > 0;
  const showTransferred = inRegistry && hasOrigin;
  // Two or four cards sit in two columns, so a fourth card never stands alone in a third row of three.
  const cards = 1 + (hasMembers ? 1 : 0) + (showTransferred ? 1 : 0) + (courtId ? 1 : 0);
  return (
    <TrendGrid columns={cards % 2 === 0 ? 2 : 3}>
      <ProfileTrend kind="mdl-fjc-years" id={mdl} />
      {hasMembers ? <ProfileTrend kind="mdl-members-years" id={mdl} /> : null}
      {showTransferred ? <ProfileTrend kind="mdl-transferred-years" id={mdl} /> : null}
      {courtId ? <MdlCourtPlCard courtId={courtId} /> : null}
    </TrendGrid>
  );
}
