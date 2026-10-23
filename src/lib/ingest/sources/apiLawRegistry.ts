/**
 * The wave 1025 api-law self-updating sources (one per row of ingest.sources registered by
 * database/contracts/api-law-v1.sql; apiLawRegistry.test.ts keeps the two in step). Kept apart from registry.ts so the
 * api-law contract can be applied and deployed on its own; the lead may fold these into SOURCES when merging.
 */
import {
  congressAmendments,
  congressCommitteeReports,
  congressNominations,
  congressTreaties,
} from "./congressGov.ts";
import { dojPressReleases2026, dojPressReleases2027 } from "./dojPressReleases.ts";
import { gaoLegalDecisions } from "./gaoLegal.ts";
import {
  govinfoBillVersions,
  govinfoCommitteePrints,
  govinfoGaoReports,
  govinfoHearings,
} from "./govinfo.ts";
import { regulationsGovDockets, regulationsGovDocuments } from "./regulationsGov.ts";
import { secEnforcement } from "./secEnforcement.ts";
import type { SourceAdapter } from "../types.ts";

export const API_LAW_SOURCES: SourceAdapter[] = [
  regulationsGovDocuments,
  regulationsGovDockets,
  secEnforcement,
  dojPressReleases2026,
  dojPressReleases2027,
  congressAmendments,
  congressNominations,
  congressTreaties,
  congressCommitteeReports,
  govinfoBillVersions,
  govinfoHearings,
  govinfoCommitteePrints,
  govinfoGaoReports,
  gaoLegalDecisions,
];

export function apiLawAdapter(source: string): SourceAdapter | undefined {
  return API_LAW_SOURCES.find((s) => s.source === source);
}
