/**
 * Enforcement analytics reads: EPA ECHO case aggregates (regulatory_epa_state_profiles, regulatory_epa_cases)
 * and CPSC recall aggregates (regulatory_cpsc_aggregates, agency_safety_cpsc_recalls_api).
 * Built by scripts/enrichment/enforcement/*. Stored JSON is validated here; malformed rows are dropped.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { restGet } from "./rest.server";

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const int = (v: unknown) => num(v) ?? 0;
const str = (v: unknown) => (typeof v === "string" ? v : "");
const strOrNull = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
const obj = (v: unknown) =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const arr = (v: unknown) => (Array.isArray(v) ? (v as unknown[]) : []);
const strings = (v: unknown) => arr(v).filter((s): s is string => typeof s === "string" && !!s);
const counts = (v: unknown) => {
  const out: Record<string, number> = {};
  for (const [k, value] of Object.entries(obj(v) ?? {})) {
    const n = num(value);
    if (k && n != null) out[k] = n;
  }
  return out;
};

// ---------------------------------------------------------------- EPA

/** Counts (cases, judicial, administrative) are by fiscal year opened; dollars are by settlement fiscal year. */
export type EpaYear = {
  fy: number;
  cases: number;
  judicial: number;
  administrative: number;
  settlements: number;
  penaltySettlements: number;
  fedPenalty: number;
  sep: number;
  costRecovery: number;
};
export type EpaStatute = {
  code: string | null;
  name: string;
  cases: number;
  judicial: number;
  fedPenalty: number;
  sep: number;
  citedCases: number | null;
  /** cases = opened that FY; fedPenalty = settled that FY. */
  years: { fy: number; cases: number; fedPenalty: number }[];
};
export type EpaDefendantGroup = {
  defendants: string[];
  nationalCase: string | null;
  cases: number;
  judicial: number;
  fedPenalty: number;
  firstSettlementFy: number | null;
  lastSettlementFy: number | null;
  statutes: string[];
  states: string[];
  caseNumbers: string[];
};
export type EpaTopCase = {
  caseNumber: string;
  name: string;
  fy: number | null;
  settled: string | null;
  settlementFy: number | null;
  type: string | null;
  statute: string | null;
  fedPenalty: number;
  records: string[];
  defendants: string[];
  inCasesDataset: boolean;
};
export type EpaNationalGroup = {
  leadCaseNumber: string;
  leadName: string;
  records: string[];
  perRecord: number;
  combined: number;
  states: string[];
};
export type EpaProfileKind = "national" | "state" | "territory" | "other" | "unrecorded";
export type EpaProfile = {
  id: string;
  code: string;
  name: string;
  kind: EpaProfileKind;
  fips: string | null;
  totals: {
    cases: number;
    judicial: number;
    administrative: number;
    penaltySettlements: number;
    fedPenalty: number;
    sep: number;
    costRecovery: number;
    multistateCases: number;
    unattributedFedPenalty: number;
  };
  years: EpaYear[];
  statutes: EpaStatute[];
  topDefendantGroups: EpaDefendantGroup[];
  topDefendantGroupsRecent: EpaDefendantGroup[];
  topCases: EpaTopCase[];
  nationalGroups: EpaNationalGroup[];
  lookalikes: { groups: number; cases: number; extraFedPenalty: number } | null;
  population: number | null;
  populationYear: number | null;
};
export type EpaEnforcement = {
  national: EpaProfile | null;
  profiles: EpaProfile[];
  fileDate: string | null;
  retrieved: string | null;
  source: string;
  dictionary: string;
  populationSource: string | null;
  generatedAt: string | null;
};
export type EpaCaseRow = {
  id: string;
  caseNumber: string;
  name: string;
  fy: number;
  settled: string | null;
  settlementFy: number | null;
  typeCode: string;
  statute: string | null;
  states: string[];
  fedPenalty: number;
  sep: number | null;
  defendants: string[];
  dojDocket: string | null;
  nationalCase: { lead: string; records: string[]; combined: number } | null;
  url: string;
};

const KINDS: readonly EpaProfileKind[] = ["national", "state", "territory", "other", "unrecorded"];

function parseYear(raw: unknown): EpaYear | null {
  const r = obj(raw);
  const fy = num(r?.["fy"]);
  if (!r || fy == null) return null;
  return {
    fy,
    cases: int(r["cases"]),
    judicial: int(r["judicial"]),
    administrative: int(r["administrative"]),
    settlements: int(r["settlements"]),
    penaltySettlements: int(r["penalty_settlements"]),
    fedPenalty: int(r["fed_penalty"]),
    sep: int(r["sep"]),
    costRecovery: int(r["cost_recovery"]),
  };
}

function parseGroup(raw: unknown): EpaDefendantGroup | null {
  const r = obj(raw);
  const defendants = strings(r?.["defendants"]);
  if (!r || !defendants.length) return null;
  return {
    defendants,
    nationalCase: strOrNull(r["national_case"]),
    cases: int(r["cases"]),
    judicial: int(r["judicial"]),
    fedPenalty: int(r["fed_penalty"]),
    firstSettlementFy: num(r["first_settlement_fy"]),
    lastSettlementFy: num(r["last_settlement_fy"]),
    statutes: strings(r["statutes"]),
    states: strings(r["states"]),
    caseNumbers: strings(r["case_numbers"]),
  };
}

const list = <T>(v: unknown, parse: (x: unknown) => T | null) =>
  arr(v).flatMap((x) => {
    const p = parse(x);
    return p ? [p] : [];
  });

function parseTopCase(raw: unknown): EpaTopCase | null {
  const tc = obj(raw);
  const penalty = num(tc?.["fed_penalty"]);
  if (!tc || !str(tc["case_number"]) || penalty == null) return null;
  const records = strings(tc["records"]);
  return {
    caseNumber: str(tc["case_number"]),
    name: str(tc["name"]) || str(tc["case_number"]),
    fy: num(tc["fy"]),
    settled: strOrNull(tc["settled"]),
    settlementFy: num(tc["settlement_fy"]),
    type: strOrNull(tc["type"]),
    statute: strOrNull(tc["statute"]),
    fedPenalty: penalty,
    records: records.length ? records : [str(tc["case_number"])],
    defendants: strings(tc["defendants"]),
    inCasesDataset: tc["in_cases_dataset"] === true,
  };
}

function parseNationalGroup(raw: unknown): EpaNationalGroup | null {
  const g = obj(raw);
  const records = strings(g?.["records"]);
  const combined = num(g?.["combined_fed_penalty"]);
  if (!g || !str(g["lead_case_number"]) || records.length < 2 || combined == null) return null;
  return {
    leadCaseNumber: str(g["lead_case_number"]),
    leadName: str(g["lead_name"]),
    records,
    perRecord: int(g["fed_penalty_per_record"]),
    combined,
    states: strings(g["states"]),
  };
}

/** Validate one stored state profile; years before minFy are dropped to keep the payload small. */
export function parseProfile(id: string, raw: unknown, minFy = 1990): EpaProfile | null {
  const r = obj(raw);
  if (!r) return null;
  const kind = str(r["kind"]) as EpaProfileKind;
  const totals = obj(r["totals"]);
  if (!KINDS.includes(kind) || !str(r["code"]) || !totals) return null;
  const population = obj(r["population"]);
  const look = obj(r["possible_duplicates"]);
  return {
    id,
    code: str(r["code"]),
    name: str(r["name"]) || str(r["code"]),
    kind,
    fips: strOrNull(r["fips"]),
    totals: {
      cases: int(totals["cases"]),
      judicial: int(totals["judicial"]),
      administrative: int(totals["administrative"]),
      penaltySettlements: int(totals["penalty_settlements"]),
      fedPenalty: int(totals["fed_penalty"]),
      sep: int(totals["sep"]),
      costRecovery: int(totals["cost_recovery"]),
      multistateCases: int(totals["multistate_cases"]),
      unattributedFedPenalty: int(obj(totals["unattributed"])?.["fed_penalty"]),
    },
    years: list(r["years"], parseYear).filter((y) => y.fy >= minFy),
    statutes: arr(r["statutes"]).flatMap((s) => {
      const st = obj(s);
      if (!st) return [];
      return [
        {
          code: strOrNull(st["code"]),
          name: str(st["name"]) || "Not recorded",
          cases: int(st["cases"]),
          judicial: int(st["judicial"]),
          fedPenalty: int(st["fed_penalty"]),
          sep: int(st["sep"]),
          citedCases: num(st["cited_cases"]),
          years: arr(st["years"]).flatMap((y) => {
            const p = obj(y);
            const fy = num(p?.["fy"]);
            return p && fy != null && fy >= minFy
              ? [{ fy, cases: int(p["cases"]), fedPenalty: int(p["fed_penalty"]) }]
              : [];
          }),
        },
      ];
    }),
    topDefendantGroups: list(r["top_defendant_groups"], parseGroup),
    topDefendantGroupsRecent: list(r["top_defendant_groups_recent"], parseGroup),
    topCases: list(r["top_cases"], parseTopCase),
    nationalGroups: list(r["national_case_groups"], parseNationalGroup),
    lookalikes: look
      ? {
          groups: int(look["groups"]),
          cases: int(look["cases"]),
          extraFedPenalty: int(look["extra_fed_penalty"]),
        }
      : null,
    population: num(population?.["value"]),
    populationYear: num(population?.["year"]),
  };
}

type DatasetMeta = { metadata: { summary?: Record<string, unknown> } | null };
const TTL = 10 * 60 * 1000;
let epaCache: { at: number; value: EpaEnforcement } | null = null;
let caseCache: { at: number; value: EpaCaseRow[] } | null = null;
let cpscCache: { at: number; value: CpscAnalytics } | null = null;

export type EpaStateDetail = {
  code: string;
  statutes: EpaStatute[];
  topDefendantGroups: EpaDefendantGroup[];
  topDefendantGroupsRecent: EpaDefendantGroup[];
  topCases: EpaTopCase[];
};

/** Strip per-state series and ranking lists from the overview payload (they load per state on demand). */
function compactProfile(p: EpaProfile): EpaProfile {
  return {
    ...p,
    years: p.years.filter((y) => y.fy >= 2000),
    statutes: p.statutes.map((s) => ({ ...s, years: [] })),
    topDefendantGroups: [],
    topDefendantGroupsRecent: [],
    topCases: [],
  };
}

export const getEpaEnforcement = createServerFn({ method: "GET" }).handler(
  async (): Promise<EpaEnforcement> => {
    if (epaCache && Date.now() - epaCache.at < TTL) return epaCache.value;
    const [records, catalog] = await Promise.all([
      restGet<{ id: string; p: unknown }[]>(
        "corpus_records?select=id,p:item->profile&dataset=eq.regulatory_epa_state_profiles&order=ordinal.asc&limit=500",
      ),
      restGet<DatasetMeta[]>(
        "corpus_datasets?select=metadata&id=eq.regulatory_epa_state_profiles&limit=1",
      ),
    ]);
    const profiles = records.rows.flatMap(({ id, p }) => {
      const parsed = parseProfile(id, p);
      return parsed ? [parsed] : [];
    });
    const summary = catalog.rows[0]?.metadata?.summary ?? {};
    const value: EpaEnforcement = {
      national: profiles.find((p) => p.kind === "national") ?? null,
      profiles: profiles.filter((p) => p.kind !== "national").map(compactProfile),
      fileDate: strOrNull(summary["file_date"]),
      retrieved: strOrNull(summary["retrieved"]),
      source:
        str(summary["source"]) || "https://echo.epa.gov/files/echodownloads/case_downloads.zip",
      dictionary:
        str(summary["dictionary"]) ||
        "https://echo.epa.gov/tools/data-downloads/icis-fec-download-summary",
      populationSource: strOrNull(summary["population"]),
      generatedAt: strOrNull(summary["generated_at"]),
    };
    epaCache = { at: Date.now(), value };
    return value;
  },
);

const detailCache = new Map<string, { at: number; value: EpaStateDetail | null }>();

export const getEpaStateDetail = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ code: z.string().regex(/^[A-Z]{2}$/) }).parse(d))
  .handler(async ({ data }): Promise<EpaStateDetail | null> => {
    const hit = detailCache.get(data.code);
    if (hit && Date.now() - hit.at < TTL) return hit.value;
    const id = `epa-profile:${data.code}`;
    const res = await restGet<{ id: string; p: unknown }[]>(
      `corpus_records?select=id,p:item->profile&dataset=eq.regulatory_epa_state_profiles&id=eq.${encodeURIComponent(id)}&limit=1`,
    );
    const row = res.rows[0];
    const parsed = row ? parseProfile(row.id, row.p) : null;
    const value = parsed
      ? {
          code: parsed.code,
          statutes: parsed.statutes,
          topDefendantGroups: parsed.topDefendantGroups,
          topDefendantGroupsRecent: parsed.topDefendantGroupsRecent,
          topCases: parsed.topCases,
        }
      : null;
    detailCache.set(data.code, { at: Date.now(), value });
    return value;
  });

/** Validate one compact case row selected from regulatory_epa_cases. */
export function parseCaseRow(raw: unknown): EpaCaseRow | null {
  const r = obj(raw);
  if (!r) return null;
  const caseNumber = str(r["n"]);
  const fy = num(r["fy"]);
  const pen = obj(r["pen"]);
  const fedPenalty = num(pen?.["fed_penalty"]);
  const url = str(r["url"]);
  if (!caseNumber || fy == null || fedPenalty == null || !/^https:\/\/echo\.epa\.gov\//.test(url))
    return null;
  const nc = obj(r["nc"]);
  const records = strings(nc?.["records"]);
  const combined = num(nc?.["combined_fed_penalty"]);
  return {
    id: str(r["id"]),
    caseNumber,
    name: str(r["name"]) || caseNumber,
    fy,
    settled: strOrNull(r["settled"]),
    settlementFy: num(r["sfy"]),
    typeCode: str(r["t"]),
    statute: strOrNull(r["st"]),
    states: strings(r["states"]),
    fedPenalty,
    sep: num(pen?.["sep"]),
    defendants: strings(r["def"]).slice(0, 4),
    dojDocket: strOrNull(r["doj"]),
    nationalCase:
      nc && str(nc["lead_case_number"]) && records.length > 1 && combined != null
        ? { lead: str(nc["lead_case_number"]), records, combined }
        : null,
    url,
  };
}

export const getEpaCases = createServerFn({ method: "GET" }).handler(
  async (): Promise<EpaCaseRow[]> => {
    if (caseCache && Date.now() - caseCache.at < TTL) return caseCache.value;
    const select = [
      "id",
      "url:source_url",
      "n:item->case->>case_number",
      "name:item->case->>name",
      "fy:item->case->fy",
      "settled:item->case->>settled",
      "sfy:item->case->settlement_fy",
      "t:item->case->>type_code",
      "st:item->case->>primary_statute",
      "states:item->case->states",
      "pen:item->case->penalties",
      "def:item->case->defendants",
      "doj:item->case->>doj_docket",
      "nc:item->case->national_case",
    ].join(",");
    const rows: unknown[] = [];
    for (let start = 0; start < 20000; start += 1000) {
      const page = await restGet<unknown[]>(
        `corpus_records?select=${select}&dataset=eq.regulatory_epa_cases&order=ordinal.asc`,
        { range: [start, start + 999] },
      );
      rows.push(...page.rows);
      if (page.rows.length < 1000) break;
    }
    const value = rows.flatMap((r) => {
      const parsed = parseCaseRow(r);
      return parsed ? [parsed] : [];
    });
    caseCache = { at: Date.now(), value };
    return value;
  },
);

// ---------------------------------------------------------------- CPSC

export type CpscYear = {
  year: number;
  partial: boolean;
  recalls: number;
  withCountry: number;
  hazards: Record<string, number>;
  countries: Record<string, number>;
  hazardCountry: Record<string, Record<string, number>>;
  /** Product-related death mentions (background/other-product/animal mentions excluded). */
  deathMentions: number;
  deathBackground: number;
  deathForeignOnly: number;
  injuryMentions: number;
  noneReported: number;
  injuryTextMissing: number;
  standardViolation: number;
  unitsParsed: number;
  unitsSum: number;
};
export type CpscHazard = {
  key: string;
  label: string;
  rule: string;
  recalls: number;
  deathMentions: number;
  years: { year: number; recalls: number; deathMentions: number }[];
  countries: Record<string, number>;
};
export type CpscFirm = {
  id: string;
  name: string;
  recalls: number;
  recent24m: number;
  deathMentions: number;
  firstDate: string | null;
  lastDate: string | null;
  roles: Record<string, number>;
  topHazards: string[];
  latest: { recallNumber: string; date: string | null; title: string }[];
};
export type CpscDeathRecall = {
  id: string;
  recallNumber: string;
  date: string | null;
  title: string;
  injuries: string;
  firms: string[];
  hazards: string[];
  foreignOnly: boolean;
  url: string | null;
};
export type CpscAnalytics = {
  recalls: number;
  asOf: string | null;
  retrieved: string | null;
  firstDate: string | null;
  hazardLabels: Record<string, string>;
  hazardRules: Record<string, string>;
  standardRule: string;
  topCountries: string[];
  firmMin: number;
  firmWindowStart: string | null;
  withCountry: number;
  apiDoc: string;
  deathRule: string;
  years: CpscYear[];
  hazards: CpscHazard[];
  countries: { country: string; recalls: number; years: { year: number; recalls: number }[] }[];
  topFirms: CpscFirm[];
  firmClusters: CpscFirm[];
  deathRecalls: CpscDeathRecall[];
};

function parseFirm(raw: unknown): CpscFirm | null {
  const r = obj(raw);
  if (!r || !str(r["name"]) || !str(r["id"])) return null;
  return {
    id: str(r["id"]),
    name: str(r["name"]),
    recalls: int(r["recalls"]),
    recent24m: int(r["recent_24m"]),
    deathMentions: int(r["death_mentions"]),
    firstDate: strOrNull(r["first_date"]),
    lastDate: strOrNull(r["last_date"]),
    roles: counts(r["roles"]),
    topHazards: strings(r["top_hazards"]),
    latest: arr(r["latest"]).flatMap((x) => {
      const l = obj(x);
      return l && str(l["recall_number"])
        ? [
            {
              recallNumber: str(l["recall_number"]),
              date: strOrNull(l["date"]),
              title: str(l["title"]),
            },
          ]
        : [];
    }),
  };
}

/** Assemble validated CPSC analytics from aggregate records ({kind, ...}) and death-mention recall rows. */
export function parseCpsc(aggs: unknown[], deaths: unknown[]): CpscAnalytics | null {
  const items = aggs.map(obj).filter((a): a is Record<string, unknown> => !!a);
  const overview = items.find((a) => a["kind"] === "overview");
  if (!overview) return null;
  const years = items.flatMap((a): CpscYear[] => {
    const year = num(a["year"]);
    if (a["kind"] !== "year" || year == null) return [];
    const cube: Record<string, Record<string, number>> = {};
    for (const [k, v] of Object.entries(obj(a["hazard_country"]) ?? {})) cube[k] = counts(v);
    return [
      {
        year,
        partial: a["partial"] === true,
        recalls: int(a["recalls"]),
        withCountry: int(a["with_country"]),
        hazards: counts(a["hazards"]),
        countries: counts(a["countries"]),
        hazardCountry: cube,
        deathMentions: int(a["death_mentions"]),
        deathBackground: int(a["death_background"]),
        deathForeignOnly: int(a["death_foreign_only"]),
        injuryMentions: int(a["injury_mentions"]),
        noneReported: int(a["none_reported"]),
        injuryTextMissing: int(a["injury_text_missing"]),
        standardViolation: int(a["standard_violation"]),
        unitsParsed: int(a["units_parsed_recalls"]),
        unitsSum: int(a["units_sum"]),
      },
    ];
  });
  const hazards = items.flatMap((a): CpscHazard[] => {
    if (a["kind"] !== "hazard" || !str(a["key"])) return [];
    return [
      {
        key: str(a["key"]),
        label: str(a["label"]) || str(a["key"]),
        rule: str(a["rule"]),
        recalls: int(a["recalls"]),
        deathMentions: int(a["death_mentions"]),
        years: arr(a["years"]).flatMap((y) => {
          const p = obj(y);
          const year = num(p?.["year"]);
          return p && year != null
            ? [{ year, recalls: int(p["recalls"]), deathMentions: int(p["death_mentions"]) }]
            : [];
        }),
        countries: counts(a["countries"]),
      },
    ];
  });
  const countries = items.flatMap((a) => {
    if (a["kind"] !== "country" || !str(a["country"])) return [];
    return [
      {
        country: str(a["country"]),
        recalls: int(a["recalls"]),
        years: arr(a["years"]).flatMap((y) => {
          const p = obj(y);
          const year = num(p?.["year"]);
          return p && year != null ? [{ year, recalls: int(p["recalls"]) }] : [];
        }),
      },
    ];
  });
  const labels: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj(overview["hazard_labels"]) ?? {}))
    if (typeof v === "string") labels[k] = v;
  const rules: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj(overview["hazard_rules"]) ?? {}))
    if (typeof v === "string") rules[k] = v;
  return {
    recalls: int(overview["recalls"]),
    asOf: strOrNull(overview["as_of"]),
    retrieved: strOrNull(overview["retrieved"]),
    firstDate: strOrNull(overview["first_date"]),
    hazardLabels: labels,
    hazardRules: rules,
    standardRule: str(overview["standard_rule"]),
    topCountries: strings(overview["top_countries"]),
    firmMin: int(overview["firm_min"]) || 3,
    firmWindowStart: strOrNull(overview["firm_window_start"]),
    withCountry: int(overview["with_country"]),
    apiDoc: str(overview["api_doc"]),
    deathRule: str(overview["death_rule"]),
    years: years.sort((a, b) => a.year - b.year),
    hazards,
    countries: countries.sort((a, b) => b.recalls - a.recalls),
    topFirms: arr(overview["top_firms"]).flatMap((f) => {
      const p = parseFirm(f);
      return p ? [p] : [];
    }),
    firmClusters: arr(overview["firm_clusters"]).flatMap((f) => {
      const p = parseFirm(f);
      return p ? [p] : [];
    }),
    deathRecalls: deaths.flatMap((d) => {
      const r = obj(d);
      if (!r || !str(r["n"]) || !str(r["id"])) return [];
      const url = str(r["u"]);
      return [
        {
          id: str(r["id"]),
          recallNumber: str(r["n"]),
          date: strOrNull(r["d"]),
          title: str(r["t"]) || `Recall ${str(r["n"])}`,
          injuries: str(r["i"]),
          firms: [...strings(r["m"]), ...strings(r["im"])].slice(0, 3),
          hazards: strings(r["h"]),
          foreignOnly: r["f"] === true,
          url: /^https:\/\/(www\.)?cpsc\.gov\//.test(url) ? url : null,
        },
      ];
    }),
  };
}

export const getCpscAnalytics = createServerFn({ method: "GET" }).handler(
  async (): Promise<CpscAnalytics | null> => {
    if (cpscCache && Date.now() - cpscCache.at < TTL) return cpscCache.value;
    const deathSelect = [
      "id",
      "n:item->recall->>recall_number",
      "d:item->recall->>date",
      "t:item->recall->>title",
      "i:item->recall->>injuries",
      "u:item->recall->>url",
      "m:item->recall->manufacturers",
      "im:item->recall->importers",
      "h:item->recall->hazard_categories",
      "f:item->recall->death_foreign_only",
    ].join(",");
    const [aggs, deaths] = await Promise.all([
      restGet<{ a: unknown }[]>(
        "corpus_records?select=a:item->agg&dataset=eq.regulatory_cpsc_aggregates&id=not.like.cpsc-agg:firm:*&order=ordinal.asc&limit=1000",
      ),
      restGet<unknown[]>(
        `corpus_records?select=${deathSelect}&dataset=eq.agency_safety_cpsc_recalls_api&filters->death_mention=cs.${encodeURIComponent('["product"]')}&order=ordinal.desc&limit=30`,
      ),
    ]);
    const value = parseCpsc(
      aggs.rows.map((r) => r.a),
      deaths.rows,
    );
    if (value) cpscCache = { at: Date.now(), value };
    return value;
  },
);
