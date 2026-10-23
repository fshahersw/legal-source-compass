/**
 * One MDL's detailed lane and product signal timeline: label fields, coverage notes and series rows. The rows of
 * agency series come from worker SAFETY's `public.product_signals_v1(p_mdl)` when it is applied (same row shape), else
 * from the FDA product series records that name the MDL (litviz/1). Litigation series (docket entries, filings) are
 * always litviz rows. Pure and client-safe.
 */
import {
  bySeries,
  isPartialBasis,
  mdlAttributes,
  monthIndex,
  monthKey,
  parseSeriesRows,
  seriesMeta,
  type MdlAttributes,
  type MdlSource,
  type SeriesRow,
} from "./model";

export type MdlMeta = {
  docketDataset: string | null;
  docketTotal: number | null;
  docketUndated: number | null;
  filings: number | null;
  filingsUndated: number | null;
  withText: number | null;
  citing: number | null;
};

export type MdlDetail = {
  mdl: string;
  scope: "reported" | "historical" | null;
  today: string | null;
  refreshed: string | null;
  basis: "precomputed" | "live";
  attributes: MdlAttributes;
  meta: MdlMeta | null;
  rows: SeriesRow[];
  notices: string[];
};

export type ProductSignals = {
  mdl: string;
  title: string;
  centralized: string | null;
  today: string | null;
  /** Where the agency series come from: SAFETY's RPC, the FDA product series records, or none held. */
  agencySource: "product_signals_v1" | "fda_product_series" | null;
  products: MdlAttributes["products"];
  rows: SeriesRow[];
  notices: string[];
};

const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const n = (v: unknown): number | null => {
  const x = typeof v === "string" && /^\d+$/.test(v) ? Number(v) : v;
  return typeof x === "number" && Number.isFinite(x) ? x : null;
};
const text = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

export function parseMeta(raw: unknown): MdlMeta | null {
  const o = obj(raw);
  if (!o) return null;
  return {
    docketDataset: text(o["docket_dataset"]),
    docketTotal: n(o["docket_total"]),
    docketUndated: n(o["docket_undated"]),
    filings: n(o["filings"]),
    filingsUndated: n(o["filings_undated"]),
    withText: n(o["with_text"]),
    citing: n(o["citing"]),
  };
}

/** Parse the litviz_mdl_series_v1 payload; null when it does not have the shape (or the MDL has no record). */
export function parseMdlDetail(
  raw: unknown,
  basis: MdlDetail["basis"],
  notices: string[] = [],
): MdlDetail | null {
  const o = obj(raw);
  const mdl = text(o?.["mdl"]);
  if (!o || !mdl || !/^[1-9][0-9]{0,5}$/.test(mdl)) return null;
  const src = obj(o["src"]) as MdlSource | null;
  const rows = parseSeriesRows(o["rows"]);
  if (!src && !rows.length) return null;
  const scope = o["scope"] === "reported" || o["scope"] === "historical" ? o["scope"] : null;
  return {
    mdl,
    scope,
    today: text(o["today"]),
    refreshed: text(o["refreshed"]),
    basis,
    attributes: mdlAttributes(mdl, src ?? {}),
    meta: parseMeta(o["meta"]),
    rows,
    notices,
  };
}

const AGENCY_GROUPS = new Set(["product"]);
const isAgency = (r: SeriesRow) => AGENCY_GROUPS.has(seriesMeta(r.series, r).group);
const isActivity = (r: SeriesRow) => seriesMeta(r.series, r).group === "activity";

/**
 * SAFETY's litigation series under this file's ids. Its `filings` is the change in JPML total actions between two
 * consecutive monthly reports (negative after a correction), not court filings: it becomes `jpml_actions_added`.
 * Its `documents_filed` and `docket_entries` duplicate litviz's own `filings` and `docket_entries`, which are kept
 * instead (they count only filings open under documents.is_open() and prefer the fuller docket source).
 */
const SAFETY_IDS: Record<string, string | null> = {
  filings: "jpml_actions_added",
  documents_filed: null,
  docket_entries: null,
};

/**
 * The timeline rows. Agency series: SAFETY's when its RPC returned any, else the FDA product series records that name
 * the MDL. Litigation series: litviz's own. The month in progress is marked partial.
 */
export function mergeSignalRows(
  own: readonly SeriesRow[],
  safety: readonly SeriesRow[] | null,
  today: string | null = null,
): {
  rows: SeriesRow[];
  agencySource: ProductSignals["agencySource"];
} {
  const activity = own.filter(isActivity);
  const theirs = (safety ?? []).flatMap((r) => {
    const id = r.series in SAFETY_IDS ? SAFETY_IDS[r.series] : r.series;
    return id ? [{ ...r, series: id }] : [];
  });
  const theirAgency = theirs.filter(isAgency);
  const ownAgency = own.filter(isAgency);
  const current = today && /^\d{4}-\d{2}/.test(today) ? today.slice(0, 7) : null;
  const mark = (r: SeriesRow): SeriesRow =>
    current &&
    r.month === current &&
    seriesMeta(r.series, r).grain === "month" &&
    !isPartialBasis(r.basis)
      ? { ...r, basis: `${r.basis}:partial_month` }
      : r;
  if (theirAgency.length)
    return {
      rows: [...theirs.map(mark), ...activity],
      agencySource: "product_signals_v1",
    };
  return {
    rows: [...ownAgency, ...theirs.filter((r) => !isAgency(r)).map(mark), ...activity],
    agencySource: ownAgency.length ? "fda_product_series" : null,
  };
}

export function productSignals(
  detail: MdlDetail,
  safety: readonly SeriesRow[] | null,
): ProductSignals {
  const { rows, agencySource } = mergeSignalRows(detail.rows, safety, detail.today);
  return {
    mdl: detail.mdl,
    title: detail.attributes.title,
    centralized: detail.attributes.dates.centralized,
    today: detail.today,
    agencySource,
    products: detail.attributes.products,
    rows,
    notices: detail.notices,
  };
}

/** Series ids present, grouped for display: agency series first, then litigation activity. */
export function signalGroups(rows: readonly SeriesRow[]): { agency: string[]; activity: string[] } {
  const ids = [...bySeries(rows).keys()];
  return {
    agency: ids.filter(
      (id) =>
        seriesMeta(id).group === "product" ||
        !["activity", "lifecycle", "national"].includes(seriesMeta(id).group),
    ),
    activity: ids.filter((id) => seriesMeta(id).group === "activity"),
  };
}

/**
 * Transport form of the product signals: SAFETY's monthly series run to thousands of rows that repeat their unit,
 * source, query URL and link statement, so every string goes once into a dictionary and each row is
 * [series, monthIndex, value, unit, dataset, url (-1 = none), basis]. Lossless; expanded in the browser.
 */
export type SignalRowWire = [number, number, number | null, number, number, number, number];
export type ProductSignalsWire = Omit<ProductSignals, "rows"> & {
  strings: string[];
  rows: SignalRowWire[];
};

export function toSignalWire(p: ProductSignals): ProductSignalsWire {
  const strings: string[] = [];
  const at = new Map<string, number>();
  const ix = (v: string) => {
    let i = at.get(v);
    if (i === undefined) {
      i = strings.push(v) - 1;
      at.set(v, i);
    }
    return i;
  };
  const { rows, ...rest } = p;
  return {
    ...rest,
    strings,
    rows: rows.map((r) => [
      ix(r.series),
      monthIndex(r.month) ?? 0,
      r.value,
      ix(r.unit),
      ix(r.source_dataset),
      r.source_url === null ? -1 : ix(r.source_url),
      ix(r.basis),
    ]),
  };
}

export function fromSignalWire(w: ProductSignalsWire): ProductSignals {
  const { strings, rows, ...rest } = w;
  const s = (i: number) => strings[i] ?? "";
  return {
    ...rest,
    rows: rows.map(([series, m, value, unit, ds, url, basis]) => ({
      series: s(series),
      month: monthKey(m),
      value,
      unit: s(unit),
      source_dataset: s(ds),
      source_url: url < 0 ? null : s(url),
      basis: s(basis),
    })),
  };
}
