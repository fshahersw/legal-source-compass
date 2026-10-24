/**
 * One fiscal year of federal civil filings as a two-level partition: case-type group → nature-of-suit code (FJC IDB,
 * this project's groups). The five largest groups keep their own ring; the remaining groups sit under "All other case
 * types", matching the case-mix chart's colours and order. A group whose codes do not add up to its own count gets a
 * "Not broken down" remainder (or, if the codes exceed it, no code ring), so the rings never claim more than the group.
 */
import type { TreeNode } from "@/components/charts/d3/maths";
import type { NosRow } from "@/lib/external/courtCaseload.functions";

export const OTHER_GROUPS = "All other case types";

export type CaseTreeGroup = {
  key: string;
  name: string;
  filings: number;
  slot: number;
  /** Codes with filings, largest first. */
  codes: { code: number; name: string; filings: number }[];
};

export type CaseTree = {
  total: number;
  root: TreeNode;
  /** Top groups in order, then the folded remainder (key OTHER_GROUPS) when any group is folded. */
  groups: CaseTreeGroup[];
};

function groupNode(g: { name: string; filings: number; codes: CaseTreeGroup["codes"] }): TreeNode {
  const coded = g.codes.reduce((s, c) => s + c.filings, 0);
  if (!g.codes.length || coded > g.filings) return { name: g.name, value: g.filings };
  const children: TreeNode[] = g.codes.map((c) => ({ name: c.name, value: c.filings }));
  if (coded < g.filings) children.push({ name: "Not broken down", value: g.filings - coded });
  return { name: g.name, children };
}

export function caseTree(
  rows: readonly NosRow[],
  { top = 5, rootName = "Civil filings" }: { top?: number; rootName?: string } = {},
): CaseTree | null {
  const groups = rows
    .filter(
      (r): r is NosRow & { filings: number; groupKey: string } =>
        r.kind === "group" && r.groupKey != null && r.filings != null && r.filings > 0,
    )
    .map((g) => ({
      key: g.groupKey,
      name: g.name,
      filings: g.filings,
      codes: rows
        .filter(
          (r): r is NosRow & { filings: number; code: number } =>
            r.kind === "nos" &&
            r.groupKey === g.groupKey &&
            r.code != null &&
            r.filings != null &&
            r.filings > 0,
        )
        .map((r) => ({ code: r.code, name: r.name, filings: r.filings }))
        .sort((a, b) => b.filings - a.filings || a.code - b.code),
    }))
    .sort((a, b) => b.filings - a.filings || a.name.localeCompare(b.name));
  if (groups.length < 2) return null;
  const shown = groups.slice(0, top).map((g, i) => ({ ...g, slot: i }));
  const folded = groups.slice(top);
  const total = groups.reduce((s, g) => s + g.filings, 0);
  const children: TreeNode[] = shown.map((g) => ({ ...groupNode(g), slot: g.slot }));
  const out: CaseTreeGroup[] = [...shown];
  if (folded.length) {
    const filings = folded.reduce((s, g) => s + g.filings, 0);
    children.push({
      name: OTHER_GROUPS,
      slot: 5,
      children: folded.map((g) => ({ name: g.name, value: g.filings })),
    });
    out.push({
      key: OTHER_GROUPS,
      name: OTHER_GROUPS,
      filings,
      slot: 5,
      codes: folded.map((g, i) => ({ code: -1 - i, name: g.name, filings: g.filings })),
    });
  }
  return { total, root: { name: rootName, children }, groups: out };
}
