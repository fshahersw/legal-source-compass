/**
 * MDL lifecycle lanes: the compact per-MDL summary the overview draws, assembled from the lanes RPC
 * (`litviz_mdl_lanes_v1`) or, before that is applied, from the same rows built by derive.ts. Pure and client-safe.
 */
import type { MdlRow } from "./derive";
import {
  dateIndex,
  isPartialBasis,
  isUnverifiedBasis,
  mdlAttributes,
  monthIndex,
  parseSeriesRows,
  type MdlAttributes,
  type MdlSource,
  type SeriesRow,
} from "./model";

/** [mdl, series, period, value, basis]: stocks per month ("YYYY-MM"), flows per calendar year ("YYYY"). */
export type CompactRow = [string, string, string, number | string | null, string];

export type LanesSource = {
  scope: "reported" | "historical";
  today: string | null;
  refreshed: string | null;
  mdls: { mdl: string; src: MdlSource }[];
  rows: CompactRow[];
  national: SeriesRow[];
};

/** A pending-actions point: month index (fractional), value, joined to the previous point (1) or not (0), and the
 * source (0 = JPML monthly report, 1 = JPML fiscal-year statistical analysis). Built on the client from the runs. */
export type PendingPoint = [number, number, 0 | 1, 0 | 1];

/** Consecutive periods from `start` (a month index, a fiscal year or a calendar year); null = not recorded. */
export type Run = { start: number; values: (number | null)[] };
/** Calendar-year counts from `start`; `partial` is the year still in progress, if it is in the run. */
export type YearRun = Run & { partial: number | null };

export type LaneSummary = Omit<MdlAttributes, "products"> & {
  products: number;
  /** Actions pending in the JPML monthly reports, by report month. */
  pendingMonthly: Run | null;
  /** Actions pending at fiscal-year end (September 30), verified attributions only. */
  pendingFy: Run | null;
  latest: { value: number; t: number; fy: boolean } | null;
  peak: { value: number; t: number; fy: boolean } | null;
  docket: YearRun | null;
  filings: YearRun | null;
  /** Docket entries collected in the last 12 complete months; null when none are held for that window. */
  activity12: number | null;
  /** Month index used to sort by start: centralization, else the first pending point. */
  start: number | null;
};

export type LanesPayload = {
  scope: "reported" | "historical";
  today: string | null;
  refreshed: string | null;
  /** "precomputed": served by the litviz functions; "live": computed from the published records on request. */
  basis: "precomputed" | "live";
  lanes: LaneSummary[];
  national: SeriesRow[];
  /** Partial-data notices to show above the chart. */
  notices: string[];
};

const MDL = /^[1-9][0-9]{0,5}$/;
const toNum = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return null;
};

/** Twin of the `roll` CTE of litviz_mdl_lanes_v1: stocks keep every point, flows sum per calendar year, and the last
 * 12 complete months of docket entries. `filings_year` rows (REST fallback) roll up as `filings`. */
export function rollupForLanes(rows: readonly MdlRow[], today: string): CompactRow[] {
  const cur = today.slice(0, 7);
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const fromIndex = y * 12 + m - 1 - 12;
  const from = `${Math.floor(fromIndex / 12)}-${String((fromIndex % 12) + 1).padStart(2, "0")}`;
  const out: CompactRow[] = [];
  const flows = new Map<string, { value: number; partial: boolean }>();
  const last12 = new Map<string, number>();
  for (const r of rows) {
    if (r.series === "jpml_pending" || r.series === "jpml_fy_pending") {
      out.push([r.mdl, r.series, r.month, r.value, r.basis]);
      continue;
    }
    if (r.series !== "docket_entries" && r.series !== "filings" && r.series !== "filings_year")
      continue;
    const series = r.series === "filings_year" ? "filings" : r.series;
    const key = `${r.mdl}|${series}|${r.month.slice(0, 4)}`;
    const cur0 = flows.get(key) ?? { value: 0, partial: false };
    cur0.value += r.value ?? 0;
    cur0.partial ||= isPartialBasis(r.basis);
    flows.set(key, cur0);
    if (r.series === "docket_entries" && r.month >= from && r.month < cur)
      last12.set(r.mdl, (last12.get(r.mdl) ?? 0) + (r.value ?? 0));
  }
  for (const [key, v] of flows) {
    const [mdl, series, year] = key.split("|") as [string, string, string];
    out.push([mdl, series, year, v.value, v.partial ? "partial" : ""]);
  }
  for (const [mdl, v] of last12) out.push([mdl, "docket_entries_12m", `${from}/${cur}`, v, ""]);
  return out;
}

const FY_END = 29 / 30; // September 30 within its month

function toRun(entries: [number, number | null][]): Run | null {
  if (!entries.length) return null;
  const sorted = [...entries].sort((x, y) => x[0] - y[0]);
  const start = sorted[0]![0];
  const values: (number | null)[] = Array(sorted[sorted.length - 1]![0] - start + 1).fill(null);
  for (const [k, v] of sorted) values[k - start] = v;
  return { start, values };
}

/** Points of the pending-actions line from the two runs. A point joins the previous one only when they are neighbours
 * in the source's cadence (consecutive fiscal years, or at most about a month apart); a missing period stays a gap. */
export function pendingPoints(
  l: Pick<LaneSummary, "pendingMonthly" | "pendingFy">,
): PendingPoint[] {
  const pts: { t: number; v: number; fy: boolean }[] = [];
  l.pendingMonthly?.values.forEach((v, i) => {
    if (v !== null) pts.push({ t: l.pendingMonthly!.start + i, v, fy: false });
  });
  l.pendingFy?.values.forEach((v, i) => {
    if (v !== null) pts.push({ t: (l.pendingFy!.start + i) * 12 + 8 + FY_END, v, fy: true });
  });
  pts.sort((a, b) => a.t - b.t || Number(a.fy) - Number(b.fy));
  return pts.map((p, i): PendingPoint => {
    const prev = pts[i - 1];
    const gap = prev ? p.t - prev.t : Infinity;
    const link = prev ? (prev.fy && p.fy ? gap <= 12.5 : gap <= 1.5) : false;
    return [Math.round(p.t * 1000) / 1000, p.v, link ? 1 : 0, p.fy ? 1 : 0];
  });
}

function yearRun(rows: readonly CompactRow[], series: string): YearRun | null {
  const entries: [number, number | null][] = [];
  let partial: number | null = null;
  for (const r of rows) {
    if (r[1] !== series || !/^[12][0-9]{3}$/.test(r[2])) continue;
    const v = toNum(r[3]);
    if (v === null) continue;
    entries.push([Number(r[2]), v]);
    if (r[4] === "partial") partial = Number(r[2]);
  }
  const run = toRun(entries);
  return run ? { ...run, partial } : null;
}

/** One lane from an MDL's label fields and its compact rows. */
export function laneSummary(mdl: string, src: MdlSource, rows: readonly CompactRow[]): LaneSummary {
  const a = mdlAttributes(mdl, src);
  const monthly: [number, number | null][] = [];
  const fy: [number, number | null][] = [];
  for (const [, series, period, value, basis] of rows) {
    const v = toNum(value);
    if (v === null) continue;
    if (series === "jpml_pending") {
      const t = monthIndex(period);
      if (t !== null) monthly.push([t, v]);
    } else if (
      series === "jpml_fy_pending" &&
      !isUnverifiedBasis(basis) &&
      /^[12][0-9]{3}-09$/.test(period)
    )
      fy.push([Number(period.slice(0, 4)), v]);
  }
  const act = rows.find((r) => r[1] === "docket_entries_12m");
  return finishLane({
    ...a,
    products: a.products.length,
    pendingMonthly: toRun(monthly),
    pendingFy: toRun(fy),
    docket: yearRun(rows, "docket_entries"),
    filings: yearRun(rows, "filings"),
    activity12: act ? toNum(act[3]) : null,
  });
}

/** Parse an untrusted lanes payload (RPC result) into its parts; null when it does not have the shape. */
export function parseLanesSource(raw: unknown): LanesSource | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const scope =
    o["scope"] === "historical" ? "historical" : o["scope"] === "reported" ? "reported" : null;
  if (!scope || !Array.isArray(o["mdls"]) || !Array.isArray(o["rows"])) return null;
  const mdls = (o["mdls"] as unknown[]).flatMap((m) => {
    const x = m && typeof m === "object" ? (m as Record<string, unknown>) : null;
    const id = typeof x?.["mdl"] === "string" ? x["mdl"] : null;
    const src = x?.["src"] && typeof x["src"] === "object" ? (x["src"] as MdlSource) : null;
    return id && MDL.test(id) && src ? [{ mdl: id, src }] : [];
  });
  const rows = (o["rows"] as unknown[]).flatMap((r): CompactRow[] =>
    Array.isArray(r) &&
    r.length === 5 &&
    typeof r[0] === "string" &&
    typeof r[1] === "string" &&
    typeof r[2] === "string"
      ? [[r[0], r[1], r[2], toNum(r[3]), typeof r[4] === "string" ? r[4] : ""]]
      : [],
  );
  const text = (v: unknown) => (typeof v === "string" && v ? v : null);
  return {
    scope,
    today: text(o["today"]),
    refreshed: text(o["refreshed"]),
    mdls,
    rows,
    national: parseSeriesRows(o["national"]),
  };
}

/** All lanes of a scope, ordered by MDL number (the UI sorts). */
export function assembleLanes(
  s: LanesSource,
  basis: LanesPayload["basis"],
  notices: string[] = [],
): LanesPayload {
  const byMdl = new Map<string, CompactRow[]>();
  for (const r of s.rows) byMdl.set(r[0], [...(byMdl.get(r[0]) ?? []), r]);
  return {
    scope: s.scope,
    today: s.today,
    refreshed: s.refreshed,
    basis,
    lanes: s.mdls
      .map((m) => laneSummary(m.mdl, m.src, byMdl.get(m.mdl) ?? []))
      .sort((a, b) => Number(a.mdl) - Number(b.mdl)),
    national: s.national,
    notices,
  };
}

// ------------------------------------------------------------------------------------------------ sorting, filtering

export type LaneSort = "start" | "size" | "peak" | "activity" | "number";
export type LaneFilter = {
  q?: string | undefined;
  court?: string | undefined;
  judge?: string | undefined;
  type?: string | undefined;
  status?: string | undefined;
};

const courtKey = (l: Pick<LaneSummary, "court">) => l.court.label ?? "Not recorded";
const judgeKey = (l: Pick<LaneSummary, "judge">) => l.judge.name ?? "Not recorded";
const typeKey = (l: Pick<LaneSummary, "type">) => l.type ?? "Not recorded";

export function filterLanes(lanes: readonly LaneSummary[], f: LaneFilter): LaneSummary[] {
  const q = f.q?.trim().toLowerCase();
  return lanes.filter(
    (l) =>
      (!q || l.title.toLowerCase().includes(q) || l.mdl === q.replace(/^mdl\s*(no\.?)?\s*/, "")) &&
      (!f.court || courtKey(l) === f.court) &&
      (!f.judge || judgeKey(l) === f.judge) &&
      (!f.type || typeKey(l) === f.type) &&
      (!f.status || l.status === f.status),
  );
}

/** Sort: values the source does not record sort last, whatever the direction. */
export function sortLanes(lanes: readonly LaneSummary[], by: LaneSort): LaneSummary[] {
  const key = (l: LaneSummary): number | null =>
    by === "start"
      ? l.start
      : by === "size"
        ? (l.latest?.value ?? null)
        : by === "peak"
          ? (l.peak?.value ?? null)
          : by === "activity"
            ? l.activity12
            : Number(l.mdl);
  const desc = by === "size" || by === "peak" || by === "activity";
  return [...lanes].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    if (ka === null && kb === null) return Number(a.mdl) - Number(b.mdl);
    if (ka === null) return 1;
    if (kb === null) return -1;
    return (desc ? kb - ka : ka - kb) || Number(a.mdl) - Number(b.mdl);
  });
}

/** Filter options with counts, most common first. */
export function laneFacets(lanes: readonly LaneSummary[]): {
  court: [string, number][];
  judge: [string, number][];
  type: [string, number][];
  status: [string, number][];
} {
  const count = (f: (l: LaneSummary) => string) => {
    const m = new Map<string, number>();
    for (const l of lanes) m.set(f(l), (m.get(f(l)) ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  };
  return {
    court: count(courtKey),
    judge: count(judgeKey),
    type: count(typeKey),
    status: count((l) => l.status),
  };
}

// ------------------------------------------------------------------------------------------------ transport

/** Positional lane: [mdl, title, status, type, massTort (1/0/null), court id, court label, judge, judge href,
 * motion filed, centralized, closed, closed year, closure source, product series, monthly run, FY run, docket run,
 * filings run, last-12-months docket entries]. A run is [start, ...values] (year runs: [start, partial year or 0, ...]);
 * 0 = none. Keys are not repeated per lane, which keeps every scope well under the 200 KB view budget. */
export type WireLane = [
  string,
  string,
  string,
  string | null,
  0 | 1 | null,
  string | null,
  string | null,
  string | null,
  string | null,
  string | null,
  string | null,
  string | null,
  number | null,
  string | null,
  number,
  (number | null)[] | 0,
  (number | null)[] | 0,
  (number | null)[] | 0,
  (number | null)[] | 0,
  number | null,
];

export type LanesWire = Omit<LanesPayload, "lanes"> & { lanes: WireLane[] };

const runOut = (r: Run | null): (number | null)[] | 0 => (r ? [r.start, ...r.values] : 0);
const yearOut = (r: YearRun | null): (number | null)[] | 0 =>
  r ? [r.start, r.partial ?? 0, ...r.values] : 0;
const runIn = (a: unknown): Run | null =>
  Array.isArray(a) && typeof a[0] === "number"
    ? { start: a[0], values: a.slice(1).map((v) => (typeof v === "number" ? v : null)) }
    : null;
const yearIn = (a: unknown): YearRun | null =>
  Array.isArray(a) && typeof a[0] === "number" && a.length >= 2
    ? {
        start: a[0],
        partial: typeof a[1] === "number" && a[1] > 0 ? a[1] : null,
        values: a.slice(2).map((v) => (typeof v === "number" ? v : null)),
      }
    : null;

export function toWire(p: LanesPayload): LanesWire {
  return {
    ...p,
    lanes: p.lanes.map((l): WireLane => [
      l.mdl,
      l.title,
      l.status,
      l.type,
      l.massTort === null ? null : l.massTort ? 1 : 0,
      l.court.id,
      l.court.label,
      l.judge.name,
      l.judge.href,
      l.dates.motionFiled,
      l.dates.centralized,
      l.dates.closed,
      l.dates.closedYear,
      l.dates.closedSourceUrl,
      l.products,
      runOut(l.pendingMonthly),
      runOut(l.pendingFy),
      yearOut(l.docket),
      yearOut(l.filings),
      l.activity12,
    ]),
  };
}

/** Latest, peak and start of a lane from its runs and dates. */
export function finishLane(core: Omit<LaneSummary, "latest" | "peak" | "start">): LaneSummary {
  const pts = pendingPoints(core);
  const last = pts[pts.length - 1];
  let peak: PendingPoint | undefined;
  for (const p of pts) if (!peak || p[1] > peak[1]) peak = p;
  return {
    ...core,
    latest: last ? { value: last[1], t: last[0], fy: last[3] === 1 } : null,
    peak: peak ? { value: peak[1], t: peak[0], fy: peak[3] === 1 } : null,
    start: dateIndex(core.dates.centralized) ?? pts[0]?.[0] ?? null,
  };
}

export function fromWire(w: LanesWire): LanesPayload {
  const s = (v: unknown) => (typeof v === "string" && v ? v : null);
  return {
    ...w,
    lanes: w.lanes.map((x) =>
      finishLane({
        mdl: x[0],
        title: x[1],
        status: x[2] as LaneSummary["status"],
        type: s(x[3]),
        massTort: x[4] === null ? null : x[4] === 1,
        court: { id: s(x[5]), label: s(x[6]) },
        judge: { name: s(x[7]), href: s(x[8]) },
        dates: {
          motionFiled: s(x[9]),
          centralized: s(x[10]),
          closed: s(x[11]),
          closedYear: typeof x[12] === "number" ? x[12] : null,
          closedSourceUrl: s(x[13]),
        },
        products: typeof x[14] === "number" ? x[14] : 0,
        pendingMonthly: runIn(x[15]),
        pendingFy: runIn(x[16]),
        docket: yearIn(x[17]),
        filings: yearIn(x[18]),
        activity12: typeof x[19] === "number" ? x[19] : null,
      }),
    ),
  };
}

/** Decade a historical lane is listed under: its termination year, else its last fiscal-year report; null when
 * neither is recorded. The historical scope is served one decade at a time to stay inside the view budget. */
export function laneDecade(l: Pick<LaneSummary, "dates" | "pendingFy">): number | null {
  const y =
    l.dates.closedYear ?? (l.pendingFy ? l.pendingFy.start + l.pendingFy.values.length - 1 : null);
  return y === null ? null : Math.floor(y / 10) * 10;
}

/** Lanes of one decade (0 = decade not recorded) and the count per decade, newest first. */
export function byDecade(
  p: LanesPayload,
  decade: number | null,
): { payload: LanesPayload; decades: [number, number][]; decade: number | null } {
  const counts = new Map<number, number>();
  for (const l of p.lanes) {
    const d = laneDecade(l) ?? 0;
    counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  const decades = [...counts].sort((a, b) => b[0] - a[0]);
  const pick = decade !== null && counts.has(decade) ? decade : (decades[0]?.[0] ?? null);
  return {
    payload: { ...p, lanes: p.lanes.filter((l) => (laneDecade(l) ?? 0) === pick) },
    decades,
    decade: pick,
  };
}
