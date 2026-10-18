/**
 * Settlement notices (settlement_notices) and the enforcement data sources catalog (enforcement_data_sources_catalog).
 * Both are compiled records built by scripts/enrichment/third_party_data: every settlement row cites an official page and
 * carries its own verification status; catalog rows list an agency's own enforcement-data page and no penalty data.
 * Stored JSON is validated here; malformed rows are dropped, never repaired.
 */
import { createServerFn } from "@tanstack/react-start";
import { restGet } from "./rest.server";

const strOrNull = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
const obj = (v: unknown) =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

export const VERIFICATIONS = [
  "Verified",
  "Partially verified",
  "Matter only",
  "Contradicted",
  "Not verified",
] as const;
export type Verification = (typeof VERIFICATIONS)[number];

export type SettlementNotice = {
  id: string;
  title: string;
  type: string | null;
  /** The status as compiled on the check date; compare `deadline` with today for the live window. */
  status: string | null;
  /** ISO date (YYYY-MM-DD) or null when the compiled record states none. */
  deadline: string | null;
  states: string | null;
  officialSource: string | null;
  verification: Verification;
  sourceUrl: string;
};

export type EnforcementSource = {
  id: string;
  agency: string;
  jurisdiction: string | null;
  level: string | null;
  covers: string | null;
  sourceType: string | null;
  host: string | null;
  urlCheck: string | null;
  /** How many corpus datasets already come from this source's host (stored as text); null when not recorded. */
  datasetCount: number | null;
  sourceUrl: string;
};

const DAY = 86_400_000;
/** Whole days from `from` to `to` (both YYYY-MM-DD), calendar-day arithmetic in UTC. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const count = (v: unknown) => {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : NaN;
  return Number.isInteger(n) && n >= 0 ? n : null;
};

export function parseSettlementNotices(
  rows: { id?: unknown; title?: unknown; source_url?: unknown; cells?: unknown }[],
): SettlementNotice[] {
  return rows.flatMap((row) => {
    const id = strOrNull(row.id);
    const title = strOrNull(row.title);
    const sourceUrl = strOrNull(row.source_url);
    const c = obj(row.cells);
    const verification = VERIFICATIONS.find((v) => v === c?.["verification"]);
    if (!id || !title || !sourceUrl || !c || !verification) return [];
    const deadline = strOrNull(c["deadline"]);
    return [
      {
        id,
        title,
        type: strOrNull(c["type"]),
        status: strOrNull(c["status"]),
        deadline: deadline && ISO_DATE.test(deadline) ? deadline : null,
        states: strOrNull(c["states"]),
        officialSource: strOrNull(c["official_source"]),
        verification,
        sourceUrl,
      },
    ];
  });
}

export function parseEnforcementSources(
  rows: { id?: unknown; source_url?: unknown; cells?: unknown }[],
): EnforcementSource[] {
  return rows.flatMap((row) => {
    const id = strOrNull(row.id);
    const sourceUrl = strOrNull(row.source_url);
    const c = obj(row.cells);
    const agency = strOrNull(c?.["agency"]);
    if (!id || !sourceUrl || !c || !agency) return [];
    return [
      {
        id,
        agency,
        jurisdiction: strOrNull(c["jurisdiction"]),
        level: strOrNull(c["level"]),
        covers: strOrNull(c["covers"]),
        sourceType: strOrNull(c["source_type"]),
        host: strOrNull(c["official_url"]),
        urlCheck: strOrNull(c["url_check"]),
        datasetCount: count(c["corpus_datasets"]),
        sourceUrl,
      },
    ];
  });
}

const TTL = 10 * 60 * 1000;
let noticesCache: { at: number; value: SettlementNotice[] } | null = null;
let sourcesCache: { at: number; value: EnforcementSource[] } | null = null;

export const getSettlementNotices = createServerFn({ method: "GET" }).handler(
  async (): Promise<SettlementNotice[]> => {
    if (noticesCache && Date.now() - noticesCache.at < TTL) return noticesCache.value;
    const { rows } = await restGet<
      { id: unknown; title: unknown; source_url: unknown; cells: unknown }[]
    >(
      "corpus_records?select=id,title,source_url,cells:item->cells&dataset=eq.settlement_notices&order=ordinal.asc&limit=1000",
    );
    const value = parseSettlementNotices(rows);
    if (value.length) noticesCache = { at: Date.now(), value };
    return value;
  },
);

export const getEnforcementSources = createServerFn({ method: "GET" }).handler(
  async (): Promise<EnforcementSource[]> => {
    if (sourcesCache && Date.now() - sourcesCache.at < TTL) return sourcesCache.value;
    const { rows } = await restGet<{ id: unknown; source_url: unknown; cells: unknown }[]>(
      "corpus_records?select=id,source_url,cells:item->cells&dataset=eq.enforcement_data_sources_catalog&order=ordinal.asc&limit=1000",
    );
    const value = parseEnforcementSources(rows);
    if (value.length) sourcesCache = { at: Date.now(), value };
    return value;
  },
);
