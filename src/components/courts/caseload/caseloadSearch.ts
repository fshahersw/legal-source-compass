/**
 * URL search state for /courts/caseload. Anything unrecognised is dropped rather than guessed, and each tab keeps only
 * its own parameters so a stale filter from another tab never lingers in the address.
 */

export type CaseloadTab = "districts" | "nos" | "mdl" | "method";
export const CASELOAD_TABS: readonly CaseloadTab[] = ["districts", "nos", "mdl", "method"];

export type CaseloadSearch = {
  tab?: CaseloadTab | undefined;
  /** Districts: selected district id, circuit id, state code. */
  court?: string | undefined;
  circuit?: string | undefined;
  state?: string | undefined;
  /** Nature of suit: selected record id ("nos:365" or "group:product"), kind, group key, active-only. */
  nos?: string | undefined;
  kind?: "nos" | "group" | undefined;
  group?: string | undefined;
  active?: "yes" | undefined;
  /** MDL association: selected MDL number, JPML filter, pending filter. */
  mdl?: number | undefined;
  jpml?: "yes" | "no" | undefined;
  pending?: "yes" | undefined;
  /** Search text and sort, shared by the three tables ("-filings" is descending). */
  q?: string | undefined;
  sort?: string | undefined;
};

type Key = keyof CaseloadSearch;

const TAB_KEYS: Record<CaseloadTab, readonly Key[]> = {
  districts: ["court", "circuit", "state", "q", "sort"],
  nos: ["nos", "kind", "group", "active", "q", "sort"],
  mdl: ["mdl", "jpml", "pending", "q", "sort"],
  method: [],
};

const text = (v: unknown, max = 80) => {
  const s = typeof v === "string" ? v.trim() : "";
  return s && s.length <= max ? s : undefined;
};
const matching = (v: unknown, re: RegExp) => {
  const s = text(v, 60);
  return s && re.test(s) ? s : undefined;
};

/** An MDL number from a number or digits in the address; a number keeps the address clean (mdl=2738, not mdl="2738"). */
const mdlNumber = (v: unknown) => {
  const n =
    typeof v === "number" ? v : typeof v === "string" && /^\d{1,5}$/.test(v) ? Number(v) : NaN;
  return Number.isInteger(n) && n >= 0 && n <= 99999 ? n : undefined;
};

export const COURT_ID = /^[a-z]{2,8}$/;
export const NOS_RECORD_ID = /^(nos:\d{3}|group:[a-z_]{2,40})$/;

export function normalizeCaseloadSearch(raw: Record<string, unknown>): CaseloadSearch {
  const tab = CASELOAD_TABS.find((t) => t === raw["tab"]);
  const active: CaseloadTab = tab ?? "districts";
  const values: Partial<Record<Key, string | number | undefined>> = {
    court: matching(raw["court"], COURT_ID),
    circuit: matching(raw["circuit"], /^(cadc|ca\d{1,2})$/),
    state: matching(raw["state"], /^[A-Z]{2}$/),
    nos: matching(raw["nos"], NOS_RECORD_ID),
    kind: raw["kind"] === "nos" || raw["kind"] === "group" ? raw["kind"] : undefined,
    group: matching(raw["group"], /^[a-z_]{2,40}$/),
    active: raw["active"] === "yes" ? "yes" : undefined,
    mdl: mdlNumber(raw["mdl"]),
    jpml: raw["jpml"] === "yes" || raw["jpml"] === "no" ? raw["jpml"] : undefined,
    pending: raw["pending"] === "yes" ? "yes" : undefined,
    q: text(typeof raw["q"] === "number" ? String(raw["q"]) : raw["q"]),
    sort: matching(raw["sort"], /^-?[a-zA-Z]{2,24}$/),
  };
  const out: Record<string, string | number> = {};
  if (tab && tab !== "districts") out["tab"] = tab;
  for (const key of TAB_KEYS[active]) {
    const v = values[key];
    if (v !== undefined) out[key] = v;
  }
  return out as CaseloadSearch;
}

/** The current search with `patch` applied (an undefined value removes the key), re-normalized for the tab. */
export function patchSearch(
  current: CaseloadSearch,
  patch: Partial<CaseloadSearch>,
): CaseloadSearch {
  return normalizeCaseloadSearch({ ...current, ...patch });
}

/** The search for opening a tab: its own parameters only. */
export function tabSearch(tab: CaseloadTab, extra: Partial<CaseloadSearch> = {}): CaseloadSearch {
  return normalizeCaseloadSearch({ ...extra, tab });
}
