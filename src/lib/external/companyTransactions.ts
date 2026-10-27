/**
 * Corporate transactions of a profiled company from FTC Hart-Scott-Rodino early termination notices
 * (ftc_hsr_early_terminations), joined only on an exact normalised name key (the regfin/enforcement exact-key rule)
 * that no other profiled company shares. Pure; no I/O.
 *
 * A notice is the FTC's publication that early termination was granted for a filing. It covers only filings granted
 * early termination, so a year without notices is not evidence that no deal happened, and the acquired party can be
 * the seller's parent rather than the business sold.
 */

export type HsrNotice = {
  transaction: string;
  date: string | null;
  acquiring: string;
  acquired: string;
  url: string | null;
};

export type CompanyTransaction = HsrNotice & { role: "acquirer" | "target" | "both" };

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const obj = (v: unknown) =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/** One notice row (cells as stored); null when the parties or transaction number are missing. */
export function parseNotice(row: { c?: unknown; source_url?: unknown }): HsrNotice | null {
  const c = obj(row.c);
  const transaction = str(c?.["transaction_number"]);
  const acquiring = str(c?.["acquiring_party"]);
  const acquired = str(c?.["acquired_party"]);
  if (!transaction || !/^\d{4,12}$/.test(transaction) || !acquiring || !acquired) return null;
  const date = str(c?.["date"]);
  const url = str(row.source_url);
  return {
    transaction,
    date: date && ISO.test(date) ? date : null,
    acquiring,
    acquired,
    url: url && /^https?:\/\//.test(url) ? url : null,
  };
}

/**
 * Notices where the company is the acquiring or the acquired party by exact key. Notices repeated under one
 * transaction number with the same parties count once. Newest first.
 */
export function matchTransactions(
  notices: readonly HsrNotice[],
  key: string,
  keyOf: (name: string) => string,
): CompanyTransaction[] {
  if (!key) return [];
  const seen = new Set<string>();
  const out: CompanyTransaction[] = [];
  for (const n of notices) {
    const a = keyOf(n.acquiring) === key;
    const t = keyOf(n.acquired) === key;
    if (!a && !t) continue;
    const id = `${n.transaction}\u0000${n.acquiring}\u0000${n.acquired}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ ...n, role: a && t ? "both" : a ? "acquirer" : "target" });
  }
  return out.sort(
    (x, y) => (y.date ?? "").localeCompare(x.date ?? "") || y.transaction.localeCompare(x.transaction),
  );
}

/** Whether the key identifies exactly one profiled company (else the join is not made). */
export function uniqueKey(key: string, profileNames: readonly string[], keyOf: (name: string) => string) {
  return !!key && profileNames.filter((n) => keyOf(n) === key).length === 1;
}

/**
 * Years in which early-termination grants collapsed: a run of years each below a tenth of the median of every earlier
 * year (at least five earlier years). In the FTC series this is 2021–2024, when grants were suspended (71, 0, 0, 6).
 */
export function suspensionYears(calendar: readonly { year: number; count: number }[]): number[] {
  const sorted = [...calendar].sort((a, b) => a.year - b.year);
  for (let i = 5; i < sorted.length; i++) {
    const prior = sorted.slice(0, i).map((c) => c.count).sort((a, b) => a - b);
    const mid = Math.floor(prior.length / 2);
    const median = prior.length % 2 ? prior[mid]! : (prior[mid - 1]! + prior[mid]!) / 2;
    if (median <= 0 || sorted[i]!.count >= median / 10) continue;
    const run: number[] = [];
    for (let j = i; j < sorted.length && sorted[j]!.count < median / 10; j++) run.push(sorted[j]!.year);
    return run;
  }
  return [];
}

/** Deals per year by role, for the timeline chart (years from the first to the last notice). */
export function dealsByYear(rows: readonly CompanyTransaction[]) {
  const years = rows.map((r) => Number(r.date?.slice(0, 4))).filter((y) => Number.isInteger(y));
  if (!years.length) return [];
  const lo = Math.min(...years);
  const hi = Math.max(...years);
  const out: { year: string; acquirer: number; target: number }[] = [];
  for (let y = lo; y <= hi; y++) out.push({ year: String(y), acquirer: 0, target: 0 });
  for (const r of rows) {
    const y = Number(r.date?.slice(0, 4));
    const row = out.find((o) => o.year === String(y));
    if (!row) continue;
    if (r.role !== "target") row.acquirer += 1;
    if (r.role !== "acquirer") row.target += 1;
  }
  return out;
}
