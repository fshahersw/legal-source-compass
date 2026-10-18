/**
 * Insight construction with the contract enforced in one place. A generator never builds an `Insight`
 * literal: it calls `makeInsight`, which returns null (the candidate is dropped) when the draft would show a
 * placeholder, an unformatted number or fewer sentences/points than the card promises.
 */
import type { Insight, InsightKind, InsightPoint, InsightSourceLink } from "./types";
import { score as clampScore } from "./format";

export type InsightDraft = {
  section: string;
  /** Short stable slug; the id becomes `<section>.<slug>`. Never put a date or a figure in it. */
  slug: string;
  kind: InsightKind;
  headline: string;
  /** Falsy entries are skipped so a generator can write `cond && "sentence"` inline. */
  summary: readonly (string | null | undefined | false)[];
  points: readonly (InsightPoint | null | undefined | false)[];
  caveat?: string | null | undefined;
  sources: readonly InsightSourceLink[];
  dataThrough?: string | null | undefined;
  score: number;
};

/** Text that means a value failed to compute somewhere upstream. */
const BAD_TEXT = /\bNaN\b|\bundefined\b|\bInfinity\b|\[object|\bnull\b/;
const SAFE_HREF = /^(\/(?!\/)|https:\/\/)/;

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

export const SUMMARY_MIN = 2;
export const SUMMARY_MAX = 4;
export const POINTS_MIN = 3;
export const POINTS_MAX = 5;

export function makeInsight(draft: InsightDraft): Insight | null {
  const summary = draft.summary
    .filter((s): s is string => typeof s === "string" && clean(s) !== "")
    .map(clean);
  const points = draft.points
    .filter((p): p is InsightPoint => !!p && clean(p.label) !== "" && clean(p.value) !== "")
    .map((p) => ({
      label: clean(p.label),
      value: clean(p.value),
      ...(p.note && clean(p.note) ? { note: clean(p.note) } : {}),
      ...(p.href && SAFE_HREF.test(p.href) ? { href: p.href } : {}),
    }));
  const sources = draft.sources.filter((s) => clean(s.label) !== "" && SAFE_HREF.test(s.href));
  const headline = clean(draft.headline);
  if (!draft.section || !/^[a-z0-9][a-z0-9-]*$/.test(draft.slug)) return null;
  if (!headline || headline.length > 220) return null;
  if (summary.length < SUMMARY_MIN || summary.length > SUMMARY_MAX) return null;
  if (points.length < POINTS_MIN) return null;
  if (!sources.length) return null;
  const caveat = draft.caveat ? clean(draft.caveat) : "";
  const texts = [
    headline,
    ...summary,
    caveat,
    draft.dataThrough ?? "",
    ...points.flatMap((p) => [p.label, p.value, p.note ?? ""]),
  ];
  if (texts.some((t) => BAD_TEXT.test(t))) return null;
  return {
    id: `${draft.section}.${draft.slug}`,
    section: draft.section,
    kind: draft.kind,
    headline,
    summary,
    points: points.slice(0, POINTS_MAX),
    ...(caveat ? { caveat } : {}),
    sources,
    ...(draft.dataThrough ? { dataThrough: draft.dataThrough } : {}),
    score: clampScore(draft.score),
  };
}

/** Drop nulls and cap the pool at `max`, keeping the most notable (ties by id so the cut is stable). */
export function finishPool(candidates: readonly (Insight | null)[], max = 10): Insight[] {
  const seen = new Set<string>();
  const unique = candidates.filter((c): c is Insight => {
    if (!c || seen.has(c.id)) return false;
    seen.add(c.id);
    return true;
  });
  return unique
    .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, max);
}
