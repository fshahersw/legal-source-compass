import { REGISTRY_SOURCES } from "./documents";

export const MATTER_TABS = [
  "overview",
  "cases",
  "docket",
  "documents",
  "parties",
  "evidence",
] as const;
export type MatterTab = (typeof MATTER_TABS)[number];

export const MATTER_TAB_LABELS: Record<MatterTab, string> = {
  overview: "Overview",
  cases: "Member cases",
  docket: "Docket entries",
  documents: "Documents",
  parties: "Parties & counsel",
  evidence: "Evidence & sources",
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
