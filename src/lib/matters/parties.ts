/**
 * Pure: parties and counsel rows for a matter.
 *
 * Names are shown exactly as the source recorded them and are never merged. Following the corpus's own party-name
 * rule, a party row whose name does not read as an organization, committee or role is counted, not listed.
 */

import { isObj, str } from "./values";

export type PartyKind = "firm" | "attorney" | "party";

export type CounselRow = {
  id: string;
  kind: PartyKind;
  /** Name as recorded (firm text, attorney name, or party name). */
  name: string;
  /** Firm line / location for attorneys, the source's qualifier for firms and parties. */
  detail: string | null;
  /** Role as recorded ("Defendant", "Lead attorney"...); null when the source says "not returned"/"not retrieved". */
  role: string | null;
  /** The source's own count text, e.g. "3 attorney records". */
  countText: string | null;
};

export type AppearanceRow = {
  id: string;
  attorney: string;
  firm: string | null;
  firmId: string | null;
  role: string | null;
  side: string | null;
  linkage: string | null;
  /** The source's own matter (docket) identifier for this appearance; distinguishes otherwise identical rows. */
  matterId: string | null;
};

const UNKNOWN_ROLE = /^(not (returned|retrieved)|not recorded|unknown)\b/i;

function roleOf(v: unknown): string | null {
  const s = str(v);
  return s && !UNKNOWN_ROLE.test(s) ? s : null;
}

export function parseCounselRow(item: unknown, kind: PartyKind): CounselRow | null {
  if (!isObj(item)) return null;
  const cells = isObj(item["cells"]) ? item["cells"] : {};
  const id = str(item["id"]);
  const name = str(item["title"]) ?? str(cells["name"]);
  if (!id || !name) return null;
  const countText = str(cells["count"]);
  return {
    id,
    kind,
    name,
    detail: str(item["subtitle"]),
    role: roleOf(cells["role"]),
    countText: countText && !/^not (returned|retrieved)/i.test(countText) ? countText : null,
  };
}

export function parseAppearanceRow(
  item: unknown,
  filters?: unknown,
  facts?: unknown,
): AppearanceRow | null {
  if (!isObj(item)) return null;
  const cells = isObj(item["cells"]) ? item["cells"] : {};
  const id = str(item["id"]);
  const attorney = str(item["title"]);
  if (!id || !attorney) return null;
  const f = isObj(filters) ? filters : {};
  const firmIds = Array.isArray(f["firm"]) ? f["firm"] : [];
  let matterId: string | null = null;
  if (Array.isArray(facts))
    for (const fact of facts)
      if (
        Array.isArray(fact) &&
        fact[0] === "Matter id (AWS release)" &&
        typeof fact[1] === "string" &&
        fact[1].trim()
      )
        matterId = fact[1].trim();
  return {
    id,
    attorney,
    firm: str(cells["firm"]) ?? str(item["subtitle"]),
    firmId: typeof firmIds[0] === "string" ? firmIds[0] : null,
    role: roleOf(cells["role"]),
    side: str(cells["side"]),
    linkage: str(cells["linkage"]),
    matterId,
  };
}

const ORGANIZATION =
  /\b(inc|incorporated|llc|llp|lp|ltd|limited|corp|corporation|company|plc|gmbh|holdings|group|partners|associates|committee|council|counsel|commission|department|agency|bureau|authority|board|district|county|city|state of|commonwealth|united states|university|college|hospital|health|bank|trust|fund|association|foundation|school|systems|technologies|laboratories|pharmaceuticals?|international|enterprises|industries|services|solutions|center|steering|executive|liaison)\b/i;

/**
 * 'list' when the recorded name reads as an organization, committee or role, or when the source marks the party a
 * defendant; 'count' otherwise (an individual's name on the plaintiff side is counted, not listed).
 */
export function partyDisplay(row: Pick<CounselRow, "name" | "role">): "list" | "count" {
  if (/^defendant/i.test(row.role ?? "")) return "list";
  if (ORGANIZATION.test(row.name)) return "list";
  return "count";
}

export function splitParties(rows: CounselRow[]): { listed: CounselRow[]; counted: number } {
  const listed: CounselRow[] = [];
  let counted = 0;
  for (const r of rows) {
    if (partyDisplay(r) === "list") listed.push(r);
    else counted++;
  }
  return { listed, counted };
}

/** Firm text (as recorded) that contains the firm's own name; an exact phrase test, not fuzzy matching. */
export function mentionsSeegerWeiss(text: string | null | undefined): boolean {
  return /\bseeger[\s,]+weiss\b/i.test(text ?? "");
}

export type AppearanceFacets = {
  side: { value: string; count: number }[];
  firm: { value: string; label: string; count: number }[];
  role: { value: string; count: number }[];
};

export function appearanceFacets(rows: AppearanceRow[]): AppearanceFacets {
  const count = <T extends string>(values: (T | null)[]): { value: T; count: number }[] => {
    const m = new Map<T, number>();
    for (const v of values) if (v) m.set(v, (m.get(v) ?? 0) + 1);
    return [...m.entries()]
      .map(([value, n]) => ({ value, count: n }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
  };
  const firms = new Map<string, { label: string; count: number }>();
  for (const r of rows) {
    const key = r.firmId ?? r.firm;
    if (!key) continue;
    const cur = firms.get(key);
    if (cur) cur.count++;
    else firms.set(key, { label: r.firm ?? key, count: 1 });
  }
  return {
    side: count(rows.map((r) => r.side)),
    role: count(rows.map((r) => r.role)),
    firm: [...firms.entries()]
      .map(([value, v]) => ({ value, label: v.label, count: v.count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
  };
}
