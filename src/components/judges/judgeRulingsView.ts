/**
 * Pure view model of a judge's recorded expert-admissibility rulings: tallies by movant side, the n thresholds that
 * decide how much is drawn, and the wording. Rules (feature-judge-outcomes):
 *  - a chart only when the judge has at least 5 recorded rulings; below that, a short list;
 *  - shares (percentages) only for a base of at least 20; below that, counts only;
 *  - plaintiffs' and defendants' motions are never mixed in one bar, and "Not determined" is always a segment;
 *  - nothing is ranked and nothing is phrased as a rate or a forecast.
 */
import type {
  ExpertRuling,
  RulingMovant,
  RulingOutcome,
} from "@/lib/external/judgeRulings.functions";

export const CHART_MIN_N = 5;
export const SHARE_MIN_N = 20;

export const OUTCOME_LABELS: Record<RulingOutcome, string> = {
  granted: "Granted",
  granted_in_part: "Granted in part",
  denied: "Denied",
  denied_as_moot: "Denied as moot",
  deferred: "Deferred",
  not_determined: "Not determined",
};
export const OUTCOME_ORDER: readonly RulingOutcome[] = [
  "granted",
  "granted_in_part",
  "denied",
  "denied_as_moot",
  "deferred",
  "not_determined",
];
export const MOVANT_LABELS: Record<RulingMovant, string> = {
  plaintiff: "Plaintiffs' motions",
  defendant: "Defendants' motions",
  other: "Other or not printed",
};
const MOVANT_ORDER: readonly RulingMovant[] = ["plaintiff", "defendant", "other"];

export const RULINGS_CAPTION =
  "Rulings this corpus records; not every ruling. Outcomes depend on the motion, the expert and the record, and say nothing about how a future motion will be decided.";

export type MovantTally = {
  movant: RulingMovant;
  label: string;
  n: number;
  counts: Record<RulingOutcome, number>;
};
export type RulingsMode = "none" | "list" | "counts" | "shares";
export type RulingsView = {
  n: number;
  mode: RulingsMode;
  /** One subject per movant side with at least one ruling, in a fixed order (never sorted by outcome). */
  subjects: MovantTally[];
  first: string | null;
  last: string | null;
};

/** How much may be drawn for n rulings. */
export function rulingsMode(n: number): RulingsMode {
  if (!Number.isFinite(n) || n <= 0) return "none";
  if (n < CHART_MIN_N) return "list";
  return n >= SHARE_MIN_N ? "shares" : "counts";
}

/** Whether a subject (one movant side) may be shown as shares: only on a base of at least 20. */
export function subjectShowsShares(t: MovantTally): boolean {
  return t.n >= SHARE_MIN_N;
}

export function rulingsView(rulings: readonly ExpertRuling[]): RulingsView {
  const by = new Map<RulingMovant, MovantTally>();
  for (const r of rulings) {
    let t = by.get(r.movant);
    if (!t) {
      t = {
        movant: r.movant,
        label: MOVANT_LABELS[r.movant],
        n: 0,
        counts: {
          granted: 0,
          granted_in_part: 0,
          denied: 0,
          denied_as_moot: 0,
          deferred: 0,
          not_determined: 0,
        },
      };
      by.set(r.movant, t);
    }
    t.n += 1;
    t.counts[r.outcome] += 1;
  }
  const dates = rulings
    .map((r) => r.date)
    .filter((d): d is string => !!d)
    .sort();
  const n = rulings.length;
  const subjects = MOVANT_ORDER.map((m) => by.get(m)).filter((t): t is MovantTally => !!t);
  // shares only when every subject drawn has a base of at least 20; otherwise the whole card shows counts
  const mode = rulingsMode(n);
  return {
    n,
    mode: mode === "shares" && !subjects.every(subjectShowsShares) ? "counts" : mode,
    subjects,
    first: dates[0] ?? null,
    last: dates.at(-1) ?? null,
  };
}

/** "2021–2025", "2024", or null. */
export function rulingsPeriod(v: Pick<RulingsView, "first" | "last">): string | null {
  const a = v.first?.slice(0, 4);
  const b = v.last?.slice(0, 4);
  if (!a || !b) return null;
  return a === b ? a : `${a}–${b}`;
}

/** The card heading: what was recorded, never a rate. */
export function rulingsTitle(v: RulingsView): string {
  if (v.n === 0) return "No recorded expert-admissibility rulings";
  const period = rulingsPeriod(v);
  return `${v.n.toLocaleString("en-US")} recorded expert-admissibility ruling${v.n === 1 ? "" : "s"}${period ? `, ${period}` : ""}`;
}
