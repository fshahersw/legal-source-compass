import { REGISTRY_SOURCES } from "./documents";

export const MATTER_TABS = [
  "overview",
  "cases",
  "docket",
  "documents",
  "parties",
  "evidence",
  "lifecycle",
] as const;
export type MatterTab = (typeof MATTER_TABS)[number];

export const MATTER_TAB_LABELS: Record<MatterTab, string> = {
  overview: "Overview",
  cases: "Member cases",
  docket: "Docket entries",
  documents: "Documents",
  parties: "Parties & counsel",
  evidence: "Evidence & sources",
  lifecycle: "Lifecycle & signals",
};

/** URL state of a matter page: which tab, an optional docket-entry filter, and an open document viewer. */
export type MatterSearch = {
  tab?: MatterTab;
  /** Docket entry number the Documents tab is filtered to. */
  entry?: number;
  /** "<registry source>|<native document id>" of the document open in the viewer. */
  view?: string;
};

export function validateMatterSearch(search: Record<string, unknown>): MatterSearch {
  const out: MatterSearch = {};
  const tab = search["tab"];
  if (
    typeof tab === "string" &&
    tab !== "overview" &&
    (MATTER_TABS as readonly string[]).includes(tab)
  )
    out.tab = tab as MatterTab;
  const entry = search["entry"];
  const n =
    typeof entry === "number"
      ? entry
      : typeof entry === "string" && /^\d{1,7}$/.test(entry)
        ? Number(entry)
        : null;
  if (n !== null && Number.isInteger(n) && n >= 0 && n <= 9_999_999) out.entry = n;
  const view = search["view"];
  if (typeof view === "string" && view.length <= 520) {
    const bar = view.indexOf("|");
    const source = bar > 0 ? view.slice(0, bar) : "";
    const doc = bar > 0 ? view.slice(bar + 1) : "";
    let clean = doc.length > 0 && doc.length <= 500;
    for (let i = 0; clean && i < doc.length; i++) if (doc.charCodeAt(i) < 32) clean = false;
    if (clean && (REGISTRY_SOURCES as readonly string[]).includes(source)) out.view = view;
  }
  return out;
}

/** Set or clear the entry filter without leaving an `undefined` key (the URL omits it). */
export function withEntry(prev: MatterSearch, entry: number | null): MatterSearch {
  const { entry: _drop, ...rest } = prev;
  return entry === null ? rest : { ...rest, entry };
}

/** Open or close the document viewer. */
export function withView(prev: MatterSearch, view: string | null): MatterSearch {
  const { view: _drop, ...rest } = prev;
  return view === null ? rest : { ...rest, view };
}

/**
 * The four views a matter page shows (owner rule: at most four tabs). Each view holds one or more of the URL tabs
 * above, so every former address (`?tab=parties`, `?tab=documents&entry=…`) still opens the same content, with
 * the part it names first.
 */
export const MATTER_VIEWS = [
  { id: "overview", label: "Overview", tabs: ["overview", "lifecycle"] },
  { id: "cases", label: "Cases & parties", tabs: ["cases", "parties"] },
  { id: "docket", label: "Docket & documents", tabs: ["docket", "documents"] },
  { id: "evidence", label: "Evidence & sources", tabs: ["evidence"] },
] as const satisfies readonly { id: string; label: string; tabs: readonly MatterTab[] }[];
export type MatterView = (typeof MATTER_VIEWS)[number];

export const matterViewOf = (tab: MatterTab): MatterView =>
  MATTER_VIEWS.find((v) => (v.tabs as readonly MatterTab[]).includes(tab)) ?? MATTER_VIEWS[0];

/**
 * The sections of the MDL command page (/matters/$id), in page order. The page is one scrollable page with a sticky
 * section index; there are no tabs, so a former `?tab=` address scrolls to the section that now holds its content.
 */
export const MDL_SECTION_IDS = [
  "mdl-overview",
  "mdl-changes",
  "mdl-velocity",
  "mdl-jpml",
  "mdl-orders",
  "mdl-dates",
  "mdl-counsel",
  "mdl-activity",
  "mdl-documents",
  "mdl-regulatory",
  "mdl-sources",
] as const;
export type MdlSectionId = (typeof MDL_SECTION_IDS)[number];

/** Where each former tab's content lives on the command page. */
export const MATTER_TAB_ANCHORS: Record<MatterTab, MdlSectionId> = {
  overview: "mdl-overview",
  lifecycle: "mdl-regulatory",
  cases: "mdl-counsel",
  parties: "mdl-counsel",
  docket: "mdl-activity",
  documents: "mdl-documents",
  evidence: "mdl-sources",
};

/**
 * The section a matter address should scroll to: its `?tab=`, else the documents section when an entry filter or an
 * open document (`?entry=`, `?view=`) is in the address, else none (the page opens at the top).
 */
export function matterAnchorOf(search: MatterSearch): MdlSectionId | null {
  if (search.tab) return MATTER_TAB_ANCHORS[search.tab];
  if (search.entry !== undefined || search.view !== undefined) return "mdl-documents";
  return null;
}
