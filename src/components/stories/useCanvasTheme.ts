/**
 * Resolved colours for canvas drawing. A canvas cannot read `var(--chart-…)`, so this reads the page's theme tokens
 * once per theme and re-reads them when the page's theme class changes. Categorical hues
 * are the palette's own light or dark steps, never generated.
 */
import { useEffect, useState } from "react";
import { interpolateRgb } from "d3-interpolate";
import {
  BASE_HEX,
  BASE_HEX_DARK,
  CATEGORICAL_HEX,
  CATEGORICAL_HEX_DARK,
} from "@/components/charts/palette";
import type { Category } from "./storiesModel";

export type CanvasTheme = {
  dark: boolean;
  slots: readonly string[];
  base: string;
  ink: string;
  axis: string;
  surface: string;
  grid: string;
  category: Record<Category, string>;
  /** Sequential shade for t in [0, 1] on the map ramp. */
  seq: (t: number) => string;
};

const SLOT_OF: Record<Category, number | null> = {
  products: 0,
  antitrust: 2,
  privacy: 3,
  consumer: 4,
  securities: 5,
  other: null,
};

function read(): CanvasTheme {
  if (typeof window === "undefined") return build(false, {});
  const cs = getComputedStyle(document.documentElement);
  // styles.css: light tokens on :root, dark tokens on .dark
  const dark = document.documentElement.classList.contains("dark");
  const v = (name: string) => cs.getPropertyValue(name).trim();
  return build(dark, {
    ink: v("--foreground"),
    axis: v("--muted-foreground"),
    surface: v("--surface") || v("--background"),
    grid: v("--border"),
    low: v("--map-low"),
    high: v("--map-high"),
  });
}

function build(
  dark: boolean,
  t: Partial<Record<"ink" | "axis" | "surface" | "grid" | "low" | "high", string>>,
): CanvasTheme {
  const slots = dark ? CATEGORICAL_HEX_DARK : CATEGORICAL_HEX;
  const base = dark ? BASE_HEX_DARK : BASE_HEX;
  const low = t.low || (dark ? "#172234" : "#e9f1fc");
  const high = t.high || (dark ? "#6fa9ee" : "#1c5cab");
  const ramp = interpolateRgb(low, high);
  const category = Object.fromEntries(
    (Object.keys(SLOT_OF) as Category[]).map((c) => {
      const s = SLOT_OF[c];
      return [c, s === null ? base : (slots[s] ?? base)];
    }),
  ) as Record<Category, string>;
  return {
    dark,
    slots,
    base,
    ink: t.ink || (dark ? "#e6e9ef" : "#101624"),
    axis: t.axis || (dark ? "#8a93a5" : "#5b6474"),
    surface: t.surface || (dark ? "#141a23" : "#ffffff"),
    grid: t.grid || (dark ? "#2a3342" : "#e3e6eb"),
    category,
    seq: (x: number) => ramp(0.1 + 0.9 * Math.min(1, Math.max(0, Number.isFinite(x) ? x : 0))),
  };
}

export function useCanvasTheme(): CanvasTheme {
  const [theme, setTheme] = useState<CanvasTheme>(() => build(false, {}));
  useEffect(() => {
    const update = () => setTheme(read());
    update();
    const mo = new MutationObserver(update);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style"] });
    return () => mo.disconnect();
  }, []);
  return theme;
}
