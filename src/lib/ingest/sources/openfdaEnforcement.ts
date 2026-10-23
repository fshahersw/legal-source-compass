/**
 * openFDA enforcement reports (drug, device, food) → agency_safety_openfda_{drug,device,food}_enforcement (upsert,
 * newest first).
 *
 * The three datasets were built from the openFDA bulk export (download.open.fda.gov, export of 2026-09-16) by a builder
 * that is not in this repository; the record shape here is reproduced from the stored rows (every field rule below was
 * read off them) and checked against them: a dry run re-builds records that are already held from the API's copy of the
 * same publisher record and compares (scripts/ingest/dry_run.mjs; capture provenance masked).
 *   - item/detail fields: firm (as published), firm_norm (upper case, '&' read as AND, apostrophes dropped, other
 *     non-alphanumerics as spaces), firm_id (firm:<firm_norm as a slug>), four publisher dates kept apart (ISO, raw
 *     YYYYMMDD in fields.*_raw), snippet (first 240 characters of reason_for_recall), title (product_description);
 *     empty publisher strings are null; publisher_record is the record exactly as published;
 *   - text: every value of the publisher record in its published key order, nested values in order, joined by spaces
 *     (an empty object or string contributes an empty part);
 *   - provenance: rows read here say so — temporal.captured_at (response time), source_as_of = the API's
 *     meta.last_updated, original_file describes the API response (not stored), and the qualification names the API.
 *     Those parts are masked when comparing, so a record unchanged at the publisher keeps its bulk-export provenance.
 *   - reads report_date windows (new reports) and termination_date windows (status changes of older reports).
 */
import { BudgetExhausted, RateLimited } from "../http.ts";
import { cmpTuple } from "../py.ts";
import { maskPath } from "../rows.ts";
import type {
  CollectContext,
  Collected,
  CorpusRow,
  Json,
  JsonObject,
  RowContent,
  SourceAdapter,
} from "../types.ts";

export type Kind = "drug" | "device" | "food";
const PUBLISHER = "U.S. Food and Drug Administration (openFDA)";
const API = "https://api.fda.gov";
const DATE_KEYS = [
  "report_date",
  "termination_date",
  "recall_initiation_date",
  "center_classification_date",
] as const;
const TEXT_FIELDS = [
  "city",
  "state",
  "status",
  "country",
  "event_id",
  "postal_code",
  "product_type",
  "recall_number",
  "classification",
  "recalling_firm",
  "product_quantity",
  "reason_for_recall",
  "voluntary_mandated",
  "product_description",
  "distribution_pattern",
  "initial_firm_notification",
] as const;
const RECHECK_DAYS = 14;
const MAX_WINDOW_DAYS = 120;
const PAGE = 1000;

export const datasetOf = (kind: Kind) => `agency_safety_openfda_${kind}_enforcement`;
export const sourceOf = (kind: Kind) => `openfda_${kind}_enforcement`;

/** The qualification each dataset carries; the last sentence names how the rows were read. */
export function qualification(kind: Kind, via: "bulk" | "api"): string {
  const codeInfo =
    kind === "device"
      ? " code_info (lot and serial lists) is kept verbatim in the publisher record but is not full-text indexed."
      : "";
  const how =
    via === "bulk"
      ? "Records are the publisher's bulk export as of the stated export date, not a live query."
      : "Records are the publisher's API records as of the stated last-updated date, read by the scheduled refresh.";
  return `Four publisher dates are kept separate: recall_initiation_date (firm began the recall), center_classification_date (FDA center classified it), report_date (appeared in the FDA Enforcement Report) and termination_date (FDA terminated the recall; empty while open).${codeInfo} openFDA data: public domain (CC0) per https://open.fda.gov/license/ with the publisher disclaimer: "Do not rely on openFDA to make decisions regarding medical care. While we make every effort to ensure that data is accurate, you should assume all results are unvalidated. We may limit or otherwise restrict your access to the API in line with our Terms of Service." ${how}`;
}

/** Upper case, '&' as AND, apostrophes dropped, any other non-alphanumeric as a space, spaces collapsed. */
export function firmNorm(firm: string): string {
  return firm
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .toUpperCase();
}

export const firmId = (norm: string) => `firm:${norm.toLowerCase().replace(/ /g, "-")}`;

const blankToNull = (v: unknown): Json =>
  v === undefined || v === null || v === "" ? null : (v as Json);
const isoOf = (raw: unknown): string | null => {
  const s = typeof raw === "string" ? raw : "";
  return /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null;
};

/** Every value of the record in published key order (nested in order), as text parts. */
export function textParts(v: unknown): string[] {
  if (v === null || v === undefined) return [""];
  if (Array.isArray(v)) return v.length ? v.flatMap(textParts) : [""];
  if (typeof v === "object") {
    const values = Object.values(v as object);
    return values.length ? values.flatMap(textParts) : [""];
  }
  return [String(v)];
}

export type Capture = {
  url: string;
  capturedAt: string;
  lastUpdated: string;
  bytes: number;
  sha256: string;
};

/** The corpus row of one publisher record read from the openFDA API. */
export function enforcementRow(kind: Kind, rec: JsonObject, cap: Capture): CorpusRow {
  const number = String(rec["recall_number"]);
  const id = `openfda:${kind}/enforcement:${number}`;
  const dates: Record<string, string | null> = {};
  for (const k of DATE_KEYS) dates[k] = isoOf(rec[k]);
  const fields: JsonObject = {};
  for (const k of TEXT_FIELDS) fields[k] = blankToNull(rec[k]);
  for (const k of DATE_KEYS) {
    fields[k] = dates[k] ?? null;
    fields[`${k}_raw`] = blankToNull(rec[k]);
  }
  const firm = String(rec["recalling_firm"] ?? "");
  const norm = firmNorm(firm);
  const fid = firmId(norm);
  const state = blankToNull(rec["state"]) as string | null;
  const reason = String(rec["reason_for_recall"] ?? "");
  const title = String(rec["product_description"] ?? "");
  const status = blankToNull(rec["status"]) as string | null;
  const classification = blankToNull(rec["classification"]) as string | null;
  const report = dates["report_date"] ?? null;
  const dataset = `openfda_${kind}_enforcement`;
  const common: JsonObject = {
    id,
    firm: blankToNull(rec["recalling_firm"]),
    dates,
    group: "enforcement",
    state,
    title,
    status,
    country: blankToNull(rec["country"]),
    dataset,
    firm_id: fid,
    snippet: Array.from(reason).slice(0, 240).join(""),
    firm_norm: norm,
    native_id: number,
    sort_date: report,
    product_code: null,
    published_at: report,
    classification,
  };
  const detail: JsonObject = {
    ...common,
    links: { firm_id: fid },
    fields,
    temporal: {
      captured_at: cap.capturedAt,
      effective_to: null,
      published_at: report,
      source_as_of: cap.lastUpdated,
      effective_from: null,
      captured_at_basis: "HTTP response completed (openFDA API, scheduled refresh)",
      effective_to_basis: null,
      published_at_basis:
        "publisher field report_date (date the recall appeared in the FDA Enforcement Report)",
      source_as_of_basis: `openFDA API meta.last_updated for /${kind}/enforcement`,
      effective_from_basis: null,
    },
    publisher: PUBLISHER,
    source_as_of: cap.lastUpdated,
    original_file: {
      url: cap.url,
      kind: `openfda api query ${kind}/enforcement`,
      mime: "application/json",
      bytes: cap.bytes,
      sha256: cap.sha256,
      file_id: null,
      filename: null,
      final_url: cap.url,
      captured_at: cap.capturedAt,
      http_status: 200,
      publisher_url: cap.url,
      representation: "API response read by the scheduled refresh (not stored)",
    },
    qualification: qualification(kind, "api"),
    publisher_record: rec,
  };
  const filters: JsonObject = {
    date: report,
    status: status ? [status.toLowerCase()] : [],
    dataset: [dataset, "enforcement"],
    firm_norm: norm,
    sort_date: report,
    date_types: DATE_KEYS.filter((k) => dates[k]).sort(),
    product_code: [],
    classification: classification ? [classification.toLowerCase()] : [],
  };
  for (const k of DATE_KEYS) if (dates[k]) filters[k] = dates[k];
  return {
    dataset: datasetOf(kind),
    id,
    category: "agency_safety",
    state: state ?? "",
    county_geoids: [],
    title,
    source_url: "",
    item: common,
    detail,
    text: textParts(rec).join(" "),
    filters,
  };
}

/** Capture provenance (masked when comparing): equal rows have the same publisher record and every derived field. */
export const PROVENANCE_PATHS = [
  ["detail", "temporal", "captured_at"],
  ["detail", "temporal", "captured_at_basis"],
  ["detail", "temporal", "source_as_of"],
  ["detail", "temporal", "source_as_of_basis"],
  ["detail", "source_as_of"],
  ["detail", "original_file"],
  ["detail", "qualification"],
] as const;

export function comparableEnforcement(content: RowContent): Json {
  let v = content as unknown as Json;
  for (const path of PROVENANCE_PATHS) v = maskPath(v, path);
  return v;
}

const day = (d: Date) => d.toISOString().slice(0, 10);
const compact = (iso: string) => iso.replace(/-/g, "");
const addDays = (iso: string, n: number) => day(new Date(Date.parse(iso) + n * 86400000));

type Window = { field: "report_date" | "termination_date"; from: string; to: string };

const searchUrl = (kind: Kind, w: Window, skip = 0) =>
  `${API}/${kind}/enforcement.json?search=${w.field}:[${compact(w.from)}+TO+${compact(w.to)}]&limit=${PAGE}${skip ? `&skip=${skip}` : ""}`;

export function openfdaEnforcement(kind: Kind): SourceAdapter {
  const dataset = datasetOf(kind);
  return {
    source: sourceOf(kind),
    dataset,
    mode: "upsert",
    ordinalPolicy: "prepend",
    functionName: "ingest-openfda-enforcement",
    limits: { maxRequests: 12, minIntervalMs: 1000 },
    secrets: [],

    async collect(ctx: CollectContext): Promise<Collected> {
      const newest = await ctx.corpus.query(
        `corpus_records?select=v:filters->>report_date&dataset=eq.${dataset}&order=filters->>report_date.desc.nullslast&limit=1`,
      );
      const stored = String(newest[0]?.["v"] ?? "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(stored))
        throw new Error(`${dataset} has no stored report_date to continue from`);
      const cursor = (ctx.cursor ?? {}) as JsonObject;
      const through =
        typeof cursor["read_through"] === "string" && String(cursor["read_through"]) > stored
          ? String(cursor["read_through"])
          : stored;
      const from = addDays(through, -RECHECK_DAYS);
      let to = day(ctx.now);
      let complete = true;
      if (Date.parse(to) - Date.parse(from) > MAX_WINDOW_DAYS * 86400000) {
        to = addDays(from, MAX_WINDOW_DAYS);
        complete = false;
      }
      const records = new Map<string, { rec: JsonObject; cap: Capture }>();
      let lastUpdated = "";
      let stopped: string | null = null;
      const windows: Window[] = [
        { field: "report_date", from, to },
        { field: "termination_date", from, to },
      ];
      const read: JsonObject[] = [];
      try {
        while (windows.length) {
          const w = windows.shift()!;
          let skip = 0;
          for (;;) {
            const res = await ctx.http.getText(searchUrl(kind, w, skip));
            if (res.status === 404 && /NOT_FOUND/.test(res.text)) break;
            if (res.status !== 200) throw new Error(`openFDA HTTP ${res.status}`);
            const doc = JSON.parse(res.text) as {
              meta?: { last_updated?: string; results?: { total?: number } };
              results?: JsonObject[];
            };
            if (!Array.isArray(doc.results)) throw new Error("Unexpected openFDA result shape");
            const total = Number(doc.meta?.results?.total ?? 0);
            if (total > PAGE && skip === 0 && w.from < w.to) {
              // split the window instead of paging an unordered result
              const mid = addDays(
                w.from,
                Math.floor((Date.parse(w.to) - Date.parse(w.from)) / 86400000 / 2),
              );
              windows.unshift({ ...w, to: mid }, { ...w, from: addDays(mid, 1) });
              break;
            }
            lastUpdated = doc.meta?.last_updated ?? lastUpdated;
            const cap: Capture = {
              url: res.record.url,
              capturedAt: res.record.retrieved_at,
              lastUpdated: doc.meta?.last_updated ?? "",
              bytes: res.record.bytes,
              sha256: res.record.sha256,
            };
            for (const rec of doc.results) {
              const n = String(rec["recall_number"] ?? "");
              if (!/^[A-Za-z0-9-]{1,40}$/.test(n))
                throw new Error("openFDA record without a usable recall_number");
              records.set(n, { rec, cap });
            }
            read.push({
              window: `${w.field} ${w.from}..${w.to}`,
              skip,
              results: doc.results.length,
              total,
            });
            skip += doc.results.length;
            if (skip >= total || !doc.results.length) break;
            if (skip >= 25000) throw new Error("openFDA skip limit reached in one window");
          }
        }
      } catch (error) {
        if (error instanceof BudgetExhausted || error instanceof RateLimited) {
          complete = false;
          stopped = error.message;
        } else throw error;
      }
      const rows = [...records.values()]
        .map(({ rec, cap }) => enforcementRow(kind, rec, cap))
        // newest first: report date, then recall number, both descending
        .sort(
          (a, b) =>
            -cmpTuple(
              [String(a.filters["report_date"] ?? ""), String(a.item["native_id"])],
              [String(b.filters["report_date"] ?? ""), String(b.item["native_id"])],
            ),
        );
      return {
        rows,
        fetched: records.size,
        held: [],
        cursorAfter: complete
          ? { read_through: to, last_updated: lastUpdated || null }
          : ctx.cursor,
        complete,
        notes: {
          window: { from, to },
          reads: read as Json,
          api_last_updated: lastUpdated || null,
          ...(stopped ? { stopped } : {}),
        },
      };
    },

    comparable: comparableEnforcement,
  };
}

export const openfdaDrugEnforcement = openfdaEnforcement("drug");
export const openfdaDeviceEnforcement = openfdaEnforcement("device");
export const openfdaFoodEnforcement = openfdaEnforcement("food");
