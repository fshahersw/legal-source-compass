/**
 * Six-step ordinal ramp for the law visualizations (recency classes, daily-count classes). One hue (chart slot 1, blue),
 * built only from chart tokens: the three light steps mix slot 1 into the chart surface, the two dark steps mix it into
 * the ink. Validated 2026-10-23 with the dataviz ordinal checks against the white surface (monotone lightness, adjacent
 * ΔL >= 0.06, light end 2.08:1, single hue): #9bb6da, #759bcb, #507fbb, #2863ab, #24518a, #20406a.
 * Labels set inside a step use the dark ink on steps 0–1 and the light ink on steps 2–5.
 */
export const RAMP = [
  "color-mix(in oklab, var(--chart-1) 46%, var(--chart-surface))",
  "color-mix(in oklab, var(--chart-1) 64%, var(--chart-surface))",
  "color-mix(in oklab, var(--chart-1) 82%, var(--chart-surface))",
  "var(--chart-1)",
  "color-mix(in oklab, var(--chart-1) 75%, var(--chart-ink))",
  "color-mix(in oklab, var(--chart-1) 50%, var(--chart-ink))",
] as const;

export const rampInkLight = (step: number) => step >= 2;

/** The step for class `i` of `n` classes, spread over the ramp so few classes still span light to dark. */
export function rampStep(i: number, n: number): number {
  if (n <= 1) return 3;
  return Math.round((i / (n - 1)) * (RAMP.length - 1));
}

/** Zero (a covered day with no record): the neutral muted surface, distinct from the hatched "not recorded". */
export const ZERO_FILL = "var(--muted)";
