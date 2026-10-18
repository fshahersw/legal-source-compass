/** Key takeaways for /judges/analytics, computed only from the published judge cross-analysis rows. */
import type {
  DistrictRow,
  JudgePoint,
  NationalSummary,
  ProfilesSummary,
} from "@/lib/external/judgeCross.functions";
import {
  compact,
  int,
  pct,
  plural,
  shareOf,
  usableTakeaways,
  type Takeaway,
} from "@/components/analysis/analysisFormat";
import { circuitLabel } from "./judgeCrossView";

export type JudgeTakeawayInput = {
  profiles: Pick<
    ProfilesSummary,
    | "pendingMdls"
    | "pendingActions"
    | "judgesWithPending"
    | "top10SharePct"
    | "hhiByJudge"
    | "medianYearsPendingJudges"
  >;
  points: readonly JudgePoint[];
  national: Pick<
    NationalSummary,
    "rows" | "medianYearsActive" | "top5DistrictSharePct" | "hhiByDistrict"
  > | null;
  disclosure: {
    exact: number;
    near: number;
    lines: number;
    checked: number;
    targeted: number;
  } | null;
};

/** The judge holding the most pending actions; ties keep the first by name so the result is stable. */
export function busiestJudge(points: readonly JudgePoint[]): JudgePoint | null {
  const live = points.filter((p) => p.pendingActions > 0);
  if (!live.length) return null;
  return [...live].sort(
    (a, b) => b.pendingActions - a.pendingActions || a.name.localeCompare(b.name),
  )[0]!;
}

/** The district with the largest recorded share of pending actions. */
export function busiestDistrict(rows: readonly DistrictRow[]): DistrictRow | null {
  const live = rows.filter((r) => r.sharePct !== null && r.pendingActions > 0);
  if (!live.length) return null;
  return [...live].sort(
    (a, b) => (b.sharePct ?? 0) - (a.sharePct ?? 0) || a.name.localeCompare(b.name),
  )[0]!;
}

export function judgeTakeaways(input: JudgeTakeawayInput): Takeaway[] {
  const { profiles: p, points, national: n, disclosure: d } = input;
  const top = busiestJudge(points);
  const topShare = top ? (top.sharePct ?? shareOf(top.pendingActions, p.pendingActions)) : null;
  const hub = n ? busiestDistrict(n.rows) : null;
  return usableTakeaways([
    p.top10SharePct != null
      ? {
          id: "concentration",
          figure: pct(p.top10SharePct),
          text: `of ${compact(p.pendingActions)} pending MDL actions sit with the ten judges who hold the most; ${int(p.judgesWithPending)} judges hold any.`,
          anchor: "judge-concentration",
          anchorLabel: "See the curve",
        }
      : null,
    top && topShare != null
      ? {
          id: "busiest-judge",
          figure: pct(topShare),
          text: `${top.name}${top.courtId ? ` (${top.courtId.toUpperCase()})` : ""} alone holds ${int(top.pendingActions)} pending actions across ${plural(top.pendingMdls, "MDL")}.`,
          anchor: "top-judges",
          anchorLabel: "See the ranking",
        }
      : null,
    hub && hub.sharePct != null
      ? {
          id: "hub-district",
          figure: pct(hub.sharePct),
          text: `${hub.name}${hub.circuit != null ? ` (${circuitLabel(hub.circuit)})` : ""} holds the largest share of pending MDL actions${n?.top5DistrictSharePct != null ? `; the five busiest districts hold ${pct(n.top5DistrictSharePct)}` : ""}.`,
          anchor: "district-benches",
          anchorLabel: "See districts",
        }
      : null,
    p.medianYearsPendingJudges != null && n?.medianYearsActive != null
      ? {
          id: "experience",
          figure: `${p.medianYearsPendingJudges.toFixed(1)} yrs`,
          text: `median service of judges with a pending MDL, against ${n.medianYearsActive.toFixed(1)} yrs for all active district judges.`,
          anchor: "judge-experience",
          anchorLabel: "See the scatter",
        }
      : null,
    d
      ? {
          id: "disclosure-matches",
          figure: `${int(d.exact)} / ${int(d.near)}`,
          text: `exact / near name matches between disclosed investments and MDL parties, over ${int(d.lines)} lines from ${int(d.checked)} of ${int(d.targeted)} judges; a review lead, not a finding.`,
          anchor: "disclosures",
          anchorLabel: "See the review",
        }
      : null,
  ]);
}
