/**
 * Pure models behind the judge profile console (JudgeConsole.tsx). Every figure is a count or a share of recorded
 * rows; nothing is estimated, and a comparison below its minimum sample is not drawn.
 *
 * - Expert admissibility: share of decided Rule 702 / Daubert challenges granted in full or in part, with a 95% Wilson
 *   interval. Decided = granted, granted in part or denied; moot, deferred and undetermined rulings are left out.
 * - MDL endings: actions closed in the transferee court against actions remanded to the transferor court, as the JPML
 *   terminated-litigation history prints them (actions = closed + remanded).
 * - Bench: the court's own district judges in the latest CJRA report; judges sitting by designation are kept apart.
 */
import type { CourtBench, BenchJudge } from "@/lib/external/judgeCjra.functions";
import type { JudgeCrossProfile, JudgeHistoricalMdl } from "@/lib/external/judgeCross.functions";
import type {
  BaselineRuling,
  CounselFirm,
  CourtBenchSeries,
  EndingTotals,
  MdlEndingsBaseline,
} from "@/lib/external/judgeConsole.functions";
import type {
  ExpertRuling,
  RulingMovant,
  RulingOutcome,
} from "@/lib/external/judgeRulings.functions";
import type { FjcRecord } from "@/lib/external/judiciary.functions";

/* ---------------------------------------------------------------- statistics */

export type Wilson = { p: number; lo: number; hi: number };

/** 95% Wilson score interval for k successes in n trials; null for n = 0. */
export function wilson(k: number, n: number, z = 1.96): Wilson | null {
  if (!(n > 0) || k < 0 || k > n) return null;
  const p = k / n;
  const z2 = z * z;
  const den = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / den;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / den;
  return { p, lo: Math.max(0, centre - half), hi: Math.min(1, centre + half) };
}

export function median(values: readonly (number | null | undefined)[]): number | null {
  const v = values
    .filter((x): x is number => typeof x === "number" && Number.isFinite(x))
    .sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m]! : (v[m - 1]! + v[m]!) / 2;
}

/* ---------------------------------------------------------------- header */

/** The service the judge holds now (no termination), else the latest one. */
export function currentService(fjc: FjcRecord | null | undefined) {
  if (!fjc?.services.length) return null;
  return fjc.services.filter((s) => !s.terminationDate).at(-1) ?? fjc.services.at(-1) ?? null;
}

/** Year of the current commission as recorded ("2011"), else null. */
export function commissionYear(fjc: FjcRecord | null | undefined): string | null {
  const c = currentService(fjc)?.commission;
  return c && /^\d{4}/.test(c) ? c.slice(0, 4) : null;
}

/** The last position of the FJC professional-career line, as printed; null when none is recorded. */
export function priorRole(career: string | null | undefined): string | null {
  if (!career) return null;
  const parts = career
    .split(/;\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.at(-1) ?? null;
}

/** Up to three initials for the avatar fallback. */
export function initials(name: string): string {
  return name
    .replace(/,?\s+(Jr|Sr|II|III|IV)\.?$/i, "")
    .split(/\s+/)
    .filter((w) => /^[A-Za-zÀ-ÿ]/.test(w))
    .filter((w, i, a) => i === 0 || i === a.length - 1)
    .map((w) => w[0]!.toUpperCase())
    .join("")
    .slice(0, 3);
}

/* ---------------------------------------------------------------- expert admissibility */

export const DECIDED: readonly RulingOutcome[] = ["granted", "granted_in_part", "denied"];
const GRANTED: readonly RulingOutcome[] = ["granted", "granted_in_part"];
/** Below this many decided rulings a rate is not drawn; below FADE_N it is drawn faded. */
export const RULING_MIN_N = 3;
export const RULING_FADE_N = 30;

export type RulingGroup = "all" | "defendant" | "plaintiff";
export const RULING_GROUPS: { id: RulingGroup; label: string; movant: RulingMovant | null }[] = [
  { id: "all", label: "All challenges", movant: null },
  { id: "defendant", label: "Defense-moved challenges", movant: "defendant" },
  { id: "plaintiff", label: "Plaintiff-moved challenges", movant: "plaintiff" },
];

export type RateCell = { k: number; n: number; ci: Wilson | null; shown: boolean };
export type RulingRow = {
  id: RulingGroup;
  label: string;
  judge: RateCell;
  others: RateCell;
  /** This judge's rulings in the group left out as moot, deferred or undetermined. */
  excluded: number;
};

function rate(
  rows: readonly { movant: RulingMovant; outcome: RulingOutcome }[],
  movant: RulingMovant | null,
): RateCell {
  const inGroup = rows.filter((r) => movant === null || r.movant === movant);
  const decided = inGroup.filter((r) => DECIDED.includes(r.outcome));
  const k = decided.filter((r) => GRANTED.includes(r.outcome)).length;
  const n = decided.length;
  return { k, n, ci: wilson(k, n), shown: n >= RULING_MIN_N };
}

/** One row per challenge group: this judge against every other attributed judge. */
export function rulingRows(
  judge: readonly ExpertRuling[],
  baseline: readonly BaselineRuling[],
  profileId: string,
): RulingRow[] {
  const others = baseline.filter((r) => r.profile !== profileId);
  return RULING_GROUPS.map((g) => ({
    id: g.id,
    label: g.label,
    judge: rate(judge, g.movant),
    others: rate(others, g.movant),
    excluded: judge.filter(
      (r) => (g.movant === null || r.movant === g.movant) && !DECIDED.includes(r.outcome),
    ).length,
  })).filter((r) => r.id === "all" || r.judge.n > 0 || r.others.n > 0);
}

/** Outcome counts for this judge, in published order, for the data table. */
export function outcomeCounts(
  rulings: readonly { outcome: RulingOutcome }[],
): Record<RulingOutcome, number> {
  const out = {
    granted: 0,
    granted_in_part: 0,
    denied: 0,
    denied_as_moot: 0,
    deferred: 0,
    not_determined: 0,
  } as Record<RulingOutcome, number>;
  for (const r of rulings) out[r.outcome] += 1;
  return out;
}

/* ---------------------------------------------------------------- MDL endings */

export type EndingRow = {
  id: string;
  label: string;
  mdls: number;
  closed: number;
  remanded: number;
  /** Remanded share of all actions, 0..100; null when there are no actions. */
  remandedPct: number | null;
};

const endingRow = (id: string, label: string, t: EndingTotals): EndingRow => {
  const total = t.closed + t.remanded;
  return { id, label, ...t, remandedPct: total > 0 ? (t.remanded / total) * 100 : null };
};

/** This judge's terminated MDLs summed; rows without a recorded remand count are left out. */
export function judgeEndings(historical: readonly JudgeHistoricalMdl[]): EndingTotals {
  const t: EndingTotals = { mdls: 0, closed: 0, remanded: 0 };
  for (const h of historical) {
    if (h.remanded === null || h.actions < h.remanded) continue;
    t.mdls += 1;
    t.closed += h.actions - h.remanded;
    t.remanded += h.remanded;
  }
  return t;
}

/** The transferee district the judge's terminated MDLs print most often (ties: alphabetical). */
export function mainDistrict(historical: readonly JudgeHistoricalMdl[]): string | null {
  const n = new Map<string, number>();
  for (const h of historical) if (h.district) n.set(h.district, (n.get(h.district) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
}

/** Judge, the judge's district and all terminated MDLs; null when the judge has no terminated MDL with counts. */
export function endingsModel(
  historical: readonly JudgeHistoricalMdl[],
  baseline: MdlEndingsBaseline | null,
  judgeLabel: string,
): { rows: EndingRow[]; perMdl: EndingRow[] } | null {
  const mine = judgeEndings(historical);
  if (!mine.mdls) return null;
  const rows = [endingRow("judge", judgeLabel, mine)];
  const district = mainDistrict(historical);
  const d = district ? baseline?.byDistrict[district] : undefined;
  if (district && d && d.mdls > mine.mdls)
    rows.push(endingRow("district", `All MDLs, ${district}`, d));
  if (baseline?.all.mdls) rows.push(endingRow("all", "All terminated MDLs", baseline.all));
  const perMdl = historical
    .filter((h) => h.remanded !== null && h.actions >= h.remanded)
    .sort((a, b) => b.year - a.year || b.actions - a.actions)
    .map((h) =>
      endingRow(h.mdl, `MDL ${h.mdl} ${h.caption}`, {
        mdls: 1,
        closed: h.actions - h.remanded!,
        remanded: h.remanded!,
      }),
    );
  return { rows, perMdl };
}

/* ---------------------------------------------------------------- bench */

export type BenchPoint = { id: string; label: string; x: number; y: number };

/** The court's own judges with both docket-flow measures, for the scatter; the rest are counted. */
export function benchScatter(bench: CourtBench | null | undefined): {
  points: BenchPoint[];
  own: number;
  missing: number;
  medianMotions: number | null;
  medianDays: number | null;
} | null {
  if (!bench?.judges.length) return null;
  const own = bench.judges.filter((j) => j.visiting === null);
  if (!own.length) return null;
  const points = own
    .filter(
      (j): j is BenchJudge & { motions6m: number; medianDaysCivil: number } =>
        j.motions6m !== null && j.medianDaysCivil !== null,
    )
    .map((j) => ({ id: j.recordId, label: j.name, x: j.motions6m, y: j.medianDaysCivil }));
  return {
    points,
    own: own.length,
    missing: own.length - points.length,
    medianMotions: median(own.map((j) => j.motions6m)),
    medianDays: median(own.map((j) => j.medianDaysCivil)),
  };
}

/** The bench judge row of this judge: the unique row whose linked profile is this judge. */
export function benchSelf(
  bench: CourtBench | null | undefined,
  profileId: string,
): BenchJudge | null {
  const rows = bench?.judges.filter((j) => j.profileId === profileId) ?? [];
  return rows.length === 1 ? rows[0]! : null;
}

export type BenchMapRow = { id: string; label: string; values: (number | null)[]; self: boolean };

/**
 * Rows of the bench map: this judge first, then the court's own judges by surname. Judges the bench lists as
 * visiting are left out; a judge with no value in the window is dropped.
 */
export function benchMapRows(
  series: CourtBenchSeries | null | undefined,
  bench: CourtBench | null | undefined,
  selfRecordId: string | null,
): BenchMapRow[] {
  if (!series?.periods.length) return [];
  const visiting = new Set(
    (bench?.judges ?? []).filter((j) => j.visiting !== null).map((j) => j.recordId),
  );
  const surname = (n: string) =>
    n
      .replace(/,?\s+(Jr|Sr|II|III|IV)\.?$/i, "")
      .split(/\s+/)
      .at(-1) ?? n;
  return series.judges
    .filter((j) => !visiting.has(j.recordId) && j.motions6m.some((v) => v !== null))
    .map((j) => ({
      id: j.recordId,
      label: j.name,
      values: j.motions6m,
      self: j.recordId === selfRecordId,
    }))
    .sort(
      (a, b) =>
        Number(b.self) - Number(a.self) ||
        surname(a.label).localeCompare(surname(b.label)) ||
        a.label.localeCompare(b.label),
    );
}

/* ---------------------------------------------------------------- counsel */

export type CounselBar = {
  id: string;
  label: string;
  plaintiff: number;
  defense: number;
  other: number;
  total: number;
  mdls: string[];
};

export function counselBars(firms: readonly CounselFirm[], limit = 10): CounselBar[] {
  return firms.slice(0, limit).map((f) => ({
    id: f.id,
    label: f.firm,
    plaintiff: f.plaintiff,
    defense: f.defense,
    other: f.other,
    total: f.plaintiff + f.defense + f.other,
    mdls: f.mdls,
  }));
}

/** MDL numbers this judge presides or presided over, pending first, without repeats. */
export function judgeMdlNumbers(cross: JudgeCrossProfile | null | undefined): string[] {
  if (!cross) return [];
  const out: string[] = [];
  for (const m of [
    ...cross.pending.map((p) => String(p.mdl)),
    ...cross.historical.map((h) => h.mdl),
  ])
    if (/^\d{1,5}$/.test(m) && !out.includes(m)) out.push(m);
  return out.slice(0, 40);
}

/* ---------------------------------------------------------------- pending MDLs */

export function pendingBars(cross: JudgeCrossProfile | null | undefined) {
  return [...(cross?.pending ?? [])]
    .sort((a, b) => b.pending - a.pending || a.mdl - b.mdl)
    .map((p) => ({
      id: String(p.mdl),
      label: `MDL ${p.mdl} ${p.title.replace(/^IN RE:\s*/i, "")}`,
      value: p.pending,
      change12m: p.change12m,
    }));
}

/* ---------------------------------------------------------------- formatting */

export const fmtInt = (v: number | null | undefined) =>
  typeof v === "number" && Number.isFinite(v) ? Math.round(v).toLocaleString("en-US") : null;
export const fmtPct0 = (v: number | null | undefined) =>
  typeof v === "number" && Number.isFinite(v) ? `${Math.round(v)}%` : null;
export const fmtShare = (p: number) => `${Math.round(p * 100)}%`;

/* ---------------------------------------------------------------- layout */

export type PanelSpan = 4 | 5 | 6 | 7 | 8 | 12;

/** Spans in reading order; when a row would not fill 12 columns its last panel stretches to the row end. */
export function layoutSpans(spans: readonly PanelSpan[]): PanelSpan[] {
  const out = [...spans];
  let used = 0;
  let rowStart = 0;
  for (let i = 0; i < out.length; i++) {
    if (used + out[i]! > 12) {
      stretch(out, rowStart, i - 1, used);
      used = 0;
      rowStart = i;
    }
    used += out[i]!;
  }
  stretch(out, rowStart, out.length - 1, used);
  return out;
}

function stretch(out: PanelSpan[], from: number, to: number, used: number) {
  if (to < from || used >= 12) return;
  if (from === to) {
    out[to] = 12;
    return;
  }
  const grow = out[to]! + (12 - used);
  out[to] = ([4, 5, 6, 7, 8, 12] as const).includes(grow as 4) ? (grow as PanelSpan) : out[to]!;
}
