/**
 * Pure model of the verdict stack: one 100%-normalised bar per subject made of outcome tags, percentages that round to
 * exactly 100, a colour per tag in fixed palette order (a tag past the sixth slot is the neutral "Other"). Tested in
 * editorial.test.ts.
 */
import { MAX_SERIES } from "../palette";

export type VerdictSubject = {
  id?: string | undefined;
  label: string;
  /** Count per tag key; null or negative means not recorded for that tag. */
  counts: Readonly<Record<string, number | null | undefined>>;
  /** Shown as n=…; defaults to the sum of the recorded counts. */
  n?: number | undefined;
};

export type VerdictTag = {
  key: string;
  label: string;
  /** Overrides the palette slot (a CSS colour token). */
  color?: string | undefined;
};

export type VerdictGroup = { group: string; tags: readonly VerdictTag[] };

export type VerdictSegment = {
  key: string;
  label: string;
  count: number;
  /** Exact share of the subject's recorded total, 0–100. */
  percent: number;
  /** Whole-number share; the segments of one subject sum to 100. */
  rounded: number;
  recorded: boolean;
};

/** Whole percentages that sum to 100 (largest remainder), so printed shares always add up. */
export function roundShares(parts: readonly number[]): number[] {
  const total = parts.reduce((a, v) => a + v, 0);
  if (!(total > 0)) return parts.map(() => 0);
  const exact = parts.map((v) => (v / total) * 100);
  const floor = exact.map(Math.floor);
  let left = 100 - floor.reduce((a, v) => a + v, 0);
  const order = exact
    .map((v, i) => ({ i, rem: v - Math.floor(v) }))
    .sort((a, b) => b.rem - a.rem || a.i - b.i);
  for (const o of order) {
    if (left <= 0) break;
    floor[o.i]! += 1;
    left -= 1;
  }
  return floor;
}

const recordedCount = (v: number | null | undefined): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;

/** The segments of one subject's bar, in taxonomy order. */
export function verdictSegments(
  subject: VerdictSubject,
  tags: readonly VerdictTag[],
): { segments: VerdictSegment[]; total: number; n: number } {
  const counts = tags.map((t) => recordedCount(subject.counts[t.key]));
  const vals = counts.map((c) => c ?? 0);
  const total = vals.reduce((a, v) => a + v, 0);
  const rounded = roundShares(vals);
  return {
    segments: tags.map((t, i) => ({
      key: t.key,
      label: t.label,
      count: vals[i]!,
      percent: total > 0 ? (vals[i]! / total) * 100 : 0,
      rounded: rounded[i]!,
      recorded: counts[i] !== null,
    })),
    total,
    n: subject.n ?? total,
  };
}

/** Colour per tag key: palette slots in taxonomy order, then the neutral Other; an explicit colour wins. */
export function tagPaints(
  groups: readonly VerdictGroup[],
): Map<string, { fill: string; ink: string }> {
  const out = new Map<string, { fill: string; ink: string }>();
  groups
    .flatMap((g) => g.tags)
    .forEach((t, i) => {
      if (t.color) out.set(t.key, { fill: t.color, ink: "var(--chart-ink)" });
      else if (i < MAX_SERIES)
        out.set(t.key, { fill: `var(--chart-${i + 1})`, ink: `var(--chart-on-${i + 1})` });
      else out.set(t.key, { fill: "var(--chart-other)", ink: "var(--chart-ink)" });
    });
  return out;
}

/** Subjects ordered by the share of one tag, largest first (ties keep their order). */
export function sortByTag(
  subjects: readonly VerdictSubject[],
  tags: readonly VerdictTag[],
  key: string,
): VerdictSubject[] {
  return subjects
    .map((s, i) => ({
      s,
      i,
      share: verdictSegments(s, tags).segments.find((x) => x.key === key)?.percent ?? 0,
    }))
    .sort((a, b) => b.share - a.share || a.i - b.i)
    .map((o) => o.s);
}
