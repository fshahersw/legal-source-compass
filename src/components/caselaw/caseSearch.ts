/** URL state of /cases (pure; validated, unknown values dropped). */
export type CaseMode = "cases" | "fulltext" | "live";
export type CaseSort = "relevance" | "cited" | "newest" | "oldest";
export type CaseSearchState = {
  mode?: CaseMode | undefined;
  q?: string | undefined;
  tier?: 1 | 2 | 3 | undefined;
  court?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  status?: string | undefined;
  sort?: CaseSort | undefined;
  page?: number | undefined;
  semantic?: boolean | undefined;
  cursor?: string | undefined;
};

export const STATUSES = [
  "Published",
  "Unpublished",
  "Errata",
  "Separate",
  "In-chambers",
  "Relating-to",
  "Unknown",
] as const;
const MODES: CaseMode[] = ["cases", "fulltext", "live"];
const SORTS: CaseSort[] = ["relevance", "cited", "newest", "oldest"];
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const validDay = (v: unknown) => {
  if (typeof v !== "string" || !DAY.test(v)) return undefined;
  const t = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(t.getTime()) || t.toISOString().slice(0, 10) !== v ? undefined : v;
};

export function normalizeCaseSearch(s: Record<string, unknown>): CaseSearchState {
  const out: CaseSearchState = {};
  if (typeof s["mode"] === "string" && (MODES as string[]).includes(s["mode"]))
    out.mode = s["mode"] as CaseMode;
  if (typeof s["q"] === "string" && s["q"].trim()) out.q = s["q"].slice(0, 300);
  const tier =
    typeof s["tier"] === "number"
      ? s["tier"]
      : typeof s["tier"] === "string"
        ? Number(s["tier"])
        : NaN;
  if (tier === 1 || tier === 2 || tier === 3) out.tier = tier;
  if (typeof s["court"] === "string" && /^[a-z0-9_-]{1,40}$/.test(s["court"]))
    out.court = s["court"];
  out.from = validDay(s["from"]);
  out.to = validDay(s["to"]);
  if (typeof s["status"] === "string" && (STATUSES as readonly string[]).includes(s["status"]))
    out.status = s["status"];
  if (typeof s["sort"] === "string" && (SORTS as string[]).includes(s["sort"]))
    out.sort = s["sort"] as CaseSort;
  const page =
    typeof s["page"] === "number"
      ? s["page"]
      : typeof s["page"] === "string"
        ? Number(s["page"])
        : NaN;
  if (Number.isInteger(page) && page >= 2 && page <= 100) out.page = page;
  if (s["semantic"] === true || s["semantic"] === "true") out.semantic = true;
  if (typeof s["cursor"] === "string" && /^[A-Za-z0-9%=_-]{1,400}$/.test(s["cursor"]))
    out.cursor = s["cursor"];
  for (const k of Object.keys(out) as (keyof CaseSearchState)[])
    if (out[k] === undefined) delete out[k];
  return out;
}

/** The live service covers the federal appellate and state tiers only; the Supreme Court is searched here. */
export function liveTier(tier: number | undefined): 2 | 3 | null {
  return tier === 2 || tier === 3 ? tier : null;
}

export const SORT_LABEL: Record<CaseSort, string> = {
  relevance: "Best match",
  cited: "Most cited",
  newest: "Newest",
  oldest: "Oldest",
};
export const MODE_LABEL: Record<CaseMode, string> = {
  cases: "Names & citations",
  fulltext: "Supreme Court full text",
  live: "Appellate & state full text",
};
