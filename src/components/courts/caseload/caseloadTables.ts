/**
 * Search, filter and sort logic for the three caseload tables (districts, nature of suit, MDL numbers), kept pure so the
 * URL state, the empty-result path and the null-last ordering are testable. A missing value always sorts last in either
 * direction; it is never treated as zero.
 */
import type { DistrictRow, MdlRow, NosRow } from "@/lib/external/courtCaseload.functions";
import { districtSearchText } from "./caseloadFormat";

export type SortSpec<K extends string> = { key: K; desc: boolean };

/** "-filings" is descending, "filings" ascending; anything not in `allowed` falls back. */
export function parseSort<K extends string>(
  raw: string | undefined,
  allowed: readonly K[],
  fallback: SortSpec<K>,
): SortSpec<K> {
  if (!raw) return fallback;
  const desc = raw.startsWith("-");
  const key = (desc ? raw.slice(1) : raw) as K;
  return allowed.includes(key) ? { key, desc } : fallback;
}

/** The URL value for a sort, or undefined when it is the table's default (so the default leaves no parameter). */
export function encodeSort<K extends string>(
  spec: SortSpec<K>,
  fallback: SortSpec<K>,
): string | undefined {
  return spec.key === fallback.key && spec.desc === fallback.desc
    ? undefined
    : `${spec.desc ? "-" : ""}${spec.key}`;
}

/** Clicking a header: the same column flips direction, a new column starts at `firstDesc` (numbers high first, names A-Z). */
export function nextSort<K extends string>(
  current: SortSpec<K>,
  key: K,
  firstDesc: boolean,
): SortSpec<K> {
  return current.key === key ? { key, desc: !current.desc } : { key, desc: firstDesc };
}

type Value = number | string | null;

/** Stable sort by an accessor: nulls last whichever direction, ties broken by `tie` ascending. */
export function sortRows<T>(
  rows: readonly T[],
  desc: boolean,
  value: (row: T) => Value,
  tie: (row: T) => string,
): T[] {
  return [...rows].sort((a, b) => {
    const av = value(a);
    const bv = value(b);
    if (av == null && bv == null) return tie(a).localeCompare(tie(b));
    if (av == null) return 1;
    if (bv == null) return -1;
    const c =
      typeof av === "number" && typeof bv === "number"
        ? av - bv
        : String(av).localeCompare(String(bv), "en", { numeric: true });
    return c !== 0 ? (desc ? -c : c) : tie(a).localeCompare(tie(b));
  });
}

/** Lower-cased words: periods vanish ("N.D." is "nd") and every other non-alphanumeric run separates words. */
const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/\./g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

/** Every search word must start a word of the haystack, so "n.d. cal" finds "N.D. California" and "nd" never finds "Second". */
export function matchesTerms(haystack: string, query: string): boolean {
  const terms = words(query);
  if (!terms.length) return true;
  const tokens = words(haystack);
  return terms.every((t) => tokens.some((w) => w.startsWith(t)));
}

// -------------------------------------------------------------------------------------------- districts

export const DISTRICT_SORT_KEYS = [
  "name",
  "state",
  "circuit",
  "filings",
  "terminations",
  "pending",
  "medianDays",
  "classActionPct",
  "proSePct",
  "productPct",
  "trialPct",
] as const;
export type DistrictSortKey = (typeof DISTRICT_SORT_KEYS)[number];
export const DISTRICT_DEFAULT_SORT: SortSpec<DistrictSortKey> = { key: "filings", desc: true };

const districtValue = (d: DistrictRow, key: DistrictSortKey): Value => {
  switch (key) {
    case "name":
      return d.name;
    case "state":
      return d.state;
    case "circuit":
      return d.circuitId;
    default:
      return d[key];
  }
};

export type DistrictFilter = {
  q?: string | undefined;
  circuit?: string | undefined;
  state?: string | undefined;
};

export function filterDistricts(rows: readonly DistrictRow[], f: DistrictFilter): DistrictRow[] {
  return rows.filter(
    (d) =>
      (!f.circuit || d.circuitId === f.circuit) &&
      (!f.state || d.state === f.state) &&
      (!f.q || matchesTerms(districtSearchText(d), f.q)),
  );
}

export function sortDistricts(rows: readonly DistrictRow[], spec: SortSpec<DistrictSortKey>) {
  return sortRows(
    rows,
    spec.desc,
    (d) => districtValue(d, spec.key),
    (d) => d.name,
  );
}

/** Circuit options in the order the circuits are numbered (D.C. first), as recorded on the rows. */
export function circuitOptions(rows: readonly DistrictRow[]): { id: string; label: string }[] {
  const seen = new Map<string, string>();
  for (const r of rows)
    if (r.circuitId && !seen.has(r.circuitId)) seen.set(r.circuitId, r.circuit ?? r.circuitId);
  const rank = (id: string) => (id === "cadc" ? 0 : Number(id.replace(/\D/g, "")) || 99);
  return [...seen].map(([id, label]) => ({ id, label })).sort((a, b) => rank(a.id) - rank(b.id));
}

export function stateOptions(rows: readonly DistrictRow[]): string[] {
  return [...new Set(rows.flatMap((r) => (r.state ? [r.state] : [])))].sort();
}

// -------------------------------------------------------------------------------------------- nature of suit

export const NOS_SORT_KEYS = [
  "code",
  "name",
  "filings",
  "terminations",
  "medianDays",
  "settledPct",
  "trialPct",
  "proSePct",
  "classActionPct",
] as const;
export type NosSortKey = (typeof NOS_SORT_KEYS)[number];
export const NOS_DEFAULT_SORT: SortSpec<NosSortKey> = { key: "filings", desc: true };

export type NosFilter = {
  q?: string | undefined;
  kind?: "nos" | "group" | undefined;
  group?: string | undefined;
  /** Hide the codes with no cases in the latest complete year. */
  activeOnly?: boolean | undefined;
};

export function filterNos(rows: readonly NosRow[], f: NosFilter): NosRow[] {
  return rows.filter(
    (n) =>
      (!f.kind || n.kind === f.kind) &&
      (!f.group || n.groupKey === f.group) &&
      (!f.activeOnly || n.filings != null) &&
      (!f.q || matchesTerms(`${n.code ?? ""} ${n.name} ${n.id}`, f.q)),
  );
}

export function sortNos(rows: readonly NosRow[], spec: SortSpec<NosSortKey>) {
  return sortRows(
    rows,
    spec.desc,
    (n) => (spec.key === "code" ? n.code : n[spec.key]),
    (n) => `${n.kind === "group" ? "0" : "1"}${n.code ?? ""}${n.name}`,
  );
}

// -------------------------------------------------------------------------------------------- MDL numbers

export const MDL_SORT_KEYS = [
  "mdl",
  "cases",
  "pending",
  "districts",
  "firstFiled",
  "lastFiled",
  "medianDays",
  "topDistrict",
] as const;
export type MdlSortKey = (typeof MDL_SORT_KEYS)[number];
export const MDL_DEFAULT_SORT: SortSpec<MdlSortKey> = { key: "cases", desc: true };

export type MdlFilter = {
  q?: string | undefined;
  jpml?: "yes" | "no" | undefined;
  /** Only numbers with at least one case still pending in the IDB. */
  pendingOnly?: boolean | undefined;
};

export function filterMdls(rows: readonly MdlRow[], f: MdlFilter): MdlRow[] {
  const q = f.q?.trim();
  return rows.filter(
    (m) =>
      (!f.jpml || (f.jpml === "yes") === m.inJpml) &&
      (!f.pendingOnly || (m.pending ?? 0) > 0) &&
      (!q ||
        (/^\d+$/.test(q) ? String(m.mdl).startsWith(q) : matchesTerms(m.topDistrict ?? "", q))),
  );
}

export function sortMdls(rows: readonly MdlRow[], spec: SortSpec<MdlSortKey>) {
  return sortRows(
    rows,
    spec.desc,
    (m) => m[spec.key],
    (m) => String(m.mdl).padStart(6, "0"),
  );
}
