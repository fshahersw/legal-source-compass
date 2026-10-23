/**
 * Read-only server functions for the enforcement_extra datasets (built by scripts/enrichment/enforcement_extra):
 *   sam_exclusions, oig_leie_exclusions   exclusion lists (names exactly as published, with the official record link)
 *   fsis_recalls                          FSIS recalls and public health alerts (listing cards, 2014-2026)
 *   ussc_sentencing_districts             USSC sentencing aggregates per fiscal year and district
 *   eousa_caseload_annual                 EOUSA FY2025 caseload release counts per district
 * Stored JSON is validated here; malformed rows are dropped, never repaired. Only http(s) source links and in-app
 * links of known shapes are passed to the client.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { ilikeTerm, restGet } from "./rest.server";

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const obj = (v: unknown) =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const arr = (v: unknown) => (Array.isArray(v) ? (v as unknown[]) : []);
const httpUrl = (v: unknown) => {
  const s = str(v);
  return s && /^https:\/\/[^\s"<>]+$/.test(s) ? s : null;
};
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const date = (v: unknown) => {
  const s = str(v);
  return s && ISO_DATE.test(s) ? s : null;
};
const RECORD_ID = /^[A-Za-z0-9:._-]{1,120}$/;
const COURT_ID = /^[a-z]{2,5}d$/;
const USPS = /^[A-Z]{2}$/;
const CIK = /^\d{10}$/;

const TTL = 10 * 60 * 1000;
function memo<T>(
  cache: Map<string, { at: number; value: T }>,
  key: string,
  load: () => Promise<T>,
) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return Promise.resolve(hit.value);
  return load().then((value) => {
    if (cache.size > 200) cache.clear();
    cache.set(key, { at: Date.now(), value });
    return value;
  });
}

// ------------------------------------------------------------------------------------------- exclusions
export type ExclusionList = "sam" | "leie";
export type ExclusionHit = {
  list: ExclusionList;
  dataset: "sam_exclusions" | "oig_leie_exclusions";
  id: string;
  name: string;
  /** SAM: Individual / Firm / Special Entity Designation / Vessel; LEIE: Individual / Entity */
  classification: string | null;
  /** SAM excluding agency or LEIE general category */
  agency: string | null;
  /** SAM exclusion type or LEIE exclusion type code as published */
  type: string | null;
  start: string | null;
  /** SAM termination date or "Indefinite"; LEIE reinstatement date */
  end: string | null;
  place: string | null;
  state: string | null;
  identifiers: string | null;
  companyCik: string | null;
  sourceUrl: string | null;
};

export function parseExclusionRow(
  list: ExclusionList,
  row: { id?: unknown; title?: unknown; source_url?: unknown; c?: unknown },
): ExclusionHit | null {
  const id = str(row.id);
  const name = str(row.title);
  const c = obj(row.c);
  if (!id || !RECORD_ID.test(id) || !name || !c) return null;
  if (list === "sam" && !id.startsWith("sam:")) return null;
  if (list === "leie" && !id.startsWith("leie:")) return null;
  const termination = str(c["termination"]);
  const cik = str(c["company_cik"]);
  const state = str(c["state"]);
  const ids =
    list === "sam"
      ? [
          str(c["uei"]) && `UEI ${str(c["uei"])}`,
          str(c["cage"]) && `CAGE ${str(c["cage"])}`,
          str(c["npi"]) && `NPI ${str(c["npi"])}`,
        ]
      : [str(c["npi"]) && `NPI ${str(c["npi"])}`];
  return {
    list,
    dataset: list === "sam" ? "sam_exclusions" : "oig_leie_exclusions",
    id,
    name,
    classification: list === "sam" ? str(c["classification"]) : str(c["kind"]),
    agency: list === "sam" ? str(c["agency"]) : str(c["general"]),
    type: list === "sam" ? str(c["type"]) : str(c["code"]),
    start: date(list === "sam" ? c["active"] : c["excluded"]),
    end:
      list === "sam"
        ? termination === "Indefinite"
          ? "Indefinite"
          : date(termination)
        : date(c["reinstated"]),
    place: str(c["place"]),
    state: state && USPS.test(state) ? state : null,
    identifiers: ids.filter(Boolean).join(" · ") || null,
    companyCik: cik && CIK.test(cik) ? cik : null,
    sourceUrl: httpUrl(row.source_url),
  };
}

const exclusionInput = z.object({
  q: z.string().trim().min(2).max(80),
  list: z.enum(["all", "sam", "leie"]).default("all"),
  classification: z.string().max(40).optional(),
  state: z.string().regex(USPS).optional(),
  page: z.number().int().min(0).max(40).default(0),
});
export type ExclusionSearchInput = z.input<typeof exclusionInput>;
export type ExclusionSearch = {
  q: string;
  page: number;
  pageSize: number;
  sam: { hits: ExclusionHit[]; total: number | null } | null;
  leie: { hits: ExclusionHit[]; total: number | null } | null;
};

/** Rows per list per page (both lists together show up to twice this). */
const PAGE = 12;
const FSIS_PAGE = 15;
const CLASSIFICATIONS = new Set([
  "Individual",
  "Firm",
  "Special Entity Designation",
  "Vessel",
  "Entity",
]);

function containsFilter(key: string, value: string) {
  return `&filters=cs.${encodeURIComponent(JSON.stringify({ [key]: [value] }))}`;
}

const exclusionCache = new Map<string, { at: number; value: ExclusionSearch }>();
export const searchExclusions = createServerFn({ method: "GET" })
  .inputValidator((d: ExclusionSearchInput) => exclusionInput.parse(d))
  .handler(async ({ data }): Promise<ExclusionSearch> => {
    const key = JSON.stringify(data);
    return memo(exclusionCache, key, async () => {
      const cls =
        data.classification && CLASSIFICATIONS.has(data.classification)
          ? data.classification
          : null;
      const range: [number, number] = [data.page * PAGE, data.page * PAGE + PAGE - 1];
      const base = (dataset: string) =>
        `corpus_records?select=id,title,source_url,c:item->cells&dataset=eq.${dataset}&title=ilike.${ilikeTerm(data.q)}` +
        (data.state ? containsFilter("state", data.state) : "") +
        "&order=title.asc,id.asc";
      const wantSam = data.list !== "leie" && cls !== "Entity";
      const wantLeie =
        data.list !== "sam" && (cls == null || cls === "Individual" || cls === "Entity");
      const [sam, leie] = await Promise.all([
        wantSam
          ? restGet<{ id: unknown; title: unknown; source_url: unknown; c: unknown }[]>(
              base("sam_exclusions") + (cls ? containsFilter("classification", cls) : ""),
              { count: true, range },
            )
          : null,
        wantLeie
          ? restGet<{ id: unknown; title: unknown; source_url: unknown; c: unknown }[]>(
              base("oig_leie_exclusions") + (cls ? containsFilter("kind", cls) : ""),
              { count: true, range },
            )
          : null,
      ]);
      const pick = (list: ExclusionList, r: typeof sam) =>
        r
          ? {
              hits: r.rows.flatMap((row) => {
                const h = parseExclusionRow(list, row);
                return h ? [h] : [];
              }),
              total: r.total,
            }
          : null;
      return {
        q: data.q,
        page: data.page,
        pageSize: PAGE,
        sam: pick("sam", sam),
        leie: pick("leie", leie),
      };
    });
  });

export type ExclusionsOverview = {
  sam: {
    records: number;
    extract: string | null;
    retrievedAt: string | null;
    dataPage: string | null;
  } | null;
  leie: { records: number; retrievedAt: string | null; dataPage: string | null } | null;
  samAgencies: { value: string; records: number }[];
};

export function parseExclusionsOverview(rows: { id?: unknown; m?: unknown }[]): ExclusionsOverview {
  const byId = new Map(rows.map((r) => [str(r.id), obj(r.m)]));
  const sam = obj(byId.get("sam_exclusions")?.["summary"]);
  const leie = obj(byId.get("oig_leie_exclusions")?.["summary"]);
  const samSrc = obj(sam?.["source"]);
  const leieSrc = obj(leie?.["source"]);
  const samRecords = num(sam?.["records"]);
  const leieRecords = num(leie?.["records"]);
  return {
    sam:
      samRecords != null
        ? {
            records: samRecords,
            extract: str(samSrc?.["file"]),
            retrievedAt: str(samSrc?.["retrieved_at"]),
            dataPage: httpUrl(samSrc?.["data_page"]),
          }
        : null,
    leie:
      leieRecords != null
        ? {
            records: leieRecords,
            retrievedAt: str(leieSrc?.["retrieved_at"]),
            dataPage: httpUrl(leieSrc?.["data_page"]),
          }
        : null,
    samAgencies: arr(sam?.["by_agency"]).flatMap((a) => {
      const o = obj(a);
      const value = str(o?.["value"]);
      const records = num(o?.["records"]);
      return value && records != null ? [{ value, records }] : [];
    }),
  };
}

let overviewCache: { at: number; value: ExclusionsOverview } | null = null;
export const getExclusionsOverview = createServerFn({ method: "GET" }).handler(
  async (): Promise<ExclusionsOverview> => {
    if (overviewCache && Date.now() - overviewCache.at < TTL) return overviewCache.value;
    const r = await restGet<{ id: unknown; m: unknown }[]>(
      "corpus_datasets?select=id,m:metadata&id=in.(sam_exclusions,oig_leie_exclusions)",
    );
    const value = parseExclusionsOverview(r.rows);
    overviewCache = { at: Date.now(), value };
    return value;
  },
);

// ------------------------------------------------------------------------------------------- FSIS recalls
export type FsisRecall = {
  id: string;
  title: string;
  number: string | null;
  kind: string | null;
  cls: "I" | "II" | "III" | "PHA" | null;
  reason: string | null;
  date: string | null;
  closed: string | null;
  status: string | null;
  states: string | null;
  pounds: number | null;
  establishment: string | null;
  expansion: boolean;
  sourceUrl: string | null;
};

export function parseFsisRow(row: {
  id?: unknown;
  title?: unknown;
  source_url?: unknown;
  c?: unknown;
}): FsisRecall | null {
  const id = str(row.id);
  const title = str(row.title);
  const c = obj(row.c);
  if (!id || !RECORD_ID.test(id) || !id.startsWith("fsis:") || !title || !c) return null;
  const cls = str(c["class"]);
  const url = httpUrl(row.source_url);
  return {
    id,
    title,
    number: str(c["number"]),
    kind: str(c["kind"]),
    cls: cls === "I" || cls === "II" || cls === "III" || cls === "PHA" ? cls : null,
    reason: str(c["reason"]),
    date: date(c["date"]),
    closed: date(c["closed"]),
    status: str(c["status"]),
    states: str(c["states"]),
    pounds: num(c["pounds"]),
    establishment: str(c["establishment"]),
    expansion: c["expansion"] === true,
    sourceUrl: url && url.startsWith("https://www.fsis.usda.gov/") ? url : null,
  };
}

export type FsisYearCheck = { year: number; official: number | null; listing: number | null };
export type FsisRecalls = {
  rows: FsisRecall[];
  total: number | null;
  page: number;
  pageSize: number;
  checks: FsisYearCheck[];
};

const fsisInput = z.object({
  q: z.string().trim().max(80).default(""),
  kind: z.enum(["all", "recall", "pha"]).default("all"),
  cls: z.enum(["all", "I", "II", "III"]).default("all"),
  year: z.number().int().min(2014).max(2030).nullable().default(null),
  state: z.string().regex(USPS).optional(),
  page: z.number().int().min(0).max(100).default(0),
});
export type FsisRecallsInput = z.input<typeof fsisInput>;

export function parseFsisChecks(summary: unknown): FsisYearCheck[] {
  return arr(obj(summary)?.["official_comparison"]).flatMap((c) => {
    const o = obj(c);
    const year = num(o?.["year"]);
    return year == null
      ? []
      : [
          {
            year,
            official: num(o?.["official_recalls"]),
            listing: num(o?.["listing_recalls_by_number_year_excluding_expansions"]),
          },
        ];
  });
}

const fsisCache = new Map<string, { at: number; value: FsisRecalls }>();
export const getFsisRecalls = createServerFn({ method: "GET" })
  .inputValidator((d: FsisRecallsInput) => fsisInput.parse(d))
  .handler(async ({ data }): Promise<FsisRecalls> => {
    return memo(fsisCache, JSON.stringify(data), async () => {
      let path = "corpus_records?select=id,title,source_url,c:item->cells&dataset=eq.fsis_recalls";
      if (data.q.length >= 2) path += `&title=ilike.${ilikeTerm(data.q)}`;
      if (data.kind !== "all")
        path += containsFilter("kind", data.kind === "pha" ? "Public health alert" : "Recall");
      if (data.cls !== "all") path += containsFilter("class", data.cls);
      if (data.year != null) path += containsFilter("year", String(data.year));
      if (data.state) path += containsFilter("state", data.state);
      path += "&order=ordinal.asc";
      const [rows, meta] = await Promise.all([
        restGet<{ id: unknown; title: unknown; source_url: unknown; c: unknown }[]>(path, {
          count: true,
          range: [data.page * FSIS_PAGE, data.page * FSIS_PAGE + FSIS_PAGE - 1],
        }),
        restGet<{ s: unknown }[]>("corpus_datasets?select=s:metadata->summary&id=eq.fsis_recalls"),
      ]);
      return {
        rows: rows.rows.flatMap((r) => {
          const p = parseFsisRow(r);
          return p ? [p] : [];
        }),
        total: rows.total,
        page: data.page,
        pageSize: FSIS_PAGE,
        checks: parseFsisChecks(meta.rows[0]?.s),
      };
    });
  });

// ------------------------------------------------------------------------------------------- USSC sentencing
export type SentencingTotals = {
  cases: number;
  prisonN: number | null;
  prisonMedian: number | null;
  prisonMean: number | null;
  sentenceMedian: number | null;
  withinPct: number | null;
  abovePct: number | null;
  belowPct: number | null;
  belowGov: number | null;
  rangeValid: number | null;
  mmPct: number | null;
  sentenceTypes: Record<string, number>;
};
export type SentencingYear = {
  fy: number;
  offenseVariable: string | null;
  rangeVariable: string | null;
  district: SentencingTotals;
  national: SentencingTotals | null;
};
export type SentencingOffense = {
  label: string;
  cases: number;
  prisonMedian: number | null;
  withinPct: number | null;
  mmPct: number | null;
};
export type DistrictSentencing = {
  courtId: string;
  name: string | null;
  years: SentencingYear[];
  latest: {
    fy: number;
    offenseVariable: string | null;
    offenses: SentencingOffense[];
    nationalShare: Record<string, number>;
  } | null;
  sourceUrl: string | null;
};

export function parseTotals(v: unknown): SentencingTotals | null {
  const t = obj(v);
  const cases = num(t?.["cases"]);
  if (!t || cases == null) return null;
  const types: Record<string, number> = {};
  const st = obj(t["sentence_types"]);
  if (st)
    for (const [k, n] of Object.entries(st)) {
      const nn = num(n);
      if (/^[0-4]$/.test(k) && nn != null) types[k] = nn;
    }
  return {
    cases,
    prisonN: num(t["prison_n"]),
    prisonMedian: num(t["prison_median"]),
    prisonMean: num(t["prison_mean"]),
    sentenceMedian: num(t["sentence_median"]),
    withinPct: num(t["within_pct"]),
    abovePct: num(t["above_pct"]),
    belowPct: num(t["below_pct"]),
    belowGov: num(t["below_gov"]),
    rangeValid: num(t["range_valid"]),
    mmPct: num(t["mm_pct"]),
    sentenceTypes: types,
  };
}

export function parseOffenses(v: unknown): SentencingOffense[] {
  return arr(v)
    .flatMap((o) => {
      const r = obj(o);
      const label = str(r?.["label"]);
      const cases = num(r?.["cases"]);
      return r && label && cases != null && r["code"] != null
        ? [
            {
              label,
              cases,
              prisonMedian: num(r["prison_median"]),
              withinPct: num(r["within_pct"]),
              mmPct: num(r["mm_pct"]),
            },
          ]
        : [];
    })
    .sort((a, b) => b.cases - a.cases);
}

export function parseDistrictSentencing(input: {
  courtId: string;
  district: {
    id?: unknown;
    fy?: unknown;
    name?: unknown;
    t?: unknown;
    ov?: unknown;
    rv?: unknown;
    court?: unknown;
  }[];
  national: { fy?: unknown; t?: unknown }[];
  latestOffenses: unknown;
  latestNationalOffenses: unknown;
  sourceUrl: unknown;
}): DistrictSentencing | null {
  const nat = new Map<number, SentencingTotals>();
  for (const r of input.national) {
    const fy = num(r.fy);
    const t = parseTotals(r.t);
    if (fy != null && t) nat.set(fy, t);
  }
  let name: string | null = null;
  const years: SentencingYear[] = [];
  for (const r of input.district) {
    const fy = num(r.fy);
    const t = parseTotals(r.t);
    if (fy == null || !t || r.court !== input.courtId) continue;
    name = name ?? str(r.name);
    years.push({
      fy,
      offenseVariable: str(r.ov),
      rangeVariable: str(r.rv),
      district: t,
      national: nat.get(fy) ?? null,
    });
  }
  if (!years.length) return null;
  years.sort((a, b) => a.fy - b.fy);
  const last = years[years.length - 1]!;
  const natOff = parseOffenses(input.latestNationalOffenses);
  const natTotal = natOff.reduce((s, o) => s + o.cases, 0);
  const nationalShare: Record<string, number> = {};
  if (natTotal > 0) for (const o of natOff) nationalShare[o.label] = (o.cases / natTotal) * 100;
  return {
    courtId: input.courtId,
    name,
    years,
    latest: {
      fy: last.fy,
      offenseVariable: last.offenseVariable,
      offenses: parseOffenses(input.latestOffenses),
      nationalShare,
    },
    sourceUrl: httpUrl(input.sourceUrl),
  };
}

const sentencingCache = new Map<string, { at: number; value: DistrictSentencing | null }>();
export const getDistrictSentencing = createServerFn({ method: "GET" })
  .inputValidator((d: { id: string }) => z.object({ id: z.string().regex(COURT_ID) }).parse(d))
  .handler(async ({ data }): Promise<DistrictSentencing | null> => {
    return memo(sentencingCache, data.id, async () => {
      const sel =
        "select=id,fy:item->profile->fy,name:item->profile->name,court:item->profile->court_id,t:item->profile->total,ov:item->profile->offense_variable,rv:item->profile->range_variable";
      const district = await restGet<
        {
          id: unknown;
          fy: unknown;
          name: unknown;
          court: unknown;
          t: unknown;
          ov: unknown;
          rv: unknown;
        }[]
      >(
        `corpus_records?${sel}&dataset=eq.ussc_sentencing_districts${containsFilter("court", data.id)}&order=id.asc`,
      );
      const fys = district.rows.map((r) => num(r.fy)).filter((v): v is number => v != null);
      if (!fys.length) return null;
      const latest = Math.max(...fys);
      const [national, off, natOff] = await Promise.all([
        restGet<{ fy: unknown; t: unknown }[]>(
          `corpus_records?select=fy:item->profile->fy,t:item->profile->total&dataset=eq.ussc_sentencing_districts${containsFilter("scope", "national")}&order=id.asc`,
        ),
        restGet<{ o: unknown; u: unknown }[]>(
          `corpus_records?select=o:item->profile->offenses,u:source_url&dataset=eq.ussc_sentencing_districts&id=eq.${encodeURIComponent(`ussc:${latest}:${data.id}`)}`,
        ),
        restGet<{ o: unknown }[]>(
          `corpus_records?select=o:item->profile->offenses&dataset=eq.ussc_sentencing_districts&id=eq.${encodeURIComponent(`ussc:${latest}:national`)}`,
        ),
      ]);
      return parseDistrictSentencing({
        courtId: data.id,
        district: district.rows,
        national: national.rows,
        latestOffenses: off.rows[0]?.o,
        latestNationalOffenses: natOff.rows[0]?.o,
        sourceUrl: off.rows[0]?.u,
      });
    });
  });

// ------------------------------------------------------------------------------------------- EOUSA
export type ProsecutionCount = { code: string; label: string; records: number };
export type DistrictProsecutions = {
  courtId: string;
  districtName: string;
  districtCode: string;
  fy: number;
  criminalRecords: number | null;
  programGroups: ProsecutionCount[];
  programCategories: ProsecutionCount[];
  leadCharges: ProsecutionCount[];
  usTitles: { title: string; records: number }[];
  govDefendantCases: number | null;
  businessProperty: { civil: number; criminal: number } | null;
  nationalRecords: number | null;
  sourceUrl: string | null;
};

function counts(v: unknown, key = "code"): ProsecutionCount[] {
  return arr(v).flatMap((x) => {
    const o = obj(x);
    const code = str(o?.[key]);
    const label = str(o?.["label"]);
    const records = num(o?.["records"]);
    return code && label && records != null ? [{ code, label, records }] : [];
  });
}

export function parseDistrictProsecutions(input: {
  courtId: string;
  profile: unknown;
  national: unknown;
  sourceUrl: unknown;
}): DistrictProsecutions | null {
  const p = obj(input.profile);
  if (!p || p["court_id"] !== input.courtId) return null;
  const name = str(p["district_name"]);
  const code = str(p["district_code"]);
  const fy = num(p["fy"]);
  if (!name || !code || fy == null) return null;
  const crim = obj(p["criminal_lead_charge_records"]);
  const gov = obj(p["government_defendant_civil"]);
  const bp = obj(p["business_property"]);
  return {
    courtId: input.courtId,
    districtName: name,
    districtCode: code,
    fy,
    criminalRecords: num(crim?.["records"]),
    programGroups: counts(crim?.["by_program_master"]),
    programCategories: counts(crim?.["top_program_categories"]),
    leadCharges: counts(crim?.["top_lead_charges"]),
    usTitles: arr(crim?.["top_usc_titles"]).flatMap((x) => {
      const o = obj(x);
      const title = str(o?.["title"]);
      const records = num(o?.["records"]);
      return title && records != null ? [{ title, records }] : [];
    }),
    govDefendantCases: num(gov?.["cases"]),
    businessProperty:
      bp && num(bp["civil_cases"]) != null && num(bp["criminal_cases"]) != null
        ? { civil: num(bp["civil_cases"])!, criminal: num(bp["criminal_cases"])! }
        : null,
    nationalRecords: num(obj(input.national)?.["lead_charge_records_total"]),
    sourceUrl: httpUrl(input.sourceUrl),
  };
}

const prosecutionsCache = new Map<string, { at: number; value: DistrictProsecutions | null }>();
export const getDistrictProsecutions = createServerFn({ method: "GET" })
  .inputValidator((d: { id: string }) => z.object({ id: z.string().regex(COURT_ID) }).parse(d))
  .handler(async ({ data }): Promise<DistrictProsecutions | null> => {
    return memo(prosecutionsCache, data.id, async () => {
      const [rec, nat] = await Promise.all([
        restGet<{ p: unknown; u: unknown }[]>(
          `corpus_records?select=p:item->profile,u:source_url&dataset=eq.eousa_caseload_annual&id=eq.${encodeURIComponent(`eousa:2025:${data.id}`)}&limit=1`,
        ),
        restGet<{ p: unknown }[]>(
          "corpus_records?select=p:item->profile->lead_charge_records_total&dataset=eq.eousa_caseload_annual&id=eq.eousa:2025:national&limit=1",
        ),
      ]);
      return parseDistrictProsecutions({
        courtId: data.id,
        profile: rec.rows[0]?.p,
        national: { lead_charge_records_total: nat.rows[0]?.p },
        sourceUrl: rec.rows[0]?.u,
      });
    });
  });
