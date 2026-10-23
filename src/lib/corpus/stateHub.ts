import { STATES, stateByFips, stateByUsps } from "./geo";
import { isJudicialCourtRecord } from "./courtDirectoryKind";
import type { CourtRow, JudgeRow } from "@/lib/external/directoryTree";
/**
 * Puerto Rico has a state-style page (courts, judges, law, Census figures) but is not one of the 50 states and DC that the
 * map, rankings and state lists iterate, so it is recognised by identity here and is not part of STATES.
 */
export const PUERTO_RICO = { fips: "72", usps: "PR", name: "Puerto Rico" };
const byName = new Map([...STATES, PUERTO_RICO].map((s) => [s.name.toLowerCase(), s] as const));
/** Identity only: no caption, substring, venue or fuzzy-name inference. */
export function canonicalState(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).trim();
  return (
    stateByUsps.get(text.toUpperCase()) ??
    byName.get(text.toLowerCase()) ??
    (/^\d{1,2}$/.test(text) ? stateByFips.get(text.padStart(2, "0")) : undefined) ??
    (text.toUpperCase() === PUERTO_RICO.usps || text === PUERTO_RICO.fips
      ? PUERTO_RICO
      : undefined) ??
    null
  );
}
export function stateFromGeometry(shape: { id: unknown; name?: string }) {
  const id = String(shape.id);
  return /^\d{1,2}$/.test(id) ? (stateByFips.get(id.padStart(2, "0")) ?? null) : null;
}
export function countyInState(county: string, state: string): boolean {
  return /^\d{5}$/.test(county) && county.slice(0, 2) === canonicalState(state)?.fips;
}
export const STATE_HUB_TABS = ["overview", "courts", "judges", "sources", "counties"] as const;
export type StateHubTab = (typeof STATE_HUB_TABS)[number];
export type StateHubSearch = { tab?: StateHubTab; q?: string; system?: string; court?: string };
export function parseStateHubSearch(value: Record<string, unknown>): StateHubSearch {
  const tab = STATE_HUB_TABS.includes(value["tab"] as StateHubTab)
    ? (value["tab"] as StateHubTab)
    : "overview";
  const q = typeof value["q"] === "string" ? value["q"].trim().slice(0, 160) : "";
  const system = ["Federal", "State"].includes(value["system"] as string)
    ? (value["system"] as string)
    : "";
  const court = typeof value["court"] === "string" ? value["court"].trim().slice(0, 200) : "";
  return { tab, ...(q ? { q } : {}), ...(system ? { system } : {}), ...(court ? { court } : {}) };
}
export function filterStateCourts(
  rows: readonly CourtRow[],
  state: string,
  filters: { q?: string; system?: string } = {},
): CourtRow[] {
  const code = canonicalState(state)?.usps;
  if (!code) return [];
  const q = (filters.q ?? "").trim().toLocaleLowerCase();
  return rows.filter(
    (row) =>
      isJudicialCourtRecord(row) &&
      canonicalState(row.state)?.usps === code &&
      (!filters.system || row.system === filters.system) &&
      (!q || `${row.title} ${row.type}`.toLocaleLowerCase().includes(q)),
  );
}
/** Profile association sets are not paired service appointments or proof of current office. */
export function filterStateJudges(
  rows: readonly JudgeRow[],
  state: string,
  filters: { q?: string; system?: string; court?: string } = {},
): JudgeRow[] {
  const code = canonicalState(state)?.usps;
  if (!code) return [];
  const q = (filters.q ?? "").trim().toLocaleLowerCase();
  return rows.filter(
    (row) =>
      row.states.some((s) => canonicalState(s)?.usps === code) &&
      (!filters.system || row.systems.includes(filters.system)) &&
      (!filters.court || row.courts.includes(filters.court)) &&
      (!q || row.name.toLocaleLowerCase().includes(q)),
  );
}
