/**
 * Chart tokens: the one place chart colours are defined. Marks reference them as `var(--chart-…)`; the variables are set
 * on every chart root by `chartTokens` (see ChartFrame), so a chart never carries a raw colour.
 *
 * Categorical slots (identity of a series) were checked with the dataviz palette validator on the white chart surface
 * (2026-10-23): lightness band 0.43–0.77 PASS, chroma >= 0.10 PASS, worst adjacent CVD ΔE 11.0 (protan) PASS, worst
 * adjacent normal-vision ΔE 22.9 PASS; slot 5 (ochre) is 2.9:1 against the surface, so every chart ships its data table
 * and direct labels (the relief rule). Scatter, maps and small multiples (any two marks can touch) use at most the
 * first three slots, which pass the all-pairs test (CVD ΔE 11.0, normal-vision 19.6).
 *
 * Dark theme: selected dark steps of the same six hues (not an automatic flip), validated 2026-10-24 on the dark card
 * surface #141618: lightness band 0.48–0.67 PASS, chroma >= 0.10 PASS, worst adjacent CVD ΔE 11.4 (protan) PASS,
 * worst adjacent normal-vision ΔE 21.6 PASS, every slot >= 3:1 against the surface (and against the page background
 * #0b0c0e); first three slots all-pairs PASS (CVD ΔE 11.4, normal-vision 15.5). Each `--chart-N` is
 * `light-dark(light, dark)`, so a chart follows the page's `color-scheme` (styles.css sets it per theme) with no
 * theme check in component code.
 *
 * Slots are assigned in fixed order and follow the entity, never its rank; a seventh series is folded or faceted, never
 * given a generated hue. Sequential shading reuses the map ramp (--map-low → --map-high); the diverging pair is slot 1
 * (blue) against slot 2 (orange) with a neutral grey midpoint.
 */
import type { CSSProperties } from "react";

/** OKLCH source of each slot, for the record: blue 0.50/0.13/255, orange 0.68/0.15/60, teal 0.62/0.11/175,
 * violet 0.52/0.14/295, ochre 0.68/0.14/85, magenta 0.58/0.16/350. */
export const CATEGORICAL_HEX = [
  "#2863ab",
  "#da7e1e",
  "#1f9b82",
  "#7055b0",
  "#c09000",
  "#bc4b87",
] as const;

/** Dark-theme steps of the same slots, in the same order: OKLCH blue 0.62/0.13/255, orange 0.66/0.15/60, teal
 * 0.62/0.11/175, violet 0.62/0.14/295, ochre 0.66/0.13/85, magenta 0.62/0.16/350. */
export const CATEGORICAL_HEX_DARK = [
  "#4c88d3",
  "#d37812",
  "#1f9b82",
  "#8d73d1",
  "#b68b16",
  "#ca5794",
] as const;

/** The CSS value of slot `index` (0-based) for both themes: `light-dark(light, dark)`. */
export function slotColor(index: number): string {
  return `light-dark(${CATEGORICAL_HEX[index]}, ${CATEGORICAL_HEX_DARK[index]})`;
}

/**
 * Label ink for text set inside a slot's fill (a stacked area, a bar segment): white or near-black, whichever gives
 * the higher WCAG ratio on that fill (checked 2026-10-24 with the dataviz validator's contrast()). Light theme:
 * slot 1 white 6.1, slot 2 ink 6.1, slot 3 ink 5.3, slot 4 white 5.8, slot 5 ink 6.4, slot 6 white 4.7. Dark theme:
 * every fill is lighter, so all six take ink (4.7 to 5.9). Text outside a fill never wears a series colour.
 */
export const SLOT_INK_LIGHT = [
  "#ffffff",
  "#111418",
  "#111418",
  "#ffffff",
  "#111418",
  "#ffffff",
] as const;
export const SLOT_INK_DARK = [
  "#111418",
  "#111418",
  "#111418",
  "#111418",
  "#111418",
  "#111418",
] as const;

export const MAX_SERIES = CATEGORICAL_HEX.length;
/** Forms where every mark can sit beside every other (scatter, maps, small multiples) use at most this many hues. */
export const MAX_ALL_PAIRS_SERIES = 3;

/** Categorical colour of slot `index` (0-based). Never cycles: an index past the palette is a caller error. */
export function seriesVar(index: number): string {
  if (!Number.isInteger(index) || index < 0 || index >= MAX_SERIES)
    throw new RangeError(`Series slot ${index} is outside the ${MAX_SERIES}-slot palette.`);
  return `var(--chart-${index + 1})`;
}

/** Label ink for text inside slot `index`'s fill: `var(--chart-on-N)`, set on every chart root by `chartTokens`. */
export function seriesOn(index: number): string {
  if (!Number.isInteger(index) || index < 0 || index >= MAX_SERIES)
    throw new RangeError(`Series slot ${index} is outside the ${MAX_SERIES}-slot palette.`);
  return `var(--chart-on-${index + 1})`;
}

/** Sequential shade for t in [0, 1] (light → dark), from the shared map ramp. */
export function sequentialFill(t: number): string {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0));
  return `color-mix(in srgb, var(--map-high) ${Math.round(10 + 85 * clamped)}%, var(--map-low))`;
}

/** Diverging shade for t in [-1, 1]: negative arm orange, positive arm blue, 0 the neutral grey midpoint. */
export function divergingFill(t: number): string {
  const clamped = Math.min(1, Math.max(-1, Number.isFinite(t) ? t : 0));
  const pole = clamped < 0 ? "var(--chart-2)" : "var(--chart-1)";
  return `color-mix(in srgb, ${pole} ${Math.round(Math.abs(clamped) * 85)}%, var(--chart-mid))`;
}

/** CSS variables every chart root sets. The neutral and ink roles map onto the app's own tokens. */
export const chartTokens: CSSProperties = {
  ["--chart-1" as string]: slotColor(0),
  ["--chart-2" as string]: slotColor(1),
  ["--chart-3" as string]: slotColor(2),
  ["--chart-4" as string]: slotColor(3),
  ["--chart-5" as string]: slotColor(4),
  ["--chart-6" as string]: slotColor(5),
  ["--chart-on-1" as string]: `light-dark(${SLOT_INK_LIGHT[0]}, ${SLOT_INK_DARK[0]})`,
  ["--chart-on-2" as string]: `light-dark(${SLOT_INK_LIGHT[1]}, ${SLOT_INK_DARK[1]})`,
  ["--chart-on-3" as string]: `light-dark(${SLOT_INK_LIGHT[2]}, ${SLOT_INK_DARK[2]})`,
  ["--chart-on-4" as string]: `light-dark(${SLOT_INK_LIGHT[3]}, ${SLOT_INK_DARK[3]})`,
  ["--chart-on-5" as string]: `light-dark(${SLOT_INK_LIGHT[4]}, ${SLOT_INK_DARK[4]})`,
  ["--chart-on-6" as string]: `light-dark(${SLOT_INK_LIGHT[5]}, ${SLOT_INK_DARK[5]})`,
  /** A folded tail ("Other"): neutral grey, never a categorical slot; its label ink is the page ink. */
  ["--chart-other" as string]: "color-mix(in srgb, var(--muted-foreground) 50%, var(--surface))",
  ["--chart-mid" as string]: "var(--muted)",
  ["--chart-grid" as string]: "var(--border)",
  ["--chart-axis" as string]: "var(--muted-foreground)",
  ["--chart-ink" as string]: "var(--foreground)",
  ["--chart-surface" as string]: "var(--surface)",
  ["--chart-reference" as string]: "var(--foreground)",
  ["--chart-muted-mark" as string]:
    "color-mix(in srgb, var(--muted-foreground) 45%, var(--surface))",
};
