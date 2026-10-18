/**
 * The top of a zero-based axis for a small chart: the data maximum rounded up to a step whose half is also a round
 * number, so the three ticks (0, half, top) read cleanly (1,600 / 800 / 0 rather than 1,291 / 646 / 0).
 */
const STEPS = [1, 1.2, 1.6, 2, 3, 4, 6, 8, 10] as const;

export function niceMax(max: number): number {
  if (!Number.isFinite(max) || max <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(max));
  const fraction = max / pow;
  const step = STEPS.find((s) => fraction <= s + 1e-9) ?? 10;
  // Round away floating-point noise from the multiplication (e.g. 1.2 * 1000).
  return Math.round(step * pow * 1e6) / 1e6;
}
