/** Pure view models for County Business Patterns (establishments, employees, payroll by NAICS sector). */
import { CBP_SECTORS, type CbpCell, type CbpGeo } from "@/lib/external/censusModel";

export type CbpTotal = {
  year: number;
  establishments: number | null;
  employees: number | null;
  payroll: number | null;
};

export function cbpTotals(geo: CbpGeo): CbpTotal[] {
  const total = geo.series["00"] ?? {};
  return Object.keys(total)
    .map(Number)
    .sort((a, b) => a - b)
    .map((year) => {
      const c = total[String(year)]!;
      return { year, establishments: c.establishments, employees: c.employees, payroll: c.payroll };
    });
}

export type SectorRow = {
  sector: string;
  label: string;
  establishments: number | null;
  employees: number | null;
  payroll: number | null;
  /** Share of all-sector employment, computed from the two published counts; null if either is withheld. */
  share: number | null;
  withheld: string | null;
};

/** One release's sector rows, largest published employment first, withheld sectors last. */
export function sectorRows(geo: CbpGeo, year: number): SectorRow[] {
  const total = geo.series["00"]?.[String(year)]?.employees ?? null;
  const rows: SectorRow[] = [];
  for (const [sector, byYear] of Object.entries(geo.series)) {
    if (sector === "00") continue;
    const cell: CbpCell | undefined = byYear[String(year)];
    if (!cell) continue;
    const flag = cell.flags["emp"] ?? cell.flags["pay"] ?? null;
    rows.push({
      sector,
      label: CBP_SECTORS[sector] ?? sector,
      establishments: cell.establishments,
      employees: cell.employees,
      payroll: cell.payroll,
      share:
        cell.employees != null && total != null && total > 0
          ? (cell.employees / total) * 100
          : null,
      withheld: cell.employees == null ? flag : null,
    });
  }
  return rows.sort(
    (a, b) => (b.employees ?? -1) - (a.employees ?? -1) || a.label.localeCompare(b.label),
  );
}

export const FLAG_MEANING: Record<string, string> = {
  D: "withheld to avoid disclosing data for individual companies",
  S: "withheld because the estimate did not meet publication standards",
};
