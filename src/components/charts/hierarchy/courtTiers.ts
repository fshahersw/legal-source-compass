/**
 * courtTiers: groups recorded court rows into the tiers of a court system, highest first, using only each court's
 * recorded type. Types the tier list does not name go to "Other recorded courts", never into a guessed tier. Pure.
 */
import type { CourtRow } from "@/lib/external/directoryTree";

export type Tier = { id: string; label: string; types: string[]; count: number; note?: string };

const FEDERAL: { id: string; label: string; types: string[]; note?: string }[] = [
  { id: "appellate", label: "Courts of appeals", types: ["Federal appellate"] },
  { id: "district", label: "District courts", types: ["Federal district"] },
  { id: "bankruptcy", label: "Bankruptcy courts & appellate panels", types: ["Federal bankruptcy", "Federal bankruptcy appellate panel"] },
];
const FEDERAL_SIDE: { id: string; label: string; types: string[] }[] = [
  { id: "special", label: "Specialized federal courts", types: ["Federal special"] },
  { id: "military", label: "Military appellate courts", types: ["Military appellate"] },
];
const STATE: { id: string; label: string; types: string[] }[] = [
  { id: "supreme", label: "Court of last resort", types: ["State supreme"] },
  { id: "appellate", label: "Intermediate appellate courts", types: ["State appellate"] },
  { id: "trial", label: "Trial courts", types: ["State trial"] },
];
const STATE_SIDE: { id: string; label: string; types: string[] }[] = [
  { id: "special", label: "Special courts", types: ["State special"] },
];

function build(rows: readonly CourtRow[], spec: { id: string; label: string; types: string[]; note?: string }[]): Tier[] {
  return spec.map((t) => ({ ...t, count: rows.filter((r) => t.types.includes(r.type)).length }));
}

export function courtTiers(rows: readonly CourtRow[], system: "Federal" | "State", state?: string) {
  const all = rows.filter((r) => r.system === system && (system === "Federal" || r.state === state));
  // The U.S. Supreme Court is matched on its exact recorded id, never on its name.
  const scotus = system === "Federal" ? all.filter((r) => r.id === "scotus") : [];
  const scoped = all.filter((r) => r.id !== "scotus");
  const main = build(scoped, system === "Federal" ? FEDERAL : STATE);
  if (system === "Federal")
    main.unshift({ id: "scotus", label: "Supreme Court of the United States", types: [], count: scotus.length });
  const side = build(scoped, system === "Federal" ? FEDERAL_SIDE : STATE_SIDE).filter((t) => t.count > 0);
  const named = new Set([...main, ...side].flatMap((t) => t.types));
  const other = scoped.filter((r) => !named.has(r.type)).length;
  return { main, side, other, total: all.length };
}
