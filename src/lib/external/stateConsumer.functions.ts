/**
 * Consumer-protection figures for one state's page, read from the published FTC datasets:
 * ftc_sentinel_states (Consumer Sentinel Data Books 2017-2024, key `<USPS>-<year>`), ftc_dnc_states (Do Not Call Data
 * Books FY2021-FY2025, key `<USPS>-FY<year>`), ftc_refunds (state rows `<year>-state-<USPS>`, refunds mailed 2022-2024)
 * and ftc_sentinel_national (`US-<year>`, the national comparison and the FTC's definition notices).
 * Every figure is shown as the FTC printed it (the record's own cell text); per-100K values are the FTC's, not
 * recomputed, and each edition's Census denominator year travels with the row. A blank source cell stays `null`
 * (shown as "Not recorded"); a row that does not parse is dropped, never repaired. Stored JSON is validated here.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { restGet } from "./rest.server";
import { parseStateCallsMonths, type StateCallsMonth } from "./ftcData";

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const strOrNull = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
const obj = (v: unknown) =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const arr = (v: unknown) => (Array.isArray(v) ? (v as unknown[]) : []);
const strings = (v: unknown) => arr(v).flatMap((s) => (strOrNull(s) ? [s as string] : []));
const NOT_RECORDED_TEXT = "Not recorded";

/** A figure exactly as the FTC printed it (`text`), with its numeric value when the record also stores one. */
export type Printed = { text: string; value: number | null };

export type TopCategory = { rank: number; category: string; sharePct: number };
export type IdentityTheftType = { type: string; sharePct: number };

export type ConsumerYear = {
  /** Data Book edition year (calendar year the reports cover). */
  year: number;
  recordId: string;
  sourceUrl: string | null;
  /** Year of the Census estimate the FTC used as the per-100K denominator in this edition. */
  populationYear: number | null;
  reports: Printed | null;
  per100k: Printed | null;
  /** The FTC's rank among the 50 states; `value` is null and `text` is "Unranked" for DC and PR. */
  rank: Printed | null;
  identityTheftReports: Printed | null;
  identityTheftPer100k: Printed | null;
  identityTheftRank: Printed | null;
  fraudReports: Printed | null;
  /** Percent of fraud reports that reported a loss, as an integer percent as printed. */
  pctReportingLoss: number | null;
  totalLoss: Printed | null;
  medianLoss: Printed | null;
  /** Year-over-year figures derived by the build from two editions' printed values; null for 2017 or a gap. */
  change: {
    reportsPct: number | null;
    per100kPct: number | null;
    rankChange: number | null;
    identityTheftRankChange: number | null;
    totalLossPct: number | null;
    medianLossPct: number | null;
  };
  /** Null where the Data Book's table was withheld (damaged text); see `withheld` for the reason on the record. */
  categories: TopCategory[] | null;
  identityTheftTypes: IdentityTheftType[] | null;
  withheld: string[];
  caveats: string[];
};

export type DncYear = {
  /** Federal fiscal year, labelled by the year it ends. */
  fy: number;
  recordId: string;
  sourceUrl: string | null;
  populationYear: number | null;
  complaints: Printed | null;
  complaintsPer100k: Printed | null;
  /** Null for DC and PR: the FTC prints no rank for them. */
  complaintsRank: Printed | null;
  registrations: Printed | null;
  registrationsPer100k: Printed | null;
  registrationsRank: Printed | null;
  complaintsYoyPct: number | null;
  complaintsRankChange: number | null;
  registrationsYoyPct: number | null;
};

export type RefundYear = {
  year: number;
  recordId: string;
  sourceUrl: string | null;
  /** Dollars the FTC mailed to consumers in the state that calendar year, as printed. */
  mailed: Printed | null;
  /** State dollars mailed as a share of the printed state table, percent. */
  sharePct: number | null;
  yoyPct: number | null;
};

export type NationalYear = {
  year: number;
  recordId: string;
  medianLoss: Printed | null;
  pctReportingLoss: number | null;
  totalLoss: Printed | null;
  fraudReports: Printed | null;
  /** The FTC's category-definition notices for this edition against the prior one (2020, 2023, 2024). */
  notices: string[];
};

export type Edition = { name: string; url: string | null };

export type ConsumerSection = "reports" | "dnc" | "calls" | "refunds" | "national" | "sources";

export type StateConsumerData = {
  usps: string;
  years: ConsumerYear[];
  dnc: DncYear[];
  /** Do Not Call reports counted by month for this state (ftc_dnc_reported_calls); empty when none are published. */
  calls: StateCallsMonth[];
  refunds: RefundYear[];
  national: NationalYear[];
  /** Edition metadata from each dataset summary, keyed by Data Book year / fiscal year / report year. */
  editions: {
    sentinel: Record<number, Edition>;
    dnc: Record<number, Edition>;
    refunds: Record<number, Edition>;
  };
  /** The dataset summary's terms line (public domain, no endorsement implied); null when it could not be read. */
  terms: string | null;
  /** Sections whose read failed; the rest of the panel still renders. */
  unavailable: ConsumerSection[];
};

const count = (n: number) => n.toLocaleString("en-US");
const usd = (n: number) => `$${n.toLocaleString("en-US")}`;

/**
 * The figure as printed: the record's cell text when it has one, otherwise the stored number formatted.
 * A cell that says "Not recorded" with no stored number is unknown (null), never a zero.
 */
export function printed(
  cell: unknown,
  metric: unknown,
  format: (n: number) => string = count,
): Printed | null {
  const value = num(metric);
  const text = strOrNull(cell);
  if (text && text !== NOT_RECORDED_TEXT) return { text, value };
  if (value != null) return { text: format(value), value };
  return null;
}

const yearOf = (v: unknown) => {
  const n = typeof v === "string" && /^\d{4}$/.test(v) ? Number(v) : num(v);
  return n != null && Number.isInteger(n) && n >= 1900 && n <= 2100 ? n : null;
};

function parseCategories(raw: unknown): TopCategory[] | null {
  const items = arr(raw).flatMap((entry) => {
    const r = obj(entry);
    const category = strOrNull(r?.["category"]);
    const share = num(r?.["share_pct"]);
    return category && share != null && share >= 0 && share <= 100
      ? [{ category, sharePct: share }]
      : [];
  });
  return items.length ? items.map((c, i) => ({ rank: i + 1, ...c })) : null;
}

function parseIdentityTypes(raw: unknown): IdentityTheftType[] | null {
  const items = arr(raw).flatMap((entry) => {
    const r = obj(entry);
    const type = strOrNull(r?.["type"]);
    const share = num(r?.["share_pct"]);
    return type && share != null && share >= 0 && share <= 100 ? [{ type, sharePct: share }] : [];
  });
  return items.length ? items : null;
}

export function parseConsumerYears(rows: unknown[], usps: string): ConsumerYear[] {
  const out = new Map<number, ConsumerYear>();
  for (const raw of rows) {
    const row = obj(raw);
    const id = strOrNull(row?.["id"]);
    const m = /^([A-Z]{2})-(\d{4})$/.exec(id ?? "");
    const metrics = obj(row?.["m"]);
    if (!row || !id || !m || m[1] !== usps || !metrics) continue;
    const year = yearOf(m[2]);
    const reports = num(metrics["fraud_other_reports"]);
    if (year == null || reports == null || out.has(year)) continue;
    const cells = obj(row["cells"]);
    const a = obj(row["a"]);
    out.set(year, {
      year,
      recordId: id,
      sourceUrl: strOrNull(row["source_url"]),
      populationYear: yearOf(row["pop"]),
      reports: printed(cells?.["fraud_other_reports"], reports),
      per100k: printed(cells?.["fraud_other_per100k"], metrics["fraud_other_per100k"]),
      rank: printed(cells?.["fraud_other_rank"], metrics["fraud_other_rank"]),
      identityTheftReports: printed(
        cells?.["identity_theft_reports"],
        metrics["identity_theft_reports"],
      ),
      identityTheftPer100k: printed(undefined, metrics["identity_theft_per100k"]),
      identityTheftRank: printed(cells?.["identity_theft_rank"], metrics["identity_theft_rank"]),
      fraudReports: printed(cells?.["fraud_reports"], metrics["fraud_reports"]),
      pctReportingLoss: num(metrics["pct_reporting_loss"]),
      totalLoss: printed(cells?.["total_loss"], metrics["total_loss_usd"], usd),
      medianLoss: printed(cells?.["median_loss"], metrics["median_loss_usd"], usd),
      change: {
        reportsPct: num(a?.["fraud_other_reports_yoy_pct"]),
        per100kPct: num(a?.["fraud_other_per100k_yoy_pct"]),
        rankChange: num(a?.["fraud_other_rank_change"]),
        identityTheftRankChange: num(a?.["identity_theft_rank_change"]),
        totalLossPct: num(a?.["total_loss_yoy_pct"]),
        medianLossPct: num(a?.["median_loss_yoy_pct"]),
      },
      categories: parseCategories(row["tc"]),
      identityTheftTypes: parseIdentityTypes(row["it"]),
      withheld: strings(row["wh"]),
      caveats: strings(row["cv"]),
    });
  }
  return [...out.values()].sort((a, b) => a.year - b.year);
}

export function parseDncYears(rows: unknown[], usps: string): DncYear[] {
  const out = new Map<number, DncYear>();
  for (const raw of rows) {
    const row = obj(raw);
    const id = strOrNull(row?.["id"]);
    const m = /^([A-Z]{2})-FY(\d{4})$/.exec(id ?? "");
    const metrics = obj(row?.["m"]);
    if (!row || !id || !m || m[1] !== usps || !metrics) continue;
    const fy = yearOf(m[2]);
    const complaints = num(metrics["complaints"]);
    if (fy == null || complaints == null || out.has(fy)) continue;
    const cells = obj(row["cells"]);
    const a = obj(row["a"]);
    out.set(fy, {
      fy,
      recordId: id,
      sourceUrl: strOrNull(row["source_url"]),
      populationYear: yearOf(row["pop"]),
      complaints: printed(cells?.["complaints"], complaints),
      complaintsPer100k: printed(cells?.["complaints_per100k"], metrics["complaints_per100k"]),
      complaintsRank: printed(cells?.["complaints_rank"], metrics["complaints_rank"]),
      registrations: printed(cells?.["registrations"], metrics["registrations"]),
      registrationsPer100k: printed(
        cells?.["registrations_per100k"],
        metrics["registrations_per100k"],
      ),
      registrationsRank: printed(undefined, metrics["registrations_rank"]),
      complaintsYoyPct: num(a?.["complaints_yoy_pct"]),
      complaintsRankChange: num(a?.["complaints_rank_change"]),
      registrationsYoyPct: num(a?.["registrations_yoy_pct"]),
    });
  }
  return [...out.values()].sort((a, b) => a.fy - b.fy);
}

export function parseRefundYears(rows: unknown[], usps: string): RefundYear[] {
  const out = new Map<number, RefundYear>();
  for (const raw of rows) {
    const row = obj(raw);
    const id = strOrNull(row?.["id"]);
    const m = /^(\d{4})-state-([A-Z]{2})$/.exec(id ?? "");
    const values = obj(row?.["v"]);
    if (!row || !id || !m || m[2] !== usps || !values) continue;
    const year = yearOf(m[1]);
    const mailed = num(values["mailed_usd"]);
    if (year == null || mailed == null || out.has(year)) continue;
    const a = obj(row["a"]);
    out.set(year, {
      year,
      recordId: id,
      sourceUrl: strOrNull(row["source_url"]),
      mailed: printed(obj(row["cells"])?.["amount"], mailed, usd),
      sharePct: num(a?.["share_of_listed_states_pct"]),
      yoyPct: num(a?.["yoy_pct"]),
    });
  }
  return [...out.values()].sort((a, b) => a.year - b.year);
}

export function parseNationalYears(rows: unknown[]): NationalYear[] {
  const out = new Map<number, NationalYear>();
  for (const raw of rows) {
    const row = obj(raw);
    const id = strOrNull(row?.["id"]);
    const m = /^US-(\d{4})$/.exec(id ?? "");
    const summary = obj(row?.["fs"]);
    if (!row || !id || !m || !summary) continue;
    const year = yearOf(m[1]);
    if (year == null || out.has(year)) continue;
    const cells = obj(row["cells"]);
    out.set(year, {
      year,
      recordId: id,
      medianLoss: printed(cells?.["median_loss"], summary["median_loss_usd"], usd),
      pctReportingLoss: num(summary["pct_reporting_loss"]),
      totalLoss: printed(cells?.["total_loss"], summary["total_loss_usd"], usd),
      fraudReports: printed(cells?.["fraud_reports"], summary["fraud_reports"]),
      notices: strings(row["n"]),
    });
  }
  return [...out.values()].sort((a, b) => a.year - b.year);
}

/** Edition names and links from the datasets' summaries; hashes and capture details are not carried. */
export function parseConsumerSummaries(rows: unknown[]): {
  terms: string | null;
  editions: StateConsumerData["editions"];
} {
  const editions: StateConsumerData["editions"] = { sentinel: {}, dnc: {}, refunds: {} };
  let terms: string | null = null;
  for (const raw of rows) {
    const row = obj(raw);
    const id = strOrNull(row?.["id"]);
    const sources = obj(row?.["src"]);
    if (!row || !id) continue;
    terms ??= strOrNull(row["terms"]);
    for (const [key, value] of Object.entries(sources ?? {})) {
      const s = obj(value);
      const name = strOrNull(s?.["name"]);
      if (!s || !name) continue;
      const edition = { name, url: strOrNull(s["url"]) };
      if (id === "ftc_sentinel_states" && /^\d{4}$/.test(key))
        editions.sentinel[Number(key)] = edition;
      else if (id === "ftc_dnc_states" && /^FY\d{4}$/.test(key))
        editions.dnc[Number(key.slice(2))] = edition;
      else if (id === "ftc_refunds" && /^report_\d{4}$/.test(key))
        editions.refunds[Number(key.slice(7))] = edition;
    }
  }
  return { terms, editions };
}

export function buildStateConsumerData(
  usps: string,
  input: {
    sentinel: unknown[];
    dnc: unknown[];
    calls?: unknown[];
    refunds: unknown[];
    national: unknown[];
    summaries: unknown[];
    unavailable?: ConsumerSection[];
  },
): StateConsumerData {
  const { terms, editions } = parseConsumerSummaries(input.summaries);
  return {
    usps,
    years: parseConsumerYears(input.sentinel, usps),
    dnc: parseDncYears(input.dnc, usps),
    calls: parseStateCallsMonths(input.calls ?? [], usps),
    refunds: parseRefundYears(input.refunds, usps),
    national: parseNationalYears(input.national),
    editions,
    terms,
    unavailable: input.unavailable ?? [],
  };
}

const TTL = 10 * 60 * 1000;
const cache = new Map<string, { at: number; value: StateConsumerData }>();

export const getStateConsumerData = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ usps: z.string().regex(/^[A-Z]{2}$/) }).parse(d))
  .handler(async ({ data }): Promise<StateConsumerData> => {
    const u = data.usps;
    const hit = cache.get(u);
    if (hit && Date.now() - hit.at < TTL) return hit.value;
    const read = (path: string) => restGet<unknown[]>(path).then((r) => r.rows);
    const state = `state=eq.${u}`;
    const [sentinel, dnc, calls, refunds, national, summaries] = await Promise.allSettled([
      read(
        `corpus_records?select=id,source_url,cells:item->cells,m:item->metrics,a:item->analytics,tc:item->top_categories,it:item->identity_theft_types,pop:item->population_basis_year,cv:item->caveats,wh:item->provenance->withheld&dataset=eq.ftc_sentinel_states&${state}&order=id.asc&limit=20`,
      ),
      read(
        `corpus_records?select=id,source_url,cells:item->cells,m:item->metrics,a:item->analytics,pop:item->population_basis_year&dataset=eq.ftc_dnc_states&${state}&order=id.asc&limit=20`,
      ),
      read(
        `corpus_records?select=id,source_url,complete:item->complete,first:item->>first_day,last:item->>last_day,m:item->metrics,a:item->analytics,subj:item->subjects&dataset=eq.ftc_dnc_reported_calls&${state}&id=like.${u}-2*&order=id.asc&limit=100`,
      ),
      read(
        `corpus_records?select=id,source_url,cells:item->cells,v:item->values,a:item->analytics&dataset=eq.ftc_refunds&${state}&id=like.*-state-${u}&order=id.asc&limit=20`,
      ),
      read(
        "corpus_records?select=id,cells:item->cells,fs:item->fraud_summary,n:item->analytics->definition_notices_vs_prior_edition&dataset=eq.ftc_sentinel_national&id=like.US-2*&order=id.asc&limit=20",
      ),
      read(
        "corpus_datasets?select=id,terms:metadata->summary->terms,src:metadata->summary->sources&id=in.(ftc_sentinel_states,ftc_dnc_states,ftc_refunds)",
      ),
    ]);
    const settled = { reports: sentinel, dnc, calls, refunds, national, sources: summaries };
    const unavailable = (Object.keys(settled) as ConsumerSection[]).filter(
      (k) => settled[k].status === "rejected",
    );
    // The three state readings are the panel's content; with none of them the panel shows its error state.
    if (
      sentinel.status === "rejected" &&
      dnc.status === "rejected" &&
      refunds.status === "rejected"
    )
      throw new Error("FTC consumer data could not be read.");
    const rows = (r: PromiseSettledResult<unknown[]>) => (r.status === "fulfilled" ? r.value : []);
    const value = buildStateConsumerData(u, {
      sentinel: rows(sentinel),
      dnc: rows(dnc),
      calls: rows(calls),
      refunds: rows(refunds),
      national: rows(national),
      summaries: rows(summaries),
      unavailable,
    });
    if (!unavailable.length) cache.set(u, { at: Date.now(), value });
    return value;
  });
