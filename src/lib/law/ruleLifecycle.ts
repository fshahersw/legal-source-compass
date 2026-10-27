/**
 * Proposal-to-final pace per agency (pure parse of law_rule_lifecycle_v1; contract drafted for the lead, see the
 * workstream report). One row per agency RIN prefix: RINs with a proposed rule, how many reached a final rule after
 * their first proposal, the median and quartile days between the first proposal and the first final rule after it, and
 * proposals since 2021 with no final rule in the Federal Register records held. Agencies with fewer than
 * MIN_FINALIZED finalized RINs are listed but not ranked (CPSC rarely uses RINs).
 */
export const MIN_FINALIZED = 20;

export type LifecycleRow = {
  agency: string;
  prefix: string;
  rinsProposed: number | null;
  finalized: number | null;
  medianDays: number | null;
  p25Days: number | null;
  p75Days: number | null;
  openSince2021: number | null;
};

export type RuleLifecycle = { asOf: string | null; rows: LifecycleRow[] };

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {};
const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

export function parseRuleLifecycle(raw: unknown): RuleLifecycle | null {
  const r = obj(raw);
  if (!Array.isArray(r["agencies"])) return null;
  const rows = (r["agencies"] as unknown[]).flatMap((a): LifecycleRow[] => {
    const o = obj(a);
    const agency = str(o["agency"]);
    const prefix = str(o["prefix"]);
    if (!agency || !prefix) return [];
    return [
      {
        agency,
        prefix,
        rinsProposed: num(o["rins_proposed"]),
        finalized: num(o["finalized"]),
        medianDays: num(o["median_days"]),
        p25Days: num(o["p25_days"]),
        p75Days: num(o["p75_days"]),
        openSince2021: num(o["open_since_2021"]),
      },
    ];
  });
  return { asOf: str(r["as_of"]), rows };
}

/** Rows with enough finalized RINs to compare a median. */
export function comparable(rows: readonly LifecycleRow[]): LifecycleRow[] {
  return rows.filter((r) => (r.finalized ?? 0) >= MIN_FINALIZED && r.medianDays !== null);
}
