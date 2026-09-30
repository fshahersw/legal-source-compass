import type { Agency } from "./agency.functions";

/** Departments are agencies whose listed name ends in "Department"; others are independent or component agencies. */
export function isDepartment(name: string): boolean {
  return /\bDepartment$/.test(name.trim());
}

export function splitAgencies(rows: Agency[]) {
  const sorted = [...rows].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return { departments: sorted.filter((a) => isDepartment(a.name)), others: sorted.filter((a) => !isDepartment(a.name)) };
}

/** Safety folder for agencies that have safety datasets in the corpus, matched by exact listed name. */
export const SAFETY_AGENCY: Record<string, string> = {
  "Food and Drug Administration": "FDA",
  "Consumer Product Safety Commission": "CPSC",
};
