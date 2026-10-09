import type { MergedStateSource } from "@/lib/atlas/stateSources";

const GROUPS = [
  "Legislation & codes",
  "Court rules",
  "Opinions",
  "Court services",
  "Regulations",
  "Legal guidance",
  "Other resources",
] as const;
export type ResourceGroup = (typeof GROUPS)[number];

/** Navigation grouping from express title words, never an assertion about legal authority or jurisdiction. */
export function resourceGroup(row: MergedStateSource): ResourceGroup {
  const title = (row.title ?? "").toLowerCase();
  if (
    /\b(statutes?|legislation|legislative|constitution|bills?|laws? search|revised code|general laws|laws and|bills and laws|code of)\b/.test(
      title,
    )
  )
    return "Legislation & codes";
  if (
    /\b(rules? of|court rules?|local rules?|civil procedure|criminal procedure|rules? and forms|practice rules?)\b/.test(
      title,
    )
  )
    return "Court rules";
  if (/\b(opinions?|decisions?|case law|caselaw)\b/.test(title)) return "Opinions";
  if (/\b(courts?|judiciar\w*|court forms|filing|e-filing|dockets?|judges?)\b/.test(title))
    return "Court services";
  if (/\b(regulations?|administrative code|register)\b/.test(title)) return "Regulations";
  if (
    /\b(legal aid|bar association|attorney|appeals?|law library|legal guide|self.help|legal assistance|trial attorneys)\b/.test(
      title,
    )
  )
    return "Legal guidance";
  return "Other resources";
}

export function prioritizeResources(rows: readonly MergedStateSource[]): MergedStateSource[] {
  return [...rows].sort(
    (a, b) =>
      GROUPS.indexOf(resourceGroup(a)) - GROUPS.indexOf(resourceGroup(b)) ||
      (a.title || a.domain).localeCompare(b.title || b.domain) ||
      a.id.localeCompare(b.id),
  );
}

export function resourceGroups(rows: readonly MergedStateSource[]) {
  const counts = new Map<ResourceGroup, number>();
  for (const row of rows) {
    const key = resourceGroup(row);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return GROUPS.flatMap((value) =>
    counts.has(value) ? [{ value, label: value, count: counts.get(value)! }] : [],
  );
}
