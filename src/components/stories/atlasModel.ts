/**
 * MDL atlas model (database/contracts/mdl-atlas-v1.sql): every MDL in every captured JPML pending report, and actions
 * pending per transferee district per report with the courthouse each district is plotted at. Parsing drops malformed
 * rows and counts them; the groupings, unit layouts and matrices here only rearrange recorded counts.
 */
import { z } from "zod";
import {
  CATEGORIES,
  CATEGORY_LABEL,
  categorize,
  shortTitle,
  type Category,
  type Network,
} from "./storiesModel";

const fmt = (v: number) => Math.round(v).toLocaleString("en-US");

export type AtlasMdl = {
  mdl: number;
  title: string;
  short: string;
  type: string | null;
  category: Category;
  district: string | null;
  judge: string | null;
  transferred: string | null;
  inLatest: boolean;
  /** Total actions (pending plus closed) in the latest report the MDL appears in. */
  total: number | null;
  /** First frame the MDL is listed in. */
  start: number;
  /** Pending actions from `start` on; null = not listed in that report. */
  values: (number | null)[];
};
export type AtlasDistrict = {
  code: string;
  courtId: string;
  court: string | null;
  lat: number | null;
  lon: number | null;
  city: string | null;
  state: string | null;
  placedBy: "court_locations" | "court_buildings" | null;
  values: number[];
  counts: number[];
};
export type Atlas = {
  dates: string[];
  mdls: AtlasMdl[];
  districts: AtlasDistrict[];
  dropped: number;
};

const mdlSchema = z.object({
  mdl: z.number().int(),
  title: z.string().nullable(),
  type: z.string().nullable(),
  district: z.string().nullable(),
  judge: z.string().nullable(),
  transferred: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  inLatest: z.boolean(),
  total: z.number().nullable(),
  start: z.number().int().min(0),
  values: z.array(z.number().nullable()),
});
const districtSchema = z.object({
  code: z.string().regex(/^[A-Z]{2,3}$/),
  courtId: z.string(),
  court: z.string().nullable(),
  lat: z.number().min(-90).max(90).nullable(),
  lon: z.number().min(-180).max(180).nullable(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  placedBy: z.enum(["court_locations", "court_buildings"]).nullable(),
  values: z.array(z.number()),
  counts: z.array(z.number()),
});
const atlasSchema = z.object({
  dates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  mdls: z.array(z.unknown()),
  districts: z.array(z.unknown()),
});

export function parseAtlas(raw: unknown): Atlas {
  const a = atlasSchema.parse(raw);
  const n = a.dates.length;
  let dropped = 0;
  const mdls: AtlasMdl[] = [];
  for (const r of a.mdls) {
    const m = mdlSchema.safeParse(r);
    if (!m.success || m.data.start + m.data.values.length > n || !m.data.values.length) {
      dropped++;
      continue;
    }
    const title = m.data.title ?? `MDL ${m.data.mdl}`;
    mdls.push({
      ...m.data,
      title,
      short: shortTitle(title),
      category: categorize(m.data.type, title),
    });
  }
  const districts: AtlasDistrict[] = [];
  for (const r of a.districts) {
    const d = districtSchema.safeParse(r);
    if (!d.success || d.data.values.length !== n || d.data.counts.length !== n) {
      dropped++;
      continue;
    }
    districts.push(d.data);
  }
  return { dates: a.dates, mdls, districts, dropped };
}

/** "District Court, D. New Jersey" → "D. New Jersey". */
export function courtShort(d: Pick<AtlasDistrict, "court" | "code">): string {
  return d.court ? d.court.replace(/^(united states )?district court,?\s*/i, "") : d.code;
}

/** Pending actions of an MDL in frame i (0 when not listed). */
export function pendingAt(m: AtlasMdl, i: number): number {
  const k = i - m.start;
  return k >= 0 && k < m.values.length ? (m.values[k] ?? 0) : 0;
}

/** Linear blend of a per-frame series at fractional frame t, for drawing motion only. */
export function blendAt(values: readonly number[], t: number): number {
  const i = Math.max(0, Math.min(values.length - 1, Math.floor(t)));
  const j = Math.min(values.length - 1, i + 1);
  const f = Math.max(0, Math.min(1, t - i));
  return (values[i] ?? 0) * (1 - f) + (values[j] ?? 0) * f;
}

// ------------------------------------------------------------------------------------------------- unit chart

export const GROUPINGS = ["mdl", "category", "district", "judge", "year"] as const;
export type Grouping = (typeof GROUPINGS)[number];
export const GROUPING_LABEL: Record<Grouping, string> = {
  mdl: "MDL",
  category: "Type",
  district: "Court",
  judge: "Judge",
  year: "Year centralized",
};

export type UnitGroup = {
  key: string;
  label: string;
  actions: number;
  mdls: number;
  members: AtlasMdl[];
};

/** The MDLs in the latest report with their pending counts there, largest first. */
export function latestMdls(a: Atlas): { m: AtlasMdl; pending: number }[] {
  const last = a.dates.length - 1;
  return a.mdls
    .map((m) => ({ m, pending: pendingAt(m, last) }))
    .filter((r) => r.pending > 0)
    .sort((x, y) => y.pending - x.pending || x.m.mdl - y.m.mdl);
}

/**
 * Groups of the latest report's actions for one grouping: the `top` largest groups by actions, then one "All others"
 * group (MDL, court and judge only; type and year are few enough to show whole). Members stay largest first.
 */
export function unitGroups(
  rows: readonly { m: AtlasMdl; pending: number }[],
  by: Grouping,
  districtName: (code: string) => string,
  top = 14,
): UnitGroup[] {
  const keyOf = (m: AtlasMdl): [string, string] => {
    if (by === "mdl") return [String(m.mdl), m.short];
    if (by === "category") return [m.category, m.category];
    if (by === "district")
      return m.district ? [m.district, districtName(m.district)] : ["?", "Not recorded"];
    if (by === "judge") return m.judge ? [m.judge, m.judge] : ["?", "Not recorded"];
    const y = m.transferred?.slice(0, 4);
    return y ? [y, y] : ["?", "Not recorded"];
  };
  const map = new Map<string, UnitGroup>();
  for (const r of rows) {
    const [key, label] = keyOf(r.m);
    const g = map.get(key) ?? { key, label, actions: 0, mdls: 0, members: [] };
    g.actions += r.pending;
    g.mdls++;
    g.members.push(r.m);
    map.set(key, g);
  }
  let groups = [...map.values()];
  if (by === "year")
    groups.sort((a, b) => (a.key === "?" ? 1 : b.key === "?" ? -1 : a.key.localeCompare(b.key)));
  else groups.sort((a, b) => b.actions - a.actions || a.label.localeCompare(b.label));
  if ((by === "mdl" || by === "district" || by === "judge") && groups.length > top + 1) {
    const rest = groups.slice(top);
    groups = [
      ...groups.slice(0, top),
      {
        key: "__other",
        label:
          by === "mdl"
            ? `All other ${rest.reduce((s, g) => s + g.mdls, 0)} MDLs`
            : `All other ${rest.length} ${by === "district" ? "courts" : "judges"}`,
        actions: rest.reduce((s, g) => s + g.actions, 0),
        mdls: rest.reduce((s, g) => s + g.mdls, 0),
        members: rest.flatMap((g) => g.members),
      },
    ];
  }
  return groups;
}

/**
 * Dots for each MDL: one dot per `unit` actions, rounded to the nearest whole dot with at least one, so every MDL in
 * the report is visible. Returns, per MDL, the number of dots.
 */
export function dotCounts(
  rows: readonly { m: AtlasMdl; pending: number }[],
  unit: number,
): Map<number, number> {
  return new Map(rows.map((r) => [r.m.mdl, Math.max(1, Math.round(r.pending / unit))] as const));
}

export type DotBlock = {
  key: string;
  label: string;
  actions: number;
  mdls: number;
  x: number;
  y: number;
  cols: number;
  rows: number;
  /** Dot slots in reading order: the MDL each slot belongs to. */
  slots: number[];
};

/**
 * Shelf-packed waffle blocks: each group is a near-square block of dots (`step` px apart) with a label line above,
 * placed left to right and wrapped into rows. The step is the largest that keeps the packed height within `maxHeight`.
 */
export function packBlocks(
  groups: readonly UnitGroup[],
  dots: Map<number, number>,
  width: number,
  maxHeight: number,
  opts: { labelHeight?: number; gap?: number; maxStep?: number; minStep?: number } = {},
): { blocks: DotBlock[]; step: number; height: number } {
  const labelHeight = opts.labelHeight ?? 30;
  const gap = opts.gap ?? 18;
  const maxStep = opts.maxStep ?? 9;
  const minStep = opts.minStep ?? 2;
  const counts = groups.map((g) => g.members.reduce((s, m) => s + (dots.get(m.mdl) ?? 0), 0));
  const attempt = (step: number) => {
    const blocks: DotBlock[] = [];
    let x = 0;
    let y = 0;
    let shelf = 0;
    groups.forEach((g, gi) => {
      const n = counts[gi] ?? 0;
      const maxCols = Math.max(1, Math.floor(width / step));
      const minCols = Math.ceil(110 / step);
      const cols = Math.min(maxCols, Math.max(minCols, Math.ceil(Math.sqrt(n * 1.6))));
      const rows = Math.ceil(n / cols);
      const bw = cols * step;
      const bh = rows * step + labelHeight;
      if (x > 0 && x + bw > width) {
        x = 0;
        y += shelf + gap;
        shelf = 0;
      }
      const slots: number[] = [];
      for (const m of g.members) for (let k = 0; k < (dots.get(m.mdl) ?? 0); k++) slots.push(m.mdl);
      blocks.push({
        key: g.key,
        label: g.label,
        actions: g.actions,
        mdls: g.mdls,
        x,
        y,
        cols,
        rows,
        slots,
      });
      x += bw + gap;
      shelf = Math.max(shelf, bh);
    });
    return { blocks, height: y + shelf };
  };
  let step = maxStep;
  let best = attempt(step);
  while (step > minStep && best.height > maxHeight) {
    step -= 0.5;
    best = attempt(step);
  }
  return { ...best, step };
}

/** A round unit near total / target dots (10, 20, 25, 50, 100, …). */
export function unitFor(total: number, target = 10000): number {
  const raw = total / target;
  for (const u of [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000]) if (u >= raw) return u;
  return 1000;
}

/** Rows for the unit chart's table: every group of the current grouping. */
export function unitTableRows(atlas: Atlas, by: Grouping, districtName: (code: string) => string) {
  const rows = latestMdls(atlas);
  return unitGroups(rows, by, districtName, 1000).map((g) => ({
    key: g.key,
    label: by === "category" ? (CATEGORY_LABEL[g.key as Category] ?? g.label) : g.label,
    actions: g.actions,
    mdls: g.mdls,
    largest: g.members[0]
      ? `MDL ${g.members[0].mdl} ${g.members[0].short} (${fmt(pendingAt(g.members[0], atlas.dates.length - 1))})`
      : "",
  }));
}

// ------------------------------------------------------------------------------------------------- chord

/** "EXXON MOBIL CORP" → "Exxon Mobil Corp"; mixed-case names are kept as filed. */
export function displayCompany(name: string): string {
  if (name !== name.toUpperCase()) return name;
  return name
    .toLowerCase()
    .replace(/\b([a-z])/g, (c) => c.toUpperCase())
    .replace(/\b(Llc|Plc|Lp|Nv|Sa|Ag|Se|Usa|Ii|Iii)\b/g, (m) => m.toUpperCase())
    .replace(/\bAnd\b/g, "and")
    .replace(/\b3m\b/g, "3M");
}

export type ChordCompany = {
  cik: string;
  company: string;
  mdls: number[];
  /** Registrants folded into this one because their filings link exactly the same MDLs (two or more). */
  also: { cik: string; company: string }[];
};
export type Chord = {
  companies: ChordCompany[];
  /** matrix[i][j]: MDLs that list both company i and company j as defendants (0 on the diagonal). */
  matrix: number[][];
  /** shared[i][j]: those MDLs' numbers. */
  shared: number[][][];
  /** Registrants folded into another with the identical MDL set. */
  folded: number;
};

/**
 * Co-defendant matrix of the `top` companies (by MDLs linked) that share at least one MDL with another company.
 * Registrants whose filings link exactly the same set of two or more MDLs (a parent and its finance subsidiaries
 * filing one report, say) are folded into one entry, listed in `also`; nothing is merged by name.
 */
export function codefendants(net: Network, top = 18, opts: { tierC?: boolean } = {}): Chord {
  const byCompany = new Map<string, { cik: string; company: string; mdls: Set<number> }>();
  for (const l of net.links) {
    if (opts.tierC === false && l.tier === "C") continue;
    const c = byCompany.get(l.cik) ?? { cik: l.cik, company: l.company, mdls: new Set<number>() };
    c.mdls.add(l.mdl);
    byCompany.set(l.cik, c);
  }
  const bySet = new Map<string, { cik: string; company: string; mdls: Set<number> }[]>();
  for (const c of byCompany.values()) {
    const key = c.mdls.size >= 2 ? [...c.mdls].sort((x, y) => x - y).join(",") : `one:${c.cik}`;
    bySet.set(key, [...(bySet.get(key) ?? []), c]);
  }
  let folded = 0;
  const all = [...bySet.values()].map((list) => {
    const sorted = [...list].sort(
      (a, b) => a.company.localeCompare(b.company) || a.cik.localeCompare(b.cik),
    );
    const head = sorted[0]!;
    folded += sorted.length - 1;
    return { ...head, also: sorted.slice(1).map((c) => ({ cik: c.cik, company: c.company })) };
  });
  const sharesAny = (c: (typeof all)[number]) =>
    all.some((o) => o.cik !== c.cik && [...c.mdls].some((m) => o.mdls.has(m)));
  const picked = all
    .filter(sharesAny)
    .sort((a, b) => b.mdls.size - a.mdls.size || a.company.localeCompare(b.company))
    .slice(0, top);
  const shared = picked.map((a) =>
    picked.map((b) =>
      a.cik === b.cik ? [] : [...a.mdls].filter((m) => b.mdls.has(m)).sort((x, y) => x - y),
    ),
  );
  return {
    companies: picked.map((c) => ({
      cik: c.cik,
      company: c.company,
      mdls: [...c.mdls].sort((x, y) => x - y),
      also: c.also,
    })),
    matrix: shared.map((row) => row.map((s) => s.length)),
    shared,
    folded,
  };
}

// ------------------------------------------------------------------------------------------------- strands

export const STRAND_SORTS = ["start", "peak", "category"] as const;
export type StrandSort = (typeof STRAND_SORTS)[number];

/** Row order of the lifespan heatmap. */
export function strandOrder(mdls: readonly AtlasMdl[], by: StrandSort): AtlasMdl[] {
  const peak = (m: AtlasMdl) => Math.max(0, ...m.values.map((v) => v ?? 0));
  const out = [...mdls];
  if (by === "start") out.sort((a, b) => a.start - b.start || peak(b) - peak(a) || a.mdl - b.mdl);
  else if (by === "peak") out.sort((a, b) => peak(b) - peak(a) || a.mdl - b.mdl);
  else
    out.sort(
      (a, b) =>
        CATEGORIES.indexOf(a.category) - CATEGORIES.indexOf(b.category) ||
        a.start - b.start ||
        a.mdl - b.mdl,
    );
  return out;
}
