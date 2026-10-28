/**
 * A company page's accent colour, taken from the company's own site icon (served same-origin under /company-logos/).
 * The icon's dominant saturated hue is re-stepped in OKLCH into the chart palette's lightness band and must pass the
 * same checks the palette passed (dataviz validator, 2026-10-28): chroma >= 0.10, at least 3:1 against the chart surface
 * in each theme, and a normal-vision ΔE (OKLab × 100) of at least 15 from slots 2-3 and 8 from slots 4-6 before it
 * stands in for slot 1 in charts; otherwise it marks only the page header. A grey or failing icon gives no accent and the page keeps the
 * default palette. Pure functions; the hook only reads pixels.
 */
import { useEffect, useState } from "react";
import { CATEGORICAL_HEX, CATEGORICAL_HEX_DARK } from "@/components/charts/palette";

export type Rgb = { r: number; g: number; b: number };
export type Accent = {
  light: string;
  dark: string;
  onLight: string;
  onDark: string;
  /** Whether charts may draw slot 1 in it (far enough from slots 2-6). */
  charts: boolean;
};

const SURFACE_LIGHT = "#ffffff";
const SURFACE_DARK = "#141a23";
const INK = "#101624";
const MIN_CONTRAST = 3;
const MIN_DELTA_E = 15;
const MIN_CHROMA = 0.1;
const MIN_SOURCE_CHROMA = 0.05;
const MIN_DELTA_E_FAR = 8;

export function hexToRgb(hex: string): Rgb {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const c = (v: number) =>
    Math.round(Math.max(0, Math.min(255, v)))
      .toString(16)
      .padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

const toLinear = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (v: number) =>
  255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.max(0, v) ** (1 / 2.4) - 0.055);

export function luminance(rgb: Rgb): number {
  return 0.2126 * toLinear(rgb.r) + 0.7152 * toLinear(rgb.g) + 0.0722 * toLinear(rgb.b);
}

export function contrast(a: string, b: string): number {
  const la = luminance(hexToRgb(a));
  const lb = luminance(hexToRgb(b));
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

type Lab = { L: number; a: number; b: number };

export function rgbToOklab({ r, g, b }: Rgb): Lab {
  const R = toLinear(r);
  const G = toLinear(g);
  const B = toLinear(b);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

export function oklabToRgb({ L, a, b }: Lab): Rgb {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return {
    r: fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  };
}

const inGamut = (lab: Lab) => {
  const rgb = oklabToRgb(lab);
  return [rgb.r, rgb.g, rgb.b].every((v) => v >= -0.5 && v <= 255.5);
};

export function deltaE(a: string, b: string): number {
  const x = rgbToOklab(hexToRgb(a));
  const y = rgbToOklab(hexToRgb(b));
  return Math.hypot(x.L - y.L, x.a - y.a, x.b - y.b) * 100;
}

/**
 * The dominant saturated colour of an RGBA pixel buffer: pixels are bucketed by hue (24 buckets), weighted by
 * chroma and opacity; near-white, near-black and grey pixels are ignored. Null when under 4% of the opaque pixels are
 * coloured (a monochrome icon).
 */
export function dominantColor(data: ArrayLike<number>): Rgb | null {
  const buckets = Array.from({ length: 24 }, () => ({ w: 0, r: 0, g: 0, b: 0 }));
  let opaque = 0;
  let coloured = 0;
  for (let i = 0; i + 3 < data.length; i += 4) {
    const alpha = data[i + 3]! / 255;
    if (alpha < 0.5) continue;
    opaque++;
    const rgb = { r: data[i]!, g: data[i + 1]!, b: data[i + 2]! };
    const lab = rgbToOklab(rgb);
    const chroma = Math.hypot(lab.a, lab.b);
    if (chroma < 0.06 || lab.L > 0.96 || lab.L < 0.18) continue;
    coloured++;
    const hue = (Math.atan2(lab.b, lab.a) * 180) / Math.PI + 360;
    const k = Math.floor((hue % 360) / 15);
    const w = chroma * alpha;
    const bucket = buckets[k]!;
    bucket.w += w;
    bucket.r += rgb.r * w;
    bucket.g += rgb.g * w;
    bucket.b += rgb.b * w;
  }
  if (!opaque || coloured / opaque < 0.04) return null;
  const best = buckets.reduce((a, b) => (b.w > a.w ? b : a));
  if (!best.w) return null;
  return { r: best.r / best.w, g: best.g / best.w, b: best.b / best.w };
}

/**
 * The colour re-stepped in OKLCH: its hue kept, its chroma raised to the palette floor when the icon colour is muted
 * (but genuinely coloured, chroma >= 0.05) and lowered only to stay in gamut, and its lightness moved to the nearest
 * step inside the band that clears 3:1 on the surface. Null when no step passes.
 */
export function fitToSurface(rgb: Rgb, surface: string, band: [number, number]): string | null {
  const lab = rgbToOklab(rgb);
  const chroma = Math.hypot(lab.a, lab.b);
  if (chroma < MIN_SOURCE_CHROMA) return null;
  const hue = Math.atan2(lab.b, lab.a);
  const target = Math.min(band[1], Math.max(band[0], lab.L));
  const steps: number[] = [];
  for (let L = band[0]; L <= band[1] + 1e-9; L += 0.01) steps.push(Number(L.toFixed(2)));
  steps.sort((x, y) => Math.abs(x - target) - Math.abs(y - target) || x - y);
  for (const L of steps) {
    let c = Math.min(Math.max(chroma, MIN_CHROMA), 0.2);
    while (c >= MIN_CHROMA && !inGamut({ L, a: c * Math.cos(hue), b: c * Math.sin(hue) }))
      c -= 0.005;
    if (c < MIN_CHROMA) continue;
    const hex = rgbToHex(oklabToRgb({ L, a: c * Math.cos(hue), b: c * Math.sin(hue) }));
    if (contrast(hex, surface) >= MIN_CONTRAST) return hex;
  }
  return null;
}

const inkOn = (fill: string) =>
  contrast("#ffffff", fill) >= contrast(INK, fill) ? "#ffffff" : INK;

/** Normal-vision distance to the slots it would chart beside: 15 for slots 2-3 (drawn together), 8 for 4-6. */
function separates(hex: string, slots: readonly string[]): boolean {
  return slots.slice(1).every((h, i) => deltaE(hex, h) >= (i < 2 ? MIN_DELTA_E : MIN_DELTA_E_FAR));
}

/**
 * The accent for both themes, or null when the icon is grey or no step clears the surface. `charts` is false when the
 * accent sits too close to another series colour (a red icon beside the orange slot): it then marks only the page
 * header and the charts keep the default palette.
 */
export function accentFrom(rgb: Rgb | null): Accent | null {
  if (!rgb) return null;
  const light = fitToSurface(rgb, SURFACE_LIGHT, [0.45, 0.62]);
  const dark = fitToSurface(rgb, SURFACE_DARK, [0.55, 0.7]);
  if (!light || !dark) return null;
  const charts = separates(light, CATEGORICAL_HEX) && separates(dark, CATEGORICAL_HEX_DARK);
  return { light, dark, onLight: inkOn(light), onDark: inkOn(dark), charts };
}

/** CSS variables a company page sets: the header mark always; slot 1 of its charts only when `charts`. */
export function accentVars(a: Accent | null): Record<string, string> {
  if (!a) return {};
  const mark = `light-dark(${a.light}, ${a.dark})`;
  if (!a.charts) return { "--entity-mark": mark };
  return {
    "--entity-mark": mark,
    "--entity-accent": mark,
    "--entity-accent-on": `light-dark(${a.onLight}, ${a.onDark})`,
  };
}

const cache = new Map<string, Accent | null>();

/** Reads the icon at `src` (same-origin) and returns its accent; null until read or when there is none. */
export function useBrandAccent(src: string | null | undefined): Accent | null {
  const [accent, setAccent] = useState<Accent | null>(() =>
    src ? (cache.get(src) ?? null) : null,
  );
  useEffect(() => {
    if (!src || typeof window === "undefined") {
      setAccent(null);
      return;
    }
    if (cache.has(src)) {
      setAccent(cache.get(src) ?? null);
      return;
    }
    let live = true;
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      let result: Accent | null = null;
      try {
        const size = 32;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (ctx) {
          ctx.drawImage(img, 0, 0, size, size);
          result = accentFrom(dominantColor(ctx.getImageData(0, 0, size, size).data));
        }
      } catch {
        result = null;
      }
      cache.set(src, result);
      if (live) setAccent(result);
    };
    img.onerror = () => {
      cache.set(src, null);
      if (live) setAccent(null);
    };
    img.src = src;
    return () => {
      live = false;
    };
  }, [src]);
  return accent;
}
