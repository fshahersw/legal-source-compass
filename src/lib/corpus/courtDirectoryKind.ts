import type { CourtRow } from "@/lib/external/directoryTree";

/** The source directory also contains explicitly typed reference collections.
 * Exclude only known non-court types from court navigation, never infer from names.
 * Unknown types remain available and are still labelled by their recorded type.
 */
export function isJudicialCourtRecord(row: Pick<CourtRow, "type">): boolean {
  const type = row.type.trim().toLowerCase().replace(/\s+/g, " ");
  return (
    !/^(?:(?:state|federal) )?attorney general\b/.test(type) &&
    !/^state judiciary system\b/.test(type)
  );
}
