import {
  FIRM_RECORD,
  FIRM_SORTS,
  type FirmSort,
  type Side,
} from "@/lib/external/firmIntel.functions";

export type FirmSearch = {
  side?: Side | undefined;
  q?: string | undefined;
  sort?: FirmSort | undefined;
  page?: number | undefined;
  firm?: string | undefined;
  mdl?: number | undefined;
};

const SIDES = new Set(["plaintiff", "defense", "other"]);

/** Keeps only values the page understands; anything else falls back to the default (left out of the address). */
export function normalizeFirmSearch(raw: Record<string, unknown>): FirmSearch {
  const out: FirmSearch = {};
  if (typeof raw["side"] === "string" && SIDES.has(raw["side"])) out.side = raw["side"] as Side;
  if (typeof raw["q"] === "string") {
    const q = raw["q"].replace(/\s+/g, " ").trim().slice(0, 80);
    if (q) out.q = q;
  }
  if (
    typeof raw["sort"] === "string" &&
    (FIRM_SORTS as readonly string[]).includes(raw["sort"]) &&
    raw["sort"] !== "appearances"
  )
    out.sort = raw["sort"] as FirmSort;
  const page = Number(raw["page"]);
  if (Number.isInteger(page) && page > 1 && page <= 100) out.page = page;
  if (typeof raw["firm"] === "string" && FIRM_RECORD.test(raw["firm"])) out.firm = raw["firm"];
  const mdl = Number(raw["mdl"]);
  if (Number.isInteger(mdl) && mdl > 0 && mdl < 100000) out.mdl = mdl;
  return out;
}

/** A new search with `patch` applied; filter changes go back to the first page. */
export function patchFirmSearch(s: FirmSearch, patch: Partial<FirmSearch>): FirmSearch {
  const next: FirmSearch = { ...s, ...patch };
  if ("side" in patch || "q" in patch || "sort" in patch) delete next.page;
  return normalizeFirmSearch(next as Record<string, unknown>);
}
