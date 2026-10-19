/** Pure filtering and sorting for the Unresolved citations tab of /courts/collection. */
import { sortRows, type SortSpec } from "@/components/courts/caseload/caseloadTables";
import type { UnmatchedRow } from "@/lib/external/clbCitationExtras.functions";

export const SORT_KEYS = ["citations", "unresolved", "opinions", "name"] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export const DEFAULT_SORT: SortSpec<SortKey> = { key: "citations", desc: true };
export const KINDS = [
  { id: "reporter", label: "Reporters" },
  { id: "court", label: "Citing courts" },
];

/** Rows of one kind whose name holds every word of `q`, in the requested order (unknown values last). */
export function unmatchedRows(
  rows: readonly UnmatchedRow[],
  kind: string | undefined,
  q: string | undefined,
  sort: SortSpec<SortKey>,
): UnmatchedRow[] {
  const k = kind === "court" ? "court" : "reporter";
  const words = (q ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const kept = rows.filter(
    (r) => r.kind === k && words.every((w) => r.name.toLowerCase().includes(w)),
  );
  const value = (r: UnmatchedRow) =>
    sort.key === "citations"
      ? r.citations
      : sort.key === "unresolved"
        ? r.unresolvedPct
        : sort.key === "opinions"
          ? r.opinions
          : r.name.toLowerCase();
  return sortRows(kept, sort.desc, value, (r) => r.id);
}
