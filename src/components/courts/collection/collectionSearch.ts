/**
 * URL search state for /courts/collection. Anything unrecognised is dropped rather than guessed, and each tab (and view
 * within a tab) keeps only its own parameters, so a filter from another view never lingers in the address. A default
 * leaves no parameter behind.
 */

export const COLLECTION_TABS = ["dockets", "citations", "cited", "disclosures", "schema"] as const;
export type CollectionTab = (typeof COLLECTION_TABS)[number];

export const DOCKET_VIEWS = ["states", "nos", "causes"] as const;
export type DocketView = (typeof DOCKET_VIEWS)[number];
export const CITATION_VIEWS = ["map", "courts", "edges", "years"] as const;
export type CitationView = (typeof CITATION_VIEWS)[number];

export type CollectionSearch = {
  tab?: CollectionTab | undefined;
  /** Sub-view of the Docket collection or Citations tab. */
  view?: string | undefined;
  /** Search text and sort ("-dockets" is descending), shared by the tables of one view. */
  q?: string | undefined;
  sort?: string | undefined;
  /** The selected row of the view's table: a state code, record id, court id, table name, or (most cited) a cluster id as a number. */
  sel?: string | number | undefined;
  /** Dockets: the selected court level code. Citations and disclosures: the citing/court level filter. */
  level?: string | undefined;
  /** Nature-of-suit group key (dockets) or schema table group (data coverage). */
  group?: string | undefined;
  /** "all" shows every year; the default shows the recent years. */
  span?: "all" | undefined;
  /** Citation map: "count" shows citation links; the default shows row shares. */
  measure?: "count" | undefined;
  /** Citation edges: the cited-court level filter, and "appeal" for appeal flows. */
  to?: string | undefined;
  flow?: "appeal" | undefined;
  /** Most cited: court id and decade filters. */
  court?: string | undefined;
  decade?: number | undefined;
  /** Data coverage: bulk-file and load-status filters. */
  bulk?: "yes" | "no" | undefined;
  loaded?: "none" | "not_loaded" | "selected" | "all" | undefined;
};

type Key = keyof CollectionSearch;

export const DEFAULT_VIEW: Partial<Record<CollectionTab, string>> = {
  dockets: "states",
  citations: "map",
};

const VIEW_KEYS: Record<string, readonly Key[]> = {
  "dockets/states": ["view", "span", "level", "q", "sort", "sel"],
  "dockets/nos": ["view", "span", "level", "q", "sort", "sel", "group"],
  "dockets/causes": ["view", "span", "level", "q", "sort", "sel"],
  "citations/map": ["view", "measure"],
  "citations/courts": ["view", "q", "sort", "level", "sel"],
  "citations/edges": ["view", "flow", "q", "sort", "level", "to"],
  "citations/years": ["view", "span"],
  cited: ["q", "sort", "court", "decade", "sel"],
  disclosures: ["q", "sort", "level"],
  schema: ["q", "sort", "group", "bulk", "loaded", "sel"],
};

const text = (v: unknown, max = 80) => {
  const s = typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
  return s && s.length <= max ? s : undefined;
};
const matching = (v: unknown, re: RegExp) => {
  const s = text(v, 60);
  return s && re.test(s) ? s : undefined;
};

export const STATE_CODE = /^[A-Z]{2}$/;
export const NOS_RECORD_ID = /^(nos:\d{3}|group:[a-z_]{2,40})$/;
export const CAUSE_RECORD_ID = /^cause:\d{3}$/;
export const COURT_ID = /^[A-Za-z0-9]{2,24}$/;
export const TABLE_NAME = /^[a-z][a-z0-9_]{1,80}$/;

/** The row id a view's `sel` may hold. */
function selPattern(tab: CollectionTab, view: string | undefined): RegExp {
  if (tab === "dockets")
    return view === "nos" ? NOS_RECORD_ID : view === "causes" ? CAUSE_RECORD_ID : STATE_CODE;
  if (tab === "citations") return COURT_ID;
  if (tab === "cited") return /^\d{1,10}$/;
  return TABLE_NAME;
}

const numeric = (s: string | undefined) => (s === undefined ? undefined : Number(s));
/** A cluster id stays a number in the address (sel=145875), so the router does not quote it. */
const selValue = (tab: CollectionTab, s: string | undefined) => (tab === "cited" ? numeric(s) : s);

/** The selected row as text, whatever the type it has in the address. */
export const selOf = (search: CollectionSearch): string | undefined =>
  search.sel === undefined ? undefined : String(search.sel);

export function viewOf(tab: CollectionTab, raw: unknown): string | undefined {
  const views: readonly string[] | undefined =
    tab === "dockets" ? DOCKET_VIEWS : tab === "citations" ? CITATION_VIEWS : undefined;
  if (!views) return undefined;
  return views.includes(raw as string) ? (raw as string) : DEFAULT_VIEW[tab];
}

export function normalizeCollectionSearch(raw: Record<string, unknown>): CollectionSearch {
  const tab = COLLECTION_TABS.find((t) => t === raw["tab"]);
  const active: CollectionTab = tab ?? "dockets";
  const view = viewOf(active, raw["view"]);
  const allowed = VIEW_KEYS[view ? `${active}/${view}` : active] ?? [];
  const values: Partial<Record<Key, string | number | undefined>> = {
    view: view && view !== DEFAULT_VIEW[active] ? view : undefined,
    q: text(raw["q"]),
    sort: matching(raw["sort"], /^-?[a-zA-Z]{2,24}$/),
    sel: selValue(active, matching(raw["sel"], selPattern(active, view))),
    level:
      active === "dockets"
        ? matching(raw["level"], /^([A-Za-z]{1,4}|none)$/)
        : matching(raw["level"], /^[A-Za-z][A-Za-z ]{1,38}$/),
    group:
      active === "schema"
        ? matching(raw["group"], /^[a-z_]{2,20}$/)
        : matching(raw["group"], /^[a-z_]{2,40}$/),
    span: raw["span"] === "all" ? "all" : undefined,
    measure: raw["measure"] === "count" ? "count" : undefined,
    to: matching(raw["to"], /^[A-Za-z][A-Za-z ]{1,38}$/),
    flow: raw["flow"] === "appeal" ? "appeal" : undefined,
    court: matching(raw["court"], COURT_ID),
    decade: numeric(matching(raw["decade"], /^\d{3}0$/)),
    bulk: raw["bulk"] === "yes" || raw["bulk"] === "no" ? raw["bulk"] : undefined,
    loaded:
      raw["loaded"] === "none" ||
      raw["loaded"] === "not_loaded" ||
      raw["loaded"] === "selected" ||
      raw["loaded"] === "all"
        ? raw["loaded"]
        : undefined,
  };
  const out: Record<string, string | number> = {};
  if (tab && tab !== "dockets") out["tab"] = tab;
  for (const key of allowed) {
    const v = values[key];
    if (v !== undefined) out[key] = v;
  }
  return out as CollectionSearch;
}

/** The current search with `patch` applied (an undefined value removes the key), re-normalized for the tab and view. */
export function patchSearch(
  current: CollectionSearch,
  patch: Partial<CollectionSearch>,
): CollectionSearch {
  return normalizeCollectionSearch({ ...current, ...patch });
}

/** The search for opening a tab: its own parameters only. */
export function tabSearch(
  tab: CollectionTab,
  extra: Partial<CollectionSearch> = {},
): CollectionSearch {
  return normalizeCollectionSearch({ ...extra, tab });
}

/**
 * The search for opening another view of the same tab. The span, the selected level and the citation-map measure are
 * kept because they mean the same thing in every view; text, sort and the selection are not.
 */
export function viewSearch(
  current: CollectionSearch,
  view: string,
  extra: Partial<CollectionSearch> = {},
): CollectionSearch {
  const tab = current.tab ?? "dockets";
  return normalizeCollectionSearch({
    tab,
    view,
    ...(current.span ? { span: current.span } : {}),
    ...(tab === "dockets" && current.level ? { level: current.level } : {}),
    ...(current.measure ? { measure: current.measure } : {}),
    ...extra,
  });
}

/** The tab a search shows. */
export const tabOf = (search: CollectionSearch): CollectionTab => search.tab ?? "dockets";
