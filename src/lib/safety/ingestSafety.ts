/**
 * Scheduled refresh of safety/1 (database/contracts/safety-signals-v1.sql) from the API-backed sources, run by the edge
 * functions supabase/functions/ingest-openfda-events (sources safety_faers_series, safety_maude_series) and
 * supabase/functions/ingest-cfpb-complaints (source safety_cfpb_complaints).
 *
 * Every run is an ingest/1 run (public.ingest_open_run_v1 … ingest_finish_run_v1), writes only through
 * public.safety_ingest_apply_v1 (which counts the writes into ingest.runs), and refreshes the insights families reading
 * the run's dataset (public.ingest_refresh_insights_v1). Runs in Deno (edge runtime) and Node (vitest): relative imports
 * with .ts extensions and web APIs only. Keys travel only in the request (openFDA api_key) and are never recorded.
 *
 * openFDA: each run refreshes the latest `windowMonths` months of every stored monthly series of the planned subjects
 * (MDL groups, national totals, then ranked products), as count=<date> aggregations, and moves each series' window end
 * to the newest complete month. A cursor rotates through the subjects across runs within the request budget.
 * CFPB: complaints received in the last days for the products already held in the record table (the build's scope),
 * through the public complaint search API, upserted by complaint id.
 */
import { politeHttp, BudgetExhausted, RateLimited, SourceError } from "../ingest/http.ts";
import type { CorpusClient } from "../ingest/corpus.ts";
import type { JsonObject, RequestRecord } from "../ingest/types.ts";

export const OPENFDA = "https://api.fda.gov/";
export const CFPB_API = "https://www.consumerfinance.gov/data-research/consumer-complaints/search/api/v1/";

export type SafetySource = "safety_faers_series" | "safety_maude_series" | "safety_cfpb_complaints";

type StreamSpec = { endpoint: string; dateField: string; clauses: Record<string, string | null> };

/** The stored series a scheduled run may refresh, with the clause each adds to the subject's search. */
export const STREAMS: Record<"safety_faers_series" | "safety_maude_series", StreamSpec> = {
  safety_faers_series: {
    endpoint: "drug/event.json",
    dateField: "receivedate",
    clauses: {
      faers_reports: null,
      faers_serious: "serious:1",
      faers_death: "seriousnessdeath:1",
      faers_hospitalization: "seriousnesshospitalization:1",
      faers_life_threatening: "seriousnesslifethreatening:1",
      faers_disabling: "seriousnessdisabling:1",
      faers_congenital_anomaly: "seriousnesscongenitalanomali:1",
      faers_other_serious: "seriousnessother:1",
    },
  },
  safety_maude_series: {
    endpoint: "device/event.json",
    dateField: "date_received",
    clauses: {
      maude_reports: null,
      maude_death: 'event_type:"Death"',
      maude_injury: 'event_type:"Injury"',
      maude_malfunction: 'event_type:"Malfunction"',
    },
  },
};

// ------------------------------------------------------------------------------------------------ pure helpers
export function monthAdd(m: string, k: number): string {
  const idx = Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1 + k;
  return `${String(Math.floor(idx / 12)).padStart(4, "0")}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

export function monthEnd(m: string): string {
  const next = monthAdd(m, 1);
  const d = new Date(Date.UTC(Number(next.slice(0, 4)), Number(next.slice(5, 7)) - 1, 1) - 86_400_000);
  return d.toISOString().slice(0, 10);
}

/** openFDA count=<date> results → {YYYY-MM: summed count}; malformed days are ignored. */
export function dayCountsToMonths(results: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of Array.isArray(results) ? results : []) {
    const t = String((r as { time?: unknown }).time ?? "");
    const n = (r as { count?: unknown }).count;
    if (!/^(19|20)\d{6}$/.test(t) || typeof n !== "number" || !Number.isInteger(n) || n < 0) continue;
    const m = `${t.slice(0, 4)}-${t.slice(4, 6)}`;
    out[m] = (out[m] ?? 0) + n;
  }
  return out;
}

/** The newest calendar month the data fully cover: the last day's month when it is a month end, else the month before. */
export function lastCompleteMonth(results: unknown): string | null {
  let last = "";
  for (const r of Array.isArray(results) ? results : []) {
    const t = String((r as { time?: unknown }).time ?? "");
    if (/^(19|20)\d{6}$/.test(t) && t > last) last = t;
  }
  if (!last) return null;
  const m = `${last.slice(0, 4)}-${last.slice(4, 6)}`;
  return monthEnd(m).replace(/-/g, "") === last ? m : monthAdd(m, -1);
}

/** openFDA query string: '+' separates clauses and stays literal; spaces, '&' and '#' are encoded. */
export function openfdaUrl(endpoint: string, search: string, count: string): string {
  const s = search.replace(/%/g, "%25").replace(/ /g, "%20").replace(/&/g, "%26").replace(/#/g, "%23");
  return `${OPENFDA}${endpoint}?search=${s}&count=${count}`;
}

export function andClause(search: string, extra: string | null): string {
  return extra ? `(${search})+AND+${extra}` : search;
}

type PlanSeries = { series: string; coverage_from: string; coverage_to: string };
type PlanSubject = { id: string; search: string | null; series: PlanSeries[] };

/** One series_patch row for public.safety_ingest_apply_v1: the refreshed window and its months (omitted = 0). */
export function patchRow(
  subject: string,
  s: PlanSeries,
  months: Record<string, number>,
  windowFrom: string,
  through: string,
  queryUrl: string,
  retrievedAt: string,
): JsonObject | null {
  const from = windowFrom < s.coverage_from ? s.coverage_from : windowFrom;
  if (through < from) return null;
  const kept: Record<string, number> = {};
  for (const [m, v] of Object.entries(months)) if (m >= from && m <= through && v > 0) kept[m] = v;
  return {
    subject_id: subject,
    series: s.series,
    window_from: from,
    window_to: through,
    months: kept,
    query_url: queryUrl,
    retrieved_at: retrievedAt,
  };
}

/** One CFPB API hit → a cfpb_complaints row (the same fields as scripts/safety_v2/cfpb_build.py; no narrative). */
export function cfpbRow(hit: unknown): JsonObject | null {
  const src = (hit as { _source?: Record<string, unknown> })?._source;
  if (!src) return null;
  const id = String(src["complaint_id"] ?? "");
  const date = String(src["date_received"] ?? "").slice(0, 10);
  if (!/^[1-9]\d{0,14}$/.test(id) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const s = (k: string) => (typeof src[k] === "string" && src[k] !== "" ? (src[k] as string) : null);
  const timely = s("timely");
  return {
    complaint_id: Number(id),
    date_received: date,
    product: s("product") ?? "",
    sub_product: s("sub_product") ?? "",
    issue: s("issue") ?? "",
    sub_issue: s("sub_issue") ?? "",
    public_response: s("company_public_response"),
    company: s("company") ?? "",
    state: s("state"),
    zip: s("zip_code"),
    tags: s("tags"),
    submitted_via: s("submitted_via"),
    date_sent: (s("date_sent_to_company") ?? "").slice(0, 10) || null,
    company_response: s("company_response"),
    timely: timely === "Yes" ? true : timely === "No" ? false : null,
  };
}

// ------------------------------------------------------------------------------------------------ runs
export type RunOptions = {
  corpus: CorpusClient;
  env: (name: string) => string | undefined;
  trigger: "schedule" | "manual";
  now: Date;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: JsonObject) => void;
  maxRequests?: number;
  windowMonths?: number;
  minIntervalMs?: number;
};

export type RunSummary = {
  source: SafetySource;
  status: "ok" | "partial" | "failed" | "skipped";
  run?: string;
  fetched?: number;
  written?: number;
  error?: string;
  notes?: JsonObject;
};

type OpenRun = { run_id?: string; skipped?: string; cursor?: JsonObject | null };

async function finish(
  opts: RunOptions,
  run: string,
  status: "ok" | "partial" | "failed",
  fetched: number,
  cursor: JsonObject | null,
  error: string | null,
  requests: RequestRecord[],
  notes: JsonObject,
) {
  await opts.corpus.call("ingest_finish_run_v1", {
    p_run: run,
    p_status: status,
    p_fetched: fetched,
    p_held: 0,
    p_unchanged: 0,
    p_cursor_after: cursor,
    p_error: error,
    p_requests: requests.slice(-200),
    p_notes: notes,
  });
  if (status !== "failed") await opts.corpus.call("ingest_refresh_insights_v1", { p_run: run });
}

export async function runOpenfdaEvents(
  source: "safety_faers_series" | "safety_maude_series",
  opts: RunOptions,
): Promise<RunSummary> {
  const spec = STREAMS[source];
  const open = await opts.corpus.call<OpenRun>("ingest_open_run_v1", { p_source: source, p_trigger: opts.trigger });
  if (!open.run_id) return { source, status: "skipped", notes: { reason: open.skipped ?? "not opened" } };
  const run = open.run_id;
  const key = opts.env("DATA_GOV_API_KEY");
  const http = politeHttp({
    maxRequests: opts.maxRequests ?? 90,
    minIntervalMs: opts.minIntervalMs ?? 500,
    fetch: opts.fetch,
    sleep: opts.sleep,
  });
  const keyed = (url: string) => (key ? `${url}&api_key=${encodeURIComponent(key)}` : url);
  const cursor = (open.cursor ?? {}) as { index?: number; cycle?: number };
  let index = typeof cursor.index === "number" && cursor.index >= 0 ? cursor.index : 0;
  const cycle = typeof cursor.cycle === "number" ? cursor.cycle : 1;
  let written = 0;
  let status: "ok" | "partial" = "ok";
  let error: string | null = null;
  const pending: JsonObject[] = [];
  const flush = async () => {
    while (pending.length) {
      const batch = pending.splice(0, 200);
      const res = await opts.corpus.call<{ updated?: number; unchanged?: number }>("safety_ingest_apply_v1", {
        p_run: run,
        p_target: "series_patch",
        p_rows: batch,
        p_opts: {},
      });
      written += (res?.updated ?? 0) + (res?.unchanged ?? 0);
    }
  };
  try {
    const plan = await opts.corpus.call<{ subjects: PlanSubject[] }>("safety_ingest_plan_v1", { p_source: source });
    const subjects = (plan.subjects ?? []).filter((s) => typeof s.search === "string" && s.search);
    if (index >= subjects.length) index = 0;
    // the newest complete month of the whole endpoint (one request): the refreshed window ends there
    const nat = await http.getText(keyed(`${OPENFDA}${spec.endpoint}?count=${spec.dateField}`), {
      recordUrl: `${OPENFDA}${spec.endpoint}?count=${spec.dateField}`,
    });
    const through = lastCompleteMonth((JSON.parse(nat.text) as { results?: unknown }).results);
    if (!through) throw new SourceError("openFDA returned no dates", nat.status);
    const windowFrom = monthAdd(through, -((opts.windowMonths ?? 3) - 1));
    const a = `${windowFrom.replace("-", "")}01`;
    const b = monthEnd(through).replace(/-/g, "");
    for (; index < subjects.length; index++) {
      const subj = subjects[index]!;
      for (const s of subj.series) {
        if (!(s.series in spec.clauses)) continue;
        const search = andClause(andClause(subj.search!, spec.clauses[s.series] ?? null), `${spec.dateField}:[${a}+TO+${b}]`);
        const url = openfdaUrl(spec.endpoint, search, spec.dateField);
        const res = await http.getText(keyed(url), { recordUrl: url });
        if (res.status !== 200 && res.status !== 404) throw new SourceError(`openFDA answered ${res.status}`, res.status);
        const months = res.status === 404 ? {} : dayCountsToMonths((JSON.parse(res.text) as { results?: unknown }).results);
        const row = patchRow(subj.id, s, months, windowFrom, through, url, res.record.retrieved_at);
        if (row) pending.push(row);
      }
      if (pending.length >= 200) await flush();
    }
    await flush();
  } catch (e) {
    await flush().catch(() => undefined);
    if (e instanceof BudgetExhausted || e instanceof RateLimited) {
      status = "partial";
      error = e instanceof RateLimited ? e.message : null;
    } else {
      const message = e instanceof Error ? `${e.name}: ${e.message}` : "unknown error";
      await finish(opts, run, "failed", http.requests.length, null, message, http.requests, { index });
      return { source, status: "failed", run, error: message };
    }
  }
  const done = status === "ok";
  const cursorAfter = done ? { index: 0, cycle: cycle + 1 } : { index, cycle };
  const notes = { subjects_index: index, cycle, windowMonths: opts.windowMonths ?? 3, series_written: written };
  await finish(opts, run, status, http.requests.length, cursorAfter, error, http.requests, notes);
  return { source, status, run, fetched: http.requests.length, written, notes };
}

export async function runCfpbComplaints(opts: RunOptions): Promise<RunSummary> {
  const source = "safety_cfpb_complaints" as const;
  const open = await opts.corpus.call<OpenRun>("ingest_open_run_v1", { p_source: source, p_trigger: opts.trigger });
  if (!open.run_id) return { source, status: "skipped", notes: { reason: open.skipped ?? "not opened" } };
  const run = open.run_id;
  const http = politeHttp({ maxRequests: opts.maxRequests ?? 20, minIntervalMs: opts.minIntervalMs ?? 1000, fetch: opts.fetch, sleep: opts.sleep });
  let written = 0;
  let fetched = 0;
  let status: "ok" | "partial" = "ok";
  let error: string | null = null;
  const plan = await opts.corpus.call<{ latest_received: string | null; products: string[] }>("safety_ingest_plan_v1", { p_source: source });
  const products = (plan.products ?? []).filter((p) => typeof p === "string" && p);
  const today = opts.now.toISOString().slice(0, 10);
  const since = new Date(opts.now.getTime() - 7 * 86_400_000).toISOString().slice(0, 10);
  if (!products.length) {
    await finish(opts, run, "ok", 0, { since }, null, [], { reason: "no products in the record table yet" });
    return { source, status: "ok", run, fetched: 0, written: 0 };
  }
  try {
    for (let frm = 0; ; frm += 1000) {
      const q = new URLSearchParams({ date_received_min: since, date_received_max: today, size: "1000", frm: String(frm),
        sort: "created_date_desc", no_aggs: "true" });
      for (const p of products) q.append("product", p);
      const url = `${CFPB_API}?${q.toString()}`;
      const res = await http.getText(url);
      if (res.status !== 200) throw new SourceError(`CFPB answered ${res.status}`, res.status);
      const body = JSON.parse(res.text) as { hits?: { hits?: unknown[]; total?: { value?: number } } };
      const hits = body.hits?.hits ?? [];
      fetched += hits.length;
      const rows = hits.map(cfpbRow).filter((r): r is JsonObject => r !== null);
      for (let i = 0; i < rows.length; i += 1000) {
        const r = await opts.corpus.call<{ inserted?: number; updated?: number }>("safety_ingest_apply_v1", {
          p_run: run, p_target: "cfpb_complaints", p_rows: rows.slice(i, i + 1000), p_opts: {},
        });
        written += (r?.inserted ?? 0) + (r?.updated ?? 0);
      }
      if (hits.length < 1000 || frm + 1000 >= (body.hits?.total?.value ?? 0)) break;
    }
  } catch (e) {
    if (e instanceof BudgetExhausted || e instanceof RateLimited) {
      status = "partial";
      error = e instanceof RateLimited ? e.message : null;
    } else {
      const message = e instanceof Error ? `${e.name}: ${e.message}` : "unknown error";
      await finish(opts, run, "failed", fetched, null, message, http.requests, { since });
      return { source, status: "failed", run, error: message };
    }
  }
  await finish(opts, run, status, fetched, { since, through: today }, error, http.requests, { since, products: products.length, written });
  return { source, status, run, fetched, written };
}
