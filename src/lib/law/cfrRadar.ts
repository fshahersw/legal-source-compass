/**
 * CFR change radar (pure): substantive eCFR changes since 2017 to the parts mass-tort cases cite most (drug labeling,
 * NDA supplements, investigational drugs, biologics, device reporting, PMA, the quality system, the motor vehicle
 * safety standards and defect reporting, hazardous substances). Rows are ecfr_section_versions records
 * (id 'cfr:<title>:<section>', detail.versions[]).
 *
 * Rules:
 *  - eCFR point-in-time history starts 2017-01-03; the first version of each section (dated 2016 or earlier) is its
 *    baseline, not a change. Every title says "since 2017".
 *  - Only versions marked substantive count; editorial reissues do not.
 *  - A version's Federal Register rule is linked only when the eCFR source note names it or it is the only rule for
 *    the part that day; otherwise it is "Not recorded" (several candidate rules are not narrowed by guesswork).
 *  - A year with no change is a real zero (the section history is complete since 2017); the current year is partial.
 */

export const ECFR_HISTORY_START = "2017-01-03";

export type WatchedPart = {
  title: string;
  part: string;
  label: string;
  agency: string;
};

export const WATCHED_PARTS: readonly WatchedPart[] = [
  { title: "21", part: "201", label: "Drug labeling", agency: "FDA" },
  { title: "21", part: "312", label: "Investigational new drugs", agency: "FDA" },
  { title: "21", part: "314", label: "New drug applications", agency: "FDA" },
  { title: "21", part: "601", label: "Biologics licensing", agency: "FDA" },
  { title: "21", part: "803", label: "Medical device reporting", agency: "FDA" },
  { title: "21", part: "814", label: "Premarket approval of devices", agency: "FDA" },
  { title: "21", part: "820", label: "Device quality system", agency: "FDA" },
  { title: "49", part: "571", label: "Motor vehicle safety standards", agency: "NHTSA" },
  { title: "49", part: "573", label: "Defect and noncompliance reports", agency: "NHTSA" },
  { title: "49", part: "579", label: "Defect early-warning reporting", agency: "NHTSA" },
  { title: "16", part: "1500", label: "Hazardous substances", agency: "CPSC" },
];

export const partKey = (p: { title: string; part: string }) => `${p.title}:${p.part}`;
export const partCitation = (p: { title: string; part: string }) => `${p.title} CFR part ${p.part}`;

export type FrRef = { documentNumber: string; citation: string | null; url: string };

export type SectionChange = {
  /** 'cfr:21:314.70' */
  id: string;
  partKey: string;
  section: string;
  heading: string;
  date: string;
  removed: boolean;
  /** Rules linked by the source note or as the only rule for the part that day. */
  fr: FrRef[];
  frBasis: string;
};

export type PartRadar = WatchedPart & {
  key: string;
  sections: number;
  changedSections: number;
  changes: number;
  latest: string | null;
  byYear: Record<string, number>;
};

export type CfrRadar = {
  today: string;
  years: string[];
  partialYear: string;
  parts: PartRadar[];
  /** Every substantive change since 2017 to a watched part, newest first. */
  changes: SectionChange[];
  last12: { sections: number; changes: number; since: string };
};

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {};
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const LINKED_BASES = new Set(["source_note", "only_rule_for_part_on_date"]);

function frRefs(v: Obj): FrRef[] {
  if (!LINKED_BASES.has(str(v["fr_basis"]) ?? "")) return [];
  const list = Array.isArray(v["fr"]) ? (v["fr"] as unknown[]) : [];
  return list.flatMap((f) => {
    const o = obj(f);
    const doc = str(o["document_number"]);
    const url = str(o["url"]);
    return doc && url && url.startsWith("https://www.federalregister.gov/")
      ? [{ documentNumber: doc, citation: str(o["citation"]), url }]
      : [];
  });
}

/** Substantive changes since 2017 recorded for one ecfr_section_versions row. */
export function sectionChanges(row: unknown, key: string): SectionChange[] {
  const r = obj(row);
  const id = str(r["id"]);
  if (!id) return [];
  const versions = Array.isArray(r["versions"]) ? (r["versions"] as unknown[]) : [];
  const section = id.split(":").slice(2).join(":");
  const fallback = (str(r["title"]) ?? id).replace(/^\d+ CFR \S+\s*/, "");
  return versions.flatMap((raw) => {
    const v = obj(raw);
    const date = str(v["date"]);
    if (!date || !ISO.test(date) || date < ECFR_HISTORY_START || v["substantive"] !== true)
      return [];
    return [
      {
        id,
        partKey: key,
        section,
        heading: (str(v["name"]) ?? fallback).replace(/^§\s*\S+\s*/, ""),
        date,
        removed: v["removed"] === true,
        fr: frRefs(v),
        frBasis: str(v["fr_basis"]) ?? "none",
      },
    ];
  });
}

/** One year before `today` (same calendar day). */
export function yearBefore(today: string): string {
  return `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`;
}

export function buildRadar(
  rowsByPart: ReadonlyMap<string, readonly unknown[]>,
  today: string,
  parts: readonly WatchedPart[] = WATCHED_PARTS,
): CfrRadar {
  const partialYear = today.slice(0, 4);
  const years: string[] = [];
  for (let y = Number(ECFR_HISTORY_START.slice(0, 4)); y <= Number(partialYear); y++)
    years.push(String(y));
  const since = yearBefore(today);
  const all: SectionChange[] = [];
  const out = parts.map((p): PartRadar => {
    const key = partKey(p);
    const rows = rowsByPart.get(key) ?? [];
    const changes = rows.flatMap((r) => sectionChanges(r, key));
    all.push(...changes);
    const byYear = Object.fromEntries(years.map((y) => [y, 0]));
    for (const c of changes) {
      const y = c.date.slice(0, 4);
      if (y in byYear) byYear[y] = (byYear[y] ?? 0) + 1;
    }
    return {
      ...p,
      key,
      sections: rows.length,
      changedSections: new Set(changes.map((c) => c.id)).size,
      changes: changes.length,
      latest: changes.reduce<string | null>(
        (m, c) => (m === null || c.date > m ? c.date : m),
        null,
      ),
      byYear,
    };
  });
  const recent = all.filter((c) => c.date > since && c.date <= today);
  return {
    today,
    years,
    partialYear,
    parts: out,
    changes: [...all].sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id)),
    last12: { sections: new Set(recent.map((c) => c.id)).size, changes: recent.length, since },
  };
}
