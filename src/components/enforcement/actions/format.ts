/** Display helpers for enforcement actions. Pure; unknown values render as "Not recorded". */

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
