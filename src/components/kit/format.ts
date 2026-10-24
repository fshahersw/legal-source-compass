/**
 * Kit number and delta helpers: pure, deterministic and tested (format.test.ts).
 *
 * - `deltaDirection` turns a signed change into up / down / flat (null when the change is not a finite number).
 * - `deltaTone` colours a delta only when the metric has an agreed good direction; otherwise it stays neutral, so a
 *   rise in filings or recalls is never painted as "good" or "bad" by default.
 * - `formatSigned`, `formatSignedPercent` and `formatCompact` print numbers with a true minus sign (U+2212).
 * - `splitChangeText` splits a model's change sentence ("+12,700 (+4.4%) vs FY2024") into its parts without changing
 *   any figure, so a card can show the percentage as a pill and the rest as a line beside it.
 */

export type DeltaDirection = "up" | "down" | "flat";
/** The direction that is agreed to be good for a metric; absent means no direction is good or bad. */
export type GoodDirection = "up" | "down";
export type DeltaTone = "good" | "bad" | "neutral";

export const MINUS = "−";

const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Direction of a signed change; null for null, NaN or an infinite value (no change can be stated). */
export function deltaDirection(change: number | null | undefined): DeltaDirection | null {
  if (!isNumber(change)) return null;
  return change > 0 ? "up" : change < 0 ? "down" : "flat";
}

/** Tone of a delta: good/bad only against an agreed good direction, neutral otherwise (and always for flat). */
export function deltaTone(
  direction: DeltaDirection | null | undefined,
  good?: GoodDirection | null,
): DeltaTone {
  if (!direction || direction === "flat" || !good) return "neutral";
  return direction === good ? "good" : "bad";
}

/** Words for a direction, for screen readers and tooltips. */
export function directionLabel(direction: DeltaDirection | null | undefined): string {
  return direction === "up"
    ? "Up"
    : direction === "down"
      ? "Down"
      : direction === "flat"
        ? "No change"
        : "";
}

/** "+12,700", "−19", "0"; `digits` fixes the decimals (default: as many as the value has, up to 2). */
export function formatSigned(
  value: number,
  opts: { digits?: number; suffix?: string } = {},
): string {
  if (!isNumber(value)) return "";
  const { digits, suffix = "" } = opts;
  const abs = Math.abs(value).toLocaleString("en-US", {
    minimumFractionDigits: digits ?? 0,
    maximumFractionDigits: digits ?? 2,
  });
  // a value that rounds to zero at the shown precision is printed without a sign
  const shownZero = Number(abs.replace(/,/g, "")) === 0;
  const sign = shownZero ? "" : value > 0 ? "+" : MINUS;
  return `${sign}${abs}${suffix}`;
}

/** "+4.4%", "−40.4%", "0.0%". */
export function formatSignedPercent(value: number, digits = 1): string {
  return formatSigned(value, { digits, suffix: "%" });
}

/** Compact magnitude: 950, 12.9K, 1.2M, 3.4B (one decimal, trailing ".0" dropped). Negative values keep a minus sign. */
export function formatCompact(value: number): string {
  if (!isNumber(value)) return "";
  const abs = Math.abs(value);
  const sign = value < 0 ? MINUS : "";
  const units: [number, string][] = [
    [1e3, "K"],
    [1e6, "M"],
    [1e9, "B"],
    [1e12, "T"],
  ];
  let i = units.length - 1;
  while (i >= 0 && abs < units[i]![0]) i--;
  if (i < 0) return `${sign}${abs.toLocaleString("en-US", { maximumFractionDigits: 1 })}`;
  let scaled = Math.round((abs / units[i]![0]) * 10) / 10;
  // 999,950 rounds to 1,000.0K: carry into the next unit instead
  if (scaled >= 1000 && i < units.length - 1) {
    i += 1;
    scaled = Math.round((abs / units[i]![0]) * 10) / 10;
  }
  return `${sign}${scaled.toLocaleString("en-US", { maximumFractionDigits: 1 })}${units[i]![1]}`;
}

export type ChangeParts = {
  /** The change without its percentage, e.g. "+12,700" or "+0.3 percentage points". */
  change: string;
  /** The percentage as printed, e.g. "+4.4%"; null when the sentence carries none. */
  percent: string | null;
  /** What the change is measured against, e.g. "FY2024"; null when the sentence names nothing. */
  comparison: string | null;
};

/**
 * Splits "<change>[ (<percent>)] vs <comparison>" into its parts, keeping every character of each part. The change
 * part is numeric, so the first " vs " is the separator. A sentence of another shape is returned whole as `change`.
 */
export function splitChangeText(text: string): ChangeParts {
  const at = text.indexOf(" vs ");
  const head = at >= 0 ? text.slice(0, at) : text;
  const comparison = at >= 0 ? text.slice(at + 4).trim() || null : null;
  const m = /^(.*?)\s\(([+\-−]?[\d.,]+%)\)$/.exec(head.trim());
  if (m) return { change: m[1]!.trim(), percent: m[2]!, comparison };
  return { change: head.trim(), percent: null, comparison };
}
