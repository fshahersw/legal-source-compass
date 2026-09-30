/** Pure grouping for the Courts and Judges folder drill-down. Uses only fields the listings supply; missing → "Not recorded". */
import { nameKey } from "./entityView";

export const NOT_RECORDED = "Not recorded";

export type CourtRow = { id: string; title: string; system: string; type: string; state: string };
export type JudgeRow = { id: string; name: string; system: string; state: string; courts: string[]; photo: string | null };

/** Court listing item → compact row. Court type is the first segment of the listing subtitle (e.g. "Federal district"). */
export function toCourtRow(it: Record<string, any>): CourtRow {
  const cells = (it["cells"] ?? {}) as Record<string, unknown>;
  const sub = typeof it["subtitle"] === "string" ? (it["subtitle"] as string) : "";
  const type = sub.split(" · ")[0]?.trim() ?? "";
  return {
    id: String(it["id"]),
    title: String(it["title"] ?? cells["court"] ?? it["id"]),
    system: String(cells["system"] ?? "").trim() || NOT_RECORDED,
    type: type || NOT_RECORDED,
    state: String(cells["state"] ?? "").trim().toUpperCase() || NOT_RECORDED,
  };
}

export function toJudgeRow(it: Record<string, any>): JudgeRow {
  const courts = Array.isArray(it["courts"]) ? (it["courts"] as unknown[]).map(String).filter(Boolean) : [];
  return {
    id: String(it["id"]),
    name: String(it["name"] ?? it["title"] ?? it["id"]),
    system: String(it["system"] ?? "").trim() || NOT_RECORDED,
    state: String(it["state"] ?? "").trim() || NOT_RECORDED,
    courts,
    photo: typeof it["photo_url"] === "string" && it["photo_url"] ? (it["photo_url"] as string) : null,
  };
}

export type Count = { key: string; count: number };

/** Count rows by a key; a row with several keys (e.g. a judge on two courts) counts once per key. */
export function countBy<T>(rows: T[], key: (r: T) => string | string[]): Count[] {
  const m = new Map<string, number>();
  for (const r of rows) {
    const k = key(r);
    for (const x of new Set(Array.isArray(k) ? (k.length ? k : [NOT_RECORDED]) : [k])) m.set(x, (m.get(x) ?? 0) + 1);
  }
  return [...m.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => (a.key === NOT_RECORDED ? 1 : b.key === NOT_RECORDED ? -1 : b.count - a.count || a.key.localeCompare(b.key)));
}

export const judgeCourts = (j: JudgeRow) => (j.courts.length ? j.courts : [NOT_RECORDED]);

/** Exact normalized-name lookup. Returns the judge id only when exactly one judge has that name; never guesses. */
export function makeJudgeMatcher(judges: JudgeRow[]) {
  const m = new Map<string, string[]>();
  for (const j of judges) { const k = nameKey(j.name); if (k) m.set(k, [...(m.get(k) ?? []), j.id]); }
  return (name: string): string | null => {
    const ids = m.get(nameKey(name));
    return ids && ids.length === 1 ? ids[0]! : null;
  };
}

/** First letter of the surname (last word of the normalized name) for the A–Z entry. */
export function surnameLetter(name: string): string {
  const parts = nameKey(name).split(" ").filter(Boolean);
  const c = (parts[parts.length - 1] ?? "").charAt(0).toUpperCase();
  return /^[A-Z]$/.test(c) ? c : "A";
}
