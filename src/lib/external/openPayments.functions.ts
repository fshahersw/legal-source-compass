/**
 * CMS Open Payments manufacturer and state totals, and MAUDE device report counts for exact-name matched
 * manufacturers (datasets company_payments_manufacturers, company_payments_states, company_adverse_manufacturers;
 * built by scripts/enrichment/open_payments/). Stored JSON is validated defensively: malformed rows are dropped.
 */
import { createServerFn } from "@tanstack/react-start";
import { restGet } from "./rest.server";

export const PAYMENT_YEARS = [2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025] as const;

export type PaymentSource = { label: string; url: string };
export type PaymentYear = {
  year: number;
  general: number | null;
  generalRecords: number | null;
  research: number | null;
  researchRecords: number | null;
  source: "summary" | "archive";
};
export type NatureSlice = { code: string; label: string; amount: number; records: number | null };
export type StateSlice = { state: string; amount: number; records: number | null };
export type ProductSlice = { name: string; type: string; amount: number; records: number | null };
export type TypeSlice = { type: string; amount: number; records: number | null };
export type ManufacturerPayments = {
  id: string;
  entityId: string;
  name: string;
  altNames: string[];
  hqState: string | null;
  country: string | null;
  rank: number;
  totals: { general: number; research: number; generalRecords: number; researchRecords: number };
  years: PaymentYear[];
  nature: NatureSlice[];
  natureLatest: NatureSlice[];
  states: StateSlice[];
  statesLatest: StateSlice[];
  latestYear: number | null;
  productTypes: TypeSlice[];
  products: ProductSlice[];
  deviceShare: number | null;
  stateCheck: { matched: number; of: number };
  sourceUrl: string;
  sources: PaymentSource[];
};
export type ManufacturerSummary = Omit<
  ManufacturerPayments,
  "natureLatest" | "states" | "statesLatest" | "products" | "sources" | "stateCheck"
>;
export type StatePaymentYear = {
  year: number;
  general: number | null;
  generalRecords: number | null;
  research: number | null;
  researchRecords: number | null;
  physicians: number | null;
  npps: number | null;
  teachingHospitals: number | null;
  source: "summary" | "archive";
};
export type StatePayments = {
  state: string;
  name: string;
  years: StatePaymentYear[];
  nature: { label: string; amount: number }[];
  natureByYear: Record<string, { label: string; amount: number }[]>;
  /** National record only: CMS dashboard count of companies making payments, by program year. */
  reportingEntities: Record<string, number>;
  sourceUrl: string;
};
/**
 * reports: attributed MAUDE reports (lower bound). denominator: reports whose manufacturer name matches the phrase
 * search or an attributed spelling. coverage = reports / denominator (null when the denominator is unknown).
 */
export type AdverseYear = {
  year: number;
  reports: number;
  denominator: number | null;
  coverage: number | null;
};
export type AdverseManufacturer = {
  /** "open_payments": entityId is a CMS reporting-entity ID; "sec": entityId is an SEC CIK. */
  kind: "open_payments" | "sec";
  entityId: string;
  name: string;
  sicDescription: string | null;
  matched: boolean;
  matchedNames: { name: string; reports: number }[];
  /** Phrase-search spellings NOT attributed by the exact-name rule (all-time counts); review leads only. */
  unattributed: { name: string; reportsAllTime: number }[];
  years: AdverseYear[];
  total: number | null;
  /** 2017-2025 name coverage (attributed / same-name reports); null when unmatched or unknown. */
  coverage: number | null;
  denominator: number | null;
  /** Spellings claimed by several companies of the same source and excluded from all of them. */
  ambiguous: { name: string; owners: string[] }[];
  discoverUrls: string[];
  seriesUrl: string | null;
  retrievedAt: string | null;
};
export type PaymentsDashboard = {
  generatedAt: string | null;
  manufacturers: ManufacturerSummary[];
  states: StatePayments[];
  national: StatePayments | null;
  adverse: AdverseManufacturer[];
  population: Record<string, Record<string, number>> | null;
  populationSource: string | null;
  method: Record<string, string>;
};
export type ManufacturerLookup = {
  query: string;
  matches: { payments: ManufacturerPayments; adverse: AdverseManufacturer | null }[];
  /** MAUDE counts for an SEC registrant with the same normalized name (company_sec_profiles scope). */
  secAdverse: AdverseManufacturer[];
};

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const obj = (v: unknown) =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const arr = (v: unknown) => (Array.isArray(v) ? v : []);
const isHttp = (v: string) => /^https:\/\/[^\s]+$/.test(v);

/**
 * Same rule as scripts/enrichment/open_payments/names.py. A name reduces to a base (case, punctuation, initial
 * spacing, trailing "& Subsidiaries" and legal-form words ignored) plus its legal-form classes. Two names are the
 * same company only when bases are equal and the legal forms agree (equal classes, or one name has none).
 */
const SUFFIX_CLASS: Record<string, string> = {
  INC: "CORP",
  INCORPORATED: "CORP",
  CORP: "CORP",
  CORPORATION: "CORP",
  CO: "CORP",
  COMPANY: "CORP",
  LTD: "LTD",
  LIMITED: "LTD",
  ...Object.fromEntries(
    "LLC LP LLP PLC AG SA SAS GMBH NV BV SPA AB AS KK PTY SE ULC LTDA SRL SARL"
      .split(" ")
      .map((s) => [s, s]),
  ),
};
export function companyKey(name: unknown): { base: string; forms: string[] } {
  if (typeof name !== "string") return { base: "", forms: [] };
  const words = name
    .toUpperCase()
    .replace(/&/g, " AND ")
    .replace(/[^A-Z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const tokens: string[] = [];
  let inRun = false;
  for (const w of words) {
    const single = w.length === 1 && /[A-Z]/.test(w);
    if (single && inRun) tokens[tokens.length - 1] += w;
    else tokens.push(w);
    inRun = single;
  }
  const original = [...tokens];
  const forms = new Set<string>();
  let changed = true;
  while (changed && tokens.length) {
    changed = false;
    if (
      tokens.length >= 3 &&
      tokens[tokens.length - 2] === "AND" &&
      tokens[tokens.length - 1] === "SUBSIDIARIES"
    ) {
      tokens.splice(-2, 2);
      changed = true;
    } else if (tokens.length > 1 && SUFFIX_CLASS[tokens[tokens.length - 1]!]) {
      forms.add(SUFFIX_CLASS[tokens.pop()!]!);
      changed = true;
    }
  }
  return { base: (tokens.length ? tokens : original).join(" "), forms: [...forms].sort() };
}
export const normalizeCompany = (name: unknown) => companyKey(name).base;
export function sameCompany(a: unknown, b: unknown): boolean {
  const ka = companyKey(a),
    kb = companyKey(b);
  return (
    !!ka.base &&
    ka.base === kb.base &&
    (!ka.forms.length || !kb.forms.length || ka.forms.join() === kb.forms.join())
  );
}

function parseSources(raw: unknown): PaymentSource[] {
  return arr(raw).flatMap((s) => {
    const o = obj(s);
    const url = str(o?.["url"]);
    return o && str(o["label"]) && isHttp(url) ? [{ label: str(o["label"]), url }] : [];
  });
}

function parseYear(raw: unknown): PaymentYear | null {
  const o = obj(raw);
  const year = num(o?.["year"]);
  const source = str(o?.["source"]);
  if (!o || year == null || (source !== "summary" && source !== "archive")) return null;
  return {
    year,
    general: num(o["general"]),
    generalRecords: num(o["generalRecords"]),
    research: num(o["research"]),
    researchRecords: num(o["researchRecords"]),
    source,
  };
}

function slices<T>(raw: unknown, pick: (o: Record<string, unknown>) => T | null): T[] {
  return arr(raw).flatMap((r) => {
    const o = obj(r);
    const v = o ? pick(o) : null;
    return v ? [v] : [];
  });
}
const nature = (o: Record<string, unknown>): NatureSlice | null => {
  const amount = num(o["amount"]);
  return str(o["label"]) && amount != null
    ? { code: str(o["code"]), label: str(o["label"]), amount, records: num(o["records"]) }
    : null;
};
const stateSlice = (o: Record<string, unknown>): StateSlice | null => {
  const amount = num(o["amount"]);
  return /^[A-Z]{2}$/.test(str(o["state"])) && amount != null
    ? { state: str(o["state"]), amount, records: num(o["records"]) }
    : null;
};

export function parseManufacturer(id: string, raw: unknown): ManufacturerPayments | null {
  const p = obj(raw);
  if (!p) return null;
  const entityId = str(p["entityId"]);
  const name = str(p["name"]);
  const rank = num(p["rank"]);
  const t = obj(p["totals"]);
  const totals = t && {
    general: num(t["general"]),
    research: num(t["research"]),
    generalRecords: num(t["generalRecords"]),
    researchRecords: num(t["researchRecords"]),
  };
  if (!/^\d+$/.test(entityId) || !name || rank == null || !totals) return null;
  if (Object.values(totals).some((v) => v == null)) return null;
  const years = arr(p["years"]).flatMap((y) => {
    const parsed = parseYear(y);
    return parsed ? [parsed] : [];
  });
  if (!years.length) return null;
  const sc = obj(p["stateCheck"]);
  const sourceUrl = str(p["sourceUrl"]);
  return {
    id,
    entityId,
    name,
    altNames: arr(p["altNames"]).filter((n): n is string => typeof n === "string" && !!n.trim()),
    hqState: str(p["hqState"]) || null,
    country: str(p["country"]) || null,
    rank,
    totals: totals as ManufacturerPayments["totals"],
    years: years.sort((a, b) => a.year - b.year),
    nature: slices(p["nature"], nature),
    natureLatest: slices(p["natureLatest"], nature),
    states: slices(p["states"], stateSlice),
    statesLatest: slices(p["statesLatest"], stateSlice),
    latestYear: num(p["latestYear"]),
    productTypes: slices(p["productTypes"], (o) => {
      const amount = num(o["amount"]);
      return amount != null
        ? { type: str(o["type"]) || "Not recorded", amount, records: num(o["records"]) }
        : null;
    }),
    products: slices(p["products"], (o) => {
      const amount = num(o["amount"]);
      return str(o["name"]) && amount != null
        ? {
            name: str(o["name"]),
            type: str(o["type"]) || "Not recorded",
            amount,
            records: num(o["records"]),
          }
        : null;
    }),
    deviceShare: num(p["deviceShare"]),
    stateCheck: { matched: num(sc?.["matched"]) ?? 0, of: num(sc?.["of"]) ?? 0 },
    sourceUrl: isHttp(sourceUrl) ? sourceUrl : "https://openpaymentsdata.cms.gov/",
    sources: parseSources(p["sources"]),
  };
}

function parseStateYear(raw: unknown): StatePaymentYear | null {
  const o = obj(raw);
  const year = num(o?.["year"]);
  const source = str(o?.["source"]);
  if (!o || year == null || (source !== "summary" && source !== "archive")) return null;
  return {
    year,
    general: num(o["general"]),
    generalRecords: num(o["generalRecords"]),
    research: num(o["research"]),
    researchRecords: num(o["researchRecords"]),
    physicians: num(o["physicians"]),
    npps: num(o["npps"]),
    teachingHospitals: num(o["teachingHospitals"]),
    source,
  };
}

const labelAmount = (o: Record<string, unknown>) => {
  const amount = num(o["amount"]);
  return str(o["label"]) && amount != null ? { label: str(o["label"]), amount } : null;
};

export function parseState(raw: unknown): StatePayments | null {
  const p = obj(raw);
  const state = str(p?.["state"]);
  if (!p || !/^[A-Z]{2}$/.test(state) || !str(p["name"])) return null;
  const years = arr(p["years"]).flatMap((y) => {
    const parsed = parseStateYear(y);
    return parsed ? [parsed] : [];
  });
  const byYear: Record<string, { label: string; amount: number }[]> = {};
  for (const [year, list] of Object.entries(obj(p["natureByYear"]) ?? {}))
    if (/^\d{4}$/.test(year)) byYear[year] = slices(list, labelAmount);
  const entities: Record<string, number> = {};
  for (const [year, v] of Object.entries(obj(p["reportingEntities"]) ?? {}))
    if (/^\d{4}$/.test(year) && num(v) != null) entities[year] = num(v)!;
  const sourceUrl = str(p["sourceUrl"]);
  return {
    state,
    name: str(p["name"]),
    years: years.sort((a, b) => a.year - b.year),
    nature: slices(p["nature"], labelAmount),
    natureByYear: byYear,
    reportingEntities: entities,
    sourceUrl: isHttp(sourceUrl) ? sourceUrl : "https://openpaymentsdata.cms.gov/",
  };
}

export function parseAdverse(raw: unknown): AdverseManufacturer | null {
  const p = obj(raw);
  const entityId = str(p?.["entityId"]);
  if (!p || !/^\d+$/.test(entityId) || !str(p["name"]) || typeof p["matched"] !== "boolean")
    return null;
  const matched = p["matched"];
  const years = slices(p["years"], (o) => {
    const year = num(o["year"]);
    const reports = num(o["reports"]);
    const denominator = num(o["denominator"]);
    const coverage = num(o["coverage"]);
    return year != null && reports != null
      ? {
          year,
          reports,
          denominator,
          coverage: coverage != null && coverage >= 0 && coverage <= 1 ? coverage : null,
        }
      : null;
  });
  const seriesUrl = str(p["seriesUrl"]);
  const coverage = num(p["coverage"]);
  return {
    kind: p["kind"] === "sec" ? "sec" : "open_payments",
    entityId,
    name: str(p["name"]),
    sicDescription: str(p["sicDescription"]) || null,
    matched,
    matchedNames: slices(p["matchedNames"], (o) => {
      const reports = num(o["reports"]);
      return str(o["name"]) && reports != null ? { name: str(o["name"]), reports } : null;
    }),
    unattributed: slices(p["unattributed"], (o) => {
      const reports = num(o["reportsAllTime"]);
      return str(o["name"]) && reports != null
        ? { name: str(o["name"]), reportsAllTime: reports }
        : null;
    }),
    years: matched ? years.sort((a, b) => a.year - b.year) : [],
    total: matched ? num(p["total"]) : null,
    coverage: matched && coverage != null && coverage >= 0 && coverage <= 1 ? coverage : null,
    denominator: matched ? num(p["denominator"]) : null,
    ambiguous: slices(p["ambiguous"], (o) =>
      str(o["name"])
        ? {
            name: str(o["name"]),
            owners: arr(o["owners"]).filter((x): x is string => typeof x === "string"),
          }
        : null,
    ),
    discoverUrls: arr(p["discoverUrls"]).filter(
      (u): u is string => typeof u === "string" && isHttp(u),
    ),
    seriesUrl: matched && isHttp(seriesUrl) ? seriesUrl : null,
    retrievedAt: str(p["retrievedAt"]) || null,
  };
}

/** Population series from state_metrics_profiles (Census July 1 estimates) when that dataset exists. */
export function parsePopulation(
  rows: { usps?: unknown; population?: unknown }[],
): Record<string, Record<string, number>> | null {
  const out: Record<string, Record<string, number>> = {};
  for (const row of rows) {
    const usps = str(row.usps);
    const series = obj(row.population);
    if (!/^[A-Z]{2}$/.test(usps) || !series) continue;
    const clean: Record<string, number> = {};
    for (const [year, value] of Object.entries(series)) {
      const v = num(value);
      if (/^\d{4}$/.test(year) && v != null && v > 0) clean[year] = v;
    }
    if (Object.keys(clean).length) out[usps] = clean;
  }
  return Object.keys(out).length ? out : null;
}

/** Pearson correlation; null when fewer than 3 pairs or no variance. */
export function pearson(xs: number[], ys: number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return null;
  const mx = xs.slice(0, n).reduce((a, b) => a + b, 0) / n;
  const my = ys.slice(0, n).reduce((a, b) => a + b, 0) / n;
  let sxy = 0,
    sxx = 0,
    syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - mx,
      dy = ys[i]! - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
}

export function median(values: number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid]! : (v[mid - 1]! + v[mid]!) / 2;
}

type Row = { id: string; item: { payments?: unknown; adverse?: unknown } | null };
const M = "company_payments_manufacturers";
const S = "company_payments_states";
const A = "company_adverse_manufacturers";

async function readAll(dataset: string, field: "payments" | "adverse") {
  const rows: Row[] = [];
  for (let start = 0; ; start += 1000) {
    const page = await restGet<{ id: string; v: unknown }[]>(
      `corpus_records?select=id,v:item->${field}&dataset=eq.${dataset}&order=ordinal.asc`,
      { range: [start, start + 999] },
    );
    rows.push(...page.rows.map((r) => ({ id: r.id, item: { [field]: r.v } })));
    if (page.rows.length < 1000) return rows;
  }
}

async function readPopulation() {
  try {
    const res = await restGet<{ usps?: unknown; population?: unknown }[]>(
      "corpus_records?select=usps:item->profile->>usps,population:item->profile->series->population&dataset=eq.state_metrics_profiles&limit=100",
    );
    return parsePopulation(res.rows);
  } catch {
    return null;
  }
}

let cache: { at: number; value: PaymentsDashboard } | null = null;
let fullCache: {
  at: number;
  manufacturers: ManufacturerPayments[];
  adverse: AdverseManufacturer[];
} | null = null;
const TTL = 10 * 60 * 1000;

async function loadFull() {
  if (fullCache && Date.now() - fullCache.at < TTL) return fullCache;
  const [m, a] = await Promise.all([readAll(M, "payments"), readAll(A, "adverse")]);
  fullCache = {
    at: Date.now(),
    manufacturers: m.flatMap((r) => {
      const parsed = parseManufacturer(r.id, r.item?.payments);
      return parsed ? [parsed] : [];
    }),
    adverse: a.flatMap((r) => {
      const parsed = parseAdverse(r.item?.adverse);
      return parsed ? [parsed] : [];
    }),
  };
  return fullCache;
}

export const getPaymentsDashboard = createServerFn({ method: "GET" }).handler(
  async (): Promise<PaymentsDashboard> => {
    if (cache && Date.now() - cache.at < TTL) return cache.value;
    const [full, states, catalog, population] = await Promise.all([
      loadFull(),
      readAll(S, "payments"),
      restGet<{ metadata: { summary?: Record<string, unknown> } | null }[]>(
        `corpus_datasets?select=metadata&id=eq.${M}&limit=1`,
      ),
      readPopulation(),
    ]);
    const parsedStates = states.flatMap((r) => {
      const parsed = parseState(r.item?.payments);
      return parsed ? [parsed] : [];
    });
    const summary = catalog.rows[0]?.metadata?.summary ?? {};
    const method: Record<string, string> = {};
    for (const [k, v] of Object.entries(obj(summary["method"]) ?? {}))
      if (typeof v === "string") method[k] = v;
    const value: PaymentsDashboard = {
      generatedAt: str(summary["generated_at"]) || null,
      manufacturers: full.manufacturers.map(
        ({ natureLatest, states, statesLatest, products, sources, stateCheck, ...rest }) => {
          void natureLatest;
          void states;
          void statesLatest;
          void products;
          void sources;
          void stateCheck;
          return rest;
        },
      ),
      states: parsedStates.filter((s) => s.state !== "US"),
      national: parsedStates.find((s) => s.state === "US") ?? null,
      adverse: full.adverse,
      population,
      populationSource: population
        ? "U.S. Census Bureau July 1 resident population estimates, via dataset state_metrics_profiles"
        : null,
      method,
    };
    cache = { at: Date.now(), value };
    return value;
  },
);

/** Exact normalized-name lookup for company pages: no fuzzy or partial matching. */
export const getManufacturerPayments = createServerFn({ method: "GET" })
  .inputValidator((input: { name: string; entityId?: string | undefined }) => ({
    name: typeof input?.name === "string" ? input.name.slice(0, 200) : "",
    entityId:
      typeof input?.entityId === "string" && /^\d{1,20}$/.test(input.entityId)
        ? input.entityId
        : undefined,
  }))
  .handler(async ({ data }): Promise<ManufacturerLookup> => {
    const full = await loadFull();
    const key = data.name.trim();
    const hits = full.manufacturers.filter((m) =>
      data.entityId
        ? m.entityId === data.entityId
        : !!key && [m.name, ...m.altNames].some((n) => sameCompany(n, key)),
    );
    const opAdverse = full.adverse.filter((a) => a.kind === "open_payments");
    return {
      query: data.name,
      matches: hits.map((payments) => ({
        payments,
        adverse: opAdverse.find((a) => a.entityId === payments.entityId) ?? null,
      })),
      secAdverse: key
        ? full.adverse.filter((a) => a.kind === "sec" && sameCompany(a.name, key))
        : [],
    };
  });
