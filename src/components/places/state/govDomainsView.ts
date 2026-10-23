/** Pure view helpers for the government-websites sections of the state and county pages. */
import {
  GOV_GROUP_LABEL,
  typeLine,
  type CountyMatch,
  type CountyMatchMethod,
  type GovGroup,
  type GovRow,
  type GovSnapshot,
} from "@/lib/external/govDomainsModel";

/** Rows shown per group before "Show all", and while a filter is active. */
export const ROWS_PER_GROUP = 8;
export const ROWS_PER_GROUP_FILTERED = 24;

export function rowLimit(expanded: boolean, filtering: boolean): number {
  return expanded ? Number.POSITIVE_INFINITY : filtering ? ROWS_PER_GROUP_FILTERED : ROWS_PER_GROUP;
}

const day = (s: string | null) => (s ? s.slice(0, 10) : null);

/** "CISA .gov registry as of 2026-10-22; GSA list of 2025-11-14", or a plain statement when the snapshot is unknown. */
export function snapshotText(s: GovSnapshot | null): string {
  if (!s) return "Registry snapshot date not recorded";
  const parts = [
    day(s.cisaZoneExport) ? `CISA .gov registry as of ${day(s.cisaZoneExport)}` : null,
    day(s.gsaCommitDate) ? `GSA list of ${day(s.gsaCommitDate)}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join("; ") : "Registry snapshot date not recorded";
}

/**
 * The line under a domain: organization, city and the type exactly as published. GSA gives no organization field, so an
 * entry without one shows GSA's own note, labelled as such.
 */
export function rowDetail(r: GovRow): string {
  const lead = r.organization ?? (r.note ? `GSA note: ${r.note}` : null);
  return [lead, r.city, typeLine(r)].filter(Boolean).join(" · ");
}

/** Short flags a row carries beyond its fields; empty for an ordinary entry. */
export function rowFlags(r: GovRow): string[] {
  const flags: string[] = [];
  if (r.path) flags.push(`Pages under /${r.path} only`);
  if (r.conflict) flags.push("Registries disagree");
  if (r.notUsed) flags.push("Also named in GSA's out-of-use list");
  if (r.states.length > 1) flags.push(`Listed for ${r.states.join(", ")}`);
  return flags;
}

export function rowName(r: GovRow): string {
  return r.path ? `${r.domain}/${r.path}` : r.domain;
}

export const METHOD_TEXT: Record<CountyMatchMethod, string> = {
  organization_name: "the Census name",
  organization_name_form_of: "the Census name in its “… of …” form",
  gsa_note: "the Census name and state",
};

/** One sentence per match saying exactly how it was made. */
export function matchLine(m: CountyMatch): string {
  return `${m.detail} (${METHOD_TEXT[m.method]})`;
}

/** The group-chip label with its count. */
export function chipLabel(group: GovGroup | "unassigned" | "", count: number): string {
  const name =
    group === "" ? "All" : group === "unassigned" ? "Level not recorded" : GOV_GROUP_LABEL[group];
  return `${name} ${count.toLocaleString("en-US")}`;
}

/** What the section says when the list is empty, by cause. */
export function emptyText(opts: { filtering: boolean; stateName: string }): string {
  return opts.filtering
    ? "No registered government website matches this filter."
    : `Neither registry gives ${opts.stateName} as the state of any listed domain.`;
}
