/**
 * Which of the Analytics hub's national series count an agency's own published data. The mapping is by exact Federal
 * Register agency id: a department is never given the series of one of its components.
 */

/** Federal Register agency id to the Analytics blocks that count that agency's own published data. */
export const AGENCY_BLOCKS: Readonly<Record<number, readonly string[]>> = {
  84: ["cpsc-recalls", "cpsc-hazards", "cpsc-deaths"], // Consumer Product Safety Commission
  145: ["epa-cases", "epa-penalties"], // Environmental Protection Agency
  192: ["ftc-actions", "ftc-sentinel"], // Federal Trade Commission
  199: ["fda-recalls", "fda-class-i", "faers", "caers"], // Food and Drug Administration
  201: ["fsis-recalls"], // Food Safety and Inspection Service
  268: ["doj-press", "doj-divisions"], // Justice Department
  345: ["nhtsa-recalls"], // National Highway Traffic Safety Administration
  386: ["osha-inspections", "osha-penalties"], // Occupational Safety and Health Administration
  466: ["sec-releases", "sec-amounts"], // Securities and Exchange Commission
  573: ["cfpb-complaints"], // Consumer Financial Protection Bureau
};

export const agencyBlockIds = (agencyId: number): readonly string[] =>
  AGENCY_BLOCKS[agencyId] ?? [];
