/**
 * One MDL's detailed lane and product signal timeline: label fields, coverage notes and series rows. The rows of
 * agency series come from worker SAFETY's `public.product_signals_v1(p_mdl)` when it is applied (same row shape), else
 * from the FDA product series records that name the MDL (litviz/1). Litigation series (docket entries, filings) are
 * always litviz rows. Pure and client-safe.
 */
import {
  bySeries,
  mdlAttributes,
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
 * The timeline rows: SAFETY's rows when its RPC returned any (they replace the FDA product series of the same MDL and
 * any litigation series they also carry), plus the litviz litigation rows.
 */
export function mergeSignalRows(
  own: readonly SeriesRow[],
  safety: readonly SeriesRow[] | null,
): {
  rows: SeriesRow[];
  agencySource: ProductSignals["agencySource"];
} {
  const activity = own.filter(isActivity);
  if (safety && safety.length) {
    const theirs = new Set(safety.map((r) => r.series));
    return {
      rows: [...safety, ...activity.filter((r) => !theirs.has(r.series))],
      agencySource: "product_signals_v1",
    };
  }
  const agency = own.filter(isAgency);
  return {
    rows: [...agency, ...activity],
    agencySource: agency.length ? "fda_product_series" : null,
  };
}

export function productSignals(
  detail: MdlDetail,
  safety: readonly SeriesRow[] | null,
): ProductSignals {
  const { rows, agencySource } = mergeSignalRows(detail.rows, safety);
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
