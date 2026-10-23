import { agencyBlockIds } from "@/components/agencies/agencyBlocks";

/** The landing page's recall cards: one national yearly series per recalling agency. */
export const LANDING_RECALL_BLOCKS = [
  "cpsc-recalls",
  "nhtsa-recalls",
  "fda-recalls",
  "fsis-recalls",
] as const;

/** Federal Register agency id of each agency page (/safety?agency=...). */
const SAFETY_AGENCY_ID: Readonly<Record<string, number>> = { FDA: 199, CPSC: 84, NHTSA: 345 };

export const safetyAgencyBlockIds = (agency: string): readonly string[] => {
  const id = SAFETY_AGENCY_ID[agency];
  return id === undefined ? [] : agencyBlockIds(id);
};
