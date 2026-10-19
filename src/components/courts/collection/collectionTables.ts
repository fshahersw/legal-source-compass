/**
 * Row shaping, search, filter and sort for the tables of /courts/collection, kept pure so the URL state, the
 * empty-result path and the null-last ordering are testable. A missing value always sorts last in either direction; it
 * is never treated as zero. Sorting and word-start matching are the caseload page's own helpers.
 */
import { matchesTerms, sortRows, type SortSpec } from "@/components/courts/caseload/caseloadTables";
import type {
  AppealEdge,
  CiteEdge,
  CitingCourt,
  DisclosureCourt,
  DocketCause,
  DocketNos,
  DocketState,
  SchemaTableRow,
  TopCited,
} from "@/lib/external/clbCollection.functions";
import { competitionRanks, decadeOf, sharePct, stateName } from "./collectionFormat";

export type { SortSpec };
export { encodeSort, nextSort, parseSort } from "@/components/courts/caseload/caseloadTables";

// -------------------------------------------------------------------------------------------- states

export type StateTableRow = {
  code: string;
  name: string;
  courts: number;
  dockets: number;
  /** Rank among the listed states and territories by dockets (1 is the most). */
  rank: number | null;
  /** Share of all dockets in the collection. */
  sharePct: number | null;
  federal: number | null;
  stateCourts: number | null;
  other: number | null;
  /** Federal courts' share of the place's own dockets. */
  federalPct: number | null;
  civil: number | null;
  recapPct: number | null;
};

export function stateRows(states: readonly DocketState[], totalDockets: number | null) {
  const ranks = competitionRanks(states.map((s) => s.dockets));
  return states.map((s, i): StateTableRow => ({
    code: s.code,
    name: stateName(s.code),
    courts: s.courts,
    dockets: s.dockets,
    rank: ranks[i] ?? null,
    sharePct: sharePct(s.dockets, totalDockets),
    federal: s.federal,
    stateCourts: s.stateCourts,
    other: s.other,
    federalPct: sharePct(s.federal, s.dockets),
    civil: s.civil,
    recapPct: sharePct(s.recap, s.dockets),
  }));
}

export const STATE_SORT_KEYS = [
  "name",
  "courts",
  "dockets",
  "sharePct",
  "federalPct",
  "civil",
  "recapPct",
] as const;
export type StateSortKey = (typeof STATE_SORT_KEYS)[number];
export const STATE_DEFAULT_SORT: SortSpec<StateSortKey> = { key: "dockets", desc: true };

export const filterStates = (rows: readonly StateTableRow[], f: { q?: string | undefined }) =>
  rows.filter((r) => !f.q || matchesTerms(`${r.name} ${r.code}`, f.q));

export const sortStates = (rows: readonly StateTableRow[], spec: SortSpec<StateSortKey>) =>
  sortRows(
    rows,
    spec.desc,
    (r) => r[spec.key],
    (r) => r.name,
  );

// -------------------------------------------------------------------------------------------- nature of suit

export type NosTableRow = DocketNos & {
  /** Share of dockets whose nature-of-suit text starts with a three-digit code. */
  sharePct: number | null;
};

export const nosRows = (nos: readonly DocketNos[], numericCodeDockets: number | null) =>
  nos.map((n): NosTableRow => ({ ...n, sharePct: sharePct(n.dockets, numericCodeDockets) }));

export const NOS_SORT_KEYS = [
  "code",
  "name",
  "group",
  "dockets",
  "sharePct",
  "terminatedPct",
] as const;
export type NosSortKey = (typeof NOS_SORT_KEYS)[number];
export const NOS_DEFAULT_SORT: SortSpec<NosSortKey> = { key: "dockets", desc: true };

export const filterNos = (
  rows: readonly NosTableRow[],
  f: { q?: string | undefined; group?: string | undefined },
) =>
  rows.filter(
    (n) =>
      (!f.group || n.group === f.group) &&
      (!f.q || matchesTerms(`${n.code} ${n.name} ${n.groupLabel ?? ""}`, f.q)),
  );

export const sortNos = (rows: readonly NosTableRow[], spec: SortSpec<NosSortKey>) =>
  sortRows(
    rows,
    spec.desc,
    (n) => (spec.key === "group" ? n.groupLabel : n[spec.key]),
    (n) => String(n.code).padStart(3, "0"),
  );

// -------------------------------------------------------------------------------------------- causes

export const CAUSE_SORT_KEYS = ["rank", "cause", "dockets"] as const;
export type CauseSortKey = (typeof CAUSE_SORT_KEYS)[number];
export const CAUSE_DEFAULT_SORT: SortSpec<CauseSortKey> = { key: "rank", desc: false };

export const filterCauses = (rows: readonly DocketCause[], f: { q?: string | undefined }) =>
  rows.filter((r) => !f.q || matchesTerms(r.cause, f.q));

export const sortCauses = (rows: readonly DocketCause[], spec: SortSpec<CauseSortKey>) =>
  sortRows(
    rows,
    spec.desc,
    (r) => r[spec.key],
    (r) => String(r.rank).padStart(4, "0"),
  );

// -------------------------------------------------------------------------------------------- citing courts

export const CITING_SORT_KEYS = [
  "name",
  "level",
  "total",
  "selfPct",
  "scotusPct",
  "federalPct",
  "statePct",
  "lagMedian",
] as const;
export type CitingSortKey = (typeof CITING_SORT_KEYS)[number];
export const CITING_DEFAULT_SORT: SortSpec<CitingSortKey> = { key: "total", desc: true };

export const filterCiting = (
  rows: readonly CitingCourt[],
  f: { q?: string | undefined; level?: string | undefined },
) =>
  rows.filter(
    (c) => (!f.level || c.level === f.level) && (!f.q || matchesTerms(`${c.name} ${c.id}`, f.q)),
  );

export const sortCiting = (rows: readonly CitingCourt[], spec: SortSpec<CitingSortKey>) =>
  sortRows(
    rows,
    spec.desc,
    (c) => (spec.key === "lagMedian" ? (c.lag?.median ?? null) : c[spec.key]),
    (c) => c.name,
  );

// -------------------------------------------------------------------------------------------- citation and appeal edges

export const CITE_SORT_KEYS = [
  "citing",
  "cited",
  "links",
  "shareOfCitingPct",
  "shareOfCitedPct",
] as const;
export type CiteSortKey = (typeof CITE_SORT_KEYS)[number];
export const CITE_DEFAULT_SORT: SortSpec<CiteSortKey> = { key: "links", desc: true };

type EdgeFilter = {
  q?: string | undefined;
  /** Level of the citing (or appealed-from) court. */
  level?: string | undefined;
  /** Level of the cited (or receiving) court. */
  to?: string | undefined;
};

export const filterCiteEdges = (rows: readonly CiteEdge[], f: EdgeFilter) =>
  rows.filter(
    (e) =>
      (!f.level || e.citing.level === f.level) &&
      (!f.to || e.cited.level === f.to) &&
      (!f.q || matchesTerms(`${e.citing.name} ${e.citing.id} ${e.cited.name} ${e.cited.id}`, f.q)),
  );

export const sortCiteEdges = (rows: readonly CiteEdge[], spec: SortSpec<CiteSortKey>) =>
  sortRows(
    rows,
    spec.desc,
    (e) =>
      spec.key === "citing" ? e.citing.name : spec.key === "cited" ? e.cited.name : e[spec.key],
    (e) => e.id,
  );

export const APPEAL_SORT_KEYS = ["from", "to", "dockets", "sharePct"] as const;
export type AppealSortKey = (typeof APPEAL_SORT_KEYS)[number];
export const APPEAL_DEFAULT_SORT: SortSpec<AppealSortKey> = { key: "dockets", desc: true };

export const filterAppealEdges = (rows: readonly AppealEdge[], f: EdgeFilter) =>
  rows.filter(
    (e) =>
      (!f.level || e.from.level === f.level) &&
      (!f.to || e.to.level === f.to) &&
      (!f.q || matchesTerms(`${e.from.name} ${e.from.id} ${e.to.name} ${e.to.id}`, f.q)),
  );

export const sortAppealEdges = (rows: readonly AppealEdge[], spec: SortSpec<AppealSortKey>) =>
  sortRows(
    rows,
    spec.desc,
    (e) => (spec.key === "from" ? e.from.name : spec.key === "to" ? e.to.name : e[spec.key]),
    (e) => e.id,
  );

// -------------------------------------------------------------------------------------------- most cited

export const TOP_SORT_KEYS = [
  "rank",
  "caseName",
  "court",
  "year",
  "timesCited",
  "mapLinks",
  "federalPct",
  "statePct",
] as const;
export type TopSortKey = (typeof TOP_SORT_KEYS)[number];
export const TOP_DEFAULT_SORT: SortSpec<TopSortKey> = { key: "rank", desc: false };

export const filterTopCited = (
  rows: readonly TopCited[],
  f: { q?: string | undefined; court?: string | undefined; decade?: number | undefined },
) =>
  rows.filter(
    (r) =>
      (!f.court || r.courtId === f.court) &&
      (!f.decade || decadeOf(r.year) === f.decade) &&
      (!f.q || matchesTerms(`${r.caseName} ${r.citation ?? ""}`, f.q)),
  );

export const sortTopCited = (rows: readonly TopCited[], spec: SortSpec<TopSortKey>) =>
  sortRows(
    rows,
    spec.desc,
    (r) => r[spec.key],
    (r) => String(r.rank).padStart(5, "0"),
  );

/** Courts that hold at least one of the rows, with how many, most first (ties by name). */
export function topCitedCourtOptions(rows: readonly TopCited[]) {
  const m = new Map<string, { id: string; label: string; count: number }>();
  for (const r of rows) {
    const cur = m.get(r.courtId);
    if (cur) cur.count += 1;
    else m.set(r.courtId, { id: r.courtId, label: r.court, count: 1 });
  }
  return [...m.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/** Decades that hold at least one of the rows, oldest first. */
export const topCitedDecades = (rows: readonly TopCited[]) =>
  [...new Set(rows.map((r) => decadeOf(r.year)))].sort((a, b) => a - b);

// -------------------------------------------------------------------------------------------- disclosure courts

export type DisclosureCourtRow = DisclosureCourt & {
  /** Share of the people with a judicial position at the court on record who have at least one report. */
  coveragePct: number | null;
};

export const disclosureCourtRows = (rows: readonly DisclosureCourt[]) =>
  rows.map((c): DisclosureCourtRow => ({ ...c, coveragePct: sharePct(c.withReport, c.people) }));

export const DISC_SORT_KEYS = [
  "name",
  "level",
  "people",
  "withReport",
  "coveragePct",
  "reports",
  "firstYear",
  "lastYear",
] as const;
export type DiscSortKey = (typeof DISC_SORT_KEYS)[number];
export const DISC_DEFAULT_SORT: SortSpec<DiscSortKey> = { key: "people", desc: true };

export const filterDisclosureCourts = (
  rows: readonly DisclosureCourtRow[],
  f: { q?: string | undefined; level?: string | undefined },
) =>
  rows.filter(
    (c) => (!f.level || c.level === f.level) && (!f.q || matchesTerms(`${c.name} ${c.id}`, f.q)),
  );

export const sortDisclosureCourts = (
  rows: readonly DisclosureCourtRow[],
  spec: SortSpec<DiscSortKey>,
) =>
  sortRows(
    rows,
    spec.desc,
    (c) => c[spec.key],
    (c) => c.name,
  );

// -------------------------------------------------------------------------------------------- schema tables

export const SCHEMA_SORT_KEYS = [
  "table",
  "group",
  "columns",
  "rowsLoaded",
  "compressedMb",
  "load",
] as const;
export type SchemaSortKey = (typeof SCHEMA_SORT_KEYS)[number];
export const SCHEMA_DEFAULT_SORT: SortSpec<SchemaSortKey> = { key: "table", desc: false };

export const filterSchemaTables = (
  rows: readonly SchemaTableRow[],
  f: {
    q?: string | undefined;
    group?: string | undefined;
    bulk?: "yes" | "no" | undefined;
    loaded?: string | undefined;
  },
) =>
  rows.filter(
    (t) =>
      (!f.group || t.group === f.group) &&
      (!f.bulk || (f.bulk === "yes") === t.bulk) &&
      (!f.loaded || t.load === f.loaded) &&
      (!f.q || matchesTerms(`${t.table} ${t.label} ${t.group}`, f.q)),
  );

const LOAD_ORDER = { none: 0, not_loaded: 1, selected: 2, all: 3, unknown: 4 } as const;

export const sortSchemaTables = (rows: readonly SchemaTableRow[], spec: SortSpec<SchemaSortKey>) =>
  sortRows(
    rows,
    spec.desc,
    (t) => (spec.key === "load" ? LOAD_ORDER[t.load] : t[spec.key]),
    (t) => t.table,
  );
