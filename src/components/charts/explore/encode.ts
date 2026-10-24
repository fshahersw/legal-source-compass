/**
 * Field typing, chart recommendation and aggregation for the "Explore this data" builder (encoding shelf in the style
 * of Data Formulator). Pure: it only rearranges the rows a chart already loaded. Missing values are left out of a
 * point and counted, never treated as zero.
 */
export type FieldType = "temporal" | "quantitative" | "nominal";
export type Raw = string | number | boolean | null | undefined;
export type Field = { key: string; label: string; type: FieldType };
export type Encoding = { x?: string | undefined; y?: string | undefined; color?: string | undefined };
export type ChartKind = "line" | "bar" | "scatter" | "none";
export type Point = { x: string | number; series: string; y: number };

const YEARISH = /^(fy)?\s?(1[89]|20)\d{2}(-\d{2})?(-\d{2})?$/i;

export function inferType(values: readonly Raw[], label = ""): FieldType {
  const present = values.filter((v) => v !== null && v !== undefined && v !== "");
  if (!present.length) return "nominal";
  if (/\b(year|date|month|fy|period|quarter)\b/i.test(label) && present.every((v) => YEARISH.test(String(v).trim())))
    return "temporal";
  if (present.every((v) => YEARISH.test(String(v).trim()) && String(v).length >= 4 && !/^\d{5,}$/.test(String(v))))
    return /year|date|fy|period/i.test(label) ? "temporal" : typeof present[0] === "number" ? "quantitative" : "temporal";
  if (present.every((v) => typeof v === "number" && Number.isFinite(v))) return "quantitative";
  return "nominal";
}

export function recommend(fields: readonly Field[], enc: Encoding): ChartKind {
  const x = fields.find((f) => f.key === enc.x);
  const y = fields.find((f) => f.key === enc.y);
  if (!x || !y || y.type !== "quantitative") return "none";
  if (x.type === "temporal") return "line";
  if (x.type === "quantitative") return "scatter";
  return "bar";
}

const num = (v: Raw) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Sums y by (x, colour); a row without a recorded x or y is skipped and counted in `skipped`. */
export function aggregate(
  rows: readonly Record<string, Raw>[],
  enc: Encoding,
  kind: ChartKind,
): { points: Point[]; skipped: number; series: string[] } {
  if (!enc.x || !enc.y || kind === "none") return { points: [], skipped: 0, series: [] };
  let skipped = 0;
  const sums = new Map<string, Point>();
  for (const r of rows) {
    const xv = r[enc.x];
    const yv = num(r[enc.y]);
    if (xv === null || xv === undefined || xv === "" || yv === null) {
      skipped++;
      continue;
    }
    const series = enc.color ? String(r[enc.color] ?? "Not recorded") : "All";
    const x = typeof xv === "number" ? xv : String(xv);
    if (kind === "scatter") {
      sums.set(`${sums.size}`, { x, series, y: yv });
      continue;
    }
    const k = `${x}\u0000${series}`;
    const cur = sums.get(k);
    if (cur) cur.y += yv;
    else sums.set(k, { x, series, y: yv });
  }
  const points = [...sums.values()];
  if (kind === "line") points.sort((a, b) => String(a.x).localeCompare(String(b.x), "en", { numeric: true }));
  if (kind === "bar") points.sort((a, b) => b.y - a.y);
  const series = [...new Set(points.map((p) => p.series))];
  return { points, skipped, series };
}

/** Wide rows for a line/bar renderer: one row per x, one key per series. */
export function pivot(points: readonly Point[], kind: ChartKind, limit = 25) {
  const byX = new Map<string, Record<string, string | number>>();
  for (const p of points) {
    const k = String(p.x);
    const row = byX.get(k) ?? { x: p.x };
    row[p.series] = ((row[p.series] as number | undefined) ?? 0) + p.y;
    byX.set(k, row);
  }
  const rows = [...byX.values()];
  return kind === "bar" ? rows.slice(0, limit) : rows;
}
