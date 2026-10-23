/**
 * The self-updating sources (one per row of ingest.sources in database/contracts/ingest-v1.sql; a test keeps the two in
 * step) and the sources considered and not scheduled, with the reason.
 */
import { cpscRecalls } from "./sources/cpscRecalls.ts";
import { federalRegister } from "./sources/federalRegister.ts";
import { ftcHsr } from "./sources/ftcHsr.ts";
import {
  openfdaDeviceEnforcement,
  openfdaDrugEnforcement,
  openfdaFoodEnforcement,
} from "./sources/openfdaEnforcement.ts";
import type { SourceAdapter } from "./types.ts";

export const SOURCES: SourceAdapter[] = [
  federalRegister,
  openfdaDrugEnforcement,
  openfdaDeviceEnforcement,
  openfdaFoodEnforcement,
  cpscRecalls,
  ftcHsr,
];

export function adapterFor(source: string): SourceAdapter | undefined {
  return SOURCES.find((s) => s.source === source);
}

/** Sources of the brief that are not scheduled, and why (shown in the handoff and kept here for the next pass). */
export const NOT_SCHEDULED: { dataset: string; reason: string }[] = [
  {
    dataset: "agency_safety_nhtsa_recalls",
    reason:
      "Built from NHTSA's FLAT_RCL_POST_2010 flat file (one line per vehicle, aggregated per campaign); the recalls API answers per-vehicle lookups with other fields, and the flat file is too large to parse within an edge function's 2 s CPU limit.",
  },
  {
    dataset: "fsis_recalls",
    reason:
      "FSIS's recall API and file downloads refused direct requests with HTTP 403 when the dataset was built; the listing was read through a page-fetching service. A scheduled job would have to work around the block, which the rules forbid.",
  },
  {
    dataset: "doj_press_releases_<year>",
    reason:
      "The builder's figure extraction marks 'boilerplate' sentences by counting them across all ~275,000 releases (25 or more) and links companies through saved lookups; an incremental row cannot reproduce those dataset-wide rules exactly.",
  },
  {
    dataset: "sec_enforcement_actions",
    reason:
      "Built by parsing sec.gov listing pages and release texts with the same dataset-wide extraction as DOJ; there is no official structured feed whose records match the builder's shape.",
  },
  {
    dataset: "congress_bills",
    reason:
      "Built from GovInfo Bill Status XML (per-Congress zip files) with a public-law lookup; an exact incremental port needs an XML parser and per-bill re-reads against the api.data.gov key budget shared with other jobs. Planned as the next source.",
  },
  {
    dataset: "ftc_dnc_reported_calls",
    reason:
      "Monthly aggregates (state ranks, per-100,000 rates) recomputed from every daily file of a month and cross-checked against the FTC dashboard; the API's monthly count is documented to differ, so unattended monthly updates would publish unverified totals.",
  },
];
