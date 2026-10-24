/**
 * Pure axis helpers for the recharts theme layer: nice value ticks (1, 2 or 5 times a power of ten, 4–6 of them),
 * the value extent of plotted rows (stack totals for stacked bars), compact tick text and the axis width the tick
 * labels need. No React, no DOM.
 */
import { compactNumber } from "../format";
import { niceDomain } from "../scale";

/** Axis tick font size in px (the chart standard: muted 12 px ticks). */
export const TICK_FONT = 12;

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * Values plotted from `rows` under `keys`. With `stacked`, the per-row sums of the positive and of the negative
 * values (the heights a stacked bar reaches) instead of the single values.
 */
export function plottedValues(
  rows: readonly Record<string, unknown>[],
  keys: readonly string[],
  stacked = false,
): number[] {
  const out: number[] = [];
  for (const r of rows) {
    if (stacked) {
      let pos = 0;
      let neg = 0;
      let any = false;
      for (const k of keys) {
        const v = r[k];
        if (!isNum(v)) continue;
        any = true;
        if (v >= 0) pos += v;
        else neg += v;
      }
      if (any) out.push(pos, neg);
    } else for (const k of keys) if (isNum(r[k])) out.push(r[k] as number);
  }
  return out;
}

export type NiceAxis = { domain: [number, number]; ticks: number[] };

/**
 * Domain and ticks for a value axis. `zero` (default true) keeps the honest zero baseline for counts and amounts;
 * `count` is the target number of intervals (4 gives 5 ticks). Extra values (reference lines) can be passed in so
 * they always sit inside the plot.
 */
export function niceAxis(
  values: readonly number[],
  options: { zero?: boolean; count?: number; include?: readonly number[] } = {},
): NiceAxis {
  const all = [...values, ...(options.include ?? [])].filter(isNum);
  if (!all.length) return { domain: [0, 1], ticks: [0, 1] };
  return niceDomain(all, { zero: options.zero ?? true, count: options.count ?? 4 });
}

/** Axis domain and ticks straight from rows and keys. */
export function niceAxisFor(
  rows: readonly Record<string, unknown>[],
  keys: readonly string[],
  options: { zero?: boolean; count?: number; stacked?: boolean; include?: readonly number[] } = {},
): NiceAxis {
  return niceAxis(plottedValues(rows, keys, options.stacked ?? false), options);
}

/** Compact tick text: 0, 950, 1.2K, 50K, 1.4M, 2.1B; with a prefix ("$") or a suffix ("%"). */
export function tickText(v: number, options: { prefix?: string; suffix?: string } = {}): string {
  if (!isNum(v)) return "";
  return `${compactNumber(v, options.prefix ?? "")}${options.suffix ?? ""}`;
}

/** Percent tick: "0%", "25%", "12.5%". */
export function percentTick(v: number): string {
  if (!isNum(v)) return "";
  return `${Number.isInteger(v) ? v : Number(v.toFixed(1))}%`;
}

/** Rough rendered width of a label in Public Sans (about 0.58 em per character; digits run wide). */
export function labelWidth(text: string, fontSize = TICK_FONT): number {
  return text.length * fontSize * 0.58;
}

/** Width a value axis needs for its tick labels, with room for the tick gap. */
export function axisWidth(
  ticks: readonly number[],
  format: (v: number) => string,
  fontSize = TICK_FONT,
): number {
  const widest = Math.max(0, ...ticks.map((t) => labelWidth(format(t), fontSize)));
  return Math.ceil(Math.max(28, widest + 16));
}

/** Width a category axis (horizontal bars) needs, capped so long names truncate instead of squeezing the bars. */
export function categoryAxisWidth(
  labels: readonly string[],
  options: { fontSize?: number; min?: number; max?: number } = {},
): number {
  const fs = options.fontSize ?? TICK_FONT;
  const widest = Math.max(0, ...labels.map((l) => labelWidth(l, fs)));
  return Math.ceil(Math.min(options.max ?? 180, Math.max(options.min ?? 40, widest + 12)));
}

/** A label cut to fit `maxWidth` px, with an ellipsis. */
export function fitText(text: string, maxWidth: number, fontSize = TICK_FONT): string {
  const max = Math.max(1, Math.floor(maxWidth / (fontSize * 0.56)));
  return text.length > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text;
}

/**
 * Indices of the category ticks to print so labels never collide: every one when they fit, else every k-th at a
 * regular step, always including the last (the latest period is the one readers look for).
 */
export function tickIndices(count: number, available: number, widest: number): number[] {
  if (count <= 0) return [];
  const fit = Math.max(1, Math.floor(available / Math.max(1, widest + 8)));
  const step = Math.max(1, Math.ceil(count / fit));
  const out: number[] = [];
  for (let i = (count - 1) % step; i < count; i += step) out.push(i);
  return out;
}
