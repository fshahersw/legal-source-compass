import { agencyBlockIds } from "@/components/agencies/agencyBlocks";

/**
 * The analytics block "fda-recalls" counts openFDA product rows (one recall can list hundreds of products), so the
 * /safety pages show FDA recalls as events instead (FdaRecallEventsSection) and leave that block out here. The block and
 * its reader are unchanged; it still serves the Analytics hub.
 */
export const FDA_ENTRY_BLOCK = "fda-recalls";

/** The landing page's recall cards: one national yearly series per recalling agency (FDA shown as events below). */
export const LANDING_RECALL_BLOCKS = ["cpsc-recalls", "nhtsa-recalls", "fsis-recalls"] as const;

/** Federal Register agency id of each agency page (/safety?agency=...). */
const SAFETY_AGENCY_ID: Readonly<Record<string, number>> = { FDA: 199, CPSC: 84, NHTSA: 345 };

export const safetyAgencyBlockIds = (agency: string): readonly string[] => {
  const id = SAFETY_AGENCY_ID[agency];
  return id === undefined ? [] : agencyBlockIds(id).filter((b) => b !== FDA_ENTRY_BLOCK);
};

/**
 * Collections left out of an agency's summed count on /safety: a superseded snapshot whose records are also in the
 * agency's current dataset (9,966 of the 9,970 CPSC local recall numbers are in the CPSC API dataset). They stay listed
 * under the agency, marked, and reachable.
 */
export const SUPERSEDED_DATASETS: Readonly<Record<string, string>> = {
  agency_safety_cpsc_recalls_local:
    "Superseded snapshot (to 2026-08-20); its recalls are in the CPSC API collection",
};

/** Notes shown on a collection whose rows must not be read as complete. */
export const COLLECTION_CAVEATS: Readonly<Record<string, string>> = {
  agency_safety_fda_warning_letters:
    "Uneven 1,000-row sample: not a complete or even record of FDA's letters",
  agency_safety_nhtsa_investigations:
    "Some rows marked open are legacy (pre-2015) or lack a manufacturer and dates",
};
