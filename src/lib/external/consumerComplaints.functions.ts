/**
 * CFPB Consumer Complaint Database analytics: national, state and company aggregates and the research-report
 * catalog (cfpb_complaints_national, cfpb_complaints_states, cfpb_complaints_companies, cfpb_research_reports).
 * Built by scripts/enrichment/cfpb. Stored JSON is validated here; malformed rows are dropped, never repaired.
 * Complaints are consumer submissions published by the CFPB: they are not findings of wrongdoing.
 */
import { createServerFn } from "@tanstack/react-start";
import { restGet } from "./rest.server";

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown) => (typeof v === "string" ? v : "");
const strOrNull = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
const obj = (v: unknown) =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const arr = (v: unknown) => (Array.isArray(v) ? (v as unknown[]) : []);

export type ConsumerYear = {
  year: number;
  complaints: number;
  /** false for a calendar year still in progress (the database starts 2011-12-01). */
  complete: boolean;
  yoyPct: number | null;
  creditReporting: number | null;
  creditReportingSharePct: number | null;
  timelyRate: number | null;
  reliefRate: number | null;
};
export type ConsumerProductShift = {
  product: string;
  complaints2024: number;
  complaints2025: number;
  share2024Pct: number;
  share2025Pct: number;
  shiftPp: number;
};
export type ConsumerState = {
  code: string;
  name: string;
  complaints: number;
  window: number | null;
  per100k2025: number | null;
  rateChangePct: number | null;
  timelyRate: number | null;
};
export type ConsumerRanked = { code: string; name: string; value: number; rank: number };
export type ConsumerCompany = {
  rank: number | null;
  company: string;
  complaints: number;
  windowChangePct: number | null;
  topProduct: string | null;
  timelyRate: number | null;
  reliefRate: number | null;
};
export type ConsumerReport = { date: string; title: string; category: string | null; url: string };
export type ConsumerComplaints = {
  from: string;
  to: string;
  complaints: number;
  companies: number;
  timelyRate: number | null;
  years: ConsumerYear[];
  ytd: {
    from: string;
    to: string;
    complaints: number;
    previousComplaints: number;
    changePct: number | null;
    note: string;
  } | null;
  productShift: { from: string; to: string; rows: ConsumerProductShift[] };
  states: ConsumerState[];
  perCapitaRanking: ConsumerRanked[];
  riseRanking: ConsumerRanked[];
  topCompanies: ConsumerCompany[];
  reports: ConsumerReport[];
  reportCount: number;
};

export function parseYears(raw: unknown): ConsumerYear[] {
  return arr(raw).flatMap((y) => {
    const r = obj(y);
    const year = Number(str(r?.["year"]));
    const complaints = num(r?.["complaints"]);
    if (!r || !Number.isInteger(year) || complaints == null) return [];
    return [
      {
        year,
        complaints,
        complete: r["complete"] === true,
        yoyPct: num(r["yoy_pct"]),
        creditReporting: num(r["credit_reporting_complaints"]),
        creditReportingSharePct: num(r["credit_reporting_share_pct"]),
        timelyRate: num(r["timely_rate"]),
        reliefRate: num(r["relief_rate"]),
      },
    ];
  });
}

function parseRanked(raw: unknown): ConsumerRanked[] {
  return arr(raw).flatMap((x) => {
    const r = obj(x);
    const value = num(r?.["value"]);
    const rank = num(r?.["rank"]);
    return r && /^[A-Z]{2}$/.test(str(r["code"])) && value != null && rank != null
      ? [{ code: str(r["code"]), name: str(r["name"]) || str(r["code"]), value, rank }]
      : [];
  });
}

export function parseConsumerComplaints(input: {
  national: unknown;
  states: { code: unknown; cells: unknown }[];
  stateRankings: unknown;
  companies: { cells: unknown }[];
  reports: { d: unknown; t: unknown; cat: unknown; u: unknown }[];
  reportCount: number;
}): ConsumerComplaints | null {
  const n = obj(input.national);
  const period = obj(n?.["period"]);
  const complaints = num(n?.["complaints"]);
  if (!n || !period || complaints == null) return null;
  const years = parseYears(n["years"]).sort((a, b) => a.year - b.year);
  if (!years.length) return null;
  const analytics = obj(n["analytics"]);
  const ytd = obj(analytics?.["ytd"]);
  const cur = obj(ytd?.["current"]);
  const prev = obj(ytd?.["previous"]);
  const shift = obj(analytics?.["product_share_shift"]);
  const rankings = obj(input.stateRankings);
  return {
    from: str(period["from"]),
    to: str(period["to"]),
    complaints,
    companies: num(n["companies"]) ?? 0,
    timelyRate: num(obj(n["timely"])?.["rate"]),
    years,
    ytd:
      cur && prev && num(cur["complaints"]) != null && num(prev["complaints"]) != null
        ? {
            from: str(cur["from"]),
            to: str(cur["to"]),
            complaints: num(cur["complaints"])!,
            previousComplaints: num(prev["complaints"])!,
            changePct: num(ytd?.["change_pct"]),
            note: str(ytd?.["note"]),
          }
        : null,
    productShift: {
      from: str(shift?.["from"]),
      to: str(shift?.["to"]),
      rows: arr(shift?.["rows"]).flatMap((x) => {
        const r = obj(x);
        const c24 = num(r?.["complaints_2024"]);
        const c25 = num(r?.["complaints_2025"]);
        const s24 = num(r?.["share_2024_pct"]);
        const s25 = num(r?.["share_2025_pct"]);
        const pp = num(r?.["shift_pp"]);
        return r &&
          str(r["product"]) &&
          c24 != null &&
          c25 != null &&
          s24 != null &&
          s25 != null &&
          pp != null
          ? [
              {
                product: str(r["product"]),
                complaints2024: c24,
                complaints2025: c25,
                share2024Pct: s24,
                share2025Pct: s25,
                shiftPp: pp,
              },
            ]
          : [];
      }),
    },
    states: input.states.flatMap((s) => {
      const c = obj(s.cells);
      const code = str(s.code);
      const total = num(c?.["complaints"]);
      // Only the 50 states and DC have a /places page and a map shape; territories and codes stay out of this view.
      return c &&
        /^[A-Z]{2}$/.test(code) &&
        (c["kind"] === "state" || c["kind"] === "district") &&
        total != null
        ? [
            {
              code,
              name: str(c["state"]) || code,
              complaints: total,
              window: num(c["window"]),
              per100k2025: num(c["per_100k_2025"]),
              rateChangePct: num(c["rate_change_pct"]),
              timelyRate: num(c["timely_rate"]),
            },
          ]
        : [];
    }),
    perCapitaRanking: parseRanked(rankings?.["per_100k_2025"]),
    riseRanking: parseRanked(rankings?.["rate_change_pct"]),
    topCompanies: input.companies.flatMap((x) => {
      const c = obj(x.cells);
      const total = num(c?.["complaints"]);
      return c && str(c["company"]) && total != null
        ? [
            {
              rank: num(c["rank"]),
              company: str(c["company"]),
              complaints: total,
              windowChangePct: num(c["window_change"]),
              topProduct: strOrNull(c["top_product"]),
              timelyRate: num(c["timely_rate"]),
              reliefRate: num(c["relief_rate"]),
            },
          ]
        : [];
    }),
    reports: input.reports
      .flatMap((r) => {
        const url = str(r.u);
        return /^\d{4}-\d{2}-\d{2}$/.test(str(r.d)) &&
          str(r.t) &&
          /^https:\/\/www\.consumerfinance\.gov\//.test(url)
          ? [{ date: str(r.d), title: str(r.t), category: strOrNull(r.cat), url }]
          : [];
      })
      .sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title)),
    reportCount: input.reportCount,
  };
}

const TTL = 10 * 60 * 1000;
let cache: { at: number; value: ConsumerComplaints } | null = null;

export const getConsumerComplaints = createServerFn({ method: "GET" }).handler(
  async (): Promise<ConsumerComplaints | null> => {
    if (cache && Date.now() - cache.at < TTL) return cache.value;
    const [national, states, ranking, companies, reports] = await Promise.all([
      restGet<{ n: unknown }[]>(
        "corpus_records?select=n:item->national&dataset=eq.cfpb_complaints_national&id=eq.cfpb-national:all&limit=1",
      ),
      restGet<{ code: unknown; cells: unknown }[]>(
        "corpus_records?select=code:state,cells:item->cells&dataset=eq.cfpb_complaints_states&id=like.cfpb-state:*&order=ordinal.asc&limit=100",
      ),
      restGet<{ r: unknown }[]>(
        "corpus_records?select=r:item->rankings&dataset=eq.cfpb_complaints_states&id=eq.cfpb-states:analytics&limit=1",
      ),
      restGet<{ cells: unknown }[]>(
        "corpus_records?select=cells:item->cells&dataset=eq.cfpb_complaints_companies&id=like.cfpb-company:*&order=ordinal.asc&limit=25",
      ),
      restGet<{ d: unknown; t: unknown; cat: unknown; u: unknown }[]>(
        "corpus_records?select=d:item->cells->>date,t:item->cells->>title,cat:item->cells->>category,u:source_url&dataset=eq.cfpb_research_reports&limit=1000",
        { count: true },
      ),
    ]);
    const value = parseConsumerComplaints({
      national: national.rows[0]?.n,
      states: states.rows,
      stateRankings: ranking.rows[0]?.r,
      companies: companies.rows,
      reports: reports.rows,
      reportCount: reports.total ?? reports.rows.length,
    });
    if (value) cache = { at: Date.now(), value };
    return value;
  },
);
