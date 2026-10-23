/**
 * Read-only server functions for the oversight datasets (built by scripts/enrichment/oversight):
 *   oversight_reports        public reports of the federal Offices of Inspector General (Oversight.gov listing)
 *   oversight_trends         yearly counts per OIG, computed from oversight_reports
 *   doj_oig_reports          every report on the DOJ OIG's own reports page (components, PDF, money fields)
 *   osc_public_files         Office of Special Counsel whistleblower disclosure public files
 *   osc_publications         OSC reports, Hatch Act advisory opinions, testimonies and press releases
 *   doj_cep_resolutions      Criminal Division corporate enforcement (CEP) voluntary self-disclosure resolutions
 *   doj_document_index       DOJ budget/performance, No FEAR Act EEO data and Library research-guide links
 * Stored JSON is validated here; malformed rows are dropped, never repaired. Only https source links and in-app links
 * of known shapes reach the client. Figures are the publisher's, passed through as stored.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { ilikeTerm, restGet } from "./rest.server";

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown, max = 2000) =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
const obj = (v: unknown) =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const arr = (v: unknown) => (Array.isArray(v) ? (v as unknown[]) : []);
const strs = (v: unknown, max = 200) => arr(v).flatMap((x) => (str(x, max) ? [str(x, max)!] : []));
export const httpsUrl = (v: unknown) => {
  const s = str(v, 2000);
  return s && /^https:\/\/[^\s"<>]+$/.test(s) ? s : null;
};
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const date = (v: unknown) => {
  const s = str(v, 10);
  return s && ISO_DATE.test(s) ? s : null;
};
const RECORD_ID = /^[A-Za-z0-9:._-]{1,200}$/;
const AGENCY_ID = /^\d{1,6}$/;
const CIK = /^\d{10}$/;
const enc = encodeURIComponent;

const TTL = 10 * 60 * 1000;
const cache = new Map<string, { at: number; value: unknown }>();
async function memo<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.value as T;
  const value = await load();
  if (cache.size > 300) cache.clear();
  cache.set(key, { at: Date.now(), value });
  return value;
}

/** An in-app link of a known shape, or null. */
export function appLink(v: unknown): string | null {
  const s = str(v, 300);
  if (!s) return null;
  if (/^\/agencies\/\d{1,6}$/.test(s)) return s;
  if (/^\/companies\/\d{10}$/.test(s)) return s;
  if (/^\/records\/[a-z0-9_]{1,80}\/[A-Za-z0-9:._-]{1,200}$/.test(s)) return s;
  return null;
}

const containsFilter = (f: Record<string, string[]>) => `&filters=cs.${enc(JSON.stringify(f))}`;

export function searchTokens(q: string): string[] {
  return q
    .replace(/[*,()%]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2)
    .slice(0, 6);
}
const textFilters = (q: string) =>
  searchTokens(q)
    .map((t) => `&text=ilike.${ilikeTerm(t)}`)
    .join("");

// ------------------------------------------------------------------------------------------------ OIG reports

export type OversightReport = {
  id: string;
  title: string;
  date: string | null;
  year: number | null;
  oig: string | null;
  oigSlug: string | null;
  agencyReviewed: string | null;
  type: string | null;
  location: string | null;
  reportNumber: string | null;
  recommendations: number | null;
  description: string | null;
  descriptionClipped: boolean;
  url: string;
  oigAgencyId: string | null;
  dojOigId: string | null;
};

export function parseOversightReport(row: {
  id?: unknown;
  title?: unknown;
  source_url?: unknown;
  r?: unknown;
}): OversightReport | null {
  const id = str(row.id, 200);
  const title = str(row.title, 600);
  const r = obj(row.r);
  const url = httpsUrl(r?.["url"]) ?? httpsUrl(row.source_url);
  if (!id || !RECORD_ID.test(id) || !title || !r || !url) return null;
  const agencyId = str(r["oig_agency_id"], 8);
  const dojId = str(r["doj_oig_id"], 200);
  return {
    id,
    title,
    date: date(r["date"]),
    year: num(r["year"]),
    oig: str(r["oig"], 200),
    oigSlug: str(r["oig_slug"], 200),
    agencyReviewed: str(r["agency_reviewed"], 300),
    type: str(r["type"], 100),
    location: str(r["location"], 200),
    reportNumber: str(r["report_number"], 120),
    recommendations: num(r["recommendations"]),
    description: str(r["description"], 1400),
    descriptionClipped: r["description_clipped"] === true,
    url,
    oigAgencyId: agencyId && AGENCY_ID.test(agencyId) ? agencyId : null,
    dojOigId: dojId && RECORD_ID.test(dojId) ? dojId : null,
  };
}

export type TrendYear = {
  year: number;
  reports: number;
  types: Record<string, number>;
  recs: number;
  recsReports: number;
};
export type MoneyYear = {
  year: number;
  reports: number;
  questionedReports: number;
  questionedCosts: number;
  betterUseReports: number;
  fundsBetterUse: number;
};
export type TrendTotals = {
  reports: number;
  dated: number;
  undated: number;
  firstDate: string | null;
  lastDate: string | null;
  recs: number;
  recsReports: number;
  types: Record<string, number>;
};
export type OversightTrend = {
  scope: "national" | "oig";
  name: string;
  oigSlug: string | null;
  agencyId: string | null;
  agencyTitle: string | null;
  asOf: string | null;
  totals: TrendTotals;
  years: TrendYear[];
  money: {
    source: string;
    sourceUrl: string | null;
    years: MoneyYear[];
    excludes: string[];
    note: string | null;
  } | null;
  oigs: { name: string; slug: string | null; agencyId: string | null; reports: number }[];
};

function counts(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, n] of Object.entries(obj(v) ?? {})) {
    const c = num(n);
    if (c != null && c >= 0 && k.length <= 120) out[k] = c;
  }
  return out;
}

export function parseTrend(v: unknown): OversightTrend | null {
  const t = obj(v);
  const scope = t?.["scope"];
  const name = str(t?.["name"], 300);
  const totals = obj(t?.["totals"]);
  if (!t || (scope !== "national" && scope !== "oig") || !name || !totals) return null;
  const reports = num(totals["reports"]);
  if (reports == null) return null;
  const years = arr(t["years"]).flatMap((y) => {
    const o = obj(y);
    const year = num(o?.["year"]);
    const n = num(o?.["reports"]);
    if (!o || year == null || n == null) return [];
    return [
      {
        year,
        reports: n,
        types: counts(o["types"]),
        recs: num(o["recs"]) ?? 0,
        recsReports: num(o["recs_reports"]) ?? 0,
      },
    ];
  });
  const m = obj(t["money"]);
  const money = m
    ? {
        source: str(m["source"], 300) ?? "Not recorded",
        sourceUrl: httpsUrl(m["source_url"]),
        excludes: strs(m["excludes"], 80),
        note: str(m["note"], 500),
        years: arr(m["years"]).flatMap((y) => {
          const o = obj(y);
          const year = num(o?.["year"]);
          if (!o || year == null) return [];
          return [
            {
              year,
              reports: num(o["reports"]) ?? 0,
              questionedReports: num(o["questioned_reports"]) ?? 0,
              questionedCosts: num(o["questioned_costs"]) ?? 0,
              betterUseReports: num(o["better_use_reports"]) ?? 0,
              fundsBetterUse: num(o["funds_better_use"]) ?? 0,
            },
          ];
        }),
      }
    : null;
  const agencyId = str(t["agency_id"], 8);
  return {
    scope,
    name,
    oigSlug: str(t["oig_slug"], 200),
    agencyId: agencyId && AGENCY_ID.test(agencyId) ? agencyId : null,
    agencyTitle: str(t["agency_title"], 200),
    asOf: date(t["as_of"]),
    totals: {
      reports,
      dated: num(totals["dated"]) ?? 0,
      undated: num(totals["undated"]) ?? 0,
      firstDate: date(totals["first_date"]),
      lastDate: date(totals["last_date"]),
      recs: num(totals["recs"]) ?? 0,
      recsReports: num(totals["recs_reports"]) ?? 0,
      types: counts(totals["types"]),
    },
    years: years.sort((a, b) => a.year - b.year),
    money,
    oigs: arr(t["oigs"]).flatMap((o) => {
      const x = obj(o);
      const nm = str(x?.["name"], 300);
      const n = num(x?.["reports"]);
      if (!x || !nm || n == null) return [];
      const a = str(x["agency_id"], 8);
      return [
        {
          name: nm,
          slug: str(x["slug"], 200),
          agencyId: a && AGENCY_ID.test(a) ? a : null,
          reports: n,
        },
      ];
    }),
  };
}

// ------------------------------------------------------------------------------------------------ dataset facets

export type FacetOption = { value: string; label: string };
export type DatasetMeta = {
  id: string;
  records: number | null;
  sourcePage: string | null;
  source: string | null;
  coverage: string | null;
  terms: string | null;
  fields: string | null;
  asOf: string | null;
  filters: Record<string, FacetOption[]>;
};

export function parseDatasetMeta(row: {
  id?: unknown;
  m?: unknown;
  n?: unknown;
}): DatasetMeta | null {
  const id = str(row.id, 80);
  const m = obj(row.m);
  if (!id || !m) return null;
  const listing = obj(m["listing"]);
  const summary = obj(m["summary"]);
  const filters: Record<string, FacetOption[]> = {};
  for (const f of arr(listing?.["filters"])) {
    const o = obj(f);
    const name = str(o?.["name"], 60);
    if (!o || !name || o["type"] !== "select") continue;
    filters[name] = arr(o["options"]).flatMap((op) => {
      const x = obj(op);
      const value = str(x?.["value"], 200);
      const label = str(x?.["label"], 200);
      return value && label ? [{ value, label }] : [];
    });
  }
  return {
    id,
    records: num(listing?.["total"]) ?? num(row.n),
    sourcePage: httpsUrl(summary?.["source_page"]),
    source: str(summary?.["source"], 500),
    coverage: str(summary?.["coverage"], 500),
    terms: str(summary?.["terms"], 600),
    fields: str(summary?.["fields"], 800),
    asOf: date(summary?.["as_of"]),
    filters,
  };
}

const DATASETS = [
  "oversight_reports",
  "oversight_trends",
  "doj_oig_reports",
  "osc_public_files",
  "osc_publications",
  "doj_cep_resolutions",
  "doj_document_index",
] as const;

export type OversightMeta = Record<string, DatasetMeta | undefined>;

export const getOversightMeta = createServerFn({ method: "GET" }).handler(
  async (): Promise<OversightMeta> =>
    memo("meta", async () => {
      const r = await restGet<{ id: unknown; m: unknown }[]>(
        `corpus_datasets?select=id,m:metadata&id=in.(${DATASETS.join(",")})&ready=eq.true`,
      );
      const out: OversightMeta = {};
      for (const row of r.rows) {
        const p = parseDatasetMeta(row);
        if (p) out[p.id] = p;
      }
      return out;
    }),
);

export const getOversightOverview = createServerFn({ method: "GET" }).handler(
  async (): Promise<OversightTrend | null> =>
    memo("overview", async () => {
      const r = await restGet<{ t: unknown }[]>(
        "corpus_records?select=t:item->trend&dataset=eq.oversight_trends&id=eq.national&limit=1",
      );
      return parseTrend(r.rows[0]?.t);
    }),
);

// ------------------------------------------------------------------------------------------------ report search

const PAGE = 25;
const searchInput = z.object({
  q: z.string().max(200).default(""),
  oig: z.string().max(200).default(""),
  type: z.string().max(100).default(""),
  year: z
    .string()
    .regex(/^\d{4}$/)
    .or(z.literal(""))
    .default(""),
  page: z.number().int().min(0).max(4000).default(0),
});
export type OversightSearchInput = z.input<typeof searchInput>;
export type OversightSearch = {
  reports: OversightReport[];
  total: number | null;
  page: number;
  pageSize: number;
};

export const searchOversightReports = createServerFn({ method: "GET" })
  .inputValidator((d: OversightSearchInput) => searchInput.parse(d))
  .handler(async ({ data }): Promise<OversightSearch> => {
    const f: Record<string, string[]> = {};
    if (data.oig) f["oig"] = [data.oig];
    if (data.type) f["type"] = [data.type];
    if (data.year) f["year"] = [data.year];
    const path =
      "corpus_records?select=id,title,source_url,r:item->oversight&dataset=eq.oversight_reports" +
      (Object.keys(f).length ? containsFilter(f) : "") +
      textFilters(data.q) +
      "&order=ordinal.asc";
    const range: [number, number] = [data.page * PAGE, data.page * PAGE + PAGE - 1];
    const r = await restGet<{ id: unknown; title: unknown; source_url: unknown; r: unknown }[]>(
      path,
      { count: true, range },
    );
    return {
      reports: r.rows.flatMap((row) => {
        const p = parseOversightReport(row);
        return p ? [p] : [];
      }),
      total: r.total,
      page: data.page,
      pageSize: PAGE,
    };
  });

// ------------------------------------------------------------------------------------------------ agency panel

export type AgencyOversight = {
  trend: OversightTrend | null;
  reports: OversightReport[];
  total: number | null;
};

const AGENCY_REPORTS = 8;
export const getAgencyOversight = createServerFn({ method: "GET" })
  .inputValidator((d: { agencyId: string }) =>
    z.object({ agencyId: z.string().regex(AGENCY_ID) }).parse(d),
  )
  .handler(async ({ data }): Promise<AgencyOversight> => {
    const [t, r] = await Promise.all([
      restGet<{ t: unknown }[]>(
        `corpus_records?select=t:item->trend&dataset=eq.oversight_trends${containsFilter({ agency_id: [data.agencyId] })}&limit=5`,
      ),
      restGet<{ id: unknown; title: unknown; source_url: unknown; r: unknown }[]>(
        `corpus_records?select=id,title,source_url,r:item->oversight&dataset=eq.oversight_reports${containsFilter({ oig_agency: [data.agencyId] })}&order=ordinal.asc&limit=${AGENCY_REPORTS}`,
        { count: true },
      ),
    ]);
    const trends = t.rows
      .flatMap((row) => {
        const p = parseTrend(row.t);
        return p ? [p] : [];
      })
      .sort((a, b) => b.totals.reports - a.totals.reports);
    return {
      trend: trends[0] ?? null,
      reports: r.rows.flatMap((row) => {
        const p = parseOversightReport(row);
        return p ? [p] : [];
      }),
      total: r.total,
    };
  });

// ------------------------------------------------------------------------------------------------ OSC

export type OscFile = {
  id: string;
  number: string;
  agency: string | null;
  location: string | null;
  dateClosed: string | null;
  results: string[];
  files: { label: string; url: string }[];
  url: string;
};

export function parseOscFile(row: {
  id?: unknown;
  source_url?: unknown;
  b?: unknown;
}): OscFile | null {
  const id = str(row.id, 200);
  const b = obj(row.b);
  const number = str(b?.["number"], 60);
  const url = httpsUrl(b?.["url"]) ?? httpsUrl(row.source_url);
  if (!id || !RECORD_ID.test(id) || !b || !number || !url) return null;
  return {
    id,
    number,
    agency: str(b["agency"], 200),
    location: str(b["location"], 200),
    dateClosed: date(b["date_closed"]),
    results: strs(b["results"], 200),
    files: arr(b["files"]).flatMap((f) => {
      const o = obj(f);
      const u = httpsUrl(o?.["url"]);
      const label = str(o?.["label"], 120);
      return u && label ? [{ label, url: u }] : [];
    }),
    url,
  };
}

export type OscPublication = {
  id: string;
  kind: string;
  kindLabel: string;
  title: string;
  group: string | null;
  parent: string | null;
  date: string | null;
  year: number | null;
  tags: string[];
  fileType: string | null;
  url: string;
  excerpt: string | null;
};

export function parseOscPublication(row: {
  id?: unknown;
  source_url?: unknown;
  b?: unknown;
}): OscPublication | null {
  const id = str(row.id, 200);
  const b = obj(row.b);
  const title = str(b?.["title"], 600);
  const kind = str(b?.["kind"], 40);
  const url = httpsUrl(b?.["url"]) ?? httpsUrl(row.source_url);
  if (!id || !RECORD_ID.test(id) || !b || !title || !kind || !url) return null;
  return {
    id,
    kind,
    kindLabel: str(b["kind_label"], 80) ?? kind,
    title,
    group: str(b["group"], 200),
    parent: str(b["parent"], 100),
    date: date(b["date"]),
    year: num(b["year"]),
    tags: strs(b["tags"], 100),
    fileType: str(b["file_type"], 40),
    url,
    excerpt: str(b["excerpt"], 500),
  };
}

const oscInput = z.object({
  q: z.string().max(200).default(""),
  a: z.string().max(200).default(""),
  year: z
    .string()
    .regex(/^\d{4}$/)
    .or(z.literal(""))
    .default(""),
  page: z.number().int().min(0).max(400).default(0),
});
export type OscSearchInput = z.input<typeof oscInput>;

export const searchOscFiles = createServerFn({ method: "GET" })
  .inputValidator((d: OscSearchInput) => oscInput.parse(d))
  .handler(async ({ data }) => {
    // `a` is the agency as OSC lists it.
    const f: Record<string, string[]> = {};
    if (data.a) f["agency"] = [data.a];
    if (data.year) f["year"] = [data.year];
    const range: [number, number] = [data.page * PAGE, data.page * PAGE + PAGE - 1];
    const r = await restGet<{ id: unknown; source_url: unknown; b: unknown }[]>(
      "corpus_records?select=id,source_url,b:item->oscdi&dataset=eq.osc_public_files" +
        (Object.keys(f).length ? containsFilter(f) : "") +
        textFilters(data.q) +
        "&order=ordinal.asc",
      { count: true, range },
    );
    return {
      files: r.rows.flatMap((row) => {
        const p = parseOscFile(row);
        return p ? [p] : [];
      }),
      total: r.total,
      page: data.page,
      pageSize: PAGE,
    };
  });

export const searchOscPublications = createServerFn({ method: "GET" })
  .inputValidator((d: OscSearchInput & { kind?: string; tag?: string }) =>
    oscInput
      .extend({ kind: z.string().max(40).default(""), tag: z.string().max(100).default("") })
      .parse(d),
  )
  .handler(async ({ data }) => {
    // `a` is the group OSC lists the item under.
    const f: Record<string, string[]> = {};
    if (data.kind) f["kind"] = [data.kind];
    if (data.a) f["group"] = [data.a];
    if (data.tag) f["tag"] = [data.tag];
    if (data.year) f["year"] = [data.year];
    const range: [number, number] = [data.page * PAGE, data.page * PAGE + PAGE - 1];
    const r = await restGet<{ id: unknown; source_url: unknown; b: unknown }[]>(
      "corpus_records?select=id,source_url,b:item->oscpub&dataset=eq.osc_publications" +
        (Object.keys(f).length ? containsFilter(f) : "") +
        textFilters(data.q) +
        "&order=ordinal.asc",
      { count: true, range },
    );
    return {
      items: r.rows.flatMap((row) => {
        const p = parseOscPublication(row);
        return p ? [p] : [];
      }),
      total: r.total,
      page: data.page,
      pageSize: PAGE,
    };
  });

// ------------------------------------------------------------------------------------------------ DOJ

export type CepResolution = {
  id: string;
  company: string;
  label: string;
  date: string | null;
  dateText: string | null;
  url: string;
  companyCik: string | null;
};

export function parseCepResolution(row: {
  id?: unknown;
  source_url?: unknown;
  b?: unknown;
}): CepResolution | null {
  const id = str(row.id, 200);
  const b = obj(row.b);
  const label = str(b?.["label"], 400);
  const company = str(b?.["company"], 400);
  const url = httpsUrl(b?.["url"]) ?? httpsUrl(row.source_url);
  if (!id || !RECORD_ID.test(id) || !b || !label || !company || !url) return null;
  const cik = str(b["company_cik"], 10);
  return {
    id,
    company,
    label,
    date: date(b["date"]),
    dateText: str(b["date_text"], 20),
    url,
    companyCik: cik && CIK.test(cik) ? cik : null,
  };
}

export type DojDocument = {
  id: string;
  kind: string;
  group: string | null;
  title: string;
  entity: string | null;
  year: number | null;
  fileKind: string | null;
  url: string;
};

export function parseDojDocument(row: {
  id?: unknown;
  source_url?: unknown;
  b?: unknown;
}): DojDocument | null {
  const id = str(row.id, 200);
  const b = obj(row.b);
  const title = str(b?.["title"], 500);
  const kind = str(b?.["kind"], 20);
  const url = httpsUrl(b?.["url"]) ?? httpsUrl(row.source_url);
  if (!id || !RECORD_ID.test(id) || !b || !title || !kind || !url) return null;
  return {
    id,
    kind,
    group: str(b["group"], 300),
    title,
    entity: str(b["entity"], 300),
    year: num(b["year"]),
    fileKind: str(b["file_kind"], 20),
    url,
  };
}

export type DojOversight = { resolutions: CepResolution[]; documents: DojDocument[] };

export const getDojOversight = createServerFn({ method: "GET" }).handler(
  async (): Promise<DojOversight> =>
    memo("doj", async () => {
      const [cep, docs] = await Promise.all([
        restGet<{ id: unknown; source_url: unknown; b: unknown }[]>(
          "corpus_records?select=id,source_url,b:item->cep&dataset=eq.doj_cep_resolutions&order=ordinal.asc&limit=200",
        ),
        restGet<{ id: unknown; source_url: unknown; b: unknown }[]>(
          "corpus_records?select=id,source_url,b:item->dojdoc&dataset=eq.doj_document_index&order=ordinal.asc&limit=500",
        ),
      ]);
      return {
        resolutions: cep.rows.flatMap((r) => {
          const p = parseCepResolution(r);
          return p ? [p] : [];
        }),
        documents: docs.rows.flatMap((r) => {
          const p = parseDojDocument(r);
          return p ? [p] : [];
        }),
      };
    }),
);

export const getCompanyCepResolutions = createServerFn({ method: "GET" })
  .inputValidator((d: { cik: string }) => z.object({ cik: z.string().regex(CIK) }).parse(d))
  .handler(async ({ data }): Promise<CepResolution[]> => {
    const r = await restGet<{ id: unknown; source_url: unknown; b: unknown }[]>(
      `corpus_records?select=id,source_url,b:item->cep&dataset=eq.doj_cep_resolutions${containsFilter({ company: [data.cik] })}&order=ordinal.asc&limit=50`,
    );
    return r.rows.flatMap((row) => {
      const p = parseCepResolution(row);
      return p ? [p] : [];
    });
  });
