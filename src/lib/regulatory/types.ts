/** Shared source-evidence and firm-work-product contracts. No credentials or inferred identities. */
export type RegulatoryJson =
  null | boolean | number | string | RegulatoryJson[] | { [key: string]: RegulatoryJson };
export const REGULATORY_SOURCE_IDS = [
  "federal_register",
  "fda_recall_notices",
  "fda_warning_letters",
  "openfda_enforcement_drug",
  "openfda_enforcement_device",
  "openfda_enforcement_food",
  "cpsc_recalls",
  "nhtsa_recalls",
  "nhtsa_investigations",
  "nhtsa_communications",
] as const;
export type RegulatorySourceId = (typeof REGULATORY_SOURCE_IDS)[number];
export type RegulatorySourceFamily = "fda" | "nhtsa" | "cpsc" | "federal_register";
export const REGULATORY_EVENT_TYPES = [
  "initial_record",
  "backfill",
  "new_record",
  "record_changed",
  "correction",
] as const;
export type RegulatoryEventType = (typeof REGULATORY_EVENT_TYPES)[number];
export type RegulatoryEntityRef = { namespace: string; native_id: string; label: string };
export type RegulatoryRecordData = {
  native_id: string;
  title: string;
  document_type: string;
  published_on: string | null;
  source_updated_on: string | null;
  source_url: string;
  agency_ids: string[];
  agency_names: string[];
  entity_refs: RegulatoryEntityRef[];
  identifiers: string[];
  status: string | null;
  fields: Record<string, RegulatoryJson>;
  correction_of: string[];
  evidence_excerpt: string;
};
export type RegulatoryIntakeRow = {
  data: RegulatoryRecordData;
  payload_sha256: string;
  raw_sha256: string;
  raw_storage_key: string;
  capture_source_url: string;
  record_pointer?: string;
  retrieved_at: string;
  schema_version: "regulatory-record/1";
};
export type RegulatorySource = {
  id: RegulatorySourceId;
  label: string;
  agency: string;
  sourceUrl: string;
  countUnit: string;
  qualification: string;
  enabled: boolean;
  latestCompletedAt: string | null;
  latestAttemptAt: string | null;
  latestAttemptStatus: "running" | "completed" | "partial" | "failed" | null;
  coverageFrom: string | null;
  coverageTo: string | null;
  records: number;
  events: number;
};
export type RegulatoryRun = {
  id: string;
  source: RegulatorySourceId;
  status: "running" | "completed" | "partial" | "failed";
  mode: "initial" | "incremental" | "backfill";
  startedAt: string;
  finishedAt: string | null;
  windowFrom: string;
  windowTo: string;
  expectedCount: number | null;
  observedCount: number;
  errorCode: string | null;
  scope: Record<string, RegulatoryJson>;
};
/** Dates filter detection or publication time, never an inferred incident date. */
export type RegulatoryQuery = {
  q?: string;
  source?: RegulatorySourceId;
  sourceFamily?: RegulatorySourceFamily;
  eventType?: RegulatoryEventType;
  from?: string;
  to?: string;
  dateBasis?: "detected" | "published";
  entityNamespace?: string;
  entityId?: string;
  limit?: number;
  offset?: number;
};
export type RegulatoryEvent = {
  id: string;
  source: RegulatorySourceId;
  nativeId: string;
  eventType: RegulatoryEventType;
  reason: string;
  changedFields: string[];
  detectedAt: string;
  payloadSha256: string;
  previousPayloadSha256: string | null;
  ruleVersion: "regulatory-events/1";
  record: RegulatoryRecordData;
};
export type RegulatoryEventPage = {
  items: RegulatoryEvent[];
  total: number;
  totalCapped: boolean;
  nextOffset: number | null;
  countUnit: "source-version events";
  dateBasis: "detected" | "published";
};
export type RegulatoryVersion = {
  payloadSha256: string;
  record: RegulatoryRecordData;
  firstObservedAt: string;
  lastObservedAt: string;
  rawSha256: string;
  captureSourceUrl: string;
  schemaVersion: string;
};
export type RegulatoryRecordDetail = {
  source: RegulatorySource;
  record: RegulatoryRecordData;
  payloadSha256: string;
  retrievedAt: string;
  versions: RegulatoryVersion[];
  versionsCapped: boolean;
  events: RegulatoryEvent[];
  eventsCapped: boolean;
  qualification: string;
} | null;
export type RegulatoryOverview = {
  sources: RegulatorySource[];
  runs: RegulatoryRun[];
  counts: { records: number; events: number; completedSources: number };
  qualifications: string[];
};
export type RegulatoryTrend = {
  points: { day: string; events: number; initialRecords: number; changes: number }[];
  countUnit: "source-version events";
  dateBasis: "detected" | "published";
  qualification: string;
  sources: RegulatorySource[];
};
export type RegulatoryEntityPage = {
  items: {
    namespace: string;
    nativeId: string;
    labels: string[];
    records: number;
    sources: string[];
  }[];
  total: number;
  totalCapped: boolean;
  nextOffset: number | null;
  qualification: string;
};
export type RegulatoryMembership = {
  organizationId: string;
  organizationName: string;
  role: "viewer" | "analyst" | "admin";
};
export type RegulatoryWorkspaceAccess =
  | { status: "sign_in_required" | "membership_required" | "unavailable"; message: string }
  | {
      status: "ready";
      memberships: RegulatoryMembership[];
      selectedOrganizationId: string;
      userId: string;
    };
export type RegulatoryInvestigation = {
  id: string;
  title: string;
  description: string;
  createdAt: string;
  updatedAt: string;
};
export type RegulatoryWatchlist = {
  id: string;
  name: string;
  query: RegulatoryQuery;
  investigationId: string | null;
  createdAt: string;
  updatedAt: string;
};
export const REGULATORY_REVIEW_STATUSES = [
  "triaged",
  "relevant",
  "dismissed",
  "needs_evidence",
] as const;
export type RegulatoryReview = {
  id: string;
  eventId: string;
  status: (typeof REGULATORY_REVIEW_STATUSES)[number];
  note: string;
  investigationId: string | null;
  reviewedBy: string;
  createdAt: string;
  source: string;
  nativeId: string;
  payloadSha256: string;
  needsReconsideration: boolean;
  sourceVerification?: "server_snapshot" | "imported_unverified";
  sourceCheckedAt?: string;
  sourceCheckStatus?: "current" | "changed" | "unavailable";
};
export type RegulatoryBrief = {
  id: string;
  title: string;
  investigationId: string | null;
  createdAt: string;
  createdBy: string;
  manifestSha256: string;
  sourceVerification?: "server_snapshot" | "imported_unverified";
  manifest?: {
    version: "regulatory-brief/1";
    generatedAt: string;
    title: string;
    query: RegulatoryQuery;
    events: RegulatoryEvent[];
    qualifications: string[];
    sources: RegulatorySource[];
    evidence: {
      eventId: string;
      runId: string;
      payloadSha256: string;
      rawSha256: string;
      captureSourceUrl: string;
      retrievedAt: string;
      recordPointer: string | null;
      parser: string;
      currentPayloadSha256?: string;
    }[];
    coverageRuns: RegulatoryRun[];
  };
};
export type RegulatoryEvidenceSnapshot = {
  manifestSha256: string;
  manifest: NonNullable<RegulatoryBrief["manifest"]>;
};
export type RegulatoryWorkProduct = {
  membership: RegulatoryMembership;
  investigations: RegulatoryInvestigation[];
  watchlists: RegulatoryWatchlist[];
  reviews: RegulatoryReview[];
  briefs: RegulatoryBrief[];
  listsCapped: boolean;
};
