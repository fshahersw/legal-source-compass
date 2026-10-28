import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { CATEGORICAL_HEX, CATEGORICAL_HEX_DARK } from "@/components/charts/palette";
import {
  accentFrom,
  accentVars,
  contrast,
  deltaE,
  dominantColor,
  fitToSurface,
  hexToRgb,
  oklabToRgb,
  rgbToHex,
  rgbToOklab,
} from "./brandAccent";

const pixels = (rgba: [number, number, number, number], n: number) =>
  Array.from({ length: n }, () => rgba).flat();

/** Minimal PNG decoder (8-bit RGB/RGBA, non-interlaced) for the stored site icons. */
function decodePng(buf: Buffer): Uint8Array | null {
  if (buf.readUInt32BE(0) !== 0x89504e47) return null;
  let off = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let type = 0;
  let interlace = 0;
  const idat: Buffer[] = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const kind = buf.toString("ascii", off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (kind === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8]!;
      type = data[9]!;
      interlace = data[12]!;
    } else if (kind === "IDAT") idat.push(data);
    else if (kind === "IEND") break;
    off += 12 + len;
  }
  if (depth !== 8 || interlace !== 0 || (type !== 6 && type !== 2)) return null;
  const bpp = type === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const out = new Uint8Array(width * height * 4);
  const prev = new Uint8Array(stride);
  const cur = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)]!;
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x]!;
      const a = x >= bpp ? cur[x - bpp]! : 0;
      const b = prev[x]!;
      const c = x >= bpp ? prev[x - bpp]! : 0;
      let p = v;
      if (f === 1) p = v + a;
      else if (f === 2) p = v + b;
      else if (f === 3) p = v + ((a + b) >> 1);
      else if (f === 4) {
        const pa = Math.abs(b - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + b - 2 * c);
        p = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      cur[x] = p & 255;
    }
    for (let x = 0; x < width; x++) {
      out[(y * width + x) * 4] = cur[x * bpp]!;
      out[(y * width + x) * 4 + 1] = cur[x * bpp + 1]!;
      out[(y * width + x) * 4 + 2] = cur[x * bpp + 2]!;
      out[(y * width + x) * 4 + 3] = bpp === 4 ? cur[x * bpp + 3]! : 255;
    }
    prev.set(cur);
  }
  return out;
}

describe("colour maths", () => {
  it("round-trips through OKLab", () => {
    for (const hex of ["#2a78d6", "#eb6834", "#101624", "#ffffff"]) {
      expect(rgbToHex(oklabToRgb(rgbToOklab(hexToRgb(hex))))).toBe(hex);
    }
  });

  it("matches WCAG contrast for black on white", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 0);
  });
});

describe("dominant colour", () => {
  it("ignores white, black and grey pixels", () => {
    const data = [
      ...pixels([255, 255, 255, 255], 600),
      ...pixels([0, 0, 0, 255], 200),
      ...pixels([128, 128, 128, 255], 100),
      ...pixels([0, 106, 77, 255], 124),
    ];
    const c = dominantColor(data)!;
    expect(rgbToHex(c)).toBe("#006a4d");
  });

  it("returns null for a monochrome icon and for transparent pixels", () => {
    expect(dominantColor(pixels([20, 20, 20, 255], 100))).toBeNull();
    expect(dominantColor(pixels([200, 20, 20, 0], 100))).toBeNull();
  });
});

describe("accent", () => {
  it("re-steps a colour to clear 3:1 on both surfaces", () => {
    const light = fitToSurface(hexToRgb("#7fd3ff"), "#ffffff", [0.45, 0.62])!;
    const dark = fitToSurface(hexToRgb("#00205b"), "#141a23", [0.55, 0.7])!;
    expect(contrast(light, "#ffffff")).toBeGreaterThanOrEqual(3);
    expect(contrast(dark, "#141a23")).toBeGreaterThanOrEqual(3);
  });

  it("keeps a colour too close to another palette slot out of the charts", () => {
    // a red icon sits beside the orange of slot 2: header mark only
    const red = accentFrom(hexToRgb("#eb1902"))!;
    expect(red.charts).toBe(false);
    expect(accentVars(red)).toEqual({ "--entity-mark": `light-dark(${red.light}, ${red.dark})` });
    expect(accentFrom(hexToRgb("#164898"))?.charts).toBe(true);
    expect(accentFrom(null)).toBeNull();
  });

  it("every accent the stored site icons produce passes the palette checks", () => {
    const dir = join(process.cwd(), "public", "company-logos");
    let files: string[] = [];
    try {
      files = readdirSync(dir).filter((f) => f.endsWith(".png"));
    } catch {
      files = [];
    }
    let checked = 0;
    let charted = 0;
    for (const f of files) {
      const px = decodePng(readFileSync(join(dir, f)));
      if (!px) continue;
      const a = accentFrom(dominantColor(px));
      if (!a) continue;
      checked++;
      expect(contrast(a.light, "#ffffff")).toBeGreaterThanOrEqual(3);
      expect(contrast(a.dark, "#141a23")).toBeGreaterThanOrEqual(3);
      expect(contrast(a.onLight, a.light)).toBeGreaterThanOrEqual(3);
      if (!a.charts) continue;
      charted++;
      CATEGORICAL_HEX.slice(1).forEach((h, i) =>
        expect(deltaE(a.light, h)).toBeGreaterThanOrEqual(i < 2 ? 15 : 8),
      );
      CATEGORICAL_HEX_DARK.slice(1).forEach((h, i) =>
        expect(deltaE(a.dark, h)).toBeGreaterThanOrEqual(i < 2 ? 15 : 8),
      );
    }
    if (files.length) {
      expect(checked).toBeGreaterThan(0);
      expect(charted).toBeGreaterThan(0);
    }
    expect(accentVars(null)).toEqual({});
  });
});
