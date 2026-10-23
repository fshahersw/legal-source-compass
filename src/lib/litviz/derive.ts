/**
 * litviz/1 derivations: published corpus records → long series rows and the label fields of each MDL.
 *
 * This file is the TypeScript twin of `litviz.series_rows()` and `litviz.source_rows()` in
 * database/contracts/litviz-v1.sql. The SQL builds the precomputed table the read RPCs serve; this file builds the same
 * rows from REST reads when those functions are not applied yet. src/lib/litviz/contract.test.mjs runs both on one
 * fixture and requires identical output, so a rule changed here must change there too.
 *
 * Rules (both sides):
 * - A series value comes from one published field; nothing is estimated or interpolated. A missing value is no row.
 * - Flow counts (docket entries, filings) are zero-filled only between the first and last month the corpus holds for
 *   that MDL; outside that span nothing is recorded. The month of `today` is marked `:partial_month`.
 * - Docket entries come from `sw_docket_entries_v1` for an MDL it covers, else from `mdl_docket_activity`; never both
 *   (the two overlap).
 * - A fiscal-year point whose MDL attribution the JPML extraction did not verify carries `:attribution_unverified`.
 * - Product series are the FDA series records that name the MDL themselves (`item.mdl`); nothing is matched by name.
 */
import type { SeriesRow } from "./model";

export type MdlRow = SeriesRow & { mdl: string };
export type RawRecord = { id: string; source_url?: string | null; item: unknown };
/** One docket entry projected to what the counts need. */
export type DocketEntry = { mdl: unknown; date: unknown; url: unknown };

const MDL = /^[1-9][0-9]{0,5}$/;
const MONTH = /^[12][0-9]{3}-(0[1-9]|1[0-2])$/;
const YEAR = /^[12][0-9]{3}$/;

const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
/** Postgres `->>` on a JSON value: strings as is, numbers and booleans as text, null/absent as null. */
export const jtext = (v: unknown): string | null =>
  typeof v === "string"
    ? v
    : typeof v === "number" || typeof v === "boolean"
      ? String(v)
      : v && typeof v === "object"
        ? JSON.stringify(v)
        : null;
const jstring = (v: unknown): string | null => (typeof v === "string" ? v : null);
/** `min(x collate "C")`: smallest by code unit, ignoring nulls. */
const minC = (a: string | null, b: string | null) =>
  a === null ? b : b === null ? a : a < b ? a : b;

const monthOf = (today: string) => today.slice(0, 7);
const monthsBetween = (lo: string, hi: string): string[] => {
  const out: string[] = [];
  let y = Number(lo.slice(0, 4));
  let m = Number(lo.slice(5, 7));
  const end = Number(hi.slice(0, 4)) * 12 + Number(hi.slice(5, 7));
  while (y * 12 + m <= end) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
};

// ------------------------------------------------------------------------------------------------ JPML

/** A. Monthly pending reports (jpml_pending_history_mdls, item.history.series[]). */
export function jpmlMonthlyRows(records: readonly RawRecord[]): MdlRow[] {
  const out: MdlRow[] = [];
  for (const r of records) {
    if (!MDL.test(r.id)) continue;
    const seen = new Set<string>();
    for (const p of arr(obj(obj(r.item)?.["history"])?.["series"])) {
      const o = obj(p);
      const month = jtext(o?.["month"]);
      if (!o || !month || !MONTH.test(month) || !isNum(o["pending"]) || seen.has(month)) continue;
      seen.add(month);
      out.push({
        mdl: r.id,
        series: "jpml_pending",
        month,
        value: o["pending"],
        unit: "actions",
        source_dataset: "jpml_pending_history_mdls",
        source_url: jstring(o["source_url"]),
        basis: "jpml_monthly_report",
      });
    }
  }
  return out;
}

/** Source URL of each fiscal-year edition (jpml_statistics_extra records "fy:YYYY"). */
export function fyEditionUrls(records: readonly RawRecord[]): Map<number, string | null> {
  const m = new Map<number, string | null>();
  for (const r of records) {
    const g = /^fy:([12][0-9]{3})$/.exec(r.id);
    if (g) m.set(Number(g[1]), r.source_url ?? null);
  }
  return m;
}

const FY_FIELDS = [
  ["jpml_fy_pending", "pending", false],
  ["jpml_fy_closed", "closed", true],
  ["jpml_fy_remanded", "remanded", true],
] as const;

/** B. Fiscal-year history per MDL (jpml_statistics_extra records "mdl:N", item.fy_history.series[]). */
export function fyRows(
  records: readonly RawRecord[],
  editions: Map<number, string | null>,
): MdlRow[] {
  const out: MdlRow[] = [];
  for (const r of records) {
    const g = /^mdl:([1-9][0-9]{0,5})$/.exec(r.id);
    if (!g) continue;
    // one line per fiscal year: a verified line first, else the first printed
    const lines = new Map<number, Record<string, unknown>>();
    for (const p of arr(obj(obj(r.item)?.["fy_history"])?.["series"])) {
      const o = obj(p);
      const fyText = jtext(o?.["fy"]);
      if (!o || !fyText || !YEAR.test(fyText)) continue;
      const fy = Number(fyText);
      const cur = lines.get(fy);
      if (
        !cur ||
        (jtext(cur["attribution"]) !== "verified" && jtext(o["attribution"]) === "verified")
      )
        lines.set(fy, o);
    }
    for (const [fy, o] of [...lines].sort((a, b) => a[0] - b[0])) {
      const verified = jtext(o["attribution"]) === "verified";
      for (const [series, field, flow] of FY_FIELDS) {
        if (!isNum(o[field])) continue;
        out.push({
          mdl: g[1]!,
          series,
          month: `${fy}-09`,
          value: o[field] as number,
          unit: "actions",
          source_dataset: "jpml_statistics_extra",
          source_url: editions.get(fy) ?? null,
          basis:
            (verified
              ? "jpml_fy_statistical_analysis"
              : "jpml_fy_statistical_analysis:attribution_unverified") +
            (flow && fy === 1992 ? ":15_month_period" : ""),
        });
      }
    }
  }
  return out;
}

/** The last filing date an FJC extract covers, from its published snapshot note ("… filing dates through 2026-06-30"). */
export function fjcThrough(note: string | null | undefined): string | null {
  return /through ([12][0-9]{3}-[01][0-9]-[0-3][0-9])/.exec(note ?? "")?.[1] ?? null;
}

/** C. FJC IDB civil cases carrying the MDL docket number, by fiscal year filed (fjc_civil_mdls "mdl:N"). A fiscal
 * year that ends after the extract's last filing date (`snapshot`, see fjcThrough) is partial. */
export function fjcRows(records: readonly RawRecord[], snapshot: string | null): MdlRow[] {
  const out: MdlRow[] = [];
  for (const r of records) {
    const g = /^mdl:([1-9][0-9]{0,5})$/.exec(r.id);
    if (!g) continue;
    const item = obj(r.item);
    const url = r.source_url ?? jstring(obj(arr(item?.["links"])[0])?.["url"]);
    const seen = new Set<string>();
    for (const p of arr(obj(item?.["profile"])?.["by_fy"])) {
      const o = obj(p);
      const fy = jtext(o?.["fy"]);
      if (!o || !fy || !YEAR.test(fy) || !isNum(o["cases"]) || seen.has(fy)) continue;
      seen.add(fy);
      out.push({
        mdl: g[1]!,
        series: "fjc_idb_cases",
        month: `${fy}-09`,
        value: o["cases"],
        unit: "civil cases",
        source_dataset: "fjc_civil_mdls",
        source_url: url,
        basis:
          "fjc_idb:historical_association" +
          (snapshot && `${fy}-09-30` > snapshot ? ":partial" : ""),
      });
    }
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ activity

function zeroFilled(
  counts: Map<string, Map<string, number>>,
  urls: Map<string, string | null>,
  make: (mdl: string, month: string, value: number, url: string | null) => MdlRow,
): MdlRow[] {
  const out: MdlRow[] = [];
  for (const [mdl, months] of counts) {
    const keys = [...months.keys()].sort();
    if (!keys.length) continue;
    for (const month of monthsBetween(keys[0]!, keys[keys.length - 1]!))
      out.push(make(mdl, month, months.get(month) ?? 0, urls.get(mdl) ?? null));
  }
  return out;
}

/** D. Master-docket entries collected per month, zero-filled inside the collected span. */
export function docketRows(
  sw: readonly DocketEntry[],
  activity: readonly DocketEntry[],
  today: string,
): MdlRow[] {
  const cur = monthOf(today);
  const swMdls = new Set<string>();
  for (const e of sw) {
    const mdl = jtext(e.mdl);
    if (mdl && MDL.test(mdl)) swMdls.add(mdl);
  }
  const tally = (entries: readonly DocketEntry[], keep: (mdl: string) => boolean) => {
    const counts = new Map<string, Map<string, number>>();
    const urls = new Map<string, string | null>();
    for (const e of entries) {
      const mdl = jtext(e.mdl);
      const month = (jtext(e.date) ?? "").slice(0, 7);
      if (!mdl || !MDL.test(mdl) || !keep(mdl) || !MONTH.test(month)) continue;
      if (month < "1968-01" || month > cur) continue;
      const m = counts.get(mdl) ?? new Map<string, number>();
      m.set(month, (m.get(month) ?? 0) + 1);
      counts.set(mdl, m);
      urls.set(mdl, minC(urls.get(mdl) ?? null, jstring(e.url)));
    }
    return { counts, urls };
  };
  const make =
    (dataset: string) =>
    (mdl: string, month: string, value: number, url: string | null): MdlRow => ({
      mdl,
      series: "docket_entries",
      month,
      value,
      unit: "entries",
      source_dataset: dataset,
      source_url: url,
      basis: "master_docket:collected_entries" + (month === cur ? ":partial_month" : ""),
    });
  const a = tally(sw, () => true);
  const b = tally(activity, (mdl) => !swMdls.has(mdl));
  return [
    ...zeroFilled(a.counts, a.urls, make("sw_docket_entries_v1")),
    ...zeroFilled(b.counts, b.urls, make("mdl_docket_activity")),
  ];
}

/** E. Filings collected per month from the documents layer (counts per MDL and filing month). */
export function filingRowsMonthly(
  counts: readonly { mdl: string; month: string; n: number }[],
  today: string,
): MdlRow[] {
  const cur = monthOf(today);
  const m = new Map<string, Map<string, number>>();
  for (const c of counts) {
    if (!MDL.test(c.mdl) || !MONTH.test(c.month) || c.month < "1968-01" || c.month > cur) continue;
    const x = m.get(c.mdl) ?? new Map<string, number>();
    x.set(c.month, (x.get(c.month) ?? 0) + c.n);
    m.set(c.mdl, x);
  }
  return zeroFilled(m, new Map(), (mdl, month, value) => ({
    mdl,
    series: "filings",
    month,
    value,
    unit: "filings",
    source_dataset: "documents",
    source_url: `/litigation/documents?mdl=${mdl}`,
    basis: "documents:listing_rule" + (month === cur ? ":partial_month" : ""),
  }));
}

/** E (REST fallback). Filings collected per calendar year (documents_for_entity_v1 by_year), zero-filled inside the
 * collected span; served as `filings_year` because the month is not available without the litviz functions. */
export function filingRowsYearly(
  byYear: readonly { mdl: string; year: number; n: number }[],
  today: string,
): MdlRow[] {
  const curYear = Number(today.slice(0, 4));
  const m = new Map<string, Map<number, number>>();
  for (const c of byYear) {
    if (!MDL.test(c.mdl) || !Number.isInteger(c.year) || c.year < 1968 || c.year > curYear)
      continue;
    const x = m.get(c.mdl) ?? new Map<number, number>();
    x.set(c.year, (x.get(c.year) ?? 0) + c.n);
    m.set(c.mdl, x);
  }
  const out: MdlRow[] = [];
  for (const [mdl, years] of m) {
    const ys = [...years.keys()].sort((a, b) => a - b);
    for (let y = ys[0]!; y <= ys[ys.length - 1]!; y++)
      out.push({
        mdl,
        series: "filings_year",
        month: `${y}-01`,
        value: years.get(y) ?? 0,
        unit: "filings",
        source_dataset: "documents",
        source_url: `/litigation/documents?mdl=${mdl}`,
        basis: "documents:listing_rule:calendar_year" + (y === curYear ? ":partial" : ""),
      });
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ products

export const PRODUCT_DATASETS = {
  fda_faers_product_series: "faers_reports",
  fda_device_event_series: "maude_reports",
} as const;
export type ProductDataset = keyof typeof PRODUCT_DATASETS;

/** F/G. FDA product series that name the MDL in their own record (item.mdl). */
export function productRows(records: readonly (RawRecord & { dataset: string })[]): MdlRow[] {
  const out: MdlRow[] = [];
  const seen = new Set<string>();
  // one value per dataset, MDL and year: the record with the smallest id first, then the first printed line
  const ordered = [...records].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const r of ordered) {
    const series = PRODUCT_DATASETS[r.dataset as ProductDataset];
    const item = obj(r.item);
    const mdl = jtext(item?.["mdl"]);
    if (!series || !mdl || !MDL.test(mdl)) continue;
    for (const p of arr(item?.["series"])) {
      const o = obj(p);
      const year = jtext(o?.["year"]);
      if (!o || !year || !YEAR.test(year) || !isNum(o["reports"])) continue;
      const key = `${r.dataset}|${mdl}|${year}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        mdl,
        series,
        month: `${year}-01`,
        value: o["reports"],
        unit: "reports",
        source_dataset: r.dataset,
        source_url: r.source_url ?? null,
        basis: "calendar_year_total" + (o["partial"] === true ? ":partial" : ""),
      });
    }
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ national

/** National context rows (mdl "US"): actions pending at FY end and centralization motions granted per year. */
export function nationalRows(
  editions: readonly RawRecord[],
  intel: readonly RawRecord[],
): MdlRow[] {
  const out: MdlRow[] = [];
  for (const r of editions) {
    const g = /^fy:([12][0-9]{3})$/.exec(r.id);
    const pending = obj(obj(r.item)?.["fy_stats"])?.["pending"];
    if (!g || !isNum(pending)) continue;
    out.push({
      mdl: "US",
      series: "jpml_fy_pending",
      month: `${g[1]}-09`,
      value: pending,
      unit: "actions",
      source_dataset: "jpml_statistics_extra",
      source_url: r.source_url ?? null,
      basis: "jpml_fy_statistical_analysis",
    });
  }
  for (const r of intel) {
    if (!/^year:[12][0-9]{3}$/.test(r.id)) continue;
    const stats = obj(obj(r.item)?.["stats"]);
    const year = jtext(stats?.["year"]);
    if (!stats || !year || !YEAR.test(year) || !isNum(stats["motions_granted"])) continue;
    out.push({
      mdl: "US",
      series: "jpml_motions_granted",
      month: `${year}-01`,
      value: stats["motions_granted"],
      unit: "motions",
      source_dataset: "mdl_intel_jpml_stats",
      source_url: r.source_url ?? null,
      basis: "calendar_year_total",
    });
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ label fields

export type SourceRecords = {
  mdls: readonly RawRecord[];
  history: readonly RawRecord[];
  analytics: readonly RawRecord[];
  fy: readonly RawRecord[];
  terminated: readonly RawRecord[];
  products: readonly (RawRecord & { dataset: string })[];
};

export type SourceRow = {
  mdl: string;
  scope: "reported" | "historical";
  src: Record<string, unknown>;
};

/** jsonb_strip_nulls of a flat object of `->>` texts. */
function pick(o: Record<string, unknown> | null, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!o) return out;
  for (const k of keys) {
    const v = jtext(o[k]);
    if (v !== null) out[k] = v;
  }
  return out;
}

const M_TEXT = [
  "title",
  "status",
  "litigation_type",
  "cl_court_id",
  "court_name",
  "judge_name_as_printed",
  "judge_profile_id",
  "judge_match_kind",
  "date_transferred",
  "date_closed",
  "as_of",
] as const;
const H_TEXT = [
  "title",
  "type",
  "judge",
  "district",
  "date_filed",
  "date_transferred",
  "date_closed",
  "exit_status",
  "last_report",
] as const;

/** The label fields of every MDL (the twin of litviz.source_rows()). */
export function sourceRows(s: SourceRecords): SourceRow[] {
  const src = new Map<string, Record<string, unknown>>();
  const reported = new Set<string>();
  const put = (mdl: string, key: string, v: Record<string, unknown>) => {
    const cur = src.get(mdl) ?? {};
    cur[key] = v;
    src.set(mdl, cur);
  };
  for (const r of s.mdls) {
    if (!MDL.test(r.id)) continue;
    const i = obj(r.item);
    const v = pick(i, M_TEXT);
    for (const k of ["actions_pending", "total_actions"]) if (isNum(i?.[k])) v[k] = i![k];
    put(r.id, "m", v);
    reported.add(r.id);
  }
  for (const r of s.history) {
    if (!MDL.test(r.id)) continue;
    const h = obj(obj(r.item)?.["history"]);
    const v = pick(h, H_TEXT);
    const url = jtext(obj(h?.["closed_evidence"])?.["url"]);
    if (url !== null) v["closed_url"] = url;
    put(r.id, "h", v);
    reported.add(r.id);
  }
  for (const r of s.analytics) {
    if (!MDL.test(r.id)) continue;
    const i = obj(r.item);
    const a = obj(i?.["analytics"]);
    const v: Record<string, unknown> = {};
    if (typeof a?.["mass_tort"] === "boolean") v["mass_tort"] = a["mass_tort"];
    const type = jtext(a?.["type"]);
    if (type !== null) v["type"] = type;
    const title = jtext(i?.["title"]);
    if (title !== null) v["title"] = title;
    put(r.id, "a", v);
    reported.add(r.id);
  }
  for (const r of s.fy) {
    const g = /^mdl:([1-9][0-9]{0,5})$/.exec(r.id);
    if (!g) continue;
    const i = obj(r.item);
    const fh = obj(i?.["fy_history"]);
    const points = arr(fh?.["series"])
      .map(obj)
      .filter((p): p is Record<string, unknown> => !!p && YEAR.test(jtext(p["fy"]) ?? ""));
    const v: Record<string, unknown> = {};
    const caption = jtext(i?.["title"]);
    if (caption !== null) v["caption"] = caption;
    const judge = jtext(fh?.["judge"]);
    if (judge !== null) v["judge"] = judge;
    if (points.length) {
      const fys = points.map((p) => Number(jtext(p["fy"])));
      const last = Math.max(...fys);
      // the district printed on the latest fiscal-year line (first such line when an MDL has several parts)
      const district = jtext(points.find((p) => Number(jtext(p["fy"])) === last)?.["district"]);
      if (district !== null) v["district"] = district;
      v["first_fy"] = Math.min(...fys);
      v["last_fy"] = last;
    }
    put(g[1]!, "x", v);
  }
  const term = new Map<string, { year: number; district: string | null }>();
  for (const r of s.terminated) {
    const h = obj(obj(r.item)?.["history"]);
    const mdl = jtext(h?.["mdl"]);
    const year = h?.["termination_year"];
    if (!mdl || !MDL.test(mdl) || !isNum(year)) continue;
    const district = jtext(h?.["district_name"]);
    const cur = term.get(mdl);
    if (
      !cur ||
      year > cur.year ||
      (year === cur.year && minC(cur.district, district) === district && district !== cur.district)
    )
      term.set(mdl, { year, district });
  }
  for (const [mdl, t] of term)
    put(
      mdl,
      "t",
      t.district === null
        ? { termination_year: t.year }
        : { termination_year: t.year, district: t.district },
    );
  const products = new Map<string, Record<string, unknown>[]>();
  for (const r of [...s.products].sort((a, b) =>
    a.dataset < b.dataset ? -1 : a.dataset > b.dataset ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  )) {
    if (!(r.dataset in PRODUCT_DATASETS)) continue;
    const i = obj(r.item);
    const mdl = jtext(i?.["mdl"]);
    if (!mdl || !MDL.test(mdl)) continue;
    const p: Record<string, unknown> = { dataset: r.dataset, id: r.id };
    const product = jtext(i?.["product"]);
    if (product !== null) p["product"] = product;
    if (r.source_url) p["source_url"] = r.source_url;
    const through = jtext(i?.["data_through"]);
    if (through !== null) p["data_through"] = through;
    products.set(mdl, [...(products.get(mdl) ?? []), p]);
  }
  for (const [mdl, list] of products) if (src.has(mdl)) src.get(mdl)!["products"] = list;
  return [...src.entries()]
    .map(([mdl, v]) => ({
      mdl,
      scope: reported.has(mdl) ? ("reported" as const) : ("historical" as const),
      src: v,
    }))
    .sort((a, b) => Number(a.mdl) - Number(b.mdl));
}
