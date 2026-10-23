/**
 * Where former addresses lead now. Every mapping keeps the view the old URL showed: its query is carried over field
 * by field, and anything unrecognised is dropped rather than guessed. Pure, so the redirects are tested.
 */

/** Top tabs of /enforcement (Overview has no `tab`). */
export const ENFORCEMENT_TABS = [
  "actions",
  "exclusions",
  "oversight",
  "merger",
  "sources",
] as const;
export type EnforcementTabId = (typeof ENFORCEMENT_TABS)[number];

/** Agencies of the "Actions by agency" tab, in display order; the first is shown when none is chosen. */
export const ENFORCEMENT_AGENCIES = [
  { id: "doj", label: "DOJ", name: "Justice Department press releases" },
  { id: "ftc", label: "FTC", name: "Federal Trade Commission cases and actions" },
  { id: "sec", label: "SEC", name: "Securities and Exchange Commission actions" },
  { id: "frb", label: "Federal Reserve", name: "Federal Reserve Board enforcement actions" },
  { id: "epa", label: "EPA", name: "EPA civil enforcement cases" },
  { id: "osha", label: "OSHA", name: "OSHA inspections and penalties" },
  { id: "cpsc", label: "CPSC", name: "CPSC recalls" },
  { id: "cfpb", label: "CFPB", name: "CFPB consumer complaints" },
] as const;
export type EnforcementAgency = (typeof ENFORCEMENT_AGENCIES)[number]["id"];
export const DEFAULT_ENFORCEMENT_AGENCY: EnforcementAgency = "doj";

export type EnforcementSearch = {
  tab?: EnforcementTabId | undefined;
  agency?: EnforcementAgency | undefined;
  /** EPA state filter (two-letter code); only with agency=epa. */
  state?: string | undefined;
};

export type EnforcementLocation =
  | { to: "/enforcement"; search: EnforcementSearch }
  | { to: "/law/rulemaking"; search: Record<string, never> }
  | { to: "/litigation/settlements"; search: { view?: "notices" } };

const AGENCY_IDS = new Set<string>(ENFORCEMENT_AGENCIES.map((a) => a.id));
const isAgency = (v: unknown): v is EnforcementAgency => typeof v === "string" && AGENCY_IDS.has(v);
const isTab = (v: unknown): v is EnforcementTabId =>
  typeof v === "string" && (ENFORCEMENT_TABS as readonly string[]).includes(v);
const stateCode = (v: unknown) => (typeof v === "string" && /^[A-Z]{2}$/.test(v) ? v : undefined);

function actions(agency: EnforcementAgency | undefined, state: string | undefined) {
  const search: EnforcementSearch = { tab: "actions" };
  if (agency) search.agency = agency;
  if (agency === "epa" && state) search.state = state;
  return { to: "/enforcement" as const, search };
}

/**
 * The /enforcement location for a query of either /enforcement or the former /law/enforcement:
 * - former agency-data tabs: ?tab=cpsc|cfpb|osha → Actions by agency with that agency; the former default (EPA,
 *   optionally ?state=XX) → agency=epa with the state;
 * - former action sections: ?actions=doj|ftc|sec|frb → Actions by agency; ?actions=settlements and ?tab=settlements
 *   → Litigation › Settlements (confirmed settlements and notices); ?tab=rulemaking → Law & government › Rulemaking;
 * - exclusions, oversight, merger and sources keep their tab.
 * A bare address opens the Enforcement overview (the former bare /law/enforcement showed EPA cases, which are one
 * click away there).
 */
export function resolveEnforcementLocation(
  raw: Readonly<Record<string, unknown>>,
): EnforcementLocation {
  const state = stateCode(raw["state"]);
  const formerAction = raw["actions"];
  if (formerAction === "settlements") return { to: "/litigation/settlements", search: {} };
  if (
    formerAction === "doj" ||
    formerAction === "ftc" ||
    formerAction === "sec" ||
    formerAction === "frb"
  )
    return actions(formerAction, undefined);
  const tab = raw["tab"];
  if (tab === "rulemaking") return { to: "/law/rulemaking", search: {} };
  if (tab === "settlements") return { to: "/litigation/settlements", search: { view: "notices" } };
  if (tab === "epa" || tab === "cpsc" || tab === "cfpb" || tab === "osha")
    return actions(tab, state);
  if (tab === "actions") return actions(isAgency(raw["agency"]) ? raw["agency"] : undefined, state);
  if (isTab(tab)) return { to: "/enforcement", search: { tab } };
  if (isAgency(raw["agency"])) return actions(raw["agency"], state);
  // The former bare page showed EPA cases; a state filter only ever applied to them.
  if (state) return actions("epa", state);
  return { to: "/enforcement", search: {} };
}

/** Only the keys /enforcement reads, as strings; used to tell a canonical query from one that must be rewritten. */
export function enforcementQueryOf(raw: Readonly<Record<string, unknown>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of ["tab", "agency", "state", "actions"])
    if (typeof raw[key] === "string" && raw[key]) out[key] = raw[key] as string;
  return out;
}

/** True when `raw` is already the canonical /enforcement query (no redirect needed). */
export function isCanonicalEnforcementQuery(raw: Readonly<Record<string, unknown>>): boolean {
  const target = resolveEnforcementLocation(raw);
  if (target.to !== "/enforcement") return false;
  const have = enforcementQueryOf(raw);
  const want = target.search as Record<string, string | undefined>;
  const wantKeys = Object.keys(want).filter((k) => want[k]);
  return wantKeys.length === Object.keys(have).length && wantKeys.every((k) => have[k] === want[k]);
}

/** /litigation/settlements views: confirmed settlements (default) and settlement notices. */
export type SettlementsSearch = { view?: "notices" | undefined };
export const normalizeSettlementsSearch = (
  raw: Readonly<Record<string, unknown>>,
): SettlementsSearch => (raw["view"] === "notices" ? { view: "notices" } : {});

/** The former /laws listing opens Federal law; any recognised /law query it carried is kept. */
export function lawsRedirectSearch(raw: Readonly<Record<string, unknown>>): Record<string, string> {
  const out: Record<string, string> = { scope: "federal" };
  for (const key of ["ds", "view", "scope", "state", "group"]) {
    const v = raw[key];
    if (typeof v === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(v)) out[key] = v;
  }
  return out;
}

/** The former /mdls page listed the JPML MDLs: the MDL collection of the matters browser (it reads only `ds`). */
export const MDLS_REDIRECT_SEARCH = { ds: "mdls" } as const;
