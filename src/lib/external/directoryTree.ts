/** Pure grouping for the Courts and Judges folder drill-down. Uses only fields the listings supply; missing → "Not recorded". */
import { nameKey } from "./entityView";

export const NOT_RECORDED = "Not recorded";

export type CourtRow = { id: string; title: string; system: string; type: string; state: string };
export type JudgeRow = {
  id: string;
  name: string;
  /** Scalar labels are retained for display; folder membership uses explicit arrays. */
  system: string;
  state: string;
  systems: string[];
  states: string[];
  courts: string[];
  profileLayer: string;
  photo: string | null;
};

/** Court listing item → compact row. Court type is the first segment of the listing subtitle (e.g. "Federal district"). */
export function toCourtRow(it: Record<string, unknown>): CourtRow {
  const cells = (it["cells"] ?? {}) as Record<string, unknown>;
  const sub = typeof it["subtitle"] === "string" ? (it["subtitle"] as string) : "";
  const type = sub.split(" · ")[0]?.trim() ?? "";
  return {
    id: String(it["id"]),
    title: String(it["title"] ?? cells["court"] ?? it["id"]),
    system: String(cells["system"] ?? "").trim() || NOT_RECORDED,
    type: type || NOT_RECORDED,
    state:
      String(cells["state"] ?? "")
        .trim()
        .toUpperCase() || NOT_RECORDED,
  };
}

export function toJudgeRow(it: Record<string, unknown>): JudgeRow {
  const system = String(it["system"] ?? "").trim() || NOT_RECORDED;
  const state = String(it["state"] ?? "").trim() || NOT_RECORDED;
  const systems = Array.isArray(it["systems"])
    ? recordedStrings(it["systems"]).map((s) =>
        s === "federal" ? "Federal" : s === "state" ? "State" : s,
      )
    : system === NOT_RECORDED
      ? []
      : [system];
  const states = Array.isArray(it["states"])
    ? recordedStrings(it["states"])
    : state === NOT_RECORDED
      ? []
      : [state];
  return {
    id: String(it["id"]),
    name: String(it["name"] ?? it["title"] ?? it["id"]),
    system,
    state,
    systems,
    states,
    courts: recordedStrings(it["courts"]),
    profileLayer:
      typeof it["profile_layer"] === "string" && it["profile_layer"].trim()
        ? it["profile_layer"].trim()
        : NOT_RECORDED,
    photo:
      typeof it["photo_url"] === "string" && it["photo_url"] ? (it["photo_url"] as string) : null,
  };
}

export type Count = { key: string; count: number };

/** Count rows by a key; a row with several keys (e.g. a judge on two courts) counts once per key. */
export function countBy<T>(rows: T[], key: (r: T) => string | string[]): Count[] {
  const m = new Map<string, number>();
  for (const r of rows) {
    const k = key(r);
    for (const x of new Set(Array.isArray(k) ? (k.length ? k : [NOT_RECORDED]) : [k]))
      m.set(x, (m.get(x) ?? 0) + 1);
  }
  return [...m.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) =>
      a.key === NOT_RECORDED
        ? 1
        : b.key === NOT_RECORDED
          ? -1
          : b.count - a.count || a.key.localeCompare(b.key),
    );
}

export const judgeCourts = (j: JudgeRow) => (j.courts.length ? j.courts : [NOT_RECORDED]);
export const judgeStates = (j: JudgeRow) => (j.states.length ? j.states : [NOT_RECORDED]);
export const judgeSystems = (j: JudgeRow) => (j.systems.length ? j.systems : [NOT_RECORDED]);

/** Counts profile records in recorded source layers, without treating names as identities. */
export function judgeProfileInventory(rows: JudgeRow[]) {
  const consolidatedProfiles = rows.filter((r) => r.profileLayer === "consolidated_entity").length;
  const officialSourceProfiles = rows.filter((r) => r.profileLayer === "official_source").length;
  return {
    records: rows.length,
    consolidatedProfiles,
    officialSourceProfiles,
    otherProfiles: rows.length - consolidatedProfiles - officialSourceProfiles,
  };
}

/** Intersects profile-level association sets, without asserting paired court/state service,
 * governing law or verified current service. */
export function filterJudgeProfiles(
  rows: JudgeRow[],
  filters: { system?: string | undefined; state?: string | undefined; court?: string | undefined },
): JudgeRow[] {
  return rows.filter(
    (r) =>
      (!filters.system || judgeSystems(r).includes(filters.system)) &&
      (!filters.state || judgeStates(r).includes(filters.state)) &&
      (!filters.court || filters.court === "*" || judgeCourts(r).includes(filters.court)),
  );
}

/** Exact person identity for links. Initials, suffixes and diacritics remain significant. */
export function exactPersonNameKey(name: string): string {
  return name.normalize("NFC").toLowerCase().replace(/[.,]/g, " ").replace(/\s+/g, " ").trim();
}

/** Explicit array members only. Source scalars are never split into inferred associations. */
function recordedStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? [
        ...new Set(
          value
            .filter((v): v is string => typeof v === "string")
            .map((v) => v.trim())
            .filter(Boolean),
        ),
      ]
    : [];
}

/** Exact normalized-name lookup. Returns the judge id only when exactly one judge has that name; never guesses. */
export function makeJudgeMatcher(judges: JudgeRow[]) {
  const m = new Map<string, string[]>();
  for (const j of judges) {
    const k = exactPersonNameKey(j.name);
    if (k) m.set(k, [...(m.get(k) ?? []), j.id]);
  }
  return (name: string): string | null => {
    const ids = m.get(exactPersonNameKey(name));
    return ids && ids.length === 1 ? ids[0]! : null;
  };
}

/** First letter of the surname (last word of the normalized name) for the A–Z entry. */
export function surnameLetter(name: string): string {
  const parts = nameKey(name).split(" ").filter(Boolean);
  const c = (parts[parts.length - 1] ?? "").charAt(0).toUpperCase();
  return /^[A-Z]$/.test(c) ? c : "A";
}
