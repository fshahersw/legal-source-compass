import { STATES, stateByFips, stateByUsps } from "./geo";
import type { CourtRow, JudgeRow } from "@/lib/external/directoryTree";
const byName = new Map(STATES.map((s) => [s.name.toLowerCase(), s]));
/** Identity only: no caption, substring, venue or fuzzy-name inference. */
export function canonicalState(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).trim();
  return (
    stateByUsps.get(text.toUpperCase()) ??
    byName.get(text.toLowerCase()) ??
    (/^\d{1,2}$/.test(text) ? stateByFips.get(text.padStart(2, "0")) : undefined) ??
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
