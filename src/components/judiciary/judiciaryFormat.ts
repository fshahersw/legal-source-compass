import type { PartySplit, SenateVote, Vacancy } from "@/lib/external/judiciary.functions";

export const NR = "Not recorded";

export const fmtN = (n: number | null | undefined) =>
  n == null ? NR : n.toLocaleString("en-US", { maximumFractionDigits: 0 });

export const fmtP = (n: number | null | undefined, digits = 1) =>
  n == null ? NR : `${n.toFixed(digits)}%`;

/** "FY2025", or "FY2026 (Oct-Jun)" for the partial fiscal year. */
export const fyLabel = (fy: number, partial: boolean) =>
  partial ? `FY${fy} (Oct–Jun)` : `FY${fy}`;

/** Yea-nay by party as published, e.g. "D 48–0 · R 5–43 · I 2–0"; parties ordered D, R, then others. */
export function splitText(split: readonly PartySplit[]): string {
  const order = (p: string) => (p === "D" ? 0 : p === "R" ? 1 : 2);
  return [...split]
    .sort((a, b) => order(a.party) - order(b.party) || a.party.localeCompare(b.party))
    .map((s) => `${s.party} ${s.yea}–${s.nay}`)
    .join(" · ");
}

export function tallyText(v: Pick<SenateVote, "yeas" | "nays">): string {
  return v.yeas != null && v.nays != null ? `${v.yeas}–${v.nays}` : NR;
}

/** A name as the AO prints it ("Last,First"), with only a space added after each comma for legibility. */
export function aoName(name: string | null): string {
  return name ? name.replace(/,(?=\S)/g, ", ") : NR;
}

export function courtLabel(v: Pick<Vacancy, "courtName" | "courtAsPublished">): string {
  return v.courtName ?? v.courtAsPublished ?? NR;
}

export const REASON_NOTE =
  "Reasons and dates are as published by the Administrative Office of the U.S. Courts.";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-06-30" -> "Jun 30, 2026"; "2026-06" -> "Jun 2026"; anything else as given. */
export function fmtDay(iso: string | null | undefined): string {
  if (!iso) return NR;
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(iso);
  if (!m) return iso;
  const mon = MONTHS[Number(m[2]) - 1];
  if (!mon) return iso;
  return m[3] ? `${mon} ${Number(m[3])}, ${m[1]}` : `${mon} ${m[1]}`;
}

/** 117 -> "117th", 101 -> "101st", 112 -> "112th". */
export function ordinal(n: number): string {
  const t = n % 100;
  const suffix =
    t >= 11 && t <= 13
      ? "th"
      : n % 10 === 1
        ? "st"
        : n % 10 === 2
          ? "nd"
          : n % 10 === 3
            ? "rd"
            : "th";
  return `${n}${suffix}`;
}

/** Rank text "3 of 94" (1 = highest). */
export const rankText = (rank: number | null, of: number | null) =>
  rank != null && of != null ? `${rank} of ${of}` : NR;
