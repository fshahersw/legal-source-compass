/** Federal Register rulemaking activity by agency, built by scripts/enrichment/rulemaking/build_rulemaking.py. */
import { createServerFn } from "@tanstack/react-start";
import { restGet } from "./rest.server";

export const DOC_TYPES = ["RULE", "PRORULE", "NOTICE"] as const;
export type DocType = (typeof DOC_TYPES)[number];
export type Series = Record<string, number>;
export type ActivityFlag = {
  recent: number;
  baselineAnnual: number;
  ratio: number | null;
  window: string;
  baselineWindow: string;
  surprise: number;
  flag: "surge" | "slowdown" | null;
};
export type SignificantRule = {
  title: string;
  date: string;
  citation: string | null;
  url: string;
  documentNumber: string | null;
  abstract: string | null;
  effectiveOn: string | null;
  cfr: string[];
};
export type AgencyActivity = {
  slug: string;
  short: string;
  name: string;
  yearly: Record<DocType, Series>;
  monthly: Record<DocType, Series>;
  significantYearly: { RULE: Series; PRORULE: Series };
  significantFinalRulesTotal: number | null;
  latestSignificantRules: SignificantRule[];
  partialMonth: string;
  partialYear: string;
  flags: Partial<Record<DocType, ActivityFlag>>;
};
export type RulemakingData = { asOf: string | null; agencies: AgencyActivity[] };

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const str = (v: unknown) => (typeof v === "string" ? v : "");

function series(raw: unknown): Series {
  const out: Series = {};
  if (raw && typeof raw === "object")
    for (const [k, v] of Object.entries(raw as Record<string, unknown>))
      if (/^\d{4}(-\d{2})?$/.test(k) && isNum(v)) out[k] = v;
  return out;
}
function bySeries<K extends string>(raw: unknown, keys: readonly K[]): Record<K, Series> {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return Object.fromEntries(keys.map((k) => [k, series(r[k])])) as Record<K, Series>;
}
function flag(raw: unknown): ActivityFlag | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!isNum(r["recent"]) || !isNum(r["baselineAnnual"])) return null;
  const f = r["flag"];
  return {
    recent: r["recent"],
    baselineAnnual: r["baselineAnnual"],
    ratio: isNum(r["ratio"]) ? r["ratio"] : null,
    window: str(r["window"]),
    baselineWindow: str(r["baselineWindow"]),
    surprise: isNum(r["surprise"]) ? r["surprise"] : 0,
    flag: f === "surge" || f === "slowdown" ? f : null,
  };
}

/** Validate one stored agency record; malformed records are dropped, never patched with guesses. */
export function parseActivity(raw: unknown): AgencyActivity | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!str(r["slug"]) || !str(r["short"]) || !str(r["name"])) return null;
  const flags: Partial<Record<DocType, ActivityFlag>> = {};
  const rawFlags = (r["flags"] && typeof r["flags"] === "object" ? r["flags"] : {}) as Record<
    string,
    unknown
  >;
  for (const t of DOC_TYPES) {
    const f = flag(rawFlags[t]);
    if (f) flags[t] = f;
  }
  const latest = Array.isArray(r["latestSignificantRules"]) ? r["latestSignificantRules"] : [];
  return {
    slug: str(r["slug"]),
    short: str(r["short"]),
    name: str(r["name"]),
    yearly: bySeries(r["yearly"], DOC_TYPES),
    monthly: bySeries(r["monthly"], DOC_TYPES),
    significantYearly: bySeries(r["significantYearly"], ["RULE", "PRORULE"] as const),
    significantFinalRulesTotal: isNum(r["significantFinalRulesTotal"])
      ? r["significantFinalRulesTotal"]
      : null,
    latestSignificantRules: latest.flatMap((x) => {
      const d = (x ?? {}) as Record<string, unknown>;
      const url = str(d["url"]);
      if (!str(d["title"]) || !/^https:\/\/www\.federalregister\.gov\//.test(url)) return [];
      return [
        {
          title: str(d["title"]),
          date: str(d["date"]),
          citation: str(d["citation"]) || null,
          url,
          documentNumber: str(d["document_number"]) || null,
          abstract: str(d["abstract"]) || null,
          effectiveOn: str(d["effective_on"]) || null,
          cfr: Array.isArray(d["cfr"])
            ? d["cfr"].filter((c): c is string => typeof c === "string")
            : [],
        },
      ];
    }),
    partialMonth: str(r["partialMonth"]),
    partialYear: str(r["partialYear"]),
    flags,
  };
}

let cache: { at: number; value: RulemakingData } | null = null;

export const getRulemakingActivity = createServerFn({ method: "GET" }).handler(
  async (): Promise<RulemakingData> => {
    if (cache && Date.now() - cache.at < 10 * 60 * 1000) return cache.value;
    const [records, catalog] = await Promise.all([
      restGet<{ item: { activity?: unknown } }[]>(
        "corpus_records?select=item&dataset=eq.regulatory_federal_register_activity&order=ordinal.asc&limit=100",
      ),
      restGet<{ metadata: { summary?: { as_of?: string } } | null }[]>(
        "corpus_datasets?select=metadata&id=eq.regulatory_federal_register_activity&limit=1",
      ),
    ]);
    const value = {
      asOf: catalog.rows[0]?.metadata?.summary?.as_of ?? null,
      agencies: records.rows.flatMap(({ item }) => {
        const a = parseActivity(item?.activity);
        return a ? [a] : [];
      }),
    };
    cache = { at: Date.now(), value };
    return value;
  },
);
