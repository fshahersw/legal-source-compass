/** Display helpers for enforcement actions. Pure; unknown values render as "Not recorded". */
import type { HeadlineFigure } from "@/lib/external/enforcementActions.functions";

export const NOT_RECORDED = "Not recorded";

export const fmtInt = (n: number) => n.toLocaleString("en-US");

/** "$1.20 billion", "$34.80 million", "$310,000" — the stated figure, never rounded to a different magnitude. */
export function fmtUsd(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return NOT_RECORDED;
  if (value >= 1e9)
    return `$${(value / 1e9).toLocaleString("en-US", { maximumFractionDigits: 2 })} billion`;
  if (value >= 1e6)
    return `$${(value / 1e6).toLocaleString("en-US", { maximumFractionDigits: 2 })} million`;
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

export type FigureView = {
  /** The release's headline figure (or, without one, the largest stated resolution figure). */
  primary: string | null;
  /** "also states $2.3 billion": the largest stated resolution figure, only when it is another value. */
  secondary: string | null;
  /** Where the primary figure was read, verbatim. */
  note: string | null;
};

export function figureView(headline: HeadlineFigure | null, largest: number | null): FigureView {
  if (headline) {
    return {
      primary: fmtUsd(headline.valueUsd),
      secondary:
        headline.differsFromLargest && largest != null ? `also states ${fmtUsd(largest)}` : null,
      note:
        headline.source === "title"
          ? `As written in the title: ${headline.asWritten}`
          : `As written in the first resolution sentence: “${headline.sentence ?? headline.asWritten}”`,
    };
  }
  if (largest != null)
    return { primary: fmtUsd(largest), secondary: null, note: "Largest resolution figure stated" };
  return { primary: null, secondary: null, note: null };
}

const DAY = 86_400_000;
/** Whole calendar days from `from` to `to` (YYYY-MM-DD, UTC). */
export function daysUntil(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);
}

export function deadlineNote(today: string, deadline: string | null): string | null {
  if (!deadline) return null;
  const d = daysUntil(today, deadline);
  if (d < 0) return "passed";
  if (d === 0) return "today";
  return `in ${fmtInt(d)}d`;
}

/** Keyword labels for stated dollar figures (the first keyword found in the figure's sentence). */
export function keywordLabel(keyword: string | null): string {
  return keyword ? keyword : "no keyword in sentence";
}

export function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}
