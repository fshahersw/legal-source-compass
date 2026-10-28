/**
 * Civil Justice Reform Act (CJRA) delay counts for one federal district (dataset court_cjra_districts, built by
 * scripts/enrichment/uscourts_cjra from the semiannual U.S. Courts CJRA reports), with the report pages of every
 * period (dataset court_cjra_reports) so each figure links to the report it was printed in.
 *
 * Exact only: a row belongs to a court page when its court_id is that court's id. A series that does not line up with
 * the report dates is not drawn; a period the reports do not record (an exempted district, no printed total) stays
 * null with the reason the builder recorded, never 0. Printed totals are kept as printed; where the judge rows do not
 * add up to them, the difference is listed, not corrected.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { restGet } from "./rest.server";
import { CJRA_SERIES, type CjraSeriesKey } from "./judgeCjra.functions";

export type DistrictCjraNote = {
  /** Judge row the note is printed under, as printed. */
  row: string;
  text: string;
  measure: CjraSeriesKey | null;
  /** Report dates that print this note, oldest first. */
  periods: string[];
  /** Printed page in the latest report that carries it. */
  page: number | null;
};
export type DistrictCjraDifference = {
  period: string;
  /** "judge_rows_differ", "no_total_row", "not_listed" as the builder records it. */
  status: string;
  /** Printed total minus the sum of the judge rows, per measure. */
  difference: Partial<Record<CjraSeriesKey, number>>;
};
export type DistrictCjra = {
  courtId: string;
  court: string | null;
  circuit: string | null;
  /** Report dates (period ends, YYYY-MM-DD), oldest first; every series has one value per period. */
  periods: string[];
  series: Record<CjraSeriesKey, (number | null)[]>;
  /** How each period's value was taken: "printed_total", "judge_rows_sum_matches_circuit_table", "not_recorded". */
  basis: (string | null)[];
  /** Reason a period is not recorded, keyed by period. */
  notRecorded: Record<string, string>;
  /** District judges listed with the district in each report (not unassigned or visiting rows). */
  judgesListed: (number | null)[];
  /** Civil cases pending 3+ years per listed district judge, as the builder computed it. */
  perJudge: (number | null)[];
  /** Share of the national civil 3+ year count, percent, per period. */
  sharePct: (number | null)[];
  /** Competition rank among the districts in the latest report (1 = most). */
  rank: { of: number; period: string; civil3y: number | null; motions6m: number | null } | null;
  peak: { value: number; period: string } | null;
  mdlNoted: boolean;
  notes: DistrictCjraNote[];
  differences: DistrictCjraDifference[];
  /** U.S. Courts report page of each period (official URLs only). */
  reportPages: Record<string, string>;
  latestPdf: string | null;
};

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null;
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const strs = (v: unknown): string[] =>
  (Array.isArray(v) ? v : []).map(str).filter((s): s is string => !!s);
const PERIOD = /^\d{4}-\d{2}-\d{2}$/;
const DISTRICT_ID = /^[a-z]{2,4}d$/;
const OFFICIAL_URL = /^https:\/\/www\.uscourts\.gov\//;
const SERIES = new Set<string>(CJRA_SERIES);

const count = (v: unknown): number | null =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null;
const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;

function aligned<T>(v: unknown, n: number, read: (x: unknown) => T | null): (T | null)[] {
  return Array.isArray(v) && v.length === n ? v.map(read) : Array.from({ length: n }, () => null);
}

/**
 * Notes printed under the same judge row for the same measure are one note across reports when one printing starts
 * with the other (extraction can cut a sentence short); the longest printing is kept.
 */
function groupNotes(raw: unknown, periods: readonly string[]): DistrictCjraNote[] {
  const groups: (DistrictCjraNote & { lastPeriod: string })[] = [];
  const norm = (t: string) => t.toLowerCase();
  for (const n of Array.isArray(raw) ? raw : []) {
    const o = obj(n);
    const period = str(o?.["period"]);
    const text = str(o?.["text"])?.replace(/\s+/g, " ") ?? null;
    const row = str(o?.["row"]) ?? "";
    if (!period || !text || !periods.includes(period)) continue;
    const m = str(o?.["measure"]);
    const measure = m && SERIES.has(m) ? (m as CjraSeriesKey) : null;
    const page = count(o?.["page"]);
    const t = norm(text);
    const g = groups.find(
      (x) =>
        x.row === row &&
        x.measure === measure &&
        (norm(x.text).startsWith(t) || t.startsWith(norm(x.text))),
    );
    if (!g) {
      groups.push({ row, text, measure, periods: [period], page, lastPeriod: period });
      continue;
    }
    if (!g.periods.includes(period)) g.periods.push(period);
    if (text.length > g.text.length) g.text = text;
    if (period > g.lastPeriod) {
      g.lastPeriod = period;
      g.page = page;
    }
  }
  return groups
    .map(({ lastPeriod: _l, ...g }) => ({ ...g, periods: g.periods.sort() }))
    .sort(
      (a, b) =>
        b.periods.at(-1)!.localeCompare(a.periods.at(-1)!) ||
        a.row.localeCompare(b.row) ||
        a.text.localeCompare(b.text),
    );
}

/** One court_cjra_districts row for one court id; null unless the row is that court's and its periods are ordered. */
export function parseDistrictCjraRow(
  row: { id: unknown; source_url?: unknown; item: unknown },
  courtId: string,
): Omit<DistrictCjra, "reportPages"> | null {
  const it = obj(row.item);
  if (!it || str(it["court_id"]) !== courtId || str(row.id) !== courtId) return null;
  const periods = strs(it["periods"]);
  if (!periods.length || periods.some((p) => !PERIOD.test(p))) return null;
  for (let i = 1; i < periods.length; i++) if (periods[i]! <= periods[i - 1]!) return null;
  const n = periods.length;
  const raw = obj(it["series"]);
  const series = {} as Record<CjraSeriesKey, (number | null)[]>;
  for (const key of CJRA_SERIES) series[key] = aligned(raw?.[key], n, count);
  const notRecorded: Record<string, string> = {};
  for (const [p, why] of Object.entries(obj(it["not_recorded"]) ?? {})) {
    const w = str(why);
    if (PERIOD.test(p) && w && periods.includes(p)) notRecorded[p] = w.replace(/\s+/g, " ");
  }
  const ranks = obj(it["ranks"]);
  const of = count(ranks?.["of"]);
  const rankPeriod = str(ranks?.["period"]);
  const peak = obj(it["peak_civil_3y"]);
  const peakValue = count(peak?.["value"]);
  const peakPeriod = str(peak?.["period"]);
  const cells = obj(it["cells"]);
  const differences: DistrictCjraDifference[] = Object.entries(obj(it["reconciliation"]) ?? {})
    .map(([period, v]) => {
      const o = obj(v);
      const status = str(o?.["status"]);
      if (!PERIOD.test(period) || !status) return null;
      const difference: Partial<Record<CjraSeriesKey, number>> = {};
      for (const [k, d] of Object.entries(obj(o?.["difference"]) ?? {}))
        if (SERIES.has(k) && typeof d === "number" && Number.isFinite(d))
          difference[k as CjraSeriesKey] = d;
      return { period, status, difference };
    })
    .filter((d): d is DistrictCjraDifference => !!d)
    .sort((a, b) => a.period.localeCompare(b.period));
  const pdf = str(row.source_url);
  return {
    courtId,
    court: str(cells?.["court"]) ?? str(it["title"]),
    circuit: str(cells?.["circuit"]),
    periods,
    series,
    basis: aligned(it["sources"], n, str),
    notRecorded,
    judgesListed: aligned(it["district_judges_listed"], n, count),
    perJudge: aligned(it["civil_3y_per_listed_district_judge"], n, num),
    sharePct: aligned(it["share_civil_3y_pct"], n, num),
    rank:
      of && rankPeriod && PERIOD.test(rankPeriod)
        ? {
            of,
            period: rankPeriod,
            civil3y: count(ranks?.["civil_3y"]),
            motions6m: count(ranks?.["motions_6m"]),
          }
        : null,
    peak:
      peakValue !== null && peakPeriod && periods.includes(peakPeriod)
        ? { value: peakValue, period: peakPeriod }
        : null,
    mdlNoted: strs(it["badges"]).includes("Multidistrict litigation noted"),
    notes: groupNotes(it["notes"], periods),
    differences,
    latestPdf: pdf && OFFICIAL_URL.test(pdf) ? pdf : null,
  };
}

/** The U.S. Courts report page of each report period, from court_cjra_reports links. */
export function reportPagesFromRows(rows: readonly { id: unknown; links: unknown }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of rows) {
    const id = str(r.id);
    if (!id || !PERIOD.test(id)) continue;
    for (const l of Array.isArray(r.links) ? r.links : []) {
      const url = str(obj(l)?.["url"]);
      if (url && OFFICIAL_URL.test(url) && /civil-justice-reform-act/i.test(url)) {
        out[id] = url;
        break;
      }
    }
  }
  return out;
}

/** The value of a series at its last recorded period, with the period before it that is recorded. */
export function latestWithPrevious(
  d: Pick<DistrictCjra, "periods" | "series">,
  key: CjraSeriesKey,
): { period: string; value: number; previous: { period: string; value: number } | null } | null {
  const s = d.series[key];
  for (let i = s.length - 1; i >= 0; i--) {
    const v = s[i];
    if (v === null || v === undefined) continue;
    let previous: { period: string; value: number } | null = null;
    const p = s[i - 1];
    if (i > 0 && p !== null && p !== undefined) previous = { period: d.periods[i - 1]!, value: p };
    return { period: d.periods[i]!, value: v, previous };
  }
  return null;
}

type DistrictRow = { id: string; source_url: string | null; item: unknown };

export const getDistrictCjra = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ id: z.string().regex(DISTRICT_ID) }).parse(d))
  .handler(async ({ data }): Promise<DistrictCjra | null> => {
    const [district, reports] = await Promise.all([
      restGet<DistrictRow[]>(
        `corpus_records?select=id,source_url,item&dataset=eq.court_cjra_districts&id=eq.${data.id}&limit=2`,
      ),
      restGet<{ id: string; links: unknown }[]>(
        `corpus_records?select=id,links:item->links&dataset=eq.court_cjra_reports&limit=120`,
      ),
    ]);
    if (district.rows.length !== 1) return null;
    const parsed = parseDistrictCjraRow(district.rows[0]!, data.id);
    return parsed ? { ...parsed, reportPages: reportPagesFromRows(reports.rows) } : null;
  });
