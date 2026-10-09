import type { Agency } from "./agency.functions";

/** Keep unknown counts distinct from recorded zero; reject non-agency filter options. */
export function parseAgencyOptions(options: readonly unknown[]): Agency[] {
  return options.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const row = value as Record<string, unknown>;
    const id =
      typeof row["value"] === "string" || typeof row["value"] === "number"
        ? String(row["value"])
        : "";
    const name = typeof row["label"] === "string" ? row["label"].trim() : "";
    if (!/^\d{1,6}$/.test(id) || !name) return [];
    const raw = row["count"];
    const count = typeof raw === "number" && Number.isSafeInteger(raw) && raw >= 0 ? raw : null;
    return [{ id, name, count }];
  });
}

export function isDepartment(name: string): boolean {
  return /\bDepartment$/.test(name.trim());
}

export function splitAgencies(rows: Agency[]) {
  const sorted = [...rows].sort(
    (a, b) => (b.count ?? -1) - (a.count ?? -1) || a.name.localeCompare(b.name),
  );
  return {
    departments: sorted.filter((a) => isDepartment(a.name)),
    others: sorted.filter((a) => !isDepartment(a.name)),
  };
}

/** Exact listed name only; a component is never silently merged into its parent. */
export const SAFETY_AGENCY: Record<string, string> = {
  "Food and Drug Administration": "FDA",
  "Consumer Product Safety Commission": "CPSC",
};
