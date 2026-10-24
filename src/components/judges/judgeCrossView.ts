/** Pure view helpers for the judges cross-analysis page (filtering, ranking, concentration, flags). */
import type { DistrictRow, JudgePoint } from "@/lib/external/judgeCross.functions";
import { FDA_COLORS } from "@/components/fda-analytics/chartView";

export const PARTY_COLOR: Record<string, string> = {
  Democratic: FDA_COLORS[3]!,
  Republican: FDA_COLORS[2]!,
};
export const OTHER_PARTY_COLOR = "var(--muted-foreground)";
export const partyColor = (party: string | null | undefined) =>
  (party && PARTY_COLOR[party]) || OTHER_PARTY_COLOR;
export const TENURE_ORDER = [
  "Under 5 yrs",
  "5–10 yrs",
  "10–15 yrs",
  "15–20 yrs",
  "20–30 yrs",
  "30+ yrs",
] as const;
export const TENURE_COLORS = [
  FDA_COLORS[1]!,
  "#4fa3ab",
  FDA_COLORS[3]!,
  FDA_COLORS[4]!,
  FDA_COLORS[0]!,
  FDA_COLORS[5]!,
];
/** A judge is flagged when their MDLs hold at least this share of all pending MDL actions. */
export const JUDGE_SHARE_FLAG_PCT = 5;
/** A district is flagged as an MDL hub when it holds at least this share of all pending MDL actions. */
export const DISTRICT_SHARE_FLAG_PCT = 5;

export type JudgeFilter = { party: string; status: string; circuit: string; q: string };
export const EMPTY_FILTER: JudgeFilter = { party: "", status: "", circuit: "", q: "" };

export function filterJudges(points: JudgePoint[], f: JudgeFilter) {
  const q = f.q.trim().toLowerCase();
  return points.filter(
    (p) =>
      (!f.party || (f.party === "Other" ? !PARTY_COLOR[p.party ?? ""] : p.party === f.party)) &&
      (!f.status || (f.status === "Senior" ? p.status === "Senior" : p.status !== "Senior")) &&
      (!f.circuit || String(p.circuit ?? "") === f.circuit) &&
      (!q ||
        p.name.toLowerCase().includes(q) ||
        (p.courtId ?? "").includes(q) ||
        (p.state ?? "").toLowerCase().includes(q) ||
        (p.topMdl ?? "").toLowerCase().includes(q)),
  );
}

export function filterDistricts(rows: DistrictRow[], circuit: string) {
  return rows.filter((d) => !circuit || String(d.circuit ?? "") === circuit);
}

export type SortKey =
  "pendingActions" | "pendingMdls" | "historicalMdls" | "totalActions" | "years" | "name";

export function sortJudges(points: JudgePoint[], key: SortKey, desc: boolean) {
  const dir = desc ? -1 : 1;
  return [...points].sort((a, b) => {
    if (key === "name") return dir * a.name.localeCompare(b.name);
    const av = a[key] ?? -1;
    const bv = b[key] ?? -1;
    return dir * (av - bv) || b.pendingActions - a.pendingActions || a.name.localeCompare(b.name);
  });
}

/** Cumulative share of pending actions held by the top-k judges (k = 1..n). */
export function concentrationCurve(points: JudgePoint[]) {
  const sorted = points
    .filter((p) => p.pendingActions > 0)
    .sort((a, b) => b.pendingActions - a.pendingActions);
  const total = sorted.reduce((s, p) => s + p.pendingActions, 0);
  let running = 0;
  return sorted.map((p, i) => {
    running += p.pendingActions;
    return {
      rank: i + 1,
      share: total ? Math.round((1000 * running) / total) / 10 : 0,
      name: p.name,
    };
  });
}

export function judgeFlag(p: JudgePoint) {
  return p.sharePct !== null && p.sharePct >= JUDGE_SHARE_FLAG_PCT;
}

/** A district is flagged as an MDL hub when it holds at least 5% of all pending MDL actions. */
export function districtFlag(d: DistrictRow) {
  return d.sharePct !== null && d.sharePct >= DISTRICT_SHARE_FLAG_PCT;
}

/** Party mix of active judges as stacked segments; unknown parties stay a separate "Other / not recorded". */
export function partySegments(counts: Record<string, number>) {
  const dem = counts["Democratic"] ?? 0;
  const rep = counts["Republican"] ?? 0;
  const other = Object.entries(counts)
    .filter(([k]) => k !== "Democratic" && k !== "Republican")
    .reduce((s, [, v]) => s + v, 0);
  return { Democratic: dem, Republican: rep, Other: other };
}

export function circuitLabel(c: number | null | undefined) {
  if (c === null || c === undefined) return "Not recorded";
  if (c === 0) return "D.C. Circuit";
  const suffix = c === 1 ? "st" : c === 2 ? "nd" : c === 3 ? "rd" : "th";
  return `${c}${suffix} Circuit`;
}

export const fmtInt = (n: number | null | undefined) =>
  typeof n === "number" && Number.isFinite(n) ? n.toLocaleString("en-US") : "Not recorded";
export const fmtPct = (n: number | null | undefined, digits = 1) =>
  typeof n === "number" && Number.isFinite(n) ? `${n.toFixed(digits)}%` : "Not recorded";
export const fmtYears = (n: number | null | undefined) =>
  typeof n === "number" && Number.isFinite(n) ? `${n.toFixed(1)} yrs` : "Not recorded";

export const COVERAGE_LABEL: Record<string, string> = {
  checked: "Checked",
  no_courtlistener_person: "Judge not found in case-law records",
  no_disclosures: "No disclosures recorded",
  no_extracted_investments: "Reports not itemised",
};
