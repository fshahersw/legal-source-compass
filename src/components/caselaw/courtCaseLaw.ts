/** Pure helpers of the court case-law pages (/cases/courts, /cases/courts/<court>). */
import { TIERS, type Tier } from "@/lib/external/caselaw";
import type { CourtOption, CourtYears } from "@/lib/external/caselaw.functions";

export type DirectoryState = { tier?: Tier | undefined; jur?: string | undefined };

export function normalizeDirectory(s: Record<string, unknown>): DirectoryState {
  const out: DirectoryState = {};
  const t = typeof s["tier"] === "number" ? s["tier"] : Number(s["tier"]);
  if (Number.isInteger(t) && t >= 1 && t <= 7) out.tier = t as Tier;
  if (typeof s["jur"] === "string" && /^[A-Z]{2}$/.test(s["jur"])) out.jur = s["jur"];
  return out;
}

/** Per tier: courts, cases and cases with stored text (sums of the court rows). */
export function tierTotals(courts: CourtOption[]) {
  return TIERS.map((tier) => {
    const rows = courts.filter((c) => c.tier === tier);
    const withText = rows.every((c) => c.casesWithText != null)
      ? rows.reduce((s, c) => s + (c.casesWithText ?? 0), 0)
      : null;
    return { tier, courts: rows.length, cases: rows.reduce((s, c) => s + c.cases, 0), withText };
  }).filter((r) => r.courts > 0);
}

export type CourtCaseState = {
  year?: number | undefined;
  sort?: "newest" | "oldest" | "cited" | undefined;
  page?: number | undefined;
};

export function normalizeCourtCases(s: Record<string, unknown>): CourtCaseState {
  const out: CourtCaseState = {};
  const y = typeof s["year"] === "number" ? s["year"] : Number(s["year"]);
  if (Number.isInteger(y) && y >= 1600 && y <= 2100) out.year = y;
  if (s["sort"] === "oldest" || s["sort"] === "cited") out.sort = s["sort"];
  const p = typeof s["page"] === "number" ? s["page"] : Number(s["page"]);
  if (Number.isInteger(p) && p >= 2 && p <= 200) out.page = p;
  return out;
}

/** Continuous year axis from the first to the last recorded year; years without decisions are 0 (counted, none held). */
export function yearSeries(d: CourtYears) {
  if (!d.years.length) return null;
  const first = d.years[0]!.year;
  const last = d.years[d.years.length - 1]!.year;
  const by = new Map(d.years.map((y) => [y.year, y] as const));
  const keys: string[] = [];
  for (let y = first; y <= last; y++) keys.push(String(y));
  return {
    keys,
    withText: keys.map((k) => ({ key: k, value: by.get(Number(k))?.withText ?? 0 })),
    noText: keys.map((k) => {
      const r = by.get(Number(k));
      return { key: k, value: r ? r.cases - r.withText : 0 };
    }),
  };
}
